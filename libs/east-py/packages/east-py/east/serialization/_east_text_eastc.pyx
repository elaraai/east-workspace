# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East text format print/parse via east-c."""

from libc.stdlib cimport free

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py, py_value_to_c


# ─── East-c runtime initialization ────────────────────────────────────────

cdef bint _eastc_initialized = False
cdef _eastc.BuiltinRegistry* _builtins = NULL
cdef _eastc.PlatformRegistry* _platform = NULL

cdef void _ensure_eastc_runtime():
    global _eastc_initialized, _builtins, _platform
    if _eastc_initialized:
        return
    _builtins = _eastc.builtin_registry_new()
    _eastc.east_register_all_builtins(_builtins)
    _platform = _eastc.platform_registry_new()
    _eastc.east_set_thread_context(_platform, _builtins)
    _eastc.east_type_of_type_init()
    _eastc_initialized = True


# ─── Print ────────────────────────────────────────────────────────────────

cpdef str _print_value(object py_type, object value):
    """Print an East value to text format via east-c."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    cdef char* c_str = _eastc.east_print_value(c_val, c_type)
    _eastc.east_value_release(c_val)

    if c_str == NULL:
        _eastc.east_type_release(c_type)
        raise RuntimeError("east-c east_print_value returned NULL")

    cdef str result = c_str.decode("utf-8")
    free(c_str)
    _eastc.east_type_release(c_type)
    return result


cpdef str _print_type(object py_type):
    """Print an East type to text format via east-c."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)

    cdef char* c_str = _eastc.east_print_type(c_type)
    _eastc.east_type_release(c_type)

    if c_str == NULL:
        raise RuntimeError("east-c east_print_type returned NULL")

    cdef str result = c_str.decode("utf-8")
    free(c_str)
    return result


# ─── Parse ────────────────────────────────────────────────────────────────

cpdef object _parse_value(object py_type, str text):
    """Parse East text format into a value via east-c."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef bytes text_bytes = text.encode("utf-8")

    cdef _eastc.EastValue* c_val = _eastc.east_parse_value(
        <const char*>text_bytes, c_type)

    if c_val == NULL:
        _eastc.east_type_release(c_type)
        raise ValueError(f"east-c parse failed for: {text[:100]}")

    try:
        result = c_value_to_py(c_val, c_type)
    finally:
        _eastc.east_value_release(c_val)
        _eastc.east_type_release(c_type)

    return result
