# Browser test for "Teach me the answer": every question can teach, the lesson shows each key point with the sentence
# that earns it, recall from memory is checked and scheduled for review, and the AI tutor can explain it more simply.
# Needs tests/l2server.mjs running (same as l2ui.py).
import os
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    for vw, vh, theme, tag in [(1300, 900, "light", "desk"), (390, 844, "black", "phone")]:
        c = b.new_context(viewport={"width": vw, "height": vh}); pg = c.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(f"localStorage.setItem('dp_theme', JSON.stringify('{theme}'))")
        pg.goto(B + "/#interview"); pg.wait_for_timeout(1200)
        if tag == "desk":
            ok(pg.evaluate("Q.every(q => q.a && q.a.length >= 120)"), "every question has a model answer")
            ok(pg.evaluate("Q.every(q => grade(q.a, q).n === q.p.length)"), "every model answer earns all its key points")
        pg.click(".qbtn >> nth=0"); pg.wait_for_timeout(200)
        i = pg.evaluate("openQ")
        pg.click(f"[data-reveal='{i}']"); pg.wait_for_timeout(200)
        n_pts = pg.evaluate(f"Q[{i}].p.length")
        ok(pg.locator(f"#res-{i} .teach .steps li").count() == n_pts, f"{tag}: lesson shows all {n_pts} key points in order")
        ok(pg.locator(f"#res-{i} .teach .steps q").count() == n_pts and pg.locator(f"#res-{i} .teach mark").count() >= n_pts, f"{tag}: each point quotes the sentence that earns it, keywords highlighted")
        if tag == "desk":
            pg.click(f"#res-{i} .full summary"); pg.wait_for_timeout(100)
            ok(pg.is_visible(f"#res-{i} .full p"), "the whole model answer opens")
            ok(pg.locator("[data-simpler]").count() == 1, "AI 'Explain it more simply' is offered when AI is on")
            pg.click("[data-simpler]"); pg.wait_for_timeout(1500)
            ok("Vector databases" in pg.inner_text(f"#res-{i} .teachai") or len(pg.inner_text(f"#res-{i} .teachai")) > 20, "AI explanation streams in under the lesson")
            pg.fill(f"#fu-{i}", "why does the order matter?"); pg.press(f"#fu-{i}", "Enter"); pg.wait_for_timeout(1500)
            ok(pg.locator(f"#res-{i} .teachai .aifb").count() == 2, "a follow-up question gets its own answer")
        pg.screenshot(path=f"{OUT}/teach-{tag}.png", full_page=False) if tag == "phone" else pg.locator(f"#qr-{i}").screenshot(path=f"{OUT}/teach-{tag}.png")
        pg.click(f"[data-tryown='{i}']"); pg.wait_for_timeout(100)
        ok(pg.evaluate(f"document.querySelector('#ans-{i}').value") == "" and pg.evaluate(f"document.activeElement.id") == f"ans-{i}", f"{tag}: 'try it in your own words' clears and focuses the answer box")
        cid = pg.evaluate(f"Q[{i}].c")
        ok(pg.evaluate(f"QS.rev['{cid}'] && QS.rev['{cid}'].due === addDays(today(), 1)"), f"{tag}: the topic comes back for review tomorrow")
        pg.fill(f"#ans-{i}", pg.evaluate(f"Q[{i}].a")); pg.click(f"[data-check='{i}']"); pg.wait_for_timeout(200)
        ok("recalled" in pg.inner_text(f"#res-{i}") and pg.evaluate(f"document.querySelectorAll('#res-{i} .pts li.ok').length") == n_pts, f"{tag}: recall is checked and praised")
        pg.fill(f"#ans-{i}", "I am not sure, I would ask the team and keep things simple and maintainable."); pg.click(f"[data-check='{i}']"); pg.wait_for_timeout(200)
        ok(pg.locator(f"#res-{i} [data-reveal]").count() == 1, f"{tag}: a weak answer offers 'Teach me the answer'")
        if tag == "phone":
            ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, "phone: no sideways scrolling")
        c.close()
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL TEACH TESTS PASSED")
raise SystemExit(1 if fails else 0)
