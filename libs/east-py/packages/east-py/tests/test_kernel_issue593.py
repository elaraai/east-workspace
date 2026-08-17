#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Issue #593 — trace-time CSE covers the BINDER forms, not just Function/Block.

A node that binds names over part of itself must say so, or ``_finalize_ir``'s
free-variable walk reports those names FREE, ``fv <= param_names`` fails, and
the node is refused a hoist: it re-emits — and re-RUNS — at every use site.
``East.for_`` lowers to ``Block[Let(cell), For…, RefGet(cell)]`` whose loop
variables are fresh names, so a loop result held in a plain python name cost
one full execution PER REFERENCE, and O(n x loop) once a read sat inside a
map/filter. Nothing diagnosed it: every run is native, so no ``eager_stats``
counter moved, and the answer stayed correct because ``East.new_*`` yields a
fresh collection per evaluation — a silent 880x.

The same trap covered ``match`` and ``try_catch``. A bare ``while_`` binds
nothing and always hoisted; it broke only when it CONTAINED a ``for_``, whose
loop variables leaked out through it. ``free_vars`` now agrees with
``binder_names`` on all four forms.

Emission count is the deterministic proxy for execution count — each emitted
copy is a separate run — so these assert the traced IR holds ONE loop and that
the unbound spelling now matches ``East.let`` node for node and answer for
answer. The last class pins the soundness filters that must keep REFUSING a
hoist (#558 A).
"""

from east import (
    ArrayType,
    DictType,
    East,
    EastArray,
    EastDict,
    EastSet,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    kernel,
    some,
)
from east.kernel import trace
from east.types.values import is_east_struct, is_east_variant

INT_ARR = ArrayType(IntegerType)
INT_SET = SetType(IntegerType)
STR_INT_DICT = DictType(StringType, IntegerType)
OPT_INT = OptionType(IntegerType)


def _count_kinds(node, acc=None):
    """Every IR node kind in a traced tree, by occurrence — a node emitted
    twice IS executed twice, so this counts runs without timing anything."""
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
            if field != "loc_id":
                _count_kinds(value, acc)
    return acc


def _emissions(fn, param_types, kind):
    return _count_kinds(trace(fn, list(param_types))[0]).get(kind, 0)


def _assert_shared_once(build, use, param_types, kind, data):
    """The unbound spelling must emit — and answer — exactly like ``East.let``.

    ``build(param)`` is the expression to share; ``use(param, shared)`` reads
    it more than once.
    """
    unbound = _emissions(lambda p: use(p, build(p)), param_types, kind)
    bound = _emissions(lambda p: East.let(build(p), lambda r: use(p, r)),
                       param_types, kind)
    assert unbound == bound, (
        f"{kind} emitted {unbound}x unbound vs {bound}x under East.let — "
        "the shared result is re-evaluated per reference")
    assert kernel(list(param_types), lambda p: use(p, build(p)))(data) == \
        kernel(list(param_types), lambda p: East.let(build(p),
                                                     lambda r: use(p, r)))(data)


def _sum_loop(p):
    return East.for_(p, {"c": 0}, lambda s, x: {"c": s.c + x})


def _twice(_p, r):
    return r.c + r.c


# ── the regression: a control-flow result shared by a python name ───────────


class TestControlFlowResultBindsOnce:
    def test_for_over_an_array(self):
        _assert_shared_once(_sum_loop, _twice, [INT_ARR], "ForArray",
                            EastArray(IntegerType, [1, 2, 3]))

    def test_for_over_a_set(self):
        _assert_shared_once(_sum_loop, _twice, [INT_SET], "ForSet",
                            EastSet(IntegerType, [1, 2, 3]))

    def test_for_over_a_dict(self):
        _assert_shared_once(
            lambda p: East.for_(p, {"c": 0}, lambda s, k, v: {"c": s.c + v}),
            _twice, [STR_INT_DICT], "ForDict",
            EastDict(StringType, IntegerType, {"a": 1, "b": 2}))

    def test_while_wrapping_a_nested_for(self):
        # The issue's own shape: the INNER for_'s loop variables leaking out
        # are what made the enclosing While un-hoistable.
        _assert_shared_once(
            lambda p: East.while_(
                {"i": 0, "c": 0}, cond=lambda w: w.i < 1,
                body=lambda w: East.let(
                    East.for_(p, {"c": w.c}, lambda s, x: {"c": s.c + x}),
                    lambda inner: {"i": w.i + 1, "c": inner.c})),
            _twice, [INT_ARR], "While", EastArray(IntegerType, [1, 2, 3]))

    def test_a_for_nested_in_a_for(self):
        # The defect compounded with depth — 4 loops emitted for 2 reads.
        _assert_shared_once(
            lambda p: East.for_(p, {"c": 0}, lambda s, x: East.let(
                East.for_(p, {"c": s.c}, lambda t, y: {"c": t.c + y}),
                lambda inner: inner)),
            _twice, [INT_ARR], "ForArray", EastArray(IntegerType, [1, 2, 3]))

    def test_a_loop_read_inside_a_callback_binds_once(self):
        # The O(n x loop) case: with the read inside a filter, a re-emitted
        # loop runs once PER ELEMENT.
        _assert_shared_once(
            _sum_loop,
            lambda p, r: p.filter(lambda e: e < r.c).size() + r.c,
            [INT_ARR], "ForArray", EastArray(IntegerType, [1, 2, 3]))


# ── the same trap in the other binder forms ─────────────────────────────────


class TestOtherBinderForms:
    def test_match_result(self):
        _assert_shared_once(
            lambda p: p.match({"some": lambda v: v + 1, "none": lambda _n: 0}),
            lambda _p, r: r + r, [OPT_INT], "Match", some(41))

    def test_try_catch_result(self):
        _assert_shared_once(
            lambda p: East.try_catch(lambda: p.get(0), lambda _m, _s: 0),
            lambda _p, r: r + r, [INT_ARR], "TryCatch",
            EastArray(IntegerType, [7, 8]))


# ── the soundness filters must keep refusing ────────────────────────────────


class TestHoistStillRefusedWhereItMustBe:
    def test_a_branch_guarded_loop_does_not_hoist(self):
        # #558 A: every occurrence sits inside a conditional arm, so hoisting
        # would run the guarded PARTIAL read unconditionally and raise on the
        # very path the guard excludes. Making loops hoistable must not reach
        # this one.
        def fn(d):
            loop = East.for_(d.get("k"), {"c": 0}, lambda s, x: {"c": s.c + x})
            return East.if_else(d.has("k"), loop.c + loop.c, -1)

        run = kernel([DictType(StringType, INT_ARR)], fn)
        assert run(EastDict(StringType, INT_ARR, {})) == -1
        assert run(EastDict(StringType, INT_ARR,
                            {"k": EastArray(IntegerType, [2, 3])})) == 10

    def test_a_loop_mutating_a_captured_collection_does_not_hoist(self):
        # `mutated_free` still blocks it: the effect must happen where the
        # trace put it, not once at the top of the kernel.
        def fn(p):
            loop = East.for_(p, {"c": 0},
                             lambda s, x: East.block(p.append(x), {"c": s.c + 1}))
            return loop.c + loop.c

        assert _emissions(fn, [INT_ARR], "ForArray") == 2

    def test_the_answer_is_unchanged_by_hoisting(self):
        # The trap was purely a performance one — a re-run loop still answered
        # correctly, so the fix must not move any result.
        def fn(p):
            loop = East.for_(p, {"c": 0, "n": 0},
                             lambda s, x: {"c": s.c + x, "n": s.n + 1})
            return loop.c * loop.n

        assert kernel([INT_ARR], fn)(EastArray(IntegerType, [2, 3, 4])) == 9 * 3


class TestCseStillCoversPlainExpressions:
    def test_a_shared_ordinary_subexpression_still_binds_once(self):
        # The #411 behaviour the binder work must not disturb. CSE is by
        # IDENTITY, so it is one reused expression that dedupes — calling
        # `.sum()` twice builds two nodes and correctly stays two.
        def shared(p):
            total = p.sum()
            return total + total

        assert _count_kinds(trace(shared, [INT_ARR])[0]).get("Let", 0) >= 1
        assert kernel([INT_ARR], shared)(EastArray(IntegerType, [1, 2, 3])) == 12


def test_three_reads_of_one_loop_cost_one_execution():
    # The rule the issue asks to be discoverable, exercised: k reads of one
    # loop expression now cost ONE run, not k.
    def unbound(p):
        loop = _sum_loop(p)
        return loop.c + loop.c + loop.c

    assert _emissions(unbound, [INT_ARR], "ForArray") == 1
    assert kernel([INT_ARR], unbound)(EastArray(IntegerType, [1, 2, 3])) == 18
