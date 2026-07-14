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

export type IconStyle = 'skeuomorphic' | 'flat';

interface IconStyleContextValue {
  iconStyle: IconStyle;
  setIconStyle: (style: IconStyle) => void;
}

const IconStyleContext = createContext<IconStyleContextValue>({
  iconStyle: 'skeuomorphic',
  setIconStyle: () => {},
});

export function useIconStyle() {
  return useContext(IconStyleContext);
}

export function IconStyleProvider({ children }: { children: ReactNode }) {
  const [iconStyle, setIconStyleState] = useState<IconStyle>('skeuomorphic');

  useEffect(() => {
    const stored = localStorage.getItem('lbm-icon-style') as IconStyle | null;
    if (stored === 'flat' || stored === 'skeuomorphic') {
      setIconStyleState(stored);
    }
  }, []);

  const setIconStyle = useCallback((style: IconStyle) => {
    setIconStyleState(style);
    localStorage.setItem('lbm-icon-style', style);
  }, []);

  return (
    <IconStyleContext.Provider value={{ iconStyle, setIconStyle }}>
      {children}
    </IconStyleContext.Provider>
  );
}

/**
 * Icon mapping: flat style uses minimalist SVG-rendered icons,
 * skeuomorphic uses emoji (current style).
 */
export const ICON_MAP: Record<string, Record<IconStyle, string>> = {
  // SideNav tabs
  'modeling':    { skeuomorphic: '📦', flat: '⬡' },
  'simulation':  { skeuomorphic: '🌀', flat: '▸' },
  'analysis':    { skeuomorphic: '📊', flat: '◈' },

  // Modeling sections
  'ai-design':   { skeuomorphic: '🤖', flat: 'AI' },
  'room-size':   { skeuomorphic: '📏', flat: '□' },
  'walls':       { skeuomorphic: '🧱', flat: '⊞' },
  'devices':     { skeuomorphic: '🖥️', flat: '⚡' },
  'furniture':   { skeuomorphic: '🛋️', flat: '⌂' },
  'vents':       { skeuomorphic: '💨', flat: '◎' },
  'heat-sources':{ skeuomorphic: '🔥', flat: '◉' },

  // Simulation sections (new structure)
  'sim-conditions': { skeuomorphic: '💨', flat: '⊙' },
  'sim-control':    { skeuomorphic: '▶️', flat: '▸' },

  // Analysis sections
  'visualization': { skeuomorphic: '🎨', flat: '◉' },
  'statistics':    { skeuomorphic: '📈', flat: '≡' },

  // TopBar buttons
  'save':     { skeuomorphic: '💾', flat: '⤓' },
  'about':    { skeuomorphic: '📖', flat: 'ⓘ' },
  'contact':  { skeuomorphic: '📧', flat: '✉' },
  'theme-light': { skeuomorphic: '🌙', flat: '◐' },
  'theme-dark':  { skeuomorphic: '☀️', flat: '◑' },
  'language': { skeuomorphic: '🌐', flat: '文' },
  'settings': { skeuomorphic: '⚙️', flat: '⚙' },

  // SimulationStepPanel inline icons
  'init-engine':     { skeuomorphic: '🔧', flat: '+' },
  'reinit-engine':   { skeuomorphic: '🔄', flat: '↻' },
  'run':             { skeuomorphic: '▶️', flat: '▸' },
  'stop':            { skeuomorphic: '⏹️', flat: '■' },
  'reset':           { skeuomorphic: '🔄', flat: '↻' },
  'log-wait':        { skeuomorphic: '💤', flat: '—' },
};

/**
 * Helper: get the icon for a given key based on current icon style.
 */
export function getIcon(key: string, style: IconStyle): string {
  const entry = ICON_MAP[key];
  if (!entry) return key; // fallback: return the key itself
  return entry[style];
}
