#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared SQL type definitions for East Python IO.

Provides East type definitions for SQL database operations including
connection configurations, query parameters, and result types.
"""

from east.types.type_of_type import LiteralValueType
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DictType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)

# SQLite configuration
SqliteConfigType = StructType(
    [
        ("path", StringType),
        ("readOnly", OptionType(BooleanType)),
        ("memory", OptionType(BooleanType)),
    ]
)

# PostgreSQL configuration
PostgresConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("database", StringType),
        ("user", StringType),
        ("password", StringType),
        ("ssl", OptionType(BooleanType)),
        ("maxConnections", OptionType(IntegerType)),
    ]
)

# MySQL configuration
MySqlConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("database", StringType),
        ("user", StringType),
        ("password", StringType),
        ("ssl", OptionType(BooleanType)),
        ("maxConnections", OptionType(IntegerType)),
    ]
)

# Connection handle type
ConnectionHandleType = StringType

# SQL parameter type (accepts any East value) — the canonical IR literal type,
# matching TypeScript's `SqlParameterType = LiteralValueType`.
SqlParameterType = LiteralValueType

SqlParametersType = ArrayType(SqlParameterType)

SqlRowType = DictType(StringType, SqlParameterType)

SqlResultType = VariantType(
    [
        ("select", StructType([("rows", ArrayType(SqlRowType))])),
        (
            "insert",
            StructType(
                [
                    ("rowsAffected", IntegerType),
                    ("lastInsertId", OptionType(IntegerType)),
                ]
            ),
        ),
        ("update", StructType([("rowsAffected", IntegerType)])),
        ("delete", StructType([("rowsAffected", IntegerType)])),
    ]
)

# Microsoft Access configuration
AccessConfigType = StructType(
    [
        ("path", StringType),
        ("password", OptionType(StringType)),
    ]
)

# Access blob configuration (for opening from bytes)
AccessBlobConfigType = StructType(
    [
        ("data", BlobType),
        ("password", OptionType(StringType)),
    ]
)

# Access query options
AccessQueryOptionsType = StructType(
    [
        ("table", StringType),
        ("columns", OptionType(ArrayType(StringType))),
        ("rowOffset", OptionType(IntegerType)),
        ("rowLimit", OptionType(IntegerType)),
    ]
)

# Access table list result
AccessTablesResultType = StructType(
    [
        ("tables", ArrayType(StringType)),
    ]
)

__all__ = [
    "SqliteConfigType",
    "PostgresConfigType",
    "MySqlConfigType",
    "ConnectionHandleType",
    "SqlParameterType",
    "SqlParametersType",
    "SqlRowType",
    "SqlResultType",
    "AccessConfigType",
    "AccessBlobConfigType",
    "AccessQueryOptionsType",
    "AccessTablesResultType",
]
