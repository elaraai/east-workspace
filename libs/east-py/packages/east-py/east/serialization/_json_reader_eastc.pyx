# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The strict streaming JSON reader, via east-c.

Like every other codec here, the reading is east-c's — python holds the bytes
and the handle and nothing else. That is what makes the three runtimes agree by
construction rather than by two implementations being kept in step: the depth
bound, the accepted lexical forms, surrogate-pair joining and the error text are
one piece of code, not three.

The reader BORROWS the bytes it is opened on for its whole life, so this class
owns them: a file is mapped and the mapping is held until close, which is the
same arrangement east-c-std makes and is why a multi-gigabyte document never
lands on the heap.
"""

from libc.stdlib cimport free
from libc.stdint cimport uint8_t

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py

import mmap as _mmap


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


class JsonReadError(Exception):
    """A document that does not satisfy the contract, located by pointer."""

    def __init__(self, message, pointer=""):
        super().__init__(message)
        self.pointer = pointer


cdef _raise_from(char* error_msg, str fallback):
    """Turn east-c's `error_out` into JsonReadError, freeing it."""
    msg = fallback
    if error_msg != NULL:
        msg = error_msg.decode("utf-8", "replace")
        free(error_msg)
    # east-c writes "<pointer>: <message>" when it has a pointer, so the
    # pointer is recovered rather than tracked a second time in python.
    pointer = ""
    if msg.startswith("/"):
        head, _, _ = msg.partition(": ")
        pointer = head
    raise JsonReadError(msg, pointer)


cdef class JsonReader:
    """A pull reader over a JSON document, backed by east-c."""

    cdef _eastc.EastJsonReader* _reader
    cdef object _owner          # the mmap or bytes the reader borrows
    cdef const uint8_t[::1] _view
    cdef object _file           # kept open while the mapping lives
    cdef bint _closed

    def __cinit__(self):
        self._reader = NULL
        self._owner = None
        self._file = None
        self._closed = False

    @staticmethod
    cdef JsonReader _open(object owner, object file_obj, str pointer, bint enter):
        cdef JsonReader self = JsonReader.__new__(JsonReader)
        self._owner = owner
        self._file = file_obj
        self._view = owner
        _ensure_eastc_runtime()

        cdef size_t length = <size_t>self._view.shape[0]
        cdef const uint8_t* data = NULL
        if length > 0:
            data = &self._view[0]
        else:
            # east-c takes NULL as "no document"; hand it a valid pointer so its
            # own message fires instead.
            data = <const uint8_t*>b""

        cdef bytes ptr_bytes = pointer.encode("utf-8")
        cdef char* error_msg = NULL
        self._reader = _eastc.east_json_reader_open(
            <const char*>data, length, <const char*>ptr_bytes, enter, &error_msg)
        if self._reader == NULL:
            self._release_buffers()
            _raise_from(error_msg, "cannot read the document")
        return self

    cdef _release_buffers(self):
        self._view = None
        self._owner = None
        if self._file is not None:
            self._file.close()
            self._file = None

    @staticmethod
    def _map_file(str path):
        """Map a file read-only, so residency is the kernel's business."""
        handle = open(path, "rb")
        try:
            if handle.seek(0, 2) == 0:
                handle.close()
                raise JsonReadError("the document is empty")
            mapped = _mmap.mmap(handle.fileno(), 0, access=_mmap.ACCESS_READ)
        except JsonReadError:
            raise
        except BaseException:
            handle.close()
            raise
        return mapped, handle

    @staticmethod
    def open_file(str path, str pointer):
        """Open a file and descend to the container the pointer names."""
        mapped, handle = JsonReader._map_file(path)
        return JsonReader._open(mapped, handle, pointer, True)

    @staticmethod
    def open_text(str text, str pointer):
        """Open an in-memory payload and descend to the container."""
        return JsonReader._open(text.encode("utf-8"), None, pointer, True)

    @staticmethod
    def open_value_file(str path, str pointer):
        """Open a file and stop in front of the value, for reading it whole."""
        mapped, handle = JsonReader._map_file(path)
        return JsonReader._open(mapped, handle, pointer, False)

    @staticmethod
    def open_value_text(str text, str pointer):
        """Open a payload and stop in front of the value, for reading it whole."""
        return JsonReader._open(text.encode("utf-8"), None, pointer, False)

    def more(self):
        """Whether another element remains in the container being iterated."""
        if self._reader == NULL:
            return False
        return bool(_eastc.east_json_reader_more(self._reader))

    def next(self, object py_type):
        """Read the next element of the container as ``py_type``."""
        if self._reader == NULL:
            raise JsonReadError("the reader is exhausted")
        cdef _eastc.EastType* c_type = py_type_to_c(py_type)
        cdef char* error_msg = NULL
        cdef _eastc.EastValue* c_val = _eastc.east_json_reader_next(
            self._reader, c_type, &error_msg)
        if c_val == NULL:
            _eastc.east_type_release(c_type)
            _raise_from(error_msg, "the element does not satisfy the type")
        try:
            return c_value_to_py(c_val, c_type)
        finally:
            _eastc.east_value_release(c_val)
            _eastc.east_type_release(c_type)

    def read_value(self, object py_type):
        """Read one whole value, strictly, as ``py_type``."""
        if self._reader == NULL:
            raise JsonReadError("the reader is closed")
        cdef _eastc.EastType* c_type = py_type_to_c(py_type)
        cdef char* error_msg = NULL
        cdef _eastc.EastValue* c_val = _eastc.east_json_reader_read(
            self._reader, c_type, &error_msg)
        if c_val == NULL:
            _eastc.east_type_release(c_type)
            _raise_from(error_msg, "the value does not satisfy the type")
        try:
            return c_value_to_py(c_val, c_type)
        finally:
            _eastc.east_value_release(c_val)
            _eastc.east_type_release(c_type)

    def close(self):
        """Close the reader and release the file it holds."""
        if self._closed:
            return
        self._closed = True
        # The reader borrows the mapping, so it goes first.
        if self._reader != NULL:
            _eastc.east_json_reader_free(self._reader)
            self._reader = NULL
        self._release_buffers()

    def __dealloc__(self):
        if self._reader != NULL:
            _eastc.east_json_reader_free(self._reader)
            self._reader = NULL


__all__ = ["JsonReadError", "JsonReader"]
