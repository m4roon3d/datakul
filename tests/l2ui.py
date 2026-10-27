# Browser test for layer 2 (run: node tests/l2server.mjs & python3 tests/l2ui.py): the app reports a miss (and stops when opted out), the reviewer approves a draft
# on the admin page, and the card reaches the app as a Community pick. Needs tests/l2server.mjs on 8788.
import json, os, urllib.request
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1
def post(path, body, ip):
    r = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers={"content-type": "application/json", "x-test-ip": ip}, method="POST")
    return json.loads(urllib.request.urlopen(r).read())

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1300, "height": 900}); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    misses = []
    pg.on("request", lambda r: misses.append(r.post_data) if r.url.endswith("/api/miss") else None)
    pg.goto(B + "/#tutor"); pg.wait_for_timeout(1200)
    ok(pg.is_visible("#shareNote"), "Ask home shows the anonymous sharing notice")
    Q1 = "how do I tune pgvector hnsw indexes"
    top = pg.evaluate("(q)=>{const r=search(q);return r[0]?r[0].s:0}", Q1)
    ok(top < 8, f"test question has no strong library match (top score {top:.1f})")
    pg.fill("#askInput", Q1); pg.press("#askInput", "Enter"); pg.wait_for_timeout(2500)
    ok(len(misses) == 1 and "pgvector" in (misses[0] or ""), "unanswered question is reported to /api/miss")
    # opt out
    pg.click("#gear"); pg.wait_for_timeout(300)
    ok(pg.is_visible("#shareWrap") and pg.is_checked("#shareChk"), "settings show 'Help grow the library', on by default")
    pg.screenshot(path=OUT+"/l2-settings.png")
    pg.uncheck("#shareChk"); pg.click("#sheetDone"); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.querySelector('#shareNote').hidden"), "notice hides after opting out")
    pg.fill("#askInput", "is pgvector or pinecone faster"); pg.press("#askInput", "Enter"); pg.wait_for_timeout(2500)
    ok(len(misses) == 1, "after opting out, nothing is reported")
    # more learners ask the same thing, then the nightly job runs
    for i, q in enumerate(["vector database vs postgres for embeddings", "what is ann similarity search", "how do vector embeddings get indexed"]):
        post("/api/miss", {"q": q, "track": "ds"}, "10.9.0.%d" % i)
    job = json.loads(urllib.request.urlopen(B + "/__run").read())
    ok(len(job["drafted"]) == 1, "nightly job drafted one topic: " + json.dumps(job))

    # ---- admin page ----
    ad = ctx.new_page(); ad.on("pageerror", lambda e: errs.append("admin: " + str(e))); ad.on("dialog", lambda d: d.accept())
    ad.goto(B + "/admin.html"); ad.wait_for_timeout(500)
    ad.fill("#tokIn", "wrong"); ad.click("#login button[type=submit]"); ad.wait_for_timeout(500)
    ok(ad.is_visible("#loginErr") and "token" in ad.inner_text("#loginErr"), "wrong token is refused on the review page")
    ad.fill("#tokIn", "test-token"); ad.click("#login button[type=submit]"); ad.wait_for_timeout(700)
    ok(ad.is_visible("#desk"), "review desk opens with the right token")
    ok(ad.locator(".item").count() == 1 and "Vector databases" in ad.inner_text(".item"), "the draft is in the queue")
    ok("All automatic checks pass" in ad.inner_text("#checks"), "check results are shown")
    ok(ad.locator(".qs li").count() >= 3, "what learners asked is listed")
    ok(ad.input_value("#c-r").count(",") >= 1, "related topics are pre-filled: " + ad.input_value("#c-r"))
    ad.screenshot(path=OUT+"/l2-admin.png", full_page=True)
    # break a field, run checks
    good = ad.input_value("#c-s"); ad.fill("#c-s", "Short."); ad.click("[data-do=check]"); ad.wait_for_timeout(500)
    ok("failed" in ad.inner_text("#checks") and "summary" in ad.inner_text("#checks"), "editing a field and running checks shows the failure")
    ad.click("[data-do=approve]"); ad.wait_for_timeout(500)
    ok("Fix" in ad.inner_text("#out") or "failed" in ad.inner_text("#out"), "approve is refused while a check fails")
    ad.fill("#c-s", good); ad.fill("#c-title", "Vector databases for RAG"); ad.click("[data-do=approve]"); ad.wait_for_timeout(1500)
    ok(ad.locator("[data-tab=live] em").inner_text() == "1", "approved card moves to Live")
    ad.set_viewport_size({"width": 390, "height": 844}); ad.click("[data-tab=live]"); ad.wait_for_timeout(300)
    ad.screenshot(path=OUT+"/l2-admin-phone.png", full_page=False)
    sw = ad.evaluate("document.documentElement.scrollWidth"); ok(sw <= 390, f"review page fits a phone (scroll width {sw})")

    # ---- the card reaches learners ----
    # a fresh learner (the earlier page cached the empty feed for 5 minutes, as browsers should)
    ctx2 = b.new_context(viewport={"width": 1300, "height": 900}); pg = ctx2.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#quests"); pg.wait_for_timeout(1800)
    cm = pg.evaluate("C.filter(c=>c.cm).map(c=>[c.id,c.title,c.mod,c.r.length])")
    ok(len(cm) == 1 and cm[0][1] == "Vector databases for RAG" and cm[0][2] == "Community picks", "community card merged into the library: " + json.dumps(cm))
    ok(cm and cm[0][3] == 3, "it has 3 related topics")
    cid = cm[0][0] if cm else ""
    ok(pg.evaluate("(id)=>(QI[id]||[]).length", cid) == 2, "its 2 interview questions are wired into quests")
    ok(pg.evaluate("(id)=>search('vector database for rag')[0].c.id===id", cid), "Ask search finds it")
    ok(pg.evaluate("!!localStorage.getItem('dp_comm')"), "cards are cached for the next visit")
    pg.evaluate("F.role.value='ds'; renderQuests()"); pg.wait_for_timeout(200)
    ok("New community pick" in pg.inner_text("#questBoard"), "it shows as a side quest on the Data Science path")
    ok(pg.evaluate("chapterInfo(chapters('ds')).find(c=>c.mod==='Community picks').unlocked"), "the Community picks chapter is open from the start")
    pg.screenshot(path=OUT+"/l2-quests.png")
    pg.evaluate("(id)=>{showView('tutor'); answer(CM[id]);}", cid); pg.wait_for_timeout(400)
    ok(pg.locator(".ans .cmtag").count() >= 1, "concept card carries the 'Community · reviewed' tag")
    pg.locator(".ans").last.screenshot(path=OUT+"/l2-card.png")
    pg.click("[data-view=library]") if pg.locator("[data-view=library]").count() else pg.evaluate("showView('library')")
    pg.wait_for_timeout(300)
    ok("Community picks" in pg.inner_text("#lib"), "Library lists Community picks")
    # reload uses the cache synchronously
    pg.reload(); pg.wait_for_timeout(300)
    ok(pg.evaluate("C.some(c=>c.cm)"), "after reload the card is there before the network call")
    # withdrawal
    ad.click(".item"); ad.wait_for_timeout(200); ad.click("[data-do=reject]"); ad.wait_for_timeout(800)
    ctx3 = b.new_context(); pg3 = ctx3.new_page()
    pg3.goto(B + "/#quests"); pg3.evaluate("localStorage.setItem('dp_comm', JSON.stringify({cards:[{id:'cm-x-1',concept:{t:'ds',title:'Old card',s:'An old cached community card that a reviewer has since withdrawn.'},questions:[]}]}))")
    pg3.reload(); pg3.wait_for_timeout(1500)
    ok(pg3.evaluate("JSON.parse(localStorage.getItem('dp_comm')).cards.length") == 0, "a withdrawn card leaves the cache, so it's gone on the next visit")
    # phone layout of the app with the share notice
    ph = b.new_page(viewport={"width": 390, "height": 844}); ph.goto(B + "/#tutor"); ph.wait_for_timeout(800)
    ok(ph.evaluate("document.documentElement.scrollWidth") <= 390, "app still fits a phone")
    ph.screenshot(path=OUT+"/l2-ask-phone.png")
    ok(not errs, "no page errors " + json.dumps(errs[:3]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL LAYER 2 UI TESTS PASSED")
raise SystemExit(1 if fails else 0)
