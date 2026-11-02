/* Daily certification questions: each night the gateway writes a few new original practice questions per exam section,
   checks them automatically (format rules, no near-duplicates, and a second AI pass that answers each question blind),
   and stores the ones that pass in D1. The app fetches them from /api/certq, so no deployment is needed.
   The owner can pause the job and set the number per section on the review page.
   Question format matches content/certs/*.json: { id, d, q, opts, ans, why }. */
import { CERT_META } from "./certs-meta.js";

const now = () => Date.now();
let memo = null; // the served list is kept for a minute; anything that changes it clears this
const DEFAULTS = { on: true, perSection: 5 };
const MAX_PER_SECTION = 10; // owner can ask for up to this many a night
const MAX_LIVE_PER_CERT = 1500; // keeps the download small
const CH = ["", "one", "two", "three"];
const str = (v) => (typeof v === "string" ? v.trim().replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ") : "");

/* ---- settings (stored in the meta table so changing them needs no deployment) ---- */
export async function getSettings(env) {
  try {
    const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'certq'").first();
    const v = r ? JSON.parse(r.v) : {};
    return { on: v.on !== false, perSection: clamp(v.perSection, 1, MAX_PER_SECTION, DEFAULTS.perSection) };
  } catch { return { ...DEFAULTS }; }
}
export async function saveSettings(env, patch) {
  const cur = await getSettings(env);
  const next = {
    on: typeof patch.on === "boolean" ? patch.on : cur.on,
    perSection: clamp(patch.perSection, 1, MAX_PER_SECTION, cur.perSection),
  };
  await env.DB.prepare("INSERT INTO meta (k, v, updated) VALUES ('certq', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated")
    .bind(JSON.stringify(next), now()).run();
  return next;
}
function clamp(v, lo, hi, dflt) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }

/* ---- prompts ---- */
export function writePrompt(cert, dom, n, avoid) {
  return [
    `You write original practice questions for the ${cert.name} exam, section "${dom.name}".`,
    `Base them on the public exam guide (${cert.guide}; ${cert.guideUrl}). Write your own questions. Never reproduce real exam questions or leaked content.`,
    "Output ONLY a JSON array, no prose, no code fence. Each item:",
    '{"q": "question text", "opts": ["option", "option", "option", "option"], "ans": [index of the correct option], "why": "explanation"}',
    "Rules:",
    `- Exactly ${n} questions. Each tests a different idea in this section. Mix recall, applying a feature to a short scenario, and choosing between approaches.`,
    "- 4 options. One correct answer, or two when the question ends with (Choose two.) and ans has two indexes. Use that wording exactly; use two-answer questions at most once.",
    "- Wrong options must be plausible and clearly wrong to someone who knows the topic. Vary where the correct answer sits. Do not use 'all of the above' or 'none of the above'.",
    "- 'why' is 2-4 sentences (at least 80 characters): why the answer is right and what makes the others wrong.",
    "- Be accurate and current as of the exam guide. If a detail is uncertain, ask about something you are sure of instead. No em dashes.",
    avoid.length ? "Do not repeat these existing questions or their ideas:\n" + avoid.map((t) => "- " + t.slice(0, 110)).join("\n") : "",
  ].filter(Boolean).join("\n");
}
export function verifyPrompt(cert) {
  return [
    `You are an expert on the ${cert.name} exam. Answer each question below on your own, from your knowledge.`,
    'Output ONLY a JSON array like [{"i": 0, "pick": [1], "ok": true, "issue": ""}] with one item per question, in order.',
    '"pick" is the index (or two indexes for a (Choose two.) question) you believe are correct.',
    '"ok" is false if the question is ambiguous, has no correct option, has more than one defensible correct option, or states something that is not accurate. Put the reason in "issue".',
  ].join("\n");
}
export function parseArray(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a < 0 || b <= a) throw new Error("The model didn't return a JSON list.");
  return JSON.parse(t.slice(a, b + 1));
}

/* ---- checks ---- */
export function normalize(raw, domId) {
  const opts = (Array.isArray(raw && raw.opts) ? raw.opts : []).map(str);
  const ans = (Array.isArray(raw && raw.ans) ? raw.ans : [raw && raw.ans]).map(Number).filter((x) => Number.isInteger(x));
  return { d: domId, q: str(raw && raw.q), opts, ans: [...new Set(ans)].sort((a, b) => a - b), why: str(raw && raw.why) };
}
export function checkQuestion(q) {
  const e = [];
  if (q.q.length < 30 || q.q.length > 600) e.push("question length");
  if (q.opts.length !== 4) e.push("needs 4 options");
  if (q.opts.some((o) => o.length < 1 || o.length > 260)) e.push("option length");
  if (new Set(q.opts.map((o) => o.toLowerCase())).size !== q.opts.length) e.push("duplicate options");
  if (q.opts.some((o) => /^(all|none) of the (above|options)/i.test(o))) e.push("all/none of the above");
  if (!q.ans.length || q.ans.length > 2 || q.ans.some((a) => a < 0 || a >= q.opts.length)) e.push("answer index");
  if (q.ans.length > 1 && !q.q.includes(`(Choose ${CH[q.ans.length]}.)`)) e.push("multi-answer wording");
  if (q.ans.length === 1 && /\(Choose/.test(q.q)) e.push("says Choose but has one answer");
  if (q.why.length < 80 || q.why.length > 900) e.push("explanation length");
  return e;
}
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2));
export function similar(a, b) {
  const x = words(a), y = words(b);
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return n / Math.max(1, x.size + y.size - n);
}
export const isDuplicate = (text, existing) => existing.some((t) => similar(text, t) > 0.6);

/* ---- one section ---- */
async function existingTexts(env, certId, domId) {
  const meta = CERT_META.find((c) => c.id === certId);
  const fixed = (meta ? meta.texts : []).filter((t) => t.d === domId).map((t) => t.q);
  const rows = (await env.DB.prepare("SELECT q FROM cert_q WHERE cert = ? AND dom = ?").bind(certId, domId).all()).results || [];
  return [...fixed, ...rows.map((r) => r.q)];
}
export async function makeSection(env, deps, cert, dom, n) {
  const have = await existingTexts(env, cert.id, dom.id);
  const avoid = have.slice(-40);
  const out = { cert: cert.id, dom: dom.id, asked: n, added: 0, rejected: [] };
  const w = await deps.complete([{ role: "system", content: writePrompt(cert, dom, n, avoid) }, { role: "user", content: "Write the questions now." }], env, { maxTokens: 3500 });
  let list; try { list = parseArray(w.text).slice(0, n); } catch (e) { out.error = e.message; return out; }
  const good = [];
  for (const raw of list) {
    const q = normalize(raw, dom.id), errs = checkQuestion(q);
    if (!errs.length && isDuplicate(q.q, [...have, ...good.map((g) => g.q)])) errs.push("too like an existing question");
    if (errs.length) out.rejected.push(errs[0]); else good.push(q);
  }
  if (!good.length) return out;
  // Second pass: another call answers each question without seeing the key; keep only those where it agrees.
  let ver = [];
  try {
    const body = good.map((q, i) => `Q${i}. ${q.q}\n` + q.opts.map((o, k) => `  ${k}. ${o}`).join("\n")).join("\n\n");
    const v = await deps.complete([{ role: "system", content: verifyPrompt(cert) }, { role: "user", content: body }], env, { maxTokens: 1500 });
    ver = parseArray(v.text);
  } catch (e) { out.error = "Checker unavailable: " + e.message; return out; } // nothing is published without the second check
  const t = now();
  for (const [i, q] of good.entries()) {
    const r = ver.find((x) => x && Number(x.i) === i) || ver[i];
    const pick = r && Array.isArray(r.pick) ? r.pick.map(Number).sort((a, b) => a - b) : [];
    if (!r || r.ok === false || pick.join() !== q.ans.join()) { out.rejected.push(r && r.issue ? "checker: " + String(r.issue).slice(0, 80) : "checker disagreed"); continue; }
    const id = `${cert.id}-n-${new Date(t).toISOString().slice(2, 10).replace(/-/g, "")}-${dom.id}-${Math.random().toString(36).slice(2, 7)}`;
    await env.DB.prepare("INSERT INTO cert_q (id, cert, dom, q, data, status, model, created) VALUES (?, ?, ?, ?, ?, 'live', ?, ?)")
      .bind(id, cert.id, dom.id, q.q, JSON.stringify({ id, ...q }), `${w.provider} · ${w.model}`, t).run();
    out.added++;
  }
  if (out.added) memo = null;
  return out;
}

/* ---- nightly ---- */
export async function runCertJob(env, deps, { force = false } = {}) {
  if (!env.DB) return { off: true };
  const s = await getSettings(env);
  if (!s.on && !force) return { paused: true };
  const results = [];
  for (const cert of CERT_META) {
    const live = (await env.DB.prepare("SELECT COUNT(*) AS n FROM cert_q WHERE cert = ? AND status = 'live'").bind(cert.id).first()).n;
    if (live >= MAX_LIVE_PER_CERT) { results.push({ cert: cert.id, full: true }); continue; }
    for (const dom of cert.domains) {
      try { results.push(await makeSection(env, deps, cert, dom, s.perSection)); }
      catch (e) { results.push({ cert: cert.id, dom: dom.id, error: String(e.message).slice(0, 160) }); }
    }
  }
  const sum = { at: now(), added: results.reduce((a, r) => a + (r.added || 0), 0), results };
  if (deps.setMeta) await deps.setMeta("lastCertJob", sum);
  return sum;
}

/* ---- served to the app ---- */
export async function publicQuestions(env, certId) {
  if (!env.DB) return { questions: [], off: true };
  if (memo && memo.cert === certId && now() - memo.at < 60000) return memo.out;
  const rows = (await env.DB.prepare("SELECT data, created FROM cert_q WHERE cert = ? AND status = 'live' ORDER BY created LIMIT ?").bind(certId, MAX_LIVE_PER_CERT).all()).results || [];
  const out = { questions: rows.map((r) => ({ ...JSON.parse(r.data), n: r.created })), updated: rows.reduce((m, r) => Math.max(m, r.created), 0) };
  out.etag = `"${out.updated}-${rows.length}"`; // lets the app ask 'anything new?' and get a tiny 304 reply
  memo = { cert: certId, at: now(), out };
  return out;
}

/* ---- owner screen ---- */
export async function adminOverview(env) {
  const s = await getSettings(env);
  const rows = (await env.DB.prepare("SELECT cert, dom, status, COUNT(*) AS n FROM cert_q GROUP BY cert, dom, status").all()).results || [];
  const day = now() - 86400000;
  const recent = (await env.DB.prepare("SELECT id, cert, dom, status, data, model, created FROM cert_q ORDER BY created DESC LIMIT 40").all()).results || [];
  const today = (await env.DB.prepare("SELECT COUNT(*) AS n FROM cert_q WHERE status = 'live' AND created > ?").bind(day).first()).n;
  let last = null; try { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'lastCertJob'").first(); last = r ? JSON.parse(r.v) : null; } catch {}
  return {
    settings: s, today, last,
    certs: CERT_META.map((c) => ({ id: c.id, name: c.name, fixed: c.texts.length, domains: c.domains.map((d) => ({ id: d.id, name: d.name, fixed: c.texts.filter((t) => t.d === d.id).length, live: (rows.find((r) => r.cert === c.id && r.dom === d.id && r.status === "live") || {}).n || 0 })) })),
    recent: recent.map((r) => ({ id: r.id, cert: r.cert, dom: r.dom, status: r.status, model: r.model, created: r.created, ...JSON.parse(r.data) })),
  };
}
export async function withdraw(env, id, back) {
  const r = await env.DB.prepare("UPDATE cert_q SET status = ? WHERE id = ?").bind(back ? "live" : "withdrawn", String(id)).run();
  memo = null;
  return { ok: !!(r.meta && r.meta.changes) };
}
export const clearMemo = () => { memo = null; };
