// Layer 2 end to end on the real gateway code: miss → group → draft (with one repair) → review → publish → reject,
// plus privacy masking, admin auth, retention, and a check that the gateway's checks agree with the library.
import { readFileSync } from "node:fs";
import { D1Mock } from "./d1mock.mjs";
import worker from "../worker/src/index.js";
import { maskPII, checkDraft, normalizeDraft, VAGUE } from "../worker/src/community.js";
import { grade } from "../worker/src/grader.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) fails++; };

import { GOOD, fakeVec } from "./l2fixtures.mjs";
const BAD = JSON.parse(JSON.stringify(GOOD));
BAD.questions[1].a = "I would look at the documents and talk to the team about what changed recently, then rebuild things carefully and test the bot again before shipping it to users.";
let calls = 0, sawRepair = false;
async function fakeLLM(url, init) {
  const body = JSON.parse(init.body);
  if (!String(url).includes("chat/completions")) throw new Error("unexpected fetch " + url);
  const sys = body.messages[0].content;
  if (!sys.includes("You write one new entry for Datakul")) throw new Error("not a draft prompt");
  calls++;
  if (body.messages.length > 2) sawRepair = body.messages[3].content.includes("Automatic checks failed");
  const out = body.messages.length > 2 ? GOOD : BAD;
  return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(out) + "\n```" } }] }), { status: 200, headers: { "content-type": "application/json" } });
}
globalThis.fetch = fakeLLM;

/* ---- environment ---- */
const DB = new D1Mock();
await DB.exec(readFileSync(new URL("../worker/migrations/0001_init.sql", import.meta.url), "utf8"));
const env = { GROQ_API_KEY: "k", ADMIN_TOKEN: "s3cret-token", MIN_ASKERS: "10", DB, AI: { run: async (m, i) => ({ data: i.text.map(fakeVec) }) } };
const req = (p, { method = "GET", body, ip = "1.1.1.1", token } = {}) => worker.fetch(new Request("https://gw" + p, {
  method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined,
}), env);
const T = env.ADMIN_TOKEN;
const runCron = async () => { let p; await worker.scheduled({}, env, { waitUntil: (x) => (p = x) }); await p; };

/* ---- privacy ---- */
const m = maskPII("I'm priya.k@gmail.com, call +91 98765 43210, PAN ABCDE1234F, aadhaar 1234 5678 9012, see https://x.com/a?token=abc. How do vector dbs work");
ok(!/priya|98765|ABCDE|5678|token=abc/.test(m) && m.includes("[email]") && m.includes("[number]") && m.includes("[id]"), "PII is masked: " + m);
ok(maskPII("What changed in Spark 3.5 for 2024 pipelines?") === "What changed in Spark 3.5 for 2024 pipelines?", "ordinary numbers are kept");

/* ---- 1. collect ---- */
const vecQs = ["How do vector databases work?", "What is a vector embedding store", "pgvector vs pinecone for similarity search", "how does ANN similarity search work", "explain vector search for RAG",
  "which vector db should I pick", "is pgvector good enough for embeddings", "what is HNSW in vector search", "how do embedding similarity indexes scale", "vector database interview questions", "difference between vector store and normal db for embeddings", "how to keep embeddings fresh in a vector db"];
for (let i = 0; i < vecQs.length; i++) {
  const r = await req("/api/miss", { method: "POST", body: { q: vecQs[i], track: i % 3 ? "ds" : "de" }, ip: "10.0.0." + i });
  if (r.status !== 200) ok(false, "miss accepted " + r.status);
}
ok(true, `recorded ${vecQs.length} vector questions from ${vecQs.length} visitors`);
let r = await req("/api/miss", { method: "POST", body: { q: vecQs[0] }, ip: "10.0.0.0" });
ok((await r.json()).dup === true, "the same question from the same visitor on the same day is counted once");
for (let i = 0; i < 3; i++) await req("/api/miss", { method: "POST", body: { q: ["how to negotiate a data engineer salary offer", "what CTC should I ask for", "salary negotiation tips"][i] }, ip: "20.0.0." + i });
await req("/api/miss", { method: "POST", body: { q: "email me at a@b.co about vector search please" }, ip: "30.0.0.1" });
r = await req("/api/miss", { method: "POST", body: { q: "hi" } });
ok(r.status === 400, "too-short questions are refused");
const stored = (await DB.prepare("SELECT q FROM misses").all()).results.map((x) => x.q);
ok(stored.some((q) => q.includes("[email]")) && !stored.some((q) => q.includes("a@b.co")), "stored rows never hold the raw email");
ok(!(await DB.prepare("SELECT * FROM misses LIMIT 1").first()).ip, "no IP column is stored");

/* ---- admin auth ---- */
ok((await req("/api/admin/queue")).status === 401, "admin queue needs the token");
ok((await req("/api/admin/queue", { token: "wrong" })).status === 401, "wrong token refused");

/* ---- 2 + 3. nightly: group and draft ---- */
await runCron();
let q = await (await req("/api/admin/queue", { token: T })).json();
ok(q.review.length === 1, `one group is ready for review (review ${q.review.length}, open ${q.open.length})`);
const g = q.review[0];
ok(g && g.askers >= 10, `it has ${g && g.askers} different askers`);
ok(q.open.some((x) => x.sample.some((s) => /salary|CTC/i.test(s))), "the small salary group stays open below the threshold");
ok(calls === 2 && sawRepair, "draft failed a check, errors went back to the model, and the repair passed");
ok(g.checks.ok && g.checks.errors.length === 0, "the repaired draft passes every check (vague answers credited " + g.checks.vague + ")");
ok(g.draft.concept.title === "Vector databases", "draft title " + g.draft.concept.title);
ok((await req("/api/community")).ok && (await (await req("/api/community")).json()).cards.length === 0, "nothing is public before approval");

/* ---- 4. review ---- */
const broken = JSON.parse(JSON.stringify(g.draft)); broken.concept.s = "Too short.";
r = await req("/api/admin/decide", { method: "POST", token: T, body: { id: g.id, action: "approve", draft: broken } });
ok(r.status === 422 && (await r.json()).checks.errors.some((e) => e.includes("summary")), "approving an edit that breaks a check is refused");
const edited = JSON.parse(JSON.stringify(g.draft)); edited.concept.r = ["rag", "embeddings", "recommenders"]; edited.concept.title = "Vector databases for RAG";
r = await req("/api/admin/decide", { method: "POST", token: T, body: { id: g.id, action: "approve", draft: edited } });
const ap = await r.json();
ok(r.status === 200 && ap.status === "live", "approve with edits goes live");
ok(ap.card.id.startsWith("cm-vector-databases-for-rag-"), "card id " + ap.card.id);

/* ---- 5. publish ---- */
let com = await (await req("/api/community")).json();
const card = com.cards[0];
ok(com.cards.length === 1 && card.concept.mod === "Community picks" && card.concept.cm === 1, "the approved card is served to every learner");
ok(card.questions.length === 2 && card.questions.every((x) => x.c === card.id), "its two interview questions point at the card");
ok(card.concept.title === "Vector databases for RAG" && card.concept.r.length === 3, "admin edits were kept");
ok(!JSON.stringify(com).includes("10.0.0") && !JSON.stringify(com).includes("asker"), "public feed carries no asker data");

/* ---- reject and reopen ---- */
await req("/api/admin/decide", { method: "POST", token: T, body: { id: g.id, action: "reject" } });
com = await (await req("/api/community")).json();
ok(com.cards.length === 0, "rejecting removes the card from the public feed");
r = await req("/api/admin/decide", { method: "POST", token: T, body: { id: g.id, action: "redraft" } });
const rd = await r.json();
ok(r.status === 200 && rd.group.status === "review", "redraft puts it back in review");

/* ---- retention ---- */
await DB.prepare("INSERT INTO misses (q, track, asker, day, vec, created) VALUES (?, ?, ?, ?, ?, ?)").bind("old question about kubernetes pods", null, "x", "2026-01-01", JSON.stringify(fakeVec("k8s")), Date.now() - 200 * 86400000).run();
await runCron();
ok(!(await DB.prepare("SELECT id FROM misses WHERE q LIKE 'old question%'").first()), "questions older than 180 days are deleted");

/* ---- the gateway's checks agree with the library's own validator ---- */
const lib = readFileSync(new URL("../web/library.js", import.meta.url), "utf8").replace(/^const /gm, "var ");
const L = new Function(lib + "; return { C, Q };")();
let agree = 0, total = 0;
const byC = {};
L.Q.filter((x) => x.a).forEach((x) => (byC[x.c] = byC[x.c] || []).push(x));
for (const [cid, qs] of Object.entries(byC)) {
  if (qs.length < 2) continue;
  const c = L.C.find((x) => x.id === cid);
  const d = normalizeDraft({ concept: c, questions: qs });
  // The oldest concept cards predate the length rules, so compare only what the grader decides: the question checks.
  const qerr = checkDraft(d).errors.filter((e) => e.startsWith("question"));
  total++; if (!qerr.length) agree++; else if (total - agree <= 3) console.log("     disagree", cid, qerr.slice(0, 2));
}
ok(agree === total && total > 50, `library topics with sample answers pass the gateway checks: ${agree}/${total}`);
ok(VAGUE.every((v) => grade(v, { p: [{ t: "x", k: ["hnsw", "ann"] }] }).n === 0), "grader copy loads and scores");

/* ---- "auto" threshold: 3 askers are enough while Datakul is small ---- */
{
  const DB2 = new D1Mock();
  await DB2.exec(readFileSync(new URL("../worker/migrations/0001_init.sql", import.meta.url), "utf8"));
  const env2 = { ...env, DB: DB2, MIN_ASKERS: "auto" };
  calls = 0;
  for (let i = 0; i < 3; i++) await worker.fetch(new Request("https://gw/api/miss", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "40.0.0." + i }, body: JSON.stringify({ q: vecQs[i] }) }), env2);
  let p2; await worker.scheduled({}, env2, { waitUntil: (x) => (p2 = x) }); const r2 = await p2;
  ok(r2.drafted.length === 1, "with MIN_ASKERS=auto, 3 different askers are enough to draft at launch");
  const q2 = await (await worker.fetch(new Request("https://gw/api/admin/queue", { headers: { authorization: "Bearer " + T } }), env2)).json();
  ok(q2.minAskers === 3, "the review page shows the current threshold (" + q2.minAskers + ")");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL LAYER 2 TESTS PASSED");
process.exit(fails ? 1 : 0);
