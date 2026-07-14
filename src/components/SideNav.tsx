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

import { useIconStyle } from '@/lib/icon-style-context';
import { useI18n } from '@/lib/i18n-context';

export type TabId = 'modeling' | 'simulation' | 'analysis';

interface SideNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const navItems = [
  { id: 'modeling' as TabId, iconSkeuomorphic: '🏠', iconFlat: '⬡', titleKey: 'sidenav.modeling', descKey: 'sidenav.modelingDesc' },
  { id: 'simulation' as TabId, iconSkeuomorphic: '🧮', iconFlat: '▸', titleKey: 'sidenav.simulation', descKey: 'sidenav.simulationDesc' },
  { id: 'analysis' as TabId, iconSkeuomorphic: '📊', iconFlat: '◈', titleKey: 'sidenav.analysis', descKey: 'sidenav.analysisDesc' },
];

export default function SideNav({ activeTab, onTabChange }: SideNavProps) {
  const { iconStyle } = useIconStyle();
  const { t } = useI18n();

  return (
    <aside className="w-16 bg-white dark:bg-slate-950 border-r border-gray-200 dark:border-slate-800 flex flex-col items-center pt-4 gap-2 shadow-sm">
      {navItems.map((item) => {
        const icon = iconStyle === 'skeuomorphic' ? item.iconSkeuomorphic : item.iconFlat;
        const isFlat = iconStyle === 'flat';
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`
              group relative w-14 h-12 rounded-lg flex items-center justify-center transition-all
              ${isFlat ? 'text-base font-bold' : 'text-2xl'}
              ${isActive
                ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300'
                : 'hover:bg-gray-100 dark:hover:bg-slate-800/60 text-gray-500 dark:text-gray-400'
              }
            `}
            title={t(item.titleKey)}
          >
            {/* 选中态：左侧 3px 竖条指示，与第二栏规则一致 */}
            {isActive && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-blue-500" />
            )}
            <span>{icon}</span>

            {/* Tooltip on hover */}
            <div className="absolute left-full ml-3 px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
              <div className="text-gray-800 dark:text-white text-sm font-medium">{t(item.titleKey)}</div>
              <div className="text-gray-500 dark:text-gray-400 text-xs mt-1">{t(item.descKey)}</div>
            </div>
          </button>
        );
      })}
    </aside>
  );
}

export function getViewerMode(tab: TabId): 'layout' | 'simulation' | 'results' {
  if (tab === 'modeling') return 'layout';
  if (tab === 'simulation') return 'simulation';
  return 'results';
}
