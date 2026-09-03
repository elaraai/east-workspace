#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``East.String`` stdlib (``libs/east/src/expr/libs/string.ts``) and the
``East.str(...)`` template — TypeScript's ``Expr.str`` tagged template."""

from __future__ import annotations

from typing import Any

from east.expression.libs import lib_function
from east.types.types import ArrayType, IntegerType, StringType, StructType

#: A stack frame as ``print_error`` takes it — TS ``{ filename, line, column }``.
STACK_FRAME_TYPE = StructType([("filename", StringType), ("line", IntegerType), ("column", IntegerType)])


def str_(*parts: Any) -> Any:
    """TypeScript's ``Expr.str`` template: the parts concatenated into one
    String, every non-String part rendered with the East ``Print`` builtin
    (``East.str("total: ", n, "%")``). Dual-mode: a plain-value call returns
    a python ``str``; a traced part builds ``StringConcat``/``Print`` IR."""
    from east.expression.expr import Expression

    if not any(isinstance(p, Expression) for p in parts):
        from east.namespace import East
        from east.types.values import type_of

        return "".join(p if isinstance(p, str) else East.String.print(type_of(p), p) for p in parts)
    from east.expression.lift import _lift
    from east.expression.nodes import _builtin, _literal

    result: Any = None
    for part in parts:
        e = _lift(part)
        if e.east_type.type != "String":
            e = Expression(_builtin("Print", StringType, [e.east_type], [e.ir]), StringType)
        result = e if result is None else Expression(
            _builtin("StringConcat", StringType, [], [result.ir, e.ir]), StringType)
    return result if result is not None else Expression(_literal("", StringType), StringType)


@lib_function([StringType, ArrayType(STACK_FRAME_TYPE)], StringType)
def _print_error(b: Any, message: Any, stack: Any) -> Any:
    """``Error: <message>`` followed by one ``[i] file line:column`` line per
    stack frame (TS ``printError``)."""
    del b
    frames = stack.map(lambda _b, f, i: str_("[", i, "] ", f.filename, " ", f.line, ":", f.column))
    return str_("Error: ", message, "\n    ", frames.string_join("\n    "))


print_error = _print_error

__all__ = ["STACK_FRAME_TYPE", "print_error", "str_"]
