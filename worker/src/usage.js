// AI service status for the people who run Datakul: one row per AI call (provider, model, feature, success, timing,
// tokens), never the question or answer text. Shown on the review page's Status tab (Bearer ADMIN_TOKEN).
// Needs the D1 database (migrations/0002_usage.sql); without it, nothing is logged and the page says so.

// Free daily allowances we know of, to draw "used today" bars. Providers change these; check their consoles.
// Groq: per model, about 1,000 requests and 200,000 tokens a day. Gemini: per project (check AI Studio). OpenRouter
// free: 50 requests a day across free models. Workers AI: 10,000 neurons a day shared by all models (not tokens).
export const FREE_LIMITS = {
  "groq|openai/gpt-oss-120b": { req: 1000, tok: 200000 },
  "groq|openai/gpt-oss-20b": { req: 1000, tok: 200000 },
  "groq|qwen/qwen3.8-27b": { req: 1000, tok: 200000 },
  "gemini|gemini-flash-lite-latest": { req: 500, approx: true },
  "gemini|gemini-flash-latest": { req: 20, approx: true },
  "openrouter|openrouter/free": { req: 50, shared: true },
};
const DAY = () => new Date().toISOString().slice(0, 10); // UTC day: most free quotas reset at 00:00 UTC (5:30 am IST)
const est = (chars) => Math.ceil((chars || 0) / 4);
const n = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function rateHeaders(r) {
  const h = (k) => (r && r.headers ? r.headers.get(k) : null);
  return { rl_req: n(h("x-ratelimit-remaining-requests")), rl_tok: n(h("x-ratelimit-remaining-tokens")) };
}

export async function logUsage(env, rec) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO usage (day, ts, provider, model, mode, ok, status, ms, tin, tout, reported, fallback, rl_req, rl_tok, err) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(DAY(), Date.now(), rec.provider, rec.model, rec.mode || "tutor", rec.ok ? 1 : 0, rec.status ?? null, rec.ms ?? null,
      rec.tin ?? 0, rec.tout ?? 0, rec.reported ? 1 : 0, rec.fallback ? 1 : 0, rec.rl_req ?? null, rec.rl_tok ?? null,
      rec.err ? String(rec.err).slice(0, 160) : null).run();
  } catch (e) { /* table missing before the migration runs: never break an answer for logging */ }
}

// Pass a streamed answer through unchanged while counting it; logs one row when the stream ends.
export function meteredStream(body, env, ctx, rec) {
  const dec = new TextDecoder();
  let buf = "", chars = 0, usage = null;
  const scan = (line) => {
    if (!line.startsWith("data:")) return;
    const d = line.slice(5).trim();
    if (!d || d === "[DONE]") return;
    try {
      const j = JSON.parse(d);
      const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
      if (t) chars += t.length;
      const u = j.usage || (j.x_groq && j.x_groq.usage);
      if (u && (u.prompt_tokens || u.completion_tokens)) usage = u;
    } catch {}
  };
  return body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      ctrl.enqueue(chunk);
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { scan(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    },
    flush() {
      if (buf.trim()) scan(buf.trim());
      const done = logUsage(env, {
        ...rec, ok: true, status: 200,
        tin: usage ? usage.prompt_tokens : rec.tin, tout: usage ? usage.completion_tokens : est(chars), reported: !!usage,
      });
      if (ctx && ctx.waitUntil) ctx.waitUntil(done);
    },
  }));
}
export const promptTokens = (messages) => est(JSON.stringify(messages || []).length);

export async function setMeta(env, key, value) {
  if (!env.DB) return;
  try {
    await env.DB.prepare("INSERT INTO meta (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated")
      .bind(key, JSON.stringify(value), Date.now()).run();
  } catch {}
}
async function getMeta(env, key) {
  try { const r = await env.DB.prepare("SELECT v, updated FROM meta WHERE k = ?").bind(key).first(); return r ? { ...JSON.parse(r.v), updated: r.updated } : null; }
  catch { return null; }
}

function health(m) {
  if (!m.n) return { level: "idle", why: "No calls today" };
  if (m.last_err && (!m.last_ok || m.last_err > m.last_ok)) return { level: "down", why: "Last call failed" + (m.last_error ? `: ${m.last_error}` : "") };
  const errRate = (m.n - m.ok) / m.n;
  if (errRate > 0.1) return { level: "warn", why: `${Math.round(errRate * 100)}% of calls failed today` };
  if (m.ms && m.ms > 8000) return { level: "warn", why: `Slow: ${(m.ms / 1000).toFixed(1)} s to first word` };
  return { level: "ok", why: "Working" };
}

// Everything the Status tab shows.
export async function usageStatus(env, providers) {
  if (!env.DB) return { off: true };
  const day = DAY();
  let rows = [];
  try {
    rows = (await env.DB.prepare(`SELECT provider, model, COUNT(*) AS n, SUM(ok) AS ok, SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS busy,
      SUM(fallback) AS fallbacks, AVG(CASE WHEN ok = 1 THEN ms END) AS ms, SUM(tin) AS tin, SUM(tout) AS tout, MIN(reported) AS allrep,
      MAX(CASE WHEN ok = 1 THEN ts END) AS last_ok, MAX(CASE WHEN ok = 0 THEN ts END) AS last_err
      FROM usage WHERE day = ? GROUP BY provider, model`).bind(day).all()).results || [];
  } catch (e) {
    return { off: true, error: "The usage table is missing. It is created by migration 0002 on the next deploy." };
  }
  const key = (p, m) => p + "|" + m;
  const seen = new Map(rows.map((r) => [key(r.provider, r.model), r]));
  // every configured model gets a row, even with no calls today
  const models = [];
  providers.forEach((p) => p.models.forEach((m) => models.push({ provider: p.id, label: p.label, model: m.id, modelLabel: m.label })));
  rows.forEach((r) => { if (!models.some((m) => m.provider === r.provider && m.model === r.model)) models.push({ provider: r.provider, label: r.provider, model: r.model, modelLabel: r.model }); });
  for (const m of models) {
    const r = seen.get(key(m.provider, m.model)) || {};
    Object.assign(m, { n: r.n || 0, ok: r.ok || 0, busy: r.busy || 0, fallbacks: r.fallbacks || 0, ms: r.ms ? Math.round(r.ms) : null,
      tin: r.tin || 0, tout: r.tout || 0, estimated: r.n ? !r.allrep : false, last_ok: r.last_ok || null, last_err: r.last_err || null,
      limit: FREE_LIMITS[key(m.provider, m.model)] || null });
    if (m.last_err) {
      const e = await env.DB.prepare("SELECT err, status FROM usage WHERE provider = ? AND model = ? AND ok = 0 ORDER BY ts DESC LIMIT 1").bind(m.provider, m.model).first();
      m.last_error = e ? (e.err || (e.status ? "HTTP " + e.status : "")) : "";
    }
    const rl = await env.DB.prepare("SELECT rl_req, rl_tok, ts FROM usage WHERE provider = ? AND model = ? AND (rl_req IS NOT NULL OR rl_tok IS NOT NULL) ORDER BY ts DESC LIMIT 1").bind(m.provider, m.model).first();
    m.remaining = rl ? { req: rl.rl_req, tok: rl.rl_tok, at: rl.ts } : null;
    m.health = health(m);
  }
  const modes = (await env.DB.prepare("SELECT mode, COUNT(*) AS n, SUM(ok) AS ok FROM usage WHERE day = ? GROUP BY mode ORDER BY n DESC").bind(day).all()).results || [];
  const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const week = (await env.DB.prepare("SELECT day, COUNT(*) AS n, SUM(ok) AS ok, SUM(tin + tout) AS tokens FROM usage WHERE day >= ? GROUP BY day ORDER BY day").bind(since).all()).results || [];
  const totals = models.reduce((t, m) => ({ n: t.n + m.n, ok: t.ok + m.ok, busy: t.busy + m.busy, fallbacks: t.fallbacks + m.fallbacks, tokens: t.tokens + m.tin + m.tout }), { n: 0, ok: 0, busy: 0, fallbacks: 0, tokens: 0 });
  return { day, totals, models, modes, week, lastJob: await getMeta(env, "lastJob") };
}

export async function pruneUsage(env, days = 90) {
  if (!env.DB) return;
  try { await env.DB.prepare("DELETE FROM usage WHERE ts < ?").bind(Date.now() - days * 86400000).run(); } catch {}
}
