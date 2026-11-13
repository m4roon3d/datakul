// Job simulator content check: every ticket is complete, every senior reply earns all its key points with the real
// grader, keywords aren't so loose that a vague reply passes, and ticket ids are unique.
import { readFileSync } from "node:fs";
import { grade } from "../worker/src/grader.js";
let fails = 0;
const ok = (c, m) => { if (!c) { console.log("FAIL " + m); fails++; } };
const src = readFileSync(new URL("../web/jobsim.js", import.meta.url), "utf8");
const SIM = new Function("document", "store", src.split("const SIM_DAYS")[0] + "; return SIM;")({ addEventListener() {} }, {});
const VAGUE = [
  "Thanks for flagging this, I will look into it and get back to you soon with more details about what happened and next steps.",
  "I think we should investigate the data and talk to the team, then fix the issue and make sure everything is working properly again.",
];
const ids = new Set();
let n = 0;
for (const [t, S] of Object.entries(SIM)) {
  ok(S.role && S.co && S.about && S.days.length === 5, `${t}: role, company, about and five days`);
  for (const d of S.days) {
    n++;
    ok(!ids.has(d.id), `${d.id}: unique id`); ids.add(d.id);
    ok(d.from && d.fromRole && d.time && d.subj && d.msg && d.ask && d.art && d.a, `${d.id}: every field filled`);
    ok(d.p.length >= 4 && d.p.length <= 6 && d.p.every((p) => p.t && p.k.length >= 2), `${d.id}: 4–6 key points, each with keywords`);
    const g = grade(d.a, d);
    ok(g.pct === 100, `${d.id}: senior reply earns every point (missed: ${g.res.filter((r) => !r.ok).map((r) => r.t).join(" | ")})`);
    ok(g.words >= 60 && g.words <= 170, `${d.id}: senior reply is 60–170 words (${g.words})`);
    for (const v of VAGUE) { const gv = grade(v, d); ok(gv.pct < 60, `${d.id}: a vague reply doesn't pass (${gv.pct}%: ${gv.res.filter((r) => r.ok).map((r) => r.t).join(" | ")})`); }
    const a = d.art;
    ok(a.kind === "table" ? a.head && a.rows.every((r) => r.length === a.head.length) : !!a.body, `${d.id}: attachment is well formed`);
  }
}
console.log(`${n} tickets checked`);
console.log(fails ? `\n${fails} FAILED` : "\nALL JOB SIM CONTENT TESTS PASSED");
process.exit(fails ? 1 : 0);
