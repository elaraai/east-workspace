#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Reductions on the traced kernel surface (#525 phase 1).

`sum` / `mean` / `maximum` / `minimum` / `reduce` / `every` / `some` existed as
eager methods and ran natively in every runtime, but did not TRACE — so inside
a kernel they were either a `KernelTraceError` or a hand-rolled fold. That is
not a slower-but-correct fallback: #524 measured 6h02m for 729k rows caused by
exactly this kind of reformulation.

The issue's test expectation, applied to every operation here:

* the traced and eager paths agree EXACTLY — float accumulation order
  included, which holds because each traced form composes the same builtin the
  eager method uses (ArrayFold / SetReduce / DictReduce / *MapReduce /
  *FirstMap);
* `eager_stats()["trampoline_calls"]` does not move, which is what actually
  proves the operation ran natively rather than silently falling back.
"""

import math

import pytest

from east import (
    ArrayType,
    DictType,
    FloatType,
    IntegerType,
    SetType,
    StringType,
    StructType,
    array,
    kernel,
    none,
    some,
)
from east.kernel import KernelTraceError
from east.runtime.compiler import eager_stats
from east.types.values.collections import (
    EastArray,
    EastDict,
    EastSet,
    _kernel_out_type,
)

ROW = StructType([("g", StringType), ("v", FloatType), ("n", IntegerType)])
ROWS = [{"g": f"g{i % 3}", "v": float(i) * 1.5, "n": i} for i in range(60)]

A_ROW = ArrayType(ROW)
A_F = ArrayType(FloatType)
S_I = SetType(IntegerType)
D_SF = DictType(StringType, FloatType)
D_SI = DictType(StringType, IntegerType)


def _rows():
    return array(ROW, ROWS)


def _floats():
    return EastArray(FloatType, [0.1, 0.2, 0.3, 1e16, -1e16])


def _ints():
    return EastSet(IntegerType, [3, 1, 4, 1, 5, 9, 2, 6])


def _dict_f():
    return EastDict(StringType, FloatType, {f"k{i:02d}": float(i) * 0.7 for i in range(20)})


def _dict_i():
    return EastDict(StringType, IntegerType, {f"k{i:02d}": i for i in range(20)})


def _native(traced, param_type, value):
    """Run the traced form, asserting it costs no per-element python."""
    k = kernel(param_type, traced)
    before = eager_stats()["trampoline_calls"]
    got = k(value)
    moved = eager_stats()["trampoline_calls"] - before
    assert moved == 0, f"{moved} per-element python trampoline call(s)"
    return got


def _same(got, want):
    if isinstance(want, float) and math.isnan(want):
        assert isinstance(got, float) and math.isnan(got)
    else:
        assert got == want
        assert type(got) is type(want), f"{type(got)} vs {type(want)}"


# ── Array ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("name", "traced", "eager"),
    [
        # ROW is a struct, so every case here MUST carry a projection; the
        # bare (no-projection) forms are covered by the Float array below.
        ("sum_float_proj", lambda a: a.sum(lambda r: r.v), lambda a: a.sum(lambda r: r["v"])),
        ("sum_int_proj", lambda a: a.sum(lambda r: r.n), lambda a: a.sum(lambda r: r["n"])),
        ("mean_float_proj", lambda a: a.mean(lambda r: r.v), lambda a: a.mean(lambda r: r["v"])),
        ("mean_int_proj", lambda a: a.mean(lambda r: r.n), lambda a: a.mean(lambda r: r["n"])),
        ("maximum", lambda a: a.maximum(lambda r: r.v), lambda a: a.maximum(lambda r: r["v"])),
        ("minimum", lambda a: a.minimum(lambda r: r.v), lambda a: a.minimum(lambda r: r["v"])),
        ("maximum_int", lambda a: a.maximum(lambda r: r.n), lambda a: a.maximum(lambda r: r["n"])),
    ],
)
def test_array_reduction_matches_eager(name, traced, eager):
    rows = _rows()
    _same(_native(traced, A_ROW, rows), eager(rows))


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda a: a.sum(), lambda a: a.sum()),
        (lambda a: a.mean(), lambda a: a.mean()),
        (lambda a: a.maximum(), lambda a: a.maximum()),
        (lambda a: a.minimum(), lambda a: a.minimum()),
    ],
)
def test_array_bare_reduction_matches_eager(traced, eager):
    """No projection: the elements themselves must be numeric."""
    xs = _floats()
    _same(_native(traced, A_F, xs), eager(xs))


def test_array_sum_float_accumulation_order_is_identical():
    """Catastrophic cancellation makes the fold ORDER observable — traced and
    eager must agree bit for bit, not merely approximately."""
    xs = EastArray(FloatType, [1e16, 1.0, -1e16, 1.0, 0.1, 0.2])
    traced = _native(lambda a: a.sum(), A_F, xs)
    assert traced == xs.sum()
    # ...and the order genuinely matters here, so the test has teeth
    assert xs.sum() != sum(sorted(xs))


def test_array_maximum_minimum_use_east_total_order_on_strings():
    words = EastArray(StringType, ["pear", "apple", "fig", "banana"])
    t = ArrayType(StringType)
    assert _native(lambda a: a.maximum(), t, words) == words.maximum() == "pear"
    assert _native(lambda a: a.minimum(), t, words) == words.minimum() == "apple"


def test_array_maximum_on_empty_errors_like_eager():
    """Same failure, same message — a max has no identity element, and the
    traced form must not quietly invent one."""
    from east.runtime.errors import EastError

    empty = EastArray(FloatType, [])
    with pytest.raises(EastError, match="Cannot reduce empty array"):
        empty.maximum()
    with pytest.raises(EastError, match="Cannot reduce empty array"):
        kernel(A_F, lambda a: a.maximum())(empty)


def test_array_mean_of_empty_is_nan_like_eager():
    empty = EastArray(FloatType, [])
    _same(_native(lambda a: a.mean(), A_F, empty), empty.mean())


def test_array_sum_of_empty_is_the_projection_zero():
    """The zero is typed from the PROJECTION, so an empty array sums to THAT
    type's zero — the traced twin of the eager #450 rule.

    `_same` compares the TYPE too, which is the whole point: `0 == 0.0` in
    python, so a bare equality assertion would pin nothing.
    """
    empty = EastArray(ROW, [])
    _same(_native(lambda a: a.sum(lambda r: r.v), A_ROW, empty), 0.0)
    _same(_native(lambda a: a.sum(lambda r: r.n), A_ROW, empty), 0)
    # ...and eager must agree. It did NOT before #525: `EastArray.sum` gated
    # its whole type derivation on `len(self)`, so an Integer projection over
    # a struct element type RAISED when empty (the defect fixed for
    # `EastDict.sum` in #526, still live on Array/Set until now).
    _same(empty.sum(lambda r: r["v"]), 0.0)
    _same(empty.sum(lambda r: r["n"]), 0)


def test_empty_set_and_dict_sum_agree_with_eager():
    _same(_native(lambda s: s.sum(), S_I, EastSet(IntegerType)), EastSet(IntegerType).sum())
    empty_d = EastDict(StringType, FloatType)
    _same(_native(lambda d: d.sum(), D_SF, empty_d), empty_d.sum())


def test_projection_may_return_a_plain_python_number():
    """`.mean(lambda r: 1)` works eagerly, so it must trace — a python int has
    no `.to_float()`, so the Integer-widening path has to lift first."""
    rows = _rows()
    _same(_native(lambda a: a.mean(lambda r: 1), A_ROW, rows), rows.mean(lambda r: 1))
    _same(_native(lambda a: a.sum(lambda r: 2), A_ROW, rows), rows.sum(lambda r: 2))


# ── the no-predicate quantifier form, as the eager methods allow ─────────────

def test_every_and_some_without_a_predicate():
    """Boolean elements (a Dict's VALUES) are the predicate, like eager."""
    from east.types.types import BooleanType

    a = EastArray(BooleanType, [True, True])
    s = EastSet(BooleanType, [True])
    d = EastDict(StringType, BooleanType, {"a": True, "b": False})
    assert _native(lambda x: x.every(), ArrayType(BooleanType), a) is a.every() is True
    assert _native(lambda x: x.some(), SetType(BooleanType), s) is s.some() is True
    assert _native(lambda x: x.every(), DictType(StringType, BooleanType), d) is d.every() is False
    assert _native(lambda x: x.some(), DictType(StringType, BooleanType), d) is d.some() is True


def test_no_predicate_quantifier_on_non_boolean_is_named():
    with pytest.raises(KernelTraceError, match="without a predicate needs Boolean elements"):
        kernel(S_I, lambda s: s.every())
    with pytest.raises(KernelTraceError, match="without a predicate needs Boolean values"):
        kernel(D_SF, lambda d: d.some())


# ── Set ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda s: s.sum(), lambda s: s.sum()),
        (lambda s: s.mean(), lambda s: s.mean()),
        (lambda s: s.reduce(0, lambda a, e: a + e), lambda s: s.reduce(0, lambda a, e: a + e)),
        (lambda s: s.reduce(1, lambda a, e: a * e), lambda s: s.reduce(1, lambda a, e: a * e)),
        (lambda s: s.every(lambda e: e > 0), lambda s: s.every(lambda e: e > 0)),
        (lambda s: s.every(lambda e: e > 3), lambda s: s.every(lambda e: e > 3)),
        (lambda s: s.some(lambda e: e > 8), lambda s: s.some(lambda e: e > 8)),
        (lambda s: s.some(lambda e: e > 100), lambda s: s.some(lambda e: e > 100)),
    ],
)
def test_set_reduction_matches_eager(traced, eager):
    s = _ints()
    _same(_native(traced, S_I, s), eager(s))


def test_set_quantifiers_on_empty_match_eager():
    empty = EastSet(IntegerType)
    assert _native(lambda s: s.every(lambda e: e > 0), S_I, empty) is empty.every(lambda e: e > 0) is True
    assert _native(lambda s: s.some(lambda e: e > 0), S_I, empty) is empty.some(lambda e: e > 0) is False


def test_set_reduce_visits_in_east_order():
    """SetReduce folds in East total order, so an order-SENSITIVE step pins it."""
    s = EastSet(StringType, ["b", "a", "c"])
    step = lambda acc, e: acc + e  # noqa: E731 — concatenation is not commutative
    got = _native(lambda x: x.reduce("", step), SetType(StringType), s)
    assert got == s.reduce("", step) == "abc"


# ── Dict ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda d: d.sum(), lambda d: d.sum()),
        (lambda d: d.sum(lambda k, v: v * 2.0), lambda d: d.sum(lambda k, v: v * 2.0)),
        (lambda d: d.mean(), lambda d: d.mean()),
        (lambda d: d.mean(lambda k, v: v * 2.0), lambda d: d.mean(lambda k, v: v * 2.0)),
        (lambda d: d.reduce(0.0, lambda a, k, v: a + v), lambda d: d.reduce(0.0, lambda a, k, v: a + v)),
        (lambda d: d.every(lambda k, v: v >= 0.0), lambda d: d.every(lambda k, v: v >= 0.0)),
        (lambda d: d.every(lambda k, v: v > 5.0), lambda d: d.every(lambda k, v: v > 5.0)),
        (lambda d: d.some(lambda k, v: v > 12.0), lambda d: d.some(lambda k, v: v > 12.0)),
        (lambda d: d.some(lambda k, v: v > 1e9), lambda d: d.some(lambda k, v: v > 1e9)),
    ],
)
def test_dict_reduction_matches_eager(traced, eager):
    d = _dict_f()
    _same(_native(traced, D_SF, d), eager(d))


def test_dict_integer_mean_widens_like_eager():
    d = _dict_i()
    _same(_native(lambda x: x.mean(), D_SI, d), d.mean())


def test_dict_callbacks_take_key_then_value():
    """Every eager Dict callback is ``(key, value)`` while the builtin slot is
    ``(value, key)`` — the traced forms must not leak the builtin's order."""
    d = EastDict(StringType, IntegerType, {"a": 1, "bb": 2})
    # a projection over the KEY proves the argument order
    assert _native(lambda x: x.sum(lambda k, v: k.length()), D_SI, d) == d.sum(lambda k, v: len(k)) == 3
    assert _native(lambda x: x.every(lambda k, v: k.length() >= v), D_SI, d) \
        is d.every(lambda k, v: len(k) >= v) is True
    assert _native(lambda x: x.reduce("", lambda a, k, v: a + k), D_SI, d) \
        == d.reduce("", lambda a, k, v: a + k) == "abb"


def test_dict_reduce_visits_in_key_order():
    d = EastDict(StringType, IntegerType, {"c": 3, "a": 1, "b": 2})
    step = lambda acc, k, v: acc + k  # noqa: E731
    assert _native(lambda x: x.reduce("", step), D_SI, d) == d.reduce("", step) == "abc"


# ── diagnostics ──────────────────────────────────────────────────────────────

def test_non_numeric_projection_is_named():
    with pytest.raises(KernelTraceError, match=r"\.sum\(\) needs a numeric"):
        kernel(A_ROW, lambda a: a.sum(lambda r: r.g))
    with pytest.raises(KernelTraceError, match=r"\.mean\(\) needs a numeric"):
        kernel(A_ROW, lambda a: a.mean(lambda r: r.g))


def test_non_boolean_predicate_is_named():
    with pytest.raises(KernelTraceError, match=r"\.every\(\) predicate must return Boolean"):
        kernel(S_I, lambda s: s.every(lambda e: e + 1))
    with pytest.raises(KernelTraceError, match=r"\.some\(\) predicate must return Boolean"):
        kernel(D_SF, lambda d: d.some(lambda k, v: v * 2.0))


def test_reduce_accumulator_mismatch_is_named():
    with pytest.raises(KernelTraceError, match=r"\.reduce\(\) step returns"):
        kernel(S_I, lambda s: s.reduce(0, lambda a, e: a > e))


def test_reduce_on_an_array_points_at_fold():
    with pytest.raises(KernelTraceError, match="fold"):
        kernel(A_F, lambda a: a.reduce(0.0, lambda acc, el: acc + el))


def test_maximum_on_a_set_is_refused_not_silently_wrong():
    """EastSet has no eager `maximum`, so the traced surface must not invent
    one — the error should name the surface rather than mis-dispatch."""
    with pytest.raises(KernelTraceError):
        kernel(S_I, lambda s: s.maximum())


# ── the projection may take the index, as it may eagerly ─────────────────────

@pytest.mark.parametrize("name", ["sum", "mean", "maximum", "minimum"])
def test_index_taking_projection_traces_like_it_runs_eagerly(name):
    """`a.sum(lambda el, i: ...)` is a supported EAGER call (every eager
    reduction normalises the arity through `_callback_arity`), so it has to
    trace too — otherwise a working lambda simply stops working inside a
    kernel. `some`/`every` already threaded the index, which is what made the
    omission an internal inconsistency rather than a deliberate limit.
    """
    ints = EastArray(IntegerType, [1, 2, 3, 4])
    t = ArrayType(IntegerType)
    traced = _native(lambda a: getattr(a, name)(lambda e, i: e * i), t, ints)
    _same(traced, getattr(ints, name)(lambda e, i: e * i))


def test_index_taking_predicate_traces_for_quantifiers():
    ints = EastArray(IntegerType, [5, 6, 7])
    t = ArrayType(IntegerType)
    assert _native(lambda a: a.some(lambda e, i: i == 2), t, ints) is ints.some(lambda e, i: i == 2)
    assert _native(lambda a: a.every(lambda e, i: e > i), t, ints) is ints.every(lambda e, i: e > i)


# ── mean evaluates its receiver exactly once ─────────────────────────────────

def _builtin_count(traced, param_type, builtin):
    """How many times ``builtin`` appears in the traced IR."""
    from east.kernel import trace
    from east.serialization.json import encode_json_for
    from east.types.type_of_type import IRType

    ir, _out = trace(traced, [param_type])
    encoded = encode_json_for(IRType)(ir)
    text = encoded.decode() if isinstance(encoded, bytes) else encoded
    return text.count(f'"{builtin}"')


def _builtin_count_inside_callbacks(traced, param_type, builtin):
    """How many times ``builtin`` appears INSIDE a per-element callback.

    `_builtin_count` counts occurrences in the whole IR, which is 1 whether a
    target is `Let`-bound at block level or spliced into the per-element probe
    — the Let changes WHERE it is evaluated, not how many nodes exist. So the
    "evaluates its target once" tests could not fail: deleting the binding left
    them green while the operation went quadratic (measured 3 300x at n=8000).

    Walk the traced IR and count only occurrences under a Function node other
    than the kernel's own top-level one. Spliced -> >= 1; Let-bound -> 0.
    """
    from east.kernel import trace
    from east.types.values import is_east_struct, is_east_variant

    ir, _out = trace(traced, [param_type])
    hits = 0

    def walk(node, in_callback):
        nonlocal hits
        if isinstance(node, (list, tuple)) or hasattr(node, "element_type"):
            for x in node:
                walk(x, in_callback)
            return
        if is_east_struct(node):
            for _f, v in node.items():
                walk(v, in_callback)
            return
        if not is_east_variant(node):
            return
        if node.type == "Builtin" and node.value["builtin"] == builtin and in_callback:
            hits += 1
        inner = in_callback or node.type == "Function"
        payload = node.value
        if is_east_struct(payload):
            for fname, v in payload.items():
                if fname in ("type", "loc_id", "type_parameters", "builtin", "name"):
                    continue
                walk(v, inner)

    # the kernel's own outermost Function is not a per-element callback
    body = ir.value["body"] if ir.type == "Function" else ir
    walk(body, False)
    return hits


@pytest.mark.parametrize("builtin", ["ArrayFilter", "ArraySort"])
def test_mean_does_not_duplicate_a_computed_receiver(builtin):
    """`mean` reads the receiver twice — the fold and `size()`.

    At the TOP level `_finalize_ir`'s CSE rescues that, but inside an inner
    lambda the receiver closes over the inner parameter, the hoist is refused
    (`fv <= param_names`), and an unbound receiver would be emitted AND RUN
    twice — squaring with each nesting level. So `mean` binds it to a Let.
    A value-only assertion cannot see this; count the IR nodes.
    """
    stage = (lambda b: b.filter(lambda r: r.n > 0)) if builtin == "ArrayFilter" \
        else (lambda b: b.sorted(lambda r: r.n))
    nested_mean = lambda a: a.group_by(lambda r: r.g).map(  # noqa: E731
        lambda b: stage(b).mean(lambda r: r.v))
    nested_sum = lambda a: a.group_by(lambda r: r.g).map(  # noqa: E731
        lambda b: stage(b).sum(lambda r: r.v))
    # `sum` reads the receiver once, so it is the baseline `mean` must match
    assert _builtin_count(nested_sum, A_ROW, builtin) == 1
    assert _builtin_count(nested_mean, A_ROW, builtin) == 1


def test_nested_group_mean_matches_eager():
    rows = _rows()
    got = _native(lambda a: a.group_by(lambda r: r.g).map(lambda b: b.mean(lambda r: r.v)),
                  A_ROW, rows)
    want = rows.group_mean(lambda r: r["g"], lambda r: r["v"])
    assert dict(got.items()) == dict(want.items())


# ── struct fields win over same-named methods ────────────────────────────────

@pytest.mark.parametrize("field", ["sum", "mean", "maximum", "minimum", "reduce", "map", "size"])
def test_a_struct_field_is_not_shadowed_by_a_method_of_the_same_name(field):
    """`sum`, `mean` and `count` are ordinary column names.

    `__getattr__` only fires when normal lookup FAILS, so every method on
    KernelExpr shadows a struct field of the same name — and the failure is
    opaque ("cannot lift python value of type method"). A Struct-typed
    expression has no collection methods at all, so the field must win.
    """
    from east.types.types import BooleanType

    Row = StructType([(field, IntegerType), ("other", BooleanType)])
    rows = EastArray(Row, [{field: 7, "other": True}])
    got = _native(lambda a: a.map(lambda r: getattr(r, field)), ArrayType(Row), rows)
    assert list(got) == [7]
    # the item-access spelling keeps working too
    assert list(_native(lambda a: a.map(lambda r: r[field]), ArrayType(Row), rows)) == [7]


def test_the_methods_still_work_on_real_collections():
    xs = EastArray(FloatType, [1.0, 2.0, 3.0])
    _same(_native(lambda a: a.sum(), A_F, xs), xs.sum())
    _same(_native(lambda a: a.mean(), A_F, xs), xs.mean())


# ── the arity oracle is the eager one ────────────────────────────────────────

def test_a_bound_method_projection_traces_like_it_runs_eagerly():
    """A bound method's `__code__.co_argcount` counts `self`, so a hand-rolled
    arity probe calls it with an extra argument. Deferring to the eager
    `_callback_arity` (inspect.signature) keeps the two paths in step —
    `map_reduce` with a bound-method projection worked before #525 and must
    keep working."""
    class Proj:
        def value(self, r):          # one REAL parameter; co_argcount says 2
            return r["n"]

    p = Proj()
    rows = _rows()
    _same(_native(lambda a: a.sum(p.value), A_ROW, rows), rows.sum(p.value))
    _same(_native(lambda a: a.maximum(p.value), A_ROW, rows), rows.maximum(p.value))
    got = _native(lambda a: a.map_reduce(p.value, lambda x, y: x + y), A_ROW, rows)
    _same(got, rows.map_reduce(p.value, lambda x, y: x + y))


# ── the set algebra is complete on the traced surface ────────────────────────

def test_is_superset_of_traces_like_its_mirror():
    """#526 added the eager method; without the traced twin the whole set
    algebra traced except this one member, silently dropping an enclosing
    loop to the per-element path."""
    a = EastSet(IntegerType, [1, 2, 3])
    b = EastSet(IntegerType, [1, 2])
    t = SetType(IntegerType)
    assert _native(lambda s: s.is_superset_of(b), t, a) is a.is_superset_of(b) is True
    assert _native(lambda s: s.is_superset_of(a), t, b) is b.is_superset_of(a) is False
    # it is is_subset with the operands swapped, in both paths
    assert _native(lambda s: s.is_superset_of(b), t, a) is _native(lambda s: s.is_subset(a), t, b)


# ── find_* (#525 phase 2) ────────────────────────────────────────────────────

_SORTED = [1, 2, 2, 2, 5, 8]


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda a: a.find_first(2), lambda a: a.find_first(2)),
        (lambda a: a.find_first(99), lambda a: a.find_first(99)),
        (lambda a: a.find_all(2), lambda a: a.find_all(2)),
        (lambda a: a.find_all(99), lambda a: a.find_all(99)),
        (lambda a: a.find_sorted_first(2), lambda a: a.find_sorted_first(2)),
        (lambda a: a.find_sorted_last(2), lambda a: a.find_sorted_last(2)),
        (lambda a: a.find_sorted_range(2), lambda a: a.find_sorted_range(2)),
        (lambda a: a.find_sorted_range(3), lambda a: a.find_sorted_range(3)),  # absent
        (lambda a: a.find_maximum(), lambda a: a.find_maximum()),
        (lambda a: a.find_minimum(), lambda a: a.find_minimum()),
    ],
)
def test_find_family_matches_eager(traced, eager):
    xs = EastArray(IntegerType, _SORTED)
    got, want = _native(traced, ArrayType(IntegerType), xs), eager(xs)
    assert got == want


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda a: a.find_first(4.5, lambda r: r.v), lambda a: a.find_first(4.5, key=lambda r: r["v"])),
        (lambda a: a.find_all("g1", lambda r: r.g), lambda a: a.find_all("g1", by=lambda r: r["g"])),
        (lambda a: a.find_maximum(lambda r: r.v), lambda a: a.find_maximum(by=lambda r: r["v"])),
        (lambda a: a.find_minimum(lambda r: r.v), lambda a: a.find_minimum(by=lambda r: r["v"])),
    ],
)
def test_find_family_with_a_projection_matches_eager(traced, eager):
    rows = _rows()
    assert _native(traced, A_ROW, rows) == eager(rows)


def test_find_extremes_on_empty_are_none_like_eager():
    """`find_maximum` returns `none` for an empty array while `maximum` itself
    RAISES, and a kernel cannot test the length at trace time — so the guard
    is a `where`, which compiles to IfElse and evaluates one branch."""
    empty = EastArray(ROW, [])
    for traced, eager in (
        (lambda a: a.find_maximum(lambda r: r.v), lambda a: a.find_maximum(by=lambda r: r["v"])),
        (lambda a: a.find_minimum(lambda r: r.v), lambda a: a.find_minimum(by=lambda r: r["v"])),
    ):
        assert _native(traced, A_ROW, empty) == eager(empty)


def test_find_uses_east_total_order_not_python_order():
    words = EastArray(StringType, ["pear", "apple", "fig"])
    t = ArrayType(StringType)
    assert _native(lambda a: a.find_maximum(), t, words) == words.find_maximum()
    assert _native(lambda a: a.find_minimum(), t, words) == words.find_minimum()


def test_find_target_type_mismatch_is_named():
    with pytest.raises(KernelTraceError, match="same East type"):
        kernel(A_ROW, lambda a: a.find_first("nope", lambda r: r.v))
    with pytest.raises(KernelTraceError, match="same East type"):
        kernel(A_ROW, lambda a: a.find_all(1, lambda r: r.g))


@pytest.mark.parametrize(
    ("stage", "builtin"),
    [("sorted", "ArraySort"), ("filter", "ArrayFilter")],
)
@pytest.mark.parametrize("method", ["find_maximum", "find_minimum", "find_all"])
def test_find_does_not_duplicate_a_computed_receiver(stage, builtin, method):
    """`find_maximum`/`find_minimum` read the receiver three times (size, the
    extreme, the search) and `find_all` twice — the same trap `mean` fell
    into. Count IR nodes; a value assertion cannot see duplicated work."""
    step = (lambda b: b.sorted(lambda r: r.n)) if stage == "sorted" \
        else (lambda b: b.filter(lambda r: r.n > 0))
    call = (lambda b: step(b).find_all(1.5, lambda r: r.v)) if method == "find_all" \
        else (lambda b: getattr(step(b), method)(lambda r: r.v))
    nested = lambda a: a.group_by(lambda r: r.g).map(call)  # noqa: E731
    assert _builtin_count(nested, A_ROW, builtin) == 1


def test_find_compares_in_the_projection_type_not_the_target_type():
    """The comparison type comes from the PROJECTION, so an `int` target
    against Float data means what a reader expects — in BOTH paths.

    Deriving it from the target (as the eager search family did until #525)
    was wrong twice: `Array<Float>.find_first(2)` compared an Integer against
    Floats under East's cross-type total order and answered `none`, while
    `find_all(2)` on the same array answered `[1, 2]`; and with a key it
    declared a Float projection as Integer, silently TRUNCATING 2.7 to 2 and
    reporting a match that does not exist.
    """
    xs = EastArray(FloatType, [1.0, 2.0, 2.0, 5.0])
    t = ArrayType(FloatType)
    # eager is now self-consistent...
    assert list(xs.find_all(2)) == [1, 2]
    assert xs.find_first(2) == some(1)
    # ...and traced agrees with it
    assert _native(lambda a: a.find_first(2), t, xs) == xs.find_first(2) == some(1)
    assert _native(lambda a: a.find_sorted_first(2), t, xs) == xs.find_sorted_first(2) == 1
    assert _native(lambda a: a.find_sorted_last(2), t, xs) == xs.find_sorted_last(2) == 3

    # no silent truncation of a Float projection to the target's Integer type
    Row = StructType([("v", FloatType)])
    rows = array(Row, [{"v": 1.2}, {"v": 2.7}, {"v": 3.9}])
    assert rows.find_first(2, key=lambda r: r["v"]) == none
    assert _native(lambda a: a.find_first(2, lambda r: r.v), ArrayType(Row), rows) == none


def test_find_all_evaluates_an_expression_target_once():
    """The probe lives INSIDE the per-element callback, so an expression
    target spliced into it would be recomputed per element — measured O(N^2),
    3.7s at N=4000 against 1.3ms for the same search via `find_first`. The
    target binds to a Let, so the search-side builtin sits at the kernel body,
    not in the callback."""
    rows = _rows()
    nested = lambda a: a.find_all(a.maximum(lambda r: r.v), lambda r: r.v)  # noqa: E731
    # The target (`maximum` -> ArrayMapReduce) must be evaluated at BLOCK level,
    # not inside the per-element probe. A whole-IR count cannot see this — it is
    # 1 either way — so check WHERE the node sits.
    assert _builtin_count_inside_callbacks(nested, A_ROW, "ArrayMapReduce") == 0
    assert _builtin_count(nested, A_ROW, "ArrayMapReduce") == 1
    got = _native(nested, A_ROW, rows)
    want = rows.find_all(rows.maximum(lambda r: r["v"]), by=lambda r: r["v"])
    assert list(got) == list(want)


@pytest.mark.parametrize(
    ("build", "builtin"),
    [
        (lambda a: a.find_maximum(lambda r: r.v), "ArrayMapReduce"),
        (lambda a: a.find_minimum(lambda r: r.v), "ArrayMapReduce"),
        (lambda a: a.mean(lambda r: r.v), "ArrayFold"),
    ],
)
def test_a_reused_composed_expression_binds_once(build, builtin):
    """Binding the receiver must not cost the CSE.

    `_finalize_ir`'s `free_vars` had no Block/Let case, so a Block's OWN
    Let-bound name looked free, `fv <= param_names` failed, and every
    receiver-binding expression became un-hoistable — reusing one re-emitted
    and RE-EXECUTED it per use site. Reuse the SAME object twice: identity is
    what the CSE keys on.
    """
    reuse = lambda a: (lambda m: {"x": m, "y": m})(build(a))  # noqa: E731
    assert _builtin_count(reuse, A_ROW, builtin) == 1


# ── composition: a whole aggregate is one compiled kernel ────────────────────

def test_group_then_reduce_is_one_native_kernel():
    """The point of the surface: `group_by` + a per-group reduction in ONE
    kernel, no intermediate crossing back into python."""
    rows = _rows()
    got = _native(
        lambda a: a.group_by(lambda r: r.g).map(lambda bucket: bucket.sum(lambda r: r.v)),
        A_ROW,
        rows,
    )
    want = rows.group_sum(lambda r: r["g"], lambda r: r["v"])
    assert dict(got.items()) == dict(want.items())


def test_mean_over_a_filtered_projection_is_one_kernel():
    rows = _rows()
    got = _native(lambda a: a.filter(lambda r: r.n % 2 == 0).mean(lambda r: r.v), A_ROW, rows)
    want = rows.filter(lambda r: r["n"] % 2 == 0).mean(lambda r: r["v"])
    _same(got, want)


# ── group_* (#525 phase 3) ───────────────────────────────────────────────────
#
# The grouped fold is the primitive and everything else composes from it, so a
# whole aggregate is ONE compiled kernel. Names mirror the eager twins per
# container: Array spells the general fold `group_reduce`, Set and Dict spell it
# `group_fold`, and Set/Dict have no group_maximum/group_minimum because their
# eager surfaces do not either.

_G_SET = SetType(IntegerType)


def _set_i():
    return EastSet(IntegerType, list(range(12)))


def _dict_kf():
    return EastDict(StringType, FloatType, {f"k{i:02d}": float(i) for i in range(12)})


def _same_dict(got, want):
    """Compare two result dicts by TYPE as well as by contents.

    Contents alone pin almost nothing here. Python's ``{0: 4} == {0: 4.0}`` is
    True, so an Integer-vs-Float divergence in the RESULT TYPE passes a
    contents-only assertion on non-empty input; and two empty dicts compare
    equal however they are typed, so on empty input it pins nothing at all.
    A dict's key/value type is part of a kernel's compiled signature and
    propagates into whatever consumes it, so it is the thing to assert.
    """
    assert (got.key_type, got.value_type) == (want.key_type, want.value_type), (
        f"result TYPE diverged: traced Dict<{got.key_type.type},{got.value_type.type}> "
        f"vs eager Dict<{want.key_type.type},{want.value_type.type}>")
    assert dict(got.items()) == dict(want.items())


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda a: a.group_reduce(lambda r: r.g, lambda _k: 0.0, lambda acc, r: acc + r.v),
         lambda a: a.group_reduce(lambda r: r["g"], lambda _k: 0.0, lambda acc, r: acc + r["v"])),
        (lambda a: a.group_size(lambda r: r.g), lambda a: a.group_size(lambda r: r["g"])),
        (lambda a: a.group_sum(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_sum(lambda r: r["g"], lambda r: r["v"])),
        (lambda a: a.group_sum(lambda r: r.g, lambda r: r.n),
         lambda a: a.group_sum(lambda r: r["g"], lambda r: r["n"])),
        (lambda a: a.group_mean(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_mean(lambda r: r["g"], lambda r: r["v"])),
        (lambda a: a.group_mean(lambda r: r.g, lambda r: r.n),
         lambda a: a.group_mean(lambda r: r["g"], lambda r: r["n"])),
        # DISCRIMINATING: true for g0 only, so an implementation that ignored
        # the predicate (returning the seed per group) would fail here.
        (lambda a: a.group_every(lambda r: r.g, lambda r: r.n % 3 == 0),
         lambda a: a.group_every(lambda r: r["g"], lambda r: r["n"] % 3 == 0)),
        (lambda a: a.group_every(lambda r: r.g, lambda r: r.v >= 0.0),
         lambda a: a.group_every(lambda r: r["g"], lambda r: r["v"] >= 0.0)),
        (lambda a: a.group_some(lambda r: r.g, lambda r: r.v > 60.0),
         lambda a: a.group_some(lambda r: r["g"], lambda r: r["v"] > 60.0)),
        (lambda a: a.group_maximum(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_maximum(lambda r: r["g"], lambda r: r["v"])),
        (lambda a: a.group_minimum(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_minimum(lambda r: r["g"], lambda r: r["v"])),
    ],
)
def test_array_group_matches_eager(traced, eager):
    rows = _rows()
    _same_dict(_native(traced, A_ROW, rows), eager(rows))


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda s: s.group_fold(lambda e: e % 3, lambda _k: 0, lambda acc, e: acc + e),
         lambda s: s.group_fold(lambda e: e % 3, lambda _k: 0, lambda acc, e: acc + e)),
        (lambda s: s.group_size(lambda e: e % 3), lambda s: s.group_size(lambda e: e % 3)),
        (lambda s: s.group_sum(lambda e: e % 3), lambda s: s.group_sum(lambda e: e % 3)),
        (lambda s: s.group_mean(lambda e: e % 3), lambda s: s.group_mean(lambda e: e % 3)),
        (lambda s: s.group_every(lambda e: e % 3, lambda e: e < 6),
         lambda s: s.group_every(lambda e: e % 3, lambda e: e < 6)),
        (lambda s: s.group_every(lambda e: e % 3, lambda e: e >= 0),
         lambda s: s.group_every(lambda e: e % 3, lambda e: e >= 0)),
        (lambda s: s.group_some(lambda e: e % 3, lambda e: e > 9),
         lambda s: s.group_some(lambda e: e % 3, lambda e: e > 9)),
    ],
)
def test_set_group_matches_eager(traced, eager):
    s = _set_i()
    _same_dict(_native(traced, _G_SET, s), eager(s))


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda d: d.group_fold(lambda k, v: k.substring(0, 2), lambda _k: 0.0,
                                lambda acc, k, v: acc + v),
         lambda d: d.group_fold(lambda k, v: k[:2], lambda _k: 0.0, lambda acc, k, v: acc + v)),
        (lambda d: d.group_size(lambda k, v: k.substring(0, 2)),
         lambda d: d.group_size(lambda k, v: k[:2])),
        (lambda d: d.group_sum(lambda k, v: k.substring(0, 2)),
         lambda d: d.group_sum(lambda k, v: k[:2])),
        (lambda d: d.group_mean(lambda k, v: k.substring(0, 2)),
         lambda d: d.group_mean(lambda k, v: k[:2])),
        (lambda d: d.group_every(lambda k, v: k.substring(0, 2), lambda k, v: v < 9.0),
         lambda d: d.group_every(lambda k, v: k[:2], lambda k, v: v < 9.0)),
        (lambda d: d.group_every(lambda k, v: k.substring(0, 2), lambda k, v: v >= 0.0),
         lambda d: d.group_every(lambda k, v: k[:2], lambda k, v: v >= 0.0)),
        (lambda d: d.group_some(lambda k, v: k.substring(0, 2), lambda k, v: v > 9.0),
         lambda d: d.group_some(lambda k, v: k[:2], lambda k, v: v > 9.0)),
    ],
)
def test_dict_group_matches_eager(traced, eager):
    d = _dict_kf()
    _same_dict(_native(traced, D_SF, d), eager(d))


def test_group_fold_and_group_reduce_are_container_specific():
    """Each container exposes the name its EAGER twin uses — a traced name
    with no eager counterpart is the divergence #526/#527 were about."""
    # a Set has no group_reduce — the error points at its own spelling
    with pytest.raises(KernelTraceError, match="group_fold"):
        kernel(_G_SET, lambda s: s.group_reduce(lambda e: e, lambda _k: 0, lambda acc, e: acc))
    # ...and an Array has no group_fold
    with pytest.raises(KernelTraceError, match="group_reduce"):
        kernel(A_ROW, lambda a: a.group_fold(lambda r: r.g, lambda _k: 0, lambda acc, r: acc))


def test_group_extremes_are_array_only_like_eager():
    """EastSet/EastDict have no eager group_maximum, so the traced surface
    must not invent one.

    `match=` matters here: without it the guard could be deleted outright and
    the test would still pass on the unrelated `KernelTraceError` a later arity
    failure raises.
    """
    with pytest.raises(KernelTraceError, match=r"group_maximum\(\) on Set"):
        kernel(_G_SET, lambda s: s.group_maximum(lambda e: e % 3))
    with pytest.raises(KernelTraceError, match=r"group_minimum\(\) on Dict"):
        kernel(D_SF, lambda d: d.group_minimum(lambda k, v: k))


def test_group_mean_accumulates_in_element_order():
    """group_mean folds `{t, n}` in one pass rather than merging a counts dict
    (a mutation, so it has no traced form) — the sum must still be accumulated
    in element order, which catastrophic cancellation makes observable."""
    Row = StructType([("g", StringType), ("v", FloatType)])
    rows = array(Row, [{"g": "a", "v": v} for v in (1e16, 1.0, -1e16, 1.0)])
    got = _native(lambda a: a.group_mean(lambda r: r.g, lambda r: r.v), ArrayType(Row), rows)
    want = rows.group_mean(lambda r: r["g"], lambda r: r["v"])
    assert dict(got.items()) == dict(want.items())


def test_a_whole_grouped_aggregate_is_one_native_kernel():
    """The point of the family: filter, group and aggregate in ONE kernel with
    no crossing back into python."""
    rows = _rows()
    got = _native(
        lambda a: a.filter(lambda r: r.n % 2 == 0).group_sum(lambda r: r.g, lambda r: r.v),
        A_ROW, rows)
    want = rows.filter(lambda r: r["n"] % 2 == 0).group_sum(lambda r: r["g"], lambda r: r["v"])
    assert dict(got.items()) == dict(want.items())


def test_group_every_actually_reads_its_predicate():
    """A guard against a no-op implementation.

    Every group_every case above used to hold for EVERY element, so the seed
    and the answer coincided and an implementation that ignored the predicate
    passed the whole suite (proven by mutation). These groups must differ.
    """
    rows = _rows()
    got = _native(lambda a: a.group_every(lambda r: r.g, lambda r: r.n % 3 == 0), A_ROW, rows)
    assert dict(got.items()) == {"g0": True, "g1": False, "g2": False}
    assert dict(got.items()) == dict(
        rows.group_every(lambda r: r["g"], lambda r: r["n"] % 3 == 0).items())


# Each case carries the RESULT TYPE it must produce on empty input, chosen so
# the old degenerate bail (a dict typed from the SOURCE) would be visibly
# wrong: an Array of structs keyed by String, a Set<String> counted to Integer,
# a Dict<String,Float> keyed by a BOOLEAN projection. Comparing traced against
# eager alone is not enough — with a callback the tracer cannot type, BOTH
# sides take the fallback and agree while both are wrong.
_EMPTY_ARRAY_CASES = [
    ("group_reduce", "String", "Float",
     lambda a: a.group_reduce(lambda r: r.g, lambda _k: 0.0, lambda acc, r: acc + r.v),
     lambda a: a.group_reduce(lambda r: r["g"], lambda _k: 0.0, lambda acc, r: acc + r["v"])),
    ("group_size", "String", "Integer",
     lambda a: a.group_size(lambda r: r.g), lambda a: a.group_size(lambda r: r["g"])),
    ("group_sum_float", "String", "Float",
     lambda a: a.group_sum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_sum(lambda r: r["g"], lambda r: r["v"])),
    ("group_sum_int", "String", "Integer",
     lambda a: a.group_sum(lambda r: r.g, lambda r: r.n),
     lambda a: a.group_sum(lambda r: r["g"], lambda r: r["n"])),
    # an INTEGER projection still means a FLOAT mean
    ("group_mean_int_proj", "String", "Float",
     lambda a: a.group_mean(lambda r: r.g, lambda r: r.n),
     lambda a: a.group_mean(lambda r: r["g"], lambda r: r["n"])),
    ("group_every", "String", "Boolean",
     lambda a: a.group_every(lambda r: r.g, lambda r: r.n > 0),
     lambda a: a.group_every(lambda r: r["g"], lambda r: r["n"] > 0)),
    ("group_some", "String", "Boolean",
     lambda a: a.group_some(lambda r: r.g, lambda r: r.n > 0),
     lambda a: a.group_some(lambda r: r["g"], lambda r: r["n"] > 0)),
    # the two names phase 3 newly traced — both compose `_group_extreme`,
    # whose empty bail the first fix pass missed
    ("group_maximum", "String", "Float",
     lambda a: a.group_maximum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_maximum(lambda r: r["g"], lambda r: r["v"])),
    ("group_minimum", "String", "Float",
     lambda a: a.group_minimum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_minimum(lambda r: r["g"], lambda r: r["v"])),
]

_EMPTY_SET_CASES = [
    ("group_fold", "Integer", "Integer",
     lambda s: s.group_fold(lambda e: e.length(), lambda _k: 0, lambda acc, e: acc + 1),
     lambda s: s.group_fold(lambda e: e.length(), lambda _k: 0, lambda acc, e: acc + 1)),
    # Set<String> counted to Integer: the degenerate bail said Dict<String,String>
    ("group_size", "String", "Integer",
     lambda s: s.group_size(lambda e: e), lambda s: s.group_size(lambda e: e)),
    ("group_mean", "String", "Float",
     lambda s: s.group_mean(lambda e: e, lambda e: e.length()),
     lambda s: s.group_mean(lambda e: e, lambda e: e.length())),
    ("group_every", "String", "Boolean",
     lambda s: s.group_every(lambda e: e, lambda e: e.length() > 0),
     lambda s: s.group_every(lambda e: e, lambda e: e.length() > 0)),
    ("group_some", "String", "Boolean",
     lambda s: s.group_some(lambda e: e, lambda e: e.length() > 0),
     lambda s: s.group_some(lambda e: e, lambda e: e.length() > 0)),
]

_EMPTY_DICT_CASES = [
    # a BOOLEAN group key over a Dict<String,Float>, so BOTH type parameters
    # differ from the source — the degenerate bail leaked both
    ("group_fold", "Boolean", "Float",
     lambda d: d.group_fold(lambda k, v: v > 5.0, lambda _k: 0.0, lambda acc, k, v: acc + v),
     lambda d: d.group_fold(lambda k, v: v > 5.0, lambda _k: 0.0, lambda acc, k, v: acc + v)),
    ("group_size", "Boolean", "Integer",
     lambda d: d.group_size(lambda k, v: v > 5.0), lambda d: d.group_size(lambda k, v: v > 5.0)),
    ("group_sum", "Boolean", "Float",
     lambda d: d.group_sum(lambda k, v: v > 5.0), lambda d: d.group_sum(lambda k, v: v > 5.0)),
    ("group_mean", "Boolean", "Float",
     lambda d: d.group_mean(lambda k, v: v > 5.0), lambda d: d.group_mean(lambda k, v: v > 5.0)),
    ("group_every", "Boolean", "Boolean",
     lambda d: d.group_every(lambda k, v: v > 5.0, lambda k, v: v > 0.0),
     lambda d: d.group_every(lambda k, v: v > 5.0, lambda k, v: v > 0.0)),
    ("group_some", "Boolean", "Boolean",
     lambda d: d.group_some(lambda k, v: v > 5.0, lambda k, v: v > 0.0),
     lambda d: d.group_some(lambda k, v: v > 5.0, lambda k, v: v > 0.0)),
]


@pytest.mark.parametrize(
    ("cases", "param_type", "make_empty"),
    [
        (_EMPTY_ARRAY_CASES, A_ROW, lambda: array(ROW, [])),
        (_EMPTY_SET_CASES, SetType(StringType), lambda: EastSet(StringType)),
        (_EMPTY_DICT_CASES, D_SF, lambda: EastDict(StringType, FloatType)),
    ],
    ids=["array", "set", "dict"],
)
def test_empty_group_result_type_matches_eager(cases, param_type, make_empty):
    """An EMPTY input still has a knowable result type — on ALL THREE containers.

    Eager used to bail out with a degenerate dict typed from the SOURCE
    (`(element_type, element_type)`, or `(key_type, value_type)`), so traced
    and eager disagreed about the RESULT TYPE — silently, since two empty
    dicts compare equal however they are typed.

    That is not a cosmetic divergence. A dict's key/value type is part of a
    kernel's compiled signature, so it propagates: seeding a per-chunk
    aggregation from an empty chunk gave `Set.group_mean` an INTEGER
    accumulator, and folding the real chunk's means into it truncated 2.5 to 2
    with no error raised. `Array.group_maximum` seeded from an empty partition
    raised `EastTypeError` on the merge instead. Which behaviour you got
    depended only on whether the enclosing loop happened to trace.

    Parametrized per container because the first fix pass covered Array alone
    and left the Set/Dict twins — and `_group_extreme` — untouched.

    Every eager callback here is East-typeable, which is the precondition for
    the guarantee: on an EMPTY container there is no element to sample, so a
    callback the tracer cannot type (a python builtin like `len`) leaves eager
    nothing whatsoever to infer from and it must still fall back. See
    :func:`test_an_untypeable_callback_on_empty_input_still_falls_back` — that
    residual case is inherent, not a gap in this fix.
    """
    for name, want_k, want_v, traced, eager in cases:
        empty = make_empty()
        got, want_d = _native(traced, param_type, empty), eager(empty)
        _same_dict(got, want_d)
        # ...and both must be the type a reader would predict, not merely the
        # same as each other: a callback the tracer cannot type sends BOTH
        # paths down the fallback, where they agree while both are wrong.
        assert (got.key_type.type, got.value_type.type) == (want_k, want_v), (
            f"{name}: expected Dict<{want_k},{want_v}>, "
            f"got Dict<{got.key_type.type},{got.value_type.type}>")


def test_every_eager_group_call_is_accepted_by_its_traced_twin():
    """Arity parity across the whole family, in the direction that matters.

    `group_size` shipped without eager's `key=None` default, so a working eager
    call stopped tracing — and that does not raise for the user, it silently
    drops the enclosing loop to the per-element python path. So the contract is
    one-directional: traced must require NO MORE arguments than eager, for
    every name on the surface.

    It cannot be an equality: `KernelExpr` is a single class serving all three
    tags, so Array's optional `key` is visible on a Set receiver too. Traced
    being LAXER is safe because the surplus form is rejected at trace time with
    a named error — pinned by the test below.
    """
    import inspect

    from east.kernel import _TRACED_SURFACE, KernelExpr
    from east.types.values.collections import EastArray, EastDict, EastSet

    eager_cls = {"Array": EastArray, "Set": EastSet, "Dict": EastDict}
    checked, stricter = 0, []
    for tag, names in _TRACED_SURFACE.items():
        for name in names:
            if not name.startswith("group_"):
                continue
            traced_fn = getattr(KernelExpr, name, None)
            eager_fn = getattr(eager_cls[tag], name, None)
            assert eager_fn is not None, f"{tag}.{name} has no eager twin"

            def required(fn):
                return sum(1 for p in inspect.signature(fn).parameters.values()
                           if p.name != "self" and p.default is inspect.Parameter.empty)

            checked += 1
            if required(traced_fn) > required(eager_fn):
                stricter.append(f"{tag}.{name}: traced needs {required(traced_fn)}"
                                f" but eager accepts {required(eager_fn)}")
    assert not stricter, stricter
    assert checked >= 15, f"only {checked} group_* names checked — the sweep missed the surface"


def test_group_size_defaults_to_the_identity_key_on_an_array():
    xs = EastArray(StringType, ["a", "b", "a"])
    got = _native(lambda a: a.group_size(), ArrayType(StringType), xs)
    assert dict(got.items()) == dict(xs.group_size().items()) == {"a": 2, "b": 1}
    # ...and Set/Dict require one, exactly as their eager twins do
    with pytest.raises(KernelTraceError, match="needs a key function"):
        kernel(_G_SET, lambda s: s.group_size())


def test_an_untypeable_callback_on_empty_input_falls_back_per_parameter():
    """The one case the empty-input guarantee does NOT cover, stated honestly.

    The rule is "derive from the type system, sample only as a fallback". On an
    empty container there is nothing to sample, so when the callback ALSO
    cannot be typed — a python builtin, or an impure lambda the purity scan
    refuses to trace — there is no information anywhere and eager must keep a
    source-typed guess. A kernel lambda is traceable by construction, so the
    traced path never hits this, and the two can then differ.

    The fallback is per TYPE PARAMETER, not all-or-nothing: an underivable key
    callback does not drag a perfectly derivable value type down with it. That
    is what the old single `if len(self) == 0` bail did, and why fixing it moved
    `group_size` from `Dict<String,String>` to `Dict<String,Integer>` even here.

    Pinned so the limit is a known, named boundary rather than a surprise.
    """
    empty = EastSet(StringType)
    # `len` is a python builtin: untraceable, and no element exists to sample
    assert _kernel_out_type(len, [StringType]) is None
    partly = empty.group_size(len)
    # the KEY falls back to the element type; the VALUE is still derived
    assert (partly.key_type.type, partly.value_type.type) == ("String", "Integer")
    # ...and the East-typeable spelling derives both
    typed = empty.group_size(lambda e: e.length())
    assert (typed.key_type.type, typed.value_type.type) == ("Integer", "Integer")


@pytest.mark.parametrize("tag", ["array", "set", "dict"])
def test_the_group_seed_really_receives_its_group_key(tag):
    """`init(group_key)` is documented to receive the KEY, and nothing pinned it.

    Every other `group_reduce`/`group_fold` case seeds from a constant
    (`lambda _k: 0`), so an implementation that passed the wrong thing — or
    nothing — would leave the whole suite green. Seed each group FROM its key
    so the result can only be right if the key arrived.
    """
    if tag == "array":
        rows = _rows()
        got = _native(
            lambda a: a.group_reduce(lambda r: r.n % 3, lambda k: k * 100,
                                     lambda acc, r: acc + 1),
            A_ROW, rows)
        want = rows.group_reduce(lambda r: r["n"] % 3, lambda k: k * 100,
                                 lambda acc, r: acc + 1)
    elif tag == "set":
        s = _set_i()
        got = _native(lambda x: x.group_fold(lambda e: e % 3, lambda k: k * 100,
                                             lambda acc, e: acc + e),
                      _G_SET, s)
        want = s.group_fold(lambda e: e % 3, lambda k: k * 100, lambda acc, e: acc + e)
    else:
        d = _dict_kf()
        got = _native(lambda x: x.group_fold(lambda k, v: v, lambda k: k * 1000.0,
                                             lambda acc, k, v: acc + v),
                      D_SF, d)
        want = d.group_fold(lambda k, v: v, lambda k: k * 1000.0,
                            lambda acc, k, v: acc + v)
    _same_dict(got, want)
    # ...and the seed must actually have moved the answer off the constant
    assert any(v != 0 for v in dict(got.items()).values())


# Eager `group_*` names with no traced twin. EMPTY as of #525 phase 3b, which
# closed the last seven (`group_to_*` on all three containers plus the Array
# `group_find_*` family). Every entry would be a working eager call that
# silently drops its enclosing loop to the per-element python path, so this
# stays as a ratchet: it may only ever shrink.
_UNTRACED_GROUP_NAMES: dict[str, set[str]] = {"Array": set(), "Set": set(), "Dict": set()}


def test_the_traced_group_surface_is_pinned_against_the_eager_one():
    """Every eager `group_*` is traced, or is listed as known-missing.

    The arity sweep above iterates `_TRACED_SURFACE`, so it can only check
    names that are ALREADY traced — an omission is invisible to it, which is
    exactly how seven of them survived phase 3. Drive the comparison from the
    EAGER surface instead.

    This matters more than a normal coverage gap: an untraced name does not
    raise. `try_push_down` simply fails and east-c trampolines once per
    element, so the only symptom is that the job takes hours (#524 measured
    6h02m for 729k rows). The list must only ever SHRINK.
    """
    from east.kernel import _TRACED_SURFACE
    from east.types.values.collections import EastArray, EastDict, EastSet

    regressions, stale = [], []
    for tag, cls in (("Array", EastArray), ("Set", EastSet), ("Dict", EastDict)):
        eager = {n for n in dir(cls) if n.startswith("group") and not n.startswith("_")}
        traced = {n for n in _TRACED_SURFACE[tag] if n.startswith("group")}
        known = _UNTRACED_GROUP_NAMES[tag]
        missing = eager - traced
        for name in sorted(missing - known):
            regressions.append(f"{tag}.{name} is eager-only and NOT in the known list")
        for name in sorted(known - missing):
            stale.append(f"{tag}.{name} is now traced — remove it from _UNTRACED_GROUP_NAMES")
    assert not regressions, regressions
    assert not stale, stale


def test_a_traced_group_name_always_has_an_eager_twin():
    """The other direction: the traced surface must not invent a name.

    A traced-only name is the divergence #526/#527 were about — code that
    works inside a kernel and fails outside it, or vice versa.
    """
    from east.kernel import _TRACED_SURFACE
    from east.types.values.collections import EastArray, EastDict, EastSet

    orphans = []
    for tag, cls in (("Array", EastArray), ("Set", EastSet), ("Dict", EastDict)):
        for name in sorted(n for n in _TRACED_SURFACE[tag] if n.startswith("group")):
            if not hasattr(cls, name):
                orphans.append(f"{tag}.{name} traces but has no eager twin")
    assert not orphans, orphans


# ── group_to_* / group_find_* (#525 phase 3b) ────────────────────────────────
#
# The last seven eager `group_*` names to gain traced twins. `group_to_*`
# accumulate into a COLLECTION, so their step mutates a per-group accumulator —
# hand-built IR, since the traced surface exposes no mutators. `group_find_*`
# are Array-only, like their eager twins.

_G_ROWS = [{"g": f"g{i % 3}", "v": float(i % 4), "n": i} for i in range(12)]


def _g_rows():
    return array(ROW, _G_ROWS)


def _norm(x):
    """Compare nested results structurally (Set/Array/Dict/Option alike)."""
    if hasattr(x, "items"):
        return {k: _norm(v) for k, v in x.items()}
    if hasattr(x, "element_type"):
        out = [_norm(e) for e in x]
        try:
            return sorted(out)
        except TypeError:
            return out
    if hasattr(x, "type") and hasattr(x, "value"):
        return (x.type, x.value)
    return x


@pytest.mark.parametrize(
    ("name", "traced", "eager"),
    [
        ("to_arrays", lambda a: a.group_to_arrays(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_to_arrays(lambda r: r["g"], lambda r: r["v"])),
        # no value fn: the elements themselves, which on an Array is group_by
        ("to_arrays_bare", lambda a: a.group_to_arrays(lambda r: r.g),
         lambda a: a.group_to_arrays(lambda r: r["g"])),
        ("to_sets", lambda a: a.group_to_sets(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_to_sets(lambda r: r["g"], lambda r: r["v"])),
        ("to_dicts", lambda a: a.group_to_dicts(lambda r: r.g, lambda r: r.n, lambda r: r.v),
         lambda a: a.group_to_dicts(lambda r: r["g"], lambda r: r["n"], lambda r: r["v"])),
        ("to_dicts_combine",
         lambda a: a.group_to_dicts(lambda r: r.g, lambda r: r.v, lambda r: r.v,
                                    lambda x, y: x + y),
         lambda a: a.group_to_dicts(lambda r: r["g"], lambda r: r["v"], lambda r: r["v"],
                                    lambda x, y: x + y)),
        ("find_all", lambda a: a.group_find_all(lambda r: r.g, 2.0, lambda r: r.v),
         lambda a: a.group_find_all(lambda r: r["g"], 2.0, lambda r: r["v"])),
        ("find_first", lambda a: a.group_find_first(lambda r: r.g, 2.0, lambda r: r.v),
         lambda a: a.group_find_first(lambda r: r["g"], 2.0, lambda r: r["v"])),
        ("find_maximum", lambda a: a.group_find_maximum(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_find_maximum(lambda r: r["g"], lambda r: r["v"])),
        ("find_minimum", lambda a: a.group_find_minimum(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_find_minimum(lambda r: r["g"], lambda r: r["v"])),
    ],
)
def test_array_group_to_and_find_match_eager(name, traced, eager):
    rows = _g_rows()
    assert _norm(_native(traced, A_ROW, rows)) == _norm(eager(rows))


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda s: s.group_to_arrays(lambda e: e % 3, lambda e: e % 2),
         lambda s: s.group_to_arrays(lambda e: e % 3, lambda e: e % 2)),
        (lambda s: s.group_to_sets(lambda e: e % 3, lambda e: e % 2),
         lambda s: s.group_to_sets(lambda e: e % 3, lambda e: e % 2)),
        (lambda s: s.group_to_dicts(lambda e: e % 3, lambda e: e, lambda e: e % 2),
         lambda s: s.group_to_dicts(lambda e: e % 3, lambda e: e, lambda e: e % 2)),
    ],
)
def test_set_group_to_match_eager(traced, eager):
    s = EastSet(IntegerType, list(range(12)))
    assert _norm(_native(traced, _G_SET, s)) == _norm(eager(s))


@pytest.mark.parametrize(
    ("traced", "eager"),
    [
        (lambda d: d.group_to_arrays(lambda k, v: v > 1.0, lambda k, v: v),
         lambda d: d.group_to_arrays(lambda k, v: v > 1.0, lambda k, v: v)),
        (lambda d: d.group_to_sets(lambda k, v: v > 1.0, lambda k, v: v),
         lambda d: d.group_to_sets(lambda k, v: v > 1.0, lambda k, v: v)),
        (lambda d: d.group_to_dicts(lambda k, v: v > 1.0, lambda k, v: k, lambda k, v: v),
         lambda d: d.group_to_dicts(lambda k, v: v > 1.0, lambda k, v: k, lambda k, v: v)),
    ],
)
def test_dict_group_to_match_eager(traced, eager):
    d = EastDict(StringType, FloatType, {f"k{i:02d}": float(i % 4) for i in range(12)})
    assert _norm(_native(traced, D_SF, d)) == _norm(eager(d))


def test_group_to_sets_collapses_duplicates():
    """The point of collecting into a set — and the defect the eager helper had.

    `_set_insert_field_kernel` emitted `SetInsert`, which ERRORS on an existing
    element, so eager `group_to_sets` raised `Set already contains key …` the
    moment two members of a group shared a value. The traced twin must collapse
    them, and so must eager (fixed to `SetTryInsert`).
    """
    rows = _g_rows()          # v cycles 0..3, so every group repeats values
    got = _native(lambda a: a.group_to_sets(lambda r: r.g, lambda r: r.v), A_ROW, rows)
    want = rows.group_to_sets(lambda r: r["g"], lambda r: r["v"])
    assert _norm(got) == _norm(want)
    # each group SAW 4 elements and kept 4 distinct values here...
    assert _norm(got) == {"g0": [0.0, 1.0, 2.0, 3.0], "g1": [0.0, 1.0, 2.0, 3.0],
                          "g2": [0.0, 1.0, 2.0, 3.0]}
    # ...so pin the collapse itself on data where it is the ONLY difference:
    # two identical values in one group must yield a one-element set, and under
    # the old SetInsert spelling this raised rather than collapsing.
    dupes = array(ROW, [{"g": "a", "v": 1.0, "n": 0}, {"g": "a", "v": 1.0, "n": 1}])
    assert _norm(_native(lambda a: a.group_to_sets(lambda r: r.g, lambda r: r.v),
                         A_ROW, dupes)) == {"a": [1.0]}


def test_group_find_all_keeps_groups_with_no_match():
    """A group whose members ALL failed still appears, with an empty array.

    That is the contract eager and TS `groupFindAll` both make, and it is why
    the traced form needs a second pass for the group set rather than just
    grouping the matches.
    """
    rows = _g_rows()
    got = _native(lambda a: a.group_find_all(lambda r: r.g, 3.0, lambda r: r.v), A_ROW, rows)
    want = rows.group_find_all(lambda r: r["g"], 3.0, lambda r: r["v"])
    assert _norm(got) == _norm(want)
    # a value present in NO group: every group still listed, all empty
    none_match = _native(lambda a: a.group_find_all(lambda r: r.g, 99.0, lambda r: r.v),
                         A_ROW, rows)
    assert _norm(none_match) == {"g0": [], "g1": [], "g2": []}
    assert set(none_match.keys()) == {"g0", "g1", "g2"}


def test_group_find_extremes_keep_the_earliest_index_on_a_tie():
    """A tie must report the FIRST index — the non-strict comparison in the
    collision handler is what makes that true, and a strict one would silently
    report the last."""
    tied = array(ROW, [{"g": "a", "v": 5.0, "n": 0}, {"g": "a", "v": 5.0, "n": 1},
                       {"g": "a", "v": 1.0, "n": 2}])
    for traced, eager in (
        (lambda a: a.group_find_maximum(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_find_maximum(lambda r: r["g"], lambda r: r["v"])),
        (lambda a: a.group_find_minimum(lambda r: r.g, lambda r: r.v),
         lambda a: a.group_find_minimum(lambda r: r["g"], lambda r: r["v"])),
    ):
        assert _norm(_native(traced, A_ROW, tied)) == _norm(eager(tied))
    assert _norm(_native(lambda a: a.group_find_maximum(lambda r: r.g, lambda r: r.v),
                         A_ROW, tied)) == {"a": 0}


def test_group_find_all_evaluates_an_expression_target_once():
    """The probe sits inside the per-element callback, so a spliced expression
    target would be recomputed per element — the O(N^2) trap `find_all`
    documents. The target binds to a Let instead."""
    nested = lambda a: a.group_find_all(  # noqa: E731
        lambda r: r.g, a.maximum(lambda r: r.v), lambda r: r.v)
    # WHERE the target sits is the whole point: a whole-IR count is 1 whether it
    # is Let-bound or spliced into the probe, so it cannot fail. Deleting the
    # binding measured 3 738 ms vs 2.43 ms at n=4000 with the suite still green.
    assert _builtin_count_inside_callbacks(nested, A_ROW, "ArrayMapReduce") == 0
    rows = _g_rows()
    got = _native(nested, A_ROW, rows)
    want = rows.group_find_all(lambda r: r["g"], rows.maximum(lambda r: r["v"]),
                               lambda r: r["v"])
    assert _norm(got) == _norm(want)


@pytest.mark.parametrize("builtin", ["ArraySort", "ArrayFilter"])
def test_group_find_all_does_not_duplicate_a_computed_receiver(builtin):
    """`group_find_all` scans the receiver TWICE (matches + the group set), so
    it binds it — the same trap `mean`/`find_*` fell into. Dropping the binding
    left the suite green while the receiver was re-executed per group."""
    stage = (lambda b: b.sorted(lambda r: r.n)) if builtin == "ArraySort" \
        else (lambda b: b.filter(lambda r: r.n > 0))
    nested = lambda a: a.group_by(lambda r: r.g).map(  # noqa: E731
        lambda b: stage(b).group_find_all(lambda r: r.g, 1.5, lambda r: r.v))
    assert _builtin_count(nested, A_ROW, builtin) == 1


def test_the_group_to_family_is_one_native_kernel():
    """filter → group → collect, with no crossing back into python."""
    rows = _g_rows()
    got = _native(
        lambda a: a.filter(lambda r: r.n % 2 == 0).group_to_sets(lambda r: r.g, lambda r: r.v),
        A_ROW, rows)
    want = rows.filter(lambda r: r["n"] % 2 == 0).group_to_sets(
        lambda r: r["g"], lambda r: r["v"])
    assert _norm(got) == _norm(want)


# ── flatten_to_dict / Set.to_set / Dict.union (#525 phase 4) ─────────────────
#
# The last three eager methods with no traced twin. With these the traced
# surface equals the eager one on every container.

_P4_ROW = StructType([("g", StringType), ("n", IntegerType), ("tags", ArrayType(StringType))])
_P4_A = ArrayType(_P4_ROW)


def test_array_flatten_to_dict_matches_eager():
    rows = array(_P4_ROW, [{"g": "a", "n": 1, "tags": ["p", "q"]},
                           {"g": "b", "n": 2, "tags": ["r"]}])
    got = _native(lambda a: a.flatten_to_dict(
        lambda r: r.tags.to_dict(lambda t: t, lambda _t: r.n)), _P4_A, rows)
    want = rows.flatten_to_dict(
        lambda r: r["tags"].to_dict(lambda t: t, lambda _t: r["n"]))
    _same_dict(got, want)


def test_set_and_dict_flatten_to_dict_match_eager():
    s = EastSet(IntegerType, [1, 2, 3])
    got = _native(lambda x: x.flatten_to_dict(lambda e: x.map(lambda y: y * e),
                                              lambda a, b: a + b), _G_SET, s)
    want = s.flatten_to_dict(lambda e: s.map(lambda y: y * e), lambda a, b: a + b)
    _same_dict(got, want)

    d = EastDict(StringType, IntegerType, {"x": 1, "y": 2})
    t = DictType(StringType, IntegerType)
    got_d = _native(lambda x: x.flatten_to_dict(
        lambda k, _v: x.filter(lambda k2, _v2: k2 == k)), t, d)
    want_d = d.flatten_to_dict(lambda k, _v: d.filter(lambda k2, _v2: k2 == k))
    _same_dict(got_d, want_d)


def test_set_to_set_traces_like_its_eager_twin():
    """The whole `to_*` family traced except this one member, so a working
    eager `EastSet.to_set(fn)` silently dropped its loop to python."""
    s = EastSet(IntegerType, [1, 2, 3, 4])
    got = _native(lambda x: x.to_set(lambda e: e % 2), _G_SET, s)
    assert sorted(got) == sorted(s.to_set(lambda e: e % 2)) == [0, 1]
    with pytest.raises(KernelTraceError, match="needs a projection"):
        kernel(_G_SET, lambda x: x.to_set())


def test_dict_union_is_pure_and_matches_eager():
    """The traced twin of the `EastDict.union` added in #527 — a copy plus an
    in-place merge, so neither input is modified."""
    t = DictType(StringType, IntegerType)
    d = EastDict(StringType, IntegerType, {"x": 1, "y": 2})
    other = EastDict(StringType, IntegerType, {"z": 9})
    got = _native(lambda a: a.union(other), t, d)
    _same_dict(got, d.union(other))
    assert dict(d.items()) == {"x": 1, "y": 2}          # receiver untouched
    assert dict(other.items()) == {"z": 9}              # argument untouched

    overlap = EastDict(StringType, IntegerType, {"x": 10})
    _same_dict(_native(lambda a: a.union(overlap, lambda p, q: p + q), t, d),
               d.union(overlap, lambda p, q: p + q))


def test_dict_union_overlap_without_a_combine_errors_on_both_paths():
    from east.runtime.errors import EastError

    t = DictType(StringType, IntegerType)
    d = EastDict(StringType, IntegerType, {"x": 1})
    overlap = EastDict(StringType, IntegerType, {"x": 5})
    with pytest.raises(EastError, match="exists in both dictionaries"):
        d.union(overlap)
    with pytest.raises(EastError, match="exists in both dictionaries"):
        kernel(t, lambda a: a.union(overlap))(d)
    # the message names the key, as eager and TS both do
    with pytest.raises(EastError, match='Key "?x"? exists in both'):
        kernel(t, lambda a: a.union(overlap))(d)


def test_a_set_union_still_takes_no_combine():
    """`union` now serves two containers; a Set has no values to combine, so
    passing one is a caller error rather than a silently ignored argument."""
    with pytest.raises(KernelTraceError, match="takes no combine"):
        kernel(_G_SET, lambda s: s.union(EastSet(IntegerType, [9]), lambda a, b: a))


# Keywords an eager method accepts that its traced twin does not. Two kinds:
#
# * a parameter NAME difference (traced `fn` where eager says `pred`/`key`/
#   `value_fn`) — a positional call behaves identically, only a keyword call
#   differs;
# * a genuinely missing `out=`/`key_out=`/`acc_out=` type pin. A kernel always
#   knows its types so the pin is redundant, but passing it raises TypeError
#   and the enclosing loop silently drops to the per-element python path —
#   the same defect `to_set` had, fixed in #525 phase 4.
#
# Tracked in #536. RATCHET: this list may only ever SHRINK.
_KNOWN_KEYWORD_GAPS = {
    "Array.every": {"pred"}, "Array.some": {"pred"},
    "Array.map": {"out"}, "Array.filter_map": {"out"}, "Array.map_reduce": {"out"},
    "Array.flatten_to_array": {"out"}, "Array.flatten_to_set": {"out"},
    "Set.every": {"pred"}, "Set.some": {"pred"}, "Set.to_array": {"key"},
    "Set.map": {"out"}, "Set.filter_map": {"out"},
    "Set.flatten_to_array": {"out"}, "Set.flatten_to_set": {"out"},
    "Dict.every": {"pred"}, "Dict.some": {"pred"}, "Dict.get": {"default"},
    "Dict.map": {"out"}, "Dict.filter_map": {"out"}, "Dict.map_reduce": {"out"},
    "Dict.to_array": {"out"}, "Dict.to_dict": {"key_out", "value_out"},
    "Dict.group_fold": {"acc_out", "key_out"},
    "Dict.group_to_arrays": {"value_fn"}, "Dict.group_to_sets": {"value_fn"},
    "Dict.group_to_dicts": {"value_fn"},
}


def test_the_traced_surface_now_equals_the_eager_one():
    """The epic's actual goal, asserted directly.

    Every public eager collection method has a traced twin. The exclusions are
    named rather than filtered by a fuzzy rule: mutators and side-effecting
    methods (the kernel language is pure), the columnar/bulk boundary helpers,
    and the python mapping VIEWS `items`/`keys`/`values` — whose East-value
    spelling is `keys_set`, which does trace.
    """
    from east.kernel import _TRACED_SURFACE, KernelExpr
    from east.types.values.collections import EastArray, EastDict, EastSet

    excluded = {
        # mutators / side effects
        "insert", "delete", "add", "discard", "remove", "clear", "append",
        "extend", "pop", "update", "union_in_place", "insert_or_update",
        "get_or_insert", "swap", "try_insert", "try_delete", "merge",
        "merge_key", "merge_all", "update_many", "for_each",
        # constructors and the columnar / bulk boundary
        "generate", "range", "linspace", "to_columns", "from_columns",
        "map_batches", "count", "index", "sort", "reverse",
        # python mapping views (the East spelling of `keys` is `keys_set`)
        "items", "keys", "values",
    }
    import inspect

    gaps = []
    for tag, cls in (("Array", EastArray), ("Set", EastSet), ("Dict", EastDict)):
        eager = {n for n in dir(cls)
                 if not n.startswith("_") and callable(getattr(cls, n, None))
                 and n not in excluded}
        for name in sorted(eager - set(_TRACED_SURFACE[tag])):
            gaps.append(f"{tag}.{name} is eager-only")
        # ...and the NAME existing is not enough: a traced twin that needs more
        # arguments, or refuses a keyword eager accepts, makes a working eager
        # call stop tracing — silently, which is the failure mode this whole
        # surface exists to prevent. Compare the SIGNATURES too.
        for name in sorted(eager & set(_TRACED_SURFACE[tag])):
            e_fn, t_fn = getattr(cls, name), getattr(KernelExpr, name, None)
            if t_fn is None or not callable(t_fn):
                continue
            try:
                e_p = inspect.signature(e_fn).parameters
                t_p = inspect.signature(t_fn).parameters
            except (TypeError, ValueError):
                continue
            def required(ps):
                return sum(1 for n, x in ps.items()
                           if n != "self" and x.default is inspect.Parameter.empty
                           and x.kind in (x.POSITIONAL_ONLY, x.POSITIONAL_OR_KEYWORD))
            if required(t_p) > required(e_p):
                gaps.append(f"{tag}.{name}: traced needs {required(t_p)} args, "
                            f"eager accepts {required(e_p)}")
            missing_kw = {n for n, x in e_p.items()
                          if n != "self" and x.default is not inspect.Parameter.empty} - set(t_p)
            missing_kw -= _KNOWN_KEYWORD_GAPS.get(f"{tag}.{name}", set())
            if missing_kw:
                gaps.append(f"{tag}.{name}: eager accepts {sorted(missing_kw)}, traced does not")
    assert not gaps, gaps


def test_group_find_first_reports_the_FIRST_match_not_the_last():
    """Two matches per group, so "first" is observable.

    The `_G_ROWS` fixture gives each group exactly one element equal to the
    probed value, so the row-order contract of `group_find_all` and the
    "first" contract of `group_find_first` were both unpinned — mutating
    `try_get(0)` to `reversed().try_get(0)`, and reversing the pair order, each
    left the whole suite green.
    """
    rows = array(ROW, [{"g": "a", "v": 1.0, "n": 0}, {"g": "b", "v": 9.0, "n": 1},
                       {"g": "a", "v": 1.0, "n": 2}, {"g": "b", "v": 1.0, "n": 3},
                       {"g": "b", "v": 1.0, "n": 4}])
    got_all = _native(lambda a: a.group_find_all(lambda r: r.g, 1.0, lambda r: r.v), A_ROW, rows)
    want_all = rows.group_find_all(lambda r: r["g"], 1.0, lambda r: r["v"])
    assert {k: list(v) for k, v in got_all.items()} == {"a": [0, 2], "b": [3, 4]}
    assert {k: list(v) for k, v in got_all.items()} == {k: list(v) for k, v in want_all.items()}

    got_first = _native(lambda a: a.group_find_first(lambda r: r.g, 1.0, lambda r: r.v),
                        A_ROW, rows)
    want_first = rows.group_find_first(lambda r: r["g"], 1.0, lambda r: r["v"])
    assert {k: (v.type, v.value) for k, v in got_first.items()} == {
        "a": ("some", 0), "b": ("some", 3)}
    assert {k: (v.type, v.value) for k, v in got_first.items()} == {
        k: (v.type, v.value) for k, v in want_first.items()}


def test_a_collision_handler_receives_existing_then_incoming():
    """Slot ORDER, pinned with a NON-commutative combine.

    Every `combine` in these tests was `x + y` on numbers, so swapping the two
    arguments left the suite green while `union` produced 'R|L' instead of
    'L|R'. Order is part of the contract: `existing` is this dict's value.
    """
    t = DictType(StringType, StringType)
    left = EastDict(StringType, StringType, {"x": "L"})
    right = EastDict(StringType, StringType, {"x": "R"})
    joined = _native(lambda a: a.union(right, lambda ex, inc: ex + "|" + inc), t, left)
    assert dict(joined.items()) == {"x": "L|R"}
    assert dict(joined.items()) == dict(left.union(right, lambda ex, inc: ex + "|" + inc).items())

    # ...and the same for to_dict's collision handler
    parts = array(StringType, ["a", "a"])
    got = _native(lambda a: a.to_dict(lambda p: p, lambda p: p, lambda ex, inc: ex + "|" + inc),
                  ArrayType(StringType), parts)
    assert dict(got.items()) == {"a": "a|a"}


def test_the_duplicate_key_error_message_is_unquoted_like_eager_and_ts():
    """A String key is printed BARE on all three runtimes.

    The traced path wrapped every key in the East `Print` builtin, which
    JSON-quotes a String, so the kernel's message read `key "a"` where eager
    and TS both read `key a`. The two tests written at the time used a
    `"?a"?` regex that accepted either, so CI could not see it.
    """
    from east.runtime.errors import EastError

    parts = array(StringType, ["b", "a", "c", "a"])
    t = ArrayType(StringType)
    with pytest.raises(EastError, match="Cannot insert duplicate key a into dict"):
        kernel(t, lambda a: a.to_dict(lambda p: p, value=lambda p: p.length()))(parts)
    with pytest.raises(EastError, match="Cannot insert duplicate key a into dict"):
        parts.to_dict(lambda p: p, value=lambda p: len(p))

    dt = DictType(StringType, IntegerType)
    d = EastDict(StringType, IntegerType, {"x": 1})
    o = EastDict(StringType, IntegerType, {"x": 5})
    with pytest.raises(EastError, match="Key x exists in both dictionaries"):
        kernel(dt, lambda a: a.union(o))(d)
    with pytest.raises(EastError, match="Key x exists in both dictionaries"):
        d.union(o)
    # a NON-String key still goes through Print, so an Integer key is bare too
    ints = array(IntegerType, [7, 7])
    with pytest.raises(EastError, match="duplicate key 7 into dict"):
        kernel(ArrayType(IntegerType), lambda a: a.to_dict(lambda p: p, value=lambda p: p))(ints)


def test_group_find_coerces_the_target_into_the_projection_type():
    """A python literal target must mean the same thing on both paths.

    The eager probe handed the raw literal to `East.equal(p_t, …)`, so an
    Integer `2` against a Float projection was NEVER equal under East's
    cross-type total order and `group_find_all` reported no matches — while the
    traced twin lifts with `hint=p_t`, coerces, and reports them. Same call,
    two answers, decided only by whether the enclosing lambda happened to
    trace. The ungrouped `find_*` family was fixed this way in phase 2; the
    grouped one goes through a different helper and was missed.
    """
    rows = array(ROW, [{"g": "a", "v": 2.0, "n": 0}, {"g": "a", "v": 3.0, "n": 1}])
    for target in (2, 2.0):
        got = _native(lambda a, _t=target: a.group_find_all(lambda r: r.g, _t, lambda r: r.v),
                      A_ROW, rows)
        want = rows.group_find_all(lambda r: r["g"], target, lambda r: r["v"])
        assert {k: list(v) for k, v in got.items()} == {"a": [0]}, f"target={target!r}"
        assert {k: list(v) for k, v in got.items()} == {k: list(v) for k, v in want.items()}
    # ...and group_find_first, which composes it
    first = rows.group_find_first(lambda r: r["g"], 2, lambda r: r["v"])
    assert {k: (v.type, v.value) for k, v in first.items()} == {"a": ("some", 0)}


@pytest.mark.parametrize("tag", ["array", "set", "dict"])
def test_group_to_dicts_accepts_a_three_argument_combine(tag):
    """`combine(existing, incoming, key)` is a supported EAGER call.

    `group_to_dicts` was the one collision site phase 4's `_with_key_arg`
    normalisation missed, so the 3-arg form raised inside an explicit kernel
    and — worse — silently trampolined (measured 203 per-element calls) when it
    appeared inside an enclosing lambda.
    """
    if tag == "array":
        rows = array(ROW, [{"g": "a", "v": 1.0, "n": 1}, {"g": "a", "v": 2.0, "n": 1}])
        traced = lambda a: a.group_to_dicts(  # noqa: E731
            lambda r: r.g, lambda r: r.n, lambda r: r.v, lambda ex, inc, _k: ex + inc)
        eager = lambda a: a.group_to_dicts(  # noqa: E731
            lambda r: r["g"], lambda r: r["n"], lambda r: r["v"], lambda ex, inc, _k: ex + inc)
        pt, val = A_ROW, rows
    elif tag == "set":
        val, pt = EastSet(IntegerType, [1, 2, 3, 4]), _G_SET
        traced = eager = lambda s: s.group_to_dicts(  # noqa: E731
            lambda e: e % 2, lambda _e: 0, lambda e: e, lambda ex, inc, _k: ex + inc)
    else:
        val = EastDict(StringType, FloatType, {"a": 1.0, "b": 2.0})
        pt = D_SF
        traced = eager = lambda d: d.group_to_dicts(  # noqa: E731
            lambda _k, _v: "g", lambda _k, _v: "same", lambda _k, v: v,
            lambda ex, inc, _k2: ex + inc)
    got, want = _native(traced, pt, val), eager(val)
    assert {k: dict(v.items()) for k, v in got.items()} == \
           {k: dict(v.items()) for k, v in want.items()}


_P4_EROW = StructType([("g", StringType), ("v", FloatType), ("n", IntegerType),
                       ("tags", ArrayType(StringType))])
_P4_EA = ArrayType(_P4_EROW)

_EMPTY_NEW_NAMES = [
    ("group_find_all", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_all(lambda r: r.g, 2.0, lambda r: r.v),
     lambda a: a.group_find_all(lambda r: r["g"], 2.0, lambda r: r["v"])),
    ("group_find_first", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_first(lambda r: r.g, 2.0, lambda r: r.v),
     lambda a: a.group_find_first(lambda r: r["g"], 2.0, lambda r: r["v"])),
    ("group_find_maximum", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_maximum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_find_maximum(lambda r: r["g"], lambda r: r["v"])),
    ("group_find_minimum", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_minimum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_find_minimum(lambda r: r["g"], lambda r: r["v"])),
    ("group_to_arrays", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_to_arrays(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_to_arrays(lambda r: r["g"], lambda r: r["v"])),
    ("group_to_sets", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_to_sets(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_to_sets(lambda r: r["g"], lambda r: r["v"])),
    ("group_to_dicts", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_to_dicts(lambda r: r.g, lambda r: r.n, lambda r: r.v),
     lambda a: a.group_to_dicts(lambda r: r["g"], lambda r: r["n"], lambda r: r["v"])),
    ("array_flatten_to_dict", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.flatten_to_dict(lambda r: r.tags.to_dict(lambda x: x, lambda _x: r.n)),
     lambda a: a.flatten_to_dict(lambda r: r["tags"].to_dict(lambda x: x, lambda _x: r["n"]))),
    ("set_flatten_to_dict", SetType(IntegerType), lambda: EastSet(IntegerType),
     lambda s: s.flatten_to_dict(lambda e: s.map(lambda y: y * e), lambda p, q: p + q),
     lambda s: s.flatten_to_dict(lambda e: s.map(lambda y: y * e), lambda p, q: p + q)),
    ("dict_flatten_to_dict", D_SF, lambda: EastDict(StringType, FloatType),
     lambda d: d.flatten_to_dict(lambda k, _v: d.filter(lambda k2, _v2: k2 == k)),
     lambda d: d.flatten_to_dict(lambda k, _v: d.filter(lambda k2, _v2: k2 == k))),
]


@pytest.mark.parametrize(("name", "param_type", "make", "traced", "eager"),
                         _EMPTY_NEW_NAMES, ids=[c[0] for c in _EMPTY_NEW_NAMES])
def test_the_newly_traced_names_agree_on_empty_input(name, param_type, make, traced, eager):
    """Every name phases 3b/4 traced, on an EMPTY receiver.

    The eager methods bailed out with a dict typed from the SOURCE while the
    new traced twins derive the real types, so the two disagreed on exactly the
    input where both look identical — two empty dicts compare equal however
    they are typed. It surfaces later: `empty.union(full)` raises
    `EastTypeError`, and `EastArray.flatten_to_dict` bailed to
    `(element_type, element_type)`, which on a struct with an Array field
    RAISES outright because a mutable type cannot key a Dict.

    Compare the TYPES; the contents are `{}` on both sides by construction.
    """
    empty = make()
    got, want = _native(traced, param_type, empty), eager(empty)
    assert (got.key_type, got.value_type) == (want.key_type, want.value_type), (
        f"{name}: traced Dict<{got.key_type.type},{got.value_type.type}> vs "
        f"eager Dict<{want.key_type.type},{want.value_type.type}>")
    assert dict(got.items()) == dict(want.items()) == {}


def test_set_to_set_agrees_on_empty_input():
    """Set.to_set returns a Set, not a Dict — same rule, different shape."""
    empty = EastSet(IntegerType)
    got = _native(lambda s: s.to_set(lambda e: e.to_float()), _G_SET, empty)
    want = empty.to_set(lambda e: e.to_float())
    assert got.element_type == want.element_type == FloatType
    assert list(got) == list(want) == []


def test_a_dict_group_to_value_projection_is_optional_on_both_paths():
    """TypeScript makes `valueFn` optional on all three `groupTo*`; east-py's
    eager Dict spellings required it, so the traced twin (which follows TS) was
    laxer than its own eager method — a call that traced fine raised outside a
    kernel."""
    d = EastDict(StringType, FloatType, {"a": 1.0, "b": 2.0})
    t = DictType(StringType, FloatType)
    for traced, eager in (
        (lambda x: x.group_to_arrays(lambda k, w: w > 1.0),
         lambda x: x.group_to_arrays(lambda k, w: w > 1.0)),
        (lambda x: x.group_to_sets(lambda k, w: w > 1.0),
         lambda x: x.group_to_sets(lambda k, w: w > 1.0)),
    ):
        got, want = _native(traced, t, d), eager(d)
        assert {k: sorted(v) for k, v in got.items()} == {k: sorted(v) for k, v in want.items()}


def test_dict_to_dict_accepts_a_two_argument_combine_like_its_siblings():
    """`EastDict.to_dict` wired its handler raw at 3 args while Array and Set
    both route through `_combine_cb`, which accepts 2 or 3 — so a 2-arg lambda
    that works on every other collection failed on a Dict alone."""
    d = EastDict(StringType, FloatType, {"a": 1.0, "b": 2.0})
    t = DictType(StringType, FloatType)
    got = _native(lambda x: x.to_dict(lambda k, v: "same", lambda k, v: v,
                                      combine=lambda p, q: p + q), t, d)
    want = d.to_dict(lambda k, v: "same", lambda k, v: v, lambda p, q: p + q)
    _same_dict(got, want)
    assert dict(got.items()) == {"same": 3.0}


def test_traced_to_set_accepts_the_out_keyword_its_eager_twin_takes():
    """`EastSet.to_set(fn, out=T)` is a documented eager call; the traced twin
    rejected the keyword, so it silently fell back to the per-element path."""
    s = EastSet(IntegerType, [1, 2, 3, 4])
    got = _native(lambda x: x.to_set(lambda e: e % 2, out=IntegerType), _G_SET, s)
    assert sorted(got) == sorted(s.to_set(lambda e: e % 2, out=IntegerType)) == [0, 1]
    # a contradictory out= is a caller error, not a silent relabel (#467)
    with pytest.raises(KernelTraceError, match="out= declares"):
        kernel(_G_SET, lambda x: x.to_set(lambda e: e % 2, out=SetType(IntegerType)))
