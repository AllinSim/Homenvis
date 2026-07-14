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
 * Clean up verbose GPU name strings from WebGL/WebGPU adapter info.
 *
 * Examples:
 *   "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)"
 *   → "NVIDIA GeForce RTX 4060 Ti"
 *
 *   "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"
 *   → "Intel(R) UHD Graphics 630"
 *
 *   "NVIDIA GeForce RTX 4060 Ti/PCIe/SSE2"
 *   → "NVIDIA GeForce RTX 4060 Ti"
 */
export function cleanGPUName(raw: string): string {
  if (!raw) return '';

  // 1) ANGLE format — strip the wrapper
  if (raw.startsWith('ANGLE ') || raw.startsWith('angle ')) {
    // Remove "ANGLE (Vendor, " prefix
    let inner = raw.replace(/^ANGLE \([^,]+, /i, '');
    // Remove trailing ", backend)" suffix — everything after the last comma before closing paren
    const lastComma = inner.lastIndexOf(',');
    if (lastComma > 0) {
      inner = inner.substring(0, lastComma);
    }
    // Remove hex device ID like "(0x00002803)"
    inner = inner.replace(/ \(0x[0-9a-fA-F]+\)/g, '');
    // Remove Direct3D / D3D / vs_ / ps_ noise
    inner = inner.replace(/ Direct3D11/gi, '');
    inner = inner.replace(/ vs_5_0/gi, '');
    inner = inner.replace(/ ps_5_0/gi, '');
    inner = inner.replace(/ D3D11/gi, '');
    return inner.trim();
  }

  // 2) Non-ANGLE — strip common noise
  let name = raw;
  name = name.replace(/ \(0x[0-9a-fA-F]+\)/g, '');
  name = name.replace(/ \/ PCIe/gi, '');
  name = name.replace(/ \/ SSE2/gi, '');
  return name.trim();
}