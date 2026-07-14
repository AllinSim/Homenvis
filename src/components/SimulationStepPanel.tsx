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

'use client';

import { useState, useMemo } from 'react';
import { type RoomLayout, type SwingSchedule, VENT_FACE_LABELS, deriveFaceFromVelocity, deriveInflowFace, deriveFaceFromSize, createDefaultSwing } from '@/lib/room-layout';
import { type LBMEngineGPU, type LBMEngineCPU, type EngineType, type GPUDeviceInfo } from '@/lib/lbm-engine';
import { estimateSimTime } from '@/lib/gpu-benchmark';
import { useIconStyle } from '@/lib/icon-style-context';
import { useI18n } from '@/lib/i18n-context';
import SectionPanel from '@/components/SectionPanel';
import NumberInput from '@/components/NumberInput';

type SimQuality = 'low' | 'medium' | 'high' | 'ultra';

const STEP_PRESETS = [100, 500, 1000, 2000, 5000];

interface SimulationStepPanelProps {
  room: RoomLayout;
  setRoom: React.Dispatch<React.SetStateAction<RoomLayout>>;
  initialTemp: number;
  setInitialTemp: (temp: number) => void;
  simQuality: SimQuality;
  setSimQuality: (q: SimQuality) => void;
  engine: LBMEngineGPU | LBMEngineCPU | null;
  engineType: EngineType | null;
  gpuInfo: GPUDeviceInfo | null;
  running: boolean;
  step: number;
  log: string[];
  Nx: number; Ny: number; Nz: number;
  dtPhys: number;
  estimatedGpuName: string;
  maxPhysSpeed: number;
  initEngine: () => void;
  runSteps: (n: number) => void;
  stopSimulation: () => void;
  resetEngine: () => void;
  activeSection: string;
}

export default function SimulationStepPanel({
  room, setRoom,
  initialTemp, setInitialTemp,
  simQuality, setSimQuality,
  engine, engineType, gpuInfo,
  running, step, log,
  Nx, Ny, Nz,
  dtPhys, estimatedGpuName, maxPhysSpeed,
  initEngine, runSteps, stopSimulation, resetEngine,
  activeSection,
}: SimulationStepPanelProps) {
  const { iconStyle } = useIconStyle();
  const { t } = useI18n();
  const isFlat = iconStyle === 'flat';

  const iconInit = isFlat ? '+' : '🔧';
  const iconReinit = isFlat ? '↻' : '🔄';
  const iconRun = isFlat ? '▸' : '▶️';
  const iconStop = isFlat ? '■' : '⏹️';
  const iconReset = isFlat ? '↻' : '🔄';

  const [runMode, setRunMode] = useState<'steps' | 'time'>('steps');
  const [stepInput, setStepInput] = useState(500);
  const [timeInput, setTimeInput] = useState(5.0);

  const stepsForTime = useMemo(() => {
    if (dtPhys <= 0) return 100;
    return Math.max(1, Math.round(timeInput / dtPhys));
  }, [timeInput, dtPhys]);

  const stepsToRun = runMode === 'steps' ? stepInput : stepsForTime;

  const estimatedTimeMs = useMemo(() => {
    const gpuDesc = gpuInfo?.device || gpuInfo?.description || '';
    const isCPU = engineType === 'cpu';
    return estimateSimTime(Nx * Ny * Nz, stepsToRun, gpuDesc, isCPU).ms;
  }, [Nx, Ny, Nz, stepsToRun, gpuInfo, engineType]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return t('sim.timeMs', { n: ms.toFixed(0) });
    const sec = ms / 1000;
    if (sec < 60) return t('sim.timeSec', { n: sec.toFixed(1) });
    return t('sim.timeMin', { n: (sec / 60).toFixed(1) });
  };

  const gpuDisplayName = engine
    ? (engineType === 'webgpu' ? (gpuInfo?.device || gpuInfo?.description || estimatedGpuName || 'WebGPU') : 'CPU')
    : estimatedGpuName || '';

  // 判断当前 WebGPU 是否跑在集成显卡上（未识别到独显）。
  // 仅在引擎为 WebGPU 且 GPU 描述命中集显关键字时为真；CPU 后端不提示。
  const isLikelyIntegratedGPU = useMemo(() => {
    if (engineType !== 'webgpu') return false;
    const desc = (gpuInfo?.device || gpuInfo?.description || estimatedGpuName || '').toLowerCase();
    if (!desc) return false;
    // 集显典型特征：Intel UHD/Iris/HD Graphics、AMD APU/Radeon Graphics、Apple M 基础款(无 Pro/Max/Ultra)
    if (/uhd|iris|hd graphics|intel.*graphics/i.test(desc)) return true;
    if (/radeon.*graphics|radeon.*vega|amd.*radeon.*graphics/i.test(desc)) return true;
    if (/apple.*m[0-9]/i.test(desc) && !/pro|max|ultra/i.test(desc)) return true;
    // 明确的"独显"则不算集显
    if (/rtx|gtx|geforce|radeon rx|radeon hd|radeon pro|arc a[57]/i.test(desc)) return false;
    return false;
  }, [engineType, gpuInfo, estimatedGpuName]);

  const gridCells = Nx * Ny * Nz;

  const handleRun = () => { runSteps(stepsToRun); };

  const hasVents = room.vents.length > 0;
  const hasHeatSources = room.heatSources.length > 0;
  // 窗户勾选了热源也算作热源边界条件
  const windowHeatSources = room.boxes.filter(b => b.isWindow && b.asHeatSource);
  const hasWindowHeat = windowHeatSources.length > 0;
  const hasDevices = room.devices && room.devices.length > 0;
  const hasBoundaryConditions = hasVents || hasHeatSources || hasWindowHeat || hasDevices;

  return (
    <div className="p-5 h-full flex flex-col text-sm">
      {/* ===== 仿真条件（初始条件 + 边界条件） ===== */}
      <SectionPanel sectionId="sim-conditions" activeSection={activeSection} title={t('section.sim-conditions')} iconSkeuomorphic="🎛️" iconFlat="◐" iconBg="from-blue-400 to-cyan-500">
        {/* --- 初始条件 --- */}
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-5 h-5 rounded flex items-center justify-center bg-gradient-to-br from-purple-400 to-pink-500 ${isFlat ? 'text-[9px] font-bold' : 'text-[10px]'} text-white`}>
            {isFlat ? 'T' : '🌡️'}
          </span>
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('sim.initCond')}</span>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">{t('sim.initTemp')}</span>
          <NumberInput step="0.5" value={initialTemp}
            onValueChange={(val) => setInitialTemp(val)}
            className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 transition-all" />
        </label>

        {/* --- 边界条件 --- */}
        <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-3">
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-5 h-5 rounded flex items-center justify-center bg-gradient-to-br from-blue-400 to-cyan-500 ${isFlat ? 'text-[9px] font-bold' : 'text-[10px]'} text-white`}>
              {isFlat ? '◎' : '💨'}
            </span>
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('sim.boundaryCond')}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          {!hasBoundaryConditions && (
            <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">{t('sim.noBoundary')}</div>
          )}
          {/* Vent BCs */}
          {hasVents && room.vents.map(v => {
            const setVel = (idx: number, val: number) => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, velocity: x.velocity.map((vel, i) => i === idx ? val : vel) as [number, number, number] } : x) }));
            const speed = Math.sqrt(v.velocity[0]**2 + v.velocity[1]**2 + v.velocity[2]**2);
            const showVel = v.ventType === 'velocity_inlet' || v.outletMode === 'velocity';
            const isOutflow = v.ventType === 'velocity_inlet';
            const face = isOutflow ? deriveFaceFromVelocity(v.velocity) : deriveInflowFace(v.velocity);
            return (
            <div key={v.id} className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-2 border border-blue-200 dark:border-blue-800">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {v.name} <span className={`text-xs px-2 py-0.5 rounded-full ${v.ventType === 'velocity_inlet' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'}`}>
                  {v.ventType === 'velocity_inlet' ? t('sim.inlet') : t('sim.outlet')}
                </span>
              </div>
              {/* 出风/回风面：由速度方向自动确定（与电器设备一致），只读提示 */}
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {v.ventType === 'velocity_inlet' ? t('sim.outflowFace') : t('sim.inflowFace')}：<span className="font-medium text-gray-700 dark:text-gray-300">{VENT_FACE_LABELS[face]}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('sim.faceAuto')}</span>
              </div>
              {showVel && (
                <>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[["Vx'", 0], ["Vy'", 1], ["Vz'", 2]].map(([label, idx]) => (
                      <label key={label as string}>
                        <span className="text-gray-500 dark:text-gray-400 font-medium">{label} (m/s)</span>
                        <NumberInput step="0.01" value={v.velocity[idx as number]}
                          onValueChange={(val) => setVel(idx as number, val)}
                          className={`w-full border rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 ${speed > maxPhysSpeed ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-300 dark:border-slate-600'}`} />
                      </label>
                    ))}
                  </div>
                  {speed > maxPhysSpeed && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2 text-xs text-red-700 dark:text-red-300">
                      {t('sim.speedOverLimit', { max: maxPhysSpeed.toFixed(2) })}
                    </div>
                  )}
                </>
              )}
              {v.ventType === 'velocity_inlet' ? (
                <>
                  <label className="block text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.outletTemp')}</span>
                    <NumberInput step="0.5" value={v.temperature ?? initialTemp}
                      onValueChange={(val) => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, temperature: val } : x) }))}
                      className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-1" />
                  </label>
                  {/* 扫风：出风方向周期性摆动。模式按房间坐标系定义——
                      水平扫风(左右)=方向在水平面内摆动，竖直扫风(上下)=方向在铅垂面内摆动。 */}
                  {(() => {
                    const sw: SwingSchedule = v.swing ?? createDefaultSwing();
                    const setSwing = (patch: Partial<SwingSchedule>) => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, swing: { ...sw, ...patch } } : x) }));
                    return (
                      <div className="border-t border-gray-200 dark:border-slate-600 pt-2 space-y-1.5 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={sw.enabled} onChange={e => setSwing({ enabled: e.target.checked })} className="accent-blue-500" />
                          <span className="font-medium text-gray-700 dark:text-gray-200">{t('sim.swing')}</span>
                          <span className="text-gray-400 dark:text-gray-500">{t('sim.swingDesc')}</span>
                        </label>
                        {sw.enabled && (
                          <div className="space-y-1.5 pl-5">
                            <div className="flex items-center gap-2">
                              <span className="w-12 text-gray-500 dark:text-gray-400">{t('sim.swingMode')}</span>
                              <select value={sw.mode} onChange={e => setSwing({ mode: e.target.value as 'horizontal' | 'vertical' })}
                                className="bg-gray-100 dark:bg-gray-700 rounded px-1 py-0.5 flex-1">
                                <option value="horizontal">{t('sim.swingH')}</option>
                                <option value="vertical">{t('sim.swingV')}</option>
                              </select>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-12 text-gray-500 dark:text-gray-400">{t('sim.swingHalfAngle')}</span>
                              <NumberInput step="1" value={Math.round(sw.amplitude * 180 / Math.PI)} onValueChange={(num) => setSwing({ amplitude: num * Math.PI / 180 })}
                                className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-12 text-gray-500 dark:text-gray-400">{t('sim.swingPeriod')}</span>
                              <NumberInput step="0.5" value={sw.period} onValueChange={(num) => setSwing({ period: num })}
                                className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  <label className="block text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.outletMode')}</span>
                    <select value={v.outletMode ?? 'pressure'} onChange={e => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, outletMode: e.target.value as 'pressure' | 'velocity' } : x) }))}
                      className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-1">
                      <option value="pressure">{t('sim.pressureOutlet')}</option><option value="velocity">{t('sim.forcedReturn')}</option>
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.returnTemp')}</span>
                    <NumberInput step="0.5" value={v.temperature ?? initialTemp}
                      onValueChange={(val) => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, temperature: val } : x) }))}
                      className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-1" />
                  </label>
                </>
              )}
            </div>
            );
          })}
          {/* Heat source BCs */}
          {hasHeatSources && room.heatSources.map(h => (
            <div key={h.id} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 space-y-2 border border-red-200 dark:border-red-800">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{h.name}</div>
              <label className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.surfaceTemp')}</span>
                <NumberInput step="0.5" value={h.temperature}
                  onValueChange={(val) => setRoom(prev => ({ ...prev, heatSources: prev.heatSources.map(x => x.id === h.id ? { ...x, temperature: val } : x) }))}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200" />
              </label>
            </div>
          ))}
          {/* 窗户热源 BCs */}
          {hasWindowHeat && windowHeatSources.map(b => (
            <div key={b.id} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 space-y-2 border border-red-200 dark:border-red-800">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{b.name} <span className="text-xs text-gray-400 dark:text-gray-500">{t('sim.windowHeatLabel')}</span></div>
              <label className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.surfaceTemp')}</span>
                <NumberInput step="0.5" value={b.windowTemp ?? 35}
                  onValueChange={(val) => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, windowTemp: val } : x) }))}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200" />
              </label>
            </div>
          ))}
          {/* Device BCs */}
          {hasDevices && room.devices.map(device => {
            // 通用更新助手：按设备 id + 出/回风口索引写回字段
            const patchOutlet = (idx: number, patch: Partial<typeof device.outlets[number]>) =>
              setRoom(prev => ({ ...prev, devices: prev.devices!.map(d => d.id === device.id ? { ...d, outlets: d.outlets.map((o, oidx) => oidx === idx ? { ...o, ...patch } : o) } : d) }));
            const patchOutletVel = (idx: number, vidx: number, val: number) =>
              setRoom(prev => ({ ...prev, devices: prev.devices!.map(d => d.id === device.id ? { ...d, outlets: d.outlets.map((o, oidx) => oidx === idx ? { ...o, velocity: o.velocity.map((v, i) => i === vidx ? val : v) as [number, number, number] } : o) } : d) }));
            const patchInlet = (idx: number, patch: Partial<typeof device.inlets[number]>) =>
              setRoom(prev => ({ ...prev, devices: prev.devices!.map(d => d.id === device.id ? { ...d, inlets: d.inlets.map((i, iidx) => iidx === idx ? { ...i, ...patch } : i) } : d) }));
            const patchInletVel = (idx: number, vidx: number, val: number) =>
              setRoom(prev => ({ ...prev, devices: prev.devices!.map(d => d.id === device.id ? { ...d, inlets: d.inlets.map((i, iidx) => iidx === idx ? { ...i, velocity: i.velocity.map((v, i) => i === vidx ? val : v) as [number, number, number] } : i) } : d) }));
            const patchDevice = (patch: Partial<typeof device>) =>
              setRoom(prev => ({ ...prev, devices: prev.devices!.map(d => d.id === device.id ? { ...d, ...patch } : d) }));
            return (
            <div key={device.id} className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 space-y-2 border border-indigo-200 dark:border-indigo-800">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{device.name}</div>
              {/* 出风口：速度 + 温度 + 扫风（与自定义通风口一致） */}
              {device.outlets.map((outlet, idx) => {
                const sw: SwingSchedule = outlet.swing ?? createDefaultSwing();
                const setSwing = (p: Partial<SwingSchedule>) => patchOutlet(idx, { swing: { ...sw, ...p } });
                const face = deriveFaceFromVelocity(outlet.velocity);
                return (
                <div key={idx} className="bg-white dark:bg-slate-800 rounded p-2 space-y-1.5">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('sim.outletN', { n: idx + 1 })} <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('sim.outletFaceHint', { face: VENT_FACE_LABELS[face] })}</span></div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    {[["Vx'", 0], ["Vy'", 1], ["Vz'", 2]].map(([label, vidx]) => (
                      <label key={label as string}>
                        <span className="text-gray-500 dark:text-gray-400">{label} (m/s)</span>
                        <NumberInput step="0.01" value={outlet.velocity[vidx as number]}
                          onValueChange={(val) => patchOutletVel(idx, vidx as number, val)}
                          className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200" />
                      </label>
                    ))}
                  </div>
                  <label className="block text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.outletTemp')}</span>
                    <NumberInput step="1" value={outlet.temperature}
                      onValueChange={(val) => patchOutlet(idx, { temperature: val })}
                      className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-1" />
                  </label>
                  {/* 扫风：出风方向周期性摆动（与自定义通风口同一套语义） */}
                  <div className="border-t border-gray-200 dark:border-slate-600 pt-2 space-y-1.5 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={sw.enabled} onChange={e => setSwing({ enabled: e.target.checked })} className="accent-blue-500" />
                      <span className="font-medium text-gray-700 dark:text-gray-200">{t('sim.swing')}</span>
                      <span className="text-gray-400 dark:text-gray-500">{t('sim.swingDesc')}</span>
                    </label>
                    {sw.enabled && (
                      <div className="space-y-1.5 pl-5">
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-gray-500 dark:text-gray-400">{t('sim.swingMode')}</span>
                          <select value={sw.mode} onChange={e => setSwing({ mode: e.target.value as 'horizontal' | 'vertical' })}
                            className="bg-gray-100 dark:bg-gray-700 rounded px-1 py-0.5 flex-1">
                            <option value="horizontal">{t('sim.swingH')}</option>
                            <option value="vertical">{t('sim.swingV')}</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-gray-500 dark:text-gray-400">{t('sim.swingHalfAngle')}</span>
                          <NumberInput step="1" value={Math.round(sw.amplitude * 180 / Math.PI)} onValueChange={(num) => setSwing({ amplitude: num * Math.PI / 180 })}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-gray-500 dark:text-gray-400">{t('sim.swingPeriod')}</span>
                          <NumberInput step="0.5" value={sw.period} onValueChange={(num) => setSwing({ period: num })}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              {/* 回风口/进风口：模式 + 速度（强制回流时）+ 温度 */}
              {device.inlets.map((inlet, idx) => {
                const inFace = inlet.mode === 'velocity'
                  ? deriveInflowFace(inlet.velocity ?? [0, 0, 0])
                  : deriveFaceFromSize(inlet.size, [
                      inlet.relativePosition[0] - device.geometry.length / 2,
                      inlet.relativePosition[1] - device.geometry.width / 2,
                      inlet.relativePosition[2] - device.geometry.height / 2,
                    ]);
                return (
                <div key={idx} className="bg-amber-50 dark:bg-amber-900/20 rounded p-2 space-y-1.5">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-300">{t('sim.inletNameFace', { name: inlet.name, face: VENT_FACE_LABELS[inFace] })}</div>
                  <label className="block text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.inletMode')}</span>
                    <select value={inlet.mode} onChange={e => patchInlet(idx, { mode: e.target.value as 'pressure' | 'velocity' })}
                      className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 mt-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200">
                      <option value="pressure">{t('sim.pressureOutletNat')}</option>
                      <option value="velocity">{t('sim.forcedReturn')}</option>
                    </select>
                  </label>
                  {inlet.mode === 'velocity' && (
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      {[["Vx'", 0], ["Vy'", 1], ["Vz'", 2]].map(([label, vidx]) => (
                        <label key={label as string}>
                          <span className="text-gray-500 dark:text-gray-400">{label} (m/s)</span>
                          <NumberInput step="0.01" value={inlet.velocity[vidx as number]}
                            onValueChange={(val) => patchInletVel(idx, vidx as number, val)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200" />
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="block text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.inletTemp')}</span>
                    <NumberInput step="1" value={inlet.temperature}
                      onValueChange={(val) => patchInlet(idx, { temperature: val })}
                      className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-1" />
                  </label>
                </div>
                );
              })}
              {/* 纯热源设备（电视/油汀等无风口的）：表面温度可调 */}
              {device.heatSourceId && device.outlets.length === 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 space-y-1.5 border border-red-200 dark:border-red-800">
                  <div className="text-xs font-medium text-red-700 dark:text-red-300">{t('sim.heatLabel')}</div>
                  <label className="block text-xs">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">{t('sim.surfaceTemp')}</span>
                    <NumberInput step="0.5" value={device.heatTemp ?? 40}
                      onValueChange={(val) => patchDevice({ heatTemp: val })}
                      className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-1" />
                  </label>
                </div>
              )}
            </div>
            );
          })}
          </div>
        </div>
      </SectionPanel>

      {/* ===== 仿真控制（仿真质量 + 运行设置 + 日志） ===== */}
      <SectionPanel sectionId="sim-control" activeSection={activeSection} title={t('section.sim-control')} iconSkeuomorphic="▶️" iconFlat="▸" iconBg="from-green-400 to-teal-500">
        {/* --- 仿真质量 --- */}
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-5 h-5 rounded flex items-center justify-center bg-gradient-to-br from-purple-400 to-pink-500 ${isFlat ? 'text-[9px] font-bold' : 'text-[10px]'} text-white`}>
            {isFlat ? '◎' : '🎯'}
          </span>
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('sim.quality')}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(['low', 'medium', 'high', 'ultra'] as const).map(q => (
            <button key={q} onClick={() => setSimQuality(q)}
              className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${simQuality === q ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'}`}>
              {t('sim.q' + q.charAt(0).toUpperCase() + q.slice(1))}
            </button>
          ))}
        </div>
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3 text-xs space-y-1">
          <p>{t('sim.grid')}<span className="font-bold">{Nx} × {Ny} × {Nz}</span>{t('sim.gridNodes', { n: (gridCells / 1000).toFixed(0) })}</p>
          <p>{t('sim.perStep')}<span className="font-bold">{(dtPhys * 1000).toFixed(3)} ms</span>{t('sim.perStepPhys')}</p>
          <p className="text-gray-500 dark:text-gray-400">
            {simQuality === 'low' && t('sim.descLow')}
            {simQuality === 'medium' && t('sim.descMedium')}
            {simQuality === 'high' && t('sim.descHigh')}
            {simQuality === 'ultra' && t('sim.descUltra')}
          </p>
        </div>

        {/* --- 运行设置 --- */}
        <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-1 space-y-3">
          <div className="flex items-center gap-2">
            <span className={`w-5 h-5 rounded flex items-center justify-center bg-gradient-to-br from-green-400 to-teal-500 ${isFlat ? 'text-[9px] font-bold' : 'text-[10px]'} text-white`}>
              {isFlat ? '▸' : '▶️'}
            </span>
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('sim.runSettings')}</span>
          </div>
          <button onClick={initEngine}
            className={`w-full rounded-lg py-2.5 text-sm font-medium transition-all duration-200 ${engine ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-md hover:shadow-lg' : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:shadow-lg'}`}>
            {engine ? t('sim.reinitEngine', { icon: iconReinit }) : t('sim.initEngine', { icon: iconInit })}
          </button>

          {engine && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-2 text-xs text-green-700 dark:text-green-300">
              {t('sim.engineReady', { type: engineType === 'webgpu' ? 'WebGPU' : 'CPU', gpu: gpuDisplayName })}
            </div>
          )}

          {engine && isLikelyIntegratedGPU && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <div className="font-bold">{t('sim.igpuWarnTitle')}</div>
              <p className="leading-relaxed">{t('sim.igpuWarnBody')}</p>
            </div>
          )}

          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 text-center">
            <p className="text-gray-600 dark:text-gray-400 text-xs">{t('sim.currentStep')}</p>
            <p className="font-bold text-gray-800 dark:text-gray-200 text-xl">{step}</p>
            <p className="text-gray-500 dark:text-gray-500 text-xs">{t('sim.physTime')}<span className="font-bold">{(step * dtPhys).toFixed(3)} s</span></p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setRunMode('steps')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${runMode === 'steps' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'}`}>
              {t('sim.bySteps')}
            </button>
            <button onClick={() => setRunMode('time')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${runMode === 'time' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'}`}>
              {t('sim.byTime')}
            </button>
          </div>

          {runMode === 'steps' ? (
            <>
              <div className="grid grid-cols-5 gap-1">
                {STEP_PRESETS.map(n => (
                  <button key={n} onClick={() => setStepInput(n)}
                    className={`px-1 py-1.5 rounded text-xs font-medium transition-all ${stepInput === n ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300' : 'bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-gray-400'}`}>
                    {n}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">{t('sim.simSteps')}</span>
                <input type="number" step="100" value={stepInput}
                  onChange={e => setStepInput(Math.max(1, +e.target.value))}
                  className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 transition-all" />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">{t('sim.physTimeSec')}</span>
              <input type="number" step="0.5" value={timeInput}
                onChange={e => setTimeInput(Math.max(0.001, +e.target.value))}
                className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 transition-all" />
              <span className="text-xs text-gray-400 mt-1 block">{t('sim.approxFoot', { n: stepsForTime })}</span>
            </label>
          )}

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-400">{t('sim.runStepsLabel')}</span> <span className="font-bold text-gray-800 dark:text-gray-200">{stepsToRun}</span></div>
            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-400">{t('sim.physTimeLabel')}</span> <span className="font-bold text-gray-800 dark:text-gray-200">{(stepsToRun * dtPhys).toFixed(2)} s</span></div>
            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-400">{t('sim.estTime')}</span> <span className="font-bold text-amber-700 dark:text-amber-300">{formatTime(estimatedTimeMs)}</span></div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleRun} disabled={!engine || running}
              className="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg py-2.5 text-sm font-medium hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              {running ? t('sim.runPause') : t('sim.runStart', { icon: iconRun })}
            </button>
            <button onClick={stopSimulation} disabled={!running}
              className="bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-lg py-2.5 text-sm font-medium hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              {t('sim.stop', { icon: iconStop })}
            </button>
          </div>
        </div>

        {/* --- 日志 --- */}
        <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-1">
          <div className="flex items-center gap-2">
            <span className={`w-5 h-5 rounded flex items-center justify-center bg-gradient-to-br from-gray-400 to-slate-500 ${isFlat ? 'text-[9px] font-bold' : 'text-[10px]'} text-white`}>
              {isFlat ? '≡' : '📋'}
            </span>
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('sim.log')}</span>
          </div>
          <div className="bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-700 rounded-lg p-3 max-h-60 overflow-y-auto font-mono text-xs">
            {log.map((msg, i) => <div key={i}>{msg}</div>)}
            {log.length === 0 && <div className="text-gray-400 dark:text-gray-500 text-center py-6">{isFlat ? '—' : '💤'} {t('sim.logWait')}</div>}
          </div>
        </div>
      </SectionPanel>
    </div>
  );
}
