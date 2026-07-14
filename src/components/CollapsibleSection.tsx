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

import { useState, useEffect, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  /** Section unique ID — used for external control via `open` prop */
  sectionId?: string;
  title: string;
  icon?: string;
  iconBg?: string; // gradient class, e.g. 'from-blue-400 to-cyan-500'
  defaultOpen?: boolean;
  /** Controlled open state — if provided, overrides internal state */
  open?: boolean;
  badge?: string; // optional right-side badge, e.g. '3 个'
  children: ReactNode;
}

export default function CollapsibleSection({
  sectionId,
  title,
  icon,
  iconBg = 'from-gray-400 to-slate-500',
  defaultOpen = false,
  open: controlledOpen,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);

  // Use controlled open if provided, otherwise internal state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  // When controlledOpen transitions from false to true, sync internal state too
  useEffect(() => {
    if (controlledOpen !== undefined) {
      setInternalOpen(controlledOpen);
    }
  }, [controlledOpen]);

  const toggle = () => {
    if (controlledOpen === undefined) {
      setInternalOpen(!internalOpen);
    }
    // If controlled, the parent handles toggling via SectionNav clicks
  };

  return (
    <div className="border-b border-gray-100 dark:border-slate-700">
      {/* Header — always visible */}
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 py-3 px-1 text-sm hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        {icon && (
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br ${iconBg}`}>
            <span className="text-white text-xs">{icon}</span>
          </div>
        )}
        <span className="font-bold text-gray-800 dark:text-gray-100 flex-1">{title}</span>
        {badge && (
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">{badge}</span>
        )}
        <span className={`text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {/* Content — collapsible */}
      {isOpen && (
        <div className="pb-4 space-y-3 text-sm animate-in">
          {children}
        </div>
      )}
    </div>
  );
}
