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

import { useI18n } from '@/lib/i18n-context';

interface StatusBarProps {
  step: number;
  physicalTime: number;
  webgpuSupported: boolean | null;
  engineType: 'gpu' | 'cpu' | null;
}

export default function StatusBar({ step, physicalTime, webgpuSupported, engineType }: StatusBarProps) {
  const { t } = useI18n();
  return (
    <footer className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-t border-gray-200/50 dark:border-slate-700/50 px-6 py-3 shadow-lg">
      <div className="flex items-center justify-between text-xs">
        {/* Left: Engine Status */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${webgpuSupported ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <span className="text-gray-600 dark:text-gray-300">
              {webgpuSupported === null ? t('status.detecting') : webgpuSupported ? t('status.webgpuReady') : t('status.webgpuNotSupp')}
            </span>
          </div>
          {engineType && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${engineType === 'gpu' ? 'bg-blue-500' : 'bg-orange-500'}`}></div>
              <span className="text-gray-600 dark:text-gray-300">
                {t('status.engine')}<span className="font-bold">{engineType === 'gpu' ? t('status.gpu') : t('status.cpu')}</span>
              </span>
            </div>
          )}
        </div>

        {/* Center: Simulation Info */}
        <div className="flex items-center gap-4">
          <div className="text-gray-500 dark:text-gray-400">
            {t('status.steps')}<span className="font-bold text-gray-700 dark:text-gray-200">{step}</span>
          </div>
          <div className="text-gray-500 dark:text-gray-400">
            {t('status.physTime')}<span className="font-bold text-gray-700 dark:text-gray-200">{physicalTime.toFixed(3)} s</span>
          </div>
        </div>

        {/* Right: Version */}
        <div className="text-gray-400 dark:text-gray-500">
          {t('status.copyright')}
        </div>
      </div>
    </footer>
  );
}
