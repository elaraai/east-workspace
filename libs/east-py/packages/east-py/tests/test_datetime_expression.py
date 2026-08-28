#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The traced DateTime surface's SIGN conventions — where python has two
spellings of one builtin and they must not be confused (#623)."""

from __future__ import annotations

from datetime import UTC, datetime

from east import DateTimeType, East, FloatType, IntegerType

_A = datetime(2024, 1, 1, tzinfo=UTC)
_LATER = datetime(2024, 1, 2, 12, tzinfo=UTC)


def test_the_traced_duration_method_is_other_minus_this_like_typescript():
    """TS ``date1.durationMilliseconds(date2)`` is ``date2 - date1`` (positive
    when the argument is later) — it emits the builtin as ``(other, this)``."""
    ms = East.function([DateTimeType, DateTimeType], IntegerType,
                       lambda _b, x, y: x.duration_milliseconds(y))
    assert ms(_A, _LATER) == 36 * 3_600_000
    assert ms(_LATER, _A) == -36 * 3_600_000
    days = East.function([DateTimeType, DateTimeType], FloatType,
                         lambda _b, x, y: x.duration_days(y))
    assert days(_A, _LATER) == 1.5


def test_the_namespace_duration_is_the_raw_builtin_first_minus_second():
    """``East.DateTime.duration_milliseconds(a, b)`` IS the builtin
    ``DateTimeDurationMilliseconds(a, b)`` — ``a - b`` — on values and in a
    body alike; the method and the namespace function differ in argument
    order exactly as TypeScript's method and the builtin do."""
    assert East.DateTime.duration_milliseconds(_LATER, _A) == 36 * 3_600_000
    traced = East.function([DateTimeType, DateTimeType], IntegerType,
                           lambda _b, x, y: East.DateTime.duration_milliseconds(x, y))
    assert traced(_LATER, _A) == 36 * 3_600_000
