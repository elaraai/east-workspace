#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``East.Float`` stdlib — ``libs/east/src/expr/libs/float.ts``, body for body."""

from __future__ import annotations

from typing import Any

from east.expression.libs import lib_function
from east.expression.libs.string import str_
from east.types.types import BooleanType, FloatType, IntegerType, StringType

_NAN = float("nan")
_INF = float("inf")


def _if_else(*branches: Any) -> Any:
    from east.namespace import East

    return East.if_else(*branches)


def _refuse_non_finite(b: Any, x: Any, what: str) -> None:
    """The TS guard every rounding/formatting body opens with."""
    b.if_(x == _NAN, lambda b: b.error(f"Cannot {what} NaN"))
    b.if_(x == _INF, lambda b: b.error(f"Cannot {what} Infinity"))
    b.if_(x == -_INF, lambda b: b.error(f"Cannot {what} -Infinity"))


def _pow10(b: Any, decimals: Any) -> Any:
    """``10.0 ** decimals`` as the TS loop builds it (a ``b.let`` Float)."""
    remaining = b.let(decimals)
    multiplier = b.let(1.0)

    def step(b: Any, _label: Any) -> None:
        b.assign(multiplier, multiplier.multiply(10.0))
        b.assign(remaining, remaining.subtract(1))

    b.while_(remaining > 0, step)
    return multiplier


def _thousands(b: Any, y: Any, ret: Any) -> None:
    def step(b: Any, _label: Any) -> None:
        z = b.let(y.remainder(1000))
        b.if_(z < 10, lambda b: b.assign(ret, str_(",00", z, ret))) \
            .else_if(z < 100, lambda b: b.assign(ret, str_(",0", z, ret))) \
            .else_(lambda b: b.assign(ret, str_(",", z, ret)))
        b.assign(y, y.divide(1000))

    b.while_(y > 999, step)


def _half_away(value: Any) -> Any:
    """Round a Float to an integral Float, ties away from zero — the TS
    ``shifted.subtract(shifted.remainder(1.0))`` on ``x ± 0.5``."""
    return _if_else(value >= 0.0,
                    value.add(0.5).subtract(value.add(0.5).remainder(1.0)),
                    value.subtract(0.5).subtract(value.subtract(0.5).remainder(1.0)))


@lib_function([FloatType, FloatType, FloatType], BooleanType)
def _approx_equal(b: Any, x: Any, y: Any, epsilon: Any) -> None:
    """``|x - y| <= epsilon`` (TS ``approxEqual``)."""
    diff = b.let(x.subtract(y).abs())
    b.return_(diff <= epsilon)


@lib_function([FloatType], IntegerType)
def _round_floor(b: Any, x: Any) -> None:
    """The largest Integer <= ``x`` (TS ``roundFloor``)."""
    rem = b.let(x.remainder(1.0))
    is_exact = b.let((rem == 0.0) | (rem == -0.0))
    floored = b.let(_if_else(is_exact, x, _if_else(x >= 0.0, x.subtract(rem), x.subtract(rem).subtract(1.0))))
    b.return_(floored.to_integer())


@lib_function([FloatType], IntegerType)
def _round_ceil(b: Any, x: Any) -> None:
    """The smallest Integer >= ``x`` (TS ``roundCeil``)."""
    rem = b.let(x.remainder(1.0))
    is_exact = b.let((rem == 0.0) | (rem == -0.0))
    ceiled = b.let(_if_else(is_exact, x, _if_else(x >= 0.0, x.subtract(rem).add(1.0), x.subtract(rem))))
    b.return_(ceiled.to_integer())


@lib_function([FloatType], IntegerType)
def _round_half(b: Any, x: Any) -> None:
    """The nearest Integer, ties away from zero (TS ``roundHalf``)."""
    rounded = b.let(_half_away(x))
    b.return_(rounded.to_integer())


@lib_function([FloatType], IntegerType)
def _round_trunc(b: Any, x: Any) -> None:
    """The Integer part of ``x`` (TS ``roundTrunc``)."""
    truncated = b.let(x.subtract(x.remainder(1.0)))
    b.return_(truncated.to_integer())


@lib_function([FloatType, FloatType], FloatType)
def _round_nearest(b: Any, x: Any, step: Any) -> None:
    """The nearest multiple of ``step``, ties away from zero (TS ``roundNearest``)."""
    _refuse_non_finite(b, x, "round")
    b.if_(step == 0.0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    divisions = b.let(x.divide(abs_step))
    rounded_divisions = b.let(_half_away(divisions))
    b.return_(rounded_divisions.multiply(abs_step))


@lib_function([FloatType, FloatType], FloatType)
def _round_up(b: Any, x: Any, step: Any) -> None:
    """The smallest multiple of ``step`` >= ``x`` (TS ``roundUp``)."""
    _refuse_non_finite(b, x, "round")
    b.if_(step == 0.0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    divisions = b.let(x.divide(abs_step))
    rem = b.let(divisions.remainder(1.0))
    is_exact = b.let((rem == 0.0) | (rem == -0.0))
    b.if_(is_exact, lambda b: b.return_(x))
    ceiled = b.let(_if_else(x >= 0.0, divisions.subtract(rem).add(1.0), divisions.subtract(rem)))
    b.return_(ceiled.multiply(abs_step))


@lib_function([FloatType, FloatType], FloatType)
def _round_down(b: Any, x: Any, step: Any) -> None:
    """The largest multiple of ``step`` <= ``x`` (TS ``roundDown``)."""
    _refuse_non_finite(b, x, "round")
    b.if_(step == 0.0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    divisions = b.let(x.divide(abs_step))
    rem = b.let(divisions.remainder(1.0))
    is_exact = b.let((rem == 0.0) | (rem == -0.0))
    b.if_(is_exact, lambda b: b.return_(x))
    floored = b.let(_if_else(x >= 0.0, divisions.subtract(rem), divisions.subtract(rem).subtract(1.0)))
    b.return_(floored.multiply(abs_step))


@lib_function([FloatType, FloatType], FloatType)
def _round_truncate(b: Any, x: Any, step: Any) -> None:
    """The multiple of ``step`` between zero and ``x`` closest to ``x`` (TS ``roundTruncate``)."""
    _refuse_non_finite(b, x, "round")
    b.if_(step == 0.0, lambda b: b.return_(x))
    abs_step = b.let(step.abs())
    divisions = b.let(x.divide(abs_step))
    truncated = b.let(divisions.subtract(divisions.remainder(1.0)))
    b.return_(truncated.multiply(abs_step))


@lib_function([FloatType, IntegerType], FloatType)
def _round_to_decimals(b: Any, x: Any, decimals: Any) -> None:
    """``x`` rounded to ``decimals`` places, ties away from zero (TS ``roundToDecimals``)."""
    _refuse_non_finite(b, x, "round")
    multiplier = _pow10(b, decimals)
    scaled = b.let(x.multiply(multiplier))
    rounded = b.let(_half_away(scaled))
    b.return_(rounded.divide(multiplier))


def _split_fixed(b: Any, abs_x: Any, multiplier: Any) -> tuple:
    """``(integer_part, frac_part)`` of ``abs_x`` rounded at ``multiplier`` —
    the TS scale / shift / split steps."""
    scaled = b.let(abs_x.multiply(multiplier))
    shifted = b.let(scaled.add(0.5))
    rounded_scaled_float = b.let(shifted.subtract(shifted.remainder(1.0)))
    rounded_scaled = b.let(rounded_scaled_float.to_integer())
    integer_part = b.let(rounded_scaled.divide(multiplier.to_integer()))
    frac_part = b.let(rounded_scaled.remainder(multiplier.to_integer()))
    return integer_part, frac_part


def _padded_fraction(b: Any, frac_part: Any, decimals: Any) -> tuple:
    """``(frac_str, padding)`` — the fraction's digits and its leading zeros."""
    frac_str = b.let(str_(frac_part))
    padding_needed = b.let(decimals.subtract(frac_str.length()))
    padding = b.let("")

    def pad(b: Any, _label: Any) -> None:
        b.assign(padding, str_("0", padding))
        b.assign(padding_needed, padding_needed.subtract(1))

    b.while_(padding_needed > 0, pad)
    return frac_str, padding


@lib_function([FloatType, IntegerType], StringType)
def _print_comma_seperated(b: Any, x: Any, decimals: Any) -> None:
    """``1234.567, 2`` → ``"1,234.57"`` (TS ``printCommaSeperated``)."""
    _refuse_non_finite(b, x, "format")
    negative = b.let(x < 0.0)
    abs_x = b.let(x.abs())
    multiplier = _pow10(b, decimals)
    integer_part, frac_part = _split_fixed(b, abs_x, multiplier)
    int_with_commas = b.let(integer_part)
    comma_ret = b.let("")
    _thousands(b, int_with_commas, comma_ret)
    int_str = b.let(str_(int_with_commas, comma_ret))
    frac_str, padding = _padded_fraction(b, frac_part, decimals)
    result = b.let(_if_else(decimals == 0, int_str, str_(int_str, ".", padding, frac_str)))
    b.return_(_if_else(negative, str_("-", result), result))


@lib_function([FloatType], StringType)
def _print_currency(b: Any, x: Any) -> None:
    """``1234.567`` → ``"$1,234.57"``, ``-42.5`` → ``"-$42.50"`` (TS ``printCurrency``)."""
    _refuse_non_finite(b, x, "format")
    negative = b.let(x < 0.0)
    abs_x = b.let(x.abs())
    shifted = b.let(abs_x.multiply(100.0).add(0.5))
    cents_total_float = b.let(shifted.subtract(shifted.remainder(1.0)))
    cents_total = b.let(cents_total_float.to_integer())
    dollars = b.let(cents_total.divide(100))
    cents = b.let(cents_total.remainder(100))
    dollars_with_commas = b.let(dollars)
    comma_ret = b.let("")
    _thousands(b, dollars_with_commas, comma_ret)
    dollars_str = b.let(str_(dollars_with_commas, comma_ret))
    cents_str = b.let(_if_else(cents < 10, str_("0", cents), str_(cents)))
    result = b.let(str_(dollars_str, ".", cents_str))
    b.return_(_if_else(negative, str_("-$", result), str_("$", result)))


@lib_function([FloatType, IntegerType], StringType)
def _print_fixed(b: Any, x: Any, decimals: Any) -> None:
    """``3.14159, 2`` → ``"3.14"``, ``42.0, 3`` → ``"42.000"`` (TS ``printFixed``)."""
    _refuse_non_finite(b, x, "format")
    negative = b.let(x < 0.0)
    abs_x = b.let(x.abs())
    multiplier = _pow10(b, decimals)
    integer_part, frac_part = _split_fixed(b, abs_x, multiplier)
    frac_str, padding = _padded_fraction(b, frac_part, decimals)
    result = b.let(_if_else(decimals == 0, str_(integer_part), str_(integer_part, ".", padding, frac_str)))
    b.return_(_if_else(negative, str_("-", result), result))


@lib_function([FloatType], StringType)
def _print_compact(b: Any, x: Any) -> None:
    """``1500.0`` → ``"1.5K"``, ``3140000000.0`` → ``"3.14B"`` (TS ``printCompact``)."""
    _refuse_non_finite(b, x, "format")
    negative = b.let(x < 0.0)
    y = b.let(x.abs())

    def small(b: Any) -> None:
        shifted = b.let(y.add(0.5))
        rounded_int = b.let(shifted.subtract(shifted.remainder(1.0)))
        rounded = b.let(rounded_int.divide(100.0))
        b.return_(_if_else(negative, str_("-", rounded), str_(rounded)))

    b.if_(y < 1000.0, small)
    scale = b.let(1)
    scaled = b.let(y)

    def grow(b: Any, _label: Any) -> None:
        b.assign(scaled, scaled.divide(1000.0))
        b.assign(scale, scale.add(1))

    b.while_(scaled >= 1000000.0, grow)
    suffix = b.let(_if_else(scale == 1, "K", scale == 2, "M", scale == 3, "B",
                            scale == 4, "T", scale == 5, "Q", "Qi"))
    div = b.let(scaled.divide(1000.0))

    def whole(b: Any) -> None:
        shifted = b.let(div.add(0.5))
        rounded_float = b.let(shifted.subtract(shifted.remainder(1.0)))
        rounded = b.let(rounded_float.to_integer())
        b.return_(_if_else(negative, str_("-", rounded, suffix), str_(rounded, suffix)))

    b.if_(scaled >= 100000.0, whole)

    def tenths(b: Any) -> None:
        shifted = b.let(div.multiply(10.0).add(0.5))
        rounded_int = b.let(shifted.subtract(shifted.remainder(1.0)))
        rounded = b.let(rounded_int.divide(10.0))
        b.return_(_if_else(negative, str_("-", rounded, suffix), str_(rounded, suffix)))

    b.if_(scaled >= 10000.0, tenths)
    shifted = b.let(div.multiply(100.0).add(0.5))
    rounded_int = b.let(shifted.subtract(shifted.remainder(1.0)))
    rounded = b.let(rounded_int.divide(100.0))
    b.return_(_if_else(negative, str_("-", rounded, suffix), str_(rounded, suffix)))


@lib_function([FloatType, IntegerType], StringType)
def _print_percentage(b: Any, x: Any, decimals: Any) -> None:
    """``0.452, 1`` → ``"45.2%"`` (TS ``printPercentage``)."""
    _refuse_non_finite(b, x, "format")
    percentage = b.let(x.multiply(100.0))
    multiplier = _pow10(b, decimals)
    scaled = b.let(percentage.multiply(multiplier))
    shifted = b.let(_if_else(scaled >= 0.0, scaled.add(0.5), scaled.subtract(0.5)))
    rounded_int = b.let(shifted.subtract(shifted.remainder(1.0)))
    rounded = b.let(rounded_int.divide(multiplier))
    b.return_(str_(rounded, "%"))


approx_equal = _approx_equal
round_floor = _round_floor
round_ceil = _round_ceil
round_half = _round_half
round_trunc = _round_trunc
round_nearest = _round_nearest
round_up = _round_up
round_down = _round_down
round_truncate = _round_truncate
round_to_decimals = _round_to_decimals
print_comma_seperated = _print_comma_seperated
print_currency = _print_currency
print_fixed = _print_fixed
print_compact = _print_compact
print_percentage = _print_percentage

__all__ = [
    "approx_equal", "round_floor", "round_ceil", "round_half", "round_trunc", "round_nearest",
    "round_up", "round_down", "round_truncate", "round_to_decimals", "print_comma_seperated",
    "print_currency", "print_fixed", "print_compact", "print_percentage",
]
