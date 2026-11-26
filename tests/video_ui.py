# Browser test for video quests: Practice → Videos lists the published video, a part opens with its YouTube link,
# the quick check clears a part (+XP), all parts complete the quest (badge), progress is saved, the tutor answers from
# the video's notes, it works offline from the saved list, and the review page shows the Video quests tab.
# Needs tests/l2server.mjs running (it seeds one published video).
import os, json
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1

ANS = [[0, 1], [2, 1], [1, 0]]  # the fixture's correct answers per part

def answer(pg, picks):
    for qi, oi in enumerate(picks):
        pg.locator(f'input[name="vqa{qi}"]').nth(oi).check()
    pg.click("[data-vqcheck]"); pg.wait_for_timeout(250)

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    for theme, vw in (("light", 1280), ("dark", 390), ("black", 390)):
        c = b.new_context(viewport={"width": vw, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(f"localStorage.setItem('dp_theme', JSON.stringify('{theme}'))")
        pg.goto(B + "/#video"); pg.wait_for_timeout(900)
        ok(pg.is_visible("#view-video") and pg.locator(".vqitem").count() == 1, f"{theme} {vw}px: #video opens Videos with the published video")
        ok("Auto Loader in 20 minutes" in pg.inner_text(".vqitem") and "0 of 3" in pg.inner_text(".vqitem"), f"{theme}: the card shows title and progress")
        ok(pg.evaluate("document.documentElement.scrollWidth") <= vw, f"{theme}: no sideways scrolling on the list")
        pg.screenshot(path=f"{OUT}/video_list_{theme}.png", full_page=True)
        pg.click(".vqitem"); pg.wait_for_timeout(300)
        ok(pg.locator(".vqpart").count() == 3 and "Why incremental ingestion" in pg.inner_text(".vqch"), f"{theme}: the quest opens on part 1 of 3")
        ok(pg.evaluate("document.documentElement.scrollWidth") <= vw, f"{theme}: no sideways scrolling in the quest")
        pg.screenshot(path=f"{OUT}/video_quest_{theme}.png", full_page=True)
        c.close()

    # ---- the full journey on desktop (reduced motion, so smooth scrolling doesn't move targets mid-click) ----
    c = b.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce"); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(800)
    pg.click("#tab-practice"); pg.click("#pmenu [data-sub=video]"); pg.wait_for_timeout(500)
    ok(pg.is_visible("#view-video") and pg.get_attribute("#tab-practice", "aria-selected") == "true", "Practice → Videos opens video quests")
    pg.click(".vqitem"); pg.wait_for_timeout(300)
    href = pg.get_attribute(".vqwatch", "href")
    ok(href == "https://www.youtube.com/watch?v=dQw4w9WgXcQ" and pg.get_attribute(".vqwatch", "target") == "_blank", "part 1 links to YouTube from the start")
    pg.click("[data-vqcheck]"); pg.wait_for_timeout(150)
    ok("Answer every question" in pg.inner_text("#vqMsg"), "checking with nothing picked asks for answers first")
    xp0 = pg.evaluate("QS.xp")
    answer(pg, [1, 0])
    ok(pg.locator(".cfb.no").count() == 2 and pg.evaluate("QS.xp") == xp0, "wrong answers show the explanations and give no XP")
    pg.click("[data-vqretry]"); pg.wait_for_timeout(150)
    answer(pg, ANS[0])
    ok(pg.locator(".cfb.ok").count() == 2 and pg.evaluate("QS.xp") == xp0 + 15, "right answers clear the part: +15 XP")
    ok("Part cleared" in pg.inner_text("#vqMsg") and pg.locator(".vqpart.ok").count() == 1, "the part is marked cleared")
    pg.click("[data-vqretry]"); answer(pg, ANS[0])
    ok(pg.evaluate("QS.xp") == xp0 + 15, "clearing the same part again gives no extra XP")
    pg.click(".vqquiz [data-vqch='1']"); pg.wait_for_timeout(250)
    ok("Setting up cloudFiles" in pg.inner_text(".vqch") and "t=270s" in pg.get_attribute(".vqwatch", "href"), "Next part opens part 2 with the link at 4:30")
    answer(pg, ANS[1])
    pg.click("[data-vqch='2']"); pg.wait_for_timeout(250)
    ok("to the end" in pg.inner_text(".vqwatch"), "the last part's link runs to the end")
    answer(pg, ANS[2]); pg.wait_for_timeout(1700)
    st = pg.evaluate("JSON.parse(localStorage.getItem('dp_vq'))")
    ok(st["full"].get("dQw4w9WgXcQ") and st["done"]["dQw4w9WgXcQ"] == [0, 1, 2], "progress is saved on the device")
    gained = pg.evaluate("QS.xp") - xp0
    ok(gained in (95, 115), f"three parts and the whole video: +45 and +50 XP (plus the daily 'quest steps' bonus) = {gained}")
    ok("video1" in pg.evaluate("QS.badges"), "the Video learner badge is earned")
    ok(pg.is_visible(".vqtake") and "Quest complete" in pg.inner_text(".vqtop"), "the finished quest shows its takeaways")
    # tutor
    if pg.locator("#vqAskIn").count():
        pg.fill("#vqAskIn", "Why does it need a checkpoint?")
        with pg.expect_request(lambda r: r.url.endswith("/api/chat")) as rq: pg.click("[data-vqask]")
        body = json.loads(rq.value.post_data); pg.wait_for_timeout(800)
        ok(body["context"][0]["title"].startswith("Video: Auto Loader") and "Part 2 (4:30)" in body["context"][0]["text"], "the tutor gets the video's notes as context")
        ok(len(pg.inner_text("#vqAI .md")) > 10, "the tutor's answer appears")
    else:
        ok(False, "the ask box shows when an AI provider is connected")
    pg.click("[data-vqback]"); pg.wait_for_timeout(200)
    ok("Done" in pg.inner_text(".vqitem") and "ok" in pg.get_attribute(".vqitem", "class"), "the list shows the video as done")
    pg.screenshot(path=f"{OUT}/video_done.png", full_page=True)
    # offline: the saved list is used
    pg.route("**/api/videos", lambda r: r.abort())
    pg.reload(); pg.wait_for_timeout(900)
    pg.goto(B + "/#video"); pg.wait_for_timeout(900)
    ok(pg.locator(".vqitem").count() == 1 and "saved on this device" in pg.inner_text("#videoBoard"), "offline, the videos saved on the device still show")
    c.close()

    # ---- phone: the Practice sub-menu fits ----
    c = b.new_context(viewport={"width": 360, "height": 780}); pg = c.new_page()
    pg.goto(B + "/#video"); pg.wait_for_timeout(800)
    ok(pg.locator("#view-video .subnav button").all_inner_texts() == ["Interview questions", "Coding", "Job sim", "Videos"], "the Practice sub-menu has Videos")
    sb = pg.locator("#view-video .subnav").bounding_box()
    ok(sb["x"] >= 0 and sb["x"] + sb["width"] <= 360 and pg.evaluate("document.documentElement.scrollWidth") <= 360, "the sub-menu fits a 360px phone")
    pg.screenshot(path=f"{OUT}/video_phone_subnav.png")
    c.close()

    # ---- review page ----
    c = b.new_context(viewport={"width": 1280, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/admin.html"); pg.fill("#gwIn", B); pg.fill("#tokIn", "test-token"); pg.click("#login button[type=submit]"); pg.wait_for_timeout(700)
    pg.click("[data-tab=videos]"); pg.wait_for_timeout(600)
    ok(pg.is_visible("#videosView") and "Auto Loader in 20 minutes" in pg.inner_text("#videosView") and "Live in the app" in pg.inner_text("#videosView"), "the review page lists the video and its state")
    ok("GEMINI_API_KEY" in pg.inner_text("#videosView") and pg.is_disabled("#vGo"), "without a Gemini key, Analyse is off and the page says why")
    pg.click("#videosView details summary"); pg.wait_for_timeout(100)
    ok("Why incremental ingestion" in pg.inner_text("#videosView details"), "the owner can preview parts and questions")
    pg.once("dialog", lambda d: d.accept())
    pg.click("[data-vs=hidden]"); pg.wait_for_timeout(500)
    ok("Hidden from learners" in pg.inner_text("#videosView"), "Hide takes it out of the app")
    pg.screenshot(path=f"{OUT}/video_admin.png", full_page=True)
    pg.click("[data-vs=live]"); pg.wait_for_timeout(500)
    ok("Live in the app" in pg.inner_text("#videosView"), "Publish puts it back")
    c.close()
    ok(not errs, "no page errors " + str(errs[:3]))
    b.close()

print(f"\n{fails} failed" if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
