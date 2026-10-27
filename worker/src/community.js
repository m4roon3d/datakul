// Datakul layer 2: a shared library that grows from what learners ask.
//
//   1. Collect   POST /api/miss        the app reports a question the library couldn't answer (anonymous, PII masked)
//   2. Group     nightly cron          questions are embedded and grouped by meaning
//   3. Draft     nightly cron          when enough different people ask about one thing, an LLM drafts a concept card
//                                      and two interview questions; the server checks them with the app's own grader
//   4. Review    /api/admin/*          a person approves, edits, redrafts or rejects each draft (Bearer ADMIN_TOKEN)
//   5. Publish   GET /api/community    approved cards load into every learner's app as "Community picks"
//
// Needs a D1 database bound as DB and the Workers AI binding (for embeddings). Without DB these routes switch off.

import { grade } from "./grader.js";

const DEF = {
  minAskers: 10,       // different askers needed before a topic is drafted
  sim: 0.8,            // cosine similarity to join an existing group
  retainDays: 180,     // unanswered questions are deleted after this
  draftsPerRun: 3,     // LLM drafts per nightly run (keeps free-tier use small)
  maxQ: 300,           // characters kept from each question
  sample: 10,          // example questions kept per group
};
const cfg = (env, k) => {
  const map = { minAskers: "MIN_ASKERS", sim: "CLUSTER_SIM", retainDays: "RETAIN_DAYS", draftsPerRun: "DRAFTS_PER_RUN" };
  const v = Number(env[map[k]]);
  return Number.isFinite(v) && v > 0 ? v : DEF[k];
};
const DAY_MS = 86400000;
const TRACKS = ["de", "da", "ds", "ar"];
const now = () => Date.now();
const isoDay = (t = now()) => new Date(t).toISOString().slice(0, 10);

/* ---------------- privacy ---------------- */
export function maskPII(s) {
  return String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[id]")                       // PAN
    .replace(/(?:\+?\d[\s-]?){10,}/g, (m) => (/\s$/.test(m) ? "[number] " : "[number]")) // phones, Aadhaar, card numbers
    .replace(/https?:\/\/\S+/g, (u) => u.split(/[?#]/)[0])                    // drop query strings, which can carry tokens
    .replace(/\s+/g, " ")
    .trim();
}
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// A per-day pseudonym: lets us count different askers without being able to follow anyone across days.
const askerOf = async (ip, env) => (await sha(`${env.ADMIN_TOKEN || "datakul"}|${ip}|${isoDay()}`)).slice(0, 16);

/* ---------------- vectors ---------------- */
function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}
const packVec = (v) => JSON.stringify(v.map((x) => Math.round(x * 1e5) / 1e5));

/* ---------------- 1. collect ---------------- */
export async function recordMiss(body, ip, env, deps) {
  if (!env.DB || !env.AI) return { status: 200, out: { ok: false, reason: "off" } };
  const raw = String(body.q ?? "");
  const q = maskPII(raw).slice(0, DEF.maxQ);
  if (q.length < 8 || q.split(" ").length < 3) return { status: 400, out: { error: "Question too short." } };
  const track = TRACKS.includes(body.track) ? body.track : null;
  const asker = await askerOf(ip, env), day = isoDay();
  const dup = await env.DB.prepare("SELECT id FROM misses WHERE asker = ? AND day = ? AND lower(q) = lower(?)").bind(asker, day, q).first();
  if (dup) return { status: 200, out: { ok: true, dup: true } };
  const [vec] = await deps.embed([q]);
  await env.DB.prepare("INSERT INTO misses (q, track, asker, day, vec, created) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(q, track, asker, day, packVec(vec), now()).run();
  return { status: 200, out: { ok: true } };
}

/* ---------------- 2. group ---------------- */
export async function clusterMisses(env) {
  const sim = cfg(env, "sim");
  const pending = (await env.DB.prepare("SELECT id, q, vec FROM misses WHERE cluster_id IS NULL ORDER BY id LIMIT 1000").all()).results || [];
  if (!pending.length) return { assigned: 0, created: 0 };
  const rows = (await env.DB.prepare("SELECT id, label, centroid, n, sample, status FROM clusters ORDER BY id LIMIT 5000").all()).results || [];
  const cl = rows.map((r) => ({ ...r, c: JSON.parse(r.centroid), s: JSON.parse(r.sample || "[]"), dirty: false, fresh: false }));
  let created = 0;
  for (const m of pending) {
    const v = JSON.parse(m.vec);
    let best = null, bs = -1;
    for (const k of cl) { const s = cosine(v, k.c); if (s > bs) { bs = s; best = k; } }
    if (!best || bs < sim) {
      best = { id: null, label: m.q, c: v.slice(), n: 0, s: [], status: "open", dirty: true, fresh: true, members: [] };
      cl.push(best); created++;
    } else {
      best.c = best.c.map((x, i) => (x * best.n + v[i]) / (best.n + 1));
    }
    best.n++; best.dirty = true;
    if (best.s.length < DEF.sample && !best.s.some((x) => x.toLowerCase() === m.q.toLowerCase())) best.s.push(m.q);
    (best.members = best.members || []).push(m.id);
  }
  const t = now();
  for (const k of cl.filter((x) => x.dirty)) {
    if (k.fresh) {
      const r = await env.DB.prepare("INSERT INTO clusters (label, centroid, n, status, sample, updated) VALUES (?, ?, ?, 'open', ?, ?) RETURNING id")
        .bind(k.label, packVec(k.c), k.n, JSON.stringify(k.s), t).first();
      k.id = r.id;
    } else {
      await env.DB.prepare("UPDATE clusters SET centroid = ?, n = ?, sample = ?, updated = ? WHERE id = ?").bind(packVec(k.c), k.n, JSON.stringify(k.s), t, k.id).run();
    }
    const ids = k.members || [];
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      await env.DB.prepare(`UPDATE misses SET cluster_id = ? WHERE id IN (${part.map(() => "?").join(",")})`).bind(k.id, ...part).run();
    }
    const a = await env.DB.prepare("SELECT COUNT(DISTINCT asker) AS a FROM misses WHERE cluster_id = ?").bind(k.id).first();
    await env.DB.prepare("UPDATE clusters SET askers = ? WHERE id = ?").bind(a.a || 0, k.id).run();
  }
  return { assigned: pending.length, created };
}

/* ---------------- 3. draft and check ---------------- */
export function draftPrompt() {
  return [
    "You write one new entry for Datakul, a learning library for data engineering, data analysis, data science and data architecture careers.",
    "Several learners asked the questions below and the library had no entry for them. Write the entry they needed.",
    "Output ONLY a JSON object, no prose, no code fence:",
    '{"concept": {"title": "2-6 word topic name in sentence case",',
    ' "t": "de, da, ds or ar: the track that fits best (data engineering, data analysis, data science, data architecture)",',
    ' "lv": "F, I or A: foundation, intermediate or advanced",',
    ' "kw": "15-30 lowercase search keywords and synonyms separated by spaces, including the words learners used",',
    ' "s": "summary: two plain sentences, 60-300 characters",',
    ' "d": "details: 4-7 sentences, 250-900 characters: how it works, when to use it, the trade-offs",',
    ' "e": "one concrete worked example from a real kind of business, 60-350 characters",',
    ' "c": "one check-yourself question that makes the learner apply the idea, 30-240 characters",',
    ' "i": "interview angle: what interviewers probe and how to answer well, 60-280 characters"},',
    ' "questions": [{"q": "an interview question about this topic",',
    '  "r": ["roles it suits, any of de, da, ds, ar"], "l": "j, m or s: junior, mid-level or senior", "d": ["any, or ecom, fin, log, saas"],',
    '  "tg": ["1-3 lowercase skill tags such as sql, python, spark, statistics"],',
    '  "p": [{"t": "a key point a strong answer makes", "k": ["3-6 lowercase keywords or short phrases a correct answer would literally contain"]}],',
    '  "a": "a model answer of 60-150 words that makes every key point, using those keywords"}]}',
    "Rules:",
    "- Exactly 2 questions, each with 3 to 5 key points.",
    "- Keywords must be specific to their point and include common synonyms. Never use generic words such as data, use, using, good, best, first, then, the.",
    "- A vague answer like 'I would understand the requirements and use best practices' must not contain your keywords.",
    "- Be accurate. If a detail is uncertain or varies by vendor, say so or leave it out. No em dashes.",
    '- If the questions are not about data or data careers, output {"skip": true}.',
  ].join("\n");
}
export function draftMessages(sample, trackHint, previous, errors) {
  const msgs = [
    { role: "system", content: draftPrompt() },
    { role: "user", content: `TRACK MOST LEARNERS WERE ON: ${trackHint || "unknown"}\nQUESTIONS LEARNERS ASKED:\n${sample.map((q) => "- " + q).join("\n")}` },
  ];
  if (previous && errors && errors.length) {
    msgs.push(
      { role: "assistant", content: String(previous).slice(0, 12000) },
      { role: "user", content: `Automatic checks failed:\n${errors.slice(0, 12).map((e) => "- " + e).join("\n")}\nFix every problem. Output only the full corrected JSON object.` },
    );
  }
  return msgs;
}
export function parseJSON(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("The model didn't return JSON.");
  return JSON.parse(t.slice(a, b + 1));
}
const str = (v) => (typeof v === "string" ? v.trim().replace(/\s*—\s*/g, ", ") : "");
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);
export function normalizeDraft(raw) {
  const c = raw && raw.concept ? raw.concept : {};
  const concept = {
    title: str(c.title), t: TRACKS.includes(str(c.t)) ? str(c.t) : "", lv: ["F", "I", "A"].includes(str(c.lv).toUpperCase()) ? str(c.lv).toUpperCase() : "I",
    kw: str(c.kw).toLowerCase(), s: str(c.s), d: str(c.d), e: str(c.e), c: str(c.c), i: str(c.i),
    r: arr(c.r).map(String).filter((x) => /^[a-z0-9-]+$/.test(x)).slice(0, 3),
  };
  const questions = arr(raw && raw.questions).slice(0, 4).map((q) => ({
    q: str(q && q.q),
    r: arr(q && q.r).map((x) => str(x)).filter((x) => TRACKS.includes(x)),
    l: ["j", "m", "s"].includes(str(q && q.l)) ? str(q.l) : "m",
    d: arr(q && q.d).map((x) => str(x)).filter((x) => ["any", "ecom", "fin", "log", "saas"].includes(x)),
    tg: arr(q && q.tg).map((x) => str(x).toLowerCase()).filter(Boolean).slice(0, 4),
    p: arr(q && q.p).map((p) => ({ t: str(p && p.t), k: arr(p && p.k).map((k) => str(k).toLowerCase()).filter(Boolean) })),
    a: str(q && q.a),
  }));
  questions.forEach((q) => { if (!q.r.length && concept.t) q.r = [concept.t]; if (!q.d.length) q.d = ["any"]; });
  return { concept, questions };
}

// The same checks content/validate_batch.js runs on hand-written batches, using the app's own grader.
const GENERIC = new Set(["and", "or", "the", "a", "an", "to", "of", "in", "on", "it", "is", "data", "use", "using", "with", "for", "then", "first", "good", "best"]);
export const VAGUE = [
  "I am not sure about this one, I would build something quickly and discuss it with the team before deciding.",
  "I would first understand the requirements, talk to the users and stakeholders, then pick the right tool and keep the solution simple and maintainable.",
  "This is a common problem. My approach is to analyse it, use best practices, and make sure it performs well at scale with high quality.",
];
export function checkDraft(d) {
  const errors = [], warnings = [];
  const c = d.concept || {};
  if (c.title.length < 3 || c.title.length > 60) errors.push("concept: title must be 3-60 characters");
  if (!TRACKS.includes(c.t)) errors.push("concept: track (t) must be de, da, ds or ar");
  for (const [k, min, max, name] of [["s", 60, 330, "summary"], ["d", 250, 1000, "details"], ["e", 60, 400, "example"], ["c", 30, 260, "check question"], ["i", 60, 300, "interview angle"], ["kw", 30, 260, "keywords"]]) {
    if ((c[k] || "").length < min) errors.push(`concept: ${name} (${k}) is shorter than ${min} characters`);
    else if (c[k].length > max) warnings.push(`concept: ${name} (${k}) is long (${c[k].length} > ${max})`);
  }
  const qs = d.questions || [];
  if (qs.length < 2) errors.push(`needs 2 interview questions, has ${qs.length}`);
  let vh = 0, vt = 0;
  qs.forEach((q, i) => {
    const w = `question ${i + 1}`;
    if (q.q.length < 15) errors.push(`${w}: question text is missing or too short`);
    if (!q.r.length) errors.push(`${w}: needs at least one role`);
    if (!q.tg.length) warnings.push(`${w}: no skill tags`);
    if (q.p.length < 2 || q.p.length > 6) errors.push(`${w}: needs 2-6 key points, has ${q.p.length}`);
    q.p.forEach((p) => {
      if (p.t.length < 8) errors.push(`${w}: key point "${p.t}" is too short`);
      if (p.k.length < 2) errors.push(`${w}: key point "${p.t}" needs at least 2 keywords`);
      p.k.filter((k) => GENERIC.has(k)).forEach((k) => errors.push(`${w}: keyword "${k}" is too generic`));
    });
    if (q.a.length < 120) { errors.push(`${w}: model answer (a) is missing or shorter than 120 characters`); return; }
    if (!q.p.length) return;
    const g = grade(q.a, q);
    if (g.n < q.p.length) errors.push(`${w}: its model answer only covers ${g.n}/${q.p.length} key points (missing: ${g.res.filter((r) => !r.ok).map((r) => r.t).join("; ")})`);
    VAGUE.forEach((v) => { const gv = grade(v, q); vh += gv.n; vt += q.p.length; if (gv.n > 1) errors.push(`${w}: a vague answer scores ${gv.n} points, so the keywords are too loose`); });
  });
  return { ok: !errors.length, errors, warnings, vague: `${vh}/${vt}`, at: now() };
}

async function trackHint(env, clusterId) {
  const r = await env.DB.prepare("SELECT track, COUNT(*) AS n FROM misses WHERE cluster_id = ? AND track IS NOT NULL GROUP BY track ORDER BY n DESC LIMIT 1").bind(clusterId).first();
  return r ? r.track : "";
}
// Draft one group: ask the LLM, check, and if checks fail send the errors back once for a repair.
export async function draftCluster(env, deps, row) {
  const sample = JSON.parse(row.sample || "[]");
  const hint = await trackHint(env, row.id);
  let text = "", draft = null, checks = null, used = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await deps.complete(draftMessages(sample, hint, attempt ? text : null, attempt ? checks.errors : null), env, { maxTokens: 3500 });
    text = out.text; used = `${out.provider} · ${out.model}`;
    let raw;
    try { raw = parseJSON(text); } catch (e) { checks = { ok: false, errors: [e.message], warnings: [], at: now() }; continue; }
    if (raw.skip) {
      await env.DB.prepare("UPDATE clusters SET status = 'rejected', note = ?, updated = ? WHERE id = ?").bind("Skipped by the model: not about data", now(), row.id).run();
      return { id: row.id, skipped: true };
    }
    draft = normalizeDraft(raw);
    checks = checkDraft(draft);
    if (checks.ok) break;
  }
  await env.DB.prepare("UPDATE clusters SET status = 'review', draft = ?, checks = ?, note = ?, updated = ? WHERE id = ?")
    .bind(draft ? JSON.stringify(draft) : null, JSON.stringify(checks), `Drafted by ${used}`, now(), row.id).run();
  return { id: row.id, ok: checks.ok };
}

/* ---------------- nightly job ---------------- */
export async function runJob(env, deps) {
  if (!env.DB) return { off: true };
  const cutoff = now() - cfg(env, "retainDays") * DAY_MS;
  const del = await env.DB.prepare("DELETE FROM misses WHERE created < ?").bind(cutoff).run();
  await env.DB.prepare("DELETE FROM clusters WHERE status = 'open' AND updated < ?").bind(cutoff).run();
  const grouped = await clusterMisses(env);
  const ready = (await env.DB.prepare("SELECT * FROM clusters WHERE status = 'open' AND askers >= ? ORDER BY askers DESC LIMIT ?").bind(cfg(env, "minAskers"), cfg(env, "draftsPerRun")).all()).results || [];
  const drafted = [];
  for (const row of ready) {
    try { drafted.push(await draftCluster(env, deps, row)); }
    catch (e) {
      await env.DB.prepare("UPDATE clusters SET note = ?, updated = ? WHERE id = ?").bind("Drafting failed: " + String(e.message).slice(0, 200), now(), row.id).run();
      drafted.push({ id: row.id, error: e.message });
    }
  }
  return { deleted: del.meta ? del.meta.changes : undefined, ...grouped, drafted };
}

/* ---------------- 4. review ---------------- */
async function authed(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const h = request.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  // Compare digests so the check takes the same time whatever the token.
  return (await sha("t|" + tok)) === (await sha("t|" + env.ADMIN_TOKEN));
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "topic";
const rowOut = (r) => ({
  id: r.id, label: r.label, n: r.n, askers: r.askers, status: r.status, note: r.note, updated: r.updated,
  sample: JSON.parse(r.sample || "[]"), draft: r.draft ? JSON.parse(r.draft) : null, checks: r.checks ? JSON.parse(r.checks) : null,
});
export function cardFrom(row, draft) {
  const id = `cm-${slug(draft.concept.title)}-${row.id}`;
  return {
    id,
    concept: { id, ...draft.concept, mod: "Community picks", cm: 1 },
    questions: draft.questions.map((q) => ({ ...q, c: id })),
    asked: row.askers,
  };
}

async function admin(request, url, env, deps) {
  if (!env.DB) return { status: 503, out: { error: "Layer 2 needs the D1 database (see README)." } };
  if (!env.ADMIN_TOKEN) return { status: 503, out: { error: "Admin is off. Set the ADMIN_TOKEN secret." } };
  if (!(await authed(request, env))) return { status: 401, out: { error: "Wrong or missing admin token." } };
  const path = url.pathname.replace("/api/admin/", "");

  if (path === "queue" && request.method === "GET") {
    const get = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).all()).results || []).map(rowOut);
    const stats = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM misses) AS misses, (SELECT COUNT(*) FROM misses WHERE cluster_id IS NULL) AS pending, (SELECT COUNT(*) FROM published) AS live").first();
    return {
      status: 200,
      out: {
        minAskers: cfg(env, "minAskers"), stats,
        review: await get("SELECT * FROM clusters WHERE status = 'review' ORDER BY askers DESC, updated DESC LIMIT 100"),
        open: await get("SELECT * FROM clusters WHERE status = 'open' ORDER BY askers DESC, n DESC LIMIT 40"),
        live: await get("SELECT * FROM clusters WHERE status = 'live' ORDER BY updated DESC LIMIT 200"),
        rejected: await get("SELECT * FROM clusters WHERE status = 'rejected' ORDER BY updated DESC LIMIT 40"),
      },
    };
  }
  if (path === "run" && request.method === "POST") return { status: 200, out: await runJob(env, deps) };

  if (path === "decide" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return { status: 400, out: { error: "Request body must be JSON." } }; }
    const row = await env.DB.prepare("SELECT * FROM clusters WHERE id = ?").bind(Number(body.id)).first();
    if (!row) return { status: 404, out: { error: "No such group." } };
    const t = now();
    if (body.action === "reject") {
      await env.DB.prepare("DELETE FROM published WHERE cluster_id = ?").bind(row.id).run();
      await env.DB.prepare("UPDATE clusters SET status = 'rejected', note = ?, updated = ? WHERE id = ?").bind(String(body.note || "Rejected in review").slice(0, 200), t, row.id).run();
      communityMemo = null;
      return { status: 200, out: { ok: true, status: "rejected" } };
    }
    if (body.action === "reopen") {
      await env.DB.prepare("UPDATE clusters SET status = 'open', note = 'Reopened', updated = ? WHERE id = ?").bind(t, row.id).run();
      return { status: 200, out: { ok: true, status: "open" } };
    }
    if (body.action === "redraft") {
      const r = await draftCluster(env, deps, row);
      const fresh = await env.DB.prepare("SELECT * FROM clusters WHERE id = ?").bind(row.id).first();
      return { status: 200, out: { ok: true, result: r, group: rowOut(fresh) } };
    }
    if (body.action === "check" || body.action === "approve") {
      const src = body.draft || (row.draft ? JSON.parse(row.draft) : null);
      if (!src) return { status: 400, out: { error: "There's no draft to approve yet. Redraft first." } };
      const draft = normalizeDraft(src);
      const checks = checkDraft(draft);
      await env.DB.prepare("UPDATE clusters SET draft = ?, checks = ?, updated = ? WHERE id = ?").bind(JSON.stringify(draft), JSON.stringify(checks), t, row.id).run();
      if (body.action === "check" || !checks.ok) return { status: checks.ok ? 200 : 422, out: { ok: checks.ok, checks, draft, error: checks.ok ? undefined : "Fix the failed checks before approving." } };
      const card = cardFrom(row, draft);
      await env.DB.prepare("DELETE FROM published WHERE cluster_id = ?").bind(row.id).run();
      await env.DB.prepare("INSERT INTO published (id, cluster_id, card, approved) VALUES (?, ?, ?, ?)").bind(card.id, row.id, JSON.stringify(card), t).run();
      await env.DB.prepare("UPDATE clusters SET status = 'live', note = 'Approved', updated = ? WHERE id = ?").bind(t, row.id).run();
      communityMemo = null;
      return { status: 200, out: { ok: true, status: "live", card } };
    }
    return { status: 400, out: { error: "action must be approve, check, redraft, reject or reopen." } };
  }
  return { status: 404, out: { error: "Not found." } };
}

/* ---------------- 5. publish ---------------- */
let communityMemo = null;
async function community(env) {
  if (!env.DB) return { cards: [], off: true };
  if (communityMemo && now() - communityMemo.at < 60000) return communityMemo.out;
  const rows = (await env.DB.prepare("SELECT card, approved FROM published ORDER BY approved LIMIT 500").all()).results || [];
  const out = { cards: rows.map((r) => ({ ...JSON.parse(r.card), approved: r.approved })), updated: rows.reduce((m, r) => Math.max(m, r.approved), 0) };
  communityMemo = { at: now(), out };
  return out;
}

/* ---------------- router hook ---------------- */
// Returns a Response for layer 2 routes, or null for anything else.
export async function handleCommunity(request, url, env, cors, deps) {
  const p = url.pathname;
  const send = (r, extra) => deps.json(r.out, r.status, { ...cors, ...(extra || {}) });
  if (p === "/api/miss" && request.method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "anon";
    if (deps.rateLimited("miss:" + ip)) return deps.json({ error: "Too many reports." }, 429, cors);
    let body;
    try { body = await request.json(); } catch { return deps.json({ error: "Request body must be JSON." }, 400, cors); }
    try { return send(await recordMiss(body, ip, env, deps)); }
    catch (e) { return deps.json({ error: "Couldn't record: " + e.message }, 500, cors); }
  }
  if (p === "/api/community" && request.method === "GET") {
    try { return send({ status: 200, out: await community(env) }, { "cache-control": "public, max-age=300" }); }
    catch (e) { return deps.json({ cards: [], error: e.message }, 200, cors); }
  }
  if (p.startsWith("/api/admin/")) {
    try { return send(await admin(request, url, env, deps), { "cache-control": "no-store" }); }
    catch (e) { return deps.json({ error: e.message }, 500, cors); }
  }
  return null;
}
