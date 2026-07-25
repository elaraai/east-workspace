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

from libc.stdint cimport int32_t, uint8_t
from libc.stddef cimport size_t
from libc.stdlib cimport free

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


cdef object _consume_eastc_error(str fallback, object exc_type=RuntimeError):
    """Drain east-c's error slot and raise. Always consuming the slot matters:
    a stale message would make the next encode's own error check misfire."""
    cdef char *err = _eastc.east_builtin_get_error()
    if err != NULL:
        msg = (<bytes>err).decode("utf-8", errors="replace")
        free(err)
        raise exc_type(msg)
    raise exc_type(fallback)


# ─── Headerless ───────────────────────────────────────────────────────────

cpdef bytes _encode_beast2(object py_type, object value):
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef _eastc.ByteBuffer* buf
    cdef char *err

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    buf = _eastc.east_beast2_encode(c_val, c_type)
    _eastc.east_value_release(c_val)

    if buf == NULL:
        _eastc.east_type_release(c_type)
        err = _eastc.east_builtin_get_error()
        if err != NULL:
            msg = (<bytes>err).decode("utf-8", errors="replace")
            free(err)
            raise RuntimeError(msg)
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
        _consume_eastc_error("beast2 decode failed in east-c", ValueError)

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
    cdef char *err

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    buf = _eastc.east_beast2_encode_full(c_val, c_type)
    _eastc.east_value_release(c_val)

    if buf == NULL:
        _eastc.east_type_release(c_type)
        err = _eastc.east_builtin_get_error()
        if err != NULL:
            msg = (<bytes>err).decode("utf-8", errors="replace")
            free(err)
            raise RuntimeError(msg)
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
        _consume_eastc_error("beast2 full decode failed in east-c", ValueError)

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


# ─── v5: segment-terminated record stream (issue #416) ────────────────────

cdef int32_t _codec_id(object codec) except -1:
    if codec == "none":
        return 0
    if codec == "deflate":
        return 1
    raise ValueError(f"beast2 v5 codec must be 'none' or 'deflate', not {codec!r}")


cpdef bytes _encode_beast2_v5(object py_type, object value, object codec, bint with_index):
    _ensure_eastc_runtime()
    cdef int32_t codec_id = _codec_id(codec)
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef _eastc.ByteBuffer* buf

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    buf = _eastc.east_beast2_encode_v5(c_val, c_type, codec_id, with_index)
    _eastc.east_value_release(c_val)

    if buf == NULL:
        _eastc.east_type_release(c_type)
        _consume_eastc_error("east-c beast2 v5 encode returned NULL")

    cdef bytes result = buf.data[:buf.len]
    _eastc.byte_buffer_free(buf)
    _eastc.east_type_release(c_type)
    return result


cdef class _Beast2WriterCore:
    """Thin wrapper over east-c's streaming v5 writer. The Python-facing
    Beast2Writer in east.serialization.beast2 owns the output stream and
    drains pending bytes after every operation."""

    cdef _eastc.Beast2StreamWriter* _w
    cdef _eastc.EastType* _type

    def __cinit__(self, object py_type, object codec, bint self_contained, bint with_index):
        _ensure_eastc_runtime()
        cdef int32_t codec_id = _codec_id(codec)
        self._type = py_type_to_c(py_type)
        self._w = _eastc.east_beast2_writer_new(self._type, codec_id, self_contained, with_index)
        if self._w == NULL:
            _eastc.east_type_release(self._type)
            self._type = NULL
            _consume_eastc_error("east-c beast2 v5 writer construction failed")

    def write(self, object batch):
        cdef _eastc.EastValue* c_val = py_value_to_c(batch, self._type)
        cdef bint ok = _eastc.east_beast2_writer_write(self._w, c_val)
        _eastc.east_value_release(c_val)
        if not ok:
            _consume_eastc_error("east-c beast2 v5 writer write failed")

    def take(self):
        cdef _eastc.ByteBuffer* buf = _eastc.east_beast2_writer_take(self._w)
        if buf == NULL:
            return b""
        cdef bytes result = buf.data[:buf.len]
        _eastc.byte_buffer_free(buf)
        return result

    def finish(self):
        if not _eastc.east_beast2_writer_finish(self._w):
            _consume_eastc_error("east-c beast2 v5 writer finish failed")

    def __dealloc__(self):
        if self._w != NULL:
            _eastc.east_beast2_writer_free(self._w)
        if self._type != NULL:
            _eastc.east_type_release(self._type)


cdef class _Beast2ReaderCore:
    """Thin wrapper over east-c's sequential v5 segment reader. Holds a
    contiguous view of the source bytes for the reader's whole lifetime
    (the C reader borrows the buffer)."""

    cdef _eastc.Beast2SegmentReader* _r
    cdef _eastc.EastType* _type
    cdef const uint8_t[::1] _view

    def __cinit__(self, object py_type, object data):
        _ensure_eastc_runtime()
        self._view = data
        self._type = py_type_to_c(py_type)
        cdef const uint8_t* ptr = NULL
        if self._view.shape[0] > 0:
            ptr = &self._view[0]
        self._r = _eastc.east_beast2_reader_new(ptr, <size_t>self._view.shape[0], self._type)
        if self._r == NULL:
            _eastc.east_type_release(self._type)
            self._type = NULL
            _consume_eastc_error("east-c beast2 v5 reader construction failed")

    def next(self):
        """Decode the next segment, or return None at the terminator."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_reader_next(self._r)
        if c_val == NULL:
            if _eastc.east_beast2_reader_done(self._r):
                return None
            _consume_eastc_error("east-c beast2 v5 reader failed")
        try:
            return c_value_to_py(c_val, self._type)
        finally:
            _eastc.east_value_release(c_val)

    def counts(self):
        """Return (segment_count, element_count) from the index, or None."""
        cdef size_t segs = 0
        cdef size_t elems = 0
        if not _eastc.east_beast2_reader_counts(self._r, &segs, &elems):
            return None
        return (segs, elems)

    def __dealloc__(self):
        if self._r != NULL:
            _eastc.east_beast2_reader_free(self._r)
        if self._type != NULL:
            _eastc.east_type_release(self._type)


cpdef str beast2_auto_to_east_text(bytes data):
    """Decode a beast2-full blob using its embedded type and return the value
    rendered as east-text. Useful for CLI tools that want to inspect a value
    file without knowing the type in advance.
    """
    _ensure_eastc_runtime()
    cdef const uint8_t* data_ptr = <const uint8_t*>data
    cdef size_t data_len = len(data)

    cdef _eastc.EastType *c_type = _eastc.east_beast2_extract_type(data_ptr, data_len)
    if c_type == NULL:
        _consume_eastc_error("beast2 auto-decode: input is not a beast2-full blob", ValueError)
    cdef _eastc.EastValue *c_val = _eastc.east_beast2_decode_auto(data_ptr, data_len)
    if c_val == NULL:
        _eastc.east_type_release(c_type)
        _consume_eastc_error("beast2 auto-decode failed", ValueError)

    cdef char *text = _eastc.east_print_value(c_val, c_type)
    _eastc.east_value_release(c_val)
    _eastc.east_type_release(c_type)
    if text == NULL:
        raise ValueError("east-text print failed")
    try:
        result = (<bytes>text).decode("utf-8", errors="replace")
    finally:
        free(text)
    return result
