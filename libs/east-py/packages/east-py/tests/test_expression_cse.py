#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The trace-time CSE — a python-only pass, pinned by rule (#593/#595/#602/#603).

TypeScript has no trace-time common-subexpression pass: a python body that
holds an expression in a NAME and reads it twice would otherwise emit — and
execute — it twice. Each test here names one rule of the pass: a shared
result binds once (whichever binder form built it), it binds at the innermost
Block whose bindings it needs, a derivation read once inside a callback
hoists out of the per-element body, and the soundness filters keep refusing
where a hoist would change the answer. Emission count is the proxy for
execution count (each emitted copy is a separate run).
"""

from __future__ import annotations

from east import (
    ArrayType,
    DictType,
    East,
    EastArray,
    EastDict,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    coerce_to,
    some,
)
from east.expression import trace
from east.types.values import is_east_struct, is_east_variant

INT_ARR = ArrayType(IntegerType)
DATA = EastArray(IntegerType, [5, 3, 9, 1, 7])


def _count_kinds(node, acc=None):
    """Every IR node kind by occurrence — a node emitted twice runs twice."""
    if acc is None:
        acc = {}
    if isinstance(node, (list, tuple, EastArray)):
        for x in node:
            _count_kinds(x, acc)
    elif is_east_variant(node):
        acc[node.type] = acc.get(node.type, 0) + 1
        _count_kinds(node.value, acc)
    elif is_east_struct(node):
        for field, value in node.items():
            if field not in ("loc_id", "type"):
                _count_kinds(value, acc)
    return acc


def _emissions(fn, kind, param_types=(INT_ARR,)):
    return _count_kinds(trace(fn, list(param_types))[0]).get(kind, 0)


def _sum_loop(src):
    return East.for_(src, {"c": 0, "n": 0},
                     lambda _b, s, x: {"c": s.c + x, "n": s.n + 1})


# ── a shared result binds once, whichever binder form built it ──────────────


def test_a_loop_result_held_in_a_name_binds_once():
    def unbound(_b, p):
        loop = _sum_loop(p)
        return loop.c + loop.c + loop.c

    assert _emissions(unbound, "ForArray") == 1
    assert East.function([INT_ARR], IntegerType, unbound)(EastArray(IntegerType, [1, 2, 3])) == 18


def test_match_and_try_catch_results_bind_once():
    def matched(_b, p):
        r = p.match({"some": lambda _b, v: v + 1, "none": lambda _b, _n: 0})
        return r + r

    assert _emissions(matched, "Match", [OptionType(IntegerType)]) == 1
    assert East.function([OptionType(IntegerType)], IntegerType, matched)(some(41)) == 84

    def caught(_b, p):
        r = East.try_catch(lambda _b: p.get(0), lambda _b, _m, _s: 0)
        return r + r

    assert _emissions(caught, "TryCatch") == 1
    assert East.function([INT_ARR], IntegerType, caught)(EastArray(IntegerType, [7, 8])) == 14


# ── the hoist site is the innermost Block binding what the node needs ───────


def test_a_loop_under_an_enclosing_let_binds_once():
    def fn(_b, p):
        return East.let(p.filter(lambda _b, e: e > 2),
                        lambda _b, a: (lambda r: r.c + r.n)(_sum_loop(a)))

    assert _emissions(fn, "ForArray") == 1
    assert East.function([INT_ARR], IntegerType, fn)(DATA) == 24 + 4


def test_a_derivation_read_once_inside_a_callback_hoists_out_of_it():
    Row = StructType([("k", IntegerType), ("v", FloatType)])
    Rec = StructType([("items", ArrayType(Row))])

    def fn(_b, rec):
        table = rec.items.sorted(key=lambda _b, r: r.v)   # a NAME, read once, inside .map
        return (rec.items.slice(0, 8)
                .map(lambda _b, it: table.sum(lambda _b, d: d.v) + it.v, out=FloatType)
                .sum(lambda _b, x: x))

    ir = trace(fn, [Rec])[0]

    def bodies(node, out, top=True):
        if isinstance(node, (list, tuple, EastArray)):
            for x in node:
                bodies(x, out, top)
        elif is_east_variant(node):
            if node.type == "Function" and is_east_struct(node.value):
                if not top:
                    out.append(node.value["body"])
                bodies(node.value["body"], out, False)
                return out
            if is_east_struct(node.value):
                for field, value in node.value.items():
                    if field not in ("loc_id", "type"):
                        bodies(value, out, top)
        elif is_east_struct(node):
            for field, value in node.items():
                if field not in ("loc_id", "type"):
                    bodies(value, out, top)
        return out

    for body in bodies(ir, []):
        assert "ArraySort" not in set(_count_kinds(body)) and \
            not any(n.type == "Builtin" and n.value["builtin"] == "ArraySort"
                    for n in _walk(body))
    rec = {"items": [{"k": i, "v": float(i % 7) - 2.0} for i in range(40)]}
    got = East.function([Rec], FloatType, fn)(rec)
    want = sum((float(i % 7) - 2.0) * 1.0 for i in range(8)) + 8 * sum(
        float(i % 7) - 2.0 for i in range(40))
    assert got == want


def _walk(node):
    stack = [node]
    while stack:
        n = stack.pop()
        if isinstance(n, (list, tuple, EastArray)):
            stack.extend(n)
        elif is_east_variant(n):
            yield n
            stack.append(n.value)
        elif is_east_struct(n):
            stack.extend(v for f, v in n.items() if f not in ("loc_id", "type"))


# ── the soundness filters keep refusing ─────────────────────────────────────


def test_a_branch_guarded_partial_read_is_not_hoisted():
    # Every occurrence sits inside a conditional arm: hoisting would run the
    # guarded `get(0)` unconditionally and raise on the very path the guard
    # excludes.
    def fn(_b, d):
        loop = East.for_(d.get("k"), {"c": 0}, lambda _b, s, x: {"c": s.c + x})
        return East.if_else(d.has("k"), loop.c + loop.c, -1)

    run = East.function([DictType(StringType, INT_ARR)], IntegerType, fn)
    assert run(EastDict(StringType, INT_ARR, {})) == -1
    assert run(EastDict(StringType, INT_ARR, {"k": EastArray(IntegerType, [2, 3])})) == 10


def test_a_read_of_a_value_mutated_after_its_binding_is_not_hoisted():
    # Hoisting the size reads to just past `Let(a, …)` would measure BEFORE
    # the append: 2+2 instead of 3+3.
    def fn(_b, p):
        return East.let(
            East.new_array(IntegerType, [1, 2]),
            lambda _b, a: East.block(a.append(99), (lambda n: n + n)(a.size())))

    assert East.function([INT_ARR], IntegerType, fn)(DATA) == 6


def test_a_loop_state_read_never_leaves_its_loop():
    # The loop's own Ref cell looks like a good anchor but changes per
    # iteration: `m` must be twice the running total before the last step.
    def fn(_b, p):
        return East.for_(p, {"c": 0, "m": 0},
                         lambda _b, s, x: {"c": s.c + x, "m": s.c + s.c}).m

    assert East.function([INT_ARR], IntegerType, fn)(DATA) == 36


def test_nested_match_arms_keep_the_outer_binding():
    # Arm variables are trace-unique: an inner arm reading the OUTER payload
    # must see it, not the inner payload rebound under the same name.
    Inner = StructType([("inner_only", StringType), ("label", StringType)])
    Outer = StructType([("label", OptionType(StringType)), ("plain", StringType),
                        ("nested", OptionType(Inner))])
    T = OptionType(Outer)
    val = coerce_to(some({"label": some("OUTER-LABEL"), "plain": "OUTER-PLAIN",
                          "nested": some({"inner_only": "I", "label": "INNER-LABEL"})}), T)

    def fn(_b, x):
        return x.match({"none": lambda _b, _n: "NO-OUTER", "some": lambda _b, o:
            o.nested.match({"none": lambda _b, _m: "NO-INNER",
                            "some": lambda _b, i: o.label.unwrap_or(i.label)})})

    assert East.function([T], StringType, fn)(val) == "OUTER-LABEL"
