#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The expression builders: ``East.function`` and its compile entry points.

``East.function(param_types, out, body)`` runs ``body`` ONCE over typed
expression proxies and compiles the recorded IR — the python twin of the
TypeScript builder, name-for-name (#623/#625). ``East.asyncFunction`` builds
the AsyncFunction twin, ``East.compile`` / ``East.compileAsync`` compile a
builder artifact against platform implementations, and ``trace`` is the shared
capture step every path uses (the eager methods' automatic push-down included).
``trace_builtin_call`` is the hook the eager builtin funnel calls when it
notices a traced argument.

A build opens an authoring-frame source map (``east.expression.location``,
#626): every node the body builds carries the ``loc_id`` of the python
frames that built it, the artifact carries the map (``_east_source_map``),
and the compile hands it to east-c — so a runtime error inside the function
names the python ``file:line:column`` of the failing expression, and the
function's beast2 encoding carries the map for every other runner.
"""

from __future__ import annotations

from typing import Any

from east.expression.errors import ExpressionError
from east.expression.expr import Expression
from east.expression.finalize import _function_ir
from east.expression.lift import (
    _clear_registries,
    _effect_frames,
    _lift,
    _pop_effects,
    _push_effects,
    _push_registries,
    _registry_entries,
    _trace_inner_fn,
)
from east.expression.location import SourceMap, source_map_scope
from east.expression.nodes import _builtin, _var
from east.types.types import EastType

#: Whether the build currently on the stack is an ``East.asyncFunction`` —
#: what lets a platform declaration handle reject an async call spelled
#: inside a sync body at build time.
_async_build = False


def _in_async_build() -> bool:
    """Whether the open build is an ``East.asyncFunction`` body."""
    return _async_build


def trace_builtin_call(
    name: str, type_params: list, args: list, output_type: EastType
) -> Expression | None:
    """The eager-builtin funnel's kernel hook (#393).

    ``_call_builtin`` (east/types/values/_helpers.py) routes every namespace
    builtin (``East.String.*``, ``East.Float.*``, …) and eager collection
    method through one funnel. When any argument is a traced expression the
    call is happening INSIDE a builder body — emit a Builtin IR node instead
    of executing eagerly. Returns None (caller runs the eager path) when no
    argument is traced.

    Callback arguments (``EastFunction``) are traced recursively against
    their declared signature; captured East collections/structs inline as
    constructor IR via ``_lift``.
    """
    if not any(isinstance(a, Expression) for a in args):
        return None
    from east.types.values.structural import EastFunction

    ir_args: list[dict] = []
    for a in args:
        if isinstance(a, EastFunction):
            node, out_t = _trace_inner_fn(a.fn, list(a.input_types))
            if out_t != a.output_type:
                raise ExpressionError(
                    f"traced callback for {name} returns {out_t.type}, "
                    f"declared {a.output_type.type}"
                )
            ir_args.append(node)
        else:
            ir_args.append(_lift(a).ir)
    return Expression(_builtin(name, output_type, list(type_params), ir_args), output_type)


def trace(fn: Any, param_types: list[EastType],
          out_hint: EastType | None = None,
          is_async: bool = False) -> tuple[Any, EastType, list]:
    """Trace ``fn`` over expression proxies; return
    ``(IR value, output type, called-function binds)``.

    The IR value is homoiconic — an ``EastVariant`` conforming to ``IRType``
    (compile with ``compile_from_value``). Raises ExpressionError when the
    lambda performs untraceable operations. ``out_hint`` types the traced
    result expression — the build's declared output — which is what lets
    the root build a general variant or an ``if_else`` over variant arms
    (#541). ``is_async`` assembles the AsyncFunction node instead of the
    Function node (``East.asyncFunction``).

    The third element carries the compiled East function values the lambda
    CALLED (#561), in hidden-trailing-parameter order: the returned IR
    declares one extra trailing parameter per entry, and the caller must
    ``bind(*binds)`` the compiled result so those calls resolve. Empty for
    lambdas that call no compiled functions.

    Node locations come from the AMBIENT source map: the builder entries
    (``East.function``, ``capture_callback``) open one with
    ``source_map_scope`` around this call and hand it to the compile; a bare
    ``trace`` (a type-only derivation, a test) captures none — every
    ``loc_id`` is 0 — and costs no frame walk.
    """
    proxies = [Expression(_var(f"__k{i}", t), t) for i, t in enumerate(param_types)]
    outer = _push_registries()
    _push_effects()
    popped = False
    try:
        try:
            result = fn(*proxies)
        except ExpressionError:
            raise
        except Exception as e:
            raise ExpressionError(f"the function body is not traceable: {e}") from e
        result = _lift(result, hint=out_hint)
        popped = True
        _pop_effects(result.ir)
        consts, fn_consts = _registry_entries() if outer else ([], [])
    finally:
        if not popped:
            _effect_frames.pop()
        if outer:
            _clear_registries()
    params = [_var(f"__k{i}", t) for i, t in enumerate(param_types)]
    all_types = list(param_types) + [t for _name, _hold, t in fn_consts]
    all_params = params + [_var(name, t) for name, _hold, t in fn_consts]
    ir = _function_ir(all_types, all_params, result, consts, is_async=is_async)
    return ir, result.east_type, [hold for _name, hold, _t in fn_consts]


def _platform_deps(ir_value: Any) -> tuple[tuple[str, bool], ...]:
    """The Platform declarations an IR value references, in first-use order.

    Each entry is ``(name, is_async)``. This is what decides whether a built
    function can compile eagerly (no deps) or must go through ``East.compile``
    with implementations — and, in phase 4, what the export manifest records.
    """
    from east.types.values import is_east_struct, is_east_variant

    deps: dict[str, bool] = {}
    seen: set[int] = set()

    def walk(node: Any) -> None:
        if id(node) in seen:
            return
        seen.add(id(node))
        if is_east_variant(node):
            payload = node.value
            if node.type == "Platform" and payload["name"] not in deps:
                deps[payload["name"]] = bool(payload["async"])
            if is_east_struct(payload):
                for fname, v in payload.items():
                    if fname in ("type", "loc_id", "type_parameters"):
                        continue
                    walk(v)
            return
        if is_east_struct(node):
            for _f, v in node.items():
                walk(v)
            return
        if isinstance(node, (list, tuple)) or hasattr(node, "element_type"):
            for x in node:
                walk(x)

    walk(ir_value)
    return tuple(deps.items())


class _PlatformFunction:
    """An ``East.function`` whose body declares platform calls.

    A first-class value — its IR is carried whole, it splices into other
    builder bodies, and (phase 4) it exports — but it cannot EXECUTE until
    the named platform implementations arrive: calling it uncompiled raises
    the same error an unavailable platform function raises at run time, with
    the ``East.compile`` fix-it.
    """

    def __init__(self, fn: Any, ir_value: Any, out_type: EastType,
                 param_types: list[EastType], fn_binds: list,
                 deps: tuple, is_async: bool, source_map: SourceMap | None) -> None:
        self._fn = fn
        self._east_ir = ir_value
        self._east_out_type = out_type
        self._east_param_types = tuple(param_types)
        self._east_fn_binds = tuple(fn_binds)
        self._east_platforms = deps
        self._east_is_async = is_async
        self._east_retrace = fn
        self._east_source_map = source_map

    def __repr__(self) -> str:
        names = ", ".join(name for name, _a in self._east_platforms)
        return f"<East.function declaring platform {names} (uncompiled)>"

    def __call__(self, *args: Any) -> Any:
        if any(isinstance(a, Expression) for a in args):
            # Composition: splice this function's expression into the
            # surrounding build by re-running its (pure) body.
            return self._fn(*args)
        from east.runtime.errors import EastError

        entry = "East.compileAsync" if self._east_is_async else "East.compile"
        name = self._east_platforms[0][0]
        raise EastError(
            f"Platform function '{name}' is not available — compile with "
            f"{entry}(fn, platform=[...])",
            [],
        )


def _assemble(fn: Any, ir_value: Any, out_type: EastType,
              param_types: list[EastType], fn_binds: list,
              is_async: bool, source_map: SourceMap | None) -> Any:
    """Compile a traced body and wrap it as the dual-mode artifact — or, when
    the body declares platform calls, return the uncompiled first-class value
    (``East.compile`` finishes it). ``source_map`` is the build's authoring
    map: the compile hands it to east-c and the artifact carries it."""
    deps = _platform_deps(ir_value)
    if deps:
        return _PlatformFunction(fn, ir_value, out_type, param_types,
                                 fn_binds, deps, is_async, source_map)
    from east.runtime.compiler import compile_from_value

    compiled = compile_from_value(ir_value, is_async=is_async, source_map=source_map)
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
        if any(isinstance(a, Expression) for a in args):
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
    kernel_callable._east_fn_binds = tuple(fn_binds)
    kernel_callable._east_platforms = ()
    kernel_callable._east_is_async = is_async
    kernel_callable._east_source_map = source_map
    return kernel_callable


def _build(param_types: Any, out: Any, body: Any, *, is_async: bool, entry: str) -> Any:
    """The shared strict-builder core behind ``East.function``/``asyncFunction``."""
    if isinstance(param_types, EastType) or not isinstance(param_types, (list, tuple)):
        raise TypeError(
            f"{entry}(param_types, out, body) takes a LIST of parameter East "
            f"types first — got {type(param_types).__name__}; a zero-parameter "
            "function takes []"
        )
    types = list(param_types)
    for i, t in enumerate(types):
        if not isinstance(t, EastType):
            raise TypeError(
                f"{entry} parameter type {i} is not an East type "
                f"(got {type(t).__name__})"
            )
    if not isinstance(out, EastType):
        raise TypeError(
            f"{entry}(param_types, out, body) requires the declared output "
            f"East type second — got {type(out).__name__}"
        )
    if not callable(body):
        raise TypeError(f"{entry} body must be callable, got {type(body).__name__}")
    global _async_build
    previous = _async_build
    _async_build = is_async
    try:
        # The build's source map: fresh, or the enclosing build's when this
        # function is being built inside another body (#626).
        with source_map_scope() as source_map:
            ir_value, out_type, fn_binds = trace(body, types, out_hint=out, is_async=is_async)
    finally:
        _async_build = previous
    if out_type != out:
        raise ExpressionError(
            f"{entry} body produced {out_type.type}, declared out is {out.type}"
        )
    return _assemble(body, ir_value, out_type, types, fn_binds, is_async, source_map)


def function(param_types: list[EastType], out: EastType, body: Any) -> Any:
    """Build an East function from a python body — the strict expression
    builder, mirroring the TypeScript ``East.function`` (#625).

    ``body`` receives one typed expression per parameter and runs ONCE, at
    definition time; the expression it returns is the function's whole
    behavior. Anything East cannot express raises immediately — there is no
    purity gate and no per-element python fallback.

    Args:
        param_types: The parameter East types, in order (``[]`` for a
            zero-parameter function). A list is required; there is no
            single-type shorthand.
        out: The declared output East type. Required, and enforced: a body
            whose built expression has a different type raises immediately,
            naming both types. The declared type also types the root
            expression, so a body may return a general ``variant(case, …)``
            or an ``if_else`` over variant arms (#541).
        body: The python callable to capture.

    Returns:
        A python callable. A PURE body compiles immediately: the result runs
        natively, every eager collection method accepts it, ``.bind(*values)``
        pre-binds trailing parameters by reference (#399), and referencing it
        inside another builder body splices its expression into that build
        (#470/#561). A body that calls ``East.platform`` declarations returns
        the same first-class value UNCOMPILED — calling it raises
        ``Platform function '<name>' is not available`` until
        :func:`compile_` (``East.compile``) pairs it with implementations.

        A runtime error raised inside the function carries the python
        ``file:line:column`` of the expression that raised it
        (``EastError.location``, innermost frame first), and the function's
        beast2 encoding carries the same source map (#626).

    Raises:
        TypeError: If ``param_types`` is not a list of East types, ``out`` is
            missing or not an East type, or ``body`` is not callable.
        ExpressionError: If the body performs an operation with no East
            spelling, or its built expression type differs from ``out``.
    """
    return _build(param_types, out, body, is_async=False, entry="East.function")


def async_function(param_types: list[EastType], out: EastType, body: Any) -> Any:
    """Build an East ASYNC function — the ``East.asyncFunction`` twin of
    :func:`function`, for bodies that call ``East.asyncPlatform`` declarations.

    The artifact carries an ``AsyncFunction`` IR node; compile it with
    ``East.compileAsync`` and the compiled callable returns a coroutine.
    A sync body calling an async platform declaration is a build-time error
    (raised by the declaration handle), so the async-ness of a program is
    visible in its spelling, exactly as in TypeScript.

    Args:
        param_types: The parameter East types, in order.
        out: The declared output East type (required and enforced).
        body: The python callable to capture — it still runs once,
            synchronously, at build time; only the COMPILED artifact is async.

    Returns:
        The built artifact: uncompiled when platform declarations are
        present (compile with ``East.compileAsync``); a pure async body
        compiles immediately into a callable returning coroutines.

    Raises:
        TypeError: If the signature arguments are malformed (see
            :func:`function`).
        ExpressionError: If the body is untraceable or its type differs
            from ``out``.
    """
    return _build(param_types, out, body, is_async=True, entry="East.asyncFunction")


def _artifact_ir(fn: Any, entry: str) -> tuple[Any, bool, tuple, SourceMap | None]:
    """``(IR value, is_async, fn_binds, source map)`` for a compile entry's
    argument — a builder artifact (carries ``_east_ir`` and, when it was
    built, ``_east_source_map``) or a raw homoiconic IR value (no map)."""
    from east.types.values import is_east_variant

    ir = getattr(fn, "_east_ir", None)
    if ir is not None:
        return ir, bool(getattr(fn, "_east_is_async", False)), \
            tuple(getattr(fn, "_east_fn_binds", ())), \
            getattr(fn, "_east_source_map", None)
    if is_east_variant(fn):
        node = fn
        if node.type == "Block":
            statements = node.value["statements"]
            node = statements[len(statements) - 1]
        return fn, node.type == "AsyncFunction", (), None
    raise TypeError(
        f"{entry} takes an East.function result or a homoiconic IR value, "
        f"got {type(fn).__name__}"
    )


def compile_(fn: Any, platform: list | None = None) -> Any:
    """Compile a built East function against platform implementations —
    the public ``East.compile``, a thin name over ``compile_from_value``.

    Platform-signature validation runs inside the east-c compile with the
    same error text the TS analyzer produces — a mismatch names the offending
    call by its python ``file:line:column`` when ``fn`` is a builder artifact
    (its source map is installed for the compile, #626); a platform the list
    does not provide compiles to a stub that raises at the call, exactly like
    the TS ``East.compile``.

    Args:
        fn: An ``East.function`` result (pure or platform-declaring) or a
            homoiconic IR value built with ``east.ir.builders``.
        platform: The ``PlatformFunction`` implementations to link
            (``@platform_function`` results, or entries built by hand).

    Returns:
        The compiled native callable, immediately executable.

    Raises:
        TypeError: If ``fn`` was built with ``East.asyncFunction`` (compile
            it with ``East.compileAsync``) or is not a builder artifact/IR
            value.
    """
    ir, is_async, binds, source_map = _artifact_ir(fn, "East.compile()")
    if is_async:
        raise TypeError(
            "this function was built with East.asyncFunction — compile it "
            "with East.compileAsync(fn, platform=[...])"
        )
    from east.runtime.compiler import compile_from_value

    compiled = compile_from_value(ir, list(platform or []), source_map=source_map)
    if binds:
        compiled = compiled.bind(*binds)
    return compiled


def compile_async(fn: Any, platform: list | None = None) -> Any:
    """Compile a built East ASYNC function — the public ``East.compileAsync``.

    Args:
        fn: An ``East.asyncFunction`` result or a homoiconic ``AsyncFunction``
            IR value.
        platform: The ``PlatformFunction`` implementations to link (sync and
            async entries both).

    Returns:
        The compiled callable; calling it returns a coroutine to await.

    Raises:
        TypeError: If ``fn`` was built with the sync ``East.function``
            (compile it with ``East.compile``) or is not a builder
            artifact/IR value.
    """
    ir, is_async, binds, source_map = _artifact_ir(fn, "East.compileAsync()")
    if not is_async:
        raise TypeError(
            "this function was built with East.function — compile it with "
            "East.compile(fn, platform=[...])"
        )
    from east.runtime.compiler import compile_from_value

    compiled = compile_from_value(ir, list(platform or []), is_async=True,
                                  source_map=source_map)
    if binds:
        compiled = compiled.bind(*binds)
    return compiled
