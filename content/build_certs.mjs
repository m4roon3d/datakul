// Checks every certification question bank in content/certs/*.json and writes web/certs.js for the app.
//   node content/build_certs.mjs           check and write
//   node content/build_certs.mjs --check   check, and fail if web/certs.js is out of date (CI)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "content/certs");
const errors = [];
const err = (m) => errors.push(m);
const certs = [];
const DOCS = /^https:\/\/docs\.databricks\.com\//;

for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const { cert, questions } = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const where = (s) => `${cert.id}: ${s}`;
  for (const k of ["id", "vendor", "name", "short", "fee", "minutes", "scored", "guide", "guideUrl", "disclaimer"]) if (!cert[k]) err(where(`missing ${k}`));
  if (!/not affiliated/i.test(cert.disclaimer || "")) err(where("disclaimer must say it is not affiliated with the vendor"));
  const sum = cert.domains.reduce((s, d) => s + d.w, 0);
  if (sum !== 100) err(where(`domain weights add up to ${sum}, not 100`));
  const dom = new Set(cert.domains.map((d) => d.id));
  const ids = new Set(), texts = new Set(), per = {};
  for (const q of questions) {
    const w = (s) => err(where(`${q.id}: ${s}`));
    if (ids.has(q.id)) w("duplicate id"); ids.add(q.id);
    if (texts.has(q.q.toLowerCase())) w("duplicate question text"); texts.add(q.q.toLowerCase());
    if (!dom.has(q.d)) w(`unknown domain ${q.d}`);
    per[q.d] = (per[q.d] || 0) + 1;
    if (q.q.length < 30) w("question too short");
    if (!Array.isArray(q.opts) || q.opts.length < 3 || q.opts.length > 5) w("needs 3 to 5 options");
    if (new Set(q.opts.map((o) => o.toLowerCase())).size !== q.opts.length) w("duplicate options");
    if (!q.ans.length || q.ans.some((a) => !Number.isInteger(a) || a < 0 || a >= q.opts.length)) w("answer index out of range");
    if (q.ans.length > 1 && !q.q.includes(`(Choose ${["", "one", "two", "three"][q.ans.length]}.)`)) w(`multi-answer question must say (Choose ${["", "one", "two", "three"][q.ans.length]}.)`);
    if (q.ans.length === 1 && /\(Choose/.test(q.q)) w("says Choose but has one answer");
    if ((q.why || "").length < 80) w("explanation shorter than 80 characters");
    if (/—/.test(JSON.stringify(q))) w("contains an em dash");
    if (q.more && !(DOCS.test(q.more.u || "") && q.more.t)) w("more must be a docs.databricks.com link with a title");
  }
  // Study chapters: content/certs/study/<cert>.<domain>.json, attached to the section as domain.study
  const sdir = join(dir, "study");
  let files = []; try { files = readdirSync(sdir).filter((x) => x.startsWith(cert.id + ".") && x.endsWith(".json")).sort(); } catch {}
  for (const f2 of files) {
    const ch = JSON.parse(readFileSync(join(sdir, f2), "utf8"));
    const w = (s) => err(where(`study ${f2}: ${s}`));
    const d = cert.domains.find((x) => x.id === ch.dom);
    if (!d) { w(`unknown section ${ch.dom}`); continue; }
    for (const k of ["intro", "expects", "ideas", "problems", "mistakes", "links", "checked"]) if (!ch[k] || !ch[k].length) w(`missing ${k}`);
    (ch.problems || []).forEach((p, i) => {
      if (!p.t || !p.q || !p.answer || !(p.steps || []).length) w(`problem ${i + 1} needs t, q, steps and answer`);
    });
    (ch.links || []).forEach((l, i) => { if (!DOCS.test(l.u || "") || !l.t || !l.why) w(`link ${i + 1} must be a docs.databricks.com link with title and why`); });
    // Figures: content/certs/figs/<cert>.<domain>.json (written by study_figs.py): a section map and one figure per idea title
    let figs = null; try { figs = JSON.parse(readFileSync(join(dir, "figs", f2), "utf8")); } catch {}
    if (figs) {
      const KINDS = { flow: "n", cols: "n", vs: "a", layers: "n", hub: "n", table: "rows", tables: "tables", bars: "n", line: "n", grid2: "v", tree: "n", dag: "n" };
      const okFig = (g, at) => { if (!g || !KINDS[g.k] || !g[KINDS[g.k]] || !g[KINDS[g.k]].length) w(`figure ${at} needs a known kind and its items`); };
      if (figs.map) { okFig(figs.map, "map"); ch.map = figs.map; }
      for (const [t, g] of Object.entries(figs.ideas || {})) {
        const idea = (ch.ideas || []).find((i) => i.t === t);
        if (!idea) { w(`figure for unknown idea "${t}"`); continue; }
        okFig(g, `"${t}"`); idea.fig = g;
      }
    }
    if (/—/.test(JSON.stringify(ch))) w("contains an em dash");
    d.study = ch;
  }
  for (const d of cert.domains) if ((per[d.id] || 0) < 2) err(where(`domain ${d.id} has ${per[d.id] || 0} questions; needs at least 2 for the diagnostic`));
  certs.push({ ...cert, questions });
  console.log(`${cert.id}: ${questions.length} questions · ${cert.domains.map((d) => `${d.id} ${per[d.id] || 0}`).join(", ")}`);
}

if (errors.length) { errors.forEach((e) => console.log("ERROR:", e)); process.exit(1); }
// The gateway writes new questions for each section; it needs the sections and the existing question texts (to avoid repeats).
const meta = "// GENERATED by content/build_certs.mjs from content/certs/*.json. Do not edit by hand.\nexport const CERT_META = " + JSON.stringify(certs.map((c) => ({ id: c.id, name: c.name, guide: c.guide, guideUrl: c.guideUrl, domains: c.domains.map((d) => ({ id: d.id, name: d.name })), texts: c.questions.map((q) => ({ d: q.d, q: q.q })) }))) + ";\n";
const metaPath = join(root, "worker/src/certs-meta.js");
const out = "// GENERATED by content/build_certs.mjs from content/certs/*.json. Do not edit by hand.\nconst CERTS = " + JSON.stringify(certs) + ";\n";
const path = join(root, "web/certs.js");
if (process.argv.includes("--check")) {
  let cur = ""; try { cur = readFileSync(path, "utf8"); } catch {}
  let curMeta = ""; try { curMeta = readFileSync(metaPath, "utf8"); } catch {}
  if (cur !== out || curMeta !== meta) { console.error("web/certs.js or worker/src/certs-meta.js is out of date. Run: node content/build_certs.mjs"); process.exit(1); }
  console.log("certs in sync");
} else { writeFileSync(path, out); writeFileSync(metaPath, meta); console.log("wrote web/certs.js and worker/src/certs-meta.js"); }
