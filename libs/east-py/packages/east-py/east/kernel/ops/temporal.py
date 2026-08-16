#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""DateTime accessors, shifts, durations and formatting."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.ir.builders import ir_variant
from east.kernel.errors import KernelTraceError
from east.kernel.lift import _lift
from east.kernel.nodes import _builtin, _k_new_array, _literal
from east.kernel.ops import _ExprBase
from east.types.types import IntegerType, NullType, StringType

if TYPE_CHECKING:
    from east.kernel.expr import KernelExpr


class _TemporalOps(_ExprBase):
    """Traced DateTime builtins.

    Shifts and durations compose the millisecond builtins the eager methods
    use, so a traced calculation agrees with the eager one exactly.
    """

    __slots__ = ()

    # ── datetime ───────────────────────────────────────────────────────

    def _dt_get(self, name: str) -> KernelExpr:
        if self.east_type.type != "DateTime":
            raise KernelTraceError(f".{name}() needs a DateTime")
        builtin = {
            "get_year": "DateTimeGetYear",
            "get_month": "DateTimeGetMonth",
            "get_day_of_month": "DateTimeGetDayOfMonth",
            "get_day_of_week": "DateTimeGetDayOfWeek",
            "get_hour": "DateTimeGetHour",
            "get_minute": "DateTimeGetMinute",
            "get_second": "DateTimeGetSecond",
            "get_millisecond": "DateTimeGetMillisecond",
            "to_epoch_milliseconds": "DateTimeToEpochMilliseconds",
        }[name]
        return self._expr(_builtin(builtin, IntegerType, [], [self.ir]), IntegerType)

    def get_year(self) -> KernelExpr:
        return self._dt_get("get_year")

    def get_month(self) -> KernelExpr:
        return self._dt_get("get_month")

    def get_day_of_month(self) -> KernelExpr:
        return self._dt_get("get_day_of_month")

    def get_day_of_week(self) -> KernelExpr:
        return self._dt_get("get_day_of_week")

    def get_hour(self) -> KernelExpr:
        return self._dt_get("get_hour")

    def get_minute(self) -> KernelExpr:
        return self._dt_get("get_minute")

    def get_second(self) -> KernelExpr:
        return self._dt_get("get_second")

    def get_millisecond(self) -> KernelExpr:
        return self._dt_get("get_millisecond")

    def to_epoch_milliseconds(self) -> KernelExpr:
        return self._dt_get("to_epoch_milliseconds")

    def _dt_shift(self, amount: Any, scale: int, negate: bool) -> KernelExpr:
        if self.east_type.type != "DateTime":
            raise KernelTraceError("datetime arithmetic needs a DateTime")
        n = _lift(amount)
        if n.east_type.type == "Float":
            ms = (n * float(scale)).to_integer()
        elif n.east_type.type == "Integer":
            ms = n * scale
        else:
            raise KernelTraceError("datetime shift amount must be Integer or Float")
        if negate:
            ms = -ms
        from east.types.types import DateTimeType

        return self._expr(
            _builtin("DateTimeAddMilliseconds", DateTimeType, [], [self.ir, ms.ir]), DateTimeType
        )

    def add_milliseconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1, False)

    def add_seconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1000, False)

    def add_minutes(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 60_000, False)

    def add_hours(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 3_600_000, False)

    def add_days(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 86_400_000, False)

    def add_weeks(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 604_800_000, False)

    def subtract_milliseconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1, True)

    def subtract_seconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1000, True)

    def subtract_minutes(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 60_000, True)

    def subtract_hours(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 3_600_000, True)

    def subtract_days(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 86_400_000, True)

    def subtract_weeks(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 604_800_000, True)

    def duration_milliseconds(self, other: Any) -> KernelExpr:
        if self.east_type.type != "DateTime":
            raise KernelTraceError(".duration_*() needs a DateTime")
        o = _lift(other)
        if o.east_type.type != "DateTime":
            raise KernelTraceError(".duration_*() other must be a DateTime")
        return self._expr(
            _builtin("DateTimeDurationMilliseconds", IntegerType, [], [self.ir, o.ir]), IntegerType
        )

    def _dt_duration(self, other: Any, scale: float) -> KernelExpr:
        return self.duration_milliseconds(other).to_float() / scale

    def duration_seconds(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 1000.0)

    def duration_minutes(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 60_000.0)

    def duration_hours(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 3_600_000.0)

    def duration_days(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 86_400_000.0)

    def duration_weeks(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 604_800_000.0)

    def print_format(self, fmt: Any) -> KernelExpr:
        """Format a DateTime with a Day.js-style format string.

        Like the TS `printFormatted`, the format must be a python string
        literal — it is tokenized at trace time (the builtin takes the token
        array, not the raw string).
        """
        if self.east_type.type != "DateTime":
            raise KernelTraceError(".print_format() needs a DateTime")
        if not isinstance(fmt, str):
            raise KernelTraceError(
                ".print_format() takes a literal format string (tokenized at trace time)"
            )
        from east.datetime_format import DateTimeFormatTokenType, tokenize_datetime_format
        from east.types.types import ArrayType as _ArrayType

        token_t = DateTimeFormatTokenType
        token_nodes = []
        for tok in tokenize_datetime_format(fmt):
            if tok.value is None or str(tok.value) == "null":
                payload = _literal(None, NullType)
            else:
                payload = _literal(str(tok.value), StringType)
            token_nodes.append(ir_variant(token_t, tok.type, payload))
        arr_t = _ArrayType(token_t)
        tokens_ir = _k_new_array(arr_t, token_nodes)
        return self._expr(
            _builtin("DateTimePrintFormat", StringType, [], [self.ir, tokens_ir]), StringType
        )
