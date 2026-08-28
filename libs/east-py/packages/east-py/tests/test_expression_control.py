#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Block-level control flow in traced kernels (issue #578).

east-c has always executed ``While``, the ``For*`` family, ``Block``, ``Let``,
``NewRef``, ``TryCatch``, ``Break`` and ``Continue``; the tracer emitted none
of them, so a kernel could only ever be one pure expression and any algorithm
whose next step depends on the last ran per element in python.

``IfElse`` is here too: the conditional is ``East.if_else``, named for its
node like everything else, and it takes cond/value pairs then the else so a
chain is ONE node. (It was ``where``, which the #578 naming rule made the odd
one out; there is no alias.)

These tests pin four things:

* the constructs EMIT the IR nodes they name, and compile and run — including
  the zero- and one-iteration edges a loop gets wrong first;
* the same lambda works traced and eager — the constructs are dual-mode, so
  one body serves a build and a plain-value call;
* the failure modes are LOUD — a state that changes shape or type, a mutation
  written as a statement (evaluated and thrown away), a mutation of a
  build-time constant (shared by every call to the kernel);
* the workload the issue is about — Kahn's algorithm over a DAG — is ONE
  compiled kernel.
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
    if_else,
)
from east.expression import ExpressionError, trace
from east.runtime.errors import EastError
from east.types.values import EastArray, EastDict, EastSet

INTS = ArrayType(IntegerType)
STRS = ArrayType(StringType)
COUNTS = DictType(StringType, IntegerType)


def _ints(*values):
    return array(IntegerType, list(values))


def _node_kinds(node, out=None):
    """Every IR variant tag under ``node`` — what the trace actually emitted."""
    from east.types.values import is_east_struct, is_east_variant

    out = set() if out is None else out
    if isinstance(node, (list, EastArray)):
        for item in node:
            _node_kinds(item, out)
    elif is_east_variant(node):
        out.add(node.type)
        _node_kinds(node.value, out)
    elif is_east_struct(node):
        for _name, value in node.items():
            _node_kinds(value, out)
    return out


def _traced_kinds(param_types, fn):
    return _node_kinds(trace(fn, list(param_types))[0])


# ── while_ ──────────────────────────────────────────────────────────────────


def test_while_sums_a_range_including_both_edges():
    """The issue's headline, hand-built there and traced here."""
    k = East.function([IntegerType], IntegerType, lambda _b, n: East.while_(
        {"i": 0, "acc": 0},
        cond=lambda _b, s: s.i < n,
        body=lambda _b, s: {"acc": s.acc + s.i, "i": s.i + 1}).acc)
    assert [k(n) for n in (10, 0, 1, 5)] == [45, 0, 0, 10]


def test_while_emits_the_while_node():
    kinds = _traced_kinds([IntegerType], lambda _b, n: East.while_(
        {"i": 0}, cond=lambda _b, s: s.i < n, body=lambda _b, s: {"i": s.i + 1}).i)
    assert {"While", "NewRef", "Let", "Block"} <= kinds


def test_while_body_may_return_the_fields_in_any_order():
    """The issue's own example seeds ``{i, acc}`` and returns ``{acc, i}``:
    a dict literal's order is whatever the body wrote, the struct type's is
    the state's, so the body is reordered rather than rejected."""
    k = East.function([IntegerType], IntegerType, lambda _b, n: East.while_(
        {"i": 0, "acc": 0},
        cond=lambda _b, s: s.i < n,
        body=lambda _b, s: {"acc": s.acc + s.i, "i": s.i + 1}).acc)
    assert k(4) == 6


def test_while_threads_a_single_value_state():
    k = East.function([IntegerType], IntegerType, lambda _b, n: East.while_(
        1, cond=lambda _b, p: p < n, body=lambda _b, p: p * 2))
    assert k(50) == 64


def test_while_cond_must_be_boolean():
    with pytest.raises(ExpressionError, match="cond must return a Boolean"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.while_(
            {"i": 0}, cond=lambda _b, s: s.i + n, body=lambda _b, s: {"i": s.i + 1}))


def test_while_state_shape_change_is_named():
    with pytest.raises(ExpressionError, match="missing \\['acc'\\]"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.while_(
            {"i": 0, "acc": 0},
            cond=lambda _b, s: s.i < n,
            body=lambda _b, s: {"i": s.i + 1}))
    with pytest.raises(ExpressionError, match="unknown \\['extra'\\]"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.while_(
            {"i": 0},
            cond=lambda _b, s: s.i < n,
            body=lambda _b, s: {"i": s.i + 1, "extra": 0}))


def test_while_state_type_change_names_the_field():
    with pytest.raises(ExpressionError, match="acc: Integer -> Float"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.while_(
            {"i": 0, "acc": 0},
            cond=lambda _b, s: s.i < n,
            body=lambda _b, s: {"i": s.i + 1, "acc": s.acc.to_float() + 1.0}))


# ── for_ ────────────────────────────────────────────────────────────────────


def test_for_over_an_array_with_and_without_the_index():
    total = East.function(
        [INTS], StructType([("n", IntegerType), ("t", IntegerType)]),
        lambda _b, a: East.for_(a, {"n": 0, "t": 0}, lambda _b, s, el: {"n": s.n + 1, "t": s.t + el}))
    got = total(_ints(3, 4, 5))
    assert (got["n"], got["t"]) == (3, 12)

    weighted = East.function([INTS], IntegerType, lambda _b, a: East.for_(
        a, {"w": 0}, lambda _b, s, el, i: {"w": s.w + el * i}).w)
    assert weighted(_ints(10, 20, 30)) == 80


def test_for_over_a_set_and_a_dict():
    """A While over an index cannot walk these — they have no positional
    access — which is why ``for_`` lowers to the container's own For node."""
    from_set = East.function([SetType(IntegerType)], IntegerType, lambda _b, s0: East.for_(
        s0, {"t": 0}, lambda _b, s, el: {"t": s.t + el}).t)
    assert from_set(EastSet(IntegerType, [1, 2, 3])) == 6

    from_dict = East.function(
        [COUNTS], StructType([("t", IntegerType), ("keys", StringType)]),
        lambda _b, d: East.for_(d, {"t": 0, "keys": ""},
                            lambda _b, s, key, v: {"t": s.t + v, "keys": s.keys + key}))
    got = from_dict(EastDict(StringType, IntegerType, {"a": 1, "b": 2}))
    assert (got["t"], got["keys"]) == (3, "ab")


@pytest.mark.parametrize(("container", "value", "node"), [
    (INTS, lambda: _ints(1), "ForArray"),
    (SetType(IntegerType), lambda: EastSet(IntegerType, [1]), "ForSet"),
    (COUNTS, lambda: EastDict(StringType, IntegerType, {"a": 1}), "ForDict"),
])
def test_for_emits_the_containers_own_node(container, value, node):
    body = (lambda _b, s, k, v: {"t": s.t + v}) if node == "ForDict" \
        else (lambda _b, s, el: {"t": s.t + el})
    assert node in _traced_kinds([container], lambda _b, c: East.for_(c, {"t": 0}, body))


def test_for_over_an_empty_collection_returns_the_seed():
    k = East.function([INTS], IntegerType, lambda _b, a: East.for_(a, {"t": 7}, lambda _b, s, el: {"t": s.t + el}).t)
    assert k(array(IntegerType, [])) == 7


def test_for_needs_a_container():
    with pytest.raises(ExpressionError, match="for_ over Integer"):
        East.function([IntegerType], IntegerType,
                      lambda _b, n: East.for_(n, {"t": 0}, lambda _b, s, el: s))


# ── mutable locals ──────────────────────────────────────────────────────────


def test_append_accumulates_in_place_and_starts_fresh_each_call():
    k = East.function([INTS], INTS, lambda _b, a: East.for_(
        a, {"out": East.new_array(IntegerType)},
        lambda _b, s, el: East.block(s.out.push_last(el * 2), s)).out)
    assert list(k(_ints(1, 2, 3))) == [2, 4, 6]
    assert list(k(_ints(1, 2, 3))) == [2, 4, 6], "state leaked between calls"


def test_a_captured_seed_collection_is_also_built_per_call():
    """A loop's SEED is its mutable working set, so a captured collection is
    inlined rather than hoisted to the one build-time constant every call
    would otherwise share (the spelling the issue's own example uses)."""
    seed = EastArray(IntegerType, [])
    k = East.function([INTS], INTS, lambda _b, a: East.for_(
        a, {"out": seed}, lambda _b, s, el: East.block(s.out.push_last(el), s)).out)
    assert list(k(_ints(1, 2))) == [1, 2]
    assert list(k(_ints(1, 2))) == [1, 2]
    assert list(seed) == [], "the captured object itself was mutated"


def test_dict_and_set_accumulators():
    counts = East.function([STRS], COUNTS, lambda _b, a: East.for_(
        a, {"counts": East.new_dict(StringType, IntegerType)},
        lambda _b, s, el: East.block(
            s.counts.insert_or_update(el, 1, lambda _b, old, new: old + new), s)).counts)
    assert dict(counts(array(StringType, ["a", "b", "a"])).items()) == {"a": 2, "b": 1}

    seen = East.function(
        [STRS], StructType([("seen", SetType(StringType)), ("n", IntegerType)]),
        lambda _b, a: East.for_(
            a, {"seen": East.new_set(StringType), "n": 0},
            lambda _b, s, el: East.block(s.seen.try_insert(el), {**s, "n": s.n + 1})))
    got = seen(array(StringType, ["a", "b", "a"]))
    assert (sorted(got["seen"]), got["n"]) == (["a", "b"], 3)


def test_a_mutation_written_as_a_statement_is_refused():
    """A traced callback is ONE expression, so a bare ``acc.push_last(x)`` is
    evaluated at trace time and thrown away — the compiled loop would silently
    do nothing, which is the worst way to be wrong."""
    def step(_b, s, el):
        s.out.push_last(el)
        return s

    with pytest.raises(ExpressionError, match="thrown away.*East.block"):
        East.function([INTS], INTS, lambda _b, a: East.for_(
            a, {"out": East.new_array(IntegerType)}, step).out)


def test_mutating_a_captured_constant_is_refused():
    table = EastArray(IntegerType, [1, 2, 3])
    with pytest.raises(ExpressionError, match="captured constant"):
        East.function([INTS], IntegerType, lambda _b, a: East.block(
            a.map(lambda _b, el: el).concat(table).size(),
            East.let(table.copy().concat(table), lambda _b, t: t.size()),
            East.for_(a, {"n": 0},
                      lambda _b, s, el: East.block(_capture_append(table, el), s)).n))


def _capture_append(table, el):
    """Reach the captured constant AS A TRACED EXPRESSION, which is the shape
    the guard is about — a bare ``table.push_last`` would hit the eager method."""
    from east.expression import _lift

    return _lift(table).push_last(el)


def test_mutators_yield_what_their_eager_twins_yield():
    k = East.function([STRS], IntegerType, lambda _b, a: East.for_(
        a, {"new": 0, "seen": East.new_set(StringType)},
        lambda _b, s, el: {"new": s.new + if_else(s.seen.try_insert(el), 1, 0),
                       "seen": s.seen}).new)
    assert k(array(StringType, ["a", "b", "a"])) == 2


# ── if_else ─────────────────────────────────────────────────────────────────


def test_if_else_is_the_two_way_conditional():
    k = East.function([IntegerType], IntegerType, lambda _b, n: East.if_else(n > 0, 1, -1))
    assert (k(5), k(-5)) == (1, -1)


def test_if_else_chains_into_ONE_node():
    """The IR's ``ifs`` is an array of cases, so an if/elif/else chain is one
    IfElse — not a nest of them, which is what a two-way-only spelling costs."""
    k = East.function([IntegerType], StringType,
               lambda _b, n: East.if_else(n > 10, "bulk", n > 0, "retail", "none"))
    assert [k(20), k(5), k(-1)] == ["bulk", "retail", "none"]

    ir = trace(lambda _b, n: East.if_else(n > 10, 1, n > 5, 2, 3), [IntegerType])[0]
    cases = _ifelse_cases(ir)
    assert cases == [2], f"expected one IfElse with two cases, got {cases}"


def _ifelse_cases(node, out=None):
    """The case count of every IfElse under ``node``."""
    from east.types.values import is_east_struct, is_east_variant

    out = [] if out is None else out
    if isinstance(node, (list, EastArray)):
        for item in node:
            _ifelse_cases(item, out)
    elif is_east_variant(node):
        if node.type == "IfElse":
            out.append(len(node.value["ifs"]))
        _ifelse_cases(node.value, out)
    elif is_east_struct(node):
        for _name, value in node.items():
            _ifelse_cases(value, out)
    return out


def test_if_else_needs_an_odd_argument_count():
    with pytest.raises(ExpressionError, match="odd\\s+number of arguments"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.if_else(n > 0, 1, n > 5, 2))
    with pytest.raises(ExpressionError, match="odd"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.if_else(n > 0, 1))


def test_if_else_conditions_must_be_boolean():
    with pytest.raises(ExpressionError, match="condition must be Boolean"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.if_else(n, 1, 2))


def test_if_else_arms_must_agree():
    with pytest.raises(ExpressionError, match="arms must have the same East type"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.if_else(n > 0, 1, "no"))


def test_if_else_reconciles_an_integer_float_mix_either_way():
    assert East.function([IntegerType], FloatType, lambda _b, n: East.if_else(n > 0, 1, 2.0))(1) == 1.0
    assert East.function([IntegerType], FloatType, lambda _b, n: East.if_else(n > 0, 1.0, 2))(-1) == 2.0


def test_if_else_is_dual_mode():
    assert East.if_else(True, "a", "b") == "a"
    assert East.if_else(False, "a", True, "b", "c") == "b"
    assert East.if_else(False, "a", False, "b", "c") == "c"


def test_where_is_gone():
    """#578 renamed it: the python name is the IR node name, so a second
    spelling for IfElse would be exactly the inconsistency the rename fixes."""
    import east
    import east.expression

    assert not hasattr(east, "where")
    assert not hasattr(east.expression, "where")
    assert not hasattr(East, "where")


# ── break / continue ────────────────────────────────────────────────────────


def test_break_stops_the_loop():
    k = East.function([INTS], IntegerType, lambda _b, a: East.for_(
        a, {"t": 0}, lambda _b, s, el: if_else(el < 0, East.break_(), {"t": s.t + el})).t)
    assert k(_ints(1, 2, -1, 100)) == 3


def test_break_can_commit_a_final_state():
    k = East.function([INTS], IntegerType, lambda _b, a: East.for_(
        a, {"found": -1, "i": 0},
        lambda _b, s, el: if_else(el == 7,
                              East.break_({"found": s.i, "i": s.i}),
                              {"found": s.found, "i": s.i + 1})).found)
    assert k(_ints(4, 5, 7, 9)) == 2
    assert k(_ints(4, 5, 9)) == -1


def test_continue_skips_the_rest_of_the_body():
    k = East.function([INTS], IntegerType, lambda _b, a: East.for_(
        a, {"t": 0}, lambda _b, s, el: if_else(el < 0, East.continue_(), {"t": s.t + el})).t)
    assert k(_ints(1, -5, 2)) == 3
    assert "Continue" in _traced_kinds([INTS], lambda _b, a: East.for_(
        a, {"t": 0}, lambda _b, s, el: if_else(el < 0, East.continue_(), {"t": s.t + el})))


def test_a_labelled_break_leaves_the_outer_loop_with_its_state():
    """The one thing a label is for: an inner loop reporting to the outer one
    it stops. Without the committed state the outer iteration's work is lost."""
    outer = East.label("outer")
    grid_t = ArrayType(ArrayType(IntegerType))
    k = East.function(
        [grid_t, IntegerType],
        StructType([("row", IntegerType), ("col", IntegerType), ("r", IntegerType)]),
        lambda _b, g, target: East.for_(
        g, {"row": -1, "col": -1, "r": 0},
        lambda _b, s, cells: East.let(
            East.for_(cells, {"c": 0},
                      lambda _b, t, cell: if_else(
                          cell == target,
                          East.break_({"row": s.r, "col": t.c, "r": s.r}, label=outer),
                          {"c": t.c + 1})),
            lambda _b, _inner: {"row": s.row, "col": s.col, "r": s.r + 1}),
        label=outer))
    grid = array(ArrayType(IntegerType),
                 [_ints(1, 2), _ints(3, 4)])
    found = k(grid, 4)
    assert (found["row"], found["col"]) == (1, 1)
    missing = k(grid, 99)
    assert (missing["row"], missing["col"], missing["r"]) == (-1, -1, 2)


def test_break_outside_a_loop_says_so():
    with pytest.raises(ExpressionError, match="outside any loop"):
        East.function([IntegerType], IntegerType, lambda _b, n: if_else(n > 0, East.break_(), n))


def test_break_with_a_label_positionally_is_corrected():
    lbl = East.label("l")
    with pytest.raises(ExpressionError, match=r"break_\(label="):
        East.break_(lbl)


# ── block / let / ref ───────────────────────────────────────────────────────


def test_block_yields_its_last_expression():
    assert East.function([IntegerType], IntegerType, lambda _b, n: East.block(n, n + 1))(4) == 5
    with pytest.raises(ExpressionError, match="at least one expression"):
        East.function([IntegerType], IntegerType, lambda _b, n: East.block())


def test_let_binds_once():
    k = East.function([IntegerType], IntegerType, lambda _b, n: East.let(n * 2, lambda _b, d: d + d))
    assert k(5) == 20
    assert "Let" in _traced_kinds([IntegerType],
                                  lambda _b, n: East.let(n * 2, lambda _b, d: d + d))


def test_ref_reads_writes_and_updates():
    assert East.function([IntegerType], IntegerType, lambda _b, n: East.let(
        East.ref(n), lambda _b, r: East.block(r.update(r.get() + 10), r.get())))(7) == 17
    assert East.function([IntegerType], IntegerType, lambda _b, n: East.let(
        East.ref(n), lambda _b, r: East.block(r.update(r.get() * 3), r.get())))(4) == 12


def test_new_collections_are_typed_and_can_start_populated():
    k = East.function([IntegerType], INTS, lambda _b, n: East.new_array(IntegerType, [n, n + 1]))
    assert list(k(5)) == [5, 6]
    k = East.function([IntegerType], IntegerType, lambda _b, n: East.new_dict(
        StringType, IntegerType, {"a": n}).get("a"))
    assert k(3) == 3
    k = East.function([IntegerType], IntegerType, lambda _b, n: East.new_set(IntegerType, [n]).size())
    assert k(9) == 1


# ── try_catch ───────────────────────────────────────────────────────────────


def test_try_catch_runs_the_handler_on_an_east_error():
    k = East.function([INTS], IntegerType, lambda _b, a: East.try_catch(lambda _b: a.get(10), lambda _b, _m: -1))
    assert k(_ints(1, 2)) == -1
    assert k(_ints(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)) == 11
    assert "TryCatch" in _traced_kinds(
        [INTS], lambda _b, a: East.try_catch(lambda _b: a.get(10), lambda _b, _m: -1))


def test_try_catch_handler_sees_the_message():
    k = East.function([INTS], StringType, lambda _b, a: East.try_catch(
        lambda _b: East.new_array(StringType, ["ok"]).get(a.get(9)),
        lambda _b, msg: msg))
    assert isinstance(k(_ints(1)), str)


def test_try_catch_arms_must_agree_on_type():
    with pytest.raises(ExpressionError, match="both arms must agree"):
        East.function([INTS], IntegerType,
                      lambda _b, a: East.try_catch(lambda _b: a.get(0), lambda _b, _m: "no"))


def test_try_catch_runs_finally_either_way():
    k = East.function([INTS], IntegerType, lambda _b, a: East.let(
        East.ref(0),
        lambda _b, r: East.block(
            East.try_catch(lambda _b: a.get(10), lambda _b, _m: -1,
                           finally_=lambda _b: r.update(1)),
            r.get())))
    assert k(_ints(1)) == 1


# ── the same lambda works on the python path ────────────────────────────────


def test_eager_while_and_for_match_the_traced_answers():
    state = East.while_({"i": 0, "acc": 0},
                        cond=lambda _b, s: s.i < 5,
                        body=lambda _b, s: {"acc": s.acc + s.i, "i": s.i + 1})
    assert (state["i"], state["acc"]) == (5, 10)
    assert East.for_(_ints(1, 2, 3), {"t": 0}, lambda _b, s, el: {"t": s.t + el})["t"] == 6
    assert East.for_(EastDict(StringType, IntegerType, {"a": 2}), {"t": 0},
                     lambda _b, s, k, v: {"t": s.t + v})["t"] == 2


def test_eager_break_and_continue_match():
    assert East.for_(_ints(1, 2, -1, 9), {"t": 0},
                     lambda _b, s, el: if_else(el < 0, East.break_(),
                                           {"t": s.t + el}))["t"] == 3
    assert East.for_(_ints(4, 5, 7, 9), {"found": -1, "i": 0},
                     lambda _b, s, el: if_else(el == 7,
                                           East.break_({"found": s.i, "i": s.i}),
                                           {"found": s.found, "i": s.i + 1}))["found"] == 2
    assert East.for_(_ints(1, -5, 2), {"t": 0},
                     lambda _b, s, el: if_else(el < 0, East.continue_(),
                                           {"t": s.t + el}))["t"] == 3


def test_eager_mutators_block_and_try_catch_match():
    out = East.for_(_ints(1, 2, 3), {"out": East.new_array(IntegerType)},
                    lambda _b, s, el: East.block(s.out.push_last(el * 2), s))["out"]
    assert list(out) == [2, 4, 6]
    assert East.try_catch(lambda _b: 1 // 0, lambda _b, _m: -1) == -1
    assert East.let(3, lambda _b, x: x + 1) == 4
    assert East.ref(2).get() == 2


def test_eager_state_shape_is_checked_the_same_way():
    with pytest.raises(ExpressionError, match="missing \\['acc'\\]"):
        East.while_({"i": 0, "acc": 0},
                    cond=lambda _b, s: s.i < 3,
                    body=lambda _b, s: {"i": s.i + 1})


def test_a_loop_inside_an_eager_callback_captures():
    """The capture validator must let the control-flow constructs through:
    an eager callback built from them captures like any other (under the
    strict surface the alternative is a refusal, never a slow path)."""
    rows = array(INTS, [_ints(1, 2), _ints(3, 4, 5)])
    got = rows.map(lambda _b, r: East.for_(r, {"t": 0}, lambda _b, s, el: {"t": s.t + el}).t,
                   out=IntegerType)
    assert list(got) == [3, 12]


# ── the workload the issue is about ─────────────────────────────────────────


def test_kahns_algorithm_is_one_kernel():
    """A worklist over a DAG: the shape the issue names, and the one no
    data-parallel reformulation reproduces (pointer jumping measured ~12×
    slower and answered differently wherever a chain forks)."""
    node_t = IntegerType
    succ_t = DictType(node_t, ArrayType(node_t))
    indeg_t = DictType(node_t, IntegerType)

    topo = East.function(
        [ArrayType(node_t), succ_t, indeg_t], ArrayType(node_t),
        lambda _b, roots, succ, indeg: East.while_(
            # a cursor into a worklist the loop APPENDS to — O(1) per edge,
            # where rebuilding `ready` through the state would copy it per step
            {"ready": roots.copy(), "indeg": indeg.copy(),
             "order": East.new_array(node_t), "i": 0},
            cond=lambda _b, s: s.i < s.ready.size(),
            body=lambda _b, s: East.let(
                s.ready.get(s.i),
                lambda _b, node: East.block(
                    s.order.push_last(node),
                    East.for_(
                        succ.get_or_default(node, East.new_array(node_t)),
                        {**s, "i": s.i + 1},
                        lambda _b, t, v: East.block(
                            t.indeg.insert_or_update(v, -1, lambda _b, old, d: old + d),
                            if_else(t.indeg.get(v) == 0,
                                    East.block(t.ready.push_last(v), t),
                                    t)))))).order)

    #   1 → 2 → 4 ;  1 → 3 → 4
    succ = EastDict(node_t, ArrayType(node_t), {
        1: _ints(2, 3), 2: _ints(4), 3: _ints(4), 4: array(node_t, [])})
    indeg = EastDict(node_t, IntegerType, {1: 0, 2: 1, 3: 1, 4: 2})
    assert list(topo(_ints(1), succ, indeg)) == [1, 2, 3, 4]
    # the inputs are untouched: the loop works on its own copies
    assert dict(indeg.items()) == {1: 0, 2: 1, 3: 1, 4: 2}


def test_a_loop_that_raises_still_reports_the_east_error():
    k = East.function([INTS], IntegerType, lambda _b, a: East.for_(
        a, {"t": 0}, lambda _b, s, el: {"t": s.t + a.get(el)}).t)
    with pytest.raises(EastError):
        k(_ints(99))


# ── the escape hatch is where the docs say it is (#578 papercut) ────────────


def test_compile_from_value_is_reachable_from_east():
    from east import (  # noqa: F401
        compile_from_beast2,
        compile_from_east,
        compile_from_json,
        compile_from_value,
    )
    from east.ir.builders import ir_builtin, ir_function, ir_value, ir_variable
    from east.types.types import FunctionType

    assert compile_from_json is not None
    doubled = ir_function(
        FunctionType([IntegerType], IntegerType), [], [ir_variable(IntegerType, "x")],
        ir_builtin(IntegerType, "IntegerAdd", [],
                   [ir_variable(IntegerType, "x"), ir_value(IntegerType, 1)]))
    assert compile_from_value(doubled)(41) == 42


def test_float_state_keeps_its_type():
    k = East.function([FloatType], FloatType, lambda _b, x: East.while_(
        {"v": 1.0, "n": 0},
        cond=lambda _b, s: s.n < 3,
        body=lambda _b, s: {"v": s.v * x, "n": s.n + 1}).v)
    assert k(2.0) == 8.0
