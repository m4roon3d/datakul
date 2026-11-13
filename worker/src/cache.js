// Saved answers for repeated first questions (see migrations/0005_answer_cache.sql).
// A hit is streamed back in the same shape as a live answer, so the app needs no special path to show it.
import { maskPII } from "./community.js";

const DAY = () => new Date().toISOString().slice(0, 10);
const KEEP_DAYS = 30, MAX_ROWS = 5000, MIN_CHARS = 40, MAX_CHARS = 6000;

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Same question, different spacing, capitals or a missing question mark: same answer.
export const normalise = (q) => String(q || "").toLowerCase().replace(/\s+/g, " ").replace(/[\s?.!]+$/, "").trim();

// Only grounded first questions are saved: no earlier conversation, at least one library note, nothing that looks
// personal (emails, phone or ID numbers), and short enough to be a common question.
export function cacheable(body, messages) {
  if (String(body.mode || "tutor") !== "tutor") return false;
  if (!Array.isArray(body.context) || !body.context.length) return false;
  if (messages.length !== 2) return false; // system + this question only
  const q = String(body.question || "");
  if (!q.trim() || q.length > 300) return false;
  if (maskPII(q) !== q.replace(/\s+/g, " ").trim()) return false;
  return true;
}
export async function cacheKey(messages) {
  return sha(JSON.stringify([messages[0].content, normalise(messages[1].content)]));
}

export async function getCached(env, k) {
  if (!env.DB) return null;
  try {
    return await env.DB.prepare("SELECT answer, provider, model FROM answer_cache WHERE k = ? AND created > ?")
      .bind(k, Date.now() - KEEP_DAYS * 86400000).first();
  } catch { return null; } // table missing before the migration runs
}
export async function noteHit(env, k) {
  if (!env.DB) return;
  try {
    await env.DB.prepare("UPDATE answer_cache SET hits = hits + 1, last_hit = ? WHERE k = ?").bind(Date.now(), k).run();
    await env.DB.prepare("INSERT INTO cache_day (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1").bind(DAY()).run();
  } catch {}
}

// A saved answer as an OpenAI-style event stream, in small pieces so it fills in like a live answer.
export function replay(text) {
  const enc = new TextEncoder(), parts = String(text).match(/[\s\S]{1,48}/g) || [];
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

// Pass a live answer through unchanged and save it once it has finished cleanly.
export function capture(body, env, ctx, k, provider, model) {
  const dec = new TextDecoder();
  let buf = "", text = "", done = false, finish = null;
  const scan = (line) => {
    if (!line.startsWith("data:")) return;
    const d = line.slice(5).trim();
    if (d === "[DONE]") { done = true; return; }
    try {
      const j = JSON.parse(d), ch = j.choices && j.choices[0];
      const t = ch && ch.delta && ch.delta.content;
      if (t) text += t;
      if (ch && ch.finish_reason) finish = ch.finish_reason;
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
      const t = text.trim();
      // Keep only complete answers: the stream ended properly, wasn't cut off at the length limit, and isn't a
      // clarifying question back to the learner.
      if (!done || finish === "length" || t.length < MIN_CHARS || t.length > MAX_CHARS || !/Your turn:/i.test(t)) return;
      const save = env.DB.prepare("INSERT INTO answer_cache (k, answer, provider, model, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(k) DO NOTHING")
        .bind(k, t, provider, model, Date.now()).run().catch(() => {});
      if (ctx && ctx.waitUntil) ctx.waitUntil(save);
    },
  }));
}

export async function pruneCache(env) {
  if (!env.DB) return;
  try {
    const cut = Date.now() - KEEP_DAYS * 86400000;
    await env.DB.prepare("DELETE FROM answer_cache WHERE created < ? OR COALESCE(last_hit, created) < ?").bind(cut, cut).run();
    await env.DB.prepare(`DELETE FROM answer_cache WHERE k IN (SELECT k FROM answer_cache ORDER BY COALESCE(last_hit, created) DESC LIMIT -1 OFFSET ${MAX_ROWS})`).run();
    await env.DB.prepare("DELETE FROM cache_day WHERE day < ?").bind(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)).run();
  } catch {}
}
export async function clearCache(env) {
  if (!env.DB) return 0;
  const r = await env.DB.prepare("DELETE FROM answer_cache").run();
  return (r.meta && r.meta.changes) || 0;
}
export async function cacheStatus(env) {
  if (!env.DB) return null;
  try {
    const a = await env.DB.prepare("SELECT COUNT(*) AS entries, COALESCE(SUM(hits), 0) AS hits FROM answer_cache").first();
    const t = await env.DB.prepare("SELECT n FROM cache_day WHERE day = ?").bind(DAY()).first();
    const w = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM cache_day WHERE day >= ?").bind(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)).first();
    return { entries: a.entries, hits: a.hits, today: t ? t.n : 0, week: w.n };
  } catch { return null; }
}
