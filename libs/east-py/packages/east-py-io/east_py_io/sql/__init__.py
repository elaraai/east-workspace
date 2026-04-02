#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SQL module - SQLite, PostgreSQL, MySQL, and Microsoft Access databases."""

from east_py_io.sql.access import (
    access_close_all_impl,
    access_close_impl,
    access_impl,
    access_open_impl,
    access_query_factory,
    access_tables_impl,
)
from east_py_io.sql.mysql import (
    mysql_close_all_impl,
    mysql_close_impl,
    mysql_connect_impl,
    mysql_impl,
    mysql_query_impl,
)
from east_py_io.sql.postgres import (
    postgres_close_all_impl,
    postgres_close_impl,
    postgres_connect_impl,
    postgres_impl,
    postgres_query_impl,
)
from east_py_io.sql.sqlite import (
    sqlite_close_all_impl,
    sqlite_close_impl,
    sqlite_connect_impl,
    sqlite_impl,
    sqlite_query_impl,
)
from east_py_io.sql.types import (
    AccessBlobConfigType,
    AccessConfigType,
    AccessQueryOptionsType,
    AccessTablesResultType,
    ConnectionHandleType,
    MySqlConfigType,
    PostgresConfigType,
    SqliteConfigType,
    SqlParametersType,
    SqlParameterType,
    SqlResultType,
    SqlRowType,
)

__all__ = [
    # Types
    "SqliteConfigType",
    "PostgresConfigType",
    "MySqlConfigType",
    "ConnectionHandleType",
    "SqlParametersType",
    "SqlParameterType",
    "SqlRowType",
    "SqlResultType",
    "AccessBlobConfigType",
    "AccessConfigType",
    "AccessQueryOptionsType",
    "AccessTablesResultType",
    # SQLite
    "sqlite_impl",
    "sqlite_connect_impl",
    "sqlite_query_impl",
    "sqlite_close_impl",
    "sqlite_close_all_impl",
    # PostgreSQL
    "postgres_impl",
    "postgres_connect_impl",
    "postgres_query_impl",
    "postgres_close_impl",
    "postgres_close_all_impl",
    # MySQL
    "mysql_impl",
    "mysql_connect_impl",
    "mysql_query_impl",
    "mysql_close_impl",
    "mysql_close_all_impl",
    # Microsoft Access
    "access_impl",
    "access_open_impl",
    "access_tables_impl",
    "access_query_factory",
    "access_close_impl",
    "access_close_all_impl",
]
