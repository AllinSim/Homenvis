// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Commercial
//
// Homenvis — LBM-based indoor airflow simulation.
// Copyright (c) 2026 Haocheng Wen / AllinSim. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public
// License along with this program.  If not, see
// <https://www.gnu.org/licenses/>.
//
// Commercial licenses are available. Contact AllinSim for details.

/**
 * WGSL Compute Shaders for D3Q19 Lattice Boltzmann Method
 *
 * Architecture: Single f buffer + f_post intermediate, NO double-buffering
 *   Pass 1 (Collide): f → f_post  (read f, compute macro + Smagorinsky collide, write f_post)
 *   Pass 2 (Stream):  f_post → f  (read f_post, PULL stream + BB + BCs, write f)
 *   Pass 3 (Temp):    T → T_new  (read T, compute update, write T_new — avoids data race!)
 *   Copy:             T_new → T  (copy buffer after temp pass)
 *
 * Key fixes:
 *   1. UPWIND scheme: select() arguments corrected (were swapped → DOWNWIND = unstable!)
 *   2. Temperature data race: write to T_new, not T (like Python's T_np = copy)
 *   3. Smagorinsky LES (Cs=0.12) — matches Python reference
 *   4. Temperature update for ALL non-solid cells (including outlet)
 */

// =====================================================================
// Common WGSL: D3Q19 constants and helpers
// =====================================================================
export const LBM_COMMON = /* wgsl */`
const Q: u32 = 19u;

const EX: array<i32, 19> = array<i32, 19>(0, 1,-1, 0, 0, 0, 0, 1,-1, 1,-1, 1,-1, 1,-1, 0, 0, 0, 0);
const EY: array<i32, 19> = array<i32, 19>(0, 0, 0, 1,-1, 0, 0, 1,-1,-1, 1, 0, 0, 0, 0, 1,-1, 1,-1);
const EZ: array<i32, 19> = array<i32, 19>(0, 0, 0, 0, 0, 1,-1, 0, 0, 0, 0, 1,-1,-1, 1, 1,-1,-1, 1);

const WT: array<f32, 19> = array<f32, 19>(
  1.0/3.0,
  1.0/18.0, 1.0/18.0, 1.0/18.0, 1.0/18.0, 1.0/18.0, 1.0/18.0,
  1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0,
  1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0
);

// OPP[i] = index j such that e_j = -e_i (matches EX/EY/EZ ordering above).
// CRITICAL: must be consistent with the EX/EY/EZ tables — a mismatch silently
// breaks bounce-back (no-slip walls) and mass conservation.
const OPP: array<u32, 19> = array<u32, 19>(0u, 2u, 1u, 4u, 3u, 6u, 5u, 8u, 7u, 10u, 9u, 12u, 11u, 14u, 13u, 16u, 15u, 18u, 17u);

const CS2: f32 = 1.0 / 3.0;

// Sentinel for "no prescribed temperature" in ventTemp/heatTemp. Must match
// TEMP_UNSET in lbm-engine.ts. Normalized temperatures can be NEGATIVE (any
// physical T below T_min), so we cannot use 0 or -1 as the unset marker.
const TEMP_UNSET: f32 = -1e30;

const CELL_FLUID: u32 = 0u;
const CELL_SOLID: u32 = 1u;
const CELL_INLET: u32 = 2u;
const CELL_OUTLET: u32 = 3u;
const CELL_HEAT: u32 = 4u;

// Pre-computed e_ia * e_ib for Smagorinsky strain rate
const EX2: array<f32, 19> = array<f32, 19>(0,1,1,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0);
const EY2: array<f32, 19> = array<f32, 19>(0,0,0,1,1,0,0,1,1,1,1,0,0,0,0,1,1,1,1);
const EZ2: array<f32, 19> = array<f32, 19>(0,0,0,0,0,1,1,0,0,0,0,1,1,1,1,1,1,1,1);
// Cross products e_ia * e_ib for Smagorinsky strain rate.
// CRITICAL: must match EX/EY/EZ above (was previously using a different
// velocity ordering → wrong Pi_xy/Pi_xz/Pi_yz → broken LES).
const EXY: array<f32, 19> = array<f32, 19>(0,0,0,0,0,0,0,1,1,-1,-1,0,0,0,0,0,0,0,0);
const EXZ: array<f32, 19> = array<f32, 19>(0,0,0,0,0,0,0,0,0,0,0,1,1,-1,-1,0,0,0,0);
const EYZ: array<f32, 19> = array<f32, 19>(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,-1,-1);

fn idx3d(x: i32, y: i32, z: i32, Nx: i32, Ny: i32) -> u32 {
  return u32(x + y * Nx + z * Nx * Ny);
}

fn f_addr(i: u32, cell: u32) -> u32 {
  return i * 108000u + cell;  // will be overridden by P.C
}

// Search the 6 face-neighbors for the first FLUID cell and return its linear index.
// Returns u32(-1) if none found. Used by outlet / heat-source zero-gradient BCs so
// they work for vents placed on ANY wall (not just north/south).
// NOTE: cellType is referenced as the MODULE-SCOPE storage var declared by each
// shader that uses this helper. WGSL (naga / Firefox) forbids passing a storage
// pointer into a function — only Chrome's Dawn tolerated the old address-of form.
// Reading the module-scope global here is portable across all WebGPU backends.
// (Do NOT put backtick chars in this comment — it lives inside a JS template string.)
fn findFluidNeighbor(x: i32, y: i32, z: i32, Nx: i32, Ny: i32, Nz: i32) -> u32 {
  if (x > 0)          { let nc = idx3d(x-1, y, z, Nx, Ny); if (cellType[nc] == CELL_FLUID) { return nc; } }
  if (x < Nx - 1)     { let nc = idx3d(x+1, y, z, Nx, Ny); if (cellType[nc] == CELL_FLUID) { return nc; } }
  if (y > 0)          { let nc = idx3d(x, y-1, z, Nx, Ny); if (cellType[nc] == CELL_FLUID) { return nc; } }
  if (y < Ny - 1)     { let nc = idx3d(x, y+1, z, Nx, Ny); if (cellType[nc] == CELL_FLUID) { return nc; } }
  if (z > 0)          { let nc = idx3d(x, y, z-1, Nx, Ny); if (cellType[nc] == CELL_FLUID) { return nc; } }
  if (z < Nz - 1)     { let nc = idx3d(x, y, z+1, Nx, Ny); if (cellType[nc] == CELL_FLUID) { return nc; } }
  return 0xFFFFFFFFu;
}
`;

// =====================================================================
// Params struct (shared by ALL shaders)
// Offset:  0    4    8   12   16     20      24       28      32      36
// =====================================================================
const PARAMS_STRUCT = /* wgsl */`
struct Params {
  Nx: u32, Ny: u32, Nz: u32, C: u32,
  omega: f32, alphaT: f32, roomTemp: f32, Cs: f32,
  g_lat: f32, T_ref: f32,
};
`;

// =====================================================================
// Shader 1: Initialize f to equilibrium
// =====================================================================
export const INIT_SHADER = /* wgsl */`
${LBM_COMMON}
${PARAMS_STRUCT}

@group(0) @binding(0) var<storage, read_write> f: array<f32>;
@group(0) @binding(1) var<storage, read> cellType: array<u32>;
@group(0) @binding(2) var<storage, read> ventVelX: array<f32>;
@group(0) @binding(3) var<storage, read> ventVelY: array<f32>;
@group(0) @binding(4) var<storage, read> ventVelZ: array<f32>;
@group(0) @binding(5) var<storage, read> ventTemp: array<f32>;
@group(0) @binding(6) var<storage, read> heatTemp: array<f32>;
@group(0) @binding(7) var<storage, read_write> T: array<f32>;
@group(0) @binding(8) var<storage, read_write> rho_out: array<f32>;
@group(0) @binding(9) var<storage, read_write> ux_out: array<f32>;
@group(0) @binding(10) var<storage, read_write> uy_out: array<f32>;
@group(0) @binding(11) var<storage, read_write> uz_out: array<f32>;
@group(0) @binding(12) var<uniform> P: Params;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // 2D dispatch计算线程索引
  // workgroup_size是(64,1,1)，dispatch是(dispatchX, dispatchY, 1)
  // gid.x 范围: [0, dispatchX * 64)
  // gid.y 范围: [0, dispatchY)
  // 线性索引: cell = gid.x + gid.y * (dispatchX * 64)
  // 但dispatchX不是常量，所以用第一维最大值65535*64代替
  let cell = gid.x + gid.y * 4194240u; // 65535 * 64
  if (cell >= P.C) { return; }
  let ct = cellType[cell];

  // Solid: skip (f stays zero)
  if (ct == CELL_SOLID) {
    rho_out[cell] = 1.0; ux_out[cell] = 0.0; uy_out[cell] = 0.0; uz_out[cell] = 0.0;
    T[cell] = P.roomTemp;
    return;
  }

  var vx: f32 = 0.0; var vy: f32 = 0.0; var vz: f32 = 0.0;
  var T_set: f32 = P.roomTemp;

  if (ct == CELL_INLET) {
    vx = ventVelX[cell]; vy = ventVelY[cell]; vz = ventVelZ[cell];
    if (ventTemp[cell] != TEMP_UNSET) { T_set = ventTemp[cell]; }
  }
  if (ct == CELL_HEAT) {
    if (heatTemp[cell] != TEMP_UNSET) { T_set = heatTemp[cell]; }
  }

  let usq = vx * vx + vy * vy + vz * vz;
  for (var i: u32 = 0u; i < Q; i = i + 1u) {
    let eu = f32(EX[i]) * vx + f32(EY[i]) * vy + f32(EZ[i]) * vz;
    f[i * P.C + cell] = WT[i] * (1.0 + eu / CS2 + eu * eu / (2.0 * CS2 * CS2) - usq / (2.0 * CS2));
  }

  rho_out[cell] = 1.0;
  ux_out[cell] = vx; uy_out[cell] = vy; uz_out[cell] = vz;
  T[cell] = T_set;
}
`;

// =====================================================================
// Shader 2: Collide (f → f_post) with Smagorinsky LES
// =====================================================================
export const COLLIDE_SHADER = /* wgsl */`
${LBM_COMMON}
${PARAMS_STRUCT}

@group(0) @binding(0) var<storage, read> f: array<f32>;
@group(0) @binding(1) var<storage, read_write> f_post: array<f32>;
@group(0) @binding(2) var<storage, read> cellType: array<u32>;
@group(0) @binding(3) var<storage, read> ventVelX: array<f32>;
@group(0) @binding(4) var<storage, read> ventVelY: array<f32>;
@group(0) @binding(5) var<storage, read> ventVelZ: array<f32>;
@group(0) @binding(6) var<storage, read_write> rho_out: array<f32>;
@group(0) @binding(7) var<storage, read_write> ux_out: array<f32>;
@group(0) @binding(8) var<storage, read_write> uy_out: array<f32>;
@group(0) @binding(9) var<storage, read_write> uz_out: array<f32>;
@group(0) @binding(10) var<storage, read> T: array<f32>;
@group(0) @binding(11) var<uniform> P: Params;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // 2D dispatch计算线程索引
  // workgroup_size是(64,1,1)，dispatch是(dispatchX, dispatchY, 1)
  // gid.x 范围: [0, dispatchX * 64)
  // gid.y 范围: [0, dispatchY)
  // 线性索引: cell = gid.x + gid.y * (dispatchX * 64)
  // 但dispatchX不是常量，所以用第一维最大值65535*64代替
  let cell = gid.x + gid.y * 4194240u; // 65535 * 64
  if (cell >= P.C) { return; }
  let ct = cellType[cell];

  if (ct == CELL_SOLID) {
    rho_out[cell] = 1.0; ux_out[cell] = 0.0; uy_out[cell] = 0.0; uz_out[cell] = 0.0;
    return;
  }

  // Macroscopic variables
  var rho: f32 = 0.0; var mx: f32 = 0.0; var my: f32 = 0.0; var mz: f32 = 0.0;
  for (var i: u32 = 0u; i < Q; i = i + 1u) {
    let fi = f[i * P.C + cell];
    rho += fi; mx += f32(EX[i]) * fi; my += f32(EY[i]) * fi; mz += f32(EZ[i]) * fi;
  }
  rho = max(rho, 0.01);
  // If rho was clamped (would-be negative/drifted mass), discard the spurious
  // momentum rather than amplifying it (mx/eps → huge velocity).
  if (rho <= 0.01) { mx = 0.0; my = 0.0; mz = 0.0; }

  // Boussinesq buoyancy force (Guo forcing): F = rho * g_lat * (T - T_ref) in +z (up).
  // Hot cells (T > T_ref) rise, cold cells sink. Disabled when g_lat == 0.
  var Fx: f32 = 0.0; var Fy: f32 = 0.0; var Fz: f32 = 0.0;
  if (P.g_lat != 0.0) {
    let dT = T[cell] - P.T_ref;
    Fz = rho * P.g_lat * dT;   // +z = up
  }

  // Macroscopic velocity includes the half-force (Guo scheme): u = (Σ e_i f_i + F/2) / rho
  var vx = (mx + 0.5 * Fx) / rho;
  var vy = (my + 0.5 * Fy) / rho;
  var vz = (mz + 0.5 * Fz) / rho;

  // Inlet: override velocity (buoyancy irrelevant — velocity prescribed)
  if (ct == CELL_INLET) {
    vx = ventVelX[cell]; vy = ventVelY[cell]; vz = ventVelZ[cell];
  }

  rho_out[cell] = rho; ux_out[cell] = vx; uy_out[cell] = vy; uz_out[cell] = vz;

  // Compute equilibrium
  var feq: array<f32, 19>;
  let usq = vx * vx + vy * vy + vz * vz;
  for (var i: u32 = 0u; i < Q; i = i + 1u) {
    let eu = f32(EX[i]) * vx + f32(EY[i]) * vy + f32(EZ[i]) * vz;
    feq[i] = WT[i] * rho * (1.0 + eu / CS2 + eu * eu / (2.0 * CS2 * CS2) - usq / (2.0 * CS2));
  }

  // Smagorinsky LES: compute strain rate from non-equilibrium stress
  var Pi_xx: f32 = 0.0; var Pi_yy: f32 = 0.0; var Pi_zz: f32 = 0.0;
  var Pi_xy: f32 = 0.0; var Pi_xz: f32 = 0.0; var Pi_yz: f32 = 0.0;
  for (var i: u32 = 0u; i < Q; i = i + 1u) {
    let fneq = f[i * P.C + cell] - feq[i];
    Pi_xx += fneq * EX2[i]; Pi_yy += fneq * EY2[i]; Pi_zz += fneq * EZ2[i];
    Pi_xy += fneq * EXY[i]; Pi_xz += fneq * EXZ[i]; Pi_yz += fneq * EYZ[i];
  }
  let S_mag = sqrt(Pi_xx*Pi_xx + Pi_yy*Pi_yy + Pi_zz*Pi_zz + 2.0*(Pi_xy*Pi_xy + Pi_xz*Pi_xz + Pi_yz*Pi_yz));

  // Effective relaxation time with Smagorinsky (matches Python: nu_turb = Cs² * S_mag)
  let nu_mol = (1.0 / P.omega - 0.5) / 3.0;
  let nu_turb = P.Cs * P.Cs * S_mag;
  let tau_eff = max(3.0 * (nu_mol + nu_turb) + 0.5, 0.505);
  let omega_eff = 1.0 / tau_eff;

  // BGK collision + Guo body-force source term.
  // S_i = (1 - ω/2) w_i [ 3 (e_i - u)·F / cs² + 9 (e_i·u)(e_i·F) / cs⁴ ]
  let one_m_omega_half = 1.0 - 0.5 * omega_eff;
  for (var i: u32 = 0u; i < Q; i = i + 1u) {
    let eix = f32(EX[i]); let eiy = f32(EY[i]); let eiz = f32(EZ[i]);
    let eu = eix * vx + eiy * vy + eiz * vz;
    // (e_i - u) · F  =  e_i·F - u·F
    let eiF = eix * Fx + eiy * Fy + eiz * Fz;
    let uF  = vx * Fx + vy * Fy + vz * Fz;
    let Si  = one_m_omega_half * WT[i] * (3.0 * (eiF - uF) / CS2 + 9.0 * eu * eiF / (CS2 * CS2));
    f_post[i * P.C + cell] = f[i * P.C + cell] + omega_eff * (feq[i] - f[i * P.C + cell]) + Si;
  }
}
`;

// =====================================================================
// Shader 3: Stream + BB + BCs (f_post → f)
// =====================================================================
export const STREAM_SHADER = /* wgsl */`
${LBM_COMMON}
${PARAMS_STRUCT}

@group(0) @binding(0) var<storage, read> f_post: array<f32>;
@group(0) @binding(1) var<storage, read_write> f_out: array<f32>;
@group(0) @binding(2) var<storage, read> cellType: array<u32>;
@group(0) @binding(3) var<storage, read> ventVelX: array<f32>;
@group(0) @binding(4) var<storage, read> ventVelY: array<f32>;
@group(0) @binding(5) var<storage, read> ventVelZ: array<f32>;
@group(0) @binding(6) var<storage, read> ventTemp: array<f32>;
@group(0) @binding(7) var<storage, read> heatTemp: array<f32>;
@group(0) @binding(8) var<storage, read_write> T: array<f32>;
@group(0) @binding(9) var<uniform> P: Params;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // 2D dispatch计算线程索引
  // workgroup_size是(64,1,1)，dispatch是(dispatchX, dispatchY, 1)
  // gid.x 范围: [0, dispatchX * 64)
  // gid.y 范围: [0, dispatchY)
  // 线性索引: cell = gid.x + gid.y * (dispatchX * 64)
  // 但dispatchX不是常量，所以用第一维最大值65535*64代替
  let cell = gid.x + gid.y * 4194240u; // 65535 * 64
  if (cell >= P.C) { return; }
  let ct = cellType[cell];

  let Nx = i32(P.Nx); let Ny = i32(P.Ny); let Nz = i32(P.Nz);
  let z = i32(cell / (u32(Nx) * u32(Ny)));
  let rem = i32(cell) - z * Nx * Ny;
  let y = rem / Nx;
  let x = rem - y * Nx;

  // ---- PULL streaming + bounce-back for FLUID cells ----
  if (ct == CELL_FLUID) {
    for (var i: u32 = 0u; i < Q; i = i + 1u) {
      let xs = x - EX[i]; let ys = y - EY[i]; let zs = z - EZ[i];
      if (xs >= 0 && xs < Nx && ys >= 0 && ys < Ny && zs >= 0 && zs < Nz) {
        let src = idx3d(xs, ys, zs, Nx, Ny);
        let src_ct = cellType[src];
        if (src_ct == CELL_SOLID) {
          // Bounce-back: reflect at current cell
          f_out[i * P.C + cell] = f_post[OPP[i] * P.C + cell];
        } else {
          // PULL from source
          f_out[i * P.C + cell] = f_post[i * P.C + src];
        }
      } else {
        // Out of bounds: bounce-back
        f_out[i * P.C + cell] = f_post[OPP[i] * P.C + cell];
      }
    }
    return;
  }

  // ---- Inlet: enforce equilibrium at prescribed velocity ----
  if (ct == CELL_INLET) {
    let vx = ventVelX[cell]; let vy = ventVelY[cell]; let vz = ventVelZ[cell];
    let usq = vx * vx + vy * vy + vz * vz;
    for (var i: u32 = 0u; i < Q; i = i + 1u) {
      let eu = f32(EX[i]) * vx + f32(EY[i]) * vy + f32(EZ[i]) * vz;
      f_out[i * P.C + cell] = WT[i] * (1.0 + eu / CS2 + eu * eu / (2.0 * CS2 * CS2) - usq / (2.0 * CS2));
    }
    if (ventTemp[cell] != TEMP_UNSET) {
      T[cell] = ventTemp[cell];
    }
    return;
  }

  // ---- Outlet: zero-gradient from nearest interior fluid cell ----
  // Read from f_post (NOT f_out) to avoid data race
  if (ct == CELL_OUTLET) {
    let nc = findFluidNeighbor(x, y, z, Nx, Ny, Nz);
    if (nc != 0xFFFFFFFFu) {
      for (var i: u32 = 0u; i < Q; i = i + 1u) {
        f_out[i * P.C + cell] = f_post[i * P.C + nc];
      }
    } else {
      for (var i: u32 = 0u; i < Q; i = i + 1u) {
        f_out[i * P.C + cell] = WT[i];
      }
    }
    if (ventTemp[cell] != TEMP_UNSET) {
      T[cell] = ventTemp[cell];
    }
    return;
  }

  // ---- Heat source: zero-gradient from nearest interior fluid cell ----
  // Read from f_post (NOT f_out) to avoid data race
  if (ct == CELL_HEAT) {
    let nc = findFluidNeighbor(x, y, z, Nx, Ny, Nz);
    if (nc != 0xFFFFFFFFu) {
      for (var i: u32 = 0u; i < Q; i = i + 1u) {
        f_out[i * P.C + cell] = f_post[i * P.C + nc];
      }
    } else {
      for (var i: u32 = 0u; i < Q; i = i + 1u) {
        f_out[i * P.C + cell] = WT[i];
      }
    }
    if (heatTemp[cell] != TEMP_UNSET) {
      T[cell] = heatTemp[cell];
    }
    return;
  }

  // ---- Solid: nothing to do (f_out stays zero) ----
}
`;

// =====================================================================
// Shader 4: Temperature update (T → T_new, avoids data race!)
// =====================================================================
export const TEMPERATURE_SHADER = /* wgsl */`
${LBM_COMMON}
${PARAMS_STRUCT}

@group(0) @binding(0) var<storage, read> T: array<f32>;           // OLD temperature (read only!)
@group(0) @binding(1) var<storage, read_write> T_new: array<f32>; // NEW temperature (write)
@group(0) @binding(2) var<storage, read> cellType: array<u32>;
@group(0) @binding(3) var<storage, read> ux_in: array<f32>;
@group(0) @binding(4) var<storage, read> uy_in: array<f32>;
@group(0) @binding(5) var<storage, read> uz_in: array<f32>;
@group(0) @binding(6) var<uniform> P: Params;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // 2D dispatch计算线程索引
  // workgroup_size是(64,1,1)，dispatch是(dispatchX, dispatchY, 1)
  // gid.x 范围: [0, dispatchX * 64)
  // gid.y 范围: [0, dispatchY)
  // 线性索引: cell = gid.x + gid.y * (dispatchX * 64)
  // 但dispatchX不是常量，所以用第一维最大值65535*64代替
  let cell = gid.x + gid.y * 4194240u; // 65535 * 64
  if (cell >= P.C) { return; }
  let ct = cellType[cell];

  // Solid: T = roomTemp
  if (ct == CELL_SOLID) {
    T_new[cell] = P.roomTemp;
    return;
  }

  // Inlet and Heat: T is fixed by BCs (set in stream shader), copy to T_new
  if (ct == CELL_INLET || ct == CELL_HEAT) {
    T_new[cell] = T[cell];
    return;
  }

  // ---- Update T for FLUID and OUTLET cells ----
  let Nx = i32(P.Nx); let Ny = i32(P.Ny); let Nz = i32(P.Nz);
  let z = i32(cell / (u32(Nx) * u32(Ny)));
  let rem = i32(cell) - z * Nx * Ny;
  let y = rem / Nx;
  let x = rem - y * Nx;

  let Tc = T[cell];
  let vx = ux_in[cell]; let vy = uy_in[cell]; let vz = uz_in[cell];

  // Upwind advection
  // CRITICAL: select(falseVal, trueVal, cond)
  //   vx > 0 → flow from left → use BACKWARD diff (dTdx_m) → select(vx*dTdx_p, vx*dTdx_m, vx>0)
  //   vx ≤ 0 → flow from right → use FORWARD diff (dTdx_p) → select(vx*dTdx_p, vx*dTdx_m, vx>0)
  var adv: f32 = 0.0;
  if (x > 0 && x < Nx - 1) {
    let dTdx_p = T[idx3d(x+1, y, z, Nx, Ny)] - Tc;
    let dTdx_m = Tc - T[idx3d(x-1, y, z, Nx, Ny)];
    adv += select(vx * dTdx_p, vx * dTdx_m, vx > 0.0);
  }
  if (y > 0 && y < Ny - 1) {
    let dTdy_p = T[idx3d(x, y+1, z, Nx, Ny)] - Tc;
    let dTdy_m = Tc - T[idx3d(x, y-1, z, Nx, Ny)];
    adv += select(vy * dTdy_p, vy * dTdy_m, vy > 0.0);
  }
  if (z > 0 && z < Nz - 1) {
    let dTdz_p = T[idx3d(x, y, z+1, Nx, Ny)] - Tc;
    let dTdz_m = Tc - T[idx3d(x, y, z-1, Nx, Ny)];
    adv += select(vz * dTdz_p, vz * dTdz_m, vz > 0.0);
  }

  // Laplacian
  var lap: f32 = 0.0;
  if (x > 0 && x < Nx - 1) { lap += T[idx3d(x+1,y,z, Nx, Ny)] + T[idx3d(x-1,y,z, Nx, Ny)] - 2.0 * Tc; }
  if (y > 0 && y < Ny - 1) { lap += T[idx3d(x,y+1,z, Nx, Ny)] + T[idx3d(x,y-1,z, Nx, Ny)] - 2.0 * Tc; }
  if (z > 0 && z < Nz - 1) { lap += T[idx3d(x,y,z+1, Nx, Ny)] + T[idx3d(x,y,z-1, Nx, Ny)] - 2.0 * Tc; }

  T_new[cell] = clamp(Tc - adv + P.alphaT * lap, 0.1, 1.5);
}
`;
