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

import { useState, useEffect, useRef, type CSSProperties } from 'react';

interface NumberInputProps {
  /** 当前数值（受控） */
  value: number;
  /** 数值变化回调：仅当输入可解析为有限数字时调用 */
  onValueChange: (v: number) => void;
  /** 步进（保留以兼容滚轮/键盘微调） */
  step?: string | number;
  /** 允许为空时回退到的值（默认 0） */
  fallback?: number;
  className?: string;
  style?: CSSProperties;
  /** 对齐方式等透传属性可按需扩展 */
}

/**
 * 支持负号 / 小数中间态的受控数字输入框。
 *
 * 为什么需要它：原生 <input type="number"> 受控时，onChange 里用 `+e.target.value`
 * 会把中间态（"-", "-.", ""）强制转成 NaN/0，React 回填旧数值，导致**无法输入负号**。
 * 本组件用本地字符串状态保存用户正在输入的文本，仅在解析为有限数字时才回调父组件，
 * 同时把父组件传入的 value 同步到本地显示，从而允许自由输入负数与小数。
 */
export default function NumberInput({ value, onValueChange, step, fallback = 0, className, style }: NumberInputProps) {
  const [text, setText] = useState<string>(String(value));
  const isFocusedRef = useRef(false);

  // 父组件外部更新（非本输入框聚焦时）同步到本地显示
  useEffect(() => {
    if (!isFocusedRef.current) {
      setText(String(value));
    }
  }, [value]);

  return (
    <input
      type="number"
      step={step}
      inputMode="decimal"
      value={text}
      onFocus={() => { isFocusedRef.current = true; }}
      onChange={e => {
        const raw = e.target.value;
        setText(raw); // 始终保留用户输入（含 "-","-.",""）
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          // 中间态：不提交非法值，但允许继续输入
          onValueChange(fallback);
          return;
        }
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) {
          onValueChange(parsed);
        }
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        // 失焦时规范显示：若当前文本不合法，回退到 value
        const parsed = parseFloat(text);
        if (!Number.isFinite(parsed)) {
          setText(String(value));
        } else {
          setText(String(parsed));
        }
      }}
      className={className}
      style={style}
    />
  );
}
