#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A jq program's constants, as the checker and the translator read them. The twin of ``literals.ts``.

Each literal's East type and value, and the ISO-8601 text a string literal
writes a DateTime as (``libs/east/devdocs/QUERY.md`` §7). The checker and the
translator read a literal through these alike: the checker to type it and to
report a string that is not a date, the translator to give its value as the
type the checker read it as.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from east.serialization.json import from_json_for
from east.types.types import (
    BooleanType,
    DateTimeType,
    EastType,
    FloatType,
    IntegerType,
    NullType,
    StringType,
)
from east.types.values import EastVariant, east_null

#: A constant a jq program writes: a ``JqLiteralType`` value.
JqLiteral = EastVariant

_parse_date_time = from_json_for(DateTimeType)


def literal_value(literal: JqLiteral) -> tuple[EastType, Any]:
    """A literal's East type and value, as the program writes it.

    Args:
        literal: The literal: a ``JqLiteralType`` value.

    Returns:
        Its type and its value.

    Raises:
        ValueError: When it is not a ``JqLiteralType`` value.
    """
    kind = literal.type
    if kind == "boolean":
        return BooleanType, literal.value
    if kind == "float":
        return FloatType, literal.value
    if kind == "integer":
        return IntegerType, literal.value
    if kind == "null":
        return NullType, east_null
    if kind == "string":
        return StringType, literal.value
    raise ValueError(f"a jq literal has no case {kind}")


def iso_date_time(text: str) -> datetime | None:
    """Reads ISO-8601 text as a DateTime, through East's RFC 3339 reader.

    A full date-time with its offset, a date-time with none (UTC), or a date
    (midnight UTC).

    Args:
        text: The text.

    Returns:
        The DateTime, or ``None`` when the text is not an ISO-8601 date.
    """
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text, re.ASCII):
        forms = [f"{text}T00:00:00Z"]
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?", text, re.ASCII):
        forms = [f"{text}Z"]
    else:
        forms = [text]
    for form in forms:
        try:
            return _parse_date_time(form)
        except ValueError:
            continue
    return None


__all__ = ["JqLiteral", "iso_date_time", "literal_value"]
