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
from libc.string cimport memcpy, strdup

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

# Recursive type context stack for py_type_to_c.
# Each entry is an EastType* (as uintptr_t) for the recursive placeholder.
cdef list _type_ctx = []


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

    # Recursive — depth reference into _type_ctx stack
    elif tag == "Recursive":
        depth = py_type.value
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
    cdef _eastc.EastType* output_type
    cdef size_t i

    if input_types == NULL and num_inputs > 0:
        raise MemoryError()

    try:
        for i in range(num_inputs):
            input_types[i] = py_type_to_c(inputs[i])

        output_type = py_type_to_c(value["output"])

        if is_async:
            result = _eastc.east_async_function_type(input_types, num_inputs, output_type)
        else:
            result = _eastc.east_function_type(input_types, num_inputs, output_type)

        _eastc.east_type_release(output_type)
        for i in range(num_inputs):
            _eastc.east_type_release(input_types[i])

        return result
    except:
        for j in range(i):
            _eastc.east_type_release(input_types[j])
        raise
    finally:
        free(input_types)


# ─── c_value_to_py ────────────────────────────────────────────────────────

cdef object c_value_to_py(_eastc.EastValue *val, _eastc.EastType *c_type):
    """Convert a C EastValue to a Python object.

    Does NOT consume the C value — caller still owns it.
    Uses a pointer→object dict to preserve backreference aliasing.
    """
    cdef dict alias_map = {}
    return _c_value_to_py_impl(val, c_type, alias_map)


cdef object _c_value_to_py_impl(_eastc.EastValue *val, _eastc.EastType *c_type, dict alias_map):
    """Inner conversion with aliasing tracking."""
    cdef _eastc.EastTypeKind kind = c_type.kind
    cdef int64_t millis
    cdef uintptr_t ptr_key

    if kind == _eastc.EAST_TYPE_NULL:
        return None

    elif kind == _eastc.EAST_TYPE_BOOLEAN:
        return val.data.boolean

    elif kind == _eastc.EAST_TYPE_INTEGER:
        return val.data.integer

    elif kind == _eastc.EAST_TYPE_FLOAT:
        return val.data.float64

    elif kind == _eastc.EAST_TYPE_STRING:
        return PyUnicode_DecodeUTF8(
            val.data.string.data,
            <Py_ssize_t>val.data.string.len,
            NULL,
        )

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
        keys_list.append(val.data.struct_.field_names[i].decode("utf-8"))
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
    if vt != NULL and vt.kind == _eastc.EAST_TYPE_RECURSIVE:
        vt = vt.data.recursive.node
    if vt == NULL or vt.kind != _eastc.EAST_TYPE_VARIANT or case_idx >= vt.data.variant.num_cases:
        raise ValueError(f"Invalid variant: case={case_name} idx={case_idx}")
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

cdef object _c_type_tag_to_py_type(_eastc.EastType *c_type):
    """Convert a C EastType* to a Python EastVariant type descriptor.

    Top-level entry point: scopes the reverse caches (_py_type_cache,
    _type_convert_stack) to this single conversion, clearing them on entry
    and exit so pointer-keyed entries never outlive one reconstruction.
    Recursive sub-conversions go through _c_type_tag_to_py_type_inner
    instead — the within-call cache must be preserved across them, as it
    handles shared subtrees and cycle detection.
    """
    _py_type_cache.clear()
    _type_convert_stack.clear()
    try:
        return _c_type_tag_to_py_type_inner(c_type)
    finally:
        _py_type_cache.clear()
        _type_convert_stack.clear()


cdef object _c_type_tag_to_py_type_inner(_eastc.EastType *c_type):
    """Convert one node within the current top-level conversion's scope.

    Uses a conversion stack to detect cycles from recursive types and
    emit proper Recursive(depth) references.
    """
    cdef uintptr_t key = <uintptr_t>c_type
    cached = _py_type_cache.get(key)
    if cached is not None:
        return cached

    # Check if this pointer is already on the conversion stack (cycle)
    for idx in range(len(_type_convert_stack)):
        if <uintptr_t>_type_convert_stack[idx] == key:
            # Cycle detected — return Recursive(depth) where depth counts
            # from the current position back to the matching stack entry
            return EastVariant("Recursive", len(_type_convert_stack) - idx)

    return _c_type_tag_to_py_type_impl(c_type, key)


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
        _py_type_cache[key] = result
        return result
    elif kind == _eastc.EAST_TYPE_SET:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Set", elem)
        _py_type_cache[key] = result
        return result
    elif kind == _eastc.EAST_TYPE_VECTOR:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Vector", elem)
        _py_type_cache[key] = result
        return result
    elif kind == _eastc.EAST_TYPE_MATRIX:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Matrix", elem)
        _py_type_cache[key] = result
        return result
    elif kind == _eastc.EAST_TYPE_REF:
        _type_convert_stack.append(key)
        try:
            elem = _c_type_tag_to_py_type_inner(c_type.data.element)
        finally:
            _type_convert_stack.pop()
        result = EastVariant("Ref", elem)
        _py_type_cache[key] = result
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
        _py_type_cache[key] = result
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
        _py_type_cache[key] = result
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

    _py_type_cache[key] = result
    return result


# ─── py_value_to_c ────────────────────────────────────────────────────────

cdef _eastc.EastValue* py_value_to_c(object val, _eastc.EastType *c_type) except NULL:
    """Convert a Python value to a C EastValue*.

    Returns a retained pointer. Caller must call east_value_release().
    Tracks Python id() for mutable types to preserve identity (backreferences).
    """
    cdef dict identity_map = {}
    return _py_value_to_c_impl(val, c_type, identity_map)


cdef _eastc.EastValue* _py_value_to_c_impl(object val, _eastc.EastType *c_type, dict identity_map) except NULL:
    """Inner conversion with identity tracking."""
    cdef _eastc.EastTypeKind kind = c_type.kind
    cdef _eastc.EastValue* result
    cdef const char* str_data
    cdef Py_ssize_t str_len
    cdef int64_t millis
    cdef object py_id
    cdef uintptr_t cached_ptr

    # Fast path: if value is a C-backed proxy, reuse its pointer (no copy)
    if isinstance(val, EastArrayProxy):
        result = <_eastc.EastValue*><uintptr_t>val._c_ptr
        _eastc.east_value_retain(result)
        return result
    if isinstance(val, EastSetProxy):
        result = <_eastc.EastValue*><uintptr_t>val._c_ptr
        _eastc.east_value_retain(result)
        return result
    if isinstance(val, EastDictProxy):
        result = <_eastc.EastValue*><uintptr_t>val._c_ptr
        _eastc.east_value_retain(result)
        return result
    if isinstance(val, EastRefProxy):
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

    # Convert capture values and store in a C Environment
    capture_values = getattr(val, EAST_CAPTURES_ATTR, {})
    captures_list = py_ir["value"]["captures"]

    if len(captures_list) > 0 and len(capture_values) > 0:
        _populate_fn_captures(fn, captures_list, capture_values, identity_map)

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
