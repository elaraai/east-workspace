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

from cpython.ref cimport PyObject, Py_INCREF, Py_XDECREF
from libc.stddef cimport size_t
from libc.stdint cimport int64_t, uint8_t, uintptr_t
from libc.stdlib cimport malloc, calloc, free
from libc.string cimport memcpy, strdup

from east cimport _eastc
from east._eastc_bridge cimport py_type_to_c, c_value_to_py, py_value_to_c, _c_type_tag_to_py_type
from east._platform_bridge cimport register_platform_functions

import asyncio

from east.runtime.errors import EastError, NonRetraceableCallError

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


# ─── Eager-path observability ─────────────────────────────────────────────
#
# How eager-method callbacks actually executed, read via
# east.runtime.compiler.eager_stats(). Under the strict surface (#625) an
# eager callback is built into a native East function or refused — there is
# no per-element python path to count — so the counters measure what CAN
# still vary: whether a precompiled function value rode straight in
# (function_direct), how many values crossed C→python (c_to_py_decodes, kept
# in the bridge), and the beast2_* column-projection counters (#599): an
# inferred optimisation that silently stops applying is an invisible
# performance cliff, so every segment decode in the compute family counts as
# projected or whole, and every declined inference counts with its reason
# (a callback that cannot build, the element escaping whole, a compiled
# function with no source to rebuild, an unpageable blob, or a per-segment
# alias fallback).
_eager_counters = {
    "function_direct": 0,
    "beast2_segments_projected": 0, "beast2_segments_whole": 0,
    "beast2_projection_declined_untraceable": 0,
    "beast2_projection_declined_escape": 0,
    "beast2_projection_declined_function": 0,
    "beast2_projection_declined_unpageable": 0,
    "beast2_projection_declined_shape": 0,
    "beast2_projection_alias_fallback": 0,
}


def _eager_counters_snapshot():
    cdef size_t loop_projected = 0
    cdef size_t loop_whole = 0
    snap = dict(_eager_counters)
    # The C→py decode counter lives in the bridge (a cdef long on the decode
    # hot path); surface it through the same single stats API.
    from east._eastc_bridge import decode_stats

    snap["c_to_py_decodes"] = decode_stats()
    # The compiled-body paged-loop projection counters (#599 task inputs)
    # live thread-local in east-c; same single stats API.
    _eastc.east_beast2_paged_loop_stats(&loop_projected, &loop_whole)
    snap["beast2_paged_loop_segments_projected"] = loop_projected
    snap["beast2_paged_loop_segments_whole"] = loop_whole
    return snap


# ─── Compiled East functions as eager callbacks (#409) ────────────────────────
#
# A callback that is ALREADY a compiled East function (east.expression /
# compile_from_* / .bind) carries its native function value on its
# handle — re-capturing it can only fail (its python body is the bridge
# closure), so it would raise where the value is usable as it stands.
# Use the function value directly. When the builtin's callback signature
# passes more arguments than the function takes (ArrayMap invokes (element,
# index); an East.function([RowT], …) takes one), a pure-C prefix adapter
# forwards only the function's arity — the same east_foreign_function seam as
# bind.

cdef struct _ArityData:
    _eastc.EastValue* inner_fn
    size_t n_keep


cdef _eastc.EvalResult _arity_invoke(_eastc.EastCompiledFn* self,
                                     _eastc.EastValue** args, size_t n) noexcept:
    """Forward the first n_keep arguments to the inner compiled function."""
    cdef _ArityData* ad = <_ArityData*>self.invoke_userdata
    cdef size_t n_pass = ad.n_keep if n > ad.n_keep else n
    return _eastc.east_call(ad.inner_fn.data.function.compiled, args, n_pass)


cdef void _arity_release(void* ud) noexcept:
    cdef _ArityData* ad = <_ArityData*>ud
    if ad == NULL:
        return
    if ad.inner_fn != NULL:
        _eastc.east_value_release(ad.inner_fn)
    free(ad)


cdef object _adapt_function_arity(object function_callable, size_t n_keep):
    """Wrap a compiled function in a C-level prefix adapter of arity n_keep.

    Returns a tiny holder carrying the adapter's retained function value in
    ``_eastc_handle._fn_val`` shape, or None on allocation failure.
    """
    cdef uintptr_t inner_ptr = _native_fn_val_ptr(function_callable)
    if inner_ptr == 0:
        return None
    cdef _ArityData* ad = <_ArityData*>malloc(sizeof(_ArityData))
    if ad == NULL:
        return None
    ad.n_keep = n_keep
    ad.inner_fn = <_eastc.EastValue*>inner_ptr
    _eastc.east_value_retain(ad.inner_fn)
    cdef _eastc.EastValue* fv = _eastc.east_foreign_function(
        <_eastc.EastInvokeFn>_arity_invoke, <void*>ad, _arity_release, NULL
    )
    if fv == NULL:
        # east_foreign_function released ad on allocation failure.
        return None
    cdef uintptr_t fv_ptr = <uintptr_t>fv

    class _ArityHandle:
        __slots__ = ("_fn_val", "_released")

        def __init__(self):
            self._fn_val = fv_ptr
            self._released = False

        def __del__(self):
            if self._released:
                return
            self._released = True
            _proxy_value_release(self._fn_val)

    class _AdaptedFunction:
        __slots__ = ("_eastc_handle", "_inner")

        def __init__(self):
            self._eastc_handle = _ArityHandle()
            self._inner = function_callable  # keep the inner function alive

    return _AdaptedFunction()


cdef object _native_function_for(object east_fn):
    """The directly-usable native form of an EastFunction whose ``.fn`` is a
    compiled East function, or None when it is not one (or cannot be used).

    Verifies the function's declared signature against the callback's — output
    AND the input prefix it will receive: the function reads its arguments raw
    with no per-element conversion, so a mismatch on either side would read
    or write values as the wrong type (#467). A mismatch declines the native
    pass-through, and the capture then re-traces the callback against the
    signature it will actually receive and raises what is wrong with it
    (#625). Prefix-adapts arity when the callback signature passes more
    arguments than the function takes. Eager methods that wrap the user
    callback tag the wrapper with the underlying function via ``_east_function``
    (collections._mark_function) — resolve through it.
    """
    cdef _eastc.EastType* want_in
    cdef bint in_matched
    fn = getattr(east_fn.fn, "_east_function", None)
    if fn is None:
        fn = east_fn.fn
    cdef uintptr_t fn_ptr = _native_fn_val_ptr(fn)
    if fn_ptr == 0:
        return None
    try:
        handle = fn._eastc_handle
        input_ptrs = list(handle._input_types)
        n_function = len(input_ptrs)
        function_out = handle.get_output_type()
    except BaseException:
        return None
    if function_out != east_fn.output_type:
        return None
    n_declared = len(east_fn.input_types)
    if n_function > n_declared:
        return None
    for j in range(n_function):
        want_in = py_type_to_c(east_fn.input_types[j])
        in_matched = _eastc.east_type_equal(
            <_eastc.EastType*><uintptr_t>input_ptrs[j], want_in)
        _eastc.east_type_release(want_in)
        if not in_matched:
            return None
    if n_function == n_declared:
        _eager_counters["function_direct"] += 1
        return fn
    adapted = _adapt_function_arity(fn, <size_t>n_function)
    if adapted is not None:
        _eager_counters["function_direct"] += 1
    return adapted


def native_function_for(object east_fn):
    """Python-visible ``_native_function_for`` (used by ``capture_callback``, #470).

    Resolves a compiled East function from the callback — directly or via its
    ``_east_function`` mark — with the same declared-signature checks (#467)
    and arity adaptation as the eager-callback path, so the mark means one
    thing to every consumer. Returns the native callable or None.
    """
    return _native_function_for(east_fn)


def hold_function_value(uintptr_t fn_val_ptr):
    """Retain an EAST_VAL_FUNCTION pointer as a bindable hold (#561).

    The Call-lowering path records a traced call's callee by its C function
    value; the returned hold carries ``_east_c_handle``, which the
    Function-typed conversion fast-path (``_py_function_to_c``) passes
    straight through at bind time. Released when the hold is collected.
    """
    cdef _eastc.EastValue* fv = <_eastc.EastValue*>fn_val_ptr
    if fv == NULL or fv.kind != _eastc.EAST_VAL_FUNCTION:
        raise ValueError("hold_function_value: not a function value")
    _eastc.east_value_retain(fv)

    class _FnValueHold:
        __slots__ = ("_east_c_handle", "_released")

        def __init__(self):
            self._east_c_handle = fn_val_ptr
            self._released = False

        def __del__(self):
            if self._released:
                return
            self._released = True
            _proxy_value_release(self._east_c_handle)

    return _FnValueHold()


def _try_lower_call(object handle, tuple args):
    """Lower a proxy-argument call on a compiled function to traced Call IR.

    The cold path behind a wrapper's ``NonRetraceableCallError``: asked
    before re-raising, so a traced lambda calling this function splices a
    native Call instead of failing (#561). Returns the traced expression or
    None (no active trace / a shape lowering declines).
    """
    from east.expression import _lower_compiled_call
    return _lower_compiled_call(getattr(handle, "_fn_val", 0), handle._input_types,
                                handle._output_type, args)


def frozen_hold_to_py(object hold, object east_type):
    """Decode a ``freeze_value``/``load_frozen_value`` hold into the
    python-side value — frozen containers come back as branded zero-copy
    proxies, so mutation refuses exactly as a frozen task input does."""
    cdef uintptr_t ptr = <uintptr_t>getattr(hold, "_east_c_value", 0)
    if ptr == 0:
        raise TypeError("frozen_hold_to_py: not a frozen value hold")
    cdef bint own_type = False
    cdef _eastc.EastType* c_t = _resolve_c_type(east_type, &own_type)
    try:
        return c_value_to_py(<_eastc.EastValue*>ptr, c_t)
    finally:
        if own_type:
            _eastc.east_type_release(c_t)


def read_closure_capture(object fn_callable, str name, object east_type):
    """A captured variable's CURRENT value, read from a compiled closure's
    captures env.

    east-c's ``Assign`` writes the env where the variable is DEFINED, so a
    callback that rebinds a captured variable accumulates in the closure's
    captures env across per-element invocations. The compliance replay runs
    the ENCLOSING scope in python, so after such a callback executes natively
    it folds the rebound slot back into its interpreter environment (#625).
    ``east_type`` is a Python EastType or a raw ``EastType*`` pointer.
    """
    cdef uintptr_t compiled_ptr = <uintptr_t>getattr(
        fn_callable._eastc_handle, "_compiled", 0)
    cdef _eastc.EastCompiledFn* cfn = <_eastc.EastCompiledFn*>compiled_ptr
    if cfn == NULL or cfn.captures == NULL:
        raise KeyError(name)
    cdef bytes bname = name.encode("utf-8")
    cdef _eastc.EastValue* v = _eastc.env_get(cfn.captures, <const char*>bname)
    if v == NULL:
        raise KeyError(name)
    cdef bint own_type = False
    cdef _eastc.EastType* c_t = _resolve_c_type(east_type, &own_type)
    try:
        return c_value_to_py(v, c_t)
    finally:
        if own_type:
            _eastc.east_type_release(c_t)


def compile_function_carrier(object carrier, object input_types, object output_type):
    """Build a native callable from a function CARRIER — a python callable
    with attached homoiconic IR (``_east_ir``) and live capture values
    (``_east_captures``, #476 E).

    The bridge constructs the closure with an identity-mapped captures env,
    so by-reference captures stay live (mutations visible) while the body
    executes natively — the strict surface's replacement for interpreting
    such callbacks per element in python (#625). The returned callable
    carries the ordinary ``_eastc_handle`` (with ``_fn_val``), so eager
    methods, ``_mark_function`` and the arity adapter treat it as any other
    compiled function.
    """
    _ensure_runtime()
    from east.types.types import FunctionType as _FnType
    fn_t = _FnType(list(input_types), output_type)
    cdef _eastc.EastType* c_t = py_type_to_c(fn_t)
    cdef _eastc.EastValue* fv
    try:
        fv = py_value_to_c(carrier, c_t)
    finally:
        _eastc.east_type_release(c_t)
    if fv == NULL or fv.kind != _eastc.EAST_VAL_FUNCTION:
        if fv != NULL:
            _eastc.east_value_release(fv)
        raise TypeError("compile_function_carrier: conversion did not yield a function value")
    cdef uintptr_t fv_ptr = <uintptr_t>fv
    cdef uintptr_t compiled_ptr = <uintptr_t>fv.data.function.compiled
    in_ptrs = []
    for t in input_types:
        in_ptrs.append(<uintptr_t>py_type_to_c(t))
    cdef uintptr_t out_ptr = <uintptr_t>py_type_to_c(output_type)

    class _CarrierHandle:
        __slots__ = ("_compiled", "_fn_val", "_input_types", "_output_type", "_released")

        def __init__(self):
            self._compiled = compiled_ptr
            self._fn_val = fv_ptr
            self._input_types = list(in_ptrs)
            self._output_type = out_ptr
            self._released = False

        def get_input_types(self):
            from east._eastc_bridge import c_type_ptr_to_py_type as _to_py
            return [_to_py(ptr) for ptr in self._input_types]

        def get_output_type(self):
            from east._eastc_bridge import c_type_ptr_to_py_type as _to_py
            return _to_py(self._output_type)

        def __del__(self):
            if self._released:
                return
            self._released = True
            _proxy_value_release(self._fn_val)
            for ptr in self._input_types:
                _proxy_type_release(ptr)
            _proxy_type_release(self._output_type)

    carrier_handle = _CarrierHandle()

    def carrier_fn(*args):

        args = _without_block(args)
        try:
            return _eastc_call(carrier_handle._compiled, carrier_handle._input_types,
                               carrier_handle._output_type, args)
        except NonRetraceableCallError:
            # Called with trace proxies: lower to a native IR Call in the
            # surrounding trace instead of failing (#561).
            lowered = _try_lower_call(carrier_handle, args)
            if lowered is None:
                raise
            return lowered

    object.__setattr__(carrier_fn, "_eastc_handle", carrier_handle)
    # Keep the carrier (and so its live capture values) alive with the fn.
    object.__setattr__(carrier_fn, "_east_carrier_ref", carrier)

    def bind(*values):
        """Pre-bind further trailing parameters by reference (see bind_function)."""
        return bind_function(carrier_fn, values)

    object.__setattr__(carrier_fn, "bind", bind)
    return carrier_fn


cdef void _release_python_bytes(void* ctx, uint8_t* data, size_t length) noexcept with gil:
    """The paged value's release hook for python-owned bytes (#658/#661):
    ``ctx`` is the python object keeping the bytes alive (an mmap, a bytes),
    retained once at open — drop that reference now that the last reader of
    the bytes is gone. Fires on the refcount path and under the cycle
    collector alike, from whatever thread releases the value, hence the
    GIL — on a live interpreter, as for any Py_DECREF. The hook only drops
    a reference; it must never re-enter the runtime."""
    Py_XDECREF(<PyObject*>ctx)


def open_paged_value_view(object east_type, object buffer, bint frozen=False):
    """Open an indexed beast2 collection BUFFER as a lazy paged C value over
    the buffer's own bytes (#560) — no copy. The C value RETAINS ``buffer``
    (a mmap-owning file object's mapping, a ``bytes``) for its whole lifetime
    through the paged value's release hook (#658), so the bytes outlive every
    reader even when the python side drops its last reference — a platform
    function may return the hold and let the file object die (#661). An
    explicit ``mmap.close()`` is still the caller's responsibility to defer
    while readers exist (``Beast2File.close`` does). ``east_type`` is a
    Python EastType or a raw ``EastType*`` pointer. Returns ``None`` when the
    blob is not pageable (no index, aliased segments, a gated element shape,
    or not a v5 container), exactly like :func:`open_paged_value` — the
    caller falls back to the eager load.
    """
    _ensure_runtime()
    cdef const uint8_t[::1] view = buffer
    cdef const uint8_t* ptr = NULL
    if view.shape[0] > 0:
        ptr = &view[0]
    cdef bint own_type = False
    cdef _eastc.EastType* c_type = _resolve_c_type(east_type, &own_type)
    # The C value's reference to the buffer object; released by the hook.
    Py_INCREF(buffer)
    cdef _eastc.EastValue* v = _eastc.east_beast2_open_paged_external(
        <uint8_t*>ptr, <size_t>view.shape[0], c_type, frozen,
        _release_python_bytes, <void*><PyObject*>buffer)
    if v == NULL:
        Py_XDECREF(<PyObject*>buffer)  # never retained: the hook will not fire
        if own_type:
            _eastc.east_type_release(c_type)
        free(_eastc.east_builtin_get_error())
        return None
    cdef uintptr_t v_ptr = <uintptr_t>v
    cdef uintptr_t type_ptr = <uintptr_t>c_type
    cdef bint own_type_flag = own_type

    class _PagedViewHold:
        __slots__ = ("_east_c_paged", "_east_c_paged_type", "_buffer",
                     "_own_type", "_released")

        def __init__(self):
            self._east_c_paged = v_ptr
            self._east_c_paged_type = type_ptr
            self._buffer = buffer  # keeps the mmap (and its bytes) alive
            self._own_type = own_type_flag
            self._released = False

        def __del__(self):
            if self._released:
                return
            self._released = True
            _proxy_value_release(self._east_c_paged)
            if self._own_type:
                _proxy_type_release(self._east_c_paged_type)

    return _PagedViewHold()


def open_paged_file(object east_type, object path, bint frozen=True):
    """Open an indexed beast2 collection FILE as a lazy paged C value over a
    memory mapping of the file (#660): the mapping is the C value's own —
    retained through the paged value's release hook and unmapped when the
    value dies — so no python object has to outlive it, and the wire bytes
    are page cache, never process memory. ``east_type`` is a Python EastType
    or a raw ``EastType*`` pointer; the file's header must carry exactly that
    type. Returns the same hold shape as :func:`open_paged_value` (recognised
    by ``_eastc_call``, ``bind`` and the platform-return seam), or ``None``
    when the blob is not pageable — the caller then decodes whole.

    Raises:
        ValueError: If the file is not a beast2 v5 container of ``east_type``.
        OSError: If the file cannot be opened or mapped.
    """
    import mmap as _mmap
    import os as _os

    from east._eastc_bridge import c_type_ptr_to_py_type
    from east.serialization.beast2 import read_beast2_type
    from east.serialization.east_printer import print_type

    resolved = c_type_ptr_to_py_type(east_type) if isinstance(east_type, int) else east_type
    if _os.stat(path).st_size == 0:
        raise ValueError("Data too short for Beast2 format: 0 bytes")
    with open(path, "rb") as handle:
        # The mapping dups the descriptor, so the file object may close now.
        mapping = _mmap.mmap(handle.fileno(), 0, access=_mmap.ACCESS_READ)
    try:
        # The header's type, read off the mapping (the buffer form names no
        # path — the caller prefixes it once), for both container versions.
        wire = read_beast2_type(mapping)
        if wire != resolved:
            raise ValueError(
                "beast2: cannot open a blob of type "
                f"{print_type(wire)} as {print_type(resolved)}")
        hold = open_paged_value_view(east_type, mapping, frozen)
    except BaseException:
        mapping.close()
        raise
    if hold is None:
        mapping.close()
    return hold


def paged_value_ref_count(uintptr_t ptr):
    """The C refcount of a paged value — the close-safety probe (#560): a
    count above the hold's own reference means a function bind or compiled
    call still retains the value, so its borrowed bytes must stay mapped."""
    if ptr == 0:
        return 0
    return (<_eastc.EastValue*>ptr).ref_count


def paged_value_is_hydrated(uintptr_t ptr):
    """Whether a paged value has decoded its whole (hydrated) child — the
    laziness probe (#621): False means every operation so far was
    pager-served at O(segment)."""
    cdef _eastc.EastValue* v = <_eastc.EastValue*>ptr
    if v == NULL or v.kind != _eastc.EAST_VAL_PAGED:
        return False
    return v.data.paged.hydrated != NULL


def paged_value_stats(uintptr_t ptr):
    """What a paged value's reads have cost so far, as ``(segments,
    segments_decoded, fences_probed, hydrated)`` — the runner's account of a
    lazy input (#663), which no residency figure can give on a mapping —
    or ``None`` for any other value."""
    cdef size_t segments = 0
    cdef size_t decoded = 0
    cdef size_t fences = 0
    cdef _eastc.cbool hydrated = False
    if not _eastc.east_paged_stats(<_eastc.EastValue*>ptr, &segments, &decoded, &fences, &hydrated):
        return None
    return (segments, decoded, fences, bool(hydrated))


def open_paged_value(uintptr_t type_ptr, bytes data, bint frozen=False):
    """Open an indexed beast2 collection blob as a lazy paged C value (#505).

    The returned hold carries the ``EAST_VAL_PAGED`` value's pointer (released
    on garbage collection) and is recognised by ``_eastc_call``'s argument
    conversion, so a runner can pass a huge ``--stream`` input straight into a
    compiled body with O(segment) decoded memory. Returns ``None`` when the
    blob is not pageable (no index, aliased segments, or not a v5 container) —
    the caller falls back to the eager load, exactly like east-node's runner.

    With ``frozen`` (#539) the value and every pager-served segment decode
    frozen — mutation refuses with the uniform cross-runtime error and the
    collection compares as a value type under Is — and the shape gate
    collapses: any element shape opens lazily except those carrying a Ref or
    function values, which return ``None`` for the eager frozen fallback.
    """
    _ensure_runtime()
    cdef size_t n = len(data)
    cdef uint8_t* buf = <uint8_t*>malloc(n if n > 0 else 1)
    if buf == NULL:
        raise MemoryError()
    memcpy(buf, <const uint8_t*><char*>data, n)
    cdef _eastc.EastValue* v
    if frozen:
        v = _eastc.east_beast2_open_paged_frozen(buf, n, <_eastc.EastType*>type_ptr)
    else:
        v = _eastc.east_beast2_open_paged(buf, n, <_eastc.EastType*>type_ptr)
    if v == NULL:
        free(buf)  # ownership stayed with us on failure
        free(_eastc.east_builtin_get_error())
        return None
    cdef uintptr_t v_ptr = <uintptr_t>v

    class _PagedValueHold:
        __slots__ = ("_east_c_paged", "_east_c_paged_type", "_released")

        def __init__(self):
            self._east_c_paged = v_ptr
            self._east_c_paged_type = type_ptr
            self._released = False

        def __del__(self):
            if self._released:
                return
            self._released = True
            _proxy_value_release(self._east_c_paged)

    return _PagedValueHold()


cdef _eastc.EastType* _resolve_c_type(object east_type, bint* own) except NULL:
    """An ``EastType*`` from a Python EastType or a raw pointer (int). Sets
    *own when the caller must release it."""
    own[0] = False
    if isinstance(east_type, int):
        if <uintptr_t>east_type == 0:
            raise ValueError("east type pointer must not be null")
        return <_eastc.EastType*><uintptr_t>east_type
    own[0] = True
    return py_type_to_c(east_type)


cdef object _frozen_hold_from(_eastc.EastValue* v):
    """Wrap a retained frozen C value as the hold ``_eastc_call``'s argument
    conversion and the platform bridge's return conversion pass straight
    through (attribute ``_east_c_value``)."""
    cdef uintptr_t v_ptr = <uintptr_t>v

    class _FrozenValueHold:
        __slots__ = ("_east_c_value", "_released")

        def __init__(self):
            self._east_c_value = v_ptr
            self._released = False

        def __del__(self):
            if self._released:
                return
            self._released = True
            _proxy_value_release(self._east_c_value)

    return _FrozenValueHold()


def load_frozen_value(object east_type, bytes data):
    """Decode a beast2 blob as a FROZEN C value (#539).

    The eager sibling of ``open_paged_value(..., frozen=True)``: every
    constructed container carries the frozen brand from construction, so the
    compiled body's mutating builtins refuse it and it compares as a value
    type under Is. ``east_type`` is a Python EastType or a raw ``EastType*``
    pointer (a runner passes ``handle._input_types[i]``). Returns a hold
    recognised by ``_eastc_call``'s argument conversion and by platform
    function returns.
    """
    _ensure_runtime()
    cdef bint own_type = False
    cdef _eastc.EastType* c_type = _resolve_c_type(east_type, &own_type)
    cdef _eastc.EastValue* v
    try:
        v = _eastc.east_beast2_decode_full_frozen(
            <const uint8_t*><char*>data, len(data), c_type)
    finally:
        if own_type:
            _eastc.east_type_release(c_type)
    if v == NULL:
        err = _eastc.east_builtin_get_error()
        msg = err.decode("utf-8") if err != NULL else "frozen beast2 decode failed"
        free(err)
        raise ValueError(msg)
    return _frozen_hold_from(v)


def freeze_value(object east_type, object value):
    """A frozen deep copy of ``value`` — encode + frozen decode through the
    real beast2 path, so the copy is constructed exactly as a frozen task
    input would be (#539). Backs the compliance suite's ``freeze*`` platform
    functions; ``east_type`` is a Python EastType or a raw pointer.
    """
    _ensure_runtime()
    cdef bint own_type = False
    cdef _eastc.EastType* c_type = _resolve_c_type(east_type, &own_type)
    cdef _eastc.EastValue* c_val = NULL
    cdef _eastc.ByteBuffer* blob = NULL
    cdef _eastc.EastValue* frozen = NULL
    try:
        c_val = py_value_to_c(value, c_type)
        blob = _eastc.east_beast2_encode_full(c_val, c_type)
        if blob == NULL:
            err = _eastc.east_builtin_get_error()
            msg = err.decode("utf-8") if err != NULL else "freeze: encode failed"
            free(err)
            raise ValueError(msg)
        frozen = _eastc.east_beast2_decode_full_frozen(blob.data, blob.len, c_type)
        if frozen == NULL:
            err = _eastc.east_builtin_get_error()
            msg = err.decode("utf-8") if err != NULL else "freeze: frozen decode failed"
            free(err)
            raise ValueError(msg)
        return _frozen_hold_from(frozen)
    finally:
        if blob != NULL:
            _eastc.byte_buffer_free(blob)
        if c_val != NULL:
            _eastc.east_value_release(c_val)
        if own_type:
            _eastc.east_type_release(c_type)


cdef inline tuple _without_block(tuple args):
    """``args`` without a leading statement block.

    A compiled function is a value, not a body: it takes no block. Every
    callback slot invokes what it holds body-style — ``fn(b, *values)``, the
    wrappers that reorder or pad a builtin's arguments included — so a
    compiled, bound or carrier function called that way drops the block
    (east.expression.statements._drop_block, on the C side). Checked on the
    TYPE: an expression proxy's ``__getattr__`` must not fire.
    """
    if len(args) > 0 and getattr(type(args[0]), "_east_block", False):
        return args[1:]
    return args


cdef uintptr_t _native_fn_val_ptr(object obj) noexcept:
    """The EastValue* of a compiled East function callable, or 0.

    Callables from _make_callable_from_value (compile_from_json/beast2/east
    and east.expression) carry an _eastc_handle whose _fn_val is the retained
    EAST_VAL_FUNCTION pointer — passing it straight to a callback builtin
    keeps the whole loop inside east-c.
    """
    try:
        handle = obj._eastc_handle
    except BaseException:
        return 0
    try:
        return <uintptr_t>getattr(handle, "_fn_val", 0)
    except BaseException:
        return 0


# ─── Eager builtin invocation (no IR compile) ────────────────────────────

cdef _eastc.EastValue* _callback_value_for(object arg, list native_holds) except NULL:
    """The C function value for an EastFunction in a Function-typed slot.

    A compiled East function used as the callback rides its own native function
    value straight into the builtin (#409); a callable carrying attached IR
    (a replayed closure, a decoded function) converts through the bridge —
    live captures ride its identity-mapped captures env (#476 E); any other
    python callback captures STRICTLY into a native function (#625) — a
    capture failure raises.
    """
    cdef uintptr_t fn_ptr
    cdef _eastc.EastValue* out
    cdef _eastc.EastType* c_fn_t
    native = _native_function_for(arg)
    if native is None and getattr(arg.fn, EAST_IR_ATTR, None) is not None:
        from east.types.types import FunctionType as _FnType
        fn_t = _FnType(list(arg.input_types), arg.output_type)
        c_fn_t = py_type_to_c(fn_t)
        try:
            out = py_value_to_c(arg.fn, c_fn_t)
        finally:
            _eastc.east_type_release(c_fn_t)
        return out
    if native is None:
        from east.expression import capture_callback

        native = capture_callback(arg)
    fn_ptr = _native_fn_val_ptr(native)
    if fn_ptr == 0:
        raise RuntimeError(
            "callback did not resolve to a native function value")
    native_holds.append(native)
    out = <_eastc.EastValue*>fn_ptr
    _eastc.east_value_retain(out)
    return out


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
        args: Python values; each one marshals against the builtin's DECLARED
            input type for its slot (east.runtime.builtin_signatures).
        output_type: Python EastType used to decode the result.
    """
    cdef bytes name_bytes = name.encode("utf-8")
    cdef size_t ntp = len(type_params)
    cdef size_t nargs = len(args)
    cdef _eastc.EastType** c_tps = NULL
    cdef _eastc.EastType** arg_types = NULL
    cdef _eastc.EastValue** c_args = NULL
    cdef _eastc.EastType* c_out = NULL
    cdef _eastc.EastType* resolved
    cdef _eastc.BuiltinImpl bfn
    cdef _eastc.EastValue* result
    cdef _eastc.EastValue* h_arg
    cdef char* err
    cdef size_t i, j
    cdef uintptr_t fn_ptr
    cdef object py_result
    cdef list declared
    cdef bint checked_serves
    cdef bint builtin_paged_ok
    cdef _eastc.PlatformRegistry* saved_platform
    cdef _eastc.BuiltinRegistry* saved_builtins
    # Keeps captured callbacks alive until their function values are released.
    cdef list native_holds = []

    from east.runtime.builtin_signatures import FN, builtin_inputs
    from east.types.values import EastFunction

    _ensure_runtime()

    # The builtin's declared input types, instanced with the call's type
    # parameters. Every value slot converts against ITS declared type — never
    # against the argument's own inferred type, which let a wrongly-typed
    # scalar slot reinterpret memory inside east-c (an Integer key inserted
    # into a String-keyed dict was dereferenced as a string pointer, #534).
    # An unknown name or an arity mismatch is a caller bug, named here before
    # east-c ever sees a value.
    declared = builtin_inputs(name, type_params)
    if len(declared) != nargs:
        raise TypeError(
            f"east-c builtin {name} takes {len(declared)} argument(s), got {nargs}")

    try:
        if ntp > 0:
            c_tps = <_eastc.EastType**>malloc(ntp * sizeof(_eastc.EastType*))
            if c_tps == NULL:
                raise MemoryError()
            # Zero-init before converting: if py_type_to_c raises mid-loop,
            # the finally block must not release uninitialized tail entries.
            for i in range(ntp):
                c_tps[i] = NULL
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
                if declared[i] is FN:
                    if isinstance(args[i], EastFunction):
                        c_args[i] = _callback_value_for(args[i], native_holds)
                    else:
                        # Compiled East function (east.expression / compile_from_*):
                        # pass its value through so the callback executes
                        # natively (no python). Anything else in a callback
                        # slot is a caller bug.
                        fn_ptr = _native_fn_val_ptr(args[i])
                        if fn_ptr == 0:
                            raise TypeError(
                                f"{name} argument {i} is Function-typed and takes a "
                                f"callback (an EastFunction or a compiled function); "
                                f"got {type(args[i]).__name__}")
                        c_args[i] = <_eastc.EastValue*>fn_ptr
                        _eastc.east_value_retain(c_args[i])
                else:
                    # A frozen hold (freeze_value / load_frozen_value) passes
                    # its branded C value straight through — the same seam
                    # _eastc_call has (#539): re-converting via python would
                    # construct a fresh mutable value and drop the frozen
                    # contract (and, for tensors, the value identity Is
                    # compares by). The probe must swallow raising
                    # __getattr__s (Expression proxies).
                    try:
                        raw_hold = getattr(args[i], "_east_c_value", None)
                    except BaseException:
                        raw_hold = None
                    if raw_hold is not None:
                        c_args[i] = <_eastc.EastValue*><uintptr_t>raw_hold
                        _eastc.east_value_retain(c_args[i])
                        continue
                    arg_types[i] = py_type_to_c(declared[i])
                    # A Function-typed VALUE slot (a generic T instanced to a
                    # function type, e.g. Print or BlobEncodeBeast2 over
                    # functions) accepts the same forms a callback slot does:
                    # an EastFunction resolves to its native (or captured)
                    # function value, a compiled function passes its value
                    # through, and anything else converts below (decoded
                    # function wrappers serialize from their attached IR).
                    resolved = arg_types[i]
                    while resolved.kind == _eastc.EAST_TYPE_RECURSIVE and resolved.data.recursive.node != NULL:
                        resolved = resolved.data.recursive.node
                    if resolved.kind == _eastc.EAST_TYPE_FUNCTION or resolved.kind == _eastc.EAST_TYPE_ASYNC_FUNCTION:
                        if isinstance(args[i], EastFunction):
                            # A VALUE slot holds data (Print, BlobEncodeBeast2 over
                            # functions): prefer the native function value, then
                            # the function's OWN attached representation (live
                            # captures / attached IR) — CAPTURING it comes
                            # last: that re-derives the body, which executes
                            # identically but is a different function value
                            # than the one the slot holds (#476).
                            native = _native_function_for(args[i])
                            fn_ptr = _native_fn_val_ptr(native) if native is not None else 0
                            if fn_ptr != 0:
                                native_holds.append(native)
                                c_args[i] = <_eastc.EastValue*>fn_ptr
                                _eastc.east_value_retain(c_args[i])
                                continue
                            if getattr(args[i].fn, EAST_CAPTURES_ATTR, None):
                                # Live capture values ride OUTSIDE the IR:
                                # convert through the bridge, whose carrier
                                # populates the closure's captures env via the
                                # conversion's identity_map — compiling the
                                # bare node here would leave the declared
                                # captures unbound (#476 E).
                                c_args[i] = py_value_to_c(args[i].fn, arg_types[i])
                                continue
                            py_ir = getattr(args[i].fn, EAST_IR_ATTR, None)
                            if py_ir is not None:
                                # Compile the attached IR: a capture-baked
                                # Block[Let…, Function] unwraps into a real
                                # closure whose source_ir/captures env carry
                                # the exact wire shape the codec expects.
                                native = compile_eastc_from_value(
                                    py_ir, [],
                                    resolved.kind == _eastc.EAST_TYPE_ASYNC_FUNCTION)
                                fn_ptr = _native_fn_val_ptr(native)
                                if fn_ptr != 0:
                                    native_holds.append(native)
                                    c_args[i] = <_eastc.EastValue*>fn_ptr
                                    _eastc.east_value_retain(c_args[i])
                                    continue
                            from east.expression import capture_callback

                            native = capture_callback(args[i])
                            fn_ptr = _native_fn_val_ptr(native)
                            if fn_ptr == 0:
                                raise RuntimeError(
                                    "function value did not resolve to a "
                                    "native function value")
                            native_holds.append(native)
                            c_args[i] = <_eastc.EastValue*>fn_ptr
                            _eastc.east_value_retain(c_args[i])
                            continue
                        fn_ptr = _native_fn_val_ptr(args[i])
                        if fn_ptr != 0:
                            c_args[i] = <_eastc.EastValue*>fn_ptr
                            _eastc.east_value_retain(c_args[i])
                            continue
                    try:
                        c_args[i] = py_value_to_c(args[i], arg_types[i])
                    except Exception as conv_err:
                        # Name the builtin, the slot and the declared type —
                        # the raw conversion error alone ("an integer is
                        # required") does not say which argument was wrong.
                        # Printing the type is itself a conversion that can
                        # fail on the same shape that got us here, so it must
                        # degrade to a placeholder, never recurse into another
                        # round of error formatting.
                        try:
                            from east.serialization.east_printer import print_east
                            from east.types.type_of_type import EastTypeType
                            printed = print_east(declared[i], EastTypeType)
                        except Exception:
                            printed = "<type>"
                        raise TypeError(
                            f"{name} argument {i}: {type(args[i]).__name__} value does "
                            f"not convert to the declared slot type "
                            f"{printed} — {conv_err}"
                        ) from conv_err

        # Paged arguments reach only the pager-served builtins (size / keyed
        # get / has); every other builtin receives the hydrated collection —
        # the evaluator's IR_BUILTIN gate, applied here because the funnel
        # invokes impls directly and a kind-blind builtin handed a paged
        # value would read its union arms as garbage (#621). Hydration is
        # cached on the wrapper, so the cost is paid once per value.
        if nargs > 0:
            checked_serves = False
            builtin_paged_ok = False
            for i in range(nargs):
                if c_args[i] != NULL and c_args[i].kind == _eastc.EAST_VAL_PAGED:
                    if not checked_serves:
                        checked_serves = True
                        builtin_paged_ok = _eastc.east_builtin_serves_paged(
                            <const char*>name_bytes)
                    if builtin_paged_ok:
                        continue
                    h_arg = _eastc.east_paged_hydrated(c_args[i])
                    if h_arg == NULL:
                        err = _eastc.east_builtin_get_error()
                        if err != NULL:
                            msg = err.decode("utf-8")
                            free(err)
                        else:
                            msg = "failed to hydrate a paged argument"
                        from east.runtime.errors import EastError
                        raise EastError(msg, [])
                    _eastc.east_value_retain(h_arg)
                    _eastc.east_value_release(c_args[i])
                    c_args[i] = h_arg

        c_out = py_type_to_c(output_type)

        # Factory + impl back-to-back — no Python allocation in between.
        bfn = _eastc.builtin_registry_get(_builtins, <const char*>name_bytes, c_tps, ntp)
        if bfn == NULL:
            raise ValueError(f"Unknown east-c builtin: {name}")
        # Install the funnel's registries as the thread context for the
        # invocation, exactly as east_call does around a compiled body. A
        # builtin that CONSTRUCTS function values (BlobDecodeBeast2) wires
        # them to the thread-current registries — invoked bare, they would
        # capture NULL and the decoded function would crash on first call
        # (#476 B).
        _eastc.east_get_thread_context(&saved_platform, &saved_builtins)
        _eastc.east_set_thread_context(saved_platform, _builtins)
        try:
            result = bfn(c_args, nargs)
        finally:
            _eastc.east_set_thread_context(saved_platform, saved_builtins)

        if result == NULL:
            err = _eastc.east_builtin_get_error()
            from east.runtime.errors import EastError
            from east.types.values import EastArray, EastVariant
            if err != NULL:
                msg = err.decode("utf-8")
                free(err)
            else:
                msg = f"east-c builtin {name} failed"
            raise EastError(msg, [])

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


# ─── Source maps (#626) ──────────────────────────────────────────────────
#
# A python-authored function's loc_ids index the SourceMap its build captured
# (east.expression.location). The map crosses to east-c ONCE, at compile
# time: it is the current map while the IR compiles — so a compile-time
# error (a platform-signature mismatch) names the offending node by python
# file:line, exactly as the JSON/beast2 paths install an exported map — and
# the closure that results holds its own reference from then on. east-c
# refcounts source maps (east_source_map_retain/release) and the compiled
# function releases its reference when it is freed, so nothing here is
# leaked and nothing outlives its last holder.


cdef _eastc.EastSourceMap* _source_map_to_c(object source_map) except NULL:
    """A heap EastSourceMap (one reference — the caller's) holding every stack
    of a python ``SourceMap``: filenames strdup'd, lines/columns as given."""
    cdef list entries = list(source_map.entries())
    cdef size_t n = len(entries)
    cdef size_t i, j, count
    cdef bytes encoded
    cdef _eastc.EastSourceMap* sm = _eastc.east_source_map_new()
    if sm == NULL:
        raise MemoryError()
    sm.stacks = <_eastc.EastLocation**>calloc(n, sizeof(_eastc.EastLocation*))
    sm.stack_counts = <size_t*>calloc(n, sizeof(size_t))
    if sm.stacks == NULL or sm.stack_counts == NULL:
        _eastc.east_source_map_release(sm)
        raise MemoryError()
    # Set the count first: a release part-way through frees exactly the
    # stacks (and filenames) allocated so far — calloc zeroes the rest.
    sm.num_stacks = n
    for i in range(n):
        stack = entries[i]
        count = len(stack)
        sm.stack_counts[i] = count
        if count == 0:
            continue
        sm.stacks[i] = <_eastc.EastLocation*>calloc(count, sizeof(_eastc.EastLocation))
        if sm.stacks[i] == NULL:
            _eastc.east_source_map_release(sm)
            raise MemoryError()
        for j in range(count):
            filename, line, column = stack[j]
            encoded = filename.encode("utf-8")
            sm.stacks[i][j].filename = strdup(<const char*>encoded)
            sm.stacks[i][j].line = <int64_t>line
            sm.stacks[i][j].column = <int64_t>column
    return sm


cdef void _adopt_source_map(object result, _eastc.EastSourceMap* sm) except *:
    """Hand a compile's map reference to the compiled function.

    The unwrapped closure normally took its own reference while it was
    created under the map (the IR_FUNCTION eval retains the current map), in
    which case this compile's reference is simply dropped; a function that
    compiled to a bare wrapper (nothing to unwrap) adopts it instead. Either
    way the function ends up holding exactly one reference, released with it.
    """
    cdef uintptr_t compiled_ptr = <uintptr_t>result._eastc_handle._compiled
    cdef _eastc.EastCompiledFn* cfn = <_eastc.EastCompiledFn*>compiled_ptr
    if cfn != NULL and cfn.source_map == NULL:
        cfn.source_map = sm
    else:
        _eastc.east_source_map_release(sm)


cdef list _error_locations(_eastc.EvalResult* result):
    """The resolved frames of an EVAL_ERROR, innermost first, as the plain
    ``{filename, line, column}`` structs ``EastError.location`` carries."""
    from east.types.values import EastStruct
    cdef list out = []
    cdef size_t i
    if result.num_locations > 0 and result.locations != NULL:
        for i in range(result.num_locations):
            loc = result.locations[i]
            filename = loc.filename.decode("utf-8") if loc.filename != NULL else "<unknown>"
            out.append(EastStruct({
                "filename": filename,
                "line": loc.line,
                "column": loc.column,
            }))
    return out


cdef class _SourceMapScope:
    """The context manager behind ``source_map_of``."""
    cdef object _fn
    cdef _eastc.EastSourceMap* _sm
    cdef const _eastc.EastSourceMap* _saved

    def __cinit__(self, object compiled_fn):
        self._fn = compiled_fn
        self._sm = NULL
        self._saved = NULL

    def __enter__(self):
        cdef uintptr_t compiled_ptr = <uintptr_t>getattr(
            getattr(self._fn, "_eastc_handle", None), "_compiled", 0)
        cdef _eastc.EastCompiledFn* cfn = <_eastc.EastCompiledFn*>compiled_ptr
        self._saved = _eastc.east_get_source_map()
        if cfn != NULL and cfn.source_map != NULL:
            self._sm = cfn.source_map
            _eastc.east_source_map_retain(self._sm)
            _eastc.east_set_source_map(self._sm)
        return self

    def __exit__(self, *exc):
        _eastc.east_set_source_map(self._saved)
        _eastc.east_source_map_release(self._sm)  # NULL-safe
        self._sm = NULL
        self._saved = NULL
        return False


def source_map_of(object compiled_fn):
    """A context manager installing ``compiled_fn``'s source map as the
    thread-current map for the block — the C-side twin of the TypeScript
    ``with_source_map(fn.source_map, …)``.

    For a harness that builds closures against a program's EXPORTED IR (the
    compliance replay, whose loc_ids index the file's map): every function
    compiled or unwrapped inside the block snapshots that map, so its errors
    resolve the original source locations and its beast2 encoding embeds the
    same map a compiled runner's closure embeds. The previously current map
    is restored on exit. A compile installs — and restores — the map it
    compiles under on its own (``compile_from_value``'s ``source_map``, the
    decoded-map compile paths), so this is only for code that builds
    functions OUTSIDE such a compile against someone else's loc_ids.
    """
    return _SourceMapScope(compiled_fn)


# ─── Common compile from C IR value ──────────────────────────────────────

cdef object _compile_from_c_ir_val(_eastc.EastValue* c_ir_val, list platform_list, bint is_async,
                                   object py_ir=None):
    """Compile from a C IR value — shared by JSON and East text paths."""
    cdef _eastc.IRNode* ir_node = _eastc.east_ir_from_value(c_ir_val)
    if ir_node == NULL:
        _eastc.east_value_release(c_ir_val)
        raise RuntimeError("east_ir_from_value returned NULL — invalid IR")
    return _compile_from_ir_node(ir_node, c_ir_val, platform_list, is_async, py_ir)


# ─── Compile from a homoiconic IR value (no serialization round-trip) ─────

# The C-side IRType, converted once and cached for the process lifetime
# (intentionally never released — like the builtin/platform registries).
cdef _eastc.EastType* _c_ir_type = NULL


cdef _eastc.EastType* _ensure_c_ir_type() except NULL:
    global _c_ir_type
    if _c_ir_type == NULL:
        from east.types.type_of_type import IRType
        _c_ir_type = py_type_to_c(IRType)
    return _c_ir_type


def normalize_ir(object ir_value):
    """The canonical form of an IR value — east-c's ``east_ir_normalize``
    (the round-trip equality contract, implemented once): loc_ids stripped,
    variables and labels renamed in the TypeScript lowering's order, captures
    recomputed, recursive type ids renumbered. Returns a fresh IR value."""
    cdef _eastc.EastType* ir_type = _ensure_c_ir_type()
    cdef _eastc.EastValue* c_ir = py_value_to_c(ir_value, ir_type)
    cdef _eastc.EastValue* norm
    try:
        norm = _eastc.east_ir_normalize(c_ir)
    finally:
        _eastc.east_value_release(c_ir)
    if norm == NULL:
        raise ValueError("IR normalization failed (unknown node kind)")
    try:
        return c_value_to_py(norm, ir_type)
    finally:
        _eastc.east_value_release(norm)


def diff_ir(object a, object b, bint normalize=True):
    """The first structural difference between two IR values as a path
    (``$(Function).value.body...``), or None when they are equal — normalized
    first unless ``normalize=False``."""
    cdef _eastc.EastType* ir_type = _ensure_c_ir_type()
    cdef _eastc.EastValue* ca = py_value_to_c(a, ir_type)
    cdef _eastc.EastValue* cb
    cdef _eastc.EastValue* na = NULL
    cdef _eastc.EastValue* nb = NULL
    cdef char* path = NULL
    try:
        cb = py_value_to_c(b, ir_type)
    except BaseException:
        _eastc.east_value_release(ca)
        raise
    try:
        if normalize:
            na = _eastc.east_ir_normalize(ca)
            nb = _eastc.east_ir_normalize(cb)
            if na == NULL or nb == NULL:
                raise ValueError("IR normalization failed (unknown node kind)")
            path = _eastc.east_value_diff_path(na, nb)
        else:
            path = _eastc.east_value_diff_path(ca, cb)
        if path == NULL:
            return None
        result = path.decode("utf-8")
        free(path)
        return result
    finally:
        if na != NULL:
            _eastc.east_value_release(na)
        if nb != NULL:
            _eastc.east_value_release(nb)
        _eastc.east_value_release(ca)
        _eastc.east_value_release(cb)


cpdef object compile_eastc_from_value(object ir_value, list platform_list, bint is_async,
                                      object source_map=None):
    """Compile East IR from a homoiconic IR value (an EastVariant conforming
    to IRType) — the python value converts straight to a C value and
    east_ir_from_value builds the IR tree, with no serialization round-trip.
    This is the expression builder's path (#398).

    The IR value is attached to the compiled callable's ``_east_ir`` (#476):
    it is the serialization fallback's source, and dropping it here made
    east-py unable to serialize its own compiled functions.

    ``source_map`` is the ``east.expression.location.SourceMap`` the IR's
    loc_ids index (#626). It is installed as the current map around the
    compile — the same discipline as the exported-map paths — and handed to
    the compiled function, so a runtime error resolves to the python
    file:line that built the failing node, the function's beast2 encoding
    carries the map, and a compile-time error names its node's location.
    The python map is also attached as ``_east_source_map``.
    """
    _ensure_runtime()
    cdef _eastc.EastSourceMap* c_sm = NULL
    cdef const _eastc.EastSourceMap* saved = NULL
    cdef _eastc.EastValue* c_ir_val
    cdef object result
    if source_map is not None and len(source_map) > 1:
        c_sm = _source_map_to_c(source_map)
    try:
        c_ir_val = py_value_to_c(ir_value, _ensure_c_ir_type())
    except BaseException:
        _eastc.east_source_map_release(c_sm)
        raise
    saved = _eastc.east_get_source_map()
    if c_sm != NULL:
        _eastc.east_set_source_map(c_sm)
    try:
        result = _compile_from_c_ir_val(c_ir_val, platform_list, is_async, ir_value)
    except BaseException:
        _eastc.east_set_source_map(saved)
        _eastc.east_source_map_release(c_sm)
        raise
    _eastc.east_set_source_map(saved)
    if c_sm != NULL:
        _adopt_source_map(result, c_sm)
    if source_map is not None:
        object.__setattr__(result, "_east_source_map", source_map)
    return result


cdef object _compile_from_ir_node(_eastc.IRNode* ir_node, _eastc.EastValue* c_ir_val,
                                   list platform_list, bint is_async,
                                   object py_ir=None):
    """Compile from an already-decoded IRNode — shared compilation path.

    Takes ownership of the caller's ir_node reference: east_compile retains
    what it needs, so the decoded IR tree is released here on every path
    (it was previously leaked on each compile).
    """
    cdef _eastc.PlatformRegistry* platform = _eastc.platform_registry_new()
    if platform_list:
        try:
            register_platform_functions(platform, platform_list)
        except:
            _eastc.ir_node_release(ir_node)
            _eastc.platform_registry_release(platform)
            _eastc.east_value_release(c_ir_val)
            raise

    cdef char* compile_err = NULL
    cdef _eastc.EastCompiledFn* wrapper = _eastc.east_compile_checked(
        ir_node, platform, _builtins, &compile_err)
    # east_compile retained its own reference (or failed); drop ours now so
    # the IR tree's lifetime is tied to the compiled function.
    _eastc.ir_node_release(ir_node)
    if wrapper == NULL:
        _eastc.platform_registry_release(platform)
        _eastc.east_value_release(c_ir_val)
        if compile_err != NULL:
            # Platform-signature mismatch: identical message to the TS analyzer.
            msg = compile_err.decode("utf-8")
            free(compile_err)
            raise EastError(msg, [])
        raise RuntimeError("east_compile returned NULL")

    cdef _eastc.EvalResult unwrap_result = _eastc.east_call(wrapper, NULL, 0)
    if unwrap_result.status != _eastc.EVAL_OK and unwrap_result.status != _eastc.EVAL_RETURN:
        msg = "Failed to unwrap compiled function"
        if unwrap_result.error_message != NULL:
            msg = unwrap_result.error_message.decode("utf-8")
        _eastc.eval_result_free(&unwrap_result)
        _eastc.east_compiled_fn_free(wrapper)
        _eastc.platform_registry_release(platform)
        _eastc.east_value_release(c_ir_val)
        raise RuntimeError(msg)

    cdef _eastc.EastValue* fn_val = unwrap_result.value
    if fn_val == NULL or fn_val.kind != _eastc.EAST_VAL_FUNCTION:
        if fn_val != NULL:
            _eastc.east_value_release(fn_val)
        return _make_callable(wrapper, platform, c_ir_val, py_ir)

    cdef _eastc.EastCompiledFn* compiled = fn_val.data.function.compiled
    if compiled == NULL:
        _eastc.east_value_release(fn_val)
        _eastc.east_compiled_fn_free(wrapper)
        _eastc.platform_registry_release(platform)
        _eastc.east_value_release(c_ir_val)
        raise RuntimeError("Unwrapped function has NULL compiled fn")

    compiled.platform = platform
    compiled.builtins = _builtins

    cdef _eastc.EastType* fn_type = wrapper.ir.type

    return _make_callable_from_value(fn_val, wrapper, platform, c_ir_val, py_ir, is_async, fn_type)


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

    return _compile_with_decoded_map(ir_node, c_ir_val, source_map, platform_list, is_async)


cdef object _compile_with_decoded_map(_eastc.IRNode* ir_node, _eastc.EastValue* c_ir_val,
                                      _eastc.EastSourceMap* source_map,
                                      list platform_list, bint is_async):
    """Compile decoded IR under its exported map (JSON wrapper / beast2).

    The map is installed as the current one around the compile — a
    compile-time error names the offending node by source location, which
    only resolves while its map is current — then the decode's reference is
    handed to the compiled function (see ``_adopt_source_map``). The
    previously current map is restored either way: a compile may run inside
    ``east_call`` (a platform function building a program) and must not
    clobber the caller's map.
    """
    cdef const _eastc.EastSourceMap* saved = _eastc.east_get_source_map()
    cdef object result
    if source_map != NULL:
        _eastc.east_set_source_map(source_map)
    try:
        result = _compile_from_ir_node(ir_node, c_ir_val, platform_list, is_async)
    except BaseException:
        _eastc.east_set_source_map(saved)
        _eastc.east_source_map_release(source_map)
        raise
    _eastc.east_set_source_map(saved)
    if source_map != NULL:
        _adopt_source_map(result, source_map)
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
        _eastc.east_source_map_release(source_map)
        raise RuntimeError("east_beast2_decode_ir failed for IR")

    return _compile_with_decoded_map(ir_node, c_ir_val, source_map, platform_list, is_async)


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
            args = _without_block(args)
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
            args = _without_block(args)
            return _eastc_call(handle._compiled, handle._input_types,
                               handle._output_type, args)

        object.__setattr__(eastc_fn, EAST_IR_ATTR, py_ir)
        object.__setattr__(eastc_fn, EAST_CAPTURES_ATTR, {})
        object.__setattr__(eastc_fn, "_eastc_handle", handle)
        return eastc_fn


# ─── C-level partial application: function.bind(*values) (#399) ─────────────
#
# Binds the TRAILING parameters of a compiled function to live East values BY
# REFERENCE — no snapshot, no copy: each bound value's C pointer is retained
# once and appended to every call's argument list by a pure-C invoke, so the
# result is still a native function value (it carries _fn_val) and eager
# methods keep the whole loop plus the lookup inside east-c. This is the
# explicit opt-in to LIVE semantics: mutations to a bound collection are
# observed by subsequent calls — the opposite of the closure-capture
# contract (#393), which snapshots at trace time.

cdef struct _BindData:
    _eastc.EastValue* inner_fn
    _eastc.EastValue** bound
    size_t n_bound


cdef _eastc.EvalResult _bind_invoke(_eastc.EastCompiledFn* self,
                                    _eastc.EastValue** args, size_t n) noexcept:
    """Append the bound values to the call's args and delegate to the inner
    compiled function — pure C, no GIL, no per-element python."""
    cdef _BindData* bd = <_BindData*>self.invoke_userdata
    cdef _eastc.EastCompiledFn* inner = bd.inner_fn.data.function.compiled
    cdef size_t total = n + bd.n_bound
    cdef _eastc.EastValue* stack_args[8]
    cdef _eastc.EastValue** combined
    cdef bint heap = False
    cdef size_t i
    cdef _eastc.EvalResult r
    if total <= 8:
        combined = stack_args
    else:
        combined = <_eastc.EastValue**>malloc(total * sizeof(_eastc.EastValue*))
        if combined == NULL:
            return _eastc.eval_error("bind: out of memory")
        heap = True
    for i in range(n):
        combined[i] = args[i]
    for i in range(bd.n_bound):
        combined[n + i] = bd.bound[i]
    r = _eastc.east_call(inner, combined, total)
    if heap:
        free(combined)
    return r


cdef void _bind_release(void* ud) noexcept:
    cdef _BindData* bd = <_BindData*>ud
    cdef size_t i
    if bd == NULL:
        return
    if bd.inner_fn != NULL:
        _eastc.east_value_release(bd.inner_fn)
    if bd.bound != NULL:
        for i in range(bd.n_bound):
            if bd.bound[i] != NULL:
                _eastc.east_value_release(bd.bound[i])
        free(bd.bound)
    free(bd)


def bind_function(object function_callable, tuple bound_values):
    """C-level partial application of a compiled East function (#399).

    Returns a new native callable whose TRAILING parameters are pre-bound to
    ``bound_values`` by reference: collection proxies contribute their live C
    pointer (zero copy, any size — the function observes later mutations),
    other East values convert once at bind time. The result carries its own
    ``_eastc_handle`` (with ``_fn_val``), so every eager method treats it as
    native and the loop stays inside east-c. Rebinding the same function with
    other values yields independent callables; the unbound function remains
    usable.

    Raises:
        TypeError: If ``function_callable`` is not a compiled East function,
            more values are bound than the function has parameters, or a bound
            value's East type does not match the declared parameter type.
    """
    _ensure_runtime()
    try:
        handle = function_callable._eastc_handle
    except AttributeError:
        raise TypeError(
            "bind() needs a compiled East function (from East.function or compile_from_*)"
        ) from None
    input_ptrs = list(handle._input_types)
    cdef size_t n_inputs = len(input_ptrs)
    cdef size_t n_bound = len(bound_values)
    if n_bound == 0:
        raise TypeError("bind() needs at least one value")
    if n_bound > n_inputs:
        raise TypeError(
            f"bind() got {n_bound} values for a {n_inputs}-parameter function"
        )
    cdef size_t first = n_inputs - n_bound

    from east._eastc_bridge import c_type_ptr_to_py_type
    from east.serialization.east_printer import print_east
    from east.types.type_of_type import EastTypeType
    from east.types.values import type_of
    from east.types.values import is_value_of
    for j in range(n_bound):
        expected = c_type_ptr_to_py_type(input_ptrs[first + j])
        # Declared-type equality first: O(1) for typed collections (their
        # element types are carried, not inferred from contents — the #399
        # zero-copy contract must not pay a per-element validation walk), and
        # the only sound check for function values, whose contents cannot be
        # inspected (#561). SUBSUMPTION via ``is_value_of`` — does the VALUE
        # conform to the DECLARED parameter type — remains the fallback for
        # everything content inference cannot prove: ``type_of`` on a variant
        # can only see the case the value holds, so an Option-bearing struct
        # (a ``none`` field infers as a degenerate none-only variant) never
        # compares equal to its declared type (#558 B).
        try:
            got = type_of(bound_values[j])
        except TypeError:
            got = None
        if got is not None and got == expected:
            continue
        if not is_value_of(bound_values[j], expected):
            shown = print_east(got, EastTypeType) if got is not None \
                else type(bound_values[j]).__name__
            raise TypeError(
                f"bind() value {j} has East type "
                f"{shown}, parameter {first + j} "
                f"expects {print_east(expected, EastTypeType)}"
            )

    cdef _BindData* bd = <_BindData*>malloc(sizeof(_BindData))
    if bd == NULL:
        raise MemoryError()
    bd.inner_fn = NULL
    bd.n_bound = n_bound
    bd.bound = <_eastc.EastValue**>malloc(n_bound * sizeof(_eastc.EastValue*))
    if bd.bound == NULL:
        free(bd)
        raise MemoryError()
    cdef size_t k
    cdef uintptr_t paged_ptr
    cdef uintptr_t paged_type
    for k in range(n_bound):
        bd.bound[k] = NULL
    try:
        for k in range(n_bound):
            # A pager-backed value (a beast2 file opened as a collection
            # value, #560) binds BY POINTER: the compiled function's keyed
            # builtins then answer from the pager — O(one frame) per read,
            # no materialisation. Same declared-type discipline as the
            # _eastc_call seam (#467).
            paged_ptr = <uintptr_t>getattr(bound_values[k], "_east_c_paged", 0)
            if paged_ptr != 0:
                paged_type = <uintptr_t>getattr(bound_values[k], "_east_c_paged_type", 0)
                if paged_type == 0 or (paged_type != <uintptr_t>input_ptrs[first + k]
                                       and not _eastc.east_type_equal(
                                           <_eastc.EastType*>paged_type,
                                           <_eastc.EastType*><uintptr_t>input_ptrs[first + k])):
                    raise TypeError("paged input type does not match the parameter type")
                bd.bound[k] = <_eastc.EastValue*>paged_ptr
                _eastc.east_value_retain(bd.bound[k])
                continue
            bd.bound[k] = py_value_to_c(
                bound_values[k], <_eastc.EastType*><uintptr_t>input_ptrs[first + k]
            )
    except BaseException:
        _bind_release(bd)
        raise

    cdef _eastc.EastValue* inner_fv = <_eastc.EastValue*><uintptr_t>handle._fn_val
    if inner_fv == NULL:
        _bind_release(bd)
        raise TypeError("bind() needs a compiled function with a native function value")
    _eastc.east_value_retain(inner_fv)
    bd.inner_fn = inner_fv

    cdef _eastc.EastValue* fv = _eastc.east_foreign_function(
        <_eastc.EastInvokeFn>_bind_invoke, <void*>bd, _bind_release, NULL
    )
    if fv == NULL:
        # east_foreign_function released bd on allocation failure.
        raise MemoryError()

    # The bound callable's handle: remaining input types + same output.
    remaining = []
    for k in range(first):
        _eastc.east_type_retain(<_eastc.EastType*><uintptr_t>input_ptrs[k])
        remaining.append(input_ptrs[k])
    _eastc.east_type_retain(<_eastc.EastType*><uintptr_t>handle._output_type)
    cdef uintptr_t out_ptr = handle._output_type
    cdef uintptr_t fv_ptr = <uintptr_t>fv
    cdef uintptr_t bound_compiled_ptr = <uintptr_t>fv.data.function.compiled

    class _EastCBoundHandle:
        __slots__ = ("_compiled", "_fn_val", "_input_types", "_output_type", "_released")

        def __init__(self):
            self._compiled = bound_compiled_ptr
            self._fn_val = fv_ptr
            self._input_types = list(remaining)
            self._output_type = out_ptr
            self._released = False

        def get_input_types(self):
            from east._eastc_bridge import c_type_ptr_to_py_type as _to_py
            return [_to_py(ptr) for ptr in self._input_types]

        def get_output_type(self):
            from east._eastc_bridge import c_type_ptr_to_py_type as _to_py
            return _to_py(self._output_type)

        def __del__(self):
            if self._released:
                return
            self._released = True
            _proxy_value_release(self._fn_val)
            for ptr in self._input_types:
                _proxy_type_release(ptr)
            _proxy_type_release(self._output_type)

    bound_handle = _EastCBoundHandle()

    def bound_fn(*args):

        args = _without_block(args)
        try:
            return _eastc_call(bound_handle._compiled, bound_handle._input_types,
                               bound_handle._output_type, args)
        except NonRetraceableCallError:
            # Called with trace proxies: lower to a native IR Call in the
            # surrounding trace instead of failing (#561).
            lowered = _try_lower_call(bound_handle, args)
            if lowered is None:
                raise
            return lowered

    object.__setattr__(bound_fn, "_eastc_handle", bound_handle)
    # Keep the inner function callable and the bound python values alive: the
    # C side retains its own references, but the inner handle also owns the
    # wrapper/platform the compiled function runs against.
    object.__setattr__(bound_fn, "_east_bind_refs", (function_callable, bound_values))

    def bind(*values):
        """Pre-bind further trailing parameters by reference (see bind_function)."""
        return bind_function(bound_fn, values)

    object.__setattr__(bound_fn, "bind", bind)
    return bound_fn


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
            args = _without_block(args)
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
            args = _without_block(args)
            try:
                return _eastc_call(handle._compiled, handle._input_types,
                                   handle._output_type, args)
            except NonRetraceableCallError:
                # Called with trace proxies: lower to a native IR Call in the
                # surrounding trace instead of failing (#561).
                lowered = _try_lower_call(handle, args)
                if lowered is None:
                    raise
                return lowered

        object.__setattr__(eastc_fn, EAST_IR_ATTR, py_ir)
        object.__setattr__(eastc_fn, EAST_CAPTURES_ATTR, {})
        object.__setattr__(eastc_fn, "_eastc_handle", handle)

        def bind(*values):
            """Pre-bind the TRAILING parameters to live East values by
            reference — C-level partial application (#399). The result stays
            native (eager methods keep the loop in east-c) and observes later
            mutations to bound collections. See ``bind_function``."""
            return bind_function(eastc_fn, values)

        object.__setattr__(eastc_fn, "bind", bind)
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
            # Cold path: if the failing argument is a trace-time proxy, the
            # caller is a traced lambda calling this compiled function —
            # lower the call to a native IR Call in the surrounding trace
            # (#561); when lowering declines, name the actual problem so it
            # reaches the capture error's cause chain (#558 C).
            from east.expression import Expression as _Expression
            found_proxy = False
            for j in range(nargs):
                if isinstance(args[j], _Expression):
                    found_proxy = True
                    break
            if found_proxy:
                from east.expression import _lower_compiled_call
                lowered = _lower_compiled_call(val_ptr, input_type_ptrs,
                                               output_type_ptr, args)
                if lowered is not None:
                    return lowered
                raise NonRetraceableCallError(
                    "a compiled/bound East function cannot be re-traced inside "
                    "another trace — call it from python (per-element), or pass "
                    "it directly to the eager method (native pass-through)"
                )
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
        # A decoded function value resolves its loc_ids against the map it
        # carries (its blob's source-map section), so the error it raises
        # names the authoring site exactly as a compiled function's does.
        location_array = _error_locations(&result)
        if result.value != NULL:
            _eastc.east_value_release(result.value)
        _eastc.eval_result_free(&result)
        from east.runtime.errors import EastError
        raise EastError(msg, location_array)

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
        _eastc.platform_registry_release(<_eastc.PlatformRegistry*>ptr)


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
    cdef _eastc.EastValue* hydrated_val
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
                # A paged hold (open_paged_value / a beast2 file opened as a
                # value, #560) passes its C value straight through — the lazy
                # input seam (#505). Compare the declared parameter type by
                # pointer first (the runner opens with the same interned
                # EastType*), structurally otherwise (a file-backed value
                # converts its own copy of the type) — a mismatched hold must
                # not hand east-c a wrongly-typed pager (#467 discipline).
                paged = getattr(args[i], "_east_c_paged", None)
                if paged is not None:
                    if i < n_types:
                        ptype = <uintptr_t>getattr(args[i], "_east_c_paged_type", 0)
                        if ptype == 0 or (ptype != <uintptr_t>input_type_ptrs[i]
                                          and not _eastc.east_type_equal(
                                              <_eastc.EastType*>ptype,
                                              <_eastc.EastType*><uintptr_t>input_type_ptrs[i])):
                            raise TypeError("paged input type does not match the parameter type")
                    c_args[i] = <_eastc.EastValue*><uintptr_t>paged
                    _eastc.east_value_retain(c_args[i])
                    continue
                # A frozen hold (load_frozen_value / freeze_value) passes its
                # branded C value straight through — re-converting via python
                # would construct a fresh mutable value and drop the frozen
                # contract (#539).
                raw = getattr(args[i], "_east_c_value", None)
                if raw is not None:
                    c_args[i] = <_eastc.EastValue*><uintptr_t>raw
                    _eastc.east_value_retain(c_args[i])
                elif i < n_types:
                    c_args[i] = py_value_to_c(args[i], <_eastc.EastType*><uintptr_t>input_type_ptrs[i])
                else:
                    c_args[i] = _eastc.east_null()
        except:
            for j in range(i):
                _eastc.east_value_release(c_args[j])
            if heap_allocated:
                free(c_args)
            # Cold path: if the failing argument is a trace-time proxy, the
            # caller is a traced lambda trying to RE-TRACE this compiled
            # function — name that instead of the opaque conversion error, so
            # it reaches the capture error's cause chain (#558 C).
            from east.expression import Expression as _Expression
            found_proxy = False
            for j in range(nargs):
                if isinstance(args[j], _Expression):
                    found_proxy = True
                    break
            if found_proxy:
                from east.runtime.errors import NonRetraceableCallError
                raise NonRetraceableCallError(
                    "a compiled/bound East function cannot be re-traced inside "
                    "another trace — call it from python (per-element), or pass "
                    "it directly to the eager method (native pass-through)"
                )
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
        if result.value.kind == _eastc.EAST_VAL_PAGED:
            # A paged input returned as the output hydrates here — the py
            # decode walks eager values.
            hydrated_val = _eastc.east_paged_hydrated(result.value)
            if hydrated_val == NULL:
                _eastc.east_value_release(result.value)
                err_c = _eastc.east_builtin_get_error()
                msg = err_c.decode("utf-8") if err_c != NULL else "failed to hydrate the paged output"
                free(err_c)
                from east.runtime.errors import EastError
                raise EastError(msg, [])
            _eastc.east_value_retain(hydrated_val)
            _eastc.east_value_release(result.value)
            result.value = hydrated_val
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

    # The location stack for EastError — a plain list of {filename, line,
    # column} structs (error-reporting data; no need for a C-backed array).
    from east.runtime.errors import EastError

    location_array = _error_locations(&result)

    if result.value != NULL:
        _eastc.east_value_release(result.value)
    _eastc.eval_result_free(&result)

    raise EastError(msg, location_array)


def _release_handle(uintptr_t compiled_ptr, uintptr_t platform_ptr,
                     uintptr_t ir_val_ptr, list input_type_ptrs,
                     uintptr_t output_type_ptr):
    """Release C resources held by a compiled function handle."""
    if compiled_ptr != 0:
        _eastc.east_compiled_fn_free(<_eastc.EastCompiledFn*>compiled_ptr)
    if platform_ptr != 0:
        _eastc.platform_registry_release(<_eastc.PlatformRegistry*>platform_ptr)
    if ir_val_ptr != 0:
        _eastc.east_value_release(<_eastc.EastValue*>ir_val_ptr)
    for ptr in input_type_ptrs:
        _eastc.east_type_release(<_eastc.EastType*><uintptr_t>ptr)
    if output_type_ptr != 0:
        _eastc.east_type_release(<_eastc.EastType*>output_type_ptr)
