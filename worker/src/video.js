/* Video quests: the owner pastes a public YouTube link on the review page, Gemini watches it once (the video is passed
   to Gemini by its URL, so no captions or downloads are needed) and returns chapters with key points and a short quiz.
   The result is saved in D1 as a draft; the owner checks it and publishes it. Learners read published videos from
   /api/videos, so every learner reuses the one analysis and no AI allowance is spent per learner.
   Only public videos work (Gemini can't open private or unlisted ones). Free tier: about 8 hours of video a day. */
import { logUsage } from "./usage.js";
import { authed } from "./community.js";

const now = () => Date.now();
let memo = null; // the served list is kept for a minute; publishing or hiding clears it
const MAX_LIVE = 200;
const DEFAULT_MODEL = "gemini-flash-latest";
const TRACKS = ["de", "da", "ds", "arch"];
const LEVELS = ["new", "work", "interview"];
const str = (v, n) => (typeof v === "string" ? v.trim().replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").slice(0, n) : "");
const arr = (v) => (Array.isArray(v) ? v : []);

/* ---- links ---- */
// Accepts watch, youtu.be, shorts, live and embed links, or a bare 11-character id. Returns the id or "".
export function videoId(input) {
  const s = String(input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u; try { u = new URL(s.startsWith("http") ? s : "https://" + s); } catch { return ""; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else { const m = /^\/(shorts|live|embed|v)\/([^/?#]+)/.exec(u.pathname); if (m) id = m[2]; }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}
export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/* ---- the prompt ---- */
export function analysePrompt(hint) {
  return [
    "You turn a technical YouTube video into a learning quest for Datakul, an app for data engineering, analysis, science and architecture careers.",
    "Watch the whole video. Split it into its logical parts in the order they happen (3 to 10 parts; merge tiny parts, skip intros, sponsor reads and outros).",
    "Output ONLY JSON, no prose, no code fence, in this shape:",
    `{"title": "the video's title", "channel": "the channel or speaker", "minutes": length in whole minutes,
"track": "de" (data engineering) | "da" (analysis) | "ds" (science or ML) | "arch" (architecture),
"level": "new" | "work" | "interview", "topic": "1-3 words", "summary": "1-2 plain sentences: what a learner gets from it",
"chapters": [{"title": "short title", "start": "MM:SS or H:MM:SS where this part starts", "summary": "2-3 plain sentences",
  "points": ["2-4 key points, each one short sentence"],
  "quiz": [{"q": "question", "opts": ["option", "option", "option", "option"], "ans": index of the correct option, "why": "1-2 sentences"}]}],
"takeaways": ["3-5 things to remember from the whole video"]}`,
    "Rules:",
    "- Each chapter has 2 quiz questions, answerable from that part of the video. 4 options, exactly one correct, plausible wrong options, vary where the answer sits. No 'all/none of the above'.",
    "- Use only what the video says. If the speaker states something outdated or wrong, say so in the point instead of repeating it as fact.",
    "- Plain language, no hype, no em dashes. Timestamps must be real positions in this video.",
    hint ? `- The owner's note about this video: ${str(hint, 300)}` : "",
  ].filter(Boolean).join("\n");
}
export function parseObject(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("Gemini didn't return JSON.");
  return JSON.parse(t.slice(a, b + 1));
}

/* ---- checking what came back ---- */
export function seconds(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return Math.max(0, Math.round(ts));
  const p = String(ts || "").trim().split(":").map(Number);
  if (!p.length || p.length > 3 || p.some((x) => !Number.isFinite(x) || x < 0)) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}
function quizItem(raw) {
  const opts = arr(raw && raw.opts).map((o) => str(o, 200)).filter(Boolean);
  const ans = Number(Array.isArray(raw && raw.ans) ? raw.ans[0] : raw && raw.ans);
  const q = { q: str(raw && raw.q, 400), opts, ans, why: str(raw && raw.why, 500) };
  const ok = q.q.length >= 12 && opts.length === 4 && new Set(opts.map((o) => o.toLowerCase())).size === 4 &&
    Number.isInteger(ans) && ans >= 0 && ans < 4 && !opts.some((o) => /^(all|none) of the/i.test(o)) && q.why.length >= 20;
  return ok ? q : null;
}
// Returns { video, dropped } or throws when too little is usable.
export function normalizeVideo(raw, id) {
  if (!raw || typeof raw !== "object") throw new Error("Gemini's answer wasn't an object.");
  let dropped = 0, last = -1;
  const chapters = [];
  for (const c of arr(raw.chapters).slice(0, 12)) {
    const start = seconds(c && c.start), title = str(c && c.title, 120), summary = str(c && c.summary, 700);
    const points = arr(c && c.points).map((p) => str(p, 260)).filter(Boolean).slice(0, 5);
    const quiz = arr(c && c.quiz).map(quizItem);
    dropped += quiz.filter((q) => !q).length;
    const good = quiz.filter(Boolean).slice(0, 3);
    if (!title || start == null || start < last || !summary || !points.length || !good.length) { dropped++; continue; }
    last = start;
    chapters.push({ title, start, summary, points, quiz: good });
  }
  if (chapters.length < 2) throw new Error("Not enough usable parts came back (" + chapters.length + "). Try again, or try another video.");
  const v = {
    id, url: watchUrl(id),
    title: str(raw.title, 200) || "Untitled video", channel: str(raw.channel, 120), minutes: Math.max(1, Math.round(Number(raw.minutes) || 0)) || null,
    track: TRACKS.includes(raw.track) ? raw.track : "de", level: LEVELS.includes(raw.level) ? raw.level : "work",
    topic: str(raw.topic, 40), summary: str(raw.summary, 400),
    chapters, takeaways: arr(raw.takeaways).map((t) => str(t, 260)).filter(Boolean).slice(0, 6),
  };
  return { video: v, dropped };
}

/* ---- calling Gemini ---- */
async function callGemini(env, url, hint) {
  const model = env.VIDEO_MODEL || DEFAULT_MODEL, t0 = now();
  const rec = { provider: "gemini", model, mode: "video" };
  let r, j;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ file_data: { file_uri: url } }, { text: analysePrompt(hint) }] }],
        // Low video resolution: lessons are mostly speech and slides, and this uses about a third of the tokens.
        generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 12000, mediaResolution: "MEDIA_RESOLUTION_LOW" },
      }),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    await logUsage(env, { ...rec, ok: false, ms: now() - t0, err: e.message });
    throw new Error("Couldn't reach Gemini: " + e.message);
  }
  const u = j.usageMetadata || {};
  const done = { ...rec, status: r.status, ms: now() - t0, tin: u.promptTokenCount || 0, tout: u.candidatesTokenCount || 0, reported: !!u.candidatesTokenCount };
  if (!r.ok) {
    const m = (j.error && j.error.message) || `HTTP ${r.status}`;
    await logUsage(env, { ...done, ok: false, err: m });
    if (r.status === 429) throw new Error("Gemini's free allowance is used up for now (about 8 hours of video a day). Try again later.");
    if (/private|unlisted|not (be )?accessible|permission|not found/i.test(m)) throw new Error("Gemini couldn't open this video. Only public videos work. (" + m.slice(0, 120) + ")");
    throw new Error("Gemini: " + m.slice(0, 200));
  }
  const cand = j.candidates && j.candidates[0];
  const text = cand ? arr(cand.content && cand.content.parts).filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("") : "";
  await logUsage(env, { ...done, ok: !!text, err: text ? null : "empty reply" });
  if (!text) throw new Error(j.promptFeedback && j.promptFeedback.blockReason ? `Gemini declined this video (${j.promptFeedback.blockReason}).` : "Gemini returned nothing.");
  return { text, model };
}

/* ---- owner actions ---- */
export async function analyse(env, input, hint) {
  const id = videoId(input);
  if (!id) return { status: 400, out: { error: "That isn't a YouTube link I recognise." } };
  if (!env.GEMINI_API_KEY) return { status: 503, out: { error: "Set the GEMINI_API_KEY secret on the gateway first." } };
  const t = now(), url = watchUrl(id);
  const prev = await env.DB.prepare("SELECT status FROM video WHERE id = ?").bind(id).first();
  try {
    const g = await callGemini(env, url, hint);
    const { video, dropped } = normalizeVideo(parseObject(g.text), id);
    // A video that was already live stays live with the fresh analysis; anything else waits for the owner.
    const status = prev && prev.status === "live" ? "live" : "draft";
    await env.DB.prepare("INSERT INTO video (id, url, status, data, model, err, created, updated) VALUES (?, ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, model = excluded.model, err = NULL, updated = excluded.updated")
      .bind(id, url, status, JSON.stringify(video), g.model, t, t).run();
    memo = null;
    return { status: 200, out: { ok: true, id, state: status, chapters: video.chapters.length, dropped } };
  } catch (e) {
    const msg = String(e.message).slice(0, 300);
    if (!prev || prev.status === "failed") {
      await env.DB.prepare("INSERT INTO video (id, url, status, err, created, updated) VALUES (?, ?, 'failed', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = 'failed', err = excluded.err, updated = excluded.updated")
        .bind(id, url, msg, t, t).run();
    } else {
      await env.DB.prepare("UPDATE video SET err = ?, updated = ? WHERE id = ?").bind(msg, t, id).run(); // keep the last good analysis
    }
    return { status: 502, out: { error: msg } };
  }
}
export async function setStatus(env, id, status) {
  if (!["live", "hidden", "draft"].includes(status)) return { status: 400, out: { error: "Unknown status." } };
  const row = await env.DB.prepare("SELECT data FROM video WHERE id = ?").bind(String(id)).first();
  if (!row) return { status: 404, out: { error: "No such video." } };
  if (status === "live" && !row.data) return { status: 400, out: { error: "This video has no analysis to publish." } };
  await env.DB.prepare("UPDATE video SET status = ?, updated = ? WHERE id = ?").bind(status, now(), String(id)).run();
  memo = null;
  return { status: 200, out: { ok: true } };
}
export async function remove(env, id) {
  const r = await env.DB.prepare("DELETE FROM video WHERE id = ?").bind(String(id)).run();
  memo = null;
  return { status: 200, out: { ok: !!(r.meta && r.meta.changes) } };
}
export async function adminList(env) {
  const rows = (await env.DB.prepare("SELECT id, url, status, data, model, err, created, updated FROM video ORDER BY updated DESC LIMIT 300").all()).results || [];
  return { gemini: !!env.GEMINI_API_KEY, videos: rows.map((r) => ({ id: r.id, url: r.url, status: r.status, model: r.model, err: r.err, created: r.created, updated: r.updated, video: r.data ? JSON.parse(r.data) : null })) };
}

/* ---- served to the app ---- */
export async function publicVideos(env) {
  if (!env.DB) return { videos: [], off: true };
  if (memo && now() - memo.at < 60000) return memo.out;
  const rows = (await env.DB.prepare("SELECT data, updated FROM video WHERE status = 'live' AND data IS NOT NULL ORDER BY created DESC LIMIT ?").bind(MAX_LIVE).all()).results || [];
  const out = { videos: rows.map((r) => ({ ...JSON.parse(r.data), n: r.updated })), updated: rows.reduce((m, r) => Math.max(m, r.updated), 0) };
  out.etag = `"v${out.updated}-${rows.length}"`;
  memo = { at: now(), out };
  return out;
}
export const clearMemo = () => { memo = null; };

/* ---- routes ---- */
export async function handleVideos(request, url, env, cors, deps) {
  const p = url.pathname;
  if (p === "/api/videos" && request.method === "GET") {
    try {
      const out = await publicVideos(env), etag = out.etag;
      if (etag && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...cors, etag, "cache-control": "no-cache" } });
      const { etag: _e, ...body } = out;
      return deps.json(body, 200, { ...cors, "cache-control": "no-cache", ...(etag ? { etag } : {}) });
    } catch (e) { return deps.json({ videos: [], error: e.message }, 200, cors); }
  }
  if (!p.startsWith("/api/admin/videos")) return null;
  const send = (r) => deps.json(r.out, r.status, { ...cors, "cache-control": "no-store" });
  if (!env.DB) return send({ status: 503, out: { error: "Video quests need the D1 database." } });
  if (!env.ADMIN_TOKEN) return send({ status: 503, out: { error: "Admin is off. Set the ADMIN_TOKEN secret." } });
  if (!(await authed(request, env))) return send({ status: 401, out: { error: "Wrong or missing admin token." } });
  const path = p.replace("/api/admin/videos", "");
  try {
    if (path === "" && request.method === "GET") return send({ status: 200, out: await adminList(env) });
    let body = {};
    try { body = await request.json(); } catch { return send({ status: 400, out: { error: "Request body must be JSON." } }); }
    if (path === "" && request.method === "POST") return send(await analyse(env, body.url, body.note));
    if (path === "/status" && request.method === "POST") return send(await setStatus(env, body.id, body.status));
    if (path === "/delete" && request.method === "POST") return send(await remove(env, body.id));
    return send({ status: 404, out: { error: "Not found." } });
  } catch (e) { return send({ status: 500, out: { error: e.message } }); }
}
