# Browser test for the menu: top bar with a Practice drop-down on desktop, bottom tab bar with a raised Ask on phones,
# and Certifications as its own section. Needs tests/l2server.mjs running.
import os
from playwright.sync_api import sync_playwright
B = os.environ.get("L2_URL", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(OUT, exist_ok=True)
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1
def box(pg, sel): return pg.locator(sel).first.bounding_box()

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    # ---- desktop ----
    c = b.new_context(viewport={"width": 1440, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(900)
    labels = pg.locator(".tabs > .tab, .tabs > .tabwrap > .tab").all_inner_texts()
    ok([x.strip() for x in labels] == ["Quests", "Ask", "Practice", "Library", "Certifications"], "desktop menu: Quests, Ask, Practice, Library, Certifications " + str(labels))
    tb, q = box(pg, ".topbar"), box(pg, "#tab-quests")
    ok(tb["y"] < 2 and tb["height"] < 90 and q["y"] < 60, "the menu sits in a top bar")
    ok(box(pg, "#tab-tutor")["x"] > q["x"] and abs(box(pg, "#tab-tutor")["y"] - q["y"]) < 4, "menu items run left to right")
    ok(pg.is_visible("#gear") and pg.is_visible("#streakChip") and pg.is_visible("#lvlChip") and pg.is_visible("#navSearch"), "settings, streak, level and search are in the top bar")
    ok(pg.locator(".side").count() == 0, "the old sidebar is gone")
    ok(pg.evaluate("document.documentElement.scrollWidth") <= 1440, "no sideways scrolling")
    pg.click("#tab-practice"); pg.wait_for_timeout(150)
    ok(pg.is_visible("#pmenu") and pg.locator("#pmenu [data-sub]").count() == 3 and pg.get_attribute("#tab-practice", "aria-expanded") == "true", "Practice opens a drop-down with Interview questions, Coding and Job sim")
    ok("Exam" not in pg.inner_text("#pmenu") and "Certification" not in pg.inner_text("#pmenu"), "certifications are not in the Practice menu")
    pg.screenshot(path=f"{OUT}/nav-desktop-menu.png")
    pg.keyboard.press("Escape"); ok(not pg.is_visible("#pmenu"), "Escape closes the drop-down")
    pg.click("#tab-practice"); pg.click("#pmenu [data-sub=practice]"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#view-practice") and not pg.is_visible("#pmenu") and pg.get_attribute("#tab-practice", "aria-selected") == "true", "choosing Coding opens it and closes the menu")
    ok(pg.locator("#view-practice .subnav button").all_inner_texts() == ["Interview questions", "Coding", "Job sim"], "Practice screens switch between Interview questions, Coding and Job sim")
    pg.click("#tab-practice"); pg.mouse.click(700, 500); pg.wait_for_timeout(100)
    ok(not pg.is_visible("#pmenu"), "clicking elsewhere closes the drop-down")
    pg.click("#tab-cert"); pg.wait_for_timeout(300)
    ok(pg.is_visible("#view-cert") and pg.get_attribute("#tab-cert", "aria-selected") == "true" and pg.get_attribute("#tab-practice", "aria-selected") == "false", "Certifications is its own section")
    ok(pg.locator("#view-cert .subnav").count() == 0 and "Certifications" in pg.text_content("#certBoard"), "no Practice sub-menu on the Certifications screen")
    pg.click("#navSearch"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#view-library") and pg.evaluate("document.activeElement.id") == "libSearch", "the top-bar search opens the Library search")
    pg.keyboard.press("Escape")
    pg.click("#tab-tutor"); pg.wait_for_timeout(150); ok(pg.is_visible("#view-tutor"), "Ask opens")
    pg.keyboard.press("5") if not pg.evaluate("/^(input|textarea)$/i.test(document.activeElement.tagName)") else None
    pg.evaluate("document.activeElement.blur()"); pg.keyboard.press("5"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#view-cert"), "key 5 opens Certifications")
    pg.goto(B + "/#quests"); pg.wait_for_timeout(500)
    pg.screenshot(path=f"{OUT}/nav-desktop.png"); c.close()
    # narrow desktop / tablet
    for w in (900, 1024):
        c = b.new_context(viewport={"width": w, "height": 800}); pg = c.new_page(); pg.goto(B + "/"); pg.wait_for_timeout(700)
        ok(pg.evaluate("document.documentElement.scrollWidth") <= w and box(pg, "#gear")["x"] + 40 <= w, f"{w}px: top bar fits (menu, chips, settings)")
        c.close()
    # ---- phone, three themes ----
    for th in ("light", "dark", "black"):
        c = b.new_context(viewport={"width": 390, "height": 844}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(f"localStorage.setItem('dp_theme', JSON.stringify('{th}'))")
        pg.goto(B + "/"); pg.wait_for_timeout(800)
        tabs = pg.locator(".tabs > .tab, .tabs > .tabwrap > .tab")
        order = pg.evaluate("[...document.querySelectorAll('.tabs > .tab, .tabs > .tabwrap > .tab')].sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x).map(e=>e.textContent.trim())")
        ok(order == ["Quests", "Practice", "Ask", "Library", "Certifications"], f"phone {th}: bottom bar order " + str(order))
        t = box(pg, ".tabs")
        ok(abs(t["y"] + t["height"] - 844) < 2 and t["width"] >= 389, f"phone {th}: tabs are fixed to the bottom")
        ok(all(x.bounding_box()["height"] >= 44 and x.bounding_box()["width"] >= 44 for x in tabs.all()), f"phone {th}: every tab is at least 44px")
        a, q2 = box(pg, "#tab-tutor svg"), box(pg, "#tab-quests svg")
        ok(a["height"] > 56 and a["y"] < q2["y"] - 20, f"phone {th}: Ask is a raised round button")
        ok(pg.is_visible(".tb .tbrand .wm") and pg.is_visible("#gear") and pg.evaluate("document.documentElement.scrollWidth") <= 390 and box(pg, "#gear")["x"] + box(pg, "#gear")["width"] <= 390, f"phone {th}: header shows wordmark, chips and settings without overflow")
        ok(not pg.is_visible("#navSearch"), f"phone {th}: the desktop search box is hidden")
        pg.click("#tab-practice"); pg.wait_for_timeout(200)
        ok(pg.is_visible("#view-interview") and not pg.is_visible("#pmenu"), f"phone {th}: Practice opens straight to its screen")
        ok(pg.locator("#view-interview .subnav button").count() == 3 and pg.evaluate("(() => { const n = document.querySelector('#view-interview .subnav'); return n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().right <= innerWidth; })()"), f"phone {th}: Practice has an Interview / Coding / Job sim switch that fits")
        pg.click("#tab-cert"); pg.wait_for_timeout(300)
        ok(pg.is_visible("#view-cert") and pg.evaluate("document.documentElement.scrollWidth") <= 390, f"phone {th}: Certifications opens and fits")
        pg.click("#tab-tutor"); pg.wait_for_timeout(200)
        pg.screenshot(path=f"{OUT}/nav-phone-{th}.png")
        c.close()
    ok(not errs, "no page errors " + str(errs[:2]))
    b.close()
print(f"\n{fails} FAILED" if fails else "\nALL NAV TESTS PASSED")
raise SystemExit(1 if fails else 0)
