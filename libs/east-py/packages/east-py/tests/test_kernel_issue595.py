#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Issue #595 — a hoisted Let lands where its free variables are in scope.

#594 taught the CSE about binder forms, but the hoist SITE was still the one
place a Let could go: the head of the kernel body. That site can only see the
kernel's own parameters, so `fv <= param_names` refused anything else — and
the natural way to write a traced algorithm binds its derived inputs first:

    East.let(derive(param), lambda a: <loop over a, read more than once>)

That loop's free `a` is bound by an enclosing Block, not by a parameter, so it
re-emitted (and re-RAN) per reference exactly as before #594 — quadratic once a
read sat inside a filter, and as silent as ever.

Each hoistable node now gets its own site: the innermost enclosing Block that
binds every name it needs, just past the last of those bindings. Every
occurrence is already inside that Block — it references the name the Block
binds — so no separate containment check is needed.

The anchor must not be MUTATED inside that Block, which is what keeps the
hoist honest: `East.block(a.append(x), <reads of a>)` would otherwise capture
the value from before the append, and a loop's own Ref cell — updated once per
iteration by the very loop whose Block binds it — is the same shape. Those
refusals are pinned below alongside the wins, because a wrong answer here
would be far worse than a slow one.
"""

from east import (
    ArrayType,
    East,
    EastArray,
    IntegerType,
    kernel,
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
            if field != "loc_id":
                _count_kinds(value, acc)
    return acc


def _emissions(fn, kind="ForArray", param_types=(INT_ARR,)):
    return _count_kinds(trace(fn, list(param_types))[0]).get(kind, 0)


def _run(fn, data=DATA, param_types=(INT_ARR,)):
    return kernel(list(param_types), fn)(data)


def _sum_loop(src):
    return East.for_(src, {"c": 0, "n": 0},
                     lambda s, x: {"c": s.c + x, "n": s.n + 1})


# ── the regression: an enclosing East.let is a valid anchor ─────────────────


class TestLoopUnderAnEnclosingLet:
    def test_one_enclosing_let(self):
        def fn(p):
            return East.let(p.filter(lambda e: e > 2),
                            lambda a: (lambda r: r.c + r.n)(_sum_loop(a)))

        assert _emissions(fn) == 1
        assert _run(fn) == 24 + 4

    def test_two_nested_lets_anchor_on_the_inner_one(self):
        def fn(p):
            return East.let(p.filter(lambda e: e > 2), lambda a: East.let(
                a.map(lambda e: e * 2),
                lambda b: (lambda r: r.c + r.n)(_sum_loop(b))))

        assert _emissions(fn) == 1
        assert _run(fn) == 48 + 4

    def test_a_read_inside_a_callback_binds_once(self):
        # The O(n x loop) case: re-emitted, the loop ran once PER ELEMENT of
        # the filter. This is the shape the issue measured at 976x.
        def fn(p):
            return East.let(
                p.filter(lambda e: e > 2),
                lambda a: (lambda r: a.filter(lambda e: e < r.c).size() + r.n)(
                    _sum_loop(a)))

        assert _emissions(fn) == 1
        assert _run(fn) == 4 + 4

    def test_it_matches_the_east_let_workaround(self):
        # The documented workaround and the natural spelling must now agree
        # node for node and answer for answer.
        def unbound(p):
            return East.let(p.filter(lambda e: e > 2),
                            lambda a: (lambda r: r.c + r.n)(_sum_loop(a)))

        def bound(p):
            return East.let(p.filter(lambda e: e > 2),
                            lambda a: East.let(_sum_loop(a),
                                               lambda r: r.c + r.n))

        assert _emissions(unbound) == _emissions(bound) == 1
        assert _run(unbound) == _run(bound)

    def test_a_loop_needing_only_parameters_still_uses_the_kernel_site(self):
        # #594/#525 unchanged: nothing about the new site displaces the
        # kernel-body one.
        def fn(p):
            r = _sum_loop(p)
            return r.c + r.n

        assert _emissions(fn) == 1
        assert _run(fn) == 25 + 5


# ── the refusals that keep it honest ────────────────────────────────────────


class TestAnchorMustNotBeMutated:
    def test_an_anchor_appended_to_after_its_binding(self):
        # Hoisting the reads to just past `Let(a, …)` would size the array
        # BEFORE the append: 2+2=4 instead of 3+3=6.
        def fn(p):
            return East.let(
                East.new_array(IntegerType, [1, 2]),
                lambda a: East.block(a.append(99),
                                     (lambda n: n + n)(a.size())))

        assert _run(fn) == 6

    def test_an_anchor_inserted_into_after_its_binding(self):
        def fn(p):
            return East.let(
                East.new_set(IntegerType),
                lambda s: East.block(s.insert(7),
                                     (lambda n: n * 10 + n)(s.size())))

        assert _run(fn) == 11

    def test_an_anchor_mutated_by_a_loop_in_the_same_block(self):
        def fn(p):
            return East.let(
                East.new_array(IntegerType, []),
                lambda a: East.block(
                    East.for_(p, {"n": 0},
                              lambda s, x: East.block(a.append(x), s)),
                    (lambda n: n + n)(a.size())))

        assert _run(fn) == 10

    def test_reads_either_side_of_a_mutation_stay_apart(self):
        def fn(p):
            return East.let(
                East.new_array(IntegerType, [1]),
                lambda a: East.let(
                    a.size(),
                    lambda before: East.block(
                        a.append(2), before * 100 + a.size() + a.size())))

        assert _run(fn) == 104

    def test_a_loop_state_read_never_leaves_its_loop(self):
        # The loop's Ref cell is bound by the loop's OWN Block, so it looks
        # like a perfectly good anchor — but the loop updates it once per
        # iteration, so a node reading it is not invariant. `m` must be twice
        # the running total from the previous step, not twice zero.
        def fn(p):
            return East.for_(p, {"c": 0, "m": 0},
                             lambda s, x: {"c": s.c + x, "m": s.c + s.c}).m

        assert _run(fn) == 36     # 2 x 18, the total before the last element


class TestConditionalGuardsStillHold:
    def test_a_guarded_partial_read_under_a_let(self):
        # #558 A, now with an enclosing anchor available: every occurrence is
        # branch-guarded, so the hoist must still be refused or the `get(0)`
        # would run on the empty path.
        def fn(p):
            return East.let(
                p.filter(lambda e: e > 100),
                lambda a: East.if_else(a.size() > 0,
                                       (lambda n: n + n)(a.get(0)), -1))

        assert _run(fn) == -1

    def test_the_same_shape_still_answers_when_the_guard_holds(self):
        def fn(p):
            return East.let(
                p.filter(lambda e: e > 2),
                lambda a: East.if_else(a.size() > 0,
                                       (lambda n: n + n)(a.get(0)), -1))

        assert _run(fn) == 10
