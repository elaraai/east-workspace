#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``BooleanExpression`` — TS ``BooleanExpr`` (``libs/east/src/expr/boolean.ts``)."""

from __future__ import annotations

from typing import Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression
from east.expression.lift import _lift
from east.expression.nodes import _builtin, _k_ifelse
from east.types.types import BooleanType


class BooleanExpression(Expression):
    """Boolean algebra. Python's ``and``/``or``/``not`` cannot be
    overloaded, so the non-short-circuiting operators are ``&`` / ``|`` /
    ``^`` / ``~`` (TS ``bitAnd`` / ``bitOr`` / ``bitXor`` / ``not``); the
    short-circuiting conditional is ``East.if_else``."""

    __slots__ = ()
    _kind = "Boolean"

    def _bool_op(self, name: str, other: Any) -> BooleanExpression:
        other = _lift(other)
        if other.east_type.type != "Boolean":
            raise ExpressionError(f"{name} needs Boolean operands")
        return self._expr(_builtin(name, BooleanType, [], [self.ir, other.ir]), BooleanType)

    def __and__(self, other: Any) -> BooleanExpression:
        return self._bool_op("BooleanAnd", other)

    def __rand__(self, other: Any) -> BooleanExpression:
        return _lift(other, hint=BooleanType)._bool_op("BooleanAnd", self)

    def __or__(self, other: Any) -> BooleanExpression:
        return self._bool_op("BooleanOr", other)

    def __ror__(self, other: Any) -> BooleanExpression:
        return _lift(other, hint=BooleanType)._bool_op("BooleanOr", self)

    def __xor__(self, other: Any) -> BooleanExpression:
        return self._bool_op("BooleanXor", other)

    def __rxor__(self, other: Any) -> BooleanExpression:
        return _lift(other, hint=BooleanType)._bool_op("BooleanXor", self)

    def __invert__(self) -> BooleanExpression:
        return self._expr(_builtin("BooleanNot", BooleanType, [], [self.ir]), BooleanType)

    # ── the named forms (TS ``not`` / ``and`` / ``or`` / ``bitAnd`` / ``bitOr`` / ``bitXor``) ──

    def not_(self) -> BooleanExpression:
        """Traced BooleanNot (TS ``not``; also ``~``)."""
        return ~self

    def bit_and(self, y: Any) -> BooleanExpression:
        """Traced BooleanAnd — both operands always evaluate (TS ``bitAnd``; also ``&``)."""
        return self._bool_op("BooleanAnd", y)

    def bit_or(self, y: Any) -> BooleanExpression:
        """Traced BooleanOr — both operands always evaluate (TS ``bitOr``; also ``|``)."""
        return self._bool_op("BooleanOr", y)

    def bit_xor(self, y: Any) -> BooleanExpression:
        """Traced BooleanXor (TS ``bitXor``; also ``^``)."""
        return self._bool_op("BooleanXor", y)

    def if_else(self, true_fn: Any, false_fn: Any) -> Any:
        """The conditional EXPRESSION over two bodies (TS ``ifElse``): each arm
        is ``fn(b)`` run in its own frame, exactly one evaluates at run time,
        and the result is the union of the arms' types. ``East.if_else(cond,
        a, b)`` is the value form of the same node."""
        from east.expression.lift import _coerce, _union_type
        from east.expression.statements import _frames, _run_block

        ret_t = _frames[-1].return_type if _frames else None
        then = _run_block(true_fn, (), return_type=ret_t, mode="block_expr")
        other = _run_block(false_fn, (), return_type=ret_t, mode="block_expr")
        out_t = _union_type([then.east_type, other.east_type], ".if_else()")
        arms = [a if a.east_type.type == "Never" else _coerce(a, out_t) for a in (then, other)]
        return self._expr(_k_ifelse(out_t, [(self.ir, arms[0].ir)], arms[1].ir), out_t)

    def and_(self, y: Any) -> BooleanExpression:
        """Short-circuit AND: ``y`` is a body ``fn(b)`` evaluated only when
        this is true (TS ``and``) — an IfElse, not BooleanAnd."""
        return self.if_else(y, lambda _b: False)

    def or_(self, y: Any) -> BooleanExpression:
        """Short-circuit OR: ``y`` is a body ``fn(b)`` evaluated only when this
        is false (TS ``or``) — an IfElse, not BooleanOr."""
        return self.if_else(lambda _b: True, y)
