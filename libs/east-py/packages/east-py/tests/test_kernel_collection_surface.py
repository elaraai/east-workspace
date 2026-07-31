#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The traced kernel surface covers the collection builtins (issue #452).

With no loop IR, the collection builtins ARE the kernel language's iteration
constructs — a missing one is not an ergonomic gap, it bounds what a single
kernel can express. The measured gap: 92 of 112 Array/Dict/Set builtins were
unreachable from a trace (no proxy method, no namespace escape hatch), so a
"row → legs → values" transform had to split into a traced pass plus an eager
pass with a materialised intermediate array and a declared intermediate type
between them.

These tests pin three things:

* every traced collection method produces the SAME result as its eager
  spelling (the methods are the same names on both surfaces);
* the shapes the issue names — the two-level flatten and the
  group/re-key/sort aggregate — are each ONE kernel now;
* the surface is a closed, visible enumeration: every name in
  ``_TRACED_SURFACE`` resolves, and an unsupported method names the
  supported set instead of failing as a struct-field access.
"""

import pytest

from east import (
    ArrayType,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    array,
    kernel,
    none,
    some,
    where,
)
from east.kernel import _TRACED_SURFACE, KernelExpr, KernelTraceError, _var

Leg = StructType([("code", StringType), ("qty", FloatType)])
Row = StructType([("id", StringType), ("csv", StringType),
                  ("legs", ArrayType(Leg))])
ROW = {"id": "r1", "csv": "b,a,c,a",
       "legs": [{"code": "XY", "qty": 2.0}, {"code": "Z", "qty": 1.0}]}


def _arr():
    """The eager twin of ``r["csv"].split(",")`` on ROW."""
    return array(StringType, ["b", "a", "c", "a"])


def _legs():
    return array(Leg, ROW["legs"])


# ── traced == eager, per method ──────────────────────────────────────────────
# Each case: (name, kernel body over ROW, the eager spelling of the same op).

CASES = [
    ("array.concat",
     lambda r: r["csv"].split(",").concat(r["csv"].split(",")),
     lambda: _arr().concat(_arr())),
    ("array.slice",
     lambda r: r["csv"].split(",").slice(1, 3),
     lambda: _arr().slice(1, 3)),
    ("array.reversed",
     lambda r: r["csv"].split(",").reversed(),
     lambda: _arr().reversed()),
    ("array.copy",
     lambda r: r["csv"].split(",").copy(),
     lambda: _arr().copy()),
    ("array.get_keys",
     lambda r: r["csv"].split(",").get_keys(array(IntegerType, [2, 0])),
     lambda: _arr().get_keys(array(IntegerType, [2, 0]))),
    ("array.filter_map",
     lambda r: r["csv"].split(",").filter_map(
         lambda p: where(p != "a", some(p + "!"), none)),
     lambda: _arr().filter_map(lambda p: some(p + "!") if p != "a" else none)),
    ("array.flatten_to_array",
     lambda r: r["legs"].flatten_to_array(lambda leg: leg["code"].split("")),
     lambda: _legs().flatten_to_array(lambda leg: array(
         StringType, list(leg["code"])))),
    ("array.flatten_to_set",
     lambda r: r["legs"].flatten_to_set(
         lambda leg: leg["code"].split("").unique()),
     lambda: _legs().flatten_to_set(lambda leg: array(
         StringType, list(leg["code"])).unique())),
    ("array.to_dict",
     lambda r: r["csv"].split(",").to_dict(
         lambda p: p, value=lambda p: p.length()),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))),
    ("array.to_dict.combine",
     lambda r: r["csv"].split(",").to_dict(
         lambda p: p, value=lambda p: p.length(), combine=lambda a, b: a + b),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p),
                            combine=lambda a, b: a + b)),
    ("array.to_set",
     lambda r: r["csv"].split(",").to_set(lambda p: p + "s"),
     lambda: _arr().to_set(lambda p: p + "s")),
    ("array.unique",
     lambda r: r["csv"].split(",").unique(),
     lambda: _arr().unique()),
    ("array.group_by",
     lambda r: r["csv"].split(",").group_by(lambda p: p),
     lambda: _arr().group_by(lambda p: p)),
    ("array.sorted",
     lambda r: r["csv"].split(",").sorted(),
     lambda: _arr().sorted()),
    ("array.sorted.key.reverse",
     lambda r: r["legs"].sorted(key=lambda leg: leg["qty"], reverse=True)
                        .map(lambda leg: leg["code"]),
     lambda: _legs().sorted(key=lambda leg: leg["qty"], reverse=True)
                    .map(lambda leg: leg["code"])),
    ("array.is_sorted",
     lambda r: r["csv"].split(",").is_sorted(),
     lambda: _arr().is_sorted()),
    ("array.map_reduce",
     lambda r: r["legs"].map_reduce(lambda leg: leg["qty"], lambda a, b: a + b),
     lambda: _legs().map_reduce(lambda leg: leg["qty"], lambda a, b: a + b)),
    ("set.map",
     lambda r: r["csv"].split(",").unique().map(lambda x: x.length()),
     lambda: _arr().unique().map(lambda x: len(x))),
    ("set.filter",
     lambda r: r["csv"].split(",").unique().filter(lambda x: x != "b"),
     lambda: _arr().unique().filter(lambda x: x != "b")),
    ("set.filter_map",
     lambda r: r["csv"].split(",").unique().filter_map(
         lambda x: where(x != "b", some(x + "!"), none)),
     # the dual-mode where/some/none spelling on the eager side too: the
     # eager Set.filter_map derives its value type from the tracer, and a
     # python `if` cannot trace
     lambda: _arr().unique().filter_map(
         lambda x: where(x != "b", some(x + "!"), none))),
    ("set.to_array",
     lambda r: r["csv"].split(",").unique().to_array(),
     lambda: _arr().unique().to_array()),
    ("set.to_dict",
     lambda r: r["csv"].split(",").unique().to_dict(
         lambda x: x, lambda x: x.length(), lambda a, b, _k: b),
     lambda: _arr().unique().to_dict(
         lambda x: x, lambda x: len(x), lambda a, b, _k: b)),
    ("set.union",
     lambda r: r["csv"].split(",").unique().union(r["id"].split("").unique()),
     lambda: _arr().unique().union(array(StringType, ["r", "1"]).unique())),
    ("set.intersect",
     lambda r: r["csv"].split(",").unique().intersect(
         r["csv"].split(",").slice(0, 2).unique()),
     lambda: _arr().unique().intersect(_arr().slice(0, 2).unique())),
    ("set.diff",
     lambda r: r["csv"].split(",").unique().diff(
         r["csv"].split(",").slice(0, 1).unique()),
     lambda: _arr().unique().diff(_arr().slice(0, 1).unique())),
    ("set.is_subset",
     lambda r: r["csv"].split(",").slice(0, 1).unique().is_subset(
         r["csv"].split(",").unique()),
     lambda: _arr().slice(0, 1).unique().is_subset(_arr().unique())),
    ("dict.map",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .map(lambda v: v * 2),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))
                   .map(lambda v: v * 2)),
    ("dict.filter",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .filter(lambda k, v: k != "b"),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))
                   .filter(lambda k, v: k != "b")),
    ("dict.filter_map",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .filter_map(lambda k, v: where(k != "b", some(v * 10), none)),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))
                   .filter_map(lambda k, v: some(v * 10) if k != "b" else none)),
    ("dict.to_array",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .to_array(lambda k, v: k),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))
                   .to_array(lambda k, v: k)),
    ("dict.to_set",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .to_set(lambda k, v: v),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))
                   .to_set(lambda k, v: v)),
    ("dict.to_dict",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .to_dict(lambda k, v: k + "x", lambda k, v: v,
                                lambda a, b, _k: b),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))
                   .to_dict(lambda k, v: k + "x", lambda k, v: v,
                            lambda a, b, _k: b)),
    ("dict.map_reduce",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .map_reduce(lambda k, v: v, lambda a, b: a + b),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p))
                   .map_reduce(lambda k, v: v, lambda a, b: a + b)),
    ("dict.keys_set",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .keys_set(),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p)).keys_set()),
    ("dict.copy",
     lambda r: r["csv"].split(",").to_dict(lambda p: p, value=lambda p: p.length())
                       .copy(),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p)).copy()),
]


@pytest.mark.parametrize(("name", "traced", "eager"),
                         CASES, ids=[c[0] for c in CASES])
def test_traced_matches_eager(name, traced, eager):
    k = kernel(Row, traced)
    assert k(ROW) == eager()


# ── the shapes the issue names ───────────────────────────────────────────────

def test_two_level_descent_is_one_kernel():
    """record → legs → per-character rows, previously a traced pass + an eager
    ``flatten_to_array`` with a declared intermediate type between them."""
    k = kernel(Row, lambda r: r["legs"].flatten_to_array(
        lambda leg: leg["code"].split("").map(
            lambda ch: {"id": r["id"], "ch": ch, "qty": leg["qty"]})))
    out = k(ROW)
    assert [(x["id"], x["ch"], x["qty"]) for x in out] == [
        ("r1", "X", 2.0), ("r1", "Y", 2.0), ("r1", "Z", 1.0)]


def test_group_rekey_sort_is_one_kernel():
    """The intake-aggregation shape: group, count, re-key with a combine, and
    sort — previously four eager passes over materialised intermediates."""
    k = kernel(Row, lambda r: r["csv"].split(",")
               .group_by(lambda p: p)
               .to_array(lambda part, hits: {"part": part, "n": hits.size()})
               .sorted(key=lambda x: x["n"], reverse=True)
               .map(lambda x: x["part"]))
    row = dict(ROW, csv="b,a,c,a,c,c")  # distinct counts: c=3, a=2, b=1
    assert list(k(row)) == ["c", "a", "b"]


def test_slice_takes_traced_bounds():
    k = kernel(Row, lambda r: r["csv"].split(",").slice(
        0, r["legs"].size()))
    assert list(k(ROW)) == ["b", "a"]


def test_dict_get_keys_with_fill():
    k = kernel(Row, lambda r: r["csv"].split(",")
               .to_dict(lambda p: p, value=lambda p: p.length())
               .get_keys(array(StringType, ["a", "zz"]).unique(), lambda _k: 0))
    d = k(ROW)
    assert dict(d.items()) == {"a": 1, "zz": 0}


# ── the surface is closed and visible ────────────────────────────────────────

def test_every_listed_method_resolves():
    """The enumeration in ``_TRACED_SURFACE`` is real: each name resolves on
    an expression of its kind (a typo in either place fails here)."""
    from east.types.types import DictType, SetType

    exprs = {
        "Array": KernelExpr(_var("a", ArrayType(StringType)), ArrayType(StringType)),
        "Set": KernelExpr(_var("s", SetType(StringType)), SetType(StringType)),
        "Dict": KernelExpr(_var("d", DictType(StringType, IntegerType)),
                           DictType(StringType, IntegerType)),
    }
    for tag, expr in exprs.items():
        for name in _TRACED_SURFACE[tag]:
            assert getattr(expr, name) is not None, f"{tag}.{name}"


def test_unsupported_method_names_the_surface():
    with pytest.raises(KernelTraceError, match="traced kernel surface.*supported.*concat"):
        kernel(Row, lambda r: r["legs"].append({"code": "Z", "qty": 0.0}))
    with pytest.raises(KernelTraceError, match="Set-typed.*union"):
        kernel(Row, lambda r: r["csv"].split(",").unique().add("x"))
    with pytest.raises(KernelTraceError, match="Dict-typed.*keys_set"):
        kernel(Row, lambda r: r["csv"].split(",")
               .to_dict(lambda p: p, value=lambda p: p).insert("x", "y"))


def test_mismatched_operand_type_is_named():
    with pytest.raises(KernelTraceError, match="operand"):
        kernel(Row, lambda r: r["csv"].split(",").concat(
            r["legs"].map(lambda leg: leg["qty"])))
