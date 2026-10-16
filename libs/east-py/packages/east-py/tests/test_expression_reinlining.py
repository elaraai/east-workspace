#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The builder emits what the body spells (#1312).

TypeScript has no trace-time pass, and since #1312 neither does python: a
python variable holding an expression names a TREE, re-emitted — and
re-evaluated — at every read, as a JS ``const`` holding an ``Expr`` is;
sharing work is spelled ``b.const`` / ``b.let`` / ``East.let``, as it is
``$.const`` in TypeScript. (The pass that bound a reused python variable to
one ``Let`` and hoisted callback invariants decided what a hoisted read could
cross by variable NAME, which East values alias through — a ``Let`` alias, a
struct field, two parameters bound to one array, a callee's parameter — so it
moved reads above mutations and answered wrong, silently.)

Each test pins one consequence: how many times a read is emitted, the answer
the lazy reading gives where a hoist once answered differently, and the one
evaluation an explicit binding buys. Emission count is the proxy for
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
    NullType,
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


def _callback_bodies(node):
    """The body of every nested Function (not the top one)."""
    top = True
    out = []
    stack = [(node, top)]
    while stack:
        n, is_top = stack.pop()
        if isinstance(n, (list, tuple, EastArray)):
            stack.extend((x, is_top) for x in n)
        elif is_east_variant(n):
            if n.type == "Function" and is_east_struct(n.value):
                if not is_top:
                    out.append(n.value["body"])
                stack.append((n.value["body"], False))
                continue
            stack.append((n.value, is_top))
        elif is_east_struct(n):
            stack.extend((v, is_top) for f, v in n.items() if f not in ("loc_id", "type"))
    return out


def _sum_loop(src):
    return East.for_(src, {"c": 0, "n": 0},
                     lambda _b, s, x: {"c": s.c + x, "n": s.n + 1})


# ── a python variable is re-emitted at every read; a binding is emitted once ─


def test_a_loop_result_held_in_a_python_variable_is_emitted_per_read():
    def unbound(_b, p):
        loop = _sum_loop(p)
        return loop.c + loop.c + loop.c

    assert _emissions(unbound, "ForArray") == 3
    assert East.function([INT_ARR], IntegerType, unbound)(EastArray(IntegerType, [1, 2, 3])) == 18


def test_east_let_and_b_const_bind_once():
    def via_let(_b, p):
        return East.let(_sum_loop(p), lambda _b, loop: loop.c + loop.c + loop.c)

    def via_const(b, p):
        loop = b.const(_sum_loop(p))
        return loop.c + loop.c + loop.c

    for fn in (via_let, via_const):
        assert _emissions(fn, "ForArray") == 1
        assert East.function([INT_ARR], IntegerType, fn)(EastArray(IntegerType, [1, 2, 3])) == 18


def test_match_and_try_catch_held_in_a_python_variable_are_emitted_per_read():
    def matched(_b, p):
        r = p.match({"some": lambda _b, v: v + 1, "none": lambda _b, _n: 0})
        return r + r

    assert _emissions(matched, "Match", [OptionType(IntegerType)]) == 2
    assert East.function([OptionType(IntegerType)], IntegerType, matched)(some(41)) == 84

    def caught(_b, p):
        r = East.try_catch(lambda _b: p.get(0), lambda _b, _m, _s: 0)
        return r + r

    assert _emissions(caught, "TryCatch") == 2
    assert East.function([INT_ARR], IntegerType, caught)(EastArray(IntegerType, [7, 8])) == 14


def test_a_derivation_read_inside_a_callback_runs_per_element_unless_bound():
    # `table` names a sort; read inside `.map`, the sort is emitted — and run
    # — once per element. Bound with b.const it runs once. (The pass used to
    # hoist the unbound form out of the callback; the `no-reinlined-east-
    # binding` rule points at the binding instead.)
    Row = StructType([("k", IntegerType), ("v", FloatType)])
    Rec = StructType([("items", ArrayType(Row))])

    def unbound(_b, rec):
        table = rec.items.sort(lambda _b, r: r.v)
        return (rec.items.slice(0, 8)
                .map(lambda _b, it: table.sum(lambda _b, d: d.v) + it.v, out=FloatType)
                .sum(lambda _b, x: x))

    def bound(b, rec):
        table = b.const(rec.items.sort(lambda _b, r: r.v))
        return (rec.items.slice(0, 8)
                .map(lambda _b, it: table.sum(lambda _b, d: d.v) + it.v, out=FloatType)
                .sum(lambda _b, x: x))

    def sorts_in_callbacks(fn):
        return sum(1 for body in _callback_bodies(trace(fn, [Rec])[0])
                   for n in _walk(body) if n.type == "Builtin" and n.value["builtin"] == "ArraySort")

    assert sorts_in_callbacks(unbound) == 1
    assert sorts_in_callbacks(bound) == 0
    rec = {"items": [{"k": i, "v": float(i % 7) - 2.0} for i in range(40)]}
    want = sum((float(i % 7) - 2.0) * 1.0 for i in range(8)) + 8 * sum(
        float(i % 7) - 2.0 for i in range(40))
    assert East.function([Rec], FloatType, unbound)(rec) == want
    assert East.function([Rec], FloatType, bound)(rec) == want


# ── the lazy reading's answers — where a hoist answered differently ─────────


def test_a_branch_guarded_partial_read_is_evaluated_on_its_path_only():
    # Every occurrence sits inside a conditional arm: a hoist would run the
    # guarded `get(0)` unconditionally and raise on the path the guard
    # excludes (#558).
    def fn(_b, d):
        loop = East.for_(d.get("k"), {"c": 0}, lambda _b, s, x: {"c": s.c + x})
        return East.if_else(d.has("k"), loop.c + loop.c, -1)

    run = East.function([DictType(StringType, INT_ARR)], IntegerType, fn)
    assert run(EastDict(StringType, INT_ARR, {})) == -1
    assert run(EastDict(StringType, INT_ARR, {"k": EastArray(IntegerType, [2, 3])})) == 10


def test_a_read_of_a_value_mutated_after_its_binding_sees_the_mutation():
    # A hoist to just past `Let(a, …)` measured BEFORE the append: 2+2.
    def fn(_b, p):
        return East.let(
            East.new_array(IntegerType, [1, 2]),
            lambda _b, a: East.block(a.push_last(99), (lambda n: n + n)(a.size())))

    assert East.function([INT_ARR], IntegerType, fn)(DATA) == 6


def test_a_shared_read_of_a_parameter_mutated_in_the_function_sees_the_mutation():
    # The parameter twin: `n` is the size where it is read, after the push.
    def fn(_b, p):
        n = p.size()
        return East.block(p.push_last(99), n + n)

    assert East.function([INT_ARR], IntegerType, fn)(EastArray(IntegerType, [1, 2])) == 6


def test_a_loop_state_read_is_the_iterations():
    # The loop's own Ref cell changes per iteration: `m` must be twice the
    # running total before the last step.
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


# ── #1312: a read is never moved above a mutation of what it reads ──────────


def test_a_callback_read_of_a_parameter_the_callback_mutates():
    # The issue's shape: `order` is a PARAMETER, and the pass hoisted the
    # read to the head of the function, above the push the callback runs
    # first — the index came out as -1. Nothing binds here now.
    types = [DictType(StringType, IntegerType), ArrayType(StringType), StringType]

    def slot(_b, index, order, key):
        def fresh(b, _k):
            b.do(order.push_last(key))
            return order.size() - 1

        return index.get_or_insert(key, fresh)

    assert _emissions(slot, "Let", types) == 0
    index, order = EastDict(StringType, IntegerType), EastArray(StringType)
    run = East.function(types, IntegerType, slot)
    assert [run(index, order, k) for k in ["A", "B", "A", "C"]] == [0, 1, 0, 2]


def test_a_call_mutates_what_its_callee_mutates_through_a_parameter():
    # A built function called inside another embeds as its Function node
    # (#1271), whose push is of ITS parameter: through the call it is a push
    # of the caller's `seen`, read after the call per element.
    @East.function([ArrayType(IntegerType), IntegerType], NullType)
    def push(b, xs, x):
        b.do(xs.push_last(x))

    def sizes_after(_b, p):
        return East.let(East.new_array(IntegerType), lambda _b, seen:
                        p.map(lambda _b, x: East.block(push(seen, x), seen.size())))

    def pushes_per_element(_b, p):
        return East.let(East.new_array(IntegerType), lambda _b, seen:
                        p.map(lambda _b, _x: East.block(push(seen, 1), seen.size())))

    data = EastArray(IntegerType, [7, 8, 9])
    assert list(East.function([INT_ARR], INT_ARR, sizes_after)(data)) == [1, 2, 3]
    assert list(East.function([INT_ARR], INT_ARR, pushes_per_element)(data)) == [1, 2, 3]


def test_an_alias_of_a_mutated_array_reads_its_current_size():
    # The shapes no name-based rule could see: an alias through a Let, through
    # a struct field, and two parameters bound to one array at run time.
    Holder = StructType([("xs", INT_ARR)])

    @East.function([INT_ARR], INT_ARR)
    def through_let(b, xs):
        a = b.const(xs)
        b.do(xs.push_last(1))
        return xs.map(lambda _b, x: x + a.size())

    @East.function([INT_ARR], INT_ARR)
    def through_field(b, xs):
        s = b.const({"xs": xs}, Holder)
        b.do(xs.push_last(1))
        return xs.map(lambda _b, x: x + s.xs.size())

    @East.function([INT_ARR, INT_ARR], INT_ARR)
    def through_parameters(b, xs, ys):
        b.do(xs.push_last(1))
        return xs.map(lambda _b, x: x + ys.size())

    @East.function([INT_ARR], IntegerType)
    def shared_through_let(b, xs):
        a = b.const(xs)
        n = a.size()
        b.do(xs.push_last(1))
        return n + n

    assert list(through_let(EastArray(IntegerType, [10, 20]))) == [13, 23, 4]
    assert list(through_field(EastArray(IntegerType, [10, 20]))) == [13, 23, 4]
    both = EastArray(IntegerType, [10, 20])
    assert list(through_parameters(both, both)) == [13, 23, 4]
    assert shared_through_let(EastArray(IntegerType, [10, 20])) == 6
