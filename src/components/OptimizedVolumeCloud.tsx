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

import { useMemo, useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { type SimResults } from '@/lib/lbm-engine';

interface OptimizedVolumeCloudProps {
  results: SimResults;
  Nx: number;
  Ny: number;
  Nz: number;
  roomLength: number;
  roomWidth: number;
  roomHeight: number;
  field: 'velocity' | 'temperature' | 'pressure';
  threshold: number;
  opacity: number;
  maxPoints?: number;
  downsampleFactor?: number;
}

// Heat map color function
function heatmapRGB(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.25) {
    const s = t / 0.25;
    return [0, s, 1];
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [0, 1, 1 - s];
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [s, 1, 0];
  } else {
    const s = (t - 0.75) / 0.25;
    return [1, 1 - s * 0.5, 0];
  }
}

// Create circle texture for points
function createCircleTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export default function OptimizedVolumeCloud({
  results,
  Nx,
  Ny,
  Nz,
  roomLength,
  roomWidth,
  roomHeight,
  field,
  threshold,
  opacity,
  maxPoints = 50000,
  downsampleFactor = 4,
}: OptimizedVolumeCloudProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Compute geometry with intelligent sampling
  const { positions, colors, sizes, pointCount } = useMemo(() => {
    setIsProcessing(true);

    const dx = roomLength / Nx;
    const dy = roomWidth / Ny;
    const dz = roomHeight / Nz;

    // First pass: compute field values and find interesting regions
    const vals = new Float32Array(Nx * Ny * Nz);
    let vmin = Infinity, vmax = -Infinity;

    for (let idx = 0; idx < Nx * Ny * Nz; idx++) {
      let v = 0;
      if (field === 'velocity') {
        v = Math.sqrt(results.ux[idx] ** 2 + results.uy[idx] ** 2 + results.uz[idx] ** 2);
      } else if (field === 'temperature') {
        v = results.T[idx];
      } else {
        v = results.rho[idx];
      }
      vals[idx] = v;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }

    const range = vmax - vmin || 1;

    // Adaptive sampling based on field variation
    const candidates: Array<{ idx: number; norm: number; variance: number }> = [];
    const step = Math.max(2, downsampleFactor);

    for (let iz = 1; iz < Nz - 1; iz += step) {
      for (let iy = 1; iy < Ny - 1; iy += step) {
        for (let ix = 1; ix < Nx - 1; ix += step) {
          const idx = ix + iy * Nx + iz * Nx * Ny;
          const v = vals[idx];
          const norm = (v - vmin) / range;

          // Skip below threshold
          if (norm < threshold) continue;

          // Compute local variance (favor regions with high variation)
          let variance = 0;
          const neighbors = [
            vals[idx - 1] || v,
            vals[idx + 1] || v,
            vals[idx - Nx] || v,
            vals[idx + Nx] || v,
            vals[idx - Nx * Ny] || v,
            vals[idx + Nx * Ny] || v,
          ];
          for (const n of neighbors) {
            variance += Math.abs(n - v);
          }
          variance /= neighbors.length;

          candidates.push({ idx, norm, variance });
        }
      }
    }

    // Sort by importance: high values or high variance
    candidates.sort((a, b) => {
      const scoreA = a.norm * 0.7 + a.variance / range * 0.3;
      const scoreB = b.norm * 0.7 + b.variance / range * 0.3;
      return scoreB - scoreA;
    });

    // Take top N points
    const selected = candidates.slice(0, maxPoints);

    const pos: number[] = [];
    const col: number[] = [];
    const siz: number[] = [];

    for (const { idx, norm } of selected) {
      const iz = Math.floor(idx / (Nx * Ny));
      const iy = Math.floor((idx % (Nx * Ny)) / Nx);
      const ix = idx % Nx;

      const rx = (ix + 0.5) * dx;
      const ry = (iy + 0.5) * dy;
      const rz = (iz + 0.5) * dz;

      pos.push(rx, rz, ry);

      const [r, g, b] = heatmapRGB(norm);
      col.push(r, g, b);

      siz.push(0.12 + norm * 0.18);
    }

    setIsProcessing(false);

    return {
      positions: new Float32Array(pos),
      colors: new Float32Array(col),
      sizes: new Float32Array(siz),
      pointCount: selected.length,
    };
  }, [results, Nx, Ny, Nz, roomLength, roomWidth, roomHeight, field, threshold, maxPoints, downsampleFactor]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, [positions, colors, sizes]);

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.22,
      vertexColors: true,
      transparent: true,
      opacity: opacity * 0.6,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      map: createCircleTexture(),
    });
  }, [opacity]);

  // Cleanup
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (isProcessing) {
    return null;
  }

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
