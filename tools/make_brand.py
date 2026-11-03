# Builds the Datakul brand files from one definition: the K "Data climb" mark and the Space Grotesk Bold wordmark
# (outlined, so it looks the same everywhere without the font). Writes brand/*.svg, brand/inline.json, puts the mark
# and favicon into web/index.html and web/admin.html, and (needs Playwright) writes brand/*.png, web/icons/*.png and
# the Android launcher icons.
#   python3 tools/make_brand.py
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
B = os.path.join(ROOT, "brand")

# ---- colours (K, "Data climb", chosen 3 Nov 2026) ----
NAVY, SKY, SAFFRON, WHITE, INK = "#0B2A3A", "#5CC3E6", "#F7861F", "#FFFFFF", "#0B2A3A"
CLIMB = ("#B85A14", "#F7861F", "#FFB65C")  # the three bars, low to high; also the app's progress ramp


def mark(bg=NAVY, rx=26, small=False, tile=True):
    """Three rising bars with a flag on the tallest, on a 100x100 tile. small=True thickens the pole and flag
    so they survive at 48 px and below (favicon, phone icon)."""
    pw = 6 if small else 4
    flag = "M70 10.5H89.5L84 17.5L89.5 24.5H70Z" if small else "M70 12.5H87L82.5 18L87 23.5H70Z"
    return ((f'<rect width="100" height="100" rx="{rx}" fill="{bg}"/>' if tile else "") +
            f'<rect x="18" y="62" width="16" height="22" rx="3" fill="{CLIMB[0]}"/>'
            f'<rect x="40" y="48" width="16" height="36" rx="3" fill="{CLIMB[1]}"/>'
            f'<rect x="62" y="34" width="16" height="50" rx="3" fill="{CLIMB[2]}"/>'
            f'<path d="M70 34V12" stroke="{WHITE}" stroke-width="{pw}" stroke-linecap="round"/>'
            f'<path d="{flag}" fill="{SKY}" stroke="{SKY}" stroke-width="1.5" stroke-linejoin="round"/>')


# ---- wordmark: "data" + "kul" outlined from Space Grotesk Bold, tracking -0.03em ----
font = TTFont(os.path.join(B, "fonts", "SpaceGrotesk-Bold.ttf"))
gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
hmtx = font["hmtx"]
TRACK = -0.03 * upm


def outline(text, x0):
    pen = SVGPathPen(gs)
    bp = BoundsPen(gs)
    x = x0
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (1, 0, 0, -1, x, 0))  # flip y: font units grow upwards
        gs[g].draw(tp)
        gs[g].draw(TransformPen(bp, (1, 0, 0, -1, x, 0)))
        x += hmtx[g][0] + TRACK
    return pen.getCommands(), bp.bounds, x


d1, b1, xend = outline("data", 0)
d2, b2, xend2 = outline("kul", xend)
minx, miny = min(b1[0], b2[0]), min(b1[1], b2[1])
maxx, maxy = max(b1[2], b2[2]), max(b1[3], b2[3])
pad = 0.02 * upm
WVB = f"{minx - pad:.0f} {miny - pad:.0f} {maxx - minx + 2 * pad:.0f} {maxy - miny + 2 * pad:.0f}"
WW, WH = maxx - minx + 2 * pad, maxy - miny + 2 * pad


def wordmark_svg(c1, c2, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{WVB}" {extra}>'
            f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/></svg>')


def svg_doc(inner, vb, w, h, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{inner}</svg>\n')


def lockup(c1, c2, bg=None):
    # mark 100 tall at x 0; wordmark scaled to 52 tall cap-ish, gap 22
    s = 58 / WH
    wx = 122
    inner = (f'<g>{mark()}</g>'
             f'<g transform="translate({wx} {50 - (WH * s) / 2:.2f}) scale({s:.5f}) translate({-(minx - pad):.1f} {-(miny - pad):.1f})">'
             f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/></g>')
    width = wx + WW * s
    if bg:
        inner = f'<rect x="-24" y="-24" width="{width + 48:.1f}" height="148" rx="28" fill="{bg}"/>' + inner
        return svg_doc(inner, f"-24 -24 {width + 48:.1f} 148", round(width + 48) * 2, 296, "Datakul")
    return svg_doc(inner, f"0 0 {width:.1f} 100", round(width) * 2, 200, "Datakul")


def stacked():
    s = 70 / WH
    ww = WW * s
    W = max(ww, 160)
    inner = (f'<g transform="translate({(W - 140) / 2:.1f} 0) scale(1.4)">{mark()}</g>'
             f'<g transform="translate({(W - ww) / 2:.1f} 166) scale({s:.5f}) translate({-(minx - pad):.1f} {-(miny - pad):.1f})">'
             f'<path fill="{INK}" d="{d1}"/><path fill="{SAFFRON}" d="{d2}"/></g>')
    return svg_doc(inner, f"0 0 {W:.1f} 240", round(W) * 2, 480, "Datakul")


def maskable():
    # full-bleed tile; the mark kept inside the 80% safe circle
    return svg_doc(f'<rect width="100" height="100" fill="{NAVY}"/><g transform="translate(12.4 16.9) scale(0.7)">{mark(tile=False)}</g>',
                   "0 0 100 100", 512, 512, "Datakul")


files = {
    "datakul-mark.svg": svg_doc(mark(), "0 0 100 100", 512, 512, "Datakul"),
    "datakul-maskable.svg": maskable(),
    "datakul-wordmark.svg": wordmark_svg(INK, SAFFRON, f'width="{WW / 4:.0f}" height="{WH / 4:.0f}" role="img" aria-label="Datakul"') + "\n",
    "datakul-logo.svg": lockup(INK, SAFFRON),
    "datakul-logo-dark.svg": lockup(WHITE, SAFFRON, bg="#071C27"),
    "datakul-logo-stacked.svg": stacked(),
}
for n, s in files.items():
    open(os.path.join(B, n), "w").write(s)

# ---- snippets for the app ----
fav = svg_doc(mark(small=True), "0 0 100 100", 64, 64, "Datakul").replace("\n", "")
inline = {
    "mark": mark(),
    "mark_small": mark(small=True),
    "wordmark_viewbox": WVB,
    "wordmark_data": d1,
    "wordmark_kul": d2,
    "favicon_data_uri": "data:image/svg+xml," + fav.replace("#", "%23").replace("<", "%3C").replace(">", "%3E").replace('"', "'"),
}
json.dump(inline, open(os.path.join(B, "inline.json"), "w"), indent=1)

# ---- put the mark and favicon into the app pages ----
import re
W = os.path.join(ROOT, "web")
for page, pat in [("index.html", r'(<svg class="mk" viewBox="0 0 100 100" aria-hidden="true">).*?(</svg>)'),
                  ("admin.html", r'(<div class="brand"[^>]*><svg viewBox="0 0 100 100" width="30" height="30" aria-hidden="true">).*?(</svg>)')]:
    fp = os.path.join(W, page); h = open(fp).read()
    h, n1 = re.subn(pat, lambda m: m.group(1) + mark(small=True) + m.group(2), h, count=1, flags=re.S)
    h, n2 = re.subn(r'<link rel="icon" href="data:image/svg\+xml,[^"]*">', lambda m: f'<link rel="icon" href="{inline["favicon_data_uri"]}">', h, count=1)
    assert n1 == 1 and n2 == 1, f"{page}: mark or favicon not found"
    open(fp, "w").write(h)

# ---- PNGs ----
if "--no-png" in sys.argv:
    sys.exit(0)
from playwright.sync_api import sync_playwright
small = svg_doc(mark(small=True), "0 0 100 100", 64, 64, "Datakul")
open(os.path.join(B, "datakul-mark-small.svg"), "w").write(small)
# Android adaptive icon foreground: transparent 108-unit canvas, mark inside the 66-unit safe zone.
fg = svg_doc(f'<g transform="translate(18.5 22.8) scale(0.66)">{mark(small=True, tile=False)}</g>', "0 0 108 108", 432, 432, "Datakul")
open(os.path.join(B, "datakul-android-foreground.svg"), "w").write(fg)
pngs = [("datakul-mark.svg", "datakul-icon-512.png", 512, 512), ("datakul-mark.svg", "datakul-icon-192.png", 192, 192),
        ("datakul-maskable.svg", "datakul-maskable-512.png", 512, 512), ("datakul-maskable.svg", "datakul-apple-180.png", 180, 180),
        ("datakul-mark-small.svg", "datakul-favicon-32.png", 32, 32)]
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
for dens, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
    pngs.append(("datakul-mark-small.svg" if px <= 96 else "datakul-mark.svg", os.path.join(RES, f"mipmap-{dens}", "ic_launcher.png"), px, px))
    f = px * 108 // 48
    pngs.append(("datakul-android-foreground.svg", os.path.join(RES, f"mipmap-{dens}", "ic_launcher_foreground.png"), f, f))
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    for src, out, w, h in pngs:
        svg = open(os.path.join(B, src)).read()
        pg.set_viewport_size({"width": w, "height": h})
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg style=\"display:block;width:{w}px;height:{h}px\" ", 1)}</body></html>')
        pg.screenshot(path=os.path.join(B, out), omit_background=True)
    for f in ["datakul-icon-512.png", "datakul-icon-192.png", "datakul-maskable-512.png", "datakul-apple-180.png", "datakul-favicon-32.png"]:
        open(os.path.join(W, "icons", f), "wb").write(open(os.path.join(B, f), "rb").read())
    for src, out in [("datakul-logo.svg", "datakul-logo.png"), ("datakul-logo-dark.svg", "datakul-logo-dark.png")]:
        svg = open(os.path.join(B, src)).read()
        pg.set_viewport_size({"width": 1400, "height": 400})
        pg.set_content(f'<html><body style="margin:0;background:transparent;display:inline-block">{svg}</body></html>')
        pg.locator("svg").screenshot(path=os.path.join(B, out), omit_background=True)
    b.close()
print("brand files written")
