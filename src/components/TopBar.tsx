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

import { useState, useRef, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { useTheme } from '@/lib/theme-context';
import { useIconStyle } from '@/lib/icon-style-context';
import { useI18n } from '@/lib/i18n-context';
import Modal from '@/components/Modal';
import { getSimResults, getPhysicsParams } from '@/lib/simulation-store';
import { type RoomLayout } from '@/lib/room-layout';
import { SAMPLE_ROOMS, SAMPLE_CATEGORY_LABELS, type SampleRoom } from '@/lib/sample-rooms';
import LayoutThumbnail from '@/components/LayoutThumbnail';

interface TopBarProps {
  projectName: string;
  room: RoomLayout;
  onOpenSettings: () => void;
  onImportFile: (file: File) => void;
  onLoadSample: (room: RoomLayout) => void;
}

function appendArrayStream(parts: string[], values: Float32Array, chunkSize = 50_000) {
  parts.push('[');
  for (let start = 0; start < values.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, values.length);
    const chunk: number[] = new Array(end - start);
    for (let i = start; i < end; i++) chunk[i - start] = values[i];
    const json = JSON.stringify(chunk);
    parts.push(start === 0 ? json.slice(1, -1) : ',' + json.slice(1, -1));
  }
  parts.push(']');
}

export default function TopBar({ projectName, room, onOpenSettings, onImportFile, onLoadSample }: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const { iconStyle, setIconStyle } = useIconStyle();
  const { t, lang, setLang } = useI18n();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [sampleSearch, setSampleSearch] = useState('');
  const [sampleCat, setSampleCat] = useState<SampleRoom['category'] | 'all'>('all');
  const [sampleTag, setSampleTag] = useState<string | null>(null);
  const [samplePage, setSamplePage] = useState(0);
  const SAMPLES_PER_PAGE = 3;
  const [iconStyleMenuOpen, setIconStyleMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 'layout' | 'simulation' — which kind the hidden file picker should load next
  const pendingImportType = useRef<'layout' | 'simulation'>('layout');

  // Icon mapping based on style.
  // 拟物化用 emoji；扁平化用统一的几何符号，便于跨平台一致。
  const icons = {
    save:    iconStyle === 'skeuomorphic' ? '💾' : '⬇',
    import:  iconStyle === 'skeuomorphic' ? '📂' : '⬆',
    samples: iconStyle === 'skeuomorphic' ? '🏘️' : '▣',
    about:   iconStyle === 'skeuomorphic' ? 'ℹ️' : 'ⓘ',
    contact: iconStyle === 'skeuomorphic' ? '✉️' : '✉',
    support: iconStyle === 'skeuomorphic' ? '❤️' : '♥',
    themeIcon: theme === 'light'
      ? (iconStyle === 'skeuomorphic' ? '🌙' : '◐')
      : (iconStyle === 'skeuomorphic' ? '☀️' : '◑'),
    language: iconStyle === 'skeuomorphic' ? '🌐' : '文',
    settings: iconStyle === 'skeuomorphic' ? '⚙️' : '⚙',
  };

  // 统一的功能按钮图标容器：固定 20×20，让 emoji/符号视觉重量一致、与右侧 w-9 图标对齐。
  const IconBox = ({ children }: { children: React.ReactNode }) => (
    <span className={`inline-flex w-5 h-5 items-center justify-center ${iconStyle === 'flat' ? 'text-sm font-bold' : 'text-base'} leading-none`}>
      {children}
    </span>
  );

  // 保存布局结果
  const handleSaveLayout = () => {
    const exportData = {
      version: '1.0',
      type: 'layout',
      exportTime: new Date().toISOString(),
      room: room,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lbm-layout-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSaveOpen(false);
  };

  // 保存仿真结果
  const handleSaveSimulation = () => {
    const results = getSimResults();
    const physics = getPhysicsParams();

    if (!results) {
      alert(t('topbar.noSimResult'));
      setSaveOpen(false);
      return;
    }

    const Nx = physics && physics.dx ? Math.round(room.length / physics.dx) : undefined;
    const Ny = physics && physics.dx ? Math.round(room.width / physics.dx) : undefined;
    const Nz = physics && physics.dx ? Math.round(room.height / physics.dx) : undefined;
    const initialTemp = physics && physics.T_min !== undefined && physics.T_max !== undefined
      ? (physics.T_min + physics.T_max) / 2 : undefined;

    // 仿真场数据为 5 个全场 Float32Array，规模可达数千万格。一次性 JSON.stringify
    // 会生成超出 JS 字符串长度上限(~512MB)的字符串，抛 "Invalid string length"。
    // 改为流式拼装：头部/尾用 JSON.stringify(小对象)，5 个大数组按分块序列化后
    // 逐块推入 Blob parts，Blob 不受单字符串长度限制。
    const parts: string[] = [];
    parts.push(`{
  "version": "1.0",
  "type": "simulation",
  "exportTime": ${JSON.stringify(new Date().toISOString())},
  "room": ${JSON.stringify(room, null, 2)},
  "physicsParams": ${JSON.stringify(physics, null, 2)},
  "Nx": ${JSON.stringify(Nx ?? null)},
  "Ny": ${JSON.stringify(Ny ?? null)},
  "Nz": ${JSON.stringify(Nz ?? null)},
  "initialTemp": ${JSON.stringify(initialTemp ?? null)},
  "simulationResults": {
    "step": ${JSON.stringify(results.step)},
    "rho": `);
    appendArrayStream(parts, results.rho);
    parts.push(`,\n    "ux": `);
    appendArrayStream(parts, results.ux);
    parts.push(`,\n    "uy": `);
    appendArrayStream(parts, results.uy);
    parts.push(`,\n    "uz": `);
    appendArrayStream(parts, results.uz);
    parts.push(`,\n    "T": `);
    appendArrayStream(parts, results.T);
    parts.push(`\n  }
}
`);

    const blob = new Blob(parts, { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lbm-simulation-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSaveOpen(false);
  };

  // 触发文件选择器（导入布局 / 仿真结果）
  const handlePickImportFile = (type: 'layout' | 'simulation') => {
    pendingImportType.current = type;
    setImportOpen(false);
    // 给状态更新一拍时间关闭弹窗后再点击
    setTimeout(() => {
      const input = fileInputRef.current;
      if (input) {
        input.value = ''; // 允许重复选择同一文件
        input.click();
      }
    }, 0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImportFile(file);
  };

  // 样板间筛选：关键字(名称/描述/标签) + 大类 + 标签。所有过滤可叠加。
  const allTags = useMemo(() => {
    const s = new Set<string>();
    SAMPLE_ROOMS.forEach(r => r.tags.forEach(t => s.add(t)));
    return Array.from(s);
  }, []);

  const filteredSamples = useMemo(() => {
    const q = sampleSearch.trim().toLowerCase();
    return SAMPLE_ROOMS.filter(s => {
      if (sampleCat !== 'all' && s.category !== sampleCat) return false;
      if (sampleTag && !s.tags.includes(sampleTag)) return false;
      if (q) {
        const hay = (s.name + ' ' + s.description + ' ' + s.tags.join(' ') + ' ' + t('sample.cat.' + s.category)).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sampleSearch, sampleCat, sampleTag, t]);

  // 搜索/筛选变化时回到第一页，避免停在超出范围的页码。
  useEffect(() => { setSamplePage(0); }, [sampleSearch, sampleCat, sampleTag]);

  const sampleTotalPages = Math.max(1, Math.ceil(filteredSamples.length / SAMPLES_PER_PAGE));
  const safePage = Math.min(samplePage, sampleTotalPages - 1);
  const pagedSamples = filteredSamples.slice(safePage * SAMPLES_PER_PAGE, safePage * SAMPLES_PER_PAGE + SAMPLES_PER_PAGE);

  return (
    <header className="h-16 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between px-6 shadow-sm">
      {/* Left: Logo + Project Name + Function Tabs */}
      <div className="flex items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="LBM Logo" width={40} height={40} className="rounded-lg" priority />
          <span className="text-lg font-semibold text-gray-800 dark:text-gray-100">{projectName}</span>
        </div>

        {/* Function Tabs */}
        <div className="flex items-center gap-1 ml-4">
          <button onClick={() => setSaveOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all">
            <IconBox>{icons.save}</IconBox><span>{t('topbar.save')}</span>
          </button>
          <button onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all">
            <IconBox>{icons.import}</IconBox><span>{t('topbar.import')}</span>
          </button>
          <button onClick={() => setSamplesOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all">
            <IconBox>{icons.samples}</IconBox><span>{t('topbar.samples')}</span>
          </button>
          <button onClick={() => setAboutOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all">
            <IconBox>{icons.about}</IconBox><span>{t('topbar.about')}</span>
          </button>
          <button onClick={() => setContactOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all">
            <IconBox>{icons.contact}</IconBox><span>{t('topbar.contact')}</span>
          </button>
          <button onClick={() => setSupportOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/30 rounded-lg transition-all">
            <IconBox>{icons.support}</IconBox><span>{t('topbar.support')}</span>
          </button>
        </div>
      </div>

      {/* Right: Icon Style + Theme + Language + Settings + User */}
      <div className="flex items-center gap-4">
        {/* Icon Style Selector */}
        <div className="relative">
          {/* <button
            onClick={() => setIconStyleMenuOpen(!iconStyleMenuOpen)}
            className={`w-9 h-9 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all ${iconStyle === 'flat' ? 'text-sm font-bold' : 'text-base'}`}
            title="图标风格"
          >
            {iconStyle === 'skeuomorphic' ? '🎨' : '✦'}
          </button> */}

          {/* Icon Style Dropdown */}
          {iconStyleMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl z-50">
              <div className="p-2 space-y-1">
                <div className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 font-medium">{t('topbar.iconStyleTitle')}</div>
                <button
                  onClick={() => { setIconStyle('skeuomorphic'); setIconStyleMenuOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 ${
                    iconStyle === 'skeuomorphic'
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className="text-lg">🎨</span>
                  <span>{t('topbar.iconSkeuomorphic')}</span>
                </button>
                <button
                  onClick={() => { setIconStyle('flat'); setIconStyleMenuOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 ${
                    iconStyle === 'flat'
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className="text-lg font-bold text-gray-600 dark:text-gray-400">✦</span>
                  <span>{t('topbar.iconFlat')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={`w-9 h-9 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all ${iconStyle === 'flat' ? 'text-sm font-bold' : 'text-base'}`}
          title={theme === 'light' ? t('topbar.themeLight') : t('topbar.themeDark')}
        >
          {icons.themeIcon}
        </button>

        {/* Language Selector — click to toggle zh ⇄ en */}
        <button
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          className={`flex items-center justify-center gap-1 h-9 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all ${iconStyle === 'flat' ? 'text-xs font-bold' : 'text-sm'}`}
          title={t('topbar.langTitle')}
        >
          <span className="text-base leading-none">{icons.language}</span>
          <span className="font-semibold">{lang === 'zh' ? '中' : 'EN'}</span>
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className={`w-9 h-9 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all ${iconStyle === 'flat' ? 'text-sm font-bold' : 'text-base'}`}
          title={t('topbar.settings')}
        >
          {icons.settings}
        </button>

        {/* User Avatar */}
        <div className="relative group">
          <button className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-medium text-sm hover:shadow-lg transition-all">
            U
          </button>

          {/* User Info Tooltip */}
          <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs">
                  U
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">User</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">user@example.com</div>
                </div>
              </div>
              <div className="border-t border-gray-100 dark:border-slate-700 pt-2">
                <button className="w-full text-left px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 rounded">
                  {t('topbar.userSettings')}
                </button>
                <button className="w-full text-left px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded">
                  {t('topbar.logout')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 保存结果弹窗 ===== */}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={`${icons.save} ${t('topbar.saveTitle')}`}>
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          {t('topbar.savePick')}
        </p>

        <div className="space-y-3">
          {/* 布局结果 */}
          <button
            onClick={handleSaveLayout}
            className="w-full text-left p-4 rounded-xl border-2 border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-500 rounded-lg flex items-center justify-center text-white text-xl group-hover:scale-105 transition-transform ${iconStyle === 'flat' ? '!rounded-md !text-sm font-bold' : ''}`}>
                {iconStyle === 'skeuomorphic' ? '📦' : '⬇'}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-800 dark:text-gray-100 text-base">{t('topbar.saveLayout')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('topbar.saveLayoutDesc')}
                </div>
                <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  {t('topbar.fileFmt', { date: new Date().toISOString().slice(0, 10) })}
                </div>
              </div>
            </div>
          </button>

          {/* 仿真结果 */}
          <button
            onClick={handleSaveSimulation}
            className="w-full text-left p-4 rounded-xl border-2 border-gray-200 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-lg flex items-center justify-center text-white text-xl group-hover:scale-105 transition-transform ${iconStyle === 'flat' ? '!rounded-md !text-sm font-bold' : ''}`}>
                {iconStyle === 'skeuomorphic' ? '📊' : '◈'}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-800 dark:text-gray-100 text-base">{t('topbar.saveSim')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('topbar.saveSimDesc')}
                </div>
                <div className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                  {t('topbar.fileFmtSim', { date: new Date().toISOString().slice(0, 10) })}
                </div>
              </div>
            </div>
          </button>
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 mt-4" dangerouslySetInnerHTML={{ __html: t('topbar.saveHint') }} />
      </Modal>

      {/* ===== 导入弹窗 ===== */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={`${icons.import} ${t('topbar.importTitle')}`}>
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          {t('topbar.importPick')}
        </p>

        <div className="space-y-3">
          {/* 导入布局结果 */}
          <button
            onClick={() => handlePickImportFile('layout')}
            className="w-full text-left p-4 rounded-xl border-2 border-gray-200 dark:border-slate-600 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-500 rounded-lg flex items-center justify-center text-white text-xl group-hover:scale-105 transition-transform ${iconStyle === 'flat' ? '!rounded-md !text-sm font-bold' : ''}`}>
                {iconStyle === 'skeuomorphic' ? '📦' : '⬆'}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-800 dark:text-gray-100 text-base">{t('topbar.importLayout')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('topbar.importLayoutDesc')}
                </div>
                <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                  {t('topbar.importLayoutFile')}
                </div>
              </div>
            </div>
          </button>

          {/* 导入仿真结果 */}
          <button
            onClick={() => handlePickImportFile('simulation')}
            className="w-full text-left p-4 rounded-xl border-2 border-gray-200 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-lg flex items-center justify-center text-white text-xl group-hover:scale-105 transition-transform ${iconStyle === 'flat' ? '!rounded-md !text-sm font-bold' : ''}`}>
                {iconStyle === 'skeuomorphic' ? '📊' : '◈'}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-800 dark:text-gray-100 text-base">{t('topbar.importSim')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('topbar.importSimDesc')}
                </div>
                <div className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                  {t('topbar.importSimFile')}
                </div>
              </div>
            </div>
          </button>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300 mt-4" dangerouslySetInnerHTML={{ __html: t('topbar.importHint') }} />
      </Modal>

      {/* 隐藏的文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ===== 样板间弹窗（搜索 + 筛选 + 列表缩略图）===== */}
      <Modal open={samplesOpen} onClose={() => setSamplesOpen(false)} title={`${icons.samples} ${t('topbar.samplesTitle')}`} wide>
        {/* 搜索框 */}
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">🔍</span>
          <input
            value={sampleSearch}
            onChange={e => setSampleSearch(e.target.value)}
            placeholder={t('topbar.samplesSearch')}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800 outline-none"
          />
        </div>

        {/* 大类筛选 */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {(['all', ...Object.keys(SAMPLE_CATEGORY_LABELS)] as (SampleRoom['category'] | 'all')[]).map(c => (
            <button
              key={c}
              onClick={() => setSampleCat(c)}
              className={`px-2.5 py-1 text-xs rounded-full transition-all ${sampleCat === c
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'}`}
            >
              {c === 'all' ? t('topbar.all') : t('sample.cat.' + c)}
            </button>
          ))}
        </div>

        {/* 标签筛选 */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {allTags.map(t => (
              <button
                key={t}
                onClick={() => setSampleTag(sampleTag === t ? null : t)}
                className={`px-2 py-0.5 text-[11px] rounded-full transition-all border ${sampleTag === t
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500'}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* 列表：固定高度(3 行)，多于 3 个分页显示 */}
        <div className="space-y-2 min-h-[332px] flex flex-col justify-start">
          {pagedSamples.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">{t('topbar.noMatch')}</div>
          ) : (
            pagedSamples.map(s => {
              const built = s.build();
              return (
                <div
                  key={s.id}
                  className="w-full text-left p-3 rounded-xl border border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group flex items-center gap-3"
                >
                  {/* 缩略图 */}
                  <div className="shrink-0 rounded-lg overflow-hidden border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900">
                    <LayoutThumbnail room={built} size={84} />
                  </div>
                  {/* 文字 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate">{s.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 shrink-0">{t('sample.cat.' + s.category)}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.description}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {s.tags.map(t => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">{t}</span>
                      ))}
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                      {t('topbar.sampleStat', { l: built.length, w: built.width, h: built.height, boxes: built.boxes.length, vents: built.vents.length, heat: built.heatSources.length })}
                    </div>
                  </div>
                  {/* 载入按钮：明确触发，避免误点整卡即载入 */}
                  <button
                    onClick={() => {
                      onLoadSample(built);
                      setSamplesOpen(false);
                    }}
                    className="shrink-0 self-stretch px-4 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium shadow-sm transition-colors flex items-center"
                  >
                    {t('topbar.load')}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* 分页 */}
        {filteredSamples.length > SAMPLES_PER_PAGE && (
          <div className="flex items-center justify-center gap-2 mt-3 text-xs text-gray-500 dark:text-gray-400">
            <button
              onClick={() => setSamplePage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700 transition-all"
            >{t('topbar.prevPage')}</button>
            <span className="px-2">{safePage + 1} / {sampleTotalPages}</span>
            <button
              onClick={() => setSamplePage(p => Math.min(sampleTotalPages - 1, p + 1))}
              disabled={safePage >= sampleTotalPages - 1}
              className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700 transition-all"
            >{t('topbar.nextPage')}</button>
          </div>
        )}

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 mt-3">
          ⚠️ {t('topbar.samplesHint')}
        </div>
      </Modal>

      {/* ===== 关于项目弹窗 ===== */}
      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title={`${icons.about} ${t('topbar.aboutTitle')}`}>
        <div className="flex items-center gap-3 mb-4">
          <Image src="/logo.png" alt="LBM Logo" width={48} height={48} className="rounded-lg" />
          <div>
            <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('topbar.aboutName')}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('topbar.aboutVersion')}</div>
          </div>
        </div>

        <p className="text-gray-700 dark:text-gray-300" dangerouslySetInnerHTML={{ __html: t('topbar.aboutIntro') }} />

        {/* <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-1"> */}
        <div className="bg-blue-50 dark:bg-slate-700 rounded-lg p-3 space-y-1">
          <p className="font-medium text-blue-800 dark:text-blue-300">{t('topbar.aboutTechTitle')}</p>
          <p>{t('topbar.aboutTech1')}</p>
          <p>{t('topbar.aboutTech2')}</p>
          <p>{t('topbar.aboutTech3')}</p>
          <p>{t('topbar.aboutTech4')}</p>
        </div>

        <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 space-y-1">
          <p className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.aboutInfoTitle')}</p>
          <p dangerouslySetInnerHTML={{ __html: t('topbar.aboutInfo1') }} />
          <p>{t('topbar.aboutInfo2')}</p>
          <p>{t('topbar.aboutInfo3')}</p>
          {/* <p dangerouslySetInnerHTML={{ __html: t('topbar.aboutInfo4') }} /> */}
        </div>

        <div className="bg-red-50 dark:bg-slate-700 rounded-lg p-3 space-y-1">
          <p className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.GithubInfoTitle')}</p>
          <p>{t('topbar.GithubInfo1')}</p>
          <p>{t('topbar.GithubInfo2')}</p>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
          {t('topbar.aboutCopyright')}
        </p>
      </Modal>

      {/* ===== 联系我们弹窗 ===== */}
      <Modal open={contactOpen} onClose={() => setContactOpen(false)} title={`${icons.contact} ${t('topbar.contactTitle')}`}>
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          {t('topbar.contactIntro')}
        </p>

        <div className="space-y-3">
          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '📧' : '✉'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.contactEmail')}</div>
              <div className="text-gray-600 dark:text-gray-400">623127794@qq.com</div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '🌐' : '◎'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.contactWeb')}</div>
              <div className="text-blue-600 dark:text-blue-400">AllinSim</div>
            </div>
          </div>

          {/* <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '📱' : '☎'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.contactPhone')}</div>
              <div className="text-gray-600 dark:text-gray-400">[+86 xxx-xxxx-xxxx]</div>
            </div>
          </div> */}

          {/* <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '🏢' : '⌂'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.contactAddr')}</div>
              <div className="text-gray-600 dark:text-gray-400">[您的办公地址]</div>
            </div>
          </div> */}

          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '💬' : '⌨'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.contactGithub')}</div>
              <div className="text-blue-600 dark:text-blue-400">https://github.com/AllinSim/Homenvis</div>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
          {t('topbar.contactReply')}
        </p>
      </Modal>

      {/* ===== 支持我们弹窗 ===== */}
      <Modal open={supportOpen} onClose={() => setSupportOpen(false)} title={`${icons.support} ${t('topbar.supportTitle')}`}>
        <p className="text-gray-700 dark:text-gray-300 mb-4" dangerouslySetInnerHTML={{ __html: t('topbar.supportIntro') }} />
        
        {/* 微信和支付宝赞助 */}
        {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-gray-50 dark:bg-slate-700 rounded-xl p-4 flex flex-col items-center text-center border border-gray-200 dark:border-slate-600">
            <span className={`mb-2 ${iconStyle === 'skeuomorphic' ? 'text-3xl' : 'text-xl font-bold text-green-600 dark:text-green-400'}`}>
              {iconStyle === 'skeuomorphic' ? '💚' : '♤'}
            </span>
            <div className="font-medium text-gray-800 dark:text-gray-200 text-sm">{t('topbar.supportWechat')}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('topbar.supportScan')}</div>
            <div className="mt-3 w-28 h-28 bg-white border border-gray-300 dark:border-slate-500 rounded-lg flex items-center justify-center text-[10px] text-gray-400 dark:text-gray-500">
              {t('topbar.supportWechatQR')}
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-slate-700 rounded-xl p-4 flex flex-col items-center text-center border border-gray-200 dark:border-slate-600">
            <span className={`mb-2 ${iconStyle === 'skeuomorphic' ? 'text-3xl' : 'text-xl font-bold text-blue-600 dark:text-blue-400'}`}>
              {iconStyle === 'skeuomorphic' ? '💙' : '◇'}
            </span>
            <div className="font-medium text-gray-800 dark:text-gray-200 text-sm">{t('topbar.supportAlipay')}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('topbar.supportScan')}</div>
            <div className="mt-3 w-28 h-28 bg-white border border-gray-300 dark:border-slate-500 rounded-lg flex items-center justify-center text-[10px] text-gray-400 dark:text-gray-500">
              {t('topbar.supportAlipayQR')}
            </div>
          </div>
        </div> */}

        <div className="space-y-3 mt-4">
          {/* 爱发电 */}
          {/* <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '⚡' : '✦'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.supportAfdian')}</div>
              <div className="text-blue-600 dark:text-blue-400">[https://afdian.net/your-link]</div>
            </div>
          </div> */}

          {/* GitHub Sponsor */}
          {/* <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '🐱' : '⌥'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.supportGithub')}</div>
              <div className="text-blue-600 dark:text-blue-400">[https://github.com/sponsors/your-repo]</div>
            </div>
          </div> */}

          {/* 其他支持方式 */}
          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 flex items-center gap-3">
            <span className={iconStyle === 'skeuomorphic' ? 'text-xl' : 'text-sm font-bold'}>{iconStyle === 'skeuomorphic' ? '⭐' : '★'}</span>
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">{t('topbar.supportStar')}</div>
              <div className="text-gray-600 dark:text-gray-400">{t('topbar.supportStarDesc')}</div>
            </div>
          </div>
        </div>

        {/* <div className="bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-lg p-3 text-xs text-pink-700 dark:text-pink-300 mt-4 text-center">
          {t('topbar.supportThanks')}
        </div> */}

        {/* <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
          {t('topbar.supportContactNote')}
        </p> */}
      </Modal>
    </header>
  );
}
