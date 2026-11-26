// Video quests on the real gateway code: link parsing, the Gemini call (video passed by URL), checks on what comes back,
// drafts the owner publishes, hiding, re-analysing, failures, and the public route.
import { readFileSync, readdirSync } from "node:fs";
import { D1Mock } from "./d1mock.mjs";
import worker from "../worker/src/index.js";
import { videoId, seconds, normalizeVideo } from "../worker/src/video.js";
import { sampleVideo } from "./videofixture.mjs";

let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };

const DB = new D1Mock();
for (const f of readdirSync(new URL("../worker/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) await DB.exec(readFileSync(new URL("../worker/migrations/" + f, import.meta.url), "utf8"));
const env = { GEMINI_API_KEY: "g", ADMIN_TOKEN: "tok", DB };
const T = "tok";
const req = (p, { method = "GET", body, token, headers = {} } = {}) => worker.fetch(new Request("https://gw" + p, {
  method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
}), env);

/* fake Gemini */
let calls = [], reply = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(sampleVideo()) }] } }], usageMetadata: { promptTokenCount: 90000, candidatesTokenCount: 3000 } } });
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init, body: JSON.parse(init.body) });
  const r = reply();
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
};

/* ---- links ---- */
const ID = "dQw4w9WgXcQ";
for (const u of [`https://www.youtube.com/watch?v=${ID}&t=42s`, `https://youtu.be/${ID}?si=x`, `youtube.com/shorts/${ID}`, `https://m.youtube.com/watch?v=${ID}`, `https://www.youtube.com/live/${ID}`, `https://www.youtube.com/embed/${ID}`, ID])
  ok(videoId(u) === ID, "reads the id from " + u);
for (const u of ["https://vimeo.com/123", "https://www.youtube.com/watch?v=short", "not a link", "", `https://evil.com/watch?v=${ID}`])
  ok(videoId(u) === "", "refuses " + (u || "(empty)"));
ok(seconds("1:02:03") === 3723 && seconds("12:30") === 750 && seconds(95) === 95 && seconds("x") === null, "timestamps become seconds");

/* ---- checks on Gemini's answer ---- */
let n = normalizeVideo(sampleVideo(), ID);
ok(n.video.chapters.length === 3 && n.dropped === 0, "a good answer keeps every part");
const bad = sampleVideo(); bad.chapters[1].quiz[0].opts = ["a", "b"]; bad.chapters[1].quiz[1].ans = 7; bad.chapters[2].start = "0:10";
n = normalizeVideo(bad, ID);
ok(n.video.chapters.length === 2 && n.dropped >= 3, `broken questions and a part that goes back in time are dropped (${n.video.chapters.length} parts, ${n.dropped} dropped)`);
let threw = false; try { const b2 = sampleVideo(); b2.chapters = b2.chapters.slice(0, 1); normalizeVideo(b2, ID); } catch { threw = true; }
ok(threw, "fewer than two usable parts is an error, not a quest");

/* ---- before anything exists ---- */
let r = await req("/api/videos");
ok(r.ok && (await r.json()).videos.length === 0, "no videos are served before the owner adds one");
ok((await req("/api/admin/videos")).status === 401, "the owner screen needs the token");
ok((await req("/api/admin/videos", { method: "POST", body: { url: ID } })).status === 401, "analysing needs the token");

/* ---- analyse ---- */
r = await req("/api/admin/videos", { method: "POST", token: T, body: { url: `https://youtu.be/${ID}`, note: "Databricks Auto Loader basics" } });
let j = await r.json();
ok(r.status === 200 && j.state === "draft" && j.chapters === 3, "a new video is analysed into a draft");
const c0 = calls[0];
ok(c0.url.includes(":generateContent") && c0.init.headers["x-goog-api-key"] === "g" && !c0.url.includes("key="), "Gemini is called with the key in a header, not the address");
ok(c0.body.contents[0].parts[0].file_data.file_uri === `https://www.youtube.com/watch?v=${ID}`, "the video goes to Gemini by its YouTube address (no captions needed)");
ok(c0.body.generationConfig.responseMimeType === "application/json" && c0.body.generationConfig.mediaResolution === "MEDIA_RESOLUTION_LOW", "asks for JSON at low video resolution");
ok(c0.body.contents[0].parts[1].text.includes("Databricks Auto Loader basics"), "the owner's note reaches the prompt");
const u = await DB.prepare("SELECT * FROM usage WHERE mode = 'video'").first();
ok(u && u.provider === "gemini" && u.tin === 90000 && u.tout === 3000 && u.ok === 1, "the call shows on the AI status tab (tokens, never the text)");
ok((await (await req("/api/videos")).json()).videos.length === 0, "a draft is not shown to learners");

let a = await (await req("/api/admin/videos", { token: T })).json();
ok(a.gemini === true && a.videos.length === 1 && a.videos[0].status === "draft" && a.videos[0].video.chapters[0].quiz.length === 2, "the owner sees the draft with its parts and questions");

/* ---- publish ---- */
r = await req("/api/admin/videos/status", { method: "POST", token: T, body: { id: ID, status: "live" } });
ok(r.ok, "the owner publishes it");
r = await req("/api/videos"); j = await r.json();
const etag = r.headers.get("etag");
ok(j.videos.length === 1 && j.videos[0].id === ID && j.videos[0].chapters.length === 3 && j.videos[0].chapters[0].start === 0, "learners get the published quest");
ok(!/"model"|"err"|gemini/i.test(JSON.stringify(j)), "no model details reach learners");
r = await req("/api/videos", { headers: { "if-none-match": etag } });
ok(r.status === 304, "'anything new?' with an unchanged list is a tiny 304");

/* ---- re-analysing a live video keeps it live; a failure keeps the last good one ---- */
calls = [];
r = await req("/api/admin/videos", { method: "POST", token: T, body: { url: ID } });
ok((await r.json()).state === "live", "re-analysing a live video keeps it live");
reply = () => ({ status: 400, body: { error: { message: "The video is private or unlisted." } } });
r = await req("/api/admin/videos", { method: "POST", token: T, body: { url: ID } });
j = await r.json();
ok(r.status === 502 && /Only public videos work/.test(j.error), "a private video gives a clear message");
a = await (await req("/api/admin/videos", { token: T })).json();
ok(a.videos[0].status === "live" && a.videos[0].video && a.videos[0].err, "a failed re-analysis keeps the published version and notes the error");
ok((await (await req("/api/videos")).json()).videos.length === 1, "learners still see it");

/* ---- failures for a new video ---- */
reply = () => ({ status: 429, body: { error: { message: "Resource exhausted" } } });
r = await req("/api/admin/videos", { method: "POST", token: T, body: { url: "https://youtu.be/abcdefghijk" } });
ok(r.status === 502 && /allowance/.test((await r.json()).error), "an empty free allowance says so");
reply = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: "Sorry, I can't" }] } }] } });
r = await req("/api/admin/videos", { method: "POST", token: T, body: { url: "https://youtu.be/bbcdefghijk" } });
ok(r.status === 502, "a reply that isn't JSON is a failure");
a = await (await req("/api/admin/videos", { token: T })).json();
ok(a.videos.filter((v) => v.status === "failed").length === 2, "failed new videos are listed so the owner can retry");
ok((await req("/api/admin/videos/status", { method: "POST", token: T, body: { id: "abcdefghijk", status: "live" } })).status === 400, "a failed video can't be published");
ok((await req("/api/admin/videos", { method: "POST", token: T, body: { url: "https://vimeo.com/1" } })).status === 400, "a non-YouTube link is refused before calling Gemini");
const before = calls.length;
await req("/api/admin/videos", { method: "POST", token: T, body: { url: "nope" } });
ok(calls.length === before, "nothing is sent to Gemini for a bad link");

/* ---- hide and delete ---- */
await req("/api/admin/videos/status", { method: "POST", token: T, body: { id: ID, status: "hidden" } });
ok((await (await req("/api/videos")).json()).videos.length === 0, "hiding takes it out of every learner's app");
await req("/api/admin/videos/delete", { method: "POST", token: T, body: { id: ID } });
a = await (await req("/api/admin/videos", { token: T })).json();
ok(!a.videos.some((v) => v.id === ID), "delete removes it");

/* ---- no key ---- */
const env2 = { ...env, GEMINI_API_KEY: undefined };
r = await worker.fetch(new Request("https://gw/api/admin/videos", { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: JSON.stringify({ url: ID }) }), env2);
ok(r.status === 503 && /GEMINI_API_KEY/.test((await r.json()).error), "without a Gemini key the owner is told what to set");

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
