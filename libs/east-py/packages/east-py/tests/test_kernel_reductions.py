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
)
from east.kernel import KernelTraceError
from east.runtime.compiler import eager_stats
from east.types.values.collections import EastArray, EastDict, EastSet

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
