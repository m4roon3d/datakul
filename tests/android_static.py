# Checks the Android project without building it (the real build runs in CI, .github/workflows/android.yml):
# every XML file is well formed, the site address, package name and signing fingerprint agree across the app and the website,
# shortcuts open real screens, and every resource the manifest names exists.
import json, re, sys, os, glob, subprocess
import xml.etree.ElementTree as ET
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
fails = 0
def ok(c, m):
    global fails
    print(("ok   " if c else "FAIL ") + m)
    if not c: fails += 1
rd = lambda p: open(os.path.join(R, p), encoding="utf-8").read()
A = "http://schemas.android.com/apk/res/android"

xmls = glob.glob(os.path.join(R, "android/**/*.xml"), recursive=True)
bad = []
for f in xmls:
    try: ET.parse(f)
    except Exception as e: bad.append(f"{os.path.relpath(f, R)}: {e}")
ok(xmls and not bad, f"all {len(xmls)} XML files are well formed {bad}")

strings = {s.get("name"): (s.text or "") for s in ET.parse(os.path.join(R, "android/app/src/main/res/values/strings.xml")).getroot()}
colors = {s.get("name") for s in ET.parse(os.path.join(R, "android/app/src/main/res/values/colors.xml")).getroot()}
man = ET.parse(os.path.join(R, "android/app/src/main/AndroidManifest.xml")).getroot()
gradle = rd("android/app/build.gradle")
site = re.match(r"https://[^/]+", strings["launch_url"]).group(0)
host = site.split("//")[1]
web = json.loads(rd("web/manifest.webmanifest"))
ok(strings["web_manifest_url"] == site + "/manifest.webmanifest", "the web manifest address matches the site")
ok(re.search(r"applicationId '([^']+)'", gradle).group(1) == "app.datakul" == re.search(r"namespace '([^']+)'", gradle).group(1), "package name is app.datakul")
ok(any(d.get(f"{{{A}}}host") == host for d in man.iter("data")), "the app claims links for the site's host")
ok(json.loads(strings["asset_statements"].replace(chr(92) + chr(34), chr(34)))[0]["target"]["site"] == site, "the asset statement names the site")
ok(web["start_url"].startswith("/") and web["scope"] == "/", "the web app's scope is the whole site (so the app never leaves it)")

al = json.loads(rd("web/.well-known/assetlinks.json"))[0]
ok(al["target"]["package_name"] == "app.datakul" and "delegate_permission/common.handle_all_urls" in al["relation"], "assetlinks.json names the app")
fps = {x.upper() for x in al["target"]["sha256_cert_fingerprints"]}
out = subprocess.run(["keytool", "-list", "-v", "-keystore", os.path.join(R, "android/app/datakul-debug.keystore"), "-storepass", "android", "-alias", "androiddebugkey"], capture_output=True, text=True).stdout
dbg = re.search(r"SHA256: ([0-9A-F:]{95})", out)
ok(bool(dbg) and dbg.group(1) in fps, "assetlinks.json lists the debug key's fingerprint, so the test APK opens full screen")
ok(all(re.fullmatch(r"([0-9A-F]{2}:){31}[0-9A-F]{2}", x) for x in fps), "every fingerprint is a valid SHA-256")

# resources named in the manifest exist
for m in re.findall(r'@(string|color|style|xml|mipmap|drawable)/([A-Za-z0-9_.]+)', rd("android/app/src/main/AndroidManifest.xml")):
    kind, name = m
    if kind == "string": found = name in strings
    elif kind == "color": found = name in colors
    elif kind == "style": found = bool(re.search(f'name="{re.escape(name)}"', rd("android/app/src/main/res/values/themes.xml")))
    else: found = bool(glob.glob(os.path.join(R, f"android/app/src/main/res/{kind}*/{name}.*")))
    ok(found, f"manifest resource @{kind}/{name} exists")
for name in ["ic_launcher", "ic_launcher_foreground"]:
    ok(len(glob.glob(os.path.join(R, f"android/app/src/main/res/mipmap-*dpi/{name}.png"))) == 5, f"{name} exists at all 5 densities")

# shortcuts open screens the app really has
views = re.search(r"const VIEWS = \[([^\]]+)\]", rd("web/app.js")).group(1)
views = set(re.findall(r'"([a-z]+)"', views))
sc = ET.parse(os.path.join(R, "android/app/src/main/res/xml/shortcuts.xml")).getroot()
for s in sc:
    it = s.find("intent"); url = it.get(f"{{{A}}}data"); h = url.split("#")[1]
    ok(url.startswith(site + "/#") and h in views, f"shortcut {s.get(f'{{{A}}}shortcutId')} opens screen '{h}'")
    ok(strings[s.get(f"{{{A}}}shortcutShortLabel").split("/")[1]] != "", f"shortcut {s.get(f'{{{A}}}shortcutId')} has a label")
ok(len(sc) <= 4, "at most 4 launcher shortcuts (Android shows 4)")

# store rules
ok(int(re.search(r"targetSdk (\d+)", gradle).group(1)) >= 35, "targets Android 15 or newer, as Google Play requires")
ok("DATAKUL_UPLOAD_KEYSTORE" in gradle and "storePassword System.getenv" in gradle, "the Play upload key comes only from CI secrets")
ok(not glob.glob(os.path.join(R, "android/**/*.jks"), recursive=True), "no upload key file is in the repo")
print(f"\n{fails} FAILED" if fails else "\nALL ANDROID STATIC TESTS PASSED")
sys.exit(1 if fails else 0)
