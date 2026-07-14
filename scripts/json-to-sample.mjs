#!/usr/bin/env node

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
 * json-to-sample.mjs —— 把保存的 .json 布局文件转换成 sample-rooms.ts 中的样本代码。
 *
 * 用法：
 *   node scripts/json-to-sample.mjs <布局文件.json> [选项]
 *
 * 选项：
 *   --id <id>           样本 id（kebab-case，如 'kitchen'），默认由文件名推断
 *   --name <名称>       卡片名称，默认 '样本 · <文件名>'
 *   --category <大类>   residential | office | commercial，默认 residential
 *   --emoji <图标>      卡片 emoji，默认 🏠
 *   --description <说明> 一句话工况说明
 *   --tags <标签>       逗号分隔，如 '机械通风,扫风'
 *   --out <文件>        输出文件路径，默认打印到 stdout
 *   --append            追加到现有 sample-rooms.ts（自动注册到 SAMPLE_ROOMS）
 *   --target <文件>     --append 时的目标文件，默认 src/lib/sample-rooms.ts
 *
 * 示例：
 *   node scripts/json-to-sample.mjs lbm-layout-2026-06-20.json \
 *       --id kitchen --name '厨房 · 排油烟' --category residential \
 *       --emoji 🍳 --tags '机械通风,排烟,热源' \
 *       --description '油烟机排风，灶台热源' --append
 *
 * 生成的代码风格与 sample-rooms.ts 完全一致：
 *   - 每个对象字段保留在原顺序
 *   - id 改用 genId()（保证多次载入不冲突）
 *   - 数值/字符串/数组原样保留，省略 undefined 字段
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const opts = {
    id: null, name: null, category: 'residential', emoji: '🏠',
    description: '', tags: [], out: null, append: false,
    target: path.join(PROJECT_ROOT, 'src/lib/sample-rooms.ts'),
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--id': opts.id = argv[++i]; break;
      case '--name': opts.name = argv[++i]; break;
      case '--category': opts.category = argv[++i]; break;
      case '--emoji': opts.emoji = argv[++i]; break;
      case '--description': opts.description = argv[++i]; break;
      case '--tags': opts.tags = argv[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--out': opts.out = argv[++i]; break;
      case '--append': opts.append = true; break;
      case '--target': opts.target = argv[++i]; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (a.startsWith('--')) { console.error(`未知选项: ${a}`); process.exit(1); }
        positional.push(a);
    }
  }
  return { opts, positional };
}

function showHelp() {
  console.log(`用法: node scripts/json-to-sample.mjs <布局文件.json> [选项]

选项:
  --id <id>            样本 id (kebab-case)，默认由文件名推断
  --name <名称>        卡片名称
  --category <大类>    residential|office|commercial，默认 residential
  --emoji <图标>       卡片 emoji，默认 🏠
  --description <说明> 一句话工况说明
  --tags <标签>        逗号分隔
  --out <文件>         输出到文件（默认 stdout）
  --append             追加注册到 sample-rooms.ts
  --target <文件>      --append 的目标文件`);
}

// ---------- 值序列化（保持 sample-rooms.ts 的字面量风格） ----------
function num(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  // 整数直接写，浮点保留原值（避免 1.0 之类）
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function str(s) {
  // 用单引号，与源文件一致；转义单引号与反斜杠
  const escaped = String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function arr(items, indent) {
  if (items.length === 0) return '[]';
  const pad = ' '.repeat(indent);
  const inner = items.map(v => pad + serialize(v, indent + 2)).join(',\n');
  return `[\n${inner},\n${' '.repeat(indent - 2)}]`;
}

// 标记：原样输出（不加引号），用于 genId() 这类表达式
const RAW = Symbol('raw');
function raw(expr) { return { [RAW]: expr }; }
function isRaw(v) { return v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, RAW); }

function serialize(v, indent) {
  if (v === null) return 'null';
  if (isRaw(v)) return v[RAW];
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return arr(v, indent + 2);
  if (typeof v === 'object') return obj(v, indent);
  return String(v);
}

// 对象字段顺序：按给定顺序输出，跳过 undefined/null（除非显式需要）
function obj(o, indent) {
  const pad = ' '.repeat(indent + 2);
  const closePad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    // 空数组也保留（如 doorHoles: []），与源文件一致
    lines.push(`${pad}${k}: ${serialize(v, indent + 2)}`);
  }
  return `{\n${lines.join(',\n')},\n${closePad}}`;
}

// ---------- 各类对象的字段重排 + id 替换 ----------

function reBox(b) {
  // 顺序对齐 sample-rooms.ts：id,name,x,y,z,L,W,H,color,shape,doorHoles,rotZ,category,...
  const out = {
    id: raw('genId()'), name: b.name,
    x: b.x, y: b.y, z: b.z, L: b.L, W: b.W, H: b.H,
    color: b.color, shape: b.shape ?? 'box',
    doorHoles: (b.doorHoles ?? []).map(reDoorHole),
  };
  if (b.rotZ !== undefined && b.rotZ !== 0) out.rotZ = b.rotZ;
  if (b.category !== undefined) out.category = b.category;
  if (b.isWindow) { out.isWindow = true; if (b.asHeatSource) out.asHeatSource = true; if (b.windowTemp !== undefined) out.windowTemp = b.windowTemp; }
  if (b.parts && b.parts.length) out.parts = b.parts.map(rePart);
  return out;
}
function rePart(p) {
  const out = {};
  if (p.name) out.name = p.name;
  out.x = p.x; out.y = p.y; out.z = p.z; out.L = p.L; out.W = p.W; out.H = p.H;
  if (p.shape) out.shape = p.shape;
  if (p.color) out.color = p.color;
  return out;
}
function reDoorHole(d) {
  const out = {
    id: raw('genId()'), name: d.name, wallFace: d.wallFace,
    offsetFromLeft: d.offsetFromLeft, width: d.width, height: d.height,
    sillHeight: d.sillHeight, open: d.open,
  };
  return out;
}
function reVent(v) {
  const out = {
    id: raw('genId()'), name: v.name, ventType: v.ventType,
  };
  if (v.outletMode !== undefined) out.outletMode = v.outletMode;
  out.x = v.x; out.y = v.y; out.z = v.z; out.L = v.L; out.W = v.W; out.H = v.H;
  out.velocity = v.velocity;
  out.temperature = v.temperature;
  out.color = v.color;
  if (v.rotZ !== undefined && v.rotZ !== 0) out.rotZ = v.rotZ;
  if (v.shape !== undefined && v.shape !== 'box') out.shape = v.shape;
  if (v.parentDeviceId !== undefined) out.parentDeviceId = v.parentDeviceId;
  if (v.swing) out.swing = reSwing(v.swing);
  if (v.outflowFace !== undefined) out.outflowFace = v.outflowFace;
  return out;
}
function reSwing(s) {
  const out = { enabled: s.enabled, mode: s.mode, amplitude: s.amplitude, period: s.period };
  if (s.phase !== undefined && s.phase !== 0) out.phase = s.phase;
  return out;
}
function reHeat(h) {
  const out = {
    id: raw('genId()'), name: h.name,
    x: h.x, y: h.y, z: h.z, L: h.L, W: h.W, H: h.H,
    temperature: h.temperature, color: h.color,
  };
  if (h.rotZ !== undefined && h.rotZ !== 0) out.rotZ = h.rotZ;
  if (h.shape !== undefined && h.shape !== 'box') out.shape = h.shape;
  if (h.parentDeviceId !== undefined) out.parentDeviceId = h.parentDeviceId;
  return out;
}
function reDevice(d) {
  // 设备较复杂，原样保留但替换内部 id 为 genId()
  const out = {
    id: raw('genId()'), deviceId: d.deviceId, name: d.name, brand: d.brand, category: d.category,
    position: { ...d.position },
    geometry: { ...d.geometry },
  };
  if (d.bodyParts) out.bodyParts = d.bodyParts.map(rePart);
  out.modeIndex = d.modeIndex;
  out.outlets = (d.outlets ?? []).map(o => ({
    id: raw('genId()'), name: o.name,
    relativePosition: o.relativePosition, size: o.size,
    velocity: o.velocity, temperature: o.temperature,
    ...(o.swing ? { swing: reSwing(o.swing) } : {}),
  }));
  out.inlets = (d.inlets ?? []).map(i => ({
    id: raw('genId()'), name: i.name,
    relativePosition: i.relativePosition, size: i.size,
    mode: i.mode, velocity: i.velocity, temperature: i.temperature,
  }));
  if (d.heatSourceId !== undefined) out.heatSourceId = d.heatSourceId;
  if (d.heatTemp !== undefined) out.heatTemp = d.heatTemp;
  if (d.rotZ !== undefined && d.rotZ !== 0) out.rotZ = d.rotZ;
  out.color = d.color;
  return out;
}

// ---------- 主流程 ----------
function loadRoom(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  // 兼容两种：{room: {...}} 导出格式 或 直接 RoomLayout
  const room = data.room ?? data;
  if (!room || !Array.isArray(room.boxes)) {
    throw new Error('未找到有效的 room 布局数据（期望含 boxes 数组）');
  }
  return room;
}

function buildRoomLiteral(room) {
  const body = {
    length: room.length, width: room.width, height: room.height,
    boxes: (room.boxes ?? []).map(reBox),
    vents: (room.vents ?? []).map(reVent),
    heatSources: (room.heatSources ?? []).map(reHeat),
    devices: (room.devices ?? []).map(reDevice),
  };
  return obj(body, 4);
}

function slugFromFile(filePath) {
  const base = path.basename(filePath, '.json')
    .replace(/^lbm-layout-/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || 'custom-room';
}

function emitSampleCode({ id, name, factoryName, category, description, tags, emoji, roomLiteral }) {
  const header = `/* ============================================================
 * 样本：${name}
 * ${description || '（由 json-to-sample.mjs 生成）'}
 * 房间 ${roomLiteralLength(roomLiteral)}：${category}
 * ============================================================ */
function ${factoryName}(): RoomLayout {
  return ${roomLiteral};
}
`;
  return header;
}

// 仅用于注释里的尺寸提示
function roomLiteralLength(_l) { return ''; }

function emitRegistration({ id, name, factoryName, category, description, tags, emoji }) {
  const tagsStr = tags.length ? tags.map(str).join(', ') : '';
  return `  {
    id: ${str(id)},
    name: ${str(name)},
    category: ${str(category)},
    description: ${str(description)},
    tags: [${tagsStr}],
    emoji: ${str(emoji)},
    build: ${factoryName},
  },`;
}

function factoryNameFromId(id) {
  // kitchen -> kitchenRoom；保证合法标识符
  const safe = id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = safe.split('-').filter(Boolean);
  const camel = parts.map((p, i) => i === 0 ? p : p[0].toUpperCase() + p.slice(1)).join('');
  return `${camel}Room`;
}

function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  if (opts.help || positional.length === 0) { showHelp(); process.exit(opts.help ? 0 : 1); }

  const filePath = positional[0];
  if (!fs.existsSync(filePath)) { console.error(`文件不存在: ${filePath}`); process.exit(1); }

  const room = loadRoom(filePath);
  const id = opts.id || slugFromFile(filePath);
  const factoryName = factoryNameFromId(id);
  const name = opts.name || `样本 · ${id}`;
  const category = opts.category;
  const roomLiteral = buildRoomLiteral(room);

  const sampleCode = emitSampleCode({ id, name, factoryName, category, description: opts.description, tags: opts.tags, emoji: opts.emoji, roomLiteral });

  if (opts.append) {
    const target = path.resolve(opts.target);
    if (!fs.existsSync(target)) { console.error(`目标文件不存在: ${target}`); process.exit(1); }
    let src = fs.readFileSync(target, 'utf8');

    // 1) 在 SAMPLE_ROOMS 数组之前插入工厂函数（紧邻最后一个 function 定义之后、SAMPLE_ROOMS 之前）
    const arrMarker = 'export const SAMPLE_ROOMS';
    const arrIdx = src.indexOf(arrMarker);
    if (arrIdx === -1) { console.error('目标文件中未找到 SAMPLE_ROOMS，无法追加'); process.exit(1); }
    src = src.slice(0, arrIdx) + sampleCode + '\n' + src.slice(arrIdx);

    // 2) 在 SAMPLE_ROOMS 数组闭合 ] 之前注册
    const openIdx = src.indexOf('[', arrIdx);
    const closeIdx = src.lastIndexOf(']', src.length);
    if (openIdx === -1 || closeIdx === -1) { console.error('无法定位 SAMPLE_ROOMS 数组边界'); process.exit(1); }
    const reg = emitRegistration({ id, name, factoryName, category, description: opts.description, tags: opts.tags, emoji: opts.emoji });
    src = src.slice(0, closeIdx) + reg + '\n' + src.slice(closeIdx);

    fs.writeFileSync(target, src);
    console.log(`✓ 已追加样本 "${name}" 到 ${target}`);
    console.log(`  工厂函数: ${factoryName}()  样本 id: ${id}`);
  } else {
    const block = `// 生成自 ${path.basename(filePath)}
// 请将以下代码并入 src/lib/sample-rooms.ts，并记得在 SAMPLE_ROOMS 中注册 build: ${factoryName}
${sampleCode}
// 注册项（加入 SAMPLE_ROOMS 数组）：
${emitRegistration({ id, name, factoryName, category, description: opts.description, tags: opts.tags, emoji: opts.emoji })}
`;
    if (opts.out) {
      fs.writeFileSync(opts.out, block);
      console.log(`✓ 已写入 ${opts.out}`);
    } else {
      process.stdout.write(block);
    }
  }
}

main();
