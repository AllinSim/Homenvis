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

import { useState } from 'react';
import { useSettings } from '@/lib/settings-context';
import { useI18n } from '@/lib/i18n-context';
import Modal from '@/components/Modal';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** 常用 API 服务商预设。label 便于识别，base 为填入的 URL，models 为该服务可用模型名。 */
const API_PRESETS: { label: string; base: string; models: string[]; keySite: string }[] = [
  {
    label: '智谱 BigModel（GLM）',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4.6-flash', 'glm-4-plus', 'glm-4.6', 'glm-4'],
    keySite: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keySite: 'https://platform.openai.com/api-keys',
  },
  {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keySite: 'https://platform.deepseek.com/api_keys',
  },
  {
    label: '阿里云百炼（通义）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    keySite: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
  },
  {
    label: '月之暗面（Kimi）',
    base: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    keySite: 'https://platform.moonshot.cn/console/api-keys',
  },
];

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { apiBase, apiKey, apiModel, setApiBase, setApiKey, setApiModel } = useSettings();
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);

  // 当前选中的预设：若 apiBase 命中某个预设则显示其 label，否则为"自定义"
  const matchedPreset = API_PRESETS.find(p => p.base === apiBase);
  const presetValue = matchedPreset ? matchedPreset.label : '__custom__';

  const onPresetChange = (label: string) => {
    if (label === '__custom__') return; // 自定义：不动 base，让用户手填
    const p = API_PRESETS.find(x => x.label === label);
    if (p) {
      setApiBase(p.base);
      // 若当前模型名不在该服务模型列表内，自动填入该服务首个模型
      if (!apiModel || !p.models.includes(apiModel)) setApiModel(p.models[0]);
    }
  };

  // 当前 base 对应的快捷模型按钮（命中预设则用其模型，否则用智谱通用列表兜底）
  const quickModels = matchedPreset?.models ?? ['glm-4-flash', 'glm-4.6-flash', 'glm-4-plus', 'glm-4.6', 'glm-4'];

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')}>
      {/* AI API 配置 */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-emerald-500 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm">🤖</span>
          </div>
          <h3 className="font-bold text-gray-800 dark:text-gray-100">{t('settings.aiTitle')}</h3>
          <button
            onClick={() => setHelpOpen(true)}
            className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            title={t('settings.helpBtn')}
          >
            {t('settings.helpBtn')}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('settings.aiIntro')}
        </p>
        <div className="space-y-2">
          {/* 服务商快捷选择 */}
          <div>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">{t('settings.preset')}</span>
            <select
              value={presetValue}
              onChange={e => onPresetChange(e.target.value)}
              className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all"
            >
              {API_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
              <option value="__custom__">{t('settings.customPreset')}</option>
            </select>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">{t('settings.baseUrl')}</span>
            <input
              value={apiBase}
              onChange={e => setApiBase(e.target.value.trim())}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
              className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">{t('settings.apiKey')}</span>
            <input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              type="password"
              className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">{t('settings.modelName')}</span>
            <input
              value={apiModel}
              onChange={e => setApiModel(e.target.value.trim())}
              placeholder="glm-4-flash"
              className="w-full border-2 border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-all"
            />
          </label>
          {/* 当前服务商的常用模型快捷选择 */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-gray-400 dark:text-gray-500 w-full">{t('settings.quickModels')}</span>
            {quickModels.map(m => (
              <button
                key={m}
                onClick={() => setApiModel(m)}
                className={`px-2 py-0.5 text-[11px] rounded-full border transition-all ${apiModel === m
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {apiBase && apiKey && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-2 text-xs text-green-700 dark:text-green-300">
            {t('settings.apiConfigured')}
          </div>
        )}
      </section>

      {/* 如何获取 API 配置 帮助弹窗 */}
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t('settings.helpTitle')}>
        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-3 leading-relaxed">
          <p>{t('settings.helpIntro')}</p>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-2">
            <p className="font-bold text-blue-800 dark:text-blue-300">{t('settings.helpZhipuTitle')}</p>
            <p><a href="https://open.bigmodel.cn" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">open.bigmodel.cn</a></p>
            <p><a href="https://open.bigmodel.cn/usercenter/apikeys" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">API Keys</a></p>
            <p><code className="px-1 bg-gray-100 dark:bg-slate-700 rounded">glm-4-flash</code> / <code className="px-1 bg-gray-100 dark:bg-slate-700 rounded">glm-4.6-flash</code></p>
          </div>

          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 space-y-2">
            <p className="font-bold text-gray-800 dark:text-gray-200">{t('settings.helpOtherTitle')}</p>
            <p>{t('settings.helpOtherIntro')}</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {API_PRESETS.map(p => (
                <li key={p.label}>{p.label}：<a href={p.keySite} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">{p.keySite}</a></li>
              ))}
            </ul>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1 text-amber-700 dark:text-amber-300">
            <p className="font-medium">{t('settings.helpNoteTitle')}</p>
            <p>• <code className="px-1 bg-amber-100 dark:bg-amber-900/40 rounded">/v1</code> / <code className="px-1 bg-amber-100 dark:bg-amber-900/40 rounded">/paas/v4</code></p>
            <p>{t('settings.helpNote1')}</p>
            <p>{t('settings.helpNote2')}</p>
            <p>{t('settings.helpNote3')}</p>
            <p>{t('settings.helpNote4')}</p>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
