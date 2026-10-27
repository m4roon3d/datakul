"""Shared helpers for writing content batches."""
import json, pathlib


def concept(id, t, title, mod, lv, kw, s, d, e, c, i, r):
    return {"id": id, "t": t, "title": title, "mod": mod, "lv": lv, "kw": kw, "s": s, "d": d, "e": e, "c": c, "i": i, "r": r}


def q(c, roles, lv, dom, tg, text, points, answer):
    return {"r": roles, "l": lv, "d": dom, "c": c, "tg": tg, "q": text,
            "p": [{"t": t, "k": k} for t, k in points], "a": answer}


def write(file, number, name, concepts, questions, search_checks):
    out = pathlib.Path(file).with_suffix(".json")
    out.write_text(json.dumps({"batch": number, "name": name, "concepts": concepts, "questions": questions,
                               "searchChecks": search_checks}, ensure_ascii=False, indent=1))
    print(f"wrote {out.name}: {len(concepts)} concepts, {len(questions)} questions")
