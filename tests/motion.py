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

    # Streak flame, boss unlock and tab glide, in all three themes at phone width and on desktop.
    for theme, vw in [("light", 390), ("dark", 390), ("black", 390), ("light", 1440)]:
        c = b.new_context(viewport={"width": vw, "height": 900}); c.add_init_script(SPY + f"localStorage.setItem('dp_theme', JSON.stringify('{theme}'));")
        pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e))); tag = f"{theme}@{vw}"
        pg.goto(B + "/#quests"); pg.wait_for_timeout(700)

        # Streak: flame flickers while alive; the count rolls when it grows.
        pg.evaluate("QS.streak = { last: addDays(today(), -1), n: 3 }; refreshChrome(); touchStreak(); refreshChrome()")
        chip = pg.locator("#streakChip .chip")
        ok("live" in chip.get_attribute("class") and "grew" in chip.get_attribute("class"), f"{tag}: streak chip flickers and rolls when the streak grows")
        ok(pg.locator("#streakChip .rl span").all_inner_texts() == ["3", "4"], f"{tag}: day count rolls from 3 to 4")
        ok(pg.evaluate("getComputedStyle(document.querySelector('#streakChip svg')).animationName").startswith("flick"), f"{tag}: flame flickers")
        pg.evaluate("refreshChrome()")
        ok("grew" not in chip.get_attribute("class") and pg.locator("#streakChip .roll").count() == 0, f"{tag}: no roll on an ordinary refresh")

        # Boss round unlocks: the lock rattles once, then it's a plain crown.
        # Finish the chapter's quests from another screen (as a learner would, inside lessons), then come back.
        pg.evaluate("""(() => { showView('library'); const ch = chapters(pathTrack())[0]; QS.sel = ch.mod;
            ch.ids.forEach((id) => { markSeen(id); QS.ans[id] = 100; }); renderQuests(); })()""")
        ok(pg.evaluate("store.get('bossseen', []).length") == 0, f"{tag}: unlock isn't used up while Quests is hidden")
        pg.evaluate("showView('quests')")
        pg.wait_for_timeout(250)
        ok(pg.locator(".pn.boss.unlock .ul-lock .shk").count() == 1 and pg.locator(".pn.boss.unlock .ul-crown").count() == 1, f"{tag}: boss node shows the unlocking lock")
        ok(pg.evaluate("getComputedStyle(document.querySelector('.pn.boss.unlock .ul-lock svg')).animationName") == "rattle", f"{tag}: lock rattles")
        ok(pg.locator(".card.path.glow").count() == 1, f"{tag}: the path card glows")
        pg.wait_for_timeout(1300)
        ok("Boss round unlocked" in pg.locator("#toast").inner_text(), f"{tag}: toast says the boss round unlocked")
        pg.screenshot(path=f"{OUT}/motion_boss_{theme}_{vw}.png")
        pg.evaluate("renderQuests()")
        ok(pg.locator(".pn.boss.unlock").count() == 0 and pg.locator(".pn.boss .dotn svg").count() == 1, f"{tag}: shown once, then a plain crown")

        # Tab glide: one highlight slides to the selected tab.
        def ind_ok(tab_id):
            return pg.evaluate(f"""(() => {{ const n = document.querySelector('.tabs'), i = n.querySelector('.tabind'), t = document.getElementById('{tab_id}');
                const a = n.getBoundingClientRect(), b = t.getBoundingClientRect(), r = i.getBoundingClientRect();
                return Math.abs(r.left - b.left) < 2 && Math.abs(r.width - b.width) < 2 && getComputedStyle(i).opacity === '1'; }})()""")
        pg.click("#tab-library"); pg.wait_for_timeout(450)
        ok(ind_ok("tab-library"), f"{tag}: highlight slides to Library")
        ok(pg.evaluate("getComputedStyle(document.getElementById('tab-library')).backgroundColor") in ("rgba(0, 0, 0, 0)", "transparent"), f"{tag}: only the sliding highlight is painted")
        pg.click("#tab-cert"); pg.wait_for_timeout(450)
        ok(ind_ok("tab-cert"), f"{tag}: highlight slides to Certifications")
        pg.click("#tab-tutor"); pg.wait_for_timeout(450)
        if vw < 900:
            ok(pg.evaluate("getComputedStyle(document.querySelector('.tabind')).opacity") == "0", f"{tag}: highlight steps aside for the raised Ask button")
        else:
            ok(ind_ok("tab-tutor"), f"{tag}: highlight slides to Ask")
        pg.click("#tab-quests"); pg.wait_for_timeout(450)
        ok(ind_ok("tab-quests"), f"{tag}: highlight back on Quests")
        pg.set_viewport_size({"width": 1440 if vw < 900 else 390, "height": 900}); pg.wait_for_timeout(300)
        ok(ind_ok("tab-quests"), f"{tag}: highlight follows a resize")
        ok(pg.evaluate("document.documentElement.scrollWidth") <= pg.evaluate("innerWidth"), f"{tag}: no sideways scroll")
        pg.screenshot(path=f"{OUT}/motion_tabs_{theme}_{vw}.png")
        c.close()

    # Reduced motion: no flicker, roll, rattle or slide; everything still shows the right state.
    c = b.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce"); c.add_init_script(SPY)
    pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/#quests"); pg.wait_for_timeout(600)
    pg.evaluate("QS.streak = { last: addDays(today(), -1), n: 3 }; refreshChrome(); touchStreak(); refreshChrome()")
    ok(pg.evaluate("getComputedStyle(document.querySelector('#streakChip svg')).animationName") == "none", "reduced motion: flame still")
    ok(pg.evaluate("getComputedStyle(document.querySelector('#streakChip .rl')).transform") != "none", "reduced motion: count shows the new day without rolling")
    pg.evaluate("""(() => { showView('library'); const ch = chapters(pathTrack())[0]; QS.sel = ch.mod; ch.ids.forEach((id) => { markSeen(id); QS.ans[id] = 100; }); showView('quests'); })()""")
    ok(pg.is_visible(".pn.boss.unlock .ul-crown") and not pg.is_visible(".pn.boss.unlock .ul-lock"), "reduced motion: crown shown straight away")
    ok(pg.evaluate("window.__buzz.length") == 0, "reduced motion: no buzz on unlock")
    ok(pg.evaluate("getComputedStyle(document.querySelector('.tabind')).transitionDuration") == "0s", "reduced motion: highlight jumps, no slide")
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
