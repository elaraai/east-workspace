#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``East.DateTime`` stdlib — ``libs/east/src/expr/libs/datetime.ts``: the
step-rounding family (``round_down/up/nearest`` × millisecond … week, plus
``round_down_month`` / ``round_down_year``). The constructors the TS file
re-exports (``from_epoch_milliseconds``, ``from_components``,
``parse_formatted``) are the namespace's own builtins."""

from __future__ import annotations

from typing import Any

from east.expression.libs import lib_function
from east.types.types import DateTimeType, IntegerType

_MS = {"millisecond": 1, "second": 1000, "minute": 60000, "hour": 3600000, "day": 86400000}
#: Reference Monday, 1969-12-29T00:00:00Z — three days before the epoch.
_REF_MONDAY_MS = -259200000
_WEEK_MS = 604800000


def _if_else(*branches: Any) -> Any:
    from east.namespace import East

    return East.if_else(*branches)


def _from_ms(ms: Any) -> Any:
    from east.namespace import East

    return East.DateTime.from_epoch_milliseconds(ms)


def _step_ms(b: Any, step: Any, unit: str) -> Any:
    scale = _MS[unit]
    return step if scale == 1 else b.let(step.multiply(scale))


def _down(unit: str) -> Any:
    def body(b: Any, date: Any, step: Any) -> Any:
        epoch_ms = b.let(date.to_epoch_milliseconds())
        step_ms = _step_ms(b, step, unit)
        remainder = b.let(epoch_ms.remainder(step_ms))
        rounded_ms = b.let(epoch_ms.subtract(remainder))
        return _from_ms(rounded_ms)

    body.__name__ = f"round_down_{unit}"
    body.__doc__ = f"``date`` rounded DOWN to a multiple of ``step`` {unit}s (TS ``roundDown{unit.capitalize()}``)."
    return lib_function([DateTimeType, IntegerType], DateTimeType)(body)


def _up(unit: str) -> Any:
    def body(b: Any, date: Any, step: Any) -> Any:
        epoch_ms = b.let(date.to_epoch_milliseconds())
        step_ms = _step_ms(b, step, unit)
        remainder = b.let(epoch_ms.remainder(step_ms))
        rounded_ms = b.let(_if_else(remainder == 0, epoch_ms, epoch_ms.add(step_ms.subtract(remainder))))
        return _from_ms(rounded_ms)

    body.__name__ = f"round_up_{unit}"
    body.__doc__ = f"``date`` rounded UP to a multiple of ``step`` {unit}s (TS ``roundUp{unit.capitalize()}``)."
    return lib_function([DateTimeType, IntegerType], DateTimeType)(body)


def _nearest(unit: str) -> Any:
    def body(b: Any, date: Any, step: Any) -> Any:
        epoch_ms = b.let(date.to_epoch_milliseconds())
        step_ms = _step_ms(b, step, unit)
        remainder = b.let(epoch_ms.remainder(step_ms))
        half_step = b.let(step_ms.divide(2))
        rounded_ms = b.let(_if_else(
            remainder == 0, epoch_ms,
            _if_else(remainder >= half_step,
                     epoch_ms.add(step_ms.subtract(remainder)),
                     epoch_ms.subtract(remainder))))
        return _from_ms(rounded_ms)

    body.__name__ = f"round_nearest_{unit}"
    body.__doc__ = f"``date`` rounded to the NEAREST multiple of ``step`` {unit}s (TS ``roundNearest{unit.capitalize()}``)."
    return lib_function([DateTimeType, IntegerType], DateTimeType)(body)


round_down_millisecond = _down("millisecond")
round_down_second = _down("second")
round_down_minute = _down("minute")
round_down_hour = _down("hour")
round_down_day = _down("day")
round_up_millisecond = _up("millisecond")
round_up_second = _up("second")
round_up_minute = _up("minute")
round_up_hour = _up("hour")
round_up_day = _up("day")
round_nearest_millisecond = _nearest("millisecond")
round_nearest_second = _nearest("second")
round_nearest_minute = _nearest("minute")
round_nearest_hour = _nearest("hour")
round_nearest_day = _nearest("day")


@lib_function([DateTimeType, IntegerType], DateTimeType)
def _round_down_week(b: Any, date: Any, step: Any) -> Any:
    """``date`` rounded DOWN to a Monday, in ``step``-week multiples from the
    reference Monday (TS ``roundDownWeek``)."""
    epoch_ms = b.let(date.to_epoch_milliseconds())
    ref_monday_ms = b.let(_REF_MONDAY_MS)
    offset = b.let(epoch_ms.subtract(ref_monday_ms))
    step_ms = b.let(step.multiply(_WEEK_MS))
    remainder = b.let(offset.remainder(step_ms))
    rounded_offset = b.let(offset.subtract(remainder))
    rounded_ms = b.let(ref_monday_ms.add(rounded_offset))
    return _from_ms(rounded_ms)


@lib_function([DateTimeType, IntegerType], DateTimeType)
def _round_up_week(b: Any, date: Any, step: Any) -> Any:
    """``date`` rounded UP to a Monday (TS ``roundUpWeek``)."""
    epoch_ms = b.let(date.to_epoch_milliseconds())
    ref_monday_ms = b.let(_REF_MONDAY_MS)
    offset = b.let(epoch_ms.subtract(ref_monday_ms))
    step_ms = b.let(step.multiply(_WEEK_MS))
    remainder = b.let(offset.remainder(step_ms))
    rounded_offset = b.let(_if_else(remainder == 0, offset, offset.add(step_ms.subtract(remainder))))
    rounded_ms = b.let(ref_monday_ms.add(rounded_offset))
    return _from_ms(rounded_ms)


@lib_function([DateTimeType, IntegerType], DateTimeType)
def _round_nearest_week(b: Any, date: Any, step: Any) -> Any:
    """``date`` rounded to the NEAREST Monday (TS ``roundNearestWeek``)."""
    epoch_ms = b.let(date.to_epoch_milliseconds())
    ref_monday_ms = b.let(_REF_MONDAY_MS)
    offset = b.let(epoch_ms.subtract(ref_monday_ms))
    step_ms = b.let(step.multiply(_WEEK_MS))
    remainder = b.let(offset.remainder(step_ms))
    half_step = b.let(step_ms.divide(2))
    rounded_offset = b.let(_if_else(
        remainder == 0, offset,
        _if_else(remainder >= half_step, offset.add(step_ms.subtract(remainder)), offset.subtract(remainder))))
    rounded_ms = b.let(ref_monday_ms.add(rounded_offset))
    return _from_ms(rounded_ms)


@lib_function([DateTimeType, IntegerType], DateTimeType)
def _round_down_month(b: Any, date: Any, step: Any) -> Any:
    """The first instant of the ``step``-aligned month (TS ``roundDownMonth``)."""
    from east.namespace import East

    year = b.let(date.get_year())
    month = b.let(date.get_month())
    month_index = b.let(month.subtract(1))
    stepped_month_index = b.let(month_index.subtract(month_index.remainder(step)))
    rounded_month = b.let(stepped_month_index.add(1))
    return East.DateTime.from_components(year, rounded_month)


@lib_function([DateTimeType, IntegerType], DateTimeType)
def _round_down_year(b: Any, date: Any, step: Any) -> Any:
    """January 1st of the ``step``-aligned year (TS ``roundDownYear``)."""
    from east.namespace import East

    year = b.let(date.get_year())
    stepped_year = b.let(year.subtract(year.remainder(step)))
    return East.DateTime.from_components(stepped_year)


round_down_week = _round_down_week
round_up_week = _round_up_week
round_nearest_week = _round_nearest_week
round_down_month = _round_down_month
round_down_year = _round_down_year

__all__ = [
    "round_down_millisecond", "round_down_second", "round_down_minute", "round_down_hour",
    "round_down_day", "round_down_week", "round_down_month", "round_down_year",
    "round_up_millisecond", "round_up_second", "round_up_minute", "round_up_hour",
    "round_up_day", "round_up_week",
    "round_nearest_millisecond", "round_nearest_second", "round_nearest_minute",
    "round_nearest_hour", "round_nearest_day", "round_nearest_week",
]
