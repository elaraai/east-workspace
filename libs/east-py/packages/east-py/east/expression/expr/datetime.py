#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``DateTimeExpression`` — TS ``DateTimeExpr`` (``libs/east/src/expr/datetime.ts``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression, _deprecated_alias
from east.expression.lift import _lift
from east.expression.location import location_id as _loc_id
from east.expression.nodes import _builtin, _k_new_array, _literal
from east.ir.builders import ir_variant
from east.types.types import ArrayType, DateTimeType, IntegerType, NullType, StringType

if TYPE_CHECKING:
    from east.expression.expr.float import FloatExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.string import StringExpression


class DateTimeExpression(Expression):
    """DateTime accessors, shifts, durations and formatting.

    Shifts and durations compose the millisecond builtins the eager methods
    use, so a traced calculation agrees with the eager one exactly.
    """

    __slots__ = ()
    _kind = "DateTime"

    # ── components ──────────────────────────────────────────────────────

    def get_year(self) -> IntegerExpression:
        """Traced DateTimeGetYear."""
        return self._expr(_builtin("DateTimeGetYear", IntegerType, [], [self.ir]), IntegerType)

    def get_month(self) -> IntegerExpression:
        """Traced DateTimeGetMonth (1-12)."""
        return self._expr(_builtin("DateTimeGetMonth", IntegerType, [], [self.ir]), IntegerType)

    def get_day_of_month(self) -> IntegerExpression:
        """Traced DateTimeGetDayOfMonth (1-31)."""
        return self._expr(
            _builtin("DateTimeGetDayOfMonth", IntegerType, [], [self.ir]), IntegerType)

    def get_day_of_week(self) -> IntegerExpression:
        """Traced DateTimeGetDayOfWeek (0 = Sunday … 6 = Saturday)."""
        return self._expr(
            _builtin("DateTimeGetDayOfWeek", IntegerType, [], [self.ir]), IntegerType)

    def get_hour(self) -> IntegerExpression:
        """Traced DateTimeGetHour (0-23)."""
        return self._expr(_builtin("DateTimeGetHour", IntegerType, [], [self.ir]), IntegerType)

    def get_minute(self) -> IntegerExpression:
        """Traced DateTimeGetMinute (0-59)."""
        return self._expr(_builtin("DateTimeGetMinute", IntegerType, [], [self.ir]), IntegerType)

    def get_second(self) -> IntegerExpression:
        """Traced DateTimeGetSecond (0-59)."""
        return self._expr(_builtin("DateTimeGetSecond", IntegerType, [], [self.ir]), IntegerType)

    def get_millisecond(self) -> IntegerExpression:
        """Traced DateTimeGetMillisecond (0-999)."""
        return self._expr(
            _builtin("DateTimeGetMillisecond", IntegerType, [], [self.ir]), IntegerType)

    def to_epoch_milliseconds(self) -> IntegerExpression:
        """Traced DateTimeToEpochMilliseconds."""
        return self._expr(
            _builtin("DateTimeToEpochMilliseconds", IntegerType, [], [self.ir]), IntegerType)

    # ── shifts ──────────────────────────────────────────────────────────

    def _shift(self, amount: Any, scale: int, negate: bool) -> DateTimeExpression:
        """DateTimeAddMilliseconds of ``amount`` scaled to milliseconds — a
        Float amount converts after scaling, an Integer multiplies."""
        n: Any = _lift(amount)
        if n.east_type.type == "Float":
            ms = (n * float(scale)).to_integer()
        elif n.east_type.type == "Integer":
            ms = n * scale
        else:
            raise ExpressionError("datetime shift amount must be Integer or Float")
        if negate:
            ms = -ms
        return self._expr(
            _builtin("DateTimeAddMilliseconds", DateTimeType, [], [self.ir, ms.ir]), DateTimeType
        )

    def add_milliseconds(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 1, False)

    def add_seconds(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 1000, False)

    def add_minutes(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 60_000, False)

    def add_hours(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 3_600_000, False)

    def add_days(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 86_400_000, False)

    def add_weeks(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 604_800_000, False)

    def subtract_milliseconds(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 1, True)

    def subtract_seconds(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 1000, True)

    def subtract_minutes(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 60_000, True)

    def subtract_hours(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 3_600_000, True)

    def subtract_days(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 86_400_000, True)

    def subtract_weeks(self, n: Any) -> DateTimeExpression:
        return self._shift(n, 604_800_000, True)

    # ── durations (``other - this``) ────────────────────────────────────

    def duration_milliseconds(self, other: Any) -> IntegerExpression:
        """Traced DateTimeDurationMilliseconds: ``other - this`` — positive
        when ``other`` is later (TS ``durationMilliseconds``, which emits the
        builtin as ``(other, this)``; the builtin itself is ``first - second``,
        which is what the ``East.DateTime.duration_milliseconds(a, b)``
        namespace function spells)."""
        o = _lift(other)
        if o.east_type.type != "DateTime":
            raise ExpressionError(".duration_*() other must be a DateTime")
        return self._expr(
            _builtin("DateTimeDurationMilliseconds", IntegerType, [], [o.ir, self.ir]), IntegerType
        )

    def duration_seconds(self, other: Any) -> FloatExpression:
        return self.duration_milliseconds(other).to_float() / 1000.0

    def duration_minutes(self, other: Any) -> FloatExpression:
        return self.duration_milliseconds(other).to_float() / 60_000.0

    def duration_hours(self, other: Any) -> FloatExpression:
        return self.duration_milliseconds(other).to_float() / 3_600_000.0

    def duration_days(self, other: Any) -> FloatExpression:
        return self.duration_milliseconds(other).to_float() / 86_400_000.0

    def duration_weeks(self, other: Any) -> FloatExpression:
        return self.duration_milliseconds(other).to_float() / 604_800_000.0

    # ── formatting ──────────────────────────────────────────────────────

    def print_formatted(self, fmt: Any) -> StringExpression:
        """Traced DateTimePrintFormat with a Day.js-style format string (TS
        ``printFormatted``). The format must be a python string literal — it
        is tokenized at trace time (the builtin takes the token array, not the
        raw string).
        """
        if not isinstance(fmt, str):
            raise ExpressionError(
                ".print_formatted() takes a literal format string (tokenized at trace time)"
            )
        from east.datetime_format import DateTimeFormatTokenType, tokenize_datetime_format

        token_t = DateTimeFormatTokenType
        token_nodes = []
        loc = _loc_id()
        for tok in tokenize_datetime_format(fmt):
            if tok.value is None or str(tok.value) == "null":
                payload = _literal(None, NullType)
            else:
                payload = _literal(str(tok.value), StringType)
            token_nodes.append(ir_variant(token_t, tok.type, payload, loc))
        tokens_ir = _k_new_array(ArrayType(token_t), token_nodes)
        return self._expr(
            _builtin("DateTimePrintFormat", StringType, [], [self.ir, tokens_ir]), StringType
        )

    print_format = _deprecated_alias("print_format", "print_formatted")
