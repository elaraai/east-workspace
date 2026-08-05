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
from libc.stdlib cimport free, malloc

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


cdef class _Beast2PagesCore:
    """Thin wrapper over east-c's v5 paging reader. Holds a contiguous view of
    the source bytes for the pages object's whole lifetime — the C pager
    borrows the buffer and every segment() call reads from it, so the view
    must live on the extension type, never as a local."""

    cdef _eastc.Beast2Pages* _p
    cdef _eastc.EastType* _type
    cdef const uint8_t[::1] _view

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
            return c_value_to_py(c_val, self._type)
        finally:
            _eastc.east_value_release(c_val)

    def element(self, object row):
        """Decode the one element at `row` (Array roots only)."""
        cdef _eastc.EastValue* c_val = _eastc.east_beast2_pages_element(self._p, <size_t>row)
        if c_val == NULL:
            _consume_eastc_error("east-c beast2 v5 pages element failed")
        try:
            return c_value_to_py(c_val, self._type.data.element)
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
            return (True, c_value_to_py(c_val, self._type.data.dict.value))
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
            return (c_value_to_py(c_found, self._type), c_value_to_py(c_missing, set_t))
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
            return c_value_to_py(c_val, self._type)
        finally:
            _eastc.east_value_release(c_val)

    def __dealloc__(self):
        if self._p != NULL:
            _eastc.east_beast2_pages_free(self._p)
        if self._type != NULL:
            _eastc.east_type_release(self._type)


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
