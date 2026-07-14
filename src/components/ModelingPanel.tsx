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

import { useState, useMemo, useEffect } from 'react';
import { type RoomLayout, type ShapeKind, isWallLike, genId } from '@/lib/room-layout';
import { type DeviceModel, getDevicesByCategory } from '@/lib/device-library';
import { type FurnitureCategory, FURNITURE_CATEGORIES, FURNITURE_SUBCATEGORY_OPTIONS, getFurnitureByCategory, presetToBox3D } from '@/lib/furniture-library';
import { useSettings } from '@/lib/settings-context';
import { useI18n } from '@/lib/i18n-context';
import SectionPanel from '@/components/SectionPanel';
import NumberInput from '@/components/NumberInput';

const SHAPE_OPTIONS: { value: ShapeKind; labelKey: string }[] = [
  { value: 'box', labelKey: 'modeling.shapeBox' },
  { value: 'prism', labelKey: 'modeling.shapePrism' },
  { value: 'cylinder_v', labelKey: 'modeling.shapeCylV' },
  { value: 'cylinder_h', labelKey: 'modeling.shapeCylH' },
];

/**
 * 形状 + 旋转 z 同行布局（节省纵向空间）。
 * onShape(s) / onRotZ(rad) 分别写回。
 */
function ShapeRotRow({ shape, rotZRad, onShape, onRotZ }: { shape: ShapeKind; rotZRad: number; onShape: (s: ShapeKind) => void; onRotZ: (rad: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs">
        <span className="text-gray-500 dark:text-gray-400 font-medium">{t('modeling.shape')}</span>
        <select value={shape} onChange={e => onShape(e.target.value as ShapeKind)}
          className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800">
          {SHAPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
        </select>
      </label>
      <label className="text-xs">
        <span className="text-gray-500 dark:text-gray-400 font-medium">{t('modeling.rotZ')}</span>
        <NumberInput step="5" value={Math.round(rotZRad * 180 / Math.PI)} onValueChange={(val) => onRotZ(val * Math.PI / 180)}
          className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
      </label>
    </div>
  );
}


/**
 * 第二行尺寸输入：L / W / H（显示为 长/宽/高）。
 * 圆柱形状下，截面两维等价于直径(=2×半径)，引擎用 min(两维)/2 当半径，
 * 故让两维显示为"半径"并同步：编辑任一框，两维都设为 2×radius。
 *   - cylinder_v：L 与 W 同步（竖直轴沿 z，截面在 xy）
 *   - cylinder_h：W 与 H 同步（水平轴沿 x，截面在 yz）
 * onDim(key, value)：写单个字段；同步时会连续调用两次。
 */
function DimsRow({
  shape, L, W, H, onDim,
}: {
  shape: ShapeKind; L: number; W: number; H: number;
  onDim: (key: 'L' | 'W' | 'H', value: number) => void;
}) {
  const { t } = useI18n();
  // 每个槽位：显示标签 + 一个或多个需同步的字段键。
  // cylinder_v：L/W 合并为"半径"(取 min/2 显示，写入时两键都设为 2r)。
  // cylinder_h：W/H 合并为"半径"。
  let slots: { label: string; keys: ('L' | 'W' | 'H')[]; value: number }[];
  if (shape === 'cylinder_v') {
    const r = Math.min(L, W) / 2;
    slots = [
      { label: t('modeling.radius'), keys: ['L', 'W'], value: r },
      { label: t('modeling.radius'), keys: ['L', 'W'], value: r },
      { label: t('modeling.tall'), keys: ['H'], value: H },
    ];
  } else if (shape === 'cylinder_h') {
    const r = Math.min(W, H) / 2;
    slots = [
      { label: t('modeling.long'), keys: ['L'], value: L },
      { label: t('modeling.radius'), keys: ['W', 'H'], value: r },
      { label: t('modeling.radius'), keys: ['W', 'H'], value: r },
    ];
  } else {
    slots = [
      { label: t('modeling.long'), keys: ['L'], value: L },
      { label: t('modeling.wide'), keys: ['W'], value: W },
      { label: t('modeling.tall'), keys: ['H'], value: H },
    ];
  }
  return (
    <div className="grid grid-cols-3 gap-1 text-xs">
      {slots.map((slot, i) => (
        <label key={i}><span className="text-gray-500 dark:text-gray-400 font-medium">{slot.label}</span>
          <NumberInput step="0.1" value={slot.value}
            onValueChange={(val) => {
              // 半径槽位(2 keys)：把两维都设为 2×val(直径)，保证 min/2 == val。
              if (slot.keys.length === 2) {
                const diameter = 2 * val;
                onDim(slot.keys[0], diameter);
                onDim(slot.keys[1], diameter);
              } else {
                onDim(slot.keys[0], val);
              }
            }}
            className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
        </label>
      ))}
    </div>
  );
}

interface ModelingPanelProps {
  room: RoomLayout;
  setRoom: React.Dispatch<React.SetStateAction<RoomLayout>>;
  aiLoading: boolean;
  handleAI: (input: string, mode: 'text' | 'image') => void;
  aiMessages: { id: number; text: string; kind: 'info' | 'success' | 'warn' | 'error' }[];
  onClearAiMessages: () => void;
  onAddDevice: (device: DeviceModel, modeIndex: number) => void;
  activeSection: string;
}

const CATEGORIES = [
  { id: 'air_conditioner' as const, nameKey: 'modeling.cat.air_conditioner', icon: '❄️' },
  { id: 'heater' as const, nameKey: 'modeling.cat.heater', icon: '🔥' },
  { id: 'fan' as const, nameKey: 'modeling.cat.fan', icon: '🌀' },
  { id: 'heat_pump' as const, nameKey: 'modeling.cat.heat_pump', icon: '♨️' },
  { id: 'tv' as const, nameKey: 'modeling.cat.tv', icon: '📺' },
  { id: 'range_hood' as const, nameKey: 'modeling.cat.range_hood', icon: '🍳' },
  { id: 'exhaust_fan' as const, nameKey: 'modeling.cat.exhaust_fan', icon: '🌬️' },
  { id: 'air_purifier' as const, nameKey: 'modeling.cat.air_purifier', icon: '🍃' },
];

const CATEGORY_NAME_KEYS: Record<DeviceModel['category'], string> = {
  air_conditioner: 'modeling.cat.air_conditioner', heater: 'modeling.cat.heater', fan: 'modeling.cat.fan', heat_pump: 'modeling.cat.heat_pump',
  tv: 'modeling.cat.tv', range_hood: 'modeling.cat.range_hood', exhaust_fan: 'modeling.cat.exhaust_fan', air_purifier: 'modeling.cat.air_purifier',
};

export default function ModelingPanel({
  room, setRoom, aiLoading, handleAI, aiMessages, onClearAiMessages, onAddDevice, activeSection,
}: ModelingPanelProps) {
  const { apiBase, apiKey } = useSettings();
  const { t } = useI18n();
  const [aiMode, setAiMode] = useState<'text' | 'image'>('text');
  const [aiInput, setAiInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<DeviceModel['category']>('air_conditioner');
  const [selectedDevice, setSelectedDevice] = useState<DeviceModel | null>(null);
  const [selectedMode, setSelectedMode] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState<string>('__all__');
  const [devicePage, setDevicePage] = useState(0);
  const DEVICE_PER_PAGE = 3;

  // 家具库状态
  const [furnCategory, setFurnCategory] = useState<FurnitureCategory>('sofa');
  const [furnSearch, setFurnSearch] = useState('');
  const [furnSubcategoryFilter, setFurnSubcategoryFilter] = useState<string>('__all__');
  const [furnPage, setFurnPage] = useState(0);
  const FURN_PER_PAGE = 3;
  // 切换主类 / 子分类筛选 / 搜索关键字时回到第一页，避免停在超出范围的页码。
  useEffect(() => { setFurnPage(0); }, [furnCategory, furnSubcategoryFilter, furnSearch]);
  // 电器：切换主类 / 品牌筛选 / 搜索关键字时同样回到第一页。
  useEffect(() => { setDevicePage(0); }, [selectedCategory, brandFilter, searchQuery]);

  const walls = room.boxes.filter(isWallLike);
  const furniture = room.boxes.filter(b => !isWallLike(b));

  const brandsInCategory = useMemo(() => {
    const all = getDevicesByCategory(selectedCategory);
    return ['__all__', ...Array.from(new Set(all.map(d => d.brand)))];
  }, [selectedCategory]);

  const filteredDevices = useMemo(() => {
    let devices = getDevicesByCategory(selectedCategory);
    if (brandFilter !== '__all__') devices = devices.filter(d => d.brand === brandFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      devices = devices.filter(d => d.name.toLowerCase().includes(q) || d.brand.toLowerCase().includes(q));
    }
    return devices;
  }, [selectedCategory, brandFilter, searchQuery]);

  const handleAddDeviceFromLibrary = () => {
    if (selectedDevice) onAddDevice(selectedDevice, selectedMode);
  };

  const addWall = (shape: ShapeKind) => {
    setRoom(prev => {
      let name = t('modeling.newWall'), L = prev.length, W = 0.12, H = prev.height;
      if (shape === 'prism') { name = t('modeling.newSlope'); L = 2; W = 1; }
      else if (shape === 'cylinder_v') { name = t('modeling.newCylV'); L = 0.5; W = 0.5; H = prev.height; }
      else if (shape === 'cylinder_h') { name = t('modeling.newCylH'); L = 1.5; W = 0.3; H = 0.3; }
      return { ...prev, boxes: [...prev.boxes, {
        id: genId(), name,
        x: shape === 'box' ? 0 : prev.length / 2, y: prev.width / 2, z: 0,
        L, W, H,
        color: '#94a3b8', shape, doorHoles: [], category: 'wall',
      }] };
    });
  };

  const addDoorHole = (boxId: string) => {
    setRoom(prev => ({
      ...prev, boxes: prev.boxes.map(b => b.id === boxId ? {
        ...b, doorHoles: [...b.doorHoles, { id: genId(), name: t('modeling.newDoorHole'), wallFace: 'south' as const, offsetFromLeft: 0, width: 0.9, height: 2.0, sillHeight: 0, open: true }],
      } : b),
    }));
  };

  const updateDoorHole = (boxId: string, doorId: string, field: string, value: any) => {
    setRoom(prev => ({ ...prev, boxes: prev.boxes.map(b => b.id === boxId ? { ...b, doorHoles: b.doorHoles.map(d => d.id === doorId ? { ...d, [field]: value } : d) } : b) }));
  };

  const removeDoorHole = (boxId: string, doorId: string) => {
    setRoom(prev => ({ ...prev, boxes: prev.boxes.map(b => b.id === boxId ? { ...b, doorHoles: b.doorHoles.filter(d => d.id !== doorId) } : b) }));
  };

  const removeBox = (id: string) => { setRoom(prev => ({ ...prev, boxes: prev.boxes.filter(b => b.id !== id) })); };
  const addFurniture = () => { setRoom(prev => ({ ...prev, boxes: [...prev.boxes, { id: genId(), name: t('modeling.newFurniture'), x: 1, y: 1, z: 0, L: 0.5, W: 0.5, H: 0.5, color: '#8b6914', shape: 'box', doorHoles: [], category: 'furniture' }] })); };
  const addFurniturePreset = (presetId: string) => {
    const all = FURNITURE_CATEGORIES.flatMap(c => getFurnitureByCategory(c.id));
    const preset = all.find(p => p.id === presetId);
    if (!preset) return;
    setRoom(prev => ({ ...prev, boxes: [...prev.boxes, presetToBox3D(preset, prev.length, prev.width)] }));
  };
  const addWindow = () => {
    setRoom(prev => ({ ...prev, boxes: [...prev.boxes, {
      id: genId(), name: t('modeling.newWindow'),
      x: prev.length / 2, y: 0, z: 1.0,
      L: 1.6, W: 0.05, H: 1.4,
      color: '#7dd3fc', shape: 'box', doorHoles: [], category: 'wall',
      isWindow: true, asHeatSource: false, windowTemp: 35,
    }] }));
  };

  const addVent = (type: 'velocity_inlet' | 'pressure_outlet') => {
    setRoom(prev => ({
      ...prev, vents: [...prev.vents, {
        id: genId(), name: type === 'velocity_inlet' ? t('modeling.inletName') : t('modeling.outletName'),
        ventType: type, x: 2, y: 4, z: 0, L: 0.5, W: 0.05, H: 0.05,
        // velocity 在几何体自身坐标系下：出风口默认沿 -Y'(W-) 吹，回风口默认 +Y'(W+) 回流
        velocity: type === 'velocity_inlet' ? [0, -2.00, -0.5] : [0, 0, 0],
        temperature: type === 'velocity_inlet' ? 18 : null,
        color: type === 'velocity_inlet' ? '#3b82f6' : '#f59e0b',
        outflowFace: type === 'velocity_inlet' ? '-Y' : '+Y',
      }],
    }));
  };

  const removeVent = (id: string) => { setRoom(prev => ({ ...prev, vents: prev.vents.filter(v => v.id !== id) })); };
  const addHeatSource = () => { setRoom(prev => ({ ...prev, heatSources: [...prev.heatSources, { id: genId(), name: t('modeling.heatSourceName'), x: 1, y: 0, z: 0, L: 1, W: 0.01, H: 1, temperature: 35, color: '#ef4444' }] })); };
  const removeHeatSource = (id: string) => { setRoom(prev => ({ ...prev, heatSources: prev.heatSources.filter(h => h.id !== id) })); };
  const removeDevice = (id: string) => { setRoom(prev => ({ ...prev, devices: prev.devices.filter(d => d.id !== id) })); };

  const apiConfigured = apiBase && apiKey;

  return (
    <div className="p-5 h-full flex flex-col text-sm">
      {/* ===== AI 智能设计 ===== */}
      <SectionPanel sectionId="ai-design" activeSection={activeSection} title={t('section.ai-design')} iconSkeuomorphic="🤖" iconFlat="AI" iconBg="from-green-400 to-emerald-500">
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('modeling.aiDesc')}</p>
        {!apiConfigured && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2 text-xs text-amber-700 dark:text-amber-300">
            {t('modeling.apiNotConfigured')}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => setAiMode('text')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${aiMode === 'text' ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'}`}>
            {t('modeling.textMode')}
          </button>
          <button onClick={() => setAiMode('image')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${aiMode === 'image' ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'}`}>
            {t('modeling.imageMode')}
          </button>
        </div>
        {aiMode === 'text' ? (
          <>
            <textarea value={aiInput} onChange={e => setAiInput(e.target.value)} placeholder={t('modeling.textPlaceholder')}
              className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 h-28 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all resize-none" />
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2 text-[11px] text-blue-700 dark:text-blue-300 leading-relaxed">
              {t('modeling.aiTip')}
            </div>
          </>
        ) : (
          <div className="border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-all">
            <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setAiInput(r.result as string); r.readAsDataURL(f); } }} className="w-full text-xs" />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">{t('modeling.imageTip')}</p>
          </div>
        )}
        <button onClick={() => handleAI(aiInput, aiMode)} disabled={aiLoading || !apiConfigured}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-2.5 px-4 rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {aiLoading ? t('modeling.aiAnalyzing') : t('modeling.aiStart')}
        </button>

        {/* AI 输出信息栏：实时显示进度、结果与几何校核反馈 */}
        {(aiLoading || aiMessages.length > 0) && (
          <div className="mt-2 border border-gray-200 dark:border-slate-600 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between bg-gray-50 dark:bg-slate-700/60 px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('modeling.aiOutput')}</span>
              <button
                onClick={onClearAiMessages}
                disabled={aiLoading}
                className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >{t('modeling.clear')}</button>
            </div>
            <div className="max-h-52 overflow-y-auto px-2.5 py-2 space-y-1 bg-white dark:bg-slate-800">
              {aiMessages.map(m => (
                <div key={m.id} className={`text-[11px] leading-relaxed font-mono whitespace-pre-wrap ${
                  m.kind === 'success' ? 'text-green-600 dark:text-green-400'
                  : m.kind === 'error' ? 'text-red-600 dark:text-red-400'
                  : m.kind === 'warn' ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-600 dark:text-gray-300'
                }`}>{m.text}</div>
              ))}
              {aiLoading && (
                <div className="text-[11px] text-gray-400 dark:text-gray-500 italic flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                  {t('modeling.processing')}
                </div>
              )}
            </div>
          </div>
        )}
      </SectionPanel>

      {/* ===== 房间尺寸 ===== */}
      <SectionPanel sectionId="room-size" activeSection={activeSection} title={t('section.room-size')} iconSkeuomorphic="📏" iconFlat="□" iconBg="from-purple-400 to-pink-500" badge={`${(room.length * room.width).toFixed(1)} m²`}>
        <div className="grid grid-cols-3 gap-3">
          {(['length', 'width', 'height'] as const).map(k => (
            <label key={k} className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">{t('modeling.' + k)}</span>
              <NumberInput step="0.1" value={room[k]} onValueChange={(val) => setRoom(prev => ({ ...prev, [k]: val }))}
                className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all" />
              <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 block">{t('common.meter')}</span>
            </label>
          ))}
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
          <p>{t('modeling.volume')}<span className="font-bold">{(room.length * room.width * room.height).toFixed(1)}</span> m³{t('modeling.area')}<span className="font-bold">{(room.length * room.width).toFixed(1)}</span> m²</p>
        </div>
      </SectionPanel>

      {/* ===== 墙门窗 ===== */}
      <SectionPanel sectionId="walls" activeSection={activeSection} title={t('section.walls')} iconSkeuomorphic="🧱" iconFlat="▦" iconBg="from-slate-400 to-gray-500" badge={t('common.count', { n: walls.length })}>
        <div className="flex gap-2">
          <button onClick={() => addWall('box')} className="flex-1 text-xs bg-gradient-to-r from-gray-500 to-slate-600 text-white px-3 py-1.5 rounded-lg hover:shadow-md transition-all">{t('modeling.addWall')}</button>
          <button onClick={addWindow} className="flex-1 text-xs bg-gradient-to-r from-sky-400 to-cyan-500 text-white px-3 py-1.5 rounded-lg hover:shadow-md transition-all">{t('modeling.addWindow')}</button>
        </div>
        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {walls.length === 0 && <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">{t('modeling.noWall')}</div>}
          {walls.map(b => (
            <div key={b.id} className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3 space-y-2 border border-gray-200 dark:border-slate-600">
              <div className="flex justify-between items-center">
                <input value={b.name} onChange={e => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, name: e.target.value } : x) }))}
                  className="font-medium text-sm bg-transparent text-gray-800 dark:text-gray-200 border-b border-transparent hover:border-gray-400 dark:hover:border-slate-500 focus:border-blue-500 outline-none flex-1" />
                <button onClick={() => removeBox(b.id)} className="text-red-400 hover:text-red-600 rounded px-2 py-1 text-xs transition-all ml-2">✕</button>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-1 text-xs">
                  {[['x', 'x', b.x], ['y', 'y', b.y], ['z', 'z', b.z]].map(([k, label, v]) => (
                    <label key={k as string}><span className="text-gray-500 dark:text-gray-400 font-medium">{label}</span>
                      <NumberInput step="0.1" value={v as number} onValueChange={(val) => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, [k]: val } : x) }))}
                        className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                    </label>
                  ))}
                </div>
                <DimsRow shape={b.shape ?? 'box'} L={b.L} W={b.W} H={b.H}
                  onDim={(key, val) => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, [key]: val } : x) }))} />
              </div>
              <ShapeRotRow shape={b.shape ?? 'box'} rotZRad={b.rotZ ?? 0}
                onShape={s => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => {
                  if (x.id !== b.id) return x;
                  // 切换形状时重置为该形状的合理默认尺寸（保持位置 x/y/z），
                  // 否则沿用长方体薄墙尺寸(W=0.12)会导致圆柱极细、显示异常。
                  let L = x.L, W = x.W, H = x.H;
                  if (s === 'box') { L = prev.length; W = 0.12; H = prev.height; }
                  else if (s === 'prism') { L = 2; W = 1; H = prev.height; }
                  else if (s === 'cylinder_v') { L = 0.5; W = 0.5; H = prev.height; }
                  else if (s === 'cylinder_h') { L = 1.5; W = 0.3; H = 0.3; }
                  return { ...x, shape: s, L, W, H };
                }) }))}
                onRotZ={rad => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, rotZ: rad } : x) }))} />
              {b.isWindow && (
                <div className="bg-sky-50 dark:bg-sky-900/20 rounded-lg p-2 space-y-2 border border-sky-200 dark:border-sky-800">
                  <label className="flex items-center gap-2 text-xs font-medium text-sky-800 dark:text-sky-200 cursor-pointer">
                    <input type="checkbox" checked={b.asHeatSource ?? false}
                      onChange={e => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, asHeatSource: e.target.checked } : x) }))}
                      className="rounded" />
                    {t('modeling.windowHeat')}
                  </label>
                </div>
              )}
              {b.shape === 'box' && !b.isWindow && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center"><span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('modeling.doorHole')}</span><button onClick={() => addDoorHole(b.id)} className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:shadow-md transition-all">{t('modeling.addDoorHole')}</button></div>
                  {b.doorHoles.map(door => (
                    <div key={door.id} className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 space-y-2 border border-blue-200 dark:border-blue-800">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <input value={door.name} onChange={e => updateDoorHole(b.id, door.id, 'name', e.target.value)} className="text-xs bg-transparent text-gray-800 dark:text-gray-200 border-b border-transparent focus:border-blue-500 outline-none" />
                          <button onClick={() => updateDoorHole(b.id, door.id, 'open', !door.open)} className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${door.open ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'}`}>
                            {door.open ? t('modeling.doorOpen') : t('modeling.doorClose')}
                          </button>
                        </div>
                        <button onClick={() => removeDoorHole(b.id, door.id)} className="text-red-400 hover:text-red-600 rounded px-2 py-0.5 text-xs transition-all">✕</button>
                      </div>
                      {/* 位置和尺寸调整 — 无"方向"选项 */}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <label><span className="text-gray-500 dark:text-gray-400">{t('modeling.offset')}</span>
                          <NumberInput step="0.05" value={door.offsetFromLeft} onValueChange={(val) => updateDoorHole(b.id, door.id, 'offsetFromLeft', val)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-0.5" />
                        </label>
                        <label><span className="text-gray-500 dark:text-gray-400">{t('modeling.doorWidth')}</span>
                          <NumberInput step="0.05" value={door.width} onValueChange={(val) => updateDoorHole(b.id, door.id, 'width', val)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-0.5" />
                        </label>
                        <label><span className="text-gray-500 dark:text-gray-400">{t('modeling.doorHeight')}</span>
                          <NumberInput step="0.05" value={door.height} onValueChange={(val) => updateDoorHole(b.id, door.id, 'height', val)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 mt-0.5" />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionPanel>

      {/* ===== 电器 ===== */}
      <SectionPanel sectionId="devices" activeSection={activeSection} title={t('section.devices')} iconSkeuomorphic="🏭" iconFlat="⚡" iconBg="from-indigo-400 to-purple-500" badge={t('common.count', { n: room.devices.length })}>
        {/* 类别切换 — 每行 4 个 */}
        <div className="grid grid-cols-4 gap-1.5">
          {CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => { setSelectedCategory(cat.id); setSelectedDevice(null); setBrandFilter('__all__'); setSearchQuery(''); }}
              className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all text-center ${selectedCategory === cat.id ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300'}`}>
              {cat.icon} {t(cat.nameKey)}
            </button>
          ))}
        </div>
        {/* 搜索 + 品牌 */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('modeling.searchDevice')}
              className="w-full border border-gray-300 dark:border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 transition-all" />
          </div>
          <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} className="border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500">
            {brandsInCategory.map(b => <option key={b} value={b}>{b === '__all__' ? t('modeling.allBrands') : b}</option>)}
          </select>
        </div>
        {/* 设备库列表 — 分页显示，每页最多 DEVICE_PER_PAGE 项 */}
        <div className="space-y-1.5 pr-1">
          {filteredDevices.length === 0 ? <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">{searchQuery ? t('modeling.noDeviceFound', { q: searchQuery }) : t('modeling.noDevice')}</p> : (
            (() => {
              const totalPages = Math.max(1, Math.ceil(filteredDevices.length / DEVICE_PER_PAGE));
              const safePage = Math.min(devicePage, totalPages - 1);
              const paged = filteredDevices.slice(safePage * DEVICE_PER_PAGE, safePage * DEVICE_PER_PAGE + DEVICE_PER_PAGE);
              return (
                <>
                  {paged.map(device => (
                    <button key={device.id} onClick={() => { setSelectedDevice(device); setSelectedMode(0); }}
                      className={`w-full text-left p-2.5 rounded-lg border transition-all ${selectedDevice?.id === device.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-500'}`}>
                      <div className="flex justify-between items-center">
                        <div><p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{device.name}</p><p className="text-xs text-gray-500 dark:text-gray-400">{device.brand}</p></div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{device.geometry.length.toFixed(2)}×{device.geometry.width.toFixed(2)}×{device.geometry.height.toFixed(2)}m</div>
                      </div>
                    </button>
                  ))}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
                      <button onClick={() => setDevicePage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                        className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700 transition-all">{t('modeling.prevPage')}</button>
                      <span className="px-2">{safePage + 1} / {totalPages}</span>
                      <button onClick={() => setDevicePage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                        className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700 transition-all">{t('modeling.nextPage')}</button>
                    </div>
                  )}
                </>
              );
            })()
          )}
        </div>
        {/* 选中设备详情卡片 + "添加到场景"按钮 */}
        {selectedDevice && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-3 border border-blue-200 dark:border-blue-800">
            <h4 className="font-bold text-gray-800 dark:text-gray-200">{selectedDevice.name}</h4>
            <div><label className="text-xs text-gray-600 dark:text-gray-400 font-medium">{t('modeling.workMode')}</label>
              <select value={selectedMode} onChange={e => setSelectedMode(parseInt(e.target.value))} className="w-full mt-1 border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200">
                {selectedDevice.modes.map((mode, idx) => (<option key={idx} value={idx}>{mode.name} — {mode.power}W — {mode.outletTemp}°C</option>))}
              </select>
            </div>
            <button onClick={handleAddDeviceFromLibrary} className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white py-2 rounded-lg font-medium hover:shadow-lg transition-all">{t('modeling.addToScene')}</button>
          </div>
        )}
        {/* 已添加到场景 */}
        {room.devices.length > 0 && (
          <div className="space-y-2">
            <div className="border-t border-dashed border-gray-300 dark:border-slate-600" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('modeling.sceneDevices')}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">({room.devices.length})</span>
            </div>
            <div className="space-y-2 pr-1">
            {room.devices.map(device => (
              <div key={device.id} className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-2 space-y-2 border border-indigo-200 dark:border-indigo-800">
                <div className="flex justify-between items-center">
                  <div className="flex-1"><input value={device.name} onChange={e => setRoom(prev => ({ ...prev, devices: prev.devices.map(d => d.id === device.id ? { ...d, name: e.target.value } : d) }))}
                    className="font-medium text-sm bg-transparent text-gray-800 dark:text-gray-200 border-b border-transparent hover:border-gray-400 dark:hover:border-slate-500 focus:border-blue-500 outline-none" /><p className="text-xs text-gray-500 dark:text-gray-400">{t(CATEGORY_NAME_KEYS[device.category])}</p></div>
                  <button onClick={() => removeDevice(device.id)} className="text-red-400 hover:text-red-600 rounded px-2 py-1 text-xs transition-all ml-2">✕</button>
                </div>
                <div className="grid grid-cols-3 gap-1 text-xs">
                  {(['x', 'y', 'z'] as const).map(k => (
                    <label key={k}><span className="text-gray-500 dark:text-gray-400">{k.toUpperCase()}</span>
                      <NumberInput step="0.1" value={device.position[k]} onValueChange={(val) => setRoom(prev => ({ ...prev, devices: prev.devices.map(d => d.id === device.id ? { ...d, position: { ...d.position, [k]: val } } : d) }))}
                        className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200" />
                    </label>
                  ))}
                </div>
                <label className="text-xs"><span className="text-gray-500 dark:text-gray-400 font-medium">{t('modeling.rotZ')}</span>
                  <NumberInput step="5" value={Math.round((device.rotZ ?? 0) * 180 / Math.PI)} onValueChange={(val) => setRoom(prev => ({ ...prev, devices: prev.devices.map(d => d.id === device.id ? { ...d, rotZ: val * Math.PI / 180 } : d) }))}
                    className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                </label>
              </div>
            ))}
            </div>
          </div>
        )}
      </SectionPanel>

      {/* ===== 家具 ===== */}
      <SectionPanel sectionId="furniture" activeSection={activeSection} title={t('section.furniture')} iconSkeuomorphic="🛋️" iconFlat="⌂" iconBg="from-amber-400 to-orange-500" badge={t('common.count', { n: furniture.length })}>
        {/* 类型切换 — 每行 4 个 */}
        <div className="grid grid-cols-4 gap-1.5">
          {FURNITURE_CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => { setFurnCategory(cat.id); setFurnSearch(''); setFurnSubcategoryFilter('__all__'); }}
              className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all text-center ${furnCategory === cat.id && furnSearch !== '__custom__' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300'}`}>
              {cat.icon} {cat.name}
            </button>
          ))}
          <button onClick={() => { setFurnCategory('sofa'); setFurnSearch('__custom__'); }}
            className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all text-center ${furnSearch === '__custom__' ? 'bg-amber-500 text-white shadow-md' : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300'}`}>
            {t('modeling.custom')}
          </button>
        </div>
        {/* 搜索 + 形状筛选 */}
        {furnSearch !== '__custom__' && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
              <input type="text" value={furnSearch} onChange={e => setFurnSearch(e.target.value)} placeholder={t('modeling.searchFurniture')}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 transition-all" />
            </div>
            <select value={furnSubcategoryFilter} onChange={e => setFurnSubcategoryFilter(e.target.value)}
              className="border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500">
              <option value="__all__">{t('modeling.furnitureSubtypeAll')}</option>
              {FURNITURE_SUBCATEGORY_OPTIONS[furnCategory].map(sub => (
                <option key={sub.id} value={sub.id}>{t(sub.labelKey)}</option>
              ))}
            </select>
          </div>
        )}
        {/* 模型库列表 / 自定义 */}
        {furnSearch === '__custom__' ? (
          <button onClick={addFurniture} className="w-full text-xs bg-gradient-to-r from-amber-400 to-orange-500 text-white px-3 py-1.5 rounded-lg hover:shadow-md transition-all">{t('modeling.addCustomFurniture')}</button>
        ) : (
          <div className="space-y-1.5 pr-1">
            {(() => {
              let list = getFurnitureByCategory(furnCategory);
              if (furnSubcategoryFilter !== '__all__') {
                list = list.filter(f => f.subcategory === furnSubcategoryFilter);
              }
              if (furnSearch.trim()) {
                const q = furnSearch.trim().toLowerCase();
                list = list.filter(f => f.name.toLowerCase().includes(q));
              }
              if (list.length === 0) return <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-3">{(furnSearch || furnSubcategoryFilter !== '__all__') ? t('modeling.noFurnitureFound') : t('modeling.noFurniture')}</p>;
              // 分页：每页最多 FURN_PER_PAGE 项，避免长列表撑满整栏
              const totalPages = Math.max(1, Math.ceil(list.length / FURN_PER_PAGE));
              const safePage = Math.min(furnPage, totalPages - 1);
              const paged = list.slice(safePage * FURN_PER_PAGE, safePage * FURN_PER_PAGE + FURN_PER_PAGE);
              return (
                <>
                  {paged.map(preset => (
                    <button key={preset.id} onClick={() => addFurniturePreset(preset.id)}
                      className="w-full text-left p-2.5 rounded-lg border border-gray-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-500 transition-all">
                      <div className="flex justify-between items-center">
                        <div><p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{preset.name}</p><p className="text-xs text-gray-500 dark:text-gray-400">{preset.placement.description}</p></div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{preset.dims[0]}×{preset.dims[1]}×{preset.dims[2]}m</div>
                      </div>
                    </button>
                  ))}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
                      <button onClick={() => setFurnPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                        className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700 transition-all">{t('modeling.prevPage')}</button>
                      <span className="px-2">{safePage + 1} / {totalPages}</span>
                      <button onClick={() => setFurnPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                        className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700 transition-all">{t('modeling.nextPage')}</button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
        <div className="border-t border-dashed border-gray-300 dark:border-slate-600" />
        <div className="flex items-center gap-2"><span className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('modeling.sceneFurniture')}</span><span className="text-xs text-gray-500 dark:text-gray-400">({furniture.length})</span></div>
        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {furniture.length === 0 && <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">{t('modeling.noFurniture')}</div>}
          {furniture.map(b => (
            <div key={b.id} className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 space-y-2 border border-amber-200 dark:border-amber-800">
              <div className="flex justify-between items-center">
                <input value={b.name} onChange={e => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, name: e.target.value } : x) }))}
                  className="font-medium text-sm bg-transparent text-gray-800 dark:text-gray-200 border-b border-transparent focus:border-blue-500 outline-none flex-1" />
                <div className="flex items-center gap-1 ml-2">
                  {/* <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                    {SHAPE_OPTIONS.find(o => o.value === b.shape)?.label ?? '长方体'}
                  </span> */}
                  <button onClick={() => removeBox(b.id)} className="text-red-400 hover:text-red-600 rounded px-2 py-1 text-xs transition-all">✕</button>
                </div>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-1 text-xs">
                  {[['x', 'x', b.x], ['y', 'y', b.y], ['z', 'z', b.z]].map(([k, label, v]) => (
                    <label key={k as string}><span className="text-gray-500 dark:text-gray-400 font-medium">{label}</span>
                      <NumberInput step="0.1" value={v as number} onValueChange={(val) => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, [k]: val } : x) }))}
                        className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                    </label>
                  ))}
                </div>
                {b.parts && b.parts.length > 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-slate-800/50 rounded p-2">
                    {t('modeling.compositeFurniture', { n: b.parts.length, l: b.L, w: b.W, h: b.H })}
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{t('modeling.compositeTip')}</div>
                  </div>
                ) : (
                  <DimsRow shape={b.shape ?? 'box'} L={b.L} W={b.W} H={b.H}
                    onDim={(key, val) => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, [key]: val } : x) }))} />
                )}
              </div>
              {(!b.parts || b.parts.length === 0) ? (
                <ShapeRotRow shape={b.shape ?? 'box'} rotZRad={b.rotZ ?? 0}
                  onShape={s => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, shape: s } : x) }))}
                  onRotZ={rad => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, rotZ: rad } : x) }))} />
              ) : (
                <label className="text-xs"><span className="text-gray-500 dark:text-gray-400 font-medium">{t('modeling.rotZ')}</span>
                  <NumberInput step="5" value={Math.round((b.rotZ ?? 0) * 180 / Math.PI)} onValueChange={(val) => setRoom(prev => ({ ...prev, boxes: prev.boxes.map(x => x.id === b.id ? { ...x, rotZ: val * Math.PI / 180 } : x) }))}
                    className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                </label>
              )}
            </div>
          ))}
        </div>
      </SectionPanel>

      {/* ===== 通风口 ===== */}
      <SectionPanel sectionId="vents" activeSection={activeSection} title={t('section.vents')} iconSkeuomorphic="💨" iconFlat="◎" iconBg="from-blue-400 to-cyan-500" badge={t('common.count', { n: room.vents.length })}>
        <div className="flex gap-2">
          <button onClick={() => addVent('velocity_inlet')} className="text-xs bg-gradient-to-r from-blue-400 to-blue-600 text-white px-3 py-1.5 rounded-lg hover:shadow-md transition-all">{t('modeling.addInlet')}</button>
          <button onClick={() => addVent('pressure_outlet')} className="text-xs bg-gradient-to-r from-amber-400 to-orange-500 text-white px-3 py-1.5 rounded-lg hover:shadow-md transition-all">{t('modeling.addOutlet')}</button>
        </div>
        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {room.vents.length === 0 && <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">{t('modeling.noVent')}</div>}
          {room.vents.map(v => (
            <div key={v.id} className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-2 border border-blue-200 dark:border-blue-800">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <input value={v.name} onChange={e => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, name: e.target.value } : x) }))}
                    className="font-medium text-sm bg-transparent text-gray-800 dark:text-gray-200 border-b border-transparent hover:border-gray-400 dark:hover:border-slate-500 focus:border-blue-500 outline-none flex-1" />
                  <span className={`text-xs px-2 py-0.5 rounded-full ${v.ventType === 'velocity_inlet' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'}`}>
                    {v.ventType === 'velocity_inlet' ? t('modeling.inlet') : t('modeling.outlet')}
                  </span>
                </div>
                <button onClick={() => removeVent(v.id)} className="text-red-400 hover:text-red-600 rounded px-2 py-1 text-xs transition-all">✕</button>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-1 text-xs">
                  {[['x', 'x', v.x], ['y', 'y', v.y], ['z', 'z', v.z]].map(([k, label, val]) => (
                    <label key={k as string}><span className="text-gray-500 dark:text-gray-400 font-medium">{label}</span>
                      <NumberInput step="0.1" value={val as number} onValueChange={(num) => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, [k]: num } : x) }))}
                        className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                    </label>
                  ))}
                </div>
                <DimsRow shape={(v.shape ?? 'box')} L={v.L} W={v.W} H={v.H}
                  onDim={(key, num) => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, [key]: num } : x) }))} />
              </div>
              <ShapeRotRow shape={v.shape ?? 'box'} rotZRad={v.rotZ ?? 0}
                onShape={s => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, shape: s } : x) }))}
                onRotZ={rad => setRoom(prev => ({ ...prev, vents: prev.vents.map(x => x.id === v.id ? { ...x, rotZ: rad } : x) }))} />
              {v.ventType === 'velocity_inlet' && (
                <div className="text-xs text-gray-600 dark:text-gray-400 bg-white/50 dark:bg-slate-800/50 rounded p-2 space-y-2">
                  <div>速度: [{v.velocity[0].toFixed(2)}, {v.velocity[1].toFixed(2)}, {v.velocity[2].toFixed(2)}] m/s · 温度: {v.temperature ?? '—'}°C</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionPanel>

      {/* ===== 热源 ===== */}
      <SectionPanel sectionId="heat-sources" activeSection={activeSection} title={t('section.heat-sources')} iconSkeuomorphic="🔥" iconFlat="◉" iconBg="from-red-400 to-pink-500" badge={t('common.count', { n: room.heatSources.length })}>
        <button onClick={addHeatSource} className="w-full text-xs bg-gradient-to-r from-red-400 to-pink-500 text-white px-3 py-1.5 rounded-lg hover:shadow-md transition-all">{t('modeling.addHeatSource')}</button>
        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {room.heatSources.length === 0 && <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">{t('modeling.noHeatSource')}</div>}
          {room.heatSources.map(h => (
            <div key={h.id} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 space-y-2 border border-red-200 dark:border-red-800">
              <div className="flex justify-between items-center">
                <input value={h.name} onChange={e => setRoom(prev => ({ ...prev, heatSources: prev.heatSources.map(x => x.id === h.id ? { ...x, name: e.target.value } : x) }))}
                  className="font-medium text-sm bg-transparent text-gray-800 dark:text-gray-200 border-b border-transparent hover:border-gray-400 dark:hover:border-slate-500 focus:border-blue-500 outline-none flex-1" />
                <button onClick={() => removeHeatSource(h.id)} className="text-red-400 hover:text-red-600 rounded px-2 py-1 text-xs transition-all">✕</button>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-1 text-xs">
                  {[['x', 'x', h.x], ['y', 'y', h.y], ['z', 'z', h.z]].map(([k, label, v]) => (
                    <label key={k as string}><span className="text-gray-500 dark:text-gray-400 font-medium">{label}</span>
                      <NumberInput step="0.1" value={v as number} onValueChange={(num) => setRoom(prev => ({ ...prev, heatSources: prev.heatSources.map(x => x.id === h.id ? { ...x, [k]: num } : x) }))}
                        className="w-full border border-gray-300 dark:border-slate-600 rounded px-1 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
                    </label>
                  ))}
                </div>
                <DimsRow shape={(h.shape ?? 'box')} L={h.L} W={h.W} H={h.H}
                  onDim={(key, num) => setRoom(prev => ({ ...prev, heatSources: prev.heatSources.map(x => x.id === h.id ? { ...x, [key]: num } : x) }))} />
              </div>
              <ShapeRotRow shape={h.shape ?? 'box'} rotZRad={h.rotZ ?? 0}
                onShape={s => setRoom(prev => ({ ...prev, heatSources: prev.heatSources.map(x => x.id === h.id ? { ...x, shape: s } : x) }))}
                onRotZ={rad => setRoom(prev => ({ ...prev, heatSources: prev.heatSources.map(x => x.id === h.id ? { ...x, rotZ: rad } : x) }))} />
              <div className="text-xs text-gray-600 dark:text-gray-400">{t('modeling.heatTempTip', { temp: h.temperature })}</div>
            </div>
          ))}
        </div>
      </SectionPanel>
    </div>
  );
}
