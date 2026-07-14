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

// 家具模型库：沙发 / 床 / 桌子 / 橱柜。
// 每个预设由多个子部件(parts)组合而成（如桌子=桌板+4桌腿，沙发=靠背+座位+扶手），
// 子部件在父体自身坐标系(原点为最小角，x沿L、y沿W、z沿H)下用最小角坐标+尺寸描述。
// 添加到场景后作为一个整体 Box3D 存在（可拖拽/旋转），渲染与栅格化都按 parts 展开。
// "自定义"类型不走本库，直接走 ModelingPanel 里的 addFurniture（用户自行增加单一几何）。
//
// 产品特征子分类（用于搜索栏右侧下拉，按产品类型而非建模形状）：
//   sofa:    single / loveseat / three_seat
//   bed:     single / double / bunk
//   table:   desk / dining / coffee
//   cabinet: wardrobe / kitchen / bookshelf / tv_stand / nightstand

import { type Box3D, type ShapeKind, type FurniturePart, genId } from '@/lib/room-layout';

export type FurnitureCategory = 'sofa' | 'bed' | 'table' | 'cabinet';

/** 产品特征子分类（每类各自定义可选值） */
export type SofaSub = 'single' | 'loveseat' | 'three_seat';
export type BedSub = 'single' | 'double' | 'bunk';
export type TableSub = 'desk' | 'dining' | 'coffee';
export type CabinetSub = 'wardrobe' | 'kitchen' | 'bookshelf' | 'tv_stand' | 'nightstand';
export type FurnitureSubcategory = SofaSub | BedSub | TableSub | CabinetSub;

export interface FurniturePreset {
  id: string;
  name: string;
  category: FurnitureCategory;
  /** 产品特征子分类（搜索栏右侧下拉按此过滤） */
  subcategory: FurnitureSubcategory;
  /** 主体颜色（子部件未单独指定颜色时继承） */
  color: string;
  /** 包围盒尺寸 [L, W, H] (m)，用于拖拽手柄与面板显示 */
  dims: [number, number, number];
  /** 子部件列表（组合几何）。若无则退化为单体长方体。 */
  parts: FurniturePart[];
  /** 默认位置建议（房间相对） */
  placement: { x: number; y: number; z: number; description: string };
  /** 用于形状筛选的代表性形状（库中均为组合，统一记 'box'） */
  shape: ShapeKind;
}

export const FURNITURE_CATEGORIES: { id: FurnitureCategory; name: string; icon: string }[] = [
  { id: 'sofa', name: '沙发', icon: '🛋️' },
  { id: 'bed', name: '床', icon: '🛏️' },
  { id: 'table', name: '桌子', icon: '🪑' },
  { id: 'cabinet', name: '橱柜', icon: '🗄️' },
];

export const FURNITURE_CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  sofa: '沙发',
  bed: '床',
  table: '桌子',
  cabinet: '橱柜',
};

/** 每个主分类下的产品特征子分类（下拉菜单按当前主类动态展示） */
export const FURNITURE_SUBCATEGORY_OPTIONS: Record<FurnitureCategory, { id: FurnitureSubcategory; labelKey: string }[]> = {
  sofa: [
    { id: 'single', labelKey: 'furniture.subcategory.sofa.single' },
    { id: 'loveseat', labelKey: 'furniture.subcategory.sofa.loveseat' },
    { id: 'three_seat', labelKey: 'furniture.subcategory.sofa.three_seat' },
  ],
  bed: [
    { id: 'single', labelKey: 'furniture.subcategory.bed.single' },
    { id: 'double', labelKey: 'furniture.subcategory.bed.double' },
    { id: 'bunk', labelKey: 'furniture.subcategory.bed.bunk' },
  ],
  table: [
    { id: 'desk', labelKey: 'furniture.subcategory.table.desk' },
    { id: 'dining', labelKey: 'furniture.subcategory.table.dining' },
    { id: 'coffee', labelKey: 'furniture.subcategory.table.coffee' },
  ],
  cabinet: [
    { id: 'wardrobe', labelKey: 'furniture.subcategory.cabinet.wardrobe' },
    { id: 'kitchen', labelKey: 'furniture.subcategory.cabinet.kitchen' },
    { id: 'bookshelf', labelKey: 'furniture.subcategory.cabinet.bookshelf' },
    { id: 'tv_stand', labelKey: 'furniture.subcategory.cabinet.tv_stand' },
    { id: 'nightstand', labelKey: 'furniture.subcategory.cabinet.nightstand' },
  ],
};

// ---- 部件构造小工具：以最小角坐标 + 尺寸生成一个 box 部件 ----
const box = (x: number, y: number, z: number, L: number, W: number, H: number, color?: string): FurniturePart =>
  ({ x, y, z, L, W, H, shape: 'box', color });

/** 4 根桌腿：在 (L×W) 矩形四角内缩 inset 处各放一根方腿。返回 legH 高度的腿部件。 */
const fourLegs = (L: number, W: number, leg: number, inset: number, legH: number, color: string): FurniturePart[] => [
  box(inset, inset, 0, leg, leg, legH, color),
  box(L - inset - leg, inset, 0, leg, leg, legH, color),
  box(inset, W - inset - leg, 0, leg, leg, legH, color),
  box(L - inset - leg, W - inset - leg, 0, leg, leg, legH, color),
];

export const FURNITURE_LIBRARY: FurniturePreset[] = [
  // ==================== 沙发 · 单人 ====================
  {
    id: 'sofa-armchair',
    name: '扶手椅',
    category: 'sofa',
    subcategory: 'single',
    color: '#6b4423',
    dims: [0.9, 0.9, 0.85],
    shape: 'box',
    placement: { x: 1.0, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 0.9, W = 0.9, H = 0.85;
      const seatH = 0.42, seatD = 0.7, backT = 0.18, backH = H - seatH, armW = 0.14;
      const frame = '#523317';
      return [
        box(0, 0, 0, L, W, 0.12, frame),
        box(0, W - seatD, seatH, L, seatD, 0.12, '#7d5630'),
        box(0, W - backT, seatH, L, backT, backH, '#5e3c1c'),
        box(0, 0, 0, armW, W, H, frame),
        box(L - armW, 0, 0, armW, W, H, frame),
      ];
    })(),
  },
  {
    id: 'sofa-leisure',
    name: '休闲单人沙发',
    category: 'sofa',
    subcategory: 'single',
    color: '#7a5c3a',
    dims: [0.85, 0.85, 0.78],
    shape: 'box',
    placement: { x: 0.4, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 0.85, W = 0.85, H = 0.78;
      const seatH = 0.4, seatD = 0.62, backT = 0.16, backH = H - seatH;
      // 无扶手款，靠厚座垫与矮靠背体现休闲感
      const frame = '#5a4226';
      return [
        box(0, 0, 0, L, W, 0.12, frame),                       // 底座
        box(0.04, W - seatD - 0.04, seatH, L - 0.08, seatD, 0.16, '#9a724a'), // 厚座垫
        box(0, W - backT, seatH, L, backT, backH, '#6e5232'),  // 矮靠背
        box(0, 0, 0.12, 0.06, 0.06, seatH, frame),             // 四条细腿
        box(L - 0.06, 0, 0.12, 0.06, 0.06, seatH, frame),
        box(0, W - 0.06, 0.12, 0.06, 0.06, seatH, frame),
        box(L - 0.06, W - 0.06, 0.12, 0.06, 0.06, seatH, frame),
      ];
    })(),
  },
  {
    id: 'sofa-single-storage',
    name: '储物单人沙发',
    category: 'sofa',
    subcategory: 'single',
    color: '#5f4632',
    dims: [0.95, 0.9, 0.82],
    shape: 'box',
    placement: { x: 0.4, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 0.95, W = 0.9, H = 0.82;
      const seatH = 0.42, seatD = 0.7, backT = 0.17, backH = H - seatH, armW = 0.15;
      const frame = '#4a3725';
      return [
        box(0, 0, 0, L, W, 0.32, frame),                        // 储物底座（较厚）
        box(0, W - seatD, seatH, L, seatD, 0.12, '#8a6a44'),
        box(0, W - backT, seatH, L, backT, backH, '#5e4528'),
        box(0, 0, 0, armW, W, armW + 0.28, frame),              // 左扶手
        box(L - armW, 0, 0, armW, W, armW + 0.28, frame),       // 右扶手
        box(0.02, 0.32, 0.02, 0.4, 0.04, 0.26, '#3a2c1d'),      // 前侧抽屉面
      ];
    })(),
  },

  // ==================== 沙发 · 双人 ====================
  {
    id: 'sofa-loveseat',
    name: '双人沙发',
    category: 'sofa',
    subcategory: 'loveseat',
    color: '#a0522d',
    dims: [1.4, 0.9, 0.85],
    shape: 'box',
    placement: { x: 2.0, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 1.4, W = 0.9, H = 0.85;
      const seatH = 0.42, seatD = 0.7, backT = 0.18, backH = H - seatH, armW = 0.16;
      const frame = '#7a3e1f';
      return [
        box(0, 0, 0, L, W, 0.12, frame),
        box(0, W - seatD, seatH, L, seatD, 0.12, '#b56b3a'),
        box(0, W - backT, seatH, L, backT, backH, '#8c4a22'),
        box(0, 0, 0, armW, W, H, frame),
        box(L - armW, 0, 0, armW, W, H, frame),
      ];
    })(),
  },
  {
    id: 'sofa-loveseat-narrow',
    name: '双人无扶手沙发',
    category: 'sofa',
    subcategory: 'loveseat',
    color: '#8a6a44',
    dims: [1.3, 0.85, 0.8],
    shape: 'box',
    placement: { x: 2.0, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 1.3, W = 0.85, H = 0.8;
      const seatH = 0.4, seatD = 0.6, backT = 0.16, backH = H - seatH;
      const frame = '#6a5032';
      // 双座垫 + 通长靠背，无扶手
      return [
        box(0, 0, 0, L, W, 0.12, frame),
        box(0.02, W - seatD, seatH, L / 2 - 0.04, seatD, 0.14, '#a07c50'),
        box(L / 2 + 0.02, W - seatD, seatH, L / 2 - 0.04, seatD, 0.14, '#a07c50'),
        box(0, W - backT, seatH, L, backT, backH, '#7a5a38'),
        box(0, 0, 0.12, 0.06, 0.06, seatH - 0.12, frame),
        box(L - 0.06, 0, 0.12, 0.06, 0.06, seatH - 0.12, frame),
        box(0, W - 0.06, 0.12, 0.06, 0.06, seatH - 0.12, frame),
        box(L - 0.06, W - 0.06, 0.12, 0.06, 0.06, seatH - 0.12, frame),
      ];
    })(),
  },
  {
    id: 'sofa-loveseat-fabric',
    name: '布艺双人沙发',
    category: 'sofa',
    subcategory: 'loveseat',
    color: '#6b7a8f',
    dims: [1.45, 0.92, 0.86],
    shape: 'box',
    placement: { x: 2.0, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 1.45, W = 0.92, H = 0.86;
      const seatH = 0.44, seatD = 0.72, backT = 0.2, backH = H - seatH, armW = 0.18;
      const frame = '#4a5666';
      const fabric = '#6b7a8f';
      return [
        box(0, 0, 0, L, W, 0.12, frame),
        box(0, W - seatD, seatH, L, seatD, 0.16, fabric),
        box(0, W - backT, seatH, L, backT, backH, '#566477'),
        box(0, 0, 0, armW, W, H, '#566477'),
        box(L - armW, 0, 0, armW, W, H, '#566477'),
        // 两个靠枕
        box(0.3, W - backT - 0.18, seatH + 0.02, 0.3, 0.14, 0.2, '#7e8ea6'),
        box(L - 0.6, W - backT - 0.18, seatH + 0.02, 0.3, 0.14, 0.2, '#7e8ea6'),
      ];
    })(),
  },

  // ==================== 沙发 · 三人 ====================
  {
    id: 'sofa-3seat',
    name: '三人沙发',
    category: 'sofa',
    subcategory: 'three_seat',
    color: '#8b6914',
    dims: [2.1, 0.9, 0.85],
    shape: 'box',
    placement: { x: 2.5, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.1, W = 0.9, H = 0.85;
      const seatH = 0.42, seatD = 0.7, backT = 0.18, backH = H - seatH, armW = 0.16, armH = H;
      const frameColor = '#6b4f1f';
      return [
        box(0, 0, 0, L, W, 0.12, frameColor),
        box(0, W - seatD, seatH, L, seatD, 0.12, '#a07b2e'),
        box(0, W - backT, seatH, L, backT, backH, '#7a5c1f'),
        box(0, 0, 0, armW, W, armH, frameColor),
        box(L - armW, 0, 0, armW, W, armH, frameColor),
      ];
    })(),
  },
  {
    id: 'sofa-3seat-wide',
    name: '宽座三人沙发',
    category: 'sofa',
    subcategory: 'three_seat',
    color: '#9a6a3a',
    dims: [2.3, 1.0, 0.88],
    shape: 'box',
    placement: { x: 2.5, y: 4.1, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.3, W = 1.0, H = 0.88;
      const seatH = 0.42, seatD = 0.8, backT = 0.2, backH = H - seatH, armW = 0.18;
      const frame = '#7a5230';
      const seat = '#b07a44';
      return [
        box(0, 0, 0, L, W, 0.12, frame),
        // 三块独立座垫
        box(0.04, W - seatD, seatH, (L - 2 * armW - 0.12) / 3, seatD, 0.18, seat),
        box(armW + (L - 2 * armW - 0.12) / 3 + 0.02, W - seatD, seatH, (L - 2 * armW - 0.12) / 3, seatD, 0.18, seat),
        box(L - armW - (L - 2 * armW - 0.12) / 3 - 0.04, W - seatD, seatH, (L - 2 * armW - 0.12) / 3, seatD, 0.18, seat),
        box(0, W - backT, seatH, L, backT, backH, '#8a5e34'),
        box(0, 0, 0, armW, W, H, frame),
        box(L - armW, 0, 0, armW, W, H, frame),
      ];
    })(),
  },
  {
    id: 'sofa-lshape',
    name: 'L型转角沙发',
    category: 'sofa',
    subcategory: 'three_seat',
    color: '#7a5a38',
    dims: [2.4, 1.6, 0.85],
    shape: 'box',
    placement: { x: 2.5, y: 4.0, z: 0, description: '靠墙转角' },
    parts: (() => {
      const L = 2.4, W = 1.6, H = 0.85;
      const seatH = 0.42, backT = 0.18, backH = H - seatH, armW = 0.16;
      const seatW = 0.9; // 主座深
      const chaiseW = 0.9; // 贵妃榻伸出宽度
      const frame = '#5e4428';
      const seat = '#9a724a';
      return [
        // 主座底座（沿 L 方向，靠 y=0 一侧）
        box(0, 0, 0, L, seatW, 0.12, frame),
        // 主座座垫
        box(0.04, 0.04, seatH, L - 0.08, seatW - 0.08, 0.14, seat),
        // 主座靠背（沿 L 方向，在 y=0 一侧）
        box(0, 0, seatH, L, backT, backH, '#6e5232'),
        // 贵妃榻部分（沿 W 方向延伸到 y=W），无靠背
        box(0, seatW - 0.12, 0, chaiseW, W - seatW + 0.12, 0.12, frame),
        box(0.04, seatW, seatH, chaiseW - 0.08, W - seatW - 0.04, 0.14, seat),
        // 右端扶手
        box(L - armW, 0, 0, armW, seatW, H, frame),
      ];
    })(),
  },

  // ==================== 床 · 单人 ====================
  {
    id: 'bed-single',
    name: '单人床 1.2m',
    category: 'bed',
    subcategory: 'single',
    color: '#b08968',
    dims: [2.0, 1.2, 0.55],
    shape: 'box',
    placement: { x: 1.5, y: 1.0, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.0, W = 1.2, H = 0.55;
      const frame = '#5a4023';
      const matThk = 0.18;
      return [
        box(0, 0, 0, L, W, 0.16, frame),
        box(0.05, 0.05, 0.16, L - 0.1, W - 0.1, matThk, '#c4a07a'),
        box(0, 0, 0.16, 0.08, W, 0.45, frame),                  // 床头板
        box(0, 0, 0, L, 0.06, 0.16, frame),                     // 床尾档
      ];
    })(),
  },
  {
    id: 'bed-single-storage',
    name: '储物单人床',
    category: 'bed',
    subcategory: 'single',
    color: '#9a7355',
    dims: [2.05, 1.25, 0.6],
    shape: 'box',
    placement: { x: 1.5, y: 1.0, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.05, W = 1.25, H = 0.6;
      const frame = '#4a3520';
      const matThk = 0.2;
      return [
        box(0, 0, 0, L, W, 0.4, frame),                          // 储物箱体（较高）
        box(0.05, 0.05, 0.4, L - 0.1, W - 0.1, matThk, '#c4a07a'),
        box(0, 0, 0.4, 0.1, W, 0.5, frame),                      // 床头板
        box(0.04, 0.06, 0.04, 0.6, 0.04, 0.32, '#3a2a18'),       // 前侧抽屉面 x2
        box(0.7, 0.06, 0.04, 0.6, 0.04, 0.32, '#3a2a18'),
        box(1.4, 0.06, 0.04, 0.55, 0.04, 0.32, '#3a2a18'),
      ];
    })(),
  },

  // ==================== 床 · 双人 ====================
  {
    id: 'bed-double',
    name: '双人床 1.8m',
    category: 'bed',
    subcategory: 'double',
    color: '#c9a96e',
    dims: [2.0, 1.8, 0.6],
    shape: 'box',
    placement: { x: 2.5, y: 1.2, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.0, W = 1.8, H = 0.6;
      const frameColor = '#6b4f2a';
      const matThk = 0.2;
      const headH = 0.5, headT = 0.08;
      return [
        box(0, 0, 0, L, W, 0.18, frameColor),
        box(0.05, 0.05, 0.18, L - 0.1, W - 0.1, matThk, '#d8b87a'),
        box(0, 0, 0.18, headT, W, headH, frameColor),
        box(0, 0, 0, L, 0.06, 0.18, frameColor),
      ];
    })(),
  },
  {
    id: 'bed-double-queen',
    name: '双人床 1.5m',
    category: 'bed',
    subcategory: 'double',
    color: '#b8966a',
    dims: [2.0, 1.5, 0.58],
    shape: 'box',
    placement: { x: 2.5, y: 1.2, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.0, W = 1.5, H = 0.58;
      const frame = '#5e4427';
      const matThk = 0.19;
      return [
        box(0, 0, 0, L, W, 0.18, frame),
        box(0.05, 0.05, 0.18, L - 0.1, W - 0.1, matThk, '#d4b478'),
        box(0, 0, 0.18, 0.08, W, 0.55, frame),                   // 较高床头
        box(0, 0, 0, L, 0.06, 0.18, frame),
        // 两个枕头
        box(0.25, 0.2, 0.38, 0.45, 0.25, 0.06, '#e8dcc4'),
        box(0.25, W - 0.45, 0.38, 0.45, 0.25, 0.06, '#e8dcc4'),
      ];
    })(),
  },

  // ==================== 床 · 上下铺 ====================
  {
    id: 'bed-bunk',
    name: '上下铺床',
    category: 'bed',
    subcategory: 'bunk',
    color: '#7a6a4a',
    dims: [2.0, 1.0, 1.7],
    shape: 'box',
    placement: { x: 1.5, y: 1.0, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.0, W = 1.0, H = 1.7;
      const frame = '#5a4a30';
      const matThk = 0.12;
      const lowerZ = 0.3, upperZ = 1.25;       // 下铺/上铺床面高度
      const post = 0.06;
      return [
        // 四角立柱（全高）
        box(0, 0, 0, post, post, H, frame),
        box(L - post, 0, 0, post, post, H, frame),
        box(0, W - post, 0, post, post, H, frame),
        box(L - post, W - post, 0, post, post, H, frame),
        // 下铺床板+床垫
        box(post, post, lowerZ, L - 2 * post, W - 2 * post, 0.06, frame),
        box(post + 0.04, post + 0.04, lowerZ + 0.06, L - 2 * post - 0.08, W - 2 * post - 0.08, matThk, '#c4a07a'),
        // 上铺床板+床垫
        box(post, post, upperZ, L - 2 * post, W - 2 * post, 0.06, frame),
        box(post + 0.04, post + 0.04, upperZ + 0.06, L - 2 * post - 0.08, W - 2 * post - 0.08, matThk, '#c4a07a'),
        // 上铺安全护栏
        box(post, W - post - 0.02, upperZ + 0.12, L * 0.55, 0.02, 0.2, frame),
      ];
    })(),
  },
  {
    id: 'bed-bunk-ladder',
    name: '带梯上下铺床',
    category: 'bed',
    subcategory: 'bunk',
    color: '#6a5a3e',
    dims: [2.1, 1.05, 1.75],
    shape: 'box',
    placement: { x: 1.5, y: 1.0, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.1, W = 1.05, H = 1.75;
      const frame = '#4f4329';
      const matThk = 0.12;
      const lowerZ = 0.3, upperZ = 1.3;
      const post = 0.06;
      const parts: FurniturePart[] = [
        box(0, 0, 0, post, post, H, frame),
        box(L - post, 0, 0, post, post, H, frame),
        box(0, W - post, 0, post, post, H, frame),
        box(L - post, W - post, 0, post, post, H, frame),
        box(post, post, lowerZ, L - 2 * post, W - 2 * post, 0.06, frame),
        box(post + 0.04, post + 0.04, lowerZ + 0.06, L - 2 * post - 0.08, W - 2 * post - 0.08, matThk, '#c4a07a'),
        box(post, post, upperZ, L - 2 * post, W - 2 * post, 0.06, frame),
        box(post + 0.04, post + 0.04, upperZ + 0.06, L - 2 * post - 0.08, W - 2 * post - 0.08, matThk, '#c4a07a'),
        box(post, W - post - 0.02, upperZ + 0.12, L * 0.5, 0.02, 0.22, frame), // 护栏
      ];
      // 梯子（贴在右侧 W=W 处外侧，向上爬）
      const ladderX = L - 0.18;
      parts.push(box(ladderX, W - 0.02, 0.3, 0.04, 0.02, upperZ - 0.3, frame)); // 左梯梁
      parts.push(box(ladderX + 0.12, W - 0.02, 0.3, 0.04, 0.02, upperZ - 0.3, frame)); // 右梯梁
      for (let i = 0; i < 4; i++) {
        const z = 0.45 + i * 0.25;
        parts.push(box(ladderX, W - 0.02, z, 0.16, 0.02, 0.03, frame)); // 横档
      }
      return parts;
    })(),
  },

  // ==================== 桌子 · 书桌 ====================
  {
    id: 'table-desk',
    name: '书桌',
    category: 'table',
    subcategory: 'desk',
    color: '#7c5e3c',
    dims: [1.2, 0.6, 0.75],
    shape: 'box',
    placement: { x: 0.6, y: 0.6, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 1.2, W = 0.6, H = 0.75;
      const topT = 0.04, leg = 0.05, inset = 0.05, legH = H - topT;
      const top = '#5e472c';
      const side = '#4a3823';
      return [
        box(0, 0, legH, L, W, topT, top),
        box(0, 0, 0, 0.04, W, legH, side),                      // 左侧板
        box(L - inset - leg, inset, 0, leg, leg, legH, side),   // 右前腿
        box(L - inset - leg, W - inset - leg, 0, leg, leg, legH, side), // 右后腿
        box(0.1, W - 0.28, 0.05, 0.4, 0.28, 0.5, side),         // 抽屉柜
      ];
    })(),
  },
  {
    id: 'table-desk-double',
    name: '双人学习桌',
    category: 'table',
    subcategory: 'desk',
    color: '#6e5638',
    dims: [2.0, 0.6, 0.75],
    shape: 'box',
    placement: { x: 0.6, y: 0.6, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.0, W = 0.6, H = 0.75;
      const topT = 0.04, leg = 0.05, inset = 0.05, legH = H - topT;
      const top = '#54402a';
      const side = '#42331f';
      return [
        box(0, 0, legH, L, W, topT, top),
        // 左右各一块侧板，中间两根腿
        box(0, 0, 0, 0.04, W, legH, side),
        box(L - 0.04, 0, 0, 0.04, W, legH, side),
        box(L / 2 - leg / 2, inset, 0, leg, leg, legH, side),
        box(L / 2 - leg / 2, W - inset - leg, 0, leg, leg, legH, side),
        // 两侧各一个抽屉柜
        box(0.08, W - 0.26, 0.05, 0.5, 0.26, 0.45, side),
        box(L - 0.58, W - 0.26, 0.05, 0.5, 0.26, 0.45, side),
        // 中间隔板（分隔两人）
        box(L / 2 - 0.01, 0.04, legH - 0.25, 0.02, W - 0.08, 0.25, side),
      ];
    })(),
  },

  // ==================== 桌子 · 餐桌 ====================
  {
    id: 'table-dining',
    name: '餐桌',
    category: 'table',
    subcategory: 'dining',
    color: '#a0522d',
    dims: [1.4, 0.8, 0.75],
    shape: 'box',
    placement: { x: 2.5, y: 2.5, z: 0, description: '房间中部' },
    parts: (() => {
      const L = 1.4, W = 0.8, H = 0.75;
      const topT = 0.04, leg = 0.06, inset = 0.06, legH = H - topT;
      const top = '#7a3e1f';
      return [
        box(0, 0, legH, L, W, topT, top),
        ...fourLegs(L, W, leg, inset, legH, '#5e2f17'),
      ];
    })(),
  },
  {
    id: 'table-dining-large',
    name: '大餐桌',
    category: 'table',
    subcategory: 'dining',
    color: '#8b4a2a',
    dims: [1.8, 0.9, 0.75],
    shape: 'box',
    placement: { x: 2.5, y: 2.5, z: 0, description: '房间中部' },
    parts: (() => {
      const L = 1.8, W = 0.9, H = 0.75;
      const topT = 0.05, leg = 0.07, inset = 0.08, legH = H - topT;
      const top = '#6b3820';
      return [
        box(0, 0, legH, L, W, topT, top),
        ...fourLegs(L, W, leg, inset, legH, '#502a16'),
        // 桌面下横撑加固
        box(inset + leg, inset, legH - 0.12, L - 2 * (inset + leg), 0.04, 0.06, '#502a16'),
        box(inset + leg, W - inset - 0.04, legH - 0.12, L - 2 * (inset + leg), 0.04, 0.06, '#502a16'),
      ];
    })(),
  },
  {
    id: 'table-dining-square',
    name: '方餐桌',
    category: 'table',
    subcategory: 'dining',
    color: '#9a5630',
    dims: [0.9, 0.9, 0.74],
    shape: 'box',
    placement: { x: 2.5, y: 2.5, z: 0, description: '房间中部' },
    parts: (() => {
      const L = 0.9, W = 0.9, H = 0.74;
      const topT = 0.04, leg = 0.06, inset = 0.06, legH = H - topT;
      const top = '#704020';
      return [
        box(0, 0, legH, L, W, topT, top),
        ...fourLegs(L, W, leg, inset, legH, '#552f15'),
      ];
    })(),
  },

  // ==================== 桌子 · 茶几 ====================
  {
    id: 'table-coffee',
    name: '茶几',
    category: 'table',
    subcategory: 'coffee',
    color: '#8b4513',
    dims: [1.0, 0.5, 0.4],
    shape: 'box',
    placement: { x: 2.5, y: 3.0, z: 0, description: '沙发前' },
    parts: (() => {
      const L = 1.0, W = 0.5, H = 0.4;
      const topT = 0.035, leg = 0.05, inset = 0.05, legH = H - topT;
      const top = '#6b3410';
      return [
        box(0, 0, legH, L, W, topT, top),
        ...fourLegs(L, W, leg, inset, legH, top),
      ];
    })(),
  },
  {
    id: 'table-coffee-shelf',
    name: '带下层板茶几',
    category: 'table',
    subcategory: 'coffee',
    color: '#7a3e1f',
    dims: [1.1, 0.55, 0.42],
    shape: 'box',
    placement: { x: 2.5, y: 3.0, z: 0, description: '沙发前' },
    parts: (() => {
      const L = 1.1, W = 0.55, H = 0.42;
      const topT = 0.035, leg = 0.05, inset = 0.05, legH = H - topT;
      const top = '#5e2f17';
      const legs = fourLegs(L, W, leg, inset, legH, top);
      return [
        box(0, 0, legH, L, W, topT, top),
        ...legs,
        box(inset + leg, inset + leg, 0.12, L - 2 * (inset + leg), W - 2 * (inset + leg), 0.03, top), // 下层板
      ];
    })(),
  },

  // ==================== 橱柜 · 衣柜 ====================
  {
    id: 'cabinet-wardrobe',
    name: '衣柜',
    category: 'cabinet',
    subcategory: 'wardrobe',
    color: '#5c4033',
    dims: [1.8, 0.6, 2.0],
    shape: 'box',
    placement: { x: 0.6, y: 4.4, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 1.8, W = 0.6, H = 2.0;
      const t = 0.03;
      const body = '#4a3326';
      const door = '#5c4033';
      return [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
        box(L - t, 0, t, t, W, H - 2 * t, body),
        box(t, W - t, t, L - 2 * t, t, H - 2 * t, body),
        box(t, 0, t, L / 2 - t - 0.01, t, H - 2 * t, door),
        box(L / 2 + 0.01, 0, t, L / 2 - t - 0.01, t, H - 2 * t, door),
      ];
    })(),
  },
  {
    id: 'cabinet-wardrobe-sliding',
    name: '推拉门衣柜',
    category: 'cabinet',
    subcategory: 'wardrobe',
    color: '#52402f',
    dims: [2.0, 0.62, 2.1],
    shape: 'box',
    placement: { x: 0.6, y: 4.4, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.0, W = 0.62, H = 2.1;
      const t = 0.03;
      const body = '#3f3023';
      const door = '#52402f';
      return [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
        box(L - t, 0, t, t, W, H - 2 * t, body),
        box(t, W - t, t, L - 2 * t, t, H - 2 * t, body),
        // 两扇推拉门（前后错开表示轨道），略宽于半，互相重叠
        box(t, 0, t, L * 0.6, t, H - 2 * t, door),
        box(L * 0.4 - t, t, t, L * 0.6 - t, t, H - 2 * t, '#5e4a38'),
      ];
    })(),
  },

  // ==================== 橱柜 · 橱柜(厨房) ====================
  {
    id: 'cabinet-kitchen',
    name: '厨房地柜',
    category: 'cabinet',
    subcategory: 'kitchen',
    color: '#4a5d4f',
    dims: [2.0, 0.6, 0.85],
    shape: 'box',
    placement: { x: 1.0, y: 4.4, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 2.0, W = 0.6, H = 0.85;
      const t = 0.03;
      const body = '#3a4a3e';
      const door = '#4a5d4f';
      return [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
        box(L - t, 0, t, t, W, H - 2 * t, body),
        box(t, W - t, t, L - 2 * t, t, H - 2 * t, body),
        box(t, 0, t, L / 2 - t - 0.01, t, H - 2 * t, door),
        box(L / 2 + 0.01, 0, t, L / 2 - t - 0.01, t, H - 2 * t, door),
        // 台面（稍深一档的颜色）
        box(0, 0, H, L, W, 0.04, '#3a3a3a'),
      ];
    })(),
  },
  {
    id: 'cabinet-kitchen-tall',
    name: '高橱柜',
    category: 'cabinet',
    subcategory: 'kitchen',
    color: '#45594b',
    dims: [0.6, 0.6, 1.9],
    shape: 'box',
    placement: { x: 0.6, y: 4.4, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 0.6, W = 0.6, H = 1.9;
      const t = 0.03;
      const body = '#364438';
      const door = '#45594b';
      return [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
        box(L - t, 0, t, t, W, H - 2 * t, body),
        box(t, W - t, t, L - 2 * t, t, H - 2 * t, body),
        // 上下两扇门
        box(t, 0, t, L - 2 * t, t, (H - 2 * t) / 2 - 0.01, door),
        box(t, 0, t + (H - 2 * t) / 2 + 0.01, L - 2 * t, t, (H - 2 * t) / 2 - 0.01, door),
      ];
    })(),
  },

  // ==================== 橱柜 · 书柜 ====================
  {
    id: 'cabinet-bookshelf',
    name: '书柜',
    category: 'cabinet',
    subcategory: 'bookshelf',
    color: '#6b4226',
    dims: [0.4, 1.2, 1.8],
    shape: 'box',
    placement: { x: 0.3, y: 3.0, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 0.4, W = 1.2, H = 1.8;
      const t = 0.03;
      const body = '#553520';
      const shelf = '#6b4226';
      const shelves = 4;
      const parts: FurniturePart[] = [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, L, t, H - 2 * t, body),
        box(0, W - t, t, L, t, H - 2 * t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
      ];
      for (let i = 1; i < shelves; i++) {
        const z = (H / shelves) * i;
        parts.push(box(t, t, z - t / 2, L - 2 * t, W - 2 * t, t, shelf));
      }
      return parts;
    })(),
  },
  {
    id: 'cabinet-bookshelf-low',
    name: '矮书柜',
    category: 'cabinet',
    subcategory: 'bookshelf',
    color: '#7a5030',
    dims: [0.35, 0.9, 0.8],
    shape: 'box',
    placement: { x: 0.3, y: 3.0, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 0.35, W = 0.9, H = 0.8;
      const t = 0.03;
      const body = '#5e3e24';
      const shelf = '#7a5030';
      const shelves = 2;
      const parts: FurniturePart[] = [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, L, t, H - 2 * t, body),
        box(0, W - t, t, L, t, H - 2 * t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
      ];
      for (let i = 1; i < shelves; i++) {
        const z = (H / shelves) * i;
        parts.push(box(t, t, z - t / 2, L - 2 * t, W - 2 * t, t, shelf));
      }
      return parts;
    })(),
  },

  // ==================== 橱柜 · 电视柜 ====================
  {
    id: 'cabinet-tv-stand',
    name: '电视柜',
    category: 'cabinet',
    subcategory: 'tv_stand',
    color: '#4a3a2c',
    dims: [1.6, 0.45, 0.5],
    shape: 'box',
    placement: { x: 1.5, y: 4.5, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 1.6, W = 0.45, H = 0.5;
      const t = 0.03;
      const body = '#3a2e22';
      const door = '#4a3a2c';
      const parts: FurniturePart[] = [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
        box(L - t, 0, t, t, W, H - 2 * t, body),
        box(t, W - t, t, L - 2 * t, t, H - 2 * t, body),
        // 中部开放格 + 两侧抽屉门
        box(L / 2 - 0.25, 0, t, 0.5, t, H - 2 * t, body),       // 中格背板（视觉分隔）
        box(t, 0, t, L / 2 - 0.28 - t, t, H - 2 * t, door),     // 左抽屉面
        box(L / 2 + 0.28, 0, t, L / 2 - 0.28 - t, t, H - 2 * t, door), // 右抽屉面
      ];
      return parts;
    })(),
  },
  {
    id: 'cabinet-tv-stand-low',
    name: '低电视柜',
    category: 'cabinet',
    subcategory: 'tv_stand',
    color: '#524236',
    dims: [1.8, 0.4, 0.36],
    shape: 'box',
    placement: { x: 1.5, y: 4.5, z: 0, description: '靠墙' },
    parts: (() => {
      const L = 1.8, W = 0.4, H = 0.36;
      const t = 0.025;
      const body = '#3e3228';
      const top = '#5a4636';
      return [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, top),
        box(0, 0, t, t, W, H - 2 * t, body),
        box(L - t, 0, t, t, W, H - 2 * t, body),
        box(t, W - t, t, L - 2 * t, t, H - 2 * t, body),
        // 四脚细腿（悬浮感）
        ...fourLegs(L, W, 0.05, 0.04, 0.12, '#2e251d'),
        // 三等分隔板
        box(L / 3, t, t + 0.12, 0.02, W - 2 * t, H - 2 * t - 0.12, body),
        box(2 * L / 3, t, t + 0.12, 0.02, W - 2 * t, H - 2 * t - 0.12, body),
      ];
    })(),
  },

  // ==================== 橱柜 · 床头柜 ====================
  {
    id: 'cabinet-nightstand',
    name: '床头柜',
    category: 'cabinet',
    subcategory: 'nightstand',
    color: '#6a4a30',
    dims: [0.4, 0.4, 0.5],
    shape: 'box',
    placement: { x: 0.4, y: 1.0, z: 0, description: '床头' },
    parts: (() => {
      const L = 0.4, W = 0.4, H = 0.5;
      const t = 0.025;
      const body = '#523823';
      const door = '#6a4a30';
      return [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, t, W, H - 2 * t, body),
        box(L - t, 0, t, t, W, H - 2 * t, body),
        box(t, W - t, t, L - 2 * t, t, H - 2 * t, body),
        // 上层开放格、下层抽屉面
        box(t, 0, t + 0.22, L - 2 * t, t, H - 2 * t - 0.22, door),
      ];
    })(),
  },
  {
    id: 'cabinet-nightstand-drawer',
    name: '双抽屉床头柜',
    category: 'cabinet',
    subcategory: 'nightstand',
    color: '#5e442a',
    dims: [0.45, 0.4, 0.55],
    shape: 'box',
    placement: { x: 0.4, y: 1.0, z: 0, description: '床头' },
    parts: (() => {
      const L = 0.45, W = 0.4, H = 0.55;
      const t = 0.025;
      const body = '#48341f';
      const door = '#5e442a';
      const innerH = H - 2 * t;
      return [
        box(0, 0, 0, L, W, t, body),
        box(0, 0, H - t, L, W, t, body),
        box(0, 0, t, t, W, innerH, body),
        box(L - t, 0, t, t, W, innerH, body),
        box(t, W - t, t, L - 2 * t, t, innerH, body),
        box(t, 0, t + innerH / 2 + 0.01, L - 2 * t, t, innerH / 2 - 0.02, door), // 上抽屉
        box(t, 0, t, L - 2 * t, t, innerH / 2 - 0.02, door),                       // 下抽屉
        // 抽屉把手
        box(L / 2 - 0.05, 0, t + innerH / 2 - 0.02, 0.1, 0.01, 0.015, '#2e2114'),
        box(L / 2 - 0.05, 0, t + 0.02, 0.1, 0.01, 0.015, '#2e2114'),
      ];
    })(),
  },
];

export function getFurnitureByCategory(category: FurnitureCategory): FurniturePreset[] {
  return FURNITURE_LIBRARY.filter(f => f.category === category);
}

/** 把预设转成可加入房间布局的 Box3D 实例（含组合子部件）。 */
export function presetToBox3D(preset: FurniturePreset, roomLength: number, roomWidth: number): Box3D {
  return {
    id: genId(),
    name: preset.name,
    x: preset.placement.x || roomLength / 2,
    y: preset.placement.y || roomWidth / 2,
    z: preset.placement.z,
    L: preset.dims[0],
    W: preset.dims[1],
    H: preset.dims[2],
    color: preset.color,
    shape: 'box',
    doorHoles: [],
    category: 'furniture',
    parts: preset.parts.map(p => ({ ...p })),
  };
}
