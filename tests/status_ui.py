# Browser test for the review page's AI status tab. Needs tests/l2server.mjs running (same as l2ui.py).
import os, json, urllib.request
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1
# a few AI calls so there is something to show
for q in ["what is change data capture", "explain window functions"]:
    r = urllib.request.Request(B + "/api/chat", data=json.dumps({"mode": "tutor", "provider": "groq", "question": q}).encode(), headers={"content-type": "application/json"}, method="POST")
    urllib.request.urlopen(r).read()
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    for vw, theme, tag in [(1300, "light", "desk"), (390, "dark", "phone")]:
        c = b.new_context(viewport={"width": vw, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(f"localStorage.setItem('dp_theme', JSON.stringify('{theme}'))")
        pg.goto(B + "/admin.html"); pg.wait_for_timeout(400)
        pg.fill("#tokIn", "test-token"); pg.click("#login button[type=submit]"); pg.wait_for_timeout(700)
        pg.click("[data-tab=status]"); pg.wait_for_timeout(800)
        ok(pg.is_visible("#statusView") and not pg.is_visible("#queueGrid"), f"{tag}: AI status tab replaces the queue")
        txt = pg.inner_text("#statusView")
        ok("AI calls today" in txt and "GPT-OSS 120B" in txt, f"{tag}: summary and every model are shown")
        ok(pg.locator(".hl.ok").count() >= 1 and pg.locator(".ubar").count() >= 1, f"{tag}: health and free-allowance bars are drawn")
        ok("Ask answers" in txt, f"{tag}: calls are broken down by feature")
        pg.click("[data-ping='0']"); pg.wait_for_timeout(800)
        ok("Answered in" in pg.inner_text("#ping-0"), f"{tag}: Check now reports the result")
        if tag == "phone":
            ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, "phone: the page doesn't scroll sideways (the table scrolls in its box)")
        pg.screenshot(path=f"{OUT}/status-{tag}.png", full_page=True)
        pg.click("[data-tab=review]"); pg.wait_for_timeout(200)
        ok(pg.is_visible("#queueGrid"), f"{tag}: switching back shows the review queue")
        c.close()
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL STATUS UI TESTS PASSED")
raise SystemExit(1 if fails else 0)
