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

import { useState, useCallback, useRef } from 'react';
import { createEngine, type SimResults, LBMEngineGPU, LBMEngineCPU, type EngineType } from '@/lib/lbm-engine';
import { roomToLBMConfig, type RoomLayout } from '@/lib/room-layout';

interface UseSimulationProps {
  room: RoomLayout;
  Nx: number;
  Ny: number;
  Nz: number;
  initialTemp: number;
  addLog: (msg: string) => void;
  airProps: {
    density: number;
    kinematicViscosity: number;
    thermalDiffusivity: number;
  };
}

export function useSimulation({ room, Nx, Ny, Nz, initialTemp, addLog, airProps }: UseSimulationProps) {
  const [engine, setEngine] = useState<LBMEngineGPU | LBMEngineCPU | null>(null);
  const [engineType, setEngineType] = useState<EngineType | null>(null);

  // ⚠️ CRITICAL: Store large data in ref, not state!
  // Storing 58MB in state causes React to serialize it on every render → Out of Memory
  const resultsRef = useRef<SimResults | null>(null);

  // Small trigger to notify components that results changed
  const [resultsVersion, setResultsVersion] = useState(0);

  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);

  const handleInitEngine = useCallback(async () => {
    try {
      addLog('正在初始化计算引擎...');
      const { engine: eng, type } = await createEngine();
      addLog(`使用 ${type === 'webgpu' ? 'WebGPU (GPU加速)' : 'CPU'} 引擎`);

      const config = roomToLBMConfig(room);

      // Temperature conversion
      const T_min = initialTemp - 10;
      const T_max = initialTemp + 10;
      const normalizedTemp = (initialTemp - T_min) / (T_max - T_min);

      // LBM scale conversion
      const dx = room.length / Nx;
      const u_char = 0.05;
      const Re_lattice = 200;
      const nu_lattice = u_char / Re_lattice;
      const nu_phys = airProps.kinematicViscosity;
      const dt_phys = (dx * dx * nu_lattice) / nu_phys;
      const u_scale = dx / dt_phys;

      // Convert temperatures and velocities
      const processedItems = config.items.map(item => {
        const newItem = { ...item };
        if ((item.type === 'heat_source' || item.type === 'vent_inlet' || item.type === 'vent_outlet') && item.temperature !== undefined) {
          newItem.temperature = (item.temperature - T_min) / (T_max - T_min);
        }
        if (item.type === 'vent_inlet' && item.velocity) {
          newItem.velocity = item.velocity.map((v: number) => v / u_scale) as [number, number, number];
        }
        return newItem;
      });

      const finalConfig = {
        ...config,
        initialTemp: normalizedTemp,
        items: processedItems,
      };

      eng.setup(finalConfig, Nx, Ny, Nz);
      setEngine(eng);
      setEngineType(type);
      setStep(0);
      resultsRef.current = null;
      setResultsVersion(0);
      addLog('✓ 引擎初始化完成');
    } catch (err: any) {
      addLog(`✗ 引擎初始化失败: ${err.message}`);
    }
  }, [room, Nx, Ny, Nz, initialTemp, addLog, airProps]);

  const handleRunSteps = useCallback(async (n: number) => {
    if (!engine) {
      addLog('引擎未初始化');
      return;
    }

    setRunning(true);
    addLog(`▶ 开始运行 ${n} 步...`);
    const startTime = performance.now();

    try {
      engine.step_n(n);
      const res = await engine.getResults();
      resultsRef.current = res;
      setResultsVersion(v => v + 1);
      setStep(res.step);
      const elapsed = performance.now() - startTime;
      addLog(`✓ 完成 ${n} 步，用时 ${elapsed.toFixed(1)} ms`);
    } catch (err: any) {
      addLog(`✗ 运行失败: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }, [engine, addLog]);

  const handleReset = useCallback(() => {
    setRunning(false);
    setStep(0);
    resultsRef.current = null;
    setResultsVersion(0);
    if (engine) {
      engine.destroy();
      setEngine(null);
      setEngineType(null);
    }
    addLog('🔄 已重置');
  }, [engine, addLog]);

  return {
    engine,
    engineType,
    results: resultsRef.current,
    resultsVersion,
    running,
    step,
    handleInitEngine,
    handleRunSteps,
    handleReset,
  };
}
