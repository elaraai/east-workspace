#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""jq's ``strftime`` / ``strptime`` formats as East's datetime format tokens.

The twin of ``strftime.ts``: the checker reads a format by them, reporting a
code East has no token for, and the translator gives the tokens they make
(``libs/east/devdocs/QUERY.md`` §10).
"""

from __future__ import annotations

from east.query.jq.spans import from_utf16, to_utf16
from east.types.values import EastVariant, east_null


def _token(case: str) -> EastVariant:
    return EastVariant(case, east_null)


def _literal(text: str) -> EastVariant:
    return EastVariant("literal", text)


# jq's `%` codes, each as the East tokens it writes.
_FORMAT_CODES: dict[str, list[EastVariant]] = {
    "Y": [_token("year4")],
    "m": [_token("month2")],
    "d": [_token("day2")],
    "H": [_token("hour24_2")],
    "M": [_token("minute2")],
    "S": [_token("second2")],
    "b": [_token("monthNameShort")],
    "B": [_token("monthNameFull")],
    "a": [_token("weekdayNameShort")],
    "A": [_token("weekdayNameFull")],
    "F": [_token("year4"), _literal("-"), _token("month2"), _literal("-"), _token("day2")],
    "T": [_token("hour24_2"), _literal(":"), _token("minute2"), _literal(":"), _token("second2")],
}


def format_tokens(fmt: str) -> tuple[list[EastVariant], None] | tuple[None, str]:
    """A strftime format as East datetime format tokens.

    Args:
        fmt: jq's format text: ``%Y %m %d %H %M %S %b %B %a %A %F %T``, ``%%``
            for a percent sign, and any other text as it is.

    Returns:
        ``(tokens, None)``, or ``(None, code)`` with the first code East has no
        token for.
    """
    units = to_utf16(fmt)
    tokens: list[EastVariant] = []
    text = ""
    i = 0
    while i < len(units):
        c = units[i]
        if c != "%":
            text += c
            i += 1
            continue
        code = units[i + 1] if i + 1 < len(units) else None
        i += 2
        if code == "%":
            text += "%"
            continue
        mapped = None if code is None else _FORMAT_CODES.get(code)
        if mapped is None:
            return None, from_utf16(code or "")
        if text != "":
            tokens.append(_literal(from_utf16(text)))
            text = ""
        tokens.extend(mapped)
    if text != "":
        tokens.append(_literal(from_utf16(text)))
    return tokens, None


__all__ = ["format_tokens"]
