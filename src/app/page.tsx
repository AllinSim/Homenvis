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

import { useState, useEffect, useCallback, useRef } from 'react';
import { createDefaultRoom, roomToLBMConfig, isWallLike, type RoomLayout, type DeviceInstance, genId } from '@/lib/room-layout';
import { createEngine, LBMEngineGPU, LBMEngineCPU, type EngineType, type GPUDeviceInfo, type LBMParams } from '@/lib/lbm-engine';
import { type DeviceModel } from '@/lib/device-library';
import { setSimResults, clearSimResults, clearPhysicsParams, getSimVersion, setPhysicsParams, type PhysicsParams } from '@/lib/simulation-store';
import { estimateSimTime } from '@/lib/gpu-benchmark';
import { SettingsProvider, useSettings } from '@/lib/settings-context';
import { IconStyleProvider } from '@/lib/icon-style-context';
import { I18nProvider, useI18n } from '@/lib/i18n-context';

import TopBar from '@/components/TopBar';
import SideNav, { type TabId, getViewerMode } from '@/components/SideNav';
import SectionNav, { getSectionsForTab } from '@/components/SectionNav';
import StatusBar from '@/components/StatusBar';
import MainViewer from '@/components/MainViewer';
import ModelingPanel from '@/components/ModelingPanel';
import SimulationStepPanel from '@/components/SimulationStepPanel';
import ResultsPanel from '@/components/ResultsPanel';
import SettingsModal from '@/components/SettingsModal';
import ProgressModal from '@/components/ProgressModal';
import WelcomeModal from '@/components/WelcomeModal';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import { useSimResultsSummary } from '@/hooks/useSimResultsSummary';

// 网格分辨率预设：按"总网格量"为目标，各向同性铺格。
// 关键：必须保持 dx = length/Nx = width/Ny = height/Nz（各向同性），否则引擎把房间
// 当作 Nx·dx × Ny·dx × Nz·dx 的各向异性空间栅格化，与按物理坐标渲染的几何(墙/风口/
// 热源)错位——这正是从样板间导入非正方形房间时"几何与流场对不上"的根因。
// 给定各向同性 dx，总格数 N = (L/dx)(W/dx)(H/dx) = L·W·H / dx^3 = V/dx^3，
// 故 dx = (V / N)^(1/3)，再各轴四舍五入即可。
const GRID_TARGETS = {
  low:    500_000,   // ~50 万
  medium: 1_000_000, // ~100 万
  high:   3_000_000, // ~300 万
  ultra:  6_000_000, // ~600 万
} as const;

type SimQuality = 'low' | 'medium' | 'high' | 'ultra';

/**
 * 按房间尺寸与目标总网格数推算各向同性网格 Nx/Ny/Nz，保证三轴 dx 相等。
 * 由 V/dx^3 = N 反解 dx = (V/N)^(1/3)，再各轴 round；同时保证最小 4 格。
 */
function deriveIsotropicGrid(length: number, width: number, height: number, targetTotal: number) {
  const volume = Math.max(length, 0) * Math.max(width, 0) * Math.max(height, 0);
  const dx = volume > 0 && targetTotal > 0
    ? Math.cbrt(volume / targetTotal)
    : Math.max(length, width, height) / 60;
  const Nx = Math.max(4, Math.round(length / dx));
  const Ny = Math.max(4, Math.round(width / dx));
  const Nz = Math.max(4, Math.round(height / dx));
  return { Nx, Ny, Nz };
}

function HomeInner() {
  const { apiBase, apiKey, apiModel } = useSettings();
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('modeling');
  const [room, setRoom] = useState<RoomLayout>(createDefaultRoom());

  // activeSection: which section is expanded in the detail panel
  const [activeSection, setActiveSection] = useState('ai-design');

  const [resultsVersion, setResultsVersion] = useState(getSimVersion());
  const [engine, setEngine] = useState<LBMEngineGPU | LBMEngineCPU | null>(null);
  const [engineType, setEngineType] = useState<EngineType | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GPUDeviceInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [simStep, setSimStep] = useState(0);

  // 进度弹窗状态
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressElapsedMs, setProgressElapsedMs] = useState(0);
  const progressStartRef = useRef(0);
  // 中止标志：chunked 运行循环每次 chunk 检查此 ref
  const stopRequestedRef = useRef(false);

  const [log, setLog] = useState<string[]>([]);
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [initialTemp, setInitialTemp] = useState(25);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 欢迎信息弹窗：浏览器兼容性 + 本地资源说明（首屏显示）
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [simQuality, setSimQuality] = useState<SimQuality>('high');
  // Grid override: when importing a simulation result with a non-preset grid size,
  // we store the exact Nx/Ny/Nz here so the viewer & engine use the imported grid.
  const [gridOverride, setGridOverride] = useState<{ Nx: number; Ny: number; Nz: number } | null>(null);
  // 各向同性网格：按房间尺寸 + 质量目标推算；导入仿真结果时用 gridOverride 精确还原。
  const { Nx, Ny, Nz } = gridOverride ?? deriveIsotropicGrid(room.length, room.width, room.height, GRID_TARGETS[simQuality]);

  const airProps = { density: 1.2, kinematicViscosity: 1.5e-5, thermalDiffusivity: 2.0e-5 };

  const addLog = (msg: string) => setLog(prev => [...prev.slice(-50), msg]);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.gpu) { setWebgpuSupported(true); } else { setWebgpuSupported(false); }
  }, []);

  // 首屏弹出欢迎信息（浏览器兼容性 + 本地资源说明）
  // 等 WebGPU 检测完成后再打开，以便显示准确的计算后端
  useEffect(() => {
    if (webgpuSupported !== null && !welcomeOpen) {
      setWelcomeOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgpuSupported]);

  // When tab changes, reset activeSection to the first section of the new tab
  useEffect(() => {
    const sections = getSectionsForTab(tab);
    if (sections.length > 0 && !sections.find(s => s.id === activeSection)) {
      setActiveSection(sections[0].id);
    }
  }, [tab]);

  // When simQuality changes, destroy old engine and clear any imported grid override
  useEffect(() => {
    if (engine) {
      engine.destroy();
      setEngine(null);
      setEngineType(null);
      setGpuInfo(null);
      setSimStep(0);
      const v = clearSimResults(); clearPhysicsParams(); setResultsVersion(v);
      addLog(t('log.qualityChange'));
    }
    setGridOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simQuality, t]);

  // 初始化引擎
  const handleInitEngine = useCallback(async () => {
    try {
      if (engine) { engine.destroy(); setEngine(null); setEngineType(null); setGpuInfo(null); addLog(t('log.destroyOld')); }
      addLog(t('log.initEngine'));
      const { engine: eng, type, gpuInfo: info } = await createEngine();
      setGpuInfo(info ?? null);
      if (info && (info.device || info.description)) { addLog(t('log.useWebgpu', { type: type === 'webgpu' ? 'WebGPU' : 'CPU', name: info.device || info.description })); } else { addLog(t('log.useWebgpuAccel', { type: type === 'webgpu' ? 'WebGPU (GPU加速)' : 'CPU' })); }

      const config = roomToLBMConfig(room);
      const T_min = initialTemp - 10;
      const T_max = initialTemp + 10;
      const dx = room.length / Nx;
      const tau = 0.55; const omega = 1.0 / tau; const nu_lattice = (tau - 0.5) / 3;
      const u_char = 0.05; const Re_lattice = u_char * Nx / nu_lattice;
      const MAX_LATTICE_SPEED = 0.15;
      // ---- Physical scales: dt_phys from the STRICTER of two stability constraints ----
      // Boussinesq lattice gravity (pure physical conversion, NOT a tunable knob):
      //   g_lat = g·β·ΔT_span·dt_phys² / dx        (multiplies dimensionless T - T_ref)
      // ΔT_span = (T_max - T_min) is the physical temperature span the dimensionless T∈[0,1]
      // represents (the color range). g_lat is fully determined once dt_phys is fixed.
      //
      // dt_phys (= dx/u_scale) is bounded by TWO independent physics constraints; we take
      // the smaller dt (stricter) so NEITHER is violated:
      //   (A) Forced convection: max inlet lattice vel U_in/u_scale ≤ U_LAT_CAP
      //       → dt ≤ dx·U_LAT_CAP / U_in_max
      //   (B) Buoyancy: full-ΔT buoyancy vel √(g_lat·(ΔT_max/dT_span)·Nz) ≤ U_BUOY_MAX
      //       = √(g·β·ΔT_max·dt²·Nz/dx) ≤ U_BUOY_MAX → dt ≤ U_BUOY_MAX·√(dx/(g·β·ΔT_max·Nz))
      // With weak inlets (A) is loose → buoyancy sets dt (natural-convection-dominated, correct).
      // With strong inlets (A) tightens → dt shrinks, u_scale grows, buoyancy/inlet ratio drops
      // (forced-convection-dominated, correct). This is why raising inlet speed now actually
      // overcomes buoyancy instead of being silently clamped.
      const G = 9.81;
      const T_ref_phys = initialTemp + 273.15;            // K, ideal-gas thermal expansion β
      const beta = 1.0 / T_ref_phys;                      // β ≈ 1/T (K⁻¹)
      const dT_span = Math.max(T_max - T_min, 1e-3);      // K per unit dimensionless ΔT (color range)
      // Real max |T_source - T_room| and max inlet speed from the actual room contents.
      let dT_max = 1.0;                                    // fallback 1 K if no thermal source
      let U_in_max = 1e-3;                                 // fallback so (A) doesn't divide by zero
      for (const item of config.items) {
        if (item.temperature !== undefined && Number.isFinite(item.temperature)) {
          dT_max = Math.max(dT_max, Math.abs(item.temperature - initialTemp));
        }
        if (item.velocity) {
          const sp = Math.sqrt(item.velocity[0]**2 + item.velocity[1]**2 + item.velocity[2]**2);
          if (sp > U_in_max) U_in_max = sp;
        }
      }
      const CS = 1.0 / Math.sqrt(3.0);
      const U_BUOY_MAX = 0.4 * CS;                         // safe buoyancy velocity at ΔT_max
      const U_LAT_CAP = 0.1;                               // safe max inlet lattice velocity
      const dt_buoy = U_BUOY_MAX * Math.sqrt(dx / (G * beta * dT_max * Nz));
      const dt_forced = dx * U_LAT_CAP / U_in_max;
      const dt_phys = Math.min(dt_buoy, dt_forced);
      const u_scale = dx / dt_phys;                        // physical m/s per lattice velocity unit
      const g_lat = G * beta * dT_span * dt_phys * dt_phys / dx;  // determined by physics, not tuned
      const alphaT = nu_lattice / 0.71;
      const T_ref = (initialTemp - T_min) / (T_max - T_min); // normalized reference temp
      const lbmParams: LBMParams = { omega, alphaT, tau, u_char, u_scale, dx, dt_phys, Re_lattice, g_lat, T_ref };
      config.lbmParams = lbmParams;
      addLog(t('log.lbmParams', { tau: tau.toFixed(3), omega: omega.toFixed(3), re: Re_lattice.toFixed(0) }));
      addLog(t('log.scaleParams', { us: u_scale.toFixed(3), dt: (dt_phys*1000).toFixed(3), g: g_lat.toExponential(2) }));


      config.items = config.items.map(item => {
        const newItem = { ...item };
        if ((item.type === 'heat_source' || item.type === 'vent_inlet' || item.type === 'vent_outlet') && item.temperature !== undefined) { newItem.temperature = (item.temperature - T_min) / (T_max - T_min); }
        if (item.type === 'vent_inlet' && item.velocity) {
          const latticeVel = item.velocity.map((v: number) => v / u_scale) as [number, number, number];
          const latticeSpeed = Math.sqrt(latticeVel[0]**2 + latticeVel[1]**2 + latticeVel[2]**2);
          if (latticeSpeed > MAX_LATTICE_SPEED) { const scale = MAX_LATTICE_SPEED / latticeSpeed; newItem.velocity = latticeVel.map(v => v * scale) as [number, number, number]; } else { newItem.velocity = latticeVel; }
        }
        return newItem;
      });

      setPhysicsParams({ u_scale, dx, dt_phys, T_min, T_max, rho_phys: airProps.density, tau, omega, alphaT, u_char, Re_lattice, g_lat, T_ref });
      await eng.setup(config, Nx, Ny, Nz);
      setEngine(eng); setEngineType(type); setSimStep(0);
      const v = clearSimResults(); setResultsVersion(v);
      addLog(t('log.engineReady', { nx: Nx, ny: Ny, nz: Nz, nodes: (Nx*Ny*Nz/1000).toFixed(0) }));
    } catch (err: any) { addLog(t('log.engineFail', { msg: err.message })); }
  }, [engine, room, Nx, Ny, Nz, initialTemp, airProps, t]);

  // 运行步骤（分块 + 进度反馈，避免长时间计算阻塞主线程导致页面卡死）
  const handleRunSteps = useCallback(async (n: number) => {
    if (!engine) { addLog(t('log.engineNotInit')); return; }
    if (running) return; // 防止重复触发

    setRunning(true);
    stopRequestedRef.current = false;
    const startStep = simStep; // 本次运行前的步数，用于中止日志统计
    addLog(t('log.runStart', { n }));

    // 打开进度弹窗并初始化进度
    setProgressDone(0);
    setProgressTotal(n);
    setProgressElapsedMs(0);
    progressStartRef.current = performance.now();
    setProgressOpen(true);

    // 分块大小：GPU 每步很快，用较大块减少 await 开销；CPU 每步慢，用小块更频繁反馈。
    // 同时根据总步数自适应，保证至少 ~20 个反馈点且单块不超过约 200ms(CPU) 体验。
    const isCPU = engineType === 'cpu';
    let chunkSize: number;
    if (isCPU) {
      chunkSize = Math.max(5, Math.min(50, Math.ceil(n / 40)));
    } else {
      chunkSize = Math.max(50, Math.min(500, Math.ceil(n / 30)));
    }

    // 用一个节流计时器限制 React 状态更新频率（避免每个 chunk 都 setState 撑爆渲染）
    let lastUiUpdate = 0;
    const UI_UPDATE_INTERVAL = 100; // ms

    try {
      await engine.step_n_chunked(n, chunkSize, (done, total) => {
        const now = performance.now();
        if (now - lastUiUpdate >= UI_UPDATE_INTERVAL || done >= total) {
          lastUiUpdate = now;
          setProgressDone(done);
          setProgressTotal(total);
          setProgressElapsedMs(now - progressStartRef.current);
        }
        if (stopRequestedRef.current) {
          // 抛出一个特殊错误以中断 chunked 循环（在引擎内部 while 循环外捕获）
          throw new Error('__STOP_REQUESTED__');
        }
      });

      // 完成：取出最终结果
      const res = await engine.getResults();
      const v = setSimResults(res); setResultsVersion(v); setSimStep(res.step);
      const elapsed = performance.now() - progressStartRef.current;
      setProgressDone(n); setProgressElapsedMs(elapsed);
      addLog(t('log.runDone', { n, ms: elapsed.toFixed(0) }));
    } catch (err: any) {
      if (err?.message === '__STOP_REQUESTED__') {
        const elapsed = performance.now() - progressStartRef.current;
        // 中止：仍取出当前已完成的结果供查看
        try {
          const res = await engine.getResults();
          const v = setSimResults(res); setResultsVersion(v); setSimStep(res.step);
          addLog(t('log.aborted', { n: res.step - startStep, ms: elapsed.toFixed(0) }));
        } catch {
          addLog(t('log.abortedNoRes', { ms: elapsed.toFixed(0) }));
        }
        // 中止后把 total 置为已完成步数，弹窗切换为"完成"态以便用户关闭并查看结果
        setProgressTotal(progressDone);
      } else {
        addLog(t('log.runFail', { msg: err.message }));
        // 出错：直接关闭进度弹窗
        setProgressOpen(false);
      }
    } finally {
      setRunning(false);
      stopRequestedRef.current = false;
    }
  }, [engine, running, engineType, simStep, progressTotal, t]);

  // 中止当前计算（设置标志，chunked 循环在下一个 chunk 边界退出）
  const handleStop = useCallback(() => {
    stopRequestedRef.current = true;
    addLog(t('log.stopping'));
  }, [t]);
  const handleCloseProgress = useCallback(() => {
    setProgressOpen(false);
  }, []);
  const handleReset = useCallback(() => { setRunning(false); stopRequestedRef.current = true; setSimStep(0); const v = clearSimResults(); clearPhysicsParams(); setResultsVersion(v); setProgressOpen(false); if (engine) { engine.destroy(); setEngine(null); setEngineType(null); setGpuInfo(null); } addLog(t('log.reset')); }, [engine, t]);

  // 载入样板间预设布局：覆盖当前房间并销毁已建引擎（网格/边界需按新布局重建）。
  const handleLoadSample = useCallback((newRoom: RoomLayout) => {
    setRoom(newRoom);
    setRunning(false);
    stopRequestedRef.current = true;
    setSimStep(0);
    const v = clearSimResults(); clearPhysicsParams(); setResultsVersion(v);
    setProgressOpen(false);
    if (engine) { engine.destroy(); setEngine(null); setEngineType(null); setGpuInfo(null); }
    setTab('modeling');
    addLog(t('log.loadSample', { l: newRoom.length, w: newRoom.width, h: newRoom.height, boxes: newRoom.boxes.length, vents: newRoom.vents.length, heat: newRoom.heatSources.length }));
  }, [engine, t]);

  // AI Analysis hook
  const { aiLoading, handleAI, aiMessages, clearMessages } = useAIAnalysis({ addLog, onLayoutGenerated: setRoom, apiBase, apiKey, apiModel });

  const resultsSummary = useSimResultsSummary(resultsVersion);

  const estimatedGpuName = (gpuInfo?.device || gpuInfo?.description)
    ? estimateSimTime(Nx * Ny * Nz, 1, gpuInfo?.device || gpuInfo?.description || '', engineType === 'cpu').gpuName : '';

  // Physical time per step
  const dtPhys = (() => {
    const dx = room.length / Nx; let U_max_phys = 0.1;
    for (const v of room.vents) { if (v.velocity) { const speed = Math.sqrt(v.velocity[0]**2 + v.velocity[1]**2 + v.velocity[2]**2); if (speed > U_max_phys) U_max_phys = speed; } }
    for (const d of room.devices) { for (const o of d.outlets) { const speed = Math.sqrt(o.velocity[0]**2 + o.velocity[1]**2 + o.velocity[2]**2); if (speed > U_max_phys) U_max_phys = speed; } }
    U_max_phys *= 1.2; const u_scale = U_max_phys / 0.1; return dx / u_scale;
  })();

  const physicalTime = simStep * dtPhys;

  const maxPhysSpeed = (() => {
    const dx = room.length / Nx; let U_max_phys = 0.1;
    for (const v of room.vents) { if (v.velocity) { const speed = Math.sqrt(v.velocity[0]**2 + v.velocity[1]**2 + v.velocity[2]**2); if (speed > U_max_phys) U_max_phys = speed; } }
    for (const d of room.devices) { for (const o of d.outlets) { const speed = Math.sqrt(o.velocity[0]**2 + o.velocity[1]**2 + o.velocity[2]**2); if (speed > U_max_phys) U_max_phys = speed; } }
    U_max_phys *= 1.2; return 0.15 * (U_max_phys / 0.1);
  })();

  // Add device from library
  const addDeviceFromLibrary = (device: DeviceModel, modeIndex: number) => {
    const mode = device.modes[modeIndex];
    const deviceInstanceId = genId();
    const placement = { x: room.length / 2, y: room.width / 2, z: 0 };
    const deviceInstance: DeviceInstance = {
      id: deviceInstanceId, deviceId: device.id, name: `${device.name}`,
      brand: device.brand, category: device.category,
      position: placement, geometry: device.geometry, modeIndex,
      bodyParts: device.bodyParts?.map(p => ({ ...p })),
      outlets: device.outlets.map(outlet => ({
        id: genId(), name: outlet.name, relativePosition: outlet.position, size: outlet.size,
        velocity: [outlet.defaultVelocity[0] * (mode.outletVelocity / 0.08), outlet.defaultVelocity[1] * (mode.outletVelocity / 0.08), outlet.defaultVelocity[2] * (mode.outletVelocity / 0.08)],
        temperature: mode.outletTemp,
      })),
      inlets: device.inlets.map(inlet => {
        const inletMode = mode.inletMode || inlet.mode;
        return {
          id: genId(), name: inlet.name, relativePosition: inlet.position, size: inlet.size,
          mode: inletMode,
          velocity: inletMode === 'velocity' && inlet.defaultVelocity ? [
            inlet.defaultVelocity[0] * ((mode.inletVelocity || 0.05) / 0.05),
            inlet.defaultVelocity[1] * ((mode.inletVelocity || 0.05) / 0.05),
            inlet.defaultVelocity[2] * ((mode.inletVelocity || 0.05) / 0.05),
          ] : [0, 0, 0],
          temperature: initialTemp,
        };
      }),
      heatSourceId: device.emitsHeat && device.outlets.length === 0 ? genId() : undefined,
      heatTemp: device.emitsHeat && device.outlets.length === 0 ? mode.outletTemp : undefined,
      color: device.category === 'air_conditioner' ? '#60a5fa'
        : device.category === 'heater' ? '#f87171'
        : device.category === 'tv' ? '#1e293b'
        : device.category === 'range_hood' ? '#64748b'
        : device.category === 'exhaust_fan' ? '#94a3b8'
        : device.category === 'air_purifier' ? '#34d399'
        : '#94a3b8',
    };
    setRoom(prev => ({ ...prev, devices: [...prev.devices, deviceInstance] }));
    addLog(t('log.addDevice', { name: device.name, mode: mode.name }));
  };

  const viewerMode = getViewerMode(tab);

  // ===== 导入：布局结果 / 仿真结果 =====
  const handleImportLayout = useCallback((data: any, fileName: string) => {
    try {
      if (!data || data.type !== 'layout' || !data.room) {
        throw new Error(t('log.badFile'));
      }
      // 基本字段校验，补全缺失字段以容错旧文件
      const r = data.room;
      const restored: RoomLayout = {
        length: Number(r.length) || 5,
        width: Number(r.width) || 5,
        height: Number(r.height) || 2.5,
        boxes: Array.isArray(r.boxes) ? r.boxes : [],
        vents: Array.isArray(r.vents) ? r.vents : [],
        heatSources: Array.isArray(r.heatSources) ? r.heatSources : [],
        devices: Array.isArray(r.devices) ? r.devices : [],
      };
      setRoom(restored);
      addLog(t('log.importLayout', { name: fileName, boxes: restored.boxes.length, vents: restored.vents.length, devices: restored.devices.length }));
      return true;
    } catch (err: any) {
      addLog(t('log.badFile') + ': ' + err.message);
      alert(t('log.badFile') + ': ' + err.message);
      return false;
    }
  }, [t]);

  const handleImportSimulation = useCallback((data: any, fileName: string) => {
    try {
      if (!data || data.type !== 'simulation' || !data.simulationResults) {
        throw new Error(t('log.badSimFile'));
      }
      const sim = data.simulationResults;
      const rho = sim.rho, ux = sim.ux, uy = sim.uy, uz = sim.uz, T = sim.T;
      if (!ux || !uy || !uz || !T) {
        throw new Error(t('log.incompleteSim'));
      }
      // 推断网格尺寸（以速度场长度为准）
      const total = ux.length;
      // 尝试从物理参数或网格尺寸字段恢复 Nx/Ny/Nz
      let iNx = data.Nx, iNy = data.Ny, iNz = data.Nz;
      if (!iNx || !iNy || !iNz) {
        // 反推：优先用保存时的房间长度比；否则用立方根近似
        const r: RoomLayout = data.room;
        if (r && r.length && r.width && r.height) {
          const ratio = r.length * r.width * r.height;
          const k = Math.cbrt(total / ratio);
          iNx = Math.round(r.length * k);
          iNy = Math.round(r.width * k);
          iNz = Math.round(r.height * k);
        } else {
          iNz = Math.round(Math.cbrt(total / 4));
          iNx = iNy = Math.round(Math.sqrt(total / iNz));
        }
      }
      if (iNx * iNy * iNz !== total) {
        addLog(t('log.gridMismatch', { nx: iNx, ny: iNy, nz: iNz, total: iNx*iNy*iNz, len: total }));
      }

      // 恢复房间布局
      if (data.room) {
        const r = data.room;
        setRoom({
          length: Number(r.length) || 5,
          width: Number(r.width) || 5,
          height: Number(r.height) || 2.5,
          boxes: Array.isArray(r.boxes) ? r.boxes : [],
          vents: Array.isArray(r.vents) ? r.vents : [],
          heatSources: Array.isArray(r.heatSources) ? r.heatSources : [],
          devices: Array.isArray(r.devices) ? r.devices : [],
        });
      }

      // 恢复初始温度
      if (typeof data.initialTemp === 'number') setInitialTemp(data.initialTemp);

      // 恢复物理参数
      if (data.physicsParams) {
        setPhysicsParams(data.physicsParams as PhysicsParams);
      }

      // 销毁当前引擎（导入结果直接以场数据展示，无需活动引擎）
      if (engine) { engine.destroy(); setEngine(null); setEngineType(null); setGpuInfo(null); }

      // 写入场数据到全局 store
      const res = {
        rho: rho ? Float32Array.from(rho) : new Float32Array(total),
        ux: Float32Array.from(ux),
        uy: Float32Array.from(uy),
        uz: Float32Array.from(uz),
        T: Float32Array.from(T),
        step: Number(sim.step) || 0,
      };
      const v = setSimResults(res);
      setResultsVersion(v);
      setSimStep(res.step);

      // 应用网格覆盖，让 viewer 使用导入的网格
      setGridOverride({ Nx: iNx, Ny: iNy, Nz: iNz });

      addLog(t('log.importSim', { name: fileName, nx: iNx, ny: iNy, nz: iNz, step: res.step }));
      addLog(t('log.importSimHint'));
      return true;
    } catch (err: any) {
      addLog(t('log.badSimFile') + ': ' + err.message);
      alert(t('log.badSimFile') + ': ' + err.message);
      return false;
    }
  }, [engine, t]);

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.type === 'layout') {
          if (handleImportLayout(data, file.name)) setTab('modeling');
        } else if (data.type === 'simulation') {
          if (handleImportSimulation(data, file.name)) setTab('analysis');
        } else {
          alert(t('topbar.unrecognizedFile'));
        }
      } catch (err: any) {
        alert(t('topbar.parseFail', { msg: err.message }));
      }
    };
    reader.onerror = () => alert(t('topbar.readFail'));
    reader.readAsText(file);
  }, [handleImportLayout, handleImportSimulation, t]);

  // Dynamic badges for SectionNav
  const sectionBadges: Record<string, string> = {
    'walls': t('common.count', { n: room.boxes.filter(isWallLike).length }),
    'devices': t('common.count', { n: room.devices.length }),
    'furniture': t('common.count', { n: room.boxes.filter(b => !isWallLike(b)).length }),
    'vents': t('common.count', { n: room.vents.length }),
    'heat-sources': t('common.count', { n: room.heatSources.length }),
    'sim-conditions': t('common.group', { n: [room.vents, room.heatSources, room.devices].filter(a => a.length > 0).length }),
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <TopBar projectName={t('topbar.projectName')} room={room} onOpenSettings={() => setSettingsOpen(true)} onImportFile={handleImportFile} onLoadSample={handleLoadSample} />

      <div className="flex flex-1 overflow-hidden">
        {/* Column 1: Icon navigation */}
        <SideNav activeTab={tab} onTabChange={setTab} />

        {/* Column 2: Section list */}
        <SectionNav activeTab={tab} activeSection={activeSection} onSectionChange={setActiveSection} badges={sectionBadges} />

        {/* Column 3: Detail panel — shows only the active section content */}
        <aside className="w-80 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col shadow-sm">
          {tab === 'modeling' && (
            <ModelingPanel
              room={room} setRoom={setRoom}
              aiLoading={aiLoading} handleAI={handleAI}
              aiMessages={aiMessages} onClearAiMessages={clearMessages}
              onAddDevice={addDeviceFromLibrary}
              activeSection={activeSection}
            />
          )}
          {tab === 'simulation' && (
            <SimulationStepPanel
              room={room} setRoom={setRoom}
              initialTemp={initialTemp} setInitialTemp={setInitialTemp}
              simQuality={simQuality} setSimQuality={setSimQuality}
              engine={engine} engineType={engineType} gpuInfo={gpuInfo}
              running={running} step={simStep}
              log={log}
              Nx={Nx} Ny={Ny} Nz={Nz}
              dtPhys={dtPhys} estimatedGpuName={estimatedGpuName} maxPhysSpeed={maxPhysSpeed}
              initEngine={handleInitEngine}
              runSteps={handleRunSteps}
              stopSimulation={handleStop}
              resetEngine={handleReset}
              activeSection={activeSection}
            />
          )}
          {tab === 'analysis' && (
            <ResultsPanel summary={resultsSummary} activeSection={activeSection} />
          )}
        </aside>

        {/* Column 4: Main 3D viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-6 overflow-hidden">
            <MainViewer tab={viewerMode} room={room} setRoom={setRoom} resultsVersion={resultsVersion} isMounted={isMounted} Nx={Nx} Ny={Ny} Nz={Nz} showVentArrows={viewerMode === 'simulation' && activeSection === 'sim-conditions'} />
          </div>
          <StatusBar
            step={simStep} physicalTime={physicalTime}
            webgpuSupported={webgpuSupported ?? false}
            engineType={engineType === 'webgpu' ? 'gpu' : engineType === 'cpu' ? 'cpu' : null}
          />
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 首屏欢迎信息弹窗：浏览器兼容性 + 本地计算资源说明 */}
      <WelcomeModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} webgpuSupported={webgpuSupported} />

      {/* 仿真计算进度弹窗 */}
      <ProgressModal
        open={progressOpen}
        done={progressDone}
        total={progressTotal}
        elapsedMs={progressElapsedMs}
        engineLabel={engineType === 'webgpu' ? 'WebGPU 加速' : engineType === 'cpu' ? 'CPU' : undefined}
        canStop={running}
        onStop={handleStop}
        onClose={handleCloseProgress}
      />
    </div>
  );
}

export default function Home() {
  return (
    <SettingsProvider>
      <IconStyleProvider>
        <I18nProvider>
          <HomeInner />
        </I18nProvider>
      </IconStyleProvider>
    </SettingsProvider>
  );
}
