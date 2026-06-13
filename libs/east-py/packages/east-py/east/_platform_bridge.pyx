# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
# eastc: true
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Platform function bridge: enables east-c to call Python platform functions.

Uses the same trampoline pattern as east-c's WASM bridge (wasm_api.c):
1. A pre_call hook stores the platform function name before each invocation
2. A single shared C callback dispatches to the correct Python function
3. Generic platform functions are specialized lazily on first call

The pre_call hook is set on the PlatformRegistry via inline C (since the
struct is declared opaque in _eastc.pxd to break a circular dependency).
"""

from cpython.ref cimport PyObject, Py_INCREF, Py_DECREF
from cpython.tuple cimport PyTuple_New, PyTuple_SET_ITEM
from libc.stddef cimport size_t
from libc.stdint cimport int64_t, uint8_t, uintptr_t
from libc.stdlib cimport malloc, free
from libc.string cimport strdup

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py, py_value_to_c, _c_type_tag_to_py_type

import asyncio

# ─── Inline C for accessing PlatformRegistry.pre_call ─────────────────────
# PlatformRegistry is opaque in _eastc.pxd, so we use inline C to set the
# pre_call hook field.

cdef extern from *:
    """
    #include "east/platform.h"

    static void _set_pre_call_hook(PlatformRegistry *reg,
                                   void (*hook)(PlatformRegistry*, const char*,
                                                EastType**, size_t)) {
        reg->pre_call = hook;
    }
    static void _set_on_free_hook(PlatformRegistry *reg,
                                  void (*hook)(PlatformRegistry*)) {
        reg->on_free = hook;
    }
    """
    void _set_pre_call_hook(_eastc.PlatformRegistry *reg,
                            void (*hook)(_eastc.PlatformRegistry*, const char*,
                                         _eastc.EastType**, size_t))
    void _set_on_free_hook(_eastc.PlatformRegistry *reg,
                           void (*hook)(_eastc.PlatformRegistry*))


# ─── Module-level state ──────────────────────────────────────────────────

# Per-registry dispatch state, keyed by PlatformRegistry pointer:
#   <uintptr_t>reg → (fns, generic_factories, specialized_cache, platform_list)
# where fns:        name → (py_fn, is_async)
#       factories:  name → (py_factory_fn, is_async)
#       specialized_cache: (name, type_param_ptr_tuple) → py_fn
#
# Each compile gets its own registry, so registering platform functions for
# a new program must not clobber dispatch for previously compiled ones.
# Entries are dropped by the registry's on_free hook, giving the Python-side
# state exactly the registry's lifetime (closures retain the registry, so
# dispatch keeps working as long as any compiled function is alive).
cdef dict _registry_state = {}

# Context set by pre_call hook before each platform function invocation
cdef _eastc.PlatformRegistry* _current_reg = NULL
cdef const char* _current_name = NULL
cdef _eastc.EastType** _current_type_params = NULL
cdef size_t _current_num_type_params = 0


cdef object _wrap_c_function_for_python(_eastc.EastValue *val):
    """Wrap a C function value as a Python callable.

    Extracts input/output types from the compiled function's fn_type field
    so that args and results are properly converted at the Python boundary.

    Delegates actual east_call to _compiler_eastc.so to avoid _Thread_local
    mismatch (each .so has its own copy of static thread-locals like
    g_builtin_error from the statically-linked libeast-c.a).
    """
    _eastc.east_value_retain(val)
    cdef _eastc.EastCompiledFn *compiled = val.data.function.compiled
    cdef _eastc.EastType *fn_type = compiled.fn_type

    py_val_ptr = <uintptr_t>val
    py_input_type_ptrs = []
    py_output_type_ptr = <uintptr_t>0

    if fn_type != NULL and (fn_type.kind == _eastc.EAST_TYPE_FUNCTION or
                             fn_type.kind == _eastc.EAST_TYPE_ASYNC_FUNCTION):
        for i in range(fn_type.data.function.num_inputs):
            py_input_type_ptrs.append(<uintptr_t>fn_type.data.function.inputs[i])
        py_output_type_ptr = <uintptr_t>fn_type.data.function.output

    from east.runtime._compiler_eastc import _invoke_c_function_py as _invoke

    def call_c_fn(*args):
        return _invoke(py_val_ptr, py_input_type_ptrs, py_output_type_ptr, args)

    return call_c_fn


# ─── Pre-call hook ───────────────────────────────────────────────────────

cdef void _pre_call_hook(_eastc.PlatformRegistry *reg,
                         const char *name,
                         _eastc.EastType **type_params,
                         size_t num_type_params) noexcept nogil:
    """Called by east-c just before each platform function invocation.

    Stores the registry, function name, and type params so the shared
    callback knows which Python function to dispatch to and how to convert
    the result.
    """
    global _current_reg, _current_name, _current_type_params, _current_num_type_params
    _current_reg = reg
    _current_name = name
    _current_type_params = type_params
    _current_num_type_params = num_type_params


cdef void _on_free_hook(_eastc.PlatformRegistry *reg) noexcept with gil:
    """Called by platform_registry_free — drop this registry's dispatch state."""
    _registry_state.pop(<uintptr_t>reg, None)


# ─── Shared C callback ──────────────────────────────────────────────────

cdef _eastc.EvalResult _python_platform_fn(_eastc.EastValue **args,
                                            size_t num_args,
                                            _eastc.EastType **input_types,
                                            size_t num_input_types,
                                            _eastc.EastType *output_type) noexcept with gil:
    """Shared C callback for all Python platform functions.

    The pre_call hook has already set _current_name so we know which
    Python function to call.
    """
    cdef _eastc.EvalResult err_result
    cdef _eastc.EastValue *c_result
    cdef bytes name_bytes

    err_result.status = _eastc.EVAL_ERROR
    err_result.value = NULL
    err_result.label = NULL
    err_result.error_message = NULL
    err_result.locations = NULL
    err_result.num_locations = 0

    try:
        name_bytes = _current_name
        py_fn = None
        is_async = False

        state = _registry_state.get(<uintptr_t>_current_reg)
        if state is None:
            err_result.error_message = strdup(
                b"Platform registry has no Python dispatch state: " + name_bytes)
            return err_result

        entry = (<dict>state[0]).get(name_bytes)
        if entry is not None:
            py_fn = entry[0]
            is_async = entry[1]
        elif name_bytes in <dict>state[1]:
            py_fn = _specialize_generic(state, name_bytes)
            is_async = (<dict>state[1])[name_bytes][1]
        else:
            err_result.error_message = strdup(
                b"Platform function not found: " + name_bytes)
            return err_result

        # Convert C args to Python using declared input types
        py_args = PyTuple_New(num_args)
        for i in range(num_args):
            if i < num_input_types and input_types[i] != NULL:
                val = c_value_to_py(args[i], input_types[i])
            else:
                val = c_value_to_py(args[i], &_eastc.east_null_type)
            Py_INCREF(val)
            PyTuple_SET_ITEM(py_args, i, val)

        # Call the Python function
        result = py_fn(*py_args)

        # Handle async results — only check for async platform functions
        if is_async and asyncio.iscoroutine(result):
            result = _run_async(result)

        # Convert result back to C using the output type from the IR node
        if result is None:
            c_result = _eastc.east_null()
        else:
            c_result = py_value_to_c(result, output_type)

        return _eastc.eval_ok(c_result)

    except BaseException as e:
        # Must catch BaseException: this trampoline is `noexcept` returning a
        # struct, so a KeyboardInterrupt/SystemExit escaping here would hand
        # east-c an uninitialized EvalResult (garbage status/value pointer).
        msg = str(e).encode("utf-8")
        err_result.error_message = strdup(<const char*>msg)
        return err_result


cdef object _specialize_generic(tuple state, bytes name):
    """Lazily specialize a generic platform function using current type params."""
    cdef dict factories = <dict>state[1]
    cdef dict specialized_cache = <dict>state[2]
    # Cache key from C type pointers — avoids expensive type-to-Python conversion
    cdef tuple ptr_key = tuple(
        <uintptr_t>_current_type_params[i]
        for i in range(_current_num_type_params)
    )
    cache_key = (name, ptr_key)
    cached = specialized_cache.get(cache_key)
    if cached is not None:
        return cached

    # Only convert types to Python when actually calling the factory
    py_type_params = [
        _c_type_tag_to_py_type(_current_type_params[i])
        for i in range(_current_num_type_params)
    ]

    factory_entry = factories[name]
    py_factory = factory_entry[0]
    specialized = py_factory(state[3], *py_type_params)
    specialized_cache[cache_key] = specialized
    return specialized


cdef object _platform_loop = None

cdef object _run_async(object coro):
    """Run an async coroutine synchronously on a persistent event loop.

    Uses a single event loop that persists across calls, so async resources
    (database connections, etc.) remain valid between platform function calls.
    """
    global _platform_loop
    if _platform_loop is None or _platform_loop.is_closed():
        _platform_loop = asyncio.new_event_loop()
    return _platform_loop.run_until_complete(coro)


# ─── Shared generic factory callback ─────────────────────────────────────

cdef _eastc.PlatformFn _python_generic_factory(
        _eastc.EastType **type_params, size_t num_type_params) noexcept with gil:
    """Shared GenericPlatformFactory callback.

    Returns the shared platform callback. Actual specialization is done
    lazily in _python_platform_fn using pre_call context.
    """
    return _python_platform_fn


# ─── PyCapsule support for C-level platform functions ─────────────────────
# Packages (east-py-std, east-py-datascience, etc.) can provide Cython-level
# platform function implementations by wrapping C function pointers in
# PyCapsule objects. The bridge detects the "c_callback" or "c_factory" key
# and registers the C function directly with east-c, bypassing Python dispatch.
#
# Usage in a .pyx file:
#   from cpython.pycapsule cimport PyCapsule_New
#   cdef EvalResult my_impl(EastValue **args, size_t n) noexcept with gil: ...
#   capsule = PyCapsule_New(<void*>my_impl, "east_platform_fn", NULL)
#
# Then in the PlatformFunction dict:
#   PlatformFunction(name="my_fn", ..., c_callback=capsule)
#
# For generic platform functions:
#   cdef PlatformFn my_factory(EastType **tp, size_t n) noexcept with gil: ...
#   capsule = PyCapsule_New(<void*>my_factory, "east_generic_factory", NULL)
#   GenericPlatformFunction(name="my_fn", ..., c_factory=capsule)

from cpython.pycapsule cimport PyCapsule_GetPointer


# ─── Public API ──────────────────────────────────────────────────────────

cdef void register_platform_functions(_eastc.PlatformRegistry *reg,
                                       list platform_list) except *:
    """Register Python platform functions in a C PlatformRegistry.

    Iterates over PlatformFunction/GenericPlatformFunction dicts and registers
    each in both the Python dispatch table and the C PlatformRegistry.
    """
    # Fresh dispatch state for THIS registry only — previously compiled
    # programs keep their own entries (keyed by registry pointer).
    cdef dict fns = {}
    cdef dict factories = {}
    _registry_state[<uintptr_t>reg] = (fns, factories, {}, platform_list)

    # Hooks: dispatch context before each call, state drop on registry free
    _set_pre_call_hook(reg, _pre_call_hook)
    _set_on_free_hook(reg, _on_free_hook)

    for pf in platform_list:
        name = pf["name"]
        name_bytes = name.encode("utf-8")
        is_async = pf.get("type", "sync") == "async"

        if "type_parameters" in pf:
            # Generic platform function
            c_factory = pf.get("c_factory")
            if c_factory is not None:
                # C-level generic factory via PyCapsule — bypass Python dispatch
                _eastc.platform_registry_add_generic(
                    reg,
                    strdup(<const char*>name_bytes),
                    <_eastc.GenericPlatformFactory>PyCapsule_GetPointer(c_factory, "east_generic_factory"),
                    <bint>is_async,
                )
            else:
                factories[name_bytes] = (pf["fn"], is_async)
                _eastc.platform_registry_add_generic(
                    reg,
                    strdup(<const char*>name_bytes),
                    _python_generic_factory,
                    <bint>is_async,
                )
        else:
            # Non-generic platform function
            c_callback = pf.get("c_callback")
            if c_callback is not None:
                # C-level callback via PyCapsule — bypass Python dispatch
                _eastc.platform_registry_add(
                    reg,
                    strdup(<const char*>name_bytes),
                    <_eastc.PlatformFn>PyCapsule_GetPointer(c_callback, "east_platform_fn"),
                    <bint>is_async,
                )
            else:
                fns[name_bytes] = (pf["fn"], is_async)
                _eastc.platform_registry_add(
                    reg,
                    strdup(<const char*>name_bytes),
                    _python_platform_fn,
                    <bint>is_async,
                )


def clear_platform_state():
    """Clear all platform function state. For testing."""
    _registry_state.clear()
