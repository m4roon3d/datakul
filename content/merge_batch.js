/* Merge a validated batch into web/library.js (concepts into C, questions into Q).
   Usage: node content/validate_batch.js <batch.json> && node content/merge_batch.js <batch.json>
   Refuses to merge twice. Keeps every other part of library.js unchanged. */
const fs = require("fs");
const path = require("path");
const libPath = path.join(__dirname, "..", "web", "library.js");
const syncOnly = process.argv[2] === "--sync";
const batch = syncOnly ? { batch: "sync", concepts: [], questions: [] } : JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const SYL = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, "syllabus.json"), "utf8")).map((t) => [t.id, t]));
const src = fs.readFileSync(libPath, "utf8");

const { C, Q } = new Function(src.replace(/^const /gm, "var ") + "; return { C, Q };")();
const have = new Set(C.map((c) => c.id));
const dup = batch.concepts.filter((c) => have.has(c.id)).map((c) => c.id);
if (dup.length) { console.error("Already merged: " + dup.join(", ")); process.exit(1); }

// Every concept carries its syllabus module and level, so the app can group and label it.
const concepts = C.concat(batch.concepts).map((c) => {
  const t = SYL[c.id];
  return t ? { ...c, mod: t.module, lv: t.level } : c;
});
concepts.sort((a, b) => (SYL[a.id] ? SYL[a.id].order : 1e9) - (SYL[b.id] ? SYL[b.id].order : 1e9));
const questions = Q.concat(batch.questions);
const block = (name, arr) => `const ${name}=[\n` + arr.map((x) => JSON.stringify(x)).join(",\n") + "\n];";

const cStart = src.indexOf("const C=["), cEnd = src.indexOf("\n];", cStart) + 3;
const qStart = src.indexOf("const Q=["), qEnd = src.indexOf("\n];", qStart) + 3;
if (cStart < 0 || qStart < 0 || qStart < cEnd) { console.error("Unexpected library.js layout"); process.exit(1); }
const out = src.slice(0, cStart) + block("C", concepts) + src.slice(cEnd, qStart) + block("Q", questions) + src.slice(qEnd);
fs.writeFileSync(libPath, out);
console.log(`${syncOnly ? "Synced" : "Merged batch " + batch.batch}: library now has ${concepts.length} concepts and ${questions.length} questions`);
