/* Datakul coding practice tab. Loaded after app.js and problems.js; uses their helpers ($, esc, md, store, act, aiOn, engine, streamChat, level, detail). */
"use strict";

const SQLJS_URL = (window.DATAKUL_CONFIG && window.DATAKUL_CONFIG.sqlJsUrl) || "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-asm.js";
const LANG_LABEL = { sql: "SQL", python: "Python", pandas: "pandas", pyspark: "PySpark" };
const PM = Object.fromEntries(PROBLEMS.map((p) => [p.id, p]));
const PSTATE = store.get("practice", {}); // id -> {status, code}
let GEN = store.get("gen", []);             // problems generated on this device
GEN.forEach((p) => (PM[p.id] = p));
const allProblems = () => GEN.concat(PROBLEMS);
let pView = null;
let pFilter = store.get("pfilter", "all");
let hintShown = {};
let saveTimer = null;

const pSave = () => store.set("practice", PSTATE);
const pState = (id) => (PSTATE[id] = PSTATE[id] || { status: "new" });
const statusOf = (id) => (PSTATE[id] && PSTATE[id].status) || "new";
const STATUS_LABEL = { new: "Not started", attempted: "Attempted", viewed: "Solution viewed", solved: "Solved" };

/* ---------- SQL engine (SQLite compiled to JavaScript, loaded on first use) ---------- */
let sqlPromise = null;
function loadSql() {
  if (sqlPromise) return sqlPromise;
  sqlPromise = new Promise((resolve, reject) => {
    const go = () => window.initSqlJs().then(resolve, reject);
    if (window.initSqlJs) return go();
    const s = document.createElement("script");
    s.src = SQLJS_URL;
    s.onload = () => (window.initSqlJs ? go() : reject(new Error("SQL engine missing")));
    s.onerror = () => reject(new Error("SQL engine failed to load"));
    document.head.appendChild(s);
  });
  sqlPromise.catch(() => { sqlPromise = null; });
  return sqlPromise;
}
function runSql(SQL, setup, query) {
  const db = new SQL.Database();
  try {
    db.run(setup);
    const out = db.exec(query);
    return out.length ? out[out.length - 1] : null;
  } finally { db.close(); }
}
const tableNames = (setup) => [...setup.matchAll(/CREATE TABLE\s+(\w+)/gi)].map((m) => m[1]);

function normVal(v) {
  if (v === null || v === undefined) return "NULL";
  const s = String(v).trim();
  if (typeof v === "number" || /^-?\d+(\.\d+)?$/.test(s)) return String(Math.round(Number(s) * 100) / 100);
  return s;
}
function compare(got, exp, ordered) {
  if (!got) return { ok: false, why: "Your query ran but didn't return any result set. End it with a SELECT." };
  if (got.columns.length !== exp.columns.length) return { ok: false, why: `Expected ${exp.columns.length} column${exp.columns.length > 1 ? "s" : ""} (${exp.columns.join(", ")}), but your query returned ${got.columns.length}.` };
  const g = got.values.map((r) => r.map(normVal).join("\u0001")), e = exp.values.map((r) => r.map(normVal).join("\u0001"));
  if (g.length !== e.length) return { ok: false, why: `Expected ${e.length} row${e.length === 1 ? "" : "s"}, but your query returned ${g.length}.` };
  const same = (a, b) => a.every((x, i) => x === b[i]);
  if (same(g, e)) return { ok: true };
  const gs = [...g].sort(), es = [...e].sort();
  if (same(gs, es)) return ordered ? { ok: false, why: "You have the right rows in the wrong order. Check your ORDER BY." } : { ok: true };
  const i = g.findIndex((x, k) => x !== e[k]);
  const fmt = (s) => s.split("\u0001").join(", ");
  return { ok: false, why: `Row ${i + 1} differs: expected (${fmt(e[i])}) but got (${fmt(g[i])}).` };
}
function resultTable(res, cap = 50) {
  if (!res) return `<p class="muted">No rows.</p>`;
  const rows = res.values.slice(0, cap);
  return `<div class="rtable"><table><thead><tr>${res.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v === null ? '<i class="null">NULL</i>' : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${res.values.length > cap ? `<p class="muted">Showing ${cap} of ${res.values.length} rows.</p>` : ""}`;
}

/* ---------- list ---------- */
function renderPracticeList() {
  const inF = (p) => pFilter === "all" || (pFilter === "sql" ? p.lang === "sql" : p.lang !== "sql");
  const all = allProblems();
  const solved = all.filter((p) => statusOf(p.id) === "solved").length;
  const mark = (s) => s === "solved" ? `<b class="pm ok" aria-label="Solved">✓</b>` : s === "new" ? `<b class="pm" aria-label="Not started">○</b>` : `<b class="pm mid" aria-label="${STATUS_LABEL[s]}">●</b>`;
  const row = (p) => `<button class="prow" type="button" data-open="${p.id}">${mark(statusOf(p.id))}<span class="pt"><b>${esc(p.title)}</b><small><span class="diff d-${p.diff.toLowerCase()}">${p.diff}</span> · ${esc(p.pattern)} · ${LANG_LABEL[p.lang]}</small></span>${ARR}</button>`;
  const gens = GEN.filter(inF);
  $("#pracBoard").innerHTML = `
    <div class="libhead"><span class="eyebrow">${solved} of ${all.length} solved</span><h2>Coding practice</h2>
      <p class="muted">Interview-style SQL and Python problems, checked automatically. Solving one completes a quest's coding step.</p></div>
    ${genBoxHTML()}
    <div class="seg" role="group" aria-label="Filter problems">${[["all", "All"], ["sql", "SQL"], ["py", "Python, pandas, PySpark"]].map(([k, v]) => `<button class="pill${pFilter === k ? " pill-on" : ""}" type="button" data-pf="${k}" aria-pressed="${pFilter === k}">${v}</button>`).join("")}</div>
    ${gens.length ? `<div class="sechead"><h3>Your generated problems</h3><span class="muted">${gens.length}</span></div>
      <div class="plist">${gens.map((p) => `<div class="prow-wrap">${row(p)}<button class="del" type="button" data-del="${p.id}" aria-label="Delete ${esc(p.title)}">×</button></div>`).join("")}</div>
      <div class="sechead"><h3>Datakul problems</h3><span class="muted">${PROBLEMS.filter(inF).length}</span></div>` : ""}
    <div class="plist">${PROBLEMS.filter(inF).map(row).join("")}</div>
    <div class="morep"><span class="eyebrow">More practice</span><p class="muted">Once you're comfortable, try these study plans on LeetCode:</p><div class="next">${PRACTICE_LINKS.map((l) => `<a class="lnk" href="${l.url}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div></div>`;
  wireGenBox();
}

/* ---------- problem ---------- */
async function renderProblem(id) {
  const p = PM[id], st = pState(id), isSql = p.lang === "sql";
  const canRunPy = !isSql && Array.isArray(p.tests) && p.tests.length && pyAvailable();
  const nVis = !isSql && p.tests ? p.tests.filter((t) => !t.hidden).length : 0;
  hintShown[id] = hintShown[id] || 0;
  const code = st.code != null ? st.code : p.starter;
  $("#pracBoard").innerHTML = `
    <div class="pview">
      <button class="ghostlink back" type="button" data-back="1">← All problems</button>
      <div class="phead"><span class="eyebrow">${LANG_LABEL[p.lang]} · <span class="diff d-${p.diff.toLowerCase()}">${p.diff}</span> · ${esc(p.pattern)}</span>
        <h2>${esc(p.title)}</h2><span class="spill s-${statusOf(id)}" id="pStatus">${STATUS_LABEL[statusOf(id)]}</span>
        ${p.generated ? `<span class="genby">Generated by ${esc(p.by || "AI")} · passed the automatic checks · <button class="ghostlink" type="button" data-del="${p.id}">Delete</button></span>` : ""}</div>
      <div class="md pprompt">${md(p.prompt)}</div>
      ${isSql ? `<div id="pTables">${climbLoader("Loading the sample tables…")}</div>` : `<div class="pblock"><span class="eyebrow">Example</span><pre class="code">${esc(p.example || "")}</pre>${p.tests ? `<p class="muted kbd">${p.tests.length} tests: ${nVis} shown when you run, ${p.tests.length - nVis} hidden until you submit.${p.lang === "pyspark" ? " PySpark code runs on Datakul's in-browser engine, which supports the common DataFrame API." : ""}</p>` : ""}</div>`}
      <div class="pblock"><div class="edhead"><span class="eyebrow">Your ${LANG_LABEL[p.lang]}</span><button class="ghostlink" type="button" id="pReset">Reset</button></div>
        <textarea class="code editor" id="pcode" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Your code">${esc(code)}</textarea>
        <div class="acts">
          ${isSql || canRunPy ? `<button class="btn quiet" type="button" id="pRun">Run</button><button class="btn" type="button" id="pSubmit">Submit</button>` : ""}
          ${!isSql && !canRunPy && aiOn() ? `<button class="btn" type="button" id="pAiCheck">Check with AI</button>` : ""}
          ${(isSql || canRunPy) && aiOn() ? `<button class="ghostlink" type="button" id="pAiReview">Ask AI to review</button>` : ""}
          <button class="ghostlink" type="button" id="pHint">Hint</button>
          <button class="ghostlink" type="button" id="pSol">Show solution</button>
        </div>
        <p class="muted kbd">${isSql ? "Ctrl + Enter runs your query. Each run starts from a fresh copy of the tables."
          : canRunPy ? "Ctrl + Enter runs the example tests. Submit runs every test, including hidden ones."
          : window.DATAKUL_PREVIEW ? "Running Python needs the installed app, which downloads a Python runtime this preview can't load." + (aiOn() ? " Here, the AI reviews your code instead." : "")
          : aiOn() ? "Python can't run in this browser right now. The AI reviews your code against the problem and edge cases." : "Python can't run in this browser right now. Compare your code with the solution, or connect an AI provider in settings."}</p>
      </div>
      <div id="pOut" aria-live="polite"></div>
      <div id="pHints"></div>
      <div id="pAi"></div>
      <div id="pSolution"></div>
    </div>`;
  renderHints(p);
  const ed = $("#pcode");
  ed.addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { pState(id).code = ed.value; pSave(); }, 400); });
  ed.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText("  ", s, ed.selectionEnd, "end"); ed.dispatchEvent(new Event("input")); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ($("#pRun") || $("#pAiCheck"))?.click(); }
  });
  $("#pReset").onclick = () => { ed.value = p.starter; pState(id).code = p.starter; pSave(); };
  $("#pHint").onclick = () => { hintShown[id] = Math.min(p.hints.length, hintShown[id] + 1); renderHints(p); };
  $("#pSol").onclick = () => askSolution(p);
  if (isSql) {
    $("#pRun").onclick = () => sqlRun(p, false);
    $("#pSubmit").onclick = () => sqlRun(p, true);
    if ($("#pAiReview")) $("#pAiReview").onclick = () => aiReview(p);
    try {
      const SQL = await loadSql();
      if (pView !== id) return;
      $("#pTables").innerHTML = `<div class="pblock"><span class="eyebrow">Tables</span>${tableNames(p.setup).map((t) => `<p class="tname"><code>${esc(t)}</code></p>${resultTable(runSql(SQL, p.setup, `SELECT * FROM ${t}`))}`).join("")}</div>
        <div class="pblock"><span class="eyebrow">Expected output</span>${resultTable(runSql(SQL, p.setup, p.solution))}</div>`;
    } catch (err) {
      if (pView !== id) return;
      $("#pTables").innerHTML = `<p class="warnnote">The SQL engine couldn't load, so queries can't run right now. You can still read the tables below, take hints and open the solution.</p><div class="pblock"><span class="eyebrow">Tables (as SQL)</span><pre class="code">${esc(p.setup)}</pre></div>`;
      ["#pRun", "#pSubmit"].forEach((s) => { if ($(s)) $(s).disabled = true; });
    }
  } else if (canRunPy) {
    $("#pRun").onclick = () => pyRunTests(p, false);
    $("#pSubmit").onclick = () => pyRunTests(p, true);
    if ($("#pAiReview")) $("#pAiReview").onclick = () => aiReview(p);
  } else if ($("#pAiCheck")) {
    $("#pAiCheck").onclick = () => aiReview(p);
  }
}

/* ---------- Python tests ---------- */
async function pyRunTests(p, submit) {
  const out = $("#pOut"), code = $("#pcode").value;
  if (!code.trim()) { out.innerHTML = `<p class="muted">Write your code first.</p>`; return; }
  const tests = submit ? p.tests : p.tests.filter((t) => !t.hidden);
  ["#pRun", "#pSubmit"].forEach((b) => ($(b).disabled = true));
  out.innerHTML = climbLoader("Running…", "pyStatus");
  let res;
  try {
    res = await pyRun({ lang: p.lang, entry: p.entry, ordered: p.ordered !== false, code, reference: p.solution, tests },
      (msg) => { const el = $("#pyStatus .cl-t"); if (el) el.textContent = msg; });
  } catch (e) {
    lastRun[p.id] = "Error: " + e.message;
    out.innerHTML = `<div class="verdict bad"><b>Couldn't run</b><span>${esc(e.message)}</span></div>`;
    return;
  } finally { ["#pRun", "#pSubmit"].forEach((b) => { if ($(b)) $(b).disabled = false; }); }
  if (pView !== p.id) return;
  if (res.error) {
    lastRun[p.id] = "Error: " + res.error;
    if (submit) setStatus(p.id, "attempted");
    out.innerHTML = `<div class="verdict bad"><b>Error</b><span>${esc(res.error)}</span></div>`;
    return;
  }
  const n = res.tests.length, passed = res.tests.filter((t) => t.ok).length;
  const failed = res.tests.filter((t) => !t.ok);
  lastRun[p.id] = `${submit ? "Submitted" : "Ran example tests"}: ${passed} of ${n} passed.` + (failed[0] ? ` First failure "${failed[0].name}": ${failed[0].error || "expected " + failed[0].expected + " but got " + failed[0].got}` : "");
  let head;
  if (passed === n && submit) { setStatus(p.id, "solved"); head = `<div class="verdict good"><b>Accepted</b><span>All ${n} tests passed, including the hidden ones.</span></div>`; }
  else if (passed === n) head = `<div class="verdict good"><b>Example tests pass</b><span>Submit to run all ${p.tests.length} tests, including the hidden ones.</span></div>`;
  else { if (submit) setStatus(p.id, "attempted"); head = `<div class="verdict bad"><b>Not yet</b><span>${passed} of ${n} tests passed.</span></div>`; }
  const firstFail = res.tests.findIndex((t) => !t.ok);
  out.innerHTML = head + `<div class="tlist">${res.tests.map((t, i) => `<details class="tcase ${t.ok ? "ok" : "no"}" ${i === firstFail ? "open" : ""}>
      <summary><b>${t.ok ? "✓" : "✗"}</b><span>${esc(t.name)}${t.hidden ? ` <small>hidden test</small>` : ""}</span>${CHEV}</summary>
      <div class="tbody">
        <span class="eyebrow">Input</span><pre class="code">${esc(t.input || "")}</pre>
        ${t.error ? `<span class="eyebrow">Error</span><pre class="code err">${esc(t.error)}</pre>` : `<span class="eyebrow">Your output</span><pre class="code">${esc(t.got ?? "")}</pre>`}
        ${t.ok ? "" : `<span class="eyebrow">Expected</span><pre class="code">${esc(t.expected ?? "")}</pre>`}
        ${t.stdout ? `<span class="eyebrow">Printed</span><pre class="code">${esc(t.stdout)}</pre>` : ""}
      </div></details>`).join("")}</div>`;
}
function setStatus(id, s) {
  const st = pState(id);
  const rank = { new: 0, attempted: 1, viewed: 2, solved: 3 };
  const was = st.status;
  if (rank[s] > rank[st.status] || s === "solved") { st.status = s; pSave(); }
  if (s === "solved" && was !== "solved" && typeof questEvent === "function") questEvent("solve", { id, lang: (PM[id] || {}).lang });
  const el = $("#pStatus");
  if (el) { el.className = "spill s-" + st.status; el.textContent = STATUS_LABEL[st.status]; }
}
function renderHints(p) {
  const n = hintShown[p.id] || 0;
  $("#pHints").innerHTML = n ? `<div class="pblock hints"><span class="eyebrow">Hints</span><ol>${p.hints.slice(0, n).map((h) => `<li>${esc(h)}</li>`).join("")}</ol>${n < p.hints.length ? `<p class="muted">Still stuck? Tap Hint again for a bigger nudge.</p>` : ""}</div>` : "";
  const b = $("#pHint");
  if (b) b.textContent = n >= p.hints.length ? "All hints shown" : n ? `Next hint (${n + 1} of ${p.hints.length})` : "Hint";
  if (b) b.disabled = n >= p.hints.length;
}
let lastRun = {};
async function sqlRun(p, submit) {
  const out = $("#pOut"), q = $("#pcode").value;
  if (!q.trim()) { out.innerHTML = `<p class="muted">Write a query first.</p>`; return; }
  out.innerHTML = climbLoader("Running…");
  let SQL;
  try { SQL = await loadSql(); } catch (e) { out.innerHTML = `<p class="warnnote">The SQL engine isn't available right now.</p>`; return; }
  let got;
  try { got = runSql(SQL, p.setup, q); }
  catch (e) {
    lastRun[p.id] = "Error: " + e.message;
    out.innerHTML = `<div class="verdict bad"><b>Error</b><span>${esc(e.message)}</span></div>`;
    if (submit) setStatus(p.id, "attempted");
    return;
  }
  const exp = runSql(SQL, p.setup, p.solution);
  if (!submit) {
    lastRun[p.id] = got ? `Ran OK, ${got.values.length} rows, columns ${got.columns.join(", ")}` : "Ran OK, no result set";
    out.innerHTML = `<div class="pblock"><span class="eyebrow">Your output</span>${resultTable(got)}</div>`;
    return;
  }
  const r = compare(got, exp, p.ordered);
  lastRun[p.id] = r.ok ? "Submitted: accepted" : "Submitted: wrong answer. " + r.why;
  if (r.ok) {
    setStatus(p.id, "solved");
    out.innerHTML = `<div class="verdict good"><b>Accepted</b><span>All ${exp.values.length} rows match the expected output.</span></div><p class="muted">Open the solution to compare approaches and read the common mistakes.</p>`;
  } else {
    setStatus(p.id, "attempted");
    out.innerHTML = `<div class="verdict bad"><b>Not yet</b><span>${esc(r.why)}</span></div><div class="cmp"><div class="pblock"><span class="eyebrow">Your output</span>${resultTable(got)}</div><div class="pblock"><span class="eyebrow">Expected</span>${resultTable(exp)}</div></div>`;
  }
}

/* ---------- solution ---------- */
function askSolution(p) {
  const host = $("#pSolution");
  if (statusOf(p.id) === "solved" || statusOf(p.id) === "viewed") return showSolution(p);
  const more = (hintShown[p.id] || 0) < p.hints.length;
  host.innerHTML = `<div class="confirm"><p><b>See the full solution?</b> ${more ? "A hint often gets you there, and you'll remember it better." : "You've used all the hints, so this is a good time to look."}</p><div class="acts"><button class="btn" type="button" id="pSolYes">Show solution</button>${more ? `<button class="btn quiet" type="button" id="pSolHint">Take a hint instead</button>` : ""}</div></div>`;
  $("#pSolYes").onclick = () => showSolution(p);
  if ($("#pSolHint")) $("#pSolHint").onclick = () => { host.innerHTML = ""; $("#pHint").click(); };
}
function showSolution(p) {
  if (statusOf(p.id) !== "solved") setStatus(p.id, "viewed");
  const x = p.explain;
  const block = (label, body) => `<div class="sblock"><span class="eyebrow">${label}</span>${body}</div>`;
  const codeBlock = (code, id) => `<div class="codewrap"><button class="ghostlink copy" type="button" data-copy="${id}">Copy</button><pre class="code" id="${id}">${esc(code)}</pre></div>`;
  $("#pSolution").innerHTML = `<article class="ans solution"><span class="eyebrow">Solution</span><h3>${esc(p.title)}</h3>
    ${block("Approach", `<p>${esc(x.approach)}</p>`)}
    ${block("Step by step", `<ol class="steps-ol">${x.steps.map((s) => `<li>${md(s).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ol>`)}
    ${block("Solution code", codeBlock(p.solution, "sol-" + p.id))}
    ${x.trace ? block("Walkthrough on the sample data", `<pre class="code">${esc(x.trace)}</pre>`) : ""}
    ${x.alt ? block("Another way", codeBlock(x.alt, "alt-" + p.id)) : ""}
    ${x.sql ? block(p.lang === "sql" ? "Related" : "The same idea in SQL", codeBlock(x.sql, "sql-" + p.id)) : ""}
    ${x.wrong ? block("Why the common wrong answer fails", `${x.trap ? `<p>${esc(x.trap)}</p>` : ""}${codeBlock(x.wrong, "wrong-" + p.id)}`) : ""}
    ${x.complexity ? block("Complexity", `<p>${esc(x.complexity)}</p>`) : ""}
    ${block("Common mistakes", `<ul>${x.pitfalls.map((s) => `<li>${md(s).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>`)}
    ${block("Where you'll use this", `<p>${esc(x.real)}</p>`)}
  </article>`;
  $("#pSolution").scrollIntoView({ behavior: "smooth", block: "start" });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const el = document.getElementById(b.dataset.copy);
  const done = () => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); };
  try {
    navigator.clipboard.writeText(el.textContent).then(done, () => selectText(el));
  } catch (err) { selectText(el); }
});
function selectText(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

/* ---------- AI review ---------- */
async function aiReview(p) {
  const host = $("#pAi"), code = $("#pcode").value;
  if (code.trim() === p.starter.trim() || code.trim().length < 15) { host.innerHTML = `<p class="muted">Write your attempt first. The AI reviews what you've written.</p>`; return; }
  const btn = $("#pAiCheck") || $("#pAiReview");
  if (btn) btn.disabled = true;
  host.innerHTML = `<div class="aifb"><span class="eyebrow">AI review</span><div class="md cursor"><p class="muted">Reading your code…</p></div><p class="muted foot3" style="font-size:12.5px"></p></div>`;
  const body = host.querySelector(".md");
  try {
    const out = await streamChat({
      mode: "codereview", detail, level: level || "work", provider: engine.provider, model: engine.model,
      lang: LANG_LABEL[p.lang], title: p.title, question: p.prompt + (p.example ? "\n\nExample:\n" + p.example : ""),
      code, result: lastRun[p.id] || (p.lang === "sql" ? "Not run yet" : "Not executed (Python is reviewed, not run)"),
      reference: p.solution,
    }, (t) => { body.innerHTML = md(t); });
    body.classList.remove("cursor");
    host.querySelector(".foot3").textContent = `Reviewed by ${out.label} · ${out.model}`;
    if (p.lang !== "sql" && /\*\*verdict:\*\*\s*correct/i.test(out.text)) setStatus(p.id, "solved");
    else setStatus(p.id, "attempted");
  } catch (err) {
    body.classList.remove("cursor");
    body.innerHTML = `<p class="warnnote">Couldn't get a review: ${esc(err.message)}</p>`;
  } finally { if (btn) btn.disabled = false; }
}


/* ---------- problem generator ---------- */
const GEN_TOPICS = ["Surprise me", "Joins and anti joins", "GROUP BY and HAVING", "Ranking and top N per group", "Running totals and moving averages",
  "LAG and LEAD comparisons", "Deduplication", "Gaps and islands", "Cohorts and retention", "Funnels and conversion", "Date and calendar logic",
  "Self joins and hierarchies", "Recursive CTEs", "Point-in-time joins (SCD Type 2)", "Pivoting with CASE", "Medians and percentiles"];
const GEN_DOMAINS = [["any", "Any business"], ["ecom", "E-commerce / D2C"], ["fin", "Fintech / UPI"], ["log", "Logistics"], ["saas", "SaaS"]];
let genForm = Object.assign({ lang: "sql", topic: "Surprise me", diff: "Medium", domain: "fin" }, store.get("genForm", {}));
const GEN_LANGS = [["sql", "SQL"], ["python", "Python"], ["pandas", "pandas"], ["pyspark", "PySpark"]];
const GEN_TOPICS_BY = {
  sql: GEN_TOPICS,
  python: ["Surprise me", "Hash maps and counting", "Sliding windows", "Intervals and scheduling", "Sorting with custom keys", "Heaps and top K",
    "Stream processing and dedup", "Parsing and validating records", "Idempotent loads and upserts", "Dependency graphs and DAG order", "Binary search", "Date and time logic"],
  pandas: ["Surprise me", "groupby and aggregation", "Merges and joins", "Rolling windows and shifts", "Pivot and reshape", "Time series resampling",
    "Cleaning messy data", "Latest record per key", "Sessions and gaps", "Ranking within groups"],
  pyspark: ["Surprise me", "Aggregations", "Joins including anti and semi", "Window ranking", "Running totals, lag and lead", "Deduplication",
    "Gaps and islands", "Point-in-time joins (SCD Type 2)", "Data quality checks", "Cohorts and retention"],
};
let genBusy = false, genLogHTML = "";

function genBoxHTML() {
  if (genForm.lang !== "sql" && !pyAvailable()) genForm.lang = "sql";
  const t = genTarget();
  if (!t) return `<div class="genbox"><h3>Generate fresh problems</h3><p class="muted">Connect an AI provider in settings and the app can write new, automatically checked SQL problems on any pattern.</p><div><button class="btn quiet" type="button" id="genSettings">Open settings</button></div></div>`;
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return `<details class="genbox" id="genBox" ${genBusy || genLogHTML || store.get("genOpen", false) ? "open" : ""}>
    <summary><h3>Generate a fresh problem</h3>${CHEV}</summary>
    <p class="muted">The AI writes an original problem, then the app checks it: the solution must pass its own tests and a typical wrong answer must fail them.</p>
    <div class="genform">
      <label>Language<select id="genLang">${GEN_LANGS.map(([v, l]) => {
        const off = v !== "sql" && !pyAvailable();
        return `<option value="${v}" ${v === genForm.lang ? "selected" : ""} ${off ? "disabled" : ""}>${l}${off ? " (installed app)" : ""}</option>`;
      }).join("")}</select></label>
      <label>Pattern${sel("genTopic", (GEN_TOPICS_BY[genForm.lang] || GEN_TOPICS).map((x) => [x, x]), genForm.topic)}</label>
      <label>Difficulty${sel("genDiff", [["Easy", "Easy"], ["Medium", "Medium"], ["Hard", "Hard"]], genForm.diff)}</label>
      <label>Business${sel("genDomain", GEN_DOMAINS, genForm.domain)}</label>
    </div>
    <div class="genrow"><button class="btn" type="button" id="genGo" ${genBusy ? "disabled" : ""}>${genBusy ? "Working…" : "Generate and check"}</button>
      <span class="genby">Model: <b>${esc(modelLabel(t))}</b> · <button class="ghostlink" type="button" id="genChange">change</button></span></div>
    <div class="genlog" id="genLog" aria-live="polite">${genLogHTML}</div>
  </details>`;
}
function wireGenBox() {
  const box = $("#genBox");
  if (box) box.addEventListener("toggle", () => store.set("genOpen", box.open));
  const go = $("#genGo");
  if ($("#genSettings")) $("#genSettings").onclick = openSheet;
  if (!go) return;
  $("#genChange").onclick = openSheet;
  ["genTopic", "genDiff", "genDomain"].forEach((id) => $("#" + id).addEventListener("change", () => {
    genForm = Object.assign(genForm, { topic: $("#genTopic").value, diff: $("#genDiff").value, domain: $("#genDomain").value });
    store.set("genForm", genForm);
  }));
  $("#genLang").addEventListener("change", (e) => {
    genForm = Object.assign(genForm, { lang: e.target.value, topic: "Surprise me" });
    store.set("genForm", genForm); renderPracticeList();
  });
  go.onclick = generateProblem;
}
function onGenEngineChange() { if (!pView && !$("#view-practice").hidden) renderPracticeList(); }

function setGenLog(html) { genLogHTML = html; const el = $("#genLog"); if (el) el.innerHTML = html; }
const ckRow = (state, label, note) => `<div class="ck ${state}"><b>${state === "ok" ? "✓" : state === "no" ? "✗" : "…"}</b><span>${esc(label)}${note ? ` <small>${esc(note)}</small>` : ""}</span></div>`;

function parseProblem(raw) {
  let t = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return { error: "The reply was not a JSON object." };
  let o;
  try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { error: "The JSON could not be parsed: " + e.message }; }
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  for (const k of ["title", "prompt", "setup", "solution", "wrong_solution"]) if (!str(o[k])) return { error: `The "${k}" field is missing or empty.` };
  const ex = o.explain || {};
  if (!str(ex.approach) || !Array.isArray(ex.steps) || !ex.steps.length) return { error: "The explain.approach or explain.steps field is missing." };
  if (o.setup.length > 12000) return { error: "The setup is too long; keep each table to at most 25 rows." };
  const arr = (v) => (Array.isArray(v) ? v.filter(str).map(String) : []);
  return { p: {
    title: o.title.trim().slice(0, 90),
    diff: ["Easy", "Medium", "Hard"].includes(o.diff) ? o.diff : genForm.diff,
    pattern: str(o.pattern) ? o.pattern.trim().slice(0, 40) : genForm.topic,
    prompt: o.prompt, setup: o.setup, ordered: o.ordered !== false,
    starter: str(o.starter) ? o.starter : "-- Write your query here\n",
    solution: o.solution.trim(), hints: arr(o.hints).slice(0, 3),
    explain: { approach: ex.approach, steps: arr(ex.steps), trace: str(ex.trace) ? ex.trace : "", pitfalls: arr(ex.pitfalls),
      real: str(ex.real) ? ex.real : "", wrong: o.wrong_solution.trim(), trap: str(o.trap) ? o.trap : "" },
  } };
}

function verifyProblem(SQL, p) {
  const checks = [];
  const add = (ok, label, note) => { checks.push({ ok, label, note }); return ok; };
  const fail = (msg) => ({ ok: false, checks, error: msg });
  // 1. tables load and have enough rows
  let tables = [];
  try {
    tables = tableNames(p.setup);
    const db = new SQL.Database(); db.run(p.setup);
    const counts = tables.map((t) => db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0]);
    db.close();
    if (!tables.length) throw new Error("no CREATE TABLE statements");
    if (counts.some((c) => c < 3)) throw new Error("each table needs at least 3 rows");
    add(true, "Tables load", tables.map((t, i) => `${t}: ${counts[i]} rows`).join(", "));
  } catch (e) { add(false, "Tables load", e.message); return fail("The setup SQL failed in SQLite: " + e.message); }
  // 2. reference solution runs and returns rows
  let exp;
  try { exp = runSql(SQL, p.setup, p.solution); } catch (e) { add(false, "Solution runs", e.message); return fail("The reference solution failed in SQLite: " + e.message); }
  if (!exp || !exp.values.length) { add(false, "Solution returns rows", "empty result"); return fail("The reference solution returned no rows on the sample data."); }
  if (exp.values.length > 200) { add(false, "Solution returns rows", exp.values.length + " rows"); return fail("The expected output is too large; keep it under 200 rows."); }
  add(true, "Solution runs", `${exp.values.length} rows × ${exp.columns.length} columns`);
  // 3. deterministic order when order matters
  let top = p.solution;                                   // strip (...) groups so only the outer query's clauses remain
  for (let i = 0; i < 8; i++) top = top.replace(/\([^()]*\)/g, " ");
  if (p.ordered && !/order\s+by/i.test(top)) {
    add(false, "Sort order is defined", "missing final ORDER BY"); return fail("The task says order matters but the solution has no final ORDER BY.");
  }
  add(true, "Sort order is defined", p.ordered ? "final ORDER BY present" : "order-insensitive");
  // 4. the typical wrong answer must fail on this data
  let wrong;
  try { wrong = runSql(SQL, p.setup, p.explain.wrong); } catch (e) { add(false, "Wrong answer is caught", "it errors instead"); return fail("wrong_solution must run without error but failed: " + e.message); }
  const cmp = compare(wrong, exp, p.ordered);
  if (cmp.ok) { add(false, "Wrong answer is caught", "it returns the same result"); return fail("wrong_solution returns the same result as the solution, so the data does not expose the trap. Add rows that make it differ."); }
  add(true, "Wrong answer is caught", cmp.why.replace(/^Expected/, "expected").replace(/your query/, "it"));
  return { ok: true, checks };
}

function parsePyProblem(raw, lang) {
  let t = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return { error: "The reply was not a JSON object." };
  let o;
  try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { error: "The JSON could not be parsed: " + e.message }; }
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  for (const k of ["title", "prompt", "entry", "solution", "wrong_solution"]) if (!str(o[k])) return { error: `The "${k}" field is missing or empty.` };
  if (!/^[A-Za-z_]\w*$/.test(o.entry.trim())) return { error: "entry must be a plain function name." };
  if (!Array.isArray(o.tests) || o.tests.length < 4) return { error: "Provide at least 4 tests." };
  const tests = o.tests.filter((x) => x && str(x.call)).slice(0, 8).map((x, i) => ({
    name: str(x.name) ? x.name.slice(0, 80) : `Test ${i + 1}`, setup: str(x.setup) ? x.setup : "", call: x.call,
    ...(str(x.observe) ? { observe: x.observe } : {}), hidden: !!x.hidden,
  }));
  if (tests.length < 4) return { error: "Each test needs a \"call\" expression; at least 4 are required." };
  if (!tests.some((x) => !x.hidden)) { tests[0].hidden = false; tests[1].hidden = false; }
  if (tests.every((x) => !x.hidden)) tests.slice(2).forEach((x) => (x.hidden = true));
  const ex = o.explain || {};
  if (!str(ex.approach) || !Array.isArray(ex.steps) || !ex.steps.length) return { error: "The explain.approach or explain.steps field is missing." };
  const arr = (v) => (Array.isArray(v) ? v.filter(str).map(String) : []);
  return { p: {
    lang, title: o.title.trim().slice(0, 90),
    diff: ["Easy", "Medium", "Hard"].includes(o.diff) ? o.diff : genForm.diff,
    pattern: str(o.pattern) ? o.pattern.trim().slice(0, 40) : genForm.topic,
    prompt: o.prompt, example: str(o.example) ? o.example : "", entry: o.entry.trim(), tests, ordered: true,
    starter: str(o.starter) ? o.starter : `def ${o.entry.trim()}():\n    pass\n`,
    solution: o.solution.trim(), hints: arr(o.hints).slice(0, 3),
    explain: { approach: ex.approach, steps: arr(ex.steps), complexity: str(ex.complexity) ? ex.complexity : "", pitfalls: arr(ex.pitfalls),
      real: str(ex.real) ? ex.real : "", wrong: o.wrong_solution.trim(), trap: str(o.trap) ? o.trap : "" },
  } };
}

async function verifyPyProblem(p, onStatus) {
  const checks = [];
  const add = (ok, label, note) => { checks.push({ ok, label, note }); return ok; };
  const fail = (msg) => ({ ok: false, checks, error: msg });
  const base = { lang: p.lang, entry: p.entry, ordered: true, reference: p.solution };
  let r;
  try { r = await pyRun({ ...base, entry: null, code: p.starter, tests: [] }, onStatus); }
  catch (e) { add(false, "Starter code compiles", e.message); return fail("Running the starter failed: " + e.message); }
  if (r.error) { add(false, "Starter code compiles", r.error); return fail("The starter code doesn't compile: " + r.error); }
  add(true, "Starter code compiles");
  try { r = await pyRun({ ...base, code: p.solution, tests: p.tests }, onStatus); }
  catch (e) { add(false, "Solution passes its tests", e.message); return fail("Running the solution failed: " + e.message); }
  if (r.error) { add(false, "Solution passes its tests", r.error); return fail("The reference solution failed to load: " + r.error); }
  const bad = r.tests.filter((t) => !t.ok);
  if (bad.length) {
    add(false, "Solution passes its tests", `${bad.length} of ${r.tests.length} failed`);
    return fail(`The reference solution failed or gave different results on repeated runs for: ${bad.map((t) => `"${t.name}" (${t.error || "non-deterministic output"})`).join("; ")}. Fix the solution or those tests.`);
  }
  add(true, "Solution passes its tests", `${r.tests.length} tests, each run twice`);
  try { r = await pyRun({ ...base, code: p.explain.wrong, tests: p.tests }, onStatus); }
  catch (e) { add(false, "Wrong answer is caught", e.message); return fail("Running wrong_solution failed: " + e.message); }
  if (r.error) { add(false, "Wrong answer is caught", "it doesn't load"); return fail("wrong_solution must load and run, but: " + r.error); }
  const caught = r.tests.filter((t) => !t.ok && !t.error);
  if (!caught.length) {
    add(false, "Wrong answer is caught", r.tests.some((t) => !t.ok) ? "it only crashes" : "it passes every test");
    return fail("wrong_solution must return a different result (not crash) on at least one test, so the tests prove the trap. Add a test that exposes it.");
  }
  add(true, "Wrong answer is caught", `fails "${caught[0].name}"`);
  return { ok: true, checks };
}

async function generateProblem() {
  if (genBusy) return;
  const t = genTarget();
  if (!t) return openSheet();
  genBusy = true; renderPracticeList();
  const lang = genForm.lang || "sql", topics = GEN_TOPICS_BY[lang] || GEN_TOPICS;
  const topic = genForm.topic === "Surprise me" ? topics[1 + Math.floor(Math.random() * (topics.length - 1))] : genForm.topic;
  let SQL;
  if (lang === "sql") {
    try { SQL = await loadSql(); }
    catch (e) { genBusy = false; renderPracticeList(); setGenLog(ckRow("no", "The SQL engine couldn't load, so problems can't be checked right now.")); return; }
  }

  let raw = "", err = "", prob = null, by = "", lines = [];
  const show = (extra) => setGenLog(lines.join("") + (extra || ""));
  for (let attempt = 0; attempt < 2 && !prob; attempt++) {
    const head = attempt ? ckRow("run", "Fixing it", err.slice(0, 140)) : ckRow("run", `Writing a ${genForm.diff.toLowerCase()} ${LANG_LABEL[lang]} problem: ${topic.toLowerCase()}`);
    show(head);
    const payload = { mode: "generate", lang, provider: t.provider, model: t.model, topic, difficulty: genForm.diff, domain: genForm.domain, avoid: allProblems().map((x) => x.title) };
    if (attempt) Object.assign(payload, { previous: raw, error: err });
    try {
      const out = await streamChat(payload, (txt) => show(head.replace("</span></div>", ` <small>${txt.length.toLocaleString()} characters</small></span></div>`)));
      raw = out.text; by = `${out.label} · ${out.model}`;
    } catch (e) {
      lines.push(ckRow("no", "The model couldn't write a problem", e.message)); show(); break;
    }
    lines.push(ckRow("ok", attempt ? "Rewrote the problem" : "Wrote the problem"));
    const parsed = lang === "sql" ? parseProblem(raw) : parsePyProblem(raw, lang);
    if (parsed.error) { err = parsed.error; lines.push(ckRow("no", "Format check", err)); show(); continue; }
    const v = lang === "sql" ? verifyProblem(SQL, parsed.p) : await verifyPyProblem(parsed.p, (m) => show(ckRow("run", m)));
    v.checks.forEach((c) => lines.push(ckRow(c.ok ? "ok" : "no", c.label, c.note)));
    show();
    if (v.ok) prob = parsed.p; else err = v.error;
  }
  genBusy = false;
  if (!prob) {
    lines.push(ckRow("no", "No problem saved", "It didn't pass every check. Try again, or pick another pattern or a larger model."));
    genLogHTML = lines.join(""); renderPracticeList(); return;
  }
  const id = "gen-" + Date.now().toString(36);
  Object.assign(prob, { id, lang, track: lang === "sql" ? "da" : "de", generated: true, by, created: new Date().toISOString() });
  GEN.unshift(prob); PM[id] = prob;
  if (GEN.length > 40) { const old = GEN.pop(); delete PM[old.id]; }
  store.set("gen", GEN);
  lines.push(ckRow("ok", "Saved to your problems")); genLogHTML = lines.join("");
  pView = id; renderProblem(id); window.scrollTo({ top: 0 });
}
function deleteGenerated(id) {
  GEN = GEN.filter((p) => p.id !== id); delete PM[id]; delete PSTATE[id];
  store.set("gen", GEN); pSave();
  if (pView === id) pView = null;
  renderPracticeList();
}

/* ---------- wiring ---------- */
function renderPractice() { pView ? renderProblem(pView) : renderPracticeList(); }
function openProblem(id) { if (!PM[id]) return; pView = id; showView("practice"); window.scrollTo({ top: 0 }); }
$("#pracBoard").addEventListener("click", (e) => {
  const f = e.target.closest("[data-pf]");
  if (f) { pFilter = f.dataset.pf; store.set("pfilter", pFilter); renderPracticeList(); return; }
  const d = e.target.closest("[data-del]");
  if (d) { deleteGenerated(d.dataset.del); return; }
  const o = e.target.closest("[data-open]");
  if (o) { pView = o.dataset.open; renderProblem(pView); window.scrollTo({ top: 0 }); return; }
  if (e.target.closest("[data-back]")) { pView = null; renderPracticeList(); window.scrollTo({ top: 0 }); }
});
if (location.hash.slice(1) === "practice") showView("practice");
