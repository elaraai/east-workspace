#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``East.Integer`` stdlib — ``libs/east/src/expr/libs/integer.ts``, body for body."""

from __future__ import annotations

from typing import Any

from east.expression.libs import lib_function
from east.expression.libs.string import str_
from east.types.types import IntegerType, StringType

_INT64_MIN = -9223372036854775808


def _if_else(*branches: Any) -> Any:
    from east.namespace import East

    return East.if_else(*branches)


def _thousands(b: Any, y: Any, ret: Any) -> None:
    """The shared comma-grouping loop: peel thousands off ``y`` into ``ret``
    (both ``b.let`` variables) until ``y`` is below 1000."""

    def step(b: Any, _label: Any) -> None:
        z = b.let(y.remainder(1000))
        b.if_(z < 10, lambda b: b.assign(ret, str_(",00", z, ret))) \
            .else_if(z < 100, lambda b: b.assign(ret, str_(",0", z, ret))) \
            .else_(lambda b: b.assign(ret, str_(",", z, ret)))
        b.assign(y, y.divide(1000))

    b.while_(y > 999, step)


@lib_function([IntegerType], StringType)
def _print_comma_seperated(b: Any, x: Any) -> None:
    """``1234567`` → ``"1,234,567"`` (TS ``printCommaSeperated``)."""
    y = b.let(x)
    negative = b.let(False)

    def negate(b: Any) -> None:
        b.if_(y == _INT64_MIN, lambda b: b.return_("-9,223,372,036,854,775,808"))  # cannot negate -2^63
        b.assign(negative, True)
        b.assign(y, y.negate())

    b.if_(y < 0, negate)
    ret = b.let("")
    _thousands(b, y, ret)
    b.if_(negative, lambda b: b.return_(str_("-", y, ret))).else_(lambda b: b.return_(str_(y, ret)))


@lib_function([IntegerType], StringType)
def _print_currency(b: Any, x: Any) -> None:
    """``1234`` → ``"$1,234"``, ``-42`` → ``"-$42"`` (TS ``printCurrency``)."""
    negative = b.let(x < 0)
    abs_x = b.let(x.abs())
    shifted = b.let(abs_x.multiply(100.0).add(0.5))
    cents_total_float = b.let(shifted.subtract(shifted.remainder(1.0)))
    cents_total = b.let(cents_total_float.to_integer())
    dollars = b.let(cents_total.divide(100))
    dollars_with_commas = b.let(dollars)
    comma_ret = b.let("")
    _thousands(b, dollars_with_commas, comma_ret)
    dollars_str = b.let(str_(dollars_with_commas, comma_ret))
    result = b.let(str_(dollars_str))
    b.return_(_if_else(negative, str_("-$", result), str_("$", result)))


def _compact(b: Any, x: Any, base: int, big: int, suffixes: list, min_text: str,
             hundred_k: int, ten_k: int, tenths_scale: int, hundredths_scale: int) -> None:
    """The compact-form body shared by the three ``print_compact*`` spellings
    (business / SI / binary suffixes)."""
    y = b.let(x)
    negative = b.let(False)

    def negate(b: Any) -> None:
        b.if_(y == _INT64_MIN, lambda b: b.return_(min_text))  # cannot negate -2^63
        b.assign(negative, True)
        b.assign(y, y.negate())

    b.if_(y < 0, negate)
    b.if_(y < 1000, lambda b: b.return_(_if_else(negative, str_("-", y), str_(y))))
    scale = b.let(1)

    def grow(b: Any, _label: Any) -> None:
        b.assign(y, y.divide(base))
        b.assign(scale, scale.add(1))

    b.while_(y >= big, grow)
    suffix = b.let(_if_else(scale == 1, suffixes[0], scale == 2, suffixes[1], scale == 3, suffixes[2],
                            scale == 4, suffixes[3], scale == 5, suffixes[4], suffixes[5]))
    b.if_(y >= hundred_k, lambda b: b.if_(
        negative, lambda b: b.return_(str_("-", y.divide(base), suffix))
    ).else_(lambda b: b.return_(str_(y.divide(base), suffix))))

    def tenths(b: Any) -> None:
        part = b.let(y.multiply(tenths_scale).divide(base).remainder(10))
        b.if_(negative, lambda b: b.return_(str_("-", y.divide(base), ".", part, suffix))) \
            .else_(lambda b: b.return_(str_(y.divide(base), ".", part, suffix)))

    b.if_(y >= ten_k, tenths)
    part = b.let(y.multiply(hundredths_scale).divide(base).remainder(100))

    def two(b: Any) -> None:
        b.if_(negative, lambda b: b.return_(str_("-", y.divide(base), ".", part, suffix))) \
            .else_(lambda b: b.return_(str_(y.divide(base), ".", part, suffix)))

    def one(b: Any) -> None:
        b.if_(negative, lambda b: b.return_(str_("-", y.divide(base), ".0", part, suffix))) \
            .else_(lambda b: b.return_(str_(y.divide(base), ".0", part, suffix)))

    b.if_(part >= 10, two).else_(one)


@lib_function([IntegerType], StringType)
def _print_compact(b: Any, x: Any) -> None:
    """``1500`` → ``"1.5K"``, ``3140000000`` → ``"3.14B"`` — K/M/B/T/Q/Qi (TS ``printCompact``)."""
    # TS: part = y / 100 % 10 (tenths) and y / 10 % 100 (hundredths) — the
    # decimal bases express those as (y * 10 / 1000) % 10 and (y * 100 / 1000) % 100.
    _compact(b, x, 1000, 1000000, ["K", "M", "B", "T", "Q", "Qi"], "-9.22Qi", 100000, 10000, 10, 100)


@lib_function([IntegerType], StringType)
def _print_compact_si(b: Any, x: Any) -> None:
    """``1500`` → ``"1.5k"``, ``3140000000`` → ``"3.14G"`` — k/M/G/T/P/E (TS ``printCompactSI``)."""
    _compact(b, x, 1000, 1000000, ["k", "M", "G", "T", "P", "E"], "-9.22E", 100000, 10000, 10, 100)


@lib_function([IntegerType], StringType)
def _print_compact_computing(b: Any, x: Any) -> None:
    """``1536`` → ``"1.5ki"``, ``3221225472`` → ``"3Gi"`` — ki/Mi/Gi/Ti/Pi/Ei, base 1024
    (TS ``printCompactComputing``)."""
    _compact(b, x, 1024, 1048576, ["ki", "Mi", "Gi", "Ti", "Pi", "Ei"], "-7.99Ei", 102400, 10240, 10, 100)


@lib_function([IntegerType], StringType)
def _print_ordinal(b: Any, x: Any) -> None:
    """``1`` → ``"1st"``, ``11`` → ``"11th"``, ``112`` → ``"112th"`` (TS ``printOrdinal``)."""
    abs_x = b.let(x.abs())
    last_digit = b.let(abs_x.remainder(10))
    last_two_digits = b.let(abs_x.remainder(100))
    b.if_((last_two_digits >= 11) & (last_two_digits <= 13), lambda b: b.return_(str_(x, "th")))
    b.if_(last_digit == 1, lambda b: b.return_(str_(x, "st"))) \
        .else_if(last_digit == 2, lambda b: b.return_(str_(x, "nd"))) \
        .else_if(last_digit == 3, lambda b: b.return_(str_(x, "rd"))) \
        .else_(lambda b: b.return_(str_(x, "th")))


@lib_function([IntegerType], IntegerType)
def _digit_count(b: Any, x: Any) -> None:
    """The number of decimal digits of ``|x|`` (TS ``digitCount``)."""
    b.if_(x == 0, lambda b: b.return_(1))
    b.return_(x.abs().log(10).add(1))


@lib_function([IntegerType, IntegerType], IntegerType)
def _round_nearest(b: Any, x: Any, step: Any) -> None:
    """The nearest multiple of ``step``, ties away from zero (TS ``roundNearest``)."""
    b.if_(step == 0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    abs_x = b.let(x.abs())
    remainder = b.let(abs_x.remainder(abs_step))
    half_step = b.let(abs_step.divide(2))

    def rounded(b: Any) -> None:
        rounded_abs = b.let(_if_else(remainder < half_step,
                                     abs_x.subtract(remainder),
                                     abs_x.add(abs_step.subtract(remainder))))
        b.if_(x >= 0, lambda b: b.return_(rounded_abs)).else_(lambda b: b.return_(rounded_abs.negate()))

    b.if_(remainder == 0, lambda b: b.return_(x)).else_(rounded)


@lib_function([IntegerType, IntegerType], IntegerType)
def _round_up(b: Any, x: Any, step: Any) -> None:
    """The smallest multiple of ``step`` >= ``x`` (TS ``roundUp``)."""
    b.if_(step == 0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    remainder = b.let(x.remainder(abs_step))
    b.if_(remainder == 0, lambda b: b.return_(x)).else_(
        lambda b: b.if_(x >= 0, lambda b: b.return_(x.add(abs_step.subtract(remainder))))
        .else_(lambda b: b.return_(x.subtract(remainder))))


@lib_function([IntegerType, IntegerType], IntegerType)
def _round_down(b: Any, x: Any, step: Any) -> None:
    """The largest multiple of ``step`` <= ``x`` (TS ``roundDown``)."""
    b.if_(step == 0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    remainder = b.let(x.remainder(abs_step))
    b.if_(remainder == 0, lambda b: b.return_(x)).else_(
        lambda b: b.if_(x >= 0, lambda b: b.return_(x.subtract(remainder)))
        .else_(lambda b: b.return_(x.subtract(abs_step.add(remainder)))))


@lib_function([IntegerType, IntegerType], IntegerType)
def _round_truncate(b: Any, x: Any, step: Any) -> None:
    """The multiple of ``step`` between zero and ``x`` closest to ``x`` (TS ``roundTruncate``)."""
    b.if_(step == 0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    remainder = b.let(x.remainder(abs_step))
    b.if_(remainder == 0, lambda b: b.return_(x)).else_(lambda b: b.return_(x.subtract(remainder)))


@lib_function([IntegerType], StringType)
def _print_percentage(b: Any, x: Any) -> None:
    """``45`` → ``"45%"`` (TS ``printPercentage``)."""
    b.return_(str_(x, "%"))


print_comma_seperated = _print_comma_seperated
print_currency = _print_currency
print_compact = _print_compact
print_compact_si = _print_compact_si
print_compact_computing = _print_compact_computing
print_ordinal = _print_ordinal
digit_count = _digit_count
round_nearest = _round_nearest
round_up = _round_up
round_down = _round_down
round_truncate = _round_truncate
print_percentage = _print_percentage

__all__ = [
    "print_comma_seperated", "print_currency", "print_compact", "print_compact_si",
    "print_compact_computing", "print_ordinal", "digit_count", "round_nearest", "round_up",
    "round_down", "round_truncate", "print_percentage",
]
