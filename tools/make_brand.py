# Builds the Datakul brand files from one definition: the compass mark and the Space Grotesk Bold wordmark (outlined,
# so it looks the same everywhere without the font). Writes brand/*.svg, brand/*.png (needs Playwright) and
# brand/inline.json (the snippets used in web/index.html and web/admin.html).
#   python3 tools/make_brand.py
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
B = os.path.join(ROOT, "brand")

# ---- colours (compass palette) ----
NAVY, SKY, SAFFRON, WHITE, INK = "#0B2A3A", "#5CC3E6", "#FF8A2A", "#FFFFFF", "#0B2A3A"


def mark(bg=NAVY, ring=SKY, north=SAFFRON, south=WHITE, rx=26):
    """The compass, on a 100x100 tile."""
    return (f'<rect width="100" height="100" rx="{rx}" fill="{bg}"/>'
            f'<circle cx="50" cy="50" r="31" fill="none" stroke="{ring}" stroke-width="4.5"/>'
            f'<path d="M50 14V20M50 80V86M14 50H20M80 50H86" stroke="{ring}" stroke-width="4.5" stroke-linecap="round"/>'
            f'<path d="M50 22L59 50H41Z" fill="{north}"/><path d="M50 78L59 50H41Z" fill="{south}"/>'
            f'<circle cx="50" cy="50" r="4.5" fill="{bg}"/>')


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
    # full-bleed tile; compass kept inside the 80% safe circle
    return svg_doc(f'<rect width="100" height="100" fill="{NAVY}"/><g transform="translate(20 20) scale(0.6)">{mark(rx=0)}</g>',
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
fav = svg_doc(mark(), "0 0 100 100", 64, 64, "Datakul").replace("\n", "")
inline = {
    "mark": mark(),
    "wordmark_viewbox": WVB,
    "wordmark_data": d1,
    "wordmark_kul": d2,
    "favicon_data_uri": "data:image/svg+xml," + fav.replace("#", "%23").replace("<", "%3C").replace(">", "%3E").replace('"', "'"),
}
json.dump(inline, open(os.path.join(B, "inline.json"), "w"), indent=1)

# ---- PNGs ----
if "--no-png" in sys.argv:
    sys.exit(0)
from playwright.sync_api import sync_playwright
pngs = [("datakul-mark.svg", "datakul-icon-512.png", 512, 512), ("datakul-mark.svg", "datakul-icon-192.png", 192, 192),
        ("datakul-maskable.svg", "datakul-maskable-512.png", 512, 512), ("datakul-maskable.svg", "datakul-apple-180.png", 180, 180),
        ("datakul-mark.svg", "datakul-favicon-32.png", 32, 32)]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    for src, out, w, h in pngs:
        svg = open(os.path.join(B, src)).read()
        pg.set_viewport_size({"width": w, "height": h})
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg style=\"display:block;width:{w}px;height:{h}px\" ", 1)}</body></html>')
        pg.screenshot(path=os.path.join(B, out), omit_background=True)
    for src, out in [("datakul-logo.svg", "datakul-logo.png"), ("datakul-logo-dark.svg", "datakul-logo-dark.png")]:
        svg = open(os.path.join(B, src)).read()
        pg.set_viewport_size({"width": 1400, "height": 400})
        pg.set_content(f'<html><body style="margin:0;background:transparent;display:inline-block">{svg}</body></html>')
        pg.locator("svg").screenshot(path=os.path.join(B, out), omit_background=True)
    b.close()
print("brand files written")
