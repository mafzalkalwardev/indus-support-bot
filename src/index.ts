import { createBotService, PRODUCT_SITES } from '@indus/bot-core';
import { draftAnswer, run } from './logic';

createBotService({
  id: 'support',
  name: 'Support',
  description: 'A small chat widget for product sites. It answers from docs and escalates to Inquiries. It never emails.',
  accent: '#8fd0c6',
  defaultPort: 41758,
  capabilities: ['widget'],
  defaultSettings: { docs: PRODUCT_SITES.map((url) => `${url}/llms.txt`) },
  fields: [{ key: 'docs', label: 'llms.txt or docs URLs', type: 'lines' }],
  desired: [{ key: 'refresh-docs', task: 'refresh-docs', cron: '0 */12 * * *', group: 'default' }],
  autoTask: 'refresh-docs',
  publicRoutes: (app, deps) => {
    app.get('/widget.js', (_req, res) => {
      res.type('application/javascript').send(widget());
    });
    app.post('/chat', async (req, res) => {
      const row = deps.db.prepare(`SELECT value_json FROM kv WHERE key = 'docs'`).get() as { value_json: string } | undefined;
      const docs = row ? (JSON.parse(row.value_json) as { text?: string }).text || '' : '';
      const answer = await draftAnswer(String(req.body?.message || '').slice(0, 2000), docs, async (system, user) => {
        const { completeLlm, withLlmLock, llmConfig } = await import('@indus/bot-core');
        const config = llmConfig(deps.env);
        return withLlmLock(deps.env.INDUS_SHARED_DIR || deps.dataDir, 'support', config.timeoutMs, () => completeLlm(config, [{ role: 'system', content: system }, { role: 'user', content: user }]));
      });
      res.json(answer);
    });
    app.post('/lead', async (req, res) => {
      const headers = { authorization: `Bearer ${deps.env.INDUS_BOT_TOKEN || 'dev-bot-token'}`, 'content-type': 'application/json' };
      const hub = deps.env.HUB_URL || 'http://127.0.0.1:41731';
      try {
        const fleet = await fetch(new URL('/api/internal/fleet', hub), { headers, signal: AbortSignal.timeout(3000) });
        const inquiries = fleet.ok ? ((await fleet.json()) as { bots: { id: string; base_url: string }[] }).bots.find((bot) => bot.id === 'inquiries') : undefined;
        if (inquiries) {
          await fetch(new URL('/api/internal/ingest', inquiries.base_url), { method: 'POST', headers, body: JSON.stringify({ from: 'support', type: 'inquiry_reply', title: 'Widget escalation', summary: String(req.body?.email || ''), body: String(req.body?.message || ''), payload: { to: req.body?.email, site: req.body?.site } }) });
        }
      } catch { /* inquiries can be down */ }
      res.status(202).json({ ok: true });
    });
  },
  runTask: run,
}).start().catch((error) => { console.error(error); process.exit(1); });

function widget(): string {
  return `(() => {
    const script = document.currentScript;
    const endpoint = (script && script.dataset.endpoint) || '/public/support';
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;font:14px/1.4 system-ui,sans-serif';
    root.innerHTML = '<button id="indus-open" style="background:#121613;color:#e0b15c;border:0;border-radius:999px;padding:10px 14px">Ask INDUS</button><form id="indus-box" hidden style="background:#fff;color:#142;padding:12px;border-radius:12px;width:min(320px,90vw);display:grid;gap:8px"><strong>Product help</strong><div id="indus-log"></div><input name="q" placeholder="Ask about this product" style="padding:8px"><button>Send</button></form>';
    document.body.appendChild(root);
    const open = root.querySelector('#indus-open');
    const box = root.querySelector('#indus-box');
    open.onclick = () => { box.hidden = !box.hidden; };
    box.onsubmit = async (event) => {
      event.preventDefault();
      const q = new FormData(box).get('q');
      const res = await fetch(endpoint + '/chat', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ message: q, site: location.host }) });
      const data = await res.json();
      root.querySelector('#indus-log').textContent = data.reply || '';
      if (data.escalate) {
        const email = prompt('Leave an email and a person will follow up. Nothing is sent until they approve a reply.');
        if (email) await fetch(endpoint + '/lead', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email, message: q, site: location.host }) });
      }
    };
  })();`;
}
