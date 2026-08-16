#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Arithmetic, comparison, boolean algebra and scalar math."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.kernel.errors import KernelTraceError
from east.kernel.lift import _lift
from east.kernel.nodes import _builtin
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
        return self._arith("mod", other)

    def __rmod__(self, other: Any) -> KernelExpr:
        return self._arith("mod", other, reflected=True)

    def __pow__(self, other: Any) -> KernelExpr:
        return self._arith("pow", other)

    def __rpow__(self, other: Any) -> KernelExpr:
        return self._arith("pow", other, reflected=True)

    def __truediv__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "Integer":
            raise KernelTraceError(
                "`/` on East Integers is ambiguous — use `//` for integer division or "
                ".to_float() for float division"
            )
        other = _lift(other, hint=self.east_type)
        if other.east_type.type != "Float":
            raise KernelTraceError("float division needs Float on both sides")
        return self._expr(_builtin("FloatDivide", FloatType, [], [self.ir, other.ir]), FloatType)

    def __rtruediv__(self, other: Any) -> KernelExpr:
        return _lift(other, hint=self.east_type).__truediv__(self)

    def __floordiv__(self, other: Any) -> KernelExpr:
        # Python `//` floors; East IntegerDivide truncates toward zero. A
        # traced `//` therefore differs from eager Python for mixed-sign
        # operands: -10 // 3 == -4 in Python but traces to -3.
        if self.east_type.type != "Integer":
            raise KernelTraceError("`//` is East IntegerDivide — both sides must be Integer")
        other = _lift(other)
        if other.east_type.type != "Integer":
            raise KernelTraceError("`//` is East IntegerDivide — both sides must be Integer")
        return self._expr(
            _builtin("IntegerDivide", IntegerType, [], [self.ir, other.ir]), IntegerType
        )

    def __rfloordiv__(self, other: Any) -> KernelExpr:
        return _lift(other).__floordiv__(self)

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
