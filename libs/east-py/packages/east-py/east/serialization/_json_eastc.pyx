# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""JSON encode/decode via east-c.

All JSON serialization goes through east-c. No Python fallback.
"""

from libc.stdlib cimport free
from libc.stddef cimport size_t

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py, py_value_to_c

import json as _json


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


# ─── Low-level encode/decode ──────────────────────────────────────────────

cpdef bytes _encode_json(object py_type, object value):
    """Encode an East value to JSON bytes via east-c."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef char* c_str

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    c_str = _eastc.east_json_encode(c_val, c_type)
    _eastc.east_value_release(c_val)

    if c_str == NULL:
        _eastc.east_type_release(c_type)
        raise RuntimeError("east-c JSON encode returned NULL")

    cdef bytes result = c_str
    free(c_str)
    _eastc.east_type_release(c_type)
    return result


cpdef object _decode_json(object py_type, bytes data):
    """Decode JSON bytes to an East value via east-c."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef char* error_msg = NULL

    cdef _eastc.EastValue* c_val = _eastc.east_json_decode_with_error(
        <const char*>data, c_type, &error_msg)

    if c_val == NULL:
        msg = "JSON decode failed"
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


# ─── Public API (matches json.py interface) ──────────────────────────────

def encode_json_for(type_val):
    """Create a function that encodes East values to JSON bytes."""
    def encode(value):
        return _encode_json(type_val, value)
    return encode


def decode_json_for(type_val, frozen=False):
    """Create a function that decodes JSON bytes to East values."""
    def decode(data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        return _decode_json(type_val, data)
    return decode


def to_json_for(type_val, frozen=False):
    """Create a function that converts East values to JSON-compatible Python objects."""
    def to_json(value):
        json_bytes = _encode_json(type_val, value)
        return _json.loads(json_bytes)
    return to_json


def from_json_for(type_val, frozen=False):
    """Create a function that converts JSON-compatible Python objects to East values."""
    def from_json(json_value):
        json_bytes = _json.dumps(json_value, separators=(",", ":")).encode("utf-8")
        return _decode_json(type_val, json_bytes)
    return from_json


class JSONDecodeError(Exception):
    """Error during JSON decoding with location info."""

    def __init__(self, message, path=None, type_str=None):
        self.decode_message = message
        self.path = path or []
        self.type_str = type_str or ""
        super().__init__(message)

    def __str__(self):
        path_str = "/" + "/".join(self.path) if self.path else ""
        if self.type_str:
            return f'Error occurred because {self.decode_message} (at {path_str}) while parsing value of type "{self.type_str}"'
        return self.decode_message


# JSON pointer utilities (re-exported for compatibility)
def encode_json_pointer_component(component: str) -> str:
    return component.replace("~", "~0").replace("/", "~1")


def decode_json_pointer_component(component: str) -> str:
    return component.replace("~1", "/").replace("~0", "~")


def encode_relative_ref(current_path, target_path):
    """Encode a relative JSON pointer from current_path to target_path."""
    common = 0
    for a, b in zip(current_path, target_path):
        if a == b:
            common += 1
        else:
            break

    up_count = len(current_path) - common
    remaining = target_path[common:]
    parts = [str(up_count)]
    for segment in remaining:
        parts.append(encode_json_pointer_component(segment))
    return "/".join(parts)


def decode_relative_ref(ref_str, current_path):
    """Decode a relative JSON pointer given the current path."""
    parts = ref_str.split("/")
    up_count = int(parts[0])
    base = current_path[:len(current_path) - up_count]
    for segment in parts[1:]:
        base.append(decode_json_pointer_component(segment))
    return base
