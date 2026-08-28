#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``FloatExpression`` — TS ``FloatExpr`` (``libs/east/src/expr/float.ts``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression
from east.expression.lift import _lift
from east.expression.nodes import _builtin, _k_ifelse
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

if TYPE_CHECKING:
    from east.expression.expr.integer import IntegerExpression


class FloatExpression(Expression):
    """IEEE-754 double arithmetic, the math tail, and the Float → Integer
    roundings. Operators overload only where python agrees with East
    (#624): ``+`` ``-`` ``*`` ``/`` ``**`` and unary ``-``; ``//`` and ``%``
    raise naming the explicit East spelling."""

    __slots__ = ()
    _kind = "Float"

    def _binary(self, name: str, other: Any, reflected: bool = False) -> FloatExpression:
        other = _lift(other, hint=FloatType)
        lhs, rhs = (other, self) if reflected else (self, other)
        if other.east_type.type != "Float":
            raise ExpressionError(
                f"arithmetic between {lhs.east_type.type} and {rhs.east_type.type} — East "
                "has no implicit numeric coercion; convert explicitly with .to_float()"
            )
        return self._expr(_builtin(name, FloatType, [], [lhs.ir, rhs.ir]), FloatType)

    def _unary(self, name: str) -> FloatExpression:
        return self._expr(_builtin(name, FloatType, [], [self.ir]), FloatType)

    # ── arithmetic ─────────────────────────────────────────────────────

    def __add__(self, other: Any) -> FloatExpression:
        return self._binary("FloatAdd", other)

    def __radd__(self, other: Any) -> FloatExpression:
        return self._binary("FloatAdd", other, reflected=True)

    def __sub__(self, other: Any) -> FloatExpression:
        return self._binary("FloatSubtract", other)

    def __rsub__(self, other: Any) -> FloatExpression:
        return self._binary("FloatSubtract", other, reflected=True)

    def __mul__(self, other: Any) -> FloatExpression:
        return self._binary("FloatMultiply", other)

    def __rmul__(self, other: Any) -> FloatExpression:
        return self._binary("FloatMultiply", other, reflected=True)

    def __truediv__(self, other: Any) -> FloatExpression:
        other = _lift(other, hint=FloatType)
        if other.east_type.type != "Float":
            raise ExpressionError("float division needs Float on both sides")
        return self._expr(_builtin("FloatDivide", FloatType, [], [self.ir, other.ir]), FloatType)

    def __rtruediv__(self, other: Any) -> FloatExpression:
        return _lift(other, hint=FloatType).__truediv__(self)

    def __pow__(self, other: Any) -> FloatExpression:
        return self._binary("FloatPow", other)

    def __rpow__(self, other: Any) -> FloatExpression:
        return self._binary("FloatPow", other, reflected=True)

    def __mod__(self, other: Any) -> FloatExpression:
        raise ExpressionError(_MOD_FORK)

    def __rmod__(self, other: Any) -> FloatExpression:
        raise ExpressionError(_MOD_FORK)

    def __floordiv__(self, other: Any) -> FloatExpression:
        raise ExpressionError(_FLOORDIV_FORK)

    def __rfloordiv__(self, other: Any) -> FloatExpression:
        raise ExpressionError(_FLOORDIV_FORK)

    def __neg__(self) -> FloatExpression:
        return self._unary("FloatNegate")

    def __abs__(self) -> FloatExpression:
        return self.abs()

    # ── conversions and math ────────────────────────────────────────────

    def to_integer(self) -> IntegerExpression:
        """Traced FloatToInteger (TS ``toInteger``): errors at run time on a
        non-integral, NaN or infinite value."""
        return self._expr(_builtin("FloatToInteger", IntegerType, [], [self.ir]), IntegerType)

    def abs(self) -> FloatExpression:
        """Traced FloatAbs."""
        return self._unary("FloatAbs")

    def sign(self) -> FloatExpression:
        """Traced FloatSign: -1.0, 0.0 (or -0.0), 1.0, or NaN."""
        return self._unary("FloatSign")

    def sqrt(self) -> FloatExpression:
        """Traced FloatSqrt (NaN for a negative)."""
        return self._unary("FloatSqrt")

    def exp(self) -> FloatExpression:
        """Traced FloatExp: e to the power of this value."""
        return self._unary("FloatExp")

    def log(self) -> FloatExpression:
        """Traced FloatLog: the natural logarithm."""
        return self._unary("FloatLog")

    def sin(self) -> FloatExpression:
        """Traced FloatSin (radians)."""
        return self._unary("FloatSin")

    def cos(self) -> FloatExpression:
        """Traced FloatCos (radians)."""
        return self._unary("FloatCos")

    def tan(self) -> FloatExpression:
        """Traced FloatTan (radians)."""
        return self._unary("FloatTan")

    # ── Float → Integer rounding (#604) ─────────────────────────────────
    #
    # Composed from Remainder/Subtract/IfElse/FloatToInteger, so every
    # runtime executes them with no new builtins. The compositions emit
    # FloatRemainder directly — the `%` dunder raises (#624), and the
    # builtin's sign-of-dividend contract is exactly what they want.
    # `frac = FloatRemainder(x, 1.0) + 0.0` is the fractional part, exactly
    # (fmod is exact), with `+ 0.0` folding the -0.0 that fmod returns for
    # negative integral x — East's float TOTAL order puts -0.0 below 0.0, so
    # an unnormalized frac would make every sign test lie on whole negatives.
    # All decisions compare that exact frac; never add 0.5 to x, which
    # double-rounds at the tie boundary (0.49999999999999994 + 0.5 rounds
    # to 1.0).

    def _frac(self) -> FloatExpression:
        return self._binary("FloatRemainder", 1.0) + 0.0

    def _pick(self, pred: Any, then: Any, other: Any) -> FloatExpression:
        return self._expr(_k_ifelse(FloatType, [(pred.ir, then.ir)], other.ir), FloatType)

    def trunc(self) -> IntegerExpression:
        """Truncate toward zero, as an Integer: 3.7 → 3, -3.7 → -3."""
        return (self - self._binary("FloatRemainder", 1.0)).to_integer()

    def floor(self) -> IntegerExpression:
        """Round toward negative infinity, as an Integer: -3.2 → -4."""
        frac = self._frac()
        whole = self - frac
        return self._pick(frac < 0.0, whole - 1.0, whole).to_integer()

    def ceil(self) -> IntegerExpression:
        """Round toward positive infinity, as an Integer: 3.2 → 4."""
        frac = self._frac()
        whole = self - frac
        return self._pick(frac > 0.0, whole + 1.0, whole).to_integer()

    def round(self) -> IntegerExpression:
        """Round half AWAY FROM ZERO, as an Integer: 2.5 → 3, -2.5 → -3.

        Deliberately not python's round(): the builtin rounds ties to even,
        and a silently different tie rule between the traced and eager paths
        would surface as one-unit discrepancies long after the fact — so the
        traced spelling is an explicit method with an explicit rule.
        """
        frac = self._frac()
        whole = self - frac
        return self._pick(
            frac >= 0.5, whole + 1.0,
            self._pick(frac <= -0.5, whole - 1.0, whole),
        ).to_integer()

    def __trunc__(self) -> IntegerExpression:
        return self.trunc()

    def __floor__(self) -> IntegerExpression:
        return self.floor()

    def __ceil__(self) -> IntegerExpression:
        return self.ceil()

    def __round__(self, ndigits: Any = None) -> IntegerExpression:
        raise ExpressionError(
            "python round() rounds ties to even; the traced surface rounds "
            "half away from zero — call .round() explicitly (or compose "
            ".floor()/.ceil()/.trunc())"
        )

    # ── the named arithmetic (TS ``add`` … ``pow``): an Integer operand widens ──

    def _operand(self, other: Any) -> Any:
        o = _lift(other, hint=FloatType)
        if o.east_type.type == "Integer":
            return o.to_float()
        if o.east_type.type != "Float":
            raise ExpressionError(f"Cannot add Float and {o.east_type.type}")
        return o

    def _named(self, name: str, other: Any) -> FloatExpression:
        o = self._operand(other)
        return self._expr(_builtin(name, FloatType, [], [self.ir, o.ir]), FloatType)

    def negate(self) -> FloatExpression:
        """Traced FloatNegate (TS ``negate``; also unary ``-``)."""
        return self._unary("FloatNegate")

    def add(self, y: Any) -> FloatExpression:
        """Traced FloatAdd; an Integer ``y`` widens first (TS ``add``)."""
        return self._named("FloatAdd", y)

    def subtract(self, y: Any) -> FloatExpression:
        """Traced FloatSubtract (TS ``subtract``)."""
        return self._named("FloatSubtract", y)

    def multiply(self, y: Any) -> FloatExpression:
        """Traced FloatMultiply (TS ``multiply``)."""
        return self._named("FloatMultiply", y)

    def divide(self, y: Any) -> FloatExpression:
        """Traced FloatDivide — IEEE-754, a zero divisor yields ±inf/NaN (TS ``divide``)."""
        return self._named("FloatDivide", y)

    def remainder(self, y: Any) -> FloatExpression:
        """Traced FloatRemainder — the sign of the dividend (TS ``remainder``)."""
        return self._named("FloatRemainder", y)

    def pow(self, y: Any) -> FloatExpression:
        """Traced FloatPow (TS ``pow``; also ``**``)."""
        return self._named("FloatPow", y)

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
