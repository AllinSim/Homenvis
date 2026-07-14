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
 * Room Layout Data Model
 */

/**
 * 绕 z 轴(竖直轴)旋转一个水平向量 (vx, vy) 与位置偏移 (lx, ly)。
 * 约定与渲染端 <group rotation={[0, rotZ, 0]}> 一致（CW，因 room(y,z)→Three(Z,Y) 手性翻转）：
 *   gx = lx*cos + ly*sin,  gy = -lx*sin + ly*cos
 * 返回 [gx, gy]。z 分量不变。
 */
export function rotateZ2D(lx: number, ly: number, rotZ: number): [number, number] {
  const c = Math.cos(rotZ), s = Math.sin(rotZ);
  return [lx * c + ly * s, -lx * s + ly * c];
}

export interface DoorHole {
  id: string;
  name: string;           // 如"门洞1"
  wallFace: 'north' | 'south' | 'east' | 'west'; // 墙体哪一面开门
  offsetFromLeft: number; // 门洞距墙面左边的偏移量(米)
  width: number;         // 门洞宽度(米)
  height: number;        // 门洞高度(米)
  sillHeight: number;    // 门洞底边离地高度(米，通常0)
  open: boolean;          // true=门洞打开(气流可穿过), false=门洞关闭(就是一面墙)
}

/** 几何形状类型：长方体 / 水平截面三棱柱 / 立面楔形三棱柱 / 圆柱(竖放) / 圆柱(横放) */
export type ShapeKind = 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h';

/**
 * 扫风(摆动出风方向)调度。仅对 velocity_inlet 类出风口有意义。
 * 仿真每步根据当前物理时刻 t = step * dt_phys 重新计算出口速度方向：
 *   angle(t) = amplitude * sin(2π·t / period + phase)
 * 然后把出风口"基础速度向量"绕相应轴旋转 angle，写回 ventVel 缓冲区。
 * - horizontal: 左右扫风——在水平面(xy)内绕 z 轴旋转，垂直分量 vz 不变。
 * - vertical:   上下扫风——在(水平方向, z)张成的铅垂面内旋转。
 * amplitude/period/phase 由 UI 给出(度数→弧度、秒)。enabled=false 时该风口恒定出风。
 */
export interface SwingSchedule {
  enabled: boolean;
  mode: 'horizontal' | 'vertical'; // 左右扫风 / 上下扫风
  amplitude: number;   // 半摆角(弧度)
  period: number;      // 完整周期(秒)
  phase?: number;      // 初相位(弧度)，默认 0
}

/** 默认扫风参数：左右扫风，半角 30°，周期 10s。 */
export function createDefaultSwing(): SwingSchedule {
  return { enabled: false, mode: 'horizontal', amplitude: Math.PI / 6, period: 10, phase: 0 };
}

export interface Box3D {
  id: string;
  name: string;
  x: number; y: number; z: number;
  L: number; W: number; H: number;
  color: string;
  shape: ShapeKind;     // 长方体 / 三棱柱 / 圆柱(竖放) / 圆柱(横放)
  doorHoles: DoorHole[];      // 门洞列表（仅长方体支持）
  rotZ?: number;              // 绕 z 轴(竖直轴)旋转角度(弧度)，默认 0
  category?: 'wall' | 'furniture'; // 分类：墙体/隔断 或 家具（决定在哪个面板分区显示；与 shape 无关）
  // 窗户：在"墙门窗"中添加的窗户（仍是 Box3D，category='wall'）。
  // isWindow=true 标记其为窗户而非实体墙——几何上仍是一道薄板，
  // 但语义上代表玻璃窗。勾选 asHeatSource 后，该窗户在仿真中作为热源：
  // 既作为固体障碍物存在，又在窗板体积上施加表面温度（如夏季日照受热）。
  isWindow?: boolean;
  asHeatSource?: boolean;     // 窗户是否同时充当热源（在"边界条件"中配置温度）
  windowTemp?: number;        // 窗户作为热源时的表面温度(°C)，默认 35
  // 组合家具的子部件（如桌子=桌板+4桌腿，沙发=靠背+座位+扶手）。
  // 每个部件用自身坐标系下的最小角坐标 + 尺寸描述，与父 Box3D 的 x,y,z/L,W,H 语义一致
  // （但相对父体原点，不随父 rotZ 预旋转——引擎/渲染端统一按父 rotZ 旋转）。
  // 若提供 parts，则父体的 L/W/H 仅作为整体包围盒（用于拖拽/面板显示），
  // 渲染与栅格化都以 parts 中各部件为准；父体本身不再作为单一障碍物。
  parts?: FurniturePart[];
}

/** 组合家具的一个子部件。坐标/尺寸均在父体自身系（未旋转）下。 */
export interface FurniturePart {
  name?: string;
  x: number; y: number; z: number;  // 相对父体最小角的最小角坐标(m)
  L: number; W: number; H: number;  // 尺寸(m)
  shape?: ShapeKind;                // 形状，默认 box
  color?: string;                   // 颜色，缺省继承父体 color
}

/**
 * prism（水平截面三棱柱）：截面在水平 x-y 面，顶点 (x,y),(x+L,y),(x,y-W)，
 *   直角在 (x,y)，挤出沿 z(高度)。中心 (x+L/2, y-W/2)。斜面为竖直面。
 * prism_y（立面楔形三棱柱）：截面在 y-z 立面(侧视)，挤出沿 x(长度，平行墙面)。
 *   截面顶点(自身系)：后下(y+W,z)→后上(y+W,z+H)→前上(y,z+H)，直角在后下(y+W,z)（贴墙底角），
 *   斜面连接后下(y+W,z)与前上(y,z+H)，朝 -y(前方)且自下而上前倾——
 *   下端贴墙、上端向前，整体上下翻转后的侧吸油烟机吸烟板形态。
 *   几何中心即包围盒中心 (x+L/2, y+W/2, z+H/2)。
 */

export interface Vent {
  id: string;
  name: string;
  ventType: 'velocity_inlet' | 'pressure_outlet';
  outletMode?: 'pressure' | 'velocity'; // 回风口模式：压力出口（自然通风）或速度出口（强制回流）
  x: number; y: number; z: number;
  L: number; W: number; H: number;
  velocity: [number, number, number];
  temperature: number | null;
  color: string;
  rotZ?: number;              // 绕 z 轴(竖直轴)旋转角度(弧度)，默认 0
  shape?: ShapeKind;          // 形状，默认 box
  parentDeviceId?: string; // 关联的父设备ID（如果是设备的一部分）
  swing?: SwingSchedule;      // 扫风调度（仅 velocity_inlet 生效）
  // 出风/回风施加面（几何体自身坐标系：X'沿L / Y'沿W / Z'沿H）。
  // 选定后，引擎只在该面最外一层格子施加边界条件，而非整个体积。
  // 缺省（undefined）时退回旧行为：整个体积标记。向后兼容旧布局。
  outflowFace?: VentFace;
}

/**
 * 出风/回风面标识，基于几何体自身坐标系：
 *   X' 轴沿 L（长度），Y' 轴沿 W，Z' 轴沿 H（=房间高度 z）。
 * '+X' 表示 +X' 面（L 较大一端，法向 +X'），其余类推。
 * 速度 velocity 也在该自身坐标系下定义；引擎 setup 时按 rotZ 旋转到房间系。
 */
export type VentFace = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

/** 出风面在自身坐标系下的单位法向向量 [nx', ny', nz']。 */
export const VENT_FACE_NORMALS: Record<VentFace, [number, number, number]> = {
  '+X': [1, 0, 0],
  '-X': [-1, 0, 0],
  '+Y': [0, 1, 0],
  '-Y': [0, -1, 0],
  '+Z': [0, 0, 1],
  '-Z': [0, 0, -1],
};

/** 出风面的人类可读标签（带轴与方向）。 */
export const VENT_FACE_LABELS: Record<VentFace, string> = {
  '+X': "+X'",
  '-X': "-X'",
  '+Y': "+Y'",
  '-Y': "-Y'",
  '+Z': "+Z'",
  '-Z': "-Z'",
};

/**
 * 将"自身坐标系速度 + rotZ"换算为房间坐标系速度向量。
 * 自身系：X'沿L, Y'沿W, Z'沿H(=房间z)。旋转只影响水平分量 (X',Y') → (房间 x,y)，
 * Z' 分量恒等于房间 z（竖直轴不受 rotZ 影响）。
 */
export function ventVelocityToWorld(v: [number, number, number], rotZ: number): [number, number, number] {
  const [vx, vy, vz] = v;
  const [rx, ry] = rotateZ2D(vx, vy, rotZ);
  return [rx, ry, vz];
}

/**
 * 由速度向量(自身系)推断出风/回风面：取最大分量所在轴 + 其符号。
 * 用于品牌电器设备风口——设备出风/回风方向已由型号确定，无需用户选择面。
 * velocity 各分量对应自身系：[X'(L), Y'(W), Z'(H)]。
 * 速度≈0 时回退 '-Y'（默认水平出风方向）。
 */
export function deriveFaceFromVelocity(v: [number, number, number]): VentFace {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] >= 0 ? '+X' : '-X';
  if (ay >= ax && ay >= az) return v[1] >= 0 ? '+Y' : '-Y';
  return v[2] >= 0 ? '+Z' : '-Z';
}

/** 取面的反向面（+X↔-X, +Y↔-Y, +Z↔-Z）。 */
export function oppositeFace(f: VentFace): VentFace {
  return (f[0] === '+' ? '-' : '+') + f[1] as VentFace;
}

/**
 * 由速度向量(自身系)推断【回风面】。
 *
 * 速度始终表示"气流方向"（出风=向外吹，回风=向内吸入，二者一致）。
 * deriveFaceFromVelocity 返回的是速度"顺着法向"的面（正点积面）：
 *   - 出风：速度向外，正点积面正是空气离开的出风面 ✓
 *   - 回风：速度向内，正点积面是空气离开的"对面"，而非空气进入的回风面 ✗
 * 因此回风面 = 出风面推断结果的反向面（空气进入的那一侧，法向分量为负）。
 * 速度≈0 时回退 '-Y'。
 */
export function deriveInflowFace(v: [number, number, number]): VentFace {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax < 1e-6 && ay < 1e-6 && az < 1e-6) return '-Y';
  return oppositeFace(deriveFaceFromVelocity(v));
}

/**
 * 由风口尺寸与中心相对设备中心的偏移，推断回风面（用于压力模式、无速度向量的回风口）。
 * 回风面=风口最薄的那个轴(尺寸最小的轴)对应的自身系面；方向取风口中心相对设备中心
 * 在该轴上的偏移方向(风口贴设备表面、面朝房间外侧)。
 * 例：size=[0.26,0.26,0.02]、中心 z=0 相对设备中心偏 z=-H/2 → 最薄轴 Z、方向负 → -Z。
 * 用于吸顶换气扇(底面 -Z)、柜机回风(前面 -Y，size=[..,0.04,..] 最薄轴 Y、偏移 -W/2)等。
 */
export function deriveFaceFromSize(size: [number, number, number], offsetFromCenter: [number, number, number]): VentFace {
  // 自身系轴顺序：0=X'(L/size[0])、1=Y'(W/size[1])、2=Z'(H/size[2])
  let minAxis = 0, minSize = size[0];
  if (size[1] < minSize) { minSize = size[1]; minAxis = 1; }
  if (size[2] < minSize) { minSize = size[2]; minAxis = 2; }
  const off = offsetFromCenter[minAxis];
  if (minAxis === 0) return off >= 0 ? '+X' : '-X';
  if (minAxis === 1) return off >= 0 ? '+Y' : '-Y';
  return off >= 0 ? '+Z' : '-Z';
}

export interface HeatSource {
  id: string;
  name: string;
  x: number; y: number; z: number;
  L: number; W: number; H: number;
  temperature: number;
  color: string;
  rotZ?: number;              // 绕 z 轴(竖直轴)旋转角度(弧度)，默认 0
  shape?: ShapeKind;          // 形状，默认 box
  parentDeviceId?: string; // 关联的父设备ID
}

// 标准设备实例（从设备库添加的）
export interface DeviceInstance {
  id: string;
  deviceId: string;       // 设备库中的型号ID
  name: string;           // 实例名称（可自定义）
  brand: string;
  category: 'air_conditioner' | 'heater' | 'fan' | 'heat_pump' | 'tv' | 'range_hood' | 'exhaust_fan' | 'air_purifier';

  // 设备位置（可调整）
  position: {
    x: number;
    y: number;
    z: number;
  };

  // 几何尺寸（锁定，从设备库继承）
  geometry: {
    length: number;
    width: number;
    height: number;
  };

  // 外观组合部件（从设备库继承，仅用于渲染）
  bodyParts?: FurniturePart[];

  // 当前工作模式索引
  modeIndex: number;

  // 运行时边界条件（可调整）
  outlets: Array<{
    id: string;           // 关联的 Vent ID
    name: string;
    relativePosition: [number, number, number]; // 相对设备的位置
    size: [number, number, number];
    velocity: [number, number, number];  // 当前速度
    temperature: number;  // 当前温度
    swing?: SwingSchedule;  // 扫风调度（出风口摆动方向）
  }>;

  inlets: Array<{
    id: string;
    name: string;
    relativePosition: [number, number, number];
    size: [number, number, number];
    mode: 'pressure' | 'velocity';
    velocity: [number, number, number];
    temperature: number;
  }>;

  // 如果是纯热源
  heatSourceId?: string;
  // 纯热源设备（如电视、油汀，无出风口）的表面温度(°C)。
  // 由工作模式的 outletTemp 初始化；在"边界条件"中可调。
  heatTemp?: number;

  rotZ?: number;              // 绕 z 轴(竖直轴)旋转角度(弧度)，默认 0
  color: string;
}

export interface RoomLayout {
  length: number;
  width: number;
  height: number;
  boxes: Box3D[];
  vents: Vent[];
  heatSources: HeatSource[];
  devices: DeviceInstance[]; // 新增：标准设备实例
}

let _id = 0;
export const genId = () => `item_${++_id}`;

/** 分类判断：是否属于"墙体/隔断"类（在建模面板的墙体区域显示）。
 *  以显式 category 为准；旧数据无 category 时回退到名字关键字（墙/隔断）。
 *  注意：不再按 shape 判定——家具也可选三棱柱/圆柱形状。 */
export const isWallLike = (b: Box3D) =>
  b.category === 'wall' || (b.category === undefined && (b.name.includes('墙') || b.name.includes('隔断')));

export function createDefaultRoom(): RoomLayout {
  // 默认空房间：仅保留房间尺寸，不带任何家具/通风口/热源/设备，
  // 让用户从空白开始自行搭建。
  return {
    length: 5, width: 5, height: 2.5,
    boxes: [],
    vents: [],
    heatSources: [],
    devices: [],
  };
}

/** Convert RoomLayout to the format expected by LBMEngine */
export function roomToLBMConfig(room: RoomLayout): import('@/lib/lbm-engine').RoomConfig {
  const items = [];

  // 自定义障碍物
  for (const b of room.boxes) {
    // 组合家具：按子部件分别栅格化为障碍物（桌腿之间可透气）。
    // 父体 L/W/H 仅作包围盒用，本身不再产生障碍物。
    // 部件坐标在父体自身系（未旋转）；栅格化时与渲染一致——绕父体水平中心
    // (b.x+L/2, b.y+W/2) 旋转 rot，故部件中心 = 父中心 + rotateZ2D(部件相对中心)。
    if (b.parts && b.parts.length > 0) {
      const rot = b.rotZ ?? 0;
      const pcx = b.x + b.L / 2, pcy = b.y + b.W / 2;  // 父体水平中心
      for (const p of b.parts) {
        const pshape = p.shape ?? 'box';
        // 部件中心相对父中心的偏移（自身系）。
        // box/cylinder/prism_y 中心在包围盒中心 (p.x+L/2, p.y+W/2)；prism(水平截面)
        // 沿用整体三棱柱语义——p.y 为截面上沿(y大)，几何中心在 p.y-p.W/2（与渲染及 markShape 一致）。
        const relX = (p.x + p.L / 2) - b.L / 2;
        const relY = (pshape === 'prism' ? p.y - p.W / 2 : p.y + p.W / 2) - b.W / 2;
        const [rx, ry] = rotateZ2D(relX, relY, rot);
        const cx = pcx + rx, cy = pcy + ry;            // 部件水平中心(房间系)
        const cz0 = b.z + p.z;                          // 部件底(房间 z)
        // 引擎 box/cylinder/prism_y 用 (x,y) = 最小角 = 中心 - L/2,W/2；
        // prism(水平) 的 markShape 中心 = y - W/2，故传入 y = 中心 + W/2。
        const bx = cx - p.L / 2, by = pshape === 'prism' ? cy + p.W / 2 : cy - p.W / 2, bz = cz0;
        if (pshape === 'prism') {
          items.push({ name: p.name ?? b.name, type: 'prism' as const, x: bx, y: by, z: bz, L: p.L, W: p.W, H: p.H, rotZ: rot });
        } else if (pshape === 'prism_y') {
          items.push({ name: p.name ?? b.name, type: 'prism_y' as const, x: bx, y: by, z: bz, L: p.L, W: p.W, H: p.H, rotZ: rot });
        } else if (pshape === 'cylinder_v') {
          items.push({ name: p.name ?? b.name, type: 'cylinder_v' as const, x: bx, y: by, z: bz, L: p.L, W: p.W, H: p.H, rotZ: rot });
        } else if (pshape === 'cylinder_h') {
          items.push({ name: p.name ?? b.name, type: 'cylinder_h' as const, x: bx, y: by, z: bz, L: p.L, W: p.W, H: p.H, rotZ: rot });
        } else {
          items.push({ name: p.name ?? b.name, type: 'box' as const, x: bx, y: by, z: bz, L: p.L, W: p.W, H: p.H, rotZ: rot });
        }
      }
      continue;
    }
    if (b.shape === 'prism') {
      // 三棱柱：底面平行于地面，截面为直角三角形
      items.push({ name: b.name, type: 'prism' as const, x: b.x, y: b.y, z: b.z, L: b.L, W: b.W, H: b.H, rotZ: b.rotZ ?? 0 });
    } else if (b.shape === 'cylinder_v') {
      // 圆柱(竖放)：轴沿 z(竖直)，半径=min(L,W)/2，高度=H
      items.push({ name: b.name, type: 'cylinder_v' as const, x: b.x, y: b.y, z: b.z, L: b.L, W: b.W, H: b.H, rotZ: b.rotZ ?? 0 });
    } else if (b.shape === 'cylinder_h') {
      // 圆柱(横放)：轴默认沿 x(水平)，轴向长度=L，半径=min(W,H)/2
      items.push({ name: b.name, type: 'cylinder_h' as const, x: b.x, y: b.y, z: b.z, L: b.L, W: b.W, H: b.H, rotZ: b.rotZ ?? 0 });
    } else {
      // 长方体
      items.push({ name: b.name, type: 'box' as const, x: b.x, y: b.y, z: b.z, L: b.L, W: b.W, H: b.H, rotZ: b.rotZ ?? 0 });
      // 门洞：仅当 open=true 时才将门洞区域标记为流体（气流可穿过）
      for (const door of b.doorHoles) {
        if (!door.open) continue; // 门洞关闭时不挖洞，保持墙体完整
        items.push({
          name: door.name,
          type: 'door_hole' as const,
          parentBox: { x: b.x, y: b.y, z: b.z, L: b.L, W: b.W, H: b.H },
          wallFace: door.wallFace,
          offsetFromLeft: door.offsetFromLeft,
          width: door.width,
          height: door.height,
          sillHeight: door.sillHeight,
        });
      }
    }
    // 窗户勾选了热源：在窗板体积上叠加一个热源（表面温度边界条件）。
    // 几何与窗户本体一致，引擎在该体积格子施加温度源。
    if (b.isWindow && b.asHeatSource) {
      items.push({
        name: b.name + '（热源）',
        type: 'heat_source' as const,
        x: b.x, y: b.y, z: b.z, L: b.L, W: b.W, H: b.H,
        temperature: b.windowTemp ?? 35,
        rotZ: b.rotZ ?? 0,
        shape: b.shape ?? 'box',
      });
    }
  }

  // 自定义风口
  for (const v of room.vents) {
    const shape = v.shape ?? 'box';
    const swing = (v.swing && v.swing.enabled) ? v.swing : undefined;
    // 出风/回风面由速度方向自动确定（与品牌电器设备风口一致），用户无需手动选择。
    // velocity 在几何体自身坐标系下定义，表示"气流方向"。
    //   出风(velocity_inlet)：速度向外，出风面=速度顺着法向的面(deriveFaceFromVelocity)。
    //   回风(pressure_outlet)：速度向内，回风面=空气进入侧=出风面推断的反向面(deriveInflowFace)。
    // 旧布局里显式存储的 v.outflowFace 已废弃，一律以速度自动推断为准。
    const isOutflow = v.ventType === 'velocity_inlet';
    const face = isOutflow ? deriveFaceFromVelocity(v.velocity) : deriveInflowFace(v.velocity);
    void v.outflowFace; // 保留字段以兼容旧数据，但不再使用
    if (v.ventType === 'velocity_inlet') {
      items.push({ name: v.name, type: 'vent_inlet' as const, x: v.x, y: v.y, z: v.z, L: v.L, W: v.W, H: v.H, velocity: v.velocity, temperature: v.temperature ?? undefined, rotZ: v.rotZ ?? 0, shape, swing, outflowFace: face });
    } else {
      if (v.outletMode === 'velocity') {
        items.push({ name: v.name, type: 'vent_inlet' as const, x: v.x, y: v.y, z: v.z, L: v.L, W: v.W, H: v.H, velocity: v.velocity, temperature: v.temperature ?? undefined, rotZ: v.rotZ ?? 0, shape, swing, outflowFace: face });
      } else {
        items.push({ name: v.name, type: 'vent_outlet' as const, x: v.x, y: v.y, z: v.z, L: v.L, W: v.W, H: v.H, velocity: v.velocity, temperature: v.temperature ?? undefined, rotZ: v.rotZ ?? 0, shape, outflowFace: face });
      }
    }
  }

  // 自定义热源
  for (const h of room.heatSources) {
    items.push({ name: h.name, type: 'heat_source' as const, x: h.x, y: h.y, z: h.z, L: h.L, W: h.W, H: h.H, temperature: h.temperature, rotZ: h.rotZ ?? 0, shape: h.shape ?? 'box' });
  }

  // 标准设备（从设备库添加的）
  for (const device of room.devices) {
    const pos = device.position;
    const geom = device.geometry;
    const devRot = device.rotZ ?? 0;

    // 设备本体（box）绕设备中心旋转
    items.push({
      name: device.name,
      type: 'box' as const,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      L: geom.length,
      W: geom.width,
      H: geom.height,
      rotZ: devRot,
    });

    for (const outlet of device.outlets) {
      // outlet.relativePosition 为风口【中心】相对设备最小角(自身系，未旋转)。
      // 风口中心先随设备转到房间系；风口尺寸、速度、出风面保持自身系，交给引擎按 rotZ 统一旋转。
      // 这样与 FlowViewer3D 中设备风口的可视几何/箭头保持一致。
      const dcx = geom.length / 2, dcy = geom.width / 2;
      const relCX = outlet.relativePosition[0] - dcx;
      const relCY = outlet.relativePosition[1] - dcy;
      const [rx, ry] = rotateZ2D(relCX, relCY, devRot);
      const pcx = pos.x + dcx, pcy = pos.y + dcy;   // 设备水平中心(房间系)
      const vcx = pcx + rx, vcy = pcy + ry;          // 风口中心(房间系)
      items.push({
        name: `${device.name} - ${outlet.name}`,
        type: 'vent_inlet' as const,
        x: vcx - outlet.size[0] / 2,
        y: vcy - outlet.size[1] / 2,
        z: pos.z + outlet.relativePosition[2] - outlet.size[2] / 2,
        L: outlet.size[0],
        W: outlet.size[1],
        H: outlet.size[2],
        velocity: [outlet.velocity[0], outlet.velocity[1], outlet.velocity[2]],
        temperature: outlet.temperature,
        rotZ: devRot,
        swing: (outlet.swing && outlet.swing.enabled) ? outlet.swing : undefined,
        outflowFace: deriveFaceFromVelocity(outlet.velocity),
      });
    }

    for (const inlet of device.inlets) {
      const dcx = geom.length / 2, dcy = geom.width / 2;
      const relCX = inlet.relativePosition[0] - dcx;
      const relCY = inlet.relativePosition[1] - dcy;
      const [rx, ry] = rotateZ2D(relCX, relCY, devRot);
      const pcx = pos.x + dcx, pcy = pos.y + dcy;
      const vcx = pcx + rx, vcy = pcy + ry;
      // 回风面=空气进入侧。速度模式由速度方向推断(deriveInflowFace)。
      // 压力模式(速度≈0，如吸顶换气扇回风口在底面 -Z)：无法由速度推面，改由风口几何推断——
      // 取风口最薄轴(尺寸最小的轴)为法向轴，方向取风口中心相对设备中心在该轴的偏移方向
      // (风口贴设备表面、面朝房间外侧)。例如吸顶扇 size=[0.26,0.26,0.02] 中心 z=0(设备底) → -Z。
      const inFace = inlet.mode === 'velocity'
        ? deriveInflowFace(inlet.velocity ?? [0, 0, 0])
        : deriveFaceFromSize(inlet.size, [
            inlet.relativePosition[0] - geom.length / 2,
            inlet.relativePosition[1] - geom.width / 2,
            inlet.relativePosition[2] - geom.height / 2,
          ]);
      const common = {
        name: `${device.name} - ${inlet.name}`,
        x: vcx - inlet.size[0] / 2,
        y: vcy - inlet.size[1] / 2,
        z: pos.z + inlet.relativePosition[2] - inlet.size[2] / 2,
        L: inlet.size[0],
        W: inlet.size[1],
        H: inlet.size[2],
        velocity: [inlet.velocity[0], inlet.velocity[1], inlet.velocity[2]] as [number, number, number],
        temperature: inlet.temperature,
        rotZ: devRot,
        outflowFace: inFace,
      };
      if (inlet.mode === 'velocity') {
        items.push({ ...common, type: 'vent_inlet' as const });
      } else {
        items.push({ ...common, type: 'vent_outlet' as const });
      }
    }

    if (device.heatSourceId) {
      items.push({
        name: device.name,
        type: 'heat_source' as const,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        L: geom.length,
        W: geom.width,
        H: geom.height,
        temperature: device.heatTemp ?? device.outlets[0]?.temperature ?? 40,
        rotZ: devRot,
      });
    }
  }

  return { length: room.length, width: room.width, height: room.height, items };
}
