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

import { NextRequest, NextResponse } from 'next/server';
import { buildSystemPrompt, buildVlmPrompt } from '@/lib/ai-layout-prompt';

export async function POST(req: NextRequest) {
  try {
    const { type, input, apiBase, apiKey, apiModel } = await req.json();

    if (!apiBase || !apiKey) {
      return NextResponse.json(
        { error: 'apiBase and apiKey are required' },
        { status: 400 }
      );
    }

    const baseUrl = apiBase.replace(/\/$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    const llmModel = apiModel || 'glm-4-flash';

    let description = input || '';

    if (type === 'image') {
      // Step 1: VLM 分析图片 → 结构化文字描述
      const vlmModel = apiModel?.replace('glm-4-', 'glm-4v-') || 'glm-4v-flash';
      const vlmBody = {
        model: vlmModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildVlmPrompt() },
            { type: 'image_url', image_url: { url: input } },
          ],
        }],
      };
      const vlmResp = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(vlmBody) });
      if (!vlmResp.ok) {
        const err = await vlmResp.text();
        return NextResponse.json({ error: `VLM API error: ${err}` }, { status: vlmResp.status });
      }
      const vlmResult = await vlmResp.json();
      description = vlmResult.choices?.[0]?.message?.content || '';
      if (!description) {
        return NextResponse.json({ error: 'VLM 未返回有效描述' }, { status: 500 });
      }
    }

    // Step 2: LLM 把描述转为布局 JSON（带完整目录与推理步骤的 system 提示词）
    const layout = await parseDescription(description, baseUrl, headers, llmModel);
    return NextResponse.json(layout);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function parseDescription(description: string, baseUrl: string, headers: Record<string, string>, model: string) {
  const body = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: `请根据以下房间描述生成布局 JSON：\n\n${description}` },
    ],
    temperature: 0.2,
  };

  const resp = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    const errText = await resp.text();
    // 智谱 1211: 模型不存在 —— 给出可操作提示
    let friendly = errText;
    try {
      const j = JSON.parse(errText);
      if (j?.error?.code === '1211' || /模型不存在|model not found/i.test(errText)) {
        friendly = `模型「${model}」不存在或当前账号未开通。请在「设置」中改用有效模型名（智谱常用：glm-4-flash / glm-4.6-flash / glm-4-plus / glm-4）。原始错误：${errText}`;
      }
    } catch {}
    throw new Error(`LLM API error: ${friendly}`);
  }
  const result = await resp.json();
  const text = result.choices?.[0]?.message?.content || '';

  const parsed = extractJson(text);
  if (!parsed) throw new Error('无法从 AI 响应中解析出 JSON 布局，请重试或更换描述。');
  return parsed;
}

/**
 * 从 LLM 文本中稳健地提取 JSON 对象：
 *   - 优先去掉 ```json ... ``` 代码块围栏；
 *   - 用括号配平找到最外层 { ... }；
 *   - 修复常见尾逗号。
 */
function extractJson(text: string): any | null {
  if (!text) return null;
  let s = text.trim();
  // 去除 markdown 代码围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 找到第一个 '{'，做括号配平（忽略字符串内的括号）
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
  }
  if (end < 0) return null;
  let jsonStr = s.slice(start, end + 1);
  // 修复尾逗号
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(jsonStr);
  } catch {
    // 更激进的修复：补全缺失逗号
    try {
      const fixed = jsonStr
        .replace(/}\s*\n\s*{/g, '},\n{')
        .replace(/]\s*\n\s*{/g, '],\n{')
        .replace(/"\s*\n\s*"/g, '",\n"')
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}
