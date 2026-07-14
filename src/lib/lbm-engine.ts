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
 * LBM Engine — WebGPU + CPU Fallback for D3Q19 Lattice Boltzmann Method
 *
 * WebGPU engine: Single f buffer + f_post, NO double-buffering
 *   Pass 1 (Collide): f → f_post  (read f, compute macro + collide, write f_post)
 *   Pass 2 (Stream):  f_post → f  (read f_post, PULL stream + BB + BCs, write f)
 *   Pass 3 (Temp):    T update    (separate pass to avoid race conditions)
 *
 * CRITICAL: JS bind group entries MUST exactly match WGSL @binding numbers!
 * Each shader declares its own bindings — count them carefully.
 */

import { INIT_SHADER, COLLIDE_SHADER, STREAM_SHADER, TEMPERATURE_SHADER } from './lbm-shaders';
import { cleanGPUName } from './clean-gpu-name';
import type { SwingSchedule } from './room-layout';
import { VENT_FACE_NORMALS } from './room-layout';

// =====================================================================
// Types
// =====================================================================
export interface DoorHoleItem {
  name: string;
  type: 'door_hole';
  parentBox: { x: number; y: number; z: number; L: number; W: number; H: number };
  wallFace: 'north' | 'south' | 'east' | 'west';
  offsetFromLeft: number;
  width: number;
  height: number;
  sillHeight: number;
}

export interface RoomItem {
  name: string;
  type: 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h' | 'door_hole' | 'vent_inlet' | 'vent_outlet' | 'heat_source';
  x: number; y: number; z: number;
  L: number; W: number; H: number;
  velocity?: [number, number, number];
  temperature?: number;
  rotZ?: number;              // 绕 z 轴旋转(弧度)，仅 box/prism 有效
  shape?: 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h'; // 形状（vent/heat 用，box/prism/cylinder 项由 type 决定）
  // door_hole specific fields (only present when type === 'door_hole')
  parentBox?: { x: number; y: number; z: number; L: number; W: number; H: number };
  wallFace?: 'north' | 'south' | 'east' | 'west';
  offsetFromLeft?: number;
  width?: number;
  height?: number;
  sillHeight?: number;
  // 扫风调度（仅 vent_inlet 有效；enabled 时每步重算出口速度方向）
  swing?: SwingSchedule;
  // 出风/回风施加面（几何体自身系：'+X'|'-X'|'+Y'|'-Y'|'+Z'|'-Z'）。
  // 设置后引擎只在该面最外一层格子施加边界条件，而非整个体积。
  // 缺省 → 整个体积标记（旧行为，向后兼容）。
  outflowFace?: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
}

/**
 * 扫风组：一个出风口的时变边界描述。
 * - runs: 该出风口覆盖的格子，按内存连续段压缩成 [start, length] 列表。
 *   markShape 按 (z 外, y 中, x 内) 遍历，故同一 (z,y) 行内连续 x 的格子
 *   在内存中相邻 → 可用一次 writeBuffer 上传一小段，避免上传整个 ventVel 缓冲区。
 * - baseVx/Vy/Vz: 出风口"基础速度向量"(格子单位)，由 setup 时的 velocity 经 rotZ 旋转得到。
 * - mode/amplitude/period/phase: 扫风参数(见 room-layout.SwingSchedule)。
 */
export interface SwingGroup {
  runs: [number, number][];   // [起始格子索引, 连续长度]
  baseVx: number; baseVy: number; baseVz: number;
  mode: 'horizontal' | 'vertical';
  amplitude: number;
  period: number;
  phase: number;
}

/** 把一个无序格子索引列表压缩成 [start, length] 连续段（按索引排序后合并相邻）。 */
function compressRuns(indices: number[]): [number, number][] {
  if (indices.length === 0) return [];
  const sorted = indices.slice().sort((a, b) => a - b);
  const runs: [number, number][] = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    runs.push([start, prev - start + 1]);
    start = sorted[i]; prev = sorted[i];
  }
  runs.push([start, prev - start + 1]);
  return runs;
}

/**
 * 扫风：把出风口基础速度向量(房间系)按模式摆动 ang 弧度，返回新速度向量。
 * 关键：保持速度大小不变，只改变方向。在房间坐标系下定义：
 *  - horizontal(水平扫风/左右)：水平方位角摆动，vz 不变。绕房间 z 轴旋转水平分量。
 *  - vertical(竖直扫风/上下)：俯仰角摆动，在铅垂面内旋转(水平幅值, vz)。
 * 对"纯竖直出风"(水平分量≈0)：两种模式本会退化(水平模式旋转零向量、竖直模式被跳过)，
 *  故强制注入默认水平方位使其可见——horizontal 沿房间 +x、vertical 沿房间 +y 倾斜。
 *  这样纯竖直散流器也能扫风，且两种模式产生不同方向的摆动。
 */
function applySwing(bvx: number, bvy: number, bvz: number, mode: 'horizontal' | 'vertical', ang: number): [number, number, number] {
  const mag = Math.hypot(bvx, bvy, bvz);
  if (mag < 1e-12) return [0, 0, 0];
  let dx = bvx / mag, dy = bvy / mag, dz = bvz / mag;
  const c = Math.cos(ang), s = Math.sin(ang);
  if (mode === 'horizontal') {
    const hMag = Math.hypot(dx, dy);
    if (hMag > 1e-6) {
      // 绕 z 轴旋转水平分量(方位角摆动)
      const nx = dx * c + dy * s;
      const ny = -dx * s + dy * c;
      dx = nx; dy = ny;
    } else {
      // 纯竖直：注入 +x 方向倾斜
      dx = s; dy = 0; dz = c * (dz >= 0 ? 1 : -1);
    }
  } else {
    const hMag = Math.hypot(dx, dy);
    if (hMag > 1e-6) {
      const ux = dx / hMag, uy = dy / hMag;
      const nH = hMag * c - dz * s;
      const nZ = hMag * s + dz * c;
      dx = ux * nH; dy = uy * nH; dz = nZ;
    } else {
      // 纯竖直：注入 +y 方向倾斜
      dx = 0; dy = s; dz = c * (dz >= 0 ? 1 : -1);
    }
  }
  return [dx * mag, dy * mag, dz * mag];
}

export interface LBMParams {
  omega: number;    // BGK relaxation rate = 1/tau
  alphaT: number;   // Lattice thermal diffusivity
  tau: number;      // Relaxation time (tau > 0.5 for stability, safe range 0.6~0.8)
  u_char: number;   // Lattice characteristic velocity
  u_scale: number;  // Physical velocity per lattice velocity unit (m/s per lattice unit)
  dx: number;       // Lattice spacing in physical units (m)
  dt_phys: number;  // Physical time per LBM step (s)
  Re_lattice: number; // Lattice Reynolds number
  // Boussinesq buoyancy (natural convection). g_lat = lattice gravity accel (dx-units / step²).
  // Force on fluid ∝ g_lat * (T - T_ref). When g_lat == 0 buoyancy is disabled.
  g_lat: number;
  T_ref: number;    // Reference (dimensionless) temperature for buoyancy, ~ roomTemp
}

export interface RoomConfig {
  length: number; width: number; height: number;
  items: RoomItem[];
  initialTemp?: number; // 初始温度（无量纲，0-1范围）
  lbmParams?: LBMParams; // 预计算的 LBM 格子参数（推荐由 page.tsx 动态计算后传入）
}

export interface SimResults {
  rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array;
  T: Float32Array; step: number;
}

// Cell type constants (must match WGSL)
const CELL_FLUID  = 0;
const CELL_SOLID  = 1;
const CELL_INLET  = 2;
const CELL_OUTLET = 3;
const CELL_HEAT   = 4;

/**
 * Sentinel marking "no prescribed temperature" in ventTemp/heatTemp arrays.
 *
 * WHY a large-negative value (NOT -1): temperatures are stored NORMALIZED as
 * (T_phys - T_min) / (T_max - T_min), which is NEGATIVE for any physical
 * temperature below T_min (default 15 °C). So a 0 °C window → -0.75, and the
 * old `>= 0` / `== -1` sentinel tests treated every sub-T_min boundary as
 * "unset", silently dropping the boundary (the cell stayed at roomTemp).
 * -1e30 is far outside any plausible normalized temperature, so it is an
 * unambiguous "unset" marker that never collides with real values.
 * (Must match TEMP_UNSET in lbm-shaders.ts.)
 */
export const TEMP_UNSET = -1e30;

const UNIFORM_SIZE = 256;

// =====================================================================
// Rotated-shape rasterization helpers (z-axis rotation, applied in room xy plane)
// Used by box/prism cell marking so rotated obstacles block flow correctly.
// All shapes are defined in a LOCAL frame centered at the object's horizontal
// center; the caller inverse-rotates a cell's center into this frame first.
// =====================================================================

/** Point (lx,ly) inside an axis-aligned rect [-L/2,L/2]×[-W/2,W/2] centered at origin. */
function pointInRect(lx: number, ly: number, L: number, W: number): boolean {
  return Math.abs(lx) <= L / 2 && Math.abs(ly) <= W / 2;
}

/**
 * Cell-overlap test for an axis-aligned rect: the cell (size dx, centered at
 * (lx,ly) in the local frame) OVERLAPS [-L/2,L/2]×[-W/2,W/2]. This is a
 * "radius = dx/2" expansion of pointInRect and correctly captures THIN features
 * (e.g. a window heat-source or thin wall with W < dx) which the center-in-rect
 * test would miss entirely. Standard for LBM rasterization: obstacles/boundaries
 * must occupy at least one cell to take effect.
 */
function cellOverlapsRect(lx: number, ly: number, L: number, W: number, dx: number): boolean {
  const r = dx / 2;
  return Math.abs(lx) <= L / 2 + r && Math.abs(ly) <= W / 2 + r;
}

/**
 * Point (lx,ly) inside the prism's right-triangle cross-section, centered at origin.
 * Prism occupies room [x,x+L]×[y-W,y]; vertices (room) (x,y),(x+L,y),(x,y-W).
 * Relative to center (x+L/2, y-W/2) the local vertices are:
 *   (-L/2,  W/2), (L/2, W/2), (-L/2, -W/2)  — right angle at (-L/2, W/2).
 * Uses three edge same-sign tests.
 */
function pointInTri(lx: number, ly: number, L: number, W: number): boolean {
  const v0x = -L / 2, v0y = W / 2;   // right-angle corner
  const v1x = L / 2,  v1y = W / 2;
  const v2x = -L / 2, v2y = -W / 2;
  const d1 = (lx - v1x) * (v0y - v1y) - (ly - v1y) * (v0x - v1x);
  const d2 = (lx - v2x) * (v1y - v2y) - (ly - v2y) * (v1x - v2x);
  const d3 = (lx - v0x) * (v2y - v0y) - (ly - v0y) * (v2x - v0x);
  const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(neg && pos);
}

/**
 * 立面楔形 prism_y 的截面测试：三角形在 (y'=W, z'=H) 立面内，挤出沿 x'(=L)。
 * 以包围盒中心为原点，三角形顶点：后下(+W/2,+H/2)、后上(+W/2,-H/2)、前下(-W/2,+H/2)，
 * 直角在后下(+W/2,+H/2)（贴墙竖边与顶边相交），斜面连接后上与前下（朝 -y' 自上而下前倾，
 * 即下端在前、上端贴墙顶——整体上下翻转后的侧吸形态）。入参 (ly, lz) 已中心化。
 */
function pointInTriYZ(ly: number, lz: number, W: number, H: number): boolean {
  const v0y = W / 2,  v0z = H / 2;   // 后下(直角, 顶)
  const v1y = W / 2,  v1z = -H / 2;  // 后上(底)
  const v2y = -W / 2, v2z = H / 2;   // 前下(顶)
  const d1 = (ly - v1y) * (v0z - v1z) - (lz - v1z) * (v0y - v1y);
  const d2 = (ly - v2y) * (v1z - v2z) - (lz - v2z) * (v1y - v2y);
  const d3 = (ly - v0y) * (v2z - v0z) - (lz - v0z) * (v2y - v0y);
  const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(neg && pos);
}

/**
 * Mark cells of an extruded shape (extruded along z/height) that may be rotated
 * about the object's horizontal center by `rotZ` (radians, CCW about +z).
 * `cx, cy` = horizontal center (room coords). `test` decides membership of a
 * cell center expressed in the LOCAL frame (centered at origin, pre-rotation).
 * Writes CELL_SOLID into `cellType` for matching cells across z∈[z0,z1).
 */
function markRotatedExtruded(
  cellType: Uint32Array | Uint8Array,
  Nx: number, Ny: number, dx: number,
  cx: number, cy: number, z0: number, z1: number,
  L: number, W: number, rotZ: number,
  isPrism: boolean,
  NxMax: number, NyMax: number, NzMax: number,
) {
  const iz0 = Math.max(Math.round(z0 / dx), 0);
  const iz1 = Math.min(Math.max(Math.round(z1 / dx), iz0 + 1), NzMax);
  if (rotZ === 0) {
    // Fast path: axis-aligned bounding box in local frame.
    const lx0 = -L / 2, lx1 = L / 2, ly0 = -W / 2, ly1 = W / 2;
    const ix0 = Math.max(Math.floor((cx + lx0) / dx), 0);
    const ix1 = Math.min(Math.ceil((cx + lx1) / dx), NxMax);
    const iy0 = Math.max(Math.floor((cy + ly0) / dx), 0);
    const iy1 = Math.min(Math.ceil((cy + ly1) / dx), NyMax);
    for (let z = iz0; z < iz1; z++)
      for (let y = iy0; y < iy1; y++)
        for (let x = ix0; x < ix1; x++) {
          const gx = (x + 0.5) * dx - cx, gy = (y + 0.5) * dx - cy;
          // Overlap (not center-containment) so THIN walls (W < dx) still get marked.
          const inside = isPrism ? pointInTri(gx, gy, L, W) : cellOverlapsRect(gx, gy, L, W, dx);
          if (inside) cellType[x + y * Nx + z * Nx * Ny] = CELL_SOLID;
        }
    return;
  }
  // Rotated: iterate the rotated AABB (with 1-cell margin) and inverse-rotate each cell.
  const cos = Math.cos(rotZ), sin = Math.sin(rotZ);
  // Local AABB half-extent (rect or tri both fit in [-L/2,L/2]×[-W/2,W/2]).
  const halfDiag = Math.sqrt(L * L + W * W) / 2;
  const ix0 = Math.max(Math.floor((cx - halfDiag) / dx) - 1, 0);
  const ix1 = Math.min(Math.ceil((cx + halfDiag) / dx) + 1, NxMax);
  const iy0 = Math.max(Math.floor((cy - halfDiag) / dx) - 1, 0);
  const iy1 = Math.min(Math.ceil((cy + halfDiag) / dx) + 1, NyMax);
  for (let z = iz0; z < iz1; z++)
    for (let y = iy0; y < iy1; y++)
      for (let x = ix0; x < ix1; x++) {
        const gx = (x + 0.5) * dx - cx, gy = (y + 0.5) * dx - cy;
        // 与渲染一致：渲染端 <group rotation={[0,rotZ,0]}> 绕 Three 世界 Y(=房间 z)
        // 旋转，由于 room(y,z)→Three(Z,Y) 手性翻转，正向 rotZ 在房间 x-y 平面为
        // 顺时针(CW)。故 LBM 正向亦取 CW：
        //   gx = lx*cos + ly*sin,  gy = -lx*sin + ly*cos
        // 其逆(local = R^{-1}·(gx,gy))为：
        const lx = gx * cos - gy * sin;
        const ly = gx * sin + gy * cos;
        // Overlap (not center-containment) so THIN walls (W < dx) still get marked.
        const inside = isPrism ? pointInTri(lx, ly, L, W) : cellOverlapsRect(lx, ly, L, W, dx);
        if (inside) cellType[x + y * Nx + z * Nx * Ny] = CELL_SOLID;
      }
}

/**
 * 圆柱(竖放)：轴沿 z(竖直)。半径 r=min(L,W)/2，高度 z∈[z0,z1)。
 * 水平截面为圆，中心 (cx,cy)=(x+L/2, y+W/2)。支持 rotZ 绕中心旋转(CW，与渲染一致)。
 * 旋转不改变圆的形状(圆对称)，但保留参数以备未来非圆截面扩展。
 */
function markCylinderV(
  cellType: Uint32Array | Uint8Array,
  Nx: number, Ny: number, dx: number,
  x: number, y: number, z0: number, z1: number,
  L: number, W: number, rotZ: number,
  NxMax: number, NyMax: number, NzMax: number,
) {
  const cx = x + L / 2, cy = y + W / 2;
  const r = Math.min(L, W) / 2;
  const iz0 = Math.max(Math.round(z0 / dx), 0);
  const iz1 = Math.min(Math.max(Math.round(z1 / dx), iz0 + 1), NzMax);
  const rCell = r / dx;
  const ix0 = Math.max(Math.floor((cx - r) / dx) - 1, 0);
  const ix1 = Math.min(Math.ceil((cx + r) / dx) + 1, NxMax);
  const iy0 = Math.max(Math.floor((cy - r) / dx) - 1, 0);
  const iy1 = Math.min(Math.ceil((cy + r) / dx) + 1, NyMax);
  const r2 = rCell * rCell;
  for (let z = iz0; z < iz1; z++)
    for (let yy = iy0; yy < iy1; yy++)
      for (let xx = ix0; xx < ix1; xx++) {
        const gx = (xx + 0.5) - cx / dx, gy = (yy + 0.5) - cy / dx;
        if (gx * gx + gy * gy <= r2) cellType[xx + yy * Nx + z * Nx * Ny] = CELL_SOLID;
      }
}

/**
 * 圆柱(横放)：轴默认沿房间 x(水平)，轴向长度 L，半径 r=min(W,H)/2。
 * 中心 (cx,cy,cz)=(x+L/2, y+W/2, z+H/2)。圆截面在 y-z 平面。
 * rotZ 绕竖直轴在水平面内旋转轴向(CW)：先把水平偏移逆旋转回局部，再判定
 * |lx| ≤ L/2 且 ly² + lz² ≤ r²（lz = z 相对中心，z 不随 rotZ 变）。
 */
function markCylinderH(
  cellType: Uint32Array | Uint8Array,
  Nx: number, Ny: number, dx: number,
  x: number, y: number, z0: number, z1: number,
  L: number, W: number, H: number, rotZ: number,
  NxMax: number, NyMax: number, NzMax: number,
) {
  const cx = x + L / 2, cy = y + W / 2, cz = z0 + H / 2;
  const r = Math.min(W, H) / 2;
  const cos = Math.cos(rotZ), sin = Math.sin(rotZ);
  // 旋转后轴在水平面的投影半长 = L/2，半径方向覆盖 r。外接水平框半对角 ≈ sqrt((L/2)²+r²)
  const halfDiag = Math.sqrt((L / 2) * (L / 2) + r * r);
  const ix0 = Math.max(Math.floor((cx - halfDiag) / dx) - 1, 0);
  const ix1 = Math.min(Math.ceil((cx + halfDiag) / dx) + 1, NxMax);
  const iy0 = Math.max(Math.floor((cy - halfDiag) / dx) - 1, 0);
  const iy1 = Math.min(Math.ceil((cy + halfDiag) / dx) + 1, NyMax);
  const iz0 = Math.max(Math.round((cz - r) / dx), 0);
  const iz1 = Math.min(Math.max(Math.round((cz + r) / dx), iz0 + 1), NzMax);
  const halfL = L / 2;
  const r2 = r * r;
  for (let z = iz0; z < iz1; z++)
    for (let yy = iy0; yy < iy1; yy++)
      for (let xx = ix0; xx < ix1; xx++) {
        const gx = (xx + 0.5) * dx - cx, gy = (yy + 0.5) * dx - cy;
        // 逆旋转(CW 正向，逆为 local=R^{-1}·(gx,gy))
        const lx = gx * cos - gy * sin;
        const ly = gx * sin + gy * cos;
        const lz = (z + 0.5) * dx - cz;
        if (Math.abs(lx) <= halfL && ly * ly + lz * lz <= r2) cellType[xx + yy * Nx + z * Nx * Ny] = CELL_SOLID;
      }
}

/**
 * 统一形状栅格化：按 shape（box/prism/cylinder_v/cylinder_h）标记落入体积的 cell。
 * 写入 cellType=cellVal 并调用 setter 回填速度/温度等（SOLID 时 setter 为空）。
 * 中心：box/prism/cylinder_v 水平中心 (x+L/2, y+W/2)，z 挤出 [z0,z0+H)；
 *       cylinder_h 中心 (x+L/2, y+W/2, z0+H/2)，轴默认沿局部 x，半径=min(W,H)/2。
 * rotZ 绕水平中心 CW 旋转（与渲染一致）。prism 中心沿用 (x+L/2, y-W/2)（与 SOLID 一致）。
 */
function markShape(
  cellType: Uint32Array | Uint8Array,
  Nx: number, Ny: number, dx: number,
  x: number, y: number, z0: number, H: number,
  L: number, W: number, shape: 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h',
  rotZ: number,
  cellVal: number,
  setter: (idx: number) => void,
  NxMax: number, NyMax: number, NzMax: number,
) {
  const isPrism = shape === 'prism';
  const cx = x + L / 2;
  const cy = isPrism ? y - W / 2 : y + W / 2;
  const cos = Math.cos(rotZ), sin = Math.sin(rotZ);

  // 水平候选框与 z 范围（按形状）
  let halfX: number, halfY: number;      // 局部水平半尺寸（旋转后外接框）
  let zCenter: number, zHalf: number;    // z 中心与半高
  let rv = 0, ryz = 0;                   // 半径（水平 / y-z 面）
  if (shape === 'cylinder_v') {
    rv = Math.min(L, W) / 2; halfX = rv; halfY = rv; zCenter = z0 + H / 2; zHalf = H / 2;
  } else if (shape === 'cylinder_h') {
    ryz = Math.min(W, H) / 2; halfX = L / 2; halfY = ryz; zCenter = z0 + H / 2; zHalf = ryz;
  } else {
    halfX = L / 2; halfY = W / 2; zCenter = z0 + H / 2; zHalf = H / 2;
  }
  // 旋转后水平外接半对角
  const hDiag = Math.sqrt(halfX * halfX + halfY * halfY);
  const ix0 = Math.max(Math.floor((cx - hDiag) / dx) - 1, 0);
  const ix1 = Math.min(Math.ceil((cx + hDiag) / dx) + 1, NxMax);
  const iy0 = Math.max(Math.floor((cy - hDiag) / dx) - 1, 0);
  const iy1 = Math.min(Math.ceil((cy + hDiag) / dx) + 1, NyMax);
  const iz0 = Math.max(Math.round((zCenter - zHalf) / dx), 0);
  const iz1 = Math.min(Math.max(Math.round((zCenter + zHalf) / dx), iz0 + 1), NzMax);

  const halfL = L / 2, halfW = W / 2;
  const rv2 = rv * rv, ryz2 = ryz * ryz;
  // Overlap margin: a cell (size dx) is considered inside if its center is within
  // the shape expanded by dx/2. This guarantees THIN features (W or H < dx, e.g. a
  // window heat-source of W=0.01m) still mark at least one cell layer, so the
  // boundary actually takes effect. Center-containment would silently drop them.
  const r = dx / 2;
  const rv2o = (rv + r) * (rv + r);          // cylinder_v overlap (radius+dx/2)²
  const ryz2o = (ryz + r) * (ryz + r);       // cylinder_h cross-section overlap
  for (let z = iz0; z < iz1; z++) {
    const lz = (z + 0.5) * dx - zCenter;
    for (let yy = iy0; yy < iy1; yy++)
      for (let xx = ix0; xx < ix1; xx++) {
        const gx = (xx + 0.5) * dx - cx, gy = (yy + 0.5) * dx - cy;
        // 逆旋转(CW 正向，逆为 local=R^{-1}·(gx,gy))
        const lx = gx * cos - gy * sin;
        const ly = gx * sin + gy * cos;
        let inside = false;
        if (shape === 'box') inside = Math.abs(lx) <= halfL + r && Math.abs(ly) <= halfW + r;
        else if (shape === 'prism') inside = pointInTri(lx, ly, L, W);
        else if (shape === 'prism_y') inside = Math.abs(lx) <= halfL + r && pointInTriYZ(ly, lz, W, H);
        else if (shape === 'cylinder_v') inside = lx * lx + ly * ly <= rv2o;
        else { // cylinder_h
          inside = Math.abs(lx) <= halfL + r && ly * ly + lz * lz <= ryz2o;
        }
        if (inside) {
          const idx = xx + yy * Nx + z * Nx * Ny;
          cellType[idx] = cellVal;
          setter(idx);
        }
      }
  }
}

/**
 * 仅标记几何体某一面最外一层格子（用于"出风/回风面"边界条件）。
 * 与 markShape 相同的坐标/旋转约定（自身系 X'沿L, Y'沿W, Z'沿H；rotZ 只旋转水平面）。
 * face 为自身系面标识；标记该面外法向最外一层格子（厚度约 dx），其余格子不动。
 * 仅对 box 形状有意义（prism/cylinder 的"面"语义复杂，故有 face 时按 box 外接处理）。
 */
function markFace(
  cellType: Uint32Array | Uint8Array,
  Nx: number, Ny: number, dx: number,
  x: number, y: number, z0: number, H: number,
  L: number, W: number, rotZ: number,
  face: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z',
  cellVal: number,
  setter: (idx: number) => void,
  NxMax: number, NyMax: number, NzMax: number,
) {
  const cx = x + L / 2;
  const cy = y + W / 2;
  const zCenter = z0 + H / 2;
  const cos = Math.cos(rotZ), sin = Math.sin(rotZ);
  const halfL = L / 2, halfW = W / 2, halfH = H / 2;
  const n = VENT_FACE_NORMALS[face]; // [nx', ny', nz'] 自身系单位法向

  // 面内两轴的半尺寸与法向轴半尺寸
  // 法向轴：0=X'(L) / 1=Y'(W) / 2=Z'(H)
  const normalAxis = n[0] !== 0 ? 0 : (n[1] !== 0 ? 1 : 2);
  const halfNormal = normalAxis === 0 ? halfL : normalAxis === 1 ? halfW : halfH;
  // 面内半尺寸（另两轴）
  const halfA = normalAxis === 0 ? halfW : halfL; // 第一个面内轴
  const halfB = normalAxis === 2 ? halfW : halfH; // 第二个面内轴

  // 旋转后水平外接半对角（用于候选框；与 box markShape 一致）
  const hDiag = Math.sqrt(halfL * halfL + halfW * halfW);
  const ix0 = Math.max(Math.floor((cx - hDiag) / dx) - 1, 0);
  const ix1 = Math.min(Math.ceil((cx + hDiag) / dx) + 1, NxMax);
  const iy0 = Math.max(Math.floor((cy - hDiag) / dx) - 1, 0);
  const iy1 = Math.min(Math.ceil((cy + hDiag) / dx) + 1, NyMax);
  const iz0Base = Math.max(Math.round((zCenter - halfH) / dx), 0);
  const iz1Base = Math.min(Math.max(Math.round((zCenter + halfH) / dx), iz0Base + 1), NzMax);

  const r = dx / 2;
  const nSign = n[normalAxis];
  const thin = halfNormal <= r;
  // 普通厚度(halfNormal > dx/2)：取该面侧最外一层格子，lc 沿法向 nSign 同号且 |lc|∈[halfNormal-r, halfNormal+r]。
  if (!thin) {
    for (let z = iz0Base; z < iz1Base; z++) {
      const lz = (z + 0.5) * dx - zCenter;
      for (let yy = iy0; yy < iy1; yy++)
        for (let xx = ix0; xx < ix1; xx++) {
          const gx = (xx + 0.5) * dx - cx, gy = (yy + 0.5) * dx - cy;
          // 逆旋转到自身系 (CW 正向)
          const lx = gx * cos - gy * sin;
          const ly = gx * sin + gy * cos;
          const lc = normalAxis === 0 ? lx : normalAxis === 1 ? ly : lz;
          const la = normalAxis === 0 ? ly : lx;
          const lb = normalAxis === 2 ? ly : lz;
          const inFace = Math.abs(la) <= halfA + r && Math.abs(lb) <= halfB + r;
          const onOuterLayer = nSign * lc > 0 && Math.abs(lc) >= halfNormal - r && Math.abs(lc) <= halfNormal + r;
          if (inFace && onOuterLayer) {
            const idx = xx + yy * Nx + z * Nx * Ny;
            cellType[idx] = cellVal;
            setter(idx);
          }
        }
    }
    return;
  }
  // 薄风口(halfNormal ≤ dx/2，如柜机/壁挂出风口 W=0.04 < dx)：风口几何整体埋在设备 box
  // 容差带内，无论取中心层还是外缘层都落在设备实体格(被 markShape 的 +r 容差吞掉)，
  // 表现为出风面被堵、旋转后"没有出风"。
  // 正确做法：每个面内列沿【外法向】搜索风口外缘(nlc≥halfNormal)之外的【第一个非实体格】，
  // 即设备表面外的空气层。该层才是真正能进/出风的边界面，且旋转任意角度都不依赖设备尺寸。
  // 面内列必须用【自身系面内坐标 la/lb 量化到格子】作 key——若用房间系格索引(xx/yy/z)作 key，
  // 旋转 90°/270° 时风口对角线方向的多个自身列会映射到同一房间格，造成面内列去重错误、
  // 出风面只剩两列。按 la/lb 各自量化到最近格子中心(±dx/2 容差)，保证每个自身列唯一。
  //
  // 关键：薄风口外法向搜索需要越过设备实体找到外侧第一空气格。水平法向(X/Y)的候选框
  // 已由 hDiag 覆盖足够范围；但法向轴为 Z 时(如吸顶换气扇回风口 -Z：风口贴设备底面、halfH=0.01)，
  // 候选 z 范围只有风口自身 ±0.01，根本到不了设备底面下方的空气格 → 整个回风面 0 格。
  // 因此仅对 Z 法向薄风口扩展 z 搜索范围；避免影响已经正确的水平出/回风口。
  const ix0t = ix0;
  const ix1t = ix1;
  const iy0t = iy0;
  const iy1t = iy1;
  const iz0t = normalAxis === 2 ? 0 : iz0Base;
  const iz1t = normalAxis === 2 ? NzMax : iz1Base;
  const best = new Map<number, { nlc: number; idx: number }>();
  for (let z = iz0t; z < iz1t; z++) {
    const lz = (z + 0.5) * dx - zCenter;
    for (let yy = iy0t; yy < iy1t; yy++)
      for (let xx = ix0t; xx < ix1t; xx++) {
        const gx = (xx + 0.5) * dx - cx, gy = (yy + 0.5) * dx - cy;
        const lx = gx * cos - gy * sin;
        const ly = gx * sin + gy * cos;
        const lc = normalAxis === 0 ? lx : normalAxis === 1 ? ly : lz;
        const la = normalAxis === 0 ? ly : lx;
        const lb = normalAxis === 2 ? ly : lz;
        if (Math.abs(la) > halfA + r || Math.abs(lb) > halfB + r) continue; // 不在面内
        const nlc = nSign * lc;
        if (nlc < halfNormal) continue;               // 风口内侧，跳过
        const idx = xx + yy * Nx + z * Nx * Ny;
        if (cellType[idx] === CELL_SOLID) continue;    // 实体格，等外侧空气格
        // 自身系面内列量化到格子(每格 ±dx/2)，la/lb 量化索引组合作 key
        const lai = Math.round(la / dx);
        const lbi = Math.round(lb / dx);
        const key = lai * 100000 + lbi;
        const cur = best.get(key);
        if (cur === undefined || nlc < cur.nlc) best.set(key, { nlc, idx });
      }
  }
  for (const { idx } of best.values()) {
    cellType[idx] = cellVal;
    setter(idx);
  }
}


// =====================================================================
// WebGPU Engine — Single f buffer, NO double-buffering
// =====================================================================

/**
 * 请求一个高性能 GPU 适配器。
 *
 * 问题：navigator.gpu.requestAdapter() 不传参数时，浏览器通常返回 0 号适配器，
 * 在"集显 + 独显"的双显卡机器上 0 号往往是集成显卡，导致 WebGPU 默认跑在弱核上。
 *
 * 解决：用 powerPreference: 'high-performance' 告知浏览器优先选择独显（dGPU）。
 *  - 该选项是 WebGPU 标准提示，浏览器据此在多适配器环境中挑选高性能设备；
 *  - 不保证一定切到独显（浏览器/驱动策略、是否插电等会影响），但能显著改善命中率；
 *  - 即便没切，也只会回退到原本的默认适配器，不会变差。
 *
 * 为提高在双显卡机器上选中独显的概率，采用"枚举 + 评分"策略：
 *  1. 若浏览器支持 adapter 信息（requestAdapterInfo / adapter.info），先尝试
 *     powerPreference: 'high-performance' 拿到一个候选；
 *  2. 再用 'low-power' 拿另一个候选（通常对应集显）；
 *  3. 对两者按厂商/类型评分（独显 NVIDIA/AMD/Apple dGPU 高分，Intel 集显低分），
 *     选分高者。若评分不可用（信息被屏蔽），回退 high-performance 候选。
 * 这样即使 high-performance 没能切到独显，只要能拿到两个不同适配器，也能纠偏。
 */
async function scoreAdapter(adapter: GPUAdapter | null): Promise<{ adapter: GPUAdapter | null; score: number; label: string }> {
  if (!adapter) return { adapter: null, score: -1, label: '无' };
  let vendor = '';
  let desc = '';
  const a = adapter as any;
  try {
    if (typeof a.requestAdapterInfo === 'function') {
      const info = a.requestAdapterInfo(true) ?? a.requestAdapterInfo();
      vendor = info?.vendor ?? '';
      desc = info?.description ?? '';
    } else if (a.info) {
      vendor = a.info.vendor ?? '';
      desc = a.info.description ?? '';
    }
  } catch { /* 忽略，按默认分 */ }

  const label = `${vendor || 'unknown'} ${desc || ''}`.trim();
  let score = 0; // 未知适配器基准分
  // 独显厂商/型号加分
  if (/NVIDIA|RTX|GTX|GeForce|Radeon|RX \d|Arc A[57]/i.test(label)) score += 10;
  if (/Apple.*M[0-9].*(Pro|Max|Ultra)/i.test(label)) score += 8;
  // 集显扣分
  if (/Intel.*Graphics|UHD|Iris|Apple.*M[0-9]( |$)/i.test(label) && !/Pro|Max|Ultra/i.test(label)) score -= 10;
  // 含"Integrated"/"集显"字样扣分
  if (/integrated|集显/i.test(label)) score -= 10;
  return { adapter, score, label };
}

async function requestBestAdapter(): Promise<GPUAdapter | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;

  // 候选 1：high-performance（主选，期望命中独显）
  let hpAdapter: GPUAdapter | null = null;
  try {
    hpAdapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch { hpAdapter = null; }

  // 候选 2：low-power（通常对应集显，用于与候选 1 对比纠偏）
  let lpAdapter: GPUAdapter | null = null;
  try {
    lpAdapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
  } catch { lpAdapter = null; }

  // 同一适配器（双取相同）或只有其一 —— 无需评分
  if (!lpAdapter) return hpAdapter;
  if (!hpAdapter) return lpAdapter;

  // 两者都有：用 adapter 信息评分择优
  const [hp, lp] = await Promise.all([scoreAdapter(hpAdapter), scoreAdapter(lpAdapter)]);
  console.log(`[GPU] 适配器候选: high-performance="${hp.label}"(分${hp.score}), low-power="${lp.label}"(分${lp.score})`);

  // 评分差异显著才切换；否则信任 high-performance（标准默认偏好）
  if (hp.score < lp.score - 0) {
    console.log('[GPU] 选用 low-power 候选（评分更高，可能为独显）');
    return lp.adapter;
  }
  console.log('[GPU] 选用 high-performance 候选');
  return hp.adapter;
}

export class LBMEngineGPU {
  private device: GPUDevice | null = null;
  private adapter: GPUAdapter | null = null;
  private adapterInfo: GPUDeviceInfo = { vendor: '', architecture: '', device: '', description: '' };
  private Nx = 0; private Ny = 0; private Nz = 0;
  private cellCount = 0;

  // Buffers — single f, single f_post, no swap
  private fBuf: GPUBuffer = null!;
  private fPostBuf: GPUBuffer = null!;
  private cellTypeBuf: GPUBuffer = null!;
  private ventVelBufs: [GPUBuffer, GPUBuffer, GPUBuffer] = [null!, null!, null!];
  private ventTempBuf: GPUBuffer = null!;
  private heatTempBuf: GPUBuffer = null!;
  private tBuf: GPUBuffer = null!;
  private tNewBuf: GPUBuffer = null!;  // T_new buffer to avoid data race
  private rhoBuf: GPUBuffer = null!;
  private uxBuf: GPUBuffer = null!;
  private uyBuf: GPUBuffer = null!;
  private uzBuf: GPUBuffer = null!;
  private uniformBuf: GPUBuffer = null!;

  // Pipelines & bind groups
  private initPipeline: GPUComputePipeline = null!;
  private collidePipeline: GPUComputePipeline = null!;
  private streamPipeline: GPUComputePipeline = null!;
  private tempPipeline: GPUComputePipeline = null!;
  private initBindGroup: GPUBindGroup = null!;
  private collideBindGroup: GPUBindGroup = null!;
  private streamBindGroup: GPUBindGroup = null!;
  private tempBindGroup: GPUBindGroup = null!;

  // 扫风：每步需重算速度方向的出风口集合；空数组=无扫风，零开销。
  private swingGroups: SwingGroup[] = [];
  private dt_phys = 0;   // 物理时间/步(秒)，setup 时从 lbmParams 取

  step = 0;

  static async isAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined') return false;
    if (!navigator.gpu) return false;
    try {
      const adapter = await requestBestAdapter();
      return adapter !== null;
    } catch { return false; }
  }

  async init(): Promise<boolean> {
    try {
      const adapter = await requestBestAdapter();
      if (!adapter) return false;
      this.adapter = adapter;

      // Try to get adapter info immediately (while adapter is alive)
      await this._fetchAdapterInfo();

      // 检查适配器支持的最大缓冲区大小
      const maxBufferSize = adapter.limits.maxStorageBufferBindingSize;
      console.log(`[GPU] 适配器支持最大存储缓冲区: ${(maxBufferSize / 1024 / 1024).toFixed(0)} MB`);

      // 请求设备时指定更高的限制（用于大网格）
      this.device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBuffersPerShaderStage: 16,
          maxStorageBufferBindingSize: Math.min(maxBufferSize, 2147483648), // 最多2GB
          maxBufferSize: Math.min(adapter.limits.maxBufferSize, 2147483648),
        }
      });

      console.log(`[GPU] 已请求存储缓冲区限制: ${(this.device.limits.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0)} MB`);
      return true;
    } catch { return false; }
  }

  async setup(config: RoomConfig, Nx: number, Ny: number, Nz: number): Promise<void> {
    if (!this.device) throw new Error('WebGPU not initialized');
    this.Nx = Nx; this.Ny = Ny; this.Nz = Nz;
    const C = Nx * Ny * Nz;
    this.cellCount = C;
    this.step = 0;
    this.swingGroups = [];   // 重置扫风组（每次 setup 重新栅格化）

    const device = this.device;
    const dx = config.length / Nx;
    this.dt_phys = config.lbmParams?.dt_phys ?? 0;

    // ---- Lattice parameter computation ----
    // If lbmParams is provided (from page.tsx dynamic computation), use it directly.
    // Otherwise, compute with corrected formula (NOT config.length — that's the physical bug!)
    let omega: number, alphaT: number, tau: number, u_char: number;

    if (config.lbmParams) {
      // Use pre-computed params from page.tsx (recommended path)
      omega = config.lbmParams.omega;
      alphaT = config.lbmParams.alphaT;
      tau = config.lbmParams.tau;
      u_char = config.lbmParams.u_char;
    } else {
      // Fallback: compute from grid resolution with CORRECTED formula
      // nu = u_char * Nx / Re_lattice  (uses Nx = lattice length, NOT config.length = physical meters!)
      u_char = 0.05;
      const Re_lattice = 200;
      const nu = u_char * Nx / Re_lattice;
      tau = Math.max(3 * nu + 0.5, 0.55); // Use 0.55 as minimum (Smagorinsky LES keeps it stable)
      omega = 1.0 / tau;
      alphaT = nu / 0.71; // Pr ≈ 0.71 for air
    }
    const roomTemp = config.initialTemp ?? 0.7; // 使用配置的初始温度，默认0.7
    // Boussinesq buoyancy (lattice gravity accel). From lbmParams if provided,
    // else a mild default so natural convection works even on the fallback path.
    const g_lat = config.lbmParams?.g_lat ?? 1.0e-5;
    const T_ref = config.lbmParams?.T_ref ?? roomTemp;

    console.log(`[GPU Engine] LBM参数: tau=${tau.toFixed(4)}, omega=${omega.toFixed(4)}, nu_lattice=${((tau-0.5)/3).toFixed(4)}, alphaT=${alphaT.toFixed(4)}, u_char=${u_char}, g_lat=${g_lat.toExponential(2)}`);
    console.log(`[GPU Engine] 来源: ${config.lbmParams ? 'page.tsx动态计算' : '引擎内fallback'}`);

    // Build cell type and BC arrays
    const cellType = new Uint32Array(C);
    const ventVelX = new Float32Array(C);
    const ventVelY = new Float32Array(C);
    const ventVelZ = new Float32Array(C);
    const ventTemp = new Float32Array(C).fill(TEMP_UNSET);
    const heatTemp = new Float32Array(C).fill(TEMP_UNSET);
    const T = new Float32Array(C).fill(roomTemp);
    const rho = new Float32Array(C).fill(1);
    const ux = new Float32Array(C);
    const uy = new Float32Array(C);
    const uz = new Float32Array(C);

    // Mark walls
    for (let z = 0; z < Nz; z++)
      for (let y = 0; y < Ny; y++)
        for (let x = 0; x < Nx; x++) {
          if (x === 0 || x === Nx - 1 || y === 0 || y === Ny - 1 || z === 0 || z === Nz - 1)
            cellType[x + y * Nx + z * Nx * Ny] = CELL_SOLID;
        }

    // Mark items
    let inletCount = 0;
    let heatCount = 0;
    for (const item of config.items) {
      if (item.type === 'prism') {
        // 三棱柱：直角三角形截面，挤出沿 z（高度）。中心 (x+L/2, y-W/2)。
        // rotZ 绕中心旋转（与渲染一致）。基座三角形顶点(房间) (x,y),(x+L,y),(x,y-W)。
        markRotatedExtruded(cellType, Nx, Ny, dx,
          item.x + item.L / 2, item.y - item.W / 2,
          item.z, item.z + item.H, item.L, item.W, item.rotZ ?? 0,
          true, Nx, Ny, Nz);
      } else if (item.type === 'prism_y') {
        // 立面楔形三棱柱：截面在 y-z 立面，挤出沿 x；中心为包围盒中心。
        markShape(cellType, Nx, Ny, dx,
          item.x, item.y, item.z, item.H, item.L, item.W, 'prism_y', item.rotZ ?? 0,
          CELL_SOLID, () => {}, Nx, Ny, Nz);
      } else if (item.type === 'cylinder_v') {
        // 圆柱(竖放)：轴沿 z，半径=min(L,W)/2，高度 H。
        markCylinderV(cellType, Nx, Ny, dx,
          item.x, item.y, item.z, item.z + item.H, item.L, item.W, item.rotZ ?? 0,
          Nx, Ny, Nz);
      } else if (item.type === 'cylinder_h') {
        // 圆柱(横放)：轴默认沿 x，长度 L，半径=min(W,H)/2，中心 (x+L/2,y+W/2,z+H/2)。
        markCylinderH(cellType, Nx, Ny, dx,
          item.x, item.y, item.z, item.z + item.H, item.L, item.W, item.H, item.rotZ ?? 0,
          Nx, Ny, Nz);
      } else if (item.type === 'door_hole') {
        // 门洞：从已标记为 SOLID 的墙体中挖出门洞区域
        const pb = item.parentBox!;
        const face = item.wallFace!;
        const offset = item.offsetFromLeft!;
        const dw = item.width!;
        const dh = item.height!;
        const sill = item.sillHeight!;

        // 门洞的 z 范围
        const iz0 = Math.max(Math.round((pb.z + sill) / dx), 0);
        const iz1 = Math.min(Math.max(Math.round((pb.z + sill + dh) / dx), iz0 + 1), Nz);

        if (face === 'north' || face === 'south') {
          // 墙体沿 X 方向延伸，门洞在北/南面
          const ix0 = Math.max(Math.round((pb.x + offset) / dx), 0);
          const ix1 = Math.min(Math.max(Math.round((pb.x + offset + dw) / dx), ix0 + 1), Nx);
          // Y 方向：贯穿墙体厚度
          const iy0 = Math.max(Math.round(pb.y / dx), 0);
          const iy1 = Math.min(Math.max(Math.round((pb.y + pb.W) / dx), iy0 + 1), Ny);

          for (let z = iz0; z < iz1; z++)
            for (let y = iy0; y < iy1; y++)
              for (let x = ix0; x < ix1; x++) {
                const idx = x + y * Nx + z * Nx * Ny;
                if (cellType[idx] === CELL_SOLID) cellType[idx] = 0; // 恢复为流体
              }
        } else {
          // 墙体沿 Y 方向延伸，门洞在东/西面
          const iy0 = Math.max(Math.round((pb.y + offset) / dx), 0);
          const iy1 = Math.min(Math.max(Math.round((pb.y + offset + dw) / dx), iy0 + 1), Ny);
          // X 方向：贯穿墙体厚度
          const ix0 = Math.max(Math.round(pb.x / dx), 0);
          const ix1 = Math.min(Math.max(Math.round((pb.x + pb.L) / dx), ix0 + 1), Nx);

          for (let z = iz0; z < iz1; z++)
            for (let y = iy0; y < iy1; y++)
              for (let x = ix0; x < ix1; x++) {
                const idx = x + y * Nx + z * Nx * Ny;
                if (cellType[idx] === CELL_SOLID) cellType[idx] = 0; // 恢复为流体
              }
        }
      } else if (item.type === 'box') {
        // 长方体：支持 rotZ 绕中心 (x+L/2, y+W/2) 旋转（与渲染一致）。
        markRotatedExtruded(cellType, Nx, Ny, dx,
          item.x + item.L / 2, item.y + item.W / 2,
          item.z, item.z + item.H, item.L, item.W, item.rotZ ?? 0,
          false, Nx, Ny, Nz);
      } else {
        // vent_inlet / vent_outlet / heat_source — 按形状(box/prism/cylinder_v/cylinder_h)
        // 标记体积，支持绕水平中心旋转 rotZ。速度向量(房间 x,y 分量)随 rotZ 旋转(CW)。
        const vRot = item.rotZ ?? 0;
        const vcos = Math.cos(vRot), vsin = Math.sin(vRot);
        const shape = item.shape ?? 'box';
        if (item.type === 'vent_inlet') {
          const vel = item.velocity ?? [0, 0, 0] as [number, number, number];
          const vx = vel[0] * vcos + vel[1] * vsin;
          const vy = -vel[0] * vsin + vel[1] * vcos;
          // 扫风：若该出风口启用 swing，记录其格子集合与基础速度向量，供每步重算。
          const sw = item.swing;
          const swingCells = (sw && sw.enabled) ? [] as number[] : null;
          const mark = item.outflowFace
            ? (val: number, s: (idx: number) => void) => markFace(cellType, Nx, Ny, dx, item.x, item.y, item.z, item.H, item.L, item.W, vRot, item.outflowFace!, val, s, Nx, Ny, Nz)
            : (val: number, s: (idx: number) => void) => markShape(cellType, Nx, Ny, dx, item.x, item.y, item.z, item.H, item.L, item.W, shape, vRot, val, s, Nx, Ny, Nz);
          mark(CELL_INLET,
            (idx) => {
              ventVelX[idx] = vx; ventVelY[idx] = vy; ventVelZ[idx] = vel[2];
              if (item.temperature !== undefined) ventTemp[idx] = item.temperature;
              if (swingCells) swingCells.push(idx);
            });
          if (swingCells && swingCells.length > 0) {
            this.swingGroups.push({
              runs: compressRuns(swingCells), baseVx: vx, baseVy: vy, baseVz: vel[2],
              mode: sw!.mode, amplitude: sw!.amplitude, period: sw!.period, phase: sw!.phase ?? 0,
            });
          }
          inletCount++;
        } else if (item.type === 'vent_outlet') {
          if (item.outflowFace) {
            markFace(cellType, Nx, Ny, dx,
              item.x, item.y, item.z, item.H, item.L, item.W, vRot, item.outflowFace,
              CELL_OUTLET,
              (idx) => { if (item.temperature !== undefined) ventTemp[idx] = item.temperature; },
              Nx, Ny, Nz);
          } else {
            markShape(cellType, Nx, Ny, dx,
              item.x, item.y, item.z, item.H, item.L, item.W, shape, vRot,
              CELL_OUTLET,
              (idx) => { if (item.temperature !== undefined) ventTemp[idx] = item.temperature; },
              Nx, Ny, Nz);
          }
        } else if (item.type === 'heat_source') {
          markShape(cellType, Nx, Ny, dx,
            item.x, item.y, item.z, item.H, item.L, item.W, shape, vRot,
            CELL_HEAT,
            (idx) => { if (item.temperature !== undefined) heatTemp[idx] = item.temperature; heatCount++; },
            Nx, Ny, Nz);
        }
      }
    }

    console.log(`[GPU Engine] 网格: ${Nx}×${Ny}×${Nz}, dx=${dx.toFixed(4)}m, 入口节点数: ${inletCount}, 热源节点数: ${heatCount}`);

    // 调试：检查入口速度是否正确设置
    let nonZeroVelCount = 0;
    for (let i = 0; i < C; i++) {
      if (Math.abs(ventVelX[i]) > 1e-6 || Math.abs(ventVelY[i]) > 1e-6 || Math.abs(ventVelZ[i]) > 1e-6) {
        nonZeroVelCount++;
        if (nonZeroVelCount <= 3) {
          console.log(`  入口节点 ${i}: cellType=${cellType[i]}, vel=(${ventVelX[i].toFixed(4)}, ${ventVelY[i].toFixed(4)}, ${ventVelZ[i].toFixed(4)})`);
        }
      }
    }
    console.log(`  非零速度节点总数: ${nonZeroVelCount}`);

    // ===== Create GPU buffers =====
    const STOR = GPUBufferUsage.STORAGE;
    const CSRC = GPUBufferUsage.COPY_SRC;
    const CDST = GPUBufferUsage.COPY_DST;

    const createBuf = (data: Uint32Array | Float32Array, label: string, usage: GPUBufferUsageFlags): GPUBuffer => {
      const buf = device.createBuffer({ label, size: data.byteLength, usage: usage | CDST, mappedAtCreation: true });
      if (data instanceof Uint32Array) new Uint32Array(buf.getMappedRange()).set(data);
      else new Float32Array(buf.getMappedRange()).set(data);
      buf.unmap();
      return buf;
    };

    const fSize = 4 * 19 * C;
    // Single f buffer + f_post intermediate (NO double-buffering!)
    this.fBuf = device.createBuffer({ label: 'f', size: fSize, usage: STOR | CDST });
    this.fPostBuf = device.createBuffer({ label: 'f_post', size: fSize, usage: STOR | CDST });

    this.cellTypeBuf = createBuf(cellType, 'cellType', STOR);
    this.ventVelBufs = [createBuf(ventVelX, 'ventVelX', STOR), createBuf(ventVelY, 'ventVelY', STOR), createBuf(ventVelZ, 'ventVelZ', STOR)];
    this.ventTempBuf = createBuf(ventTemp, 'ventTemp', STOR);
    this.heatTempBuf = createBuf(heatTemp, 'heatTemp', STOR);

    // Output buffers (need COPY_SRC for readback!)
    this.tBuf = createBuf(T, 'T', STOR | CSRC);
    this.tNewBuf = device.createBuffer({ label: 'T_new', size: C * 4, usage: STOR | CDST | CSRC });  // needs COPY_SRC for copyBufferToBuffer!
    this.rhoBuf = createBuf(rho, 'rho', STOR | CSRC);
    this.uxBuf = createBuf(ux, 'ux', STOR | CSRC);
    this.uyBuf = createBuf(uy, 'uy', STOR | CSRC);
    this.uzBuf = createBuf(uz, 'uz', STOR | CSRC);

    // Uniform buffer (SAME struct for ALL shaders)
    // Layout: Nx(u32), Ny(u32), Nz(u32), C(u32), omega(f32), alphaT(f32), roomTemp(f32), Cs(f32), g_lat(f32), T_ref(f32)
    this.uniformBuf = device.createBuffer({ label: 'uniform', size: UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | CDST });
    const ab = new ArrayBuffer(UNIFORM_SIZE);
    const dv = new DataView(ab);
    dv.setUint32(0, Nx, true); dv.setUint32(4, Ny, true); dv.setUint32(8, Nz, true); dv.setUint32(12, C, true);
    dv.setFloat32(16, omega, true); dv.setFloat32(20, alphaT, true); dv.setFloat32(24, roomTemp, true);
    dv.setFloat32(28, 0.12, true);  // Cs: Smagorinsky constant (matches Python)
    dv.setFloat32(32, g_lat, true);  // Boussinesq lattice gravity (0 = disabled)
    dv.setFloat32(36, T_ref, true);  // Reference temperature for buoyancy
    device.queue.writeBuffer(this.uniformBuf, 0, ab);

    // ===== Create shader modules =====
    const initMod = device.createShaderModule({ label: 'init', code: INIT_SHADER });
    const collideMod = device.createShaderModule({ label: 'collide', code: COLLIDE_SHADER });
    const streamMod = device.createShaderModule({ label: 'stream', code: STREAM_SHADER });
    const tempMod = device.createShaderModule({ label: 'temp', code: TEMPERATURE_SHADER });

    // ===== Create pipelines (layout: "auto" like WebLBM) =====
    this.initPipeline = device.createComputePipeline({ label: 'init', layout: 'auto', compute: { module: initMod, entryPoint: 'main' } });
    this.collidePipeline = device.createComputePipeline({ label: 'collide', layout: 'auto', compute: { module: collideMod, entryPoint: 'main' } });
    this.streamPipeline = device.createComputePipeline({ label: 'stream', layout: 'auto', compute: { module: streamMod, entryPoint: 'main' } });
    this.tempPipeline = device.createComputePipeline({ label: 'temp', layout: 'auto', compute: { module: tempMod, entryPoint: 'main' } });

    // ===== Create bind groups — MUST match WGSL @binding exactly! =====

    // Init: bindings 0..12 (13 total)
    this.initBindGroup = device.createBindGroup({
      layout: this.initPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.fBuf } },         // f (rw)
        { binding: 1, resource: { buffer: this.cellTypeBuf } },   // cellType
        { binding: 2, resource: { buffer: this.ventVelBufs[0] } },// ventVelX
        { binding: 3, resource: { buffer: this.ventVelBufs[1] } },// ventVelY
        { binding: 4, resource: { buffer: this.ventVelBufs[2] } },// ventVelZ
        { binding: 5, resource: { buffer: this.ventTempBuf } },   // ventTemp
        { binding: 6, resource: { buffer: this.heatTempBuf } },   // heatTemp
        { binding: 7, resource: { buffer: this.tBuf } },          // T (rw)
        { binding: 8, resource: { buffer: this.rhoBuf } },        // rho_out (rw)
        { binding: 9, resource: { buffer: this.uxBuf } },         // ux_out (rw)
        { binding: 10, resource: { buffer: this.uyBuf } },        // uy_out (rw)
        { binding: 11, resource: { buffer: this.uzBuf } },        // uz_out (rw)
        { binding: 12, resource: { buffer: this.uniformBuf } },   // Params (uniform)
      ],
    });

    // Collide: bindings 0..11 (12 total) — T (read) at 10, uniform at 11
    this.collideBindGroup = device.createBindGroup({
      layout: this.collidePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.fBuf } },         // f (read)
        { binding: 1, resource: { buffer: this.fPostBuf } },      // f_post (rw)
        { binding: 2, resource: { buffer: this.cellTypeBuf } },   // cellType
        { binding: 3, resource: { buffer: this.ventVelBufs[0] } },// ventVelX
        { binding: 4, resource: { buffer: this.ventVelBufs[1] } },// ventVelY
        { binding: 5, resource: { buffer: this.ventVelBufs[2] } },// ventVelZ
        { binding: 6, resource: { buffer: this.rhoBuf } },        // rho_out (rw)
        { binding: 7, resource: { buffer: this.uxBuf } },         // ux_out (rw)
        { binding: 8, resource: { buffer: this.uyBuf } },         // uy_out (rw)
        { binding: 9, resource: { buffer: this.uzBuf } },         // uz_out (rw)
        { binding: 10, resource: { buffer: this.tBuf } },         // T (read) — for buoyancy
        { binding: 11, resource: { buffer: this.uniformBuf } },   // Params (uniform)
      ],
    });

    // Stream: bindings 0..9 (10 total) — NOTE: only 10 bindings, NOT 14!
    this.streamBindGroup = device.createBindGroup({
      layout: this.streamPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.fPostBuf } },      // f_post (read)
        { binding: 1, resource: { buffer: this.fBuf } },          // f (rw)
        { binding: 2, resource: { buffer: this.cellTypeBuf } },   // cellType
        { binding: 3, resource: { buffer: this.ventVelBufs[0] } },// ventVelX
        { binding: 4, resource: { buffer: this.ventVelBufs[1] } },// ventVelY
        { binding: 5, resource: { buffer: this.ventVelBufs[2] } },// ventVelZ
        { binding: 6, resource: { buffer: this.ventTempBuf } },   // ventTemp
        { binding: 7, resource: { buffer: this.heatTempBuf } },   // heatTemp
        { binding: 8, resource: { buffer: this.tBuf } },          // T (rw)
        { binding: 9, resource: { buffer: this.uniformBuf } },    // Params (uniform) ← WAS WRONG: was rhoBuf!
      ],
    });

    // Temp: bindings 0..6 (7 total) — T(read) + T_new(write) to avoid data race
    this.tempBindGroup = device.createBindGroup({
      layout: this.tempPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.tBuf } },          // T (read only — old values)
        { binding: 1, resource: { buffer: this.tNewBuf } },       // T_new (write — new values)
        { binding: 2, resource: { buffer: this.cellTypeBuf } },   // cellType
        { binding: 3, resource: { buffer: this.uxBuf } },         // ux_in
        { binding: 4, resource: { buffer: this.uyBuf } },         // uy_in
        { binding: 5, resource: { buffer: this.uzBuf } },         // uz_in
        { binding: 6, resource: { buffer: this.uniformBuf } },    // Params (uniform)
      ],
    });

    // ===== Run init shader =====
    // 使用2D dispatch避免超过maxComputeWorkgroupsPerDimension限制(65535)
    const workgroupSize = 64;
    const totalWorkgroups = Math.ceil(C / workgroupSize);
    let dispatchX = totalWorkgroups;
    let dispatchY = 1;

    // 如果超过65535，拆分到Y维度
    if (dispatchX > 65535) {
      dispatchX = 65535;
      dispatchY = Math.ceil(totalWorkgroups / 65535);
    }

    const initEnc = device.createCommandEncoder();
    const initPass = initEnc.beginComputePass();
    initPass.setPipeline(this.initPipeline);
    initPass.setBindGroup(0, this.initBindGroup);
    initPass.dispatchWorkgroups(dispatchX, dispatchY);
    initPass.end();
    device.queue.submit([initEnc.finish()]);
    await device.queue.onSubmittedWorkDone(); // 确保初始化完成
  }

  /** 是否存在启用了扫风的出风口（用于步循环零开销判断）。 */
  hasSwing(): boolean { return this.swingGroups.length > 0; }

  /**
   * 扫风：根据当前已完成的步数 `step`，重算每个扫风出风口的速度向量并写回 GPU 缓冲区。
   * 必须在该步的 collide/stream 之前调用，本步才使用新方向。
   * 角度 angle = amplitude·sin(2π·t/period + phase)，t = step·dt_phys。
   * horizontal: 基础 (vx,vy) 绕 z 旋转 angle，vz 不变。
   * vertical:   (水平幅值, vz) 在铅垂面内旋转 angle，水平方向不变。
   */
  updateSwing(step: number): void {
    if (this.swingGroups.length === 0 || this.dt_phys <= 0) return;
    // 关键性能点：不整体上传 ventVel(数百 KB~MB)，只按"连续段"写回出风口覆盖的格子。
    // 同一出风口所有格子本步速度相同，故每段构造一个 length=runLen 的同值数组，
    // 用一次 writeBuffer 写一小段。每段 3 次(分量)队列写，总段数远小于网格规模。
    for (const g of this.swingGroups) {
      const t = step * this.dt_phys;
      const ang = g.amplitude * Math.sin(2 * Math.PI * t / g.period + g.phase);
      const [vx, vy, vz] = applySwing(g.baseVx, g.baseVy, g.baseVz, g.mode, ang);
      for (const [start, len] of g.runs) {
        const vxArr = new Float32Array(len).fill(vx);
        const vyArr = new Float32Array(len).fill(vy);
        const vzArr = new Float32Array(len).fill(vz);
        this.device.queue.writeBuffer(this.ventVelBufs[0], start * 4, vxArr as Float32Array<ArrayBuffer>);
        this.device.queue.writeBuffer(this.ventVelBufs[1], start * 4, vyArr as Float32Array<ArrayBuffer>);
        this.device.queue.writeBuffer(this.ventVelBufs[2], start * 4, vzArr as Float32Array<ArrayBuffer>);
      }
    }
  }

  step_n(n: number): void {
    if (!this.device) throw new Error('Not initialized');

    // 使用2D dispatch避免超过maxComputeWorkgroupsPerDimension限制
    const workgroupSize = 64;
    const totalWorkgroups = Math.ceil(this.cellCount / workgroupSize);
    let dispatchX = totalWorkgroups;
    let dispatchY = 1;
    if (dispatchX > 65535) {
      dispatchX = 65535;
      dispatchY = Math.ceil(totalWorkgroups / 65535);
    }

    for (let s = 0; s < n; s++) {
      // 扫风：本步使用新方向前，先更新 ventVel 缓冲区（绝对步数 = 当前 step + 本批内偏移 s）。
      if (this.swingGroups.length > 0) this.updateSwing(this.step + s);

      const enc = this.device.createCommandEncoder();

      // Pass 1: Collide — f → f_post
      const collidePass = enc.beginComputePass();
      collidePass.setPipeline(this.collidePipeline);
      collidePass.setBindGroup(0, this.collideBindGroup);
      collidePass.dispatchWorkgroups(dispatchX, dispatchY);
      collidePass.end();

      // Pass 2: Stream+BB — f_post → f
      const streamPass = enc.beginComputePass();
      streamPass.setPipeline(this.streamPipeline);
      streamPass.setBindGroup(0, this.streamBindGroup);
      streamPass.dispatchWorkgroups(dispatchX, dispatchY);
      streamPass.end();

      // Pass 3: Temperature update — T → T_new (no data race!)
      const tempPass = enc.beginComputePass();
      tempPass.setPipeline(this.tempPipeline);
      tempPass.setBindGroup(0, this.tempBindGroup);
      tempPass.dispatchWorkgroups(dispatchX, dispatchY);
      tempPass.end();

      // Copy T_new → T (so next step reads updated temperature)
      enc.copyBufferToBuffer(this.tNewBuf, 0, this.tBuf, 0, this.tBuf.size);

      this.device.queue.submit([enc.finish()]);
    }
    this.step += n;
  }

  /**
   * Chunked variant of step_n: runs `n` steps but yields to the event loop
   * (and drains the GPU queue) every `chunkSize` steps, invoking `onProgress`
   * with (stepsCompleted, totalSteps). This keeps the main thread responsive
   * during long runs so the UI can show progress and the user can interact.
   *
   * GPU note: between chunks we `await onSubmittedWorkDone()` so the command
   * queue is actually flushed to the GPU and doesn't grow unbounded, and so
   * `this.step` reflects truly-completed work.
   */
  async step_n_chunked(n: number, chunkSize: number, onProgress?: (done: number, total: number) => void): Promise<void> {
    if (!this.device) throw new Error('Not initialized');
    const chunk = Math.max(1, Math.floor(chunkSize));
    const workgroupSize = 64;
    const totalWorkgroups = Math.ceil(this.cellCount / workgroupSize);
    let dispatchX = totalWorkgroups;
    let dispatchY = 1;
    if (dispatchX > 65535) {
      dispatchX = 65535;
      dispatchY = Math.ceil(totalWorkgroups / 65535);
    }

    let done = 0;
    while (done < n) {
      const batch = Math.min(chunk, n - done);
      for (let s = 0; s < batch; s++) {
        // 扫风：先更新 ventVel，本步 collide 起即用新方向。
        if (this.swingGroups.length > 0) this.updateSwing(this.step + s);

        const enc = this.device.createCommandEncoder();

        const collidePass = enc.beginComputePass();
        collidePass.setPipeline(this.collidePipeline);
        collidePass.setBindGroup(0, this.collideBindGroup);
        collidePass.dispatchWorkgroups(dispatchX, dispatchY);
        collidePass.end();

        const streamPass = enc.beginComputePass();
        streamPass.setPipeline(this.streamPipeline);
        streamPass.setBindGroup(0, this.streamBindGroup);
        streamPass.dispatchWorkgroups(dispatchX, dispatchY);
        streamPass.end();

        const tempPass = enc.beginComputePass();
        tempPass.setPipeline(this.tempPipeline);
        tempPass.setBindGroup(0, this.tempBindGroup);
        tempPass.dispatchWorkgroups(dispatchX, dispatchY);
        tempPass.end();

        enc.copyBufferToBuffer(this.tNewBuf, 0, this.tBuf, 0, this.tBuf.size);

        this.device.queue.submit([enc.finish()]);
      }
      // Flush this chunk to the GPU before reporting progress / yielding.
      await this.device.queue.onSubmittedWorkDone();
      done += batch;
      this.step += batch;
      if (onProgress) onProgress(done, n);
      // Yield to the event loop so React can paint and the user can interact.
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  async getResults(): Promise<SimResults> {
    if (!this.device) throw new Error('Not initialized');
    await this.device.queue.onSubmittedWorkDone();

    const readBuf = async (buf: GPUBuffer): Promise<Float32Array> => {
      const staging = this.device!.createBuffer({ size: buf.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = this.device!.createCommandEncoder();
      enc.copyBufferToBuffer(buf, 0, staging, 0, buf.size);
      this.device!.queue.submit([enc.finish()]);
      await this.device!.queue.onSubmittedWorkDone();
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap(); staging.destroy();
      return data;
    };

    const [rho, ux, uy, uz, T] = await Promise.all([
      readBuf(this.rhoBuf), readBuf(this.uxBuf), readBuf(this.uyBuf),
      readBuf(this.uzBuf), readBuf(this.tBuf),
    ]);

    return { rho, ux, uy, uz, T, step: this.step };
  }

  /** Called during init() to fetch adapter info via all available methods */
  private async _fetchAdapterInfo(): Promise<void> {
    if (!this.adapter) return;

    const a = this.adapter as any;
    let info: any = null;

    // Method 1: requestAdapterInfo(true) — sync, unmasked, Chrome 121+
    if (typeof a.requestAdapterInfo === 'function') {
      try {
        info = a.requestAdapterInfo(true);
        console.log('[GPU] requestAdapterInfo(true):', JSON.stringify(info));
      } catch (e) {
        console.warn('[GPU] requestAdapterInfo(true) failed:', e);
      }

      // Fallback: try without unmask
      if (!info || (!info.device && !info.description)) {
        try {
          info = a.requestAdapterInfo();
          console.log('[GPU] requestAdapterInfo():', JSON.stringify(info));
        } catch (e) {
          console.warn('[GPU] requestAdapterInfo() failed:', e);
        }
      }
    }

    // Method 2: Deprecated adapter.info property (Chrome < 121)
    if ((!info || (!info.device && !info.description)) && a.info) {
      info = a.info;
      console.log('[GPU] adapter.info (deprecated):', JSON.stringify(info));
    }

    // Method 3: Fallback — create a temporary WebGL2 context to get GPU renderer string
    // This is universally supported and doesn't require any permissions
    if (!info || (!info.device && !info.description)) {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
          const renderer = debugExt ? gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          const vendorStr = debugExt ? gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
          // Clean up long ANGLE strings: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)"
          // → "NVIDIA GeForce RTX 4060 Ti"
          const cleanRenderer = cleanGPUName(renderer);
          const cleanVendor = vendorStr.split(',')[0].trim();
          console.log(`[GPU] WebGL renderer: "${renderer}" → cleaned: "${cleanRenderer}"`);
          info = { vendor: cleanVendor, architecture: '', device: '', description: cleanRenderer };
          // Clean up — lose context to free GPU resources
          const loseCtx = gl.getExtension('WEBGL_lose_context');
          if (loseCtx) loseCtx.loseContext();
          canvas.remove();
        }
      } catch (e) {
        console.warn('[GPU] WebGL fallback failed:', e);
      }
    }

    // Build result
    if (info) {
      const vendor = info.vendor ?? '';
      const arch = info.architecture ?? '';
      const device = info.device ?? '';
      const desc = info.description ?? '';

      this.adapterInfo = {
        vendor,
        architecture: arch,
        device,
        // If description is empty but device has value, compose one
        description: desc || (device ? `${vendor} ${device}`.trim() : vendor),
      };
    }

    console.log(`[GPU] Adapter info resolved: device="${this.adapterInfo.device}", vendor="${this.adapterInfo.vendor}", desc="${this.adapterInfo.description}"`);
  }

  /** Get cached adapter info (available after init()) */
  getAdapterInfo(): GPUDeviceInfo {
    return this.adapterInfo;
  }

  destroy(): void {
    this.fBuf?.destroy(); this.fPostBuf?.destroy();
    this.cellTypeBuf?.destroy(); this.ventVelBufs.forEach(b => b?.destroy());
    this.ventTempBuf?.destroy(); this.heatTempBuf?.destroy();
    this.tBuf?.destroy(); this.tNewBuf?.destroy();
    this.rhoBuf?.destroy();
    this.uxBuf?.destroy(); this.uyBuf?.destroy(); this.uzBuf?.destroy();
    this.uniformBuf?.destroy();
    this.device?.destroy(); this.device = null;
  }
}

// =====================================================================
// CPU Fallback Engine (with Smagorinsky LES + fixed temperature BCs)
// =====================================================================
const EX = [0, 1,-1, 0, 0, 0, 0, 1,-1, 1,-1, 1,-1, 1,-1, 0, 0, 0, 0];
const EY = [0, 0, 0, 1,-1, 0, 0, 1,-1,-1, 1, 0, 0, 0, 0, 1,-1, 1,-1];
const EZ = [0, 0, 0, 0, 0, 1,-1, 0, 0, 0, 0, 1,-1,-1, 1, 1,-1,-1, 1];
const WT = [1/3, 1/18,1/18,1/18,1/18,1/18,1/18, 1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36];
// OPP[i] = index j such that e_j = -e_i (must match EX/EY/EZ above).
const OPP = [0, 2,1, 4,3, 6,5, 8,7,10,9, 12,11,14,13, 16,15,18,17];
const CS2 = 1/3;
// Pre-computed for Smagorinsky strain rate
const EX2 = [0,1,1,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0];
const EY2 = [0,0,0,1,1,0,0,1,1,1,1,0,0,0,0,1,1,1,1];
const EZ2 = [0,0,0,0,0,1,1,0,0,0,0,1,1,1,1,1,1,1,1];
const EXY = [0,0,0,0,0,0,0,1,1,-1,-1,0,0,0,0,0,0,0,0];
const EXZ = [0,0,0,0,0,0,0,0,0,0,0,1,1,-1,-1,0,0,0,0];
const EYZ = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,-1,-1];

// Search the 6 face-neighbors for the first FLUID cell. Returns -1 if none.
// Lets outlet / heat-source zero-gradient BCs work for vents on ANY wall.
function findFluidNeighborCPU(x: number, y: number, z: number,
    Nx: number, Ny: number, Nz: number, cellType: Uint8Array): number {
  const at = (xx: number, yy: number, zz: number) => xx + yy * Nx + zz * Nx * Ny;
  if (x > 0       && cellType[at(x-1, y,   z  )] === CELL_FLUID) return at(x-1, y,   z  );
  if (x < Nx - 1  && cellType[at(x+1, y,   z  )] === CELL_FLUID) return at(x+1, y,   z  );
  if (y > 0       && cellType[at(x,   y-1, z  )] === CELL_FLUID) return at(x,   y-1, z  );
  if (y < Ny - 1  && cellType[at(x,   y+1, z  )] === CELL_FLUID) return at(x,   y+1, z  );
  if (z > 0       && cellType[at(x,   y,   z-1)] === CELL_FLUID) return at(x,   y,   z-1);
  if (z < Nz - 1  && cellType[at(x,   y,   z+1)] === CELL_FLUID) return at(x,   y,   z+1);
  return -1;
}

export class LBMEngineCPU {
  private Nx = 0; private Ny = 0; private Nz = 0;
  private cellType!: Uint8Array;
  private ventVelX!: Float32Array; private ventVelY!: Float32Array; private ventVelZ!: Float32Array;
  private ventTemp!: Float32Array; private heatTemp!: Float32Array;
  private rho!: Float32Array;
  private ux!: Float32Array; private uy!: Float32Array; private uz!: Float32Array;
  private T!: Float32Array;
  private f!: Float32Array;
  private tau = 0.8;
  private alphaT = 0.01;
  private roomTemp = 0.7;
  private Cs = 0.12; // Smagorinsky constant
  private g_lat = 0;    // Boussinesq lattice gravity (0 = disabled)
  private T_ref = 0.7;  // Reference temperature for buoyancy
  private swingGroups: SwingGroup[] = [];
  private dt_phys = 0;
  step = 0;

  async init(): Promise<boolean> { return true; }

  setup(config: RoomConfig, Nx: number, Ny: number, Nz: number): void {
    this.Nx = Nx; this.Ny = Ny; this.Nz = Nz;
    const total = Nx * Ny * Nz;
    const dx = config.length / Nx;

    // ---- Lattice parameter computation (same logic as GPU engine) ----
    let omega: number, alphaT: number, u_char: number;

    if (config.lbmParams) {
      this.tau = config.lbmParams.tau;
      alphaT = config.lbmParams.alphaT;
      u_char = config.lbmParams.u_char;
      omega = config.lbmParams.omega;
    } else {
      // Fallback: compute from grid resolution with CORRECTED formula
      u_char = 0.05;
      const Re_lattice = 200;
      const nu = u_char * Nx / Re_lattice;
      this.tau = Math.max(3 * nu + 0.5, 0.55); // Use 0.55 as minimum (Smagorinsky LES keeps it stable)
      alphaT = nu / 0.71;
      omega = 1.0 / this.tau;
    }
    this.alphaT = alphaT;
    this.roomTemp = config.initialTemp ?? 0.7; // 使用配置的初始温度，默认0.7
    this.g_lat = config.lbmParams?.g_lat ?? 1.0e-5;
    this.T_ref = config.lbmParams?.T_ref ?? this.roomTemp;
    this.dt_phys = config.lbmParams?.dt_phys ?? 0;
    this.step = 0;
    this.swingGroups = [];

    this.cellType = new Uint8Array(total);
    this.ventVelX = new Float32Array(total);
    this.ventVelY = new Float32Array(total);
    this.ventVelZ = new Float32Array(total);
    this.ventTemp = new Float32Array(total).fill(TEMP_UNSET);
    this.heatTemp = new Float32Array(total).fill(TEMP_UNSET);
    this.T = new Float32Array(total).fill(this.roomTemp);
    this.rho = new Float32Array(total).fill(1);
    this.ux = new Float32Array(total);
    this.uy = new Float32Array(total);
    this.uz = new Float32Array(total);
    this.f = new Float32Array(19 * total);

    for (let z = 0; z < Nz; z++)
      for (let y = 0; y < Ny; y++)
        for (let x = 0; x < Nx; x++) {
          if (x === 0 || x === Nx - 1 || y === 0 || y === Ny - 1 || z === 0 || z === Nz - 1)
            this.cellType[x + y * Nx + z * Nx * Ny] = CELL_SOLID;
        }

    for (const item of config.items) {
      if (item.type === 'prism') {
        // 与渲染端一致：中心 (x+L/2, y-W/2)，支持 rotZ 旋转。
        markRotatedExtruded(this.cellType, Nx, Ny, dx,
          item.x + item.L / 2, item.y - item.W / 2,
          item.z, item.z + item.H, item.L, item.W, item.rotZ ?? 0,
          true, Nx, Ny, Nz);
      } else if (item.type === 'prism_y') {
        markShape(this.cellType, Nx, Ny, dx,
          item.x, item.y, item.z, item.H, item.L, item.W, 'prism_y', item.rotZ ?? 0,
          CELL_SOLID, () => {}, Nx, Ny, Nz);
      } else if (item.type === 'cylinder_v') {
        markCylinderV(this.cellType, Nx, Ny, dx,
          item.x, item.y, item.z, item.z + item.H, item.L, item.W, item.rotZ ?? 0,
          Nx, Ny, Nz);
      } else if (item.type === 'cylinder_h') {
        markCylinderH(this.cellType, Nx, Ny, dx,
          item.x, item.y, item.z, item.z + item.H, item.L, item.W, item.H, item.rotZ ?? 0,
          Nx, Ny, Nz);
      } else if (item.type === 'door_hole') {
        const pb = item.parentBox!;
        const face = item.wallFace!;
        const offset = item.offsetFromLeft!;
        const dw = item.width!;
        const dh = item.height!;
        const sill = item.sillHeight!;

        const iz0 = Math.max(Math.round((pb.z + sill) / dx), 0);
        const iz1 = Math.min(Math.max(Math.round((pb.z + sill + dh) / dx), iz0 + 1), Nz);

        if (face === 'north' || face === 'south') {
          const ix0 = Math.max(Math.round((pb.x + offset) / dx), 0);
          const ix1 = Math.min(Math.max(Math.round((pb.x + offset + dw) / dx), ix0 + 1), Nx);
          const iy0 = Math.max(Math.round(pb.y / dx), 0);
          const iy1 = Math.min(Math.max(Math.round((pb.y + pb.W) / dx), iy0 + 1), Ny);

          for (let z = iz0; z < iz1; z++)
            for (let y = iy0; y < iy1; y++)
              for (let x = ix0; x < ix1; x++) {
                const idx = x + y * Nx + z * Nx * Ny;
                if (this.cellType[idx] === CELL_SOLID) this.cellType[idx] = 0;
              }
        } else {
          const iy0 = Math.max(Math.round((pb.y + offset) / dx), 0);
          const iy1 = Math.min(Math.max(Math.round((pb.y + offset + dw) / dx), iy0 + 1), Ny);
          const ix0 = Math.max(Math.round(pb.x / dx), 0);
          const ix1 = Math.min(Math.max(Math.round((pb.x + pb.L) / dx), ix0 + 1), Nx);

          for (let z = iz0; z < iz1; z++)
            for (let y = iy0; y < iy1; y++)
              for (let x = ix0; x < ix1; x++) {
                const idx = x + y * Nx + z * Nx * Ny;
                if (this.cellType[idx] === CELL_SOLID) this.cellType[idx] = 0;
              }
        }
      } else if (item.type === 'box') {
        // 长方体：支持 rotZ 绕中心 (x+L/2, y+W/2) 旋转。
        markRotatedExtruded(this.cellType, Nx, Ny, dx,
          item.x + item.L / 2, item.y + item.W / 2,
          item.z, item.z + item.H, item.L, item.W, item.rotZ ?? 0,
          false, Nx, Ny, Nz);
      } else {
        // vent_inlet / vent_outlet / heat_source — 按形状标记体积，支持旋转 rotZ。
        const vRot = item.rotZ ?? 0;
        const vcos = Math.cos(vRot), vsin = Math.sin(vRot);
        const shape = item.shape ?? 'box';
        if (item.type === 'vent_inlet') {
          const vel = item.velocity ?? [0, 0, 0] as [number, number, number];
          const vx = vel[0] * vcos + vel[1] * vsin;
          const vy = -vel[0] * vsin + vel[1] * vcos;
          const sw = item.swing;
          const swingCells = (sw && sw.enabled) ? [] as number[] : null;
          const mark = item.outflowFace
            ? (val: number, s: (idx: number) => void) => markFace(this.cellType, Nx, Ny, dx, item.x, item.y, item.z, item.H, item.L, item.W, vRot, item.outflowFace!, val, s, Nx, Ny, Nz)
            : (val: number, s: (idx: number) => void) => markShape(this.cellType, Nx, Ny, dx, item.x, item.y, item.z, item.H, item.L, item.W, shape, vRot, val, s, Nx, Ny, Nz);
          mark(CELL_INLET,
            (idx) => {
              this.ventVelX[idx] = vx; this.ventVelY[idx] = vy; this.ventVelZ[idx] = vel[2];
              if (item.temperature !== undefined) this.ventTemp[idx] = item.temperature;
              if (swingCells) swingCells.push(idx);
            });
          if (swingCells && swingCells.length > 0) {
            this.swingGroups.push({
              runs: compressRuns(swingCells), baseVx: vx, baseVy: vy, baseVz: vel[2],
              mode: sw!.mode, amplitude: sw!.amplitude, period: sw!.period, phase: sw!.phase ?? 0,
            });
          }
        } else if (item.type === 'vent_outlet') {
          if (item.outflowFace) {
            markFace(this.cellType, Nx, Ny, dx,
              item.x, item.y, item.z, item.H, item.L, item.W, vRot, item.outflowFace,
              CELL_OUTLET,
              (idx) => { if (item.temperature !== undefined) this.ventTemp[idx] = item.temperature; },
              Nx, Ny, Nz);
          } else {
            markShape(this.cellType, Nx, Ny, dx,
              item.x, item.y, item.z, item.H, item.L, item.W, shape, vRot,
              CELL_OUTLET,
              (idx) => { if (item.temperature !== undefined) this.ventTemp[idx] = item.temperature; },
              Nx, Ny, Nz);
          }
        } else if (item.type === 'heat_source') {
          markShape(this.cellType, Nx, Ny, dx,
            item.x, item.y, item.z, item.H, item.L, item.W, shape, vRot,
            CELL_HEAT,
            (idx) => { if (item.temperature !== undefined) this.heatTemp[idx] = item.temperature; },
            Nx, Ny, Nz);
        }
      }
    }

    for (let idx = 0; idx < total; idx++) {
      if (this.cellType[idx] === CELL_SOLID) continue;
      let vx = 0, vy = 0, vz = 0;
      if (this.cellType[idx] === CELL_INLET) { vx = this.ventVelX[idx]; vy = this.ventVelY[idx]; vz = this.ventVelZ[idx]; }
      const usq = vx * vx + vy * vy + vz * vz;
      for (let i = 0; i < 19; i++) {
        const eu = EX[i] * vx + EY[i] * vy + EZ[i] * vz;
        this.f[i * total + idx] = WT[i] * 1.0 * (1 + eu / CS2 + eu * eu / (2 * CS2 * CS2) - usq / (2 * CS2));
      }
    }
  }

  /** Single LBM step (CPU). Extracted so step_n / step_n_chunked share one body. */
  /** CPU 扫风：直接就地改 ventVel 数组（_stepOnce 立即读到新值）。 */
  private updateSwing(step: number): void {
    if (this.swingGroups.length === 0 || this.dt_phys <= 0) return;
    for (const g of this.swingGroups) {
      const t = step * this.dt_phys;
      const ang = g.amplitude * Math.sin(2 * Math.PI * t / g.period + g.phase);
      const [vx, vy, vz] = applySwing(g.baseVx, g.baseVy, g.baseVz, g.mode, ang);
      for (const [start, len] of g.runs) {
        this.ventVelX.fill(vx, start, start + len);
        this.ventVelY.fill(vy, start, start + len);
        this.ventVelZ.fill(vz, start, start + len);
      }
    }
  }

  hasSwing(): boolean { return this.swingGroups.length > 0; }

  private _stepOnce(absoluteStep?: number): void {
    if (this.swingGroups.length > 0) this.updateSwing(absoluteStep ?? this.step);
    const { Nx, Ny, Nz, f, cellType, ventVelX, ventVelY, ventVelZ, ventTemp, heatTemp } = this;
    const total = Nx * Ny * Nz;
    const nu_mol = (this.tau - 0.5) / 3;
    const alphaT = this.alphaT;
    const roomTemp = this.roomTemp;
    const Cs = this.Cs;
    const g_lat = this.g_lat;
    const T_ref = this.T_ref;

      // 1. Macroscopic (+ buoyancy half-force in velocity)
      const FxArr = new Float32Array(total);
      const FyArr = new Float32Array(total);
      const FzArr = new Float32Array(total);
      for (let idx = 0; idx < total; idx++) {
        if (cellType[idx] === CELL_SOLID) { this.rho[idx] = 1; this.ux[idx] = 0; this.uy[idx] = 0; this.uz[idx] = 0; continue; }
        let r = 0, mx = 0, my = 0, mz = 0;
        for (let i = 0; i < 19; i++) { const fi = f[i * total + idx]; r += fi; mx += EX[i] * fi; my += EY[i] * fi; mz += EZ[i] * fi; }
        r = Math.max(r, 0.01); this.rho[idx] = r;
        // If rho was clamped (drifted mass), discard spurious momentum to avoid
        // amplifying it into a huge velocity (mx/eps).
        if (r <= 0.01) { mx = 0; my = 0; mz = 0; }

        // Boussinesq buoyancy: F = rho * g_lat * (T - T_ref) in +z (up). Hot rises, cold sinks.
        let Fx = 0, Fy = 0, Fz = 0;
        if (g_lat !== 0) { Fz = r * g_lat * (this.T[idx] - T_ref); }
        FxArr[idx] = Fx; FyArr[idx] = Fy; FzArr[idx] = Fz;

        // u = (Σ e_i f_i + F/2) / rho  (Guo half-force)
        let vx = (mx + 0.5 * Fx) / r, vy = (my + 0.5 * Fy) / r, vz = (mz + 0.5 * Fz) / r;
        if (cellType[idx] === CELL_INLET) { vx = ventVelX[idx]; vy = ventVelY[idx]; vz = ventVelZ[idx]; }
        this.ux[idx] = vx; this.uy[idx] = vy; this.uz[idx] = vz;
      }

      // 2. Collision with Smagorinsky LES (+ Guo buoyancy source)
      const f_post = new Float32Array(19 * total);
      for (let idx = 0; idx < total; idx++) {
        if (cellType[idx] === CELL_SOLID) continue;
        const r = this.rho[idx], vx = this.ux[idx], vy = this.uy[idx], vz = this.uz[idx];
        const Fx = FxArr[idx], Fy = FyArr[idx], Fz = FzArr[idx];
        const usq = vx * vx + vy * vy + vz * vz;

        // Compute equilibrium
        const feq = new Float32Array(19);
        for (let i = 0; i < 19; i++) {
          const eu = EX[i] * vx + EY[i] * vy + EZ[i] * vz;
          feq[i] = WT[i] * r * (1 + eu / CS2 + eu * eu / (2 * CS2 * CS2) - usq / (2 * CS2));
        }

        // Smagorinsky: compute strain rate from non-equilibrium part
        let Pi_xx = 0, Pi_yy = 0, Pi_zz = 0, Pi_xy = 0, Pi_xz = 0, Pi_yz = 0;
        for (let i = 0; i < 19; i++) {
          const fneq = f[i * total + idx] - feq[i];
          Pi_xx += fneq * EX2[i]; Pi_yy += fneq * EY2[i]; Pi_zz += fneq * EZ2[i];
          Pi_xy += fneq * EXY[i]; Pi_xz += fneq * EXZ[i]; Pi_yz += fneq * EYZ[i];
        }
        const S_mag = Math.sqrt(Pi_xx*Pi_xx + Pi_yy*Pi_yy + Pi_zz*Pi_zz + 2*(Pi_xy*Pi_xy + Pi_xz*Pi_xz + Pi_yz*Pi_yz));
        const nu_turb = Cs * Cs * S_mag;
        const tau_eff = Math.max(3 * (nu_mol + nu_turb) + 0.5, 0.505);
        const omega_eff = 1.0 / tau_eff;

        // Guo body-force source:
        // S_i = (1 - ω/2) w_i [ 3(e_i - u)·F / cs² + 9 (e_i·u)(e_i·F) / cs⁴ ]
        const one_m_omega_half = 1.0 - 0.5 * omega_eff;
        const uF = vx * Fx + vy * Fy + vz * Fz;
        for (let i = 0; i < 19; i++) {
          const eiF = EX[i] * Fx + EY[i] * Fy + EZ[i] * Fz;
          const eu = EX[i] * vx + EY[i] * vy + EZ[i] * vz;
          const Si = one_m_omega_half * WT[i] * (3.0 * (eiF - uF) / CS2 + 9.0 * eu * eiF / (CS2 * CS2));
          f_post[i * total + idx] = f[i * total + idx] + omega_eff * (feq[i] - f[i * total + idx]) + Si;
        }
      }

      // 3. PULL Streaming + Bounce-back
      const f_new = new Float32Array(19 * total);
      for (let z = 0; z < Nz; z++)
        for (let y = 0; y < Ny; y++)
          for (let x = 0; x < Nx; x++) {
            const idx = x + y * Nx + z * Nx * Ny;
            if (cellType[idx] === CELL_SOLID) continue;
            for (let i = 0; i < 19; i++) {
              const xs = x - EX[i], ys = y - EY[i], zs = z - EZ[i];
              if (xs >= 0 && xs < Nx && ys >= 0 && ys < Ny && zs >= 0 && zs < Nz) {
                const srcIdx = xs + ys * Nx + zs * Nx * Ny;
                if (cellType[srcIdx] === CELL_SOLID) {
                  f_new[i * total + idx] = f_post[OPP[i] * total + idx];
                } else {
                  f_new[i * total + idx] = f_post[i * total + srcIdx];
                }
              } else {
                f_new[i * total + idx] = f_post[OPP[i] * total + idx];
              }
            }
          }

      // 4. Velocity inlet BC
      for (let idx = 0; idx < total; idx++) {
        if (cellType[idx] !== CELL_INLET) continue;
        const vx = ventVelX[idx], vy = ventVelY[idx], vz = ventVelZ[idx];
        const usq = vx * vx + vy * vy + vz * vz;
        for (let i = 0; i < 19; i++) {
          const eu = EX[i] * vx + EY[i] * vy + EZ[i] * vz;
          f_new[i * total + idx] = WT[i] * 1.0 * (1 + eu / CS2 + eu * eu / (2 * CS2 * CS2) - usq / (2 * CS2));
        }
        if (ventTemp[idx] !== TEMP_UNSET) this.T[idx] = ventTemp[idx];
      }

      // 5. Pressure outlet: zero-gradient from nearest interior fluid cell
      //    (search all 6 neighbors so vents on ANY wall work, not just N/S)
      for (let idx = 0; idx < total; idx++) {
        if (cellType[idx] !== CELL_OUTLET) continue;
        const x = idx % Nx, y = Math.floor(idx / Nx) % Ny, z = Math.floor(idx / (Nx * Ny));
        const nc = findFluidNeighborCPU(x, y, z, Nx, Ny, Nz, cellType);
        if (nc >= 0) { for (let i = 0; i < 19; i++) f_new[i * total + idx] = f_new[i * total + nc]; }
        if (ventTemp[idx] !== TEMP_UNSET) this.T[idx] = ventTemp[idx];
      }

      // 6. Heat source: zero-gradient from nearest interior fluid cell
      for (let idx = 0; idx < total; idx++) {
        if (cellType[idx] !== CELL_HEAT) continue;
        const x = idx % Nx, y = Math.floor(idx / Nx) % Ny, z = Math.floor(idx / (Nx * Ny));
        const nc = findFluidNeighborCPU(x, y, z, Nx, Ny, Nz, cellType);
        if (nc >= 0) { for (let i = 0; i < 19; i++) f_new[i * total + idx] = f_new[i * total + nc]; }
        if (heatTemp[idx] !== TEMP_UNSET) this.T[idx] = heatTemp[idx];
      }

      // 7. Temperature update for ALL non-solid cells (matching Python)
      const T_old = new Float32Array(this.T);
      for (let z = 0; z < Nz; z++)
        for (let y = 0; y < Ny; y++)
          for (let x = 0; x < Nx; x++) {
            const idx = x + y * Nx + z * Nx * Ny;
            const ct = cellType[idx];

            // Solid: T = roomTemp
            if (ct === CELL_SOLID) { this.T[idx] = roomTemp; continue; }
            // Inlet and Heat: T is fixed by BCs, skip update
            if (ct === CELL_INLET || ct === CELL_HEAT) continue;
            // FLUID and OUTLET: update T via advection-diffusion
            if (x <= 0 || x >= Nx - 1 || y <= 0 || y >= Ny - 1 || z <= 0 || z >= Nz - 1) continue;

            const Tc = T_old[idx];
            const vx = this.ux[idx], vy = this.uy[idx], vz = this.uz[idx];
            const dTdx_p = T_old[(x+1)+y*Nx+z*Nx*Ny] - Tc; const dTdx_m = Tc - T_old[(x-1)+y*Nx+z*Nx*Ny];
            const dTdy_p = T_old[x+(y+1)*Nx+z*Nx*Ny] - Tc; const dTdy_m = Tc - T_old[x+(y-1)*Nx+z*Nx*Ny];
            const dTdz_p = T_old[x+y*Nx+(z+1)*Nx*Ny] - Tc; const dTdz_m = Tc - T_old[x+y*Nx+(z-1)*Nx*Ny];
            const adv = (vx > 0 ? vx * dTdx_m : vx * dTdx_p) + (vy > 0 ? vy * dTdy_m : vy * dTdy_p) + (vz > 0 ? vz * dTdz_m : vz * dTdz_p);
            const lap = T_old[(x+1)+y*Nx+z*Nx*Ny] + T_old[(x-1)+y*Nx+z*Nx*Ny] + T_old[x+(y+1)*Nx+z*Nx*Ny] + T_old[x+(y-1)*Nx+z*Nx*Ny] + T_old[x+y*Nx+(z+1)*Nx*Ny] + T_old[x+y*Nx+(z-1)*Nx*Ny] - 6 * Tc;
            this.T[idx] = Math.max(0.1, Math.min(1.5, Tc - adv + alphaT * lap));
          }

      f.set(f_new);
  }

  step_n(n: number): void {
    for (let s = 0; s < n; s++) this._stepOnce(this.step + s);
    this.step += n;
  }

  /**
   * Chunked variant of step_n: runs `n` steps but yields to the event loop
   * every `chunkSize` steps (via setTimeout(0)), invoking `onProgress` with
   * (stepsCompleted, totalSteps). This keeps the main thread responsive so the
   * UI can show progress and the user can still interact / stop the run.
   */
  async step_n_chunked(n: number, chunkSize: number, onProgress?: (done: number, total: number) => void): Promise<void> {
    const chunk = Math.max(1, Math.floor(chunkSize));
    let done = 0;
    while (done < n) {
      const batch = Math.min(chunk, n - done);
      for (let s = 0; s < batch; s++) this._stepOnce(this.step + s);
      done += batch;
      this.step += batch;
      if (onProgress) onProgress(done, n);
      // Yield to the event loop so React can paint and the user can interact.
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  async getResults(): Promise<SimResults> {
    return { rho: new Float32Array(this.rho), ux: new Float32Array(this.ux), uy: new Float32Array(this.uy), uz: new Float32Array(this.uz), T: new Float32Array(this.T), step: this.step };
  }

  destroy(): void { /* nothing */ }
}

// =====================================================================
// Auto-select engine
// =====================================================================
export type EngineType = 'webgpu' | 'cpu';

export interface GPUDeviceInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

export async function createEngine(): Promise<{ engine: LBMEngineGPU | LBMEngineCPU; type: EngineType; gpuInfo?: GPUDeviceInfo }> {
  const gpuAvail = await LBMEngineGPU.isAvailable();
  if (gpuAvail) {
    const engine = new LBMEngineGPU();
    const ok = await engine.init();
    if (ok) {
      const info = engine.getAdapterInfo();
      return { engine, type: 'webgpu', gpuInfo: info };
    }
  }
  const engine = new LBMEngineCPU();
  await engine.init();
  return { engine, type: 'cpu' };
}
