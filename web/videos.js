/* Video quests (Practice → Videos, #video): hand-picked public YouTube videos that the gateway has already split into
   parts with key points and a two-question check (worker/src/video.js; the owner adds them on the review page).
   Learners watch each part on YouTube, answer the check to clear it, and can ask the tutor about the video.
   The list is cached on the device (dp_videos) so it works offline; progress lives in dp_vq (synced with an account). */
"use strict";

const VQ_PART_XP = 15, VQ_FULL_XP = 50;
const VQ_GW = ((window.DATAKUL_CONFIG && window.DATAKUL_CONFIG.gatewayUrl) || "").replace(/\/+$/, "");
const VQ_TRACK = { de: "Data engineering", da: "Analysis", ds: "Data science", arch: "Architecture" };
const VQ_LEVEL = { new: "Beginner", work: "On the job", interview: "Interview prep" };
let vqList = vqClean(store.get("videos", [])), vqOpen = null, vqCh = 0, vqPicks = {}, vqChecked = false, vqLoad = "idle";

const vqState = () => Object.assign({ done: {}, full: {} }, store.get("vq", {}));
function vqSave(st) { store.set("vq", st); if (typeof qsSave === "function") qsSave(); }
const vqDone = (st, v) => (st.done[v.id] || []).filter((i) => i < v.chapters.length);
const vqClock = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const vqAt = (v, s) => `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}${s ? "&t=" + Math.round(s) + "s" : ""}`;
const vqFind = (id) => vqList.find((v) => v.id === id);

// Only keep well-formed entries: the list comes from the network and is drawn as HTML.
function vqClean(list) {
  const s = (x, n) => typeof x === "string" && x.length <= n;
  return (Array.isArray(list) ? list : []).filter((v) => v && /^[A-Za-z0-9_-]{11}$/.test(v.id) && s(v.title, 300) && Array.isArray(v.chapters) && v.chapters.length >= 2 &&
    v.chapters.every((c) => c && s(c.title, 200) && Number.isFinite(c.start) && s(c.summary, 1000) && Array.isArray(c.points) && Array.isArray(c.quiz) && c.quiz.length &&
      c.quiz.every((q) => q && s(q.q, 600) && Array.isArray(q.opts) && q.opts.length === 4 && q.opts.every((o) => s(o, 300)) && Number.isInteger(q.ans) && q.ans >= 0 && q.ans < 4)));
}

async function vqRefresh() {
  if (!VQ_GW || VQ_GW.startsWith("preview:")) { vqLoad = "off"; return; }
  vqLoad = "loading";
  try {
    const r = await fetch(VQ_GW + "/api/videos", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!Array.isArray(j.videos)) throw new Error("bad list");
    vqList = vqClean(j.videos); store.set("videos", vqList); vqLoad = "ok";
  } catch (e) { vqLoad = "down"; }
  if (document.querySelector("#view-video:not([hidden])")) renderVideos();
}
window.vqRefresh = vqRefresh;

function renderVideos() {
  const host = $("#videoBoard"); if (!host) return;
  const v = vqOpen && vqFind(vqOpen);
  if (!v) { vqOpen = null; host.innerHTML = vqHome(); return; }
  if (vqCh >= v.chapters.length) vqCh = 0;
  host.innerHTML = vqQuest(v);
}

function vqHome() {
  const st = vqState(), mine = typeof pathTrack === "function" ? pathTrack() : "de";
  const list = vqList.slice().sort((a, b) => (b.track === mine) - (a.track === mine));
  const note = vqLoad === "down" ? `<p class="muted vqnote">Can't reach Datakul right now${vqList.length ? ", so these are the videos saved on this device" : ""}.</p>` : "";
  return `<div class="card vqhead">
      <span class="eyebrow">Video quests</span>
      <h2>Learn from a video</h2>
      <p class="muted">Hand-picked talks and tutorials, split into short parts. Watch a part on YouTube, then answer two quick questions to clear it. +${VQ_PART_XP} XP a part, +${VQ_FULL_XP} XP for the whole video.</p>
    </div>${note}
    ${list.length ? `<div class="vqgrid">${list.map((x) => {
      const n = vqDone(st, x).length, all = x.chapters.length;
      return `<button type="button" class="card vqitem${st.full[x.id] ? " ok" : ""}" data-vq="${esc(x.id)}">
        <span class="eyebrow">${esc([VQ_TRACK[x.track], x.minutes ? x.minutes + " min" : ""].filter(Boolean).join(" · "))}</span>
        <b>${esc(x.title)}</b>
        <small>${esc(x.channel || "")}</small>
        <span class="meter"><span class="tr"><span class="fl" style="width:${Math.round((100 * n) / all)}%"></span></span><b>${st.full[x.id] ? "Done" : `${n} of ${all}`}</b></span>
      </button>`;
    }).join("")}</div>` : `<div class="card vqempty"><p class="muted">${vqLoad === "loading" ? climbLoader("Fetching videos…") : vqLoad === "off" ? "Video quests need the Datakul gateway, which isn't connected in this copy of the app." : "No videos yet. New ones are added by the Datakul team, so check back soon."}</p></div>`}`;
}

function vqQuest(v) {
  const st = vqState(), done = vqDone(st, v), c = v.chapters[vqCh], cleared = done.includes(vqCh);
  const next = c.start != null && v.chapters[vqCh + 1] ? v.chapters[vqCh + 1].start : null;
  return `<button type="button" class="pill vqback" data-vqback>← All videos</button>
    <div class="card vqtop">
      <span class="eyebrow">${esc([v.topic, VQ_LEVEL[v.level]].filter(Boolean).join(" · "))}</span>
      <h2>${esc(v.title)}</h2>
      <p class="muted">${esc([v.channel, v.minutes ? v.minutes + " min" : ""].filter(Boolean).join(" · "))}</p>
      ${v.summary ? `<p>${esc(v.summary)}</p>` : ""}
      <div class="meter"><div class="tr"><div class="fl" style="width:${Math.round((100 * done.length) / v.chapters.length)}%"></div></div><b>${done.length} of ${v.chapters.length} parts</b></div>
      <div class="vqparts" role="group" aria-label="Parts of the video">${v.chapters.map((x, i) => `<button type="button" class="simday vqpart${done.includes(i) ? " ok" : ""}${i === vqCh ? " cur" : ""}" aria-pressed="${i === vqCh}" data-vqch="${i}"><b>${i + 1}</b><small>${done.includes(i) ? "✓" : vqClock(x.start)}</small></button>`).join("")}</div>
      ${st.full[v.id] ? `<div class="simdone">Quest complete. Replay any part, or pick another video.</div>` : ""}
    </div>
    <article class="card vqch" aria-label="Part ${vqCh + 1}: ${esc(c.title)}">
      <span class="eyebrow">Part ${vqCh + 1} of ${v.chapters.length}</span>
      <h3>${esc(c.title)}</h3>
      <a class="btn quiet vqwatch" href="${vqAt(v, c.start)}" target="_blank" rel="noopener">▶ Watch ${vqClock(c.start)}${next != null ? "–" + vqClock(next) : " to the end"} on YouTube</a>
      <p>${esc(c.summary)}</p>
      <ul class="vqpts">${c.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <div class="vqquiz"><span class="eyebrow">Quick check${cleared ? " · cleared" : ""}</span>
        ${c.quiz.map((q, qi) => {
          const pick = vqPicks[qi];
          return `<fieldset class="copts vqq"><legend>${esc(q.q)}</legend>${q.opts.map((o, oi) => {
            const right = oi === q.ans, on = pick === oi;
            const cls = vqChecked ? (right ? " right" : on ? " wrong" : "") : on ? " on" : "";
            return `<label class="copt${cls}"><input type="radio" name="vqa${qi}" value="${oi}" ${on ? "checked" : ""} ${vqChecked ? "disabled" : ""}><span>${esc(o)}</span>${vqChecked && right ? '<b class="cmark">✓</b>' : vqChecked && on ? '<b class="cmark">✗</b>' : ""}</label>`;
          }).join("")}${vqChecked ? `<div class="cfb ${pick === q.ans ? "ok" : "no"}"><b>${pick === q.ans ? "Right." : "Not quite."}</b><span>${esc(q.why)}</span></div>` : ""}</fieldset>`;
        }).join("")}
        <div class="acts">${vqChecked ? `<button class="btn quiet" type="button" data-vqretry>Try again</button>${vqCh + 1 < v.chapters.length ? `<button class="btn" type="button" data-vqch="${vqCh + 1}">Next part</button>` : ""}` : `<button class="btn" type="button" data-vqcheck>Check answers</button>`}</div>
        <p id="vqMsg" class="muted" role="status"></p>
      </div>
    </article>
    ${st.full[v.id] && v.takeaways && v.takeaways.length ? `<div class="card vqtake"><span class="eyebrow">Remember from this video</span><ul class="vqpts">${v.takeaways.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
    <div class="card vqask"><span class="eyebrow">Ask about this video</span>
      ${aiOn() ? `<label class="sr" for="vqAskIn">Your question about this video</label><textarea class="ans-in sc-in" id="vqAskIn" placeholder="e.g. Why does it need a checkpoint?"></textarea><div class="acts"><button class="btn quiet" type="button" data-vqask>Ask the tutor</button></div><div id="vqAI"></div>`
        : `<p class="muted">Connect an AI provider in Settings to ask the tutor about this video.</p>`}
    </div>`;
}

function vqCheck() {
  const v = vqFind(vqOpen), c = v.chapters[vqCh];
  c.quiz.forEach((q, qi) => { const el = document.querySelector(`input[name="vqa${qi}"]:checked`); if (el) vqPicks[qi] = +el.value; });
  if (c.quiz.some((q, qi) => vqPicks[qi] == null)) { $("#vqMsg").textContent = "Answer every question first."; return; }
  vqChecked = true;
  const all = c.quiz.every((q, qi) => vqPicks[qi] === q.ans), st = vqState(), done = vqDone(st, v);
  if (all && !done.includes(vqCh)) {
    st.done[v.id] = [...done, vqCh].sort((a, b) => a - b);
    const full = st.done[v.id].length === v.chapters.length && !st.full[v.id];
    if (full) st.full[v.id] = true;
    vqSave(st);
    if (typeof award === "function") award(VQ_PART_XP, `Video part ${vqCh + 1} cleared`);
    if (typeof bumpDaily === "function") bumpDaily("step");
    if (full && typeof award === "function") setTimeout(() => award(VQ_FULL_XP, "Video quest complete"), 1400);
    if (typeof checkBadges === "function") checkBadges();
    if (typeof refreshChrome === "function") refreshChrome();
  } else if (typeof buzz === "function" && !all) buzz(12);
  renderVideos();
  const m = $("#vqMsg"); if (m) m.textContent = all ? "Part cleared." : "Check the explanations, watch the part again if you need to, and try again.";
  const fb = document.querySelector(".vqquiz .acts"); if (fb) fb.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "nearest" });
}

// The tutor gets the video's own notes as its context, so answers stay on what the video covers.
function vqContext(v) {
  const t = [v.summary, ...v.chapters.map((c, i) => `Part ${i + 1} (${vqClock(c.start)}): ${c.title}. ${c.summary} ${c.points.join(" ")}`), v.takeaways && v.takeaways.length ? "Takeaways: " + v.takeaways.join("; ") : ""].filter(Boolean).join("\n");
  return [{ title: `Video: ${v.title}${v.channel ? " (" + v.channel + ")" : ""}`, text: t.slice(0, 6500) }];
}
async function vqAsk() {
  const v = vqFind(vqOpen), box = $("#vqAskIn"), host = $("#vqAI"), btn = document.querySelector("[data-vqask]");
  const q = box.value.trim();
  if (q.split(/\s+/).filter(Boolean).length < 2) { host.innerHTML = `<p class="muted">Type a question first.</p>`; return; }
  btn.disabled = true;
  host.innerHTML = `<div class="aifb"><span class="eyebrow">Tutor</span><div class="md cursor">${climbLoader("Thinking about the video…")}</div><p class="muted foot3" style="font-size:12.5px"></p></div>`;
  const body = host.querySelector(".md");
  try {
    const out = await streamChat({ detail, provider: engine.provider, model: engine.model, level: level || "work", question: q, context: vqContext(v), store: shareOn() },
      (t) => { body.innerHTML = md(t); });
    body.classList.remove("cursor");
    host.querySelector(".foot3").textContent = `Answered by ${out.label} · ${out.model}, from the video's notes. AI can be wrong; the video is the source.`;
    if (typeof QS !== "undefined") { QS.asks = (QS.asks || 0) + 1; if (typeof bumpDaily === "function") bumpDaily("ask"); if (typeof qsSave === "function") qsSave(); }
  } catch (e) {
    body.classList.remove("cursor");
    body.innerHTML = `<p class="warnnote">The tutor isn't available right now: ${esc(e.message)}</p>`;
  }
  btn.disabled = false;
}

document.addEventListener("click", (e) => {
  const o = e.target.closest("[data-vq]");
  if (o) { vqOpen = o.dataset.vq; const v = vqFind(vqOpen), d = v ? vqDone(vqState(), v) : []; vqCh = v ? Math.max(0, v.chapters.findIndex((x, i) => !d.includes(i))) : 0; vqPicks = {}; vqChecked = false; renderVideos(); window.scrollTo({ top: 0 }); return; }
  if (e.target.closest("[data-vqback]")) { vqOpen = null; renderVideos(); window.scrollTo({ top: 0 }); return; }
  const ch = e.target.closest("[data-vqch]");
  if (ch) { vqCh = +ch.dataset.vqch; vqPicks = {}; vqChecked = false; renderVideos(); const a = $(".vqch"); if (a) a.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" }); return; }
  if (e.target.closest("[data-vqcheck]")) return vqCheck();
  if (e.target.closest("[data-vqretry]")) { vqPicks = {}; vqChecked = false; renderVideos(); return; }
  if (e.target.closest("[data-vqask]")) return vqAsk();
});
document.addEventListener("change", (e) => {
  const m = /^vqa(\d+)$/.exec(e.target.name || ""); if (!m) return;
  vqPicks[+m[1]] = +e.target.value;
  e.target.closest("fieldset").querySelectorAll(".copt").forEach((l) => l.classList.toggle("on", l.contains(e.target)));
  const msg = $("#vqMsg"); if (msg) msg.textContent = "";
});
// The start-up screen is chosen before this file loads; fill it in if the app opened straight on video quests.
if ($("#view-video") && !$("#view-video").hidden) { renderVideos(); vqRefresh(); }
