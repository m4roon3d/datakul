# Browser test for the job simulator: reachable from Practice on phone and desktop, a vague reply doesn't clear the
# day, a full reply does (XP once), the week completes with a badge, roles switch, the colleague's AI review streams,
# drafts survive switching days, and it fits phone width in all three themes.
# Needs tests/l2server.mjs running (same as l2ui.py).
import json, os
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(__file__), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1

VAGUE = "Thanks for flagging this, I will look into it and get back to you soon with more details about what happened."
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []

    # Phone: Practice tab → Job sim sub-tab.
    for theme in ["light", "dark", "black"]:
        c = b.new_context(viewport={"width": 390, "height": 844}); c.add_init_script(f"localStorage.setItem('dp_theme', JSON.stringify('{theme}'));")
        pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(B + "/#quests"); pg.wait_for_timeout(700)
        pg.click("#tab-practice"); pg.wait_for_timeout(300)
        pg.click("#view-interview .subnav [data-sub=sim]"); pg.wait_for_timeout(400)
        ok(pg.is_visible("#view-sim") and pg.is_visible("#simBoard .simtk"), f"{theme}: Practice → Job sim opens the simulator")
        ok(pg.get_attribute("#tab-practice", "aria-selected") == "true", f"{theme}: Practice tab stays selected")
        ok("Data Engineer at Chaiwala Pay" in pg.inner_text("#simBoard"), f"{theme}: starts on the learner's path (Data Engineer)")
        ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, f"{theme}: no sideways scroll at phone width")
        ok(pg.evaluate("[...document.querySelectorAll('.simday')].every((d) => d.getBoundingClientRect().height >= 44)"), f"{theme}: day buttons are big enough to tap")
        pg.screenshot(path=f"{OUT}/jobsim_{theme}.png", full_page=True)
        c.close()

    c = b.new_context(viewport={"width": 390, "height": 844}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    sent = []
    pg.on("request", lambda r: sent.append(json.loads(r.post_data)) if r.url.endswith("/api/chat") and r.post_data else None)
    pg.goto(B + "/#sim"); pg.wait_for_timeout(800)
    ok(pg.is_visible("#simBoard .simtk"), "#sim opens the simulator directly")
    xp0 = pg.evaluate("QS.xp")

    # Too short, then vague: not cleared.
    pg.fill("#simAns", "I'll fix it."); pg.click("#simSend"); pg.wait_for_timeout(200)
    ok("Write a fuller answer" in pg.inner_text("#simOut"), "a one-liner asks for a fuller reply")
    pg.fill("#simAns", VAGUE); pg.click("#simSend"); pg.wait_for_timeout(300)
    ok("Not quite" in pg.inner_text("#simOut") and pg.evaluate("QS.xp") == xp0, "a vague reply doesn't clear the day or earn XP")
    ok(pg.is_visible("#simModel"), "after a try, the senior's reply can be shown")
    pg.click("#simModel"); pg.wait_for_timeout(200)
    ok(pg.locator(".simmodel mark").count() >= 5, "senior's reply highlights what Quick check listens for")

    # A full reply clears Monday and gives XP once.
    model = pg.evaluate("SIM.de.days[0].a")
    pg.fill("#simAns", model); pg.click("#simSend"); pg.wait_for_timeout(400)
    ok("Day cleared" in pg.inner_text("#simOut"), "a full reply clears the day")
    ok(pg.evaluate("QS.xp") == xp0 + 40, "clearing a day gives 40 XP")
    ok("✓ 100%" in pg.locator(".simday").nth(0).inner_text(), "Monday shows as cleared with the score")
    pg.fill("#simAns", model); pg.click("#simSend"); pg.wait_for_timeout(300)
    ok(pg.evaluate("QS.xp") == xp0 + 40, "replaying a cleared day gives no extra XP")

    # Colleague's AI review streams in character.
    ok(pg.is_visible("#simReview"), "with AI on, you can ask the colleague for feedback")
    pg.click("#simReview"); pg.wait_for_timeout(1500)
    ok(pg.inner_text("#simAI .md").strip() != "" and "playing Priya Nair" in pg.inner_text("#simAI"), "colleague's review streams and is labelled")
    rv = [x for x in sent if x.get("mode") == "simreview"]
    ok(rv and rv[-1]["from"] == "Priya Nair" and rv[-1]["company"] == "Chaiwala Pay" and len(rv[-1]["points"]) == 5 and rv[-1]["answer"].startswith("Hi Priya"), "review request carries the ticket, key points and reply")

    # Drafts survive switching days.
    pg.click("[data-simday='2']"); pg.wait_for_timeout(200)
    pg.fill("#simAns", "half-written reply about PII"); pg.click("[data-simday='3']"); pg.wait_for_timeout(200)
    pg.click("[data-simday='2']"); pg.wait_for_timeout(200)
    ok(pg.input_value("#simAns") == "half-written reply about PII", "an unsent reply is kept when switching days")

    # Finish the week: bonus XP and a badge.
    for i in range(1, 5):
        pg.click(f"[data-simday='{i}']"); pg.wait_for_timeout(150)
        pg.fill("#simAns", pg.evaluate(f"SIM.de.days[{i}].a")); pg.click("#simSend"); pg.wait_for_timeout(300)
    pg.wait_for_timeout(1700)
    ok(pg.evaluate("QS.xp") == xp0 + 5 * 40 + 100, "a full week gives 5 × 40 XP plus a 100 XP bonus")
    ok("Week one done at Chaiwala Pay" in pg.inner_text("#simBoard"), "week shows as done")
    ok("week1" in pg.evaluate("QS.badges"), "badge earned: Week one survived")
    ok(pg.evaluate("JSON.parse(localStorage.getItem('dp_sim')).week.de") is True, "progress saved on the device")

    # Other roles.
    for t, co in [("da", "Kirana Cart"), ("ds", "Dabba Express"), ("ar", "Mandi Mart")]:
        pg.click(f"[data-simtrack='{t}']"); pg.wait_for_timeout(200)
        ok(co in pg.inner_text("#simBoard") and pg.locator(".simday.ok").count() == 0, f"{t}: switches to {co}, fresh week")
        if pg.locator(".simtbl").count():
            ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, f"{t}: wide attachment table scrolls inside its box")
    c.close()

    # Desktop: Practice drop-down → Job sim.
    c = b.new_context(viewport={"width": 1440, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#quests"); pg.wait_for_timeout(700)
    pg.click("#tab-practice"); pg.wait_for_timeout(200)
    pg.click("#pmenu [data-sub=sim]"); pg.wait_for_timeout(400)
    ok(pg.is_visible("#view-sim") and "Job sim" in pg.inner_text("#pmenu", timeout=1000) if pg.is_visible("#pmenu") else pg.is_visible("#view-sim"), "desktop: Practice menu → Job sim")
    pg.reload(); pg.wait_for_timeout(700)
    pg.click("#tab-practice"); pg.wait_for_timeout(200)
    ok(pg.get_attribute("#pmenu [data-sub=sim]", "aria-pressed") == "true", "desktop: the menu remembers Job sim as last used")
    pg.goto(B + "/#sim"); pg.wait_for_timeout(500)
    pg.screenshot(path=f"{OUT}/jobsim_desktop.png", full_page=True)
    c.close()

    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL JOB SIM UI TESTS PASSED")
raise SystemExit(1 if fails else 0)
