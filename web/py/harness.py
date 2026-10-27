"""Datakul Python test harness (runs inside Pyodide in a Web Worker).

For each test, the same inputs are built twice (setup code), the learner's function and
the reference function are called, and their observed results are compared after
normalisation. Expected outputs therefore always come from the reference solution.
"""
import copy
import inspect
import io
import json
import math
import sys
import traceback
from contextlib import redirect_stdout

_PANDAS = None
_SPARK = None


def _ensure(lang):
    """Import pandas / the PySpark engine only for problems that need them."""
    global _PANDAS, _SPARK
    if lang in ("pandas", "pyspark") and _PANDAS is None:
        import pandas as pd
        _PANDAS = pd
    if lang == "pyspark" and _SPARK is None:
        import pyspark_lite
        pyspark_lite.install()
        _SPARK = pyspark_lite.spark


def _norm(x, ordered=True):
    """Turn results into plain, comparable Python data."""
    if x is None:
        return None
    if isinstance(x, bool):
        return x
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        if math.isnan(x):
            return None
        return int(x) if x.is_integer() else round(x, 6)
    if isinstance(x, str):
        return x
    mod = type(x).__module__
    if mod.startswith("numpy"):
        try:
            return _norm(x.item(), ordered)
        except Exception:
            return _norm(x.tolist(), ordered)
    if _PANDAS is not None:
        pd = _PANDAS
        if type(x).__name__ == "DataFrame" and mod.startswith("pyspark_lite"):
            x = x.toPandas()
        if isinstance(x, pd.DataFrame):
            rows = [tuple(_norm(v) for v in r) for r in x.itertuples(index=False, name=None)]
            if not ordered:
                rows = sorted(rows, key=repr)
            return {"__df__": [str(c) for c in x.columns], "rows": rows}
        if isinstance(x, pd.Series):
            return [_norm(v) for v in x.tolist()]
        if x is pd.NaT:
            return None
        if isinstance(x, pd.Timestamp):
            return x.isoformat()
    if hasattr(x, "isoformat"):
        return x.isoformat()
    if isinstance(x, dict):
        return {str(k): _norm(v, ordered) for k, v in sorted(x.items(), key=lambda kv: repr(kv[0]))}
    if isinstance(x, (set, frozenset)):
        return sorted((_norm(v, ordered) for v in x), key=repr)
    if inspect.isgenerator(x) or type(x).__name__ in ("map", "filter", "zip"):
        x = list(x)
    if isinstance(x, (list, tuple)):
        return [_norm(v, ordered) for v in x]
    if hasattr(x, "asDict"):
        return _norm(tuple(x), ordered)
    return repr(x)


def _same(a, b):
    if isinstance(a, dict) and isinstance(b, dict) and "__df__" in a and "__df__" in b:
        return len(a["__df__"]) == len(b["__df__"]) and a["rows"] == b["rows"]
    return a == b


def _short(v, limit=600):
    if isinstance(v, dict) and "__df__" in v:
        head = " | ".join(v["__df__"])
        body = "\n".join(" | ".join("null" if c is None else str(c) for c in r) for r in v["rows"][:15])
        more = f"\n… {len(v['rows']) - 15} more rows" if len(v["rows"]) > 15 else ""
        s = f"{head}\n{body}{more}"
    else:
        s = repr(v)
    return s if len(s) <= limit else s[:limit] + " …"


def _show(raw, normed):
    """Display the learner-facing value: tables for DataFrames, Python repr for everything else."""
    if isinstance(normed, dict) and "__df__" in normed:
        return _short(normed)
    try:
        if inspect.isgenerator(raw):
            raw = list(raw)
        return _short_text(repr(raw))
    except Exception:
        return _short(normed)


def _short_text(s, limit=600):
    return s if len(s) <= limit else s[:limit] + " …"


def _load(code, label):
    ns = {"__name__": "__dp__", "__builtins__": __builtins__}
    if _SPARK is not None:
        ns["spark"] = _SPARK
    exec(compile(code, label, "exec"), ns)
    return ns


def _err(e, label):
    tb = traceback.extract_tb(e.__traceback__)
    line = next((f.lineno for f in reversed(tb) if f.filename == label), None)
    where = f" (line {line})" if line else ""
    return f"{type(e).__name__}{where}: {e}"


def _observe(ns, test, label):
    env = dict(ns)
    buf = io.StringIO()
    with redirect_stdout(buf):
        exec(compile(test.get("setup", ""), "<test setup>", "exec"), env)
        result = eval(compile(test["call"], label, "eval"), env)
        if inspect.isgenerator(result):
            result = list(result)
        env["result"] = result
        obs = eval(test.get("observe") or "result", env)
    return obs, buf.getvalue()


def run(payload_json):
    p = json.loads(payload_json)
    lang, ordered, entry = p.get("lang", "python"), p.get("ordered", True), p.get("entry")
    out = {"tests": [], "error": None}
    try:
        _ensure(lang)
    except Exception as e:
        out["error"] = "Couldn't start the runtime: " + _err(e, "")
        return json.dumps(out)
    try:
        mine = _load(p["code"], "<your code>")
    except Exception as e:
        out["error"] = _err(e, "<your code>")
        return json.dumps(out)
    if entry and not callable(mine.get(entry)):
        out["error"] = f"Define a function named {entry}()."
        return json.dumps(out)
    try:
        ref = _load(p["reference"], "<reference>")
    except Exception as e:
        out["error"] = "The reference solution failed to load: " + _err(e, "<reference>")
        return json.dumps(out)
    for i, t in enumerate(p["tests"]):
        r = {"name": t.get("name") or f"Test {i + 1}", "hidden": bool(t.get("hidden"))}
        try:
            exp_raw, _ = _observe(ref, t, "<reference>")
            exp = _norm(exp_raw, ordered)
        except Exception as e:
            r.update(ok=False, error="The reference solution failed on this test: " + _err(e, "<reference>"))
            out["tests"].append(r)
            continue
        try:
            got_raw, printed = _observe(mine, t, "<your code>")
            got = _norm(got_raw, ordered)
            r.update(ok=_same(got, exp), got=_show(got_raw, got), expected=_show(exp_raw, exp), stdout=printed[-2000:])
        except Exception as e:
            r.update(ok=False, error=_err(e, "<your code>"), expected=_show(exp_raw, exp))
        r["input"] = (t.get("setup", "").strip() + "\n" + t["call"]).strip()
        out["tests"].append(r)
    return json.dumps(out)
