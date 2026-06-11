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

SqliteConfigType = StructType(
    [
        ("path", StringType),
        ("readOnly", OptionType(BooleanType)),
        ("memory", OptionType(BooleanType)),
    ]
)
"""SQLite connection configuration.

Fields: ``path`` (``String``) - file-system path to the ``.db`` file;
``readOnly`` (``Option<Boolean>``) - open in read-only mode (default
``False``); ``memory`` (``Option<Boolean>``) - open an in-memory database,
ignoring ``path`` (default ``False``).
"""

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
"""PostgreSQL connection pool configuration.

Fields: ``host`` (``String``), ``port`` (``Integer``), ``database``
(``String``), ``user`` (``String``), ``password`` (``String``), ``ssl``
(``Option<Boolean>``) - enable TLS (default ``False``),
``maxConnections`` (``Option<Integer>``) - pool upper bound (default 10).
"""

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
"""MySQL connection pool configuration.

Fields: ``host`` (``String``), ``port`` (``Integer``), ``database``
(``String``), ``user`` (``String``), ``password`` (``String``), ``ssl``
(``Option<Boolean>``) - enable TLS (default ``False``),
``maxConnections`` (``Option<Integer>``) - pool upper bound (default 10).
"""

ConnectionHandleType = StringType
"""Opaque ``String`` connection handle returned by connect/open functions."""

# SQL parameter type (accepts any East value) - the canonical IR literal type,
# matching TypeScript's `SqlParameterType = LiteralValueType`.
SqlParameterType = LiteralValueType
"""East literal value type used for SQL bind parameters and result cell values.

Matches the TypeScript ``SqlParameterType = LiteralValueType``. A value may be
``String``, ``Integer``, ``Float``, ``Boolean``, ``DateTime``, ``Blob``, or
``Null``.
"""

SqlParametersType = ArrayType(SqlParameterType)
"""``Array<SqlParameterType>`` - ordered list of bind parameters for a query."""

SqlRowType = DictType(StringType, SqlParameterType)
"""``Dict<String, SqlParameterType>`` - one result row keyed by column name."""

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
"""Result of a ``*_query`` call - discriminated by the DML statement executed.

Cases:
- ``select`` ``{rows: Array<SqlRowType>}`` - result set rows.
- ``insert`` ``{rowsAffected: Integer, lastInsertId: Option<Integer>}`` -
  rows written and, where the driver provides it, the last auto-increment id.
- ``update`` ``{rowsAffected: Integer}`` - rows updated.
- ``delete`` ``{rowsAffected: Integer}`` - rows deleted.
DDL statements (``CREATE``, ``DROP``, etc.) are mapped to the ``update`` case
with ``rowsAffected = 0``.
"""

AccessConfigType = StructType(
    [
        ("path", StringType),
        ("password", OptionType(StringType)),
    ]
)
"""Microsoft Access database file configuration.

Fields: ``path`` (``String``) - path to the ``.mdb`` or ``.accdb`` file;
``password`` (``Option<String>``) - database password (not yet supported by
access-parser; reserved for future use).
"""

AccessBlobConfigType = StructType(
    [
        ("data", BlobType),
        ("password", OptionType(StringType)),
    ]
)
"""Configuration for opening a Microsoft Access database from raw bytes.

Fields: ``data`` (``Blob``) - the raw ``.mdb``/``.accdb`` bytes;
``password`` (``Option<String>``) - database password (reserved).
"""

AccessQueryOptionsType = StructType(
    [
        ("table", StringType),
        ("columns", OptionType(ArrayType(StringType))),
        ("rowOffset", OptionType(IntegerType)),
        ("rowLimit", OptionType(IntegerType)),
    ]
)
"""Options controlling an ``access_query`` read from a table.

Fields: ``table`` (``String``) - table name; ``columns``
(``Option<Array<String>>``) - restrict to these column names (default: all);
``rowOffset`` (``Option<Integer>``) - skip this many rows before returning
(default 0); ``rowLimit`` (``Option<Integer>``) - maximum rows to return
(default: all remaining).
"""

AccessTablesResultType = StructType(
    [
        ("tables", ArrayType(StringType)),
    ]
)
"""Result of ``access_tables``.

Fields: ``tables`` (``Array<String>``) - names of all user tables in the
database.
"""

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
