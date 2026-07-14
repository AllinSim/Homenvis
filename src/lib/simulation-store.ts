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
 * Simulation Store — Module-level singleton for sharing large SimResults
 * and physics conversion parameters outside the React component tree.
 *
 * WHY: SimResults contains 5 Float32Arrays (~58MB for 180×180×90 grid).
 * Passing these through React props triggers React's reconciliation which
 * attempts to structurally clone/compare the data → "DataCloneError: out of memory".
 *
 * SOLUTION: Store the data here in a plain module-level variable.
 * Only a lightweight `version` number passes through React to trigger re-renders.
 * Components read the data directly from this store, bypassing React entirely.
 *
 * The store also holds physics conversion parameters (u_scale, T_min, T_max, etc.)
 * so all visualization components use the SAME conversion — no duplicated formulas.
 */

import type { SimResults } from '@/lib/lbm-engine';

let _results: SimResults | null = null;
let _version = 0;

/** Physics conversion parameters for interpreting simulation results. */
export interface PhysicsParams {
  u_scale: number;   // Physical velocity per lattice velocity unit (m/s per lattice unit)
  dx: number;        // Lattice spacing in meters
  dt_phys: number;   // Physical time per LBM step (seconds)
  T_min: number;     // Minimum temperature for T normalization (°C)
  T_max: number;     // Maximum temperature for T normalization (°C)
  rho_phys: number;  // Physical air density (kg/m³), typically 1.2
  tau: number;       // LBM relaxation time
  omega: number;     // LBM relaxation rate
  alphaT: number;    // Lattice thermal diffusivity
  u_char: number;    // Lattice characteristic velocity
  Re_lattice: number; // Lattice Reynolds number
  g_lat: number;     // Boussinesq lattice gravity coefficient (0 = buoyancy off)
  T_ref: number;     // Dimensionless reference temperature for buoyancy
}

let _physicsParams: PhysicsParams | null = null;

/** Write new simulation results to the store. Returns the new version. */
export function setSimResults(results: SimResults | null): number {
  _results = results;
  _version++;
  return _version;
}

/** Read current simulation results (direct reference, no clone). */
export function getSimResults(): SimResults | null {
  return _results;
}

/** Get current version number (incremented on each write). */
export function getSimVersion(): number {
  return _version;
}

/** Store physics conversion parameters (set once at engine initialization). */
export function setPhysicsParams(params: PhysicsParams): void {
  _physicsParams = params;
}

/** Read physics conversion parameters. */
export function getPhysicsParams(): PhysicsParams | null {
  return _physicsParams;
}

/** Clear only the simulation results (keep physics params, which are engine
 *  calibration set at init and needed by the viewer/summary for unit conversion). */
export function clearSimResults(): number {
  _results = null;
  _version = 0;
  return _version;
}

/** Clear physics params too (call when the engine itself is destroyed/reset). */
export function clearPhysicsParams(): void {
  _physicsParams = null;
}

/** Clear the store (results + physics params). */
export function clearAll(): number {
  _results = null;
  _version = 0;
  _physicsParams = null;
  return _version;
}
