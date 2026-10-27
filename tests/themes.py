# Browser test for appearance: Auto/Light/Dark/Pitch dark, saved choice, no flash, and the phone header fitting.
# Needs tests/l2server.mjs running (same as l2ui.py).
import os
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1
BG = {"light": "rgb(242, 246, 248)", "dark": "rgb(7, 28, 39)", "black": "rgb(0, 0, 0)"}
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    c = b.new_context(viewport={"width": 390, "height": 844}, color_scheme="light"); pg = c.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#quests"); pg.wait_for_timeout(700)
    ok(pg.evaluate("document.documentElement.dataset.theme") is None, "starts on Auto")
    ok(pg.is_visible(".tb .tbrand .wm"), "phone header shows the datakul wordmark")
    ok(pg.is_visible("#gear") and pg.evaluate("document.documentElement.scrollWidth") <= 390, "phone header fits: logo, chips and settings")
    pg.click("#gear"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#themeSeg") and pg.evaluate("document.querySelector('#sheet .sheet-card').scrollTop") == 0, "settings open at Appearance")
    for t, label in [("dark", "Dark"), ("black", "Pitch dark"), ("light", "Light")]:
        pg.click(f"#themeSeg >> text={label}"); pg.wait_for_timeout(100)
        bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
        meta = pg.evaluate("document.querySelector('meta[name=theme-color]').content")
        ok(pg.evaluate("document.documentElement.dataset.theme") == t and bg == BG[t], f"{label}: background {bg}, browser bar {meta}")
    pg.click("#themeSeg >> text=Pitch dark"); pg.click("#sheetDone")
    pg.reload(); pg.wait_for_timeout(50)
    ok(pg.evaluate("document.documentElement.dataset.theme") == "black", "choice is remembered and applied before first paint")
    pg.evaluate("localStorage.setItem('dp_theme', JSON.stringify('auto'))")
    c2 = b.new_context(color_scheme="dark"); p2 = c2.new_page(); p2.add_init_script("localStorage.setItem('dp_theme', JSON.stringify('auto'))")
    p2.goto(B + "/#quests"); p2.wait_for_timeout(500)
    ok(p2.evaluate("getComputedStyle(document.body).backgroundColor") == BG["dark"], "Auto follows a device in dark mode")
    a = b.new_page(); a.add_init_script("localStorage.setItem('dp_theme', JSON.stringify('black'))"); a.goto(B + "/admin.html"); a.wait_for_timeout(300)
    ok(a.evaluate("getComputedStyle(document.body).backgroundColor") == BG["black"], "review page follows the chosen theme")
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL THEME TESTS PASSED")
raise SystemExit(1 if fails else 0)
