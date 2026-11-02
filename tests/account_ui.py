# Browser test for accounts: sign in, guest progress merged, second device sync, sign out, delete, phone layout.
# Needs tests/l2server.mjs running (it fakes Google's signing keys and mints test tokens).
import os, json, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1
def jwt(sub, email, name): return urllib.request.urlopen(f"{B}/__jwt?" + urllib.parse.urlencode({"sub": sub, "email": email, "name": name})).read().decode()
def seed(pg, xp, extra=None):
    pg.evaluate("""([xp, extra]) => { const q = JSON.parse(localStorage.getItem('dp_qs') || '{}'); q.xp = xp; q.badges = extra || q.badges || []; q.done = Object.assign(q.done || {}, {}); localStorage.setItem('dp_qs', JSON.stringify(q)); }""", [xp, extra])
def xp(pg): return pg.evaluate("JSON.parse(localStorage.getItem('dp_qs') || '{}').xp || 0")

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def page(w=1300, h=900, theme=None):
        c = b.new_context(viewport={"width": w, "height": h}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        if theme: pg.add_init_script(f"localStorage.setItem('dp_theme', JSON.stringify('{theme}'))")
        return c, pg
    # device A: guest with progress, then signs in
    cA, A = page(); A.goto(B + "/"); A.wait_for_timeout(1200)
    ok(A.evaluate("typeof dkAccount") == "object", "account code is loaded")
    A.evaluate("openSheet()"); A.wait_for_timeout(400)
    ok(A.is_visible("#acctWrap") and A.is_visible("#acctOut") and not A.is_visible("#acctIn"), "Settings offers sign-in when signed out")
    ok("privacy.html" in A.get_attribute("#acctWrap a", "href"), "Settings links the privacy notice")
    seed(A, 120, ["first"]); A.evaluate("localStorage.setItem('dp_seen', JSON.stringify(['a','b']))")
    A.evaluate("closeSheet()")
    A.evaluate("(t) => dkAccount.signInWithCredential(t)", jwt(1, "ada@example.com", "Ada Lovelace")); A.wait_for_timeout(1500)
    ok(A.evaluate("dkAccount.state().signedIn"), "sign in works")
    A.evaluate("openSheet()"); A.wait_for_timeout(300)
    ok(A.is_visible("#acctIn") and "Ada Lovelace" in A.inner_text("#acctName") and A.inner_text("#acctAvatar") == "A", "Settings shows the signed-in learner")
    ok("synced" in A.inner_text("#acctSync").lower(), "Settings shows sync status")
    A.screenshot(path=f"{OUT}/account-in.png")
    A.evaluate("closeSheet()")
    # device B: different browser, own guest progress, same account
    cB, Bp = page(); Bp.goto(B + "/"); Bp.wait_for_timeout(900)
    seed(Bp, 40, ["streak3"])
    Bp.evaluate("(t) => dkAccount.signInWithCredential(t)", jwt(1, "ada@example.com", "Ada Lovelace"))
    Bp.wait_for_timeout(2500)  # it reloads after merging
    ok(xp(Bp) == 120, "device B received A's progress (xp 120, the larger of 120 and 40)")
    ok(set(Bp.evaluate("JSON.parse(localStorage.getItem('dp_qs')).badges")) == {"first", "streak3"}, "badges from both devices are kept")
    ok(Bp.evaluate("JSON.parse(localStorage.getItem('dp_seen')).length") == 2, "seen topics arrive on B")
    # B earns more, A picks it up
    seed(Bp, 200); Bp.evaluate("store.set('qs', JSON.parse(localStorage.getItem('dp_qs')))"); Bp.wait_for_timeout(6500)
    A.evaluate("dkAccount.reconcile()"); A.wait_for_timeout(2500)
    ok(xp(A) == 200, "A picks up B's newer progress (xp 200)")
    # another learner is separate
    cC, C = page(); C.goto(B + "/"); C.wait_for_timeout(800)
    C.evaluate("(t) => dkAccount.signInWithCredential(t)", jwt(2, "bob@example.com", "Bob")); C.wait_for_timeout(1500)
    ok(xp(C) == 0, "a different learner does not get Ada's progress")
    # merge unit checks
    m = A.evaluate("dkAccount.merge({att:[{t:3,q:'x'},{t:1,q:'y'}],xp:5,flag:false,due:'2026-11-01',s:'a'},{att:[{t:2,q:'z'},{t:3,q:'x'}],xp:9,flag:true,due:'2026-11-09',s:'b'},'')")
    ok(m["xp"] == 9 and m["flag"] is True and m["due"] == "2026-11-09" and m["s"] == "a", "merge: bigger number, either true, later date, local text")
    ok([x["t"] for x in m["att"]] == [1, 2, 3], "merge: attempts combined without duplicates, in time order")
    # sign out keeps progress
    A.evaluate("openSheet()"); A.wait_for_timeout(200); A.click("#acctSignOut"); A.wait_for_timeout(700)
    ok(not A.evaluate("dkAccount.state().signedIn") and A.is_visible("#acctOut") and xp(A) == 200, "sign out keeps progress on the device")
    # session survives reload; delete needs two taps
    Bp.reload(); Bp.wait_for_timeout(1200)
    ok(Bp.evaluate("dkAccount.state().signedIn"), "a signed-in learner stays signed in after reload")
    Bp.evaluate("openSheet()"); Bp.wait_for_timeout(300)
    Bp.click("#acctDelete"); ok("Tap again" in Bp.inner_text("#acctDelete"), "delete asks for a second tap")
    Bp.click("#acctDelete"); Bp.wait_for_timeout(900)
    ok(not Bp.evaluate("dkAccount.state().signedIn") and "deleted" in Bp.inner_text("#acctMsg"), "delete removes the account")
    A.evaluate("(t) => dkAccount.signInWithCredential(t)", jwt(1, "ada@example.com", "Ada Lovelace")); A.wait_for_timeout(1500)
    ok(A.evaluate("dkAccount.state().signedIn") and A.evaluate("dkAccount.state().base") > 0, "the same Google account can start again after deleting")
    # admin count
    req = urllib.request.Request(B + "/api/admin/status", headers={"authorization": "Bearer test-token"})
    st = json.loads(urllib.request.urlopen(req).read())
    ok(st["users"]["enabled"] and st["users"]["total"] == 2, "review page counts 2 learners (no emails)")
    for c in (cA, cB, cC): c.close()
    # phone layouts in all themes
    for th in ["light", "dark", "black"]:
        c, pg = page(390, 844, th); pg.goto(B + "/"); pg.wait_for_timeout(700)
        pg.evaluate("(t) => dkAccount.signInWithCredential(t)", jwt(7, "z@example.com", "Zed A Very Long Display Name For Narrow Screens")); pg.wait_for_timeout(1500)
        pg.evaluate("openSheet()"); pg.wait_for_timeout(300)
        ok(pg.evaluate("document.querySelector('.sheet-card').scrollWidth <= document.querySelector('.sheet-card').clientWidth + 1"), f"phone {th}: account block fits the sheet")
        pg.screenshot(path=f"{OUT}/account-phone-{th}.png"); c.close()
    # privacy page
    c, pg = page(390, 844, "black"); pg.goto(B + "/privacy.html"); pg.wait_for_timeout(300)
    ok("Delete my account" in pg.inner_text("main") and pg.evaluate("document.documentElement.scrollWidth") <= 390, "privacy page covers deletion and fits a phone")
    pg.screenshot(path=f"{OUT}/privacy-phone.png", full_page=True); c.close()
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL ACCOUNT UI TESTS PASSED")
raise SystemExit(1 if fails else 0)
