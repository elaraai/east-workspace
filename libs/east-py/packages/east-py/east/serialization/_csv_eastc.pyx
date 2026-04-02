# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""CSV encode/decode via east-c.

All CSV serialization goes through east-c. No Python fallback.
"""

from libc.stdlib cimport free
from libc.stddef cimport size_t

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


# ─── Config type for east-c ──────────────────────────────────────────────

cdef _eastc.EastType* _csv_parse_config_c_type = NULL
cdef _eastc.EastType* _csv_serialize_config_c_type = NULL

cdef _eastc.EastType* _get_csv_parse_config_type():
    """Get or create the C type for CsvParseConfigType."""
    global _csv_parse_config_c_type
    if _csv_parse_config_c_type != NULL:
        return _csv_parse_config_c_type
    from east.serialization.csv import CsvParseConfigType
    _csv_parse_config_c_type = py_type_to_c(CsvParseConfigType)
    return _csv_parse_config_c_type

cdef _eastc.EastType* _get_csv_serialize_config_type():
    """Get or create the C type for CsvSerializeConfigType."""
    global _csv_serialize_config_c_type
    if _csv_serialize_config_c_type != NULL:
        return _csv_serialize_config_c_type
    from east.serialization.csv import CsvSerializeConfigType
    _csv_serialize_config_c_type = py_type_to_c(CsvSerializeConfigType)
    return _csv_serialize_config_c_type


# ─── Low-level encode/decode ──────────────────────────────────────────────

cpdef bytes _encode_csv(object py_type, object value, object config):
    """Encode an East array to CSV bytes via east-c."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef _eastc.EastValue* c_config = NULL
    cdef char* c_str

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    if config is not None:
        try:
            c_config = py_value_to_c(config, _get_csv_serialize_config_type())
        except:
            _eastc.east_value_release(c_val)
            _eastc.east_type_release(c_type)
            raise

    c_str = _eastc.east_csv_encode(c_val, c_type, c_config)
    _eastc.east_value_release(c_val)
    if c_config != NULL:
        _eastc.east_value_release(c_config)

    if c_str == NULL:
        _eastc.east_type_release(c_type)
        raise RuntimeError("east-c CSV encode returned NULL")

    cdef bytes result = c_str
    free(c_str)
    _eastc.east_type_release(c_type)
    return result


cpdef object _decode_csv(object py_type, bytes data, object config):
    """Decode CSV bytes to an East array via east-c."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_config = NULL
    cdef char* error_msg = NULL

    if config is not None:
        try:
            c_config = py_value_to_c(config, _get_csv_parse_config_type())
        except:
            _eastc.east_type_release(c_type)
            raise

    cdef _eastc.EastValue* c_val = _eastc.east_csv_decode_with_error(
        <const char*>data, c_type, c_config, &error_msg)

    if c_config != NULL:
        _eastc.east_value_release(c_config)

    if c_val == NULL:
        msg = "CSV decode failed"
        if error_msg != NULL:
            msg = error_msg.decode("utf-8")
            free(error_msg)
        _eastc.east_type_release(c_type)
        raise ValueError(msg)

    try:
        result = c_value_to_py(c_val, c_type)
    finally:
        _eastc.east_value_release(c_val)
        _eastc.east_type_release(c_type)

    return result


# ─── Public API (matches csv.py interface) ────────────────────────────────

def encode_csv_for(type_val, config=None):
    """Create a function that encodes East arrays to CSV bytes."""
    def encode(value):
        return _encode_csv(type_val, value, config)
    return encode


def decode_csv_for(type_val, config=None):
    """Create a function that decodes CSV bytes to East arrays."""
    def decode(data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        return _decode_csv(type_val, data, config)
    return decode
