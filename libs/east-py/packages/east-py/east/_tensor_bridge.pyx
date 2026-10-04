# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Vectors, Matrices and numpy columns to and from east-c, through numpy's C API.

The value bridge (`_eastc_bridge`) imports this module the first time a value
needs numpy: a Vector or a Matrix crossing, or a numpy column read. Cython makes
a module that cimports numpy import numpy as the module loads, so a process
whose values hold none never loads numpy (#1128). Memory rules are the
bridge's: a C value given here is borrowed, and one returned is retained.
"""

from libc.stdint cimport uintptr_t
from libc.string cimport memcpy

cimport numpy as cnp

cdef extern from "numpy/arrayobject.h":
    void *PyArray_DATA(cnp.ndarray arr) nogil

# Initialise the numpy C-API table.
cnp.import_array()

from east cimport _eastc
from east._eastc_bridge cimport _c_type_tag_to_py_type

import numpy as np
import os
import sys

from east.types.values import EAST_ELEMENT_TO_DTYPE, EastMatrix, EastVector


def c_vector_to_py(uintptr_t val_ptr, uintptr_t c_type_ptr):
    """A Vector east-c holds, as an EastVector.

    Args:
        val_ptr: The vector's ``EastValue*``, borrowed.
        c_type_ptr: Its ``EastType*``.

    Returns:
        An EastVector over a read-only zero-copy view of the C buffer, or over
        a copy of it where zero-copy is off.
    """
    return _c_vector_to_py(<_eastc.EastValue*>val_ptr, <_eastc.EastType*>c_type_ptr)


def c_matrix_to_py(uintptr_t val_ptr, uintptr_t c_type_ptr):
    """A Matrix east-c holds, as an EastMatrix.

    Args:
        val_ptr: The matrix's ``EastValue*``, borrowed.
        c_type_ptr: Its ``EastType*``.

    Returns:
        An EastMatrix over a read-only zero-copy view of the C buffer, or over
        a copy of it where zero-copy is off.
    """
    return _c_matrix_to_py(<_eastc.EastValue*>val_ptr, <_eastc.EastType*>c_type_ptr)


def py_vector_to_c(object val, uintptr_t c_type_ptr):
    """An EastVector as an east-c Vector.

    Args:
        val: The EastVector.
        c_type_ptr: The Vector's ``EastType*``.

    Returns:
        The new value's ``EastValue*``, retained: the caller releases it.
    """
    return <uintptr_t>_py_vector_to_c(val, <_eastc.EastType*>c_type_ptr)


def py_matrix_to_c(object val, uintptr_t c_type_ptr):
    """An EastMatrix as an east-c Matrix.

    Args:
        val: The EastMatrix.
        c_type_ptr: The Matrix's ``EastType*``.

    Returns:
        The new value's ``EastValue*``, retained: the caller releases it.
    """
    return <uintptr_t>_py_matrix_to_c(val, <_eastc.EastType*>c_type_ptr)


def array_data(object a):
    """The address of a numpy array's data buffer.

    Args:
        a: The array, which the caller keeps alive while it reads the buffer.

    Returns:
        The buffer's address.
    """
    return <uintptr_t>PyArray_DATA(<cnp.ndarray>a)


# ---------------------------------------------------------------------------
# Zero-copy c->py views.
#
# A Vector/Matrix returned from east-c is exposed to Python as a read-only numpy
# view over the C buffer instead of a copy: PyArray_SimpleNewFromData wraps the
# buffer, and an `_EastBufferOwner` holding a retained reference to the owning
# EastValue is set as the array's base — so the EastValue (and the buffer) lives
# exactly as long as the view and anything derived from it. The value is retained
# once and released in `__dealloc__`. east-c values are immutable, so the borrowed
# bytes never change underneath the view.
#
# Requires the GIL (the borrowed EastValue's refcount is non-atomic) — disabled
# under free-threading. Set EAST_PY_NO_ZEROCOPY=1 to force the copy path.
# ---------------------------------------------------------------------------

cdef bint _gil_enabled():
    try:
        return sys._is_gil_enabled()
    except AttributeError:
        return True


cdef bint _ZEROCOPY_C2PY = (os.environ.get("EAST_PY_NO_ZEROCOPY") != "1") and _gil_enabled()


cdef class _EastBufferOwner:
    """Retained EastValue that anchors the lifetime of a zero-copy numpy view.

    The view (a PyArray_SimpleNewFromData array) borrows the C buffer; this owner
    is set as the array's base, so numpy keeps it alive while the array — and any
    slice / torch tensor derived from it — lives, releasing the EastValue (and so
    the buffer) in __dealloc__. east-c values are immutable, so the bytes never
    change underneath the view.
    """
    cdef _eastc.EastValue *val

    def __cinit__(self):
        self.val = NULL

    def __dealloc__(self):
        if self.val != NULL:
            _eastc.east_value_release(self.val)
            self.val = NULL


cdef object _east_buffer_view(_eastc.EastValue *val, void *buf, int ndim,
                              cnp.npy_intp *dims, int typenum):
    """Read-only zero-copy numpy view over a C buffer owned by `val` (retains val).

    A data-pointer array (not the buffer protocol, which makes numpy cache a
    per-array buffer-info struct) plus cnp.set_array_base — numpy's own helper
    that does the INCREF + base-steal behind a function boundary (base is a
    parameter, so Cython does not also decrement it), avoiding the
    premature-dealloc / dangling-base bug of a hand-rolled Py_INCREF +
    PyArray_SetBaseObject.
    """
    cdef cnp.ndarray arr = cnp.PyArray_SimpleNewFromData(ndim, dims, typenum, buf)
    cdef _EastBufferOwner owner = _EastBufferOwner.__new__(_EastBufferOwner)
    _eastc.east_value_retain(val)
    owner.val = val
    cnp.set_array_base(arr, owner)
    cnp.PyArray_CLEARFLAGS(arr, cnp.NPY_ARRAY_WRITEABLE)
    return arr


cdef object _c_vector_to_py(_eastc.EastValue *val, _eastc.EastType *c_type):
    cdef _eastc.EastType *elem_c = c_type.data.element
    cdef size_t n = val.data.vector.len
    cdef size_t byte_count
    cdef cnp.npy_intp dims[1]
    py_elem_type = _c_type_tag_to_py_type(elem_c)
    dtype = np.dtype(EAST_ELEMENT_TO_DTYPE[py_elem_type.type])
    if _ZEROCOPY_C2PY and n > 0:
        dims[0] = <cnp.npy_intp>n
        return EastVector(py_elem_type, _east_buffer_view(
            val, val.data.vector.data, 1, dims, <int>dtype.num))
    byte_count = n * dtype.itemsize
    data = np.empty(n, dtype=dtype)
    if byte_count > 0:
        memcpy(PyArray_DATA(<cnp.ndarray>data), val.data.vector.data, byte_count)
    return EastVector(py_elem_type, data)


cdef object _c_matrix_to_py(_eastc.EastValue *val, _eastc.EastType *c_type):
    cdef _eastc.EastType *elem_c = c_type.data.element
    cdef size_t rows = val.data.matrix.rows
    cdef size_t cols = val.data.matrix.cols
    cdef size_t count = rows * cols
    cdef size_t byte_count
    cdef cnp.npy_intp dims[2]
    py_elem_type = _c_type_tag_to_py_type(elem_c)
    dtype = np.dtype(EAST_ELEMENT_TO_DTYPE[py_elem_type.type])
    if _ZEROCOPY_C2PY and count > 0:
        dims[0] = <cnp.npy_intp>rows
        dims[1] = <cnp.npy_intp>cols
        return EastMatrix(py_elem_type, _east_buffer_view(
            val, val.data.matrix.data, 2, dims, <int>dtype.num), rows, cols)
    byte_count = count * dtype.itemsize
    data = np.empty(count, dtype=dtype)
    if byte_count > 0:
        memcpy(PyArray_DATA(<cnp.ndarray>data), val.data.matrix.data, byte_count)
    data = data.reshape(rows, cols)
    return EastMatrix(py_elem_type, data, rows, cols)


cdef _eastc.EastValue* _py_vector_to_c(object val, _eastc.EastType *c_type) except NULL:
    cdef _eastc.EastType *elem_c = c_type.data.element
    cdef size_t n = len(val)
    cdef _eastc.EastValue* vec = _eastc.east_vector_new(elem_c, n)
    cdef size_t byte_count

    # The C buffer stores the canonical width for the logical element (f64 for
    # Float, i64 for Integer, bool for Boolean). The Python buffer may use any
    # compatible runtime dtype (e.g. f32), so cast to canonical before copy.
    expected_dtype = EAST_ELEMENT_TO_DTYPE[val.element_type.type]
    cdef object data = np.ascontiguousarray(val._data, dtype=expected_dtype)
    byte_count = n * expected_dtype.itemsize
    if byte_count > 0:
        memcpy(vec.data.vector.data, PyArray_DATA(<cnp.ndarray>data), byte_count)

    return vec


cdef _eastc.EastValue* _py_matrix_to_c(object val, _eastc.EastType *c_type) except NULL:
    cdef _eastc.EastType *elem_c = c_type.data.element
    cdef size_t rows = val._rows
    cdef size_t cols = val._cols
    cdef _eastc.EastValue* mat = _eastc.east_matrix_new(elem_c, rows, cols)
    cdef size_t byte_count

    # Cast the (possibly f32) runtime buffer to the canonical C storage width.
    expected_dtype = EAST_ELEMENT_TO_DTYPE[val.element_type.type]
    cdef object data = np.ascontiguousarray(val._data, dtype=expected_dtype)
    cdef size_t count = rows * cols
    byte_count = count * expected_dtype.itemsize
    if byte_count > 0:
        memcpy(mat.data.matrix.data, PyArray_DATA(<cnp.ndarray>data), byte_count)

    return mat
