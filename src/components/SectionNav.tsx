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

import { type TabId } from '@/components/SideNav';
import { useIconStyle } from '@/lib/icon-style-context';
import { useI18n } from '@/lib/i18n-context';

export interface SectionDef {
  id: string;
  iconSkeuomorphic: string;
  iconFlat: string;
  titleKey: string;
  iconBg: string;
  badge?: string;
}

// Sections for each tab
export const MODELING_SECTIONS: SectionDef[] = [
  { id: 'ai-design', iconSkeuomorphic: '🤖', iconFlat: 'AI', titleKey: 'section.ai-design', iconBg: 'from-green-400 to-emerald-500' },
  { id: 'room-size', iconSkeuomorphic: '📏', iconFlat: '□', titleKey: 'section.room-size', iconBg: 'from-purple-400 to-pink-500' },
  { id: 'walls', iconSkeuomorphic: '🧱', iconFlat: '▦', titleKey: 'section.walls', iconBg: 'from-slate-400 to-gray-500' },
  { id: 'devices', iconSkeuomorphic: '📺', iconFlat: '⚡', titleKey: 'section.devices', iconBg: 'from-indigo-400 to-purple-500' },
  { id: 'furniture', iconSkeuomorphic: '🛋️', iconFlat: '⌂', titleKey: 'section.furniture', iconBg: 'from-amber-400 to-orange-500' },
  { id: 'vents', iconSkeuomorphic: '💨', iconFlat: '◎', titleKey: 'section.vents', iconBg: 'from-blue-400 to-cyan-500' },
  { id: 'heat-sources', iconSkeuomorphic: '🔥', iconFlat: '◉', titleKey: 'section.heat-sources', iconBg: 'from-red-400 to-pink-500' },
];

export const SIMULATION_SECTIONS: SectionDef[] = [
  { id: 'sim-conditions', iconSkeuomorphic: '🎛️', iconFlat: '◐', titleKey: 'section.sim-conditions', iconBg: 'from-blue-400 to-cyan-500' },
  { id: 'sim-control', iconSkeuomorphic: '▶️', iconFlat: '▸', titleKey: 'section.sim-control', iconBg: 'from-green-400 to-teal-500' },
];

export const ANALYSIS_SECTIONS: SectionDef[] = [
  { id: 'statistics', iconSkeuomorphic: '📈', iconFlat: '≡', titleKey: 'section.statistics', iconBg: 'from-green-400 to-teal-500' },
  { id: 'comfort', iconSkeuomorphic: '🌡️', iconFlat: '◐', titleKey: 'section.comfort', iconBg: 'from-rose-400 to-pink-500' },
  { id: 'uniformity', iconSkeuomorphic: '⚖️', iconFlat: '◇', titleKey: 'section.uniformity', iconBg: 'from-amber-400 to-orange-500' },
];

interface SectionNavProps {
  activeTab: TabId;
  activeSection: string;
  onSectionChange: (sectionId: string) => void;
  /** Dynamic badges — keyed by section id */
  badges?: Record<string, string>;
}

export function getSectionsForTab(tab: TabId): SectionDef[] {
  if (tab === 'modeling') return MODELING_SECTIONS;
  if (tab === 'simulation') return SIMULATION_SECTIONS;
  return ANALYSIS_SECTIONS;
}

export default function SectionNav({ activeTab, activeSection, onSectionChange, badges }: SectionNavProps) {
  const { iconStyle } = useIconStyle();
  const { t } = useI18n();
  const sections = getSectionsForTab(activeTab);
  const isFlat = iconStyle === 'flat';

  // Reset to first section if activeSection doesn't exist in current tab
  const currentSection = sections.find(s => s.id === activeSection) ? activeSection : sections[0]?.id;

  return (
    <aside className="w-52 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col overflow-y-auto shadow-sm">
      <div className="px-2.5 pt-4 pb-3 space-y-1">
        {sections.map(section => {
          const isActive = currentSection === section.id;
          const badgeText = badges?.[section.id];
          const icon = isFlat ? section.iconFlat : section.iconSkeuomorphic;
          return (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={`relative w-full flex items-center gap-2.5 pl-3.5 pr-2.5 py-2 rounded-lg transition-all text-left ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200'
                  : 'hover:bg-gray-100 dark:hover:bg-slate-700/50 text-gray-700 dark:text-gray-300'
              }`}
            >
              {/* 选中态：左侧 3px 竖条，与第一栏规则一致 */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-blue-500" />
              )}
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isFlat ? 'text-[11px] font-bold' : 'text-sm'} ${
                isActive ? 'bg-blue-500/15' : `bg-gradient-to-br ${section.iconBg}`
              }`}>
                <span className={isActive ? '' : 'grayscale-[0.15]'}>{icon}</span>
              </div>
              <span className={`text-xs font-medium flex-1 truncate ${isActive ? 'font-semibold' : ''}`}>
                {t(section.titleKey)}
              </span>
              {badgeText && (
                <span className={`text-xs ${isActive ? 'text-blue-400 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'}`}>
                  {badgeText}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
