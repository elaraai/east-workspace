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
from east.ir.builders import ir_as
from east.types.types import EastType, is_subtype, is_type_equal


class PlatformDeclaration:
    """A declared platform call — the handle ``East.platform`` returns.

    Calling the handle inside an ``East.function`` body emits the ``Platform``
    IR node with this declaration's signature; the implementation arrives at
    ``East.compile`` time as a ``PlatformFunction`` entry with the same name.
    Outside a build there is nothing to execute — declarations have no eager
    behavior — so a plain call raises with the builder fix-it.
    """

    __slots__ = ("name", "inputs", "output", "is_async", "optional", "type_params")

    def __init__(self, name: str, inputs: list[EastType], output: EastType,
                 is_async: bool, optional: bool = False,
                 type_params: list[str] | None = None) -> None:
        entry = "East.asyncPlatform" if is_async else "East.platform"
        if not isinstance(name, str) or not name:
            raise TypeError(f"{entry} name must be a non-empty string")
        if isinstance(inputs, EastType) or not isinstance(inputs, (list, tuple)):
            raise TypeError(
                f"{entry}(name, inputs, output) takes a LIST of input East "
                f"types — got {type(inputs).__name__}"
            )
        generic = type_params is not None
        for i, t in enumerate(inputs):
            if not isinstance(t, EastType) and not (generic and isinstance(t, str)):
                raise TypeError(
                    f"{entry} input type {i} is not an East type "
                    f"(got {type(t).__name__})"
                )
        if not isinstance(output, EastType) and not (generic and isinstance(output, str)):
            raise TypeError(
                f"{entry} output must be an East type, got {type(output).__name__}"
            )
        self.name = name
        self.inputs = tuple(inputs)
        self.output = output
        self.is_async = is_async
        self.optional = bool(optional)
        self.type_params = tuple(type_params) if generic else None

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
        type_args: list = []
        inputs: list = list(self.inputs)
        output: Any = self.output
        if self.type_params is not None:
            # Generic (TS `East.genericPlatform`): the type arguments come
            # first, as a list, and substitute for the declared placeholders.
            if not args or not isinstance(args[0], (list, tuple)):
                raise ExpressionError(
                    f"generic platform declaration '{self.name}' takes its type "
                    f"arguments first, as a list of {len(self.type_params)} East type(s)"
                )
            type_args = list(args[0])
            args = args[1:]
            if len(type_args) != len(self.type_params):
                raise ExpressionError(
                    f"generic platform declaration '{self.name}' expects "
                    f"{len(self.type_params)} type parameters, got {len(type_args)}"
                )
            for i, t in enumerate(type_args):
                if not isinstance(t, EastType):
                    raise ExpressionError(
                        f"generic platform declaration '{self.name}' type argument "
                        f"{i} is not an East type")
            subst = dict(zip(self.type_params, type_args, strict=True))
            inputs = [_apply_type_args(subst, t) for t in inputs]
            output = _apply_type_args(subst, output)
        if len(args) != len(inputs):
            raise ExpressionError(
                f"platform declaration '{self.name}' takes "
                f"{len(inputs)} argument(s), called with {len(args)}"
            )
        arg_nodes = []
        for i, (a, t) in enumerate(zip(args, inputs, strict=True)):
            e = _lift(a, hint=t)
            if e.east_type.type == "Never":
                raise ExpressionError(
                    f"platform declaration '{self.name}' argument {i} expected type "
                    f"{t.type}, got Never type"
                )
            if not is_type_equal(e.east_type, t):
                if not is_subtype(e.east_type, t):
                    raise ExpressionError(
                        f"platform declaration '{self.name}' argument {i} has "
                        f"East type {e.east_type.type}, the declaration expects "
                        f"{t.type}"
                    )
                # Implicit widening: the TypeScript platform helper inserts
                # an As node here (not the literal re-typing `coerce_to` does).
                from east.expression.location import location_id as _loc_id

                arg_nodes.append(ir_as(t, e.ir, _loc_id()))
            else:
                arg_nodes.append(e.ir)
        node = _k_platform(self.name, output, arg_nodes, self.is_async,
                           type_params=type_args, optional=self.optional)
        return Expression(node, output)


def _apply_type_args(subst: dict, t: Any) -> EastType:
    """Substitute type-parameter placeholders (strings) in a declared type
    (TS ``applyTypeArgs``)."""
    from east.types.types import (
        ArrayType,
        AsyncFunctionType,
        DictType,
        FunctionType,
        RefType,
        SetType,
        StructType,
        VariantType,
    )

    if isinstance(t, str):
        if t not in subst:
            raise ExpressionError(f"Unexpected type argument {t}")
        return subst[t]
    kind = t.type
    if kind == "Ref":
        return RefType(_apply_type_args(subst, t.value))
    if kind == "Array":
        return ArrayType(_apply_type_args(subst, t.value))
    if kind == "Set":
        return SetType(_apply_type_args(subst, t.value))
    if kind == "Dict":
        return DictType(_apply_type_args(subst, t.value["key"]),
                        _apply_type_args(subst, t.value["value"]))
    if kind == "Struct":
        return StructType([(f["name"], _apply_type_args(subst, f["type"])) for f in t.value])
    if kind == "Variant":
        return VariantType([(c["name"], _apply_type_args(subst, c["type"])) for c in t.value])
    if kind in ("Function", "AsyncFunction"):
        make = FunctionType if kind == "Function" else AsyncFunctionType
        return make([_apply_type_args(subst, i) for i in t.value["inputs"]],
                    _apply_type_args(subst, t.value["output"]))
    return t


def platform(name: str, inputs: list[EastType], output: EastType, *,
             optional: bool = False) -> PlatformDeclaration:
    """Declare a SYNC platform call — the public ``East.platform``.

    The returned handle is callable inside ``East.function`` /
    ``East.asyncFunction`` bodies and emits the ``Platform`` IR node with the
    declared signature; pair it with a ``@platform_function`` implementation
    of the same name at ``East.compile`` time. An argument whose type is a
    strict subtype of the declared input widens through an ``As`` node,
    exactly as the TypeScript helper inserts one.

    Args:
        name: The platform function name — must match the implementation's
            registered name exactly.
        inputs: The declared input East types, in order.
        output: The declared output East type.
        optional: When true, compiling succeeds even if no implementation is
            provided — the call raises at run time instead (TS
            ``{ optional: true }``).

    Returns:
        The declaration handle.

    Raises:
        TypeError: If ``name`` is empty, ``inputs`` is not a list of East
            types, or ``output`` is not an East type.
    """
    return PlatformDeclaration(name, inputs, output, is_async=False, optional=optional)


def async_platform(name: str, inputs: list[EastType], output: EastType, *,
                   optional: bool = False) -> PlatformDeclaration:
    """Declare an ASYNC platform call — the public ``East.asyncPlatform``.

    Callable only inside ``East.asyncFunction`` bodies (a sync body calling
    an async declaration is a build-time error); the compiled program awaits
    the implementation coroutine.

    Args:
        name: The platform function name — must match the implementation's
            registered name exactly.
        inputs: The declared input East types, in order.
        output: The declared output East type.
        optional: As for :func:`platform`.

    Returns:
        The declaration handle.

    Raises:
        TypeError: If the signature arguments are malformed (see
            :func:`platform`).
    """
    return PlatformDeclaration(name, inputs, output, is_async=True, optional=optional)


def generic_platform(name: str, type_params: list[str], inputs: list,
                     output: Any, *, optional: bool = False) -> PlatformDeclaration:
    """Declare a GENERIC (polymorphic) platform call — the public
    ``East.genericPlatform``: the type parameters are named placeholders that
    may stand anywhere in ``inputs``/``output``, and the handle takes the
    concrete type arguments first, as a list: ``log([StringType], s)``.

    Args:
        name: The platform function name.
        type_params: The type parameter names, e.g. ``["T", "U"]``.
        inputs: The declared input types — East types or placeholder names.
        output: The declared output type — an East type or a placeholder.
        optional: As for :func:`platform`.

    Returns:
        The declaration handle; calling it emits a ``Platform`` node whose
        ``type_parameters`` are the type arguments.
    """
    return PlatformDeclaration(name, inputs, output, is_async=False, optional=optional,
                               type_params=list(type_params))


def async_generic_platform(name: str, type_params: list[str], inputs: list,
                           output: Any, *, optional: bool = False) -> PlatformDeclaration:
    """The ASYNC twin of :func:`generic_platform` (TS ``East.asyncGenericPlatform``)."""
    return PlatformDeclaration(name, inputs, output, is_async=True, optional=optional,
                               type_params=list(type_params))
