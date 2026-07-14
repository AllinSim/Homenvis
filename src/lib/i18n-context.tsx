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

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { DICT, type Lang } from '@/lib/i18n-dict';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a key with optional {param} interpolation. Falls back to zh, then to the key. */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (k) => k,
});

export function useI18n() {
  return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Start with 'zh' to match server-rendered HTML and avoid hydration mismatch.
  // The real language (from localStorage) is applied in the first useEffect.
  const [lang, setLangState] = useState<Lang>('zh');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('roomsim-lang') as Lang | null;
    if (stored === 'en' || stored === 'zh') {
      setLangState(stored);
    }
    setMounted(true);
  }, []);

  // Persist on change (skip the initial 'zh' before real lang loads)
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem('roomsim-lang', lang);
  }, [lang, mounted]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    const table = DICT[lang];
    let val = table[key] ?? DICT.zh[key] ?? key;
    if (params) {
      val = val.replace(/\{(\w+)\}/g, (_, name: string) =>
        params[name] !== undefined ? String(params[name]) : `{${name}}`,
      );
    }
    return val;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}
