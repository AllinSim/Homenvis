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

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always start with 'light' to match server-rendered HTML and avoid hydration mismatch.
  // The real theme (from localStorage / system preference) is applied in the first useEffect.
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  // On mount, read the real theme preference and apply it.
  // This runs AFTER hydration, so no mismatch.
  useEffect(() => {
    const stored = localStorage.getItem('lbm-theme') as Theme | null;
    let initial: Theme = 'light';
    if (stored === 'light' || stored === 'dark') {
      initial = stored;
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      initial = 'dark';
    }
    setTheme(initial);
    setMounted(true);
  }, []);

  // Apply dark class to <html> element whenever theme changes
  useEffect(() => {
    if (!mounted) return; // skip the initial 'light' before real theme is loaded
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('lbm-theme', theme);
  }, [theme, mounted]);

  // Listen for system preference changes
  useEffect(() => {
    if (!mounted) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem('lbm-theme');
      // Only follow system preference if user hasn't explicitly set a preference
      if (!stored) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [mounted]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
