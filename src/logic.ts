import { extractJson, fetchText, type TaskContext, type TaskResult } from '@indus/bot-core';

export function answerFromDocs(question: string, docs: string): { grounded: boolean } {
  const words = question.toLowerCase().split(/\W+/).filter((word) => word.length > 4);
  const grounded = words.some((word) => docs.toLowerCase().includes(word));
  return { grounded };
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task !== 'refresh-docs' && ctx.task !== 'auto' && ctx.task !== 'check') {
    if (ctx.task === 'instruct') return { summary: 'The widget answers from product docs and escalates to Inquiries. It does not email anyone.' };
  }
  const url = String((Array.isArray(ctx.settings.docs) ? ctx.settings.docs[0] : '') || 'https://mailforge.induswebagency.com/llms.txt');
  const page = await fetchText(url, ctx.fetch, 8000);
  ctx.db.prepare(`INSERT INTO kv (key, value_json) VALUES ('docs', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`).run(JSON.stringify({ url, text: page.text.slice(0, 20000), at: ctx.now.toISOString() }));
  return { summary: page.ok ? `Cached docs from ${url}.` : `Docs fetch failed for ${url}.` };
}

export async function draftAnswer(question: string, docs: string, llm: TaskContext['llm']): Promise<{ reply: string; escalate: boolean }> {
  const grounding = answerFromDocs(question, docs);
  const result = await llm('Answer only from the product notes. Return JSON with answer and escalate boolean. If the person wants a human, set escalate true. Do not invent prices.', `Notes:\n${docs.slice(0, 4000)}\n\nQuestion: ${question}`);
  try {
    const parsed = extractJson(result.text) as { answer?: string; escalate?: boolean };
    return { reply: String(parsed.answer || result.text), escalate: Boolean(parsed.escalate) || !grounding };
  } catch {
    return { reply: result.text.slice(0, 500), escalate: !grounding };
  }
}
