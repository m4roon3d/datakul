/* Install, offline, back button and keyboard shortcuts. Loaded last; everything here is wrapped so it adds no globals. */
(() => {
  /* offline copy (needs https; skipped on file:// and plain http except localhost) */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  /* install button in Settings */
  const wrap = document.getElementById("installWrap"), btn = document.getElementById("installBtn"), tip = document.getElementById("installTip");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let deferred = null;
  if (wrap && !standalone) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (ios) { wrap.hidden = false; btn.hidden = true; tip.textContent = "On iPhone or iPad: tap Share, then Add to Home Screen."; }
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; wrap.hidden = false; btn.hidden = false; tip.textContent = "Opens like an app, with its own icon, and keeps working offline."; });
    btn && btn.addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch (e) {} deferred = null; wrap.hidden = true; });
    window.addEventListener("appinstalled", () => { wrap.hidden = true; });
  }

  /* the browser's back and forward buttons move between screens */
  window.addEventListener("hashchange", () => {
    const v = location.hash.slice(1);
    if (VIEWS.includes(v)) { showView(v); window.scrollTo({ top: 0 }); }
  });

  /* keyboard: 1 to 5 switch tabs, / jumps to search, ? shows the list. Never fires while typing or with a dialog open. */
  const typing = (t) => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const sheet = document.getElementById("sheet");
    if (sheet && !sheet.hidden) return;
    const tabs = { 1: "quests", 2: "tutor", 3: "practice", 4: "library", 5: "cert" };
    if (tabs[e.key]) { showView(tabs[e.key] === "practice" ? lastPractice() : tabs[e.key]); window.scrollTo({ top: 0 }); return; }
    if (e.key === "/") {
      const lib = document.getElementById("view-library");
      if (!lib || lib.hidden) showView("library");
      const s = document.getElementById("libSearch"); if (s) { e.preventDefault(); s.focus(); }
      return;
    }
    if (e.key === "?") toast("<span><b>Keys:</b> 1 Quests · 2 Ask · 3 Practice · 4 Library · 5 Certifications · / Search</span>");
  });
})();
