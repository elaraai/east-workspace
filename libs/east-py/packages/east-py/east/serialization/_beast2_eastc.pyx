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
from cpython.ref cimport Py_DECREF, Py_INCREF

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


# ─── Native emit accumulator (issue #560, phase 2) ────────────────────────
#
# The per-row half of the streamTask emit sink: an east-c foreign function
# value whose invoke does the compare + append in C — zero python per row —
# calling back into python only at the batch boundaries (flush a segment,
# spill a run, demote to buffered mode). The python side (_EmitSink in
# east-py-cli) keeps every policy decision: file management, byte-adaptive
# batch sizing, spill/merge, and the run/tail bookkeeping — so the output
# bytes are decided by exactly the arithmetic it always ran.


cdef _eastc.EvalResult _emit_accum_invoke(_eastc.EastCompiledFn* self,
                                          _eastc.EastValue** args, size_t n) noexcept with gil:
    """The foreign-function entry east-c calls once per emitted row."""
    cdef _EmitAccumCore core = <_EmitAccumCore>self.invoke_userdata
    return core._accept(args, n)


cdef void _emit_accum_release(void* ud) noexcept with gil:
    Py_DECREF(<object>ud)


cdef class _EmitAccumCore:
    """C-side row accumulator behind a streamTask ``emit`` (issue #560).

    ``kind``: 0 = array, 1 = set, 2 = dict. Rows append into C-backed arrays
    in arrival order; Set/Dict emission tracks the ascending watermark with
    ``east_value_compare`` and raises the duplicate-key error in C. When the
    current batch reaches ``limit`` rows the ``flush`` callback runs (mode 0,
    ascending) or ``spill`` runs (mode 1, buffered); the first out-of-order
    key runs ``demote`` once and flips to buffered mode. The callbacks drain
    the rows with :meth:`take_batch` — a zero-copy proxy wrap.
    """

    cdef int kind
    cdef public int mode          # 0 ascending, 1 buffered
    cdef size_t limit
    cdef size_t run_cap
    cdef size_t count
    cdef public size_t emitted
    cdef _eastc.EastValue* _elems  # array/set rows, or dict KEYS
    cdef _eastc.EastValue* _vals   # dict VALUES (NULL otherwise)
    cdef _eastc.EastValue* _last_key
    cdef _eastc.EastType* _elem_t  # retained: element (or key) type
    cdef _eastc.EastType* _val_t   # retained: dict value type (or NULL)
    cdef object _flush_cb
    cdef object _demote_cb
    cdef object _spill_cb
    cdef object _fn_hold

    def __cinit__(self, int kind, object emit_types, object limit, object run_cap,
                  object flush_cb, object demote_cb, object spill_cb):
        _ensure_eastc_runtime()
        self.kind = kind
        self.mode = 0
        self.limit = <size_t>limit
        self.run_cap = <size_t>run_cap
        self.count = 0
        self.emitted = 0
        self._flush_cb = flush_cb
        self._demote_cb = demote_cb
        self._spill_cb = spill_cb
        self._elem_t = py_type_to_c(emit_types[0])
        self._elems = _eastc.east_array_new(self._elem_t)
        if kind == 2:
            self._val_t = py_type_to_c(emit_types[1])
            self._vals = _eastc.east_array_new(self._val_t)

    def __dealloc__(self):
        if self._elems != NULL:
            _eastc.east_value_release(self._elems)
        if self._vals != NULL:
            _eastc.east_value_release(self._vals)
        if self._last_key != NULL:
            _eastc.east_value_release(self._last_key)
        if self._elem_t != NULL:
            _eastc.east_type_release(self._elem_t)
        if self._val_t != NULL:
            _eastc.east_type_release(self._val_t)

    cdef _eastc.EvalResult _duplicate(self, _eastc.EastValue* key):
        """The duplicate-key refusal, message-identical to the python sink."""
        cdef char* printed = _eastc.east_print_value(key, self._elem_t)
        noun = "Dict" if self.kind == 2 else "Set"
        part = "key" if self.kind == 2 else "element"
        shown = ""
        if printed != NULL:
            shown = ": " + (<bytes>printed).decode("utf-8", "replace")
            free(printed)
        msg = (f"beast2 v5: duplicate {noun} {part} emitted{shown} — "
               f"{noun} {part}s must be unique").encode("utf-8")
        return _eastc.eval_error(<const char*>msg)

    cdef _eastc.EvalResult _accept(self, _eastc.EastValue** args, size_t n):
        cdef size_t need = 2 if self.kind == 2 else 1
        cdef _eastc.EastValue* key
        cdef int order
        if n < need:
            return _eastc.eval_error("emit: missing argument")
        key = args[0]
        if self.mode == 0 and self.kind != 0:
            if self._last_key != NULL:
                order = _eastc.east_value_compare(self._last_key, key)
                if order == 0:
                    return self._duplicate(key)
                if order > 0:
                    # First out-of-order key: hand the ascending prefix to
                    # python (flush + finalize + demote to run #0), then
                    # buffer from here on.
                    try:
                        self._demote_cb()
                    except BaseException as e:
                        msg = f"emit demote failed: {e}".encode("utf-8")
                        return _eastc.eval_error(<const char*>msg)
                    self.mode = 1
                    if self._last_key != NULL:
                        _eastc.east_value_release(self._last_key)
                        self._last_key = NULL
            if self.mode == 0:
                if self._last_key != NULL:
                    _eastc.east_value_release(self._last_key)
                self._last_key = key
                _eastc.east_value_retain(key)
        _eastc.east_array_push(self._elems, args[0])
        if self.kind == 2:
            _eastc.east_array_push(self._vals, args[1])
        self.count += 1
        self.emitted += 1
        cdef size_t threshold = self.limit if self.mode == 0 else self.run_cap
        if threshold > 0 and self.count >= threshold:
            try:
                if self.mode == 0:
                    self._flush_cb()
                else:
                    self._spill_cb()
            except BaseException as e:
                msg = f"emit flush failed: {e}".encode("utf-8")
                return _eastc.eval_error(<const char*>msg)
        return _eastc.eval_ok(_eastc.east_null())

    def emit(self, *args):
        """The python-boundary entry: marshal one row and run the same C
        acceptance path the compiled body uses."""
        cdef _eastc.EastValue* c_args[2]
        cdef size_t n = len(args)
        cdef _eastc.EvalResult r
        if n == 0 or (self.kind == 2 and n < 2):
            raise TypeError("emit: missing argument")
        c_args[0] = py_value_to_c(args[0], self._elem_t)
        if self.kind == 2:
            try:
                c_args[1] = py_value_to_c(args[1], self._val_t)
            except BaseException:
                _eastc.east_value_release(c_args[0])
                raise
        r = self._accept(c_args, 2 if self.kind == 2 else 1)
        _eastc.east_value_release(c_args[0])
        if self.kind == 2:
            _eastc.east_value_release(c_args[1])
        if r.status != _eastc.EVAL_OK and r.status != _eastc.EVAL_RETURN:
            from east.runtime.errors import EastError
            msg = r.error_message.decode("utf-8") if r.error_message != NULL \
                else "emit failed"
            _eastc.eval_result_free(&r)
            raise EastError(msg, [])
        if r.value != NULL:
            _eastc.east_value_release(r.value)

    def set_limit(self, object limit):
        """Update the ascending-mode flush threshold (byte-adaptive sizing
        lives python-side; this carries each refinement back)."""
        self.limit = <size_t>limit

    def pending(self):
        """Rows accumulated since the last drain."""
        return self.count

    def take_batch(self):
        """Drain the accumulated rows as C-backed arrays (zero-copy wraps):
        ``(elements,)`` for array/set sinks, ``(keys, values)`` for dict."""
        cdef _eastc.EastType* arr_t
        elems = None
        vals = None
        arr_t = _eastc.east_array_type(self._elem_t)
        try:
            elems = c_value_to_py(self._elems, arr_t)
        finally:
            _eastc.east_type_release(arr_t)
        _eastc.east_value_release(self._elems)
        self._elems = _eastc.east_array_new(self._elem_t)
        if self.kind == 2:
            arr_t = _eastc.east_array_type(self._val_t)
            try:
                vals = c_value_to_py(self._vals, arr_t)
            finally:
                _eastc.east_type_release(arr_t)
            _eastc.east_value_release(self._vals)
            self._vals = _eastc.east_array_new(self._val_t)
        self.count = 0
        if self.kind == 2:
            return (elems, vals)
        return (elems,)

    def function_value(self, object emit_types):
        """The East function value backing ``emit``: its invoke is this
        accumulator's C entry, and its declared type is
        ``FunctionType(emit_types, NullType)`` so signature introspection
        answers. The returned hold carries ``_east_c_handle`` (the
        conversion fast-path attribute) and keeps this core alive."""
        from east.types.types import FunctionType, NullType

        cdef _eastc.EastType* fn_t = py_type_to_c(FunctionType(list(emit_types), NullType))
        Py_INCREF(self)  # held by the C value; released by _emit_accum_release
        cdef _eastc.EastValue* fv = _eastc.east_foreign_function(
            <_eastc.EastInvokeFn>_emit_accum_invoke, <void*>self,
            _emit_accum_release, fn_t)
        _eastc.east_type_release(fn_t)
        if fv == NULL:
            raise MemoryError()
        cdef uintptr_t fv_ptr = <uintptr_t>fv
        core = self

        class _EmitFnHold:
            __slots__ = ("_east_c_handle", "_core", "_released")

            def __init__(self):
                self._east_c_handle = fv_ptr
                self._core = core
                self._released = False

            def __del__(self):
                if self._released:
                    return
                self._released = True
                from east.runtime._compiler_eastc import _proxy_value_release
                _proxy_value_release(self._east_c_handle)

        hold = _EmitFnHold()
        self._fn_hold = None  # the hold owns the value; the core need not
        return hold


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
