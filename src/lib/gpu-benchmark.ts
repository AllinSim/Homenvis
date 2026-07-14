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
 * GPU Performance Benchmark Dictionary
 *
 * Reference benchmark: RTX 4060Ti, 60×60×30 grid (108K cells), 50000 steps = 10413ms
 * => 0.001927 ms per step per K-cells
 *
 * Each GPU has a relative performance factor vs RTX 4060Ti.
 * The `msPerStepPerKCells` for RTX 4060Ti is the baseline (1.0×).
 * Other GPUs are estimated relative to this.
 */

export interface GPUBenchmark {
  /** Display name */
  name: string;
  /** Relative performance factor (1.0 = RTX 4060Ti baseline) */
  factor: number;
}

// Baseline: RTX 4060Ti = 10413ms / 50000 steps / 108 K-cells = 0.001927 ms/step/K-cells
const BASELINE_MS_PER_STEP_PER_K = 10413 / 50000 / 108; // ≈ 0.001927

/**
 * Known GPU benchmarks, keyed by keywords found in GPU adapter description.
 * Ordered from most specific to least specific — first match wins.
 */
const GPU_BENCHMARKS: Array<{ keywords: string[]; benchmark: GPUBenchmark }> = [
  // NVIDIA RTX 50 series
  { keywords: ['RTX 5090'], benchmark: { name: 'RTX 5090', factor: 3.2 } },
  { keywords: ['RTX 5080'], benchmark: { name: 'RTX 5080', factor: 2.6 } },
  { keywords: ['RTX 5070'], benchmark: { name: 'RTX 5070', factor: 2.0 } },
  { keywords: ['RTX 5060'], benchmark: { name: 'RTX 5060', factor: 1.4 } },
  // NVIDIA RTX 40 series
  { keywords: ['RTX 4090'], benchmark: { name: 'RTX 4090', factor: 2.8 } },
  { keywords: ['RTX 4080'], benchmark: { name: 'RTX 4080', factor: 2.2 } },
  { keywords: ['RTX 4070'], benchmark: { name: 'RTX 4070', factor: 1.4 } },
  { keywords: ['RTX 4060'], benchmark: { name: 'RTX 4060', factor: 1.0 } }, // baseline
  // NVIDIA RTX 30 series
  { keywords: ['RTX 3090'], benchmark: { name: 'RTX 3090', factor: 1.8 } },
  { keywords: ['RTX 3080'], benchmark: { name: 'RTX 3080', factor: 1.5 } },
  { keywords: ['RTX 3070'], benchmark: { name: 'RTX 3070', factor: 1.1 } },
  { keywords: ['RTX 3060'], benchmark: { name: 'RTX 3060', factor: 0.7 } },
  // NVIDIA RTX 20 series
  { keywords: ['RTX 2080'], benchmark: { name: 'RTX 2080', factor: 0.8 } },
  { keywords: ['RTX 2070'], benchmark: { name: 'RTX 2070', factor: 0.6 } },
  { keywords: ['RTX 2060'], benchmark: { name: 'RTX 2060', factor: 0.5 } },
  // NVIDIA GTX 10 series
  { keywords: ['GTX 1080'], benchmark: { name: 'GTX 1080', factor: 0.5 } },
  { keywords: ['GTX 1070'], benchmark: { name: 'GTX 1070', factor: 0.4 } },
  { keywords: ['GTX 1060'], benchmark: { name: 'GTX 1060', factor: 0.3 } },
  // Apple Silicon
  { keywords: ['Apple', 'M4 Pro'], benchmark: { name: 'Apple M4 Pro', factor: 0.9 } },
  { keywords: ['Apple', 'M4'], benchmark: { name: 'Apple M4', factor: 0.7 } },
  { keywords: ['Apple', 'M3 Pro'], benchmark: { name: 'Apple M3 Pro', factor: 0.7 } },
  { keywords: ['Apple', 'M3'], benchmark: { name: 'Apple M3', factor: 0.5 } },
  { keywords: ['Apple', 'M2'], benchmark: { name: 'Apple M2', factor: 0.4 } },
  // AMD
  { keywords: ['RX 7900'], benchmark: { name: 'RX 7900', factor: 1.8 } },
  { keywords: ['RX 7800'], benchmark: { name: 'RX 7800', factor: 1.4 } },
  { keywords: ['RX 7600'], benchmark: { name: 'RX 7600', factor: 0.8 } },
  { keywords: ['RX 6800'], benchmark: { name: 'RX 6800', factor: 0.9 } },
  { keywords: ['RX 6700'], benchmark: { name: 'RX 6700', factor: 0.7 } },
  // Intel Arc
  { keywords: ['Arc A770'], benchmark: { name: 'Arc A770', factor: 0.6 } },
  { keywords: ['Arc A750'], benchmark: { name: 'Arc A750', factor: 0.5 } },
  // Generic fallbacks
  { keywords: ['NVIDIA'], benchmark: { name: 'NVIDIA GPU', factor: 0.8 } },
  { keywords: ['AMD'], benchmark: { name: 'AMD GPU', factor: 0.7 } },
  { keywords: ['Apple'], benchmark: { name: 'Apple GPU', factor: 0.5 } },
  { keywords: ['Intel'], benchmark: { name: 'Intel GPU', factor: 0.3 } },
];

/** CPU fallback: much slower, roughly 10× slower than RTX 4060Ti */
const CPU_FACTOR = 0.05;

export interface EstimationResult {
  /** Detected GPU name */
  gpuName: string;
  /** Performance factor vs RTX 4060Ti */
  factor: number;
  /** Estimated ms per step per K-cells */
  msPerStepPerK: number;
}

/**
 * Detect GPU and estimate performance based on adapter description.
 */
export function estimateGPUPerformance(gpuDescription: string): EstimationResult {
  if (!gpuDescription) {
    return { gpuName: '未知 GPU', factor: 0.5, msPerStepPerK: BASELINE_MS_PER_STEP_PER_K / 0.5 };
  }

  for (const entry of GPU_BENCHMARKS) {
    if (entry.keywords.every(kw => gpuDescription.includes(kw))) {
      return {
        gpuName: entry.benchmark.name,
        factor: entry.benchmark.factor,
        msPerStepPerK: BASELINE_MS_PER_STEP_PER_K / entry.benchmark.factor,
      };
    }
  }

  // Unknown GPU — assume mid-range
  return { gpuName: gpuDescription.substring(0, 30), factor: 0.6, msPerStepPerK: BASELINE_MS_PER_STEP_PER_K / 0.6 };
}

/**
 * Estimate total simulation time in milliseconds.
 * @param cells - Total grid cells (Nx * Ny * Nz)
 * @param steps - Number of simulation steps
 * @param gpuDescription - GPU adapter description string
 * @param isCPU - Whether using CPU engine
 */
export function estimateSimTime(cells: number, steps: number, gpuDescription: string, isCPU: boolean): { ms: number; gpuName: string } {
  const cellsK = cells / 1000;

  if (isCPU) {
    return {
      ms: cellsK * steps * BASELINE_MS_PER_STEP_PER_K / CPU_FACTOR,
      gpuName: 'CPU',
    };
  }

  const perf = estimateGPUPerformance(gpuDescription);
  return {
    ms: cellsK * steps * perf.msPerStepPerK,
    gpuName: perf.gpuName,
  };
}
