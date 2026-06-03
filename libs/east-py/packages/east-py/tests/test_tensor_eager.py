#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Eager value-method tests for EastVector / EastMatrix.

Vector and Matrix are immutable value types: ``set`` returns a new tensor and
leaves the original unchanged, preserving the backing storage dtype.
"""

import numpy as np
import pytest

from east import EastMatrix, EastVector, FloatType


def test_vector_set_is_functional():
    v = EastVector(FloatType, np.array([1.0, 2.0, 3.0]))
    v2 = v.set(1, 42.0)
    assert v2 is not v
    assert v2.get(1) == 42.0
    assert v.get(1) == 2.0  # original unchanged
    assert v2.element_type.type == v.element_type.type
    assert v2.dtype == v.dtype


def test_vector_set_preserves_storage_dtype():
    v = EastVector(FloatType, np.array([1.0, 2.0], dtype=np.float32))
    v2 = v.set(0, 9.0)
    assert v2.dtype == np.float32
    assert v.dtype == np.float32  # original untouched
    assert v2.get(0) == 9.0


def test_matrix_set_is_functional():
    m = EastMatrix(FloatType, np.array([[1.0, 2.0], [3.0, 4.0]]))
    m2 = m.set(0, 1, 99.0)
    assert m2 is not m
    assert m2.get(0, 1) == 99.0
    assert m.get(0, 1) == 2.0  # original unchanged
    assert (m2.num_rows(), m2.num_cols()) == (2, 2)
    assert m2.dtype == m.dtype


def test_tensors_are_not_hashable():
    v = EastVector(FloatType, np.array([1.0, 2.0]))
    m = EastMatrix(FloatType, np.array([[1.0, 2.0]]))
    with pytest.raises(TypeError):
        hash(v)
    with pytest.raises(TypeError):
        hash(m)


def test_to_numpy_default_is_readonly():
    v = EastVector(FloatType, np.array([1.0, 2.0, 3.0]))
    a = v.to_numpy()
    assert not a.flags.writeable
    with pytest.raises(ValueError):
        a[0] = 9.0  # cannot mutate the immutable buffer


def test_to_numpy_copy_is_writeable_and_isolated():
    v = EastVector(FloatType, np.array([1.0, 2.0]))
    a = v.to_numpy(copy=True)
    assert a.flags.writeable
    a[0] = 9.0
    assert v.get(0) == 1.0  # original untouched


def test_to_numpy_dtype_cast_copies_and_is_writeable():
    v = EastVector(FloatType, np.array([1.0, 2.0], dtype=np.float64))
    a = v.to_numpy(dtype=np.float32)
    assert a.dtype == np.float32
    assert a.flags.writeable
    assert v.dtype == np.float64  # original untouched


def test_asarray_uses_array_protocol():
    v = EastVector(FloatType, np.array([1.0, 2.0]))
    a = np.asarray(v)
    assert a.shape == (2,)
    assert not a.flags.writeable


def test_from_numpy_preserves_dtype():
    v = EastVector.from_numpy(FloatType, np.array([1.0, 2.0, 3.0], dtype=np.float32))
    assert v.dtype == np.float32
    assert v.to_numpy().tolist() == [1.0, 2.0, 3.0]


def test_matrix_to_numpy_is_2d_readonly():
    m = EastMatrix(FloatType, np.array([[1.0, 2.0], [3.0, 4.0]]))
    a = m.to_numpy()
    assert a.shape == (2, 2)
    assert not a.flags.writeable
