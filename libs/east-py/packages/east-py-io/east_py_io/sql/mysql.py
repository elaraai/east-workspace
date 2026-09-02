#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""MySQL platform functions for East.

Provides MySQL database operations for East programs, including
connection pooling and parameterized query execution.
"""

import importlib.util
import uuid
from datetime import UTC, datetime
from typing import Any

from east.runtime.platform import (
    generic_platform_function,
    platform_function,
    platform_functions,
)

_HAS_MYSQL_SUPPORT = importlib.util.find_spec("aiomysql") is not None


def _check_mysql_support() -> None:
    """Check if MySQL support is available."""
    if not _HAS_MYSQL_SUPPORT:
        raise NotImplementedError(
            "MySQL support requires the 'mysql' extra. "
            "Add east-py-io[mysql] to your pyproject.toml dependencies."
        )
from east.types.types import (
    NullType,
    StringType,
    get_option_inner_type,
    is_blob_type,
    is_boolean_type,
    is_datetime_type,
    is_float_type,
    is_integer_type,
    is_option_type,
    is_string_type,
    is_struct_type,
)
from east.types.values import EastArray, EastDict, EastStruct, EastVariant, east_null

from .types import (
    ConnectionHandleType,
    MySqlConfigType,
    SqlParametersType,
    SqlParameterType,
    SqlResultType,
    SqlRowType,
)

# Connection pool storage
_pools: dict[str, Any] = {}


def convert_param_to_native(param: EastVariant) -> Any:
    """Convert an East SQL parameter variant to a native Python value for aiomysql binding.

    Args:
        param: ``EastVariant`` whose ``type`` tag is one of ``String``,
            ``Integer``, ``Float``, ``Boolean``, ``Null``, ``Blob``,
            ``DateTime``.

    Returns:
        Native Python value suitable for aiomysql ``%s`` parameter binding.
    """
    tag = param.type
    value = param.value

    if tag == "String":
        return value
    elif tag == "Integer":
        return int(value) if value is not None else 0
    elif tag == "Float" or tag == "Boolean":
        return value
    elif tag == "Null":
        return None
    elif tag == "Blob":
        return bytes(value) if value else b""
    elif tag == "DateTime":
        return value
    else:
        return None


# MySQL field type constants
MYSQL_TINY = 1  # TINYINT - used as BOOL
MYSQL_SHORT = 2
MYSQL_LONG = 3
MYSQL_FLOAT = 4
MYSQL_DOUBLE = 5
MYSQL_TIMESTAMP = 7
MYSQL_LONGLONG = 8
MYSQL_INT24 = 9
MYSQL_DATE = 10
MYSQL_TIME = 11
MYSQL_DATETIME = 12
MYSQL_YEAR = 13
MYSQL_BIT = 16
MYSQL_NEWDECIMAL = 246
MYSQL_BLOB = 252
MYSQL_VARCHAR = 253
MYSQL_STRING = 254


def convert_native_to_param(value: Any, field_type: int | None = None) -> EastVariant:
    """Convert native Python value to East SQL parameter variant.

    Args:
        value: Native Python value from MySQL
        field_type: MySQL field type code from cursor.description

    Returns:
        East SQL parameter variant
    """
    from east.types.values import EastBlob

    if value is None:
        return EastVariant("Null", east_null)

    # Boolean handling - TINYINT(1) and BIT are booleans
    if isinstance(value, bool) or (
        field_type in (MYSQL_TINY, MYSQL_BIT) and isinstance(value, int | float)
    ):
        return EastVariant("Boolean", bool(value))

    # Integer handling
    if isinstance(value, int):
        return EastVariant("Integer", value)

    # Float handling
    if isinstance(value, float):
        return EastVariant("Float", value)

    # String handling
    if isinstance(value, str):
        return EastVariant("String", value)

    # Bytes handling
    if isinstance(value, bytes):
        return EastVariant("Blob", EastBlob(value))

    # DateTime handling
    if isinstance(value, datetime):
        # Ensure UTC timezone and truncate to milliseconds to match TypeScript behavior
        value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        # Truncate microseconds to milliseconds (keep first 3 digits of microseconds)
        ms = (value.microsecond // 1000) * 1000
        value = value.replace(microsecond=ms)
        return EastVariant("DateTime", value)

    return EastVariant("Null", east_null)


def _convert_placeholders(sql: str) -> str:
    """Convert ? placeholders to %s for aiomysql.

    Handles quoted strings properly to avoid replacing ? inside strings.
    """
    result = []
    in_single_quote = False
    in_double_quote = False
    i = 0

    while i < len(sql):
        char = sql[i]

        # Handle escape sequences
        if char == "\\" and i + 1 < len(sql):
            result.append(char)
            result.append(sql[i + 1])
            i += 2
            continue

        # Toggle quote states
        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote

        # Replace ? with %s only outside of quotes
        if char == "?" and not in_single_quote and not in_double_quote:
            result.append("%s")
        else:
            result.append(char)

        i += 1

    return "".join(result)


@platform_function(
    name="mysql_connect",
    inputs=[MySqlConfigType],
    output=ConnectionHandleType,
)
async def mysql_connect_impl(config: EastStruct) -> str:
    """Create an aiomysql connection pool and return a handle.

    Args:
        config: ``MySqlConfigType`` (``EastStruct``) with fields:

            - ``host`` (``String``): server hostname or IP.
            - ``port`` (``Integer``): server port (typically 3306).
            - ``database`` (``String``): schema/database name.
            - ``user`` (``String``): login user.
            - ``password`` (``String``): login password.
            - ``ssl`` (``Option<Boolean>``): enable TLS (reserved - aiomysql
              pool does not currently forward this flag; default ``False``).
            - ``maxConnections`` (``Option<Integer>``): pool upper bound
              (default 10).

    Returns:
        ``String`` - opaque connection handle, passed to
        ``mysql_query_impl`` / ``mysql_close_impl``.

    Raises:
        NotImplementedError: the ``mysql`` extra (aiomysql) is not installed.
        Exception: aiomysql pool creation fails (bad credentials, host
            unreachable, etc.).
    """
    _check_mysql_support()
    import aiomysql

    try:
        host = config["host"]
        port = int(config["port"])
        database = config["database"]
        user = config["user"]
        password = config["password"]

        max_conn_opt = config["maxConnections"]
        max_connections = int(max_conn_opt.value) if max_conn_opt.type == "some" else 10

        # Create connection pool
        pool = await aiomysql.create_pool(
            host=host,
            port=port,
            db=database,
            user=user,
            password=password,
            minsize=1,
            maxsize=max_connections,
            autocommit=True,
        )

        # Generate handle
        handle = str(uuid.uuid4())
        _pools[handle] = pool

        return handle
    except Exception as e:
        raise Exception(f"MySQL connection failed: {e}") from e


@platform_function(
    name="mysql_query",
    inputs=[ConnectionHandleType, StringType, SqlParametersType],
    output=SqlResultType,
)
async def mysql_query_impl(handle: str, sql: str, params: EastArray) -> EastVariant:
    """Execute a parameterized SQL statement and return a typed result.

    Converts ``?`` placeholders to ``%s`` before passing to aiomysql.
    Dispatches on the leading keyword of the SQL string (``SELECT``,
    ``INSERT``, ``UPDATE``, ``DELETE``; everything else treated as
    ``UPDATE``).  MySQL field type codes from ``cursor.description`` drive
    East type coercion for ``SELECT`` rows.

    Args:
        handle: ``String`` - connection handle from ``mysql_connect_impl``.
        sql: ``String`` - SQL statement with ``?`` positional placeholders.
        params: ``Array<SqlParameterType>`` (``EastArray``) - bind values in
            placeholder order.

    Returns:
        ``SqlResultType`` (``EastVariant``):

        - ``select`` ``{rows: Array<Dict<String, SqlParameterType>>}``
        - ``insert`` ``{rowsAffected: Integer, lastInsertId: Option<Integer>}``
        - ``update`` ``{rowsAffected: Integer}``
        - ``delete`` ``{rowsAffected: Integer}``

    Raises:
        NotImplementedError: the ``mysql`` extra (aiomysql) is not installed.
        Exception: the handle is unknown, the SQL is malformed, or a
            parameter type is incompatible.
    """
    _check_mysql_support()

    try:
        if handle not in _pools:
            raise Exception(f"Invalid connection handle: {handle}")

        pool = _pools[handle]

        # Convert East parameters to native values
        native_params = tuple(convert_param_to_native(p) for p in params)

        # Convert ? placeholders to %s for aiomysql
        # Be careful not to replace ? inside quoted strings
        converted_sql = _convert_placeholders(sql)

        # Determine query type
        trimmed_sql = sql.strip().upper()

        import aiomysql

        async with pool.acquire() as conn, conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute(converted_sql, native_params)

            if trimmed_sql.startswith("SELECT") or cursor.description:
                # SELECT query - return rows
                rows = await cursor.fetchall()

                # Build field type map from cursor.description
                # cursor.description is tuple of (name, type_code, display_size, internal_size, precision, scale, null_ok)
                field_type_map: dict[str, int | None] = {}
                if cursor.description:
                    for desc in cursor.description:
                        field_type_map[desc[0]] = desc[1]

                # Convert rows to East format
                east_rows: EastArray = EastArray(SqlRowType, [])
                for row in rows:
                    row_dict: EastDict = EastDict(StringType, SqlParameterType)
                    for key, value in row.items():
                        field_type = field_type_map.get(key)
                        row_dict[key] = convert_native_to_param(value, field_type)
                    east_rows.push_last(row_dict)

                return EastVariant("select", EastStruct({"rows": east_rows}))
            elif trimmed_sql.startswith("INSERT"):
                # INSERT query
                rows_affected = cursor.rowcount
                last_insert_id = cursor.lastrowid

                last_id_opt: EastVariant = (
                    EastVariant("some", last_insert_id)
                    if last_insert_id and last_insert_id != 0
                    else EastVariant("none", None)
                )

                return EastVariant(
                    "insert",
                    EastStruct({"rowsAffected": rows_affected, "lastInsertId": last_id_opt}),
                )
            elif trimmed_sql.startswith("UPDATE"):
                # UPDATE query
                rows_affected = cursor.rowcount
                return EastVariant("update", EastStruct({"rowsAffected": rows_affected}))
            elif trimmed_sql.startswith("DELETE"):
                # DELETE query
                rows_affected = cursor.rowcount
                return EastVariant("delete", EastStruct({"rowsAffected": rows_affected}))
            else:
                # Other queries (CREATE, DROP, etc.)
                rows_affected = cursor.rowcount
                return EastVariant("update", EastStruct({"rowsAffected": rows_affected}))
    except Exception as e:
        raise Exception(f"MySQL query failed: {e}") from e


@platform_function(
    name="mysql_close",
    inputs=[ConnectionHandleType],
    output=NullType,
)
async def mysql_close_impl(handle: str) -> None:
    """Close a MySQL connection pool and release its handle.

    Args:
        handle: ``String`` - connection handle from ``mysql_connect_impl``.

    Raises:
        NotImplementedError: the ``mysql`` extra (aiomysql) is not installed.
        Exception: the handle is unknown.
    """
    _check_mysql_support()

    try:
        if handle not in _pools:
            raise Exception(f"Invalid connection handle: {handle}")

        pool = _pools[handle]
        pool.close()
        await pool.wait_closed()
        del _pools[handle]
    except Exception as e:
        raise Exception(f"MySQL close failed: {e}") from e


@platform_function(
    name="mysql_close_all",
    inputs=[],
    output=NullType,
)
async def mysql_close_all_impl() -> None:
    """Close every open MySQL connection pool managed by this process.

    Clears the internal pool map; useful for test teardown.
    """
    for pool in _pools.values():
        pool.close()
        await pool.wait_closed()
    _pools.clear()


def _get_mysql_east_type(field_type: int | None, value: Any = None) -> str:
    """Get expected East type from MySQL field type code.

    Field type 252 (BLOB) is special - it's used for both TEXT and BLOB.
    We determine the actual type based on the value:
    - If value is bytes, it's Blob
    - If value is str, it's String
    """
    if field_type is None:
        return "String"

    # Boolean types
    if field_type == MYSQL_BIT:
        return "Boolean"

    # Integer types
    if field_type in (MYSQL_SHORT, MYSQL_LONG, MYSQL_LONGLONG, MYSQL_INT24):
        return "Integer"

    # Float types
    if field_type in (MYSQL_FLOAT, MYSQL_DOUBLE, MYSQL_NEWDECIMAL):
        return "Float"

    # String types
    if field_type in (MYSQL_VARCHAR, MYSQL_STRING):
        return "String"

    # DateTime types
    if field_type in (MYSQL_TIMESTAMP, MYSQL_DATE, MYSQL_TIME, MYSQL_DATETIME, MYSQL_YEAR):
        return "DateTime"

    # BLOB/TEXT type - determined by actual value type
    if field_type == MYSQL_BLOB:
        if isinstance(value, bytes):
            return "Blob"
        return "String"  # TEXT columns return str

    # TINYINT can be boolean or integer depending on usage
    # We treat it as boolean by default (TINYINT(1) is MySQL's boolean)
    if field_type == MYSQL_TINY:
        return "Boolean"

    return "String"  # Default


def _get_east_type_name(t: Any) -> str:
    """Get the East type name from a type object."""
    if is_integer_type(t):
        return "Integer"
    elif is_float_type(t):
        return "Float"
    elif is_boolean_type(t):
        return "Boolean"
    elif is_string_type(t):
        return "String"
    elif is_blob_type(t):
        return "Blob"
    elif is_datetime_type(t):
        return "DateTime"
    return "Unknown"


def _check_type_compatibility(field_type: Any, expected_east: str) -> tuple[bool, bool]:
    """Check if field_type matches expected_east type.

    Returns:
        Tuple of (is_option, is_compatible)
    """
    field_is_option = is_option_type(field_type)
    inner_type = get_option_inner_type(field_type) if field_is_option else field_type
    actual_type = _get_east_type_name(inner_type)

    # Check compatibility
    compatible = False
    if actual_type == expected_east or expected_east == "Integer" and actual_type in ("Float", "Boolean") or expected_east == "Float" and actual_type == "Integer" or expected_east == "Boolean" and actual_type == "Integer":
        compatible = True

    return field_is_option, compatible


def _convert_mysql_select_value(value: Any, field_type: int | None) -> Any:
    """Convert MySQL value to East value for select results."""
    from east.types.values import EastBlob

    if field_type is None:
        return value

    if field_type in (MYSQL_SHORT, MYSQL_LONG, MYSQL_LONGLONG, MYSQL_INT24):
        return int(value)
    elif field_type in (MYSQL_FLOAT, MYSQL_DOUBLE, MYSQL_NEWDECIMAL):
        return float(value)
    elif field_type in (MYSQL_TINY, MYSQL_BIT):
        return bool(value)
    elif field_type == MYSQL_BLOB and isinstance(value, bytes):
        return EastBlob(value)
    elif field_type in (MYSQL_TIMESTAMP, MYSQL_DATETIME) and isinstance(value, datetime):
        # Ensure UTC timezone and truncate to milliseconds
        value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        ms = (value.microsecond // 1000) * 1000
        return value.replace(microsecond=ms)
    else:
        return value


@generic_platform_function(
    name="mysql_select",
    type_parameters=["T"],
    is_async=True,
)
def mysql_select_factory(platform: Any, row_type: Any) -> Any:
    """Return a typed ``mysql_select`` implementation for a given row struct type.

    Called by the ``@generic_platform_function`` decorator with the resolved
    ``T`` type argument.  The returned coroutine validates MySQL field type
    codes against ``T`` (using the first returned row for ``BLOB``/``TEXT``
    disambiguation) before converting each row.

    Args:
        platform: Platform-function list (unused; matches the
            ``GenericPlatformFunction`` factory convention of
            ``(platform_list, *type_params)``).
        row_type: East ``StructType`` describing one result row.

    Returns:
        Async callable ``(handle, sql, params) -> EastArray(T)`` implementing
        ``mysql_select<T>``.
    """
    del platform

    async def mysql_select_impl(handle: str, sql: str, params: EastArray) -> EastArray:
        """Execute a SELECT query and return rows typed as ``Array<T>``.

        Validates that every field in ``T`` maps to a compatible MySQL field
        type from ``cursor.description`` before converting values.  Nullable
        columns must be declared as ``Option<...>`` in ``T``.  ``BLOB``
        vs ``TEXT`` disambiguation (both are field type 252) uses the actual
        Python type of the first row's value.

        Args:
            handle: ``String`` - connection handle from
                ``mysql_connect_impl``.
            sql: ``String`` - ``SELECT`` statement with ``?`` positional
                placeholders.
            params: ``Array<SqlParameterType>`` (``EastArray``) - bind
                values in placeholder order.

        Returns:
            ``Array<T>`` (``EastArray``) - one ``EastStruct`` per result row,
            fields coerced to the types declared in ``T``.

        Raises:
            NotImplementedError: the ``mysql`` extra (aiomysql) is not
                installed.
            Exception: the handle is unknown, the query has no result set,
                ``T`` is not a ``StructType``, a required column is missing,
                a column type is incompatible with the corresponding ``T``
                field, or a non-optional field contains ``NULL``.
        """
        _check_mysql_support()
        import aiomysql

        try:
            if handle not in _pools:
                raise Exception(f"Invalid connection handle: {handle}")

            pool = _pools[handle]

            # Convert East parameters to native values
            native_params = tuple(convert_param_to_native(p) for p in params)

            # Convert ? placeholders to %s for aiomysql
            converted_sql = _convert_placeholders(sql)

            async with pool.acquire() as conn, conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(converted_sql, native_params)

                # Verify this is a SELECT query
                if not cursor.description:
                    raise Exception(
                        "mysql_select only supports SELECT queries. "
                        "Use mysql_query for INSERT/UPDATE/DELETE."
                    )

                # Validate row type T is a Struct
                if not is_struct_type(row_type):
                    raise Exception(f"Expected row type must be a Struct, got {row_type.type}")

                # Build field type map from cursor.description
                field_type_map: dict[str, int | None] = {}
                if cursor.description:
                    for desc in cursor.description:
                        field_type_map[desc[0]] = desc[1]

                # Fetch all rows first to get actual value types for BLOB/TEXT disambiguation
                raw_rows = await cursor.fetchall()

                # Validate field types match columns using first row for type inference
                fields = row_type.value
                field_info: dict[str, dict[str, Any]] = {}

                # Use first row to help disambiguate BLOB/TEXT (type 252)
                sample_row = raw_rows[0] if raw_rows else {}

                for field in fields:
                    field_name = field["name"]
                    field_type = field["type"]

                    if field_name not in field_type_map:
                        raise Exception(f"Column '{field_name}' not found in query result")

                    mysql_type = field_type_map[field_name]
                    sample_value = sample_row.get(field_name)
                    expected_east = _get_mysql_east_type(mysql_type, sample_value)

                    # Check if field type matches expected type or OptionType(expected)
                    field_is_option, compatible = _check_type_compatibility(field_type, expected_east)

                    if not compatible:
                        raise Exception(
                            f"Type mismatch for column '{field_name}': MySQL field type is {mysql_type}, "
                            f"expected {expected_east} or OptionType({expected_east})"
                        )

                    field_info[field_name] = {
                        "is_option": field_is_option,
                        "mysql_type": mysql_type,
                    }

                # Convert rows
                rows: list[EastStruct] = []

                for row_idx, raw_row in enumerate(raw_rows):
                    converted: dict[str, Any] = {}

                    for field in fields:
                        field_name = field["name"]
                        info = field_info[field_name]
                        value = raw_row.get(field_name)

                        if value is None:
                            if info["is_option"]:
                                converted[field_name] = EastVariant("none", None)
                            else:
                                raise Exception(
                                    f"null value at row[{row_idx}] for required field '{field_name}' - "
                                    f"use OptionType for nullable columns"
                                )
                        else:
                            # Convert based on MySQL type
                            converted_value = _convert_mysql_select_value(value, info["mysql_type"])

                            if info["is_option"]:
                                converted[field_name] = EastVariant("some", converted_value)
                            else:
                                converted[field_name] = converted_value

                    rows.append(EastStruct(converted))

                return EastArray(row_type, rows)
        except Exception as e:
            raise Exception(f"MySQL select failed: {e}") from e

    return mysql_select_impl


# Collected from the @platform_function / @generic_platform_function decorations above.
mysql_impl = platform_functions(__name__)

__all__ = [
    "mysql_impl",
    "mysql_connect_impl",
    "mysql_query_impl",
    "mysql_close_impl",
    "mysql_close_all_impl",
]
