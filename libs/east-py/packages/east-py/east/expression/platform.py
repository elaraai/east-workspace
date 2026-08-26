#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Platform declaration handles — the expression-level ``Platform`` spelling.

``East.platform(name, inputs, output)`` declares a platform call the way the
TypeScript surface does: the handle is callable inside ``East.function``
bodies and emits the ``Platform`` IR node with the declared signature.
``@platform_function`` remains the IMPLEMENTATION side; ``East.compile``
pairs the two. Before this module, ``Platform`` nodes entered python only
through raw ``east.ir.builders.ir_platform`` or TS-exported IR (#623
addendum 1).
"""

from __future__ import annotations

from typing import Any

from east.expression.errors import ExpressionError
from east.expression.lift import _lift, _tracing
from east.expression.nodes import _k_platform
from east.types.types import EastType


class PlatformDeclaration:
    """A declared platform call — the handle ``East.platform`` returns.

    Calling the handle inside an ``East.function`` body emits the ``Platform``
    IR node with this declaration's signature; the implementation arrives at
    ``East.compile`` time as a ``PlatformFunction`` entry with the same name.
    Outside a build there is nothing to execute — declarations have no eager
    behavior — so a plain call raises with the builder fix-it.
    """

    __slots__ = ("name", "inputs", "output", "is_async")

    def __init__(self, name: str, inputs: list[EastType], output: EastType,
                 is_async: bool) -> None:
        entry = "East.asyncPlatform" if is_async else "East.platform"
        if not isinstance(name, str) or not name:
            raise TypeError(f"{entry} name must be a non-empty string")
        if isinstance(inputs, EastType) or not isinstance(inputs, (list, tuple)):
            raise TypeError(
                f"{entry}(name, inputs, output) takes a LIST of input East "
                f"types — got {type(inputs).__name__}"
            )
        for i, t in enumerate(inputs):
            if not isinstance(t, EastType):
                raise TypeError(
                    f"{entry} input type {i} is not an East type "
                    f"(got {type(t).__name__})"
                )
        if not isinstance(output, EastType):
            raise TypeError(
                f"{entry} output must be an East type, got {type(output).__name__}"
            )
        self.name = name
        self.inputs = tuple(inputs)
        self.output = output
        self.is_async = is_async

    def __repr__(self) -> str:
        kind = "asyncPlatform" if self.is_async else "platform"
        return f"<East.{kind} '{self.name}'>"

    def __call__(self, *args: Any) -> Any:
        from east.expression.expr import Expression
        from east.expression.function import _in_async_build

        if not _tracing():
            raise ExpressionError(
                f"platform declaration '{self.name}' is expression-level — "
                "call it inside an East.function / East.asyncFunction body "
                "and compile the result with East.compile"
            )
        if self.is_async and not _in_async_build():
            raise ExpressionError(
                f"async platform declaration '{self.name}' called inside a "
                "sync East.function body — build with East.asyncFunction and "
                "compile with East.compileAsync"
            )
        if len(args) != len(self.inputs):
            raise ExpressionError(
                f"platform declaration '{self.name}' takes "
                f"{len(self.inputs)} argument(s), called with {len(args)}"
            )
        arg_exprs = []
        for i, (a, t) in enumerate(zip(args, self.inputs, strict=True)):
            e = _lift(a, hint=t)
            if e.east_type != t:
                raise ExpressionError(
                    f"platform declaration '{self.name}' argument {i} has "
                    f"East type {e.east_type.type}, the declaration expects "
                    f"{t.type}"
                )
            arg_exprs.append(e)
        node = _k_platform(self.name, self.output, [e.ir for e in arg_exprs],
                           self.is_async)
        return Expression(node, self.output)


def platform(name: str, inputs: list[EastType], output: EastType) -> PlatformDeclaration:
    """Declare a SYNC platform call — the public ``East.platform``.

    The returned handle is callable inside ``East.function`` /
    ``East.asyncFunction`` bodies and emits the ``Platform`` IR node with the
    declared signature; pair it with a ``@platform_function`` implementation
    of the same name at ``East.compile`` time.

    Args:
        name: The platform function name — must match the implementation's
            registered name exactly.
        inputs: The declared input East types, in order.
        output: The declared output East type.

    Returns:
        The declaration handle.

    Raises:
        TypeError: If ``name`` is empty, ``inputs`` is not a list of East
            types, or ``output`` is not an East type.
    """
    return PlatformDeclaration(name, inputs, output, is_async=False)


def async_platform(name: str, inputs: list[EastType], output: EastType) -> PlatformDeclaration:
    """Declare an ASYNC platform call — the public ``East.asyncPlatform``.

    Callable only inside ``East.asyncFunction`` bodies (a sync body calling
    an async declaration is a build-time error); the compiled program awaits
    the implementation coroutine.

    Args:
        name: The platform function name — must match the implementation's
            registered name exactly.
        inputs: The declared input East types, in order.
        output: The declared output East type.

    Returns:
        The declaration handle.

    Raises:
        TypeError: If the signature arguments are malformed (see
            :func:`platform`).
    """
    return PlatformDeclaration(name, inputs, output, is_async=True)
