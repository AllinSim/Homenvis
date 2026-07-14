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

import { useState, useCallback, useRef } from 'react';
import { type RoomLayout } from '@/lib/room-layout';
import { buildRoomLayout } from '@/lib/ai-layout-builder';
import { useI18n } from '@/lib/i18n-context';

interface UseAIAnalysisProps {
  addLog: (msg: string) => void;
  onLayoutGenerated: (layout: RoomLayout) => void;
  apiBase?: string;
  apiKey?: string;
  apiModel?: string;
}

export interface AiLogEntry {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'warn' | 'error';
}

export function useAIAnalysis({ addLog, onLayoutGenerated, apiBase, apiKey, apiModel }: UseAIAnalysisProps) {
  const { t } = useI18n();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiLogEntry[]>([]);
  const seqRef = useRef(0);

  const push = useCallback((text: string, kind: AiLogEntry['kind'] = 'info') => {
    seqRef.current += 1;
    const entry: AiLogEntry = { id: seqRef.current, text, kind };
    setAiMessages(prev => [...prev, entry]);
    addLog(text);
  }, [addLog]);

  const handleAI = async (userInput: string, mode: 'text' | 'image') => {
    const base = apiBase || '';
    const key = apiKey || '';
    const model = apiModel || '';
    if (!base || !key) {
      push(t('ai.configFirst'), 'error');
      return;
    }
    if (mode === 'text' && !userInput.trim()) {
      push(t('ai.inputFirst'), 'error');
      return;
    }
    setAiLoading(true);
    setAiMessages([]);
    push(t('ai.connecting'), 'info');
    if (mode === 'image') push(t('ai.imageMode'), 'info');
    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: mode, input: userInput, apiBase: base, apiKey: key, apiModel: model }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || t('ai.aiFail'));
      }
      push(t('ai.returned'), 'info');
      const data = await resp.json();

      // 原始 JSON → RoomLayout，并执行几何校核/自动修复
      const { layout, warnings } = buildRoomLayout(data);
      onLayoutGenerated(layout);

      push(t('ai.loaded'), 'success');
      push(t('ai.roomSummary', { l: layout.length, w: layout.width, h: layout.height, boxes: layout.boxes.length, vents: layout.vents.length, heat: layout.heatSources.length, devices: layout.devices.length }), 'info');
      // 几何校核结果
      const shown = warnings.slice(0, 20);
      shown.forEach(w => push(`  · ${w}`, w.includes('忽略') || w.includes('失败') ? 'warn' : 'info'));
      if (warnings.length > 20) push(t('ai.moreWarnings', { n: warnings.length - 20 }), 'info');
    } catch (err: any) {
      const msg = err.message || t('ai.unknownError');
      push(t('ai.failPrefix', { msg }), 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const clearMessages = useCallback(() => setAiMessages([]), []);

  return { aiLoading, handleAI, aiMessages, clearMessages };
}
