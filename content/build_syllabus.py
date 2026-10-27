"""Parse syllabus.txt into syllabus.json and validate it."""
import json, re, sys, pathlib, collections
here = pathlib.Path(__file__).parent
lib = (here.parent / "web" / "library.js").read_text()
existing = set(re.findall(r'\{"?id"?:"([^"]+)","?t"?:"', lib))
topics, track, module, order = [], None, None, 0
for raw in (here / "syllabus.txt").read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("# "): continue
    if line.startswith("## "):
        track, module = [x.strip() for x in line[3:].split("|", 1)]; continue
    parts = [x.strip() for x in line.split("|")]
    tid, title, level, pre, pack = parts
    order += 1
    topics.append({"id": tid, "title": title, "track": track, "module": module, "level": level,
                   "prereqs": [p.strip() for p in pre.split(",") if p.strip()], "pack": pack,
                   "status": "existing" if tid in existing else "new", "order": order})
ids = [t["id"] for t in topics]
errs = [f"duplicate id {i}" for i, n in collections.Counter(ids).items() if n > 1]
idset = set(ids)
for t in topics:
    if t["level"] not in "FIA": errs.append(f"{t['id']}: bad level")
    for p in t["prereqs"]:
        if p not in idset: errs.append(f"{t['id']}: unknown prereq {p}")
        if p == t["id"]: errs.append(f"{t['id']}: self prereq")
# cycle check
graph = {t["id"]: t["prereqs"] for t in topics}
state = {}
def visit(n, path):
    if state.get(n) == 1: errs.append("cycle: " + " -> ".join(path + [n])); return
    if state.get(n) == 2: return
    state[n] = 1
    for p in graph.get(n, []): visit(p, path + [n])
    state[n] = 2
for n in graph: visit(n, [])
missing_existing = existing - idset
if missing_existing: errs.append(f"existing library entries not in syllabus: {sorted(missing_existing)}")
if errs:
    print("\n".join(errs)); sys.exit(1)
(here / "syllabus.json").write_text(json.dumps(topics, indent=1, ensure_ascii=False))
c = collections.Counter(t["track"] for t in topics); s = collections.Counter(t["status"] for t in topics)
p = collections.Counter(t["pack"] for t in topics); l = collections.Counter(t["level"] for t in topics)
print(f"{len(topics)} topics | tracks {dict(c)} | {dict(s)} | packs {dict(p)} | levels {dict(l)} | library has {len(existing)}")
