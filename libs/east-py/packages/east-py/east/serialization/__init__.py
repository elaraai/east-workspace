#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East serialization and deserialization."""

from east.serialization.csv import (
    CsvError,
    CsvLocation,
    CsvParseConfigType,
    CsvSerializeConfigType,
    decode_csv_for,
    encode_csv_for,
)
from east.serialization.json_schema import (
    EAST_JSON_PATTERNS,
    JsonSchema,
    JsonSchemaDraft,
    json_schema_for,
)
from east.serialization.json_schema_to_type import (
    JsonSchemaUnsupportedError,
    type_from_json_schema,
)

__all__ = [
    # CSV
    "CsvParseConfigType",
    "CsvSerializeConfigType",
    "CsvError",
    "CsvLocation",
    "decode_csv_for",
    "encode_csv_for",
    # JSON Schema
    "EAST_JSON_PATTERNS",
    "JsonSchema",
    "JsonSchemaDraft",
    "json_schema_for",
    "JsonSchemaUnsupportedError",
    "type_from_json_schema",
]
