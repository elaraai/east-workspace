# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast v2 encode/decode via east-c.

All beast2 serialization goes through east-c. No Python fallback.
"""

from libc.stdint cimport uint8_t
from libc.stddef cimport size_t

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py, py_value_to_c


# ─── East-c runtime initialization ────────────────────────────────────────
# East-c's beast2 decoder for function values needs builtins and platform
# registries to be set up (used by east_ir_from_value and EastCompiledFn).

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


# ─── Headerless ───────────────────────────────────────────────────────────

cpdef bytes _encode_beast2(object py_type, object value):
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef _eastc.ByteBuffer* buf

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    buf = _eastc.east_beast2_encode(c_val, c_type)
    _eastc.east_value_release(c_val)

    if buf == NULL:
        _eastc.east_type_release(c_type)
        raise RuntimeError("east-c beast2 encode returned NULL")

    cdef bytes result = buf.data[:buf.len]
    _eastc.byte_buffer_free(buf)
    _eastc.east_type_release(c_type)
    return result


cpdef object _decode_beast2(object py_type, bytes data):
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef const uint8_t* data_ptr = <const uint8_t*>data
    cdef size_t data_len = len(data)

    cdef _eastc.EastValue* c_val = _eastc.east_beast2_decode(data_ptr, data_len, c_type)
    if c_val == NULL:
        _eastc.east_type_release(c_type)
        raise ValueError("beast2 decode failed in east-c")

    try:
        result = c_value_to_py(c_val, c_type)
    finally:
        _eastc.east_value_release(c_val)
        _eastc.east_type_release(c_type)

    return result


# ─── With header ──────────────────────────────────────────────────────────

cpdef bytes _encode_beast2_full(object py_type, object value):
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef _eastc.ByteBuffer* buf

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    buf = _eastc.east_beast2_encode_full(c_val, c_type)
    _eastc.east_value_release(c_val)

    if buf == NULL:
        _eastc.east_type_release(c_type)
        raise RuntimeError("east-c beast2 encode_full returned NULL")

    cdef bytes result = buf.data[:buf.len]
    _eastc.byte_buffer_free(buf)
    _eastc.east_type_release(c_type)
    return result


cpdef object _decode_beast2_full(object py_type, bytes data):
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef const uint8_t* data_ptr = <const uint8_t*>data
    cdef size_t data_len = len(data)

    cdef _eastc.EastValue* c_val = _eastc.east_beast2_decode_full(data_ptr, data_len, c_type)
    if c_val == NULL:
        _eastc.east_type_release(c_type)
        raise ValueError("beast2 full decode failed in east-c")

    try:
        result = c_value_to_py(c_val, c_type)
    finally:
        _eastc.east_value_release(c_val)
        _eastc.east_type_release(c_type)

    return result


# ─── Public API ───────────────────────────────────────────────────────────

def encode_beast2_for(type_val):
    """Create encoder for headerless beast2 format."""
    def encode(value):
        return _encode_beast2(type_val, value)
    return encode


def decode_beast2_for(type_val, options=None):
    """Create decoder for headerless beast2 format."""
    def decode(data):
        return _decode_beast2(type_val, data)
    return decode


def encode_beast2_with_header_for(type_val):
    """Create encoder for beast2-full format (magic + type schema + value)."""
    def encode(value):
        return _encode_beast2_full(type_val, value)
    return encode


def decode_beast2_with_header_for(type_val, options=None):
    """Create decoder for beast2-full format (magic + type schema + value)."""
    def decode(data):
        return _decode_beast2_full(type_val, data)
    return decode
