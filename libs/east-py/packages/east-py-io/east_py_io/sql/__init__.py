#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SQL database platform functions for East - SQLite, PostgreSQL, MySQL, and Microsoft Access.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.  The registration lists
(``sqlite_impl``, ``postgres_impl``, ``mysql_impl``, ``access_impl``) are
passed to ``east.runtime.platform.platform_functions`` to register all
decorated functions in a module.  The East type definitions are re-exported
here for building inputs with ``coerce_to`` and validating outputs.
"""

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
    # Platform registration lists
    "sqlite_impl",
    "postgres_impl",
    "mysql_impl",
    "access_impl",
    # East type definitions
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
    # SQLite - directly-callable implementations
    "sqlite_connect_impl",
    "sqlite_query_impl",
    "sqlite_close_impl",
    "sqlite_close_all_impl",
    # PostgreSQL - directly-callable implementations
    "postgres_connect_impl",
    "postgres_query_impl",
    "postgres_close_impl",
    "postgres_close_all_impl",
    # MySQL - directly-callable implementations
    "mysql_connect_impl",
    "mysql_query_impl",
    "mysql_close_impl",
    "mysql_close_all_impl",
    # Microsoft Access - directly-callable implementations
    "access_open_impl",
    "access_tables_impl",
    "access_query_factory",
    "access_close_impl",
    "access_close_all_impl",
]
