#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Vector CONSTRUCTION inside East function bodies (issue #601).

#598 made the tensor surface traceable for transforms and reads; these tests
pin the construction seam that was missing — without it a function could carry
a sparse accumulator through a fold but never produce one from per-row
values, forcing an eager pre-pass with one python crossing per table:

* ``Array.to_vector()`` — traced (VectorFromArray) and its eager twin;
* the ``East.Vector.*`` sparse entry points accept ``Array`` as well as
  ``Vector`` for every ix/v input, preserving the documented duplicate-sum
  stability whichever overload is taken;
* ``East.Vector.zeros/ones/fill`` (and the Matrix siblings) take the element
  type first, matching the eager classmethods, with the pre-#601 Float-pinned
  spellings kept;
* a function that builds and then folds a sparse accumulator end to end is ONE
  build (the issue's acceptance bar — a body that cannot capture raises, so
  building is the proof it runs natively).

Every case checks the RESULT, not just that the function compiled.
"""

import pytest

from east import (
    ArrayType,
    BooleanType,
    East,
    EastArray,
    EastVector,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    VectorType,
)
from east.expression import ExpressionError

FA = ArrayType(FloatType)
IA = ArrayType(IntegerType)
SPARSE = StructType([("ix", VectorType(IntegerType)), ("v", VectorType(FloatType))])


# ── Array → Vector ─────────────────────────────────────────────────────────


def test_array_to_vector_traces_for_every_vector_element_kind():
    got = East.function([FA], FA, lambda _b, a: a.to_vector().scale(2.0).to_array())(
        EastArray(FloatType, [1.0, 2.5]))
    assert list(got) == [2.0, 5.0]

    got = East.function([IA], IntegerType, lambda _b, a: a.to_vector().sum())(EastArray(IntegerType, [1, 2, 3]))
    assert got == 6

    got = East.function([ArrayType(BooleanType)], IntegerType, lambda _b, a: a.to_vector().count_true())(
        EastArray(BooleanType, [True, False, True]))
    assert got == 2

    # empty arrays construct empty vectors
    assert East.function([FA], IntegerType, lambda _b, a: a.to_vector().length())(EastArray(FloatType, [])) == 0


def test_array_to_vector_eager_twin_matches():
    v = EastArray(FloatType, [3.0, 1.0]).to_vector()
    assert isinstance(v, EastVector)
    assert v.element_type == FloatType
    assert list(v.to_array()) == [3.0, 1.0]

    # the traced and eager spellings produce East-equal vectors
    traced = East.function([FA], VectorType(FloatType), lambda _b, a: a.to_vector())(EastArray(FloatType, [3.0, 1.0]))
    assert East.equal(VectorType(FloatType), traced, v)


def test_array_to_vector_refuses_non_numeric_elements():
    with pytest.raises(TypeError, match="Float, Integer or Boolean"):
        EastArray(StringType, ["x"]).to_vector()
    with pytest.raises(ExpressionError, match="Float, Integer or Boolean"):
        East.function([ArrayType(StringType)], VectorType(FloatType), lambda _b, a: a.to_vector())


def test_computed_per_row_values_seed_a_vector():
    """The motivating shape: indices and values computed from rows, inside
    the function, become the Vectors the sparse builtins need."""
    Row = StructType([("id", IntegerType), ("qty", FloatType)])
    rows = EastArray(Row, [{"id": 3, "qty": 1.5}, {"id": 1, "qty": 2.0}])
    got = East.function([ArrayType(Row)], FloatType, lambda _b, rs: rs.map(
        lambda _b, r: r.qty, out=FloatType).to_vector().sum())(rows)
    assert got == 3.5


# ── sparse entry points accept Arrays ──────────────────────────────────────


def test_sparse_from_pairs_accepts_arrays_and_matches_the_vector_overload():
    ix = [3, 1, 3]
    v = [1.0, 2.0, 4.0]
    from_arrays = East.function([IA, FA], SPARSE, lambda _b, i, x: East.Vector.sparse_from_pairs(i, x))(
        EastArray(IntegerType, ix), EastArray(FloatType, v))
    from_vectors = East.function(
        [VectorType(IntegerType), VectorType(FloatType)], SPARSE,
        lambda _b, i, x: East.Vector.sparse_from_pairs(i, x))(
        EastVector(IntegerType, ix), EastVector(FloatType, v))
    for got in (from_arrays, from_vectors):
        assert list(got["ix"].to_array()) == [1, 3]
        assert list(got["v"].to_array()) == [2.0, 5.0]


def test_sparse_from_pairs_stability_is_identical_across_overloads():
    """Duplicate indices sum in INPUT order whichever overload is taken —
    the float fold over the result must not depend on the input type. The
    values are chosen so a reordered sum gives a different answer
    (1e16 + 1.0 absorbs; the reverse order does not)."""
    ix = [7, 7, 7]
    v = [1e16, 1.0, -1e16]
    in_order = (1e16 + 1.0) + -1e16  # == 0.0; reversed would be 1.0
    from_arrays = East.function([IA, FA], SPARSE, lambda _b, i, x: East.Vector.sparse_from_pairs(i, x))(
        EastArray(IntegerType, ix), EastArray(FloatType, v))
    from_vectors = East.Vector.sparse_from_pairs(
        EastVector(IntegerType, ix), EastVector(FloatType, v))
    assert from_arrays["v"].get(0) == in_order
    assert from_vectors["v"].get(0) == in_order


def test_sparse_axpy_and_filter_gt_accept_arrays_mixed_with_vectors():
    a_ix, a_v = EastArray(IntegerType, [1, 3]), EastArray(FloatType, [1.0, 2.0])
    b_ix, b_v = EastVector(IntegerType, [3, 4]), EastVector(FloatType, [10.0, 5.0])
    got = East.function([IA, FA], SPARSE, lambda _b, i, x: East.Vector.sparse_axpy(
        i, x, b_ix, b_v, 2.0))(a_ix, a_v)
    assert list(got["ix"].to_array()) == [1, 3, 4]
    assert list(got["v"].to_array()) == [1.0, 22.0, 10.0]

    got = East.function([IA, FA], SPARSE, lambda _b, i, x: East.Vector.sparse_filter_gt(i, x, 1.5))(
        a_ix, a_v)
    assert list(got["ix"].to_array()) == [3]
    assert list(got["v"].to_array()) == [2.0]


def test_sparse_entry_points_still_reject_non_tensor_inputs():
    with pytest.raises(TypeError, match="expects a Vector or Array"):
        East.Vector.sparse_from_pairs("nope", EastVector(FloatType, [1.0]))
    with pytest.raises(TypeError, match="Float, Integer or Boolean"):
        East.Vector.sparse_from_pairs(
            EastArray(IntegerType, [1]), EastArray(StringType, ["x"]))


# ── zeros / ones / fill arity ──────────────────────────────────────────────


def test_vector_constructors_take_the_element_type_first():
    E = EastArray(FloatType, [])
    assert East.function([FA], FloatType, lambda _b, a: East.Vector.zeros(FloatType, 3).sum())(E) == 0.0
    assert East.function([FA], IntegerType, lambda _b, a: East.Vector.zeros(IntegerType, 3).sum())(E) == 0
    assert East.function([FA], FloatType, lambda _b, a: East.Vector.ones(FloatType, 2).sum())(E) == 2.0
    assert East.function([FA], IntegerType, lambda _b, a: East.Vector.ones(IntegerType, 4).sum())(E) == 4
    assert East.function([FA], FloatType, lambda _b, a: East.Vector.fill(FloatType, 2, 2.5).sum())(E) == 5.0
    assert East.function([FA], IntegerType, lambda _b, a: East.Vector.fill(IntegerType, 3, 7).sum())(E) == 21
    # ...and eagerly, matching the classmethods
    assert list(East.Vector.zeros(IntegerType, 2).to_array()) == [0, 0]
    assert list(EastVector.zeros(IntegerType, 2).to_array()) == [0, 0]


def test_vector_constructor_legacy_spellings_still_pin_float():
    E = EastArray(FloatType, [])
    assert East.function([FA], FloatType, lambda _b, a: East.Vector.zeros(3).sum())(E) == 0.0
    assert East.function([FA], FloatType, lambda _b, a: East.Vector.ones(2).sum())(E) == 2.0
    assert East.function([FA], FloatType, lambda _b, a: East.Vector.fill(2, 1.5).sum())(E) == 3.0


def test_matrix_constructors_take_the_element_type_first():
    E = EastArray(FloatType, [])
    assert East.function([FA], IntegerType, lambda _b, a: East.Matrix.zeros(FloatType, 2, 3).row_sums().length())(E) == 2
    assert East.function([FA], IntegerType, lambda _b, a: East.Matrix.ones(IntegerType, 2, 3).col_sums().sum())(E) == 6
    assert East.function([FA], FloatType, lambda _b, a: East.Matrix.fill(FloatType, 2, 2, 5.0).vec_mul(
        East.Vector.ones(FloatType, 2)).sum())(E) == 20.0
    # legacy spellings keep working
    assert East.function([FA], FloatType, lambda _b, a: East.Matrix.zeros(2, 2).row_sums().sum())(E) == 0.0
    assert East.function([FA], FloatType, lambda _b, a: East.Matrix.fill(2, 2, 1.5).col_sums().sum())(E) == 6.0


def test_constructor_misuse_raises_named_errors():
    with pytest.raises(TypeError, match="needs a length"):
        East.Vector.zeros(FloatType)
    with pytest.raises(TypeError, match="needs a length"):
        East.Vector.ones(IntegerType)
    with pytest.raises(TypeError, match="needs a value"):
        East.Vector.fill(FloatType, 3)
    with pytest.raises(TypeError, match="must be Float"):
        East.Vector.fill(FloatType, 2, 3)  # an Integer value for a Float vector
    with pytest.raises(TypeError, match="Float, Integer or Boolean"):
        East.Vector.zeros(StringType, 2)
    with pytest.raises(TypeError, match="needs rows and cols"):
        East.Matrix.zeros(FloatType, 2)
    with pytest.raises(TypeError, match="needs a value"):
        East.Matrix.fill(FloatType, 2, 2)


# ── the acceptance bar: build + fold, zero python per element ──────────────


def test_a_function_builds_and_folds_a_sparse_accumulator_natively():
    """The issue's motivating workload in one function: seed a sparse table
    from per-row values, scale it, merge a second deposit, compact, and
    reduce — one build, one call."""
    Row = StructType([("id", IntegerType), ("qty", FloatType)])
    RA = ArrayType(Row)
    rows = EastArray(Row, [
        {"id": 5, "qty": 2.0}, {"id": 1, "qty": 3.0}, {"id": 5, "qty": 1.0}])
    deposit_ix = EastVector(IntegerType, [1, 9])
    deposit_v = EastVector(FloatType, [10.0, 0.25])

    k = East.function([RA], StructType([("ix", IA), ("total", FloatType)]), lambda _b, rs: East.let(
        East.Vector.sparse_from_pairs(
            rs.map(lambda _b, r: r.id, out=IntegerType),
            rs.map(lambda _b, r: r.qty, out=FloatType)),
        lambda _b, seeded: East.let(
            East.Vector.sparse_axpy(
                seeded.ix, seeded.v.scale(2.0), deposit_ix, deposit_v, 1.0),
            lambda _b, merged: East.let(
                East.Vector.sparse_filter_gt(merged.ix, merged.v, 1.0),
                lambda _b, kept: {
                    "ix": kept.ix.to_array(),
                    "total": kept.v.sum(),
                }))))

    got = k(rows)
    # seeded: {1: 3.0, 5: 3.0} → scaled: {1: 6.0, 5: 6.0} → merged:
    # {1: 16.0, 5: 6.0, 9: 0.25} → kept (> 1.0): {1: 16.0, 5: 6.0}
    assert list(got["ix"]) == [1, 5]
    assert got["total"] == 22.0
