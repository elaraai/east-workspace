#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Datetime format-string tokenizer.

east-c's ``DateTimePrintFormat``/``DateTimeParseFormat`` builtins take an
``Array<DateTimeFormatToken>``, not a raw format string. This module ports the
TS tokenizer (``east/src/datetime_format/tokenize.ts``) so the ``East.DateTime``
namespace can turn a Day.js-style format string into that token array before
delegating to east-c.
"""

from __future__ import annotations

from east.types.types import NullType, StringType, VariantType
from east.types.values import EastArray, EastVariant, east_null

# Case names + types, identical to east-c's DateTimeFormatTokenType. VariantType
# sorts cases alphabetically on construction (as east-c does), so the wire case
# indices line up automatically.
_TOKEN_CASES = [
    ("literal", StringType),
    ("year4", NullType),
    ("year2", NullType),
    ("month1", NullType),
    ("month2", NullType),
    ("monthNameShort", NullType),
    ("monthNameFull", NullType),
    ("day1", NullType),
    ("day2", NullType),
    ("weekdayNameMin", NullType),
    ("weekdayNameShort", NullType),
    ("weekdayNameFull", NullType),
    ("hour24_1", NullType),
    ("hour24_2", NullType),
    ("hour12_1", NullType),
    ("hour12_2", NullType),
    ("minute1", NullType),
    ("minute2", NullType),
    ("second1", NullType),
    ("second2", NullType),
    ("millisecond3", NullType),
    ("ampmUpper", NullType),
    ("ampmLower", NullType),
]

DateTimeFormatTokenType = VariantType(_TOKEN_CASES)

# Format patterns, longest-first within each letter group so matching is greedy
# (mirrors the order in the TS tokenizer).
_PATTERNS: list[tuple[str, str]] = [
    ("YYYY", "year4"), ("YY", "year2"),
    ("MMMM", "monthNameFull"), ("MMM", "monthNameShort"), ("MM", "month2"), ("M", "month1"),
    ("DD", "day2"), ("D", "day1"),
    ("dddd", "weekdayNameFull"), ("ddd", "weekdayNameShort"), ("dd", "weekdayNameMin"),
    ("HH", "hour24_2"), ("H", "hour24_1"),
    ("hh", "hour12_2"), ("h", "hour12_1"),
    ("mm", "minute2"), ("m", "minute1"),
    ("ss", "second2"), ("s", "second1"),
    ("SSS", "millisecond3"),
    ("A", "ampmUpper"), ("a", "ampmLower"),
]


def tokenize_datetime_format(fmt: str) -> list[EastVariant]:
    """Tokenize a Day.js-style format string into DateTimeFormatToken variants.

    Recognized format codes (everything else is a literal):

    ====== =================================== ==========
    Code   Meaning                             Example
    ====== =================================== ==========
    YYYY   4-digit year                        2025
    YY     2-digit year                        25
    M      month 1-12                          3
    MM     month 01-12                         03
    MMM    short month name                    Mar
    MMMM   full month name                     March
    D      day of month 1-31                   5
    DD     day of month 01-31                  05
    dd     minimal weekday name                Mo
    ddd    short weekday name                  Mon
    dddd   full weekday name                   Monday
    H      hour 0-23                           14
    HH     hour 00-23                          14
    h      hour 1-12                           2
    hh     hour 01-12                          02
    m      minute 0-59                         9
    mm     minute 00-59                        09
    s      second 0-59                         7
    ss     second 00-59                        07
    SSS    millisecond 000-999                 123
    A      AM/PM (upper)                       PM
    a      am/pm (lower)                       pm
    ====== =================================== ==========

    Backslash escapes the next character into a literal (``\\YYYY`` → literal
    "YYYY"); a trailing backslash is itself a literal. Consecutive literal
    characters are grouped into one ``literal`` token. Matching is greedy and
    Unicode-aware (operates on codepoints).

    Args:
        fmt: The format string, e.g. ``"YYYY-MM-DD HH:mm:ss"``.

    Returns:
        A list of ``DateTimeFormatTokenType`` variants in left-to-right order.
    """
    tokens: list[EastVariant] = []
    cps = list(fmt)  # Python str iterates by codepoint, matching TS Array.from
    n = len(cps)
    literal: list[str] = []

    def flush() -> None:
        if literal:
            tokens.append(EastVariant("literal", "".join(literal)))
            literal.clear()

    i = 0
    while i < n:
        ch = cps[i]
        if ch == "\\":
            if i + 1 < n:
                literal.append(cps[i + 1])
                i += 2
            else:
                literal.append("\\")
                i += 1
            continue
        matched = False
        for pattern, token in _PATTERNS:
            length = len(pattern)
            if i + length <= n and "".join(cps[i:i + length]) == pattern:
                flush()
                tokens.append(EastVariant(token, east_null))
                i += length
                matched = True
                break
        if matched:
            continue
        literal.append(ch)
        i += 1

    flush()
    return tokens


def format_token_array(fmt: str) -> EastArray:
    """The ``Array<DateTimeFormatToken>`` for a format string (east-c arg form)."""
    return EastArray(DateTimeFormatTokenType, tokenize_datetime_format(fmt))


__all__ = ["DateTimeFormatTokenType", "tokenize_datetime_format", "format_token_array"]
