"""pyspark_lite: a small, pandas-backed subset of the PySpark DataFrame API.

It lets Datakul run learners' PySpark answers in the browser (Pyodide), where a real
Spark cluster can't run. It covers the API used in typical data interviews:
DataFrame select / withColumn / filter / groupBy().agg / orderBy / join / distinct /
dropDuplicates / union / limit / collect / show, Column operators and functions, and
Window functions (row_number, rank, dense_rank, lag, lead, running aggregates).

Differences from real Spark: execution is eager and single-machine, running window
aggregates use a ROWS frame, and anything outside the subset raises a clear error.
"""
import copy as _copy
import datetime as _dt
import math as _math

import pandas as pd

__all__ = ["SparkSession", "DataFrame", "Column", "Row", "Window", "F"]


class PySparkLiteError(NotImplementedError):
    pass


def _unsupported(what):
    raise PySparkLiteError(
        f"{what} isn't supported by Datakul's in-browser PySpark engine. "
        "Use the DataFrame API with column functions (F.col, F.sum, F.when, Window, …)."
    )


# --------------------------------------------------------------------------- Row
class Row(tuple):
    def __new__(cls, *args, **kwargs):
        if kwargs:
            r = tuple.__new__(cls, kwargs.values())
            r.__fields__ = list(kwargs.keys())
        else:
            r = tuple.__new__(cls, args)
            r.__fields__ = None
        return r

    def __getattr__(self, item):
        f = tuple.__getattribute__(self, "__fields__")
        if f and item in f:
            return self[f.index(item)]
        raise AttributeError(item)

    def __getitem__(self, k):
        if isinstance(k, str):
            return self[self.__fields__.index(k)]
        return tuple.__getitem__(self, k)

    def asDict(self):
        return dict(zip(self.__fields__, self))

    def __repr__(self):
        if self.__fields__:
            return "Row(" + ", ".join(f"{k}={v!r}" for k, v in zip(self.__fields__, self)) + ")"
        return "<Row(" + ", ".join(repr(v) for v in self) + ")>"


def _clean(v):
    """Convert pandas/numpy scalars and NaN to plain Python values."""
    if v is None:
        return None
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):
        try:
            v = v.item()
        except Exception:
            pass
    if isinstance(v, float) and _math.isnan(v):
        return None
    if v is pd.NaT:
        return None
    if isinstance(v, pd.Timestamp):
        return v.to_pydatetime()
    return v


# --------------------------------------------------------------------------- Column
def _series(d, v):
    return pd.Series([v] * len(d), index=d.index, dtype=object)


def _coerce_pair(a, b):
    """Let date/datetime columns compare with ISO date strings, like Spark's implicit cast."""
    def kind(s):
        if isinstance(s, pd.Series):
            nn = s.dropna()
            return type(nn.iloc[0]) if len(nn) else None
        return type(s)
    ka, kb = kind(a), kind(b)
    dates = (_dt.date, _dt.datetime)
    if ka in dates and kb is str:
        b = pd.Series(b, index=a.index) if not isinstance(b, pd.Series) else b
        b = b.map(lambda x: _parse_date(x, ka is _dt.datetime))
    elif kb in dates and ka is str:
        a = pd.Series(a, index=b.index) if not isinstance(a, pd.Series) else a
        a = a.map(lambda x: _parse_date(x, kb is _dt.datetime))
    return a, b


def _parse_date(x, as_datetime=False):
    if x is None or (isinstance(x, float) and _math.isnan(x)):
        return None
    if isinstance(x, (_dt.date, _dt.datetime)):
        return x
    t = pd.Timestamp(str(x))
    return t.to_pydatetime() if as_datetime else t.date()


class Column:
    """Row-level column (fn: pandas DataFrame -> Series) or aggregate column (g: group -> scalar)."""

    __hash__ = object.__hash__

    def __init__(self, fn=None, name="col", g=None, order=None, src=None):
        self.fn, self._name, self.g, self.order, self.src = fn, name, g, order, src
        self._eqpair = None

    # naming
    def alias(self, name):
        c = _copy.copy(self)
        c._name = name
        return c

    def name(self, name):
        return self.alias(name)

    @property
    def is_agg(self):
        return self.g is not None

    # ordering
    def desc(self):
        c = _copy.copy(self); c.order = "desc"; return c

    def asc(self):
        c = _copy.copy(self); c.order = "asc"; return c

    desc_nulls_last = desc
    asc_nulls_first = asc

    # operators
    def _bin(self, other, op, sym, swap=False):
        oname = other._name if isinstance(other, Column) else repr(other)
        name = f"({oname} {sym} {self._name})" if swap else f"({self._name} {sym} {oname})"
        if self.is_agg or (isinstance(other, Column) and other.is_agg):
            ga = self.g if self.is_agg else None
            def g(grp, o=other):
                a = ga(grp) if ga else None
                b = o.g(grp) if isinstance(o, Column) else o
                a, b = (b, a) if swap else (a, b)
                if a is None or b is None:
                    return None
                return op(a, b)
            return Column(g=g, name=name)
        def fn(d, o=other):
            a = self.fn(d)
            b = o.fn(d) if isinstance(o, Column) else o
            a, b = _coerce_pair(a, b)
            if swap:
                a, b = b, a
            return op(a, b)
        return Column(fn, name)

    def __add__(self, o): return self._bin(o, lambda a, b: a + b, "+")
    def __radd__(self, o): return self._bin(o, lambda a, b: a + b, "+", True)
    def __sub__(self, o): return self._bin(o, lambda a, b: a - b, "-")
    def __rsub__(self, o): return self._bin(o, lambda a, b: a - b, "-", True)
    def __mul__(self, o): return self._bin(o, lambda a, b: a * b, "*")
    def __rmul__(self, o): return self._bin(o, lambda a, b: a * b, "*", True)
    def __truediv__(self, o): return self._bin(o, lambda a, b: a / b, "/")
    def __rtruediv__(self, o): return self._bin(o, lambda a, b: a / b, "/", True)
    def __mod__(self, o): return self._bin(o, lambda a, b: a % b, "%")
    def __gt__(self, o): return self._bin(o, lambda a, b: a > b, ">")
    def __ge__(self, o): return self._bin(o, lambda a, b: a >= b, ">=")
    def __lt__(self, o): return self._bin(o, lambda a, b: a < b, "<")
    def __le__(self, o): return self._bin(o, lambda a, b: a <= b, "<=")

    def __eq__(self, o):
        c = self._bin(o, lambda a, b: a == b, "=")
        if isinstance(o, Column) and self.src is not None and o.src is not None and self.src != o.src:
            c._eqpair = (self, o)
        return c

    def __ne__(self, o): return self._bin(o, lambda a, b: a != b, "!=")
    def __and__(self, o): return self._bin(o, lambda a, b: _b(a) & _b(b), "AND")
    def __or__(self, o): return self._bin(o, lambda a, b: _b(a) | _b(b), "OR")

    def __invert__(self):
        return Column(lambda d: ~_b(self.fn(d)), f"(NOT {self._name})")

    def __neg__(self):
        return Column(lambda d: -self.fn(d), f"(- {self._name})")

    def __bool__(self):
        raise ValueError("Cannot convert column into bool: use '&' for 'and', '|' for 'or', '~' for 'not'.")

    # predicates
    def isNull(self): return Column(lambda d: self.fn(d).isna(), f"({self._name} IS NULL)")
    def isNotNull(self): return Column(lambda d: self.fn(d).notna(), f"({self._name} IS NOT NULL)")
    def isin(self, *vals):
        if len(vals) == 1 and isinstance(vals[0], (list, tuple, set)):
            vals = list(vals[0])
        return Column(lambda d: self.fn(d).isin(list(vals)), f"({self._name} IN {tuple(vals)})")
    def between(self, lo, hi): return (self >= lo) & (self <= hi)
    def contains(self, s): return Column(lambda d: self.fn(d).astype(str).str.contains(s, regex=False), f"contains({self._name}, {s})")
    def startswith(self, s): return Column(lambda d: self.fn(d).astype(str).str.startswith(s), f"startswith({self._name}, {s})")
    def endswith(self, s): return Column(lambda d: self.fn(d).astype(str).str.endswith(s), f"endswith({self._name}, {s})")
    def like(self, pat):
        import re
        rx = "^" + re.escape(pat).replace("%", ".*").replace("_", ".") + "$"
        return Column(lambda d: self.fn(d).astype(str).str.match(rx), f"{self._name} LIKE {pat}")

    def cast(self, t):
        t = str(t).lower().replace("type()", "").replace("type", "")
        def fn(d):
            s = self.fn(d)
            if t in ("int", "integer", "long", "bigint", "short"):
                return pd.to_numeric(s, errors="coerce").map(lambda v: None if pd.isna(v) else int(v))
            if t in ("double", "float", "decimal"):
                return pd.to_numeric(s, errors="coerce").astype(float)
            if t == "string":
                return s.map(lambda v: None if v is None or (isinstance(v, float) and _math.isnan(v)) else (v.isoformat() if isinstance(v, (_dt.date, _dt.datetime)) else str(v)))
            if t == "date":
                return s.map(lambda v: _parse_date(v))
            if t == "timestamp":
                return s.map(lambda v: _parse_date(v, True))
            if t == "boolean":
                return s.map(lambda v: None if v is None else bool(v))
            _unsupported(f"cast to {t}")
        return Column(fn, self._name)

    astype = cast

    def otherwise(self, v):
        _unsupported("otherwise() without when()")

    def over(self, window):
        _unsupported("over() on this expression")

    def __repr__(self):
        return f"Column<'{self._name}'>"


def _b(s):
    if isinstance(s, pd.Series):
        return s.fillna(False).astype(bool)
    return bool(s)


def _colify(c):
    if isinstance(c, Column):
        return c
    if isinstance(c, str):
        if c == "*":
            return Column(lambda d: _series(d, 1), "*")
        return Column(lambda d, n=c: _get(d, n), c)
    return lit(c)


def _get(d, n):
    if n not in d.columns:
        raise KeyError(f"Column '{n}' not found. Available columns: {list(d.columns)}")
    return d[n]


def lit(v):
    return Column(lambda d: _series(d, v), str(v))


def col(n):
    return _colify(n)


column = col


# --------------------------------------------------------------------------- when / otherwise
class _When(Column):
    def __init__(self, branches, default=None, has_default=False):
        self.branches, self.default, self.has_default = branches, default, has_default
        super().__init__(self._eval, "CASE WHEN")

    def _eval(self, d):
        out = pd.Series([None] * len(d), index=d.index, dtype=object)
        done = pd.Series(False, index=d.index)
        for cond, val in self.branches:
            m = _b(cond.fn(d)) & ~done
            v = val.fn(d) if isinstance(val, Column) else _series(d, val)
            out[m] = v[m]
            done |= m
        if self.has_default:
            v = self.default.fn(d) if isinstance(self.default, Column) else _series(d, self.default)
            out[~done] = v[~done]
        return out.infer_objects()

    def when(self, cond, val):
        return _When(self.branches + [(cond, val)], self.default, self.has_default)

    def otherwise(self, val):
        return _When(self.branches, val, True)


def when(cond, val):
    return _When([(cond, val)])


# --------------------------------------------------------------------------- aggregates
def _vals(s):
    return [v for v in (_clean(x) for x in s) if v is not None]


_AGG = {
    "sum": lambda v: sum(v) if v else None,
    "count": len,
    "avg": lambda v: (sum(v) / len(v)) if v else None,
    "min": lambda v: min(v) if v else None,
    "max": lambda v: max(v) if v else None,
    "countDistinct": lambda v: len(set(v)),
    "collect_list": list,
    "collect_set": lambda v: list(dict.fromkeys(v)),
    "first": lambda v: v[0] if v else None,
    "last": lambda v: v[-1] if v else None,
}


class _AggColumn(Column):
    def __init__(self, fname, inner, label):
        self.fname, self.inner = fname, inner
        f = _AGG[fname]
        super().__init__(None, label, g=lambda grp: f(_vals(inner.fn(grp))))

    def over(self, window):
        f, inner = _AGG[self.fname], self.inner
        def per_part(part, okeys, spec):
            vals = [_clean(x) for x in inner.fn(part)]
            out = []
            for i in range(len(vals)):
                lo, hi = spec.frame_bounds(i, len(vals))
                frame = [v for v in vals[lo:hi + 1] if v is not None]
                out.append(f(frame))
            return out
        return _window_column(window, per_part, f"{self._name} OVER (…)")


def _agg(fname, label_fn):
    def make(c="*"):
        inner = _colify(c)
        return _AggColumn(fname, inner, label_fn(inner._name))
    return make


sum = _agg("sum", lambda n: f"sum({n})")  # noqa: A001  (shadows builtin inside this module on purpose; see _AGG)
avg = _agg("avg", lambda n: f"avg({n})")
mean = avg
min = _agg("min", lambda n: f"min({n})")  # noqa: A001
max = _agg("max", lambda n: f"max({n})")  # noqa: A001
collect_list = _agg("collect_list", lambda n: f"collect_list({n})")
collect_set = _agg("collect_set", lambda n: f"collect_set({n})")
first = _agg("first", lambda n: f"first({n})")
last = _agg("last", lambda n: f"last({n})")

import builtins as _bi  # restore builtins for the rest of this module
_AGG.update({
    "sum": lambda v: _bi.sum(v) if v else None,
    "avg": lambda v: (_bi.sum(v) / len(v)) if v else None,
    "min": lambda v: _bi.min(v) if v else None,
    "max": lambda v: _bi.max(v) if v else None,
})


def count(c="*"):
    inner = _colify(c)
    label = "count(1)" if (isinstance(c, str) and c == "*") else f"count({inner._name})"
    return _AggColumn("count", inner, label)


def countDistinct(c, *more):
    if more:
        cols = [_colify(x) for x in (c,) + more]
        inner = Column(lambda d: pd.Series(list(zip(*[x.fn(d) for x in cols])), index=d.index), ",".join(x._name for x in cols))
    else:
        inner = _colify(c)
    return _AggColumn("countDistinct", inner, f"count(DISTINCT {inner._name})")


count_distinct = countDistinct


# --------------------------------------------------------------------------- row functions
def _map(c, f, label):
    c = _colify(c)
    if c.is_agg:
        return Column(g=lambda grp: (lambda v: None if v is None else f(v))(c.g(grp)), name=label)
    return Column(lambda d: c.fn(d).map(lambda v: None if _clean(v) is None else f(_clean(v))), label)


def round(c, scale=0):  # noqa: A001
    c2 = _colify(c)
    def r(v):
        q = 10 ** scale
        x = _math.floor(_bi.abs(v) * q + 0.5) / q  # Spark rounds half up
        x = x if v >= 0 else -x
        return x if scale > 0 else float(x)
    return _map(c2, r, f"round({c2._name}, {scale})")


def bround(c, scale=0): return _map(c, lambda v: _bi.round(v, scale), f"bround({_colify(c)._name}, {scale})")
def abs(c): return _map(c, lambda v: v if v >= 0 else -v, f"abs({_colify(c)._name})")  # noqa: A001
def floor(c): return _map(c, lambda v: _math.floor(v), f"FLOOR({_colify(c)._name})")
def ceil(c): return _map(c, lambda v: _math.ceil(v), f"CEIL({_colify(c)._name})")
def sqrt(c): return _map(c, lambda v: _math.sqrt(v), f"SQRT({_colify(c)._name})")
def upper(c): return _map(c, lambda v: str(v).upper(), f"upper({_colify(c)._name})")
def lower(c): return _map(c, lambda v: str(v).lower(), f"lower({_colify(c)._name})")
def trim(c): return _map(c, lambda v: str(v).strip(), f"trim({_colify(c)._name})")
def length(c): return _map(c, lambda v: len(str(v)), f"length({_colify(c)._name})")
def substring(c, pos, ln): return _map(c, lambda v: str(v)[pos - 1:pos - 1 + ln], f"substring({_colify(c)._name}, {pos}, {ln})")
def to_date(c, fmt=None): return _map(c, lambda v: _parse_date(v), f"to_date({_colify(c)._name})")
def to_timestamp(c, fmt=None): return _map(c, lambda v: _parse_date(v, True), f"to_timestamp({_colify(c)._name})")
def year(c): return _map(c, lambda v: _parse_date(v).year, f"year({_colify(c)._name})")
def month(c): return _map(c, lambda v: _parse_date(v).month, f"month({_colify(c)._name})")
def dayofmonth(c): return _map(c, lambda v: _parse_date(v).day, f"dayofmonth({_colify(c)._name})")
def dayofweek(c): return _map(c, lambda v: (_parse_date(v).isoweekday() % 7) + 1, f"dayofweek({_colify(c)._name})")
def hour(c): return _map(c, lambda v: _parse_date(v, True).hour, f"hour({_colify(c)._name})")
def date_add(c, n): return _map(c, lambda v: _parse_date(v) + _dt.timedelta(days=n), f"date_add({_colify(c)._name}, {n})")
def date_sub(c, n): return _map(c, lambda v: _parse_date(v) - _dt.timedelta(days=n), f"date_sub({_colify(c)._name}, {n})")


def date_format(c, fmt):
    py = fmt.replace("yyyy", "%Y").replace("MM", "%m").replace("dd", "%d").replace("HH", "%H").replace("mm", "%M").replace("ss", "%S")
    return _map(c, lambda v: _parse_date(v, True).strftime(py), f"date_format({_colify(c)._name}, {fmt})")


def datediff(end, start):
    e, s = _colify(end), _colify(start)
    def fn(d):
        return pd.Series([None if (a is None or b is None) else (_parse_date(a) - _parse_date(b)).days
                          for a, b in zip(map(_clean, e.fn(d)), map(_clean, s.fn(d)))], index=d.index, dtype=object)
    return Column(fn, f"datediff({e._name}, {s._name})")


def unix_timestamp(c):
    return _map(c, lambda v: int(_parse_date(v, True).replace(tzinfo=_dt.timezone.utc).timestamp()), f"unix_timestamp({_colify(c)._name})")


def concat(*cs):
    cols = [_colify(c) for c in cs]
    def fn(d):
        parts = [list(map(_clean, c.fn(d))) for c in cols]
        return pd.Series([None if any(p is None for p in row) else "".join(str(p) for p in row) for row in zip(*parts)], index=d.index, dtype=object)
    return Column(fn, "concat(" + ", ".join(c._name for c in cols) + ")")


def concat_ws(sep, *cs):
    cols = [_colify(c) for c in cs]
    def fn(d):
        parts = [list(map(_clean, c.fn(d))) for c in cols]
        return pd.Series([sep.join(str(p) for p in row if p is not None) for row in zip(*parts)], index=d.index, dtype=object)
    return Column(fn, f"concat_ws({sep}, …)")


def coalesce(*cs):
    cols = [_colify(c) for c in cs]
    def fn(d):
        parts = [list(map(_clean, c.fn(d))) for c in cols]
        return pd.Series([next((p for p in row if p is not None), None) for row in zip(*parts)], index=d.index, dtype=object).infer_objects()
    return Column(fn, "coalesce(" + ", ".join(c._name for c in cols) + ")")


def greatest(*cs):
    cols = [_colify(c) for c in cs]
    return Column(lambda d: pd.Series([_bi.max([v for v in row if v is not None], default=None) for row in zip(*[list(map(_clean, c.fn(d))) for c in cols])], index=d.index, dtype=object), "greatest")


def least(*cs):
    cols = [_colify(c) for c in cs]
    return Column(lambda d: pd.Series([_bi.min([v for v in row if v is not None], default=None) for row in zip(*[list(map(_clean, c.fn(d))) for c in cols])], index=d.index, dtype=object), "least")


def isnull(c):
    return _colify(c).isNull()


def desc(c): return _colify(c).desc()
def asc(c): return _colify(c).asc()


def expr(s):
    _unsupported("F.expr / SQL expression strings")


def udf(*a, **k):
    _unsupported("UDFs")


# --------------------------------------------------------------------------- windows
class WindowSpec:
    def __init__(self, parts=(), orders=(), frame=None):
        self.parts, self.orders, self.frame = list(parts), list(orders), frame

    def partitionBy(self, *cols):
        cols = cols[0] if len(cols) == 1 and isinstance(cols[0], (list, tuple)) else cols
        return WindowSpec([_colify(c) for c in cols], self.orders, self.frame)

    def orderBy(self, *cols):
        cols = cols[0] if len(cols) == 1 and isinstance(cols[0], (list, tuple)) else cols
        return WindowSpec(self.parts, [_colify(c) for c in cols], self.frame)

    def rowsBetween(self, start, end):
        return WindowSpec(self.parts, self.orders, (start, end))

    def rangeBetween(self, start, end):
        return self.rowsBetween(start, end)  # documented approximation

    def frame_bounds(self, i, n):
        if self.frame is None:
            return (0, i) if self.orders else (0, n - 1)
        s, e = self.frame
        lo = 0 if s <= Window.unboundedPreceding else i + s
        hi = n - 1 if e >= Window.unboundedFollowing else i + e
        return _bi.max(lo, 0), _bi.min(hi, n - 1)


class Window:
    unboundedPreceding = -(1 << 62)
    unboundedFollowing = 1 << 62
    currentRow = 0

    @staticmethod
    def partitionBy(*cols): return WindowSpec().partitionBy(*cols)

    @staticmethod
    def orderBy(*cols): return WindowSpec().orderBy(*cols)


def _sort_frame(d, orders):
    """Return d sorted by the order columns (Spark: ASC NULLS FIRST, DESC NULLS LAST)."""
    if not orders:
        return d
    tmp = d.copy()
    keys = []
    for i, oc in enumerate(orders):
        vals = [_clean(v) for v in oc.fn(d)]
        desc_ = oc.order == "desc"
        nul = f"__n{i}"; key = f"__o{i}"
        tmp[nul] = [(0 if v is not None else 1) if desc_ else (1 if v is not None else 0) for v in vals]
        tmp[key] = pd.Series(vals, index=d.index, dtype=object)
        keys += [(nul, True), (key, not desc_)]
    nonnull = tmp
    # sort key by key from last to first with a stable sort
    for k, asc_ in reversed(keys):
        nonnull = nonnull.sort_values(k, ascending=asc_, kind="mergesort", key=lambda s: s.map(lambda v: (v is None, v) if v is not None else (True, 0)) if s.dtype == object else s)
    return d.loc[nonnull.index]


def _window_column(spec, per_part, label):
    def fn(d):
        out = pd.Series([None] * len(d), index=d.index, dtype=object)
        if spec.parts:
            pk = pd.Series(list(zip(*[[_clean(v) for v in p.fn(d)] for p in spec.parts])), index=d.index)
            groups = {}
            for idx, k in pk.items():
                groups.setdefault(k, []).append(idx)
            parts = [d.loc[ix] for ix in groups.values()]
        else:
            parts = [d]
        for part in parts:
            sp = _sort_frame(part, spec.orders)
            okeys = [tuple(_clean(o.fn(sp).loc[i]) for o in spec.orders) for i in sp.index]
            vals = per_part(sp, okeys, spec)
            for i, v in zip(sp.index, vals):
                out.at[i] = v
        return out.infer_objects()
    return Column(fn, label)


class _WinFunc(Column):
    def __init__(self, label, per_part):
        super().__init__(None, label)
        self.per_part = per_part

    def over(self, window):
        if not window.orders and self._name.split("(")[0] in ("row_number", "rank", "dense_rank", "lag", "lead"):
            raise PySparkLiteError(f"{self._name} requires an ordered window: Window.partitionBy(...).orderBy(...)")
        return _window_column(window, self.per_part, f"{self._name} OVER (…)")


def row_number():
    return _WinFunc("row_number()", lambda p, k, s: list(range(1, len(p) + 1)))


def rank():
    def f(p, keys, s):
        out, r = [], 0
        for i, k in enumerate(keys):
            r = i + 1 if i == 0 or k != keys[i - 1] else r
            out.append(r)
        return out
    return _WinFunc("rank()", f)


def dense_rank():
    def f(p, keys, s):
        out, r = [], 0
        for i, k in enumerate(keys):
            if i == 0 or k != keys[i - 1]:
                r += 1
            out.append(r)
        return out
    return _WinFunc("dense_rank()", f)


def percent_rank():
    def f(p, keys, s):
        rk = rank().per_part(p, keys, s)
        n = len(keys)
        return [0.0 if n == 1 else (r - 1) / (n - 1) for r in rk]
    return _WinFunc("percent_rank()", f)


def ntile(n):
    def f(p, keys, s):
        m = len(keys); base, extra = divmod(m, n); out = []
        for b in range(n):
            out += [b + 1] * (base + (1 if b < extra else 0))
        return out
    return _WinFunc(f"ntile({n})", f)


def lag(c, offset=1, default=None):
    cc = _colify(c)
    def f(p, k, s):
        v = [_clean(x) for x in cc.fn(p)]
        return [v[i - offset] if i - offset >= 0 else default for i in range(len(v))]
    return _WinFunc(f"lag({cc._name}, {offset})", f)


def lead(c, offset=1, default=None):
    cc = _colify(c)
    def f(p, k, s):
        v = [_clean(x) for x in cc.fn(p)]
        return [v[i + offset] if i + offset < len(v) else default for i in range(len(v))]
    return _WinFunc(f"lead({cc._name}, {offset})", f)


# --------------------------------------------------------------------------- DataFrame
class GroupedData:
    def __init__(self, df, keys):
        self.df, self.keys = df, keys

    def agg(self, *aggs):
        if len(aggs) == 1 and isinstance(aggs[0], dict):
            aggs = [{"sum": sum, "avg": avg, "mean": avg, "min": min, "max": max, "count": count}[f](c) for c, f in aggs[0].items()]
        for a in aggs:
            if not isinstance(a, Column) or not a.is_agg:
                raise PySparkLiteError(f"agg() expects aggregate expressions such as F.sum('x'); got {a!r}")
        d = self.df._pdf
        names = [k._name for k in self.keys]
        if self.keys:
            kv = pd.Series(list(zip(*[[_clean(v) for v in k.fn(d)] for k in self.keys])), index=d.index)
            groups = {}
            for idx, key in kv.items():
                groups.setdefault(key, []).append(idx)
            rows = [list(key) + [a.g(d.loc[ix]) for a in aggs] for key, ix in groups.items()]
        else:
            rows = [[a.g(d) for a in aggs]]
        return DataFrame(pd.DataFrame(rows, columns=names + [a._name for a in aggs]))

    def count(self): return self.agg(count("*").alias("count"))
    def sum(self, *c): return self.agg(*[sum(x) for x in c])
    def avg(self, *c): return self.agg(*[avg(x) for x in c])
    mean = avg
    def min(self, *c): return self.agg(*[min(x) for x in c])
    def max(self, *c): return self.agg(*[max(x) for x in c])


class _NA:
    def __init__(self, df): self.df = df
    def fill(self, value, subset=None): return self.df.fillna(value, subset)
    def drop(self, how="any", subset=None): return self.df.dropna(how, subset=subset)


class DataFrame:
    def __init__(self, pdf):
        self._pdf = pdf.reset_index(drop=True)
        self._id = id(self)

    # columns
    @property
    def columns(self): return list(self._pdf.columns)

    @property
    def dtypes(self): return [(c, str(t)) for c, t in self._pdf.dtypes.items()]

    def __getitem__(self, k):
        if isinstance(k, str):
            c = _colify(k); c.src = self._id; return c
        if isinstance(k, Column):
            return self.filter(k)
        if isinstance(k, (list, tuple)):
            return self.select(*k)
        _unsupported("this kind of indexing")

    def __getattr__(self, k):
        if k.startswith("_"):
            raise AttributeError(k)
        if k in self._pdf.columns:
            return self[k]
        raise AttributeError(f"'DataFrame' object has no attribute '{k}'. Datakul's in-browser PySpark supports a common subset of the API.")

    @property
    def na(self): return _NA(self)

    # transformations
    def _eval(self, c):
        return c.fn(self._pdf)

    def select(self, *cols):
        cols = cols[0] if len(cols) == 1 and isinstance(cols[0], (list, tuple)) else cols
        cols = [_colify(c) for c in cols]
        if any(c.is_agg for c in cols):
            if not all(c.is_agg for c in cols):
                raise PySparkLiteError("Mixing aggregate and non-aggregate columns in select() needs groupBy().")
            return GroupedData(self, []).agg(*cols)
        out = {}
        for c in cols:
            if c._name == "*":
                for n in self._pdf.columns:
                    out[n] = self._pdf[n]
            else:
                out[c._name] = self._eval(c).reset_index(drop=True)
        return DataFrame(pd.DataFrame(out))

    def withColumn(self, name, c):
        c = _colify(c)
        if c.is_agg:
            raise PySparkLiteError("An aggregate like F.sum() in withColumn() needs .over(window) or groupBy().agg().")
        pdf = self._pdf.copy()
        pdf[name] = self._eval(c).values
        return DataFrame(pdf)

    def withColumns(self, mapping):
        df = self
        for k, v in mapping.items():
            df = df.withColumn(k, v)
        return df

    def withColumnRenamed(self, old, new):
        return DataFrame(self._pdf.rename(columns={old: new}))

    def drop(self, *cols):
        names = [c._name if isinstance(c, Column) else c for c in cols]
        return DataFrame(self._pdf.drop(columns=[n for n in names if n in self._pdf.columns]))

    def filter(self, cond):
        if isinstance(cond, str):
            _unsupported("filter() with a SQL string")
        m = _b(self._eval(cond))
        return DataFrame(self._pdf[m.values])

    where = filter

    def groupBy(self, *cols):
        cols = cols[0] if len(cols) == 1 and isinstance(cols[0], (list, tuple)) else cols
        return GroupedData(self, [_colify(c) for c in cols])

    groupby = groupBy

    def agg(self, *aggs):
        return GroupedData(self, []).agg(*aggs)

    def orderBy(self, *cols, ascending=True):
        cols = cols[0] if len(cols) == 1 and isinstance(cols[0], (list, tuple)) else cols
        cols = [_colify(c) for c in cols]
        asc_list = ascending if isinstance(ascending, (list, tuple)) else [ascending] * len(cols)
        cols = [c if c.order else (c.asc() if a else c.desc()) for c, a in zip(cols, asc_list)]
        return DataFrame(_sort_frame(self._pdf, cols))

    sort = orderBy

    def distinct(self):
        return DataFrame(self._pdf.astype(object).drop_duplicates())

    def dropDuplicates(self, subset=None):
        return DataFrame(self._pdf.drop_duplicates(subset=subset))

    drop_duplicates = dropDuplicates

    def limit(self, n):
        return DataFrame(self._pdf.head(n))

    def union(self, other):
        if len(other.columns) != len(self.columns):
            raise PySparkLiteError("union() needs the same number of columns on both sides.")
        o = other._pdf.copy(); o.columns = self._pdf.columns
        return DataFrame(pd.concat([self._pdf, o], ignore_index=True))

    unionAll = union

    def unionByName(self, other, allowMissingColumns=False):
        return DataFrame(pd.concat([self._pdf, other._pdf], ignore_index=True))

    def join(self, other, on=None, how="inner"):
        how = (how or "inner").lower().replace("_outer", "").replace("outer", "outer")
        hmap = {"inner": "inner", "left": "left", "leftouter": "left", "right": "right", "rightouter": "right",
                "outer": "outer", "full": "outer", "fullouter": "outer", "cross": "cross",
                "left_anti": "anti", "leftanti": "anti", "anti": "anti", "left_semi": "semi", "leftsemi": "semi", "semi": "semi"}
        h = hmap.get(how.replace(" ", ""))
        if h is None:
            _unsupported(f"join type '{how}'")
        L, R = self._pdf, other._pdf
        if on is None:
            if h != "cross":
                _unsupported("join() without 'on' (use crossJoin)")
            return DataFrame(L.merge(R, how="cross"))
        if isinstance(on, Column):
            if on._eqpair is None:
                _unsupported("join conditions other than df1.a == df2.b (or a list of column names)")
            a, b = on._eqpair
            lk, rk = (a._name, b._name) if a.src == self._id else (b._name, a._name)
            kw = dict(left_on=lk, right_on=rk)
            keys = None
        else:
            keys = [on] if isinstance(on, str) else list(on)
            kw = dict(on=keys)
        if h in ("anti", "semi"):
            rkeys = R[kw.get("right_on", keys)] if keys is None else R[keys]
            rset = set(map(tuple, rkeys.astype(object).values.reshape(len(R), -1)))
            lk_ = L[[kw["left_on"]]] if keys is None else L[keys]
            m = [tuple(r) in rset for r in lk_.astype(object).values]
            m = [not x for x in m] if h == "anti" else m
            return DataFrame(L[m])
        res = L.merge(R, how=h, suffixes=("", "_right"), **kw)
        return DataFrame(res)

    def crossJoin(self, other):
        return DataFrame(self._pdf.merge(other._pdf, how="cross"))

    def fillna(self, value, subset=None):
        pdf = self._pdf.copy()
        cols = subset or (list(value.keys()) if isinstance(value, dict) else pdf.columns)
        for c in ([subset] if isinstance(subset, str) else cols):
            v = value[c] if isinstance(value, dict) else value
            pdf[c] = pdf[c].astype(object).where(pdf[c].notna(), v)
        return DataFrame(pdf)

    def dropna(self, how="any", thresh=None, subset=None):
        return DataFrame(self._pdf.dropna(how=how, subset=subset))

    def alias(self, name): return self
    def cache(self): return self
    def persist(self, *a): return self
    def unpersist(self, *a): return self
    def repartition(self, *a, **k): return self
    def coalesce(self, *a): return self
    def explain(self, *a): print("== Plan ==\n(in-browser engine: no query plan)")

    # actions
    def collect(self):
        return [Row(**{c: _clean(v) for c, v in zip(self.columns, r)}) for r in self._pdf.itertuples(index=False, name=None)]

    def toPandas(self):
        return self._pdf.copy()

    def count(self):
        return len(self._pdf)

    def first(self):
        rows = self.collect()
        return rows[0] if rows else None

    def head(self, n=None):
        rows = self.collect()
        return (rows[0] if rows else None) if n is None else rows[:n]

    def take(self, n): return self.collect()[:n]

    def isEmpty(self): return len(self._pdf) == 0

    def show(self, n=20, truncate=True):
        rows = [[("null" if _clean(v) is None else str(_clean(v))) for v in r] for r in self._pdf.head(n).itertuples(index=False, name=None)]
        cols = self.columns
        w = [_bi.max([len(c)] + [len(r[i]) for r in rows]) for i, c in enumerate(cols)]
        if truncate:
            w = [_bi.min(x, 20) for x in w]
        line = "+" + "+".join("-" * x for x in w) + "+"
        fmt = lambda vals: "|" + "|".join(str(v)[:x].rjust(x) for v, x in zip(vals, w)) + "|"
        print("\n".join([line, fmt(cols), line] + [fmt(r) for r in rows] + [line]))
        if len(self._pdf) > n:
            print(f"only showing top {n} rows")

    def printSchema(self):
        print("root")
        for c, t in self._pdf.dtypes.items():
            print(f" |-- {c}: {t}")

    def __repr__(self):
        return "DataFrame[" + ", ".join(f"{c}: {t}" for c, t in self.dtypes) + "]"


# --------------------------------------------------------------------------- session
class _Builder:
    def appName(self, *a): return self
    def master(self, *a): return self
    def config(self, *a, **k): return self
    def enableHiveSupport(self): return self
    def getOrCreate(self): return SparkSession._instance


class SparkSession:
    builder = _Builder()
    _instance = None

    def createDataFrame(self, data, schema=None):
        if isinstance(data, pd.DataFrame):
            return DataFrame(data.copy())
        data = list(data)
        names = None
        if isinstance(schema, str):
            names = [p.strip().split()[0].split(":")[0] for p in schema.split(",")]
        elif isinstance(schema, (list, tuple)):
            names = [s if isinstance(s, str) else getattr(s, "name", str(s)) for s in schema]
        elif schema is not None and hasattr(schema, "fieldNames"):
            names = list(schema.fieldNames())
        if data and isinstance(data[0], dict):
            pdf = pd.DataFrame(data)
            if names:
                pdf = pdf[names]
        elif data and isinstance(data[0], Row) and data[0].__fields__:
            pdf = pd.DataFrame([list(r) for r in data], columns=data[0].__fields__)
        else:
            pdf = pd.DataFrame([list(r) if isinstance(r, (list, tuple)) else [r] for r in data], columns=names)
        return DataFrame(pdf.astype(object).where(pdf.notna(), None) if len(pdf) else pdf)

    def stop(self): pass

    @property
    def sparkContext(self):
        _unsupported("RDDs and the SparkContext")

    def sql(self, q):
        _unsupported("spark.sql()")


SparkSession._instance = SparkSession()
spark = SparkSession._instance


# --------------------------------------------------------------------------- module wiring
def install():
    """Register this module under the pyspark import names."""
    import sys
    import types
    me = sys.modules[__name__]
    funcs = types.ModuleType("pyspark.sql.functions")
    for k in ["col", "column", "lit", "when", "sum", "avg", "mean", "min", "max", "count", "countDistinct", "count_distinct",
              "collect_list", "collect_set", "first", "last", "round", "bround", "abs", "floor", "ceil", "sqrt", "upper", "lower",
              "trim", "length", "substring", "to_date", "to_timestamp", "year", "month", "dayofmonth", "dayofweek", "hour",
              "date_add", "date_sub", "date_format", "datediff", "unix_timestamp", "concat", "concat_ws", "coalesce", "greatest",
              "least", "isnull", "desc", "asc", "expr", "udf", "row_number", "rank", "dense_rank", "percent_rank", "ntile",
              "lag", "lead"]:
        setattr(funcs, k, getattr(me, k))
    window = types.ModuleType("pyspark.sql.window")
    window.Window, window.WindowSpec = Window, WindowSpec
    sql = types.ModuleType("pyspark.sql")
    sql.SparkSession, sql.DataFrame, sql.Column, sql.Row, sql.Window = SparkSession, DataFrame, Column, Row, Window
    sql.functions, sql.window = funcs, window
    sql.types = types.ModuleType("pyspark.sql.types")
    root = types.ModuleType("pyspark")
    root.sql = sql
    sys.modules.update({"pyspark": root, "pyspark.sql": sql, "pyspark.sql.functions": funcs,
                        "pyspark.sql.window": window, "pyspark.sql.types": sql.types})
    return funcs
