#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""CSV serialization for East types.

Encode/decode is handled by east-c via the _csv_eastc Cython extension.
Config types, error types, and config resolvers remain in Python.

Null handling: by default no field text is treated as null (``nullStrings``
defaults to ``[]``), so an empty field decodes as an empty string — the
universal CSV-tool semantics. To decode empty (or sentinel) fields as
``none`` for Option columns, opt in explicitly, e.g.
``csv_parse_config(null_strings=[""])``; a null-string match on a required
(non-Option) column is a decode error.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, NamedTuple

from east.types.construct import none, some
from east.types.types import (
    ArrayType,
    BooleanType,
    DictType,
    EastType,
    OptionType,
    StringType,
    StructType,
)
from east.types.values import is_east_variant

# =============================================================================
# CSV Configuration East Types
# =============================================================================

CsvParseConfigType: EastType = StructType(
    [
        ("delimiter", OptionType(StringType)),
        ("quoteChar", OptionType(StringType)),
        ("escapeChar", OptionType(StringType)),
        ("newline", OptionType(StringType)),
        ("hasHeader", OptionType(BooleanType)),
        ("nullStrings", OptionType(ArrayType(StringType))),
        ("skipEmptyLines", OptionType(BooleanType)),
        ("trimFields", OptionType(BooleanType)),
        ("columnMapping", OptionType(DictType(StringType, StringType))),
        ("strict", OptionType(BooleanType)),
    ]
)

CsvSerializeConfigType: EastType = StructType(
    [
        ("delimiter", OptionType(StringType)),
        ("quoteChar", OptionType(StringType)),
        ("escapeChar", OptionType(StringType)),
        ("newline", OptionType(StringType)),
        ("includeHeader", OptionType(BooleanType)),
        ("nullString", OptionType(StringType)),
        ("alwaysQuote", OptionType(BooleanType)),
    ]
)

# =============================================================================
# CSV Error Types
# =============================================================================


@dataclass(slots=True)
class CsvLocation:
    """Location information for CSV parsing errors."""

    row: int  # 1-indexed row number (excluding header)
    column: int  # 0-indexed column index
    column_name: str | None = None


class CsvError(Exception):
    """Error thrown during CSV parsing with location information."""

    __slots__ = ("location",)

    def __init__(self, message: str, location: CsvLocation | None = None):
        self.location = location
        location_str = ""
        if location:
            location_str = f" at row {location.row}, column {location.column}"
            if location.column_name:
                location_str += f" ({location.column_name})"
        super().__init__(f"CSV error: {message}{location_str}")


# =============================================================================
# Configuration
# =============================================================================


class ResolvedParseConfig(NamedTuple):
    """Resolved parse configuration with defaults applied.

    ``null_strings`` defaults to the empty set: no field text is treated as
    null, so an empty field decodes as an empty string (universal CSV-tool
    semantics). Opt in to null handling with e.g. ``frozenset(("",))``.
    """

    delimiter: str = ","
    quote_char: str = '"'
    escape_char: str = '"'
    newline: str = ""  # empty = auto-detect
    has_header: bool = True
    null_strings: frozenset[str] = frozenset()
    skip_empty_lines: bool = True
    trim_fields: bool = False
    column_mapping: dict[str, str] | None = None
    strict: bool = False


class ResolvedSerializeConfig(NamedTuple):
    """Resolved serialize configuration with defaults applied."""

    delimiter: str = ","
    quote_char: str = '"'
    escape_char: str = '"'
    newline: str = "\r\n"
    include_header: bool = True
    null_string: str = ""
    always_quote: bool = False


def _get_option_value(val: Any, default: Any) -> Any:
    """Extract value from Option variant or return default."""
    if val is None:
        return default
    if is_east_variant(val):
        return val.value if val.type == "some" else default
    if isinstance(val, dict) and val.get("type") == "some":
        return val.get("value", default)
    return default


def resolve_parse_config(config: Any) -> ResolvedParseConfig:
    """Extract resolved options from East config value, applying defaults."""
    if config is None:
        return ResolvedParseConfig()

    data = config

    null_strings_val = _get_option_value(data.get("nullStrings"), None)
    column_mapping_val = _get_option_value(data.get("columnMapping"), None)

    return ResolvedParseConfig(
        delimiter=_get_option_value(data.get("delimiter"), ","),
        quote_char=_get_option_value(data.get("quoteChar"), '"'),
        escape_char=_get_option_value(data.get("escapeChar"), '"'),
        newline=_get_option_value(data.get("newline"), ""),
        has_header=_get_option_value(data.get("hasHeader"), True),
        null_strings=frozenset(null_strings_val) if null_strings_val is not None else frozenset(),
        skip_empty_lines=_get_option_value(data.get("skipEmptyLines"), True),
        trim_fields=_get_option_value(data.get("trimFields"), False),
        column_mapping=dict(column_mapping_val) if column_mapping_val else None,
        strict=_get_option_value(data.get("strict"), False),
    )


def resolve_serialize_config(config: Any) -> ResolvedSerializeConfig:
    """Extract resolved options from East config value, applying defaults."""
    if config is None:
        return ResolvedSerializeConfig()

    data = config

    return ResolvedSerializeConfig(
        delimiter=_get_option_value(data.get("delimiter"), ","),
        quote_char=_get_option_value(data.get("quoteChar"), '"'),
        escape_char=_get_option_value(data.get("escapeChar"), '"'),
        newline=_get_option_value(data.get("newline"), "\r\n"),
        include_header=_get_option_value(data.get("includeHeader"), True),
        null_string=_get_option_value(data.get("nullString"), ""),
        always_quote=_get_option_value(data.get("alwaysQuote"), False),
    )


# =============================================================================
# Config builders
# =============================================================================


def _opt(value: Any) -> Any:
    """Wrap a python value as some(value), or none when it is None."""
    return some(value) if value is not None else none


def csv_parse_config(
    *,
    delimiter: str | None = None,
    quote_char: str | None = None,
    escape_char: str | None = None,
    newline: str | None = None,
    has_header: bool | None = None,
    null_strings: list[str] | None = None,
    skip_empty_lines: bool | None = None,
    trim_fields: bool | None = None,
    column_mapping: dict[str, str] | None = None,
    strict: bool | None = None,
) -> dict[str, Any]:
    """Build a ``CsvParseConfigType`` value from keyword options.

    Unset options become ``none`` and take the decoder defaults. Note the
    null-handling default: ``null_strings`` is ``[]`` (no field text is null),
    so empty fields decode as empty strings; pass ``null_strings=[""]`` to
    decode empty fields as ``none`` for Option columns instead.

    Args:
        delimiter: Field delimiter (default ``","``).
        quote_char: Quote character (default ``'"'``).
        escape_char: Escape character (default ``'"'`` for doubled quotes).
        newline: Line ending; auto-detected when unset.
        has_header: Whether the first row is a header (default ``True``).
        null_strings: Field texts to treat as null (default ``[]``).
        skip_empty_lines: Skip rows whose fields are all empty (default ``True``).
        trim_fields: Trim surrounding whitespace from each field (default ``False``).
        column_mapping: Map of CSV header name to struct field name.
        strict: Error on columns not present in the struct (default ``False``).

    Returns:
        A plain value of ``CsvParseConfigType`` accepted as the ``config``
        argument of ``decode_csv_for`` and ``EastBlob.decode_csv``.
    """
    return {
        "delimiter": _opt(delimiter),
        "quoteChar": _opt(quote_char),
        "escapeChar": _opt(escape_char),
        "newline": _opt(newline),
        "hasHeader": _opt(has_header),
        "nullStrings": _opt(null_strings),
        "skipEmptyLines": _opt(skip_empty_lines),
        "trimFields": _opt(trim_fields),
        "columnMapping": _opt(column_mapping),
        "strict": _opt(strict),
    }


def csv_serialize_config(
    *,
    delimiter: str | None = None,
    quote_char: str | None = None,
    escape_char: str | None = None,
    newline: str | None = None,
    include_header: bool | None = None,
    null_string: str | None = None,
    always_quote: bool | None = None,
) -> dict[str, Any]:
    """Build a ``CsvSerializeConfigType`` value from keyword options.

    Unset options become ``none`` and take the encoder defaults.

    Args:
        delimiter: Field delimiter (default ``","``).
        quote_char: Quote character (default ``'"'``).
        escape_char: Escape character (default ``'"'``).
        newline: Line ending (default ``"\\r\\n"``).
        include_header: Whether to emit the header row (default ``True``).
        null_string: Text emitted for ``none`` values (default ``""``).
        always_quote: Quote every field (default ``False``).

    Returns:
        A plain value of ``CsvSerializeConfigType`` accepted as the ``config``
        argument of ``encode_csv_for``.
    """
    return {
        "delimiter": _opt(delimiter),
        "quoteChar": _opt(quote_char),
        "escapeChar": _opt(escape_char),
        "newline": _opt(newline),
        "includeHeader": _opt(include_header),
        "nullString": _opt(null_string),
        "alwaysQuote": _opt(always_quote),
    }


# =============================================================================
# Encode/Decode via east-c
# =============================================================================

from east.serialization._csv_eastc import (  # type: ignore[import-not-found]  # noqa: E402
    decode_csv_for,
    encode_csv_for,
)

__all__ = [
    # Config types
    "CsvParseConfigType",
    "CsvSerializeConfigType",
    "CsvLocation",
    "CsvError",
    # Config resolution
    "resolve_parse_config",
    "resolve_serialize_config",
    # Config builders
    "csv_parse_config",
    "csv_serialize_config",
    # Functions
    "decode_csv_for",
    "encode_csv_for",
]
