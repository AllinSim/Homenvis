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

import { type SimResultsSummary } from '@/hooks/useSimResultsSummary';
import { useI18n } from '@/lib/i18n-context';
import SectionPanel from '@/components/SectionPanel';

interface ResultsPanelProps {
  summary: SimResultsSummary | null;
  activeSection: string;
}

/** 把比例 0~1 渲染为带颜色等级的进度条 + 百分比 */
function RatioBar({ ratio, label }: { ratio: number; label: string }) {
  const pct = Math.round(ratio * 100);
  const color =
    ratio >= 0.8 ? 'bg-green-500'
    : ratio >= 0.5 ? 'bg-amber-500'
    : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-bold text-gray-800 dark:text-gray-200">{pct}%</span>
      </div>
      <div className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ResultsPanel({ summary, activeSection }: ResultsPanelProps) {
  const { t } = useI18n();
  return (
    <div className="p-5 h-full flex flex-col text-sm space-y-1">
      {/* ===== 舒适度评估 ===== */}
      <SectionPanel sectionId="comfort" activeSection={activeSection} title={t('section.comfort')} iconSkeuomorphic="🌡️" iconFlat="◐" iconBg="from-rose-400 to-pink-500">
        {summary ? (
          <>
            <div className="bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20 rounded-lg p-3 border border-rose-200 dark:border-rose-800 mb-3">
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">{t('analysis.comfortOverall')}</div>
              <div className="flex items-end gap-2">
                <span className={`text-3xl font-bold ${
                  summary.comfort.overallRatio >= 0.8 ? 'text-green-600 dark:text-green-400'
                  : summary.comfort.overallRatio >= 0.5 ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
                }`}>
                  {Math.round(summary.comfort.overallRatio * 100)}%
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('analysis.comfortInRange')}</span>
              </div>
            </div>

            <div className="space-y-2.5 mb-3">
              <RatioBar ratio={summary.comfort.thermalRatio} label={t('analysis.thermalRatio')} />
              <RatioBar ratio={summary.comfort.lowDraftRatio} label={t('analysis.lowDraftRatio')} />
            </div>

            <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('analysis.meanSpeed')}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{summary.comfort.meanSpeed.toFixed(3)} m/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('analysis.meanTemp')}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{summary.temperature.mean.toFixed(2)} °C</span>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 mt-3 space-y-1">
              <p className="font-medium">{t('analysis.comfortNoteTitle')}</p>
              <p>{t('analysis.comfortNote1')}</p>
              <p>{t('analysis.comfortNote2')}</p>
              <p>{t('analysis.comfortNote3')}</p>
            </div>
          </>
        ) : (
          <div className="bg-gradient-to-r from-gray-50 to-slate-50 dark:from-slate-700/50 dark:to-slate-700/50 rounded-lg p-4 border border-gray-200 dark:border-slate-600">
            <div className="text-center text-gray-500 dark:text-gray-400 text-xs space-y-1">
              <p className="text-2xl">🧪</p>
              <p>{t('analysis.notRun')}</p>
              <p className="text-xs">{t('analysis.goSim')}</p>
            </div>
          </div>
        )}
      </SectionPanel>

      {/* ===== 统计信息 ===== */}
      <SectionPanel sectionId="statistics" activeSection={activeSection} title={t('section.statistics')} iconSkeuomorphic="📈" iconFlat="≡" iconBg="from-green-400 to-teal-500">
        {summary ? (
          <>
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('analysis.simSteps')}</span>
                  <span className="font-bold text-gray-800 dark:text-gray-200">{summary.step}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('analysis.dataPoints')}</span>
                  <span className="font-bold text-gray-800 dark:text-gray-200">{summary.dataPoints.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 space-y-1 text-xs mt-2">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('analysis.velRange')}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200 text-[10px]">
                  {summary.velocity.magMin.toFixed(3)} ~ {summary.velocity.magMax.toFixed(3)} m/s
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('analysis.meanVel')}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200 text-[10px]">
                  {summary.velocity.magMean.toFixed(3)} m/s
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('analysis.tempRange')}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200 text-[10px]">
                  {summary.temperature.min.toFixed(2)} ~ {summary.temperature.max.toFixed(2)} °C
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{t('analysis.densityRange')}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200 text-[10px]">
                  {summary.pressure.min.toFixed(3)} ~ {summary.pressure.max.toFixed(3)} kg/m³
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">
            {t('analysis.noStats')}
          </div>
        )}
      </SectionPanel>

      {/* ===== 温度均匀性 ===== */}
      <SectionPanel sectionId="uniformity" activeSection={activeSection} title={t('section.uniformity')} iconSkeuomorphic="⚖️" iconFlat="◇" iconBg="from-amber-400 to-orange-500">
        {summary ? (
          (() => {
            const std = summary.temperature.std;
            const deltaT = summary.temperature.deltaT;
            // 均匀性等级：标准差越小越均匀
            const grade =
              std < 1.0 ? { txt: t('analysis.grade.excellent'), color: 'text-green-600 dark:text-green-400' }
              : std < 2.5 ? { txt: t('analysis.grade.good'), color: 'text-amber-600 dark:text-amber-400' }
              : { txt: t('analysis.grade.poor'), color: 'text-red-600 dark:text-red-400' };
            return (
              <>
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">{t('analysis.uniformityGrade')}</div>
                  <div className="flex items-end gap-2">
                    <span className={`text-3xl font-bold ${grade.color}`}>{grade.txt}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">σ = {std.toFixed(2)} °C</span>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 space-y-1 text-xs mt-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('analysis.tempStd')}</span>
                    <span className="font-mono text-gray-800 dark:text-gray-200">{std.toFixed(2)} °C</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('analysis.maxDeltaT')}</span>
                    <span className="font-mono text-gray-800 dark:text-gray-200">{deltaT.toFixed(2)} °C</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('analysis.meanTemp')}</span>
                    <span className="font-mono text-gray-800 dark:text-gray-200">{summary.temperature.mean.toFixed(2)} °C</span>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300 mt-3 space-y-1">
                  <p className="font-medium">{t('analysis.uniformNoteTitle')}</p>
                  <p>{t('analysis.uniformNote1')}</p>
                  <p>{t('analysis.uniformNote2')}</p>
                  <p>{t('analysis.uniformNote3')}</p>
                </div>
              </>
            );
          })()
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">
            {t('analysis.noData')}
          </div>
        )}
      </SectionPanel>
    </div>
  );
}
