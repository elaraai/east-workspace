#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Arithmetic, comparison, boolean algebra and scalar math."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.kernel.errors import KernelTraceError
from east.kernel.lift import _lift
from east.kernel.nodes import _builtin, _k_ifelse
from east.kernel.ops import _ExprBase
from east.types.types import BooleanType, FloatType, IntegerType, StringType

if TYPE_CHECKING:
    from east.kernel.expr import KernelExpr

_ARITH = {
    "add": ("IntegerAdd", "FloatAdd"),
    "sub": ("IntegerSubtract", "FloatSubtract"),
    "mul": ("IntegerMultiply", "FloatMultiply"),
    "mod": ("IntegerRemainder", "FloatRemainder"),
    "pow": ("IntegerPow", "FloatPow"),
}

_COMPARE = {
    "eq": "Equal",
    "ne": "NotEqual",
    "lt": "Less",
    "le": "LessEqual",
    "gt": "Greater",
    "ge": "GreaterEqual",
}

# Operator forks (#624): python spellings whose East builtin disagrees with
# python's own semantics on ordinary inputs. Tracing them would silently
# compute different values than the same lambda run per-element, so each
# raises and names the East spelling that says which semantics you get.
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
_INT_POW_FORK = (
    "python `**` promotes a negative Integer exponent to float (2 ** -1 is "
    "0.5 in python but 0 as East IntegerPow) — call East.Integer.pow(a, b) "
    "explicitly"
)


class _ScalarOps(_ExprBase):
    """Traced arithmetic, comparison, boolean algebra and scalar math.

    Python's ``and``/``or``/``not`` cannot be overloaded, so boolean algebra is
    ``&`` / ``|`` / ``~``; comparisons go through East's total order, generic
    over the operand type.
    """

    __slots__ = ()

    # ── arithmetic ─────────────────────────────────────────────────────

    def _arith(self, op: str, other: Any, reflected: bool = False) -> KernelExpr:
        other = _lift(other, hint=self.east_type)
        lhs, rhs = (other, self) if reflected else (self, other)
        tag = lhs.east_type.type
        if tag != rhs.east_type.type or tag not in ("Integer", "Float"):
            raise KernelTraceError(
                f"arithmetic between {lhs.east_type.type} and {rhs.east_type.type} — East "
                "has no implicit numeric coercion; convert explicitly with .to_float()"
            )
        name = _ARITH[op][0 if tag == "Integer" else 1]
        return self._expr(_builtin(name, lhs.east_type, [], [lhs.ir, rhs.ir]), lhs.east_type)

    def __add__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "String":
            rhs = _lift(other)
            if rhs.east_type.type != "String":
                raise KernelTraceError("string concatenation needs a String on both sides")
            return self._expr(
                _builtin("StringConcat", StringType, [], [self.ir, rhs.ir]), StringType
            )
        return self._arith("add", other)

    def __radd__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "String":
            return _lift(other).__add__(self)
        return self._arith("add", other, reflected=True)

    def __sub__(self, other: Any) -> KernelExpr:
        return self._arith("sub", other)

    def __rsub__(self, other: Any) -> KernelExpr:
        return self._arith("sub", other, reflected=True)

    def __mul__(self, other: Any) -> KernelExpr:
        return self._arith("mul", other)

    def __rmul__(self, other: Any) -> KernelExpr:
        return self._arith("mul", other, reflected=True)

    def __mod__(self, other: Any) -> KernelExpr:
        raise KernelTraceError(_MOD_FORK)

    def __rmod__(self, other: Any) -> KernelExpr:
        raise KernelTraceError(_MOD_FORK)

    def __pow__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "Integer":
            raise KernelTraceError(_INT_POW_FORK)
        return self._arith("pow", other)

    def __rpow__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "Integer":
            raise KernelTraceError(_INT_POW_FORK)
        return self._arith("pow", other, reflected=True)

    def __truediv__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "Integer":
            raise KernelTraceError(
                "`/` on East Integers is ambiguous — call East.Integer.divide(a, b) "
                "for truncating integer division or .to_float() for float division"
            )
        other = _lift(other, hint=self.east_type)
        if other.east_type.type != "Float":
            raise KernelTraceError("float division needs Float on both sides")
        return self._expr(_builtin("FloatDivide", FloatType, [], [self.ir, other.ir]), FloatType)

    def __rtruediv__(self, other: Any) -> KernelExpr:
        return _lift(other, hint=self.east_type).__truediv__(self)

    def __floordiv__(self, other: Any) -> KernelExpr:
        raise KernelTraceError(_FLOORDIV_FORK)

    def __rfloordiv__(self, other: Any) -> KernelExpr:
        raise KernelTraceError(_FLOORDIV_FORK)

    def __neg__(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return self._expr(_builtin("IntegerNegate", IntegerType, [], [self.ir]), IntegerType)
        if tag == "Float":
            return self._expr(_builtin("FloatNegate", FloatType, [], [self.ir]), FloatType)
        raise KernelTraceError(f"unary minus on {tag}")

    def __abs__(self) -> KernelExpr:
        return self.abs()

    # ── comparisons (East total order, generic over the operand type) ──

    def _compare(self, op: str, other: Any) -> KernelExpr:
        other = _lift(other, hint=self.east_type)
        if self.east_type != other.east_type:
            raise KernelTraceError(
                f"comparison between different East types "
                f"({self.east_type.type} vs {other.east_type.type})"
            )
        return self._expr(
            _builtin(_COMPARE[op], BooleanType, [self.east_type], [self.ir, other.ir]),
            BooleanType,
        )

    def __eq__(self, other: Any) -> KernelExpr:  # type: ignore[override]
        return self._compare("eq", other)

    def __ne__(self, other: Any) -> KernelExpr:  # type: ignore[override]
        return self._compare("ne", other)

    def __lt__(self, other: Any) -> KernelExpr:
        return self._compare("lt", other)

    def __le__(self, other: Any) -> KernelExpr:
        return self._compare("le", other)

    def __gt__(self, other: Any) -> KernelExpr:
        return self._compare("gt", other)

    def __ge__(self, other: Any) -> KernelExpr:
        return self._compare("ge", other)

    # ── boolean algebra (& | ^ ~ — python `and`/`or`/`not` can't overload) ──

    def _bool_op(self, name: str, other: Any) -> KernelExpr:
        other = _lift(other)
        if self.east_type.type != "Boolean" or other.east_type.type != "Boolean":
            raise KernelTraceError(f"{name} needs Boolean operands")
        return self._expr(_builtin(name, BooleanType, [], [self.ir, other.ir]), BooleanType)

    def __and__(self, other: Any) -> KernelExpr:
        return self._bool_op("BooleanAnd", other)

    def __rand__(self, other: Any) -> KernelExpr:
        return _lift(other)._bool_op("BooleanAnd", self)

    def __or__(self, other: Any) -> KernelExpr:
        return self._bool_op("BooleanOr", other)

    def __ror__(self, other: Any) -> KernelExpr:
        return _lift(other)._bool_op("BooleanOr", self)

    def __xor__(self, other: Any) -> KernelExpr:
        return self._bool_op("BooleanXor", other)

    def __invert__(self) -> KernelExpr:
        if self.east_type.type != "Boolean":
            raise KernelTraceError("`~` (not) needs a Boolean operand")
        return self._expr(_builtin("BooleanNot", BooleanType, [], [self.ir]), BooleanType)

    # ── conversions and math methods ────────────────────────────────────

    def to_float(self) -> KernelExpr:
        if self.east_type.type != "Integer":
            raise KernelTraceError(f".to_float() on {self.east_type.type} (needs Integer)")
        return self._expr(_builtin("IntegerToFloat", FloatType, [], [self.ir]), FloatType)

    def to_integer(self) -> KernelExpr:
        if self.east_type.type != "Float":
            raise KernelTraceError(f".to_integer() on {self.east_type.type} (needs Float)")
        return self._expr(_builtin("FloatToInteger", IntegerType, [], [self.ir]), IntegerType)

    def abs(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return self._expr(_builtin("IntegerAbs", IntegerType, [], [self.ir]), IntegerType)
        if tag == "Float":
            return self._expr(_builtin("FloatAbs", FloatType, [], [self.ir]), FloatType)
        raise KernelTraceError(f".abs() on {tag}")

    def sqrt(self) -> KernelExpr:
        if self.east_type.type != "Float":
            raise KernelTraceError(".sqrt() needs a Float")
        return self._expr(_builtin("FloatSqrt", FloatType, [], [self.ir]), FloatType)

    # ── Float → Integer rounding (#604) ─────────────────────────────────
    #
    # Composed from Remainder/Subtract/IfElse/FloatToInteger, so every
    # runtime executes them with no new builtins. The compositions call
    # `_arith("mod", 1.0)` directly — the `%` dunder raises (#624), and
    # FloatRemainder's sign-of-dividend contract is exactly what they want.
    # `frac = FloatRemainder(x, 1.0) + 0.0` is the fractional part, exactly
    # (fmod is exact), with `+ 0.0` folding the -0.0 that fmod returns for
    # negative integral x — East's float TOTAL order puts -0.0 below 0.0, so
    # an unnormalized frac would make every sign test lie on whole negatives.
    # All decisions compare that exact frac; never add 0.5 to x, which
    # double-rounds at the tie boundary (0.49999999999999994 + 0.5 rounds
    # to 1.0).

    def _pick_float(self, pred: KernelExpr, then: KernelExpr, other: KernelExpr) -> KernelExpr:
        return self._expr(_k_ifelse(FloatType, [(pred.ir, then.ir)], other.ir), FloatType)

    def _require_float(self, method: str) -> None:
        if self.east_type.type != "Float":
            raise KernelTraceError(f".{method}() needs a Float")

    def trunc(self) -> KernelExpr:
        """Truncate toward zero, as an Integer: 3.7 → 3, -3.7 → -3."""
        self._require_float("trunc")
        return (self - self._arith("mod", 1.0)).to_integer()

    def floor(self) -> KernelExpr:
        """Round toward negative infinity, as an Integer: -3.2 → -4."""
        self._require_float("floor")
        frac = self._arith("mod", 1.0) + 0.0
        whole = self - frac
        return self._pick_float(frac < 0.0, whole - 1.0, whole).to_integer()

    def ceil(self) -> KernelExpr:
        """Round toward positive infinity, as an Integer: 3.2 → 4."""
        self._require_float("ceil")
        frac = self._arith("mod", 1.0) + 0.0
        whole = self - frac
        return self._pick_float(frac > 0.0, whole + 1.0, whole).to_integer()

    def round(self) -> KernelExpr:
        """Round half AWAY FROM ZERO, as an Integer: 2.5 → 3, -2.5 → -3.

        Deliberately not python's round(): the builtin rounds ties to even,
        and a silently different tie rule between the traced and eager paths
        would surface as one-unit discrepancies long after the fact — so the
        traced spelling is an explicit method with an explicit rule.
        """
        self._require_float("round")
        frac = self._arith("mod", 1.0) + 0.0
        whole = self - frac
        return self._pick_float(
            frac >= 0.5, whole + 1.0,
            self._pick_float(frac <= -0.5, whole - 1.0, whole),
        ).to_integer()

    def __trunc__(self) -> KernelExpr:
        return self.trunc()

    def __floor__(self) -> KernelExpr:
        return self.floor()

    def __ceil__(self) -> KernelExpr:
        return self.ceil()

    def __round__(self, ndigits: Any = None) -> KernelExpr:
        raise KernelTraceError(
            "python round() rounds ties to even; the traced surface rounds "
            "half away from zero — call .round() explicitly (or compose "
            ".floor()/.ceil()/.trunc())"
        )

    # ── float / integer math tail ───────────────────────────────────────

    def _float_fn(self, name: str) -> KernelExpr:
        if self.east_type.type != "Float":
            raise KernelTraceError(f".{name.lower()}() needs a Float")
        return self._expr(_builtin(name, FloatType, [], [self.ir]), FloatType)

    def exp(self) -> KernelExpr:
        return self._float_fn("FloatExp")

    def log(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return self._expr(_builtin("IntegerLog", IntegerType, [], [self.ir]), IntegerType)
        return self._float_fn("FloatLog")

    def sin(self) -> KernelExpr:
        return self._float_fn("FloatSin")

    def cos(self) -> KernelExpr:
        return self._float_fn("FloatCos")

    def tan(self) -> KernelExpr:
        return self._float_fn("FloatTan")

    def sign(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return self._expr(_builtin("IntegerSign", IntegerType, [], [self.ir]), IntegerType)
        return self._float_fn("FloatSign")
