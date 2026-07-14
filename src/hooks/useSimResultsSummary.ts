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

import { useMemo } from 'react';
import { getSimResults, getPhysicsParams } from '@/lib/simulation-store';

/**
 * Lightweight statistics-only version of SimResults.
 * Reads data from simulation-store (module-level singleton) — NEVER through React props.
 * Only `version` passes through React, triggering recalculation when results change.
 */
export interface SimResultsSummary {
  step: number;
  dataPoints: number;
  velocity: {
    uxMin: number;
    uxMax: number;
    uyMin: number;
    uyMax: number;
    uzMin: number;
    uzMax: number;
    magMin: number;
    magMax: number;
    magMean: number;
  };
  temperature: {
    min: number;
    max: number;
    mean: number;
    std: number;       // 标准差，衡量温度均匀性
    deltaT: number;    // 最大温差 = max - min
  };
  pressure: {
    min: number;
    max: number;
  };
  comfort: {
    /** 处于热舒适区(默认 18–28°C)的体占比 */
    thermalRatio: number;
    /** 风速低于吹风感阈值(默认 0.3 m/s)的体占比 */
    lowDraftRatio: number;
    /** 同时满足热舒适 + 低吹风感的体占比（综合舒适度） */
    overallRatio: number;
    /** 平均风速 (m/s) */
    meanSpeed: number;
  };
}

/**
 * Extract lightweight summary from SimResults in global store.
 * Only `version` is needed as React dependency — the 58MB data is never a prop.
 * Uses stored PhysicsParams for correct physical unit conversion.
 */
export function useSimResultsSummary(
  version: number
): SimResultsSummary | null {
  return useMemo(() => {
    const results = getSimResults(); // Read from global store, not from props
    const physics = getPhysicsParams(); // Read stored conversion params
    if (!results) return null;

    // Use stored physics params for conversion (consistent with engine initialization)
    const u_scale = physics?.u_scale ?? 1;
    const T_min = physics?.T_min ?? 15;
    const T_max = physics?.T_max ?? 35;
    const rho_phys = physics?.rho_phys ?? 1.2;

    const n = results.ux.length;

    let uxMin = Infinity, uxMax = -Infinity;
    let uyMin = Infinity, uyMax = -Infinity;
    let uzMin = Infinity, uzMax = -Infinity;
    let magMin = Infinity, magMax = -Infinity;
    let tMin = Infinity, tMax = -Infinity, tSum = 0;
    let rhoMin = Infinity, rhoMax = -Infinity;
    let magSum = 0;

    // 舒适度阈值（参考 ASHRAE 55 / ISO 7730 室内热环境标准）
    const T_COMFORT_LO = 18, T_COMFORT_HI = 28; // 热舒适温度区间 (°C)
    const DRAFT_LIMIT = 0.3;                     // 吹风感风速上限 (m/s)
    let thermalOk = 0, lowDraft = 0, comfortOk = 0;

    // Single pass through data — convert to physical units
    for (let i = 0; i < n; i++) {
      const ux = results.ux[i] * u_scale;  // lattice → m/s
      const uy = results.uy[i] * u_scale;
      const uz = results.uz[i] * u_scale;
      const t = results.T[i] * (T_max - T_min) + T_min;  // normalized → °C
      const rho = results.rho[i] * rho_phys;  // lattice → kg/m³

      const mag = Math.sqrt(ux * ux + uy * uy + uz * uz);
      magSum += mag;

      if (ux < uxMin) uxMin = ux;
      if (ux > uxMax) uxMax = ux;
      if (uy < uyMin) uyMin = uy;
      if (uy > uyMax) uyMax = uy;
      if (uz < uzMin) uzMin = uz;
      if (uz > uzMax) uzMax = uz;
      if (mag < magMin) magMin = mag;
      if (mag > magMax) magMax = mag;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      tSum += t;
      if (rho < rhoMin) rhoMin = rho;
      if (rho > rhoMax) rhoMax = rho;

      const tOk = t >= T_COMFORT_LO && t <= T_COMFORT_HI;
      const dOk = mag <= DRAFT_LIMIT;
      if (tOk) thermalOk++;
      if (dOk) lowDraft++;
      if (tOk && dOk) comfortOk++;
    }

    const meanT = tSum / n;
    // 第二趟：温度标准差（衡量温度场均匀性 / 热分层程度）
    let tVarSum = 0;
    for (let i = 0; i < n; i++) {
      const t = results.T[i] * (T_max - T_min) + T_min;
      const d = t - meanT;
      tVarSum += d * d;
    }
    const tStd = Math.sqrt(tVarSum / n);

    return {
      step: results.step,
      dataPoints: n,
      velocity: {
        uxMin, uxMax, uyMin, uyMax, uzMin, uzMax,
        magMin, magMax, magMean: magSum / n,
      },
      temperature: {
        min: tMin,
        max: tMax,
        mean: meanT,
        std: tStd,
        deltaT: tMax - tMin,
      },
      pressure: {
        min: rhoMin,
        max: rhoMax,
      },
      comfort: {
        thermalRatio: thermalOk / n,
        lowDraftRatio: lowDraft / n,
        overallRatio: comfortOk / n,
        meanSpeed: magSum / n,
      },
    };
  }, [version]); // Only `version` triggers recalculation — 58MB data is never a React dependency
}