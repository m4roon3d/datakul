/* Validate a content batch against the syllabus, the current library and the app's own search and grader.
   Usage: node content/validate_batch.js content/batches/batch01.json */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const batchFile = process.argv[2];
const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
const syllabus = JSON.parse(fs.readFileSync(path.join(__dirname, "syllabus.json"), "utf8"));
const SYL = Object.fromEntries(syllabus.map((t) => [t.id, t]));

// Load the live library (C, Q, SKILLS …) and the app's real search and grader code.
const lib = fs.readFileSync(path.join(root, "web/library.js"), "utf8").replace(/^const /gm, "var ");
eval(lib);
const app = fs.readFileSync(path.join(root, "web/app.js"), "utf8");
const cut = (a, b) => app.slice(app.indexOf(a), app.indexOf(b));
const searchSrc = cut("/* ---------- on-device retrieval", "const refText");
const graderSrc = cut("/* ---- answer checker", "const MIN_WORDS");

const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
const isStr = (v, min = 1) => typeof v === "string" && v.trim().length >= min;

// ---- concepts
const existingIds = new Set(C.map((c) => c.id));
const newIds = new Set();
for (const c of batch.concepts) {
  const where = `concept ${c.id}`;
  if (existingIds.has(c.id)) err(`${where}: already in the library`);
  if (newIds.has(c.id)) err(`${where}: duplicated in batch`);
  newIds.add(c.id);
  const s = SYL[c.id];
  if (!s) { err(`${where}: not in the syllabus`); continue; }
  if (s.title !== c.title) err(`${where}: title "${c.title}" differs from syllabus "${s.title}"`);
  if (s.track !== c.t) err(`${where}: track ${c.t} differs from syllabus ${s.track}`);
  for (const [k, min, max] of [["s", 60, 330], ["d", 250, 1000], ["e", 60, 400], ["c", 30, 260], ["i", 60, 300], ["kw", 30, 260]]) {
    if (!isStr(c[k], min)) err(`${where}: field ${k} missing or shorter than ${min} chars`);
    else if (c[k].length > max) warn(`${where}: field ${k} is long (${c[k].length} > ${max})`);
  }
  if (!Array.isArray(c.r) || c.r.length !== 3) err(`${where}: needs exactly 3 related topics`);
  if (/[—]/.test(JSON.stringify(c))) warn(`${where}: contains an em dash`);
}
const allIds = new Set([...existingIds, ...newIds]);
for (const c of batch.concepts) for (const r of c.r || []) {
  if (r === c.id) err(`concept ${c.id}: relates to itself`);
  if (!allIds.has(r)) err(`concept ${c.id}: related topic "${r}" is not in the library or this batch`);
}

// ---- search: each new topic must win for its own title, and old topics must still win for theirs
const merged = C.concat(batch.concepts.map((c) => ({ ...c, lv: undefined })));
const search = new Function("C", searchSrc + "; return search;")(merged);
for (const c of merged) {
  const top = search(c.title)[0];
  if (!top || top.c.id !== c.id) (newIds.has(c.id) ? err : warn)(`search: "${c.title}" returns ${top ? top.c.id : "nothing"} first, not ${c.id}`);
}
for (const [q, id] of batch.searchChecks || []) {
  const top = search(q)[0];
  if (!top || top.c.id !== id) err(`search: "${q}" should find ${id} but finds ${top ? top.c.id : "nothing"}`);
}

// ---- interview questions, graded with the app's own checker
const grade = new Function(graderSrc + "; return grade;")();
const VAGUE = [
  "I am not sure about this one, I would build something quickly and discuss it with the team before deciding.",
  "I would first understand the requirements, talk to the users and stakeholders, then pick the right tool and keep the solution simple and maintainable.",
  "This is a common problem. My approach is to analyse it, use best practices, and make sure it performs well at scale with high quality.",
];
const ROLES = new Set(["de", "da", "ds", "ar"]), LV = new Set(["j", "m", "s"]), DOM = new Set(["any", "ecom", "fin", "log", "saas"]);
const qTexts = new Set(Q.map((q) => q.q.toLowerCase()));
const perConcept = {};
let vagueHits = 0, vagueTotal = 0;
for (const q of batch.questions) {
  const where = `question "${(q.q || "").slice(0, 50)}"`;
  if (!isStr(q.q, 15)) err(`${where}: missing text`);
  if (qTexts.has((q.q || "").toLowerCase())) err(`${where}: duplicate question`);
  qTexts.add((q.q || "").toLowerCase());
  if (!allIds.has(q.c)) err(`${where}: concept ${q.c} unknown`);
  perConcept[q.c] = (perConcept[q.c] || 0) + 1;
  if (!q.r?.length || !q.r.every((r) => ROLES.has(r))) err(`${where}: bad roles`);
  if (!LV.has(q.l)) err(`${where}: bad level`);
  if (!q.d?.length || !q.d.every((d) => DOM.has(d))) err(`${where}: bad domains`);
  if (!Array.isArray(q.tg) || !q.tg.length) err(`${where}: needs skill tags`);
  else q.tg.filter((t) => !SKILLS.includes(t)).forEach((t) => warn(`${where}: tag "${t}" isn't in SKILLS, so job-description matching ignores it`));
  if (!Array.isArray(q.p) || q.p.length < 2 || q.p.length > 6) err(`${where}: needs 2–6 key points`);
  for (const p of q.p || []) if (!isStr(p.t, 8) || !Array.isArray(p.k) || p.k.length < 2) err(`${where}: point "${p.t}" needs text and at least 2 keywords`);
  const GENERIC = new Set(["and", "or", "the", "a", "an", "to", "of", "in", "on", "it", "is", "data", "use", "using", "with", "for", "then", "first", "good", "best"]);
  for (const p of q.p || []) for (const k of p.k || []) if (GENERIC.has(String(k).trim().toLowerCase())) err(`${where}: keyword "${k}" is too generic and would credit almost any answer`);
  if (!isStr(q.a, 120)) { err(`${where}: needs a sample answer (a)`); continue; }
  const g = grade(q.a, q);
  if (g.n < q.p.length) err(`${where}: its own sample answer only covers ${g.n}/${q.p.length} key points (missing: ${g.res.filter((r) => !r.ok).map((r) => r.t).join("; ")})`);
  for (const v of VAGUE) { const gv = grade(v, q); vagueHits += gv.n; vagueTotal += q.p.length; if (gv.n > 1) err(`${where}: a vague answer scores ${gv.n} points`); }
}
for (const c of batch.concepts) {
  const n = perConcept[c.id] || 0;
  if (n < 2) err(`concept ${c.id}: has ${n} interview questions, needs at least 2`);
}

// ---- report
console.log(`Batch: ${batch.concepts.length} concepts, ${batch.questions.length} questions`);
console.log(`Vague answers credited: ${vagueHits}/${vagueTotal} points`);
warnings.forEach((w) => console.log("warning:", w));
errors.forEach((e) => console.log("ERROR:", e));
console.log(errors.length ? `FAILED with ${errors.length} errors` : "PASSED");
process.exit(errors.length ? 1 : 0);
