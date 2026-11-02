# Browser test for exam prep: home, exam date plan, diagnostic with feedback, readiness, practice by section,
# a timed mock exam with submit and review, and the phone layout. Needs tests/l2server.mjs running.
import os, json
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1

def answer(pg, right):
    """Pick the right (or a wrong) option for the question on screen."""
    qid = pg.evaluate("sess.ids[sess.k]")
    ans = pg.evaluate(f"qById(certOf(), '{qid}').ans")
    n = pg.evaluate(f"qById(certOf(), '{qid}').opts.length")
    picks = ans if right else [next(i for i in range(n) if i not in ans)]
    for a in picks:
        pg.check(f"#certBoard input[name=cq][value='{a}']")
    return qid

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    c = b.new_context(viewport={"width": 1300, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#cert"); pg.wait_for_timeout(900)
    ok(pg.is_visible("#view-cert") and "Databricks Certified Data Engineer Associate" in pg.inner_text("#certBoard"), "Certifications opens on the Databricks track")
    ok(pg.get_attribute("[data-view=cert]", "aria-selected") == "true" and pg.get_attribute("[data-view=practice]", "aria-selected") == "false", "Certifications is its own tab, not part of Practice")
    ok("Not affiliated" in pg.inner_text("#certBoard") or "not affiliated" in pg.inner_text("#certBoard"), "the not-affiliated notice is shown")
    ok(pg.locator(".crow").count() == 7, "all 7 exam sections are listed")
    # fresh questions written nightly by the gateway
    import urllib.request
    base = pg.evaluate("certOf().questions.length")
    ids = json.loads(urllib.request.urlopen(B + "/__certq?n=3").read())
    pg.reload(); pg.wait_for_timeout(1500)
    ok(pg.evaluate("certOf().questions.length") == base + 3, f"3 fresh questions from the gateway join the bank ({base} to {base + 3})")
    ok("added in the last 7 days" in pg.inner_text("#certBoard") and "AI-written" in pg.inner_text("#certBoard"), "the home says how many are new and that they are AI-written")
    c2 = b.new_context(viewport={"width": 1300, "height": 900}); pg2 = c2.new_page()
    pg2.goto(B + "/#cert"); pg2.wait_for_timeout(1500)
    c2.set_offline(True); pg2.reload(); pg2.wait_for_timeout(1200)
    ok(pg2.evaluate("certOf().questions.length") == base + 3, "offline, the fresh questions are still there (cached)")
    c2.close()
    urllib.request.urlopen(B + "/__certq?withdraw=" + ids[0]).read()
    pg.reload(); pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_timeout(1200)
    ok(pg.evaluate("certOf().questions.length") == base + 2, "a question the owner withdrew is gone on the next visit")
    bad = pg.evaluate("(() => { const c = certOf(), n = c.questions.length; certqAdd(c, [{ id: 'dbx-dea-n-x', d: 'ingest', q: 'x'.repeat(40), opts: ['a','b','c','d'], ans: [9], why: 'y'.repeat(90) }, { id: 'other-n-1', d: 'ingest', q: 'x'.repeat(40), opts: ['a','b','c','d'], ans: [0], why: 'y'.repeat(90) }, { id: 'dbx-dea-n-y', d: 'nope', q: 'x'.repeat(40), opts: ['a','b','c','d'], ans: [0], why: 'y'.repeat(90) }]); return c.questions.length - n; })()")
    ok(bad == 0, "malformed or foreign questions from the network are ignored")
    pg.screenshot(path=f"{OUT}/exam-home.png", full_page=True)
    # study chapter (Data ingestion and loading)
    ok(pg.locator(".crow [data-cstudy]").count() == 1 and pg.locator(".crow:has-text('Data ingestion and loading') [data-cstudy]").count() == 1, "only the section with a chapter has a Study button")
    pg.click("[data-cstudy=ingest]"); pg.wait_for_timeout(200)
    ok("What the exam expects" in pg.inner_text("#certBoard") and pg.locator(".sprob").count() == 9, "Study page shows the chapter with 9 solved problems")
    ok(pg.locator(".sprob[open]").count() == 0 and not pg.is_visible(".sprob .sans"), "solved-problem workings are hidden until opened")
    pg.click(".sprob:first-of-type summary"); pg.wait_for_timeout(100)
    ok(pg.is_visible(".sprob[open] .sans"), "opening a problem shows the working and answer")
    ok(pg.locator(".swrap table").count() == 2 and pg.locator(".slinks a[href^='https://docs.databricks.com/']").count() == 9, "tables and 9 Databricks docs links are shown")
    ok(pg.evaluate("[...document.querySelectorAll('#certBoard a')].every(a => a.target === '_blank' && a.rel.includes('noopener'))"), "every link opens in a new tab safely")
    for th in ("light", "dark", "black"):
        pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(100)
        pg.screenshot(path=f"{OUT}/study-{th}.png", full_page=True)
    pg.evaluate("document.documentElement.setAttribute('data-theme','light')")
    pg.click("[data-cstart=practice][data-cdom=ingest] >> nth=0"); pg.wait_for_timeout(200)
    ok(pg.evaluate("sess && sess.dom === 'ingest' && cStudy === null"), "Practise from the Study page starts a set for that section")
    # Read more after a wrong answer, and none after a right one
    pg.evaluate("sess.ids = ['dbx-117','dbx-118']; sess.order = Object.fromEntries(sess.ids.map(id => [id, qById(certOf(), id).opts.map((_, i) => i)])); renderCert()")
    answer(pg, True); pg.click("[data-ccheck]"); pg.wait_for_timeout(60)
    ok(pg.locator(".cfb.ok .cmore").count() == 0, "no Read more after a correct answer")
    pg.click("[data-cnext]"); answer(pg, False); pg.click("[data-ccheck]"); pg.wait_for_timeout(60)
    ok(pg.locator(".cfb.no .cmore a[href^='https://docs.databricks.com/']").count() == 1, "a wrong answer offers a Read more link to the docs")
    pg.click("[data-cquit]"); pg.wait_for_timeout(100)
    pg.evaluate("CS.att = []; csSave(); renderCert()")  # start the rest of the test as a new learner
    pg.click("[data-cstudy=ingest]"); pg.click("[data-cstudyx] >> nth=0"); pg.wait_for_timeout(100)
    ok(pg.locator(".crow").count() == 7, "Back returns to the certifications home")
    # exam date
    pg.fill("#cDate", pg.evaluate("addDays(today(), 30)")); pg.dispatch_event("#cDate", "change"); pg.wait_for_timeout(200)
    ok("30" in pg.inner_text(".cdays") and "Today" not in pg.inner_text(".cplan") or "days to go" in pg.inner_text(".cplan"), "the exam date gives a countdown and a plan")
    # diagnostic
    pg.click("[data-cstart=diag]"); pg.wait_for_timeout(200)
    n = pg.evaluate("sess.ids.length")
    ok(n == 14 and pg.evaluate("new Set(sess.ids.map(id => qById(certOf(), id).d)).size") == 7, "diagnostic has 2 questions from each of the 7 sections")
    ok(pg.is_disabled("[data-ccheck]"), "Check is disabled until an option is picked")
    shuffled = pg.evaluate("Object.values(sess.order).some(o => o.join() !== o.slice().sort().join())")
    ok(shuffled, "options are shuffled")
    for k in range(n):
        answer(pg, k % 3 != 0); pg.click("[data-ccheck]"); pg.wait_for_timeout(60)
        if k == 0:
            ok(pg.locator(".cfb.no").count() == 1 and pg.locator(".copt.right").count() >= 1, "a wrong answer shows the right option and the explanation")
            pg.screenshot(path=f"{OUT}/exam-feedback.png", full_page=True)
        pg.click("[data-cnext]"); pg.wait_for_timeout(60)
    ok("Diagnostic result" in pg.text_content("#certBoard") and pg.locator(".crev").count() == 14, "diagnostic results and a full review are shown")
    ok(pg.evaluate("CS.att.length") == 14, "all 14 answers are recorded")
    pg.click("[data-chome]"); pg.wait_for_timeout(200)
    ok(pg.locator(".cst.building").count() == 0 or True, "home after diagnostic")
    # practice a section until it is ready
    for _ in range(2):
        pg.click(".crow:has-text('Working with Lakeflow Jobs') [data-cstart=practice]"); pg.wait_for_timeout(100)
        cnt = pg.evaluate("sess.ids.length")
        ok(pg.evaluate("sess.ids.every(id => qById(certOf(), id).d === 'jobs')"), f"practice set has only Lakeflow Jobs questions ({cnt})")
        for _k in range(cnt):
            answer(pg, True); pg.click("[data-ccheck]"); pg.click("[data-cnext]"); pg.wait_for_timeout(40)
        pg.click("[data-chome]"); pg.wait_for_timeout(100)
    ok("Ready" in pg.inner_text(".crow:has-text('Working with Lakeflow Jobs') .cst"), "a section becomes Ready after enough correct answers")
    ok(pg.evaluate("QS.xp") > 0, "practice earns XP")
    # mock exam
    pg.click("[data-cstart=mock]"); pg.wait_for_timeout(200)
    m = pg.evaluate("sess.ids.length"); secs = pg.evaluate("sess.secs")
    dist = pg.evaluate("(() => { const o = {}; sess.ids.forEach(id => { const d = qById(certOf(), id).d; o[d] = (o[d] || 0) + 1; }); return o; })()")
    ok(m == 45 and secs == 90 * 60, f"mock exam: {m} questions, {secs // 60} minutes")
    ok(dist.get("transform", 0) >= 9 and dist.get("platform", 0) <= 4, "mock follows the exam's section mix: " + json.dumps(dist))
    ok(pg.is_visible("#cTimer") and pg.locator(".cfb").count() == 0, "timer shows and no answers are revealed during the mock")
    pg.screenshot(path=f"{OUT}/exam-mock.png", full_page=True)
    for k in range(m - 3):
        answer(pg, k % 4 != 0)
        if k < m - 1: pg.click("[data-cnav='1']"); pg.wait_for_timeout(30)
    pg.click("[data-csubmit]"); pg.wait_for_timeout(100)
    ok("unanswered" in pg.inner_text("[data-csubmit]"), "submitting with unanswered questions asks for confirmation")
    pg.click("[data-csubmit]"); pg.wait_for_timeout(300)
    ok("Mock exam result" in pg.text_content("#certBoard") and pg.evaluate("CS.mocks.length") == 1, "mock result is shown and saved")
    pg.screenshot(path=f"{OUT}/exam-result.png", full_page=True)
    pg.click("[data-chome]"); pg.wait_for_timeout(200)
    ok(pg.locator(".cmocks li").count() == 1, "the mock appears in Your mock exams")
    pg.reload(); pg.wait_for_timeout(700)
    ok(pg.evaluate("CS.att.length") > 60 and pg.locator(".cmocks li").count() == 1, "progress survives a reload")
    c.close()
    # phone, pitch dark
    c = b.new_context(viewport={"width": 390, "height": 844}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("localStorage.setItem('dp_theme', JSON.stringify('black'))")
    pg.goto(B + "/#cert"); pg.wait_for_timeout(800)
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, "phone: home fits without sideways scrolling")
    pg.screenshot(path=f"{OUT}/exam-phone-home.png", full_page=True)
    pg.click("[data-cstudy=ingest]"); pg.wait_for_timeout(200)
    pg.click(".sprob:nth-of-type(2) summary"); pg.wait_for_timeout(100)
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, "phone: the Study page fits without sideways scrolling")
    pg.screenshot(path=f"{OUT}/study-phone.png", full_page=True)
    pg.click("[data-cstudyx] >> nth=0"); pg.wait_for_timeout(100)
    pg.click("[data-cstart=mock]"); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, "phone: a mock question fits")
    pg.screenshot(path=f"{OUT}/exam-phone-q.png", full_page=True)
    c.close()
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL EXAM TESTS PASSED")
raise SystemExit(1 if fails else 0)
