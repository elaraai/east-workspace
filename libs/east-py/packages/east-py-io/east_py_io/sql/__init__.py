#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SQL database platform functions for East - SQLite, PostgreSQL, MySQL, and Microsoft Access.

Every platform function is exported under its own name — a plain Python
callable taking and returning East values, to import from a project's own
``@East.platform_function``, and the same object callable inside an East
body (#667).  The typed selects (``sqlite_select``, ``postgres_select``,
``mysql_select``, ``access_query``) are generic: from python the factory
called with the row type, in a body the call with the row type first.  The
registration lists (``sqlite_impl``, ``postgres_impl``, ``mysql_impl``,
``access_impl``) go to ``East.compile``.  The East type definitions are
re-exported here for building inputs with ``coerce_to`` and validating
outputs.
"""

from east_py_io.sql.access import (
    access_close,
    access_close_all,
    access_impl,
    access_open,
    access_query,
    access_query_factory,
    access_tables,
)
from east_py_io.sql.mysql import (
    mysql_close,
    mysql_close_all,
    mysql_connect,
    mysql_impl,
    mysql_query,
    mysql_select,
)
from east_py_io.sql.postgres import (
    postgres_close,
    postgres_close_all,
    postgres_connect,
    postgres_impl,
    postgres_query,
    postgres_select,
    postgres_select_factory,
)
from east_py_io.sql.sqlite import (
    sqlite_close,
    sqlite_close_all,
    sqlite_connect,
    sqlite_impl,
    sqlite_query,
    sqlite_select,
    sqlite_select_factory,
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
    "sqlite_connect",
    "sqlite_query",
    "sqlite_select",
    "sqlite_select_factory",
    "sqlite_close",
    "sqlite_close_all",
    # PostgreSQL - directly-callable implementations
    "postgres_connect",
    "postgres_query",
    "postgres_select",
    "postgres_select_factory",
    "postgres_close",
    "postgres_close_all",
    # MySQL - directly-callable implementations
    "mysql_connect",
    "mysql_query",
    "mysql_select",
    "mysql_close",
    "mysql_close_all",
    # Microsoft Access - directly-callable implementations
    "access_open",
    "access_tables",
    "access_query",
    "access_query_factory",
    "access_close",
    "access_close_all",
]
