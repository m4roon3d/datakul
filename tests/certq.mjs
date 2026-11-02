// Daily certification questions on the real gateway code: nightly write, automatic checks (format, duplicates,
// blind second answer), publishing without a deploy, owner pause and per-section count, withdraw, and the public route.
import { readFileSync } from "node:fs";
import { D1Mock } from "./d1mock.mjs";
import worker from "../worker/src/index.js";
import { checkQuestion, normalize } from "../worker/src/certq.js";
import { CERT_META } from "../worker/src/certs-meta.js";
import { fakeVec } from "./l2fixtures.mjs";

let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };

const DB = new D1Mock();
for (const f of ["0001_init.sql", "0002_usage.sql", "0003_accounts.sql", "0004_cert_questions.sql"]) await DB.exec(readFileSync(new URL("../worker/migrations/" + f, import.meta.url), "utf8"));
const env = { GROQ_API_KEY: "k", ADMIN_TOKEN: "tok", DB, AI: { run: async (m, i) => ({ data: i.text.map(fakeVec) }) } };
const T = "tok";
const req = (p, { method = "GET", body, token } = {}) => worker.fetch(new Request("https://gw" + p, {
  method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined,
}), env);
const runCron = async () => { let p; await worker.scheduled({}, env, { waitUntil: (x) => (p = x) }); await p; };

/* a fake model: writes questions for whatever section it is asked about; the checker disagrees with some */
let writes = 0, checks = 0, perAsk = [], disagree = new Set(), serial = 0, breakWriter = false;
const rnd = () => Array.from({ length: 7 }, () => Math.random().toString(36).slice(2, 9)).join(" ");
const mkQ = (sec, i) => ({
  q: `In ${sec}, which statement about ${rnd()} is correct for a production pipeline?`,
  opts: [`Option A ${++serial} first`, `Option B ${serial} second`, `Option C ${serial} third`, `Option D ${serial} fourth`], ans: [serial % 4],
  why: "This is correct because the platform applies it that way by design. The other options describe behaviour that does not exist or applies to something else.",
});
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body), sys = body.messages[0].content;
  let content;
  if (sys.startsWith("You write original practice questions")) {
    writes++;
    if (breakWriter) return new Response("nope", { status: 500 });
    const sec = /section "([^"]+)"/.exec(sys)[1], n = +/Exactly (\d+) questions/.exec(sys)[1];
    perAsk.push(n);
    content = "```json\n" + JSON.stringify(Array.from({ length: n }, (_, i) => mkQ(sec, i))) + "\n```";
    lastWritten = JSON.parse(content.replace(/```json\n|\n```/g, ""));
  } else if (sys.includes("Answer each question below")) {
    checks++;
    const qs = body.messages[1].content.split(/\n\n/).length;
    content = JSON.stringify(Array.from({ length: qs }, (_, i) => ({ i, pick: disagree.has(checks + ":" + i) ? [(lastWritten[i].ans[0] + 1) % 4] : lastWritten[i].ans, ok: true, issue: "" })));
  } else throw new Error("unexpected prompt");
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
};
let lastWritten = [];

/* ---- format checks ---- */
const good = normalize(mkQ("platform", 0), "platform");
ok(checkQuestion(good).length === 0, "a well-formed question passes");
ok(checkQuestion({ ...good, opts: good.opts.slice(0, 3) }).length > 0, "3 options are refused");
ok(checkQuestion({ ...good, opts: [good.opts[0], good.opts[0], good.opts[2], good.opts[3]] }).length > 0, "duplicate options are refused");
ok(checkQuestion({ ...good, ans: [9] }).length > 0, "an answer index out of range is refused");
ok(checkQuestion({ ...good, ans: [0, 1] }).length > 0, "two answers without '(Choose two.)' are refused");
ok(checkQuestion({ ...good, ans: [0, 1], q: good.q + " (Choose two.)" }).length === 0, "two answers with '(Choose two.)' pass");
ok(checkQuestion({ ...good, why: "Too short." }).length > 0, "a short explanation is refused");
ok(checkQuestion({ ...good, opts: [...good.opts.slice(0, 3), "All of the above"] }).length > 0, "'all of the above' is refused");

/* ---- public route before anything exists ---- */
let r = await req("/api/certq?cert=dbx-dea");
ok(r.ok && (await r.json()).questions.length === 0, "nothing is served before the first night");
ok((await req("/api/admin/certq")).status === 401, "the owner screen needs the token");

/* ---- first night ---- */
disagree = new Set(["1:0", "3:2"]); // the checker disagrees with a question in the 1st and 3rd section
await runCron();
const sections = CERT_META[0].domains.length;
ok(writes === sections && checks === sections, `one write and one blind check per section (${writes}/${checks} for ${sections} sections)`);
ok(perAsk.every((n) => n === 5), "5 per section by default");
let ov = await (await req("/api/admin/certq", { token: T })).json();
const added = ov.certs[0].domains.reduce((a, d) => a + d.live, 0);
ok(added === sections * 5 - 2, `questions the checker disagreed with are dropped (${added} live of ${sections * 5})`);
ok(ov.last && ov.last.added === added, "the last run is recorded");
r = await (await req("/api/certq?cert=dbx-dea")).json();
ok(r.questions.length === added && r.questions.every((q) => q.id.startsWith("dbx-dea-n-") && q.opts.length === 4 && q.why && q.n), "the app route serves them with the same shape as the built-in bank");
ok(!/"model"|"provider"/.test(JSON.stringify(r)), "no model details reach learners");
ok((await (await req("/api/certq?cert=nope")).json()).questions.length === 0, "an unknown exam returns nothing");

/* ---- 'anything new?' is cheap ---- */
r = await req("/api/certq?cert=dbx-dea");
const tag = r.headers.get("etag");
ok(!!tag && r.headers.get("cache-control") === "no-cache", "the list carries an ETag and must be revalidated");
const r304 = await worker.fetch(new Request("https://gw/api/certq?cert=dbx-dea", { headers: { "if-none-match": tag } }), env);
ok(r304.status === 304, "asking again with the ETag gets an empty 304");

/* ---- owner controls: count per section, pause, resume ---- */
let s = await (await req("/api/admin/certq", { method: "POST", token: T, body: { perSection: 3 } })).json();
ok(s.perSection === 3 && s.on === true, "the owner sets 3 per section");
s = await (await req("/api/admin/certq", { method: "POST", token: T, body: { perSection: 99 } })).json();
ok(s.perSection === 10, "the number is capped at 10");
await req("/api/admin/certq", { method: "POST", token: T, body: { perSection: 3 } });
const before = writes;
await req("/api/admin/certq", { method: "POST", token: T, body: { on: false } });
await runCron();
ok(writes === before, "paused: the nightly run writes nothing");
await req("/api/admin/certq", { method: "POST", token: T, body: { on: true } });
perAsk = []; disagree = new Set();
await runCron();
ok(perAsk.length === sections && perAsk.every((n) => n === 3), "resumed with 3 per section");
const total = (await (await req("/api/certq?cert=dbx-dea")).json()).questions.length;
ok(total === added + sections * 3, `new questions are added to the old ones (${total})`);

/* ---- withdraw and restore ---- */
await new Promise((res) => setTimeout(res, 61000 * 0)); // the route memo lasts 60 s; withdraw clears it
const pick = (await (await req("/api/certq?cert=dbx-dea")).json()).questions[0];
r = await (await req("/api/admin/certq/withdraw", { method: "POST", token: T, body: { id: pick.id } })).json();
ok(r.ok, "the owner withdraws a question");
ok(!(await (await req("/api/certq?cert=dbx-dea")).json()).questions.some((q) => q.id === pick.id), "a withdrawn question stops being served");
await req("/api/admin/certq/withdraw", { method: "POST", token: T, body: { id: pick.id, restore: true } });
ok((await (await req("/api/certq?cert=dbx-dea")).json()).questions.some((q) => q.id === pick.id), "and can be restored");

/* ---- duplicates and failures ---- */
const dupBefore = (await DB.prepare("SELECT COUNT(*) AS n FROM cert_q").first()).n;
const { makeSection } = await import("../worker/src/certq.js");
const first = lastWritten.slice();
const text = (await DB.prepare("SELECT q FROM cert_q WHERE dom = ? LIMIT 1").bind(CERT_META[0].domains[0].id).first()).q;
globalThis.fetch = async (u, init) => {
  const sys = JSON.parse(init.body).messages[0].content;
  const content = sys.startsWith("You write") ? JSON.stringify([{ ...mkQ("x", 0), q: text }]) : JSON.stringify([{ i: 0, pick: [0], ok: true }]);
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};
const deps = { complete: async (m, e, o) => ({ text: JSON.parse(await (await globalThis.fetch("", { body: JSON.stringify({ messages: m }) })).text()).choices[0].message.content, provider: "t", model: "t" }) };
const out = await makeSection(env, deps, CERT_META[0], CERT_META[0].domains[0], 1);
ok(out.added === 0 && out.rejected.length === 1, "a repeat of an existing question is dropped: " + out.rejected);
breakWriter = true;
globalThis.fetch = async () => new Response("down", { status: 500 });
await runCron();
const after = (await DB.prepare("SELECT COUNT(*) AS n FROM cert_q").first()).n;
ok(after === dupBefore, "if the AI is down nothing is added and the night does not crash");

console.log(fails ? `\n${fails} FAILED` : "\nALL CERT QUESTION TESTS PASSED");
process.exit(fails ? 1 : 0);
