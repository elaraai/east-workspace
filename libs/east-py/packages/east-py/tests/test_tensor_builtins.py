#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The Vector/Matrix surface's python SPELLINGS (#598).

What the tensor builtins compute is the compliance corpus's business; these
pin the python side only — that the traced surface spells the arithmetic,
structural and sparse builtins (a body that cannot build raises, so building
is the proof), that a method miss names the tensor surface instead of a
String error, and that captured tensor constants lift.
"""

from __future__ import annotations

import pytest

from east import (
    East,
    EastMatrix,
    EastVector,
    FloatType,
    IntegerType,
    StructType,
    VectorType,
)
from east.expression import ExpressionError
from east.types.types import MatrixType

VF = VectorType(FloatType)


def fvec(items):
    return EastVector.from_array(FloatType, items)


def ivec(items):
    return EastVector.from_array(IntegerType, items)


def test_the_traced_tensor_surface_builds_and_runs():
    sp_t = StructType([("ix", VectorType(IntegerType)), ("v", VectorType(FloatType))])
    v = fvec([1.0, 2.0, 3.0])
    sa = {"ix": ivec([0, 2]), "v": fvec([1.0, 2.0])}
    sb = {"ix": ivec([1]), "v": fvec([5.0])}
    assert East.function([VF], FloatType, lambda _b, t: t.scale(0.99).sum())(v) == pytest.approx(5.94)
    assert East.function([VF], IntegerType, lambda _b, t: t.length())(v) == 3
    assert East.function([VF], FloatType, lambda _b, t: t.get(0))(v) == 1.0
    assert East.function([VF], FloatType, lambda _b, t: t.slice(1, 3).dot(t.slice(1, 3)))(v) == 13.0
    assert East.function([VF], IntegerType, lambda _b, t: t.cum_sum().arg_max())(v) == 2
    assert East.function([VF], IntegerType, lambda _b, t: t.gt(t.scale(0.0)).count_true())(v) == 3
    assert East.function([VF], IntegerType,
                         lambda _b, t: t.compress(t.gt(t.scale(0.0).add_scalar(1.5))).length())(v) == 2
    step = East.function([sp_t, sp_t], sp_t, lambda _b, a, c: East.Vector.sparse_axpy(
        a["ix"], a["v"], c["ix"], c["v"], 0.5))
    merged = step(sa, sb)
    assert merged["ix"].to_numpy().tolist() == [0, 1, 2]
    assert merged["v"].to_numpy().tolist() == [1.0, 2.5, 2.0]
    m = EastMatrix.from_array(FloatType, [[1.0, 2.0], [3.0, 4.0]])
    assert East.function([MatrixType(FloatType)], FloatType, lambda _b, t: t.row_sums().sum())(m) == 10.0
    assert East.function([MatrixType(FloatType)], FloatType,
                         lambda _b, t: t.vec_mul(t.get_row(0)).get(1))(m) == 11.0


def test_a_method_miss_names_the_tensor_surface():
    assert East.function([VF], IntegerType, lambda _b, t: t.length())(fvec([1.0])) == 1
    with pytest.raises(ExpressionError, match="Vector.*scale"):
        East.function([VF], FloatType, lambda _b, t: t.nonexistent())
    with pytest.raises(ExpressionError, match=r"\.map\(\) on Vector"):
        East.function([VF], VF, lambda _b, t: t.map(lambda _b, q: q * 0.99))


def test_captured_tensor_constants_lift():
    cv = fvec([10.0, 20.0, 30.0])
    cm = EastMatrix.from_array(FloatType, [[1.0, 2.0], [3.0, 4.0]])
    assert East.function([IntegerType], FloatType, lambda _b, i: cv.get(i))(2) == 30.0
    assert East.function([IntegerType], FloatType, lambda _b, i: cv.slice(0, i).sum())(2) == 30.0
    assert East.function([IntegerType], FloatType, lambda _b, i: cm.get_row(i).sum())(1) == 7.0
