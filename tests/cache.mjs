// Saved answers: a grounded first question is answered by the AI once, then served from the cache with no AI call.
// Follow-ups, ungrounded questions, personal details, cut-off answers and opted-out learners are never saved.
import { readFileSync } from "node:fs";
import { D1Mock } from "./d1mock.mjs";
import worker from "../worker/src/index.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const DB = new D1Mock();
for (const f of ["0001_init.sql", "0002_usage.sql", "0003_accounts.sql", "0004_cert_questions.sql", "0005_answer_cache.sql"])
  await DB.exec(readFileSync(new URL("../worker/migrations/" + f, import.meta.url), "utf8"));
const enc = new TextEncoder();
let calls = 0, reply = ["**CDC copies only the changes.** ", "It reads the database log.\n\nYour turn: when would you not use CDC?"], finish = "stop";
globalThis.fetch = async () => {
  calls++;
  return new Response(new ReadableStream({ start(c) {
    reply.forEach((p) => c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`)));
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`));
    c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
  } }), { status: 200 });
};
const env = { GROQ_API_KEY: "k", ADMIN_TOKEN: "tok", DB };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const settle = async () => { while (waits.length) await waits.shift(); };
const ref = [{ title: "Change data capture", text: "CDC reads the transaction log and sends inserts, updates and deletes downstream." }];
async function ask(extra) {
  const r = await worker.fetch(new Request("https://gw/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3." + Math.random() },
    body: JSON.stringify({ mode: "tutor", provider: "groq", level: "work", detail: "full", question: "What is CDC?", context: ref, ...extra }) }), env, ctx);
  const text = (await r.text()).split("\n").filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
    .map((l) => { try { return JSON.parse(l.slice(5)).choices[0].delta.content || ""; } catch { return ""; } }).join("");
  await settle();
  return { r, text };
}
const rows = async () => (await DB.prepare("SELECT COUNT(*) AS n FROM answer_cache").first()).n;

// 1. First ask: AI answers and the answer is saved, without the question text.
let a = await ask();
ok(calls === 1 && a.r.headers.get("x-provider") === "groq", "first ask goes to the AI");
ok(await rows() === 1, "the answer is saved");
const saved = await DB.prepare("SELECT * FROM answer_cache").first();
ok(!JSON.stringify(saved).toLowerCase().includes("what is cdc"), "the question text is not stored");

// 2. Same question, different spacing and capitals: served from the cache, no AI call.
a = await ask({ question: "  what is   CDC " });
ok(calls === 1, "repeat question uses no AI call");
ok(a.r.headers.get("x-provider") === "cache" && a.r.headers.get("x-provider-label") === "Groq" && a.r.headers.get("x-model") === "openai/gpt-oss-120b", "saved answer says who wrote it");
ok(a.text === reply.join("").trim(), "saved answer streams back word for word");
ok((await DB.prepare("SELECT hits FROM answer_cache").first()).hits === 1, "hit counted");

// 3. Different level, length or library notes: a different prompt, so a fresh answer.
await ask({ level: "new" });
ok(calls === 2, "a different level gets its own answer");
await ask({ context: [{ ...ref[0], text: ref[0].text + " Edited." }] });
ok(calls === 3, "an edited library card starts fresh");

// 4. Never saved: follow-ups, ungrounded questions, personal details, opted-out learners, cut-off or clarifying replies.
const before = await rows();
await ask({ question: "What is a CDC tool?", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello" }] });
await ask({ question: "What is a CDC log?", context: [] });
await ask({ question: "What is CDC? mail me at a@b.com" });
await ask({ question: "Explain CDC simply", store: false });
finish = "length"; await ask({ question: "Explain CDC in detail" }); finish = "stop";
reply = ["Do you mean CDC in databases or in streaming?"]; await ask({ question: "CDC meaning" });
ok(await rows() === before, "follow-ups, ungrounded, personal, opted-out, cut-off and clarifying replies are not saved");
const c0 = calls; await ask({ question: "Explain CDC simply" });
ok(calls === c0 + 1, "an opted-out learner's answer was not saved");
reply = ["**CDC copies only the changes.** ", "It reads the database log.\n\nYour turn: when would you not use CDC?"];

// 5. Other modes are never cached.
const c1 = calls;
for (let i = 0; i < 2; i++) await worker.fetch(new Request("https://gw/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "feedback", question: "q", answer: "my answer", points: [] }) }), env, ctx);
await settle();
ok(calls === c1 + 2, "interview feedback is never cached");

// 6. Review page: counts, clear, and admin-only.
const adm = (p, m = "GET", tok = "tok") => worker.fetch(new Request("https://gw/api/admin/" + p, { method: m, headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined }), env, ctx);
const st = await (await adm("status")).json();
ok(st.cache && st.cache.today >= 1 && st.cache.entries >= 1, `status shows saved answers (${JSON.stringify(st.cache)})`);
ok(!st.models.some((m) => m.provider === "cache"), "saved answers don't appear as a model");
ok((await adm("cache/clear", "POST", "wrong")).status === 401, "clearing needs the admin token");
const cl = await (await adm("cache/clear", "POST")).json();
ok(cl.cleared >= 1 && await rows() === 0, "clear empties the saved answers");

// 7. Nightly pruning drops answers unused for 30 days.
await ask();
await DB.prepare("UPDATE answer_cache SET created = ?, last_hit = NULL").bind(Date.now() - 31 * 86400000).run();
await worker.scheduled({}, env, ctx); await settle();
ok(await rows() === 0, "answers older than 30 days are pruned nightly");

// 8. Before the migration runs, answers still work.
const bare = new D1Mock(); await bare.exec(readFileSync(new URL("../worker/migrations/0001_init.sql", import.meta.url), "utf8"));
const r = await worker.fetch(new Request("https://gw/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "tutor", question: "What is CDC?", context: ref }) }), { ...env, DB: bare }, ctx);
ok(r.status === 200 && (await r.text()).includes("CDC"), "works before the migration runs");
await settle();

console.log(fails ? `\n${fails} FAILED` : "\nALL CACHE TESTS PASSED");
process.exit(fails ? 1 : 0);
