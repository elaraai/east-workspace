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

An implementation is paired with the ``East.platform(name, inputs, output)``
declaration a body calls **by name** — the ``def``'s name unless ``name=``
says otherwise — at ``East.compile(fn, platform=[…])``, where a declaration
no implementation matches is the error ``Platform function '<name>' not
found``. An ``East.function`` carries no name of its own: it is a value,
called through the binding that holds it.
"""

import asyncio
import functools
from collections.abc import Callable
from typing import Any, Literal, TypedDict

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

    fn: Callable[..., Any]
    """The actual Python function implementation"""


class GenericPlatformFunction(TypedDict):
    """Generic platform function with type parameters.

    The `fn` field is a factory that receives type arguments and returns
    the actual implementation.

    Example:
        >>> alns = GenericPlatformFunction(
        ...     name="alns_optimize",
        ...     type_parameters=["S"],
        ...     type='sync',
        ...     fn=lambda S: alns_optimize_impl,
        ... )
    """

    name: str
    """The name of the platform function (must match Platform IR node name)"""

    type_parameters: list[str]
    """Type parameter names (e.g., ["S", "T"])"""

    type: Literal["sync", "async"]
    """Whether the function is synchronous or asynchronous"""

    fn: Callable[..., Callable[..., Any]]
    """Factory: fn(*type_params) -> impl where impl(*args) -> result"""


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


def platform_function(
    *,
    inputs: list[EastType],
    output: EastType,
    name: str | None = None,
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

    Args:
        inputs: East types of the parameters, in order.
        output: East type of the return value.
        name: Platform-function name East calls it by (defaults to
            ``fn.__name__``) — it must equal the ``East.platform(name, …)``
            declaration's, which is how ``East.compile`` pairs the two.
        validate_output: Validate the return value against ``output`` (on by
            default — cheap insurance against silent corruption).
        validate_input: Validate each argument against ``inputs`` (off by
            default — it re-walks values the bridge already converted; enable
            while debugging a boundary).

    Returns:
        A decorator returning the (wrapped) function, still directly callable
        from Python, with the ``PlatformFunction`` dict attached as
        ``east_platform_function``.
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        pf_name = name or fn.__name__
        is_async = asyncio.iscoroutinefunction(fn)

        if is_async:
            @functools.wraps(fn)
            async def wrapper(*args: Any) -> Any:
                if validate_input:
                    _validate_inputs(args, inputs)
                result = await fn(*args)
                if validate_output:
                    _validate_output(result, output, pf_name)
                return result
        else:
            @functools.wraps(fn)
            def wrapper(*args: Any) -> Any:
                if validate_input:
                    _validate_inputs(args, inputs)
                result = fn(*args)
                if validate_output:
                    _validate_output(result, output, pf_name)
                return result

        pf: PlatformFunction = {
            "name": pf_name,
            "inputs": list(inputs),
            "output": output,
            "type": "async" if is_async else "sync",
            "fn": wrapper,
        }
        _REGISTRY.setdefault(fn.__module__, []).append(pf)
        wrapper.east_platform_function = pf  # type: ignore[attr-defined]
        return wrapper

    return decorator


def generic_platform_function(
    *,
    type_parameters: list[str],
    name: str | None = None,
    is_async: bool = False,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Register a type-parameterized platform function (the factory convention).

    Additive sugar over :class:`GenericPlatformFunction`: the decorated function
    is the factory ``fn(*type_params) -> impl``. Output validation is not applied
    (the output type depends on the type parameters); auto-collected like
    :func:`platform_function`.

    Args:
        type_parameters: Type-parameter names (e.g. ``["S", "T"]``).
        name: Platform-function name (defaults to ``fn.__name__``).
        is_async: Whether the produced implementation is async.

    Returns:
        A decorator returning the factory unchanged, with the
        ``GenericPlatformFunction`` dict attached as ``east_platform_function``.
    """

    def decorator(factory: Callable[..., Any]) -> Callable[..., Any]:
        gpf: GenericPlatformFunction = {
            "name": name or factory.__name__,
            "type_parameters": list(type_parameters),
            "type": "async" if is_async else "sync",
            "fn": factory,
        }
        _REGISTRY.setdefault(factory.__module__, []).append(gpf)
        factory.east_platform_function = gpf  # type: ignore[attr-defined]
        return factory

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
