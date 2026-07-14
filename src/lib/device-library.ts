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

// 设备模型库：空调、暖气等标准设备型号

import { type FurniturePart } from '@/lib/room-layout';

export interface DeviceModel {
  id: string;
  name: string;
  brand: string;
  category: 'air_conditioner' | 'heater' | 'fan' | 'heat_pump' | 'tv' | 'range_hood' | 'exhaust_fan' | 'air_purifier';

  // 纯热源设备（无风口，如电视、油汀）：勾选后该设备在仿真中同时作为热源存在，
  // 表面温度取当前模式 outletTemp。设备库中显式声明，避免在 page.tsx 里按
  // category 硬编码判断（更可扩展）。
  emitsHeat?: boolean;

  // 几何尺寸 [m]（设备包围盒：length=X, width=Y, height=Z）
  geometry: {
    length: number;  // X方向
    width: number;   // Y方向
    height: number;  // Z方向
  };

  // 设备外观组合部件（与家具一致的多体组合）。坐标系：以设备包围盒最小角为原点，
  // x沿length、y沿width、z沿height。未提供时退化为单一长方体(整包围盒)。
  // 这些部件仅用于渲染；栅格化障碍物用包围盒整体（设备通常近似为实心体）。
  bodyParts?: FurniturePart[];

  // 出风口配置。position 为风口【中心】相对设备最小角的位置 [m]（在设备自身系，
  // 未旋转）；渲染/引擎会减去半尺寸得到最小角，再随设备 rotZ 旋转。
  outlets: Array<{
    name: string;
    position: [number, number, number]; // 风口中心相对设备最小角 [m]
    size: [number, number, number];     // 尺寸 [L, W, H] [m]
    defaultVelocity: [number, number, number]; // 默认速度(设备自身系) [m/s]
  }>;

  // 回风口配置（同上，position 为风口中心）
  inlets: Array<{
    name: string;
    position: [number, number, number];
    size: [number, number, number];
    mode: 'pressure' | 'velocity';
    defaultVelocity?: [number, number, number];
  }>;

  // 工作模式参数
  modes: Array<{
    name: string;          // 例如：制冷、制热、送风
    power: number;         // 功率 [W]
    outletTemp: number;    // 出风温度 [°C]
    outletVelocity: number; // 出风速度 [m/s]
    inletMode?: 'pressure' | 'velocity';
    inletVelocity?: number;
  }>;

  // 默认安装位置建议
  defaultPlacement: {
    x: number;
    y: number;
    z: number;
    description: string; // 例如："靠墙顶部"
  };
}

// ---- 部件构造小工具：以最小角坐标 + 尺寸生成一个 box 部件 ----
const _box = (x: number, y: number, z: number, L: number, W: number, H: number, color?: string): FurniturePart =>
  ({ x, y, z, L, W, H, shape: 'box', color });

// 水平截面三棱柱部件：截面为直角三角形，顶点 (x,y),(x+L,y),(x,y-W)，
// 直角在 (x,y)，斜面为竖直面；p.y 为截面上沿(y大)，几何中心在 (x+L/2, y-W/2)。
const _prism = (x: number, y: number, z: number, L: number, W: number, H: number, color?: string): FurniturePart =>
  ({ x, y, z, L, W, H, shape: 'prism', color });

// 立面楔形三棱柱部件：截面在 y-z 立面，挤出沿 x。用于侧吸式油烟机：
// 后下(y+W,z)→后上(y+W,z+H)→前下(y,z)，斜面连接后上与前下，形成倾斜抽吸面。
const _prismY = (x: number, y: number, z: number, L: number, W: number, H: number, color?: string): FurniturePart =>
  ({ x, y, z, L, W, H, shape: 'prism_y', color });

// 预定义设备库
export const DEVICE_LIBRARY: DeviceModel[] = [
  // ==================== 壁挂式空调 ====================
  {
    id: 'ac-wall-gree-1.5hp',
    name: '壁挂式空调 1.5匹',
    brand: '格力',
    category: 'air_conditioner',
    geometry: { length: 0.85, width: 0.30, height: 0.28 },
    bodyParts: (() => {
      const L = 0.85, W = 0.30, H = 0.28;
      return [
        _box(0, 0, 0, L, W, H, '#e2e8f0'),                 // 外壳(白)
        _box(0, W - 0.04, 0.02, L, 0.04, H - 0.04, '#cbd5e1'), // 前面板
        _box(0.02, W - 0.06, 0.0, L - 0.04, 0.06, 0.05, '#94a3b8'), // 底部出风格栅
      ];
    })(),
    outlets: [{
      name: '出风口',
      position: [0.425, 0.02, 0.02],     // 前下沿(中心)
      size: [0.60, 0.04, 0.04],
      defaultVelocity: [0, -1.80, -0.5],  // 向前下方吹(自身系: -Y前, -Z下)
    }],
    inlets: [{
      name: '回风口',
      position: [0.425, 0.15, 0.27],     // 顶部中央(中心)
      size: [0.50, 0.20, 0.02],
      mode: 'velocity',
      defaultVelocity: [0, 0, -0.5],       // 向上吸入(+Z)
    }],
    modes: [
      { name: '制冷-强', power: 3500, outletTemp: 16, outletVelocity: 0.10, inletMode: 'velocity', inletVelocity: 0.06 },
      { name: '制冷-中', power: 2500, outletTemp: 18, outletVelocity: 0.08, inletMode: 'velocity', inletVelocity: 0.05 },
      { name: '制冷-弱', power: 1500, outletTemp: 20, outletVelocity: 0.06, inletMode: 'velocity', inletVelocity: 0.04 },
      { name: '制热-强', power: 3800, outletTemp: 35, outletVelocity: 0.10, inletMode: 'velocity', inletVelocity: 0.06 },
      { name: '制热-中', power: 2800, outletTemp: 32, outletVelocity: 0.08, inletMode: 'velocity', inletVelocity: 0.05 },
      { name: '送风', power: 50, outletTemp: 25, outletVelocity: 0.05, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 4.8, z: 2.4, description: '靠墙顶部，距地面2.4m' },
  },

  {
    id: 'ac-wall-midea-1hp',
    name: '壁挂式空调 1匹',
    brand: '美的',
    category: 'air_conditioner',
    geometry: { length: 0.78, width: 0.28, height: 0.25 },
    bodyParts: (() => {
      const L = 0.78, W = 0.28, H = 0.25;
      return [
        _box(0, 0, 0, L, W, H, '#e2e8f0'),
        _box(0, W - 0.04, 0.02, L, 0.04, H - 0.04, '#cbd5e1'),
        _box(0.02, W - 0.06, 0.0, L - 0.04, 0.06, 0.04, '#94a3b8'),
      ];
    })(),
    outlets: [{
      name: '出风口',
      position: [0.39, 0.02, 0.02],
      size: [0.55, 0.04, 0.04],
      defaultVelocity: [0, -1.50, -0.4],
    }],
    inlets: [{
      name: '回风口',
      position: [0.39, 0.14, 0.24],
      size: [0.45, 0.18, 0.02],
      mode: 'velocity',
      defaultVelocity: [0, 0, -0.45],
    }],
    modes: [
      { name: '制冷-强', power: 2600, outletTemp: 17, outletVelocity: 0.09, inletMode: 'velocity', inletVelocity: 0.055 },
      { name: '制冷-中', power: 1900, outletTemp: 19, outletVelocity: 0.07, inletMode: 'velocity', inletVelocity: 0.045 },
      { name: '制热-强', power: 2900, outletTemp: 34, outletVelocity: 0.09, inletMode: 'velocity', inletVelocity: 0.055 },
      { name: '送风', power: 40, outletTemp: 25, outletVelocity: 0.045, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 4.8, z: 2.3, description: '靠墙顶部，距地面2.3m' },
  },

  // ==================== 柜式空调 ====================
  {
    id: 'ac-cabinet-gree-3hp',
    name: '柜式空调 3匹',
    brand: '格力',
    category: 'air_conditioner',
    geometry: { length: 0.50, width: 0.35, height: 1.80 },
    bodyParts: (() => {
      const L = 0.50, W = 0.35, H = 1.80;
      return [
        _box(0, 0, 0, L, W, H, '#f1f5f9'),                  // 主体(白)
        _box(0, W - 0.03, 0.05, L, 0.03, 1.70, '#cbd5e1'),   // 前面板
        _box(0.05, W - 0.05, 1.55, L - 0.10, 0.05, 0.20, '#94a3b8'), // 上部出风格栅
        _box(0.05, W - 0.05, 0.20, L - 0.10, 0.05, 1.10, '#94a3b8'), // 中下部进风格栅
      ];
    })(),
    outlets: [{
      name: '出风口',
      position: [0.25, 0.02, 1.65],     // 前面上部(中心)
      size: [0.40, 0.04, 0.20],
      defaultVelocity: [0, -1.20, 0.10], // 向前吹(自身系 -Y)，略上扬
    }],
    inlets: [{
      name: '回风口',
      position: [0.25, 0.02, 0.75],     // 前面中下部(中心)
      size: [0.35, 0.04, 0.60],
      mode: 'velocity',
      defaultVelocity: [0, 0.6, 0],      // 向前吸入(回流 -Y)
    }],
    modes: [
      { name: '制冷-强', power: 7200, outletTemp: 15, outletVelocity: 0.15, inletMode: 'velocity', inletVelocity: 0.09 },
      { name: '制冷-中', power: 5500, outletTemp: 17, outletVelocity: 0.12, inletMode: 'velocity', inletVelocity: 0.075 },
      { name: '制冷-弱', power: 3800, outletTemp: 19, outletVelocity: 0.09, inletMode: 'velocity', inletVelocity: 0.06 },
      { name: '制热-强', power: 7800, outletTemp: 38, outletVelocity: 0.15, inletMode: 'velocity', inletVelocity: 0.09 },
      { name: '制热-中', power: 6000, outletTemp: 35, outletVelocity: 0.12, inletMode: 'velocity', inletVelocity: 0.075 },
      { name: '送风', power: 80, outletTemp: 25, outletVelocity: 0.08, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 0.3, y: 0.3, z: 0.0, description: '墙角地面，距墙0.3m' },
  },

  {
    id: 'ac-wall-haier-2hp',
    name: '壁挂式空调 2匹',
    brand: '海尔',
    category: 'air_conditioner',
    geometry: { length: 0.95, width: 0.32, height: 0.30 },
    bodyParts: (() => {
      const L = 0.95, W = 0.32, H = 0.30;
      return [
        _box(0, 0, 0, L, W, H, '#e2e8f0'),
        _box(0, W - 0.04, 0.02, L, 0.04, H - 0.04, '#cbd5e1'),
        _box(0.02, W - 0.06, 0.0, L - 0.04, 0.06, 0.06, '#94a3b8'),
      ];
    })(),
    outlets: [{
      name: '出风口',
      position: [0.475, 0.02, 0.02],
      size: [0.70, 0.04, 0.04],
      defaultVelocity: [0, -2.00, -0.5],
    }],
    inlets: [{
      name: '回风口',
      position: [0.475, 0.16, 0.28],
      size: [0.55, 0.20, 0.02],
      mode: 'velocity',
      defaultVelocity: [0, 0, -0.5],
    }],
    modes: [
      { name: '制冷-强', power: 5000, outletTemp: 16, outletVelocity: 0.12, inletMode: 'velocity', inletVelocity: 0.07 },
      { name: '制冷-中', power: 3800, outletTemp: 18, outletVelocity: 0.10, inletMode: 'velocity', inletVelocity: 0.06 },
      { name: '制热-强', power: 5400, outletTemp: 36, outletVelocity: 0.12, inletMode: 'velocity', inletVelocity: 0.07 },
      { name: '送风', power: 60, outletTemp: 25, outletVelocity: 0.06, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 4.8, z: 2.4, description: '靠墙顶部，距地面2.4m' },
  },

  {
    id: 'ac-window-1.5hp',
    name: '窗式空调 1.5匹',
    brand: '海信',
    category: 'air_conditioner',
    geometry: { length: 0.60, width: 0.45, height: 0.40 },
    bodyParts: (() => {
      const L = 0.60, W = 0.45, H = 0.40;
      return [
        _box(0, 0, 0, L, W, H, '#e5e7eb'),                  // 整体机壳
        _box(0.04, 0.0, 0.04, L - 0.08, 0.03, H - 0.08, '#9ca3af'), // 前出风格栅
        _box(0.04, W - 0.05, 0.04, L - 0.08, 0.05, H - 0.08, '#6b7280'), // 后冷凝器侧
      ];
    })(),
    outlets: [{
      name: '出风口',
      position: [0.30, 0.02, 0.20],
      size: [0.45, 0.04, 0.20],
      defaultVelocity: [0, -1.60, -0.3],
    }],
    inlets: [{
      name: '回风口',
      position: [0.30, 0.20, 0.36],
      size: [0.40, 0.18, 0.02],
      mode: 'velocity',
      defaultVelocity: [0, 0, -0.4],
    }],
    modes: [
      { name: '制冷-强', power: 3500, outletTemp: 17, outletVelocity: 0.10, inletMode: 'velocity', inletVelocity: 0.06 },
      { name: '制冷-中', power: 2500, outletTemp: 19, outletVelocity: 0.08, inletMode: 'velocity', inletVelocity: 0.05 },
      { name: '制热-强', power: 3800, outletTemp: 34, outletVelocity: 0.10, inletMode: 'velocity', inletVelocity: 0.06 },
      { name: '送风', power: 50, outletTemp: 25, outletVelocity: 0.05, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 4.85, z: 1.6, description: '窗台或墙洞，距地面1.6m' },
  },

  {
    id: 'ac-cabinet-midea-5hp',
    name: '柜式空调 5匹',
    brand: '美的',
    category: 'air_conditioner',
    geometry: { length: 0.60, width: 0.40, height: 1.90 },
    bodyParts: (() => {
      const L = 0.60, W = 0.40, H = 1.90;
      return [
        _box(0, 0, 0, L, W, H, '#f1f5f9'),
        _box(0, W - 0.03, 0.05, L, 0.03, 1.80, '#cbd5e1'),
        _box(0.05, W - 0.05, 1.60, L - 0.10, 0.05, 0.25, '#94a3b8'),
        _box(0.05, W - 0.05, 0.20, L - 0.10, 0.05, 1.20, '#94a3b8'),
      ];
    })(),
    outlets: [{
      name: '出风口',
      position: [0.30, 0.02, 1.70],
      size: [0.48, 0.04, 0.25],
      defaultVelocity: [0, -1.40, 0.10],
    }],
    inlets: [{
      name: '回风口',
      position: [0.30, 0.02, 0.80],
      size: [0.42, 0.04, 0.65],
      mode: 'velocity',
      defaultVelocity: [0, 0.7, 0],
    }],
    modes: [
      { name: '制冷-强', power: 12000, outletTemp: 15, outletVelocity: 0.18, inletMode: 'velocity', inletVelocity: 0.11 },
      { name: '制冷-中', power: 9000, outletTemp: 17, outletVelocity: 0.14, inletMode: 'velocity', inletVelocity: 0.085 },
      { name: '制热-强', power: 13000, outletTemp: 38, outletVelocity: 0.18, inletMode: 'velocity', inletVelocity: 0.11 },
      { name: '送风', power: 100, outletTemp: 25, outletVelocity: 0.09, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 0.3, y: 0.3, z: 0.0, description: '墙角地面，距墙0.3m' },
  },

  // ==================== 电暖器 ====================
  {
    id: 'heater-oil-2000w',
    name: '油汀电暖器 2000W',
    brand: '美的',
    category: 'heater',
    emitsHeat: true,
    geometry: { length: 0.60, width: 0.25, height: 0.65 },
    bodyParts: (() => {
      const L = 0.60, W = 0.25, H = 0.65;
      const parts: FurniturePart[] = [
        _box(0, 0, 0, L, 0.05, 0.06, '#475569'),   // 底座
        _box(0, 0, H - 0.05, L, 0.05, 0.05, '#475569'), // 顶盖
      ];
      // 散热片：7 片竖立薄片
      const n = 7, finT = 0.05, gap = (L - n * finT) / (n + 1);
      for (let i = 0; i < n; i++) {
        const fx = gap + i * (finT + gap);
        parts.push(_box(fx, 0.02, 0.04, finT, W - 0.04, H - 0.10, '#334155'));
      }
      return parts;
    })(),
    outlets: [],  // 油汀是热源，不是风口
    inlets: [],
    modes: [
      { name: '高温', power: 2000, outletTemp: 60, outletVelocity: 0 },
      { name: '中温', power: 1500, outletTemp: 50, outletVelocity: 0 },
      { name: '低温', power: 1000, outletTemp: 40, outletVelocity: 0 },
    ],
    defaultPlacement: { x: 1.0, y: 0.2, z: 0.0, description: '墙边地面' },
  },

  {
    id: 'heater-ptc-1500w',
    name: 'PTC陶瓷暖风机 1500W',
    brand: '艾美特',
    category: 'heater',
    geometry: { length: 0.25, width: 0.20, height: 0.35 },
    bodyParts: (() => {
      const L = 0.25, W = 0.20, H = 0.35;
      return [
        _box(0, 0, 0, L, W, H, '#dc2626'),                 // 外壳(红)
        _box(0, 0.0, 0.03, L, 0.03, H - 0.06, '#1f2937'),  // 前出风格栅(黑, y≈0)
      ];
    })(),
    outlets: [{
      name: '出风口',
      position: [0.125, 0.015, 0.175],  // 前面中央(中心)
      size: [0.18, 0.03, 0.25],
      defaultVelocity: [0, -1.50, 0],     // 向前吹(自身系 -Y)
    }],
    inlets: [{
      name: '进风口',
      position: [0.125, 0.19, 0.175],   // 后面中央(中心)
      size: [0.15, 0.02, 0.20],
      mode: 'pressure',
    }],
    modes: [
      { name: '强热', power: 1500, outletTemp: 45, outletVelocity: 0.15 },
      { name: '中热', power: 1000, outletTemp: 38, outletVelocity: 0.12 },
      { name: '送风', power: 30, outletTemp: 25, outletVelocity: 0.10 },
    ],
    defaultPlacement: { x: 1.0, y: 0.3, z: 0.5, description: '桌面或地面' },
  },

  {
    id: 'heater-convector-2000w',
    name: '对流式电暖器 2000W',
    brand: '先锋',
    category: 'heater',
    emitsHeat: true,
    geometry: { length: 0.70, width: 0.12, height: 0.55 },
    bodyParts: (() => {
      const L = 0.70, W = 0.12, H = 0.55;
      return [
        _box(0, 0, 0, L, W, H, '#e5e7eb'),                   // 扁平机身(白)
        _box(0.04, 0, 0.04, L - 0.08, 0.02, H - 0.12, '#9ca3af'), // 前出风格栅
        _box(0.04, W - 0.02, 0.04, L - 0.08, 0.02, H - 0.12, '#9ca3af'), // 后进风格栅
        _box(L / 2 - 0.15, 0, -0.02, 0.30, 0.08, 0.04, '#475569'), // 底脚
      ];
    })(),
    outlets: [{
      name: '顶部出风',
      position: [0.35, 0.06, 0.55],
      size: [0.55, 0.04, 0.02],
      defaultVelocity: [0, 0, 1.20],
    }],
    inlets: [{
      name: '进风口',
      position: [0.35, 0.11, 0.25],
      size: [0.50, 0.02, 0.30],
      mode: 'pressure',
    }],
    modes: [
      { name: '高温', power: 2000, outletTemp: 55, outletVelocity: 0.10 },
      { name: '中温', power: 1500, outletTemp: 45, outletVelocity: 0.08 },
      { name: '低温', power: 1000, outletTemp: 38, outletVelocity: 0.06 },
    ],
    defaultPlacement: { x: 1.0, y: 0.1, z: 0.0, description: '墙边地面' },
  },

  {
    id: 'heater-film-1800w',
    name: '电热膜暖器 1800W',
    brand: '格力',
    category: 'heater',
    emitsHeat: true,
    geometry: { length: 0.55, width: 0.22, height: 0.70 },
    bodyParts: (() => {
      const L = 0.55, W = 0.22, H = 0.70;
      const parts: FurniturePart[] = [
        _box(0, 0, 0, L, 0.04, 0.06, '#475569'),     // 底座
        _box(0, 0, H - 0.04, L, 0.04, 0.04, '#475569'), // 顶盖
      ];
      // 电热膜竖片
      const n = 5, finT = 0.04, gap = (L - n * finT) / (n + 1);
      for (let i = 0; i < n; i++) {
        const fx = gap + i * (finT + gap);
        parts.push(_box(fx, 0.02, 0.04, finT, W - 0.04, H - 0.10, '#1f2937'));
      }
      return parts;
    })(),
    outlets: [],
    inlets: [],
    modes: [
      { name: '高温', power: 1800, outletTemp: 58, outletVelocity: 0 },
      { name: '中温', power: 1200, outletTemp: 48, outletVelocity: 0 },
      { name: '低温', power: 800, outletTemp: 40, outletVelocity: 0 },
    ],
    defaultPlacement: { x: 1.0, y: 0.2, z: 0.0, description: '墙边地面' },
  },

  {
    id: 'heater-halogen-800w',
    name: '小太阳暖器 800W',
    brand: '艾美特',
    category: 'heater',
    emitsHeat: true,
    geometry: { length: 0.40, width: 0.35, height: 0.55 },
    bodyParts: (() => {
      const L = 0.40, W = 0.35, H = 0.55;
      const cx = L / 2, cy = W / 2;
      return [
        _box(cx - 0.15, cy - 0.15, 0, 0.30, 0.30, 0.04, '#374151'), // 底盘
        _box(cx - 0.025, cy - 0.025, 0.04, 0.05, 0.05, 0.20, '#6b7280'), // 立杆
        _box(cx - 0.18, cy - 0.18, 0.24, 0.36, 0.36, 0.10, '#9ca3af'), // 反射罩
        _box(cx - 0.15, cy - 0.15, 0.27, 0.30, 0.02, 0.04, '#f59e0b'), // 发热管(橙)
      ];
    })(),
    outlets: [],
    inlets: [],
    modes: [
      { name: '高温', power: 800, outletTemp: 65, outletVelocity: 0 },
      { name: '低温', power: 400, outletTemp: 45, outletVelocity: 0 },
    ],
    defaultPlacement: { x: 1.0, y: 0.2, z: 0.0, description: '地面，朝向人体' },
  },

  // ==================== 电风扇 ====================
  {
    id: 'fan-stand-40cm',
    name: '落地扇 40cm',
    brand: '艾美特',
    category: 'fan',
    geometry: { length: 0.45, width: 0.40, height: 1.30 },
    bodyParts: (() => {
      const L = 0.45, W = 0.40, H = 1.30;
      const cx = L / 2, cy = W / 2;
      return [
        _box(cx - 0.18, cy - 0.18, 0, 0.36, 0.36, 0.05, '#334155'), // 底盘
        _box(cx - 0.025, cy - 0.025, 0.05, 0.05, 0.05, 0.95, '#64748b'), // 立杆
        _box(cx - 0.20, 0.02, 1.00, 0.40, 0.36, 0.10, '#475569'), // 机头外壳
        _box(cx - 0.20, 0.0, 1.00, 0.40, 0.02, 0.36, '#0f172a'), // 前网罩(y≈0)
      ];
    })(),
    outlets: [{
      name: '风扇出风',
      position: [0.225, 0.01, 1.18],   // 前网罩中央(中心)
      size: [0.40, 0.04, 0.30],
      defaultVelocity: [0, -2.50, 0],   // 向前吹(自身系 -Y)
    }],
    inlets: [],
    modes: [
      { name: '3档', power: 60, outletTemp: 25, outletVelocity: 0.30 },
      { name: '2档', power: 45, outletTemp: 25, outletVelocity: 0.20 },
      { name: '1档', power: 30, outletTemp: 25, outletVelocity: 0.12 },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 0.0, description: '房间中心地面' },
  },

  {
    id: 'fan-desk-30cm',
    name: '台扇 30cm',
    brand: '美的',
    category: 'fan',
    geometry: { length: 0.35, width: 0.30, height: 0.50 },
    bodyParts: (() => {
      const L = 0.35, W = 0.30, H = 0.50;
      const cx = L / 2, cy = W / 2;
      return [
        _box(cx - 0.12, cy - 0.12, 0, 0.24, 0.24, 0.04, '#334155'), // 底盘
        _box(cx - 0.02, cy - 0.02, 0.04, 0.04, 0.04, 0.22, '#64748b'), // 立杆
        _box(cx - 0.15, 0.02, 0.26, 0.30, 0.26, 0.08, '#475569'), // 机头
        _box(cx - 0.15, 0.0, 0.26, 0.30, 0.02, 0.26, '#0f172a'), // 前网罩
      ];
    })(),
    outlets: [{
      name: '风扇出风',
      position: [0.175, 0.01, 0.39],
      size: [0.30, 0.04, 0.22],
      defaultVelocity: [0, -2.00, 0],
    }],
    inlets: [],
    modes: [
      { name: '3档', power: 45, outletTemp: 25, outletVelocity: 0.22 },
      { name: '2档', power: 32, outletTemp: 25, outletVelocity: 0.15 },
      { name: '1档', power: 20, outletTemp: 25, outletVelocity: 0.10 },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 0.7, description: '桌面，距地面0.7m' },
  },

  {
    id: 'fan-tower-90cm',
    name: '塔扇 90cm',
    brand: '戴森',
    category: 'fan',
    geometry: { length: 0.30, width: 0.30, height: 0.95 },
    bodyParts: (() => {
      const L = 0.30, W = 0.30, H = 0.95;
      const cx = L / 2, cy = W / 2;
      return [
        _box(cx - 0.13, cy - 0.13, 0, 0.26, 0.26, 0.05, '#1f2937'), // 底座(深)
        _box(cx - 0.05, cy - 0.05, 0.05, 0.10, 0.10, 0.20, '#374151'), // 下立柱
        _box(cx - 0.10, 0.05, 0.25, 0.20, 0.20, 0.60, '#4b5563'), // 扇柱(无叶)
        _box(cx - 0.08, 0.03, 0.30, 0.16, 0.02, 0.50, '#0f172a'), // 前出风槽
      ];
    })(),
    outlets: [{
      name: '风扇出风',
      position: [0.15, 0.01, 0.55],
      size: [0.16, 0.04, 0.50],
      defaultVelocity: [0, -1.80, 0],
    }],
    inlets: [{
      name: '进风口',
      position: [0.15, 0.29, 0.55],
      size: [0.16, 0.02, 0.40],
      mode: 'pressure',
    }],
    modes: [
      { name: '强档', power: 50, outletTemp: 25, outletVelocity: 0.25 },
      { name: '中档', power: 35, outletTemp: 25, outletVelocity: 0.18 },
      { name: '静音', power: 20, outletTemp: 25, outletVelocity: 0.10 },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 0.0, description: '房间中心地面' },
  },

  {
    id: 'fan-circulator-35cm',
    name: '空气循环扇 35cm',
    brand: '艾美特',
    category: 'fan',
    geometry: { length: 0.40, width: 0.38, height: 1.05 },
    bodyParts: (() => {
      const L = 0.40, W = 0.38, H = 1.05;
      const cx = L / 2, cy = W / 2;
      return [
        _box(cx - 0.16, cy - 0.16, 0, 0.32, 0.32, 0.06, '#334155'), // 底盘(大)
        _box(cx - 0.025, cy - 0.025, 0.06, 0.05, 0.05, 0.70, '#64748b'), // 立杆
        _box(cx - 0.18, 0.02, 0.76, 0.36, 0.34, 0.12, '#1f2937'), // 深筒机头
        _box(cx - 0.17, 0.0, 0.77, 0.34, 0.02, 0.30, '#0f172a'), // 前网罩(深)
      ];
    })(),
    outlets: [{
      name: '风扇出风',
      position: [0.20, 0.01, 0.92],
      size: [0.34, 0.04, 0.28],
      defaultVelocity: [0, -3.50, 0],  // 循环扇风量大、射程远
    }],
    inlets: [],
    modes: [
      { name: '强档', power: 75, outletTemp: 25, outletVelocity: 0.40 },
      { name: '中档', power: 50, outletTemp: 25, outletVelocity: 0.25 },
      { name: '弱档', power: 30, outletTemp: 25, outletVelocity: 0.15 },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 0.0, description: '房间中心地面' },
  },

  // ==================== 电视 ====================
  {
    id: 'tv-55inch',
    name: '液晶电视 55寸',
    brand: '小米',
    category: 'tv',
    emitsHeat: true,  // 电视工作时机身散热，作为热源
    geometry: { length: 1.23, width: 0.08, height: 0.72 },
    bodyParts: (() => {
      const L = 1.23, W = 0.08, H = 0.72;
      const bezel = 0.03;
      return [
        _box(0, 0, 0, L, W, H, '#0f172a'),                              // 边框(黑)
        _box(bezel, 0, bezel, L - 2 * bezel, W, H - 2 * bezel, '#1e293b'), // 屏幕
        _box(L / 2 - 0.15, 0, -0.04, 0.30, 0.10, 0.04, '#334155'),      // 底座支架(略低于机身)
      ];
    })(),
    outlets: [],  // 无风口
    inlets: [],
    modes: [
      { name: '观看', power: 120, outletTemp: 36, outletVelocity: 0 },
      { name: '待机', power: 5, outletTemp: 28, outletVelocity: 0 },
    ],
    defaultPlacement: { x: 2.5, y: 4.92, z: 1.1, description: '靠墙，距地面1.1m（电视柜上方）' },
  },

  {
    id: 'tv-65inch',
    name: '液晶电视 65寸',
    brand: '海信',
    category: 'tv',
    emitsHeat: true,
    geometry: { length: 1.45, width: 0.08, height: 0.84 },
    bodyParts: (() => {
      const L = 1.45, W = 0.08, H = 0.84;
      const bezel = 0.025;
      return [
        _box(0, 0, 0, L, W, H, '#0f172a'),
        _box(bezel, 0, bezel, L - 2 * bezel, W, H - 2 * bezel, '#1e293b'),
        _box(L / 2 - 0.18, 0, -0.04, 0.36, 0.10, 0.04, '#334155'),
      ];
    })(),
    outlets: [],
    inlets: [],
    modes: [
      { name: '观看', power: 150, outletTemp: 38, outletVelocity: 0 },
      { name: '节能', power: 90, outletTemp: 34, outletVelocity: 0 },
      { name: '待机', power: 5, outletTemp: 28, outletVelocity: 0 },
    ],
    defaultPlacement: { x: 2.5, y: 4.92, z: 1.05, description: '靠墙，距地面1.05m（电视柜上方）' },
  },

  {
    id: 'tv-75inch',
    name: '液晶电视 75寸',
    brand: 'TCL',
    category: 'tv',
    emitsHeat: true,
    geometry: { length: 1.67, width: 0.09, height: 0.96 },
    bodyParts: (() => {
      const L = 1.67, W = 0.09, H = 0.96;
      const bezel = 0.025;
      return [
        _box(0, 0, 0, L, W, H, '#0f172a'),
        _box(bezel, 0, bezel, L - 2 * bezel, W, H - 2 * bezel, '#111827'),
        _box(0.22, 0, -0.04, 0.25, 0.10, 0.04, '#334155'), // 左脚
        _box(L - 0.47, 0, -0.04, 0.25, 0.10, 0.04, '#334155'), // 右脚
      ];
    })(),
    outlets: [],
    inlets: [],
    modes: [
      { name: '观看', power: 220, outletTemp: 40, outletVelocity: 0 },
      { name: '节能', power: 140, outletTemp: 35, outletVelocity: 0 },
      { name: '待机', power: 5, outletTemp: 28, outletVelocity: 0 },
    ],
    defaultPlacement: { x: 2.5, y: 4.92, z: 1.0, description: '靠墙，距地面1.0m（电视柜上方）' },
  },

  // ==================== 热泵 ====================
  {
    id: 'heat-pump-air-source',
    name: '空气源热泵主机',
    brand: '格力',
    category: 'heat_pump',
    geometry: { length: 0.95, width: 0.45, height: 0.80 },
    bodyParts: (() => {
      const L = 0.95, W = 0.45, H = 0.80;
      return [
        _box(0, 0, 0, L, W, H, '#e5e7eb'),
        _box(0.06, 0.0, 0.10, 0.35, 0.03, 0.35, '#374151'), // 前风扇格栅
        _box(0.54, 0.0, 0.10, 0.35, 0.03, 0.35, '#374151'),
        _box(0.08, W - 0.04, 0.55, L - 0.16, 0.04, 0.18, '#9ca3af'), // 后换热格栅
      ];
    })(),
    outlets: [{
      name: '室外侧出风',
      position: [0.475, 0.02, 0.30],
      size: [0.80, 0.04, 0.35],
      defaultVelocity: [0, -2.00, 0],
    }],
    inlets: [{
      name: '室外侧进风',
      position: [0.475, 0.43, 0.62],
      size: [0.70, 0.04, 0.20],
      mode: 'pressure',
    }],
    modes: [
      { name: '制热', power: 4500, outletTemp: 8, outletVelocity: 0.20, inletMode: 'pressure' },
      { name: '制冷', power: 4200, outletTemp: 35, outletVelocity: 0.18, inletMode: 'pressure' },
      { name: '待机', power: 40, outletTemp: 25, outletVelocity: 0.02, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 0.3, y: 4.5, z: 0.0, description: '阳台或室外机位' },
  },

  {
    id: 'heat-pump-floor-heating',
    name: '地暖热泵内机',
    brand: '美的',
    category: 'heat_pump',
    geometry: { length: 0.55, width: 0.35, height: 1.20 },
    bodyParts: (() => {
      const L = 0.55, W = 0.35, H = 1.20;
      return [
        _box(0, 0, 0, L, W, H, '#f8fafc'),
        _box(0.04, W - 0.03, 0.10, L - 0.08, 0.03, 0.35, '#cbd5e1'), // 下维护门
        _box(0.04, W - 0.03, 0.55, L - 0.08, 0.03, 0.45, '#94a3b8'), // 控制面板/换热区
      ];
    })(),
    outlets: [],
    inlets: [],
    modes: [
      { name: '地暖-高温', power: 3500, outletTemp: 45, outletVelocity: 0 },
      { name: '地暖-节能', power: 2200, outletTemp: 35, outletVelocity: 0 },
      { name: '待机', power: 30, outletTemp: 25, outletVelocity: 0 },
    ],
    defaultPlacement: { x: 0.5, y: 4.4, z: 0.0, description: '设备间或阳台地面' },
  },

  // ==================== 油烟机 ====================
  // 侧吸式油烟机：主体为立面楔形三棱柱(prism_y)，截面在 y-z 立面、挤出沿 x(长度，平行墙面)。
  // 翻转后形态：直角厚处在后下(y=W,z=0 贴墙底)，斜面自后下向前上(y=0,z=H)倾斜——
  // 下端贴墙、上端向前，斜面朝 -y(前方/灶台方向)。顶部贴墙叠加烟道盒，前下沿为集油槽/吸烟口。
  {
    id: 'range-hood-90cm',
    name: '侧吸式油烟机 90cm',
    brand: '方太',
    category: 'range_hood',
    geometry: { length: 0.90, width: 0.45, height: 0.60 },
    bodyParts: (() => {
      const L = 0.90, W = 0.45, H = 0.60;
      return [
        // 立面楔形主体：直角在后下(贴墙底)，斜面自后下向前上方倾斜
        _prismY(0, 0, 0, L, W, H, '#9ca3af'),
        // 顶部贴墙烟道盒(水平，位于后上方)
        _box(0, W - 0.16, H - 0.10, L, 0.16, 0.10, '#6b7280'),
        // 前下沿集油槽(深色窄条，吸烟口所在)
        // _box(0.03, 0, 0, L - 0.06, 0.05, 0.06, '#374151'),
      ];
    })(),
    outlets: [],  // 排气接至室外，室内不注风
    inlets: [{
      name: '吸烟口',
      position: [0.45, 0.4, 0.04],     // 斜面下端前方(中心)
      size: [0.80, 0.04, 0.10],
      mode: 'pressure',  // 压力出口：从室内抽走空气（强制排气）
    }],
    modes: [
      { name: '高速', power: 260, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 180, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 120, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.0, z: 1.8, description: '灶台正上方，距地面1.8m' },
  },

  {
    id: 'range-hood-side-75cm',
    name: '侧吸式油烟机 75cm',
    brand: '华帝',
    category: 'range_hood',
    geometry: { length: 0.75, width: 0.42, height: 0.55 },
    bodyParts: (() => {
      const L = 0.75, W = 0.42, H = 0.55;
      return [
        _prismY(0, 0, 0, L, W, H, '#9ca3af'),
        _box(0, W - 0.14, H - 0.09, L, 0.14, 0.09, '#6b7280'),
        // _box(0.03, 0, 0, L - 0.06, 0.05, 0.06, '#374151'),
      ];
    })(),
    outlets: [],
    inlets: [{
      name: '吸烟口',
      position: [0.375, 0.38, 0.04],
      size: [0.65, 0.04, 0.10],
      mode: 'pressure',
    }],
    modes: [
      { name: '高速', power: 240, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 170, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 110, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.0, z: 1.8, description: '灶台正上方，距地面1.8m' },
  },

  {
    id: 'range-hood-side-100cm',
    name: '侧吸式油烟机 100cm',
    brand: '老板',
    category: 'range_hood',
    geometry: { length: 1.00, width: 0.48, height: 0.62 },
    bodyParts: (() => {
      const L = 1.00, W = 0.48, H = 0.62;
      return [
        _prismY(0, 0, 0, L, W, H, '#9ca3af'),
        _box(0, W - 0.18, H - 0.11, L, 0.18, 0.11, '#6b7280'),
        // _box(0.04, 0, 0, L - 0.08, 0.05, 0.06, '#374151'),
        // 后上方控制面板(深色长条)
        // _box(0.10, W - 0.04, H - 0.18, L - 0.20, 0.04, 0.10, '#1f2937'),
      ];
    })(),
    outlets: [],
    inlets: [{
      name: '吸烟口',
      position: [0.50, 0.43, 0.04],
      size: [0.90, 0.04, 0.12],
      mode: 'pressure',
    }],
    modes: [
      { name: '高速', power: 300, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 220, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 150, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.0, z: 1.8, description: '灶台正上方，距地面1.8m' },
  },

  // 下吸式油烟机：长方体箱体，从下表面抽吸(底部吸烟口)，多见于集成灶或岛台下吸式。
  // 与侧吸(斜面)区分：整体为方箱，吸气口在底面(朝下)。
  {
    id: 'range-hood-down-75cm',
    name: '下吸式油烟机 75cm',
    brand: '美的',
    category: 'range_hood',
    geometry: { length: 0.75, width: 0.40, height: 0.45 },
    bodyParts: (() => {
      const L = 0.75, W = 0.40, H = 0.45;
      return [
        _box(0, 0, 0, L, W, H, '#9ca3af'),                       // 主体方箱
        _box(0.04, 0.04, 0, L - 0.08, W - 0.08, 0.04, '#374151'), // 底面吸烟板(下表面抽吸)
        _box(0.10, W - 0.06, H - 0.10, L - 0.20, 0.06, 0.10, '#1f2937'), // 侧面控制面板
      ];
    })(),
    outlets: [],
    inlets: [{
      name: '吸烟口',
      position: [0.375, 0.20, 0.02],   // 底面中央(下表面抽吸)
      size: [0.60, 0.30, 0.04],
      mode: 'pressure',
    }],
    modes: [
      { name: '高速', power: 250, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 180, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 120, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.0, z: 0.85, description: '灶台/岛台下方，距地面0.85m' },
  },

  // 顶吸式(T型)油烟机：仍用长方体组合近似(吊装、下口吸烟)，与侧吸/下吸区分。
  {
    id: 'range-hood-ceil-90cm',
    name: '顶吸式油烟机 90cm',
    brand: '老板',
    category: 'range_hood',
    geometry: { length: 0.90, width: 0.52, height: 0.55 },
    bodyParts: (() => {
      const L = 0.90, W = 0.52, H = 0.55;
      return [
        _box(0, 0, 0, L, W, 0.30, '#9ca3af'),               // 顶部罩壳
        _box(0, 0, 0.30, L, W, 0.25, '#6b7280'),             // 倒梯形下部(用矩形近似)
        _box(0.04, 0.02, 0.30, L - 0.08, 0.04, 0.20, '#374151'), // 底部吸烟板
      ];
    })(),
    outlets: [],
    inlets: [{
      name: '吸烟口',
      position: [0.45, 0.02, 0.42],
      size: [0.80, 0.04, 0.20],
      mode: 'pressure',
    }],
    modes: [
      { name: '高速', power: 280, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 200, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 130, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.0, z: 1.9, description: '灶台正上方吊装，距地面1.9m' },
  },

  // ==================== 换气扇 ====================
  {
    id: 'exhaust-fan-wall',
    name: '墙壁换气扇 30cm',
    brand: '绿岛风',
    category: 'exhaust_fan',
    geometry: { length: 0.35, width: 0.18, height: 0.35 },
    bodyParts: (() => {
      const L = 0.35, W = 0.18, H = 0.35;
      return [
        _box(0, 0, 0, L, W, H, '#e5e7eb'),                 // 外框(白)
        _box(0.03, 0.0, 0.03, L - 0.06, 0.02, H - 0.06, '#6b7280'), // 前网罩+百叶
      ];
    })(),
    outlets: [],
    inlets: [{
      name: '排气口',
      position: [0.175, 0.01, 0.175],  // 室内侧前面(中心)
      size: [0.30, 0.02, 0.30],
      mode: 'pressure',  // 压力出口：将室内空气排出室外
    }],
    modes: [
      { name: '高速', power: 45, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 30, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 18, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 4.9, z: 2.0, description: '靠墙上部，距地面2.0m' },
  },

  {
    id: 'exhaust-fan-duct-25cm',
    name: '管道换气扇 25cm',
    brand: '正野',
    category: 'exhaust_fan',
    geometry: { length: 0.30, width: 0.20, height: 0.30 },
    bodyParts: (() => {
      const L = 0.30, W = 0.20, H = 0.30;
      return [
        _box(0, 0, 0, L, W, H, '#d1d5db'),
        _box(0.03, 0.0, 0.03, L - 0.06, 0.02, H - 0.06, '#6b7280'),
      ];
    })(),
    outlets: [],
    inlets: [{
      name: '排气口',
      position: [0.15, 0.01, 0.15],
      size: [0.25, 0.02, 0.25],
      mode: 'pressure',
    }],
    modes: [
      { name: '高速', power: 35, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 24, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 15, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 4.9, z: 2.2, description: '吊顶内，距地面2.2m' },
  },

  {
    id: 'exhaust-fan-ceil-30cm',
    name: '吸顶换气扇 30cm',
    brand: '绿岛风',
    category: 'exhaust_fan',
    geometry: { length: 0.32, width: 0.32, height: 0.20 },
    bodyParts: (() => {
      const L = 0.32, W = 0.32, H = 0.20;
      return [
        _box(0, 0, 0, L, W, 0.06, '#e5e7eb'),               // 面板(贴顶)
        _box(0.04, 0.04, 0.06, L - 0.08, W - 0.08, 0.14, '#9ca3af'), // 机身(嵌入吊顶)
        _box(0.06, 0.06, 0.0, L - 0.12, 0.02, W - 0.12, '#6b7280'), // 面板进风格栅
      ];
    })(),
    outlets: [],
    inlets: [{
      name: '排气口',
      position: [0.16, 0.16, 0.0],
      size: [0.26, 0.26, 0.02],
      mode: 'pressure',
    }],
    modes: [
      { name: '高速', power: 40, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '中速', power: 28, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
      { name: '低速', power: 16, outletTemp: 25, outletVelocity: 0, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 2.6, description: '吊顶嵌入式，距地面2.6m' },
  },

  // ==================== 空气净化器 ====================
  {
    id: 'air-purifier-cyl',
    name: '空气净化器',
    brand: '飞利浦',
    category: 'air_purifier',
    geometry: { length: 0.35, width: 0.35, height: 0.65 },
    bodyParts: (() => {
      const L = 0.35, W = 0.35, H = 0.65;
      return [
        _box(0, 0, 0, L, W, H, '#1f2937'),                  // 主体(深色)
        _box(0.02, 0.02, H - 0.04, L - 0.04, W - 0.04, 0.04, '#374151'), // 顶部出风格栅
        _box(0.0, 0.0, 0.05, L, 0.03, H - 0.15, '#4b5563'), // 四周进风格栅(以四面薄板近似，此处给前面)
        _box(0.0, W - 0.03, 0.05, L, 0.03, H - 0.15, '#4b5563'),
      ];
    })(),
    outlets: [{
      name: '顶部出风',
      position: [0.175, 0.175, 0.65],   // 顶部(中心)
      size: [0.25, 0.25, 0.02],
      defaultVelocity: [0, 0, 1.50],      // 向上吹(自身系 +Z)
    }],
    inlets: [{
      name: '下部进风',
      position: [0.175, 0.0, 0.25],     // 前下部(中心)
      size: [0.30, 0.02, 0.30],
      mode: 'pressure',  // 从室内吸入（压力出口），与顶部出风构成循环
    }],
    modes: [
      { name: '强档', power: 60, outletTemp: 25, outletVelocity: 0.15, inletMode: 'pressure' },
      { name: '中档', power: 35, outletTemp: 25, outletVelocity: 0.10, inletMode: 'pressure' },
      { name: '静音', power: 15, outletTemp: 25, outletVelocity: 0.06, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 0.0, description: '房间中心地面' },
  },

  {
    id: 'air-purifier-mini',
    name: '桌面空气净化器',
    brand: '小米',
    category: 'air_purifier',
    geometry: { length: 0.20, width: 0.20, height: 0.35 },
    bodyParts: (() => {
      const L = 0.20, W = 0.20, H = 0.35;
      return [
        _box(0, 0, 0, L, W, H, '#374151'),
        _box(0.02, 0.02, H - 0.03, L - 0.04, W - 0.04, 0.03, '#4b5563'),
        _box(0.0, 0.0, 0.05, L, 0.03, H - 0.15, '#6b7280'),
      ];
    })(),
    outlets: [{
      name: '顶部出风',
      position: [0.10, 0.10, 0.35],
      size: [0.14, 0.14, 0.02],
      defaultVelocity: [0, 0, 1.00],
    }],
    inlets: [{
      name: '下部进风',
      position: [0.10, 0.0, 0.15],
      size: [0.16, 0.02, 0.14],
      mode: 'pressure',
    }],
    modes: [
      { name: '强档', power: 25, outletTemp: 25, outletVelocity: 0.10, inletMode: 'pressure' },
      { name: '中档', power: 15, outletTemp: 25, outletVelocity: 0.07, inletMode: 'pressure' },
      { name: '静音', power: 6, outletTemp: 25, outletVelocity: 0.04, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 0.7, description: '桌面，距地面0.7m' },
  },

  {
    id: 'air-purifier-large',
    name: '大型空气净化器',
    brand: '布鲁雅尔',
    category: 'air_purifier',
    geometry: { length: 0.45, width: 0.45, height: 0.80 },
    bodyParts: (() => {
      const L = 0.45, W = 0.45, H = 0.80;
      return [
        _box(0, 0, 0, L, W, H, '#f3f4f6'),                 // 主体(浅)
        _box(0.02, 0.02, H - 0.05, L - 0.04, W - 0.04, 0.05, '#d1d5db'), // 顶部出风格栅
        _box(0.0, 0.0, 0.05, L, 0.03, H - 0.20, '#9ca3af'),
        _box(0.0, W - 0.03, 0.05, L, 0.03, H - 0.20, '#9ca3af'),
      ];
    })(),
    outlets: [{
      name: '顶部出风',
      position: [0.225, 0.225, 0.80],
      size: [0.35, 0.35, 0.02],
      defaultVelocity: [0, 0, 2.00],
    }],
    inlets: [{
      name: '下部进风',
      position: [0.225, 0.0, 0.30],
      size: [0.38, 0.02, 0.40],
      mode: 'pressure',
    }],
    modes: [
      { name: '强档', power: 90, outletTemp: 25, outletVelocity: 0.22, inletMode: 'pressure' },
      { name: '中档', power: 55, outletTemp: 25, outletVelocity: 0.15, inletMode: 'pressure' },
      { name: '静音', power: 25, outletTemp: 25, outletVelocity: 0.08, inletMode: 'pressure' },
    ],
    defaultPlacement: { x: 2.5, y: 2.5, z: 0.0, description: '房间中心地面' },
  },
];

// 按分类获取设备列表
export function getDevicesByCategory(category: DeviceModel['category']) {
  return DEVICE_LIBRARY.filter(d => d.category === category);
}

// 按品牌获取设备列表
export function getDevicesByBrand(brand: string) {
  return DEVICE_LIBRARY.filter(d => d.brand === brand);
}

// 获取所有品牌
export function getAllBrands() {
  return Array.from(new Set(DEVICE_LIBRARY.map(d => d.brand)));
}

// 根据ID获取设备
export function getDeviceById(id: string) {
  return DEVICE_LIBRARY.find(d => d.id === id);
}
