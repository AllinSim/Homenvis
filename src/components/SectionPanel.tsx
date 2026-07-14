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

import { type ReactNode } from 'react';
import { useIconStyle } from '@/lib/icon-style-context';

interface SectionPanelProps {
  /** Section unique ID */
  sectionId: string;
  /** The currently active section in the parent panel — content is rendered only when this matches sectionId */
  activeSection: string;
  title: string;
  icon?: string;
  iconSkeuomorphic?: string;
  iconFlat?: string;
  iconBg?: string; // gradient class, e.g. 'from-blue-400 to-cyan-500'
  badge?: string;
  children: ReactNode;
}

/**
 * SectionPanel — used in the detail panel (column 3).
 * Renders a titled content section, but ONLY when its sectionId matches activeSection.
 * The section title comes from column 2's SectionNav, so this is effectively a header + content
 * container that is hidden unless selected.
 *
 * The panel fills the entire height of its parent (column 3) using flex column layout.
 * The content area (children) flex-grows to fill remaining vertical space.
 */
export default function SectionPanel({
  sectionId,
  activeSection,
  title,
  icon,
  iconSkeuomorphic,
  iconFlat,
  iconBg = 'from-gray-400 to-slate-500',
  badge,
  children,
}: SectionPanelProps) {
  const { iconStyle } = useIconStyle();
  const isFlat = iconStyle === 'flat';

  // Determine icon to show: prefer iconSkeuomorphic/iconFlat pair, fallback to legacy icon prop
  const displayIcon = iconSkeuomorphic && iconFlat
    ? (isFlat ? iconFlat : iconSkeuomorphic)
    : icon;

  if (sectionId !== activeSection) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header — title + optional badge, NOT clickable (navigation lives in column 2) */}
      <div className="flex items-center gap-2 pb-3 mb-3 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
        {displayIcon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br ${iconBg} shadow-sm ${isFlat ? 'text-[11px] font-bold' : 'text-sm'}`}>
            <span className="text-white">{displayIcon}</span>
          </div>
        )}
        <span className="font-bold text-gray-800 dark:text-gray-100 flex-1 text-base">{title}</span>
        {badge && (
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>

      {/* Content — flex-grows to fill remaining height, scrolls when content overflows */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 text-sm animate-in overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
