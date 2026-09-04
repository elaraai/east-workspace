#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Platform function definitions for East runtime.

Platform functions are the bridge between East IR and the host environment (Python).
They allow East code to call native Python functions (sync or async).

The ``@East.platform_function`` decorator (``platform_function`` bare, the
same object) is the ergonomic on-ramp: it turns a plain Python function into
a registered platform function, inferring sync/async, validating its declared
output (and optionally inputs) against the East type, and auto-collecting it
so a module just exposes ``East.platform_functions(__name__)`` instead of
hand-building a ``PlatformFunction`` list.

The decorated function is DUAL-MODE, as an ``East.function`` artifact is
(#667): called with values it runs the python; called inside an East body —
a build is open — it emits the ``Platform`` IR node with its own declared
signature, so a body calls the implementation directly and no separate
``East.platform(name, inputs, output)`` line restates what the decorator
already holds. ``East.platform`` remains for declaring a function
implemented elsewhere (another package, another runtime). Either way the
pairing at ``East.compile(fn, platform=[…])`` is **by name** — the ``def``'s
name unless ``name=`` says otherwise — and a declaration no implementation
matches is the error ``Platform function '<name>' not found``. An
``East.function`` carries no name of its own: it is a value, called through
the binding that holds it.
"""

import asyncio
import functools
from collections.abc import Callable
from typing import Any, Literal, NotRequired, TypedDict

from east.expression.errors import ExpressionError
from east.expression.lift import _tracing
from east.expression.platform import PlatformDeclaration
from east.types.types import EastType


class PlatformFunction(TypedDict):
    """Represents a platform function callable from East IR.

    Platform functions are defined by the host environment and can be called
    from East IR using Platform nodes. They can be synchronous or asynchronous.

    Example:
        >>> log = PlatformFunction(
        ...     name="log",
        ...     inputs=[StringType],
        ...     output=NullType,
        ...     type='sync',
        ...     fn=print
        ... )
    """

    name: str
    """The name of the platform function (must match Platform IR node name)"""

    inputs: list[EastType]
    """Input parameter types"""

    output: EastType
    """Output/return type"""

    type: Literal["sync", "async"]
    """Whether the function is synchronous or asynchronous (returns a coroutine)"""

    fn: Callable[..., Any] | None
    """The Python implementation; ``None`` when ``c_callback`` supplies it"""

    c_callback: NotRequired[object]
    """A ``PyCapsule`` (``"east_platform_fn"``) wrapping a C ``PlatformFn``:
    east-c calls it directly, with no Python frame (the Cython modules in
    east-py-datascience register this way)"""


class GenericPlatformFunction(TypedDict):
    """Generic platform function with type parameters.

    The `fn` field is a factory that receives type arguments and returns
    the actual implementation.

    Example:
        >>> alns = GenericPlatformFunction(
        ...     name="alns_optimize",
        ...     type_parameters=["S"],
        ...     type='sync',
        ...     fn=lambda S: alns_optimize,
        ... )
    """

    name: str
    """The name of the platform function (must match Platform IR node name)"""

    type_parameters: list[str]
    """Type parameter names (e.g., ["S", "T"])"""

    type: Literal["sync", "async"]
    """Whether the function is synchronous or asynchronous"""

    fn: Callable[..., Callable[..., Any]] | None
    """Factory: fn(*type_params) -> impl where impl(*args) -> result; ``None``
    when ``c_factory`` supplies it"""

    c_factory: NotRequired[object]
    """A ``PyCapsule`` (``"east_generic_factory"``) wrapping a C
    ``GenericPlatformFactory`` that builds the implementation per type argument"""


# =============================================================================
# @platform_function — the ergonomic on-ramp
# =============================================================================

# Module name -> the platform functions decorated in that module, in definition
# order. Retrieved with platform_functions(__name__).
_REGISTRY: dict[str, list[Any]] = {}


def _validate_inputs(args: tuple, inputs: list[EastType]) -> None:
    from east.types.coercion import assert_value_of

    for i, (arg, typ) in enumerate(zip(args, inputs, strict=False)):
        assert_value_of(arg, typ, path=f"$.inputs[{i}]")


def _validate_output(result: Any, output: EastType, name: str) -> None:
    from east.types.coercion import EastTypeError, assert_value_of

    try:
        assert_value_of(result, output, path="$.output")
    except EastTypeError as e:
        raise EastTypeError(
            f"platform function {name!r} returned a value that does not match its declared output: {e.message}",
            value=result,
            expected=output,
            path=e.path,
        ) from None


def _check_signature(entry: str, inputs: Any, output: Any, *, placeholders: bool) -> list:
    """The declared signature, validated where the decorator is written."""
    if isinstance(inputs, EastType) or not isinstance(inputs, (list, tuple)):
        raise TypeError(f"{entry} takes inputs= as a LIST of East types, got {type(inputs).__name__}")
    for i, t in enumerate(inputs):
        if not isinstance(t, EastType) and not (placeholders and isinstance(t, str)):
            raise TypeError(f"{entry} input type {i} is not an East type (got {type(t).__name__})")
    if not isinstance(output, EastType) and not (placeholders and isinstance(output, str)):
        raise TypeError(f"{entry} output= must be an East type, got {type(output).__name__}")
    return list(inputs)


def platform_function(
    *,
    inputs: list[EastType],
    output: EastType,
    name: str | None = None,
    is_async: bool | None = None,
    validate_output: bool = True,
    validate_input: bool = False,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Register a Python function as an East platform function.

    Additive sugar over the :class:`PlatformFunction` TypedDict: it emits the
    same dict (so nothing downstream changes), infers ``sync``/``async`` from
    the function, auto-collects it into the defining module's registry (so the
    module exposes ``platform_functions(__name__)`` instead of a hand-built
    list), and wraps the call to validate the result against ``output`` — a
    named ``EastTypeError`` instead of a cryptic downstream failure.

    The wrapper is dual-mode (#667). Called with values it runs ``fn`` (an
    async ``fn`` returns its coroutine, to ``await`` as before). Called inside
    an ``East.function`` / ``East.asyncFunction`` body it emits the
    ``Platform`` node with this signature — exactly what
    ``East.platform(name, inputs, output)(*args)`` would emit — so the body
    needs no separate declaration; an async implementation called inside a
    sync body is the build-time error the declaration handle raises.

    Args:
        inputs: East types of the parameters, in order.
        output: East type of the return value.
        name: Platform-function name East calls it by (defaults to
            ``fn.__name__``) — the name a body's call carries, and what
            ``East.compile`` pairs the implementation with.
        is_async: The DECLARED asyncness, when it differs from the ``def``'s
            (``test`` and ``describe`` are async on every runtime while their
            python is a plain ``def``). Defaults to the ``def``'s.
        validate_output: Validate the return value against ``output`` (on by
            default — cheap insurance against silent corruption).
        validate_input: Validate each argument against ``inputs`` (off by
            default — it re-walks values the bridge already converted; enable
            while debugging a boundary).

    Returns:
        A decorator returning the (wrapped) function, still directly callable
        from Python, with the ``PlatformFunction`` dict attached as
        ``east_platform_function`` and the declaration handle it emits in a
        body as ``east_platform_declaration``.

    Raises:
        TypeError: If ``inputs`` is not a list of East types or ``output`` is
            not an East type — where the decorator is written.
    """
    declared = _check_signature("@East.platform_function", inputs, output, placeholders=False)

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        pf_name = name or fn.__name__
        # What the python IS decides how it is called; what East DECLARES
        # decides the node and the record — normally the same thing.
        awaitable = asyncio.iscoroutinefunction(fn)
        if is_async is False and awaitable:
            # The other way round is the point of the override; this way the
            # runner would never await the coroutine and East would take it
            # for the value.
            raise TypeError(
                f"@East.platform_function(is_async=False) on the async def {pf_name!r} — "
                "an async implementation is declared async")
        declared_async = awaitable if is_async is None else is_async
        declaration = PlatformDeclaration(pf_name, declared, output, is_async=declared_async)

        if awaitable:
            async def run(*args: Any) -> Any:
                if validate_input:
                    _validate_inputs(args, declared)
                result = await fn(*args)
                if validate_output:
                    _validate_output(result, output, pf_name)
                return result
        else:
            def run(*args: Any) -> Any:
                if validate_input:
                    _validate_inputs(args, declared)
                result = fn(*args)
                if validate_output:
                    _validate_output(result, output, pf_name)
                return result

        # One sync entry for both modes: the dispatch has to happen before a
        # coroutine exists, so an async implementation's coroutine is `run`'s
        # return value, awaited by the caller as before.
        @functools.wraps(fn)
        def wrapper(*args: Any) -> Any:
            if _tracing():
                return declaration(*args)
            return run(*args)

        pf: PlatformFunction = {
            "name": pf_name,
            "inputs": list(declared),
            "output": output,
            "type": "async" if declared_async else "sync",
            "fn": wrapper,
        }
        _REGISTRY.setdefault(fn.__module__, []).append(pf)
        wrapper.east_platform_function = pf  # type: ignore[attr-defined]
        wrapper.east_platform_declaration = declaration  # type: ignore[attr-defined]
        return wrapper

    return decorator


def generic_platform_function(
    *,
    type_parameters: list[str],
    name: str | None = None,
    is_async: bool = False,
    inputs: list | None = None,
    output: Any = None,
    type_erased: bool = False,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Register a type-parameterized platform function (the factory convention).

    Additive sugar over :class:`GenericPlatformFunction`: the decorated function
    is the factory ``fn(platform, *type_args) -> impl``. Output validation is
    not applied (the output type depends on the type parameters);
    auto-collected like :func:`platform_function`.

    With ``type_erased=True`` the decorated function is the IMPLEMENTATION
    instead — for a function whose behaviour does not vary with the type
    arguments (it reads the values, not the types). The factory the runtime
    binds is derived, and a python call runs the implementation directly:
    ``causal_experiment(rows, config)`` keeps working while the same name,
    inside a body, is ``causal_experiment(RowType, rows, config)``.

    With ``inputs`` and ``output`` declared — East types, or the type
    parameters' names as placeholders (``inputs=[StringType], output="T"``) —
    the factory is dual-mode too (#667): called inside an East body with the
    type arguments first, ``open_beast(DictType(K, V), path)``, it emits the
    generic ``Platform`` node exactly as the ``East.genericPlatform``
    declaration of the same signature would (which takes its type arguments
    spread or as a list, either way). Without them a body call is a
    build-time error naming what to declare.

    Args:
        type_parameters: Type-parameter names (e.g. ``["S", "T"]``).
        name: Platform-function name (defaults to ``fn.__name__``).
        is_async: Whether the produced implementation is async.
        inputs: The declared input types, with placeholders — for body calls.
        output: The declared output type, or a placeholder — for body calls.
        type_erased: The decorated function is the implementation, not the
            factory — legal exactly when the implementation ignores the type
            arguments.

    Returns:
        A decorator returning the (wrapped) factory, with the
        ``GenericPlatformFunction`` dict attached as ``east_platform_function``
        and — when the signature is declared — the declaration handle as
        ``east_platform_declaration``.

    Raises:
        TypeError: If only one of ``inputs`` / ``output`` is given, or either
            is malformed.
    """
    if (inputs is None) != (output is None):
        raise TypeError("@East.generic_platform_function takes inputs= and output= together")
    declared = (_check_signature("@East.generic_platform_function", inputs, output, placeholders=True)
                if inputs is not None else None)

    def decorator(decorated: Callable[..., Any]) -> Callable[..., Any]:
        gpf_name = name or decorated.__name__
        declaration = (PlatformDeclaration(gpf_name, declared, output, is_async=is_async,
                                           type_params=list(type_parameters))
                       if declared is not None else None)
        # The runtime always binds a factory; a type-erased implementation is
        # the same one whatever the type arguments are. Either way a python
        # call runs the decorated function itself.
        factory = ((lambda _platform, *_type_args: decorated) if type_erased else decorated)

        @functools.wraps(decorated)
        def wrapper(*args: Any) -> Any:
            if not _tracing():
                return decorated(*args)
            if declaration is None:
                raise ExpressionError(
                    f"generic platform function '{gpf_name}' has no declared signature to call "
                    "inside an East body — give @East.generic_platform_function inputs= and "
                    "output= (the type parameters' names as placeholders), or declare it with "
                    "East.genericPlatform")
            return declaration(*args)

        gpf: GenericPlatformFunction = {
            "name": gpf_name,
            "type_parameters": list(type_parameters),
            "type": "async" if is_async else "sync",
            "fn": factory if type_erased else wrapper,
        }
        _REGISTRY.setdefault(decorated.__module__, []).append(gpf)
        wrapper.east_platform_function = gpf  # type: ignore[attr-defined]
        wrapper.east_platform_declaration = declaration  # type: ignore[attr-defined]
        return wrapper

    return decorator


def platform_functions(module: str | Any) -> list[Any]:
    """The platform functions decorated in ``module`` (name or module object), in order."""
    mod_name = module if isinstance(module, str) else getattr(module, "__name__", str(module))
    return list(_REGISTRY.get(mod_name, []))


__all__ = [
    "PlatformFunction",
    "GenericPlatformFunction",
    "platform_function",
    "generic_platform_function",
    "platform_functions",
]
