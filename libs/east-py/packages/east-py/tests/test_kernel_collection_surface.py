#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The traced kernel surface covers the collection builtins (issue #452).

A missing collection builtin is not an ergonomic gap, it bounds what a single
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
    DictType,
    East,
    FloatType,
    IntegerType,
    SetType,
    StringType,
    StructType,
    array,
)
from east.expression import _TRACED_SURFACE, ExpressionError

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
    ("array.get_keys", ArrayType(StringType),
     lambda r: r["csv"].split(",").get_keys(array(IntegerType, [2, 0])),
     lambda: _arr().get_keys(array(IntegerType, [2, 0]))),
    ("array.to_dict.combine", DictType(StringType, IntegerType),
     lambda r: r["csv"].split(",").to_dict(
         lambda p: p, value=lambda p: p.length(), combine=lambda a, b: a + b),
     lambda: _arr().to_dict(lambda p: p, value=lambda p: p.length(),
                            combine=lambda a, b: a + b)),
    ("array.sorted.key.reverse", ArrayType(StringType),
     lambda r: r["legs"].sorted(key=lambda leg: leg["qty"], reverse=True)
                        .map(lambda leg: leg["code"]),
     lambda: _legs().sorted(key=lambda leg: leg["qty"], reverse=True)
                    .map(lambda leg: leg["code"])),
]


# ── the shapes the issue names ───────────────────────────────────────────────


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
        parts.to_dict(lambda p: p, value=lambda p: p.length())
    with pytest.raises(EastError, match="Cannot insert duplicate key"):
        East.function([t], DictType(StringType, IntegerType), lambda a: a.to_dict(lambda p: p, value=lambda p: p.length()))(parts)
    # ...and the message names the offending key, as eager and TS do
    with pytest.raises(EastError, match='duplicate key "?a"? into dict'):
        East.function([t], DictType(StringType, IntegerType), lambda a: a.to_dict(lambda p: p, value=lambda p: p.length()))(parts)
    # with a combine, both paths agree on the resolved value
    got = East.function([t], DictType(StringType, IntegerType), lambda a: a.to_dict(lambda p: p, value=lambda p: p.length(),
                                        combine=lambda x, y: x + y))(parts)
    want = parts.to_dict(lambda p: p, value=lambda p: p.length(),
                         combine=lambda x, y: x + y)
    assert dict(got.items()) == dict(want.items())

    # a 3-argument combine is a supported EAGER call, so it must trace too
    got3 = East.function([t], DictType(StringType, IntegerType), lambda a: a.to_dict(lambda p: p, value=lambda p: p.length(),
                                         combine=lambda x, y, _k: x + y))(parts)
    assert dict(got3.items()) == dict(want.items())


# ── the surface is closed and visible ────────────────────────────────────────


def test_unsupported_method_names_the_surface():
    # `append`/`insert` (#578) and `pop` (#627) are ON the surface — these are
    # names that still are not, so the enumeration keeps being the thing that
    # answers.
    with pytest.raises(ExpressionError, match="traced kernel surface.*supported.*concat"):
        East.function([Row], ArrayType(Leg), lambda r: r["legs"].shuffle())
    with pytest.raises(ExpressionError, match="Set-typed.*union"):
        East.function([Row], SetType(StringType),
                      lambda r: r["csv"].split(",").unique().add("x"))
    with pytest.raises(ExpressionError, match="Dict-typed.*keys_set"):
        East.function([Row], DictType(StringType, StringType), lambda r: r["csv"].split(",")
                      .to_dict(lambda p: p, value=lambda p: p).shuffle())


def test_mismatched_operand_type_is_named():
    with pytest.raises(ExpressionError, match="operand"):
        East.function([Row], ArrayType(StringType), lambda r: r["csv"].split(",").concat(
            r["legs"].map(lambda leg: leg["qty"])))


def test_skill_documents_the_exact_traced_surface():
    """SKILL.md's three enumeration bullets must EQUAL ``_TRACED_SURFACE`` —
    the docs are the enumeration people can trust, so drift in either
    direction fails here (#452's docs mandate, held by CI)."""
    import re
    from pathlib import Path

    skill = (Path(__file__).parent.parent / "SKILL.md").read_text(encoding="utf-8")
    for tag in ("Array", "Set", "Dict", "Vector", "Matrix"):
        m = re.search(rf"- \*\*{tag}\*\*(?: \(.*?\))?: (.*?)(?=\n   - \*\*|\n\n)", skill, re.S)
        assert m, f"SKILL.md lost the {tag} traced-surface bullet"
        listed = set(re.findall(r"`([a-z_]+)`", m.group(1)))
        assert listed == set(_TRACED_SURFACE[tag]), (
            f"{tag}: missing from SKILL {sorted(set(_TRACED_SURFACE[tag]) - listed)}; "
            f"stale in SKILL {sorted(listed - set(_TRACED_SURFACE[tag]))}")
