# Browser test for the installable web app: manifest and icons, offline copy, back button, keyboard, layouts at four widths.
# Needs tests/l2server.mjs running.
import os, json, urllib.request
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1

man = json.load(open(os.path.join(WEB, "manifest.webmanifest")))
ok(man["display"] == "standalone" and man["start_url"] and man["name"] == "Datakul", "manifest names the app and opens it standalone")
sizes = {i["sizes"] + i.get("purpose", "") for i in man["icons"]}
ok({"192x192any", "512x512any", "512x512maskable"} <= sizes, "manifest has 192, 512 and maskable icons")
ok(all(os.path.exists(os.path.join(WEB, i["src"])) for i in man["icons"]), "every manifest icon file exists")
ok(all(os.path.exists(os.path.join(WEB, f)) for f in ["sw.js", "icons/datakul-apple-180.png"]), "service worker and Apple icon exist")

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    c = b.new_context(viewport={"width": 1300, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(1500)
    ok(pg.get_attribute("link[rel=manifest]", "href") == "manifest.webmanifest", "page links the manifest")
    ok(pg.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)"), "service worker is active")
    pg.reload(); pg.wait_for_timeout(1200)
    # back button
    pg.keyboard.press("3"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#view-interview") or pg.is_visible("#view-practice"), "key 3 opens Practice")
    pg.keyboard.press("4"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#view-library"), "key 4 opens Library")
    pg.keyboard.press("1"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#view-quests"), "key 1 opens Quests")
    pg.keyboard.press("/"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#view-library") and pg.evaluate("document.activeElement.id") == "libSearch", "/ jumps to the library search box")
    pg.keyboard.type("1"); ok(pg.input_value("#libSearch") == "1" and pg.is_visible("#view-library"), "typing in a box does not trigger shortcuts")
    pg.fill("#libSearch", "")
    pg.evaluate("location.hash = '#cert'"); pg.wait_for_timeout(300)
    ok(pg.is_visible("#view-cert"), "changing the address hash switches screen (back button)")
    pg.evaluate("history.back()"); pg.wait_for_timeout(300)
    ok(not pg.is_visible("#view-cert"), "back leaves the exam screen")
    # offline
    c.set_offline(True); pg.goto(B + "/"); pg.wait_for_timeout(1200)
    ok("Datakul" in pg.title() and pg.locator(".tabs button").count() >= 4, "the app opens with no network")
    pg.keyboard.press("4"); pg.wait_for_timeout(300)
    ok(pg.locator("#lib .trk").count() >= 3, "the library works offline")
    c.set_offline(False); c.close()
    # layouts
    for w, h in [(390, 844), (768, 1024), (1280, 800), (1600, 900), (1920, 1080)]:
        for th in ["light", "dark", "black"]:
            c = b.new_context(viewport={"width": w, "height": h}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.add_init_script(f"localStorage.setItem('dp_theme', JSON.stringify('{th}'))")
            for v in ["quests", "interview", "library", "cert"]:
                pg.goto(B + "/"); pg.wait_for_timeout(250); pg.evaluate(f"showView('{v}')"); pg.wait_for_timeout(250)
                if pg.evaluate("document.documentElement.scrollWidth") > w:
                    ok(False, f"{w}px {th} {v}: sideways scroll")
            if th == "dark": pg.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", f"pwa-{w}.png"))
            c.close()
    ok(True, "no sideways scrolling in 5 widths x 3 themes x 4 screens (failures listed above)")
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL PWA TESTS PASSED")
raise SystemExit(1 if fails else 0)
