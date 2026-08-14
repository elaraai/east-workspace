# cython: language_level=3
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cython declarations for east-c's public C API.

Declares struct layouts with union members so .pyx files can access
fields directly (e.g. val.data.string.data).

Declaration order matters — types are ordered so that each struct only
references types already declared above it.  PlatformRegistry is kept
opaque here because PlatformFn depends on EvalResult which depends on
EastValue; the pre_call hook field is accessed via inline C in the
platform bridge module.
"""

from libc.stddef cimport size_t
from libc.stdint cimport int32_t, int64_t, uint8_t, uint64_t


# ─── types.h ──────────────────────────────────────────────────────────────

cdef extern from "east/types.h":

    ctypedef enum EastTypeKind:
        EAST_TYPE_NEVER
        EAST_TYPE_NULL
        EAST_TYPE_BOOLEAN
        EAST_TYPE_INTEGER
        EAST_TYPE_FLOAT
        EAST_TYPE_STRING
        EAST_TYPE_DATETIME
        EAST_TYPE_BLOB
        EAST_TYPE_ARRAY
        EAST_TYPE_SET
        EAST_TYPE_DICT
        EAST_TYPE_STRUCT
        EAST_TYPE_VARIANT
        EAST_TYPE_REF
        EAST_TYPE_VECTOR
        EAST_TYPE_MATRIX
        EAST_TYPE_FUNCTION
        EAST_TYPE_ASYNC_FUNCTION
        EAST_TYPE_RECURSIVE

    ctypedef struct EastTypeField:
        char *name
        EastType *type

    # Nested structs for the union
    ctypedef struct _EastTypeDictData:
        EastType *key
        EastType *value

    ctypedef struct _EastTypeStructData:
        EastTypeField *fields
        size_t num_fields

    ctypedef struct _EastTypeVariantData:
        EastTypeField *cases
        size_t num_cases

    ctypedef struct _EastTypeFunctionData:
        EastType **inputs
        size_t num_inputs
        EastType *output

    ctypedef struct _EastTypeRecursiveData:
        EastType *node

    ctypedef union _EastTypeData:
        # Array, Set, Ref, Vector, Matrix
        EastType *element
        # Dict
        _EastTypeDictData dict
        # Struct
        _EastTypeStructData struct_  "struct_"
        # Variant
        _EastTypeVariantData variant
        # Function, AsyncFunction
        _EastTypeFunctionData function
        # Recursive
        _EastTypeRecursiveData recursive

    ctypedef struct EastType:
        EastTypeKind kind
        int ref_count
        _EastTypeData data

    # Primitive type singletons
    EastType east_never_type
    EastType east_null_type
    EastType east_boolean_type
    EastType east_integer_type
    EastType east_float_type
    EastType east_string_type
    EastType east_datetime_type
    EastType east_blob_type

    # Constructors (return interned, arena-immortal types; retain/release are no-ops)
    EastType *east_array_type(EastType *elem)
    EastType *east_set_type(EastType *elem)
    EastType *east_dict_type(EastType *key, EastType *val)
    EastType *east_struct_type(const char **names, EastType **types, size_t count)
    EastType *east_variant_type(const char **names, EastType **types, size_t count)
    EastType *east_ref_type(EastType *inner)
    EastType *east_vector_type(EastType *elem)
    EastType *east_matrix_type(EastType *elem)
    EastType *east_function_type(EastType **inputs, size_t num_inputs, EastType *output)
    EastType *east_async_function_type(EastType **inputs, size_t num_inputs, EastType *output)

    # Recursive type
    EastType *east_recursive_type_new()
    void east_recursive_type_set(EastType *rec, EastType *node)
    EastType *east_recursive_type_intern(EastType *rec)

    # Ref counting
    void east_type_retain(EastType *t)
    void east_type_release(EastType *t)

    # Comparison
    bint east_type_equal(EastType *a, EastType *b)


# ─── ir.h ────────────────────────────────────────────────────────────────

cdef extern from "east/ir.h":

    ctypedef struct EastLocation:
        char *filename
        int64_t line
        int64_t column

    ctypedef struct IRNode:
        int ref_count
        EastType *type
        EastLocation *locations
        size_t num_locations

    void ir_node_retain(IRNode *node)
    void ir_node_release(IRNode *node)


# ─── values.h ─────────────────────────────────────────────────────────────
# PlatformRegistry and BuiltinRegistry are kept opaque — their internal
# layout is not needed here.  EastCompiledFn uses them only as pointers.

cdef extern from "east/values.h":

    ctypedef enum EastValueKind:
        EAST_VAL_NULL
        EAST_VAL_BOOLEAN
        EAST_VAL_INTEGER
        EAST_VAL_FLOAT
        EAST_VAL_STRING
        EAST_VAL_DATETIME
        EAST_VAL_BLOB
        EAST_VAL_ARRAY
        EAST_VAL_SET
        EAST_VAL_DICT
        EAST_VAL_STRUCT
        EAST_VAL_VARIANT
        EAST_VAL_REF
        EAST_VAL_VECTOR
        EAST_VAL_MATRIX
        EAST_VAL_FUNCTION
        EAST_VAL_PAGED

    ctypedef struct Environment:
        pass

    ctypedef struct BuiltinRegistry:
        pass

    ctypedef struct PlatformRegistry:
        pass

    ctypedef struct EastSourceMap:
        pass

    ctypedef struct EastCompiledFn:
        IRNode *ir
        Environment *captures
        char **param_names
        size_t num_params
        PlatformRegistry *platform
        BuiltinRegistry *builtins
        EastValue *source_ir
        EastType *fn_type
        EastSourceMap *source_map
        void *invoke_userdata

    # Nested structs for the value union
    ctypedef struct _EastValueStringData:
        # `data` points into the node itself for strings up to the inline cap
        # (that trailing buffer is not declared here — nothing reads it from
        # Python, and cdef extern binds by name rather than by layout).
        char *data
        size_t len

    ctypedef struct _EastValueBlobData:
        uint8_t *data
        size_t len

    ctypedef struct _EastValueArrayData:
        EastValue **items
        size_t len
        size_t cap
        EastType *elem_type

    ctypedef struct _EastValueSetData:
        EastValue **items
        size_t len
        size_t cap
        EastType *elem_type

    ctypedef struct _EastValueDictData:
        EastValue **keys
        EastValue **values
        size_t len
        size_t cap
        EastType *key_type
        EastType *val_type

    ctypedef struct _EastValueStructData:
        char **field_names
        EastValue **field_values
        size_t num_fields
        EastType *type

    ctypedef struct _EastValueVariantData:
        EastValue *value
        EastType *type
        size_t case_idx
        const char *case_tag

    ctypedef struct _EastValueRefData:
        EastValue *value

    ctypedef struct _EastValueVectorData:
        void *data
        size_t len
        EastType *elem_type

    ctypedef struct _EastValueMatrixData:
        void *data
        size_t rows
        size_t cols
        EastType *elem_type

    ctypedef struct _EastValueFunctionData:
        EastCompiledFn *compiled

    ctypedef union _EastValueData:
        bint boolean
        int64_t integer
        double float64
        _EastValueStringData string
        int64_t datetime
        _EastValueBlobData blob
        _EastValueArrayData array
        _EastValueSetData set
        _EastValueDictData dict
        _EastValueStructData struct_  "struct_"
        _EastValueVariantData variant
        _EastValueRefData ref
        _EastValueVectorData vector
        _EastValueMatrixData matrix
        _EastValueFunctionData function

    # The GC header trails `data`, and exists only on the container kinds — a
    # leaf value's slot stops at its union arm, so reading gc_tracked or
    # iter_lock on a scalar is out of bounds. cdef extern binds by name, not
    # offset, so this mirror only has to stay honest, not exhaustive.
    ctypedef struct EastValue:
        EastValueKind kind
        int ref_count
        _EastValueData data
        EastValue *gc_next
        EastValue *gc_prev
        int gc_refs
        bint gc_tracked
        unsigned char gc_gen
        int iter_lock

    # Global null singleton
    EastValue east_null_value

    # Constructors
    EastValue *east_null()
    EastValue *east_boolean(bint val)
    EastValue *east_integer(int64_t val)
    EastValue *east_float(double val)
    EastValue *east_string(const char *s)
    EastValue *east_string_len(const char *s, size_t length)
    EastValue *east_datetime(int64_t millis)
    EastValue *east_blob(const uint8_t *data, size_t length)

    # Collection constructors
    EastValue *east_array_new(EastType *elem_type)
    void east_array_push(EastValue *arr, EastValue *val)
    EastValue *east_array_get(EastValue *arr, size_t index)
    size_t east_array_len(EastValue *arr)

    EastValue *east_set_new(EastType *elem_type)
    void east_set_insert(EastValue *s, EastValue *val)
    bint east_set_has(EastValue *s, EastValue *val)
    bint east_set_delete(EastValue *s, EastValue *val)
    void east_set_clear(EastValue *s)
    size_t east_set_len(EastValue *s)
    # Encapsulated element access — sync the lazy cache, then return the element.
    # Use these instead of indexing data.set.items / data.dict.keys|values, which
    # are a private cache of the underlying B-tree (stale until synced).
    EastValue *east_set_at(EastValue *s, size_t i)

    EastValue *east_dict_new(EastType *key_type, EastType *val_type)
    void east_dict_set(EastValue *d, EastValue *key, EastValue *val)
    EastValue *east_dict_get(EastValue *d, EastValue *key)
    bint east_dict_has(EastValue *d, EastValue *key)
    bint east_dict_delete(EastValue *d, EastValue *key)
    EastValue *east_dict_pop(EastValue *d, EastValue *key)
    void east_dict_clear(EastValue *d)
    size_t east_dict_len(EastValue *d)
    EastValue *east_dict_key_at(EastValue *d, size_t i)
    EastValue *east_dict_val_at(EastValue *d, size_t i)

    EastValue *east_struct_new(const char **names, EastValue **values, size_t count, EastType *type)
    EastValue *east_struct_get_field(EastValue *s, const char *name)
    # field_names is NULL whenever the instance's StructType supplies the names
    # (the common case). Always read names through this.
    const char *east_struct_field_name(const EastValue *s, size_t idx)

    EastValue *east_variant_new(const char *case_name, EastValue *value, EastType *type)

    EastValue *east_ref_new(EastValue *value)
    EastValue *east_ref_get(EastValue *ref)
    void east_ref_set(EastValue *ref, EastValue *value)

    EastValue *east_vector_new(EastType *elem_type, size_t length)
    EastValue *east_matrix_new(EastType *elem_type, size_t rows, size_t cols)

    EastValue *east_function_value(EastCompiledFn *fn)

    # Ref counting
    void east_value_retain(EastValue *v)
    void east_value_release(EastValue *v)

    # Comparison
    bint east_value_equal(EastValue *a, EastValue *b)
    int east_value_compare(EastValue *a, EastValue *b)


# ─── serialization.h ──────────────────────────────────────────────────────

cdef extern from "east/serialization.h" nogil:
    EastValue *east_beast2_decode_auto(const uint8_t *data, size_t len)
    EastType *east_beast2_extract_type(const uint8_t *data, size_t len)

cdef extern from "east/serialization.h":

    ctypedef struct ByteBuffer:
        uint8_t *data
        size_t len
        size_t cap

    ByteBuffer *byte_buffer_new(size_t initial_cap)
    void byte_buffer_free(ByteBuffer *buf)

    # BEAST2 binary serialization (headerless, type-driven)
    ByteBuffer *east_beast2_encode(EastValue *value, EastType *type)
    EastValue *east_beast2_decode(const uint8_t *data, size_t length, EastType *type)

    # BEAST2 with header (magic bytes + type schema + value). *_full writes the
    # current default container (v5 since #416); *_v4 pins the legacy one.
    ByteBuffer *east_beast2_encode_full(EastValue *value, EastType *type)
    ByteBuffer *east_beast2_encode_v4(EastValue *value, EastType *type)
    EastValue *east_beast2_decode_full(const uint8_t *data, size_t length, EastType *type)
    # Frozen (task-input) decode: every constructed container/Ref/Vector/Matrix
    # carries the frozen flag from construction — mutating builtins refuse and
    # frozen collections compare as value types under Is (#539).
    EastValue *east_beast2_decode_full_frozen(const uint8_t *data, size_t length, EastType *type)
    # BEAST2 IR decode+convert in one shot (keeps type table alive for O(1) resolution)
    IRNode *east_beast2_decode_ir(const uint8_t *data, size_t length, EastValue **ir_value_out,
                                  EastSourceMap **source_map_out)

    # BEAST2 v5 — segment-terminated record stream (issue #416)
    ByteBuffer *east_beast2_encode_v5(EastValue *value, EastType *type, int32_t codec_id,
                                      bint with_index)

    ctypedef struct Beast2StreamWriter:
        pass
    Beast2StreamWriter *east_beast2_writer_new(EastType *type, int32_t codec_id,
                                               bint self_contained, bint with_index)
    bint east_beast2_writer_write(Beast2StreamWriter *w, EastValue *batch)
    ByteBuffer *east_beast2_writer_take(Beast2StreamWriter *w)
    bint east_beast2_writer_finish(Beast2StreamWriter *w)
    void east_beast2_writer_free(Beast2StreamWriter *w)

    ctypedef struct Beast2SegmentReader:
        pass
    Beast2SegmentReader *east_beast2_reader_new(const uint8_t *data, size_t length,
                                                EastType *type)
    EastValue *east_beast2_reader_next(Beast2SegmentReader *r)
    bint east_beast2_reader_done(Beast2SegmentReader *r)
    bint east_beast2_reader_counts(Beast2SegmentReader *r, size_t *segment_count,
                                   size_t *element_count)
    void east_beast2_reader_free(Beast2SegmentReader *r)

    # v5 paging reader — random access over an indexed, self-contained blob
    ctypedef struct Beast2Pages:
        pass
    Beast2Pages *east_beast2_pages_new(const uint8_t *data, size_t length, EastType *type)
    size_t east_beast2_pages_segment_count(Beast2Pages *p)
    size_t east_beast2_pages_element_count(Beast2Pages *p)
    bint east_beast2_pages_self_contained(Beast2Pages *p)
    const size_t *east_beast2_pages_counts(Beast2Pages *p, size_t *n_out)
    EastValue *east_beast2_pages_segment(Beast2Pages *p, size_t i)
    EastValue *east_beast2_pages_element(Beast2Pages *p, size_t row)
    EastValue *east_beast2_pages_fence(Beast2Pages *p, size_t i)
    int east_beast2_pages_get_key(Beast2Pages *p, EastValue *key, EastValue **value_out)
    EastValue *east_beast2_pages_get_keys(Beast2Pages *p, EastValue *keys,
                                          EastValue **missing_out)
    bint east_beast2_pages_find_sorted(Beast2Pages *p, EastValue *target, bint last,
                                       size_t *index_out)
    EastValue *east_beast2_pages_segment_disjoint(Beast2Pages *p, size_t i)
    void east_beast2_pages_free(Beast2Pages *p)

    # Lazy pager-backed collection value (issue #505). open_paged takes
    # ownership of `data` (free()-compatible) ON SUCCESS only; hydrated
    # returns a BORROWED value kept alive by the wrapper (NULL on decode
    # failure, message via east_builtin_get_error).
    EastValue *east_beast2_open_paged(uint8_t *data, size_t length, EastType *type)
    # Frozen lazy open (#539): the paged value and every pager-served segment
    # decode frozen; the shape gate collapses to Ref/function exclusions.
    EastValue *east_beast2_open_paged_frozen(uint8_t *data, size_t length, EastType *type)
    # Borrowed-bytes lazy open (#560): the caller keeps the bytes (an mmap)
    # alive and unchanged for the value's lifetime; never takes ownership.
    EastValue *east_beast2_open_paged_view(const uint8_t *data, size_t length, EastType *type,
                                           bint frozen)
    # Byte budget of a pager's decoded-segment cache (#560); the
    # EAST_PAGED_CACHE_BYTES environment variable overrides the default.
    void east_beast2_pages_set_cache_budget(Beast2Pages *p, size_t bytes)
    EastValue *east_paged_hydrated(EastValue *v)

    # v5 splice extents — byte geometry for merging blobs (issue #484)
    ctypedef struct Beast2SpliceExtents:
        size_t prefix_end
        size_t segments_end
        size_t index_offset
        size_t *offsets
        size_t *counts
        size_t segment_count
        bint self_contained
        bint source_map_empty
    Beast2SpliceExtents *east_beast2_splice_extents(const uint8_t *data, size_t length)
    void east_beast2_splice_extents_free(Beast2SpliceExtents *e)
    ByteBuffer *east_beast2_splice_tail(const size_t *offsets, const size_t *counts, size_t n,
                                        size_t stream_end)

    # JSON serialization
    char *east_json_encode(EastValue *value, EastType *type)
    EastValue *east_json_decode(const char *json, EastType *type)
    EastValue *east_json_decode_with_error(const char *json, EastType *type, char **error_out)
    # JSON IR wrapper decode (mirrors east_beast2_decode_ir for JSON)
    IRNode *east_json_decode_ir(const char *json, EastValue **ir_value_out, EastSourceMap **source_map_out)

    # CSV serialization
    char *east_csv_encode(EastValue *array, EastType *type, EastValue *config)
    EastValue *east_csv_decode(const char *csv, EastType *type, EastValue *config)
    EastValue *east_csv_decode_with_error(const char *csv, EastType *type,
                                           EastValue *config, char **error_out)

    # East text format
    char *east_print_value(EastValue *value, EastType *type)
    EastValue *east_parse_value(const char *text, EastType *type)
    char *east_print_type(EastType *type)
    EastType *east_parse_type(const char *text)


# ─── env.h ───────────────────────────────────────────────────────────────

cdef extern from "east/env.h":
    Environment *env_new(Environment *parent)
    void env_set(Environment *env, const char *name, EastValue *value)
    EastValue *env_get(Environment *env, const char *name)


# ─── builtins.h ──────────────────────────────────────────────────────────

cdef extern from "east/builtins.h":
    ctypedef EastValue *(*BuiltinImpl)(EastValue **args, size_t num_args)
    BuiltinRegistry *builtin_registry_new()
    void east_register_all_builtins(BuiltinRegistry *reg)
    void builtin_registry_free(BuiltinRegistry *reg)
    BuiltinImpl builtin_registry_get(BuiltinRegistry *reg, const char *name, EastType **type_params, size_t num_tp)
    void east_builtin_error(const char *msg)
    char *east_builtin_get_error()


# ─── eval_result.h ───────────────────────────────────────────────────────

cdef extern from "east/eval_result.h":
    ctypedef enum EvalStatus:
        EVAL_OK
        EVAL_RETURN
        EVAL_BREAK
        EVAL_CONTINUE
        EVAL_ERROR

    ctypedef struct EvalResult:
        EvalStatus status
        EastValue *value
        char *label
        char *error_message
        EastLocation *locations
        size_t num_locations

    EvalResult eval_ok(EastValue *value)
    EvalResult eval_error(const char *msg)
    void eval_result_free(EvalResult *result)


# ─── platform.h ──────────────────────────────────────────────────────────
# PlatformRegistry struct is declared opaque above (in values.h block).
# The pre_call hook field is accessed via inline C in _platform_bridge.pyx.

cdef extern from "east/platform.h":

    ctypedef EvalResult (*PlatformFn)(EastValue **args, size_t num_args, EastType **input_types, size_t num_input_types, EastType *output_type)
    ctypedef PlatformFn (*GenericPlatformFactory)(EastType **type_params, size_t num_type_params)

    PlatformRegistry *platform_registry_new()
    void platform_registry_add(PlatformRegistry *reg, const char *name, PlatformFn fn, bint is_async)
    void platform_registry_add_typed(PlatformRegistry *reg, const char *name, PlatformFn fn, bint is_async, EastType **input_types, size_t num_input_types, EastType *output_type)
    void platform_registry_add_generic(PlatformRegistry *reg, const char *name, GenericPlatformFactory factory, bint is_async)
    PlatformFn platform_registry_get(PlatformRegistry *reg, const char *name, EastType **type_params, size_t num_tp)
    void platform_registry_free(PlatformRegistry *reg)
    void platform_registry_retain(PlatformRegistry *reg)
    void platform_registry_release(PlatformRegistry *reg)


# ─── compiler.h ──────────────────────────────────────────────────────────

cdef extern from "east/compiler.h":
    ctypedef EvalResult (*EastInvokeFn)(EastCompiledFn *self, EastValue **args, size_t n_args)
    EastValue *east_foreign_function(EastInvokeFn invoke, void *userdata, void (*invoke_release)(void *userdata), EastType *fn_type)
    EastCompiledFn *east_compile(IRNode *ir, PlatformRegistry *platform, BuiltinRegistry *builtins)
    EastCompiledFn *east_compile_checked(IRNode *ir, PlatformRegistry *platform, BuiltinRegistry *builtins, char **error_out)
    EvalResult east_call(EastCompiledFn *fn, EastValue **args, size_t num_args)
    void east_compiled_fn_free(EastCompiledFn *fn)
    PlatformRegistry *east_current_platform()
    BuiltinRegistry *east_current_builtins()
    void east_set_thread_context(PlatformRegistry *p, BuiltinRegistry *b)
    void east_get_thread_context(PlatformRegistry **out_p, BuiltinRegistry **out_b)
    void east_set_source_map(const EastSourceMap *sm)
    void east_source_map_free(EastSourceMap *sm)


# ─── type_of_type.h ─────────────────────────────────────────────────────

cdef extern from "east/type_of_type.h":
    # Type descriptors (initialized by east_type_of_type_init)
    EastType *east_type_type
    EastType *east_ir_type
    EastType *east_ir_type_with_refs

    void east_type_of_type_init()

    IRNode *east_ir_from_value(EastValue *value)
    EastValue *east_type_to_value(EastType *type)
    EastType *east_type_from_value(EastValue *value)
