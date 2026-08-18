#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The Vector/Matrix arithmetic + sparse-accumulator surface (#598).

Pins the issue's acceptance criteria on the east-py side: the eager methods
delegate to east-c (reduction order and East's total order are the C
runtime's, not numpy's), the traced kernel surface covers the new builtins
plus the structural ones with ZERO trampoline calls, the ``.length()`` error
no longer claims to need a String, and the two performance contracts hold —
``VectorScale`` within 2x of a plain C loop over the same buffer, and
``SparseAxpy`` at least 5x faster than the equivalent ``Dict<Integer,
Float>.union`` at 200k entries per side.
"""

from __future__ import annotations

import math
import time

import pytest

from east import (
    BooleanType,
    East,
    EastDict,
    EastMatrix,
    EastVector,
    FloatType,
    IntegerType,
    StructType,
    VectorType,
    kernel,
)
from east.kernel import KernelTraceError
from east.runtime.compiler import eager_stats
from east.runtime.errors import EastError


def fvec(items):
    return EastVector.from_array(FloatType, items)

def ivec(items):
    return EastVector.from_array(IntegerType, items)

def bvec(items):
    return EastVector.from_array(BooleanType, items)


# ── eager delegation: order and total-order semantics are east-c's ─────────

def test_sum_and_dot_fold_left_to_right():
    # (1e16 + 1) - 1e16 absorbs the 1 only under left-to-right order; any
    # reassociation (numpy's pairwise sum included) answers 1.0.
    v = fvec([1e16, 1.0, -1e16])
    assert v.sum() == 0.0
    assert v.dot(fvec([1.0, 1.0, 1.0])) == 0.0
    assert v.cum_sum().to_numpy().tolist() == [1e16, 1e16, 0.0]


def test_extremes_use_east_total_order():
    # NaN is greatest under East's total order; ties keep the first index.
    v = fvec([1.0, float("nan"), 3.0])
    assert math.isnan(v.maximum())
    assert v.arg_max() == 1
    assert v.minimum() == 1.0
    ties = fvec([5.0, 5.0, 1.0])
    assert ties.arg_max() == 0
    assert ties.arg_min() == 2


def test_masks_use_east_float_semantics():
    a = fvec([float("nan"), -0.0, 1.0])
    b = fvec([float("nan"), 0.0, 2.0])
    assert a.eq(b).to_numpy().tolist() == [True, False, False]
    assert a.lt(b).to_numpy().tolist() == [False, True, True]
    assert a.gt(b).to_numpy().tolist() == [False, False, False]


def test_empty_reductions():
    empty = fvec([])
    assert empty.sum() == 0.0
    assert math.isnan(empty.mean())
    for op in ("maximum", "minimum", "arg_max", "arg_min"):
        with pytest.raises(EastError, match="Cannot reduce empty Vector"):
            getattr(empty, op)()


def test_length_mismatch_is_named():
    a = fvec([1.0, 2.0, 3.0])
    b = fvec([1.0, 2.0])
    with pytest.raises(EastError, match=r"Vector length mismatch \(3 vs 2\)"):
        a.add_scaled(b, 1.0)
    with pytest.raises(EastError, match="Vector length mismatch"):
        a.mul(b)


def test_sparse_axpy_and_invariants():
    merged = East.Vector.sparse_axpy(
        ivec([0, 2, 5]), fvec([1.0, 2.0, 3.0]),
        ivec([1, 2]), fvec([10.0, 20.0]), 2.0)
    assert merged["ix"].to_numpy().tolist() == [0, 1, 2, 5]
    assert merged["v"].to_numpy().tolist() == [1.0, 20.0, 42.0, 3.0]
    with pytest.raises(EastError, match="strictly ascending"):
        East.Vector.sparse_axpy(ivec([2, 1]), fvec([1.0, 2.0]), ivec([]), fvec([]), 1.0)
    with pytest.raises(EastError, match=r"Sparse index and value lengths differ \(1 vs 2\)"):
        East.Vector.sparse_axpy(ivec([0]), fvec([1.0, 2.0]), ivec([]), fvec([]), 1.0)


def test_sparse_from_pairs_is_stable():
    sparse = East.Vector.sparse_from_pairs(
        ivec([3, 0, 3, 0]), fvec([1e16, 5.0, 1.0, 6.0]))
    assert sparse["ix"].to_numpy().tolist() == [0, 3]
    # index 3 sums (1e16 + 1.0) in input order, absorbing the 1.0
    assert sparse["v"].to_numpy().tolist() == [11.0, 1e16]


def test_sparse_filter_gt():
    filtered = East.Vector.sparse_filter_gt(
        ivec([0, 1, 2]), fvec([1.0, 0.5, 2.0]), 1.0)
    assert filtered["ix"].to_numpy().tolist() == [2]
    assert filtered["v"].to_numpy().tolist() == [2.0]


def test_matrix_arithmetic():
    m = EastMatrix.from_array(FloatType, [[1.0, 2.0], [3.0, 4.0]])
    assert m.scale(2.0).to_numpy().tolist() == [[2.0, 4.0], [6.0, 8.0]]
    assert m.row_sums().to_numpy().tolist() == [3.0, 7.0]
    assert m.col_sums().to_numpy().tolist() == [4.0, 6.0]
    assert m.vec_mul(fvec([10.0, 20.0])).to_numpy().tolist() == [50.0, 110.0]
    with pytest.raises(EastError, match=r"Matrix dimension mismatch \(2x2 vs 1x2\)"):
        m.add_scaled(EastMatrix.from_array(FloatType, [[1.0, 2.0]]), 1.0)
    with pytest.raises(EastError, match=r"MatrixVecMul dimension mismatch \(2x2 vs length 3\)"):
        m.vec_mul(fvec([1.0, 2.0, 3.0]))


def test_select_compress_gather_scatter():
    v = fvec([1.0, 2.0, 3.0, 4.0])
    mask = bvec([True, False, True, False])
    assert mask.select(v, v.scale(10.0)).to_numpy().tolist() == [1.0, 20.0, 3.0, 40.0]
    assert v.compress(mask).to_numpy().tolist() == [1.0, 3.0]
    assert mask.count_true() == 2
    assert v.gather(ivec([3, 0])).to_numpy().tolist() == [4.0, 1.0]
    scattered = fvec([100.0, 0.0]).scatter_add(ivec([0, 0, 1]), fvec([1.0, 2.0, 5.0]))
    assert scattered.to_numpy().tolist() == [103.0, 5.0]
    assert fvec([10.0, 20.0, 30.0]).search_sorted(fvec([25.0, 5.0])).to_numpy().tolist() == [2, 0]


# ── the traced kernel surface (#598 acceptance criterion 3) ────────────────

def test_kernel_tensor_surface_is_trampoline_free():
    """Kernels over the new builtins + the structural surface execute with
    exactly zero per-element python calls."""
    sp_t = StructType([("ix", VectorType(IntegerType)), ("v", VectorType(FloatType))])
    v = fvec([1.0, 2.0, 3.0])
    sa = {"ix": ivec([0, 2]), "v": fvec([1.0, 2.0])}
    sb = {"ix": ivec([1]), "v": fvec([5.0])}
    before = eager_stats()
    assert kernel(VectorType(FloatType), lambda t: t.scale(0.99).sum())(v) == pytest.approx(5.94)
    assert kernel(VectorType(FloatType), lambda t: t.length())(v) == 3
    assert kernel(VectorType(FloatType), lambda t: t.get(0))(v) == 1.0
    assert kernel(VectorType(FloatType), lambda t: t.slice(1, 3).dot(t.slice(1, 3)))(v) == 13.0
    assert kernel(VectorType(FloatType), lambda t: t.cum_sum().arg_max())(v) == 2
    assert kernel(VectorType(FloatType), lambda t: t.gt(t.scale(0.0)).count_true())(v) == 3
    assert kernel(VectorType(FloatType),
                  lambda t: t.compress(t.gt(t.scale(0.0).add_scalar(1.5))).length())(v) == 2
    # the motivating shape: a sparse accumulator step as ONE native kernel
    step = kernel([sp_t, sp_t], lambda a, b: East.Vector.sparse_axpy(
        a["ix"], a["v"], b["ix"], b["v"], 0.5))
    merged = step(sa, sb)
    assert merged["ix"].to_numpy().tolist() == [0, 1, 2]
    assert merged["v"].to_numpy().tolist() == [1.0, 2.5, 2.0]
    m = EastMatrix.from_array(FloatType, [[1.0, 2.0], [3.0, 4.0]])
    from east.types.types import MatrixType

    assert kernel(MatrixType(FloatType), lambda t: t.row_sums().sum())(m) == 10.0
    assert kernel(MatrixType(FloatType),
                  lambda t: t.vec_mul(t.get_row(0)).get(1))(m) == 11.0
    after = eager_stats()
    assert after["trampoline_calls"] == before["trampoline_calls"]


def test_traced_length_error_is_fixed():
    """`.length()` on a traced Vector is VectorLength, not a String error, and
    a method miss names the tensor surface."""
    assert kernel(VectorType(FloatType), lambda t: t.length())(fvec([1.0])) == 1
    with pytest.raises(KernelTraceError, match="traced kernel surface.*Vector.*scale"):
        kernel(VectorType(FloatType), lambda t: t.nonexistent())
    # .map()/.fold() are deliberately absent (callback boxing is inherent);
    # their misses name the real problem instead of "needs a String"
    with pytest.raises(KernelTraceError, match=r"\.map\(\) on Vector"):
        kernel(VectorType(FloatType), lambda t: t.map(lambda q: q * 0.99))


def test_captured_tensor_constants_lift():
    cv = fvec([10.0, 20.0, 30.0])
    cm = EastMatrix.from_array(FloatType, [[1.0, 2.0], [3.0, 4.0]])
    before = eager_stats()
    assert kernel(IntegerType, lambda i: cv.get(i))(2) == 30.0
    assert kernel(IntegerType, lambda i: cv.slice(0, i).sum())(2) == 30.0
    assert kernel(IntegerType, lambda i: cm.get_row(i).sum())(1) == 7.0
    after = eager_stats()
    assert after["trampoline_calls"] == before["trampoline_calls"]


# ── the performance contracts (#598 acceptance criterion 4) ────────────────

def _best_of(reps, fn):
    best = math.inf
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        best = min(best, time.perf_counter() - t0)
    return best


def test_vector_scale_within_2x_of_c_loop():
    """The marginal cost of one VectorScale inside a kernel is within 2x of a
    plain C loop over the same buffer (numpy's `a * alpha` is that loop).

    Measured as the difference between a 9-scale and a 1-scale kernel so the
    py<->C marshalling at the call boundary — which the motivating fold pays
    once per event batch, not per operation — cancels out.
    """
    n = 1_000_000
    import numpy as np

    data = np.random.default_rng(0).random(n)
    v = EastVector.from_numpy(data)

    def chain(k):
        def build(t):
            out = t
            for _ in range(k):
                out = out.scale(0.99)
            return out.length()
        return kernel(VectorType(FloatType), build)

    k1, k9 = chain(1), chain(9)
    k1(v)
    k9(v)  # warm both
    t1 = _best_of(3, lambda: k1(v))
    t9 = _best_of(3, lambda: k9(v))
    per_scale = (t9 - t1) / 8
    baseline = _best_of(3, lambda: data * 0.99)
    assert per_scale <= 2 * baseline, (per_scale, baseline)


def test_sparse_axpy_beats_dict_union_by_5x():
    """SparseAxpy at 200k entries per side is at least 5x faster than the
    equivalent Dict<Integer, Float>.union — the issue's measured motivation
    (a two-pointer merge vs the per-entry dict machinery)."""
    n = 200_000
    a_keys = list(range(0, 2 * n, 2))  # evens
    # a genuinely different sorted index set with partial overlap
    b_keys = sorted(set(range(1, 2 * n, 4)) | set(range(0, 2 * n, 6)))[:n]
    ix_a = ivec(a_keys)
    ix_b = ivec(b_keys)
    v_a = fvec([1.0] * n)
    v_b = fvec([2.0] * len(b_keys))

    d_a = EastDict(IntegerType, FloatType)
    d_a.update_many(a_keys, [1.0] * n)
    d_b = EastDict(IntegerType, FloatType)
    d_b.update_many(b_keys, [2.0] * len(b_keys))

    sparse_t = _best_of(3, lambda: East.Vector.sparse_axpy(ix_a, v_a, ix_b, v_b, 1.0))
    dict_t = _best_of(3, lambda: d_a.union(d_b, lambda a, b: a + b))
    assert sparse_t * 5 <= dict_t, (sparse_t, dict_t)
