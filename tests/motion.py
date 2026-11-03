# Browser test for the motion pack: splash, quest-cleared flag drop, level-up bar, climb loader, card-to-lesson morph, haptics,
# and that all of it switches off under reduced motion. Needs tests/l2server.mjs running (same as l2ui.py).
import os
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(__file__), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1

SPY = """
window.__vt = 0; window.__buzz = [];
const _svt = document.startViewTransition && document.startViewTransition.bind(document);
if (_svt) document.startViewTransition = (cb) => { window.__vt++; return _svt(cb); };
try { Object.defineProperty(navigator, 'vibrate', { value: (p) => { window.__buzz.push(p); return true; }, configurable: true }); } catch (e) {}
"""

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    for theme in ["light", "dark", "black"]:
        c = b.new_context(viewport={"width": 390, "height": 844}, color_scheme="light")
        c.add_init_script(SPY + f"localStorage.setItem('dp_theme', JSON.stringify('{theme}'));")
        pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(B + "/#quests"); pg.wait_for_timeout(700)

        # 1. Quest step cleared
        pg.evaluate("award(15, 'Learned: Slowly changing dimensions')"); pg.wait_for_timeout(1300)
        t = pg.locator("#toast")
        ok(t.is_visible() and t.locator(".fdrop .fd").count() == 1 and t.locator(".xpfly").inner_text() == "+15", f"{theme}: toast drops the flag and floats +15")
        ok(pg.evaluate("getComputedStyle(document.querySelector('#toast .fd')).animationName") == "fdrop", f"{theme}: flag drop animates")
        to = pg.evaluate("getComputedStyle(document.querySelector('#toast .celbar i')).getPropertyValue('--to').trim()")
        ok(to.endswith("%"), f"{theme}: level bar fills to {to}")
        ok(pg.evaluate("window.__buzz.length") == 1, f"{theme}: one short buzz on Android")
        pg.screenshot(path=f"{OUT}/motion_toast_{theme}.png")

        # 2. Compass loader
        pg.evaluate("document.querySelector('#view-quests').insertAdjacentHTML('afterbegin', '<div id=\"lt\" class=\"md cursor\">' + climbLoader('Thinking…') + '</div>')")
        ok(pg.evaluate("[...document.querySelectorAll('#lt .lb')].map(e => getComputedStyle(e).animationName).join()") == "lbounce,lbounce,lbounce", f"{theme}: loader bars bounce")
        ok(pg.evaluate("getComputedStyle(document.querySelector('#lt'), '::after').display") == "none", f"{theme}: streaming cursor hidden while the loader shows")
        pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(100)
        pg.locator("#lt").screenshot(path=f"{OUT}/motion_loader_{theme}.png")
        pg.evaluate("document.querySelector('#lt').remove()")

        # Level up: a fourth bar grows in
        pg.wait_for_timeout(2900)
        pg.evaluate("award(5000, 'big jump')"); pg.wait_for_timeout(900)
        ok(pg.locator("#toast .lvup .b4").count() == 1 and "Level up" in pg.locator("#toast").inner_text(), f"{theme}: level up shows the growing fourth bar")
        ok(pg.evaluate("window.__buzz.length") == 2, f"{theme}: level up buzzes too")
        pg.screenshot(path=f"{OUT}/motion_levelup_{theme}.png")

        # 3. Card to lesson morph
        go = pg.locator("#view-quests [data-act*='qgo']").first
        ok(go.count() == 1, f"{theme}: continue card has a Start button")
        go.click(); pg.wait_for_timeout(900)
        ok(pg.evaluate("window.__vt") >= 1, f"{theme}: opening a quest runs a view transition")
        ok(pg.is_visible("#view-tutor .ans"), f"{theme}: the lesson opened")
        ok(pg.evaluate("[...document.querySelectorAll('[style*=view-transition-name]')].length") == 0, f"{theme}: no morph names left behind")
        ok(not pg.evaluate("document.documentElement.classList.contains('vt')"), f"{theme}: transition finished cleanly")
        ok(pg.evaluate("document.documentElement.scrollWidth") <= 390, f"{theme}: no sideways scroll at phone width")
        c.close()

    # Reduced motion: no transitions, no buzz, no needle animation; everything still works.
    c = b.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    c.add_init_script(SPY); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#quests"); pg.wait_for_timeout(700)
    pg.evaluate("award(15, 'Learned: x')")
    ok(pg.evaluate("window.__buzz.length") == 0, "reduced motion: no buzz")
    pg.evaluate("document.body.insertAdjacentHTML('beforeend', climbLoader('Thinking…'))")
    ok(pg.evaluate("getComputedStyle(document.querySelector('.cloader .lb')).animationName") == "none", "reduced motion: loader bars still")
    pg.goto(B + "/?splash#quests"); pg.wait_for_timeout(100)
    ok(pg.locator("#splash").count() == 0 or not pg.is_visible("#splash"), "reduced motion: no splash")
    pg.locator("#view-quests [data-act*='qgo']").first.click(); pg.wait_for_timeout(400)
    ok(pg.evaluate("window.__vt") == 0 and pg.is_visible("#view-tutor .ans"), "reduced motion: lesson opens without a transition")
    c.close()

    # Splash: shown on the first open of a session only, never blocks taps, then removes itself.
    c = b.new_context(viewport={"width": 390, "height": 844}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/?splash#quests"); pg.wait_for_timeout(450)
    ok(pg.is_visible("#splash") and pg.evaluate("getComputedStyle(document.querySelector('#splash')).pointerEvents") == "none", "splash shows on first open and lets taps through")
    pg.screenshot(path=f"{OUT}/motion_splash.png")
    pg.wait_for_timeout(1300)
    ok(pg.locator("#splash").count() == 0, "splash removes itself after about 1.5 s")
    pg.goto(B + "/?splash#quests"); pg.wait_for_timeout(200)
    ok(pg.locator("#splash").count() == 0 or not pg.is_visible("#splash"), "splash is not shown again in the same session")
    c.close()

    # Library card on desktop morphs too.
    c = b.new_context(viewport={"width": 1440, "height": 900}); c.add_init_script(SPY); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#library"); pg.wait_for_timeout(700)
    pg.locator("#view-library .citem[data-act*='concept']").first.click(); pg.wait_for_timeout(900)
    ok(pg.evaluate("window.__vt") >= 1 and pg.is_visible("#view-tutor .ans"), "desktop: library card morphs into the lesson")
    c.close()

    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL MOTION TESTS PASSED")
raise SystemExit(1 if fails else 0)
