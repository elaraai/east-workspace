#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The ``East`` namespace — builtins for primitive scalars.

Python's ``float``/``int``/``str``/``bool``/``datetime`` are built-in types we
can't attach methods to, so their East builtins live here as namespace
functions taking the value as the first argument (mirroring the TS static
namespaces):

    from east import East
    East.Float.sqrt(2.0)
    East.String.split("a,b,c", ",")
    East.Integer.pow(2, 10)
    East.less(IntegerType, 1, 2)

Every function delegates to the corresponding east-c builtin via ``call_builtin``
— no scalar semantics are reimplemented in Python.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from east.expression.control import (
    block,
    break_,
    continue_,
    for_,
    label,
    let,
    new_array,
    new_dict,
    new_matrix,
    new_set,
    new_vector,
    ref,
    try_catch,
    while_,
)
from east.expression.function import (
    async_function as _async_function,
)
from east.expression.function import (
    compile_ as _compile,
)
from east.expression.function import (
    compile_async as _compile_async,
)
from east.expression.function import (
    function as _function,
)
from east.expression.lift import as_, builtin, greatest, if_else, least, value, wrap_recursive
from east.expression.platform import (
    async_generic_platform as _async_generic_platform,
)
from east.expression.platform import (
    async_platform as _async_platform,
)
from east.expression.platform import (
    generic_platform as _generic_platform,
)
from east.expression.platform import (
    platform as _platform,
)
from east.expression.statements import (
    assign,
    const,
    do,
    error,
    if_,
    match_,
    return_,
    try_,
)
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    EastType,
    FloatType,
    IntegerType,
    MatrixType,
    NullType,
    PatchType,
    SetType,
    StringType,
    StructType,
    VectorType,
)
from east.types.values import EastValue, _call_builtin


class _FloatNamespace:
    """East ``Float`` builtins (f64)."""

    @staticmethod
    def to_integer(x: float) -> int:
        """Truncate a Float toward zero to an Integer (east-c FloatToInteger).

        Args:
            x: The Float (f64) to convert.

        Returns:
            The Integer (i64) part of ``x`` with the fractional component dropped
            (truncation toward zero, not rounding).
        """
        return _call_builtin("FloatToInteger", [], [x], IntegerType)

    @staticmethod
    def negate(x: float) -> float:
        """Arithmetic negation, ``-x`` (east-c FloatNegate).

        Args:
            x: The Float to negate.

        Returns:
            ``-x`` as a Float.
        """
        return _call_builtin("FloatNegate", [], [x], FloatType)

    @staticmethod
    def add(a: float, b: float) -> float:
        """Sum of two Floats, ``a + b`` (east-c FloatAdd).

        Args:
            a: The left addend.
            b: The right addend.

        Returns:
            ``a + b`` under IEEE-754 f64 arithmetic.
        """
        return _call_builtin("FloatAdd", [], [a, b], FloatType)

    @staticmethod
    def subtract(a: float, b: float) -> float:
        """Difference of two Floats, ``a - b`` (east-c FloatSubtract).

        Args:
            a: The minuend.
            b: The subtrahend.

        Returns:
            ``a - b`` under IEEE-754 f64 arithmetic.
        """
        return _call_builtin("FloatSubtract", [], [a, b], FloatType)

    @staticmethod
    def multiply(a: float, b: float) -> float:
        """Product of two Floats, ``a * b`` (east-c FloatMultiply).

        Args:
            a: The left factor.
            b: The right factor.

        Returns:
            ``a * b`` under IEEE-754 f64 arithmetic.
        """
        return _call_builtin("FloatMultiply", [], [a, b], FloatType)

    @staticmethod
    def divide(a: float, b: float) -> float:
        """Quotient of two Floats, ``a / b`` (east-c FloatDivide).

        Args:
            a: The dividend.
            b: The divisor.

        Returns:
            ``a / b`` under IEEE-754 f64 arithmetic (division by zero yields an
            infinity or NaN rather than raising).
        """
        return _call_builtin("FloatDivide", [], [a, b], FloatType)

    @staticmethod
    def remainder(a: float, b: float) -> float:
        """Floating-point remainder of ``a / b`` (east-c FloatRemainder).

        Args:
            a: The dividend.
            b: The divisor.

        Returns:
            The remainder left after dividing ``a`` by ``b``, carrying the sign of
            ``a``.
        """
        return _call_builtin("FloatRemainder", [], [a, b], FloatType)

    @staticmethod
    def pow(base: float, exponent: float) -> float:
        """Raise ``base`` to ``exponent`` (east-c FloatPow).

        Args:
            base: The base value.
            exponent: The exponent value.

        Returns:
            ``base ** exponent`` as a Float.
        """
        return _call_builtin("FloatPow", [], [base, exponent], FloatType)

    @staticmethod
    def abs(x: float) -> float:
        """Absolute value, ``|x|`` (east-c FloatAbs).

        Args:
            x: The Float whose magnitude is taken.

        Returns:
            The non-negative magnitude of ``x``.
        """
        return _call_builtin("FloatAbs", [], [x], FloatType)

    @staticmethod
    def sign(x: float) -> float:
        """Sign of ``x`` as ``-1.0`` / ``0.0`` / ``1.0`` (east-c FloatSign).

        Args:
            x: The Float to inspect.

        Returns:
            ``-1.0`` if ``x`` is negative, ``1.0`` if positive, and ``0.0`` for
            zero. The result is a Float, not an Integer.
        """
        return _call_builtin("FloatSign", [], [x], FloatType)

    @staticmethod
    def sqrt(x: float) -> float:
        """Square root of ``x`` (east-c FloatSqrt).

        Args:
            x: The radicand.

        Returns:
            The non-negative square root of ``x``; NaN for a negative input.
        """
        return _call_builtin("FloatSqrt", [], [x], FloatType)

    @staticmethod
    def exp(x: float) -> float:
        """Natural exponential, ``e ** x`` (east-c FloatExp).

        Args:
            x: The exponent.

        Returns:
            ``e`` raised to the power ``x``.
        """
        return _call_builtin("FloatExp", [], [x], FloatType)

    @staticmethod
    def log(x: float) -> float:
        """Natural (base-``e``) logarithm of ``x`` (east-c FloatLog).

        Args:
            x: The Float whose logarithm is taken.

        Returns:
            ``ln(x)``; NaN for a negative input and negative infinity at zero.
        """
        return _call_builtin("FloatLog", [], [x], FloatType)

    @staticmethod
    def sin(x: float) -> float:
        """Sine of ``x`` in radians (east-c FloatSin).

        Args:
            x: The angle in radians.

        Returns:
            ``sin(x)``.
        """
        return _call_builtin("FloatSin", [], [x], FloatType)

    @staticmethod
    def cos(x: float) -> float:
        """Cosine of ``x`` in radians (east-c FloatCos).

        Args:
            x: The angle in radians.

        Returns:
            ``cos(x)``.
        """
        return _call_builtin("FloatCos", [], [x], FloatType)

    @staticmethod
    def tan(x: float) -> float:
        """Tangent of ``x`` in radians (east-c FloatTan).

        Args:
            x: The angle in radians.

        Returns:
            ``tan(x)``.
        """
        return _call_builtin("FloatTan", [], [x], FloatType)


class _IntegerNamespace:
    """East ``Integer`` builtins (i64)."""

    @staticmethod
    def to_float(x: int) -> float:
        """Widen an Integer to a Float (east-c IntegerToFloat).

        Args:
            x: the i64 value to convert.

        Returns:
            the value as a Float (f64).
        """
        return _call_builtin("IntegerToFloat", [], [x], FloatType)

    @staticmethod
    def negate(x: int) -> int:
        """Arithmetic negation (east-c IntegerNegate).

        Args:
            x: the i64 value to negate.

        Returns:
            ``-x`` as an Integer.
        """
        return _call_builtin("IntegerNegate", [], [x], IntegerType)

    @staticmethod
    def add(a: int, b: int) -> int:
        """Addition (east-c IntegerAdd).

        Args:
            a: the first addend.
            b: the second addend.

        Returns:
            ``a + b`` as an Integer.
        """
        return _call_builtin("IntegerAdd", [], [a, b], IntegerType)

    @staticmethod
    def subtract(a: int, b: int) -> int:
        """Subtraction (east-c IntegerSubtract).

        Args:
            a: the minuend.
            b: the subtrahend.

        Returns:
            ``a - b`` as an Integer.
        """
        return _call_builtin("IntegerSubtract", [], [a, b], IntegerType)

    @staticmethod
    def multiply(a: int, b: int) -> int:
        """Multiplication (east-c IntegerMultiply).

        Args:
            a: the first factor.
            b: the second factor.

        Returns:
            ``a * b`` as an Integer.
        """
        return _call_builtin("IntegerMultiply", [], [a, b], IntegerType)

    @staticmethod
    def divide(a: int, b: int) -> int:
        """Truncating integer division (east-c IntegerDivide).

        The quotient is truncated toward zero, not floored, so it differs from
        Python's ``//`` for operands of mixed sign.

        Args:
            a: the dividend.
            b: the divisor.

        Returns:
            ``a / b`` truncated toward zero, as an Integer.

        Raises:
            EastError: if ``b`` is zero.
        """
        return _call_builtin("IntegerDivide", [], [a, b], IntegerType)

    @staticmethod
    def remainder(a: int, b: int) -> int:
        """Remainder of ``a / b`` (east-c IntegerRemainder).

        Pairs with the truncating :meth:`divide`, so the result takes the sign
        of ``a`` and differs from Python's ``%`` for operands of mixed sign.

        Args:
            a: the dividend.
            b: the divisor.

        Returns:
            ``a - (a / b) * b`` as an Integer.

        Raises:
            EastError: if ``b`` is zero.
        """
        return _call_builtin("IntegerRemainder", [], [a, b], IntegerType)

    @staticmethod
    def pow(base: int, exponent: int) -> int:
        """Integer exponentiation, ``base ** exponent`` (east-c IntegerPow).

        Args:
            base: the base value.
            exponent: the power to raise ``base`` to.

        Returns:
            ``base`` raised to ``exponent`` as an Integer.
        """
        return _call_builtin("IntegerPow", [], [base, exponent], IntegerType)

    @staticmethod
    def abs(x: int) -> int:
        """Absolute value (east-c IntegerAbs).

        Args:
            x: the i64 value.

        Returns:
            the magnitude of ``x`` as a non-negative Integer.
        """
        return _call_builtin("IntegerAbs", [], [x], IntegerType)

    @staticmethod
    def sign(x: int) -> int:
        """Sign of ``x`` (east-c IntegerSign).

        Args:
            x: the i64 value.

        Returns:
            ``-1`` if ``x`` is negative, ``0`` if zero, ``1`` if positive.
        """
        return _call_builtin("IntegerSign", [], [x], IntegerType)

    @staticmethod
    def log(x: int, base: int) -> int:
        """Integer logarithm of ``x`` to ``base`` (east-c IntegerLog).

        Args:
            x: the value to take the logarithm of.
            base: the logarithm base.

        Returns:
            the integer logarithm as an Integer.
        """
        return _call_builtin("IntegerLog", [], [x, base], IntegerType)


class _StringNamespace:
    """East ``String`` builtins."""

    @staticmethod
    def concat(a: str, b: str) -> str:
        """Concatenate two strings (east-c StringConcat).

        Args:
            a: The left-hand string.
            b: The right-hand string, appended after ``a``.

        Returns:
            ``a`` followed by ``b``.
        """
        return _call_builtin("StringConcat", [], [a, b], StringType)

    @staticmethod
    def repeat(s: str, n: int) -> str:
        """Repeat ``s`` ``n`` times (east-c StringRepeat).

        Args:
            s: The string to repeat.
            n: The number of copies; ``0`` yields the empty string.

        Returns:
            The concatenation of ``n`` copies of ``s``.
        """
        return _call_builtin("StringRepeat", [], [s, n], StringType)

    @staticmethod
    def length(s: str) -> int:
        """Number of characters in ``s`` (east-c StringLength)."""
        return _call_builtin("StringLength", [], [s], IntegerType)

    @staticmethod
    def substring(s: str, start: int, end: int) -> str:
        """Substring over the half-open range ``[start, end)`` (east-c StringSubstring).

        Args:
            s: The source string.
            start: Inclusive start index.
            end: Exclusive end index.

        Returns:
            The characters of ``s`` from ``start`` up to but not including ``end``.
        """
        return _call_builtin("StringSubstring", [], [s, start, end], StringType)

    @staticmethod
    def upper_case(s: str) -> str:
        """Convert ``s`` to upper case (east-c StringUpperCase)."""
        return _call_builtin("StringUpperCase", [], [s], StringType)

    @staticmethod
    def lower_case(s: str) -> str:
        """Convert ``s`` to lower case (east-c StringLowerCase)."""
        return _call_builtin("StringLowerCase", [], [s], StringType)

    @staticmethod
    def split(s: str, separator: str) -> Any:
        """Split ``s`` on each occurrence of ``separator`` (east-c StringSplit).

        Args:
            s: The string to split.
            separator: The delimiter to split on.

        Returns:
            An ``Array<String>`` of the pieces between separators.
        """
        return _call_builtin("StringSplit", [], [s, separator], ArrayType(StringType))

    @staticmethod
    def trim(s: str) -> str:
        """Remove leading and trailing whitespace from ``s`` (east-c StringTrim)."""
        return _call_builtin("StringTrim", [], [s], StringType)

    @staticmethod
    def trim_start(s: str) -> str:
        """Remove leading whitespace from ``s`` (east-c StringTrimStart)."""
        return _call_builtin("StringTrimStart", [], [s], StringType)

    @staticmethod
    def trim_end(s: str) -> str:
        """Remove trailing whitespace from ``s`` (east-c StringTrimEnd)."""
        return _call_builtin("StringTrimEnd", [], [s], StringType)

    @staticmethod
    def encode_utf8(s: str) -> bytes:
        """Encode ``s`` to its UTF-8 byte representation as a Blob (east-c StringEncodeUtf8)."""
        return _call_builtin("StringEncodeUtf8", [], [s], BlobType)

    @staticmethod
    def encode_utf16(s: str) -> bytes:
        """Encode ``s`` to its little-endian UTF-16 byte representation as a Blob (east-c StringEncodeUtf16)."""
        return _call_builtin("StringEncodeUtf16", [], [s], BlobType)

    @staticmethod
    def starts_with(s: str, prefix: str) -> bool:
        """Whether ``s`` begins with ``prefix`` (east-c StringStartsWith).

        Args:
            s: The string to test.
            prefix: The candidate prefix.

        Returns:
            ``True`` if ``s`` starts with ``prefix``.
        """
        return _call_builtin("StringStartsWith", [], [s, prefix], BooleanType)

    @staticmethod
    def ends_with(s: str, suffix: str) -> bool:
        """Whether ``s`` ends with ``suffix`` (east-c StringEndsWith).

        Args:
            s: The string to test.
            suffix: The candidate suffix.

        Returns:
            ``True`` if ``s`` ends with ``suffix``.
        """
        return _call_builtin("StringEndsWith", [], [s, suffix], BooleanType)

    @staticmethod
    def contains(s: str, substring: str) -> bool:
        """Whether ``s`` contains ``substring`` anywhere (east-c StringContains).

        Args:
            s: The string to search.
            substring: The literal substring to look for.

        Returns:
            ``True`` if ``substring`` occurs in ``s``.
        """
        return _call_builtin("StringContains", [], [s, substring], BooleanType)

    @staticmethod
    def index_of(s: str, substring: str) -> int:
        """Index of the first occurrence of ``substring`` in ``s`` (east-c StringIndexOf).

        Args:
            s: The string to search.
            substring: The literal substring to locate.

        Returns:
            The zero-based index of the first match, or ``-1`` if ``substring``
            does not occur in ``s``.
        """
        return _call_builtin("StringIndexOf", [], [s, substring], IntegerType)

    @staticmethod
    def replace(s: str, find: str, replacement: str) -> str:
        """Replace every occurrence of ``find`` with ``replacement`` (east-c StringReplace).

        Args:
            s: The source string.
            find: The literal substring to replace.
            replacement: The string to substitute for each match.

        Returns:
            ``s`` with all occurrences of ``find`` replaced.
        """
        return _call_builtin("StringReplace", [], [s, find, replacement], StringType)

    @staticmethod
    def regex_contains(s: str, pattern: str, flags: str = "") -> bool:
        """Whether ``pattern`` matches anywhere in ``s`` (east-c RegexContains).

        Args:
            s: The string to search.
            pattern: The regular expression.
            flags: Optional regex flags (e.g. ``"i"`` for case-insensitive).

        Returns:
            ``True`` if ``pattern`` matches somewhere in ``s``.
        """
        return _call_builtin("RegexContains", [], [s, pattern, flags], BooleanType)

    @staticmethod
    def regex_index_of(s: str, pattern: str, flags: str = "") -> int:
        """Index of the first ``pattern`` match in ``s`` (east-c RegexIndexOf).

        Args:
            s: The string to search.
            pattern: The regular expression.
            flags: Optional regex flags (e.g. ``"i"`` for case-insensitive).

        Returns:
            The zero-based index of the first match, or ``-1`` if ``pattern``
            does not match in ``s``.
        """
        return _call_builtin("RegexIndexOf", [], [s, pattern, flags], IntegerType)

    @staticmethod
    def regex_replace(s: str, pattern: str, replacement: str, flags: str = "") -> str:
        """Replace ``pattern`` matches in ``s`` with ``replacement`` (east-c RegexReplace).

        Args:
            s: The source string.
            pattern: The regular expression to match.
            replacement: The replacement string (may reference capture groups).
            flags: Optional regex flags (e.g. ``"g"`` for global, ``"i"`` for
                case-insensitive).

        Returns:
            ``s`` with matches of ``pattern`` replaced by ``replacement``.
        """
        return _call_builtin("RegexReplace", [], [s, pattern, flags, replacement], StringType)

    @staticmethod
    def print(typ: EastType, value: EastValue) -> str:
        """Render ``value`` in East text format (east-c Print).

        Args:
            typ: The East type of ``value``, which drives how it is rendered.
            value: The value to render.

        Returns:
            The East text representation of ``value``, parseable back via
            :meth:`parse` with the same ``typ``.
        """
        return _call_builtin("Print", [typ], [value], StringType)

    @staticmethod
    def parse(typ: EastType, s: str) -> Any:
        """Parse ``s`` as an East value of type ``typ`` (east-c Parse).

        Args:
            typ: The target East type to parse into.
            s: The East text representation to parse.

        Returns:
            The parsed value, of type ``typ`` (the inverse of :meth:`print`).
        """
        return _call_builtin("Parse", [typ], [s], typ)

    @staticmethod
    def print_json(typ: EastType, value: EastValue) -> str:
        """Render ``value`` as JSON (east-c StringPrintJSON).

        Args:
            typ: The East type of ``value``, which drives the JSON encoding.
            value: The value to encode.

        Returns:
            The JSON text representation of ``value``, parseable back via
            :meth:`parse_json` with the same ``typ``.
        """
        return _call_builtin("StringPrintJSON", [typ], [value], StringType)

    @staticmethod
    def parse_json(typ: EastType, s: str) -> Any:
        """Parse JSON ``s`` as an East value of type ``typ`` (east-c StringParseJSON).

        Args:
            typ: The target East type to decode into.
            s: The JSON text to parse.

        Returns:
            The decoded value, of type ``typ`` (the inverse of :meth:`print_json`).
        """
        return _call_builtin("StringParseJSON", [typ], [s], typ)


class _DateTimeNamespace:
    """East ``DateTime`` builtins (UTC)."""

    @staticmethod
    def get_year(dt: datetime) -> int:
        """Extract the UTC calendar year (east-c DateTimeGetYear).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The full year, e.g. ``2026``.
        """
        return _call_builtin("DateTimeGetYear", [], [dt], IntegerType)

    @staticmethod
    def get_month(dt: datetime) -> int:
        """Extract the UTC month (east-c DateTimeGetMonth).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The month as ``1`` (January) through ``12`` (December).
        """
        return _call_builtin("DateTimeGetMonth", [], [dt], IntegerType)

    @staticmethod
    def get_day_of_month(dt: datetime) -> int:
        """Extract the UTC day of the month (east-c DateTimeGetDayOfMonth).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The day of the month, ``1`` through ``31``.
        """
        return _call_builtin("DateTimeGetDayOfMonth", [], [dt], IntegerType)

    @staticmethod
    def get_hour(dt: datetime) -> int:
        """Extract the UTC hour (east-c DateTimeGetHour).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The hour on a 24-hour clock, ``0`` through ``23``.
        """
        return _call_builtin("DateTimeGetHour", [], [dt], IntegerType)

    @staticmethod
    def get_minute(dt: datetime) -> int:
        """Extract the UTC minute (east-c DateTimeGetMinute).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The minute of the hour, ``0`` through ``59``.
        """
        return _call_builtin("DateTimeGetMinute", [], [dt], IntegerType)

    @staticmethod
    def get_second(dt: datetime) -> int:
        """Extract the UTC second (east-c DateTimeGetSecond).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The second of the minute, ``0`` through ``59``.
        """
        return _call_builtin("DateTimeGetSecond", [], [dt], IntegerType)

    @staticmethod
    def get_millisecond(dt: datetime) -> int:
        """Extract the UTC sub-second milliseconds (east-c DateTimeGetMillisecond).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The milliseconds within the current second, ``0`` through ``999``.
        """
        return _call_builtin("DateTimeGetMillisecond", [], [dt], IntegerType)

    @staticmethod
    def get_day_of_week(dt: datetime) -> int:
        """Extract the UTC ISO 8601 day of the week (east-c DateTimeGetDayOfWeek).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            The weekday as ``1`` (Monday) through ``7`` (Sunday) — ISO 8601
            numbering, not the Python ``date.weekday()`` (0-6, Monday=0) or
            ``isoweekday()`` conventions.
        """
        return _call_builtin("DateTimeGetDayOfWeek", [], [dt], IntegerType)

    @staticmethod
    def to_epoch_milliseconds(dt: datetime) -> int:
        """Convert to milliseconds since the Unix epoch (east-c DateTimeToEpochMilliseconds).

        Args:
            dt: The datetime, interpreted as UTC.

        Returns:
            Milliseconds since ``1970-01-01T00:00:00Z`` (negative for times
            before the epoch). Inverse of :meth:`from_epoch_milliseconds`.
        """
        return _call_builtin("DateTimeToEpochMilliseconds", [], [dt], IntegerType)

    @staticmethod
    def from_epoch_milliseconds(millis: int) -> datetime:
        """Construct a datetime from milliseconds since the Unix epoch (east-c DateTimeFromEpochMilliseconds).

        Args:
            millis: Milliseconds since ``1970-01-01T00:00:00Z`` (may be negative).

        Returns:
            The corresponding UTC datetime. Inverse of
            :meth:`to_epoch_milliseconds`.
        """
        return _call_builtin("DateTimeFromEpochMilliseconds", [], [millis], DateTimeType)

    @staticmethod
    def from_components(
        year: int,
        month: int,
        day: int,
        hour: int,
        minute: int,
        second: int,
        millisecond: int,
    ) -> datetime:
        """Construct a UTC datetime from its calendar components (east-c DateTimeFromComponents).

        Args:
            year: The full year, e.g. ``2026``.
            month: The month, ``1`` (January) through ``12`` (December).
            day: The day of the month, ``1`` through ``31``.
            hour: The hour on a 24-hour clock, ``0`` through ``23``.
            minute: The minute of the hour, ``0`` through ``59``.
            second: The second of the minute, ``0`` through ``59``.
            millisecond: The sub-second milliseconds, ``0`` through ``999``.

        Returns:
            The UTC datetime built from the given components.
        """
        return _call_builtin(
            "DateTimeFromComponents",
            [],
            [year, month, day, hour, minute, second, millisecond],
            DateTimeType,
        )

    @staticmethod
    def add_milliseconds(dt: datetime, millis: int) -> datetime:
        """Offset a datetime by a number of milliseconds (east-c DateTimeAddMilliseconds).

        Args:
            dt: The base datetime, interpreted as UTC.
            millis: Milliseconds to add; negative values move backwards in time.

        Returns:
            A new datetime shifted by ``millis``; the input is unchanged.
        """
        return _call_builtin("DateTimeAddMilliseconds", [], [dt, millis], DateTimeType)

    # ── unit sugar over add/duration_milliseconds (TS-expr parity) ──

    @staticmethod
    def _shift(dt: datetime, n: int | float, scale: int) -> datetime:
        millis = int(n * scale)
        return _call_builtin("DateTimeAddMilliseconds", [], [dt, millis], DateTimeType)

    @staticmethod
    def add_seconds(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` by ``n`` seconds (east-c DateTimeAddMilliseconds, scaled)."""
        return East.DateTime._shift(dt, n, 1000)

    @staticmethod
    def add_minutes(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` by ``n`` minutes."""
        return East.DateTime._shift(dt, n, 60_000)

    @staticmethod
    def add_hours(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` by ``n`` hours."""
        return East.DateTime._shift(dt, n, 3_600_000)

    @staticmethod
    def add_days(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` by ``n`` days."""
        return East.DateTime._shift(dt, n, 86_400_000)

    @staticmethod
    def add_weeks(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` by ``n`` weeks."""
        return East.DateTime._shift(dt, n, 604_800_000)

    @staticmethod
    def subtract_seconds(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` backwards by ``n`` seconds."""
        return East.DateTime._shift(dt, -n, 1000)

    @staticmethod
    def subtract_minutes(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` backwards by ``n`` minutes."""
        return East.DateTime._shift(dt, -n, 60_000)

    @staticmethod
    def subtract_hours(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` backwards by ``n`` hours."""
        return East.DateTime._shift(dt, -n, 3_600_000)

    @staticmethod
    def subtract_days(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` backwards by ``n`` days."""
        return East.DateTime._shift(dt, -n, 86_400_000)

    @staticmethod
    def subtract_weeks(dt: datetime, n: int | float) -> datetime:
        """Offset ``dt`` backwards by ``n`` weeks."""
        return East.DateTime._shift(dt, -n, 604_800_000)

    @staticmethod
    def duration_seconds(a: datetime, b: datetime) -> float:
        """``a - b`` in seconds as a Float (like the TS durationSeconds)."""
        return East.DateTime.duration_milliseconds(a, b) / 1000.0

    @staticmethod
    def duration_minutes(a: datetime, b: datetime) -> float:
        """``a - b`` in minutes as a Float."""
        return East.DateTime.duration_milliseconds(a, b) / 60_000.0

    @staticmethod
    def duration_hours(a: datetime, b: datetime) -> float:
        """``a - b`` in hours as a Float."""
        return East.DateTime.duration_milliseconds(a, b) / 3_600_000.0

    @staticmethod
    def duration_days(a: datetime, b: datetime) -> float:
        """``a - b`` in days as a Float."""
        return East.DateTime.duration_milliseconds(a, b) / 86_400_000.0

    @staticmethod
    def duration_weeks(a: datetime, b: datetime) -> float:
        """``a - b`` in weeks as a Float."""
        return East.DateTime.duration_milliseconds(a, b) / 604_800_000.0

    @staticmethod
    def duration_milliseconds(a: datetime, b: datetime) -> int:
        """Compute the signed millisecond gap between two datetimes (east-c DateTimeDurationMilliseconds).

        Args:
            a: The first datetime.
            b: The second datetime.

        Returns:
            ``a - b`` in milliseconds — the elapsed time from ``b`` to ``a``.
            Positive when ``a`` is later than ``b``, negative when earlier.
        """
        return _call_builtin("DateTimeDurationMilliseconds", [], [a, b], IntegerType)

    @staticmethod
    def print_format(dt: datetime, fmt: str) -> str:
        """Format a UTC datetime with a Day.js-style format string (east-c DateTimePrintFormat).

        ``fmt`` is tokenized into the ``Array<DateTimeFormatToken>`` east-c expects
        — see :func:`east.datetime_format.tokenize_datetime_format` for the full
        table of format codes (``YYYY``, ``MM``, ``DD``, ``HH``, ``mm``, ``ss``,
        ``SSS``, ``A``/``a``, …) and the backslash-escaping rule.

        Args:
            dt: The datetime to format (interpreted as UTC).
            fmt: The format string, e.g. ``"YYYY-MM-DD HH:mm:ss"``.

        Returns:
            The formatted string.
        """
        from east.datetime_format import format_token_array

        return _call_builtin("DateTimePrintFormat", [], [dt, format_token_array(fmt)], StringType)

    @staticmethod
    def parse_format(s: str, fmt: str) -> datetime:
        """Parse ``s`` with a Day.js-style format string (east-c DateTimeParseFormat)."""
        from east.datetime_format import format_token_array

        return _call_builtin("DateTimeParseFormat", [], [s, format_token_array(fmt)], DateTimeType)


class _BooleanNamespace:
    """East ``Boolean`` builtins."""

    @staticmethod
    def not_(x: bool) -> bool:
        """Logical not (east-c BooleanNot)."""
        return _call_builtin("BooleanNot", [], [x], BooleanType)

    @staticmethod
    def and_(a: bool, b: bool) -> bool:
        """Logical and (east-c BooleanAnd)."""
        return _call_builtin("BooleanAnd", [], [a, b], BooleanType)

    @staticmethod
    def or_(a: bool, b: bool) -> bool:
        """Logical or (east-c BooleanOr)."""
        return _call_builtin("BooleanOr", [], [a, b], BooleanType)

    @staticmethod
    def xor(a: bool, b: bool) -> bool:
        """Logical xor (east-c BooleanXor)."""
        return _call_builtin("BooleanXor", [], [a, b], BooleanType)


def _tensor_elem_of(value: Any, kind: str) -> EastType:
    """The element type of a Vector/Matrix argument — an eager
    ``EastVector``/``EastMatrix`` (``element_type``) or a traced expression
    (``east_type``), so one namespace function serves both paths."""
    east_type = getattr(value, "east_type", None)
    if east_type is not None:
        if east_type.type != kind:
            raise TypeError(f"expected a {kind}, got {east_type.type}")
        return east_type.value
    return value.element_type


def _scalar_elem_of(value: Any) -> EastType:
    """The element type a fill value pins (bool before int, like the lifter)."""
    east_type = getattr(value, "east_type", None)
    if east_type is not None:
        return east_type
    if isinstance(value, bool):
        return BooleanType
    if isinstance(value, int):
        return IntegerType
    if isinstance(value, float):
        return FloatType
    raise TypeError(f"cannot infer a Vector element type from {type(value).__name__}")


def _sparse_type(elem: EastType) -> EastType:
    return StructType([("ix", VectorType(IntegerType)), ("v", VectorType(elem))])


def _as_vector(x: Any, what: str) -> Any:
    """``x`` as a Vector — passed through, or an ``Array`` of Float/Integer/
    Boolean elements converted in order via east-c VectorFromArray (#601).

    Serves both paths like every namespace function: a traced Array emits the
    conversion as IR, an eager ``EastArray`` converts natively — so the sparse
    entry points accept the ``rows.map(...)`` results a kernel actually has,
    at exactly the point the values are materialised.
    """
    east_type = getattr(x, "east_type", None)
    if east_type is not None:
        tag = east_type.type
        elem = east_type.value if tag in ("Vector", "Array") else None
    else:
        from east.types.values.collections import EastArray
        from east.types.values.tensor import EastVector

        if isinstance(x, EastVector):
            tag, elem = "Vector", x.element_type
        elif isinstance(x, EastArray):
            tag, elem = "Array", x.element_type
        else:
            raise TypeError(f"{what} expects a Vector or Array, got {type(x).__name__}")
    if tag == "Vector":
        return x
    if tag != "Array":
        raise TypeError(f"{what} expects a Vector or Array, got {tag}")
    if elem.type not in ("Float", "Integer", "Boolean"):
        raise TypeError(
            f"{what} needs Float, Integer or Boolean elements, got {elem.type}")
    return _call_builtin("VectorFromArray", [elem], [x], VectorType(elem))


def _construct_elem(element_type: Any, what: str) -> EastType:
    """Validate the explicit element type of a Vector/Matrix constructor."""
    if not isinstance(element_type, EastType):
        raise TypeError(
            f"{what} takes the element type first, matching the eager "
            f"classmethod — got {type(element_type).__name__}")
    if element_type.type not in ("Float", "Integer", "Boolean"):
        raise TypeError(
            f"{what} element type must be Float, Integer or Boolean, "
            f"got {element_type.type}")
    return element_type


def _fill_value_elem(value: Any, element_type: EastType, what: str) -> None:
    """A fill value must carry the declared element type exactly — a mismatch
    would reinterpret the scalar under the builtin's type parameter."""
    actual = _scalar_elem_of(value)
    if actual != element_type:
        raise TypeError(
            f"{what} value must be {element_type.type} (the declared element "
            f"type), got {actual.type}")


class _VectorNamespace:
    """East ``Vector`` builtins — constructors and the sparse accumulators."""

    @staticmethod
    def from_array(arr: Any) -> Any:
        """Build a Vector from an Array of scalars (east-c VectorFromArray).

        Args:
            arr: The source Array of Float, Integer or Boolean elements.

        Returns:
            A Vector of the array's element type.
        """
        east_type = getattr(arr, "east_type", None)
        elem = east_type.value if east_type is not None else arr.element_type
        return _call_builtin("VectorFromArray", [elem], [arr], VectorType(elem))

    @staticmethod
    def zeros(element_type: Any, length: Any = None) -> Any:
        """A zero-filled Vector (east-c VectorZeros).

        Matches the eager ``EastVector.zeros(element_type, length)``
        classmethod (#601); the one-argument ``zeros(length)`` spelling is
        kept and pins Float.

        Args:
            element_type: The Float, Integer or Boolean element type — or,
                in the one-argument form, the length of a Float vector.
            length: The number of elements.

        Returns:
            A ``Vector<element_type>`` of ``length`` zeros.
        """
        if length is None:
            if isinstance(element_type, EastType):
                raise TypeError("East.Vector.zeros(element_type, length) needs a length")
            element_type, length = FloatType, element_type
        elem = _construct_elem(element_type, "East.Vector.zeros()")
        return _call_builtin("VectorZeros", [elem], [length], VectorType(elem))

    @staticmethod
    def ones(element_type: Any, length: Any = None) -> Any:
        """A ones-filled Vector (east-c VectorOnes).

        Matches the eager ``EastVector.ones(element_type, length)``
        classmethod (#601); the one-argument ``ones(length)`` spelling is
        kept and pins Float.

        Args:
            element_type: The Float, Integer or Boolean element type — or,
                in the one-argument form, the length of a Float vector.
            length: The number of elements.

        Returns:
            A ``Vector<element_type>`` of ``length`` ones.
        """
        if length is None:
            if isinstance(element_type, EastType):
                raise TypeError("East.Vector.ones(element_type, length) needs a length")
            element_type, length = FloatType, element_type
        elem = _construct_elem(element_type, "East.Vector.ones()")
        return _call_builtin("VectorOnes", [elem], [length], VectorType(elem))

    @staticmethod
    def fill(element_type: Any, length: Any = None, value: Any = None) -> Any:
        """A Vector of ``length`` copies of ``value`` (east-c VectorFill).

        Matches the eager ``EastVector.fill(element_type, length, value)``
        classmethod (#601); the two-argument ``fill(length, value)`` spelling
        is kept, with the value's type pinning the element type.

        Args:
            element_type: The Float, Integer or Boolean element type — or,
                in the two-argument form, the length.
            length: The number of elements — or, in the two-argument form,
                the fill value.
            value: The fill value; must carry the declared element type.

        Returns:
            A Vector with every element set to ``value``.
        """
        if value is None:
            if isinstance(element_type, EastType):
                raise TypeError(
                    "East.Vector.fill(element_type, length, value) needs a value")
            length, value = element_type, length
            elem = _scalar_elem_of(value)
        else:
            elem = _construct_elem(element_type, "East.Vector.fill()")
            _fill_value_elem(value, elem, "East.Vector.fill()")
        return _call_builtin("VectorFill", [elem], [length, value], VectorType(elem))

    @staticmethod
    def sparse_axpy(ix_a: Any, v_a: Any, ix_b: Any, v_b: Any, alpha: Any) -> Any:
        """Merge two sparse accumulators, ``vA + alpha * vB`` over the union
        of their strictly ascending index vectors (east-c SparseAxpy).

        Merge, scaled deposit and single-key accumulate all fall out of one
        call (``alpha`` of one, a scale factor, or a one-element right-hand
        side). Entries absent from a side are structurally absent, not
        explicit zeros: an A-only entry passes through unscaled, a B-only
        entry contributes ``alpha * vB`` even when ``alpha`` is NaN.

        Each index/value input may also be an ``Array`` (converted in order
        via VectorFromArray, #601), so per-row values computed inside a
        kernel feed the merge directly.

        Args:
            ix_a: The left accumulator's strictly ascending Integer indices.
            v_a: The left accumulator's values (same length as ``ix_a``).
            ix_b: The right accumulator's strictly ascending Integer indices.
            v_b: The right accumulator's values (same length as ``ix_b``).
            alpha: The scalar factor applied to ``v_b``.

        Returns:
            A ``Struct{ix, v}`` of the merged accumulator.

        Raises:
            EastError: If an index vector is not strictly ascending, or index
                and value lengths differ.
        """
        ix_a = _as_vector(ix_a, "sparse_axpy() indices")
        v_a = _as_vector(v_a, "sparse_axpy() values")
        ix_b = _as_vector(ix_b, "sparse_axpy() indices")
        v_b = _as_vector(v_b, "sparse_axpy() values")
        elem = _tensor_elem_of(v_a, "Vector")
        return _call_builtin(
            "SparseAxpy", [elem], [ix_a, v_a, ix_b, v_b, alpha], _sparse_type(elem)
        )

    @staticmethod
    def sparse_from_pairs(ix: Any, v: Any) -> Any:
        """Build the canonical sparse accumulator from unsorted ``(index,
        value)`` pairs (east-c SparseFromPairs).

        Indices sort ascending and duplicate indices sum, stably, in input
        order — so the float result is deterministic for a given input order.
        Either input may be an ``Array`` (converted in order via
        VectorFromArray, #601) — the natural way to seed an accumulator from
        ``rows.map(...)`` results inside a kernel — and the conversion
        preserves input order, so the duplicate-summing stability is
        identical whichever input type is given.

        Args:
            ix: The Integer indices, in any order, possibly with duplicates.
            v: The values (same length as ``ix``).

        Returns:
            A ``Struct{ix, v}`` with strictly ascending ``ix`` and summed ``v``.

        Raises:
            EastError: If the index and value lengths differ.
        """
        ix = _as_vector(ix, "sparse_from_pairs() indices")
        v = _as_vector(v, "sparse_from_pairs() values")
        elem = _tensor_elem_of(v, "Vector")
        return _call_builtin("SparseFromPairs", [elem], [ix, v], _sparse_type(elem))

    @staticmethod
    def sparse_filter_gt(ix: Any, v: Any, threshold: Any) -> Any:
        """Compact a sparse accumulator, keeping entries strictly greater than
        ``threshold`` under East's total order (east-c SparseFilterGt).

        Either input may be an ``Array`` (converted in order via
        VectorFromArray, #601).

        Args:
            ix: The accumulator's strictly ascending Integer indices.
            v: The accumulator's values (same length as ``ix``).
            threshold: The exclusive lower bound a value must exceed to survive.

        Returns:
            A ``Struct{ix, v}`` of the surviving entries, in order.

        Raises:
            EastError: If the index vector is not strictly ascending, or index
                and value lengths differ.
        """
        ix = _as_vector(ix, "sparse_filter_gt() indices")
        v = _as_vector(v, "sparse_filter_gt() values")
        elem = _tensor_elem_of(v, "Vector")
        return _call_builtin("SparseFilterGt", [elem], [ix, v, threshold], _sparse_type(elem))


class _MatrixNamespace:
    """East ``Matrix`` builtins — constructors."""

    @staticmethod
    def from_array(rows: Any) -> Any:
        """Build a Matrix from a nested Array of rows (east-c MatrixFromArray).

        Args:
            rows: An ``Array<Array<T>>`` of equal-length rows.

        Returns:
            A Matrix of the rows' element type.
        """
        east_type = getattr(rows, "east_type", None)
        inner = east_type.value if east_type is not None else rows.element_type
        elem = inner.value
        return _call_builtin("MatrixFromArray", [elem], [rows], MatrixType(elem))

    @staticmethod
    def from_rows(rows: Any) -> Any:
        """Build a Matrix from an Array of row Vectors (east-c MatrixFromRows).

        Args:
            rows: An ``Array<Vector<T>>`` of equal-length rows.

        Returns:
            A Matrix of the rows' element type.
        """
        east_type = getattr(rows, "east_type", None)
        inner = east_type.value if east_type is not None else rows.element_type
        elem = inner.value
        return _call_builtin("MatrixFromRows", [elem], [rows], MatrixType(elem))

    @staticmethod
    def zeros(element_type: Any, rows: Any = None, cols: Any = None) -> Any:
        """A zero-filled Matrix (east-c MatrixZeros).

        Matches the eager ``EastMatrix.zeros(element_type, rows, cols)``
        classmethod (#601); the two-argument ``zeros(rows, cols)`` spelling
        is kept and pins Float.

        Args:
            element_type: The Float, Integer or Boolean element type — or,
                in the two-argument form, the number of rows.
            rows: The number of rows.
            cols: The number of columns.

        Returns:
            A ``Matrix<element_type>`` of zeros.
        """
        if cols is None:
            if isinstance(element_type, EastType):
                raise TypeError(
                    "East.Matrix.zeros(element_type, rows, cols) needs rows and cols")
            element_type, rows, cols = FloatType, element_type, rows
        elem = _construct_elem(element_type, "East.Matrix.zeros()")
        return _call_builtin("MatrixZeros", [elem], [rows, cols], MatrixType(elem))

    @staticmethod
    def ones(element_type: Any, rows: Any = None, cols: Any = None) -> Any:
        """A ones-filled Matrix (east-c MatrixOnes).

        Matches the eager ``EastMatrix.ones(element_type, rows, cols)``
        classmethod (#601); the two-argument ``ones(rows, cols)`` spelling is
        kept and pins Float.

        Args:
            element_type: The Float, Integer or Boolean element type — or,
                in the two-argument form, the number of rows.
            rows: The number of rows.
            cols: The number of columns.

        Returns:
            A ``Matrix<element_type>`` of ones.
        """
        if cols is None:
            if isinstance(element_type, EastType):
                raise TypeError(
                    "East.Matrix.ones(element_type, rows, cols) needs rows and cols")
            element_type, rows, cols = FloatType, element_type, rows
        elem = _construct_elem(element_type, "East.Matrix.ones()")
        return _call_builtin("MatrixOnes", [elem], [rows, cols], MatrixType(elem))

    @staticmethod
    def fill(element_type: Any, rows: Any = None, cols: Any = None,
             value: Any = None) -> Any:
        """A Matrix filled with ``value`` (east-c MatrixFill).

        Matches the eager ``EastMatrix.fill(element_type, rows, cols, value)``
        classmethod (#601); the three-argument ``fill(rows, cols, value)``
        spelling is kept, with the value's type pinning the element type.

        Args:
            element_type: The Float, Integer or Boolean element type — or,
                in the three-argument form, the number of rows.
            rows: The number of rows.
            cols: The number of columns.
            value: The fill value; must carry the declared element type.

        Returns:
            A Matrix with every cell set to ``value``.
        """
        if value is None:
            if isinstance(element_type, EastType):
                raise TypeError(
                    "East.Matrix.fill(element_type, rows, cols, value) needs a value")
            rows, cols, value = element_type, rows, cols
            elem = _scalar_elem_of(value)
        else:
            elem = _construct_elem(element_type, "East.Matrix.fill()")
            _fill_value_elem(value, elem, "East.Matrix.fill()")
        return _call_builtin("MatrixFill", [elem], [rows, cols, value], MatrixType(elem))


class _ArrayNamespace:
    """``East.Array`` — the Array constructors that are builtins (dual-mode)."""

    @staticmethod
    def generate(count: Any, fn: Any, element_type: EastType) -> Any:
        """``ArrayGenerate``: ``[fn(0), …, fn(count-1)]`` of ``element_type``."""
        from east.expression import _lift, _trace_inner_fn, _tracing
        from east.expression.expr import Expression
        from east.expression.nodes import _builtin as _b
        from east.types.values import EastArray

        if not _tracing():
            return EastArray.generate(count, fn, element_type=element_type)
        n = _lift(count, hint=IntegerType)
        node, _t = _trace_inner_fn(fn, [IntegerType], out_hint=element_type)
        out = ArrayType(element_type)
        return Expression(_b("ArrayGenerate", out, [element_type], [n.ir, node]), out)

    @staticmethod
    def range(start: Any, end: Any, step: Any = 1) -> Any:
        """``ArrayRange``: the Integers from ``start`` to ``end`` by ``step``."""
        from east.expression import _lift, _tracing
        from east.expression.expr import Expression
        from east.expression.nodes import _builtin as _b
        from east.types.values import EastArray

        if not _tracing():
            return EastArray.range(start, end, step)
        args = [_lift(x, hint=IntegerType).ir for x in (start, end, step)]
        out = ArrayType(IntegerType)
        return Expression(_b("ArrayRange", out, [], args), out)

    @staticmethod
    def linspace(start: Any, end: Any, count: Any) -> Any:
        """``ArrayLinspace``: ``count`` Floats evenly spaced from ``start`` to ``end``."""
        from east.expression import _lift, _tracing
        from east.expression.expr import Expression
        from east.expression.nodes import _builtin as _b
        from east.types.values import EastArray

        if not _tracing():
            return EastArray.linspace(start, end, count)
        args = [_lift(start, hint=FloatType).ir, _lift(end, hint=FloatType).ir,
                _lift(count, hint=IntegerType).ir]
        out = ArrayType(FloatType)
        return Expression(_b("ArrayLinspace", out, [], args), out)


class _SetNamespace:
    """``East.Set`` — the Set constructors that are builtins (dual-mode)."""

    @staticmethod
    def generate(count: Any, fn: Any, on_duplicate: Any, element_type: EastType) -> Any:
        """``SetGenerate``: the set of ``fn(0..count-1)``; ``on_duplicate(key)``
        runs for a key generated twice."""
        from east.expression import _lift, _trace_inner_fn, _tracing
        from east.expression.expr import Expression
        from east.expression.nodes import _builtin as _b
        from east.types.values import EastSet

        if not _tracing():
            return EastSet.generate(count, fn, element_type=element_type)
        n = _lift(count, hint=IntegerType)
        node, _t = _trace_inner_fn(fn, [IntegerType], out_hint=element_type)
        dup, _t2 = _trace_inner_fn(on_duplicate, [element_type], out_hint=NullType)
        out = SetType(element_type)
        return Expression(_b("SetGenerate", out, [element_type], [n.ir, node, dup]), out)


class _DictNamespace:
    """``East.Dict`` — the Dict constructors that are builtins (dual-mode)."""

    @staticmethod
    def generate(count: Any, key_fn: Any, value_fn: Any, combine: Any,
                 key_type: EastType, value_type: EastType) -> Any:
        """``DictGenerate``: ``count`` entries ``key_fn(i) → value_fn(i)``;
        ``combine(existing, incoming, key)`` resolves a repeated key."""
        from east.expression import _lift, _trace_inner_fn, _tracing
        from east.expression.expr import Expression
        from east.expression.nodes import _builtin as _b
        from east.types.values import EastDict

        if not _tracing():
            return EastDict.generate(count, key_fn, value_fn, combine, key_type, value_type)
        n = _lift(count, hint=IntegerType)
        kf, _a = _trace_inner_fn(key_fn, [IntegerType], out_hint=key_type)
        vf, _b2 = _trace_inner_fn(value_fn, [IntegerType], out_hint=value_type)
        cf, _c = _trace_inner_fn(combine, [value_type, value_type, key_type], out_hint=value_type)
        out = DictType(key_type, value_type)
        return Expression(_b("DictGenerate", out, [key_type, value_type], [n.ir, kf, vf, cf]), out)


class _East:
    """The ``East`` namespace object — primitive builtins, comparisons and
    the block-level control flow."""

    Float = _FloatNamespace()
    Integer = _IntegerNamespace()
    String = _StringNamespace()
    Boolean = _BooleanNamespace()
    DateTime = _DateTimeNamespace()
    Vector = _VectorNamespace()
    Matrix = _MatrixNamespace()
    Array = _ArrayNamespace()
    Set = _SetNamespace()
    Dict = _DictNamespace()

    # ── the strict expression builders (#625, east/expression/function.py) ──
    # Name-for-name with the TypeScript trio: East.function / East.platform /
    # East.compile author, declare and compile East programs from python.
    function = staticmethod(_function)
    asyncFunction = staticmethod(_async_function)  # noqa: N815 — TS parity name
    platform = staticmethod(_platform)
    asyncPlatform = staticmethod(_async_platform)  # noqa: N815 — TS parity name
    genericPlatform = staticmethod(_generic_platform)  # noqa: N815 — TS parity name
    asyncGenericPlatform = staticmethod(_async_generic_platform)  # noqa: N815 — TS parity name
    compile = staticmethod(_compile)
    compileAsync = staticmethod(_compile_async)  # noqa: N815 — TS parity name

    # ── the statement surface (east/expression/statements.py) ────────────
    # Python's twin of the TypeScript `$` builder: statements append to the
    # innermost open body. `let`/`while_`/`for_`/`block`/`break_`/`continue_`
    # below dispatch between their statement and expression forms.
    const = staticmethod(const)
    assign = staticmethod(assign)
    return_ = staticmethod(return_)
    if_ = staticmethod(if_)
    match_ = staticmethod(match_)
    try_ = staticmethod(try_)
    do = staticmethod(do)
    error = staticmethod(error)
    # expression-level spellings every IR node kind needs (TS parity names)
    value = staticmethod(value)
    as_ = staticmethod(as_)
    wrap_recursive = staticmethod(wrap_recursive)
    greatest = staticmethod(greatest)
    least = staticmethod(least)

    # ── block-level control flow (#578, east/kernel/control.py) ──────────
    # Attached rather than defined here: they are dual-mode expression
    # builders, and this is the spelling — the python name is the IR node
    # name, so an error, an IR dump and the docs all say the same word.
    if_else = staticmethod(if_else)
    while_ = staticmethod(while_)
    for_ = staticmethod(for_)
    block = staticmethod(block)
    let = staticmethod(let)
    ref = staticmethod(ref)
    label = staticmethod(label)
    break_ = staticmethod(break_)
    continue_ = staticmethod(continue_)
    try_catch = staticmethod(try_catch)
    new_array = staticmethod(new_array)
    new_set = staticmethod(new_set)
    new_dict = staticmethod(new_dict)
    new_vector = staticmethod(new_vector)
    new_matrix = staticmethod(new_matrix)
    builtin = staticmethod(builtin)

    @staticmethod
    def equal(typ: EastType, a: EastValue, b: EastValue) -> bool:
        """East structural equality of two values of type ``typ`` (east-c Equal)."""
        return _call_builtin("Equal", [typ], [a, b], BooleanType)

    @staticmethod
    def not_equal(typ: EastType, a: EastValue, b: EastValue) -> bool:
        """East inequality (east-c NotEqual)."""
        return _call_builtin("NotEqual", [typ], [a, b], BooleanType)

    @staticmethod
    def less(typ: EastType, a: EastValue, b: EastValue) -> bool:
        """East total-order less-than (east-c Less)."""
        return _call_builtin("Less", [typ], [a, b], BooleanType)

    @staticmethod
    def less_equal(typ: EastType, a: EastValue, b: EastValue) -> bool:
        """East total-order ≤ (east-c LessEqual)."""
        return _call_builtin("LessEqual", [typ], [a, b], BooleanType)

    @staticmethod
    def greater(typ: EastType, a: EastValue, b: EastValue) -> bool:
        """East total-order greater-than (east-c Greater)."""
        return _call_builtin("Greater", [typ], [a, b], BooleanType)

    @staticmethod
    def greater_equal(typ: EastType, a: EastValue, b: EastValue) -> bool:
        """East total-order ≥ (east-c GreaterEqual)."""
        return _call_builtin("GreaterEqual", [typ], [a, b], BooleanType)

    @staticmethod
    def compare(typ: EastType, a: EastValue, b: EastValue) -> int:
        """Three-way comparison as -1/0/1, via east-c Less/Equal."""
        if _call_builtin("Less", [typ], [a, b], BooleanType):
            return -1
        return 0 if _call_builtin("Equal", [typ], [a, b], BooleanType) else 1

    @staticmethod
    def is_(typ: EastType, a: EastValue, b: EastValue) -> bool:
        """East ``Is`` identity of two values of type ``typ`` (east-c Is).

        Reference identity for mutable values (``Ref``/``Array``/``Set``/``Dict``)
        and structural equality for immutable ones — the type-aware ``===``.
        """
        return _call_builtin("Is", [typ], [a, b], BooleanType)

    @staticmethod
    def diff(typ: EastType, before: EastValue, after: EastValue) -> EastValue:
        """Structural diff producing a patch from ``before`` to ``after`` (east-c Diff).

        ``typ`` is the shared East type of both operands — explicit, like
        :meth:`compose_patch` / :meth:`invert_patch`, because a type sampled
        from one value cannot describe both: ``type_of(variant("ok", 1))`` is
        the single-case ``Variant<ok>``, so an ``"error"``-case ``after`` has
        no case to marshal into (and a tag-equal payload of a different type
        would be reinterpreted, #534). The result is a value of
        ``PatchType(typ)`` that :meth:`apply_patch` replays onto ``before``
        to reconstruct ``after``.
        """
        return _call_builtin("Diff", [typ, PatchType(typ)], [before, after], PatchType(typ))

    @staticmethod
    def apply_patch(typ: EastType, value: EastValue, patch: EastValue) -> EastValue:
        """Apply ``patch`` to ``value``, producing the patched value (east-c ApplyPatch).

        ``typ`` is ``value``'s East type — explicit for the same reason as
        :meth:`diff`: a patch may replace a variant with a case the sampled
        single-case type does not carry.

        Raises an East runtime error if the patch conflicts with the value
        (e.g. deleting a key that is not present).
        """
        return _call_builtin("ApplyPatch", [typ, PatchType(typ)], [value, patch], typ)

    @staticmethod
    def compose_patch(typ: EastType, first: EastValue, second: EastValue) -> EastValue:
        """Compose two patches of value type ``typ`` into one (east-c ComposePatch).

        The result has the same effect as applying ``first`` then ``second``.
        """
        return _call_builtin(
            "ComposePatch", [typ, PatchType(typ)], [first, second], PatchType(typ)
        )

    @staticmethod
    def invert_patch(typ: EastType, patch: EastValue) -> EastValue:
        """Invert ``patch`` (of value type ``typ``) so it undoes its own effect (east-c InvertPatch).

        Applying the inverted patch to the ``after`` value reproduces ``before``.
        """
        return _call_builtin("InvertPatch", [typ, PatchType(typ)], [patch], PatchType(typ))


East = _East()

__all__ = ["East"]
