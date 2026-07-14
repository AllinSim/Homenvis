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

import { type RoomLayout, isWallLike } from '@/lib/room-layout';

/**
 * 布局俯视图缩略图：把 RoomLayout 渲染成一张 SVG 顶视图。
 * 用于样板间列表，比 emoji 更直观地反映房间形状与设备布置。
 *
 * 坐标约定（与房间坐标系一致，俯视看下去）：
 *   x 向右、y 向下；房间 length(x) × width(y)。z 不显示（俯视无深度）。
 * 渲染顺序：房间底 → 墙体/家具 → 热源 → 通风口(出风/回风)。
 */
interface Props {
  room: RoomLayout;
  size?: number;        // 缩略图边长(px)，正方形
  className?: string;
}

export default function LayoutThumbnail({ room, size = 88, className }: Props) {
  const L = Math.max(room.length, 0.1);
  const W = Math.max(room.width, 0.1);
  // 等比放入正方形视口，留 padding
  const pad = 4;
  const inner = size - pad * 2;
  const scale = inner / Math.max(L, W);
  const ox = pad + (inner - L * scale) / 2;
  const oy = pad + (inner - W * scale) / 2;

  // 房间坐标 → SVG 像素
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      {/* 房间底 + 外框 */}
      <rect x={X(0)} y={Y(0)} width={L * scale} height={W * scale}
        fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1.5} rx={2} className="dark:fill-slate-900 dark:stroke-slate-600" />

      {/* 墙体/家具：按类别着色，墙偏冷灰、家具偏暖 */}
      {room.boxes.map((b) => {
        const wall = isWallLike(b);
        const fill = wall ? '#94a3b8' : '#d6b88a';
        return (
          <rect key={b.id}
            x={X(b.x)} y={Y(b.y)} width={b.L * scale} height={b.W * scale}
            fill={fill} fillOpacity={wall ? 0.9 : 0.85} rx={1}
            className="dark:opacity-80" />
        );
      })}

      {/* 热源：红/蓝（温度高低由调用方按需着色，这里统一暖色） */}
      {room.heatSources.map((h) => (
        <rect key={h.id}
          x={X(h.x)} y={Y(h.y)} width={Math.max(h.L * scale, 2)} height={Math.max(h.W * scale, 2)}
          fill="#ef4444" fillOpacity={0.8} rx={1} />
      ))}

      {/* 通风口：出风蓝、回风橙 */}
      {room.vents.map((v) => {
        const isOutlet = v.ventType === 'velocity_inlet';
        return (
          <rect key={v.id}
            x={X(v.x)} y={Y(v.y)} width={Math.max(v.L * scale, 2.5)} height={Math.max(v.W * scale, 2.5)}
            fill={isOutlet ? '#3b82f6' : '#f59e0b'} fillOpacity={0.9} rx={1} />
        );
      })}

      {/* 设备本体（box 表示）也画一下，便于看到空调等设备位置 */}
      {room.devices.map((d) => (
        <rect key={d.id}
          x={X(d.position.x)} y={Y(d.position.y)}
          width={d.geometry.length * scale} height={d.geometry.width * scale}
          fill="#64748b" fillOpacity={0.7} rx={1} />
      ))}
    </svg>
  );
}
