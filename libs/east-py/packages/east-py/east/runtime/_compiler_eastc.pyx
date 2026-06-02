# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compile and execute East IR via east-c.

Converts Python IR → C IR, compiles it with east-c's compiler, and returns
a Python callable that invokes east_call.  All 212+ builtins come from
east-c via east_register_all_builtins — no Python builtins are used.
"""

from libc.stddef cimport size_t
from libc.stdint cimport int64_t, uint8_t, uintptr_t
from libc.stdlib cimport malloc, free
from cpython.ref cimport Py_INCREF, Py_DECREF

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py, py_value_to_c, _c_type_tag_to_py_type
from east._platform_bridge cimport register_platform_functions

import asyncio

# Attribute name used to attach source IR to compiled functions.
EAST_IR_ATTR = "_east_ir"
EAST_CAPTURES_ATTR = "_east_captures"


# ─── Shared runtime ─────────────────────────────────────────────────────

cdef bint _runtime_initialized = False
cdef _eastc.BuiltinRegistry* _builtins = NULL

cdef void _ensure_runtime() except *:
    """Initialize east-c runtime (builtins, type_of_type) once."""
    global _runtime_initialized, _builtins
    if _runtime_initialized:
        return
    _builtins = _eastc.builtin_registry_new()
    _eastc.east_register_all_builtins(_builtins)
    _eastc.east_type_of_type_init()
    _runtime_initialized = True


# ─── Python callbacks as east-c function values (the invoke hook) ─────────
#
# A callback builtin (ArrayMap, ArrayFilter, keyed ArraySort, …) takes the
# user's lambda as a function ARG. To delegate the whole builtin to east-c we
# wrap that lambda as a function value whose EastCompiledFn.invoke trampolines
# back into Python. east-c then drives the loop and calls the lambda per element
# through the trampoline — no algorithm is reimplemented in Python.

cdef _eastc.EvalResult _py_invoke_trampoline(_eastc.EastCompiledFn* self,
                                             _eastc.EastValue** args, size_t n) noexcept with gil:
    """Called by east-c when it invokes a wrapped Python callable."""
    cdef object ud = <object>self.invoke_userdata  # (fn, input_types, output_type)
    cdef _eastc.EastType* c_in
    cdef _eastc.EastType* c_out
    cdef _eastc.EastValue* c_result
    cdef size_t i, n_types
    cdef bytes msg
    pyfn = ud[0]
    input_types = ud[1]
    output_type = ud[2]
    n_types = len(input_types)
    try:
        py_args = []
        for i in range(n):
            in_type = input_types[i] if i < n_types else input_types[n_types - 1]
            c_in = py_type_to_c(in_type)
            try:
                py_args.append(c_value_to_py(args[i], c_in))
            finally:
                _eastc.east_type_release(c_in)
        py_result = pyfn(*py_args)
        c_out = py_type_to_c(output_type)
        try:
            c_result = py_value_to_c(py_result, c_out)
        finally:
            _eastc.east_type_release(c_out)
        return _eastc.eval_ok(c_result)
    except BaseException as e:  # surface the Python error through east-c
        msg = f"callback raised: {e}".encode("utf-8")
        return _eastc.eval_error(<const char*>msg)


cdef void _py_invoke_release(void* ud) noexcept with gil:
    """Release the Python callable handle when the function value is freed."""
    Py_DECREF(<object>ud)


cdef _eastc.EastValue* _wrap_pyfn(object east_fn) except NULL:
    """Wrap an EastFunction (Python callable + signature) as a C function value."""
    cdef tuple ud = (east_fn.fn, east_fn.input_types, east_fn.output_type)
    Py_INCREF(ud)  # held by the C value; released by _py_invoke_release
    cdef _eastc.EastValue* fv = _eastc.east_foreign_function(
        <_eastc.EastInvokeFn>_py_invoke_trampoline, <void*>ud, _py_invoke_release, NULL
    )
    if fv == NULL:
        # east_foreign_function already released `ud` on allocation failure.
        raise MemoryError()
    return fv


# ─── Eager builtin invocation (no IR compile) ────────────────────────────

def call_builtin(str name, list type_params, list args, object output_type):
    """Eagerly invoke an east-c builtin by name and return its result.

    This is the bridge that backs east-py's eager value methods. It marshals
    args into east-c, looks up the builtin in the shared registry, calls the
    factory then the impl back-to-back (so factories that stash thread-local
    type context stay valid — mirrors compiler.c's IR_BUILTIN path), and
    decodes the result.

    Args:
        name: undotted builtin name, e.g. "ArraySortDefault", "FloatSqrt".
        type_params: Python EastTypes for the builtin's type parameters.
        args: Python values; each arg's C type is inferred via ``type_of``.
        output_type: Python EastType used to decode the result.
    """
    cdef bytes name_bytes = name.encode("utf-8")
    cdef size_t ntp = len(type_params)
    cdef size_t nargs = len(args)
    cdef _eastc.EastType** c_tps = NULL
    cdef _eastc.EastType** arg_types = NULL
    cdef _eastc.EastValue** c_args = NULL
    cdef _eastc.EastType* c_out = NULL
    cdef _eastc.BuiltinImpl bfn
    cdef _eastc.EastValue* result
    cdef char* err
    cdef size_t i, j
    cdef object py_result

    from east.types.values import EastFunction, type_of

    _ensure_runtime()

    try:
        if ntp > 0:
            c_tps = <_eastc.EastType**>malloc(ntp * sizeof(_eastc.EastType*))
            if c_tps == NULL:
                raise MemoryError()
            for i in range(ntp):
                c_tps[i] = py_type_to_c(type_params[i])

        if nargs > 0:
            c_args = <_eastc.EastValue**>malloc(nargs * sizeof(_eastc.EastValue*))
            arg_types = <_eastc.EastType**>malloc(nargs * sizeof(_eastc.EastType*))
            if c_args == NULL or arg_types == NULL:
                raise MemoryError()
            for i in range(nargs):
                c_args[i] = NULL
                arg_types[i] = NULL
            for i in range(nargs):
                if isinstance(args[i], EastFunction):
                    # Wrap the Python callable as an east-c function value.
                    c_args[i] = _wrap_pyfn(args[i])
                else:
                    arg_types[i] = py_type_to_c(type_of(args[i]))
                    c_args[i] = py_value_to_c(args[i], arg_types[i])

        c_out = py_type_to_c(output_type)

        # Factory + impl back-to-back — no Python allocation in between.
        bfn = _eastc.builtin_registry_get(_builtins, <const char*>name_bytes, c_tps, ntp)
        if bfn == NULL:
            raise ValueError(f"Unknown east-c builtin: {name}")
        result = bfn(c_args, nargs)

        if result == NULL:
            err = _eastc.east_builtin_get_error()
            from east.runtime.errors import EastError
            from east.types.values import EastArray, EastVariant
            if err != NULL:
                msg = err.decode("utf-8")
                free(err)
            else:
                msg = f"east-c builtin {name} failed"
            raise EastError(msg, EastArray(EastVariant("Null", None)))

        py_result = c_value_to_py(result, c_out)
        _eastc.east_value_release(result)
        return py_result
    finally:
        if c_args != NULL:
            for j in range(nargs):
                if c_args[j] != NULL:
                    _eastc.east_value_release(c_args[j])
            free(c_args)
        if arg_types != NULL:
            for j in range(nargs):
                if arg_types[j] != NULL:
                    _eastc.east_type_release(arg_types[j])
            free(arg_types)
        if c_tps != NULL:
            for j in range(ntp):
                if c_tps[j] != NULL:
                    _eastc.east_type_release(c_tps[j])
            free(c_tps)
        if c_out != NULL:
            _eastc.east_type_release(c_out)


# ─── Common compile from C IR value ──────────────────────────────────────

cdef object _compile_from_c_ir_val(_eastc.EastValue* c_ir_val, list platform_list, bint is_async):
    """Compile from a C IR value — shared by JSON and East text paths."""
    cdef _eastc.IRNode* ir_node = _eastc.east_ir_from_value(c_ir_val)
    if ir_node == NULL:
        _eastc.east_value_release(c_ir_val)
        raise RuntimeError("east_ir_from_value returned NULL — invalid IR")
    return _compile_from_ir_node(ir_node, c_ir_val, platform_list, is_async)


cdef object _compile_from_ir_node(_eastc.IRNode* ir_node, _eastc.EastValue* c_ir_val,
                                   list platform_list, bint is_async):
    """Compile from an already-decoded IRNode — shared compilation path."""
    cdef _eastc.PlatformRegistry* platform = _eastc.platform_registry_new()
    if platform_list:
        try:
            register_platform_functions(platform, platform_list)
        except:
            _eastc.platform_registry_free(platform)
            _eastc.east_value_release(c_ir_val)
            raise

    cdef _eastc.EastCompiledFn* wrapper = _eastc.east_compile(ir_node, platform, _builtins)
    if wrapper == NULL:
        _eastc.platform_registry_free(platform)
        _eastc.east_value_release(c_ir_val)
        raise RuntimeError("east_compile returned NULL")

    cdef _eastc.EvalResult unwrap_result = _eastc.east_call(wrapper, NULL, 0)
    if unwrap_result.status != _eastc.EVAL_OK and unwrap_result.status != _eastc.EVAL_RETURN:
        msg = "Failed to unwrap compiled function"
        if unwrap_result.error_message != NULL:
            msg = unwrap_result.error_message.decode("utf-8")
        _eastc.east_compiled_fn_free(wrapper)
        _eastc.platform_registry_free(platform)
        _eastc.east_value_release(c_ir_val)
        raise RuntimeError(msg)

    cdef _eastc.EastValue* fn_val = unwrap_result.value
    if fn_val == NULL or fn_val.kind != _eastc.EAST_VAL_FUNCTION:
        if fn_val != NULL:
            _eastc.east_value_release(fn_val)
        return _make_callable(wrapper, platform, c_ir_val, None)

    cdef _eastc.EastCompiledFn* compiled = fn_val.data.function.compiled
    if compiled == NULL:
        _eastc.east_value_release(fn_val)
        _eastc.east_compiled_fn_free(wrapper)
        _eastc.platform_registry_free(platform)
        _eastc.east_value_release(c_ir_val)
        raise RuntimeError("Unwrapped function has NULL compiled fn")

    compiled.platform = platform
    compiled.builtins = _builtins

    cdef _eastc.EastType* fn_type = wrapper.ir.type

    return _make_callable_from_value(fn_val, wrapper, platform, c_ir_val, None, is_async, fn_type)


# ─── Compile from JSON (fast path — no Python round-trip) ────────────────

cpdef object compile_eastc_from_json(bytes json_data, list platform_list, bint is_async):
    """Compile East IR directly from JSON bytes — no Python IR round-trip.

    Supports both wrapper format {ir, source_map} (exported by TS test suite)
    and raw IR format (legacy). Extracts and attaches source map if present.
    """
    _ensure_runtime()

    cdef _eastc.EastValue* c_ir_val = NULL
    cdef _eastc.EastSourceMap* source_map = NULL
    cdef _eastc.IRNode* ir_node = _eastc.east_json_decode_ir(
        <const char*>json_data, &c_ir_val, &source_map)
    if ir_node == NULL:
        if c_ir_val != NULL:
            _eastc.east_value_release(c_ir_val)
        raise RuntimeError("east_json_decode_ir failed for IR")

    cdef object result = _compile_from_ir_node(ir_node, c_ir_val, platform_list, is_async)

    # Attach source map to the compiled function if present
    cdef uintptr_t sm_compiled_ptr
    cdef _eastc.EastCompiledFn* sm_cfn
    if source_map != NULL:
        try:
            handle = result._eastc_handle
            sm_compiled_ptr = handle._compiled
            sm_cfn = <_eastc.EastCompiledFn*>sm_compiled_ptr
            if sm_cfn != NULL:
                sm_cfn.source_map = source_map
                _eastc.east_set_source_map(source_map)
            else:
                _eastc.east_source_map_free(source_map)
                free(source_map)
        except Exception:
            _eastc.east_source_map_free(source_map)
            free(source_map)

    return result


# ─── Compile from BEAST2 (fast path — no Python round-trip) ──────────────

cpdef object compile_eastc_from_beast2(bytes beast2_data, list platform_list, bint is_async):
    """Compile East IR from BEAST2 bytes with header — no Python IR round-trip.

    Uses east_beast2_decode_ir for combined decode+convert with O(1) type
    resolution via the beast2 type table. Extracts source map from the blob
    and attaches it to the compiled function (mirrors compile_eastc_from_json).
    """
    _ensure_runtime()

    cdef _eastc.EastValue* c_ir_val = NULL
    cdef _eastc.EastSourceMap* source_map = NULL
    cdef _eastc.IRNode* ir_node = _eastc.east_beast2_decode_ir(
        <const uint8_t*><char*>beast2_data, len(beast2_data), &c_ir_val, &source_map)
    if ir_node == NULL:
        if c_ir_val != NULL:
            _eastc.east_value_release(c_ir_val)
        if source_map != NULL:
            _eastc.east_source_map_free(source_map)
            free(source_map)
        raise RuntimeError("east_beast2_decode_ir failed for IR")

    cdef object result = _compile_from_ir_node(ir_node, c_ir_val, platform_list, is_async)

    # Attach source map to the compiled function if present
    cdef uintptr_t sm_compiled_ptr
    cdef _eastc.EastCompiledFn* sm_cfn
    if source_map != NULL:
        try:
            handle = result._eastc_handle
            sm_compiled_ptr = handle._compiled
            sm_cfn = <_eastc.EastCompiledFn*>sm_compiled_ptr
            if sm_cfn != NULL:
                sm_cfn.source_map = source_map
                _eastc.east_set_source_map(source_map)
            else:
                _eastc.east_source_map_free(source_map)
                free(source_map)
        except Exception:
            _eastc.east_source_map_free(source_map)
            free(source_map)

    return result


# ─── Compile from East text (fast path — no Python round-trip) ───────────

cpdef object compile_eastc_from_east(str east_text, list platform_list, bint is_async):
    """Compile East IR from East text format — no Python IR round-trip."""
    _ensure_runtime()

    cdef _eastc.EastType* ir_type = _eastc.east_ir_type
    cdef bytes text_bytes = east_text.encode("utf-8")

    cdef _eastc.EastValue* c_ir_val = _eastc.east_parse_value(
        <const char*>text_bytes, ir_type)
    if c_ir_val == NULL:
        raise RuntimeError("east_parse_value failed for IR")

    return _compile_from_c_ir_val(c_ir_val, platform_list, is_async)


cdef object _make_callable(_eastc.EastCompiledFn* compiled,
                            _eastc.PlatformRegistry* platform,
                            _eastc.EastValue* c_ir_val,
                            object py_ir):
    """Build a Python callable that invokes east_call on the compiled fn.

    Captures C pointers as uintptr_t in closure. The callable's __del__
    releases all C resources.
    """
    # Get the function type for arg/result conversion
    cdef _eastc.EastType* fn_type = compiled.ir.type
    if fn_type == NULL:
        raise RuntimeError("Compiled function has no type")

    # Resolve through recursive wrapper
    if fn_type.kind == _eastc.EAST_TYPE_RECURSIVE:
        fn_type = fn_type.data.recursive.node

    cdef bint is_async_fn = (fn_type.kind == _eastc.EAST_TYPE_ASYNC_FUNCTION)

    # Extract input/output types
    cdef size_t num_inputs = fn_type.data.function.num_inputs
    input_type_ptrs = []
    for i in range(num_inputs):
        _eastc.east_type_retain(fn_type.data.function.inputs[i])
        input_type_ptrs.append(<uintptr_t>fn_type.data.function.inputs[i])

    cdef _eastc.EastType* output_type = fn_type.data.function.output
    _eastc.east_type_retain(output_type)
    cdef uintptr_t output_type_ptr = <uintptr_t>output_type

    # Store pointers for the closure
    cdef uintptr_t compiled_ptr = <uintptr_t>compiled
    cdef uintptr_t platform_ptr = <uintptr_t>platform
    cdef uintptr_t ir_val_ptr = <uintptr_t>c_ir_val

    # Create a ref-tracking container to prevent premature release
    class _EastCFnHandle:
        """Reference holder for C resources. Released on garbage collection."""
        __slots__ = ("_compiled", "_platform", "_ir_val", "_input_types", "_output_type", "_released")

        def __init__(self):
            self._compiled = compiled_ptr
            self._platform = platform_ptr
            self._ir_val = ir_val_ptr
            self._input_types = list(input_type_ptrs)
            self._output_type = output_type_ptr
            self._released = False

        def get_input_types(self):
            """Return Python EastType objects for each input parameter."""
            from east._eastc_bridge import c_type_ptr_to_py_type
            return [c_type_ptr_to_py_type(ptr) for ptr in self._input_types]

        def get_output_type(self):
            """Return Python EastType for the return type."""
            from east._eastc_bridge import c_type_ptr_to_py_type
            return c_type_ptr_to_py_type(self._output_type)

        def __del__(self):
            if self._released:
                return
            self._released = True
            _release_handle(
                self._compiled, self._platform, self._ir_val,
                self._input_types, self._output_type)

    handle = _EastCFnHandle()

    if is_async_fn:
        async def eastc_fn_async(*args):
            # east-c's eval_ir is synchronous, so we call east_call directly.
            # Async platform callbacks are handled by _run_async in the
            # platform bridge which uses _set_running_loop(None) to allow
            # nested event loops.
            return _eastc_call(handle._compiled, handle._input_types,
                               handle._output_type, args)

        object.__setattr__(eastc_fn_async, EAST_IR_ATTR, py_ir)
        object.__setattr__(eastc_fn_async, EAST_CAPTURES_ATTR, {})
        object.__setattr__(eastc_fn_async, "_eastc_handle", handle)
        return eastc_fn_async
    else:
        def eastc_fn(*args):
            return _eastc_call(handle._compiled, handle._input_types,
                               handle._output_type, args)

        object.__setattr__(eastc_fn, EAST_IR_ATTR, py_ir)
        object.__setattr__(eastc_fn, EAST_CAPTURES_ATTR, {})
        object.__setattr__(eastc_fn, "_eastc_handle", handle)
        return eastc_fn


cdef object _make_callable_from_value(_eastc.EastValue* fn_val,
                                       _eastc.EastCompiledFn* wrapper,
                                       _eastc.PlatformRegistry* platform,
                                       _eastc.EastValue* c_ir_val,
                                       object py_ir,
                                       bint is_async_fn,
                                       _eastc.EastType* fn_type_raw):
    """Like _make_callable but owns a function value (which owns the closure).

    fn_type_raw is the Function/AsyncFunction type from the original IR node
    (wrapper->ir->type), NOT the closure body type.
    Also frees the wrapper (the outer compilation unit) on cleanup.
    """
    cdef _eastc.EastCompiledFn* compiled = fn_val.data.function.compiled

    # Use the function type from the original IR node
    cdef _eastc.EastType* fn_type = fn_type_raw
    if fn_type == NULL:
        raise RuntimeError("Function IR node has no type")

    if fn_type.kind == _eastc.EAST_TYPE_RECURSIVE:
        fn_type = fn_type.data.recursive.node

    cdef size_t num_inputs = fn_type.data.function.num_inputs
    input_type_ptrs = []
    for i in range(num_inputs):
        _eastc.east_type_retain(fn_type.data.function.inputs[i])
        input_type_ptrs.append(<uintptr_t>fn_type.data.function.inputs[i])

    cdef _eastc.EastType* output_type = fn_type.data.function.output
    _eastc.east_type_retain(output_type)
    cdef uintptr_t output_type_ptr = <uintptr_t>output_type

    cdef uintptr_t compiled_ptr = <uintptr_t>compiled
    cdef uintptr_t fn_val_ptr = <uintptr_t>fn_val
    cdef uintptr_t wrapper_ptr = <uintptr_t>wrapper
    cdef uintptr_t platform_ptr = <uintptr_t>platform
    cdef uintptr_t ir_val_ptr = <uintptr_t>c_ir_val

    class _EastCFnHandle2:
        __slots__ = ("_compiled", "_fn_val", "_wrapper", "_platform", "_ir_val",
                     "_input_types", "_output_type", "_released")

        def __init__(self):
            self._compiled = compiled_ptr
            self._fn_val = fn_val_ptr
            self._wrapper = wrapper_ptr
            self._platform = platform_ptr
            self._ir_val = ir_val_ptr
            self._input_types = list(input_type_ptrs)
            self._output_type = output_type_ptr
            self._released = False

        def get_input_types(self):
            from east._eastc_bridge import c_type_ptr_to_py_type
            return [c_type_ptr_to_py_type(ptr) for ptr in self._input_types]

        def get_output_type(self):
            from east._eastc_bridge import c_type_ptr_to_py_type
            return c_type_ptr_to_py_type(self._output_type)

        def __del__(self):
            if self._released:
                return
            self._released = True
            # Release function value (which owns the closure)
            _proxy_value_release(self._fn_val)
            # Free the wrapper compilation unit
            _free_compiled(self._wrapper)
            # Free platform and IR
            _free_platform(self._platform)
            _proxy_value_release(self._ir_val)
            for ptr in self._input_types:
                _proxy_type_release(ptr)
            _proxy_type_release(self._output_type)

    handle = _EastCFnHandle2()

    if is_async_fn:
        async def eastc_fn_async(*args):
            # east-c's eval_ir is synchronous, so we call east_call directly.
            # Async platform callbacks are handled by _run_async in the
            # platform bridge which uses _set_running_loop(None) to allow
            # nested event loops.
            return _eastc_call(handle._compiled, handle._input_types,
                               handle._output_type, args)

        object.__setattr__(eastc_fn_async, EAST_IR_ATTR, py_ir)
        object.__setattr__(eastc_fn_async, EAST_CAPTURES_ATTR, {})
        object.__setattr__(eastc_fn_async, "_eastc_handle", handle)
        return eastc_fn_async
    else:
        def eastc_fn(*args):
            return _eastc_call(handle._compiled, handle._input_types,
                               handle._output_type, args)

        object.__setattr__(eastc_fn, EAST_IR_ATTR, py_ir)
        object.__setattr__(eastc_fn, EAST_CAPTURES_ATTR, {})
        object.__setattr__(eastc_fn, "_eastc_handle", handle)
        return eastc_fn


def _invoke_c_function_py(uintptr_t val_ptr, list input_type_ptrs, uintptr_t output_type_ptr, tuple args):
    """Call a C function value via east_call. Must be in _compiler_eastc.so
    so it shares the same _Thread_local g_builtin_error as the registered builtins."""
    cdef _eastc.EastValue *c_fn = <_eastc.EastValue*>val_ptr
    cdef _eastc.EastCompiledFn *compiled = c_fn.data.function.compiled
    cdef size_t nargs = len(args)
    cdef _eastc.EastValue *stack_args[8]
    cdef _eastc.EastValue **c_args = NULL
    cdef size_t i, n_types = len(input_type_ptrs)
    cdef _eastc.EvalResult result
    cdef _eastc.EastType* out_type
    cdef bint heap_allocated = False

    if nargs > 0:
        if nargs <= 8:
            c_args = stack_args
        else:
            c_args = <_eastc.EastValue**>malloc(nargs * sizeof(_eastc.EastValue*))
            if c_args == NULL:
                raise MemoryError()
            heap_allocated = True
        try:
            for i in range(nargs):
                if i < n_types and <uintptr_t>input_type_ptrs[i] != 0:
                    c_args[i] = py_value_to_c(args[i], <_eastc.EastType*><uintptr_t>input_type_ptrs[i])
                else:
                    c_args[i] = _eastc.east_null()
        except:
            for j in range(i):
                _eastc.east_value_release(c_args[j])
            if heap_allocated:
                free(c_args)
            raise

    result = _eastc.east_call(compiled, c_args, nargs)

    if c_args != NULL:
        for i in range(nargs):
            _eastc.east_value_release(c_args[i])
        if heap_allocated:
            free(c_args)

    if result.status != _eastc.EVAL_OK and result.status != _eastc.EVAL_RETURN:
        msg = "east_call failed"
        if result.error_message != NULL:
            msg = result.error_message.decode("utf-8")
        if result.value != NULL:
            _eastc.east_value_release(result.value)
        from east.runtime.errors import EastError
        from east.types.values import EastArray, EastVariant
        raise EastError(msg, EastArray(EastVariant("Null", None)))

    if result.value == NULL:
        return None
    out_type = <_eastc.EastType*>output_type_ptr
    if out_type == NULL:
        out_type = &_eastc.east_null_type
    py_result = c_value_to_py(result.value, out_type)
    _eastc.east_value_release(result.value)
    return py_result


def _proxy_value_release(uintptr_t ptr):
    if ptr != 0:
        _eastc.east_value_release(<_eastc.EastValue*>ptr)

def _proxy_type_release(uintptr_t ptr):
    if ptr != 0:
        _eastc.east_type_release(<_eastc.EastType*>ptr)

def _free_compiled(uintptr_t ptr):
    if ptr != 0:
        _eastc.east_compiled_fn_free(<_eastc.EastCompiledFn*>ptr)

def _free_platform(uintptr_t ptr):
    if ptr != 0:
        _eastc.platform_registry_free(<_eastc.PlatformRegistry*>ptr)


cpdef object _eastc_call(uintptr_t compiled_ptr, list input_type_ptrs,
                          uintptr_t output_type_ptr, tuple args):
    """Convert args, call east_call, convert result."""
    cdef _eastc.EastCompiledFn* compiled = <_eastc.EastCompiledFn*>compiled_ptr
    cdef size_t nargs = len(args)
    cdef _eastc.EastValue *stack_args[8]
    cdef _eastc.EastValue** c_args = NULL
    cdef size_t i, n_types = len(input_type_ptrs)
    cdef _eastc.EvalResult result
    cdef _eastc.EastType* out_type
    cdef bint heap_allocated = False

    if nargs > 0:
        if nargs <= 8:
            c_args = stack_args
        else:
            c_args = <_eastc.EastValue**>malloc(nargs * sizeof(_eastc.EastValue*))
            if c_args == NULL:
                raise MemoryError()
            heap_allocated = True
        try:
            for i in range(nargs):
                if i < n_types:
                    c_args[i] = py_value_to_c(args[i], <_eastc.EastType*><uintptr_t>input_type_ptrs[i])
                else:
                    c_args[i] = _eastc.east_null()
        except:
            for j in range(i):
                _eastc.east_value_release(c_args[j])
            if heap_allocated:
                free(c_args)
            raise

    result = _eastc.east_call(compiled, c_args, nargs)

    # Release argument C values
    if c_args != NULL:
        for i in range(nargs):
            _eastc.east_value_release(c_args[i])
        if heap_allocated:
            free(c_args)

    if result.status == _eastc.EVAL_OK or result.status == _eastc.EVAL_RETURN:
        # Success — convert result to Python
        if result.value == NULL:
            return None
        out_type = <_eastc.EastType*>output_type_ptr
        if out_type == NULL:
            # No declared output type — use null type as fallback
            out_type = &_eastc.east_null_type
        py_result = c_value_to_py(result.value, out_type)
        _eastc.east_value_release(result.value)
        return py_result

    # Error — raise EastError with location info
    msg = "east_call failed"
    if result.error_message != NULL:
        msg = result.error_message.decode("utf-8")

    # Build location array for EastError
    from east.runtime.errors import EastError
    from east.types.values import EastArray, EastStruct, EastVariant

    locations = []
    if result.num_locations > 0 and result.locations != NULL:
        for i in range(result.num_locations):
            loc = result.locations[i]
            filename = loc.filename.decode("utf-8") if loc.filename != NULL else "<unknown>"
            locations.append(EastStruct({
                "filename": filename,
                "line": loc.line,
                "column": loc.column,
            }))

    location_array = EastArray(
        EastVariant("Struct", None),  # element type placeholder
        locations if locations else [],
    )

    if result.value != NULL:
        _eastc.east_value_release(result.value)

    raise EastError(msg, location_array)


def _release_handle(uintptr_t compiled_ptr, uintptr_t platform_ptr,
                     uintptr_t ir_val_ptr, list input_type_ptrs,
                     uintptr_t output_type_ptr):
    """Release C resources held by a compiled function handle."""
    if compiled_ptr != 0:
        _eastc.east_compiled_fn_free(<_eastc.EastCompiledFn*>compiled_ptr)
    if platform_ptr != 0:
        _eastc.platform_registry_free(<_eastc.PlatformRegistry*>platform_ptr)
    if ir_val_ptr != 0:
        _eastc.east_value_release(<_eastc.EastValue*>ir_val_ptr)
    for ptr in input_type_ptrs:
        _eastc.east_type_release(<_eastc.EastType*><uintptr_t>ptr)
    if output_type_ptr != 0:
        _eastc.east_type_release(<_eastc.EastType*>output_type_ptr)
