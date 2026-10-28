/* Datakul web app. Content lives in library.js; settings in config.js. */
"use strict";

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("dp_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("dp_" + k, JSON.stringify(v)); } catch (e) {} },
};
const act = (o) => `data-act='${esc(JSON.stringify(o))}'`;
const CHEV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
const ARR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const GW = ((window.DATAKUL_CONFIG && window.DATAKUL_CONFIG.gatewayUrl) || "").replace(/\/+$/, "");
/* Layer 2: questions the library can't answer are shared anonymously so reviewers can add them (opt-out in settings). */
const shareOn = () => store.get("share", true) !== false;
const canShare = () => !!GW && !GW.startsWith("preview:");
function reportMiss(text) {
  if (!canShare() || !shareOn()) return;
  const track = typeof F !== "undefined" && F.role ? F.role.value : null;
  try { fetch(GW + "/api/miss", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: String(text).slice(0, 300), track }), keepalive: true }).catch(() => {}); } catch (e) {}
}

/* ---------- on-device retrieval (the "R" in RAG) ---------- */
const STOP = new Set("a an the is are was what whats how do does did to of in on for and or vs versus between difference explain me about tell can could you i my with why when which should it this that be use using get give some please mean means".split(" "));
function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
const toks = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w)).map(stem);
const idxOf = (c) => { const m = {}; const add = (t, w) => toks(t).forEach((x) => (m[x] = (m[x] || 0) + w)); add(c.title, 4); add(c.kw, 3); add(c.s, 1); add(c.d, 0.5); return m; };
const IDX = C.map(idxOf);
const DF = {}; IDX.forEach((m) => Object.keys(m).forEach((t) => (DF[t] = (DF[t] || 0) + 1)));
// Community picks that arrive after start-up (community.js) join the index here. C and IDX stay aligned by position.
function indexAdded(list) {
  list.forEach((c) => { const i = C.indexOf(c); if (i < 0 || IDX[i]) return; IDX[i] = idxOf(c); Object.keys(IDX[i]).forEach((t) => (DF[t] = (DF[t] || 0) + 1)); });
  list.forEach(fillRelated);
}
// A reviewer may leave a community card without related topics; borrow the closest library topics.
function fillRelated(c) {
  if (!c.cm || c.r.length >= 3) return;
  search(c.title + " " + c.kw).filter((x) => x.c.id !== c.id && !x.c.cm && !c.r.includes(x.c.id)).slice(0, 3 - c.r.length).forEach((x) => c.r.push(x.c.id));
}
function search(q) {
  const qt = [...new Set(toks(q))];
  return C.map((c, i) => { let s = 0; qt.forEach((t) => { if (IDX[i][t]) s += IDX[i][t] * Math.log(1 + C.length / DF[t]); }); return { c, s }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
}
const modName = (m) => { const t = String(m || "").replace(/^Domain pack: |^Career: /, ""); return t.charAt(0).toUpperCase() + t.slice(1); };
C.filter((c) => c.cm).forEach(fillRelated);
const refText = (c) => [c.s, c.d, "Example: " + c.e, "How interviewers ask it: " + c.i].join("\n");

/* ---------- light markdown for AI replies (escaped first, so it's safe) ---------- */
function md(src) {
  let s = String(src);
  if ((s.match(/```/g) || []).length % 2) s += "\n```";
  const blocks = [];
  s = esc(s).replace(/```([\w-]*)\n?([\s\S]*?)```/g, (m, lang, c) => { blocks.push({ lang: lang.toLowerCase(), c: c.replace(/\n$/, "") }); return `\n\u0000${blocks.length - 1}\u0000\n`; });
  const inline = (t) => t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const out = []; let list = null;
  for (const raw of s.split("\n")) {
    const l = raw.trim();
    const m = l.match(/^([-*•]|\d+[.)])\s+(.*)/);
    if (m) {
      const tag = /\d/.test(m[1][0]) ? "ol" : "ul";
      if (!list || list !== tag) { if (list) out.push(`</${list}>`); list = tag; out.push(`<${tag}>`); }
      out.push(`<li>${inline(m[2])}</li>`); continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    if (!l) continue;
    const b = l.match(/^\u0000(\d+)\u0000$/);
    if (b) { const k = blocks[+b[1]]; out.push(k.lang === "mermaid" ? `<div class="mmd" data-src="${k.c}"><pre>${k.c}</pre></div>` : `<pre>${k.c}</pre>`); continue; }
    if (/^#{1,4}\s/.test(l)) { out.push(`<p><b>${inline(l.replace(/^#+\s/, ""))}</b></p>`); continue; }
    if (/^(\*\*)?your turn:/i.test(l)) { out.push(`<p class="yourturn">${inline(l)}</p>`); continue; }
    out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
}


/* Mermaid diagrams in AI answers: the library loads only when an answer contains one. */
const MERMAID_URL = (window.DATAKUL_CONFIG && window.DATAKUL_CONFIG.mermaidUrl) || "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
let mermaidP = null, mmdSeq = 0;
function loadMermaid() {
  if (mermaidP) return mermaidP;
  mermaidP = new Promise((res, rej) => {
    if (window.mermaid) return res(window.mermaid);
    const sc = document.createElement("script");
    sc.src = MERMAID_URL;
    sc.onload = () => (window.mermaid ? res(window.mermaid) : rej(new Error("Diagram library missing")));
    sc.onerror = () => rej(new Error("Diagram library failed to load"));
    document.head.appendChild(sc);
  });
  mermaidP.catch(() => { mermaidP = null; });
  return mermaidP;
}
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" || t === "black" : matchMedia("(prefers-color-scheme: dark)").matches; };
async function drawMermaid(root) {
  const els = [...root.querySelectorAll(".mmd[data-src]")];
  if (!els.length) return;
  try {
    const m = await loadMermaid();
    m.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark() ? "dark" : "neutral", fontFamily: "Atkinson Hyperlegible, sans-serif" });
    for (const el of els) {
      const src = el.dataset.src; el.removeAttribute("data-src");
      try { const { svg } = await m.render("mmd" + (++mmdSeq), src); el.innerHTML = svg; } catch (e) { /* keep the code block */ }
    }
  } catch (e) { /* offline: the code block stays */ }
}

/* Optional semantic search: concept vectors in emb.js (built by tools/embed-concepts.mjs) plus the gateway's /api/embed. */
async function semanticSearch(text) {
  const E = window.DATAKUL_EMB;
  if (!E || !GW || GW.startsWith("preview:")) return [];
  try {
    const r = await fetch(GW + "/api/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts: [text] }) });
    if (!r.ok) return [];
    const q = (await r.json()).vectors[0];
    const nq = Math.hypot(...q);
    return Object.entries(E.vecs).map(([id, v]) => {
      let d = 0; for (let i = 0; i < v.length; i++) d += v[i] * q[i];
      return { c: CM[id], s: d / (nq * Math.hypot(...v)) };
    }).filter((x) => x.c).sort((a, b) => b.s - a.s).slice(0, 5);
  } catch (e) { return []; }
}

/* ---------- answer engine (gateway) ---------- */
let providers = [];
let engine = store.get("engine", null); // {provider, model} or {provider:"library"}
let gwState = GW ? "checking" : "off";
const aiOn = () => engine && engine.provider !== "library" && providers.some((p) => p.id === engine.provider);
function engineLabel() {
  if (!aiOn()) return "Library only";
  const p = providers.find((x) => x.id === engine.provider);
  const m = p.models.find((x) => x.id === engine.model) || p.models[0];
  return m.label;
}
function renderEngineLine() {
  $("#engineLine").innerHTML = `Answer engine: <b>${esc(engineLabel())}</b> · change`;
}
async function loadProviders() {
  if (!GW) { renderEngineLine(); return; }
  try {
    const r = await fetch(GW + "/api/providers");
    const j = await r.json();
    providers = j.providers || [];
    gwState = providers.length ? "ok" : "nokeys";
    if (!engine && providers.length) {
      const p = providers.find((x) => x.id === "groq") || providers[0];
      engine = { provider: p.id, model: p.models[0].id };
    }
  } catch (e) { gwState = "down"; }
  renderEngineLine();
}
async function streamChat(payload, onText) {
  const r = await fetch(GW + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) { let m = ""; try { m = (await r.json()).error; } catch (e) {} throw new Error(m || "The AI gateway returned an error (" + r.status + ")."); }
  const used = { id: r.headers.get("x-provider") || "", label: r.headers.get("x-provider-label") || "", model: r.headers.get("x-model") || "" };
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try { const j = JSON.parse(data); const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (d) { full += d; onText(full); } } catch (e) {}
    }
  }
  if (!full.trim()) throw new Error("The model returned an empty reply.");
  return { text: full, ...used };
}

/* appearance: auto (follows the device), light, dark (navy) or black ("Pitch dark", for OLED phones) */
const THEME_BG = { light: "#F2F6F8", dark: "#071C27", black: "#000000" };
function applyTheme(t) {
  const r = document.documentElement;
  if (THEME_BG[t]) r.dataset.theme = t; else delete r.dataset.theme;
  const eff = r.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const m = document.createElement("meta"); m.name = "theme-color"; m.content = THEME_BG[eff]; document.head.appendChild(m);
}
applyTheme(store.get("theme", "auto"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(store.get("theme", "auto")));
document.addEventListener("change", (e) => {
  if (e.target.name !== "theme") return;
  store.set("theme", e.target.value); applyTheme(e.target.value);
});

/* settings sheet */
/* model used to generate practice problems: null = same as the answer engine */
let genEngine = store.get("genEngine", null);
function genTarget() {
  if (genEngine && providers.some((p) => p.id === genEngine.provider && p.models.some((m) => m.id === genEngine.model))) return genEngine;
  if (aiOn()) return { provider: engine.provider, model: engine.model };
  const p = providers[0];
  return p ? { provider: p.id, model: p.models[0].id } : null;
}
function modelLabel(t) {
  const p = t && providers.find((x) => x.id === t.provider);
  const m = p && p.models.find((x) => x.id === t.model);
  return p ? `${p.label} · ${m ? m.label : t.model}` : "";
}
function renderSheet() {
  const opts = [{ id: "library", label: "Library only", sub: "Offline and instant. Uses the curated entries, no API." }]
    .concat(providers.map((p) => ({ id: p.id, label: p.label, sub: p.models.map((m) => m.label).join(" · ") })));
  const cur = aiOn() ? engine.provider : "library";
  $("#opts").innerHTML = opts.map((o) => `<label class="opt${o.id === cur ? " on" : ""}"><input type="radio" name="eng" value="${o.id}" ${o.id === cur ? "checked" : ""}><span><b>${esc(o.label)}</b><small>${esc(o.sub)}</small></span></label>`).join("");
  const p = providers.find((x) => x.id === cur);
  $("#modelWrap").hidden = !p || p.models.length < 2;
  if (p) $("#modelSel").innerHTML = p.models.map((m) => `<option value="${esc(m.id)}" ${engine && engine.model === m.id ? "selected" : ""}>${esc(m.label)}</option>`).join("");
  $("#genWrap").hidden = !providers.length;
  const gcur = genEngine ? genEngine.provider + "|" + genEngine.model : "";
  $("#genSel").innerHTML = `<option value="">Same as answer engine</option>` + providers.map((pp) => pp.models.map((m) => {
    const v = pp.id + "|" + m.id;
    return `<option value="${esc(v)}" ${v === gcur ? "selected" : ""}>${esc(pp.label + " · " + m.label)}</option>`;
  }).join("")).join("");
  $("#shareWrap").hidden = !canShare();
  $("#shareChk").checked = shareOn();
  const tv = store.get("theme", "auto");
  document.querySelectorAll('input[name="theme"]').forEach((r) => (r.checked = r.value === tv));
  const st = $("#gwStatus");
  st.className = "status";
  if (gwState === "off") st.textContent = "AI providers appear here once the gateway address is set in config.js.";
  else if (gwState === "down") { st.className = "status bad"; st.textContent = "Can't reach the AI gateway right now. Library mode still works."; }
  else if (gwState === "nokeys") { st.className = "status bad"; st.textContent = "The gateway is up but has no API keys yet."; }
  else if (gwState === "checking") st.textContent = "Checking the AI gateway…";
  else st.textContent = "If a provider is busy or out of free quota, the gateway switches to the next one automatically.";
}
$("#opts").addEventListener("change", (e) => {
  const id = e.target.value;
  if (id === "library") engine = { provider: "library" };
  else { const p = providers.find((x) => x.id === id); engine = { provider: id, model: p.models[0].id }; }
  store.set("engine", engine); renderSheet(); renderEngineLine();
});
$("#shareChk").addEventListener("change", (e) => { store.set("share", e.target.checked); renderShareNote(); });
function renderShareNote() { const n = $("#shareNote"); if (n) { n.hidden = !canShare() || !shareOn(); } }
renderShareNote();
$("#shareOff").addEventListener("click", () => openSheet());
$("#modelSel").addEventListener("change", (e) => { engine.model = e.target.value; store.set("engine", engine); renderEngineLine(); });
$("#genSel").addEventListener("change", (e) => {
  const v = e.target.value;
  genEngine = v ? { provider: v.slice(0, v.indexOf("|")), model: v.slice(v.indexOf("|") + 1) } : null;
  store.set("genEngine", genEngine);
  if (typeof onGenEngineChange === "function") onGenEngineChange();
});
const openSheet = () => { renderSheet(); $("#sheet").hidden = false; $("#sheet .sheet-card").scrollTop = 0; const r = $('input[name="theme"]:checked'); (r || $("#sheetDone")).focus({ preventScroll: true }); };
const closeSheet = () => { $("#sheet").hidden = true; if (typeof onGenEngineChange === "function") onGenEngineChange(); };
$("#gear").addEventListener("click", openSheet);
$("#engineLine").addEventListener("click", openSheet);
$("#sheetDone").addEventListener("click", closeSheet);
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

/* ---------- progress ---------- */
const seen = new Set(store.get("seen", []));
function markSeen(id) { const fresh = !seen.has(id); seen.add(id); store.set("seen", [...seen]); if (typeof questEvent === "function") questEvent("learn", { id, fresh }); }
const trackPct = (t) => { const all = C.filter((c) => c.t === t); return all.filter((c) => seen.has(c.id)).length / all.length; };

/* ---------- ask: starter questions ---------- */
const STARTERS = [["cdc", "What is change data capture?"], ["window-functions", "How do window functions work?"], ["precision-recall", "Precision vs recall, simply"], ["scd", "Explain SCD Type 2"], ["de-system-design", "How do I prepare for a data engineering interview?"]];
$("#starters").innerHTML = STARTERS.map(([id, q]) => `<button class="starter" type="button" ${act({ a: "ask", q })}><i class="dot" style="background:var(--${CM[id].t})"></i><span>${esc(q)}</span>${ARR}</button>`).join("");

/* ---------- tutor ---------- */
let level = store.get("level", "work"), pending = null, lastConcept = null, busy = false;
let detail = store.get("detail", "detailed");
function setDetail(v) { detail = v === "brief" ? "brief" : "detailed"; store.set("detail", detail); $("#len").value = detail; $("#lenSheet").value = detail; }
let aiHistory = [];
const thread = $("#thread");
function enterChat() { $("#home").hidden = true; $("#chat").hidden = false; if (level) $("#lvl").value = level; }
function addMsg(who, html, cls) {
  enterChat();
  const d = document.createElement("div");
  d.className = "msg " + who + (cls ? " " + cls : "");
  d.innerHTML = html;
  thread.appendChild(d);
  if (who === "bot") requestAnimationFrame(() => { const prev = d.previousElementSibling; (prev || d).scrollIntoView({ behavior: "smooth", block: "start" }); });
  return d;
}
let scSeq = 0;
const det = (label, body) => `<details><summary>${label}${CHEV}</summary><div class="db">${body}</div></details>`;
const nextLinks = (c) => `<div class="next"><span class="eyebrow">Related</span>${c.r.map((r) => `<button class="lnk" type="button" ${act({ a: "concept", id: r })}>${esc(CM[r].title)}</button>`).join("")}</div>`;

function answer(c) {
  const sid = "sc-" + (++scSeq);
  let h = `<article class="ans"><span class="eyebrow"><i style="background:var(--${c.t})"></i>${TRACKS[c.t].name}${c.mod ? " · " + esc(modName(c.mod)) : ""}${c.cm ? ` <b class="cmtag" title="Written from questions learners asked, checked and approved by a reviewer">Community · reviewed</b>` : ""}</span><h3>${esc(c.title)}</h3><p class="lead">${esc(c.s)}</p>`;
  if (typeof drawDiagram === "function") h += drawDiagram(c.id);
  h += `<div class="example"><b>Example</b>${esc(c.e)}</div><div class="disc">`;
  h += det("Go deeper", `<p>${esc(c.d)}</p>`);
  h += det("Interview angle", `<p>${esc(c.i)}</p>`);
  h += det("Check yourself", `<p>${esc(c.c)}</p><textarea class="ans-in sc-in" id="${sid}" placeholder="Type your answer in a sentence or two…"></textarea>
    <div class="acts"><button class="btn quiet" type="button" data-sc="${c.id}" data-box="${sid}">${aiOn() ? "Check my thinking" : "Compare with the notes"}</button></div><div class="schost"></div>`);
  h += `</div>${typeof questCTA === "function" ? questCTA(c.id) : ""}${nextLinks(c)}</article>`;
  addMsg("bot", h);
  markSeen(c.id);
  lastConcept = c; // the AI tutor gets this as context for follow-up questions
}
function askLevel() {
  addMsg("bot", `<p>Quick check before I explain: how familiar are you with this?</p><div class="seg">${[["new", "New to it"], ["work", "I use it at work"], ["interview", "Prepping for interviews"]].map(([k, v]) => `<button class="pill" type="button" ${act({ a: "level", v: k, label: v })}>${v}</button>`).join("")}</div>`, "note");
}
function libraryResolve(text) {
  const res = search(text);
  if (!res.length || res[0].s < 6) {
    reportMiss(text);
    addMsg("bot", `<p>I couldn't match that to a topic in the library. Which area is it closest to?</p><div class="seg">${Object.entries(TRACKS).map(([k, v]) => `<button class="pill" type="button" ${act({ a: "track", t: k })}>${v.name}</button>`).join("")}</div>${GW ? "" : `<p class="muted" style="font-size:14px">Connect an AI provider in settings to ask free-form questions.</p>`}`, "note");
    return;
  }
  const top = res[0], sec = res[1];
  if (sec && sec.s >= top.s * 0.8) {
    const opts = res.slice(0, 3).filter((x) => x.s >= top.s * 0.6);
    addMsg("bot", `<p>That could mean a few things. Which one?</p><div class="seg">${opts.map((x) => `<button class="pill" type="button" ${act({ a: "concept", id: x.c.id })}>${esc(x.c.title)}</button>`).join("")}</div>`, "note");
    return;
  }
  if (typeof questEvent === "function") questEvent("interest", { id: top.c.id });
  answer(top.c);
}
async function aiResolve(text) {
  const res = search(text);
  let hits = res.filter((x) => x.s >= 8 && x.s >= res[0].s * 0.6).slice(0, 2).map((x) => x.c); // 8+ means a distinctive title or keyword match, not a stray word
  if (hits.length < 2) (await semanticSearch(text)).filter((x) => x.s >= 0.62 && !hits.includes(x.c)).slice(0, 2 - hits.length).forEach((x) => hits.push(x.c));
  let ctx = hits.slice();
  if (!ctx.length && lastConcept) ctx = [lastConcept];
  const el = addMsg("bot", `<article class="ans"><div class="src">${ctx.length ? `Grounded in ${ctx.map((c) => `<span class="srcchip">${esc(c.title)}</span>`).join("")}` : `<span>No library match, so the answer will be flagged</span>`}</div><div class="md cursor"><p class="muted">Thinking…</p></div><div class="foot2"></div></article>`);
  const body = el.querySelector(".md"), foot = el.querySelector(".foot2");
  const payload = {
    mode: "tutor", provider: engine.provider, model: engine.model, level: level || "work", detail,
    question: text, history: aiHistory.slice(-6), focus: lastConcept ? lastConcept.title : "",
    context: ctx.map((c) => ({ title: c.title, text: refText(c) })),
  };
  busy = true;
  try {
    const out = await streamChat(payload, (t) => { body.innerHTML = md(t); });
    body.classList.remove("cursor");
    drawMermaid(body);
    const chosen = providers.find((p) => p.id === engine.provider);
    const switched = out.id && chosen && out.id !== chosen.id ? `${esc(chosen.label)} was busy, so ` : "";
    foot.innerHTML = `${hits[0] && typeof questCTA === "function" ? questCTA(hits[0].id) : ""}${ctx[0] ? nextLinks(ctx[0]) : ""}<p class="muted" style="font-size:12.5px">${switched}${switched ? "a" : "A"}nswered by ${esc(out.label)} · ${esc(out.model)}. AI can make mistakes; the library entries are the reviewed source.</p>`;
    aiHistory.push({ role: "user", content: text }, { role: "assistant", content: out.text });
    aiHistory = aiHistory.slice(-8);
    hits.forEach((c) => { markSeen(c.id); if (typeof questEvent === "function") questEvent("interest", { id: c.id }); });
    if (ctx[0]) lastConcept = ctx[0];
    if (!hits.length) { reportMiss(text); if (typeof makeMyCard === "function") makeMyCard(text, out.text, foot); }
  } catch (err) {
    body.classList.remove("cursor");
    if (ctx.length) {
      el.remove();
      addMsg("bot", `<p class="warnnote">The AI tutor couldn't answer: ${esc(err.message)} Here's the library entry instead.</p>`, "note");
      answer(ctx[0]);
    } else {
      body.innerHTML = `<p class="warnnote">The AI tutor couldn't answer: ${esc(err.message)}</p>`;
    }
  } finally { busy = false; }
}
function resolve(text) { return aiOn() ? aiResolve(text) : libraryResolve(text); }
function ask(text) {
  if (busy) return;
  addMsg("user", esc(text));
  if (typeof questEvent === "function") questEvent("ask", { text });
  resolve(text);
}
function openConcept(id) {
  const c = CM[id];
  showView("tutor");
  addMsg("user", esc("Tell me about " + c.title));
  answer(c); // library card is instant and free; the AI handles follow-ups
}
function onAct(o) {
  if (o.a === "ask") ask(o.q);
  else if (o.a === "concept") openConcept(o.id);
  else if (o.a === "level") {
    level = o.v; store.set("level", level); $("#lvl").value = level;
    addMsg("user", esc(o.label));
    const p = pending; pending = null;
    if (p) p.startsWith("#") ? answer(CM[p.slice(1)]) : resolve(p);
  } else if (o.a === "track") {
    showView("tutor");
    addMsg("user", esc(TRACKS[o.t].name));
    addMsg("bot", `<p>Here's what ${esc(TRACKS[o.t].name)} covers. Pick one to start:</p><div class="seg">${C.filter((c) => c.t === o.t).map((c) => `<button class="pill" type="button" ${act({ a: "concept", id: c.id })}>${seen.has(c.id) ? "✓ " : ""}${esc(c.title)}</button>`).join("")}</div>`, "note");
  } else if (o.a === "practice") { focusId = o.id; showView("interview"); }
  else if (o.a === "problem" && typeof openProblem === "function") openProblem(o.id);
  else if (typeof questAct === "function") questAct(o);
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onAct(JSON.parse(b.dataset.act)); });
$("#askForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#askInput").value.trim(); if (!v || busy) return; $("#askInput").value = ""; showView("tutor"); ask(v); });
$("#lvl").addEventListener("change", (e) => { level = e.target.value; store.set("level", level); });
$("#len").addEventListener("change", (e) => setDetail(e.target.value));
$("#lenSheet").addEventListener("change", (e) => setDetail(e.target.value));
$("#newTopic").addEventListener("click", () => { thread.innerHTML = ""; pending = null; lastConcept = null; aiHistory = []; $("#chat").hidden = true; $("#home").hidden = false; window.scrollTo({ top: 0 }); });

/* ---------- interviews ---------- */
let focusId = null, openQ = null, mock = null;
const F = { role: $("#role"), level: $("#level"), company: $("#company"), domain: $("#domain"), jd: $("#jd") };
Object.entries(F).forEach(([k, el]) => { const v = store.get("f_" + k, null); if (v != null) el.value = v; el.addEventListener("input", () => { store.set("f_" + k, el.value); renderInterview(); }); });
const RN = { de: "Data Engineer", da: "Data Analyst", ds: "Data Scientist", ar: "Data Architect" };
const LVN = { j: "Junior", m: "Mid-level", s: "Senior" };
const DN = { any: "General", ecom: "E-commerce", fin: "Fintech / UPI", log: "Logistics", saas: "SaaS" };
function jdSkills() { const t = " " + F.jd.value.toLowerCase().replace(/[^a-z0-9/+ -]+/g, " ") + " "; return SKILLS.filter((s) => t.includes(" " + s + " ")); }
function rank() {
  const role = F.role.value, lv = F.level.value, dom = F.domain.value, sk = jdSkills(), o = { j: 0, m: 1, s: 2 }, jd = F.jd.value.toLowerCase();
  const boost = Object.entries(SKILL_TOPICS).filter(([w]) => jd.includes(w)).map(([, c]) => c);
  return Q.map((q, i) => {
    let s = 0; const hit = q.r.includes(role); if (hit) s += 5;
    const dl = Math.abs(o[q.l] - o[lv]); s += dl === 0 ? 2 : dl === 1 ? 1 : 0;
    s += q.d.includes(dom) ? 2 : q.d.includes("any") ? 0.5 : 0;
    s += q.tg.filter((t) => sk.includes(t)).length * 1.5;
    if (boost.includes(q.c)) s += 1.5;
    let foc = false;
    if (focusId && (q.c === focusId || CM[focusId].r.includes(q.c))) { s += q.c === focusId ? 8 : 3; foc = true; }
    return { q, i, s, keep: hit || foc };
  }).filter((x) => x.keep).sort((a, b) => b.s - a.s);
}
/* ---- answer checker: whole words, plural/tense tolerant, with synonyms ---- */
const SYN_GROUPS = [
  ["dedup", "dedupe", "deduplicate", "deduplication", "duplicate", "distinct"],
  ["overwrite", "replace", "insert overwrite", "truncate and load"],
  ["merge", "upsert"],
  ["retry", "try again"],
  ["backfill", "reprocess", "replay"],
  ["checkpoint", "resume"],
  ["threshold", "cut-off", "cutoff", "cut off"],
  ["not exists", "anti join", "anti-join"],
  ["skew", "hot key"],
  ["broadcast", "map-side join"],
  ["watermark", "allowed lateness"],
];
function gStem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
const gNorm = (s) => " " + String(s).toLowerCase().replace(/\s*=\s*/g, " = ").replace(/([a-z_)])\.([a-z_(])/g, "$1 $2").replace(/[^a-z0-9_=./+'-]+/g, " ")
  .split(" ").map((t) => (t === "=" ? t : t.replace(/^[.'\-/]+|[.'\-/]+$/g, ""))).filter(Boolean).map(gStem).join(" ") + " ";
const SYN_N = SYN_GROUPS.map((g) => g.map((x) => gNorm(x).trim()));
function kwHits(normAns, kw) {
  const k = gNorm(kw).trim();
  const forms = new Set([k]);
  SYN_N.forEach((g) => { if (g.includes(k)) g.forEach((x) => forms.add(x)); });
  for (const f of forms) {
    if (normAns.includes(" " + f + " ")) return true;
    if (f.length >= 5 && normAns.includes(" " + f)) return true; // prefix: "dependenc" → dependency
  }
  return false;
}
function grade(ans, q) {
  const a = gNorm(ans);
  const res = q.p.map((p) => ({ t: p.t, ok: p.k.some((k) => kwHits(a, k)) }));
  const n = res.filter((r) => r.ok).length;
  return { res, n, pct: Math.round((100 * n) / q.p.length), words: ans.trim().split(/\s+/).filter(Boolean).length };
}
const MIN_WORDS = 12;
const tooShort = (v) => v.trim().split(/\s+/).filter(Boolean).length < MIN_WORDS;
const SHORT_MSG = `<p class="muted">Write a fuller answer first: a few sentences, as you would say it aloud. Short keyword lists aren't scored.</p>`;
function resultHTML(g, i, hostId) {
  const how = aiOn()
    ? "Quick check looks for the key ideas, allowing for plurals and common synonyms. For a judgement of correctness and depth, ask the AI interviewer."
    : "Quick check looks for the key ideas, allowing for plurals and common synonyms. A correct answer in unusual wording may score lower.";
  const tn = taught.has(i) ? `<p class="muted" style="font-size:13.5px">${g.pct >= 60 ? "Nicely recalled after studying the answer." : "Recalling takes practice. Study it once more, then try again."} This question comes back for review tomorrow.</p>` : "";
  const tl = g.pct < 60 && Q[i].a ? `<div class="acts"><button class="btn quiet" type="button" data-reveal="${i}">Teach me the answer</button></div>` : "";
  return tn + `<div class="meter"><div class="tr"><div class="fl" style="width:${g.pct}%"></div></div><b>${g.n} of ${g.res.length}</b></div><ul class="pts">${g.res.map((r) => `<li class="${r.ok ? "ok" : "miss"}"><span class="mk">${r.ok ? "✓" : "+"}</span><span>${r.ok ? "" : "Add: "}${esc(r.t)}</span></li>`).join("")}</ul>${g.words < 30 ? `<p class="muted" style="font-size:14px">${g.words} words so far. In a real round, give a structured answer with one concrete example.</p>` : ""}<p class="muted" style="font-size:12.5px">${how}</p>${tl}${aiOn() ? `<div class="acts"><button class="btn quiet" type="button" data-aifb="${i}" data-host="${hostId}">Get AI interviewer feedback</button></div><div class="aifbhost"></div>` : ""}`;
}
/* ---------- teach me the answer: the model answer, point by point, then recall it ---------- */
const taught = new Set();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Escape text and wrap every keyword occurrence (word start, any ending) in <mark>, without nesting.
function markText(text, kws) {
  const spans = [];
  kws.forEach((k) => {
    const re = new RegExp("(^|[^a-z0-9])(" + reEsc(String(k).toLowerCase()) + "[a-z]*)", "gi");
    let m;
    while ((m = re.exec(text))) { const s = m.index + m[1].length; spans.push([s, s + m[2].length]); if (re.lastIndex === m.index) re.lastIndex++; }
  });
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "", at = 0;
  spans.forEach(([s, e]) => { if (s < at) return; out += esc(text.slice(at, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>"; at = e; });
  return out + esc(text.slice(at));
}
function teachHTML(i) {
  const q = Q[i];
  if (!q.a) return `<ul class="pts">${q.p.map((p) => `<li><span class="mk">•</span><span>${esc(p.t)}</span></li>`).join("")}</ul>`;
  const sents = q.a.split(/(?<=[.!?])\s+(?=[A-Z"])/);
  const steps = q.p.map((p) => {
    const s = sents.find((x) => p.k.some((k) => kwHits(gNorm(x), k)));
    return `<li><b>${esc(p.t)}</b>${s ? `<q>${markText(s, p.k)}</q>` : ""}</li>`;
  }).join("");
  const all = q.p.flatMap((p) => p.k);
  return `<div class="teach" tabindex="-1"><span class="eyebrow">How to answer</span>
    <p class="muted" style="font-size:14px">Make these ${q.p.length} points, in this order. The highlighted words are what Quick check listens for.</p>
    <ol class="steps">${steps}</ol>
    <details class="full"><summary>Read the whole model answer ${CHEV}</summary><p>${markText(q.a, all)}</p></details>
    <p class="muted" style="font-size:13px">Say it in your own words. Interviewers notice memorised answers.</p>
    <div class="acts"><button class="btn" type="button" data-tryown="${i}">Now try it in your own words</button>${aiOn() ? `<button class="btn quiet" type="button" data-simpler="${i}">Explain it more simply</button>` : ""}</div>
    ${aiOn() ? `<form class="fuform" data-fu="${i}" autocomplete="off"><label class="sr" for="fu-${i}">Ask about this answer</label><input id="fu-${i}" placeholder="Ask about this answer, e.g. why does the order matter?"><button class="send" type="submit" aria-label="Ask">${ARR}</button></form><div class="teachai"></div>` : ""}
  </div>`;
}
const teachHist = {};
async function teachAI(i, ask, host) {
  const q = Q[i];
  const h = (teachHist[i] = teachHist[i] || []);
  const box = document.createElement("div");
  box.className = "aifb";
  box.innerHTML = `<span class="eyebrow">AI tutor</span><div class="md cursor"><p class="muted">Thinking…</p></div><p class="muted foot3" style="font-size:12.5px"></p>`;
  host.appendChild(box);
  const body = box.querySelector(".md");
  try {
    const out = await streamChat({
      mode: "tutor", provider: engine.provider, model: engine.model, level: "new", detail: "brief",
      question: ask, history: h.slice(-4), focus: CM[q.c].title,
      context: [{ title: "Interview question: " + q.q, text: "Model answer: " + q.a + "\nKey points a good answer makes: " + q.p.map((p) => p.t).join("; ") }],
    }, (t) => { body.innerHTML = md(t); });
    body.classList.remove("cursor");
    drawMermaid(body);
    box.querySelector(".foot3").textContent = `Answered by ${out.label} · ${out.model}. The model answer above is the reviewed source.`;
    h.push({ role: "user", content: ask }, { role: "assistant", content: out.text });
  } catch (err) {
    body.classList.remove("cursor");
    body.innerHTML = `<p class="warnnote">The AI tutor couldn't answer: ${esc(err.message)}</p>`;
  }
}
document.addEventListener("click", (e) => {
  const tr = e.target.closest("[data-tryown]");
  if (tr) {
    const i = +tr.dataset.tryown, box = $("#ans-" + i);
    taught.add(i);
    if (typeof questEvent === "function") questEvent("taught", { c: Q[i].c });
    $("#res-" + i).innerHTML = `<p class="muted" style="font-size:14px">Answer from memory, out loud or typed, then press Quick check. Stuck? Press Teach me the answer again.</p>`;
    if (box) { box.value = ""; box.focus(); }
    return;
  }
  const sm = e.target.closest("[data-simpler]");
  if (sm) {
    const i = +sm.dataset.simpler;
    sm.disabled = true;
    teachAI(i, `Explain this model answer more simply, step by step, for someone new to the topic. Interview question: "${Q[i].q}"`, sm.closest(".teach").querySelector(".teachai"));
  }
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-fu]");
  if (!f) return;
  e.preventDefault();
  const inp = f.querySelector("input"), v = inp.value.trim();
  if (!v) return;
  inp.value = "";
  teachAI(+f.dataset.fu, v + ` (This is about the interview question: "${Q[+f.dataset.fu].q}")`, f.nextElementSibling);
});

async function aiFeedback(i, answerText, hostEl, btn) {
  const q = Q[i];
  btn.disabled = true;
  hostEl.innerHTML = `<div class="aifb"><span class="eyebrow">AI interviewer</span><div class="md cursor"><p class="muted">Reading your answer…</p></div><p class="muted foot3" style="font-size:12.5px"></p></div>`;
  const body = hostEl.querySelector(".md");
  try {
    const out = await streamChat({ mode: "feedback", detail, provider: engine.provider, model: engine.model, role: RN[F.role.value], levelLabel: LVN[F.level.value], question: q.q, points: q.p.map((p) => p.t), answer: answerText }, (t) => { body.innerHTML = md(t); });
    body.classList.remove("cursor");
    hostEl.querySelector(".foot3").textContent = `Feedback by ${out.label} · ${out.model}`;
  } catch (err) {
    body.classList.remove("cursor");
    body.innerHTML = `<p class="warnnote">Couldn't get AI feedback: ${esc(err.message)}</p>`;
    btn.disabled = false;
  }
}
function renderInterview() {
  $("#tTitle").textContent = RN[F.role.value];
  const co = F.company.value.trim();
  $("#tSub").textContent = [LVN[F.level.value], DN[F.domain.value], co].filter(Boolean).join(" · ");
  $("#domainTip").textContent = TIPS[F.domain.value];
  const sk = jdSkills();
  $("#skills").innerHTML = sk.length ? `Skills found:${sk.map((s) => `<span class="sk">${esc(s)}</span>`).join("")}` : "Paste a job description to tailor the questions.";
  const list = rank().slice(0, 8);
  $("#focusNote").innerHTML = focusId ? `Focused on ${esc(CM[focusId].title)} · <button class="ghostlink" type="button" id="clrF">clear</button>` : `${list.length} picked for you`;
  if (focusId) $("#clrF").onclick = () => { focusId = null; renderInterview(); };
  $("#qlist").innerHTML = list.map(({ q, i }) => `<div class="qrow${openQ === i ? " open" : ""}" id="qr-${i}">
    <button class="qbtn" type="button" data-q="${i}" aria-expanded="${openQ === i}"><i class="dot" style="background:var(--${CM[q.c].t})"></i><span class="qt"><b>${esc(q.q)}</b><small>${LVN[q.l]} · ${esc(CM[q.c].title)}</small></span>${CHEV}</button>
    <div class="qpanel" ${openQ === i ? "" : "hidden"}><textarea class="ans-in" id="ans-${i}" placeholder="Answer as you would out loud…"></textarea>
    <div class="acts"><button class="btn" type="button" data-check="${i}">Quick check</button><button class="ghostlink" type="button" data-reveal="${i}">Teach me the answer</button><button class="ghostlink" type="button" ${act({ a: "concept", id: q.c })}>Study the topic</button></div><div id="res-${i}"></div></div></div>`).join("");
}
$("#qlist").addEventListener("click", (e) => {
  const qb = e.target.closest("[data-q]");
  if (qb) {
    const i = +qb.dataset.q, row = $("#qr-" + i), pan = row.querySelector(".qpanel"), open = pan.hidden;
    document.querySelectorAll(".qrow").forEach((r) => { r.classList.remove("open"); r.querySelector(".qpanel").hidden = true; r.querySelector(".qbtn").setAttribute("aria-expanded", "false"); });
    if (open) { row.classList.add("open"); pan.hidden = false; qb.setAttribute("aria-expanded", "true"); openQ = i; } else openQ = null;
    return;
  }
  const t = e.target;
  if (t.dataset.check) {
    const i = +t.dataset.check, v = $("#ans-" + i).value;
    if (tooShort(v)) { $("#res-" + i).innerHTML = SHORT_MSG; return; }
    const g = grade(v, Q[i]);
    $("#res-" + i).innerHTML = resultHTML(g, i, "ans-" + i);
    if (typeof questEvent === "function") questEvent("answer", { c: Q[i].c, pct: g.pct, i });
  }
  if (t.dataset.reveal) { const i = +t.dataset.reveal; $("#res-" + i).innerHTML = teachHTML(i); $("#res-" + i).querySelector(".teach").focus({ preventScroll: true }); }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-aifb]");
  if (!b) return;
  const i = +b.dataset.aifb, text = $("#" + b.dataset.host).value;
  aiFeedback(i, text, b.closest(".acts").nextElementSibling, b);
});
$("#editBtn").addEventListener("click", () => { const p = $("#editPanel"); p.hidden = !p.hidden; $("#editBtn").textContent = p.hidden ? "Edit target" : "Done"; $("#editBtn").setAttribute("aria-expanded", String(!p.hidden)); });
$("#startMock").addEventListener("click", () => { mock = { qs: rank().slice(0, 5).map((x) => x.i), k: 0, sc: [] }; renderMock(); });
function renderMock() {
  const el = $("#mockArea");
  $("#ctaBox").hidden = !!mock;
  if (!mock) { el.innerHTML = ""; return; }
  if (mock.k >= mock.qs.length) {
    const avg = Math.round(mock.sc.reduce((a, b) => a + b.pct, 0) / mock.sc.length);
    const weak = [...new Set(mock.sc.filter((s) => s.pct < 60).map((s) => Q[s.i].c))];
    const boss = mock.boss, passed = avg >= 60;
    if (boss && !mock.reported && typeof questEvent === "function") { mock.reported = true; questEvent("boss", { mod: boss, avg }); }
    el.innerHTML = `<div class="mock${boss ? " boss" : ""}"><span class="eyebrow">${boss ? "Boss round · " + esc(modName(boss)) : "Round complete"}</span><h3>${boss ? (passed ? `Boss beaten with ${avg}%! Chapter cleared.` : `You scored ${avg}%. Reach 60% to clear the chapter.`) : `You covered ${avg}% of the key points`}</h3>
      <div>${mock.sc.map((s) => `<div class="sumrow"><span>${esc(Q[s.i].q)}</span><span>${s.n}/${Q[s.i].p.length}</span></div>`).join("")}</div>
      ${weak.length ? `<div class="next"><span class="eyebrow">Study these next</span>${weak.map((c) => `<button class="lnk" type="button" ${act({ a: "concept", id: c })}>${esc(CM[c].title)}</button>`).join("")}</div>` : `<p class="muted">Strong round. Try the next level up.</p>`}
      <div class="acts">${boss ? `<button class="btn" type="button" id="mQuests">Back to quests</button>` : `<button class="btn" type="button" id="mAgain">New round</button>`}<button class="btn quiet" type="button" id="mClose">Close</button></div></div>`;
    if (boss) { $("#mQuests").onclick = () => { mock = null; renderMock(); showView("quests"); window.scrollTo({ top: 0 }); }; $("#mClose").onclick = () => { mock = null; renderMock(); }; return; }
    $("#mAgain").onclick = () => $("#startMock").click();
    $("#mClose").onclick = () => { mock = null; renderMock(); };
    return;
  }
  const i = mock.qs[mock.k], q = Q[i];
  el.innerHTML = `<div class="mock${mock.boss ? " boss" : ""}"><div class="top"><span class="eyebrow">${mock.boss ? "Boss round · " : ""}Question ${mock.k + 1} of ${mock.qs.length}</span><div class="steps">${mock.qs.map((_, j) => `<i class="${j <= mock.k ? "on" : ""}"></i>`).join("")}</div></div>
    <h3>${esc(q.q)}</h3><textarea class="ans-in" id="mAns" placeholder="Answer as you would out loud…"></textarea>
    <div class="acts"><button class="btn" type="button" id="mCheck">Quick check</button><button class="ghostlink" type="button" id="mStop">End round</button></div><div id="mRes"></div></div>`;
  $("#mStop").onclick = () => { mock = null; renderMock(); };
  $("#mCheck").onclick = () => {
    const v = $("#mAns").value;
    if (tooShort(v)) { $("#mRes").innerHTML = SHORT_MSG; return; }
    const g = grade(v, q);
    if (typeof questEvent === "function") questEvent("answer", { c: q.c, pct: g.pct, i, mock: true });
    $("#mRes").innerHTML = resultHTML(g, i, "mAns") + `<div class="acts" style="margin-top:12px"><button class="btn" type="button" id="mNext">${mock.k + 1 < mock.qs.length ? "Next question" : "See results"}</button></div>`;
    $("#mCheck").disabled = true;
    $("#mNext").onclick = () => { mock.sc.push({ i, n: g.n, pct: g.pct }); mock.k++; renderMock(); };
  };
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- library ---------- */
const LV_NAME = { F: "Foundations", I: "Intermediate", A: "Advanced" };
let libQuery = "";
function renderLib() {
  $("#prog").textContent = `${seen.size} of ${C.length} studied`;
  $("#libIntro").textContent = `${C.length} concepts across four tracks, grouped by module. Tap one to study it in the tutor.`;
  const q = libQuery.trim().toLowerCase();
  const match = (c) => !q || (c.title + " " + (c.mod || "") + " " + c.kw).toLowerCase().includes(q);
  let any = false;
  const mine = typeof myCards === "function" ? myCards().filter((m) => !q || (m.title + " " + m.s).toLowerCase().includes(q)) : [];
  const mineHTML = mine.length ? `<div class="trk mine"><div class="th"><h3>From your questions</h3><span>${mine.length}</span></div><p class="muted" style="font-size:13.5px">Cards the tutor wrote from questions the library didn't cover. Not reviewed yet.</p><div class="clist">${mine.map((m) => `<button class="citem" type="button" ${act({ a: "mycard", id: m.id })}><i class="lvchip lv-M">Q</i><span>${esc(m.title)}</span>${m.done ? '<b class="tick">✓</b>' : ""}</button>`).join("")}</div></div>` : "";
  if (mine.length) any = true;
  const fresh = typeof newTopics === "function" ? newTopics().filter(match) : [];
  const freshHTML = fresh.length ? `<div class="trk mine"><div class="th"><h3>New in the library</h3><span>${fresh.length}</span></div><p class="muted" style="font-size:13.5px">Added in the last three weeks. The library grows every week.</p><div class="clist">${fresh.map((c) => `<button class="citem" type="button" ${act({ a: "concept", id: c.id })}><i class="lvchip lv-${c.lv || "I"}" title="${LV_NAME[c.lv] || ""}">${c.lv || ""}</i><span>${esc(c.title)}</span>${seen.has(c.id) ? '<b class="tick">✓</b>' : ""}</button>`).join("")}</div></div>` : "";
  if (fresh.length) any = true;
  $("#lib").innerHTML = freshHTML + mineHTML + Object.entries(TRACKS).map(([k, v]) => {
    const all = C.filter((c) => c.t === k), d = all.filter((c) => seen.has(c.id)).length;
    const shown = all.filter(match);
    if (!shown.length) return "";
    any = true;
    const mods = [...new Set(shown.map((c) => c.mod || "Other"))];
    return `<div class="trk"><div class="th"><h3>${v.name}</h3><span>${d}/${all.length}</span></div><div class="bar2"><i style="width:${(100 * d) / all.length}%;background:var(--${k})"></i></div>
    ${mods.map((m) => {
      const mc = shown.filter((c) => (c.mod || "Other") === m), md = mc.filter((c) => seen.has(c.id)).length;
      return `<details class="lmod" ${q ? "open" : ""}><summary><span>${esc(modName(m))}${m === "Community picks" ? ' <b class="cmtag">reviewed</b>' : ""}</span><small>${md}/${mc.length}</small>${CHEV}</summary>
        <div class="clist">${mc.map((c) => `<button class="citem" type="button" ${act({ a: "concept", id: c.id })}><i class="lvchip lv-${c.lv || "I"}" title="${LV_NAME[c.lv] || ""}">${c.lv || ""}</i><span>${esc(c.title)}</span>${seen.has(c.id) ? '<b class="tick">✓</b>' : ""}</button>`).join("")}</div></details>`;
    }).join("")}</div>`;
  }).join("") || `<p class="muted">No topics match "${esc(libQuery)}". Try a broader word, or ask the tutor.</p>`;
}
$("#libSearch").addEventListener("input", (e) => { libQuery = e.target.value; renderLib(); });

/* ---------- navigation ---------- */
const VIEWS = ["quests", "tutor", "interview", "practice", "library"];
function showView(v) {
  if (!VIEWS.includes(v)) v = "quests";
  const tab = v === "interview" ? "practice" : v;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === tab)));
  VIEWS.forEach((n) => ($("#view-" + n).hidden = n !== v));
  document.querySelectorAll(".subnav button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sub === v)));
  if (v === "interview" || v === "practice") store.set("psub", v);
  if (v === "library") renderLib();
  if (v === "practice" && typeof renderPractice === "function") renderPractice();
  if (v === "interview") renderInterview();
  if (v === "quests" && typeof renderQuests === "function") renderQuests();
  try { if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v); } catch (e) {}
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { showView(b.dataset.view === "practice" ? store.get("psub", "interview") : b.dataset.view); window.scrollTo({ top: 0 }); }));
document.addEventListener("click", (e) => { const b = e.target.closest("[data-sub]"); if (b) { showView(b.dataset.sub); window.scrollTo({ top: 0 }); } });

renderInterview();
renderEngineLine();
loadProviders();

/* ---------- "Check yourself" answers ---------- */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-sc]");
  if (!b) return;
  const c = CM[b.dataset.sc], box = $("#" + b.dataset.box), host = b.closest(".acts").nextElementSibling;
  const ans = box.value.trim();
  if (!aiOn()) {
    host.innerHTML = `<div class="aifb"><span class="eyebrow">From the notes</span><p>${esc(c.d)}</p><div class="example"><b>Example</b>${esc(c.e)}</div><p class="muted" style="font-size:14px">Compare this with what you wrote. Connect an AI provider in settings to get your answer checked.</p></div>`;
    return;
  }
  if (ans.split(/\s+/).filter(Boolean).length < 3) { host.innerHTML = `<p class="muted">Write your answer first, even a rough one.</p>`; return; }
  b.disabled = true;
  host.innerHTML = `<div class="aifb"><span class="eyebrow">Tutor</span><div class="md cursor"><p class="muted">Reading your answer…</p></div><p class="muted foot3" style="font-size:12.5px"></p></div>`;
  const body = host.querySelector(".md");
  try {
    const out = await streamChat({ mode: "selfcheck", detail, provider: engine.provider, model: engine.model, level: level || "work",
      question: c.c, answer: ans, context: [{ title: c.title, text: refText(c) }] }, (t) => { body.innerHTML = md(t); });
    body.classList.remove("cursor");
    host.querySelector(".foot3").textContent = `Checked by ${out.label} · ${out.model}`;
    b.disabled = false; b.textContent = "Check again";
  } catch (err) {
    body.classList.remove("cursor");
    body.innerHTML = `<p class="warnnote">Couldn't check your answer: ${esc(err.message)}</p>`;
    b.disabled = false;
  }
});
setDetail(detail);
