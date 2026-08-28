#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The East standard library — ``East.Integer.*`` / ``East.Float.*`` /
``East.DateTime.*`` / ``East.String.*`` / ``East.Blob.*`` and the root
``East.str`` / ``min`` / ``max`` / ``clamp`` — pinned to the TypeScript
``expr/libs/*.ts`` documentation examples, on values AND inside a trace."""

from __future__ import annotations

import warnings
from datetime import UTC, datetime

import pytest

from east import (
    ArrayType,
    DateTimeType,
    East,
    FloatType,
    IntegerType,
    StringType,
)
from east.expression.libs import LazyFunction

I, F, D, S = East.Integer, East.Float, East.DateTime, East.String  # noqa: E741


def _utc(*parts: int) -> datetime:
    return datetime(*parts, tzinfo=UTC)


# ── Integer ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "fn, arg, expected",
    [
        (I.print_comma_seperated, 1234567, "1,234,567"),
        (I.print_comma_seperated, -5432, "-5,432"),
        (I.print_comma_seperated, 999, "999"),
        (I.print_comma_seperated, -9223372036854775808, "-9,223,372,036,854,775,808"),
        (I.print_currency, 1234, "$1,234"),
        (I.print_currency, -42, "-$42"),
        (I.print_compact, 500, "500"),
        # the Integer compact forms always carry two decimals below 10 units
        # of the suffix (the TypeScript body: `${y/1000}.${y/10 % 100}K`)
        (I.print_compact, 1234567, "1.23M"),  # test/integer.examples.ts
        (I.print_compact, 1500, "1.50K"),
        (I.print_compact, 2500000, "2.50M"),
        (I.print_compact, 3140000000, "3.14B"),
        (I.print_compact, -1500, "-1.50K"),
        (I.print_compact, 123456, "123K"),
        (I.print_compact, 12345, "12.3K"),
        (I.print_compact_si, 1234567, "1.23M"),  # test/integer.examples.ts
        (I.print_compact_si, 1500, "1.50k"),
        (I.print_compact_si, 3140000000, "3.14G"),
        (I.print_compact_computing, 1234567, "1.17Mi"),  # test/integer.examples.ts
        (I.print_compact_computing, 1536, "1.50ki"),
        (I.print_compact_computing, 2621440, "2.50Mi"),
        (I.print_compact_computing, 3221225472, "3.00Gi"),
        (I.print_ordinal, 1, "1st"),
        (I.print_ordinal, 2, "2nd"),
        (I.print_ordinal, 3, "3rd"),
        (I.print_ordinal, 4, "4th"),
        (I.print_ordinal, 11, "11th"),
        (I.print_ordinal, 12, "12th"),
        (I.print_ordinal, 13, "13th"),
        (I.print_ordinal, 21, "21st"),
        (I.print_ordinal, 112, "112th"),
        (I.print_ordinal, -1, "-1st"),
        (I.digit_count, 0, 1),
        (I.digit_count, 7, 1),
        (I.digit_count, -1234, 4),
        (I.print_percentage, 45, "45%"),
    ],
)
def test_integer_unary(fn, arg, expected):
    assert fn(arg) == expected


@pytest.mark.parametrize(
    "fn, x, step, expected",
    [
        # the half step is an Integer division: 5 // 2 == 2, so a remainder
        # of 2 already rounds up (the TypeScript body)
        (I.round_nearest, 127, 10, 130),  # test/integer.examples.ts
        (I.round_nearest, 17, 5, 20),
        (I.round_nearest, 16, 5, 15),
        (I.round_nearest, -17, 5, -20),
        (I.round_nearest, -16, 5, -15),
        (I.round_nearest, 15, 5, 15),
        (I.round_nearest, 17, 0, 17),
        (I.round_up, 17, 5, 20),
        (I.round_up, -17, 5, -15),
        (I.round_up, 20, 5, 20),
        (I.round_down, 17, 5, 15),
        (I.round_down, -17, 5, -20),
        (I.round_truncate, 17, 5, 15),
        (I.round_truncate, -17, 5, -15),
    ],
)
def test_integer_rounding(fn, x, step, expected):
    assert fn(x, step) == expected


def test_integer_misspelling_twin():
    assert I.print_comma_separated(1234567) == "1,234,567"


# ── Float ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "fn, arg, expected",
    [
        (F.round_floor, 2.7, 2),
        (F.round_floor, -2.3, -3),
        (F.round_floor, 3.0, 3),
        (F.round_ceil, 2.3, 3),
        (F.round_ceil, -2.7, -2),
        (F.round_ceil, 3.0, 3),
        (F.round_half, 2.5, 3),
        (F.round_half, -2.5, -3),
        (F.round_half, 2.4, 2),
        (F.round_trunc, 2.7, 2),
        (F.round_trunc, -2.7, -2),
        (F.print_currency, 1234.567, "$1,234.57"),
        (F.print_currency, -42.5, "-$42.50"),
        (F.print_currency, 0.005, "$0.01"),
        (F.print_compact, 1500000.0, "1.5M"),  # test/float.examples.ts
        (F.print_compact, 1500.0, "1.5K"),
        (F.print_compact, 3140000000.0, "3.14B"),
        (F.print_compact, 123456.0, "123K"),
        (F.print_compact, -2500000.0, "-2.5M"),
    ],
)
def test_float_unary(fn, arg, expected):
    assert fn(arg) == expected


@pytest.mark.parametrize(
    "fn, x, y, expected",
    [
        (F.round_nearest, 17.6, 5.0, 20.0),
        (F.round_nearest, 3.14159, 0.01, 3.14),
        (F.round_nearest, -17.6, 5.0, -20.0),
        (F.round_nearest, 17.5, 0.0, 17.5),
        (F.round_up, 3.14, 0.1, 3.2),
        (F.round_up, 12.0, 5.0, 15.0),  # test/float.examples.ts
        (F.round_up, 20.0, 5.0, 20.0),  # exact stays
        (F.round_down, 3.19, 0.1, 3.1),
        (F.round_down, -17.9, 5.0, -20.0),
        (F.round_truncate, -17.9, 5.0, -15.0),
        (F.round_truncate, 17.9, 5.0, 15.0),
        (F.round_to_decimals, 3.14159, 2, 3.14),
        (F.round_to_decimals, 2.5, 0, 3.0),
        (F.round_to_decimals, -2.5, 0, -3.0),
        (F.print_comma_seperated, 1234.567, 2, "1,234.57"),
        (F.print_comma_seperated, -5432.1, 3, "-5,432.100"),
        (F.print_comma_seperated, 1234567.0, 0, "1,234,567"),
        (F.print_fixed, 3.14159, 2, "3.14"),
        (F.print_fixed, 42.0, 3, "42.000"),
        (F.print_fixed, -0.5, 1, "-0.5"),
        (F.print_fixed, 2.005, 0, "2"),
        (F.print_percentage, 0.1234, 2, "12.34%"),  # test/float.examples.ts
        (F.print_percentage, 0.452, 1, "45.2%"),
        (F.print_percentage, 1.0, 0, "100.0%"),  # a Float prints with its point
        (F.print_percentage, -0.123, 2, "-12.3%"),
    ],
)
def test_float_binary(fn, x, y, expected):
    got = fn(x, y)
    if isinstance(expected, float):
        assert got == pytest.approx(expected)
    else:
        assert got == expected


def test_float_approx_equal():
    assert F.approx_equal(0.1 + 0.2, 0.3, 1e-9) is True
    assert F.approx_equal(1.0, 1.1, 0.05) is False


@pytest.mark.parametrize("value, what", [(float("nan"), "NaN"), (float("inf"), "Infinity"), (-float("inf"), "-Infinity")])
def test_float_non_finite_refused(value, what):
    with pytest.raises(Exception, match=f"Cannot round {what}"):
        F.round_nearest(value, 1.0)
    with pytest.raises(Exception, match=f"Cannot format {what}"):
        F.print_fixed(value, 2)


# ── DateTime ───────────────────────────────────────────────────────────────

_SUNDAY = _utc(2024, 3, 17, 14, 30, 45, 123000)


@pytest.mark.parametrize(
    "fn, step, expected",
    [
        (D.round_down_millisecond, 100, _utc(2024, 3, 17, 14, 30, 45, 100000)),
        (D.round_up_millisecond, 100, _utc(2024, 3, 17, 14, 30, 45, 200000)),
        (D.round_nearest_millisecond, 100, _utc(2024, 3, 17, 14, 30, 45, 100000)),
        (D.round_down_second, 15, _utc(2024, 3, 17, 14, 30, 45)),
        (D.round_up_second, 15, _utc(2024, 3, 17, 14, 31, 0)),
        (D.round_nearest_second, 30, _utc(2024, 3, 17, 14, 31, 0)),
        (D.round_down_minute, 15, _utc(2024, 3, 17, 14, 30)),
        (D.round_up_minute, 15, _utc(2024, 3, 17, 14, 45)),
        (D.round_nearest_minute, 15, _utc(2024, 3, 17, 14, 30)),
        (D.round_down_hour, 6, _utc(2024, 3, 17, 12)),
        (D.round_up_hour, 6, _utc(2024, 3, 17, 18)),
        (D.round_nearest_hour, 6, _utc(2024, 3, 17, 12)),
        (D.round_down_day, 1, _utc(2024, 3, 17)),
        (D.round_up_day, 1, _utc(2024, 3, 18)),
        (D.round_nearest_day, 1, _utc(2024, 3, 18)),
        (D.round_down_week, 1, _utc(2024, 3, 11)),
        (D.round_up_week, 1, _utc(2024, 3, 18)),
        (D.round_nearest_week, 1, _utc(2024, 3, 18)),
        (D.round_down_month, 1, _utc(2024, 3, 1)),
        (D.round_down_month, 3, _utc(2024, 1, 1)),
        (D.round_down_year, 1, _utc(2024, 1, 1)),
        (D.round_down_year, 10, _utc(2020, 1, 1)),
    ],
)
def test_datetime_rounding(fn, step, expected):
    assert fn(_SUNDAY, step) == expected


def test_datetime_week_rounding_of_a_monday_is_identity():
    monday = _utc(2024, 3, 11)
    assert D.round_down_week(monday, 1) == monday
    assert D.round_up_week(monday, 1) == monday
    assert D.round_nearest_week(monday, 1) == monday


def test_datetime_from_components_defaults_like_typescript():
    assert D.from_components(2024) == _utc(2024, 1, 1)
    assert D.from_components(2024, 6) == _utc(2024, 6, 1)
    assert D.from_components(2024, 6, 15, 8) == _utc(2024, 6, 15, 8)


def test_datetime_formatted_names():
    d = _utc(2024, 3, 17, 14, 30)
    assert D.print_formatted(d, "YYYY-MM-DD HH:mm") == "2024-03-17 14:30"
    assert D.parse_formatted("2024-03-17 14:30", "YYYY-MM-DD HH:mm") == d
    with pytest.warns(DeprecationWarning, match="print_formatted"):
        assert D.print_format(d, "YYYY") == "2024"
    with pytest.warns(DeprecationWarning, match="parse_formatted"):
        assert D.parse_format("2024", "YYYY") == _utc(2024, 1, 1)


# ── String / Blob / root ───────────────────────────────────────────────────


def test_string_print_error():
    frames = [{"filename": "main.py", "line": 12, "column": 5}, {"filename": "lib.py", "line": 3, "column": 1}]
    assert S.print_error("boom", frames) == "Error: boom\n    [0] main.py 12:5\n    [1] lib.py 3:1"


def test_string_print_json_one_argument_form():
    assert S.print_json({"name": "Alice", "age": 30}) == '{"name":"Alice","age":"30"}'
    assert S.print_json(IntegerType, 5) == '"5"'


def test_blob_encode_beast_round_trips():
    encoded = East.Blob.encode_beast([1, 2, 3], "v2", typ=ArrayType(IntegerType))
    assert encoded.decode_beast(ArrayType(IntegerType), "v2") == [1, 2, 3]
    v1 = East.Blob.encode_beast(5)
    assert v1.decode_beast(IntegerType) == 5
    with pytest.raises(ValueError, match="v3"):
        East.Blob.encode_beast(5, "v3")


def test_root_str_min_max_clamp():
    assert East.str("total: ", 5, " of ", 2.5, "!") == "total: 5 of 2.5!"
    assert East.str() == ""
    assert East.min(3, 7) == 3
    assert East.max(3, 7) == 7
    assert East.clamp(5, 0, 10) == 5
    assert East.clamp(-5, 0, 10) == 0
    assert East.clamp(15, 0, 10) == 10
    assert East.clamp("m", "a", "k") == "k"


# ── inside a trace ─────────────────────────────────────────────────────────


def test_stdlib_splices_into_a_function():
    @East.function([IntegerType], StringType)
    def label(b, x):
        return East.str(East.Integer.print_compact(x * 2), " / ", East.Integer.print_ordinal(x))

    assert label(750) == "1.50K / 750th"
    assert label(5000000) == "10.0M / 5000000th"


def test_stdlib_float_and_datetime_in_a_trace():
    @East.function([FloatType, DateTimeType], StringType)
    def report(b, x, d):
        r = b.let(East.Float.round_to_decimals(x, 1))
        return East.str(East.Float.print_currency(r), " @ ",
                        East.DateTime.print_formatted(East.DateTime.round_down_hour(d, 1), "HH:mm"))

    assert report(12.345, _utc(2024, 3, 17, 14, 30)) == "$12.30 @ 14:00"


def test_root_clamp_and_str_in_a_trace():
    @East.function([IntegerType], StringType)
    def f(b, x):
        return East.str("clamped=", East.clamp(x, 0, 10), " max=", East.max(x, 3))

    assert f(15) == "clamped=10 max=15"
    assert f(-2) == "clamped=0 max=3"


def test_lazy_function_builds_once_and_exposes_the_artifact():
    fn = East.Integer.print_ordinal
    assert isinstance(fn, LazyFunction)
    first = fn.resolve()
    assert fn.resolve() is first
    assert fn._east_ir is first._east_ir
    assert "print_ordinal" in repr(fn)


def test_generate_takes_the_typescript_order():
    assert East.Array.generate(3, IntegerType, lambda b, i: i * 2) == [0, 2, 4]
    with pytest.raises(Exception, match="Duplicate key 0 in set"):
        East.Set.generate(3, IntegerType, lambda b, i: i.remainder(2))
    assert set(East.Set.generate(3, IntegerType, lambda b, i: i.remainder(2), lambda b, k: None)) == {0, 1}
    with pytest.raises(Exception, match="Duplicate key 0 in dict"):
        East.Dict.generate(3, IntegerType, IntegerType, lambda b, i: i.remainder(2), lambda b, i: i)
    assert dict(East.Dict.generate(
        3, IntegerType, IntegerType, lambda b, i: i.remainder(2), lambda b, i: i,
        lambda b, old, new, k: old + new)) == {0: 2, 1: 1}
    with pytest.warns(DeprecationWarning, match="TypeScript order"):
        assert East.Array.generate(2, lambda b, i: i, IntegerType) == [0, 1]
    with warnings.catch_warnings():
        warnings.simplefilter("error")

        @East.function([], ArrayType(IntegerType))
        def gen(b):
            return East.Array.generate(3, IntegerType, lambda b, i: i + 1)

        assert gen() == [1, 2, 3]
