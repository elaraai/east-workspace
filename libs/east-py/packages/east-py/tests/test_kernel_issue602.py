#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Issue #602 — the loop-invariant hoist reaches COLLECTION-METHOD callbacks.

#595 hoisted a derived value read MORE THAN ONCE (the identity CSE needs two
references). A value derived outside a ``.map``/``.filter`` callback and read
once INSIDE it had exactly one reference, so it re-emitted into the
per-element body and re-ran per element — with every counter at zero, because
each run was native. Now a single-occurrence subtree inside a callback body
hoists too, when it provably cannot tell the difference: no rebound name, no
effect, no mutable value escaping anywhere but a read.

The pins are structural (where the expensive node lands in the IR), plus
bit-identity between the bound and unbound spellings — a hoist that changed
evaluation order would matter for order-dependent float folds.
"""

from east import (
    ArrayType,
    East,
    EastArray,
    FloatType,
    IntegerType,
    StructType,
)
from east.expression import trace
from east.types.values import is_east_struct, is_east_variant

RowT = StructType([("k", IntegerType), ("v", FloatType)])
Rec = StructType([("items", ArrayType(RowT))])
INT_ARR = ArrayType(IntegerType)


def _count_kinds(node, acc=None):
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


def _callback_bodies(node, out=None, top=True):
    """Every non-kernel Function body in the finalized IR."""
    if out is None:
        out = []
    if isinstance(node, (list, tuple, EastArray)):
        for x in node:
            _callback_bodies(x, out, top)
    elif is_east_variant(node):
        payload = node.value
        if node.type == "Function" and is_east_struct(payload):
            if top:
                _callback_bodies(payload["body"], out, False)
            else:
                out.append(payload["body"])
                _callback_bodies(payload["body"], out, False)
            return out
        if is_east_struct(payload):
            for field, value in payload.items():
                if field not in ("loc_id", "type"):
                    _callback_bodies(value, out, top)
    elif is_east_struct(node):
        for field, value in node.items():
            if field not in ("loc_id", "type"):
                _callback_bodies(value, out, top)
    return out


def _table(rec):
    return (rec["items"]
            .map(lambda r: {"k": r["k"], "v": r["v"] * 1.5}, out=RowT)
            .filter(lambda r: r["v"] >= 0.0)
            .sorted(key=lambda r: r["v"]))


def _unbound(rec):
    table = _table(rec)                          # a python NAME, read once
    return (rec["items"].slice(0, 8)
            .map(lambda it: table.sum(lambda d: d["v"]) + it["v"], out=FloatType)
            .sum(lambda x: x))


def _bound(rec):
    return East.let(_table(rec), lambda table: rec["items"].slice(0, 8)
                    .map(lambda it: table.sum(lambda d: d["v"]) + it["v"],
                         out=FloatType)
                    .sum(lambda x: x))


REC = {"items": [{"k": i, "v": float(i % 7) - 2.0} for i in range(40)]}


# ── the regression: the issue's exact shape ─────────────────────────────────


def test_the_derivation_leaves_the_per_element_body():
    ir = trace(_unbound, [Rec])[0]
    assert _count_kinds(ir).get("Let", 0) >= 1
    # The sort must not sit inside ANY callback body — hoisted, it runs once.
    for body in _callback_bodies(ir):
        assert _count_kinds(body).get("Builtin", 0) == 0 or \
            "ArraySort" not in _builtin_names(body)


def _builtin_names(node, out=None):
    if out is None:
        out = set()
    if isinstance(node, (list, tuple, EastArray)):
        for x in node:
            _builtin_names(x, out)
    elif is_east_variant(node):
        if node.type == "Builtin":
            out.add(node.value["builtin"])
        _builtin_names(node.value, out)
    elif is_east_struct(node):
        for field, value in node.items():
            if field not in ("loc_id", "type"):
                _builtin_names(value, out)
    return out


def test_bound_and_unbound_spellings_stay_bit_identical():
    assert East.function([Rec], FloatType, _unbound)(REC) == East.function([Rec], FloatType, _bound)(REC)


def test_a_derived_lookup_read_per_element_hoists():
    # The "derive a lookup, then use it while iterating" shape — the
    # container is Dict-typed but its single consumer is a READ, so it is
    # safe to share one instance.
    def fn(rec):
        lookup = rec["items"].to_dict(key=lambda r: r["k"], value=lambda r: r["v"])
        return (rec["items"]
                .map(lambda it: lookup.get(it["k"]) * 2.0, out=FloatType)
                .sum(lambda x: x))

    ir = trace(fn, [Rec])[0]
    for body in _callback_bodies(ir):
        assert "ArrayToDict" not in _builtin_names(body)
    got = East.function([Rec], FloatType, fn)(REC)
    want = sum((float(i % 7) - 2.0) * 2.0 for i in range(40))
    assert got == want


# ── the refusals that keep it honest ────────────────────────────────────────


def test_an_element_dependent_read_stays_in_the_body():
    def fn(rec):
        return (rec["items"]
                .map(lambda it: it["v"] * 1.5, out=FloatType)
                .sum(lambda x: x))

    ir = trace(fn, [Rec])[0]
    bodies = _callback_bodies(ir)
    assert any("FloatMultiply" in _builtin_names(b) for b in bodies)
    assert East.function([Rec], FloatType, fn)(REC) == sum((float(i % 7) - 2.0) * 1.5 for i in range(40))


def test_a_fresh_container_per_element_is_not_shared():
    # The callback returns a NEW array per element; hoisting would alias one
    # instance across every element. The mutable-escape refusal keeps it in
    # the body, and appending downstream must see independent arrays.
    def fn(p):
        return East.let(
            p.map(lambda x: East.new_array(IntegerType, [x]),
                  out=ArrayType(IntegerType)),
            lambda rows: East.block(
                rows.get(0).append(99),
                rows.get(1).size(),
            ))

    got = East.function([INT_ARR], IntegerType, fn)(EastArray(IntegerType, [7, 8]))
    assert got == 1        # aliased, row 1 would have grown to 2


def test_a_guarded_partial_read_in_a_branch_still_refuses():
    # #558 A unchanged: every occurrence branch-guarded means no hoist even
    # though the node now has a callback-independent path to eligibility.
    def fn(p):
        return East.let(
            p.filter(lambda e: e > 100),
            lambda a: East.if_else(a.size() > 0, a.get(0) + 1, -1))

    assert East.function([INT_ARR], IntegerType, fn)(EastArray(IntegerType, [1, 2])) == -1


def test_an_invariant_inside_a_loop_body_stays_per_iteration():
    # Loop bodies are conditional contexts (may run zero times); the solo
    # hoist must not lift a partial read out of one.
    def fn(p):
        return East.for_(
            p, {"acc": 0},
            lambda s, x: {"acc": s.acc + East.if_else(p.size() > 0, p.get(0), 0)},
        ).acc

    assert East.function([INT_ARR], IntegerType, fn)(EastArray(IntegerType, [5, 3])) == 10
