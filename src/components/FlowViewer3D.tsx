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

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Box, PivotControls, Edges, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { getSimResults, getPhysicsParams } from '@/lib/simulation-store';
import type { SimResults } from '@/lib/lbm-engine';
import type { RoomLayout, DoorHole, VentFace } from '@/lib/room-layout';
import { rotateZ2D, VENT_FACE_NORMALS, ventVelocityToWorld, deriveFaceFromVelocity, deriveInflowFace, deriveFaceFromSize } from '@/lib/room-layout';
import { useTheme } from '@/lib/theme-context';
import { useI18n } from '@/lib/i18n-context';

// =====================================================================
// Selection & dragging types
// =====================================================================
type DragKind = 'box' | 'vent' | 'heat' | 'device';
type Selection = { kind: DragKind; id: string } | null;

// 截面切片配置：支持同时显示多个不同轴向/位置的切片。
type SliceAxis = 'x' | 'y' | 'z';
interface SliceConfig {
  id: string;
  axis: SliceAxis;
  index: number;
  visible: boolean;
}
let _sliceSeq = 0;
const genSliceId = () => `slice-${Date.now()}-${_sliceSeq++}`;

/**
 * 统一 range 滑块样式。
 * 滑块轨道/拖柄由 globals.css 的 input[type="range"] 规则统一负责，
 * 这里只设布局尺寸，不再用 [&::-webkit-slider-thumb] 任意值类覆盖伪元素，
 * 否则在 Edge/Chromium 中会和全局规则冲突，导致 thumb 偏移、被裁剪或整条不可见
 * （Firefox 用 ::-moz-* 独立体系不冲突，所以此前只在 Edge 看不到横条）。
 */
const RANGE_SLIDER = 'flex-1 cursor-pointer';

/**
 * 坐标映射:房间坐标 (x→X, y→Z, z→Y) 与 Three.js 世界坐标的关系。
 * 普通盒:占据 [x,x+L]×[y,y+W]×[z,z+H],中心 = [x+L/2, z+H/2, y+W/2]。
 * 三棱柱:截面顶点 (0,0),(L,0),(0,W) 经 rotation=[-π/2,0,0] 挤出后,
 *   在房间 y 方向占据 [y-W, y](斜面朝 -y),故中心 = [x+L/2, z+H/2, y-W/2]。
 */
function roomToWorldCenter(x: number, y: number, z: number, L: number, W: number, H: number, prism = false): [number, number, number] {
  return [x + L / 2, z + H / 2, prism ? y - W / 2 : y + W / 2];
}

/**
 * 旋转后水平包围盒(在房间 xy 平面)的半边长。
 * 矩形 L×W 绕竖直轴旋转 θ 后，其轴对齐包围盒半宽为 (L|cosθ|+W|sinθ|)/2 与 (L|sinθ|+W|cosθ|)/2。
 * 返回 [halfX, halfY]。垂直方向不受 rotZ 影响。
 */
function rotatedHalfExtent(L: number, W: number, rotZ: number): [number, number] {
  const c = Math.abs(Math.cos(rotZ)), s = Math.abs(Math.sin(rotZ));
  return [(L * c + W * s) / 2, (L * s + W * c) / 2];
}

/**
 * 根据 world 平移增量(累计,从拖动起始算起)与起始房间坐标,计算 clamp 后的新房间坐标。
 * roomDims = [length, width, height];对象尺寸 Lx=L, Ly=W(房间y方向), Lz=H(房间z方向)。
 * 水平限位按"旋转后包围盒"计算：以对象中心 cx/cy 为基准，限制
 *   cx ∈ [halfX, length-halfX], cy ∈ [halfY, width-halfY]（halfX/halfY 含 rotZ）。
 * 这样旋转任意角度后，整个包围盒都不会越出房间，且可移动范围正确。
 * z(高度)方向不受旋转影响：z ∈ [0, height-H]。
 * 三棱柱水平中心在 y-W/2(普通盒在 y+W/2)，故中心换算时需区分。
 */
function applyDragDelta(
  kind: DragKind,
  id: string,
  startRoom: { x: number; y: number; z: number },
  size: { L: number; W: number; H: number },
  worldDX: number, worldDY: number, worldDZ: number,
  roomDims: [number, number, number],
  setRoom: React.Dispatch<React.SetStateAction<RoomLayout>>,
  prism = false,
  rotZ = 0,
) {
  // 世界 Δ → 房间 Δ
  const rdx = worldDX;      // 世界 X = 房间 x
  const rdy = worldDZ;      // 世界 Z = 房间 y
  const rdz = worldDY;      // 世界 Y = 房间 z

  const [length, width, height] = roomDims;

  // 起始中心坐标(房间系)。
  const startX = startRoom.x + size.L / 2;
  const startY = prism ? startRoom.y - size.W / 2 : startRoom.y + size.W / 2;

  // 旋转后水平包围盒半边长。
  const [halfX, halfY] = rotatedHalfExtent(size.L, size.W, rotZ);

  // 新中心 = 起始中心 + Δ，再 clamp 到 [half, dim-half]。
  const cx = Math.min(Math.max(startX + rdx, halfX), Math.max(halfX, length - halfX));
  const cy = Math.min(Math.max(startY + rdy, halfY), Math.max(halfY, width - halfY));
  // 由中心还原角点 x/y。
  const nx = cx - size.L / 2;
  const ny = prism ? cy + size.W / 2 : cy - size.W / 2;
  // z 方向不变(高度不受旋转影响)。
  const nz = Math.min(Math.max(startRoom.z + rdz, 0), Math.max(0, height - size.H));

  setRoom(prev => {
    if (kind === 'box' || kind === 'vent' || kind === 'heat') {
      const listKey = kind === 'box' ? 'boxes' : kind === 'vent' ? 'vents' : 'heatSources';
      const arr = prev[listKey] as any[];
      if (!arr.some(it => it.id === id)) return prev; // 对象已不存在
      return { ...prev, [listKey]: arr.map(it => it.id === id ? { ...it, x: nx, y: ny, z: nz } : it) };
    }
    // device
    if (!prev.devices.some(d => d.id === id)) return prev;
    return { ...prev, devices: prev.devices.map(d => d.id === id ? { ...d, position: { x: nx, y: ny, z: nz } } : d) };
  });
}

// =====================================================================
// Color mapping: value [0,1] → RGB
// =====================================================================
function heatmapRGB(t: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, t));
  if (c < 0.25) return [0, c * 4, 1];
  if (c < 0.5) return [0, 1, 1 - (c - 0.25) * 4];
  if (c < 0.75) return [(c - 0.5) * 4, 1, 0];
  return [1, 1 - (c - 0.75) * 4, 0];
}

// =====================================================================
// Create circular gradient texture for point clouds
// =====================================================================
function createCircleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// 全局单例：圆形粒子贴图只创建一次，避免每次重建 PointsMaterial 都泄漏一张 CanvasTexture。
let _circleTexture: THREE.Texture | null = null;
function getCircleTexture(): THREE.Texture {
  if (!_circleTexture) _circleTexture = createCircleTexture();
  return _circleTexture;
}

// 全局单例：云图自定义着色器材质。支持逐点 size、逐点 alpha(随强度加权)、
// AdditiveBlending 叠加，比 PointsMaterial(统一 size、忽略 size 属性) 效果更自然。
// 仅 opacity 由 uniform 控制，geometry 重建时不重建材质。
let _cloudMaterial: THREE.ShaderMaterial | null = null;
function getCloudMaterial(): THREE.ShaderMaterial {
  if (_cloudMaterial) return _cloudMaterial;
  _cloudMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.6 },
      uMap: { value: getCircleTexture() },
    },
    vertexShader: /* glsl */`
      attribute float size;
      attribute float alpha;
      attribute vec3 aColor; // 自定义颜色属性(避免与 three 内置 color 属性冲突)
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = alpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // size 为世界单位；按距离透视缩放(sizeAttenuation 等价)。常数调大让粒子明显可见。
        gl_PointSize = size * (700.0 / max(0.001, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        // gl_PointCoord ∈ [0,1]²，以粒子中心采样圆形贴图。
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.01) discard;
        gl_FragColor = vec4(vColor, tex.a * vAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return _cloudMaterial;
}

// =====================================================================
// Room walls (semi-transparent)
// =====================================================================
// =====================================================================
// Theme-aware canvas background
// Dynamically updates gl.setClearColor when theme changes.
// =====================================================================
const LIGHT_BG = '#e8ecf1';
const DARK_BG = '#1a1a2e';

function ThemeBackground() {
  const { gl } = useThree();
  const { theme } = useTheme();
  useEffect(() => {
    gl.setClearColor(theme === 'dark' ? DARK_BG : LIGHT_BG, 1);
  }, [gl, theme]);
  return null;
}

// =====================================================================
// Room walls (semi-transparent)
// =====================================================================
function RoomWalls({ length, width, height, dark }: { length: number; width: number; height: number; dark: boolean }) {
  const t = 0.03;
  const wallColor = dark ? '#334155' : '#e2e8f0';
  const floorColor = dark ? '#5c4a3a' : '#d4a574';
  const wallOpacity = dark ? 0.15 : 0.08;
  const southOpacity = dark ? 0.2 : 0.12;
  // 墙体/地板/天花板只作背景显示，不参与 raycast，避免半透明墙体挡住
  // 内部家具/设备的点击命中（设备常位于房间中央，被多面墙包围）。
  const noRaycast = () => null;
  return (
    <group>
      {/* Floor */}
      <Box args={[length, t, width]} position={[length / 2, -t / 2, width / 2]} raycast={noRaycast}>
        <meshStandardMaterial color={floorColor} />
      </Box>
      {/* Ceiling — 半透明且不写深度、最先渲染，确保从房顶俯视时不遮挡下方家具/设备 */}
      <Box args={[length, t, width]} position={[length / 2, height + t / 2, width / 2]} raycast={noRaycast} renderOrder={-2}>
        <meshStandardMaterial color={wallColor} transparent opacity={wallOpacity} side={THREE.DoubleSide} depthWrite={false} />
      </Box>
      {/* North wall y=width */}
      <Box args={[length, height, t]} position={[length / 2, height / 2, width + t / 2]} raycast={noRaycast} renderOrder={-2}>
        <meshStandardMaterial color={wallColor} transparent opacity={wallOpacity} side={THREE.DoubleSide} depthWrite={false} />
      </Box>
      {/* South wall y=0 */}
      <Box args={[length, height, t]} position={[length / 2, height / 2, -t / 2]} raycast={noRaycast} renderOrder={-2}>
        <meshStandardMaterial color={wallColor} transparent opacity={southOpacity} side={THREE.DoubleSide} depthWrite={false} />
      </Box>
      {/* East wall x=length */}
      <Box args={[t, height, width]} position={[length + t / 2, height / 2, width / 2]} raycast={noRaycast} renderOrder={-2}>
        <meshStandardMaterial color={wallColor} transparent opacity={wallOpacity} side={THREE.DoubleSide} depthWrite={false} />
      </Box>
      {/* West wall x=0 */}
      <Box args={[t, height, width]} position={[-t / 2, height / 2, width / 2]} raycast={noRaycast} renderOrder={-2}>
        <meshStandardMaterial color={wallColor} transparent opacity={wallOpacity} side={THREE.DoubleSide} depthWrite={false} />
      </Box>
    </group>
  );
}

// =====================================================================
// Furniture box — supports box, prism, and box+doorHoles
// =====================================================================
function FurnitureBox({ x, y, z, L, W, H, color, name, dark, shape, doorHoles, parts, rotZ = 0 }: {
  x: number; y: number; z: number; L: number; W: number; H: number; color: string; name: string; dark: boolean;
  shape?: 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h'; doorHoles?: DoorHole[]; parts?: import('@/lib/room-layout').FurniturePart[]; rotZ?: number;
}) {
  const textColor = dark ? 'white' : '#1e293b';
  const s = shape || 'box';
  // Horizontal center (room coords). box/cylinder: (x+L/2, y+W/2); prism: (x+L/2, y-W/2).
  const cx = x + L / 2;
  const cy = s === 'prism' ? y - W / 2 : y + W / 2;

  // 组合家具：按子部件渲染。父体包围盒中心 (cx, z+H/2, cy) 处绕 Three Y(=房间z) 旋 rotZ。
  // 子部件坐标在父体自身系（未旋转），换算到 group 局部(Three: X=房间x', Y=房间z', Z=房间y')：
  //   localX = (px+pL/2) - L/2 ; localY = (pz+pH/2) - H/2 ; localZ = (py+pW/2) - W/2
  if (parts && parts.length > 0) {
    return (
      <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
        {parts.map((p, i) => {
          const pshape = p.shape ?? 'box';
          const pcolor = p.color ?? color;
          const isPartPrism = pshape === 'prism';
          const localX = (p.x + p.L / 2) - L / 2;
          const localY = (p.z + p.H / 2) - H / 2;
          // prism 沿用整体三棱柱语义：p.y 为三角截面的后上沿(y大)，中心在 p.y - W/2。
          const localZ = (isPartPrism ? p.y - p.W / 2 : p.y + p.W / 2) - W / 2;
          const mat = <meshStandardMaterial color={pcolor} transparent opacity={0.75} side={THREE.DoubleSide} />;
          if (pshape === 'prism') {
            const tri = new THREE.Shape();
            tri.moveTo(0, 0); tri.lineTo(p.L, 0); tri.lineTo(0, p.W); tri.closePath();
            const geo = new THREE.ExtrudeGeometry(tri, { depth: p.H, bevelEnabled: false });
            return (
              <mesh key={i} geometry={geo} position={[localX - p.L / 2, localY - p.H / 2, localZ + p.W / 2]} rotation={[-Math.PI / 2, 0, 0]}>
                {mat}
              </mesh>
            );
          }
          if (pshape === 'prism_y') {
            // 立面楔形：截面在 (W深度, H高度) 立面，挤出沿 L(长度，平行墙面)。
            // 截面顶点(Shape.X=深度, Shape.Y=高度)：后下(0,H)→后上(0,0)→前上(W,H)，
            // 直角在后下(贴墙顶)，斜面连接后下(0,H)与前上(W,H)：下端贴墙、上端向前，
            // 朝 -y(前方)自上而下前倾（整体上下翻转后的侧吸形态）。
            const tri = new THREE.Shape();
            tri.moveTo(0, p.H); tri.lineTo(0, 0); tri.lineTo(p.W, p.H); tri.closePath();
            const geo = new THREE.ExtrudeGeometry(tri, { depth: p.L, bevelEnabled: false });
            return (
              <mesh key={i} geometry={geo} position={[localX - p.L / 2, localY - p.H / 2, localZ + p.W / 2]} rotation={[0, Math.PI / 2, 0]}>
                {mat}
              </mesh>
            );
          }
          if (pshape === 'cylinder_v') {
            const r = Math.min(p.L, p.W) / 2;
            return <mesh key={i} position={[localX, localY, localZ]}><cylinderGeometry args={[r, r, p.H, 20]} />{mat}</mesh>;
          }
          if (pshape === 'cylinder_h') {
            const r = Math.min(p.W, p.H) / 2;
            return <mesh key={i} position={[localX, localY, localZ]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[r, r, p.L, 20]} />{mat}</mesh>;
          }
          // box（三棱柱部件暂不支持，回退为 box）
          return (
            <Box key={i} args={[p.L, p.H, p.W]} position={[localX, localY, localZ]}>
              {mat}
            </Box>
          );
        })}
        <Text position={[0, H / 2 + 0.08, 0]} fontSize={0.12} color={textColor} anchorX="center" anchorY="bottom">{name}</Text>
      </group>
    );
  }

  if (s === 'cylinder_v') {
    // 圆柱(竖放)：轴沿 z(竖直)。半径=min(L,W)/2，高度 H。中心 (cx, z+H/2, cy)。
    const r = Math.min(L, W) / 2;
    return (
      <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
        <mesh>
          <cylinderGeometry args={[r, r, H, 24]} />
          <meshStandardMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        <Text position={[0, H / 2 + 0.08, 0]} fontSize={0.12} color={textColor} anchorX="center" anchorY="bottom">{name}</Text>
      </group>
    );
  }

  if (s === 'cylinder_h') {
    // 圆柱(横放)：轴默认沿房间 x(=Three X)。长度 L，半径=min(W,H)/2，中心 (cx, z+H/2, cy)。
    // cylinderGeometry 默认轴沿 Three Y，先绕 Z 转 90° 使轴沿 Three X，再由外层 group 绕 Y(=房间 z) 旋 rotZ。
    const r = Math.min(W, H) / 2;
    return (
      <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[r, r, L, 24]} />
          <meshStandardMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        <Text position={[0, r + 0.08, 0]} fontSize={0.12} color={textColor} anchorX="center" anchorY="bottom">{name}</Text>
      </group>
    );
  }

  if (s === 'prism') {
    // 三棱柱：直角三角形截面，挤出为三棱柱
    // 截面顶点：(0,0), (L,0), (0,W) — 在 XY 平面
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(L, 0);
    shape.lineTo(0, W);
    shape.closePath();

    const extrudeSettings = { depth: H, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // 绕水平中心 (cx, cy) 旋转 rotZ（Three 世界 Y 轴 = 房间 z 轴）。
    // group 置于物体中心并施加旋转；mesh 保持原有相对放置，rotZ=0 时与旧实现完全一致。
    return (
      <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
        <mesh
          geometry={geometry}
          position={[x - cx, -H / 2, y - cy]}
          rotation={[-Math.PI / 2, 0, 0]} // 旋转使挤出方向沿 Z(up)
        >
          <meshStandardMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        <Text
          position={[0, H / 2 + 0.08, 0]}
          fontSize={0.12}
          color={textColor}
          anchorX="center"
          anchorY="bottom"
        >
          {name}
        </Text>
      </group>
    );
  }

  // Box with optional door holes
  if (doorHoles && doorHoles.length > 0) {
    // 建墙体 Shape，然后在对应面挖孔洞
    const wallShape = new THREE.Shape();
    wallShape.moveTo(0, 0);
    wallShape.lineTo(L, 0);
    wallShape.lineTo(L, W);
    wallShape.lineTo(0, W);
    wallShape.closePath();

    // 在 Shape 上挖门洞（根据 wallFace 映射到 Shape 的坐标）
    for (const door of doorHoles) {
      const holePath = new THREE.Path();
      if (door.wallFace === 'east') {
        // 东面 (x=L)：Shape 中 x=L 边，y 方向为 offsetFromLeft → width，z 为 sillHeight → height
        // 映射到 Shape: x=L (东边), y 从 offsetFromLeft 到 offsetFromLeft+width
        // 但 Shape 是 x∈[0,L], y∈[0,W]，我们需要将门洞映射到 Shape 坐标系
        // 对于 east/west 面：门洞在 y 方向展开（沿 Y 轴），z 方向是竖向
        // 映射：holeX = L (east edge), holeY 从 offsetFromLeft 到 offsetFromLeft+door.width
        // 但 Shape 中 east 面在 x=L 处, 门洞 y 坐标就是 offsetFromLeft
        // 实际上 Shape 表示墙体的截面（垂直于墙厚方向的投影）
        // 对于南北墙(L沿x, W沿y): 截面投影为 x-z 平面, 宽=L, 高=H
        // 对于东西墙(L沿y, W沿x): 截面投影为 y-z 平面, 宽=W(这里用L), 高=H
        // 简化：统一用 wallShape 来表示墙体截面，宽=该面横向尺寸，高=H
        // east 面：横向尺寸是 W(沿y), 门洞 offsetFromLeft 沿 y 方向
        // 但这里 wallShape 定义为 L×W 的矩形，不太对...
        //
        // 更简洁的方法：wallShape 总是表示墙体的正视图截面
        // north/south 面：截面宽度 = L(沿x)，高度 = H(沿z)
        // east/west 面：截面宽度 = W(沿y)，高度 = H(沿z)
        // doorHoles 的 offsetFromLeft/width 都是在该面的横向方向
      }
      // 为了简化实现，我们将所有面统一处理：
      // wallShape 始终是墙体的正视图（宽 × 高）
      // north/south: 宽=L, 高=H
      // east/west: 宽=W, 高=H

      // 先重新定义 wallShape 以匹配面的方向
      const faceWidth = (door.wallFace === 'north' || door.wallFace === 'south') ? L : W;
      const faceShape = new THREE.Shape();
      faceShape.moveTo(0, 0);
      faceShape.lineTo(faceWidth, 0);
      faceShape.lineTo(faceWidth, H);
      faceShape.lineTo(0, H);
      faceShape.closePath();

      // 添加门洞孔
      const hole = new THREE.Path();
      hole.moveTo(door.offsetFromLeft, door.sillHeight);
      hole.lineTo(door.offsetFromLeft + door.width, door.sillHeight);
      hole.lineTo(door.offsetFromLeft + door.width, door.sillHeight + door.height);
      hole.lineTo(door.offsetFromLeft, door.sillHeight + door.height);
      hole.closePath();
      faceShape.holes.push(hole);

      // 根据面方向挤出并定位
      const wallThickness = (door.wallFace === 'north' || door.wallFace === 'south') ? W : L;
      const extrudeSettings = { depth: wallThickness, bevelEnabled: false };
      const geometry = new THREE.ExtrudeGeometry(faceShape, extrudeSettings);

      // 这个面只有一个门洞，渲染这一面
      // 实际上对于有多个门洞在同一面的情况，我们合并到一个 shape
      // 但为了简单，先每个门洞单独渲染一个面段
      // 更好的方式：把所有同一面的门洞合并到一个 shape.holes 中
    }

    // 实际渲染策略：把整个墙体用多个面段拼接
    // 这太复杂了。用更简单的方法：整个墙体作为 Box 渲染，门洞用独立的小 mesh 表示（挖空效果）
    // 最简单：墙体用 Box 渲染，门洞区域渲染一个深色/透明的方块表示门洞位置

    // 终极简化方案：墙体仍用 Box，但门洞位置渲染一个特殊标记。
    // 与其它形状一致：group 置于水平中心 (cx, z+H/2, cy) 并绕 Three Y(=房间 z) 施加 rotZ，
    // 子节点坐标全部改为相对该中心，这样带门洞的墙体也能正确旋转。
    return (
      <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
        <Box args={[L, H, W]}>
          <meshStandardMaterial color={color} transparent opacity={0.7} />
        </Box>
        {doorHoles.map(door => {
          // 门洞贯穿墙体厚度方向，并比墙体略厚、在厚度方向居中，
          // 使门洞在墙体两侧都略微突出，更直观。
          const extra = 0.04; // 厚度方向比墙体多出的总量（两侧各突出 extra/2）
          // 高度方向（Three Y = 房间 z）：门洞中心相对墙体中心
          const heightCenter = (door.sillHeight + door.height / 2) - H / 2;
          // 宽度方向（沿墙面横向）：门洞中心相对墙体中心
          const widthCenter = (door.offsetFromLeft + door.width / 2);
          const isNS = door.wallFace === 'north' || door.wallFace === 'south';
          // Three 坐标轴：X=房间x(L), Y=房间z高(H), Z=房间y(W)
          // N/S 墙：厚度沿房间 y(Three Z, =W)，宽度沿房间 x(Three X, =L)
          // E/W 墙：厚度沿房间 x(Three X, =L)，宽度沿房间 y(Three Z, =W)
          const thicknessSize = (isNS ? W : L) + extra;
          const args: [number, number, number] = isNS
            ? [door.width, door.height, thicknessSize]            // [X,Y,Z]
            : [thicknessSize, door.height, door.width];
          const position: [number, number, number] = isNS
            ? [widthCenter - L / 2, heightCenter, 0]              // 厚度方向(Three Z)居中=0
            : [0, heightCenter, widthCenter - W / 2];             // 厚度方向(Three X)居中=0
          return (
            <Box key={door.id} args={args} position={position}>
              <meshStandardMaterial
                color={door.open ? (dark ? '#1a1a2e' : '#e8ecf1') : color}
                transparent
                opacity={door.open ? 0.95 : 0.7}
              />
            </Box>
          );
        })}
        <Text
          position={[0, H / 2 + 0.08, 0]}
          fontSize={0.12}
          color={textColor}
          anchorX="center"
          anchorY="bottom"
        >
          {name}
        </Text>
      </group>
    );
  }

  // Plain box (no door holes) — supports rotZ about horizontal center (cx, cy).
  return (
    <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
      <Box args={[L, H, W]}>
        <meshStandardMaterial color={color} transparent opacity={0.7} />
      </Box>
      <Text
        position={[0, H / 2 + 0.08, 0]}
        fontSize={0.12}
        color={textColor}
        anchorX="center"
        anchorY="bottom"
      >
        {name}
      </Text>
    </group>
  );
}

// =====================================================================
// ShapeMesh — renders a shape (box/prism/cylinder_v/cylinder_h) mesh,
// centered & rotated consistently with the LBM rasterization. No text.
// 中心：box/cylinder → (x+L/2, z+H/2, y+W/2)；prism → (x+L/2, z+H/2, y-W/2)。
// 外层调用方负责放置 group 与旋转；这里只产出一个原点居中的 mesh。
// =====================================================================
function ShapeMesh({ x, y, L, W, H, shape, material }: {
  x: number; y: number; L: number; W: number; H: number;
  shape: 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h';
  material: React.ReactNode;
}) {
  if (shape === 'prism') {
    // 三棱柱：截面顶点 (0,0),(L,0),(0,W)，挤出 H；中心 (x+L/2, y-W/2)。
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(L, 0); s.lineTo(0, W); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false });
    return (
      <mesh geometry={geo} position={[x - (x + L / 2), -H / 2, y - (y - W / 2)]} rotation={[-Math.PI / 2, 0, 0]}>
        {material}
      </mesh>
    );
  }
  if (shape === 'cylinder_v') {
    const r = Math.min(L, W) / 2;
    return <mesh><cylinderGeometry args={[r, r, H, 24]} />{material}</mesh>;
  }
  if (shape === 'cylinder_h') {
    const r = Math.min(W, H) / 2;
    return <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[r, r, L, 24]} />{material}</mesh>;
  }
  // box
  return <Box args={[L, H, W]}>{material}</Box>;
}

// =====================================================================
// Vent marker
// =====================================================================
function VentMarker({ x, y, z, L, W, H, color, name, dark, rotZ = 0, shape = 'box', velocity, outflowFace, isReturn = false, showArrow = false }: {
  x: number; y: number; z: number; L: number; W: number; H: number; color: string; name: string; dark?: boolean; rotZ?: number; shape?: 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h';
  velocity?: [number, number, number]; outflowFace?: VentFace; isReturn?: boolean; showArrow?: boolean;
}) {
  // 中心 (cx, z+H/2, cy) 处绕 Three 世界 Y(=房间 z) 旋转 rotZ，与 LBM 一致(CW)。
  // group 内局部轴与几何体自身系对齐(rotZ=0 时：X'→Three X, Y'→Three Z, Z'→Three Y)，
  // 故箭头/坐标轴在 group 内按自身系绘制，外层 rotation 自动跟随。
  const cx = x + L / 2, cy = shape === 'prism' ? y - W / 2 : y + W / 2;
  // 自身系向量 [vx', vy', vz'] → Three 局部 [vx', vz', vy']（Y/Z 互换）
  const toLocal = (vv: [number, number, number]): [number, number, number] => [vv[0], vv[2], vv[1]];

  // 箭头方向(自身系)：
  //   出风口：沿速度方向(=出风面外法向)，箭头由几何体中心向外指出(尾在中心、尖向外)。
  //   回风口：箭头应"由外指向几何体中心"——尾在回风面(外侧)、尖朝向中心。
  //           方向用【出风/回风面的外法向】：出风为 +faceNormal(向外)，回风为 -faceNormal(向心)。
  //           一律取 outflowFace 法向(几何可靠)，不受速度数值符号影响；速度仅决定箭杆长度。
  const faceN: [number, number, number] = outflowFace ? VENT_FACE_NORMALS[outflowFace] : [0, 1, 0];
  const dirLocal = isReturn ? toLocal([-faceN[0], -faceN[1], -faceN[2]]) : toLocal(faceN);
  const len = Math.max(0.001, Math.hypot(dirLocal[0], dirLocal[1], dirLocal[2]));
  const nd: [number, number, number] = [dirLocal[0] / len, dirLocal[1] / len, dirLocal[2] / len];
  const arrowLen = Math.min(0.6, 0.15 + (velocity ? Math.hypot(velocity[0], velocity[1], velocity[2]) * 0.12 : 0.25));

  // 三个自身坐标轴方向(自身系单位向量 → Three 局部)
  const axes: { dir: [number, number, number]; color: string; label: string }[] = [
    { dir: toLocal([1, 0, 0]), color: '#ef4444', label: "X'" },
    { dir: toLocal([0, 1, 0]), color: '#22c55e', label: "Y'" },
    { dir: toLocal([0, 0, 1]), color: '#3b82f6', label: "Z'" },
  ];
  const axisLen = 0.18;

  // 所选出风/回风面高亮：在 box 局部系放置一个半透明亮色平面贴在该面外侧。
  // box 局部轴：X=X'(L), Y=Z'(H), Z=Y'(W)，故面中心/法向按下表换算。
  const faceHL = outflowFace ? (() => {
    const map: Record<VentFace, { center: [number, number, number]; normal: [number, number, number]; w: number; h: number }> = {
      '+X': { center: [L / 2, 0, 0], normal: [1, 0, 0], w: W, h: H },
      '-X': { center: [-L / 2, 0, 0], normal: [-1, 0, 0], w: W, h: H },
      '+Y': { center: [0, 0, W / 2], normal: [0, 0, 1], w: L, h: H },
      '-Y': { center: [0, 0, -W / 2], normal: [0, 0, -1], w: L, h: H },
      '+Z': { center: [0, H / 2, 0], normal: [0, 1, 0], w: L, h: W },
      '-Z': { center: [0, -H / 2, 0], normal: [0, -1, 0], w: L, h: W },
    };
    return map[outflowFace];
  })() : null;

  return (
    <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
      <ShapeMesh x={x} y={y} L={L} W={W} H={H} shape={shape}
        material={<meshStandardMaterial color={color} transparent opacity={0.85} emissive={color} emissiveIntensity={0.3} />} />
      {/* 所选出风/回风面高亮：沿用风口本色（出风=蓝、回风=黄）。自发光实心面 + 加粗白色边框。 */}
      {faceHL && (() => {
        const off = 0.004;
        const cxn = faceHL.center[0] + faceHL.normal[0] * off;
        const cyn = faceHL.center[1] + faceHL.normal[1] * off;
        const czn = faceHL.center[2] + faceHL.normal[2] * off;
        const q = quatFromZDir(faceHL.normal);
        return (
        <>
          {/* 自发光实心面：高不透明 + emissive，远距离仍鲜明 */}
          <mesh position={[cxn, cyn, czn]} quaternion={q}>
            <planeGeometry args={[faceHL.w, faceHL.h]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9}
              transparent opacity={0.7} side={2} depthWrite={false} />
          </mesh>
          {/* 加粗白色边框线框：用三组错位线段模拟加粗（WebGL linewidth 多被忽略） */}
          {[0, 0.006, -0.006].map(d => (
            <lineSegments key={d}
              position={[faceHL.center[0] + faceHL.normal[0] * (0.006 + d), faceHL.center[1] + faceHL.normal[1] * (0.006 + d), faceHL.center[2] + faceHL.normal[2] * (0.006 + d)]}
              quaternion={q}
            >
              <edgesGeometry args={[new THREE.PlaneGeometry(faceHL.w, faceHL.h)]} />
              <lineBasicMaterial color={'#ffffff'} />
            </lineSegments>
          ))}
        </>
        );
      })()}
      <Text
        position={[0, H / 2 + 0.08, 0]}
        fontSize={0.1}
        color={color}
        anchorX="center"
        anchorY="bottom"
      >
        {name}
      </Text>
      {showArrow && (
        <>
          {/*
            出风/回风方向箭头(Three 局部系)。杆沿 +Y 布置，quatFromDir(dir) 把 +Y 转到 dir。
              nd = 杆指向(指向尖端)：
                出风 → +faceNormal(向外)，nd 即向外；尖在外、尾近中心。
                回风 → -faceNormal(向心)，nd 即向心；尾在回风面外、尖朝几何体中心。
          */}
          {(() => {
            const shaft: [number, number, number] = [0, arrowLen / 2, 0];
            const tip: [number, number, number] = [0, arrowLen + 0.03, 0];
            if (isReturn) {
              // nd 指向中心。箭头置于回风面【外侧】(-nd 方向，房间空气侧)，杆沿 +nd 指向几何体，
              // 尖端紧贴回风面、尾端在外。整组原点放在尖端正后方，使尖端落在回风面外侧附近。
              // outwardDist = 尾端到回风面的距离，确保整支箭头都在面外、不深入几何体。
              const outwardDist = arrowLen + 0.08;
              const origin: [number, number, number] = [-nd[0] * outwardDist, -nd[1] * outwardDist, -nd[2] * outwardDist];
              return (
                <group position={origin} quaternion={quatFromDir(nd)}>
                  <mesh position={shaft}>
                    <cylinderGeometry args={[0.012, 0.012, arrowLen, 8]} />
                    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
                  </mesh>
                  <mesh position={tip}>
                    <coneGeometry args={[0.04, 0.08, 10]} />
                    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
                  </mesh>
                </group>
              );
            }
            // 出风：nd 向外，组近中心，杆沿 +nd 伸向外侧，尖在外。
            return (
              <group position={[nd[0] * 0.02, nd[1] * 0.02, nd[2] * 0.02]} quaternion={quatFromDir(nd)}>
                <mesh position={shaft}>
                  <cylinderGeometry args={[0.012, 0.012, arrowLen, 8]} />
                  <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
                </mesh>
                <mesh position={tip}>
                  <coneGeometry args={[0.04, 0.08, 10]} />
                  <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
                </mesh>
              </group>
            );
          })()}
          {/* 自身坐标系小三轴 */}
          {axes.map(a => (
            <group key={a.label} quaternion={quatFromDir(a.dir)}>
              <mesh position={[0, axisLen / 2, 0]}>
                <cylinderGeometry args={[0.006, 0.006, axisLen, 6]} />
                <meshStandardMaterial color={a.color} />
              </mesh>
              <mesh position={[0, axisLen + 0.02, 0]}>
                <coneGeometry args={[0.02, 0.04, 6]} />
                <meshStandardMaterial color={a.color} />
              </mesh>
              <Text position={[0, axisLen + 0.1, 0]} fontSize={0.05} color={a.color} anchorX="center" anchorY="middle">{a.label}</Text>
            </group>
          ))}
        </>
      )}
    </group>
  );
}

/** 由方向向量(Three 局部系，单位长)求把 +Y 轴转到该方向的四元数 [x,y,z,w]。 */
function quatFromDir(d: [number, number, number]): [number, number, number, number] {
  // +Y=(0,1,0) 旋转到 d：旋转轴 = (0,1,0) × d = (d.z, 0, -d.x)，角度 = acos(d.y)
  const axis: [number, number, number] = [d[2], 0, -d[0]];
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLen < 1e-6) {
    // d 平行 +Y 或 -Y
    return d[1] >= 0 ? [0, 0, 0, 1] : [1, 0, 0, 0]; // identity or 180° about X
  }
  const ax = axis[0] / axisLen, ay = axis[1] / axisLen, az = axis[2] / axisLen;
  const ang = Math.acos(Math.max(-1, Math.min(1, d[1])));
  const s = Math.sin(ang / 2);
  return [ax * s, ay * s, az * s, Math.cos(ang / 2)];
}

/** 把平面默认法向 +Z 转到目标方向 d(Three 局部系)的四元数。 */
function quatFromZDir(d: [number, number, number]): [number, number, number, number] {
  // +Z=(0,0,1) 旋转到 d：旋转轴 = (0,0,1) × d = (-d.y, d.x, 0)，角度 = acos(d.z)
  const axis: [number, number, number] = [-d[1], d[0], 0];
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLen < 1e-6) {
    return d[2] >= 0 ? [0, 0, 0, 1] : [0, 1, 0, 0]; // identity or 180° about Y
  }
  const ax = axis[0] / axisLen, ay = axis[1] / axisLen, az = axis[2] / axisLen;
  const ang = Math.acos(Math.max(-1, Math.min(1, d[2])));
  const s = Math.sin(ang / 2);
  return [ax * s, ay * s, az * s, Math.cos(ang / 2)];
}

// =====================================================================
// Heat source marker
// =====================================================================
function HeatSourceMarker({ x, y, z, L, W, H, color, name, rotZ = 0, shape = 'box' }: {
  x: number; y: number; z: number; L: number; W: number; H: number; color: string; name: string; rotZ?: number; shape?: 'box' | 'prism' | 'prism_y' | 'cylinder_v' | 'cylinder_h';
}) {
  const cx = x + L / 2, cy = shape === 'prism' ? y - W / 2 : y + W / 2;
  return (
    <group position={[cx, z + H / 2, cy]} rotation={[0, rotZ, 0]}>
      <ShapeMesh x={x} y={y} L={L} W={W} H={H} shape={shape}
        material={<meshStandardMaterial color={color} transparent opacity={0.85} emissive={color} emissiveIntensity={0.4} />} />
      <Text
        position={[0, H / 2 + 0.08, 0]}
        fontSize={0.1}
        color={color}
        anchorX="center"
        anchorY="bottom"
      >
        {name}
      </Text>
    </group>
  );
}

// =====================================================================
// Axis labels
// =====================================================================
function AxisLabels({ length, width, height, dark }: { length: number; width: number; height: number; dark: boolean }) {
  const color = dark ? '#94a3b8' : '#64748b';
  return (
    <group>
      <Text position={[length / 2, -0.15, -0.15]} fontSize={0.15} color={color}>X ({length}m)</Text>
      <Text position={[-0.15, -0.15, width / 2]} fontSize={0.15} color={color} rotation={[0, -Math.PI / 2, 0]}>Y ({width}m)</Text>
      <Text position={[-0.15, height / 2, -0.15]} fontSize={0.15} color={color} rotation={[0, 0, Math.PI / 2]}>Z ({height}m)</Text>
    </group>
  );
}

// =====================================================================
// 3D Volume Cloud (point-based volume rendering)
// Reads results directly from simulation-store, never through React props.
// =====================================================================
function VolumeCloud({
  resultsVersion, Nx, Ny, Nz, roomLength, roomWidth, roomHeight,
  field, thresholdLo, thresholdHi, opacity, density,
}: {
  resultsVersion: number; Nx: number; Ny: number; Nz: number;
  roomLength: number; roomWidth: number; roomHeight: number;
  field: 'velocity' | 'temperature' | 'pressure';
  thresholdLo: number;  // 归一化显示下限 [0,1]：只渲染 norm ≥ lo 的体素
  thresholdHi: number;  // 归一化显示上限 [0,1]：只渲染 norm ≤ hi 的体素
  opacity: number;
  density: number;    // 采样步长(格)，1=最密，越大越稀
}) {
  const pointsRef = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const results = getSimResults();
    const physics = getPhysicsParams();
    const geo = new THREE.BufferGeometry();
    if (!results) return geo;

    const dx = roomLength / Nx;
    const dy = roomWidth / Ny;
    const dz = roomHeight / Nz;

    // Use stored physics params for conversion (consistent with engine)
    const u_scale = physics?.u_scale ?? 1;
    const T_min = physics?.T_min ?? 15;
    const T_max = physics?.T_max ?? 35;
    const rho_phys = physics?.rho_phys ?? 1.2;

    // Compute field range for normalization (in physical units)
    let vmin = Infinity, vmax = -Infinity;
    const vals = new Float32Array(Nx * Ny * Nz);
    for (let idx = 0; idx < Nx * Ny * Nz; idx++) {
      let v = 0;
      if (field === 'velocity') {
        v = Math.sqrt(results.ux[idx] ** 2 + results.uy[idx] ** 2 + results.uz[idx] ** 2) * u_scale;
      } else if (field === 'temperature') {
        v = results.T[idx] * (T_max - T_min) + T_min;
      } else {
        v = results.rho[idx] * rho_phys;
      }
      vals[idx] = v;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const range = vmax - vmin || 1;

    // 粒子基准尺寸：按单格大小自适应。乘较大系数让粒子明显可见、互相重叠形成连续云团。
    const cellSize = Math.cbrt((roomLength * roomWidth * roomHeight) / (Nx * Ny * Nz));
    const baseSize = cellSize * 3.0;

    const step = Math.max(1, Math.round(density));
    const pos: number[] = [];
    const col: number[] = [];
    const siz: number[] = [];
    const alp: number[] = [];
    for (let iz = 1; iz < Nz - 1; iz += step) {
      for (let iy = 1; iy < Ny - 1; iy += step) {
        for (let ix = 1; ix < Nx - 1; ix += step) {
          const idx = ix + iy * Nx + iz * Nx * Ny;
          const v = vals[idx];
          const norm = (v - vmin) / range;

          // 区间外(低于下限或高于上限)的体素不渲染，只显示 [lo, hi] 区间
          if (norm < thresholdLo || norm > thresholdHi) continue;

          const rx = (ix + 0.5) * dx;
          const ry = (iy + 0.5) * dy;
          const rz = (iz + 0.5) * dz;
          pos.push(rx, rz, ry);

          const [r, g, b] = heatmapRGB(norm);
          col.push(r, g, b);
          // 大小随强度增长；alpha 也随强度加权，弱信号更透明，叠加更自然。
          siz.push(baseSize * (0.6 + norm * 0.8));
          alp.push(0.25 + norm * 0.75);
        }
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(col), 3));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(siz), 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(alp), 1));
    return geo;
  }, [resultsVersion, Nx, Ny, Nz, roomLength, roomWidth, roomHeight, field, thresholdLo, thresholdHi, density]);

  // 自定义着色器材质(全局单例)：逐点 size + 逐点 alpha + AdditiveBlending。
  // 仅更新 opacity uniform，不随 geometry 重建，避免每次重建材质。
  const material = useMemo(() => getCloudMaterial(), []);
  useEffect(() => {
    material.uniforms.uOpacity.value = opacity;
  }, [material, opacity]);

  // 重建 geometry 前释放旧的，避免显存累积导致 WebGL context 丢失。
  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

// =====================================================================
// 2D Slice Plane in 3D scene
// Reads results directly from simulation-store, never through React props.
// =====================================================================
function SlicePlane({
  resultsVersion, Nx, Ny, Nz, roomLength, roomWidth, roomHeight,
  sliceAxis, sliceIndex, field,
}: {
  resultsVersion: number; Nx: number; Ny: number; Nz: number;
  roomLength: number; roomWidth: number; roomHeight: number;
  sliceAxis: 'x' | 'y' | 'z';
  sliceIndex: number;
  field: 'velocity' | 'temperature' | 'pressure';
}) {
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  // Compute slice data and create texture
  const { texture, planeArgs, planePos, planeRot } = useMemo(() => {
    // Read results directly from global store — bypasses React props entirely
    const results = getSimResults();
    const physics = getPhysicsParams();
    if (!results) return { texture: null as any, planeArgs: [1, 1] as [number, number], planePos: [0, 0, 0] as [number, number, number], planeRot: [0, 0, 0] as [number, number, number] };

    const dx = roomLength / Nx;
    const dy = roomWidth / Ny;
    const dz = roomHeight / Nz;

    // Use stored physics params for conversion (consistent with engine)
    const u_scale = physics?.u_scale ?? 1;
    const T_min = physics?.T_min ?? 15;
    const T_max = physics?.T_max ?? 35;
    const rho_phys = physics?.rho_phys ?? 1.2;

    // Compute field range for GLOBAL normalization (in physical units)
    let vmin = Infinity, vmax = -Infinity;
    for (let idx = 0; idx < Nx * Ny * Nz; idx++) {
      let v = 0;
      if (field === 'velocity') v = Math.sqrt(results.ux[idx] ** 2 + results.uy[idx] ** 2 + results.uz[idx] ** 2) * u_scale;
      else if (field === 'temperature') v = results.T[idx] * (T_max - T_min) + T_min;
      else v = results.rho[idx] * rho_phys;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const range = vmax - vmin || 1;

    let W: number, H: number;
    if (sliceAxis === 'z') { W = Nx; H = Ny; }
    else if (sliceAxis === 'y') { W = Nx; H = Nz; }
    else { W = Ny; H = Nz; }

    // Extract slice data using GLOBAL range for consistent coloring
    const vals = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        let idx: number;
        if (sliceAxis === 'z') {
          idx = i + j * Nx + sliceIndex * Nx * Ny;
        } else if (sliceAxis === 'y') {
          idx = i + sliceIndex * Nx + j * Nx * Ny;
        } else {
          idx = sliceIndex + i * Nx + j * Nx * Ny;
        }

        let v = 0;
        if (field === 'velocity') v = Math.sqrt(results.ux[idx] ** 2 + results.uy[idx] ** 2 + results.uz[idx] ** 2) * u_scale;
        else if (field === 'temperature') v = results.T[idx] * (T_max - T_min) + T_min;
        else v = results.rho[idx];
        vals[j * W + i] = v;
      }
    }

    // Create canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(W, H);

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const norm = (vals[j * W + i] - vmin) / range;
        const [r, g, b] = heatmapRGB(norm);
        const canvasJ = sliceAxis === 'z' ? H - 1 - j : j;
        const pi = (canvasJ * W + i) * 4;
        imgData.data[pi] = Math.floor(r * 255);
        imgData.data[pi + 1] = Math.floor(g * 255);
        imgData.data[pi + 2] = Math.floor(b * 255);
        imgData.data[pi + 3] = 200;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = false;

    // Plane dimensions, position, and rotation in room coordinates
    let args: [number, number];
    let pos: [number, number, number];
    let rot: [number, number, number];

    if (sliceAxis === 'z') {
      const roomZ = (sliceIndex + 0.5) * dz;
      args = [roomLength, roomWidth];
      pos = [roomLength / 2, roomZ, roomWidth / 2];
      rot = [-Math.PI / 2, 0, 0];
    } else if (sliceAxis === 'y') {
      const roomY = (sliceIndex + 0.5) * dy;
      args = [roomLength, roomHeight];
      pos = [roomLength / 2, roomHeight / 2, roomY];
      rot = [0, 0, 0];
    } else {
      const roomX = (sliceIndex + 0.5) * dx;
      args = [roomWidth, roomHeight];
      pos = [roomX, roomHeight / 2, roomWidth / 2];
      rot = [0, -Math.PI / 2, 0];
    }

    return { texture: tex, planeArgs: args, planePos: pos, planeRot: rot };
  }, [resultsVersion, Nx, Ny, Nz, roomLength, roomWidth, roomHeight, sliceAxis, sliceIndex, field]);

  // Cleanup old texture
  useEffect(() => {
    return () => { if (texture) texture.dispose(); };
  }, [texture]);

  if (!texture) return null;

  return (
    <mesh ref={meshRef} position={planePos} rotation={planeRot}>
      <planeGeometry args={planeArgs} />
      <meshBasicMaterial map={texture} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// =====================================================================
// Color legend bar
// =====================================================================
function ColorLegend({ field, vmin, vmax }: { field: string; vmin: number; vmax: number }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = 30, H = 300;
    canvas.width = W;
    canvas.height = H;

    for (let j = 0; j < H; j++) {
      const t = 1 - j / H;
      const [r, g, b] = heatmapRGB(t);
      ctx.fillStyle = `rgb(${Math.floor(r * 255)},${Math.floor(g * 255)},${Math.floor(b * 255)})`;
      ctx.fillRect(0, j, W, 1);
    }
  }, []);

  let label = '';
  let unit = '';
  if (field === 'velocity') {
    label = t('viewer.velLabel');
    unit = ' m/s';
  } else if (field === 'temperature') {
    label = t('viewer.tempLabel');
    unit = ' °C';
  } else {
    label = t('viewer.densityLabel');
    unit = ' kg/m³';
  }

  const ticks = [];
  for (let i = 0; i <= 4; i++) {
    const value = vmin + (vmax - vmin) * (1 - i / 4);
    ticks.push(value);
  }

  return (
    <div className="absolute right-3 top-3 flex items-start gap-2 pointer-events-none">
      <div className="flex flex-col items-center bg-white/60 dark:bg-black/50 backdrop-blur-sm rounded-lg p-2">
        <span className="text-xs text-gray-900 dark:text-white font-bold mb-2">{label}</span>
        <div className="flex items-center gap-1">
          <div className="flex flex-col justify-between h-[300px] text-[11px] text-gray-900 dark:text-white font-mono">
            {ticks.map((tick, i) => (
              <span key={i} className="text-right">{tick.toFixed(3)}{unit}</span>
            ))}
          </div>
          <canvas ref={canvasRef} className="w-[30px] h-[300px] rounded border-2 border-gray-300 dark:border-white/30" />
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// RotationRing — a horizontal ring handle to rotate an object about the
// vertical axis (room z = Three world Y). Drag on the ring updates rotZ.
// =====================================================================
function RotationRing({
  centerX, centerY, centerZ, radius, rotZ, color, onDragStart, onDragEnd, onChange,
}: {
  centerX: number; centerY: number; centerZ: number; radius: number; rotZ: number;
  color: string;
  onDragStart: () => void; onDragEnd: () => void;
  onChange: (newRotZ: number) => void;
}) {
  const { camera, gl, raycaster } = useThree();
  // Latest rotZ captured at drag start so the handler closure sees the right value.
  const startRotZRef = useRef(rotZ);
  // Horizontal plane at the ring's height (world Y = centerY).
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -centerY), [centerY]);

  const angleAtPointer = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, hit);
    return Math.atan2(hit.z - centerZ, hit.x - centerX);
  }, [camera, gl, raycaster, plane, centerX, centerZ]);

  const onPointerDown = (e: any) => {
    e.stopPropagation();
    const startAngle = angleAtPointer(e.clientX, e.clientY);
    startRotZRef.current = rotZ;
    onDragStart();

    const onMove = (ev: PointerEvent) => {
      const ang = angleAtPointer(ev.clientX, ev.clientY);
      let d = ang - startAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      onChange(startRotZRef.current + d);
    };
    const onUp = () => {
      onDragEnd();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <mesh
      position={[centerX, centerY, centerZ]}
      rotation={[-Math.PI / 2, 0, 0]} // lay flat in the horizontal plane
      onPointerDown={onPointerDown}
    >
      <ringGeometry args={[radius, radius + 0.06, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
    </mesh>
  );
}

// =====================================================================
// DraggableItem — wraps a scene object, adds click-to-select and
// axis-constrained dragging via PivotControls.
// =====================================================================
function DraggableItem({
  kind, id, x, y, z, L, W, H, roomDims, selected, onSelect, setRoom, dragging, onDragStateChange, dark, prism, rotZ, children,
}: {
  kind: DragKind;
  id: string;
  x: number; y: number; z: number; L: number; W: number; H: number;
  roomDims: [number, number, number];
  selected: boolean;
  onSelect: (sel: Selection) => void;
  setRoom: React.Dispatch<React.SetStateAction<RoomLayout>>;
  dragging: boolean;
  onDragStateChange: (v: boolean) => void;
  dark: boolean;
  prism?: boolean;
  rotZ?: number;
  children: React.ReactNode;
}) {
  const startRoom = useRef({ x, y, z });
  const [centerWX, centerWY, centerWZ] = roomToWorldCenter(x, y, z, L, W, H, prism);

  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ kind, id });
      }}
    >
      {children}

      {/* Selection highlight: 包围盒随对象一起绕竖直轴旋转，与旋转后几何贴合 */}
      {selected && (
        <Box args={[L + 0.04, H + 0.04, W + 0.04]} position={[centerWX, centerWY, centerWZ]} rotation={[0, rotZ ?? 0, 0]}>
          <meshBasicMaterial color={dark ? '#fbbf24' : '#2563eb'} wireframe />
          <Edges threshold={15} color={dark ? '#fbbf24' : '#2563eb'} />
        </Box>
      )}

      {selected && setRoom && (
        <group position={[centerWX, centerWY, centerWZ]} rotation={[0, rotZ ?? 0, 0]}>
          <PivotControls
            scale={1.3}
            lineWidth={4}
            autoTransform={false}
            disableRotations
            disableScaling
            disableSliders
            anchor={[0, 0, 0]}
            depthTest={false}
            annotations
            onDragStart={() => {
              startRoom.current = { x, y, z };
              onDragStateChange(true);
            }}
            onDrag={(_l, _deltaL, _w, deltaW) => {
              // deltaW is the accumulated world delta matrix from drag start.
              const t = new THREE.Vector3().setFromMatrixPosition(deltaW);
              applyDragDelta(kind, id, startRoom.current, { L, W, H }, t.x, t.y, t.z, roomDims, setRoom, prism, rotZ ?? 0);
            }}
            onDragEnd={() => onDragStateChange(false)}
          >
            {/* Invisible anchor mesh: gives PivotControls a bounding box so the
                gizmo can compute its position. Without it the empty bbox yields
                NaN and the arrows never appear. Sized to the object (world axes:
                X=L, Y=H, Z=W), centered at this group's origin (object center). */}
            <mesh visible={false}>
              <boxGeometry args={[L, H, W]} />
              <meshBasicMaterial />
            </mesh>
          </PivotControls>
        </group>
      )}

      {/* Z-axis rotation ring */}
      {selected && setRoom && (
        <RotationRing
          centerX={centerWX} centerY={centerWY} centerZ={centerWZ}
          radius={Math.sqrt(L * L + W * W) / 2 + 0.12}
          rotZ={rotZ ?? 0}
          color={dark ? '#fbbf24' : '#2563eb'}
          onDragStart={() => onDragStateChange(true)}
          onDragEnd={() => onDragStateChange(false)}
          onChange={(newRotZ) => {
            setRoom(prev => {
              if (kind === 'box') return { ...prev, boxes: prev.boxes.map(b => b.id === id ? { ...b, rotZ: newRotZ } : b) };
              if (kind === 'vent') return { ...prev, vents: prev.vents.map(v => v.id === id ? { ...v, rotZ: newRotZ } : v) };
              if (kind === 'heat') return { ...prev, heatSources: prev.heatSources.map(h => h.id === id ? { ...h, rotZ: newRotZ } : h) };
              // device
              return { ...prev, devices: prev.devices.map(d => d.id === id ? { ...d, rotZ: newRotZ } : d) };
            });
          }}
        />
      )}
    </group>
  );
}

// =====================================================================
// Scene content
// Reads results directly from simulation-store, never through React props.
// =====================================================================
interface SceneContentProps {
  room: RoomLayout;
  resultsVersion: number;
  Nx: number; Ny: number; Nz: number;
  field: 'velocity' | 'temperature' | 'pressure';
  slices: SliceConfig[];
  showCloud: boolean;
  cloudThresholdLo: number;
  cloudThresholdHi: number;
  cloudOpacity: number;
  cloudDensity: number;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  setRoom: React.Dispatch<React.SetStateAction<RoomLayout>> | null;
  dragging: boolean;
  onDragStateChange: (v: boolean) => void;
  showVentArrows: boolean;
}

/**
 * 居中锚定：把 OrbitControls 的 target 固定到房间几何中心 (L/2, H/2, W/2)，
 * 并把相机平移到「中心 + 初始偏移向量」，保持绕 z 轴旋转 90° 后的默认视角朝向不变，
 * 仅消除房间偏右上角的问题。房间尺寸变化时自动同步。
 */
function CenterRig({ orbitRef, room }: { orbitRef: React.MutableRefObject<any>, room: RoomLayout }) {
  const { camera } = useThree();
  useEffect(() => {
    // 房间中心（Three 世界坐标：X=L/2, Y=H/2, Z=W/2）
    const cx = room.length / 2, cy = room.height / 2, cz = room.width / 2;
    // 相机相对中心的初始偏移：保持绕 z 轴旋转 90° 的视角（与 Canvas camera prop 一致）
    const offX = -room.width * 1.5, offY = room.height * 1.8, offZ = room.length * 1.5;
    camera.position.set(cx + offX, cy + offY, cz + offZ);
    if (orbitRef.current) {
      orbitRef.current.target.set(cx, cy, cz);
      orbitRef.current.update();
    }
    camera.lookAt(cx, cy, cz);
  }, [room.length, room.width, room.height, camera, orbitRef]);
  return null;
}

function SceneContent({ room, resultsVersion, Nx, Ny, Nz, field, slices, showCloud, cloudThresholdLo, cloudThresholdHi, cloudOpacity, cloudDensity, dark, selection, onSelect, setRoom, dragging, onDragStateChange, showVentArrows }: SceneContentProps & { dark: boolean }) {
  const results = getSimResults(); // Read from global store — never through React props
  const roomDims: [number, number, number] = [room.length, room.width, room.height];
  const orbitRef = useRef<any>(null);

  return (
    <>
      <ThemeBackground />
      <ambientLight intensity={0.5} />
      <directionalLight position={[-room.width * 1.5, room.height * 2, room.length * 1.5]} intensity={0.7} />
      <directionalLight position={[-room.length, room.height, -room.width]} intensity={0.3} />

      <RoomWalls length={room.length} width={room.width} height={room.height} dark={dark} />
      <AxisLabels length={room.length} width={room.width} height={room.height} dark={dark} />

      {room.boxes.map(b => (
        <DraggableItem
          key={b.id}
          kind="box" id={b.id}
          x={b.x} y={b.y} z={b.z} L={b.L} W={b.W} H={b.H}
          roomDims={roomDims}
          selected={selection?.kind === 'box' && selection.id === b.id}
          onSelect={onSelect}
          setRoom={setRoom!}
          dragging={dragging} onDragStateChange={onDragStateChange}
          dark={dark}
          prism={b.shape === 'prism'}
          rotZ={b.rotZ ?? 0}
        >
          <FurnitureBox {...b} dark={dark} shape={b.shape} doorHoles={b.doorHoles} parts={b.parts} rotZ={b.rotZ ?? 0} />
        </DraggableItem>
      ))}
      {room.vents.map(v => (
        <DraggableItem
          key={v.id}
          kind="vent" id={v.id}
          x={v.x} y={v.y} z={v.z} L={v.L} W={v.W} H={v.H}
          roomDims={roomDims}
          selected={selection?.kind === 'vent' && selection.id === v.id}
          onSelect={onSelect}
          setRoom={setRoom!}
          dragging={dragging} onDragStateChange={onDragStateChange}
          dark={dark}
          prism={v.shape === 'prism'}
          rotZ={v.rotZ ?? 0}
        >
          <VentMarker {...v} dark={dark} rotZ={v.rotZ ?? 0} shape={v.shape ?? 'box'} showArrow={showVentArrows}
            outflowFace={v.ventType === 'velocity_inlet' ? deriveFaceFromVelocity(v.velocity) : deriveInflowFace(v.velocity)}
            isReturn={v.ventType !== 'velocity_inlet'} />
        </DraggableItem>
      ))}
      {room.heatSources.map(h => (
        <DraggableItem
          key={h.id}
          kind="heat" id={h.id}
          x={h.x} y={h.y} z={h.z} L={h.L} W={h.W} H={h.H}
          roomDims={roomDims}
          selected={selection?.kind === 'heat' && selection.id === h.id}
          onSelect={onSelect}
          setRoom={setRoom!}
          dragging={dragging} onDragStateChange={onDragStateChange}
          dark={dark}
          prism={h.shape === 'prism'}
          rotZ={h.rotZ ?? 0}
        >
          <HeatSourceMarker {...h} rotZ={h.rotZ ?? 0} shape={h.shape ?? 'box'} />
        </DraggableItem>
      ))}

      {/* Render standard devices */}
      {room.devices?.map(device => {
        const devRot = device.rotZ ?? 0;
        const cx = device.position.x + device.geometry.length / 2;
        const cy = device.position.y + device.geometry.width / 2;
        return (
        <DraggableItem
          key={device.id}
          kind="device" id={device.id}
          x={device.position.x} y={device.position.y} z={device.position.z}
          L={device.geometry.length} W={device.geometry.width} H={device.geometry.height}
          roomDims={roomDims}
          selected={selection?.kind === 'device' && selection.id === device.id}
          onSelect={onSelect}
          setRoom={setRoom!}
          dragging={dragging} onDragStateChange={onDragStateChange}
          dark={dark}
          rotZ={devRot}
        >
          {/* 整体绕设备水平中心旋转：body 与出/回风口随设备一起转。
              body 用 FurnitureBox(rotZ=devRot) 自身旋转(绕其中心=设备中心)，
              出/回风口位置由 rotateZ2D 旋转后的相对位置给出，标记本身 rotZ=devRot
              随设备旋转，使出风面高亮/箭头与设备朝向一致。 */}
          <FurnitureBox
            name={device.name}
            x={device.position.x}
            y={device.position.y}
            z={device.position.z}
            L={device.geometry.length}
            W={device.geometry.width}
            H={device.geometry.height}
            color={device.color}
            dark={dark}
            shape="box"
            parts={device.bodyParts}
            rotZ={devRot}
          />
          {device.outlets.map(outlet => {
            // relativePosition 为风口【中心】相对设备最小角(自身系)。绕设备水平中心
            // 旋转 devRot 后落到房间系，再减半尺寸得最小角，与引擎一致。
            const dcx = device.geometry.length / 2, dcy = device.geometry.width / 2;
            const [rx, ry] = rotateZ2D(outlet.relativePosition[0] - dcx, outlet.relativePosition[1] - dcy, devRot);
            const pcx = device.position.x + dcx, pcy = device.position.y + dcy;
            return (
              <VentMarker
                key={outlet.id}
                name={`${device.name}-${outlet.name}`}
                x={pcx + rx - outlet.size[0] / 2}
                y={pcy + ry - outlet.size[1] / 2}
                z={device.position.z + outlet.relativePosition[2] - outlet.size[2] / 2}
                L={outlet.size[0]}
                W={outlet.size[1]}
                H={outlet.size[2]}
                color="#3b82f6"
                rotZ={devRot}
                velocity={outlet.velocity}
                outflowFace={deriveFaceFromVelocity(outlet.velocity)}
                showArrow={showVentArrows}
              />
            );
          })}
          {device.inlets.map(inlet => {
            const dcx = device.geometry.length / 2, dcy = device.geometry.width / 2;
            const [rx, ry] = rotateZ2D(inlet.relativePosition[0] - dcx, inlet.relativePosition[1] - dcy, devRot);
            const pcx = device.position.x + dcx, pcy = device.position.y + dcy;
            const inVel = inlet.velocity ?? [0, 0, 0];
            // 回风面=空气进入侧(出风面反向)；VentMarker 以 isReturn 标识回风口，
            // 箭头改为"由外指向回风面"（与回风方向一致），区别于出风口的向外箭头。
            // 压力模式速度≈0，改由风口尺寸+位置推断面(最薄轴朝房间外侧)。
            const inFace = inlet.mode === 'velocity'
              ? deriveInflowFace(inVel)
              : deriveFaceFromSize(inlet.size, [
                  inlet.relativePosition[0] - device.geometry.length / 2,
                  inlet.relativePosition[1] - device.geometry.width / 2,
                  inlet.relativePosition[2] - device.geometry.height / 2,
                ]);
            return (
              <VentMarker
                key={inlet.id}
                name={`${device.name}-${inlet.name}`}
                x={pcx + rx - inlet.size[0] / 2}
                y={pcy + ry - inlet.size[1] / 2}
                z={device.position.z + inlet.relativePosition[2] - inlet.size[2] / 2}
                L={inlet.size[0]}
                W={inlet.size[1]}
                H={inlet.size[2]}
                color="#f59e0b"
                rotZ={devRot}
                velocity={inVel}
                outflowFace={inFace}
                isReturn
                showArrow={showVentArrows}
              />
            );
          })}
        </DraggableItem>
        );
      })}

      {results && showCloud && (
        <VolumeCloud
          resultsVersion={resultsVersion} Nx={Nx} Ny={Ny} Nz={Nz}
          roomLength={room.length} roomWidth={room.width} roomHeight={room.height}
          field={field} thresholdLo={cloudThresholdLo} thresholdHi={cloudThresholdHi} opacity={cloudOpacity} density={cloudDensity}
        />
      )}

      {results && slices.filter(s => s.visible).map(s => (
        <SlicePlane
          key={s.id}
          resultsVersion={resultsVersion} Nx={Nx} Ny={Ny} Nz={Nz}
          roomLength={room.length} roomWidth={room.width} roomHeight={room.height}
          sliceAxis={s.axis} sliceIndex={s.index} field={field}
        />
      ))}

      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.1} enabled={!dragging} />
      <CenterRig orbitRef={orbitRef} room={room} />

      {/* 左下角 XYZ 轴指示器：标注房间坐标系 (Three X=房间x, Three Y=房间z高, Three Z=房间y) */}
      <GizmoHelper alignment="bottom-left" margin={[72, 72]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labels={['x', 'z', 'y']} />
      </GizmoHelper>
    </>
  );
}

// =====================================================================
// Main exported component
// =====================================================================
interface FlowViewer3DProps {
  room: RoomLayout;
  setRoom?: React.Dispatch<React.SetStateAction<RoomLayout>>;
  resultsVersion: number;
  Nx: number; Ny: number; Nz: number;
  showVentArrows?: boolean; // 在边界条件 section 显示出风/回风方向箭头 + 自身坐标轴
}

export default function FlowViewer3D({ room, setRoom, resultsVersion, Nx, Ny, Nz, showVentArrows = false }: FlowViewer3DProps) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const isDark = theme === 'dark';
  const [field, setField] = useState<'velocity' | 'temperature' | 'pressure'>('temperature');
  // 多个截面切片：默认一个 z 轴水平切片位于中部。
  const [slices, setSlices] = useState<SliceConfig[]>(() => [
    { id: genSliceId(), axis: 'z', index: Math.floor(Nz / 2), visible: true },
  ]);
  const [showCloud, setShowCloud] = useState(true);
  const [cloudThresholdLo, setCloudThresholdLo] = useState(0.15); // 归一化显示下限 [0,1]
  const [cloudThresholdHi, setCloudThresholdHi] = useState(1.0);  // 归一化显示上限 [0,1]
  const [cloudOpacity, setCloudOpacity] = useState(0.6);
  const [cloudDensity, setCloudDensity] = useState(2); // 采样步长(格)：1最密，越大越稀
  const [canvasKey, setCanvasKey] = useState(0);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [dragging, setDragging] = useState(false);
  const [controlCollapsed, setControlCollapsed] = useState(false); // 显示控制卡片可收起

  // WebGL context loss handler
  // 限制重建次数：若反复丢失（多为 GPU 资源泄漏），停止无限重建，提示用户手动重试。
  const rebuildCountRef = useRef(0);
  const MAX_REBUILDS = 10;
  const handleContextLost = useCallback((event: Event) => {
    event.preventDefault();
    rebuildCountRef.current += 1;
    console.warn(`WebGL context lost (重建第 ${rebuildCountRef.current} 次)...`);
    if (rebuildCountRef.current > MAX_REBUILDS) {
      // 反复丢失 → 不再自动重建，避免无限循环，交由用户决定
      setCanvasError(t('viewer.webglLostRepeat'));
      return;
    }
    setCanvasError(t('viewer.webglLostRebuild'));
    setTimeout(() => {
      setCanvasKey(prev => prev + 1);
      setCanvasError(null);
    }, 500);
  }, []);

  const handleCanvasError = useCallback((error: any) => {
    console.error('Canvas Error:', error);
    setCanvasError(error.message || t('viewer.webglInitFail'));
    setTimeout(() => {
      setCanvasKey(prev => prev + 1);
      setCanvasError(null);
    }, 1000);
  }, []);

  // Compute field range for legend — reads from global store, uses stored physics params
  const { vmin, vmax, currentStep } = useMemo(() => {
    const results = getSimResults(); // Read directly from global store
    const physics = getPhysicsParams(); // Read stored physics conversion params
    if (!results) return { vmin: 0, vmax: 1, currentStep: 0 };

    // Use stored physics params for correct physical unit conversion
    const u_scale = physics?.u_scale ?? 1;
    const T_min = physics?.T_min ?? 15;
    const T_max = physics?.T_max ?? 35;
    const rho_phys = physics?.rho_phys ?? 1.2;

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < Nx * Ny * Nz; i++) {
      let v = 0;
      if (field === 'velocity') {
        const u_lattice = Math.sqrt(results.ux[i] ** 2 + results.uy[i] ** 2 + results.uz[i] ** 2);
        v = u_lattice * u_scale;
      } else if (field === 'temperature') {
        v = results.T[i] * (T_max - T_min) + T_min;
      } else {
        v = results.rho[i] * rho_phys;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { vmin: lo, vmax: hi, currentStep: results.step };
  }, [resultsVersion, field, Nx, Ny, Nz]);

  // 每个轴向的切片最大索引（留 1 格边界）。
  const maxSliceFor = useCallback((axis: SliceAxis) =>
    axis === 'z' ? Math.max(1, Nz - 2) : axis === 'y' ? Math.max(1, Ny - 2) : Math.max(1, Nx - 2),
    [Nx, Ny, Nz]);

  // 网格变化（如导入不同分辨率结果）时，把越界的切片索引夹回合法范围。
  useEffect(() => {
    setSlices(prev => prev.some(s => s.index > maxSliceFor(s.axis) || s.index < 1)
      ? prev.map(s => ({ ...s, index: Math.min(Math.max(s.index, 1), maxSliceFor(s.axis)) }))
      : prev);
  }, [maxSliceFor]);

  return (
    <div className="w-full h-full min-h-[500px] bg-gray-100 dark:bg-black rounded-lg overflow-hidden relative">
      {canvasError ? (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center p-8 bg-red-900/50 rounded-lg max-w-md">
            <div className="text-6xl mb-4">😢</div>
            <div className="text-white text-sm mb-2">{t('viewer.webglError')}</div>
            <div className="text-red-300 text-xs">{canvasError}</div>
            <button
              onClick={() => {
                rebuildCountRef.current = 0; // 手动重试：重置计数，给一次全新尝试
                setCanvasKey(prev => prev + 1);
                setCanvasError(null);
              }}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
            >
              {t('viewer.retry')}
            </button>
          </div>
        </div>
      ) : (
        <Canvas
          key={canvasKey}
          frameloop="demand"   // 仅在有变化时渲染一帧，静止时不再以 60fps 空转，根治 rAF 长任务与空闲 GPU 占用
          dpr={[1, 2]}         // 限制设备像素比上限为 2，避免高分屏下帧负担过重
          camera={{ position: [-room.width * 1.5, room.height * 1.8, room.length * 1.5], fov: 45 }}
          gl={{
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
          }}
          onCreated={({ gl }) => {
            gl.setClearColor(isDark ? DARK_BG : LIGHT_BG, 1);
            gl.domElement.addEventListener('webglcontextlost', handleContextLost);
          }}
          onError={handleCanvasError}
          onPointerMissed={() => setSelection(null)}
        >
          <SceneContent
            room={room} resultsVersion={resultsVersion} Nx={Nx} Ny={Ny} Nz={Nz}
            field={field} slices={slices}
            showCloud={showCloud}
            cloudThresholdLo={cloudThresholdLo} cloudThresholdHi={cloudThresholdHi} cloudOpacity={cloudOpacity} cloudDensity={cloudDensity}
            dark={isDark}
            selection={selection} onSelect={setSelection}
            setRoom={setRoom ?? null}
            dragging={dragging} onDragStateChange={setDragging}
            showVentArrows={showVentArrows}
          />
        </Canvas>
      )}

      {/* Color legend */}
      <ColorLegend field={field} vmin={vmin} vmax={vmax} />

      {/* Drag hint */}
      {setRoom && (
        <div className="absolute right-3 bottom-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded px-3 py-1.5 text-[11px] text-gray-700 dark:text-gray-300 pointer-events-none max-w-[220px] text-right">
          {selection
            ? t('viewer.dragSelected') + (dragging ? t('viewer.dragging') : '')
            : t('viewer.dragHint')}
        </div>
      )}

      {/* Control panel overlay */}
      <div className="absolute left-3 top-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur rounded-lg p-3 text-xs text-gray-700 dark:text-gray-200 space-y-2 min-w-[180px] pointer-events-auto">
        <button
          onClick={() => setControlCollapsed(v => !v)}
          className="flex items-center justify-between w-full font-semibold text-sm text-gray-900 dark:text-white mb-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          title={controlCollapsed ? t('viewer.expand') : t('viewer.collapse')}
        >
          <span>{t('viewer.displayCtrl')}</span>
          <span className={`text-[10px] text-gray-400 dark:text-gray-500 transition-transform duration-200 ${controlCollapsed ? '' : 'rotate-90'}`}>▶</span>
        </button>

        {!controlCollapsed && (<>
        {/* Field selector */}
        <div className="flex items-center gap-2">
          <span className="w-12">{t('viewer.field')}</span>
          <select
            value={field}
            onChange={e => setField(e.target.value as 'velocity' | 'temperature' | 'pressure')}
            className="bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 text-xs flex-1"
          >
            <option value="temperature">{t('viewer.temperature')}</option>
            <option value="velocity">{t('viewer.velocity')}</option>
            <option value="pressure">{t('viewer.density')}</option>
          </select>
        </div>

        {/* Cloud toggle */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={showCloud} onChange={e => setShowCloud(e.target.checked)} className="accent-blue-500" />
          <span>{t('viewer.cloud3d')}</span>
        </div>
        {showCloud && (() => {
          // 阈值是归一化值 norm=(v-vmin)/(vmax-vmin)∈[0,1]；换算成物理量给用户看。
          const unit = field === 'velocity' ? 'm/s' : field === 'temperature' ? '°C' : 'kg/m³';
          const loPhys = vmin + (vmax - vmin) * cloudThresholdLo;
          const hiPhys = vmin + (vmax - vmin) * cloudThresholdHi;
          // 保证 lo ≤ hi：调整一个时钳制另一个，避免区间反转。
          const setLo = (v: number) => setCloudThresholdLo(Math.min(v, cloudThresholdHi));
          const setHi = (v: number) => setCloudThresholdHi(Math.max(v, cloudThresholdLo));
          return (
          <>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-12">{t('viewer.lower')}:</span>
                <input type="range" min={0} max={1} step={0.01} value={cloudThresholdLo}
                  onChange={e => setLo(parseFloat(e.target.value))}
                  className={RANGE_SLIDER} />
                <span className="w-10 text-right">{(cloudThresholdLo * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12">{t('viewer.upper')}:</span>
                <input type="range" min={0} max={1} step={0.01} value={cloudThresholdHi}
                  onChange={e => setHi(parseFloat(e.target.value))}
                  className={RANGE_SLIDER} />
                <span className="w-10 text-right">{(cloudThresholdHi * 100).toFixed(0)}%</span>
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500 pl-14">
                {t('viewer.cloudRange', { lo: loPhys.toFixed(3), hi: hiPhys.toFixed(3), unit, vmin: vmin.toFixed(2), vmax: vmax.toFixed(2) })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12">{t('viewer.opacity')}:</span>
              <input type="range" min={0.1} max={1} step={0.05} value={cloudOpacity}
                onChange={e => setCloudOpacity(parseFloat(e.target.value))}
                className={RANGE_SLIDER} />
              <span className="w-8 text-right">{cloudOpacity.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12">{t('viewer.cloudDensity')}:</span>
              <input type="range" min={1} max={5} step={1} value={cloudDensity}
                onChange={e => setCloudDensity(parseInt(e.target.value))}
                className={RANGE_SLIDER} />
              <span className="w-8 text-right">{cloudDensity}</span>
            </div>
          </>
          );
        })()}

        {/* 截面切片：支持同时显示多个不同轴向/位置的切片 */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-700 dark:text-gray-200">{t('viewer.slices')}</span>
          <button
            onClick={() => setSlices(prev => [...prev, { id: genSliceId(), axis: 'z', index: Math.floor(Nz / 2), visible: true }])}
            className="text-xs bg-green-500 text-white px-2 py-0.5 rounded hover:bg-green-600 transition-all"
          >{t('viewer.addSlice')}</button>
        </div>
        {slices.map((s, i) => {
          const maxIdx = maxSliceFor(s.axis);
          return (
            <div key={s.id} className="bg-gray-50 dark:bg-gray-700/50 rounded p-1.5 space-y-1 border border-gray-200 dark:border-slate-600">
              <div className="flex items-center gap-1">
                <input type="checkbox" checked={s.visible}
                  onChange={e => setSlices(prev => prev.map(x => x.id === s.id ? { ...x, visible: e.target.checked } : x))}
                  className="accent-green-500" />
                <span className="text-gray-500 dark:text-gray-400">#{i + 1}</span>
                <select
                  value={s.axis}
                  onChange={e => {
                    const ax = e.target.value as SliceAxis;
                    setSlices(prev => prev.map(x => x.id === s.id ? { ...x, axis: ax, index: Math.floor((ax === 'z' ? Nz : ax === 'y' ? Ny : Nx) / 2) } : x));
                  }}
                  className="bg-gray-100 dark:bg-gray-700 rounded px-1 py-0.5 text-xs flex-1"
                >
                  <option value="z">{t('viewer.axisZ')}</option>
                  <option value="y">{t('viewer.axisY')}</option>
                  <option value="x">{t('viewer.axisX')}</option>
                </select>
                <button
                  onClick={() => setSlices(prev => prev.length > 1 ? prev.filter(x => x.id !== s.id) : prev)}
                  disabled={slices.length <= 1}
                  className="text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed px-1 text-xs"
                  title={t('viewer.deleteSlice')}
                >✕</button>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-8 text-gray-500 dark:text-gray-400">{t('viewer.position')}</span>
                <input type="range" min={1} max={maxIdx} step={1} value={Math.min(s.index, maxIdx)}
                  onChange={e => setSlices(prev => prev.map(x => x.id === s.id ? { ...x, index: parseInt(e.target.value) } : x))}
                  className={RANGE_SLIDER} />
                <span className="w-8 text-right">{Math.min(s.index, maxIdx)}</span>
              </div>
            </div>
          );
        })}
        </>)}
      </div>

      {/* Info overlay — uses step from global store */}
      {resultsVersion > 0 && (
        <div className="absolute left-3 bottom-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded px-3 py-1.5 text-[10px] text-gray-700 dark:text-gray-300 pointer-events-none">
          {t('viewer.infoBar', { step: currentStep, field: field === 'velocity' ? t('viewer.velocity') : field === 'temperature' ? t('viewer.temperature') : t('viewer.density'), vmin: vmin.toFixed(3), vmax: vmax.toFixed(3) })}
        </div>
      )}
    </div>
  );
}