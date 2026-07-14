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

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface Settings {
  apiBase: string;
  apiKey: string;
  apiModel: string;
}

const DEFAULTS: Settings = {
  apiBase: '',
  apiKey: '',
  apiModel: '',
};

const STORAGE_KEY = 'roomsim-settings';

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

interface SettingsContextValue extends Settings {
  setApiBase: (v: string) => void;
  setApiKey: (v: string) => void;
  setApiModel: (v: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setMounted(true);
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  return (
    <SettingsContext.Provider
      value={{
        apiBase: settings.apiBase,
        apiKey: settings.apiKey,
        apiModel: settings.apiModel,
        setApiBase: (v) => update({ apiBase: v }),
        setApiKey: (v) => update({ apiKey: v }),
        setApiModel: (v) => update({ apiModel: v }),
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
