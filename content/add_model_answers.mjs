// Adds model answers to existing interview questions in web/library.js, matched by question text.
// Every answer must earn all of its question's key points under the app's grader, be at least 120 characters
// and contain no em dashes; otherwise nothing is written.
// Usage: node content/add_model_answers.mjs content/model_answers_YYYY_MM.json
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { grade } from "../worker/src/grader.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libPath = join(root, "web/library.js");
const src = readFileSync(libPath, "utf8");
const answers = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { Q } = new Function(src.replace(/^const /gm, "var ") + "; return { Q };")();

const errors = [];
let added = 0;
const byText = new Map(Q.map((q) => [q.q, q]));
for (const [text, a] of Object.entries(answers)) {
  const q = byText.get(text);
  if (!q) { errors.push(`no question: "${text.slice(0, 60)}"`); continue; }
  if (a.length < 120) errors.push(`too short: "${text.slice(0, 60)}"`);
  if (/—/.test(a)) errors.push(`em dash in: "${text.slice(0, 60)}"`);
  const g = grade(a, q);
  if (g.n < q.p.length) errors.push(`"${text.slice(0, 60)}" earns ${g.n}/${q.p.length} (missing: ${g.res.filter((r) => !r.ok).map((r) => r.t).join("; ")})`);
  if (!q.a) added++;
  q.a = a;
}
if (errors.length) { errors.forEach((e) => console.log("ERROR:", e)); process.exit(1); }

const qStart = src.indexOf("const Q=["), qEnd = src.indexOf("\n];", qStart) + 3;
writeFileSync(libPath, src.slice(0, qStart) + "const Q=[\n" + Q.map((x) => JSON.stringify(x)).join(",\n") + "\n];" + src.slice(qEnd));
console.log(`Added ${added} model answers. Questions without one: ${Q.filter((q) => !q.a).length}`);
