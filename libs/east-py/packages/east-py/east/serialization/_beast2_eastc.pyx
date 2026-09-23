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

from libc.stdint cimport int32_t, uint8_t, uintptr_t
from libc.stddef cimport size_t
from libc.stdlib cimport free, malloc
from cpython.ref cimport PyObject, Py_INCREF, Py_XDECREF

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py, py_value_to_c, _c_type_tag_to_py_type


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


cdef bytes _EMPTY = b""


cpdef object _decode_beast2(object py_type, object data):
    # Any C-contiguous buffer decodes zero-copy — bytes, bytearray, memoryview,
    # an mmap of a large file. Coerce the view BEFORE taking the type so a
    # non-buffer input cannot leak the retained type.
    cdef const uint8_t[::1] view = data
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    # len 0 must still hand east-c a non-NULL pointer so its too-short error
    # fires rather than the NULL-argument one.
    cdef const uint8_t* data_ptr = <const uint8_t*>_EMPTY
    cdef size_t data_len = <size_t>view.shape[0]
    if data_len > 0:
        data_ptr = &view[0]

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


cpdef bytes _encode_beast2_v4(object py_type, object value):
    """Pin the legacy v4 container. Same shape as _encode_beast2_full, which
    writes whatever the current default is (v5 since #416)."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef _eastc.ByteBuffer* buf

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    buf = _eastc.east_beast2_encode_v4(c_val, c_type)
    _eastc.east_value_release(c_val)

    if buf == NULL:
        _eastc.east_type_release(c_type)
        _consume_eastc_error("east-c beast2 v4 encode returned NULL")

    cdef bytes result = buf.data[:buf.len]
    _eastc.byte_buffer_free(buf)
    _eastc.east_type_release(c_type)
    return result


cpdef object _decode_beast2_full(object py_type, object data):
    # Same buffer contract as _decode_beast2: borrow any C-contiguous buffer,
    # so full decodes of mmap-backed files never copy the blob into RAM.
    cdef const uint8_t[::1] view = data
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef const uint8_t* data_ptr = <const uint8_t*>_EMPTY
    cdef size_t data_len = <size_t>view.shape[0]
    if data_len > 0:
        data_ptr = &view[0]

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


def encode_beast2_with_header_for(type_val, *, version=None):
    """Create encoder for beast2-full format (magic + type schema + value).

    ``version`` pins the container: ``5`` (the default — the segment-terminated
    record stream) or ``4`` (the legacy globally-sectioned container, for a
    reader that predates v5). Leave it unset to follow the runtime default,
    which is what TypeScript's ``encodeBeast2For(type)`` and the East builtin
    ``Blob.encodeBeast(value, 'v2')`` do. Decoding never needs a version —
    every entry point dispatches on the blob's magic.
    """
    if version is None:
        def encode(value):
            return _encode_beast2_full(type_val, value)
        return encode
    if version == 4:
        def encode(value):
            return _encode_beast2_v4(type_val, value)
        return encode
    if version == 5:
        def encode(value):
            return _encode_beast2_v5(type_val, value, "deflate", False)
        return encode
    raise ValueError(f"beast2: unsupported container version {version!r} (expected 4 or 5)")


def decode_beast2_with_header_for(type_val, options=None):
    """Create decoder for beast2-full format (magic + type schema + value)."""
    def decode(data):
        return _decode_beast2_full(type_val, data)
    return decode


# ─── v5: column projection (issue #599) ───────────────────────────────────


class Beast2ProjectionAlias(ValueError):
    """A projected segment decode hit a container aliased across the
    projection boundary — the caller retries that segment whole."""


cdef object _consume_projection_error(str fallback):
    """Drain east-c's error slot, distinguishing the alias fallback signal
    from real errors."""
    cdef char *err = _eastc.east_builtin_get_error()
    if err != NULL:
        msg = (<bytes>err).decode("utf-8", errors="replace")
        free(err)
        if "projection alias" in msg:
            raise Beast2ProjectionAlias(msg)
        raise ValueError(msg)
    raise ValueError(fallback)


cdef class _Beast2Projection:
    """A validated column-projection plan: wire type in, subset type out.

    Built once per operation (or per file, for the explicit ``project=``
    form) and passed to the projected read entry points. Validation failures
    raise ``ValueError`` with east-c's message naming the offending field
    and the wire type's fields.
    """

    cdef _eastc.Beast2Projection* _pr
    cdef _eastc.EastType* _wire
    cdef _eastc.EastType* _proj
    cdef readonly object projected_type

    def __cinit__(self, object wire_py_type, object proj_py_type):
        _ensure_eastc_runtime()
        self._wire = py_type_to_c(wire_py_type)
        try:
            self._proj = py_type_to_c(proj_py_type)
        except BaseException:
            _eastc.east_type_release(self._wire)
            self._wire = NULL
            raise
        self._pr = _eastc.east_beast2_projection_new(self._wire, self._proj)
        if self._pr == NULL:
            _eastc.east_type_release(self._wire)
            _eastc.east_type_release(self._proj)
            self._wire = NULL
            self._proj = NULL
            _consume_eastc_error("beast2 v5 projection validation failed", ValueError)
        self.projected_type = proj_py_type

    def is_identity(self):
        """Whether the plan is a no-op (subset deep-equals the wire type)."""
        return _eastc.east_beast2_projection_is_identity(self._pr) != 0

    def __dealloc__(self):
        if self._pr != NULL:
            _eastc.east_beast2_projection_free(self._pr)
        if self._wire != NULL:
            _eastc.east_type_release(self._wire)
        if self._proj != NULL:
            _eastc.east_type_release(self._proj)


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


cpdef bytes _encode_beast2_paged(object py_type, object value, object codec):
    """One collection value as a segmented, self-contained, indexed v5 blob
    cut by the content-defined rule — east-c's writer, so the bytes are the
    ones every runtime writes for the value."""
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

    buf = _eastc.east_beast2_encode_paged(c_val, c_type, codec_id)
    _eastc.east_value_release(c_val)
    if buf == NULL:
        _eastc.east_type_release(c_type)
        _consume_eastc_error("east-c beast2 paged encode returned NULL")

    cdef bytes result = buf.data[:buf.len]
    _eastc.byte_buffer_free(buf)
    _eastc.east_type_release(c_type)
    return result


cpdef bytes _encode_beast2_fence(object py_type, object value):
    """The canonical bare encoding of one value — a segment's fence, and what
    the boundary rule hashes. east-c's own encoder, so the bytes are the ones
    every runtime agrees on."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef _eastc.ByteBuffer* buf

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    buf = _eastc.east_beast2_encode_fence(c_val, c_type)
    _eastc.east_value_release(c_val)
    if buf == NULL:
        _eastc.east_type_release(c_type)
        _consume_eastc_error("east-c beast2 fence encode returned NULL")

    cdef bytes result = buf.data[:buf.len]
    _eastc.byte_buffer_free(buf)
    _eastc.east_type_release(c_type)
    return result


cpdef list _segment_starts(object py_type, object value):
    """The element indices at which a collection's segments begin under the
    cut rule, excluding 0 — the whole segmentation of one value in one east-c
    call."""
    _ensure_eastc_runtime()
    cdef _eastc.EastType* c_type = py_type_to_c(py_type)
    cdef _eastc.EastValue* c_val
    cdef size_t* out = NULL
    cdef size_t cap = 0
    cdef size_t found = 0
    cdef size_t i

    try:
        c_val = py_value_to_c(value, c_type)
    except:
        _eastc.east_type_release(c_type)
        raise

    # A wide element can close a segment on its own, so every element but
    # the first may start one.
    cap = max(len(value), 1)
    out = <size_t*>malloc(cap * sizeof(size_t))
    if out == NULL:
        _eastc.east_value_release(c_val)
        _eastc.east_type_release(c_type)
        raise MemoryError("out of memory computing segment starts")

    found = _eastc.east_beast2_segment_starts(c_val, c_type, out, cap)
    _eastc.east_value_release(c_val)
    _eastc.east_type_release(c_type)
    if found == <size_t>-1:
        free(out)
        _consume_eastc_error("east-c segment-start computation failed")

    cdef list result = [out[i] for i in range(found)]
    free(out)
    return result


cpdef unsigned int _segment_boundary_hash(bytes data):
    """The cut rule's hash of an element's hashed bytes: a Set or Dict key's
    fence bytes, or an Array element's canonical bytes."""
    _ensure_eastc_runtime()
    if len(data) == 0:
        return _eastc.east_beast2_segment_boundary_hash(NULL, 0)
    cdef const uint8_t* p = <const uint8_t*><char*>data
    return _eastc.east_beast2_segment_boundary_hash(p, len(data))


cpdef bint _segment_is_boundary(unsigned int hash, size_t count, size_t nbytes):
    """The rule's hash test alone: whether an element hashing to ``hash``
    starts a segment after an open one of ``count`` elements and ``nbytes``
    logical bytes."""
    return _eastc.east_beast2_segment_is_boundary(hash, count, nbytes)


cpdef bint _starts_segment_after(size_t count, size_t nbytes, bytes hash_input):
    """The whole rule for every element but a collection's first: the bounds,
    then the hash test on ``hash_input``."""
    _ensure_eastc_runtime()
    if len(hash_input) == 0:
        return _eastc.east_beast2_starts_segment_after(count, nbytes, NULL, 0)
    cdef const uint8_t* p = <const uint8_t*><char*>hash_input
    return _eastc.east_beast2_starts_segment_after(count, nbytes, p, len(hash_input))


cpdef unsigned long long _fnv1a64(bytes data):
    """The 64-bit FNV-1a hash the boundary rule is built on."""
    _ensure_eastc_runtime()
    if len(data) == 0:
        return _eastc.east_beast2_fnv1a64(NULL, 0)
    cdef const uint8_t* p = <const uint8_t*><char*>data
    return _eastc.east_beast2_fnv1a64(p, len(data))


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

    def set_parallel(self, bint parallel):
        """Deflate frames on worker threads (issue #763). Before the second
        segment only; the bytes are the inline writer's either way."""
        _eastc.east_beast2_writer_set_parallel(self._w, parallel)

    def __dealloc__(self):
        if self._w != NULL:
            _eastc.east_beast2_writer_free(self._w)
        if self._type != NULL:
            _eastc.east_type_release(self._type)


cdef class _Beast2ElementWriterCore:
    """Thin wrapper over east-c's canonical element writer. The Python-facing
    Beast2ElementWriter in east.serialization.beast2 owns the output stream
    and drains pending bytes after every operation."""

    cdef _eastc.Beast2ElementWriter* _w
    cdef _eastc.EastType* _type

    def __cinit__(self, object py_type, object codec):
        _ensure_eastc_runtime()
        cdef int32_t codec_id = _codec_id(codec)
        self._type = py_type_to_c(py_type)
        self._w = _eastc.east_beast2_element_writer_new(self._type, codec_id)
        if self._w == NULL:
            _eastc.east_type_release(self._type)
            self._type = NULL
            _consume_eastc_error("east-c beast2 element writer construction failed")

    def add(self, object element):
        """Add one element — for a Dict, a ``(key, value)`` pair."""
        cdef _eastc.EastValue* c_head
        cdef _eastc.EastValue* c_value
        cdef bint ok
        if self._type.kind == _eastc.EAST_TYPE_DICT:
            key, value = element
            c_head = py_value_to_c(key, self._type.data.dict.key)
            try:
                c_value = py_value_to_c(value, self._type.data.dict.value)
            except BaseException:
                _eastc.east_value_release(c_head)
                raise
            ok = _eastc.east_beast2_element_writer_add_pair(self._w, c_head, c_value)
            _eastc.east_value_release(c_value)
        else:
            c_head = py_value_to_c(element, self._type.data.element)
            ok = _eastc.east_beast2_element_writer_add(self._w, c_head)
        _eastc.east_value_release(c_head)
        if not ok:
            _consume_eastc_error("east-c beast2 element writer add failed")

    def add_all(self, object batch):
        """Add every element of ``batch``, a value of the collection type, in
        its order — one conversion and a loop in C, however many elements."""
        cdef _eastc.EastValue* c_val = py_value_to_c(batch, self._type)
        cdef bint ok = self._add_each(c_val)
        _eastc.east_value_release(c_val)
        if not ok:
            _consume_eastc_error("east-c beast2 element writer add failed")

    cdef bint _add_each(self, _eastc.EastValue* batch) noexcept:
        cdef size_t i
        if self._type.kind == _eastc.EAST_TYPE_ARRAY:
            for i in range(_eastc.east_array_len(batch)):
                if not _eastc.east_beast2_element_writer_add(self._w, _eastc.east_array_get(batch, i)):
                    return False
        elif self._type.kind == _eastc.EAST_TYPE_SET:
            for i in range(_eastc.east_set_len(batch)):
                if not _eastc.east_beast2_element_writer_add(self._w, _eastc.east_set_at(batch, i)):
                    return False
        else:
            for i in range(_eastc.east_dict_len(batch)):
                if not _eastc.east_beast2_element_writer_add_pair(
                        self._w, _eastc.east_dict_key_at(batch, i), _eastc.east_dict_val_at(batch, i)):
                    return False
        return True

    def take(self):
        cdef _eastc.ByteBuffer* buf = _eastc.east_beast2_element_writer_take(self._w)
        if buf == NULL:
            return b""
        cdef bytes result = buf.data[:buf.len]
        _eastc.byte_buffer_free(buf)
        return result

    def finish(self):
        if not _eastc.east_beast2_element_writer_finish(self._w):
            _consume_eastc_error("east-c beast2 element writer finish failed")

    def set_parallel(self, bint parallel):
        """Deflate frames on worker threads (issue #763); where the segments
        fall never depends on it."""
        _eastc.east_beast2_element_writer_set_parallel(self._w, parallel)

    def segments(self):
        """Segments closed so far; the open one is not counted."""
        return _eastc.east_beast2_element_writer_segments(self._w)

    def __dealloc__(self):
        if self._w != NULL:
            _eastc.east_beast2_element_writer_free(self._w)
        if self._type != NULL:
            _eastc.east_type_release(self._type)


cdef class _Beast2ReaderCore:
    """Thin wrapper over east-c's sequential v5 segment reader. Holds a
    contiguous view of the source bytes for the reader's whole lifetime
    (the C reader borrows the buffer). An optional column projection (#599)
    narrows every decoded segment; the reader keeps it alive."""

    cdef _eastc.Beast2SegmentReader* _r
    cdef _eastc.EastType* _type
    cdef const uint8_t[::1] _view
    cdef object _projection
    cdef _eastc.EastType* _out_type  # borrowed from _type or the projection

    def __cinit__(self, object py_type, object data, object projection=None):
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
        self._out_type = self._type
        if projection is not None and not (<_Beast2Projection>projection).is_identity():
            self._projection = projection
            _eastc.east_beast2_reader_set_projection(
                self._r, (<_Beast2Projection>projection)._pr)
            self._out_type = (<_Beast2Projection>projection)._proj

    def next(self):
        """Decode the next segment, or return None at the terminator."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_reader_next(self._r)
        if c_val == NULL:
            if _eastc.east_beast2_reader_done(self._r):
                return None
            _consume_eastc_error("east-c beast2 v5 reader failed")
        try:
            return c_value_to_py(c_val, self._out_type)
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


cdef class _Beast2PagesCore:
    """Thin wrapper over east-c's v5 paging reader. Holds a contiguous view of
    the source bytes for the pages object's whole lifetime — the C pager
    borrows the buffer and every segment() call reads from it, so the view
    must live on the extension type, never as a local."""

    cdef _eastc.Beast2Pages* _p
    cdef _eastc.EastType* _type
    cdef const uint8_t[::1] _view
    cdef object _projection
    cdef _eastc.EastType* _out_type  # borrowed from _type or the projection

    def __cinit__(self, object py_type, object data):
        _ensure_eastc_runtime()
        self._view = data
        self._type = py_type_to_c(py_type)
        cdef const uint8_t* ptr = NULL
        if self._view.shape[0] > 0:
            ptr = &self._view[0]
        self._p = _eastc.east_beast2_pages_new(ptr, <size_t>self._view.shape[0], self._type)
        if self._p == NULL:
            _eastc.east_type_release(self._type)
            self._type = NULL
            _consume_eastc_error("east-c beast2 v5 pages construction failed")
        self._out_type = self._type

    def set_projection(self, object projection):
        """Install an open-time column projection (#599): every pager read —
        segments, elements, keyed gets, the shared cache — serves the subset
        shape from now on. Pass None to clear."""
        if projection is None or (<_Beast2Projection>projection).is_identity():
            self._projection = None
            _eastc.east_beast2_pages_set_projection(self._p, NULL)
            self._out_type = self._type
            return
        self._projection = projection
        _eastc.east_beast2_pages_set_projection(
            self._p, (<_Beast2Projection>projection)._pr)
        self._out_type = (<_Beast2Projection>projection)._proj

    def segment_count(self):
        return _eastc.east_beast2_pages_segment_count(self._p)

    def element_count(self):
        return _eastc.east_beast2_pages_element_count(self._p)

    def self_contained(self):
        return _eastc.east_beast2_pages_self_contained(self._p) != 0

    def counts(self):
        """Per-segment element (pair) counts, in segment order."""
        cdef size_t n = 0
        cdef const size_t* c = _eastc.east_beast2_pages_counts(self._p, &n)
        if c == NULL:
            return ()
        return tuple([c[k] for k in range(n)])

    def segment(self, object i):
        """Seek to and decode exactly one segment."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_pages_segment(self._p, <size_t>i)
        if c_val == NULL:
            _consume_eastc_error("east-c beast2 v5 pages segment failed")
        try:
            return c_value_to_py(c_val, self._out_type)
        finally:
            _eastc.east_value_release(c_val)

    def segment_projected(self, object i, object projection):
        """Segment ``i`` decoded through a per-operation column projection
        (#599) — a fresh decode that never touches the pager's shared cache.
        Raises :class:`Beast2ProjectionAlias` when a shared container crosses
        the projection boundary (retry with :meth:`segment`)."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_pages_segment_projected(
            self._p, <size_t>i, (<_Beast2Projection>projection)._pr)
        if c_val == NULL:
            _consume_projection_error("east-c beast2 v5 projected segment failed")
        try:
            return c_value_to_py(c_val, (<_Beast2Projection>projection)._proj)
        finally:
            _eastc.east_value_release(c_val)

    def segment_disjoint_projected(self, object i, object projection):
        """The disjointness-checked sibling of :meth:`segment_projected` for
        Set/Dict roots — fences verify on whole keys, the decode is narrow
        and uncached."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_pages_segment_disjoint_projected(
            self._p, <size_t>i, (<_Beast2Projection>projection)._pr)
        if c_val == NULL:
            _consume_projection_error("east-c beast2 v5 projected disjoint segment failed")
        try:
            return c_value_to_py(c_val, (<_Beast2Projection>projection)._proj)
        finally:
            _eastc.east_value_release(c_val)

    def element(self, object row):
        """Decode the one element at `row` (Array roots only)."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_pages_element(self._p, <size_t>row)
        if c_val == NULL:
            _consume_eastc_error("east-c beast2 v5 pages element failed")
        try:
            return c_value_to_py(c_val, self._out_type.data.element)
        finally:
            _eastc.east_value_release(c_val)

    def fence(self, object i):
        """Segment ``i``'s first element (Array/Set) or first key (Dict) — a
        bounded-inflate probe of the frame's prefix, cached C-side."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_pages_fence(self._p, <size_t>i)
        if c_val == NULL:
            _consume_eastc_error("east-c beast2 v5 pages fence failed")
        cdef _eastc.EastType* fence_t = self._type.data.element
        if self._type.kind == _eastc.EAST_TYPE_DICT:
            fence_t = self._type.data.dict.key
        try:
            return c_value_to_py(c_val, fence_t)
        finally:
            _eastc.east_value_release(c_val)

    def get_key(self, object key):
        """Keyed lookup — ``(found, value)`` for Dict roots, ``(found, None)``
        for Set membership. One fence binary search plus at most one cached
        segment decode, all in east-c."""
        cdef _eastc.EastType* kt = self._type.data.element
        if self._type.kind == _eastc.EAST_TYPE_DICT:
            kt = self._type.data.dict.key
        cdef _eastc.EastValue* c_key = py_value_to_c(key, kt)
        cdef _eastc.EastValue* c_val = NULL
        cdef int rc = _eastc.east_beast2_pages_get_key(self._p, c_key, &c_val)
        _eastc.east_value_release(c_key)
        if rc < 0:
            _consume_eastc_error("east-c beast2 v5 keyed read failed")
        if c_val == NULL:
            return (rc == 1, None)
        try:
            return (True, c_value_to_py(c_val, self._out_type.data.dict.value))
        finally:
            _eastc.east_value_release(c_val)

    def get_keys(self, object keys):
        """Batched Dict lookup — ``(found, missing)``: a dict of the present
        pairs and the set of absent keys. east-c merges the sorted keys
        against the fences, so each owning segment decodes exactly once."""
        cdef _eastc.EastType* set_t = _eastc.east_set_type(self._type.data.dict.key)
        cdef _eastc.EastValue* c_keys = py_value_to_c(keys, set_t)
        cdef _eastc.EastValue* c_missing = NULL
        cdef _eastc.EastValue* c_found = _eastc.east_beast2_pages_get_keys(
            self._p, c_keys, &c_missing)
        _eastc.east_value_release(c_keys)
        if c_found == NULL:
            _consume_eastc_error("east-c beast2 v5 batched keyed read failed")
        try:
            return (c_value_to_py(c_found, self._out_type), c_value_to_py(c_missing, set_t))
        finally:
            _eastc.east_value_release(c_found)
            _eastc.east_value_release(c_missing)

    def find_sorted(self, object target, bint last):
        """Global insertion index for ``target`` over a sorted Array file —
        fences pick the boundary segment, its in-segment search adds the base."""
        cdef _eastc.EastValue* c_target = py_value_to_c(target, self._type.data.element)
        cdef size_t idx = 0
        cdef bint ok = _eastc.east_beast2_pages_find_sorted(self._p, c_target, last, &idx)
        _eastc.east_value_release(c_target)
        if not ok:
            _consume_eastc_error("east-c beast2 v5 find_sorted failed")
        return idx

    def segment_disjoint(self, object i):
        """Segment ``i`` under the keyed-read disjointness contract (Set/Dict
        roots): fences verified ascending, the decoded segment's greatest key
        checked against the next fence — the stream the W4 folds consume."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_pages_segment_disjoint(
            self._p, <size_t>i)
        if c_val == NULL:
            _consume_eastc_error("east-c beast2 v5 disjoint segment read failed")
        try:
            return c_value_to_py(c_val, self._out_type)
        finally:
            _eastc.east_value_release(c_val)

    def __dealloc__(self):
        if self._p != NULL:
            _eastc.east_beast2_pages_free(self._p)
        if self._type != NULL:
            _eastc.east_type_release(self._type)


# ─── The streaming emit sink (issues #507, #518, #770) ────────────────────
#
# The streamTask emit capability over east-c's library sink
# (east/emit_sink.h) — the very code the east-c CLI runs, so the two runners
# write the same bytes for the same emissions. Everything per row happens in
# C: the cut, the ascending check, the --merge / --union folds of adjacent
# equal keys, and the duplicate and out-of-order messages. _EmitSinkCore
# owns the EastEmitSink*; _EmitSink (east-py-cli) validates the emit
# parameter. _merge_blobs below is the fan-in's twin: east-c's blob merge
# (east/merge.h) behind `east-py merge`.


cdef struct _EmitSinkEntry:
    # The sink's own function value (retained): its invoke is the per-row
    # entry, reading the EastEmitSink* from its userdata.
    _eastc.EastValue* sink_fn
    # The _EmitSinkCore (one reference): the sink the entry reaches into
    # lives exactly as long as the core, so every function value handed out
    # holds the core.
    PyObject* owner


cdef _eastc.EvalResult _emit_sink_invoke(_eastc.EastCompiledFn* self,
                                         _eastc.EastValue** args, size_t n) noexcept:
    """Forward one emitted row to the sink's per-row entry — pure C, no
    python per row."""
    cdef _EmitSinkEntry* entry = <_EmitSinkEntry*>self.invoke_userdata
    return _eastc.east_call(entry.sink_fn.data.function.compiled, args, n)


cdef void _emit_sink_release(void* ud) noexcept with gil:
    cdef _EmitSinkEntry* entry = <_EmitSinkEntry*>ud
    if entry == NULL:
        return
    if entry.sink_fn != NULL:
        _eastc.east_value_release(entry.sink_fn)
    Py_XDECREF(entry.owner)
    free(entry)


cdef class _EmitSinkCore:
    """Owner of one east-c emit sink behind a streamTask ``emit``.

    ``kind``: 0 = array, 1 = set, 2 = dict; ``emit_types`` the emit
    parameter's argument types (the element, or the key and the value). The
    sink opens ``output_path`` at construction. Set and Dict emissions must
    ascend in East order: an out-of-order key is an error, and so is an
    equal key unless the sink folds it — ``merge`` (a compiled
    ``(K, V, V) -> V`` East function; a dict sink folds an adjacent equal
    key with it, in emission order) or ``union_mode`` (an adjacent equal set
    element collapses into the previous one).

    Raises ValueError when ``merge`` does not match the emit parameter, or
    when the sink cannot open (the output is not writable, a merge function
    on a non-dict sink, union mode on a non-set sink).
    """

    cdef readonly int kind
    cdef _eastc.EastEmitSink* _sink
    cdef _eastc.EastValue* _sink_fn  # retained: the sink's function value
    cdef _eastc.EastType* _fn_t      # the emit parameter's function type
    cdef _eastc.EastType* _out_type  # the output collection type
    cdef bytes _path                 # borrowed by the sink for its lifetime
    cdef object _merge               # borrowed by the sink for its lifetime

    def __cinit__(self, int kind, object emit_types, object output_path, object merge=None,
                  bint union_mode=False):
        import os

        from east.types.types import FunctionType, NullType

        _ensure_eastc_runtime()
        self.kind = kind
        self._fn_t = py_type_to_c(FunctionType(list(emit_types), NullType))
        cdef _eastc.EastType** ins = self._fn_t.data.function.inputs
        if kind == 2:
            self._out_type = _eastc.east_dict_type(ins[0], ins[1])
        elif kind == 1:
            self._out_type = _eastc.east_set_type(ins[0])
        else:
            self._out_type = _eastc.east_array_type(ins[0])
        # east-c opens the output with fopen, which reads the bytes in the
        # ANSI code page on Windows.
        self._path = _c_path(output_path)

        cdef _eastc.EastCompiledFn* merge_fn = NULL
        if merge is not None:
            merge_fn = <_eastc.EastCompiledFn*><uintptr_t>merge._eastc_handle._compiled
            if kind == 2:
                self._check_merge(merge_fn)
            self._merge = merge

        cdef _eastc.EastEmitSinkConfig cfg
        cfg.kind = <_eastc.EastEmitKind>kind
        cfg.out_type = self._out_type
        cfg.output_path = <const char*>self._path
        cfg.merge_fn = merge_fn
        cfg.union_mode = union_mode
        self._sink = _eastc.east_emit_sink_new(&cfg)
        if self._sink == NULL:
            _consume_eastc_error("emit: failed to open the sink", ValueError)
        self._sink_fn = _eastc.east_emit_sink_function(self._sink, self._fn_t)
        if self._sink_fn == NULL:
            raise MemoryError()

    cdef void _check_merge(self, _eastc.EastCompiledFn* merge_fn) except *:
        """The --merge function must be (K, V, V) -> V over the emit
        parameter's key and value types — the east-c CLI's check and
        message."""
        cdef _eastc.EastType* key_t = self._fn_t.data.function.inputs[0]
        cdef _eastc.EastType* val_t = self._fn_t.data.function.inputs[1]
        cdef _eastc.EastType* t = merge_fn.fn_type if merge_fn != NULL else NULL
        if (t != NULL and t.kind == _eastc.EAST_TYPE_FUNCTION
                and t.data.function.num_inputs == 3
                and _eastc.east_type_equal(t.data.function.inputs[0], key_t)
                and _eastc.east_type_equal(t.data.function.inputs[1], val_t)
                and _eastc.east_type_equal(t.data.function.inputs[2], val_t)
                and _eastc.east_type_equal(t.data.function.output, val_t)):
            return
        from east.serialization.east_printer import print_type

        got = print_type(_c_type_tag_to_py_type(t)) if t != NULL else "?"
        raise ValueError(
            "--merge: expected a function (K, V, V) -> V matching the emit parameter "
            f"(K = {print_type(_c_type_tag_to_py_type(key_t))}, "
            f"V = {print_type(_c_type_tag_to_py_type(val_t))}), got {got}")

    def __dealloc__(self):
        if self._sink_fn != NULL:
            _eastc.east_value_release(self._sink_fn)
        if self._sink != NULL:
            _eastc.east_emit_sink_free(self._sink)
        if self._out_type != NULL:
            _eastc.east_type_release(self._out_type)
        if self._fn_t != NULL:
            _eastc.east_type_release(self._fn_t)

    def function_value(self):
        """The emit capability as the bridge's standard CALL WRAPPER around
        the sink's function value: passed to a compiled body's FunctionType
        parameter it hands east-c the value itself (``_east_c_handle``), so
        the per-row loop runs with no python; its declared type is the emit
        parameter's, so signature introspection answers.

        It is also CALLABLE (issue #592): a harness that invokes a
        ``@platform_function`` directly from python gets the same shape a
        compiled body's decode gives it. Called on plain values it marshals
        one row through the sink's per-row entry, as :meth:`emit` does;
        called from inside a trace it lowers to an IR ``Call`` on the sink
        (#561), so a pure ``for_each(lambda k, v: emit(k, v))`` still runs
        with zero python per row. The value holds this core, so the sink
        stays open while any copy of it lives.
        """
        cdef _EmitSinkEntry* entry = <_EmitSinkEntry*>malloc(sizeof(_EmitSinkEntry))
        if entry == NULL:
            raise MemoryError()
        entry.sink_fn = self._sink_fn
        _eastc.east_value_retain(entry.sink_fn)
        entry.owner = <PyObject*>self
        Py_INCREF(self)
        cdef _eastc.EastValue* fv = _eastc.east_foreign_function(
            <_eastc.EastInvokeFn>_emit_sink_invoke, <void*>entry, _emit_sink_release, self._fn_t)
        if fv == NULL:
            # east_foreign_function released the entry (and its references).
            raise MemoryError()
        try:
            # The bridge's own function wrapper — it retains the value and
            # its parameter types, tags itself with _east_c_handle, and routes
            # a proxy-argument call through _lower_compiled_call, like every
            # other compiled East function value.
            return c_value_to_py(fv, self._fn_t)
        finally:
            _eastc.east_value_release(fv)  # the wrapper owns it from here

    def emit(self, *args):
        """The python-boundary entry: marshal one row and invoke the sink's
        per-row entry — the path a compiled body's call takes."""
        cdef _eastc.EastValue* c_args[2]
        cdef size_t need = 2 if self.kind == 2 else 1
        cdef _eastc.EvalResult r
        if <size_t>len(args) < need:
            raise TypeError("emit: missing argument")
        c_args[0] = py_value_to_c(args[0], self._fn_t.data.function.inputs[0])
        if need == 2:
            try:
                c_args[1] = py_value_to_c(args[1], self._fn_t.data.function.inputs[1])
            except BaseException:
                _eastc.east_value_release(c_args[0])
                raise
        r = _eastc.east_call(self._sink_fn.data.function.compiled, c_args, need)
        _eastc.east_value_release(c_args[0])
        if need == 2:
            _eastc.east_value_release(c_args[1])
        if r.value != NULL:
            _eastc.east_value_release(r.value)
            r.value = NULL
        if r.status != _eastc.EVAL_OK and r.status != _eastc.EVAL_RETURN:
            from east.runtime.errors import EastError
            msg = r.error_message.decode("utf-8") if r.error_message != NULL \
                else "emit failed"
            _eastc.eval_result_free(&r)
            raise EastError(msg, [])
        _eastc.eval_result_free(&r)

    def finish(self):
        """Write the held entry, then the terminator and index. On failure
        the output is left unfinalized and EastError carries the sink's
        message."""
        cdef char* err
        if _eastc.east_emit_sink_finish(self._sink):
            return
        err = _eastc.east_builtin_get_error()
        msg = "emit: failed to finalize the emitted output"
        if err != NULL:
            msg = (<bytes>err).decode("utf-8", errors="replace")
            free(err)
        from east.runtime.errors import EastError
        raise EastError(msg, [])

    def stats(self):
        """The sink's counter: ``emitted``, every emission including the
        ones that folded."""
        cdef _eastc.EastEmitSinkStats st
        _eastc.east_emit_sink_stats(self._sink, &st)
        return {"emitted": st.emitted}


cdef bytes _c_path(object path):
    """A path as the bytes east-c's fopen reads: the ANSI code page on
    Windows, the filesystem encoding elsewhere."""
    import os

    if os.name == "nt":
        return str(path).encode("mbcs")
    return os.fsencode(path)


def _merge_blobs(object input_paths, object output_path, object merge=None,
                 bint union_mode=False, object range_path=None):
    """Merge sorted Set or Dict blobs of one type into one — east-c's
    ``east_merge_blobs`` (east/merge.h), the very code ``east-c merge`` runs,
    so the two runners write the same bytes (#770). One pass: every input is
    read segment by segment through a mapping, a heap over the inputs yields
    keys in East order, and the output goes through the emit sink's writer,
    byte-identical to what ``run --emit`` writes for the same entries emitted
    ascending. Equal keys fold in input order — ``merge`` (a compiled
    ``(K, V, V) -> V`` East function) on Dict inputs, ``union_mode`` (the
    first element stands) on Set inputs — and are the duplicate error
    without a fold. With ``range_path`` — a beast2 blob of ``Struct{from:
    Option<K>, to: Option<K>}`` over the inputs' key type, an absent bound
    open — only the keys in ``[from, to)`` merge: every input is sought to
    the segment owning ``from`` through its fences.

    Returns ``{"inputs", "entries", "folds"}``. Raises ValueError with
    east-c's message — an input of another type than input 0's, an Array,
    keys that do not ascend, a fold whose signature does not match the
    inputs, bounds of another shape than the inputs' key type, a file that
    cannot be opened — leaving the output unfinalised.
    """
    _ensure_eastc_runtime()
    encoded = [_c_path(p) for p in input_paths]
    cdef bytes out_bytes = _c_path(output_path)
    cdef bytes range_bytes = _c_path(range_path) if range_path is not None else b""
    cdef size_t n = len(encoded)
    cdef const char** c_paths = <const char**>malloc((n if n > 0 else 1) * sizeof(char*))
    if c_paths == NULL:
        raise MemoryError()
    cdef size_t i
    for i in range(n):
        c_paths[i] = <const char*>(<bytes>encoded[i])
    cdef _eastc.EastCompiledFn* merge_fn = NULL
    if merge is not None:
        merge_fn = <_eastc.EastCompiledFn*><uintptr_t>merge._eastc_handle._compiled
    cdef _eastc.EastMergeConfig cfg
    cfg.input_paths = c_paths
    cfg.num_inputs = n
    cfg.output_path = <const char*>out_bytes
    cfg.merge_fn = merge_fn
    cfg.union_mode = union_mode
    cfg.range_path = <const char*>range_bytes if range_path is not None else NULL
    cdef _eastc.EastMergeStats st
    cdef bint ok
    try:
        ok = _eastc.east_merge_blobs(&cfg, &st)
    finally:
        free(c_paths)
    if not ok:
        _consume_eastc_error("merge failed", ValueError)
    return {"inputs": st.inputs, "entries": st.entries, "folds": st.folds}


def _beast2_read_type(object data):
    """The type schema embedded in a beast2-full blob (v4 or v5), as the
    python type descriptor. Parses only the header — no value decodes."""
    cdef const uint8_t[::1] view = data
    _ensure_eastc_runtime()
    cdef const uint8_t* ptr = <const uint8_t*>_EMPTY
    cdef size_t n = <size_t>view.shape[0]
    if n > 0:
        ptr = &view[0]
    cdef _eastc.EastType* c_type = _eastc.east_beast2_extract_type(ptr, n)
    if c_type == NULL:
        _consume_eastc_error("beast2: could not extract the type schema", ValueError)
    try:
        return _c_type_tag_to_py_type(c_type)
    finally:
        _eastc.east_type_release(c_type)


def _beast2_splice_extents(object data):
    """Byte extents of one indexed v5 blob (issue #484), parsed by east-c.

    Returns a dict of wire offsets and flags; raises ValueError with east-c's
    message on anything malformed. Never decodes a value.
    """
    cdef const uint8_t[::1] view = data
    _ensure_eastc_runtime()
    cdef const uint8_t* ptr = NULL
    if view.shape[0] > 0:
        ptr = &view[0]
    cdef _eastc.Beast2SpliceExtents* e = _eastc.east_beast2_splice_extents(
        ptr, <size_t>view.shape[0])
    if e == NULL:
        _consume_eastc_error("east-c beast2 v5 splice extents failed", ValueError)
    try:
        return {
            "prefix_end": e.prefix_end,
            "segments_end": e.segments_end,
            "index_offset": e.index_offset,
            "offsets": tuple(e.offsets[i] for i in range(e.segment_count)),
            "counts": tuple(e.counts[i] for i in range(e.segment_count)),
            "self_contained": e.self_contained != 0,
            "source_map_empty": e.source_map_empty != 0,
        }
    finally:
        _eastc.east_beast2_splice_extents_free(e)


def _beast2_splice_tail(object offsets, object counts, object stream_end):
    """Terminator + merged index + footer bytes for a spliced stream (east-c)."""
    _ensure_eastc_runtime()
    cdef size_t n = len(offsets)
    if n != <size_t>len(counts):
        raise ValueError("splice tail: offsets and counts must be the same length")
    cdef size_t* c_offsets = <size_t*>malloc(n * sizeof(size_t)) if n else NULL
    cdef size_t* c_counts = <size_t*>malloc(n * sizeof(size_t)) if n else NULL
    cdef _eastc.ByteBuffer* buf = NULL
    cdef size_t i
    try:
        if n and (c_offsets == NULL or c_counts == NULL):
            raise MemoryError()
        for i in range(n):
            c_offsets[i] = <size_t>offsets[i]
            c_counts[i] = <size_t>counts[i]
        buf = _eastc.east_beast2_splice_tail(c_offsets, c_counts, n, <size_t>stream_end)
        if buf == NULL:
            _consume_eastc_error("east-c beast2 v5 splice tail failed")
        return <bytes>buf.data[:buf.len]
    finally:
        if buf != NULL:
            _eastc.byte_buffer_free(buf)
        free(c_offsets)
        free(c_counts)


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
