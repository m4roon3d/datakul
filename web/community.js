/* Datakul community picks (layer 2): concept cards written from questions learners asked,
   checked automatically and approved by a reviewer, then served by the gateway's /api/community.
   Loaded right after library.js: cards cached from the last visit join the library before anything is indexed,
   and communityRefresh() fetches new ones once the app has started. */
"use strict";
(function () {
  const KEY = "dp_comm";
  const GWU = ((window.DATAKUL_CONFIG && window.DATAKUL_CONFIG.gatewayUrl) || "").replace(/\/+$/, "");
  const s = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const valid = (k) => k && typeof k.id === "string" && /^cm-[a-z0-9-]{3,80}$/.test(k.id) && k.concept && TRACKS[k.concept.t] && s(k.concept.title, 80) && s(k.concept.s, 400) && Array.isArray(k.questions);

  function add(cards) {
    const added = [];
    for (const k of Array.isArray(cards) ? cards : []) {
      if (!valid(k) || CM[k.id]) continue;
      const x = k.concept;
      const c = {
        id: k.id, t: x.t, title: s(x.title, 80), mod: "Community picks", lv: ["F", "I", "A"].includes(x.lv) ? x.lv : "I",
        kw: s(x.kw, 300), s: s(x.s, 400), d: s(x.d, 1200), e: s(x.e, 450), c: s(x.c, 300), i: s(x.i, 350),
        r: (Array.isArray(x.r) ? x.r : []).filter((r) => CM[r] && r !== k.id).slice(0, 3), cm: 1, asked: Number(k.asked) || 0,
        nw: k.approved ? new Date(Number(k.approved)).toISOString().slice(0, 10) : undefined,
      };
      C.push(c); CM[c.id] = c;
      k.questions.forEach((q) => {
        if (!q || !s(q.q, 400) || !Array.isArray(q.p) || q.p.length < 2) return;
        const p = q.p.filter((pt) => pt && s(pt.t, 200) && Array.isArray(pt.k) && pt.k.length).map((pt) => ({ t: s(pt.t, 200), k: pt.k.map(String).slice(0, 10) }));
        if (p.length < 2) return;
        Q.push({ q: s(q.q, 400), c: c.id, r: Array.isArray(q.r) && q.r.length ? q.r.filter((r) => TRACKS[r]) : [c.t], l: ["j", "m", "s"].includes(q.l) ? q.l : "m",
          d: Array.isArray(q.d) && q.d.length ? q.d : ["any"], tg: Array.isArray(q.tg) ? q.tg : [], p, a: s(q.a, 1500), cm: 1 });
      });
      added.push(c);
    }
    return added;
  }

  let cached = [];
  try { cached = (JSON.parse(localStorage.getItem(KEY) || "{}").cards) || []; } catch (e) {}
  add(cached);

  window.communityAdd = add;
  window.communityRefresh = async function () {
    if (!GWU || GWU.startsWith("preview:")) return [];
    try {
      const r = await fetch(GWU + "/api/community");
      if (!r.ok) return [];
      const j = await r.json();
      if (!Array.isArray(j.cards)) return [];
      try { localStorage.setItem(KEY, JSON.stringify({ cards: j.cards, at: Date.now() })); } catch (e) {} // cards withdrawn by a reviewer drop out on the next visit
      const added = add(j.cards);
      if (added.length && typeof window.onCommunityAdded === "function") window.onCommunityAdded(added);
      return added;
    } catch (e) { return []; }
  };
})();
