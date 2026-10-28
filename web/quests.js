/* Datakul quests: quest-based learning on top of the library.
   - A path is one career track; its modules are chapters; each concept is a quest.
   - A quest has steps: Learn (open the card), Answer (score 60%+ on one of its interview questions), and an optional Code step.
   - Each chapter ends with a boss round (a short mock interview). 60% clears it.
   - XP and levels, a daily streak, three daily quests, badges, and spaced-repetition reviews.
   - Side quests come from what you ask: library topics you keep asking about, and personal study cards the tutor writes
     from questions the library doesn't cover.
   Everything is stored in this browser. Loaded last; uses globals from app.js and practice.js. */
"use strict";

const QS = Object.assign({ xp: 0, ans: {}, boss: {}, skip: {}, rev: {}, int: {}, done: {}, day: null, streak: { last: null, n: 0 }, badges: [], asks: 0, reviews: 0, sel: null }, store.get("qs", {}));
let MY = store.get("mycards", []);
const qsSave = () => store.set("qs", QS);
const myCards = () => MY;

/* ---------- dates ---------- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };

/* ---------- levels ---------- */
const TITLES = [[1, "Shishya"], [3, "Sadhaka"], [6, "Vidvan"], [9, "Acharya"], [12, "Guru"]];
const levelOf = (xp) => { let L = 1; while (50 * L * (L + 1) <= xp) L++; return L; };
const lvlStart = (L) => 50 * (L - 1) * L;
const titleOf = (L) => TITLES.filter(([m]) => L >= m).pop()[1];
const nextTitle = (L) => (TITLES.find(([m]) => m > L) || [0, "Guru"])[1];

/* ---------- paths, chapters, quest state ---------- */
const QI = {}; Q.forEach((q, i) => (QI[q.c] = QI[q.c] || []).push(i));
const probOf = (id) => PROBLEMS.find((p) => p.concept === id);
const pathTrack = () => (F && F.role && F.role.value) || "de";
const clean = (m) => modName(m);
function chapters(t) {
  const out = [];
  C.filter((c) => c.t === t).forEach((c) => {
    const m = c.mod || "Other";
    let ch = out.find((x) => x.mod === m);
    if (!ch) out.push((ch = { mod: m, ids: [] }));
    ch.ids.push(c.id);
  });
  return out;
}
function questState(id) {
  const pr = probOf(id);
  const learn = seen.has(id), answer = (QS.ans[id] || 0) >= 60 || !QI[id];
  return { learn, answer, pr, code: pr ? statusOf(pr.id) === "solved" : null, done: learn && answer };
}
function chapterInfo(chs) {
  return chs.map((ch, i) => {
    const done = ch.ids.filter((id) => questState(id).done).length;
    const ratio = done / ch.ids.length, cleared = (QS.boss[ch.mod] || 0) >= 60;
    return { ...ch, i, done, ratio, cleared, bossOpen: ratio >= 0.6 };
  }).map((ch, i, arr) => ({ ...ch, unlocked: i === 0 || ch.mod === "Community picks" || arr[i - 1].cleared || arr[i - 1].ratio >= 0.6 || !!QS.skip[ch.mod] }));
}
function currentChapter(info) {
  const sel = info.find((c) => c.mod === QS.sel && c.unlocked);
  if (sel) return sel;
  return info.find((c) => c.unlocked && !c.cleared) || info.filter((c) => c.unlocked).pop() || info[0];
}
const nextQuest = (ch) => ch.ids.find((id) => !questState(id).done) || null;

/* ---------- XP, streak, toasts ---------- */
let toastTimer = null;
function toast(html) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.innerHTML = html; t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
function touchStreak() {
  const t = today();
  if (QS.streak.last === t) return;
  QS.streak.n = QS.streak.last === addDays(t, -1) ? QS.streak.n + 1 : 1;
  QS.streak.last = t;
}
function award(n, why, quiet) {
  const before = levelOf(QS.xp);
  QS.xp += n; touchStreak();
  const after = levelOf(QS.xp);
  if (after > before) toast(`<span>Level up! You're Level ${after} · ${titleOf(after)}</span>`);
  else if (!quiet) toast(`<span class="xp">+${n} XP</span><span>${esc(why)}</span>`);
}

/* ---------- daily quests ---------- */
const DAILY = {
  step: { label: "Finish 2 quest steps", goal: 2, xp: 20 },
  answer: { label: "Answer 3 interview questions", goal: 3, xp: 30 },
  ask: { label: "Ask the tutor anything", goal: 1, xp: 10 },
  solve: { label: "Solve 1 coding problem", goal: 1, xp: 40 },
  review: { label: "Do 1 review", goal: 1, xp: 20 },
};
function day() {
  if (!QS.day || QS.day.date !== today()) QS.day = { date: today(), step: 0, answer: 0, ask: 0, solve: 0, review: 0, claimed: [], askXp: 0 };
  return QS.day;
}
const dueReviews = () => Object.entries(QS.rev).filter(([id, r]) => CM[id] && r.due <= today()).map(([id]) => id);
function dailyToday() {
  const seed = [...today()].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const pool = ["answer", "ask", "solve"];
  const list = ["step"];
  if (dueReviews().length) list.push("review");
  for (let k = 0; list.length < 3; k++) list.push(pool[(seed + k) % pool.length]);
  return [...new Set(list)].slice(0, 3);
}
function bumpDaily(key, by = 1) {
  const d = day();
  d[key] = (d[key] || 0) + by;
  const def = DAILY[key];
  if (def && dailyToday().includes(key) && d[key] >= def.goal && !d.claimed.includes(key)) {
    d.claimed.push(key);
    award(def.xp, "Daily quest: " + def.label);
  }
}

/* ---------- badges ---------- */
const solvedBy = (pred) => allProblems().filter((p) => pred(p) && statusOf(p.id) === "solved").length;
const BADGES = [
  { id: "first", name: "First quest", short: "1st", cls: "", test: () => Object.keys(QS.done).length >= 1 },
  { id: "ten", name: "Ten quests", short: "10", cls: "b2", test: () => Object.keys(QS.done).length >= 10 },
  { id: "fifty", name: "Fifty quests", short: "50", cls: "b3", test: () => Object.keys(QS.done).length >= 50 },
  { id: "boss", name: "Boss beaten", short: "BOSS", cls: "", test: () => Object.values(QS.boss).some((v) => v >= 60) },
  { id: "streak7", name: "7-day streak", short: "7d", cls: "b2", test: () => QS.streak.n >= 7 },
  { id: "streak30", name: "30-day streak", short: "30d", cls: "b3", test: () => QS.streak.n >= 30 },
  { id: "sql5", name: "SQL slayer", short: "SQL", cls: "", test: () => solvedBy((p) => p.lang === "sql") >= 5 },
  { id: "py3", name: "Pythonista", short: "PY", cls: "b2", test: () => solvedBy((p) => p.lang !== "sql") >= 3 },
  { id: "curious", name: "Curious mind", short: "ASK", cls: "b3", test: () => QS.asks >= 25 },
  { id: "recall", name: "Never forget", short: "REV", cls: "", test: () => QS.reviews >= 10 },
];
function checkBadges() {
  BADGES.forEach((b) => {
    if (!QS.badges.includes(b.id) && b.test()) { QS.badges.push(b.id); setTimeout(() => toast(`<span>Badge earned: <b>${esc(b.name)}</b></span>`), 900); }
  });
}

/* ---------- reviews (spaced repetition) ---------- */
const GAPS = [1, 3, 7, 16, 35, 90];
function scheduleReview(id, pct) {
  const r = QS.rev[id];
  const wasDue = r && r.due <= today();
  if (!r) { if (pct >= 60) QS.rev[id] = { n: 0, due: addDays(today(), GAPS[0]) }; return false; }
  if (!wasDue) return false;
  if (pct >= 60) { r.n = Math.min(r.n + 1, GAPS.length - 1); r.due = addDays(today(), GAPS[r.n]); } else { r.n = 0; r.due = addDays(today(), 1); }
  return true;
}

/* ---------- events from the rest of the app ---------- */
function questEvent(type, d) {
  try {
    if (type === "learn" && d.fresh && CM[d.id]) { award(15, "Learned: " + CM[d.id].title); bumpDaily("step"); }
    else if (type === "taught" && CM[d.c]) {
      // studied the model answer: bring the topic back tomorrow so the answer sticks
      const r = QS.rev[d.c], tmr = addDays(today(), 1);
      if (!r) QS.rev[d.c] = { n: 0, due: tmr };
      else if (r.due > tmr) { r.n = 0; r.due = tmr; }
    }
    else if (type === "answer" && CM[d.c]) {
      const id = d.c, prev = QS.ans[id] || 0;
      QS.ans[id] = Math.max(prev, d.pct);
      bumpDaily("answer");
      const reviewed = scheduleReview(id, d.pct);
      if (reviewed) { QS.reviews++; bumpDaily("review"); if (d.pct >= 60) award(15, "Review done: " + CM[id].title); }
      else if (d.pct >= 60 && prev < 60) { award(d.pct >= 80 ? 40 : 30, "Answered: " + CM[id].title); bumpDaily("step"); }
      if (questState(id).done && !QS.done[id]) { QS.done[id] = today(); setTimeout(() => award(25, "Quest complete: " + CM[id].title), 1200); }
    } else if (type === "solve") {
      const p = PM[d.id];
      award(40, "Solved: " + (p ? p.title : "a problem")); bumpDaily("solve");
      if (p && p.concept) bumpDaily("step");
    } else if (type === "ask") {
      QS.asks++; const dd = day();
      if (dd.askXp < 5) { dd.askXp++; award(5, "Asked the tutor", true); }
      bumpDaily("ask");
    } else if (type === "interest" && CM[d.id]) QS.int[d.id] = (QS.int[d.id] || 0) + 1;
    else if (type === "boss") {
      const prev = QS.boss[d.mod] || 0;
      QS.boss[d.mod] = Math.max(prev, d.avg);
      if (d.avg >= 60 && prev < 60) { award(100, "Boss beaten: " + clean(d.mod)); QS.sel = null; }
    }
    checkBadges();
    qsSave();
    refreshChrome();
    if (!$("#view-quests").hidden) renderQuests();
  } catch (e) { /* progress tracking must never break learning */ }
}

/* ---------- moving between quest steps ---------- */
function goAnswer(id) {
  const qs = QI[id] || [];
  if (!qs.length) { openConcept(id); return; }
  const fresh = qs.find((i) => !(QS.lastQ || {})[i]) ?? qs[0];
  QS.lastQ = Object.assign(QS.lastQ || {}, { [fresh]: 1 });
  focusId = id; openQ = fresh;
  showView("interview");
  requestAnimationFrame(() => { const row = $("#qr-" + fresh); if (row) row.scrollIntoView({ behavior: "smooth", block: "center" }); });
}
function questStep(id) {
  const st = questState(id);
  if (!st.learn) openConcept(id);
  else if (!st.answer) goAnswer(id);
  else if (st.pr && !st.code) openProblem(st.pr.id);
  else openConcept(id);
}
function startBoss(mod) {
  const ch = chapters(pathTrack()).find((c) => c.mod === mod);
  if (!ch) return;
  const withQ = ch.ids.filter((id) => QI[id]);
  const step = Math.max(1, withQ.length / 5);
  const pick = [];
  for (let k = 0; k < withQ.length && pick.length < 5; k += step) pick.push(QI[withQ[Math.floor(k)]][(QS.boss[mod] ? 1 : 0) % QI[withQ[Math.floor(k)]].length]);
  mock = { qs: [...new Set(pick)], k: 0, sc: [], boss: mod };
  showView("interview");
  renderMock();
}
function questAct(o) {
  if (o.a === "qgo" || o.a === "qstep") questStep(o.id);
  else if (o.a === "qans") goAnswer(o.id);
  else if (o.a === "qreview") goAnswer(o.id);
  else if (o.a === "quests") { showView("quests"); window.scrollTo({ top: 0 }); }
  else if (o.a === "qboss") {
    const info = chapterInfo(chapters(pathTrack())), ch = info.find((c) => c.mod === o.mod);
    if (ch && ch.bossOpen) startBoss(o.mod);
    else if (ch) lockMsg(`The boss round opens once you finish ${Math.ceil(ch.ids.length * 0.6) - ch.done} more quest${Math.ceil(ch.ids.length * 0.6) - ch.done === 1 ? "" : "s"} in this chapter.`);
  } else if (o.a === "qch") {
    const info = chapterInfo(chapters(pathTrack())), ch = info.find((c) => c.mod === o.mod);
    if (!ch) return;
    if (ch.unlocked) { QS.sel = o.mod; qsSave(); renderQuests(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else lockMsg(`<b>${esc(clean(o.mod))}</b> unlocks when you clear the chapter before it. Already know this material?`, o.mod);
  } else if (o.a === "qskip") { QS.skip[o.mod] = true; QS.sel = o.mod; qsSave(); renderQuests(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  else if (o.a === "mycard") openMyCard(o.id);
}
function lockMsg(html, skipMod) {
  const el = $("#qMsg");
  if (!el) return;
  el.innerHTML = `<div class="lockmsg"><span>${html}</span>${skipMod ? `<div class="acts"><button class="btn quiet" type="button" ${act({ a: "qskip", mod: skipMod })}>Unlock it anyway</button></div>` : ""}</div>`;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* quest prompt shown on concept cards and grounded AI answers */
function questCTA(id) {
  if (!CM[id]) return "";
  const st = questState(id);
  if (!st.answer) return `<div class="questcta"><span>Quest step: answer one interview question on this · +30 XP</span><button class="btn" type="button" ${act({ a: "qans", id })}>Answer now</button></div>`;
  if (st.pr && !st.code) return `<div class="questcta"><span>Bonus step: solve “${esc(st.pr.title)}” · +40 XP</span><button class="btn" type="button" ${act({ a: "problem", id: st.pr.id })}>Solve it</button></div>`;
  return `<div class="questcta"><span>✓ Quest complete</span><button class="btn quiet" type="button" ${act({ a: "quests" })}>Back to quests</button></div>`;
}

/* ---------- chrome: streak and level ---------- */
const FLAME = `<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M6 0C9.6 4.3 10 6.6 10 9.5A4 4 0 0 1 2 9.5C2 6.6 2.4 4.3 6 0Z" fill="var(--flame)"/></svg>`;
function lvlCard() {
  const L = levelOf(QS.xp), a = lvlStart(L), b = lvlStart(L + 1);
  return `<div class="lvlcard"><div class="top"><b>Level ${L}</b><span>${titleOf(L)}</span></div><div class="tr"><i style="width:${Math.round((100 * (QS.xp - a)) / (b - a))}%"></i></div><small>${QS.xp.toLocaleString("en-IN")} / ${b.toLocaleString("en-IN")} XP${titleOf(L + 1) !== titleOf(L) ? " to " + titleOf(L + 1) : ""}</small></div>`;
}
function refreshChrome() {
  const n = QS.streak.last === today() || QS.streak.last === addDays(today(), -1) ? QS.streak.n : 0;
  const sl = n ? n + "-day streak" : "Start a streak", xp = QS.xp.toLocaleString("en-IN");
  // phones show the short form (flame + days, level only) so the logo, chips and settings fit on one line
  $("#streakChip").innerHTML = `<span class="chip fire" title="Daily streak" aria-label="${sl}">${FLAME}<span class="short" aria-hidden="true">${n}</span><span class="long" aria-hidden="true">${sl}</span></span>`;
  $("#lvlChip").innerHTML = `<span class="chip lvl" aria-label="Level ${levelOf(QS.xp)}, ${xp} XP">Lv ${levelOf(QS.xp)}<span class="long" aria-hidden="true"> · ${xp} XP</span></span>`;
  $("#sideFoot").innerHTML = lvlCard();
}

/* ---------- the Quests home ---------- */
const FLAG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2.5 3.5L16 11H5"/></svg>`;
const LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const CROWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18l2-11 6 5 6-5 2 11z"/></svg>`;
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
function ring(pct) {
  const r = 26, c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--surface)" stroke-width="7"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/><path d="M27 42V22M27 22.5h11l-2.5 3.5L38 29.5H27" fill="none" stroke="var(--flame)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
}
function continueCard(ch, nq) {
  if (!nq) {
    const open = ch.bossOpen, cleared = ch.cleared;
    return `<div class="card cont">${ring(ch.ratio)}<div class="body"><span class="eyebrow" style="color:var(--flame-ink)">Chapter boss</span><h2>${cleared ? "Chapter cleared! Replay the boss round?" : "Boss round: " + esc(clean(ch.mod))}</h2>
      <div class="steps3"><span class="step">5 interview questions</span><span class="step">Score 60% to clear</span></div></div>
      <div class="go"><span class="xp">${cleared ? "" : "+100 XP"}</span><button class="btn big" type="button" ${act({ a: "qboss", mod: ch.mod })}>${open ? "Start boss round" : "Locked"}</button></div></div>`;
  }
  const c = CM[nq], st = questState(nq);
  const steps = [`<span class="step ${st.learn ? "done" : "now"}">${st.learn ? "✓ " : ""}Learn</span>`, `<span class="step ${st.answer ? "done" : st.learn ? "now" : ""}">${st.answer ? "✓ " : ""}Answer a question</span>`];
  if (st.pr) steps.push(`<span class="step ${st.code ? "done" : "opt"}">${st.code ? "✓ " : ""}Bonus: code it</span>`);
  const xp = (st.learn ? 0 : 15) + (st.answer ? 0 : 30) + 25 + (st.pr && !st.code ? 40 : 0);
  return `<div class="card cont">${ring(ch.ratio)}<div class="body"><span class="eyebrow" style="color:var(--${c.t})">Continue your quest · ${esc(clean(ch.mod))}</span><h2>${esc(c.title)}</h2><div class="steps3">${steps.join("")}</div></div>
    <div class="go"><span class="xp">+${xp} XP</span><button class="btn big" type="button" ${act({ a: "qgo", id: nq })}>${st.learn ? "Continue" : "Start"}</button></div></div>`;
}
function pathHTML(ch, nq) {
  const ids = ch.ids;
  const at = Math.max(0, nq ? ids.indexOf(nq) : ids.length);
  const from = Math.max(0, Math.min(at - 1, ids.length - 5)), shown = ids.slice(from, from + 5);
  const nodes = shown.map((id) => {
    const st = questState(id), cls = st.done ? "done" : id === nq ? "now" : "open";
    const inner = st.done ? "✓" : id === nq ? FLAG : String(ids.indexOf(id) + 1);
    return { done: st.done, html: `<button class="pn ${cls}" type="button" ${act({ a: "qstep", id })}><span class="dotn">${inner}</span><b>${esc(CM[id].title)}</b></button>` };
  });
  nodes.push({ done: ch.cleared, html: `<button class="pn boss${ch.cleared ? " done" : ch.bossOpen ? "" : " lock"}" type="button" ${act({ a: "qboss", mod: ch.mod })}><span class="dotn">${ch.cleared ? "✓" : ch.bossOpen ? CROWN : LOCK}</span><b>Boss round</b></button>` });
  return nodes.map((n, k) => (k ? `<span class="pl${nodes[k - 1].done ? " done" : ""}"></span>` : "") + n.html).join("");
}
function sideQuests(ch) {
  const out = [];
  Object.entries(QS.int).filter(([id]) => CM[id] && !questState(id).done && !ch.ids.includes(id)).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .forEach(([id, n]) => out.push(`<button class="sq" type="button" ${act({ a: "qstep", id })}><i class="tdot" style="background:var(--${CM[id].t})"></i><span><b>${esc(CM[id].title)}</b><small>You asked about this ${n === 1 ? "once" : n + " times"} · side quest</small></span>${ARR}</button>`));
  C.filter((c) => c.cm && c.t === pathTrack() && !seen.has(c.id) && !ch.ids.includes(c.id)).slice(-1)
    .forEach((c) => out.push(`<button class="sq" type="button" ${act({ a: "qstep", id: c.id })}><i class="tdot" style="background:var(--${c.t})"></i><span><b>${esc(c.title)}</b><small>New community pick${c.asked ? ` · ${c.asked} learners asked` : ""} · reviewed</small></span>${ARR}</button>`));
  MY.filter((m) => !m.done).slice(0, 2)
    .forEach((m) => out.push(`<button class="sq" type="button" ${act({ a: "mycard", id: m.id })}><i class="tdot" style="background:var(--flame)"></i><span><b>${esc(m.title)}</b><small>From your question · personal side quest</small></span>${ARR}</button>`));
  return out.join("");
}
/* ---------- new in the library: topics added in the last 3 weeks (weekly batches and community picks) ---------- */
const NEW_DAYS = 21;
function newTopics() {
  const cut = addDays(today(), -NEW_DAYS);
  return C.filter((c) => c.nw && c.nw >= cut).sort((a, b) => (b.nw > a.nw ? 1 : b.nw < a.nw ? -1 : (b.t === pathTrack()) - (a.t === pathTrack())));
}
function newShelf() {
  const all = newTopics();
  if (!all.length) return "";
  // up to 3 from the learner's own path first, then the rest, so the shelf shows the breadth of what's new
  const mine = all.filter((c) => c.t === pathTrack()).slice(0, 3);
  const list = mine.concat(all.filter((c) => c.t !== pathTrack()), all.filter((c) => c.t === pathTrack() && !mine.includes(c)));
  const week = list.filter((c) => c.nw >= addDays(today(), -7)).length;
  return `<div class="sech"><h3>New in the library</h3><span class="muted">${week ? week + " added this week" : list.length + " added recently"}</span></div>
    <div class="newshelf">${list.slice(0, 6).map((c) => `<button class="nitem" type="button" ${act({ a: "qstep", id: c.id })}><span class="nmeta"><i class="dot" style="background:var(--${c.t})"></i>${esc(TRACKS[c.t].short)} · ${c.cm ? "Community pick" : "New"}${seen.has(c.id) ? " · ✓" : ""}</span><b>${esc(c.title)}</b><small>${esc(clean(c.mod))}</small></button>`).join("")}</div>`;
}
function renderQuests() {
  const t = pathTrack(), chs = chapters(t), info = chapterInfo(chs);
  const ch = currentChapter(info), nq = nextQuest(ch);
  const dl = dailyToday(), d = day(), due = dueReviews();
  const earned = BADGES.filter((b) => QS.badges.includes(b.id)), nextB = BADGES.find((b) => !QS.badges.includes(b.id));
  const sq = sideQuests(ch);
  $("#questBoard").innerHTML = `<div class="qmain">
    <div class="hello"><span class="eyebrow"><label for="qPath" class="sr">Career path</label><select id="qPath" class="pathsel">${Object.entries(RN).map(([k, v]) => `<option value="${k}" ${k === t ? "selected" : ""}>${v} path</option>`).join("")}</select> · Chapter ${ch.i + 1} of ${chs.length}</span><h1>${greeting()}</h1></div>
    ${continueCard(ch, nq)}
    ${due.length ? `<div class="questcta"><span>${due.length} topic${due.length > 1 ? "s" : ""} due for review. A quick answer keeps ${due.length > 1 ? "them" : "it"} fresh · +15 XP</span><button class="btn" type="button" ${act({ a: "qreview", id: due[0] })}>Review now</button></div>` : ""}
    <div id="qMsg"></div>
    <div class="sech"><h3>Chapter ${ch.i + 1} · ${esc(clean(ch.mod))}</h3><span class="muted">${ch.done} of ${ch.ids.length} quests</span></div>
    <div class="card path">${pathHTML(ch, nq)}</div>
    <div class="sech"><h3>Today's quests</h3><span class="muted">resets at midnight</span></div>
    <div class="daily">${dl.map((k) => { const def = DAILY[k], n = Math.min(d[k] || 0, def.goal), ok = d.claimed.includes(k); return `<div class="dq${ok ? " done" : ""}"><b>${def.label}</b><div class="tr"><i style="width:${(100 * n) / def.goal}%"></i></div><small>${ok ? "Done" : n + " of " + def.goal} · +${def.xp} XP</small></div>`; }).join("")}</div>
    ${newShelf()}
    ${sq ? `<div class="sech"><h3>Side quests</h3></div><div class="side-q">${sq}</div>` : ""}
    <details class="chapters"><summary>All ${chs.length} chapters in this path ${CHEV}</summary><div class="chlist">${info.map((c) => `<button class="ch${c.mod === ch.mod ? " cur" : ""}${c.cleared ? " cleared" : ""}" type="button" ${act({ a: "qch", mod: c.mod })}><b class="cn">${c.cleared ? "✓" : c.unlocked ? c.i + 1 : LOCK}</b><span>${esc(clean(c.mod))}</span><small>${c.done}/${c.ids.length}</small></button>`).join("")}</div></details>
  </div>
  <aside class="qrail">
    ${lvlCard()}
    <div class="card askbox"><b>Ask anything</b><form id="qAsk" autocomplete="off"><label for="qAskIn" class="sr">Your question</label><input id="qAskIn" placeholder="How does Kafka keep order?"><button class="send" type="submit" aria-label="Ask">${ARR}</button></form>
      <div class="seg">${["What is a watermark?", "Plan my interview prep"].map((q) => `<button class="pill" type="button" ${act({ a: "ask", q })} style="font-size:13px;padding:6px 11px">${esc(q)}</button>`).join("")}</div></div>
    <div class="card badges"><b class="h">Badges</b><div class="bgrid">${earned.map((b) => `<span class="badge ${b.cls}" title="${esc(b.name)}">${b.short}</span>`).join("")}<span class="badge next" title="Next badge">?</span></div><small class="muted">${nextB ? "Next: " + esc(nextB.name) : "You've earned every badge!"}</small></div>
  </aside>`;
}
document.addEventListener("change", (e) => {
  if (e.target.id === "qPath") {
    F.role.value = e.target.value; store.set("f_role", e.target.value);
    QS.sel = null; qsSave(); renderInterview(); renderQuests();
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "qAsk") return;
  e.preventDefault();
  const v = $("#qAskIn").value.trim();
  if (!v || busy) return;
  showView("tutor"); ask(v);
});

/* ---------- personal study cards from questions the library doesn't cover ---------- */
async function makeMyCard(question, answerText, host) {
  if (!aiOn() || MY.some((m) => m.q === question)) return;
  const note = document.createElement("div");
  note.className = "savedcard"; note.innerHTML = `<span>Saving this as a study card…</span>`;
  host.appendChild(note);
  try {
    const out = await streamChat({ mode: "cardify", provider: engine.provider, model: engine.model, question, answer: answerText }, () => {});
    const raw = out.text.replace(/```(?:json)?/gi, "");
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const pts = (Array.isArray(j.points) ? j.points : []).map((p) => ({ t: String(p.t || "").slice(0, 160), k: (Array.isArray(p.k) ? p.k : []).map((k) => String(k).toLowerCase().trim()).filter((k) => k.length > 2).slice(0, 5) })).filter((p) => p.t && p.k.length >= 2);
    if (j.skip || !j.title || !j.takeaway || !j.check || pts.length < 2) { note.remove(); return; }
    const m = { id: "my-" + Date.now().toString(36), title: String(j.title).slice(0, 80), s: String(j.takeaway).slice(0, 300), e: String(j.example || "").slice(0, 300), c: String(j.check).slice(0, 240), p: pts.slice(0, 4), q: question, at: today(), done: false, seen: false };
    MY.unshift(m); MY = MY.slice(0, 60); store.set("mycards", MY);
    note.innerHTML = `<span>Saved to your library as a side quest: <b>${esc(m.title)}</b></span><button class="lnk" type="button" ${act({ a: "mycard", id: m.id })}>Open card</button>`;
  } catch (e) { note.remove(); }
}
function openMyCard(id) {
  const m = MY.find((x) => x.id === id);
  if (!m) return;
  showView("tutor");
  addMsg("user", esc("Tell me about " + m.title));
  addMsg("bot", `<article class="ans"><span class="eyebrow"><i style="background:var(--flame)"></i>From your questions · not reviewed yet</span><h3>${esc(m.title)}</h3><p class="lead">${esc(m.s)}</p>
    ${m.e ? `<div class="example"><b>Example</b>${esc(m.e)}</div>` : ""}
    <div class="questcta" style="flex-direction:column;align-items:stretch"><span>Side quest: ${esc(m.c)}</span><label for="mc-${m.id}" class="sr">Your answer</label><textarea class="ans-in sc-in" id="mc-${m.id}" placeholder="Answer in a few sentences…"></textarea><div class="acts"><button class="btn" type="button" data-mycheck="${m.id}">Check my answer</button></div><div class="myres"></div></div></article>`);
  if (!m.seen) { m.seen = true; store.set("mycards", MY); award(10, "Opened: " + m.title); qsSave(); refreshChrome(); }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-mycheck]");
  if (!b) return;
  const m = MY.find((x) => x.id === b.dataset.mycheck), box = $("#mc-" + b.dataset.mycheck), host = b.closest(".acts").nextElementSibling;
  if (!m || !box) return;
  if (box.value.trim().split(/\s+/).filter(Boolean).length < 6) { host.innerHTML = `<p class="muted">Write a sentence or two first.</p>`; return; }
  const g = grade(box.value, { p: m.p });
  host.innerHTML = `<div class="meter"><div class="tr"><div class="fl" style="width:${g.pct}%"></div></div><b>${g.n} of ${g.res.length}</b></div><ul class="pts">${g.res.map((r) => `<li class="${r.ok ? "ok" : "miss"}"><span class="mk">${r.ok ? "✓" : "+"}</span><span>${r.ok ? "" : "Add: "}${esc(r.t)}</span></li>`).join("")}</ul>`;
  if (g.pct >= 60 && !m.done) { m.done = true; store.set("mycards", MY); award(30, "Side quest complete: " + m.title); bumpDaily("step"); checkBadges(); qsSave(); refreshChrome(); }
});

/* ---------- community picks (layer 2) ---------- */
// New reviewed cards from the gateway: index them, give their questions quests, and redraw what's on screen.
window.onCommunityAdded = (added) => {
  if (typeof indexAdded === "function") indexAdded(added);
  const ids = new Set(added.map((c) => c.id));
  Q.forEach((q, i) => { if (ids.has(q.c) && !(QI[q.c] || []).includes(i)) (QI[q.c] = QI[q.c] || []).push(i); });
  renderQuests();
  if (typeof renderLib === "function" && !$("#view-library").hidden) renderLib();
  const mine = added.filter((c) => c.t === pathTrack());
  if (mine.length) toast(`New community pick: <b>${esc(mine[0].title)}</b>${mine.length > 1 ? ` and ${mine.length - 1} more` : ""}`);
};

/* ---------- start ---------- */
refreshChrome();
(() => { const h0 = location.hash.slice(1); showView(VIEWS.includes(h0) ? h0 : "quests"); })();
if (typeof communityRefresh === "function") communityRefresh();
