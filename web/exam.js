/* Datakul exam prep (beta): certification practice built on web/certs.js.
   A learner sets an exam date, takes a short diagnostic, practises by exam section and sits timed mock exams.
   Readiness per section comes from their last 10 answers in it. Everything is stored in this browser (dp_cert).
   Questions are original, written from the public exam guide; options are shuffled each time. */
"use strict";

const CS = Object.assign({ date: {}, att: [], mocks: [] }, store.get("cert", {}));
const csSave = () => { CS.att = CS.att.slice(-3000); CS.mocks = CS.mocks.slice(-30); store.set("cert", CS); };
let certId = (typeof CERTS !== "undefined" && CERTS[0] && CERTS[0].id) || null;
let sess = null, timerT = null, cStudy = null; // cStudy: id of the section whose study chapter is open
const certOf = () => CERTS.find((c) => c.id === certId);
const qById = (c, id) => c.questions.find((q) => q.id === id);
const domOf = (c, id) => c.domains.find((d) => d.id === id);
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const READY_N = 8, READY_ACC = 75, WINDOW = 10;

/* ---------- fresh questions: the gateway writes new ones every night; they are cached here so they work offline ---------- */
const CQ_GW = ((window.DATAKUL_CONFIG && window.DATAKUL_CONFIG.gatewayUrl) || "").replace(/\/+$/, "");
const cqStr = (v, n) => (typeof v === "string" && v.length <= n ? v : "");
function certqAdd(c, list) {
  let added = 0;
  const have = new Set(c.questions.map((q) => q.id));
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x.id !== "string" || !x.id.startsWith(c.id + "-n-") || have.has(x.id) || !domOf(c, x.d)) continue;
    if (!cqStr(x.q, 700) || !cqStr(x.why, 1000) || !Array.isArray(x.opts) || x.opts.length < 3 || x.opts.length > 5 || x.opts.some((o) => !cqStr(o, 300))) continue;
    if (!Array.isArray(x.ans) || !x.ans.length || x.ans.length > 3 || x.ans.some((a) => !Number.isInteger(a) || a < 0 || a >= x.opts.length)) continue;
    c.questions.push({ id: x.id, d: x.d, q: x.q, opts: x.opts.slice(), ans: x.ans.slice(), why: x.why, ai: 1, nw: Number(x.n) || 0 });
    have.add(x.id); added++;
  }
  return added;
}
(function () { // questions from the last visit are in the bank before anything is drawn
  const saved = store.get("certq", {});
  if (typeof CERTS !== "undefined") CERTS.forEach((c) => certqAdd(c, saved[c.id]));
})();
async function certqRefresh() {
  if (!CQ_GW || CQ_GW.startsWith("preview:") || typeof CERTS === "undefined") return;
  const saved = store.get("certq", {});
  let added = 0;
  for (const c of CERTS) {
    try {
      const r = await fetch(CQ_GW + "/api/certq?cert=" + encodeURIComponent(c.id), { cache: "no-cache" }); // always asks the gateway; an unchanged list comes back as a tiny 304
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j.questions)) continue;
      saved[c.id] = j.questions; // a question the owner withdrew drops out of the cache here, and from the bank on the next visit
      added += certqAdd(c, j.questions);
    } catch (e) {}
  }
  store.set("certq", saved);
  if (added && !sess && typeof renderCert === "function" && document.querySelector("#view-cert:not([hidden])")) renderCert();
}
window.certqRefresh = certqRefresh;

/* ---------- readiness: the last 10 answers in each section ---------- */
function readiness(c) {
  const byQ = new Map(c.questions.map((q) => [q.id, q.d]));
  return c.domains.map((d) => {
    const mine = CS.att.filter((a) => byQ.get(a.q) === d.id).slice(-WINDOW);
    const n = mine.length, ok = mine.filter((a) => a.ok).length, acc = n ? Math.round((100 * ok) / n) : 0;
    const status = n < 4 ? "new" : n >= READY_N && acc >= READY_ACC ? "ready" : "building";
    return { ...d, n, acc, status };
  });
}
function overall(rd) {
  const ready = rd.filter((r) => r.status === "ready").length;
  const weighted = Math.round(rd.reduce((s, r) => s + r.w * Math.min(1, r.n ? r.acc / READY_ACC : 0) * Math.min(1, r.n / READY_N), 0));
  return { ready, all: ready === rd.length, weighted };
}
// Today's focus: the not-yet-ready section that matters most (exam weight x how far from ready).
function focusDomain(rd) {
  const open = rd.filter((r) => r.status !== "ready");
  if (!open.length) return null;
  return open.slice().sort((a, b) => b.w * (100 - (b.n ? b.acc : 0)) - a.w * (100 - (a.n ? a.acc : 0)))[0];
}

/* ---------- picking questions ---------- */
function lastAtt(id) { for (let i = CS.att.length - 1; i >= 0; i--) if (CS.att[i].q === id) return CS.att[i]; return null; }
function pickPractice(c, dom, n) {
  const pool = c.questions.filter((q) => !dom || q.d === dom);
  const score = (q) => { const a = lastAtt(q.id); return !a ? 0 : !a.ok ? 1 : 2 + a.t / 1e13; }; // unseen, then missed, then oldest
  return shuffle(pool).sort((a, b) => score(a) - score(b)).slice(0, n).map((q) => q.id);
}
function pickDiag(c) { return c.domains.flatMap((d) => shuffle(c.questions.filter((q) => q.d === d.id)).slice(0, 2).map((q) => q.id)); }
// Mock: the exam's section mix (largest remainder), limited by what the bank holds.
function pickMock(c) {
  const N = Math.min(c.scored, c.questions.length);
  const have = Object.fromEntries(c.domains.map((d) => [d.id, c.questions.filter((q) => q.d === d.id).length]));
  const raw = c.domains.map((d) => ({ id: d.id, x: (N * d.w) / 100 }));
  const take = Object.fromEntries(raw.map((r) => [r.id, Math.min(have[r.id], Math.floor(r.x))]));
  let left = N - Object.values(take).reduce((s, v) => s + v, 0);
  const order = raw.slice().sort((a, b) => (b.x % 1) - (a.x % 1));
  for (let guard = 0; left > 0 && guard < 100; guard++) for (const r of order) { if (left > 0 && take[r.id] < have[r.id]) { take[r.id]++; left--; } }
  return shuffle(c.domains.flatMap((d) => shuffle(c.questions.filter((q) => q.d === d.id)).slice(0, take[d.id]).map((q) => q.id)));
}

/* ---------- sessions ---------- */
function startSession(mode, dom) {
  const c = certOf(); cStudy = null;
  const ids = mode === "mock" ? pickMock(c) : mode === "diag" ? pickDiag(c) : pickPractice(c, dom, 10);
  sess = { mode, dom, ids, k: 0, picks: {}, checked: {}, order: Object.fromEntries(ids.map((id) => [id, shuffle(qById(c, id).opts.map((_, i) => i))])), start: Date.now() };
  if (mode === "mock") { sess.secs = Math.round((c.minutes * 60 * ids.length) / c.scored); startTimer(); }
  renderCert(); window.scrollTo({ top: 0 });
}
function startTimer() {
  clearInterval(timerT);
  timerT = setInterval(() => {
    if (!sess || sess.mode !== "mock" || sess.done) { clearInterval(timerT); return; }
    const left = sess.secs - Math.floor((Date.now() - sess.start) / 1000);
    const el = $("#cTimer");
    if (el) { el.textContent = fmtTime(Math.max(0, left)); el.classList.toggle("low", left < 300); }
    if (left <= 0) { clearInterval(timerT); finishMock(true); }
  }, 1000);
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const sameAns = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
function record(id, ok, mode) { CS.att.push({ q: id, ok: ok ? 1 : 0, t: Date.now(), m: mode === "mock" ? "m" : "p" }); }

function finishPractice() {
  const c = certOf();
  const ok = sess.ids.filter((id) => sameAns(sess.picks[id] || [], qById(c, id).ans)).length;
  sess.done = true; sess.score = ok;
  csSave();
  if (typeof award === "function") { award(sess.mode === "diag" ? 30 : 20, (sess.mode === "diag" ? "Diagnostic done: " : "Practice set done: ") + c.short); if (typeof qsSave === "function") qsSave(); if (typeof refreshChrome === "function") refreshChrome(); }
  renderCert();
}
function finishMock(timeUp) {
  const c = certOf();
  sess.ids.forEach((id) => record(id, sameAns(sess.picks[id] || [], qById(c, id).ans), "mock"));
  const by = {};
  c.domains.forEach((d) => { const ids = sess.ids.filter((id) => qById(c, id).d === d.id); if (ids.length) by[d.id] = Math.round((100 * ids.filter((id) => sameAns(sess.picks[id] || [], qById(c, id).ans)).length) / ids.length); });
  const ok = sess.ids.filter((id) => sameAns(sess.picks[id] || [], qById(c, id).ans)).length;
  CS.mocks.push({ c: c.id, t: Date.now(), n: sess.ids.length, ok, pct: Math.round((100 * ok) / sess.ids.length), by, secs: Math.round((Date.now() - sess.start) / 1000) });
  sess.done = true; sess.score = ok; sess.timeUp = !!timeUp; sess.review = null;
  clearInterval(timerT);
  csSave();
  if (typeof award === "function") { award(60, "Mock exam done: " + c.short); if (typeof qsSave === "function") qsSave(); if (typeof refreshChrome === "function") refreshChrome(); }
  renderCert(); window.scrollTo({ top: 0 });
}

/* ---------- rendering ---------- */
function renderCert() {
  const host = $("#certBoard");
  if (!host) return;
  if (typeof CERTS === "undefined" || !CERTS.length) { host.innerHTML = `<p class="muted">No certifications yet.</p>`; return; }
  if (cStudy && !sess) { const d = domOf(certOf(), cStudy); if (d && d.study) { host.innerHTML = certStudyHTML(certOf(), d); return; } cStudy = null; }
  if (sess && !sess.done) { host.innerHTML = certQuestionHTML(); return; }
  if (sess && sess.done) { host.innerHTML = certResultHTML(); return; }
  host.innerHTML = certHomeHTML();
}
const bankNew = (c) => c.questions.filter((q) => q.nw && Date.now() - q.nw < 7 * 864e5).length;
function certHomeHTML() {
  const c = certOf(), rd = readiness(c), ov = overall(rd), f = focusDomain(rd);
  const date = CS.date[c.id] || "", days = date ? Math.ceil((Date.parse(date + "T00:00:00") - Date.parse(today() + "T00:00:00")) / 864e5) : null;
  const started = CS.att.some((a) => c.questions.some((q) => q.id === a.q));
  const mocks = CS.mocks.filter((m) => m.c === c.id).slice(-5).reverse();
  const plan = !date ? "Set your exam date and Datakul plans your practice backwards from it."
    : days < 0 ? "Your exam date has passed. Set a new one if you're rebooking."
    : ov.all ? `${days} day${days === 1 ? "" : "s"} to go and every section is ready. Keep sharp with a mock exam every few days.`
    : f ? `${days} day${days === 1 ? "" : "s"} to go. Today: 10 questions on ${f.name}${days > 0 ? `, then about ${Math.max(10, Math.ceil(((rd.length - ov.ready) * 10) / Math.max(1, days)))} a day` : ""}.` : "";
  return `<div class="certwrap">
    <div class="card certhead"><span class="eyebrow">Certifications · beta</span><h1>${esc(c.name)}</h1>
      <div class="cfacts"><span><b>${c.scored}</b> questions</span><span><b>${c.minutes}</b> minutes</span><span><b>${esc(c.fee)}</b></span><span>valid <b>${esc(c.valid)}</b></span></div>
      <p class="muted cdisc">Practice bank: <b>${c.questions.length}</b> questions${bankNew(c) ? `, ${bankNew(c)} added in the last 7 days` : ""}. New ones arrive every day. Those marked "AI-written" are written by AI from the public exam guide and checked automatically, so treat the official guide as the final word.</p>
      <p class="muted cdisc">${esc(c.disclaimer)} Based on the <a href="${esc(c.guideUrl)}" target="_blank" rel="noopener">official exam guide</a> (${esc(c.guide)}); check it again two weeks before your exam.</p></div>
    <div class="card cplan"><div class="cplanrow"><label class="lab" for="cDate">Your exam date<input type="date" id="cDate" value="${esc(date)}" min="${today()}"></label>${date && days >= 0 ? `<div class="cdays"><b>${days}</b><span>day${days === 1 ? "" : "s"} left</span></div>` : ""}</div><p>${esc(plan)}</p>
      <div class="acts">${!started ? `<button class="btn" type="button" data-cstart="diag">Start the diagnostic (${c.domains.length * 2} questions)</button>` : f ? `<button class="btn" type="button" data-cstart="practice" data-cdom="${f.id}">Practise ${esc(f.name)}</button>` : ""}<button class="btn ${started ? "" : "quiet"}" type="button" data-cstart="mock">Take a mock exam (${Math.min(c.scored, c.questions.length)} questions, ${Math.round((c.minutes * Math.min(c.scored, c.questions.length)) / c.scored)} min)</button></div></div>
    <div class="card"><div class="sech" style="margin:0"><h3>Readiness by exam section</h3><span class="muted">${ov.all ? "Ready to book" : `${ov.ready} of ${rd.length} ready`}</span></div>
      <p class="muted" style="font-size:13.5px">A section is ready when you've answered at least ${READY_N} of its questions recently and got ${READY_ACC}% or more of your last ${WINDOW} right. Book the exam when every section is ready.</p>
      <div class="crd">${rd.map((r) => `<div class="crow"><div class="cname"><b>${esc(r.name)}</b><small>${r.w}% of the exam · ${r.n ? `${r.acc}% of your last ${r.n}` : "not started"}</small></div><div class="cbar ${r.status}" role="img" aria-label="${r.n ? r.acc + "% correct" : "not started"}"><i style="width:${r.n ? r.acc : 0}%"></i><em style="left:${READY_ACC}%"></em></div><span class="cst ${r.status}">${{ new: "Not started", building: "Building", ready: "Ready" }[r.status]}</span><span class="cbtns">${r.study ? `<button class="ghostlink" type="button" data-cstudy="${r.id}">Study</button>` : ""}<button class="ghostlink" type="button" data-cstart="practice" data-cdom="${r.id}">Practise</button></span></div>`).join("")}</div></div>
    ${mocks.length ? `<div class="card"><div class="sech" style="margin:0"><h3>Your mock exams</h3><span class="muted">aim for 80% or more</span></div><ul class="cmocks">${mocks.map((m) => `<li><b>${m.pct}%</b><span>${m.ok} of ${m.n} right · ${fmtTime(m.secs)} · ${new Date(m.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>`).join("")}</ul><p class="muted" style="font-size:12.5px">Databricks doesn't publish a pass mark. 80% in mocks is Datakul's suggested safety margin, not an official figure.</p></div>` : ""}
  </div>`;
}
/* ---------- study chapters: Schaum-style notes per exam section (content/certs/study/*.json) ---------- */
const cLink = (l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)}</a>`;
const cMore = (q) => (q.more ? `<p class="cmore">Read more: ${cLink(q.more)} <span class="muted">(Databricks docs)</span></p>` : "");
function certStudyHTML(c, d) {
  const s = d.study, mine = c.questions.filter((q) => q.d === d.id).length;
  const fig = (g) => (g && typeof drawDiagram === "function" ? drawDiagram(g) : "");
  const tbl = (t) => `<div class="stbl"><h4>${esc(t.title)}</h4><div class="swrap"><table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  return `<div class="certwrap study">
    <div class="card"><div class="cqtop"><span class="eyebrow">Study · ${esc(c.short)} · ${d.w}% of the exam</span><button class="ghostlink" type="button" data-cstudyx>Back</button></div>
      <h1>${esc(d.name)}</h1><p>${esc(s.intro)}</p>${fig(s.map)}
      <div class="acts"><button class="btn" type="button" data-cstart="practice" data-cdom="${d.id}">Practise this section (${mine} questions)</button></div></div>
    <div class="card"><h3>What the exam expects</h3><ol class="sexp">${s.expects.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
    <div class="card"><h3>Key ideas</h3><div class="sideas">${s.ideas.map((i, n) => `<div class="sidea${i.fig ? " hasfig" : ""}"><b><span class="snum">${n + 1}</span>${esc(i.t)}</b>${fig(i.fig)}<p>${esc(i.b)}</p></div>`).join("")}</div>${(s.tables || []).map(tbl).join("")}</div>
    <div class="card"><h3>Solved problems</h3><p class="muted" style="font-size:13.5px">Try each one first, then open the working.</p>
      ${s.problems.map((p, i) => `<details class="sprob"><summary><span class="snum">${i + 1}</span><span><b>${esc(p.t)}</b><em>${esc(p.q)}</em></span>${CHEV}</summary><div class="db"><ol>${p.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>${p.code ? `<pre class="ccode"><code>${esc(p.code)}</code></pre>` : ""}<p class="sans"><b>Answer.</b> ${esc(p.answer)}</p></div></details>`).join("")}</div>
    <div class="card"><h3>Mistakes to avoid</h3><ul class="sul smis">${s.mistakes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Read more in the Databricks docs</h3><ul class="slinks">${s.links.map((l) => `<li>${cLink(l)}<span class="muted">${esc(l.why)}</span></li>`).join("")}</ul><p class="muted" style="font-size:12.5px">${esc(s.checked)} ${esc(c.disclaimer)}</p>
      <div class="acts"><button class="btn" type="button" data-cstart="practice" data-cdom="${d.id}">Practise this section</button><button class="btn quiet" type="button" data-cstudyx>Back to certifications</button></div></div>
  </div>`;
}
function certQuestionHTML() {
  const c = certOf(), id = sess.ids[sess.k], q = qById(c, id), d = domOf(c, q.d), multi = q.ans.length > 1;
  const pick = sess.picks[id] || [], checked = sess.checked[id], mock = sess.mode === "mock";
  const title = mock ? "Mock exam" : sess.mode === "diag" ? "Diagnostic" : "Practice · " + d.name;
  const opts = sess.order[id].map((oi) => {
    const on = pick.includes(oi), right = q.ans.includes(oi);
    const cls = checked ? (right ? " right" : on ? " wrong" : "") : on ? " on" : "";
    return `<label class="copt${cls}"><input type="${multi ? "checkbox" : "radio"}" name="cq" value="${oi}" ${on ? "checked" : ""} ${checked ? "disabled" : ""}><span>${esc(q.opts[oi])}</span>${checked && right ? '<b class="cmark">✓</b>' : checked && on ? '<b class="cmark">✗</b>' : ""}</label>`;
  }).join("");
  const answered = sess.ids.filter((x) => (sess.picks[x] || []).length).length;
  const fb = checked ? `<div class="cfb ${sameAns(pick, q.ans) ? "ok" : "no"}"><b>${sameAns(pick, q.ans) ? "Correct." : "Not quite."}</b><p>${esc(q.why)}</p>${q.ai ? `<small class="muted">AI-written, checked automatically.</small>` : ""}${sameAns(pick, q.ans) ? "" : cMore(q)}</div>` : "";
  const nav = mock
    ? `<button class="btn quiet" type="button" data-cnav="-1" ${sess.k === 0 ? "disabled" : ""}>Back</button>${sess.k < sess.ids.length - 1 ? `<button class="btn" type="button" data-cnav="1">Next</button>` : ""}<button class="btn ${sess.k === sess.ids.length - 1 ? "" : "quiet"}" type="button" data-csubmit>Submit exam</button>`
    : checked ? `<button class="btn" type="button" data-cnext>${sess.k < sess.ids.length - 1 ? "Next question" : "See results"}</button>` : `<button class="btn" type="button" data-ccheck ${pick.length ? "" : "disabled"}>Check</button>`;
  return `<div class="certwrap"><div class="card cq">
    <div class="cqtop"><span class="eyebrow">${esc(title)} · ${sess.k + 1} of ${sess.ids.length}</span>${mock ? `<span class="ctimer" id="cTimer" role="timer" aria-label="Time left">${fmtTime(Math.max(0, sess.secs - Math.floor((Date.now() - sess.start) / 1000)))}</span>` : ""}<button class="ghostlink" type="button" data-cquit>${mock ? "Leave" : "Stop"}</button></div>
    <div class="cprog"><i style="width:${(100 * (mock ? answered : sess.k)) / sess.ids.length}%"></i></div>
    ${mock ? "" : `<span class="cdom">${esc(d.name)}</span>`}
    <p class="cqtext">${esc(q.q)}</p>${q.code ? `<pre class="ccode"><code>${esc(q.code)}</code></pre>` : ""}
    ${multi ? `<p class="muted" style="font-size:13px;margin:0">Select ${q.ans.length}.</p>` : ""}
    <fieldset class="copts"><legend class="sr">Answer options</legend>${opts}</fieldset>
    ${fb}<div class="acts">${nav}</div>
    ${mock ? `<div class="cmap" aria-label="Questions">${sess.ids.map((x, i) => `<button type="button" data-cgo="${i}" class="${i === sess.k ? "cur" : ""}${(sess.picks[x] || []).length ? " done" : ""}" aria-label="Question ${i + 1}${(sess.picks[x] || []).length ? ", answered" : ""}">${i + 1}</button>`).join("")}</div>` : ""}
  </div></div>`;
}
function certResultHTML() {
  const c = certOf(), n = sess.ids.length, pct = Math.round((100 * sess.score) / n), mock = sess.mode === "mock";
  const per = c.domains.map((d) => { const ids = sess.ids.filter((id) => qById(c, id).d === d.id); return { d, ids, ok: ids.filter((id) => sameAns(sess.picks[id] || [], qById(c, id).ans)).length }; }).filter((x) => x.ids.length);
  const rd = readiness(c), f = focusDomain(rd);
  const review = sess.ids.map((id, i) => {
    const q = qById(c, id), pick = sess.picks[id] || [], ok = sameAns(pick, q.ans);
    return `<details class="crev ${ok ? "ok" : "no"}"><summary><b class="cmark">${ok ? "✓" : "✗"}</b><span>${i + 1}. ${esc(q.q)}</span>${CHEV}</summary><div class="db">${q.code ? `<pre class="ccode"><code>${esc(q.code)}</code></pre>` : ""}<ul class="crevopts">${q.opts.map((o, oi) => `<li class="${q.ans.includes(oi) ? "right" : pick.includes(oi) ? "wrong" : ""}">${q.ans.includes(oi) ? "✓ " : pick.includes(oi) ? "✗ " : ""}${esc(o)}</li>`).join("")}</ul><p>${esc(q.why)}</p>${ok ? "" : cMore(q)}<small class="muted">${esc(domOf(c, q.d).name)}</small></div></details>`;
  }).join("");
  return `<div class="certwrap"><div class="card cres">
    <span class="eyebrow">${mock ? "Mock exam result" : sess.mode === "diag" ? "Diagnostic result" : "Practice result"}${sess.timeUp ? " · time ran out" : ""}</span>
    <div class="cscore"><b>${pct}%</b><span>${sess.score} of ${n} right${mock ? ` · ${fmtTime(Math.round((Date.now() - sess.start) / 1000) > sess.secs ? sess.secs : Math.round((Date.now() - sess.start) / 1000))}` : ""}</span></div>
    ${mock ? `<p>${pct >= 80 ? "Strong result. If every section shows Ready, you're in good shape to book." : "Keep going: practise the sections below where you dropped marks, then try another mock."}</p>` : ""}
    <div class="crd">${per.map((x) => { const p = Math.round((100 * x.ok) / x.ids.length); return `<div class="crow"><div class="cname"><b>${esc(x.d.name)}</b><small>${x.ok} of ${x.ids.length} right</small></div><div class="cbar ${p >= READY_ACC ? "ready" : "building"}"><i style="width:${p}%"></i><em style="left:${READY_ACC}%"></em></div><span class="cst">${p}%</span><button class="ghostlink" type="button" data-cstart="practice" data-cdom="${x.d.id}">Practise</button></div>`; }).join("")}</div>
    <div class="acts"><button class="btn" type="button" data-chome>Back to certifications</button>${f ? `<button class="btn quiet" type="button" data-cstart="practice" data-cdom="${f.id}">Practise ${esc(f.name)}</button>` : ""}</div>
  </div>
  <div class="card"><h3 style="margin-bottom:8px">Review your answers</h3><div class="crevs">${review}</div></div></div>`;
}

/* ---------- events ---------- */
document.addEventListener("change", (e) => {
  if (e.target.id === "cDate") { const c = certOf(); if (e.target.value) CS.date[c.id] = e.target.value; else delete CS.date[c.id]; csSave(); renderCert(); return; }
  if (e.target.name === "cq" && sess && !sess.done) {
    const id = sess.ids[sess.k];
    sess.picks[id] = [...document.querySelectorAll('#certBoard input[name="cq"]:checked')].map((x) => +x.value);
    const keep = sess.mode === "mock" ? null : e.target.value;
    renderCert();
    if (keep != null) { const el = document.querySelector(`#certBoard input[name="cq"][value="${keep}"]`); if (el) el.focus(); }
  }
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-cstudy],[data-cstudyx],[data-cstart],[data-ccheck],[data-cnext],[data-cnav],[data-cgo],[data-csubmit],[data-cquit],[data-chome]");
  if (!t || !t.closest("#certBoard")) return;
  const c = certOf();
  if (t.dataset.cstudy) { cStudy = t.dataset.cstudy; renderCert(); window.scrollTo({ top: 0 }); return; }
  if (t.hasAttribute("data-cstudyx")) { cStudy = null; renderCert(); window.scrollTo({ top: 0 }); return; }
  if (t.dataset.cstart) { startSession(t.dataset.cstart, t.dataset.cdom); return; }
  if (t.hasAttribute("data-ccheck")) {
    const id = sess.ids[sess.k], q = qById(c, id);
    sess.checked[id] = true; record(id, sameAns(sess.picks[id] || [], q.ans), sess.mode); csSave(); renderCert();
    const fb = $("#certBoard .cfb"); if (fb) fb.scrollIntoView({ block: "nearest" });
    return;
  }
  if (t.hasAttribute("data-cnext")) { if (sess.k < sess.ids.length - 1) { sess.k++; renderCert(); window.scrollTo({ top: 0 }); } else finishPractice(); return; }
  if (t.dataset.cnav) { sess.k = Math.max(0, Math.min(sess.ids.length - 1, sess.k + +t.dataset.cnav)); renderCert(); return; }
  if (t.dataset.cgo) { sess.k = +t.dataset.cgo; renderCert(); return; }
  if (t.hasAttribute("data-csubmit")) {
    const left = sess.ids.filter((x) => !(sess.picks[x] || []).length).length;
    if (left && !t.dataset.sure) { t.dataset.sure = "1"; t.textContent = `${left} unanswered. Submit anyway?`; return; }
    finishMock(false); return;
  }
  if (t.hasAttribute("data-cquit")) {
    if (sess.mode === "mock" && !t.dataset.sure) { t.dataset.sure = "1"; t.textContent = "Leave without a score?"; return; }
    if (sess.mode !== "mock") csSave();
    clearInterval(timerT); sess = null; renderCert(); return;
  }
  if (t.hasAttribute("data-chome")) { sess = null; renderCert(); window.scrollTo({ top: 0 }); }
});
// Loaded after quests.js, which may already have opened this view from the address bar.
if ($("#view-cert") && !$("#view-cert").hidden) renderCert();
if (typeof certqRefresh === "function") certqRefresh();
