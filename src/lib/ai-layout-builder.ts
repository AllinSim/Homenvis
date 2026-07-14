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
 * AI 智能设计 —— JSON → RoomLayout 转换 + 几何校核/修复。
 *
 * AI 输出的坐标/尺寸经常越界、重叠或方向错误。本模块把原始 JSON 解析为
 * RoomLayout，并执行一系列"尽力而为"的几何修复：
 *   1. 数值清洗（NaN/负数/过小尺寸 → 合理默认）。
 *   2. 房间尺寸下限保护。
 *   3. 把每个物体的包围盒 clamp 进房间 [0,L]×[0,W]×[0,H]；若尺寸本身超出房间则等比缩小。
 *   4. 物体间水平重叠检测：家具/电器之间不允许大面积重叠；对重叠者沿主轴轻推分离，
 *      推不动则缩小；墙体、风口、热源、窗户(贴墙薄板)不参与互斥。
 *   5. 壁挂设备高度合理性（空调 z 下限保护）。
 *   6. 速度向量合理性（出风口必须非零、朝室内）。
 *   7. 收集所有修复记录，返回 warnings 供 UI 提示。
 */
import {
  type RoomLayout, type Box3D, type Vent, type HeatSource, type DeviceInstance,
  type DoorHole, genId,
} from '@/lib/room-layout';
import { FURNITURE_LIBRARY, presetToBox3D } from '@/lib/furniture-library';
import { DEVICE_LIBRARY, getDeviceById } from '@/lib/device-library';

/** AI 输出的单个 item（宽松类型，便于容错解析）。 */
interface RawItem {
  type?: string;
  furniture_id?: string;
  device_id?: string;
  mode_index?: number;
  name?: string;
  x?: number; y?: number; z?: number;
  L?: number; W?: number; H?: number;
  rotZ_deg?: number;
  velocity?: [number, number, number];
  temperature?: number;
  category?: string;
  wall?: string;
  offset_from_left?: number;
  width?: number; height?: number;
  as_heat_source?: boolean;
  window_temp?: number;
}

export interface BuildResult {
  layout: RoomLayout;
  warnings: string[];
}

const EPS = 1e-4;

/** 窗户薄板厚度(m)：约一个网格格，太薄(<dx)会被粗网格漏识别，太厚则变成立方体。 */
const WINDOW_THICK = 0.05;

/** 安全数值：NaN/Infinity/负数 → fallback。 */
function safe(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? ''));
  if (!isFinite(v) || v < 0) return fallback;
  return v;
}
function safeDim(n: unknown, fallback: number): number {
  const v = safe(n, fallback);
  return v < 0.02 ? fallback : v; // 尺寸过小视为缺省
}

const WALL_FACES = new Set(['north', 'south', 'east', 'west']);

/** 主入口。 */
export function buildRoomLayout(raw: any): BuildResult {
  const warnings: string[] = [];
  const roomRaw = raw?.room ?? {};
  let length = Math.max(1.5, safe(roomRaw.length, 5));
  let width = Math.max(1.5, safe(roomRaw.width, 5));
  let height = Math.max(2.0, safe(roomRaw.height, 2.7));
  // 上限保护，防止 AI 给出离谱尺寸撑爆网格
  length = Math.min(length, 50);
  width = Math.min(width, 50);
  height = Math.min(height, 6);

  const boxes: Box3D[] = [];
  const vents: Vent[] = [];
  const heatSources: HeatSource[] = [];
  const devices: DeviceInstance[] = [];
  const doorHoles: DoorHole[] = []; // 暂存门洞，按 wall 归并到对应外墙(这里作为独立 box 门的占位)

  const items: RawItem[] = Array.isArray(raw?.items) ? raw.items : [];

  // 第一遍：解析所有"实体"（家具/电器/自定义box/墙/窗）用于后续互斥校核。
  // 风口、热源、门洞单独处理，不参与实体互斥。
  interface Entity { box: Box3D; kind: 'furniture' | 'device' | 'wall' | 'window' | 'box'; device?: DeviceInstance; }
  const entities: Entity[] = [];

  for (const it of items) {
    const t = (it.type || '').toLowerCase();
    const rotZ = ((safe(it.rotZ_deg, 0)) * Math.PI) / 180;

    if (t === 'furniture' && it.furniture_id) {
      const preset = FURNITURE_LIBRARY.find(f => f.id === it.furniture_id);
      if (preset) {
        const box = presetToBox3D(preset, length, width);
        box.name = it.name || preset.name;
        box.x = safe(it.x, preset.placement.x);
        box.y = safe(it.y, preset.placement.y);
        box.z = safe(it.z, preset.placement.z);
        box.rotZ = rotZ;
        entities.push({ box, kind: 'furniture' });
      } else {
        warnings.push(`家具 id="${it.furniture_id}" 不存在，已忽略。`);
      }
    } else if (t === 'device' && it.device_id) {
      const dev = getDeviceById(it.device_id);
      if (dev) {
        const modeIndex = clampInt(it.mode_index ?? 0, 0, dev.modes.length - 1);
        // 根据 wall 自动定向：向前出风(主出风口在水平 -Y 方向)的设备，旋转使出风朝室内。
        const orient = orientDevice(dev, it.wall, it.x, it.y, it.z, length, width, rotZ);
        const di = makeDeviceInstance(dev, modeIndex, orient.x, orient.y, orient.z, orient.rotZ);
        if (orient.note) warnings.push(orient.note);
        devices.push(di);
        // 设备本体也作为一个实体参与互斥（用包围盒）。
        // 旋转 90°/270° 时占地 L/W 互换，用旋转后占地避免 clamp 误移位置。
        const swapped = Math.abs(Math.cos(orient.rotZ)) < 0.5; // 90°/270°
        const boxL = swapped ? di.geometry.width : di.geometry.length;
        const boxW = swapped ? di.geometry.length : di.geometry.width;
        entities.push({
          box: { id: di.id, name: di.name, x: di.position.x, y: di.position.y, z: di.position.z, L: boxL, W: boxW, H: di.geometry.height, color: di.color, shape: 'box', doorHoles: [], category: 'furniture' },
          kind: 'device',
          device: di,
        });
      } else {
        warnings.push(`设备 id="${it.device_id}" 不存在，已忽略。`);
      }
    } else if (t === 'wall') {
      const L = safeDim(it.L, 1.0), W = safeDim(it.W, 0.12), H = safeDim(it.H, height);
      const box: Box3D = { id: genId(), name: it.name || '隔断', x: safe(it.x, 0), y: safe(it.y, 0), z: safe(it.z, 0), L, W, H, color: '#9ca3af', shape: 'box', doorHoles: [], category: 'wall', rotZ };
      entities.push({ box, kind: 'wall' });
    } else if (t === 'window') {
      // 窗户：薄板贴外墙。AI 经常给出"厚立方体"或薄维方向与墙不符，这里按 wall
      // 强制把【垂直墙面方向】的那一维归零为薄厚度，并保证窗板紧贴该墙。
      // 薄厚度取 WINDOW_THICK：太薄(<dx)会被粗网格漏识别，太厚又变成立方体，
      // 0.05m 约一个网格格、渲染与栅格都能稳定识别。
      // 缺省 wall 时按位置距哪面墙最近来推断，避免窗户悬空成厚立方体。
      const x = safe(it.x, 0), y = safe(it.y, 0);
      let wallFace: 'north' | 'south' | 'east' | 'west' | null = WALL_FACES.has(it.wall || '') ? (it.wall as 'north' | 'south' | 'east' | 'west') : null;
      if (!wallFace) {
        const dS = y, dN = width - y, dW = x, dE = length - x;
        const dMin = Math.min(dS, dN, dW, dE);
        wallFace = dMin === dS ? 'south' : dMin === dN ? 'north' : dMin === dW ? 'west' : 'east';
      }
      const sillZ = safeDim(it.z, 0.9);          // 窗台高度，缺省 0.9m
      const winH = safeDim(it.H, 1.2);            // 窗高，缺省 1.2m
      // AI 给的 L/W 经常混淆(不知哪个沿墙、哪个是厚度)。窗宽=水平两维中较大者，
      // 另一水平维收敛为 WINDOW_THICK。这样无论 AI 怎么填，窗户都是"沿墙有窗宽、
      // 垂直墙面是薄厚度"，不会变成窄长条或厚立方体。
      const aL = safeDim(it.L, 1.2), aW = safeDim(it.W, 1.2);
      const winWidth = Math.max(aL, aW) < 0.4 ? 1.2 : Math.max(aL, aW); // 沿墙窗宽，过小则按普通窗兜底
      const isHorizWall = wallFace === 'north' || wallFace === 'south';
      // 贴 north/south 墙：L 沿墙(窗宽)、W 垂直墙(薄)；贴 east/west 墙反之。
      const L = isHorizWall ? winWidth : WINDOW_THICK;
      const W = isHorizWall ? WINDOW_THICK : winWidth;
      let bx = x, by = y;
      if (wallFace === 'north') by = Math.max(0, width - W);
      else if (wallFace === 'south') by = 0;
      else if (wallFace === 'east') bx = Math.max(0, length - L);
      else bx = 0;                                // west
      const box: Box3D = {
        id: genId(), name: it.name || '窗户',
        x: bx, y: by, z: sillZ,
        L, W, H: winH,
        color: '#60a5fa', shape: 'box', doorHoles: [], category: 'wall', rotZ,
        isWindow: true,
        // 窗户自带的"热源"选项：直接在窗板上施加表面温度，无需另建 heat_source
        // （roomToLBMConfig 会据此生成热源项）。再单独 push heat_source 会与窗板重复。
        asHeatSource: !!it.as_heat_source,
        windowTemp: it.as_heat_source ? safe(it.window_temp, 45) : undefined,
      };
      entities.push({ box, kind: 'window' });
    } else if (t === 'box') {
      const L = safeDim(it.L, 0.5), W = safeDim(it.W, 0.5), H = safeDim(it.H, 0.5);
      const cat = it.category === 'wall' ? 'wall' : 'furniture';
      const box: Box3D = { id: genId(), name: it.name || '物体', x: safe(it.x, 0), y: safe(it.y, 0), z: safe(it.z, 0), L, W, H, color: cat === 'wall' ? '#9ca3af' : '#8b6914', shape: 'box', doorHoles: [], category: cat, rotZ };
      entities.push({ box, kind: 'box' });
    } else if (t === 'door_hole') {
      const wall = WALL_FACES.has(it.wall || '') ? (it.wall as any) : 'south';
      doorHoles.push({
        id: genId(), name: it.name || '门洞', wallFace: wall,
        offsetFromLeft: safe(it.offset_from_left, 0.2), width: safeDim(it.width, 0.9),
        height: safeDim(it.height, 2.0), sillHeight: 0, open: true,
      });
      // 门洞需要挂到一面墙上才能挖洞；若用户没提供墙，则记录为提示。
      warnings.push(`门洞"${it.name || wall}"已生成，请确认对应墙面上已开门（默认外墙）。`);
    } else if (t === 'vent_inlet' || t === 'vent_outlet') {
      const v: Vent = {
        id: genId(), name: it.name || (t === 'vent_inlet' ? '送风口' : '排风口'),
        ventType: t === 'vent_inlet' ? 'velocity_inlet' : 'pressure_outlet',
        x: safe(it.x, 0), y: safe(it.y, 0), z: safe(it.z, 0),
        L: safeDim(it.L, 0.4), W: safeDim(it.W, 0.4), H: safeDim(it.H, 0.05),
        velocity: t === 'vent_inlet' ? sanitizeVelocity(it.velocity) : [0, 0, 0],
        temperature: it.temperature != null ? safe(it.temperature, 22) : (t === 'vent_inlet' ? 22 : null),
        color: t === 'vent_inlet' ? '#3b82f6' : '#f59e0b', rotZ,
      };
      vents.push(v);
    } else if (t === 'heat_source') {
      const L = safeDim(it.L, 0.5), W = safeDim(it.W, 0.5), H = safeDim(it.H, 0.5);
      // 体积占比检测：热源不应是大体积物体（房间等大/半房间的"室温热源"属误用）
      const volRatio = (L * W * H) / Math.max(EPS, length * width * height);
      if (volRatio > 0.25) {
        warnings.push(`热源"${it.name || ''}"体积过大(占房间 ${Math.round(volRatio * 100)}%)，疑似用于设定室温，已忽略。初始室温请在仿真条件中设置。`);
      } else {
        const hsBox: BoxLike = { x: safe(it.x, 0), y: safe(it.y, 0), z: safe(it.z, 0), L, W, H, name: it.name };
        // 去重：若该热源与某扇窗户(水平投影重叠 ≥70%)重合，说明 AI 为同一扇窗重复加热源。
        // 改为把窗户自带的 asHeatSource/windowTemp 打开，丢弃这个独立热源，避免重复。
        const dupWin = entities.find(e => e.kind === 'window' && overlapRatio(e.box, hsBox) >= 0.7);
        if (dupWin) {
          dupWin.box.asHeatSource = true;
          dupWin.box.windowTemp = safe(it.temperature, 35);
          warnings.push(`热源"${it.name || ''}"与窗户"${dupWin.box.name}"重合，已合并为该窗户自带热源（不再单独加热源）。`);
        } else {
          heatSources.push({
            id: genId(), name: it.name || '热源',
            x: safe(it.x, 0), y: safe(it.y, 0), z: safe(it.z, 0),
            L, W, H,
            temperature: safe(it.temperature, 35), color: '#ef4444', rotZ,
          });
        }
      }
    } else if (t) {
      warnings.push(`未知类型 "${t}" 已忽略。`);
    }
  }

  // ===== 几何修复 =====
  // (a) 实体 clamp 进房间 & 尺寸超出则等比缩小
  for (const e of entities) {
    clampBoxIntoRoom(e.box, length, width, height, warnings);
  }
  // 设备实体 box 是镜像，要同步回 device.position（互斥可能改动 box.x/y）
  for (const e of entities) {
    if (e.kind === 'device' && e.device) {
      e.device.position.x = e.box.x;
      e.device.position.y = e.box.y;
      e.device.position.z = e.box.z;
    }
  }
  // 风口/热源也 clamp（不参与互斥，但要保证在房间内）
  for (const v of vents) clampBoxIntoRoom(v as any, length, width, height, warnings, true);
  for (const h of heatSources) clampBoxIntoRoom(h as any, length, width, height, warnings, true);

  // (b) 实体间水平互斥（家具/电器/自定义box 之间；墙/窗为薄板不参与）
  const collidable = entities.filter(e => e.kind === 'furniture' || e.kind === 'device' || e.kind === 'box');
  resolveOverlaps(collidable.map(e => e.box), length, width, warnings);
  // 同步设备位置
  for (const e of collidable) {
    if (e.kind === 'device' && e.device) {
      e.device.position.x = e.box.x;
      e.device.position.y = e.box.y;
      e.device.position.z = e.box.z;
    }
  }

  // (c) 收集 box（家具/墙/窗/自定义）
  for (const e of entities) {
    if (e.kind === 'window' || e.kind === 'wall' || e.kind === 'furniture' || e.kind === 'box') {
      boxes.push(e.box);
    }
  }

  const layout: RoomLayout = { length, width, height, boxes, vents, heatSources, devices };
  if (warnings.length === 0) warnings.push('几何校核通过：所有物体均在房间内且无重叠。');
  return { layout, warnings };
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function clampInt(n: unknown, lo: number, hi: number): number {
  const v = Math.round(typeof n === 'number' ? n : parseFloat(String(n ?? '0')));
  if (!isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 判断设备是否"向前出风"（主出风口在水平 -Y 自身方向，如壁挂空调/柜机/暖风机/落地扇）。
 * 这类设备需要靠墙安装且出风朝室内，由 wall 字段自动定向。
 * 向上出风(空气净化器)、仅吸风(油烟机/换气扇)、纯热源(电视/油汀)无需定向。
 */
function isForwardBlowing(dev: ReturnType<typeof getDeviceById>): boolean {
  if (!dev || dev.outlets.length === 0) return false;
  const ov = dev.outlets[0].defaultVelocity;
  const ax = Math.abs(ov[0]), ay = Math.abs(ov[1]), az = Math.abs(ov[2]);
  // 水平向前(±Y)为主，且 Y 分量为主导
  return ay >= ax && ay >= az;
}

/**
 * 依据 wall 自动计算设备的旋转角 rotZ 与贴墙位置，使出风口(-Y 自身)朝向室内。
 * 旋转映射(使自身 -Y → 朝室内的方向)：
 *   north → rotZ=0    (出风朝 -Y=南=室内)
 *   south → rotZ=180° (出风朝 +Y=北=室内)
 *   east  → rotZ=90°  (出风朝 -X=西=室内)
 *   west  → rotZ=270° (出风朝 +X=东=室内)
 * 位置：靠墙物体贴该墙；AI 给的 x 或 y 用于在该方向居中定位。
 * 返回 {x,y,z,rotZ,note}。
 */
function orientDevice(
  dev: ReturnType<typeof getDeviceById>,
  wall: unknown,
  ix: unknown, iy: unknown, iz: unknown,
  roomL: number, roomW: number,
  fallbackRotZ: number,
): { x: number; y: number; z: number; rotZ: number; note?: string } {
  const dev2 = dev!;
  const g = dev2.geometry;
  const z = safe(iz, dev2.defaultPlacement.z);
  // 非"向前出风"设备：不自动定向，沿用 AI 的 rotZ 与位置
  if (!isForwardBlowing(dev2) || !wall || !WALL_FACES.has(String(wall))) {
    // 但仍给出默认贴墙位置提示（用 defaultPlacement 兜底）
    return {
      x: safe(ix, dev2.defaultPlacement.x),
      y: safe(iy, dev2.defaultPlacement.y),
      z,
      rotZ: fallbackRotZ,
    };
  }
  const w = String(wall) as 'north' | 'south' | 'east' | 'west';
  let rotZ: number;
  let x: number, y: number;
  // north/south：机身宽度 W 沿房间 y；贴北/南墙 → y 固定；x 由 AI 给(居中)
  // east/west：靠墙后机身朝向旋转 90°，实际占地变为 W(原 width)沿房间 x、L 沿房间 y；
  //   贴东/西墙 → x 固定；y 由 AI 给(居中)
  if (w === 'north') {
    rotZ = 0;
    y = roomW - g.width;            // 贴北墙
    x = safe(ix, roomL / 2 - g.length / 2);
  } else if (w === 'south') {
    rotZ = Math.PI;
    y = 0;                          // 贴南墙
    x = safe(ix, roomL / 2 - g.length / 2);
  } else if (w === 'east') {
    rotZ = Math.PI / 2;
    x = roomL - g.width;            // 旋转后机身宽度方向沿房间 x，贴东墙
    y = safe(iy, roomW / 2 - g.length / 2);
  } else { // west
    rotZ = -Math.PI / 2;
    x = 0;                          // 贴西墙
    y = safe(iy, roomW / 2 - g.length / 2);
  }
  return { x, y, z, rotZ, note: `${dev2.name} 已按 wall="${w}" 自动定向，出风朝室内。` };
}

/** 出风口速度合理性：必须非零；若 AI 给 [0,0,0]，给一个朝 -y 的默认。 */
function sanitizeVelocity(v: unknown): [number, number, number] {
  if (Array.isArray(v) && v.length >= 3) {
    const a = safe(v[0], 0), b = safe(v[1], 0), c = safe(v[2], 0);
    if (Math.abs(a) + Math.abs(b) + Math.abs(c) > 1e-4) return [a, b, c];
  }
  return [0, -2, -0.3];
}

interface BoxLike { x: number; y: number; z: number; L: number; W: number; H: number; name?: string; }

/** 把物体 clamp 进房间。thin=true 时不缩小尺寸（风口/热源通常很小，优先 clamp 位置）。 */
function clampBoxIntoRoom(b: BoxLike, L: number, W: number, H: number, warnings: string[], thin = false) {
  // 尺寸超出房间：等比缩小到能放下
  if (!thin) {
    if (b.L > L - EPS) { const s = (L - EPS) / b.L; b.L *= s; b.W *= s; warnings.push(`"${b.name}" 长度超出房间，已等比缩小。`); }
    if (b.W > W - EPS) { const s = (W - EPS) / b.W; b.W *= s; b.H *= s; warnings.push(`"${b.name}" 宽度超出房间，已等比缩小。`); }
    if (b.H > H - EPS) { b.H = H - EPS; warnings.push(`"${b.name}" 高度超出房间，已截断。`); }
  } else {
    b.L = Math.min(b.L, L);
    b.W = Math.min(b.W, W);
    b.H = Math.min(b.H, H);
  }
  // 位置 clamp
  if (b.x < 0) b.x = 0;
  if (b.y < 0) b.y = 0;
  if (b.z < 0) b.z = 0;
  if (b.x + b.L > L) b.x = Math.max(0, L - b.L);
  if (b.y + b.W > W) b.y = Math.max(0, W - b.W);
  if (b.z + b.H > H) b.z = Math.max(0, H - b.H);
}

/** 两 AABB 水平投影(x,y)重叠面积比例。 */
function overlapRatio(a: BoxLike, b: BoxLike): number {
  const ax0 = a.x, ax1 = a.x + a.L, ay0 = a.y, ay1 = a.y + a.W;
  const bx0 = b.x, bx1 = b.x + b.L, by0 = b.y, by1 = b.y + b.W;
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  if (ix <= EPS || iy <= EPS) return 0;
  const inter = ix * iy;
  const minArea = Math.min(a.L * a.W, b.L * b.W);
  return minArea > EPS ? inter / minArea : 0;
}

/**
 * 对可碰撞物体集合做水平互斥：重叠超过阈值(20%较小者面积)时沿"更自由的一侧"推开；
 * 推到墙仍重叠则缩小较小者尺寸。最多迭代若干轮避免死循环。
 */
function resolveOverlaps(boxes: Box3D[], L: number, W: number, warnings: string[]) {
  const THRESH = 0.2;
  let changed = true;
  let iter = 0;
  while (changed && iter < 6) {
    changed = false; iter++;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const r = overlapRatio(a, b);
        if (r < THRESH) continue;
        // 计算各方向可推开的空间
        const push = tryPushApart(a, b, L, W);
        if (push) { changed = true; warnings.push(`"${a.name}" 与 "${b.name}" 重叠，已自动分离。`); }
        else {
          // 推不开：缩小较小者的高度方向无关，缩水平尺寸
          const small = (a.L * a.W) <= (b.L * b.W) ? a : b;
          small.L *= 0.7; small.W *= 0.7;
          clampBoxIntoRoom(small, L, W, 10, warnings);
          changed = true;
          warnings.push(`"${a.name}" 与 "${b.name}" 空间不足，已缩小 "${small.name}"。`);
        }
      }
    }
  }
}

/** 尝试沿 x 或 y 把 a、b 推开。返回是否成功分离。 */
function tryPushApart(a: BoxLike, b: BoxLike, L: number, W: number): boolean {
  // x 方向：a 在左 / a 在右
  const ax0 = a.x, ax1 = a.x + a.L, bx0 = b.x, bx1 = b.x + b.L;
  const ay0 = a.y, ay1 = a.y + a.W, by0 = b.y, by1 = b.y + b.W;
  // 当前重叠量
  const ox = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const oy = Math.min(ay1, by1) - Math.max(ay0, by0);
  if (ox <= EPS || oy <= EPS) return true; // 已不重叠
  // 选择推开量较小的轴，并选各自更自由的一侧
  // x 轴：把 a 往左 / b 往右，或 a 往右 / b 往左
  const aLeftSpace = ax0;              // a 可往左移
  const aRightSpace = L - ax1;         // a 可往右移
  const bLeftSpace = bx0;
  const bRightSpace = L - bx1;
  // 方案1：a 左移、b 右移
  const need1 = ox / 2;
  if (aLeftSpace >= need1 && bRightSpace >= need1) { a.x -= need1; b.x += need1; return true; }
  // 方案2：a 右移、b 左移
  if (aRightSpace >= need1 && bLeftSpace >= need1) { a.x += need1; b.x -= need1; return true; }
  // y 轴
  const aDownSpace = ay0;
  const aUpSpace = W - ay1;
  const bDownSpace = by0;
  const bUpSpace = W - by1;
  const need2 = oy / 2;
  if (aDownSpace >= need2 && bUpSpace >= need2) { a.y -= need2; b.y += need2; return true; }
  if (aUpSpace >= need2 && bDownSpace >= need2) { a.y += need2; b.y -= need2; return true; }
  // 单侧推（一侧贴墙时把另一侧推够）
  if (aLeftSpace + bRightSpace >= ox) { a.x -= Math.min(ox, aLeftSpace); b.x += ox - Math.min(ox, aLeftSpace); return true; }
  if (aRightSpace + bLeftSpace >= ox) { a.x += Math.min(ox, aRightSpace); b.x -= ox - Math.min(ox, aRightSpace); return true; }
  if (aDownSpace + bUpSpace >= oy) { a.y -= Math.min(oy, aDownSpace); b.y += oy - Math.min(oy, aDownSpace); return true; }
  if (aUpSpace + bDownSpace >= oy) { a.y += Math.min(oy, aUpSpace); b.y -= oy - Math.min(oy, aUpSpace); return true; }
  return false;
}

/** 构造一个设备实例（与 page.tsx 的 addDeviceFromLibrary 等价，便于 AI 路径独立调用）。 */
function makeDeviceInstance(dev: ReturnType<typeof getDeviceById> & {}, modeIndex: number, x: number, y: number, z: number, rotZ: number): DeviceInstance {
  const mode = dev!.modes[modeIndex];
  const initialTemp = 24;
  return {
    id: genId(), deviceId: dev!.id, name: dev!.name, brand: dev!.brand, category: dev!.category,
    position: { x, y, z }, geometry: dev!.geometry, modeIndex,
    bodyParts: dev!.bodyParts?.map(p => ({ ...p })),
    outlets: dev!.outlets.map(o => ({
      id: genId(), name: o.name, relativePosition: o.position, size: o.size,
      velocity: [
        o.defaultVelocity[0] * (mode.outletVelocity / 0.08),
        o.defaultVelocity[1] * (mode.outletVelocity / 0.08),
        o.defaultVelocity[2] * (mode.outletVelocity / 0.08),
      ],
      temperature: mode.outletTemp,
    })),
    inlets: dev!.inlets.map(inlet => {
      const inletMode = mode.inletMode || inlet.mode;
      return {
        id: genId(), name: inlet.name, relativePosition: inlet.position, size: inlet.size, mode: inletMode,
        velocity: inletMode === 'velocity' && inlet.defaultVelocity ? [
          inlet.defaultVelocity[0] * ((mode.inletVelocity || 0.05) / 0.05),
          inlet.defaultVelocity[1] * ((mode.inletVelocity || 0.05) / 0.05),
          inlet.defaultVelocity[2] * ((mode.inletVelocity || 0.05) / 0.05),
        ] : [0, 0, 0],
        temperature: initialTemp,
      };
    }),
    heatSourceId: dev!.emitsHeat && dev!.outlets.length === 0 ? genId() : undefined,
    heatTemp: dev!.emitsHeat && dev!.outlets.length === 0 ? mode.outletTemp : undefined,
    rotZ,
    color: dev!.category === 'air_conditioner' ? '#60a5fa'
      : dev!.category === 'heater' ? '#f87171'
      : dev!.category === 'tv' ? '#1e293b'
      : dev!.category === 'range_hood' ? '#64748b'
      : dev!.category === 'exhaust_fan' ? '#94a3b8'
      : dev!.category === 'air_purifier' ? '#34d399'
      : '#94a3b8',
  };
}
