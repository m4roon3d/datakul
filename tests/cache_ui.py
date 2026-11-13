# Browser test for saved answers: the app labels a saved answer honestly, still sends a live one normally,
# and tells the gateway not to save answers when "Help grow the library" is switched off.
# Needs tests/l2server.mjs running (same as l2ui.py).
import json, os
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1

SAVED = "data: " + json.dumps({"choices": [{"delta": {"content": "**CDC copies only the changes.**\n\nYour turn: when would you skip it?"}}]}) + "\n\ndata: [DONE]\n\n"
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    c = b.new_context(viewport={"width": 390, "height": 844}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    sent = []
    def handle(route):
        body = json.loads(route.request.post_data or "{}"); sent.append(body)
        if body.get("mode") == "tutor" and "cdc" in body.get("question", "").lower():
            route.fulfill(status=200, headers={"content-type": "text/event-stream", "x-provider": "cache", "x-provider-label": "Groq", "x-model": "openai/gpt-oss-120b"}, body=SAVED)
        else:
            route.continue_()
    pg.route("**/api/chat", handle)
    pg.goto(B + "/#tutor"); pg.wait_for_timeout(900)

    pg.fill("#askInput", "What is change data capture (CDC)?"); pg.press("#askInput", "Enter"); pg.wait_for_timeout(1500)
    foot = pg.locator("#view-tutor .ans").last.inner_text()
    ok("Saved answer to a common question, first written by Groq" in foot, "saved answer is labelled as saved, with who wrote it")
    ok("was busy" not in foot, "a saved answer is not mistaken for a busy provider")
    ok(sent and sent[-1].get("store") is True, "sharing on: the gateway may save answers")

    pg.fill("#askInput", "What is a data lake?"); pg.press("#askInput", "Enter"); pg.wait_for_timeout(1800)
    foot = pg.locator("#view-tutor .ans").last.inner_text()
    ok("Answered by" in foot and "Saved answer" not in foot, "a live answer keeps the usual label")

    pg.evaluate("localStorage.setItem('dp_share', 'false')"); pg.reload(); pg.wait_for_timeout(900)
    pg.goto(B + "/#tutor"); pg.wait_for_timeout(500)
    pg.fill("#askInput", "What is CDC?"); pg.press("#askInput", "Enter"); pg.wait_for_timeout(1200)
    ok(sent[-1].get("store") is False, "sharing off: the app asks the gateway not to save the answer")
    c.close()

    # Review page shows the saved-answers block, and Clear works.
    c = b.new_context(viewport={"width": 1280, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/admin.html"); pg.wait_for_timeout(500)
    pg.fill("#tokIn", "test-token"); pg.click("#login button[type=submit]"); pg.wait_for_timeout(700)
    pg.click("[data-tab=status]"); pg.wait_for_timeout(800)
    txt = pg.inner_text("#statusView")
    ok("Saved answers" in txt and "served today without an AI call" in txt and "answers saved" in txt, "review page shows saved answers")
    pg.click("#cacheClear"); pg.wait_for_timeout(600)
    ok("Cleared" in pg.inner_text("#cacheMsg"), "Clear saved answers works")
    pg.locator("#statusView").screenshot(path=os.path.join(os.path.dirname(__file__), "out", "cache_admin.png"))
    c.close()
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL CACHE UI TESTS PASSED")
raise SystemExit(1 if fails else 0)
