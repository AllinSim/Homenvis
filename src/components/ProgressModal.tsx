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

import { useEffect } from 'react';
import { useIconStyle } from '@/lib/icon-style-context';
import { useI18n } from '@/lib/i18n-context';

interface ProgressModalProps {
  open: boolean;
  /** 已完成步数 */
  done: number;
  /** 总步数 */
  total: number;
  /** 已用毫秒 */
  elapsedMs: number;
  /** 预估总毫秒（来自 gpu-benchmark，可选） */
  estimatedMs?: number;
  /** 引擎类型显示文本，如 "WebGPU" / "CPU" */
  engineLabel?: string;
  /** 是否允许中止 */
  canStop?: boolean;
  onStop?: () => void;
  /** 关闭（仅在非运行时可用） */
  onClose?: () => void;
}

function formatTime(ms: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (!isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return t('sim.timeMs', { n: ms.toFixed(0) });
  const sec = ms / 1000;
  if (sec < 60) return t('sim.timeSec', { n: sec.toFixed(1) });
  return t('sim.timeMin', { n: (sec / 60).toFixed(1) });
}

export default function ProgressModal({
  open, done, total, elapsedMs, estimatedMs, engineLabel, canStop, onStop, onClose,
}: ProgressModalProps) {
  const { iconStyle } = useIconStyle();
  const { t } = useI18n();
  const isFlat = iconStyle === 'flat';

  // 防止后台计算期间 body 滚动 / 误触（弹窗本身不阻止主线程，仅视觉层）
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;

  // 速率（步/秒）与剩余时间估算
  const elapsedSec = elapsedMs / 1000;
  const rate = elapsedSec > 0 ? done / elapsedSec : 0; // steps/sec
  const remaining = done > 0 ? ((total - done) / done) * elapsedMs : (estimatedMs ?? Infinity);
  const finished = done >= total && total > 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      {/* 遮罩层（完成后可点击关闭） */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={finished && onClose ? onClose : undefined}
      />

      <div className="relative z-10 w-full max-w-md mx-4 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3">
          <span className="text-2xl">{finished ? (isFlat ? '✓' : '✅') : (isFlat ? '◉' : '🌀')}</span>
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
              {finished ? t('progress.done') : t('progress.computing')}
            </h2>
            {engineLabel && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('progress.engineSub', { label: engineLabel })}</p>
            )}
          </div>
        </div>

        {/* 内容 */}
        <div className="px-6 py-5 space-y-4">
          {/* 进度数字 */}
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold text-gray-800 dark:text-gray-100 tabular-nums">
                {done.toLocaleString()}<span className="text-base font-normal text-gray-400 dark:text-gray-500"> / {total.toLocaleString()}</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('progress.simSteps')}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{pct.toFixed(1)}%</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('progress.progress')}</div>
            </div>
          </div>

          {/* 进度条 */}
          <div className="h-3 w-full bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* 时间信息 */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('progress.elapsed')}</div>
              <div className="text-sm font-bold text-gray-800 dark:text-gray-200">{formatTime(elapsedMs, t)}</div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('progress.rate')}</div>
              <div className="text-sm font-bold text-gray-800 dark:text-gray-200">{rate > 0 ? t('progress.rateVal', { n: rate.toFixed(0) }) : '—'}</div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('progress.remaining')}</div>
              <div className="text-sm font-bold text-gray-800 dark:text-gray-200">{finished ? t('progress.zeroSec') : formatTime(remaining, t)}</div>
            </div>
          </div>

          {/* 提示 */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300">
            {finished ? t('progress.finishedHint') : t('progress.runningHint')}
          </div>
        </div>

        {/* 底部 */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-slate-700 flex justify-end gap-2">
          {finished ? (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:shadow-lg transition-all"
            >
              {t('progress.complete')}
            </button>
          ) : (
            canStop && (
              <button
                onClick={onStop}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-red-500 to-pink-600 text-white hover:shadow-lg transition-all"
              >
                {t('progress.abort')}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
