// AI service status: every AI call is logged (never the text), fallbacks and busy providers are counted, rate-limit
// headers are kept, the Status endpoint is admin-only, and "Check now" pings one model.
import { readFileSync } from "node:fs";
import { D1Mock } from "./d1mock.mjs";
import worker from "../worker/src/index.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const DB = new D1Mock();
for (const f of ["0001_init.sql", "0002_usage.sql"]) await DB.exec(readFileSync(new URL("../worker/migrations/" + f, import.meta.url), "utf8"));
const enc = new TextEncoder();
const sse = (parts, usage) => new ReadableStream({ start(c) {
  parts.forEach((p) => c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`)));
  if (usage) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [], x_groq: { usage } })}\n\n`));
  c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
} });
let groqBusy = false;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (groqBusy) return new Response('{"error":"rate limited"}', { status: 429, headers: { "x-ratelimit-remaining-requests": "0" } });
  if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 12, completion_tokens: 2 } }), { status: 200, headers: { "x-ratelimit-remaining-requests": "990" } });
  return new Response(sse(["Change data ", "capture reads the log."], { prompt_tokens: 420, completion_tokens: 31 }), { status: 200, headers: { "x-ratelimit-remaining-requests": "998", "x-ratelimit-remaining-tokens": "7400" } });
};
const AI = { run: async (m, i) => i.text ? { data: i.text.map(() => [0.1, 0.2]) } : i.stream
  ? new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"response":"Llama answer here"}\n\n')); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } })
  : { response: "OK" } };
const env = { GROQ_API_KEY: "k", ADMIN_TOKEN: "tok", DB, AI };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const settle = async () => { while (waits.length) await waits.shift(); };
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await worker.fetch(new Request("https://gw" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return r;
};
const drain = async (r) => { const t = await r.text(); await settle(); return t; };

// 1. a normal answer from Groq
await drain(await call("/api/chat", { method: "POST", body: { mode: "tutor", provider: "groq", question: "what is change data capture, my email is a@b.co" } }));
let rows = (await DB.prepare("SELECT * FROM usage").all()).results;
ok(rows.length === 1 && rows[0].provider === "groq" && rows[0].ok === 1 && rows[0].mode === "tutor", "an answer is logged as one row");
ok(rows[0].tout === 31 && rows[0].tin === 420 && rows[0].reported === 1, "token counts come from the provider when it reports them");
ok(rows[0].rl_req === 998 && rows[0].rl_tok === 7400, "Groq's remaining requests and tokens are kept");
ok(!JSON.stringify(rows).includes("change data") && !JSON.stringify(rows).includes("a@b.co"), "no question or answer text is stored");

// 2. Groq busy: falls back to Llama, both logged
groqBusy = true;
const t = await drain(await call("/api/chat", { method: "POST", body: { mode: "feedback", provider: "groq", answer: "my answer" } }));
groqBusy = false;
rows = (await DB.prepare("SELECT * FROM usage ORDER BY id").all()).results;
ok(t.includes("Llama answer"), "the learner still gets an answer from the next provider");
ok(rows[1].ok === 0 && rows[1].status === 429 && rows[2].provider === "llama" && rows[2].fallback === 1 && rows[2].reported === 0 && rows[2].tout > 0, "the busy provider and the fallback are both logged, with estimated tokens");

// 3. embeddings
await call("/api/embed", { method: "POST", body: { texts: ["a", "b"] } }); await settle();
ok((await DB.prepare("SELECT COUNT(*) AS n FROM usage WHERE mode = 'embed'").first()).n === 1, "embedding calls are logged");

// 4. the Status endpoint
ok((await call("/api/admin/status")).status === 401, "Status needs the admin token");
const s = await (await call("/api/admin/status", { token: "tok" })).json();
const g = s.models.find((m) => m.provider === "groq" && m.model === "openai/gpt-oss-120b");
ok(s.totals.n === 4 && s.totals.busy === 1 && s.totals.fallbacks === 1, `totals today: ${s.totals.n} calls, ${s.totals.busy} busy, ${s.totals.fallbacks} fallback`);
ok(g && g.n === 2 && g.health.level === "down" && /429/.test(g.health.why), "Groq shows as down after its last call was refused: " + (g && g.health.why));
ok(g.limit && g.limit.req === 1000 && g.remaining && g.remaining.req === 0, "the free daily limit and remaining requests are shown");
ok(s.models.some((m) => m.model === "openai/gpt-oss-20b" && m.health.level === "idle"), "every configured model is listed, even unused ones");
ok(s.modes.some((m) => m.mode === "feedback"), "calls are broken down by feature");
ok(s.week.length === 1 && s.week[0].n === 4, "the last 7 days are summarised");

// 5. Check now
const p1 = await (await call("/api/admin/ping", { method: "POST", token: "tok", body: { provider: "groq", model: "openai/gpt-oss-120b" } })).json();
ok(p1.ok && p1.reply === "OK" && typeof p1.ms === "number", "Check now pings one model and times it");
const s2 = await (await call("/api/admin/status", { token: "tok" })).json();
ok(s2.models.find((m) => m.model === "openai/gpt-oss-120b").health.level !== "down", "a successful check clears the down state (amber while today's failure rate is high)");
const p2 = await (await call("/api/admin/ping", { method: "POST", token: "tok", body: { provider: "groq", model: "nope" } })).json();
ok(!p2.ok, "unknown models are refused");

// 6. the nightly job records itself and prunes old rows
await DB.prepare("INSERT INTO usage (day, ts, provider, model, mode, ok) VALUES ('2026-01-01', ?, 'groq', 'x', 'tutor', 1)").bind(Date.now() - 120 * 86400000).run();
let pj; await worker.scheduled({}, env, { waitUntil: (x) => (pj = x) }); await pj;
const s3 = await (await call("/api/admin/status", { token: "tok" })).json();
ok(s3.lastJob && s3.lastJob.at, "the last nightly run is shown");
ok(!(await DB.prepare("SELECT id FROM usage WHERE day = '2026-01-01'").first()), "usage rows older than 90 days are deleted");

// 7. no database: answers still work
const env2 = { GROQ_API_KEY: "k", AI };
const r2 = await worker.fetch(new Request("https://gw/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "hi there" }) }), env2, ctx);
ok(r2.status === 200 && (await drain(r2)).includes("capture"), "without the database, answers still stream normally");

console.log(fails ? `\n${fails} FAILED` : "\nALL STATUS TESTS PASSED");
process.exit(fails ? 1 : 0);
