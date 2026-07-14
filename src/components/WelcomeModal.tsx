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

import { useState, useEffect } from 'react';
import Modal from '@/components/Modal';
import { useIconStyle } from '@/lib/icon-style-context';
import { useI18n } from '@/lib/i18n-context';

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  /** WebGPU 是否可用（由 page.tsx 已探测，null=未探测完） */
  webgpuSupported: boolean | null;
}

interface BrowserInfo {
  nameKey: string;
  version: string;
  supported: boolean;     // 浏览器本身是否支持运行本系统
  recommendKey?: string;     // 不支持时的建议
}

/** 探测当前浏览器类型与版本，并判定是否推荐 */
function detectBrowser(): BrowserInfo {
  if (typeof navigator === 'undefined') {
    return { nameKey: 'welcome.unknown', version: '', supported: true };
  }
  const ua = navigator.userAgent;
  // Chrome / Edge / Opera 等基于 Chromium
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Edg\/([\d.]+)/))) {
    return { nameKey: 'welcome.edge', version: m[1], supported: true };
  }
  if ((m = ua.match(/OPR\/([\d.]+)/)) || (m = ua.match(/Opera\/([\d.]+)/))) {
    return { nameKey: 'welcome.opera', version: m[1], supported: true };
  }
  if ((m = ua.match(/Chrome\/([\d.]+)/))) {
    const ver = parseInt(m[1], 10);
    // WebGPU 在 Chrome 113+ 稳定可用
    return {
      nameKey: 'welcome.chrome',
      version: m[1],
      supported: ver >= 113,
      recommendKey: ver < 113 ? 'welcome.chromeRecommend' : undefined,
    };
  }
  if ((m = ua.match(/Firefox\/([\d.]+)/))) {
    return {
      nameKey: 'welcome.firefox',
      version: m[1],
      supported: false,
      recommendKey: 'welcome.firefoxRecommend',
    };
  }
  if ((m = ua.match(/Safari\/([\d.]+)/))) {
    return {
      nameKey: 'welcome.safari',
      version: m[1],
      supported: true,
      recommendKey: 'welcome.safariRecommend',
    };
  }
  return { nameKey: 'welcome.unknownBrowser', version: '', supported: true };
}

export default function WelcomeModal({ open, onClose, webgpuSupported }: WelcomeModalProps) {
  const { iconStyle } = useIconStyle();
  const { t, lang, setLang } = useI18n();
  const isFlat = iconStyle === 'flat';
  const [browser, setBrowser] = useState<BrowserInfo>({ nameKey: 'welcome.detecting', version: '', supported: true });

  useEffect(() => {
    setBrowser(detectBrowser());
  }, []);

  // 计算后端：优先 WebGPU，否则 CPU
  const computeBackend = webgpuSupported === null
    ? { labelKey: 'welcome.backendDetecting', tone: 'gray' as const }
    : webgpuSupported
      ? { labelKey: 'welcome.backendWebgpu', tone: 'green' as const }
      : { labelKey: 'welcome.backendCpu', tone: 'amber' as const };

  const toneClasses: Record<'green' | 'amber' | 'gray' | 'red', string> = {
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
    gray:  'bg-gray-50 dark:bg-slate-700/50 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300',
    red:   'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
  };

  const browserTone = browser.supported ? 'green' : 'amber';
  const languageIcon = isFlat ? '文' : '🌐';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isFlat ? t('welcome.titleFlat') : t('welcome.title')}
      headerExtra={(
        <button
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          className={`flex items-center justify-center gap-1 h-8 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all ${isFlat ? 'text-xs font-bold' : 'text-sm'}`}
          title={t('topbar.langTitle')}
        >
          <span className="text-base leading-none">{languageIcon}</span>
          <span className="font-semibold">{lang === 'zh' ? '中' : 'EN'}</span>
        </button>
      )}
    >
      <p className="text-gray-700 dark:text-gray-300 mb-4" dangerouslySetInnerHTML={{ __html: t('welcome.intro') }} />

      {/* 浏览器兼容性 */}
      <div className={`rounded-lg border p-3 mb-3 ${toneClasses[browserTone]}`}>
        <div className="flex items-center justify-between">
          <div className="font-medium flex items-center gap-2">
            <span>{isFlat ? '◎' : '🌐'}</span>
            {t('welcome.browser')}
          </div>
          <span className="text-xs font-bold">
            {browser.supported ? t('welcome.compat') : t('welcome.partialCompat')}
          </span>
        </div>
        <div className="text-xs mt-1 opacity-90">
          {t(browser.nameKey)}{browser.version ? ` ${browser.version}` : ''}
        </div>
        {browser.recommendKey && (
          <div className="text-xs mt-1 opacity-90">{t(browser.recommendKey)}</div>
        )}
      </div>

      {/* 计算后端 */}
      <div className={`rounded-lg border p-3 mb-3 ${toneClasses[computeBackend.tone]}`}>
        <div className="flex items-center justify-between">
          <div className="font-medium flex items-center gap-2">
            <span>{isFlat ? '◈' : '💻'}</span>
            {t('welcome.computeBackend')}
          </div>
          <span className="text-xs font-bold">{t(computeBackend.labelKey)}</span>
        </div>
        <div className="text-xs mt-1 opacity-90">
          {webgpuSupported
            ? t('welcome.webgpuDetected')
            : webgpuSupported === false
              ? t('welcome.webgpuFallback')
              : t('welcome.webgpuDetecting')}
        </div>
      </div>

      {/* 本地资源说明 */}
      <div className="rounded-lg border p-3 mb-3 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
        <div className="font-medium flex items-center gap-2">
          <span>{isFlat ? 'ⓘ' : '🔒'}</span>
          {t('welcome.localTitle')}
        </div>
        <div className="text-xs mt-1 opacity-90 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('welcome.localDesc') }} />
      </div>

      {/* 推荐环境 */}
      <div className="rounded-lg border p-3 mb-1 bg-gray-50 dark:bg-slate-700/50 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300">
        <div className="font-medium text-xs mb-1.5">{t('welcome.recommendTitle')}</div>
        <ul className="text-xs space-y-1 opacity-90">
          <li>{t('welcome.rec1')}</li>
          <li>{t('welcome.rec2')}</li>
          <li>{t('welcome.rec3')}</li>
        </ul>
      </div>

      <div className="text-xs text-gray-400 dark:text-gray-500 text-center mt-3">
        {t('welcome.closeHint')}
      </div>
    </Modal>
  );
}
