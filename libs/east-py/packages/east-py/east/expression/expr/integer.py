#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``IntegerExpression`` — TS ``IntegerExpr`` (``libs/east/src/expr/integer.ts``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression
from east.expression.lift import _lift
from east.expression.nodes import _builtin
from east.types.types import FloatType, IntegerType

_FLOORDIV_FORK = (
    "python `//` floors the quotient; East IntegerDivide truncates toward "
    "zero (-10 // 3 is -4 in python but -3 traced) — call "
    "East.Integer.divide(a, b) explicitly"
)
_MOD_FORK = (
    "python `%` takes the sign of the divisor; East IntegerRemainder / "
    "FloatRemainder take the sign of the dividend (-10 % 3 is 2 in python "
    "but -1 traced) — call East.Integer.remainder(a, b) or "
    "East.Float.remainder(a, b) explicitly"
)
_POW_FORK = (
    "python `**` promotes a negative Integer exponent to float (2 ** -1 is "
    "0.5 in python but 0 as East IntegerPow) — call East.Integer.pow(a, b) "
    "explicitly"
)
_DIV_AMBIGUOUS = (
    "`/` on East Integers is ambiguous — call East.Integer.divide(a, b) "
    "for truncating integer division or .to_float() for float division"
)

if TYPE_CHECKING:
    from east.expression.expr.float import FloatExpression


class IntegerExpression(Expression):
    """64-bit signed Integer arithmetic and conversion. Operators overload
    only where python agrees with East (#624): ``+`` ``-`` ``*`` and unary
    ``-``; ``//``, ``%``, ``**`` and ``/`` raise naming the explicit East
    spelling that says which semantics you get."""

    __slots__ = ()
    _kind = "Integer"

    def _binary(self, name: str, other: Any, reflected: bool = False) -> IntegerExpression:
        other = _lift(other, hint=IntegerType)
        lhs, rhs = (other, self) if reflected else (self, other)
        if other.east_type.type != "Integer":
            raise ExpressionError(
                f"arithmetic between {lhs.east_type.type} and {rhs.east_type.type} — East "
                "has no implicit numeric coercion; convert explicitly with .to_float()"
            )
        return self._expr(_builtin(name, IntegerType, [], [lhs.ir, rhs.ir]), IntegerType)

    # ── arithmetic ─────────────────────────────────────────────────────

    def __add__(self, other: Any) -> IntegerExpression:
        return self._binary("IntegerAdd", other)

    def __radd__(self, other: Any) -> IntegerExpression:
        return self._binary("IntegerAdd", other, reflected=True)

    def __sub__(self, other: Any) -> IntegerExpression:
        return self._binary("IntegerSubtract", other)

    def __rsub__(self, other: Any) -> IntegerExpression:
        return self._binary("IntegerSubtract", other, reflected=True)

    def __mul__(self, other: Any) -> IntegerExpression:
        return self._binary("IntegerMultiply", other)

    def __rmul__(self, other: Any) -> IntegerExpression:
        return self._binary("IntegerMultiply", other, reflected=True)

    def __mod__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_MOD_FORK)

    def __rmod__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_MOD_FORK)

    def __pow__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_POW_FORK)

    def __rpow__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_POW_FORK)

    def __truediv__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_DIV_AMBIGUOUS)

    def __rtruediv__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_DIV_AMBIGUOUS)

    def __floordiv__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_FLOORDIV_FORK)

    def __rfloordiv__(self, other: Any) -> IntegerExpression:
        raise ExpressionError(_FLOORDIV_FORK)

    def __neg__(self) -> IntegerExpression:
        return self._expr(_builtin("IntegerNegate", IntegerType, [], [self.ir]), IntegerType)

    def __abs__(self) -> IntegerExpression:
        return self.abs()

    # ── conversions and math ────────────────────────────────────────────

    def to_float(self) -> FloatExpression:
        """Traced IntegerToFloat (TS ``toFloat``)."""
        return self._expr(_builtin("IntegerToFloat", FloatType, [], [self.ir]), FloatType)

    def abs(self) -> IntegerExpression:
        """Traced IntegerAbs."""
        return self._expr(_builtin("IntegerAbs", IntegerType, [], [self.ir]), IntegerType)

    def sign(self) -> IntegerExpression:
        """Traced IntegerSign: -1, 0 or 1."""
        return self._expr(_builtin("IntegerSign", IntegerType, [], [self.ir]), IntegerType)

    def log(self, base: Any) -> IntegerExpression:
        """Traced IntegerLog: the floor of ``log_base(x)`` (TS ``log(base)``)."""
        b = self._typed("log", base, IntegerType)
        return self._expr(_builtin("IntegerLog", IntegerType, [], [self.ir, b.ir]), IntegerType)

    # ── the named arithmetic (TS ``add`` … ``pow``): a Float operand promotes ──

    def _named(self, integer_op: str, float_op: str, other: Any) -> Any:
        """``self <op> other`` as TS spells it: an Integer operand keeps the
        Integer builtin; a Float operand converts ``self`` with IntegerToFloat
        first (the TypeScript ``IntegerExpr`` promotion)."""
        o = _lift(other, hint=IntegerType)
        if o.east_type.type == "Float":
            return self._expr(
                _builtin(float_op, FloatType, [], [self.to_float().ir, o.ir]), FloatType)
        if o.east_type.type != "Integer":
            raise ExpressionError(
                f"arithmetic between Integer and {o.east_type.type} — East has no "
                "implicit numeric coercion; convert explicitly with .to_float()")
        return self._expr(_builtin(integer_op, IntegerType, [], [self.ir, o.ir]), IntegerType)

    def negate(self) -> IntegerExpression:
        """Traced IntegerNegate (TS ``negate``; also unary ``-``)."""
        return -self

    def add(self, y: Any) -> Any:
        """Traced IntegerAdd — FloatAdd of ``to_float()`` for a Float ``y`` (TS ``add``)."""
        return self._named("IntegerAdd", "FloatAdd", y)

    def subtract(self, y: Any) -> Any:
        """Traced IntegerSubtract (TS ``subtract``)."""
        return self._named("IntegerSubtract", "FloatSubtract", y)

    def multiply(self, y: Any) -> Any:
        """Traced IntegerMultiply (TS ``multiply``)."""
        return self._named("IntegerMultiply", "FloatMultiply", y)

    def divide(self, y: Any) -> Any:
        """Traced IntegerDivide — truncating toward zero, an East runtime
        error on a zero divisor (TS ``divide``); FloatDivide for a Float ``y``."""
        return self._named("IntegerDivide", "FloatDivide", y)

    def remainder(self, y: Any) -> Any:
        """Traced IntegerRemainder — the sign of the dividend (TS ``remainder``)."""
        return self._named("IntegerRemainder", "FloatRemainder", y)

    def pow(self, y: Any) -> Any:
        """Traced IntegerPow — a negative exponent yields 0 (TS ``pow``)."""
        return self._named("IntegerPow", "FloatPow", y)

    # the TypeScript aliases
    plus = add
    sub = subtract
    minus = subtract
    mul = multiply
    times = multiply
    div = divide
    mod = remainder
    rem = remainder
    modulo = remainder
