# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Conversion bridge between Python East types/values and east-c C types/values.

Memory management rules:
- py_type_to_c: returns a retained EastType*, caller must east_type_release()
- py_value_to_c: returns a retained EastValue*, caller must east_value_release()
- c_value_to_py: does NOT consume the C value (caller still owns it)
"""

from cpython.bytes cimport PyBytes_AS_STRING, PyBytes_GET_SIZE
from cpython.unicode cimport PyUnicode_AsUTF8AndSize, PyUnicode_DecodeUTF8
from libc.stddef cimport size_t
from libc.stdint cimport int64_t, uint8_t, uintptr_t
from libc.stdlib cimport free, malloc, calloc
from libc.string cimport memcpy, strcmp, strdup
from libc.math cimport NAN, isnan

cimport numpy as cnp

cdef extern from "numpy/arrayobject.h":
    void *PyArray_DATA(cnp.ndarray arr) nogil

# Initialise the numpy C-API table.
cnp.import_array()

from east cimport _eastc

from datetime import UTC
from datetime import datetime as DateTime

import numpy as np
import os
import sys
import weakref

from east.types.values import (
    EastArray,
    EastBlob,
    EastDict,
    EastMatrix,
    EastRef,
    EastSet,
    EastStruct,
    EastVariant,
    EastVector,
    EAST_ELEMENT_TO_DTYPE,
    east_null,
    is_east_variant,
)

# Try to import Cython-accelerated struct/variant construction
_HAS_CY_STRUCT = False
_HAS_CY_VARIANT = False
try:
    from east.types._values_cy import CyEastStruct, cy_intern_keys, fast_create_struct
    _HAS_CY_STRUCT = True
except ImportError:
    pass
try:
    from east.types._values_cy import CyEastVariant, fast_create_variant
    _HAS_CY_VARIANT = True
except ImportError:
    pass

# Constants for function IR/captures access (must match compiler.py)
EAST_IR_ATTR = "_east_ir"
EAST_CAPTURES_ATTR = "_east_captures"

# Set on Python wrappers around C-side East functions (by _c_function_to_py).
# When _py_function_to_c sees this attribute it round-trips the wrapper to
# the original C EastValue* directly, preserving captures + any other
# internal state. Without this short-circuit, encoding a previously-decoded
# function loses its capture environment because the wrapper exposes
# captures only via the EAST_CAPTURES_ATTR dict — which _c_function_to_py
# leaves empty (the live captures are inside the C-side EastCompiledFn,
# not the Python wrapper).
EAST_C_HANDLE_ATTR = "_east_c_handle"


# ─── Type cache ───────────────────────────────────────────────────────────
# Keyed by id(py_type). Each entry is (py_type_ref, EastType* as uintptr_t).
# The py_type_ref is stored to validate identity on lookup — id() values are
# reused after garbage collection, so we must verify the Python object is
# actually the same one, not just at the same address.
cdef dict _type_cache = {}

# The strong py_type_ref pins the Python object, so the cache is cleared
# wholesale when it grows past this bound — otherwise ad-hoc type
# construction (a fresh type object per call) accumulates pinned objects
# forever. Long-lived module-level types repopulate within one call.
cdef Py_ssize_t _TYPE_CACHE_MAX = 4096

# Recursive type context stack for py_type_to_c.
# Each entry is an EastType* (as uintptr_t) for the recursive placeholder.
cdef list _type_ctx = []

# ID-dialect recursive placeholders (TS `Recursive(wrapper({id, inner}))`):
# id → EastType* (uintptr_t), scoped to the wrapper's own conversion.
cdef dict _rec_id_ctx = {}


cdef void _type_cache_clear():
    """Release all cached C types."""
    cdef object key
    for key in list(_type_cache):
        entry = _type_cache[key]
        _eastc.east_type_release(<_eastc.EastType*><uintptr_t>entry[1])
    _type_cache.clear()


# ─── Well-known type singletons ──────────────────────────────────────────
# These are lazily populated on first access. Using east-c's pre-built
# types avoids the need to convert deeply recursive Python types.
cdef object _py_ir_type = None
cdef object _py_east_type_type = None
cdef bint _well_known_loaded = False

cdef void _load_well_known_types():
    global _py_ir_type, _py_east_type_type, _well_known_loaded
    if _well_known_loaded:
        return
    _well_known_loaded = True
    try:
        from east.types.type_of_type import IRType, EastTypeType
        _py_ir_type = IRType
        _py_east_type_type = EastTypeType
    except ImportError:
        pass


# ─── py_type_to_c ─────────────────────────────────────────────────────────

cdef _eastc.EastType* py_type_to_c(object py_type) except NULL:
    """Convert a Python EastType (EastVariant) to an east-c EastType*.

    Returns a retained pointer. Caller must call east_type_release().
    Uses a cache keyed by id(py_type) with identity validation.
    Supports recursive types via _type_ctx.
    """
    # Fast path for well-known recursive types — use east-c's pre-built types
    _load_well_known_types()
    if _py_ir_type is not None and py_type is _py_ir_type:
        if _eastc.east_ir_type == NULL:
            _eastc.east_type_of_type_init()
        _eastc.east_type_retain(_eastc.east_ir_type)
        return _eastc.east_ir_type
    if _py_east_type_type is not None and py_type is _py_east_type_type:
        if _eastc.east_type_type == NULL:
            _eastc.east_type_of_type_init()
        _eastc.east_type_retain(_eastc.east_type_type)
        return _eastc.east_type_type

    cdef object cache_key = id(py_type)
    cdef object entry = _type_cache.get(cache_key)
    cdef _eastc.EastType* result

    if entry is not None and entry[0] is py_type:
        result = <_eastc.EastType*><uintptr_t>entry[1]
        _eastc.east_type_retain(result)
        return result

    result = _py_type_to_c_impl(py_type)
    # Cache the result — retain an extra ref for the cache.
    # If a stale entry exists at this id, release its C type first.
    if entry is not None:
        _eastc.east_type_release(<_eastc.EastType*><uintptr_t>entry[1])
    elif len(_type_cache) >= _TYPE_CACHE_MAX:
        _type_cache_clear()
    _eastc.east_type_retain(result)
    _type_cache[cache_key] = (py_type, <uintptr_t>result)
    return result


cdef _eastc.EastType* _py_type_to_c_impl(object py_type) except NULL:
    """Convert without cache lookup. Returns retained pointer."""
    cdef str tag = py_type.type
    cdef _eastc.EastType* result
    cdef _eastc.EastType* elem
    cdef _eastc.EastType* key_type
    cdef _eastc.EastType* val_type
    cdef size_t count, i
    cdef const char** names
    cdef _eastc.EastType** types
    cdef int depth

    # Primitives — return retained pointer to singleton
    if tag == "Null":
        _eastc.east_type_retain(&_eastc.east_null_type)
        return &_eastc.east_null_type
    elif tag == "Boolean":
        _eastc.east_type_retain(&_eastc.east_boolean_type)
        return &_eastc.east_boolean_type
    elif tag == "Integer":
        _eastc.east_type_retain(&_eastc.east_integer_type)
        return &_eastc.east_integer_type
    elif tag == "Float":
        _eastc.east_type_retain(&_eastc.east_float_type)
        return &_eastc.east_float_type
    elif tag == "String":
        _eastc.east_type_retain(&_eastc.east_string_type)
        return &_eastc.east_string_type
    elif tag == "DateTime":
        _eastc.east_type_retain(&_eastc.east_datetime_type)
        return &_eastc.east_datetime_type
    elif tag == "Blob":
        _eastc.east_type_retain(&_eastc.east_blob_type)
        return &_eastc.east_blob_type
    elif tag == "Never":
        _eastc.east_type_retain(&_eastc.east_never_type)
        return &_eastc.east_never_type

    # Array, Set, Ref, Vector, Matrix — single element type. Each nesting level
    # is counted by replace_markers (types.py), so the helper pushes a recursive
    # context level too — otherwise Recursive(depth) markers that recurse THROUGH
    # a container (e.g. BsonValue.document: Dict<String, self>) undercount the
    # stack and fail with "Invalid recursive type depth".
    elif tag == "Array":
        return _convert_single_child_type(py_type.value, 0)
    elif tag == "Set":
        return _convert_single_child_type(py_type.value, 1)
    elif tag == "Ref":
        return _convert_single_child_type(py_type.value, 2)
    elif tag == "Vector":
        return _convert_single_child_type(py_type.value, 3)
    elif tag == "Matrix":
        return _convert_single_child_type(py_type.value, 4)

    # Dict — key + value types (both sit one level deeper, like replace_markers)
    elif tag == "Dict":
        return _convert_dict_type(py_type.value)

    # Struct — named fields (push onto recursive context)
    elif tag == "Struct":
        return _convert_struct_type(py_type.value)

    # Variant — named cases (push onto recursive context)
    elif tag == "Variant":
        return _convert_variant_type(py_type.value)

    # Function / AsyncFunction
    elif tag == "Function":
        return _convert_function_type(py_type.value, is_async=False)
    elif tag == "AsyncFunction":
        return _convert_function_type(py_type.value, is_async=True)

    # Recursive — two serialized dialects share the tag. east-py's builders
    # emit the DEPTH-integer form (a de Bruijn index into _type_ctx); TS and
    # east-c emit the ID form, `ref(id) | wrapper({id, inner})` (east/src/
    # type_of_type.ts), which decoded TS types carry. Accept both.
    elif tag == "Recursive":
        payload = py_type.value
        if not isinstance(payload, int):
            if payload.type == "wrapper":
                rec_id = payload.value["id"]
                result = _eastc.east_recursive_type_new()
                _rec_id_ctx[rec_id] = <uintptr_t>result
                try:
                    elem = py_type_to_c(payload.value["inner"])
                finally:
                    del _rec_id_ctx[rec_id]
                _eastc.east_recursive_type_set(result, elem)
                return result
            if payload.type == "ref":
                if payload.value not in _rec_id_ctx:
                    raise ValueError(f"Recursive ref {payload.value} outside its wrapper scope")
                result = <_eastc.EastType*><uintptr_t>_rec_id_ctx[payload.value]
                _eastc.east_type_retain(result)
                return result
            raise ValueError(f"Unknown Recursive dialect case: {payload.type}")
        depth = payload
        if depth <= 0 or depth > len(_type_ctx):
            raise ValueError(f"Invalid recursive type depth {depth}, stack size {len(_type_ctx)}")
        target_idx = len(_type_ctx) - depth
        target_ptr = <uintptr_t>_type_ctx[target_idx]
        if target_ptr != 0:
            # Stack entry already has a type (or recursive placeholder) — reuse it
            result = <_eastc.EastType*>target_ptr
            _eastc.east_type_retain(result)
            return result
        else:
            # Sentinel — create a recursive placeholder and store it
            result = _eastc.east_recursive_type_new()
            _type_ctx[target_idx] = <uintptr_t>result
            _eastc.east_type_retain(result)  # one for caller, one for stack
            return result

    else:
        raise ValueError(f"Unknown type tag: {tag}")


cdef _eastc.EastType* _convert_struct_type(object fields) except NULL:
    """Convert struct fields list to C struct type.

    Pushes a sentinel (0) onto _type_ctx before converting fields, then
    replaces it with the actual type pointer after creation. This lets
    Recursive(depth) find the in-progress type by walking the stack.
    """
    cdef size_t count = len(fields)
    cdef const char** c_names = <const char**>malloc(count * sizeof(const char*))
    cdef _eastc.EastType** c_types = <_eastc.EastType**>malloc(count * sizeof(_eastc.EastType*))
    cdef size_t i
    cdef list py_name_bytes = []
    cdef Py_ssize_t ctx_idx

    if c_names == NULL or c_types == NULL:
        free(c_names)
        free(c_types)
        raise MemoryError()

    # Push sentinel — Recursive(depth) may replace it with a placeholder
    ctx_idx = len(_type_ctx)
    _type_ctx.append(<uintptr_t>0)

    try:
        for i in range(count):
            field = fields[i]
            name_bytes = field["name"].encode("utf-8")
            py_name_bytes.append(name_bytes)
            c_names[i] = <const char*>PyBytes_AS_STRING(name_bytes)
            c_types[i] = py_type_to_c(field["type"])

        result = _eastc.east_struct_type(c_names, c_types, count)

        for i in range(count):
            _eastc.east_type_release(c_types[i])

        # If Recursive replaced the sentinel with a placeholder, wire it up
        # and return the wrapper so east_type_to_value sees RECURSIVE at top level.
        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_recursive_type_set(<_eastc.EastType*>rec_ptr, result)
            return <_eastc.EastType*>rec_ptr

        return result
    except:
        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_type_release(<_eastc.EastType*>rec_ptr)
        for j in range(i):
            _eastc.east_type_release(c_types[j])
        raise
    finally:
        _type_ctx.pop()
        free(c_names)
        free(c_types)


cdef _eastc.EastType* _convert_variant_type(object cases) except NULL:
    """Convert variant cases list to C variant type."""
    cdef size_t count = len(cases)
    cdef const char** c_names = <const char**>malloc(count * sizeof(const char*))
    cdef _eastc.EastType** c_types = <_eastc.EastType**>malloc(count * sizeof(_eastc.EastType*))
    cdef size_t i
    cdef list py_name_bytes = []
    cdef Py_ssize_t ctx_idx

    if c_names == NULL or c_types == NULL:
        free(c_names)
        free(c_types)
        raise MemoryError()

    # Push sentinel — Recursive(depth) may replace it with a placeholder
    ctx_idx = len(_type_ctx)
    _type_ctx.append(<uintptr_t>0)

    try:
        for i in range(count):
            case = cases[i]
            name_bytes = case["name"].encode("utf-8")
            py_name_bytes.append(name_bytes)
            c_names[i] = <const char*>PyBytes_AS_STRING(name_bytes)
            c_types[i] = py_type_to_c(case["type"])

        result = _eastc.east_variant_type(c_names, c_types, count)

        for i in range(count):
            _eastc.east_type_release(c_types[i])

        # If Recursive replaced the sentinel with a placeholder, wire it up
        # and return the wrapper (not the inner type) so east_type_to_value
        # sees the RECURSIVE node and emits proper Recursive(depth) values.
        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_recursive_type_set(<_eastc.EastType*>rec_ptr, result)
            # Return the wrapper — it wraps the result and is the canonical type
            return <_eastc.EastType*>rec_ptr

        return result
    except:
        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_type_release(<_eastc.EastType*>rec_ptr)
        for j in range(i):
            _eastc.east_type_release(c_types[j])
        raise
    finally:
        _type_ctx.pop()
        free(c_names)
        free(c_types)


cdef _eastc.EastType* _convert_single_child_type(object child_py, int kind) except NULL:
    """Convert a single-child structural type, managing the recursive _type_ctx
    level the same way _convert_struct_type does.

    Every nesting level is counted by replace_markers (types.py), so each
    container must push a level. Without this, a Recursive(depth) marker that
    recurses through the container resolves against too-shallow a stack.
    kind: 0=Array 1=Set 2=Ref 3=Vector 4=Matrix.
    """
    cdef Py_ssize_t ctx_idx = len(_type_ctx)
    cdef _eastc.EastType* elem = NULL
    cdef _eastc.EastType* result
    cdef uintptr_t rec_ptr

    # Push sentinel — Recursive(depth) may replace it with a placeholder.
    _type_ctx.append(<uintptr_t>0)
    try:
        elem = py_type_to_c(child_py)
        if kind == 0:
            result = _eastc.east_array_type(elem)
        elif kind == 1:
            result = _eastc.east_set_type(elem)
        elif kind == 2:
            result = _eastc.east_ref_type(elem)
        elif kind == 3:
            result = _eastc.east_vector_type(elem)
        else:
            result = _eastc.east_matrix_type(elem)
        _eastc.east_type_release(elem)
        elem = NULL

        # If Recursive replaced the sentinel with a placeholder (this container is
        # the recursion node), wire it up and return the wrapper.
        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_recursive_type_set(<_eastc.EastType*>rec_ptr, result)
            return <_eastc.EastType*>rec_ptr
        return result
    except:
        if elem != NULL:
            _eastc.east_type_release(elem)
        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_type_release(<_eastc.EastType*>rec_ptr)
        raise
    finally:
        _type_ctx.pop()


cdef _eastc.EastType* _convert_dict_type(object value) except NULL:
    """Convert a Dict type, managing the recursive _type_ctx level. Key and value
    both sit one level deeper (replace_markers increments both), so a single
    pushed level covers them."""
    cdef Py_ssize_t ctx_idx = len(_type_ctx)
    cdef _eastc.EastType* key_type = NULL
    cdef _eastc.EastType* val_type = NULL
    cdef _eastc.EastType* result
    cdef uintptr_t rec_ptr

    # Push sentinel — Recursive(depth) may replace it with a placeholder.
    _type_ctx.append(<uintptr_t>0)
    try:
        key_type = py_type_to_c(value["key"])
        val_type = py_type_to_c(value["value"])
        result = _eastc.east_dict_type(key_type, val_type)
        _eastc.east_type_release(key_type)
        key_type = NULL
        _eastc.east_type_release(val_type)
        val_type = NULL

        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_recursive_type_set(<_eastc.EastType*>rec_ptr, result)
            return <_eastc.EastType*>rec_ptr
        return result
    except:
        if key_type != NULL:
            _eastc.east_type_release(key_type)
        if val_type != NULL:
            _eastc.east_type_release(val_type)
        rec_ptr = <uintptr_t>_type_ctx[ctx_idx]
        if rec_ptr != 0:
            _eastc.east_type_release(<_eastc.EastType*>rec_ptr)
        raise
    finally:
        _type_ctx.pop()


cdef _eastc.EastType* _convert_function_type(object value, bint is_async) except NULL:
    """Convert function type to C."""
    cdef object inputs = value["inputs"]
    cdef size_t num_inputs = len(inputs)
    cdef _eastc.EastType** input_types = <_eastc.EastType**>malloc(num_inputs * sizeof(_eastc.EastType*))
    cdef _eastc.EastType* output_type = NULL
    cdef size_t i, j

    if input_types == NULL and num_inputs > 0:
        raise MemoryError()

    # Zero-init so the finally block releases exactly what was converted,
    # whether py_type_to_c raises on an input, on the output, or not at all.
    for i in range(num_inputs):
        input_types[i] = NULL

    try:
        for i in range(num_inputs):
            input_types[i] = py_type_to_c(inputs[i])

        output_type = py_type_to_c(value["output"])

        # The constructors retain inputs/output; our references are dropped
        # in the finally block.
        if is_async:
            return _eastc.east_async_function_type(input_types, num_inputs, output_type)
        else:
            return _eastc.east_function_type(input_types, num_inputs, output_type)
    finally:
        if output_type != NULL:
            _eastc.east_type_release(output_type)
        for j in range(num_inputs):
            if input_types[j] != NULL:
                _eastc.east_type_release(input_types[j])
        free(input_types)


# ─── c_value_to_py ────────────────────────────────────────────────────────

cdef object c_value_to_py(_eastc.EastValue *val, _eastc.EastType *c_type):
    """Convert a C EastValue to a Python object.

    Does NOT consume the C value — caller still owns it.
    Uses a pointer→object dict to preserve backreference aliasing.
    """
    cdef dict alias_map = {}
    return _c_value_to_py_impl(val, c_type, alias_map)


# Bounded intern table for short boxed strings (issue #255): repeated slab
# strings — categories, ids — box to the same python object, deduplicating
# memory and enabling identity-fast equality downstream. Content-keyed and
# cleared wholesale when full, so growth is bounded by unique short strings.
cdef dict _str_intern = {}
cdef Py_ssize_t _STR_INTERN_MAX_LEN = 64
cdef Py_ssize_t _STR_INTERN_MAX_SIZE = 1 << 16


cdef inline object _box_string(_eastc.EastValue *val):
    s = PyUnicode_DecodeUTF8(
        val.data.string.data,
        <Py_ssize_t>val.data.string.len,
        NULL,
    )
    if <Py_ssize_t>val.data.string.len <= _STR_INTERN_MAX_LEN:
        cached = _str_intern.get(s)
        if cached is not None:
            return cached
        if len(_str_intern) >= _STR_INTERN_MAX_SIZE:
            _str_intern.clear()
        _str_intern[s] = s
    return s


cdef object _c_value_to_py_impl(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    """Inner conversion with aliasing tracking."""
    cdef _eastc.EastTypeKind kind = c_type.kind
    cdef int64_t millis
    cdef uintptr_t ptr_key

    if kind == _eastc.EAST_TYPE_NULL:
        # Canonical NullType value is the east_null sentinel, matching what
        # construction/coercion produce — not a bare Python None. Returning None
        # here made a decoded `none` compare unequal to the `none` constant and
        # disagree with is_east_null.
        return east_null

    elif kind == _eastc.EAST_TYPE_BOOLEAN:
        return val.data.boolean

    elif kind == _eastc.EAST_TYPE_INTEGER:
        return val.data.integer

    elif kind == _eastc.EAST_TYPE_FLOAT:
        return val.data.float64

    elif kind == _eastc.EAST_TYPE_STRING:
        return _box_string(val)

    elif kind == _eastc.EAST_TYPE_DATETIME:
        millis = val.data.datetime
        return DateTime.fromtimestamp(millis / 1000.0, tz=UTC)

    elif kind == _eastc.EAST_TYPE_BLOB:
        return EastBlob((<char*>val.data.blob.data)[:val.data.blob.len])

    # Mutable types that support backreferences — check alias map
    elif kind == _eastc.EAST_TYPE_ARRAY:
        ptr_key = <uintptr_t>val
        cached = alias_map.get(ptr_key)
        if cached is not None:
            return cached
        return _c_array_to_py(val, c_type, alias_map)

    elif kind == _eastc.EAST_TYPE_SET:
        ptr_key = <uintptr_t>val
        cached = alias_map.get(ptr_key)
        if cached is not None:
            return cached
        return _c_set_to_py(val, c_type, alias_map)

    elif kind == _eastc.EAST_TYPE_DICT:
        ptr_key = <uintptr_t>val
        cached = alias_map.get(ptr_key)
        if cached is not None:
            return cached
        return _c_dict_to_py(val, c_type, alias_map)

    elif kind == _eastc.EAST_TYPE_STRUCT:
        return _c_struct_to_py(val, c_type, alias_map)

    elif kind == _eastc.EAST_TYPE_VARIANT:
        return _c_variant_to_py(val, c_type, alias_map)

    elif kind == _eastc.EAST_TYPE_REF:
        ptr_key = <uintptr_t>val
        cached = alias_map.get(ptr_key)
        if cached is not None:
            return cached
        return _c_ref_to_py(val, c_type, alias_map)

    elif kind == _eastc.EAST_TYPE_VECTOR:
        return _c_vector_to_py(val, c_type)

    elif kind == _eastc.EAST_TYPE_MATRIX:
        return _c_matrix_to_py(val, c_type)

    elif kind == _eastc.EAST_TYPE_RECURSIVE:
        # Resolve through recursive wrapper — value tree is finite so no loop
        return _c_value_to_py_impl(val, c_type.data.recursive.node, alias_map)

    elif kind == _eastc.EAST_TYPE_FUNCTION or kind == _eastc.EAST_TYPE_ASYNC_FUNCTION:
        return _c_function_to_py(val, c_type, alias_map)

    else:
        raise ValueError(f"Unknown C type kind: {kind}")


cdef object _c_array_to_py(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    cdef _eastc.EastType *elem_c = c_type.data.element
    py_elem_type = _c_type_tag_to_py_type(elem_c)
    result = EastArrayProxy._wrap(py_elem_type, <uintptr_t>val, <uintptr_t>elem_c)
    alias_map[<uintptr_t>val] = result
    return result


cdef object _c_set_to_py(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    cdef _eastc.EastType *elem_c = c_type.data.element
    py_elem_type = _c_type_tag_to_py_type(elem_c)
    result = EastSetProxy._wrap(py_elem_type, <uintptr_t>val, <uintptr_t>elem_c)
    alias_map[<uintptr_t>val] = result
    return result


cdef object _c_dict_to_py(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    cdef _eastc.EastType *key_c = c_type.data.dict.key
    cdef _eastc.EastType *val_c = c_type.data.dict.value
    py_key_type = _c_type_tag_to_py_type(key_c)
    py_val_type = _c_type_tag_to_py_type(val_c)
    result = EastDictProxy._wrap(py_key_type, py_val_type, <uintptr_t>val, <uintptr_t>key_c, <uintptr_t>val_c)
    alias_map[<uintptr_t>val] = result
    return result


cdef object _c_struct_to_py(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    cdef size_t n = val.data.struct_.num_fields
    cdef size_t i
    cdef list keys_list = []
    cdef list vals_list = []

    for i in range(n):
        keys_list.append(_eastc.east_struct_field_name(val, i).decode("utf-8"))
        vals_list.append(_c_value_to_py_impl(
            val.data.struct_.field_values[i],
            c_type.data.struct_.fields[i].type,
            alias_map,
        ))

    cdef tuple keys = tuple(keys_list)
    cdef tuple values = tuple(vals_list)

    if _HAS_CY_STRUCT:
        interned_keys, key_index = cy_intern_keys(keys)
        return fast_create_struct(interned_keys, key_index, values)
    else:
        return EastStruct._from_tuples(keys, values)


cdef object _c_variant_to_py(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    cdef const char* case_tag = val.data.variant.case_tag
    cdef str case_name = case_tag.decode("utf-8") if case_tag != NULL else ""
    cdef size_t case_idx = val.data.variant.case_idx
    cdef _eastc.EastType *case_type

    # Use the value's own type — case_idx is relative to the type the value
    # was created with, which is stored on val.data.variant.type.
    cdef _eastc.EastType *vt = val.data.variant.type
    cdef size_t ci
    if vt != NULL and vt.kind == _eastc.EAST_TYPE_RECURSIVE:
        vt = vt.data.recursive.node
    if (vt == NULL or vt.kind != _eastc.EAST_TYPE_VARIANT) and c_type != NULL:
        # Some east-c builtins construct variants without a value-side type
        # (e.g. SetFirstMap's none); fall back to the declared decode type.
        vt = c_type
        if vt.kind == _eastc.EAST_TYPE_RECURSIVE:
            vt = vt.data.recursive.node
    if vt == NULL or vt.kind != _eastc.EAST_TYPE_VARIANT:
        raise ValueError(f"Invalid variant: case={case_name} idx={case_idx}")
    if case_idx >= vt.data.variant.num_cases:
        # case_idx unset/stale — resolve the case by NAME against the type
        case_idx = <size_t>-1
        for ci in range(vt.data.variant.num_cases):
            if case_tag != NULL and strcmp(vt.data.variant.cases[ci].name, case_tag) == 0:
                case_idx = ci
                break
        if case_idx == <size_t>-1:
            raise ValueError(f"Invalid variant: case={case_name} idx={val.data.variant.case_idx}")
    case_type = vt.data.variant.cases[case_idx].type

    py_value = _c_value_to_py_impl(val.data.variant.value, case_type, alias_map)

    if _HAS_CY_VARIANT:
        return fast_create_variant(case_name, py_value)
    else:
        return EastVariant(case_name, py_value)


cdef object _c_ref_to_py(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    cdef _eastc.EastType *inner_c = c_type.data.element
    result = EastRefProxy(<uintptr_t>val, <uintptr_t>inner_c)
    alias_map[<uintptr_t>val] = result
    return result


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


def _release_c_function(uintptr_t val_ptr, uintptr_t output_type_ptr, tuple input_type_ptrs):
    """Release the C function value + its retained input/output types.

    Run as a weakref finalizer when the Python wrapper is collected — the
    wrapper is a plain closure (it carries IR/handle attributes), so it has no
    __dealloc__ of its own to return these references to east-c.
    """
    if val_ptr != 0:
        _eastc.east_value_release(<_eastc.EastValue*>val_ptr)
    if output_type_ptr != 0:
        _eastc.east_type_release(<_eastc.EastType*>output_type_ptr)
    for p in input_type_ptrs:
        if <uintptr_t>p != 0:
            _eastc.east_type_release(<_eastc.EastType*><uintptr_t>p)


cdef object _c_function_to_py(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    """Convert a C function value to a Python callable.

    Instead of extracting IR and recompiling in Python, keeps the C function
    and returns a wrapper that calls east_call. The function executes entirely
    in east-c.
    """
    if val == NULL:
        raise ValueError("NULL function value")
    if val.kind != _eastc.EAST_VAL_FUNCTION:
        raise ValueError(f"Expected EAST_VAL_FUNCTION, got kind {val.kind}")

    # Retain the C function value — the wrapper will own a reference
    _eastc.east_value_retain(val)
    cdef uintptr_t val_ptr = <uintptr_t>val

    # Get the output type for converting results back to Python
    cdef _eastc.EastType *fn_c_type = c_type
    if fn_c_type.kind == _eastc.EAST_TYPE_RECURSIVE:
        fn_c_type = fn_c_type.data.recursive.node
    cdef _eastc.EastType *output_type = fn_c_type.data.function.output
    _eastc.east_type_retain(output_type)
    cdef uintptr_t output_type_ptr = <uintptr_t>output_type

    # Get input types for converting arguments to C
    cdef size_t num_inputs = fn_c_type.data.function.num_inputs
    input_type_ptrs = []
    for i in range(num_inputs):
        _eastc.east_type_retain(fn_c_type.data.function.inputs[i])
        input_type_ptrs.append(<uintptr_t>fn_c_type.data.function.inputs[i])

    def call_eastc_function(*args):
        """Python wrapper that calls the C function via east_call.
        Delegates to _compiler_eastc.so to share _Thread_local with builtins."""
        from east.runtime._compiler_eastc import _invoke_c_function_py
        return _invoke_c_function_py(val_ptr, input_type_ptrs, output_type_ptr, args)

    # The wrapper owns one retain on the function value + its input/output types
    # (acquired above). It is a plain closure, so release them when it is
    # collected. The finalizer holds only the integer pointers, not the wrapper,
    # so it does not keep the wrapper alive.
    weakref.finalize(call_eastc_function, _release_c_function,
                     val_ptr, output_type_ptr, tuple(input_type_ptrs))

    # Attach the C-side EastValue* handle so that _py_function_to_c can
    # round-trip this wrapper back to its original C value (preserving the
    # capture environment and any other internal state). The wrapper holds one
    # retain on the value (acquired above), which keeps the handle valid for its
    # whole lifetime, so the handle fast path always covers the round-trip — no
    # need to also decode source_ir into a Python value here (that conversion
    # was never read back, and its container proxies retained IR sub-values for
    # the wrapper's whole lifetime).
    object.__setattr__(call_eastc_function, EAST_C_HANDLE_ATTR, val_ptr)

    return call_eastc_function


# ─── Helper: C type → Python EastType (EastVariant) ───────────────────────

# Completed cache: C type pointer → fully built Python type. Scoped to a
# single top-level conversion (cleared by _c_type_tag_to_py_type): entries
# are keyed by the raw pointer with no identity revalidation (unlike the
# forward _type_cache), so they must never outlive one reconstruction —
# pointer addresses are reused after east_type_release, and a cached
# recursive subtree's Recursive(depth) is only valid relative to the
# conversion stack it was built under.
cdef dict _py_type_cache = {}

# In-progress stack: list of C type pointers (as uintptr_t) currently being
# converted. When a RECURSIVE node resolves to a pointer already on this
# stack, we return Recursive(depth) instead of recursing infinitely.
# Same principle as east-c's type_equal_ctx assumption stack.
# Scoped to a single top-level conversion alongside _py_type_cache.
cdef list _type_convert_stack = []

# Smallest stack index targeted by any Recursive back-edge produced while
# building the current subtree (INT64_MAX when none). A finished node is
# cached only when no back-edge escapes above its own stack level: C types
# are interned, so a structurally shared subtree WILL be re-hit at a
# different stack depth, and a cached free back-edge's Recursive(depth)
# would silently rebind to the wrong ancestor there. Back-edges bound
# within the subtree are position-independent and safe to cache.
cdef int64_t _BACKREF_NONE = 0x7FFFFFFFFFFFFFFF
cdef int64_t _min_backref = _BACKREF_NONE

cdef object _c_type_tag_to_py_type(_eastc.EastType *c_type):
    """Convert a C EastType* to a Python EastVariant type descriptor.

    Top-level entry point: scopes the reverse caches (_py_type_cache,
    _type_convert_stack) to this single conversion, clearing them on entry
    and exit so pointer-keyed entries never outlive one reconstruction.
    Recursive sub-conversions go through _c_type_tag_to_py_type_inner
    instead — the within-call cache must be preserved across them, as it
    handles shared subtrees and cycle detection.
    """
    global _min_backref
    _py_type_cache.clear()
    _type_convert_stack.clear()
    _min_backref = _BACKREF_NONE
    try:
        return _c_type_tag_to_py_type_inner(c_type)
    finally:
        _py_type_cache.clear()
        _type_convert_stack.clear()
        _min_backref = _BACKREF_NONE


cdef object _c_type_tag_to_py_type_inner(_eastc.EastType *c_type):
    """Convert one node within the current top-level conversion's scope.

    Uses a conversion stack to detect cycles from recursive types and
    emit proper Recursive(depth) references. Owns the within-call cache:
    a node is cached only if no Recursive back-edge escapes above it, so
    a cache hit at a different stack depth can never rebind a back-edge.
    """
    global _min_backref
    cdef uintptr_t key = <uintptr_t>c_type
    cached = _py_type_cache.get(key)
    if cached is not None:
        return cached

    # Check if this pointer is already on the conversion stack (cycle)
    cdef int64_t idx
    for idx in range(len(_type_convert_stack)):
        if <uintptr_t>_type_convert_stack[idx] == key:
            # Cycle detected — return Recursive(depth) where depth counts
            # from the current position back to the matching stack entry.
            # Record the target index so enclosing nodes know a back-edge
            # reaches up to (at least) this level.
            if idx < _min_backref:
                _min_backref = idx
            return EastVariant("Recursive", len(_type_convert_stack) - idx)

    # Track back-edges produced while building this node's subtree. The
    # node's own stack level (if it pushes one) is entry_depth, so a
    # subtree whose deepest back-edge target is >= entry_depth is fully
    # internally bound and safe to cache; anything lower escapes and the
    # escape must propagate to the enclosing node instead.
    cdef int64_t entry_depth = len(_type_convert_stack)
    cdef int64_t saved = _min_backref
    _min_backref = _BACKREF_NONE

    result = _c_type_tag_to_py_type_impl(c_type, key)

    if _min_backref >= entry_depth:
        _py_type_cache[key] = result
        _min_backref = saved
    elif saved < _min_backref:
        _min_backref = saved
    return result


cdef object _c_type_tag_to_py_type_impl(_eastc.EastType *c_type, uintptr_t key):
    cdef _eastc.EastTypeKind kind = c_type.kind

    # RECURSIVE wrapper: resolve to inner node (don't push onto stack —
    # the wrapper is not a container level in the replace_markers depth
    # model; the cycle is detected at the inner node's pointer)
    if kind == _eastc.EAST_TYPE_RECURSIVE:
        if c_type.data.recursive.node == NULL:
            return EastVariant("Recursive", 1)
        return _c_type_tag_to_py_type_inner(c_type.data.recursive.node)

    # Primitives (no children, no cycle risk)
    if kind == _eastc.EAST_TYPE_NULL:
        return EastVariant("Null", None)
    elif kind == _eastc.EAST_TYPE_BOOLEAN:
        return EastVariant("Boolean", None)
    elif kind == _eastc.EAST_TYPE_INTEGER:
        return EastVariant("Integer", None)
    elif kind == _eastc.EAST_TYPE_FLOAT:
        return EastVariant("Float", None)
    elif kind == _eastc.EAST_TYPE_STRING:
        return EastVariant("String", None)
    elif kind == _eastc.EAST_TYPE_DATETIME:
        return EastVariant("DateTime", None)
    elif kind == _eastc.EAST_TYPE_BLOB:
        return EastVariant("Blob", None)
    elif kind == _eastc.EAST_TYPE_NEVER:
        return EastVariant("Never", None)

    # Containers — each pushes one recursion-stack level around child
    # conversion, matching the depth model in replace_markers (types.py, the
    # source of truth) and the forward bridge's _type_ctx, which pushes for
    # every container level. A recursive back-edge THROUGH a container (e.g.
    # Variant{document: Dict<String, self>}) must count the container level,
    # or Recursive(depth) binds to the wrong scope.
    if kind == _eastc.EAST_TYPE_ARRAY:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Array", elem)
        return result
    elif kind == _eastc.EAST_TYPE_SET:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Set", elem)
        return result
    elif kind == _eastc.EAST_TYPE_VECTOR:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Vector", elem)
        return result
    elif kind == _eastc.EAST_TYPE_MATRIX:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Matrix", elem)
        return result
    elif kind == _eastc.EAST_TYPE_REF:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Ref", elem)
        return result
    elif kind == _eastc.EAST_TYPE_DICT:
        # Dict is ONE level: key and value share a single pushed entry,
        # matching replace_markers and the forward _convert_dict_type.
        _type_convert_stack.append(key)
        try:
            k = _c_type_tag_to_py_type_inner(c_type.data.dict.key)
            v = _c_type_tag_to_py_type_inner(c_type.data.dict.value)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Dict", EastStruct({"key": k, "value": v}))
        return result

    # Function/AsyncFunction — no stack push (replace_markers and the forward
    # _convert_function_type keep depth flat across the function boundary)
    if kind == _eastc.EAST_TYPE_FUNCTION or kind == _eastc.EAST_TYPE_ASYNC_FUNCTION:
        inputs = []
        for i in range(c_type.data.function.num_inputs):
            inputs.append(_c_type_tag_to_py_type_inner(c_type.data.function.inputs[i]))
        output = _c_type_tag_to_py_type_inner(c_type.data.function.output)
        from east.types.type_of_type import EastTypeType
        if kind == _eastc.EAST_TYPE_FUNCTION:
            result = EastVariant("Function", EastStruct({
                "inputs": inputs,
                "output": output,
            }))
        else:
            result = EastVariant("AsyncFunction", EastStruct({
                "inputs": inputs,
                "output": output,
            }))
        return result

    # Struct/Variant — push onto stack, one level for all fields/cases
    # (Recursive(depth) counts these entries, like every container above,
    # matching replace_markers and py_type_to_c's _type_ctx)
    _type_convert_stack.append(key)
    try:
        if kind == _eastc.EAST_TYPE_STRUCT:
            fields = []
            for i in range(c_type.data.struct_.num_fields):
                name = c_type.data.struct_.fields[i].name.decode("utf-8")
                ftype = _c_type_tag_to_py_type_inner(c_type.data.struct_.fields[i].type)
                fields.append(EastStruct({"name": name, "type": ftype}))
            result = EastVariant("Struct", fields)
        elif kind == _eastc.EAST_TYPE_VARIANT:
            cases = []
            for i in range(c_type.data.variant.num_cases):
                name = c_type.data.variant.cases[i].name.decode("utf-8")
                ctype = _c_type_tag_to_py_type_inner(c_type.data.variant.cases[i].type)
                cases.append(EastStruct({"name": name, "type": ctype}))
            result = EastVariant("Variant", cases)
        else:
            raise ValueError(f"Unknown C type kind: {kind}")
    finally:
        _type_convert_stack.pop()

    return result


# ─── py_value_to_c ────────────────────────────────────────────────────────

cdef str _c_type_str(_eastc.EastType *t):
    """Readable form of a C type for error messages (error paths only)."""
    try:
        from east.serialization.east_printer import print_east
        from east.types.type_of_type import EastTypeType
        return print_east(_c_type_tag_to_py_type(t), EastTypeType)
    except BaseException:
        return "<type>"


cdef void _check_proxy_type(uintptr_t got_ptr, _eastc.EastType *want, str what) except *:
    """A C-backed proxy crosses by POINTER — verify its declared child type.

    The pointer fast path performs no per-element conversion, so this equality
    is the only check between the proxy's contents and the declared type. A
    mislabelled value reads fine (len, type labels) and corrupts memory only
    when an element is decoded, arbitrarily far from the cause (#467).
    Pointer equality is the common case (py_type_to_c interns per python type
    object), so the structural comparison rarely runs.
    """
    cdef _eastc.EastType *got = <_eastc.EastType*>got_ptr
    if got == want or got == NULL or want == NULL:
        return
    if not _eastc.east_type_equal(got, want):
        raise TypeError(
            f"C-backed value has {what} type {_c_type_str(got)} but "
            f"{_c_type_str(want)} was declared — refusing the by-pointer "
            "pass-through of a mislabelled value"
        )


cdef _eastc.EastValue* py_value_to_c(object val, _eastc.EastType *c_type) except NULL:
    """Convert a Python value to a C EastValue*.

    Returns a retained pointer. Caller must call east_value_release().
    Tracks Python id() for mutable types to preserve identity (backreferences).
    """
    cdef dict identity_map = {}
    return _py_value_to_c_impl(val, c_type, identity_map)


cdef _eastc.EastValue* _py_value_to_c_impl(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    """Inner conversion with identity tracking."""
    cdef _eastc.EastValue* result
    cdef const char* str_data
    cdef Py_ssize_t str_len
    cdef int64_t millis
    cdef object py_id
    cdef uintptr_t cached_ptr

    # Resolve recursive wrappers up front so the proxy kind-guards below
    # compare against the structural kind, not EAST_TYPE_RECURSIVE.
    cdef _eastc.EastTypeKind kind = c_type.kind
    while kind == _eastc.EAST_TYPE_RECURSIVE and c_type.data.recursive.node != NULL:
        c_type = c_type.data.recursive.node
        kind = c_type.kind

    # Fast path: if value is a C-backed proxy, reuse its pointer (no copy).
    # Guard each proxy against the expected type kind AND its declared
    # child type(s) — passing a wrong-shaped or mislabelled proxy by raw
    # pointer would hand east-c a union-mismatched value and cause a wild
    # deref at the next typed access (#467).
    if isinstance(val, EastArrayProxy):
        if kind != _eastc.EAST_TYPE_ARRAY:
            raise TypeError(f"EastArrayProxy supplied where C type kind {kind} expected")
        _check_proxy_type(<uintptr_t>val._c_elem_type_ptr, c_type.data.element, "Array element")
        result = <_eastc.EastValue*><uintptr_t>val._c_ptr
        _eastc.east_value_retain(result)
        return result
    if isinstance(val, EastSetProxy):
        if kind != _eastc.EAST_TYPE_SET:
            raise TypeError(f"EastSetProxy supplied where C type kind {kind} expected")
        _check_proxy_type(<uintptr_t>val._c_elem_type_ptr, c_type.data.element, "Set element")
        result = <_eastc.EastValue*><uintptr_t>val._c_ptr
        _eastc.east_value_retain(result)
        return result
    if isinstance(val, EastDictProxy):
        if kind != _eastc.EAST_TYPE_DICT:
            raise TypeError(f"EastDictProxy supplied where C type kind {kind} expected")
        _check_proxy_type(<uintptr_t>val._c_key_type_ptr, c_type.data.dict.key, "Dict key")
        _check_proxy_type(<uintptr_t>val._c_val_type_ptr, c_type.data.dict.value, "Dict value")
        result = <_eastc.EastValue*><uintptr_t>val._c_ptr
        _eastc.east_value_retain(result)
        return result
    if isinstance(val, EastRefProxy):
        if kind != _eastc.EAST_TYPE_REF:
            raise TypeError(f"EastRefProxy supplied where C type kind {kind} expected")
        _check_proxy_type(<uintptr_t>val._c_inner_type_ptr, c_type.data.element, "Ref inner")
        result = <_eastc.EastValue*><uintptr_t>val._c_ptr
        _eastc.east_value_retain(result)
        return result

    # For mutable types (Array, Set, Dict, Ref), check identity map
    if kind in (_eastc.EAST_TYPE_ARRAY, _eastc.EAST_TYPE_SET, _eastc.EAST_TYPE_DICT, _eastc.EAST_TYPE_REF):
        py_id = id(val)
        cached = identity_map.get(py_id)
        if cached is not None:
            result = <_eastc.EastValue*><uintptr_t>cached
            _eastc.east_value_retain(result)
            return result

    if kind == _eastc.EAST_TYPE_NULL:
        return _eastc.east_null()

    elif kind == _eastc.EAST_TYPE_BOOLEAN:
        return _eastc.east_boolean(<bint>val)

    elif kind == _eastc.EAST_TYPE_INTEGER:
        return _eastc.east_integer(<int64_t>val)

    elif kind == _eastc.EAST_TYPE_FLOAT:
        return _eastc.east_float(<double>val)

    elif kind == _eastc.EAST_TYPE_STRING:
        str_data = PyUnicode_AsUTF8AndSize(val, &str_len)
        return _eastc.east_string_len(str_data, <size_t>str_len)

    elif kind == _eastc.EAST_TYPE_DATETIME:
        millis = <int64_t>(val.timestamp() * 1000)
        return _eastc.east_datetime(millis)

    elif kind == _eastc.EAST_TYPE_BLOB:
        return _eastc.east_blob(
            <const uint8_t*>PyBytes_AS_STRING(<bytes>val),
            <size_t>PyBytes_GET_SIZE(<bytes>val),
        )

    elif kind == _eastc.EAST_TYPE_ARRAY:
        result = _py_array_to_c(val, c_type, identity_map)
        identity_map[id(val)] = <uintptr_t>result
        return result

    elif kind == _eastc.EAST_TYPE_SET:
        result = _py_set_to_c(val, c_type, identity_map)
        identity_map[id(val)] = <uintptr_t>result
        return result

    elif kind == _eastc.EAST_TYPE_DICT:
        result = _py_dict_to_c(val, c_type, identity_map)
        identity_map[id(val)] = <uintptr_t>result
        return result

    elif kind == _eastc.EAST_TYPE_STRUCT:
        return _py_struct_to_c(val, c_type, identity_map)

    elif kind == _eastc.EAST_TYPE_VARIANT:
        return _py_variant_to_c(val, c_type, identity_map)

    elif kind == _eastc.EAST_TYPE_REF:
        result = _py_ref_to_c(val, c_type, identity_map)
        identity_map[id(val)] = <uintptr_t>result
        return result

    elif kind == _eastc.EAST_TYPE_VECTOR:
        return _py_vector_to_c(val, c_type)

    elif kind == _eastc.EAST_TYPE_MATRIX:
        return _py_matrix_to_c(val, c_type)

    elif kind == _eastc.EAST_TYPE_RECURSIVE:
        return _py_value_to_c_impl(val, c_type.data.recursive.node, identity_map)

    elif kind == _eastc.EAST_TYPE_FUNCTION or kind == _eastc.EAST_TYPE_ASYNC_FUNCTION:
        return _py_function_to_c(val, c_type, identity_map)

    else:
        raise ValueError(f"Unknown C type kind: {kind}")


cdef _eastc.EastValue* _py_array_to_c(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    cdef _eastc.EastType *elem_c = c_type.data.element
    cdef _eastc.EastValue* arr = _eastc.east_array_new(elem_c)
    cdef _eastc.EastValue* item_c
    cdef size_t i, n = len(val)

    try:
        for i in range(n):
            item_c = _py_value_to_c_impl(val[i], elem_c, identity_map)
            _eastc.east_array_push(arr, item_c)
            _eastc.east_value_release(item_c)
        return arr
    except:
        _eastc.east_value_release(arr)
        raise


cdef _eastc.EastValue* _py_set_to_c(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    cdef _eastc.EastType *elem_c = c_type.data.element
    cdef _eastc.EastValue* s = _eastc.east_set_new(elem_c)
    cdef _eastc.EastValue* item_c

    try:
        for item in val:
            item_c = _py_value_to_c_impl(item, elem_c, identity_map)
            _eastc.east_set_insert(s, item_c)
            _eastc.east_value_release(item_c)
        return s
    except:
        _eastc.east_value_release(s)
        raise


cdef _eastc.EastValue* _py_dict_to_c(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    cdef _eastc.EastType *key_c = c_type.data.dict.key
    cdef _eastc.EastType *val_c = c_type.data.dict.value
    cdef _eastc.EastValue* d = _eastc.east_dict_new(key_c, val_c)
    cdef _eastc.EastValue* k_c
    cdef _eastc.EastValue* v_c

    try:
        for k, v in val.items():
            k_c = _py_value_to_c_impl(k, key_c, identity_map)
            try:
                v_c = _py_value_to_c_impl(v, val_c, identity_map)
            except:
                _eastc.east_value_release(k_c)
                raise
            _eastc.east_dict_set(d, k_c, v_c)
            _eastc.east_value_release(k_c)
            _eastc.east_value_release(v_c)
        return d
    except:
        _eastc.east_value_release(d)
        raise


cdef _eastc.EastValue* _py_struct_to_c(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    cdef size_t n = c_type.data.struct_.num_fields
    cdef const char** c_names = <const char**>malloc(n * sizeof(const char*))
    cdef _eastc.EastValue** c_values = <_eastc.EastValue**>malloc(n * sizeof(_eastc.EastValue*))
    cdef size_t i
    cdef list name_bytes_list = []

    if c_names == NULL or c_values == NULL:
        free(c_names)
        free(c_values)
        raise MemoryError()

    try:
        for i in range(n):
            field_name = c_type.data.struct_.fields[i].name.decode("utf-8")
            name_bytes = field_name.encode("utf-8")
            name_bytes_list.append(name_bytes)
            c_names[i] = <const char*>PyBytes_AS_STRING(name_bytes)
            c_values[i] = _py_value_to_c_impl(val[field_name], c_type.data.struct_.fields[i].type, identity_map)

        result = _eastc.east_struct_new(c_names, c_values, n, c_type)

        for i in range(n):
            _eastc.east_value_release(c_values[i])

        return result
    except:
        for j in range(i):
            _eastc.east_value_release(c_values[j])
        raise
    finally:
        free(c_names)
        free(c_values)


cdef _eastc.EastValue* _py_variant_to_c(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    # A non-variant here is a type-level bug at the caller (e.g. a String
    # where an Option was declared, #467) — name it instead of dying with
    # an AttributeError on `.type`.
    if not is_east_variant(val):
        raise TypeError(
            f"expected an East variant value for {_c_type_str(c_type)}, "
            f"got {type(val).__name__} — construct with variant()/some()/none"
        )
    cdef str case_name = val.type
    cdef object case_value = val.value
    cdef size_t i
    cdef _eastc.EastType *case_type = NULL
    cdef bytes case_name_bytes = case_name.encode("utf-8")

    for i in range(c_type.data.variant.num_cases):
        if c_type.data.variant.cases[i].name.decode("utf-8") == case_name:
            case_type = c_type.data.variant.cases[i].type
            break

    if case_type == NULL:
        raise ValueError(f"Unknown variant case: {case_name}")

    cdef _eastc.EastValue* val_c = _py_value_to_c_impl(case_value, case_type, identity_map)
    cdef _eastc.EastValue* result = _eastc.east_variant_new(
        <const char*>PyBytes_AS_STRING(case_name_bytes), val_c, c_type
    )
    _eastc.east_value_release(val_c)
    return result


cdef _eastc.EastValue* _py_ref_to_c(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    cdef _eastc.EastType *inner_c = c_type.data.element
    cdef _eastc.EastValue* inner_val = _py_value_to_c_impl(val.value, inner_c, identity_map)
    cdef _eastc.EastValue* result = _eastc.east_ref_new(inner_val)
    _eastc.east_value_release(inner_val)
    return result


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
    cdef size_t rows = val.rows
    cdef size_t cols = val.cols
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


cdef _eastc.EastValue* _py_function_to_c(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    """Convert a Python function to a C function value for serialization.

    Fast path: if `val` is a Python wrapper around an existing C EastValue*
    (created by `_c_function_to_py` and tagged with EAST_C_HANDLE_ATTR),
    return that handle directly with an extra retain. This preserves the
    function's full state — including its captures Environment — which the
    Python wrapper does not surface via attributes.

    Fallback: rebuild a minimal EastCompiledFn from the function's
    EAST_IR_ATTR (and any captures in EAST_CAPTURES_ATTR). Used for
    Python-built functions that don't wrap a C value.
    """
    cdef uintptr_t handle_int
    cdef _eastc.EastValue* existing
    handle = getattr(val, EAST_C_HANDLE_ATTR, None)
    if handle is not None:
        handle_int = <uintptr_t>handle
        existing = <_eastc.EastValue*>handle_int
        if existing != NULL and existing.kind == _eastc.EAST_VAL_FUNCTION:
            _eastc.east_value_retain(existing)
            return existing

    py_ir = getattr(val, EAST_IR_ATTR, None)
    if py_ir is None:
        raise RuntimeError(
            "Cannot serialize function: no IR attached. "
            "Functions must be compiled from East IR to be serializable."
        )

    # Use east-c's internal IR type (handles deep recursion natively)
    if _eastc.east_ir_type == NULL:
        _eastc.east_type_of_type_init()

    cdef _eastc.EastType* ir_type = _eastc.east_ir_type
    if ir_type.kind == _eastc.EAST_TYPE_RECURSIVE:
        ir_type = ir_type.data.recursive.node

    cdef _eastc.EastValue* ir_c_val = py_value_to_c(py_ir, ir_type)

    # Parse the IR value into an IRNode for the compiled fn
    cdef _eastc.IRNode* ir_node = _eastc.east_ir_from_value(ir_c_val)

    # Build a minimal EastCompiledFn
    cdef _eastc.EastCompiledFn* fn = <_eastc.EastCompiledFn*>calloc(1, sizeof(_eastc.EastCompiledFn))
    if fn == NULL:
        _eastc.east_value_release(ir_c_val)
        raise MemoryError()

    fn.ir = ir_node
    fn.source_ir = ir_c_val  # retained — fn owns it
    fn.captures = NULL
    fn.param_names = NULL
    fn.num_params = 0
    fn.platform = NULL
    fn.builtins = NULL

    # Convert capture values and store in a C Environment. From here on the
    # fn owns ir_node and ir_c_val, so a raising capture conversion must
    # tear the whole thing down via east_compiled_fn_free.
    capture_values = getattr(val, EAST_CAPTURES_ATTR, {})
    try:
        captures_list = py_ir["value"]["captures"]
        if len(captures_list) > 0 and len(capture_values) > 0:
            _populate_fn_captures(fn, captures_list, capture_values, identity_map)
    except:
        _eastc.east_compiled_fn_free(fn)
        raise

    cdef _eastc.EastValue* result = _eastc.east_function_value(fn)
    return result


cdef void _populate_fn_captures(_eastc.EastCompiledFn* fn, object captures_list, dict capture_values, dict identity_map) except *:
    """Populate captures on a compiled fn from Python capture values.

    Uses the shared identity_map so that capture values that are the same
    Python object as struct fields (etc.) map to the same C pointer.
    """
    cdef _eastc.EastType* cap_c_type
    cdef _eastc.EastValue* cap_c_val

    for cap_var in captures_list:
        cap_name = cap_var["value"]["name"]
        cap_type = cap_var["value"]["type"]

        if cap_name in capture_values:
            cap_c_type = py_type_to_c(cap_type)
            try:
                cap_c_val = _py_value_to_c_impl(capture_values[cap_name], cap_c_type, identity_map)
            finally:
                _eastc.east_type_release(cap_c_type)

            cap_name_bytes = cap_name.encode("utf-8")
            _env_set_capture(fn, cap_name_bytes, cap_c_val)
            _eastc.east_value_release(cap_c_val)


cdef void _env_set_capture(_eastc.EastCompiledFn* fn, bytes name, _eastc.EastValue* val):
    if fn.captures == NULL:
        fn.captures = _eastc.env_new(NULL)
    _eastc.env_set(fn.captures, <const char*>PyBytes_AS_STRING(name), val)


# ═══════════════════════════════════════════════════════════════════════════
#  C-Backed Proxy System
#
#  Mutable East values (Array, Set, Dict, Ref) decoded from C are wrapped
#  as proxies that hold a retained EastValue* pointer.  All reads/writes
#  go through C so mutations from east_call (C functions) and Python are
#  visible to both sides.
# ═══════════════════════════════════════════════════════════════════════════

# ─── cpdef helpers (callable from Python proxy methods via int pointers) ──

cpdef Py_ssize_t _proxy_array_len(uintptr_t ptr):
    return <Py_ssize_t>(<_eastc.EastValue*>ptr).data.array.len

cpdef object _proxy_array_get(uintptr_t ptr, uintptr_t elem_type_ptr, Py_ssize_t index):
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef Py_ssize_t n = <Py_ssize_t>arr.data.array.len
    if index < 0:
        index += n
    if index < 0 or index >= n:
        raise IndexError("array index out of range")
    cdef _eastc.EastValue *elem = arr.data.array.items[index]
    return c_value_to_py(elem, <_eastc.EastType*>elem_type_ptr)

cpdef void _proxy_array_set(uintptr_t ptr, uintptr_t elem_type_ptr, Py_ssize_t index, object value):
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef Py_ssize_t n = <Py_ssize_t>arr.data.array.len
    if index < 0:
        index += n
    if index < 0 or index >= n:
        raise IndexError("array index out of range")
    cdef _eastc.EastValue *new_val = py_value_to_c(value, <_eastc.EastType*>elem_type_ptr)
    _eastc.east_value_release(arr.data.array.items[index])
    arr.data.array.items[index] = new_val

cpdef void _proxy_array_push(uintptr_t ptr, uintptr_t elem_type_ptr, object value):
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef _eastc.EastValue *c_val = py_value_to_c(value, <_eastc.EastType*>elem_type_ptr)
    _eastc.east_array_push(arr, c_val)
    _eastc.east_value_release(c_val)

cpdef void _proxy_array_clear(uintptr_t ptr):
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef size_t i
    for i in range(arr.data.array.len):
        _eastc.east_value_release(arr.data.array.items[i])
    arr.data.array.len = 0

cpdef void _proxy_array_reverse(uintptr_t ptr):
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef size_t n = arr.data.array.len
    cdef size_t i
    cdef _eastc.EastValue *tmp
    for i in range(n // 2):
        tmp = arr.data.array.items[i]
        arr.data.array.items[i] = arr.data.array.items[n - 1 - i]
        arr.data.array.items[n - 1 - i] = tmp

cpdef object _proxy_array_pop(uintptr_t ptr, uintptr_t elem_type_ptr, Py_ssize_t index):
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef Py_ssize_t n = <Py_ssize_t>arr.data.array.len
    if n == 0:
        raise IndexError("pop from empty array")
    if index < 0:
        index += n
    if index < 0 or index >= n:
        raise IndexError("pop index out of range")
    cdef _eastc.EastValue *elem = arr.data.array.items[index]
    result = c_value_to_py(elem, <_eastc.EastType*>elem_type_ptr)
    _eastc.east_value_release(elem)
    # Shift remaining elements
    cdef size_t i
    for i in range(<size_t>index, <size_t>(n - 1)):
        arr.data.array.items[i] = arr.data.array.items[i + 1]
    arr.data.array.len -= 1
    return result

cpdef Py_ssize_t _proxy_set_len(uintptr_t ptr):
    return <Py_ssize_t>(<_eastc.EastValue*>ptr).data.set.len

cpdef void _proxy_set_add(uintptr_t ptr, uintptr_t elem_type_ptr, object value):
    cdef _eastc.EastValue *c_val = py_value_to_c(value, <_eastc.EastType*>elem_type_ptr)
    _eastc.east_set_insert(<_eastc.EastValue*>ptr, c_val)
    _eastc.east_value_release(c_val)

cpdef bint _proxy_set_contains(uintptr_t ptr, uintptr_t elem_type_ptr, object value):
    cdef _eastc.EastValue *c_val = py_value_to_c(value, <_eastc.EastType*>elem_type_ptr)
    cdef bint result = _eastc.east_set_has(<_eastc.EastValue*>ptr, c_val)
    _eastc.east_value_release(c_val)
    return result

cpdef void _proxy_set_remove(uintptr_t ptr, uintptr_t elem_type_ptr, object value):
    cdef _eastc.EastValue *c_val = py_value_to_c(value, <_eastc.EastType*>elem_type_ptr)
    if not _eastc.east_set_delete(<_eastc.EastValue*>ptr, c_val):
        _eastc.east_value_release(c_val)
        raise KeyError(value)
    _eastc.east_value_release(c_val)

cpdef object _proxy_set_iter(uintptr_t ptr, uintptr_t elem_type_ptr):
    cdef _eastc.EastValue *s = <_eastc.EastValue*>ptr
    cdef size_t n = s.data.set.len
    cdef list result = []
    for i in range(n):
        result.append(c_value_to_py(_eastc.east_set_at(s, i), <_eastc.EastType*>elem_type_ptr))
    return result

cpdef Py_ssize_t _proxy_dict_len(uintptr_t ptr):
    return <Py_ssize_t>(<_eastc.EastValue*>ptr).data.dict.len

cpdef object _proxy_dict_get(uintptr_t ptr, uintptr_t key_type_ptr, uintptr_t val_type_ptr, object key):
    cdef _eastc.EastValue *c_key = py_value_to_c(key, <_eastc.EastType*>key_type_ptr)
    cdef _eastc.EastValue *c_val = _eastc.east_dict_get(<_eastc.EastValue*>ptr, c_key)
    _eastc.east_value_release(c_key)
    if c_val == NULL:
        raise KeyError(key)
    return c_value_to_py(c_val, <_eastc.EastType*>val_type_ptr)

cpdef void _proxy_dict_set(uintptr_t ptr, uintptr_t key_type_ptr, uintptr_t val_type_ptr, object key, object value):
    cdef _eastc.EastValue *c_key = py_value_to_c(key, <_eastc.EastType*>key_type_ptr)
    cdef _eastc.EastValue *c_val = py_value_to_c(value, <_eastc.EastType*>val_type_ptr)
    _eastc.east_dict_set(<_eastc.EastValue*>ptr, c_key, c_val)
    _eastc.east_value_release(c_key)
    _eastc.east_value_release(c_val)

cpdef bint _proxy_dict_contains(uintptr_t ptr, uintptr_t key_type_ptr, object key):
    cdef _eastc.EastValue *c_key = py_value_to_c(key, <_eastc.EastType*>key_type_ptr)
    cdef bint result = _eastc.east_dict_has(<_eastc.EastValue*>ptr, c_key)
    _eastc.east_value_release(c_key)
    return result

cpdef object _proxy_dict_items(uintptr_t ptr, uintptr_t key_type_ptr, uintptr_t val_type_ptr):
    cdef _eastc.EastValue *d = <_eastc.EastValue*>ptr
    cdef size_t n = d.data.dict.len
    cdef list result = []
    for i in range(n):
        k = c_value_to_py(_eastc.east_dict_key_at(d, i), <_eastc.EastType*>key_type_ptr)
        v = c_value_to_py(_eastc.east_dict_val_at(d, i), <_eastc.EastType*>val_type_ptr)
        result.append((k, v))
    return result

cpdef object _proxy_ref_get(uintptr_t ptr, uintptr_t inner_type_ptr):
    cdef _eastc.EastValue *ref = <_eastc.EastValue*>ptr
    return c_value_to_py(ref.data.ref.value, <_eastc.EastType*>inner_type_ptr)

cpdef void _proxy_ref_set(uintptr_t ptr, uintptr_t inner_type_ptr, object value):
    cdef _eastc.EastValue *c_val = py_value_to_c(value, <_eastc.EastType*>inner_type_ptr)
    _eastc.east_ref_set(<_eastc.EastValue*>ptr, c_val)
    _eastc.east_value_release(c_val)

cpdef void _proxy_retain(uintptr_t ptr):
    _eastc.east_value_retain(<_eastc.EastValue*>ptr)

cpdef void _proxy_release(uintptr_t ptr):
    _eastc.east_value_release(<_eastc.EastValue*>ptr)

cpdef void _proxy_type_retain(uintptr_t ptr):
    _eastc.east_type_retain(<_eastc.EastType*>ptr)

cpdef void _proxy_type_release(uintptr_t ptr):
    _eastc.east_type_release(<_eastc.EastType*>ptr)


cpdef object c_type_ptr_to_py_type(uintptr_t ptr):
    """Convert a C type pointer to a Python EastType object.

    The reverse type caches are scoped to this single conversion (see
    _c_type_tag_to_py_type) — nothing is memoized across calls.
    """
    return _c_type_tag_to_py_type(<_eastc.EastType*>ptr)


def canonicalize_type(object py_type):
    """Normalize a type value to the depth-integer Recursive dialect.

    Round-trips through the C type system: the forward conversion accepts
    both serialized Recursive dialects (east-py's depth integers and TS's
    ``ref(id)``/``wrapper({id, inner})``), and the reverse conversion emits
    the depth form — which the pure-python type walkers (ordering, printing,
    construction) speak."""
    cdef _eastc.EastType* root = py_type_to_c(py_type)
    try:
        return _c_type_tag_to_py_type(root)
    finally:
        _eastc.east_type_release(root)


def resolve_child_type(object py_type, tuple steps):
    """The child type reached by ``steps``, canonically self-contained.

    Naive extraction (``t.value``) leaves ``Recursive(depth)`` markers
    pointing above the extracted root. This resolves through the C type
    system instead: the forward conversion interns the full recursive type,
    the C walk follows real child pointers, and the reverse conversion
    rebinds any back-edges relative to the extracted child — the same
    machinery every decode path already relies on, at arbitrary depth.

    Steps: ``"element"`` (Array/Set/Ref/Vector/Matrix), ``"key"``/``"value"``
    (Dict), ``("field", name)`` (Struct), ``("case", name)`` (Variant).
    """
    cdef _eastc.EastType* root = py_type_to_c(py_type)
    cdef _eastc.EastType* cur = root
    cdef size_t i
    cdef bytes name_b
    cdef bint found
    try:
        for step in steps:
            while cur.kind == _eastc.EAST_TYPE_RECURSIVE and cur.data.recursive.node != NULL:
                cur = cur.data.recursive.node
            if step == "element":
                cur = cur.data.element
            elif step == "key":
                cur = cur.data.dict.key
            elif step == "value":
                cur = cur.data.dict.value
            elif step == "output":
                cur = cur.data.function.output
            else:
                kind_, name = step
                name_b = name.encode("utf-8")
                found = False
                if kind_ == "field":
                    for i in range(cur.data.struct_.num_fields):
                        if strcmp(cur.data.struct_.fields[i].name, <const char*>name_b) == 0:
                            cur = cur.data.struct_.fields[i].type
                            found = True
                            break
                elif kind_ == "case":
                    for i in range(cur.data.variant.num_cases):
                        if strcmp(cur.data.variant.cases[i].name, <const char*>name_b) == 0:
                            cur = cur.data.variant.cases[i].type
                            found = True
                            break
                if not found:
                    raise KeyError(f"no {kind_} {name!r} on this type")
        return _c_type_tag_to_py_type(cur)
    finally:
        _eastc.east_type_release(root)


# ─── Proxy classes ────────────────────────────────────────────────────────

class EastArrayProxy(EastArray):
    """C-backed array proxy. All operations go through the C EastValue*."""

    __slots__ = ("_c_ptr", "_c_elem_type_ptr")

    def __init__(self, element_type, items=None):
        # User construction: allocate a live east-c array from birth, bulk-push.
        cdef _eastc.EastType *elem_c
        cdef _eastc.EastValue *arr
        object.__setattr__(self, "element_type", element_type)
        object.__setattr__(self, "_iteration_lock", 0)
        elem_c = py_type_to_c(element_type)
        arr = _eastc.east_array_new(elem_c)
        self._c_ptr = <uintptr_t>arr
        self._c_elem_type_ptr = <uintptr_t>elem_c
        if items is not None:
            for item in items:
                _proxy_array_push(self._c_ptr, self._c_elem_type_ptr, item)

    @staticmethod
    def _wrap(element_type, c_ptr, c_elem_type_ptr):
        # Wrap an existing live east-c value (from c_value_to_py); retains it.
        self = EastArrayProxy.__new__(EastArrayProxy)
        object.__setattr__(self, "element_type", element_type)
        object.__setattr__(self, "_iteration_lock", 0)
        self._c_ptr = c_ptr
        self._c_elem_type_ptr = c_elem_type_ptr
        _proxy_retain(c_ptr)
        _proxy_type_retain(c_elem_type_ptr)
        return self

    def __del__(self):
        # Tolerate a proxy whose __init__ never set _c_ptr (e.g. __new__ without
        # a completed __init__): a __del__ must not assume construction finished.
        if getattr(self, "_c_ptr", 0):
            _proxy_release(self._c_ptr)
            _proxy_type_release(getattr(self, "_c_elem_type_ptr", 0))

    def __len__(self):
        return _proxy_array_len(self._c_ptr)

    def __getitem__(self, index):
        if isinstance(index, slice):
            n = len(self)
            indices = range(*index.indices(n))
            return EastArray(self.element_type, [self[i] for i in indices])
        return _proxy_array_get(self._c_ptr, self._c_elem_type_ptr, index)

    def __setitem__(self, index, value):
        _proxy_array_set(self._c_ptr, self._c_elem_type_ptr, index, value)

    def __delitem__(self, index):
        _proxy_array_pop(self._c_ptr, self._c_elem_type_ptr, index)

    def __iter__(self):
        n = len(self)
        for i in range(n):
            yield _proxy_array_get(self._c_ptr, self._c_elem_type_ptr, i)

    def __contains__(self, item):
        for elem in self:
            if elem == item:
                return True
        return False

    def append(self, item):
        _proxy_array_push(self._c_ptr, self._c_elem_type_ptr, item)

    def extend(self, items):
        for item in items:
            self.append(item)

    def insert(self, index, item):
        # Push then rotate into position
        self.append(item)
        n = len(self)
        if index < 0:
            index = max(0, n + index)
        if index >= n:
            return  # already at end
        # Shift: move last element to index position
        cdef _eastc.EastValue *arr = <_eastc.EastValue*><uintptr_t>self._c_ptr
        cdef _eastc.EastValue *tmp = arr.data.array.items[n - 1]
        for i in range(n - 1, index, -1):
            arr.data.array.items[i] = arr.data.array.items[i - 1]
        arr.data.array.items[index] = tmp

    def pop(self, index=-1):
        return _proxy_array_pop(self._c_ptr, self._c_elem_type_ptr, index)

    def remove(self, item):
        for i in range(len(self)):
            if _proxy_array_get(self._c_ptr, self._c_elem_type_ptr, i) == item:
                _proxy_array_pop(self._c_ptr, self._c_elem_type_ptr, i)
                return
        raise ValueError("item not in array")

    def clear(self):
        _proxy_array_clear(self._c_ptr)

    def reverse(self):
        _proxy_array_reverse(self._c_ptr)

    def sort(self, *, key=None, reverse=False):
        # Sort by East's total order (not Python's default), in place.
        if key is None:
            # Keyless: sort in east-c via ArraySortDefault.
            from east.runtime._compiler_eastc import call_builtin
            from east.types.types import ArrayType
            result = call_builtin("ArraySortDefault", [self.element_type], [self], ArrayType(self.element_type))
            items = list(result)
            if reverse:
                items.reverse()
        else:
            # Keyed: project in Python, order keys with East semantics.
            from east.utils.ordering import make_east_key
            from east.types.values import type_of
            items = list(self)
            sample = key(items[0]) if items else None
            key_type = type_of(sample) if sample is not None else self.element_type
            east_key = make_east_key(key_type)
            items.sort(key=lambda item: east_key(key(item)), reverse=reverse)
        _proxy_array_clear(self._c_ptr)
        for item in items:
            _proxy_array_push(self._c_ptr, self._c_elem_type_ptr, item)

    def __repr__(self):
        if len(self) == 0:
            return "[]"
        items = ", ".join(repr(item) for item in self)
        return f"[{items}]"

    def __eq__(self, other):
        if isinstance(other, (list, EastArray)):
            if len(self) != len(other):
                return False
            for a, b in zip(self, other):
                if a != b:
                    return False
            return True
        return NotImplemented

    def __hash__(self):
        raise TypeError("EastArray is mutable and cannot be hashed")


class EastSetProxy(EastSet):
    """C-backed set proxy."""

    __slots__ = ("_c_ptr", "_c_elem_type_ptr")

    def __init__(self, element_type, items=None):
        # User construction: allocate a live east-c set from birth, bulk-insert
        # items. No Python-side store. (Owns east_set_new's ref + py_type_to_c's ref.)
        cdef _eastc.EastType *elem_c
        cdef _eastc.EastValue *s
        object.__setattr__(self, "element_type", element_type)
        object.__setattr__(self, "_iteration_lock", 0)
        elem_c = py_type_to_c(element_type)
        s = _eastc.east_set_new(elem_c)
        self._c_ptr = <uintptr_t>s
        self._c_elem_type_ptr = <uintptr_t>elem_c
        if items is not None:
            for item in items:
                _proxy_set_add(self._c_ptr, self._c_elem_type_ptr, item)

    @staticmethod
    def _wrap(element_type, c_ptr, c_elem_type_ptr):
        # Wrap an existing live east-c value (from c_value_to_py); retains it.
        self = EastSetProxy.__new__(EastSetProxy)
        object.__setattr__(self, "element_type", element_type)
        object.__setattr__(self, "_iteration_lock", 0)
        self._c_ptr = c_ptr
        self._c_elem_type_ptr = c_elem_type_ptr
        _proxy_retain(c_ptr)
        _proxy_type_retain(c_elem_type_ptr)
        return self

    def __del__(self):
        # Tolerate a proxy whose __init__ never set _c_ptr (e.g. __new__ without
        # a completed __init__): a __del__ must not assume construction finished.
        if getattr(self, "_c_ptr", 0):
            _proxy_release(self._c_ptr)
            _proxy_type_release(getattr(self, "_c_elem_type_ptr", 0))

    def __len__(self):
        return _proxy_set_len(self._c_ptr)

    def add(self, item):
        _proxy_set_add(self._c_ptr, self._c_elem_type_ptr, item)

    def remove(self, item):
        _proxy_set_remove(self._c_ptr, self._c_elem_type_ptr, item)

    def discard(self, item):
        try:
            self.remove(item)
        except KeyError:
            pass

    def clear(self):
        _eastc.east_set_clear(<_eastc.EastValue*><uintptr_t>self._c_ptr)

    def __contains__(self, item):
        return _proxy_set_contains(self._c_ptr, self._c_elem_type_ptr, item)

    def __iter__(self):
        return iter(_proxy_set_iter(self._c_ptr, self._c_elem_type_ptr))

    def __repr__(self):
        if len(self) == 0:
            return "{}"
        items = ", ".join(repr(item) for item in self)
        return f"{{{items}}}"

    def __eq__(self, other):
        if isinstance(other, EastSet):
            if len(self) != len(other):
                return False
            for item in self:
                if item not in other:
                    return False
            return True
        return NotImplemented


class EastDictProxy(EastDict):
    """C-backed dict proxy."""

    __slots__ = ("_c_ptr", "_c_key_type_ptr", "_c_val_type_ptr")

    def __init__(self, key_type, value_type, items=None):
        # User construction: allocate a live east-c dict from birth, bulk-insert.
        cdef _eastc.EastType *key_c
        cdef _eastc.EastType *val_c
        cdef _eastc.EastValue *d
        object.__setattr__(self, "key_type", key_type)
        object.__setattr__(self, "value_type", value_type)
        object.__setattr__(self, "_iteration_lock", 0)
        key_c = py_type_to_c(key_type)
        val_c = py_type_to_c(value_type)
        d = _eastc.east_dict_new(key_c, val_c)
        self._c_ptr = <uintptr_t>d
        self._c_key_type_ptr = <uintptr_t>key_c
        self._c_val_type_ptr = <uintptr_t>val_c
        if items is not None:
            for key, value in items.items():
                _proxy_dict_set(self._c_ptr, self._c_key_type_ptr, self._c_val_type_ptr, key, value)

    @staticmethod
    def _wrap(key_type, value_type, c_ptr, c_key_type_ptr, c_val_type_ptr):
        # Wrap an existing live east-c value (from c_value_to_py); retains it.
        self = EastDictProxy.__new__(EastDictProxy)
        object.__setattr__(self, "key_type", key_type)
        object.__setattr__(self, "value_type", value_type)
        object.__setattr__(self, "_iteration_lock", 0)
        self._c_ptr = c_ptr
        self._c_key_type_ptr = c_key_type_ptr
        self._c_val_type_ptr = c_val_type_ptr
        _proxy_retain(c_ptr)
        _proxy_type_retain(c_key_type_ptr)
        _proxy_type_retain(c_val_type_ptr)
        return self

    def __del__(self):
        # Tolerate a proxy whose __init__ never set _c_ptr (e.g. __new__ without
        # a completed __init__): a __del__ must not assume construction finished.
        if getattr(self, "_c_ptr", 0):
            _proxy_release(self._c_ptr)
            _proxy_type_release(getattr(self, "_c_key_type_ptr", 0))
            _proxy_type_release(getattr(self, "_c_val_type_ptr", 0))

    def __len__(self):
        return _proxy_dict_len(self._c_ptr)

    def __getitem__(self, key):
        return _proxy_dict_get(self._c_ptr, self._c_key_type_ptr, self._c_val_type_ptr, key)

    def __setitem__(self, key, value):
        _proxy_dict_set(self._c_ptr, self._c_key_type_ptr, self._c_val_type_ptr, key, value)

    def __delitem__(self, key):
        cdef _eastc.EastValue *c_key = py_value_to_c(key, <_eastc.EastType*><uintptr_t>self._c_key_type_ptr)
        if not _eastc.east_dict_delete(<_eastc.EastValue*><uintptr_t>self._c_ptr, c_key):
            _eastc.east_value_release(c_key)
            raise KeyError(key)
        _eastc.east_value_release(c_key)

    def __contains__(self, key):
        return _proxy_dict_contains(self._c_ptr, self._c_key_type_ptr, key)

    def __iter__(self):
        return iter(self.keys())

    def items(self):
        return _proxy_dict_items(self._c_ptr, self._c_key_type_ptr, self._c_val_type_ptr)

    def keys(self):
        return [k for k, v in self.items()]

    def values(self):
        return [v for k, v in self.items()]

    def __repr__(self):
        if len(self) == 0:
            return "{:}"
        items = ", ".join(f"{repr(k)}: {repr(v)}" for k, v in self.items())
        return f"{{{items}}}"

    def __eq__(self, other):
        if isinstance(other, EastDict):
            if len(self) != len(other):
                return False
            for k, v in self.items():
                if k not in other or other[k] != v:
                    return False
            return True
        return NotImplemented

    def pop(self, key, *args):
        cdef _eastc.EastValue *c_key = py_value_to_c(key, <_eastc.EastType*><uintptr_t>self._c_key_type_ptr)
        cdef _eastc.EastValue *c_val = _eastc.east_dict_pop(<_eastc.EastValue*><uintptr_t>self._c_ptr, c_key)
        _eastc.east_value_release(c_key)
        if c_val == NULL:
            if args:
                return args[0]
            raise KeyError(key)
        result = c_value_to_py(c_val, <_eastc.EastType*><uintptr_t>self._c_val_type_ptr)
        _eastc.east_value_release(c_val)  # east_dict_pop handed us a ref to release
        return result

    def clear(self):
        _eastc.east_dict_clear(<_eastc.EastValue*><uintptr_t>self._c_ptr)


class EastRefProxy(EastRef):
    """C-backed ref proxy."""

    __slots__ = ("_c_ptr", "_c_inner_type_ptr")

    def __init__(self, c_ptr, c_inner_type_ptr):
        # Don't call EastRef.__init__ — just set up the proxy
        self._c_ptr = c_ptr
        self._c_inner_type_ptr = c_inner_type_ptr
        _proxy_retain(c_ptr)
        _proxy_type_retain(c_inner_type_ptr)

    def __del__(self):
        # Tolerate a proxy whose __init__ never set _c_ptr (e.g. __new__ without
        # a completed __init__): a __del__ must not assume construction finished.
        if getattr(self, "_c_ptr", 0):
            _proxy_release(self._c_ptr)
            _proxy_type_release(getattr(self, "_c_inner_type_ptr", 0))

    @property
    def value(self):
        return _proxy_ref_get(self._c_ptr, self._c_inner_type_ptr)

    @value.setter
    def value(self, val):
        _proxy_ref_set(self._c_ptr, self._c_inner_type_ptr, val)


# ═══════════════════════════════════════════════════════════════════════════
#  Columnar interop (issue #255)
#
#  Struct-of-arrays views over Array<Struct> with one crossing per column
#  instead of one per row × field, plus bulk mutation entry points. Numeric
#  and boolean columns move through numpy buffers filled in C; strings box
#  once through the intern table.
# ═══════════════════════════════════════════════════════════════════════════


cdef bint _is_option_of(_eastc.EastType *t, _eastc.EastTypeKind inner_kind) noexcept:
    """Whether t is Option<inner_kind> = Variant{none: Null, some: inner_kind}."""
    if t == NULL or t.kind != _eastc.EAST_TYPE_VARIANT:
        return False
    if t.data.variant.num_cases != 2:
        return False
    if strcmp(t.data.variant.cases[0].name, b"none") != 0:
        return False
    if strcmp(t.data.variant.cases[1].name, b"some") != 0:
        return False
    return t.data.variant.cases[1].type.kind == inner_kind


cdef _eastc.EastValue *east_struct_get_field_checked(_eastc.EastValue *elem, const char *name) except NULL:
    cdef _eastc.EastValue *fval = _eastc.east_struct_get_field(elem, name)
    if fval == NULL:
        raise ValueError(f"struct element missing field '{name.decode('utf-8')}'")
    return fval


def _array_to_columns(uintptr_t ptr, uintptr_t elem_type_ptr, object fields,
                      Py_ssize_t start, Py_ssize_t stop):
    """Columnar view of an Array<Struct> slice: {field: ndarray | list}.

    Float/Integer/Boolean columns fill numpy arrays in C (Option<Float>
    becomes float64 with NaN for none); String columns box once with
    interning; any other field type falls back to a list of boxed values.
    """
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef _eastc.EastType *et = <_eastc.EastType*>elem_type_ptr
    if et == NULL or et.kind != _eastc.EAST_TYPE_STRUCT:
        raise TypeError("to_columns requires an Array of Struct elements")
    cdef Py_ssize_t n = <Py_ssize_t>arr.data.array.len
    if start < 0:
        start = 0
    if stop < 0 or stop > n:
        stop = n
    if stop < start:
        stop = start
    cdef Py_ssize_t rows = stop - start

    cdef size_t nf = et.data.struct_.num_fields
    cdef size_t f
    cdef Py_ssize_t i
    cdef _eastc.EastType *ftype
    cdef _eastc.EastValue *elem
    cdef _eastc.EastValue *fval
    cdef const char *fname_c
    cdef double[::1] dview
    cdef int64_t[::1] iview
    cdef uint8_t[::1] bview
    cdef dict out = {}

    wanted = set(fields) if fields is not None else None
    for f in range(nf):
        fname_c = et.data.struct_.fields[f].name
        fname = fname_c.decode("utf-8")
        if wanted is not None and fname not in wanted:
            continue
        if wanted is not None:
            wanted.discard(fname)
        ftype = et.data.struct_.fields[f].type

        if ftype.kind == _eastc.EAST_TYPE_FLOAT or _is_option_of(ftype, _eastc.EAST_TYPE_FLOAT):
            farr = np.empty(rows, dtype=np.float64)
            dview = farr
            if ftype.kind == _eastc.EAST_TYPE_FLOAT:
                for i in range(rows):
                    fval = east_struct_get_field_checked(arr.data.array.items[start + i], fname_c)
                    dview[i] = fval.data.float64
            else:
                for i in range(rows):
                    fval = east_struct_get_field_checked(arr.data.array.items[start + i], fname_c)
                    if strcmp(fval.data.variant.case_tag, b"some") == 0:
                        dview[i] = fval.data.variant.value.data.float64
                    else:
                        dview[i] = NAN
            out[fname] = farr
        elif ftype.kind == _eastc.EAST_TYPE_INTEGER:
            iarr = np.empty(rows, dtype=np.int64)
            iview = iarr
            for i in range(rows):
                fval = east_struct_get_field_checked(arr.data.array.items[start + i], fname_c)
                iview[i] = fval.data.integer
            out[fname] = iarr
        elif ftype.kind == _eastc.EAST_TYPE_BOOLEAN:
            barr = np.empty(rows, dtype=np.bool_)
            bview = barr.view(np.uint8)
            for i in range(rows):
                fval = east_struct_get_field_checked(arr.data.array.items[start + i], fname_c)
                bview[i] = 1 if fval.data.boolean else 0
            out[fname] = barr
        elif ftype.kind == _eastc.EAST_TYPE_STRING:
            slist = [None] * rows
            for i in range(rows):
                fval = east_struct_get_field_checked(arr.data.array.items[start + i], fname_c)
                slist[i] = _box_string(fval)
            out[fname] = slist
        else:
            # Generic fallback: still one pass, values boxed individually
            glist = [None] * rows
            for i in range(rows):
                fval = east_struct_get_field_checked(arr.data.array.items[start + i], fname_c)
                glist[i] = c_value_to_py(fval, ftype)
            out[fname] = glist

    if wanted:
        raise KeyError(f"to_columns: unknown field(s) {sorted(wanted)!r}")
    return out


def _array_from_columns(object element_type, dict columns):
    """Build a C-backed Array<Struct> from equal-length columns in one pass.

    float64/int64/bool numpy columns write through raw buffers; Option<Float>
    fields accept float64 with NaN meaning none; everything else goes through
    the generic converter per cell.
    """
    cdef _eastc.EastType *et = py_type_to_c(element_type)
    if et.kind != _eastc.EAST_TYPE_STRUCT:
        _eastc.east_type_release(et)
        raise TypeError("from_columns requires a Struct element type")

    cdef size_t nf = et.data.struct_.num_fields
    cdef size_t f
    cdef Py_ssize_t i, rows = -1
    cdef list py_cols = []
    cdef list np_keep = []
    cdef const char **names = NULL
    cdef _eastc.EastValue **values = NULL
    cdef void **dptr = NULL
    cdef int *tags = NULL  # 0 generic, 1 f64, 2 i64, 3 bool, 4 f64->Option<Float>
    cdef _eastc.EastValue *arr = NULL
    cdef _eastc.EastValue *sv
    cdef _eastc.EastValue *inner
    cdef _eastc.EastType *ftype
    cdef double dv
    cdef size_t built

    field_names = [et.data.struct_.fields[f].name.decode("utf-8") for f in range(nf)]
    extra = set(columns.keys()) - set(field_names)
    if extra:
        _eastc.east_type_release(et)
        raise KeyError(f"from_columns: column(s) {sorted(extra)!r} not in element type")

    try:
        names = <const char**>malloc(nf * sizeof(char*))
        values = <_eastc.EastValue**>malloc(nf * sizeof(_eastc.EastValue*))
        dptr = <void**>malloc(nf * sizeof(void*))
        tags = <int*>malloc(nf * sizeof(int))
        if names == NULL or values == NULL or dptr == NULL or tags == NULL:
            raise MemoryError()

        for f in range(nf):
            names[f] = et.data.struct_.fields[f].name
            ftype = et.data.struct_.fields[f].type
            fname = field_names[f]
            if fname not in columns:
                raise KeyError(f"from_columns: missing column '{fname}'")
            col = columns[fname]
            clen = len(col)
            if rows < 0:
                rows = clen
            elif clen != rows:
                raise ValueError(
                    f"from_columns: column '{fname}' has {clen} rows, expected {rows}"
                )
            tags[f] = 0
            dptr[f] = NULL
            if isinstance(col, np.ndarray):
                a = <object>col
                if a.dtype == np.float64 and a.flags["C_CONTIGUOUS"]:
                    if ftype.kind == _eastc.EAST_TYPE_FLOAT:
                        tags[f] = 1
                    elif _is_option_of(ftype, _eastc.EAST_TYPE_FLOAT):
                        tags[f] = 4
                elif a.dtype == np.int64 and a.flags["C_CONTIGUOUS"] and ftype.kind == _eastc.EAST_TYPE_INTEGER:
                    tags[f] = 2
                elif a.dtype == np.bool_ and a.flags["C_CONTIGUOUS"] and ftype.kind == _eastc.EAST_TYPE_BOOLEAN:
                    tags[f] = 3
                if tags[f] != 0:
                    np_keep.append(a)
                    dptr[f] = cnp.PyArray_DATA(<cnp.ndarray>a)
            py_cols.append(col)

        if rows < 0:
            rows = 0

        arr = _eastc.east_array_new(et)
        if arr == NULL:
            raise MemoryError()

        for i in range(rows):
            built = 0
            try:
                for f in range(nf):
                    if tags[f] == 1:
                        values[f] = _eastc.east_float((<double*>dptr[f])[i])
                    elif tags[f] == 2:
                        values[f] = _eastc.east_integer((<int64_t*>dptr[f])[i])
                    elif tags[f] == 3:
                        values[f] = _eastc.east_boolean((<uint8_t*>dptr[f])[i] != 0)
                    elif tags[f] == 4:
                        dv = (<double*>dptr[f])[i]
                        ftype = et.data.struct_.fields[f].type
                        if isnan(dv):
                            values[f] = _eastc.east_variant_new(b"none", _eastc.east_null(), ftype)
                        else:
                            inner = _eastc.east_float(dv)
                            values[f] = _eastc.east_variant_new(b"some", inner, ftype)
                            _eastc.east_value_release(inner)
                    else:
                        values[f] = py_value_to_c(py_cols[f][i], et.data.struct_.fields[f].type)
                    built += 1
                sv = _eastc.east_struct_new(names, values, nf, et)
                if sv == NULL:
                    raise MemoryError()
                _eastc.east_array_push(arr, sv)
                _eastc.east_value_release(sv)
            finally:
                for f in range(built):
                    _eastc.east_value_release(values[f])

        proxy = EastArrayProxy._wrap(element_type, <uintptr_t>arr, <uintptr_t>et)
        # _wrap retained its own value/type references; drop our value ref
        _eastc.east_value_release(arr)
        arr = NULL
        return proxy
    except BaseException:
        if arr != NULL:
            _eastc.east_value_release(arr)
        raise
    finally:
        free(names)
        free(values)
        free(dptr)
        free(tags)
        _eastc.east_type_release(et)


def _array_extend_bulk(uintptr_t ptr, uintptr_t elem_type_ptr, object items,
                       bint allow_c_copy):
    """Append many elements in one crossing (issue #255 bulk mutation).

    Fast paths: another C-backed array of the SAME element type (caller
    asserts via allow_c_copy) is copied C-to-C with no boxing;
    float64/int64/bool numpy arrays convert through raw buffers. Anything
    else marshals per item inside this single call.
    """
    cdef _eastc.EastValue *arr = <_eastc.EastValue*>ptr
    cdef _eastc.EastType *elem_t = <_eastc.EastType*>elem_type_ptr
    cdef _eastc.EastValue *src
    cdef _eastc.EastValue *c_val
    cdef Py_ssize_t i, n
    cdef const double *dp
    cdef const int64_t *ip
    cdef const uint8_t *bp

    src_ptr = getattr(items, "_c_ptr", None) if allow_c_copy else None
    if src_ptr is not None:
        # C-to-C: push retains each element; no python objects involved
        src = <_eastc.EastValue*><uintptr_t>src_ptr
        if src.kind == _eastc.EAST_VAL_ARRAY:
            n = <Py_ssize_t>src.data.array.len
            for i in range(n):
                _eastc.east_array_push(arr, src.data.array.items[i])
            return

    if isinstance(items, np.ndarray):
        a = <object>items
        if a.dtype == np.float64 and a.flags["C_CONTIGUOUS"] and elem_t.kind == _eastc.EAST_TYPE_FLOAT:
            dp = <const double*>cnp.PyArray_DATA(<cnp.ndarray>a)
            n = len(a)
            for i in range(n):
                c_val = _eastc.east_float(dp[i])
                _eastc.east_array_push(arr, c_val)
                _eastc.east_value_release(c_val)
            return
        if a.dtype == np.int64 and a.flags["C_CONTIGUOUS"] and elem_t.kind == _eastc.EAST_TYPE_INTEGER:
            ip = <const int64_t*>cnp.PyArray_DATA(<cnp.ndarray>a)
            n = len(a)
            for i in range(n):
                c_val = _eastc.east_integer(ip[i])
                _eastc.east_array_push(arr, c_val)
                _eastc.east_value_release(c_val)
            return
        if a.dtype == np.bool_ and a.flags["C_CONTIGUOUS"] and elem_t.kind == _eastc.EAST_TYPE_BOOLEAN:
            bp = <const uint8_t*>cnp.PyArray_DATA(<cnp.ndarray>a)
            n = len(a)
            for i in range(n):
                c_val = _eastc.east_boolean(bp[i] != 0)
                _eastc.east_array_push(arr, c_val)
                _eastc.east_value_release(c_val)
            return

    for item in items:
        c_val = py_value_to_c(item, elem_t)
        _eastc.east_array_push(arr, c_val)
        _eastc.east_value_release(c_val)


def _dict_update_many(uintptr_t ptr, uintptr_t key_type_ptr, uintptr_t val_type_ptr,
                      object keys, object values,
                      uintptr_t combine_fn_ptr, object combine_py,
                      uintptr_t keys_arr_ptr=0, uintptr_t vals_arr_ptr=0,
                      Py_ssize_t n_c=-1):
    """Apply many (key, value) updates in one crossing (issue #255).

    On a key collision the combine function resolves the new value from
    (existing, incoming): combine_fn_ptr is a native East function value
    (invoked C-to-C via east_call), combine_py a python callable, and with
    neither the incoming value wins.

    Two input paths:

    * ``keys``/``values`` as python sequences — each element is converted with
      ``py_value_to_c``;
    * ``keys_arr_ptr``/``vals_arr_ptr`` as C-backed ``Array`` values, with
      ``n_c`` their length — elements are read straight out with
      ``east_array_get`` and never converted at all.

    The C-backed path exists because callers usually already HAVE C-backed
    arrays. Forcing them through python lists (which this function used to
    require) boxed every element C->python only for ``py_value_to_c`` to convert
    it back python->C: O(n) pointless round trips on the exact path whose
    contract promises the batch "crosses once". Measured on 61,238 nested-Option
    entries: 0.39s and +57MB peak RSS boxed, against 0.03s and +0MB by pointer.
    The boxing could also exhaust or corrupt memory on deeply nested values —
    MemoryError inside ``_box_string``, SIGSEGV under ``list_extend``.
    """
    cdef _eastc.EastValue *d = <_eastc.EastValue*>ptr
    cdef _eastc.EastType *kt = <_eastc.EastType*>key_type_ptr
    cdef _eastc.EastType *vt = <_eastc.EastType*>val_type_ptr
    cdef _eastc.EastValue *k_arr = <_eastc.EastValue*>keys_arr_ptr
    cdef _eastc.EastValue *v_arr = <_eastc.EastValue*>vals_arr_ptr
    cdef bint c_backed = keys_arr_ptr != 0 and vals_arr_ptr != 0
    cdef _eastc.EastValue *c_key
    cdef _eastc.EastValue *c_val
    cdef _eastc.EastValue *existing
    cdef _eastc.EastValue *combined
    cdef _eastc.EastValue *cargs[2]
    cdef _eastc.EastValue *fn_val = <_eastc.EastValue*>combine_fn_ptr
    cdef _eastc.EvalResult r
    cdef Py_ssize_t i, n

    if c_backed:
        n = n_c
    else:
        n = len(keys)
        if len(values) != n:
            raise ValueError(f"update_many: {n} keys but {len(values)} values")
    has_combine = combine_fn_ptr != 0 or combine_py is not None

    for i in range(n):
        if c_backed:
            # east_array_get borrows; retain so the unconditional release at the
            # end of the loop body stays balanced, exactly as it is for the
            # owned values py_value_to_c returns on the python path.
            c_key = _eastc.east_array_get(k_arr, <size_t>i)
            _eastc.east_value_retain(c_key)
            c_val = _eastc.east_array_get(v_arr, <size_t>i)
            _eastc.east_value_retain(c_val)
        else:
            c_key = py_value_to_c(keys[i], kt)
            try:
                c_val = py_value_to_c(values[i], vt)
            except BaseException:
                _eastc.east_value_release(c_key)
                raise
        try:
            existing = _eastc.east_dict_get(d, c_key) if has_combine else NULL
            if existing != NULL:
                if combine_fn_ptr != 0:
                    cargs[0] = existing
                    cargs[1] = c_val
                    r = _eastc.east_call(fn_val.data.function.compiled, cargs, 2)
                    if r.status != _eastc.EVAL_OK and r.status != _eastc.EVAL_RETURN:
                        msg = "update_many combine failed"
                        if r.error_message != NULL:
                            msg = r.error_message.decode("utf-8")
                        if r.value != NULL:
                            _eastc.east_value_release(r.value)
                        _eastc.eval_result_free(&r)
                        raise RuntimeError(msg)
                    combined = r.value
                    _eastc.east_dict_set(d, c_key, combined)
                    _eastc.east_value_release(combined)
                else:
                    # A python combine needs python values on both sides. On the
                    # C-backed path the incoming one is unboxed here, for this
                    # colliding key only — not for the whole batch.
                    incoming = (c_value_to_py(c_val, vt) if c_backed
                                else values[i])
                    py_combined = combine_py(c_value_to_py(existing, vt), incoming)
                    combined = py_value_to_c(py_combined, vt)
                    _eastc.east_dict_set(d, c_key, combined)
                    _eastc.east_value_release(combined)
            else:
                _eastc.east_dict_set(d, c_key, c_val)
        finally:
            _eastc.east_value_release(c_val)
            _eastc.east_value_release(c_key)
