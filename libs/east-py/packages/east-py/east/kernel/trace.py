#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Running a lambda over expression proxies, and compiling the result.

``trace`` is the entry point every path shares — the explicit ``kernel(...)``
call, the eager methods' automatic push-down, and the type-only probe. It runs
the lambda ONCE against proxies, lifts the result, and assembles the kernel's
Function node. ``trace_builtin_call`` is the hook the eager builtin funnel
calls when it notices a traced argument.
"""

from __future__ import annotations

from typing import Any

from east.kernel.errors import KernelTraceError
from east.kernel.expr import KernelExpr
from east.kernel.finalize import _function_ir
from east.kernel.lift import (
    _clear_registries,
    _lift,
    _push_registries,
    _registry_entries,
    _trace_inner_fn,
)
from east.kernel.nodes import _builtin, _var
from east.types.types import EastType


def trace_builtin_call(
    name: str, type_params: list, args: list, output_type: EastType
) -> KernelExpr | None:
    """The eager-builtin funnel's kernel hook (#393).

    ``_call_builtin`` (east/types/values/_helpers.py) routes every namespace
    builtin (``East.String.*``, ``East.Float.*``, …) and eager collection
    method through one funnel. When any argument is a traced expression the
    call is happening INSIDE a kernel lambda — emit a Builtin IR node instead
    of executing eagerly. Returns None (caller runs the eager path) when no
    argument is traced.

    Callback arguments (``EastFunction``) are traced recursively against
    their declared signature; captured East collections/structs inline as
    constructor IR via ``_lift``.
    """
    if not any(isinstance(a, KernelExpr) for a in args):
        return None
    from east.types.values.structural import EastFunction

    ir_args: list[dict] = []
    for a in args:
        if isinstance(a, EastFunction):
            node, out_t = _trace_inner_fn(a.fn, list(a.input_types))
            if out_t != a.output_type:
                raise KernelTraceError(
                    f"traced callback for {name} returns {out_t.type}, "
                    f"declared {a.output_type.type}"
                )
            ir_args.append(node)
        else:
            ir_args.append(_lift(a).ir)
    return KernelExpr(_builtin(name, output_type, list(type_params), ir_args), output_type)


def trace(fn: Any, param_types: list[EastType],
          out_hint: EastType | None = None) -> tuple[Any, EastType, list]:
    """Trace ``fn`` over expression proxies; return
    ``(IR value, output type, called-function binds)``.

    The IR value is homoiconic — an ``EastVariant`` conforming to ``IRType``
    (compile with ``compile_from_value``). Raises KernelTraceError when the
    lambda performs untraceable operations. ``out_hint`` types the traced
    result expression — the kernel's declared ``out=`` — which is what lets
    the root build a general variant or a ``where`` over variant branches
    (#541).

    The third element carries the compiled East function values the lambda
    CALLED (#561), in hidden-trailing-parameter order: the returned IR
    declares one extra trailing parameter per entry, and the caller must
    ``bind(*binds)`` the compiled result so those calls resolve. Empty for
    lambdas that call no compiled functions.
    """
    proxies = [KernelExpr(_var(f"__k{i}", t), t) for i, t in enumerate(param_types)]
    outer = _push_registries()
    try:
        try:
            result = fn(*proxies)
        except KernelTraceError:
            raise
        except Exception as e:
            raise KernelTraceError(f"kernel lambda is not traceable: {e}") from e
        result = _lift(result, hint=out_hint)
        consts, fn_consts = _registry_entries() if outer else ([], [])
    finally:
        if outer:
            _clear_registries()
    params = [_var(f"__k{i}", t) for i, t in enumerate(param_types)]
    all_types = list(param_types) + [t for _name, _hold, t in fn_consts]
    all_params = params + [_var(name, t) for name, _hold, t in fn_consts]
    ir = _function_ir(all_types, all_params, result, consts)
    return ir, result.east_type, [hold for _name, hold, _t in fn_consts]


def kernel(param_types: EastType | list[EastType], fn: Any = None, *, out: EastType | None = None) -> Any:
    """Trace and compile a python lambda into a native East kernel.

    The returned object is an ordinary python callable (arguments are
    marshalled through east-c) that every eager collection method accepts —
    when passed to ``map``/``filter``/``fold``/… the loop and the kernel both
    execute natively, with no per-element python.

    Args:
        param_types: East type of the lambda's parameter, or a list of types
            for multi-parameter kernels (e.g. ``fold`` steps take
            ``[acc_type, element_type]``).
        fn: The lambda to trace. When omitted, returns a decorator.
        out: Optional expected output type; a traced output of a different
            type raises TypeError.

    Returns:
        The compiled kernel callable. It is dual-mode (#470): called with
        plain values it executes natively; called with trace proxies — from
        inside another ``kernel()`` lambda, or a wrapper an eager method is
        tracing — it re-runs its source lambda so its expression splices
        into the surrounding trace. Kernels therefore compose: referencing
        one from another kernel or from any pure wrapper keeps the whole
        loop native. Its ``.bind(*values)`` method pre-binds the TRAILING
        parameters to live East values by reference (C-level partial
        application, #399) — the bound callable stays native, is zero-copy
        at any table size, and observes later mutations to bound
        collections (bound callables are not re-traceable).

    Raises:
        KernelTraceError: If the lambda cannot be traced (uses python
            ``if``/``and``/``or``, calls host libraries, etc.).
        TypeError: If ``out`` is given and the traced output type differs.
    """
    types = [param_types] if isinstance(param_types, EastType) else list(param_types)
    if fn is None:
        return lambda f: kernel(types, f, out=out)
    ir_value, out_type, fn_binds = trace(fn, types, out_hint=out)
    if out is not None and out != out_type:
        raise TypeError(f"kernel output is {out_type.type}, expected {out.type}")
    from east.runtime.compiler import compile_from_value

    compiled = compile_from_value(ir_value)
    if fn_binds:
        # The lambda called compiled East function values (#561): they are
        # hidden trailing parameters of the compiled kernel — bind them by
        # reference so the visible signature is the declared one and every
        # call site resolves to its native callee.
        compiled = compiled.bind(*fn_binds)

    def kernel_callable(*args):
        # Dual-mode (#470): called with expression proxies — i.e. from inside
        # another trace, e.g. a composing wrapper like
        # ``lambda el: {"k": key(el), "v": value(el)}`` — re-run the (pure)
        # source lambda on the proxies so this kernel's expression splices
        # inline into the surrounding trace. On plain values, execute natively.
        if any(isinstance(a, KernelExpr) for a in args):
            return fn(*args)
        return compiled(*args)

    # The wrapper carries the compiled callable's whole public surface, so
    # every existing consumer (the native pass-through via _eastc_handle,
    # _mark_kernel, _kernel_out_type, bind) sees an ordinary kernel.
    kernel_callable._eastc_handle = compiled._eastc_handle
    kernel_callable._east_ir = getattr(compiled, "_east_ir", None)
    kernel_callable._east_captures = getattr(compiled, "_east_captures", {})
    kernel_callable.bind = compiled.bind
    kernel_callable._east_compiled = compiled  # owns the C resources; keep alive
    kernel_callable._east_retrace = fn         # marks the callable trace-safe
    return kernel_callable
