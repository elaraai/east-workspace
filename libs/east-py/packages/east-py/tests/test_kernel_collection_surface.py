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


# ── traced == eager: the py-native signature sugar only ─────────────────────
# Rows that were 1:1 builtin equivalences are now covered corpus-wide by
# tests/test_compliance_eager.py (all three modes, exact-pinned) — #474
# cleanup pass 2. What remains pins the PYTHON-side signature surface the
# corpus cannot express: kwargs and defaults (sorted(key=, reverse=),
# to_dict's 2-arg combine), the narrowed get_keys, and the flagship shapes.

CASES = [
    ("array.get_keys",
     lambda r: r["csv"].split(",").get_keys(array(IntegerType, [2, 0])),
     lambda: _arr().get_keys(array(IntegerType, [2, 0]))),
    ("array.to_dict.combine",
     lambda r: r["csv"].split(",").to_dict(
         lambda p: p, value=lambda p: p.length(), combine=lambda a, b: a + b),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: len(p),
                            combine=lambda a, b: a + b)),
    ("array.sorted.key.reverse",
     lambda r: r["legs"].sorted(key=lambda leg: leg["qty"], reverse=True)
                        .map(lambda leg: leg["code"]),
     lambda: _legs().sorted(key=lambda leg: leg["qty"], reverse=True)
                    .map(lambda leg: leg["code"])),
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
    # NB the csv is "b,a,c,a", so "a" is a DUPLICATE key. This test is about
    # get_keys + fill, so resolve the collision explicitly rather than relying
    # on a default — the traced default used to be "later value wins" while the
    # eager path and TS both raise, and this test was silently encoding that
    # divergence (#525).
    k = kernel(Row, lambda r: r["csv"].split(",")
               .to_dict(lambda p: p, value=lambda p: p.length(),
                        combine=lambda a, _b: a)
               .get_keys(array(StringType, ["a", "zz"]).unique(), lambda _k: 0))
    d = k(ROW)
    assert dict(d.items()) == {"a": 1, "zz": 0}


def test_to_dict_duplicate_key_errors_like_eager_and_ts():
    """No combine + a duplicate key = an ERROR, on every runtime.

    The traced default was a "second value wins" function, so a kernel silently
    DROPPED rows where the eager method and TypeScript both raise
    `Cannot insert duplicate key … into dict`. Losing data without a word is
    the worse failure mode, and it made the two paths disagree on the same
    input — which is the whole thing this surface exists to prevent.
    """
    from east.runtime.errors import EastError

    parts = array(StringType, ["b", "a", "c", "a"])
    t = ArrayType(StringType)
    with pytest.raises(EastError, match="Cannot insert duplicate key"):
        parts.to_dict(lambda p: p, value=lambda p: len(p))
    with pytest.raises(EastError, match="Cannot insert duplicate key"):
        kernel(t, lambda a: a.to_dict(lambda p: p, value=lambda p: p.length()))(parts)
    # ...and the message names the offending key, as eager and TS do
    with pytest.raises(EastError, match='duplicate key "?a"? into dict'):
        kernel(t, lambda a: a.to_dict(lambda p: p, value=lambda p: p.length()))(parts)
    # with a combine, both paths agree on the resolved value
    got = kernel(t, lambda a: a.to_dict(lambda p: p, value=lambda p: p.length(),
                                        combine=lambda x, y: x + y))(parts)
    want = parts.to_dict(lambda p: p, value=lambda p: len(p), combine=lambda x, y: x + y)
    assert dict(got.items()) == dict(want.items())

    # a 3-argument combine is a supported EAGER call, so it must trace too
    got3 = kernel(t, lambda a: a.to_dict(lambda p: p, value=lambda p: p.length(),
                                         combine=lambda x, y, _k: x + y))(parts)
    assert dict(got3.items()) == dict(want.items())


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


def test_skill_documents_the_exact_traced_surface():
    """SKILL.md's three enumeration bullets must EQUAL ``_TRACED_SURFACE`` —
    the docs are the enumeration people can trust, so drift in either
    direction fails here (#452's docs mandate, held by CI)."""
    import re
    from pathlib import Path

    skill = (Path(__file__).parent.parent / "SKILL.md").read_text(encoding="utf-8")
    for tag in ("Array", "Set", "Dict"):
        m = re.search(rf"- \*\*{tag}\*\*: (.*?)(?=\n   - \*\*|\n\n)", skill, re.S)
        assert m, f"SKILL.md lost the {tag} traced-surface bullet"
        listed = set(re.findall(r"`([a-z_]+)`", m.group(1)))
        assert listed == set(_TRACED_SURFACE[tag]), (
            f"{tag}: missing from SKILL {sorted(set(_TRACED_SURFACE[tag]) - listed)}; "
            f"stale in SKILL {sorted(listed - set(_TRACED_SURFACE[tag]))}")
