/* Optional account: Google sign-in so progress follows the learner between devices.
   Hidden unless the gateway says sign-in is on. Without an account nothing changes: progress stays in this browser.
   Only learning progress is synced (never the theme, answer engine or other device settings). */
(() => {
  if (!GW) return;
  const KEYS = ["qs", "cert", "mycards", "practice", "seen"];
  const SES = "dp_session";
  const wrap = $("#acctWrap"), outEl = $("#acctOut"), inEl = $("#acctIn"), msg = $("#acctMsg");
  let cfg = null, ses = null, gisLoaded = false, timer = null, running = false, lastRun = 0;
  try { ses = JSON.parse(localStorage.getItem(SES)); if (ses && ses.expires < Date.now()) ses = null; } catch (e) { ses = null; }
  const saveSes = () => { try { ses ? localStorage.setItem(SES, JSON.stringify(ses)) : localStorage.removeItem(SES); } catch (e) {} };

  /* ---- merging: nothing the learner earned on either side is lost ---- */
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d\d-\d\d/.test(s);
  function merge(a, b, path) {
    if (a === undefined || a === null) return b;
    if (b === undefined || b === null) return a;
    if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
    if (typeof a === "boolean" && typeof b === "boolean") return a || b;
    if (typeof a === "string" && typeof b === "string") return isDate(a) && isDate(b) && b > a ? b : a;
    if (Array.isArray(a) && Array.isArray(b)) {
      const idOf = (x) => (x && typeof x === "object" ? (x.id !== undefined ? "i" + x.id : x.t !== undefined ? "t" + x.t + (x.q || x.c || "") : JSON.stringify(x)) : "v" + JSON.stringify(x));
      const seen = new Map(a.map((x) => [idOf(x), x]));
      const out = a.slice();
      b.forEach((x) => { const k = idOf(x); if (seen.has(k)) { const i = out.indexOf(seen.get(k)); out[i] = merge(out[i], x, path + "[]"); } else { out.push(x); seen.set(k, x); } });
      return /(^|\.)(att|mocks)$/.test(path) ? out.sort((p, q) => (p.t || 0) - (q.t || 0)) : out;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const o = { ...a };
      Object.keys(b).forEach((k) => { o[k] = merge(a[k], b[k], path ? path + "." + k : k); });
      return o;
    }
    return a;
  }
  const collect = () => { const o = {}; KEYS.forEach((k) => { try { if (localStorage.getItem("dp_" + k) != null) o[k] = store.get(k); } catch (e) {} }); return o; };
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  async function api(path, opt = {}) {
    const r = await fetch(GW + path, { ...opt, headers: { "content-type": "application/json", ...(ses ? { authorization: "Bearer " + ses.token } : {}), ...(opt.headers || {}) } });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok, json: j || {} };
  }
  function expired() { ses = null; saveSes(); render(); say("Please sign in again."); }

  /* pull, merge, push. Safe to run any time; a second device's changes arrive here. */
  async function reconcile() {
    if (!ses || running) return false;
    running = true;
    try {
      for (let tries = 0; tries < 3; tries++) {
        const g = await api("/api/sync");
        if (g.status === 401) { expired(); return false; }
        if (!g.ok) throw new Error("sync");
        const local = collect(), merged = merge(local, g.json.data || {}, "");
        const changedLocal = !same(merged, local);
        if (changedLocal) KEYS.forEach((k) => { if (merged[k] !== undefined && !same(merged[k], local[k])) store.set(k, merged[k]); });
        if (!same(merged, g.json.data || {})) {
          const p = await api("/api/sync", { method: "PUT", body: JSON.stringify({ data: merged, base: g.json.updated_at }) });
          if (p.status === 409) continue;
          if (p.status === 401) { expired(); return false; }
          if (!p.ok) throw new Error("sync");
          ses.base = p.json.updated_at;
        } else ses.base = g.json.updated_at;
        ses.at = Date.now(); saveSes(); render();
        if (changedLocal) { toast("<span>Progress from your other devices was added.</span>"); setTimeout(() => location.reload(), 700); }
        return true;
      }
    } catch (e) { say("Couldn't sync just now. It will try again."); }
    finally { running = false; lastRun = Date.now(); }
    return false;
  }
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(reconcile, ms); };

  async function signInWithCredential(credential) {
    say("Signing in…");
    const r = await api("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) });
    if (!r.ok) { say(r.json.error || "Sign-in didn't work. Please try again."); return false; }
    ses = { token: r.json.token, expires: r.json.expires, user: r.json.user, base: 0, at: 0 };
    saveSes(); render(); say("");
    await reconcile();
    toast("<span>Signed in as <b>" + esc(ses.user.name || ses.user.email) + "</b>. Progress will sync.</span>");
    return true;
  }
  async function signOut() {
    try { await api("/api/auth/signout", { method: "POST" }); } catch (e) {}
    ses = null; saveSes(); render(); say("Signed out. Your progress stays on this device.");
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (e) {}
  }
  let armed = 0;
  async function deleteAccount(btn) {
    if (!armed || Date.now() - armed > 6000) { armed = Date.now(); btn.textContent = "Tap again to delete for good"; setTimeout(() => { if (btn.isConnected && armed && Date.now() - armed >= 6000) { armed = 0; btn.textContent = "Delete my account"; } }, 6200); return; }
    armed = 0; btn.disabled = true;
    const r = await api("/api/me", { method: "DELETE" });
    btn.disabled = false; btn.textContent = "Delete my account";
    if (!r.ok && r.status !== 401) { say("Couldn't delete just now. Please try again."); return; }
    ses = null; saveSes(); render(); say("Your account and synced progress are deleted. Progress on this device is kept.");
  }

  /* ---- screen ---- */
  function say(t) { if (msg) msg.textContent = t || ""; }
  const ago = (t) => { if (!t) return "not yet"; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; };
  function render() {
    if (!wrap) return;
    wrap.hidden = !(cfg && cfg.enabled);
    if (wrap.hidden) return;
    outEl.hidden = !!ses; inEl.hidden = !ses;
    if (ses) {
      const n = ses.user.name || ses.user.email || "Learner";
      $("#acctAvatar").textContent = (n.trim()[0] || "?").toUpperCase();
      $("#acctName").textContent = n; $("#acctEmail").textContent = ses.user.email || "";
      $("#acctSync").textContent = "Progress synced " + ago(ses.at);
    }
  }
  function loadGoogle() {
    if (gisLoaded || ses || !cfg || !cfg.enabled) return; gisLoaded = true;
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => {
      try {
        google.accounts.id.initialize({ client_id: cfg.clientId, callback: (r) => signInWithCredential(r.credential), ux_mode: "popup", auto_select: false });
        google.accounts.id.renderButton($("#gBtn"), { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 280 });
      } catch (e) { say("Google sign-in couldn't start."); }
    };
    s.onerror = () => { gisLoaded = false; say("Google sign-in couldn't load. Check your connection."); };
    document.head.appendChild(s);
  }

  if (wrap) {
    $("#acctSignOut").addEventListener("click", signOut);
    $("#acctSyncNow").addEventListener("click", async () => { say("Syncing…"); const ok = await reconcile(); if (ok) say(""); });
    $("#acctDelete").addEventListener("click", (e) => deleteAccount(e.currentTarget));
    new MutationObserver(() => { if (!$("#sheet").hidden) { loadGoogle(); render(); } }).observe($("#sheet"), { attributes: true, attributeFilter: ["hidden"] });
  }

  /* keep it in step: after changes, when the app comes back to the front, when the network returns */
  const _set = store.set;
  store.set = function (k, v) { _set.call(store, k, v); if (ses && KEYS.includes(k)) later(5000); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ses && Date.now() - lastRun > 30000) reconcile(); });
  window.addEventListener("online", () => { if (ses) later(1000); });

  window.dkAccount = { signInWithCredential, reconcile, merge, state: () => ({ signedIn: !!ses, user: ses && ses.user, base: ses && ses.base }) };

  fetch(GW + "/api/auth/config").then((r) => r.json()).then((c) => { cfg = c; render(); if (ses) reconcile(); }).catch(() => {});
})();
