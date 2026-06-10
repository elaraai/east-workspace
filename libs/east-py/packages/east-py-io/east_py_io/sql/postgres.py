#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""PostgreSQL platform functions for East.

Provides PostgreSQL database operations for East programs, including
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

_HAS_POSTGRES_SUPPORT = importlib.util.find_spec("asyncpg") is not None


def _check_postgres_support() -> None:
    """Check if PostgreSQL support is available."""
    if not _HAS_POSTGRES_SUPPORT:
        raise NotImplementedError(
            "PostgreSQL support requires the 'postgres' extra. "
            "Add east-py-io[postgres] to your pyproject.toml dependencies."
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
    PostgresConfigType,
    SqlParametersType,
    SqlParameterType,
    SqlResultType,
    SqlRowType,
)

# Connection pool storage
_pools: dict[str, Any] = {}


def convert_param_to_native(param: EastVariant) -> Any:
    """Convert an East SQL parameter variant to a native Python value for asyncpg binding.

    ``DateTime`` values have their timezone stripped before binding to avoid
    asyncpg comparison failures with timezone-aware timestamps.

    Args:
        param: ``EastVariant`` whose ``type`` tag is one of ``String``,
            ``Integer``, ``Float``, ``Boolean``, ``Null``, ``Blob``,
            ``DateTime``.

    Returns:
        Native Python value suitable for asyncpg parameter binding.
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
        # Strip timezone info to avoid asyncpg comparison issues
        if value is not None and hasattr(value, "tzinfo") and value.tzinfo is not None:
            return value.replace(tzinfo=None)
        return value
    else:
        return None


def convert_native_to_param(value: Any) -> EastVariant:
    """Convert a native asyncpg result value to an East SQL parameter variant.

    ``datetime`` values are normalized to UTC and truncated to millisecond
    precision to match TypeScript behavior.

    Args:
        value: Native Python value returned by asyncpg (``None``, ``bool``,
            ``int``, ``float``, ``str``, ``bytes``, or ``datetime``).

    Returns:
        ``EastVariant`` tagged ``Null``, ``Boolean``, ``Integer``, ``Float``,
        ``String``, ``Blob``, or ``DateTime``.
    """
    from east.types.values import EastBlob

    if value is None:
        return EastVariant("Null", east_null)
    elif isinstance(value, bool):
        return EastVariant("Boolean", value)
    elif isinstance(value, int):
        return EastVariant("Integer", value)
    elif isinstance(value, float):
        return EastVariant("Float", value)
    elif isinstance(value, str):
        return EastVariant("String", value)
    elif isinstance(value, bytes):
        return EastVariant("Blob", EastBlob(value))
    elif isinstance(value, datetime):
        # Ensure UTC timezone and truncate to milliseconds to match TypeScript behavior
        value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        # Truncate microseconds to milliseconds (keep first 3 digits of microseconds)
        ms = (value.microsecond // 1000) * 1000
        value = value.replace(microsecond=ms)
        return EastVariant("DateTime", value)
    else:
        return EastVariant("Null", east_null)


@platform_function(
    name="postgres_connect",
    inputs=[PostgresConfigType],
    output=ConnectionHandleType,
)
async def postgres_connect_impl(config: EastStruct) -> str:
    """Create an asyncpg connection pool and return a handle.

    Args:
        config: ``PostgresConfigType`` (``EastStruct``) with fields:

            - ``host`` (``String``): server hostname or IP.
            - ``port`` (``Integer``): server port (typically 5432).
            - ``database`` (``String``): database name.
            - ``user`` (``String``): login user.
            - ``password`` (``String``): login password.
            - ``ssl`` (``Option<Boolean>``): enable TLS (default ``False``).
            - ``maxConnections`` (``Option<Integer>``): pool upper bound
              (default 10).

    Returns:
        ``String`` - opaque connection handle, passed to
        ``postgres_query_impl`` / ``postgres_close_impl``.

    Raises:
        NotImplementedError: the ``postgres`` extra (asyncpg) is not
            installed.
        Exception: asyncpg pool creation fails (bad credentials, host
            unreachable, etc.).
    """
    _check_postgres_support()
    import asyncpg

    try:
        host = config["host"]
        port = int(config["port"])
        database = config["database"]
        user = config["user"]
        password = config["password"]

        ssl_opt = config["ssl"]
        ssl = ssl_opt.value if ssl_opt.type == "some" else False

        max_conn_opt = config["maxConnections"]
        max_connections = int(max_conn_opt.value) if max_conn_opt.type == "some" else 10

        # Create connection pool
        pool = await asyncpg.create_pool(
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            ssl=ssl if ssl else None,
            min_size=1,
            max_size=max_connections,
        )

        if pool is None:
            raise Exception("Failed to create connection pool")

        # Generate handle
        handle = str(uuid.uuid4())
        _pools[handle] = pool

        return handle
    except Exception as e:
        raise Exception(f"PostgreSQL connection failed: {e}") from e


@platform_function(
    name="postgres_query",
    inputs=[ConnectionHandleType, StringType, SqlParametersType],
    output=SqlResultType,
)
async def postgres_query_impl(handle: str, sql: str, params: EastArray) -> EastVariant:
    """Execute a parameterized SQL statement and return a typed result.

    Dispatches on the leading keyword of the SQL string (``SELECT``,
    ``INSERT``, ``UPDATE``, ``DELETE``; everything else treated as ``UPDATE``
    with ``rowsAffected = 0``).

    Args:
        handle: ``String`` - connection handle from ``postgres_connect_impl``.
        sql: ``String`` - SQL statement with ``$1``, ``$2``, ... positional
            placeholders (asyncpg style).
        params: ``Array<SqlParameterType>`` (``EastArray``) - bind values in
            placeholder order.

    Returns:
        ``SqlResultType`` (``EastVariant``):

        - ``select`` ``{rows: Array<Dict<String, SqlParameterType>>}``
        - ``insert`` ``{rowsAffected: Integer, lastInsertId: Option<Integer>}``
          (``lastInsertId`` is always ``none`` for PostgreSQL - use
          ``RETURNING`` in the query instead)
        - ``update`` ``{rowsAffected: Integer}``
        - ``delete`` ``{rowsAffected: Integer}``

    Raises:
        NotImplementedError: the ``postgres`` extra (asyncpg) is not
            installed.
        Exception: the handle is unknown, the SQL is malformed, or a
            parameter type is incompatible.
    """
    _check_postgres_support()

    try:
        if handle not in _pools:
            raise Exception(f"Invalid connection handle: {handle}")

        pool = _pools[handle]

        # Convert East parameters to native values
        native_params = [convert_param_to_native(p) for p in params]

        # Determine query type
        trimmed_sql = sql.strip().upper()

        async with pool.acquire() as conn:
            if trimmed_sql.startswith("SELECT"):
                # SELECT query - return rows
                rows = await conn.fetch(sql, *native_params)

                # Convert rows to East format
                east_rows: EastArray = EastArray(SqlRowType, [])
                for row in rows:
                    row_dict: EastDict = EastDict(StringType, SqlParameterType)
                    for key, value in row.items():
                        row_dict[key] = convert_native_to_param(value)
                    east_rows.append(row_dict)

                return EastVariant("select", EastStruct({"rows": east_rows}))
            elif trimmed_sql.startswith("INSERT"):
                # INSERT query
                result = await conn.execute(sql, *native_params)
                # Parse result like "INSERT 0 1"
                parts = result.split()
                rows_affected = int(parts[-1]) if len(parts) >= 2 else 0

                return EastVariant(
                    "insert",
                    EastStruct(
                        {"rowsAffected": rows_affected, "lastInsertId": EastVariant("none", None)}
                    ),
                )
            elif trimmed_sql.startswith("UPDATE"):
                # UPDATE query
                result = await conn.execute(sql, *native_params)
                parts = result.split()
                rows_affected = int(parts[-1]) if len(parts) >= 2 else 0

                return EastVariant("update", EastStruct({"rowsAffected": rows_affected}))
            elif trimmed_sql.startswith("DELETE"):
                # DELETE query
                result = await conn.execute(sql, *native_params)
                parts = result.split()
                rows_affected = int(parts[-1]) if len(parts) >= 2 else 0

                return EastVariant("delete", EastStruct({"rowsAffected": rows_affected}))
            else:
                # Other queries (CREATE, DROP, etc.)
                await conn.execute(sql, *native_params)
                return EastVariant("update", EastStruct({"rowsAffected": 0}))
    except Exception as e:
        raise Exception(f"PostgreSQL query failed: {e}") from e


@platform_function(
    name="postgres_close",
    inputs=[ConnectionHandleType],
    output=NullType,
)
async def postgres_close_impl(handle: str) -> None:
    """Gracefully close a PostgreSQL connection pool and release its handle.

    Args:
        handle: ``String`` - connection handle from ``postgres_connect_impl``.

    Raises:
        NotImplementedError: the ``postgres`` extra (asyncpg) is not
            installed.
        Exception: the handle is unknown.
    """
    _check_postgres_support()

    try:
        if handle not in _pools:
            raise Exception(f"Invalid connection handle: {handle}")

        pool = _pools[handle]
        await pool.close()
        del _pools[handle]
    except Exception as e:
        raise Exception(f"PostgreSQL close failed: {e}") from e


@platform_function(
    name="postgres_close_all",
    inputs=[],
    output=NullType,
)
async def postgres_close_all_impl() -> None:
    """Gracefully close every open PostgreSQL connection pool managed by this process.

    Clears the internal pool map; useful for test teardown.
    """
    for pool in _pools.values():
        await pool.close()
    _pools.clear()


# PostgreSQL type OIDs
_PG_BOOL = 16
_PG_BYTEA = 17
_PG_INT8 = 20  # bigint
_PG_INT2 = 21  # smallint
_PG_INT4 = 23  # integer
_PG_TEXT = 25
_PG_FLOAT4 = 700
_PG_FLOAT8 = 701
_PG_CHAR = 1042
_PG_VARCHAR = 1043
_PG_TIMESTAMP = 1114
_PG_TIMESTAMPTZ = 1184
_PG_NUMERIC = 1700


def _get_postgres_east_type(oid: int) -> str:
    """Get expected East type from PostgreSQL type OID."""
    if oid == _PG_BOOL:
        return "Boolean"
    elif oid in (_PG_INT2, _PG_INT4, _PG_INT8):
        return "Integer"
    elif oid in (_PG_FLOAT4, _PG_FLOAT8, _PG_NUMERIC):
        return "Float"
    elif oid in (_PG_TEXT, _PG_CHAR, _PG_VARCHAR):
        return "String"
    elif oid in (_PG_TIMESTAMP, _PG_TIMESTAMPTZ):
        return "DateTime"
    elif oid == _PG_BYTEA:
        return "Blob"
    else:
        return "String"  # Default to String for unknown types


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


def _convert_postgres_select_value(value: Any, oid: int) -> Any:
    """Convert PostgreSQL value to East value for select results."""
    from east.types.values import EastBlob

    if oid in (_PG_INT2, _PG_INT4, _PG_INT8):
        return int(value)
    elif oid in (_PG_FLOAT4, _PG_FLOAT8, _PG_NUMERIC):
        return float(value)
    elif oid == _PG_BOOL:
        return bool(value)
    elif oid == _PG_BYTEA and isinstance(value, bytes):
        return EastBlob(value)
    elif oid in (_PG_TIMESTAMP, _PG_TIMESTAMPTZ) and isinstance(value, datetime):
        # Ensure UTC timezone and truncate to milliseconds
        value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        ms = (value.microsecond // 1000) * 1000
        return value.replace(microsecond=ms)
    else:
        return value


def postgres_select_factory(row_type: Any) -> Any:
    """Return a typed ``postgres_select`` implementation for a given row struct type.

    Called by the ``@generic_platform_function`` decorator with the resolved
    ``T`` type argument.  The returned coroutine uses asyncpg's
    ``conn.prepare()`` to obtain column OIDs and validates them against ``T``
    before converting each row.

    Args:
        row_type: East ``StructType`` describing one result row.

    Returns:
        Async callable ``(handle, sql, params) -> EastArray(T)`` implementing
        ``postgres_select<T>``.
    """

    async def postgres_select_impl(handle: str, sql: str, params: EastArray) -> EastArray:
        """Execute a SELECT query and return rows typed as ``Array<T>``.

        Uses a prepared statement to obtain column OIDs and validates that
        every field in ``T`` maps to a compatible PostgreSQL column type
        before converting values.  Nullable columns must be declared as
        ``Option<...>`` in ``T``.

        Args:
            handle: ``String`` - connection handle from
                ``postgres_connect_impl``.
            sql: ``String`` - ``SELECT`` statement with ``$1``, ``$2``, ...
                positional placeholders.
            params: ``Array<SqlParameterType>`` (``EastArray``) - bind
                values in placeholder order.

        Returns:
            ``Array<T>`` (``EastArray``) - one ``EastStruct`` per result row,
            fields coerced to the types declared in ``T``.

        Raises:
            NotImplementedError: the ``postgres`` extra (asyncpg) is not
                installed.
            Exception: the handle is unknown, ``T`` is not a ``StructType``,
                a required column is missing from the result, a column type
                is incompatible with the corresponding ``T`` field, or a
                non-optional field contains ``NULL``.
        """
        _check_postgres_support()

        try:
            if handle not in _pools:
                raise Exception(f"Invalid connection handle: {handle}")

            pool = _pools[handle]

            # Convert East parameters to native values
            native_params = [convert_param_to_native(p) for p in params]

            async with pool.acquire() as conn:
                # Use prepared statement to get column types
                stmt = await conn.prepare(sql)
                attributes = stmt.get_attributes()

                # Validate row type T is a Struct
                if not is_struct_type(row_type):
                    raise Exception(f"Expected row type must be a Struct, got {row_type.type}")

                # Build column info from attributes
                column_info = [(attr.name, attr.type.oid) for attr in attributes]
                column_types = dict(column_info)

                # Validate field types match columns
                fields = row_type.value
                field_info: dict[str, dict[str, Any]] = {}

                for field in fields:
                    field_name = field["name"]
                    field_type = field["type"]

                    if field_name not in column_types:
                        raise Exception(f"Column '{field_name}' not found in query result")

                    oid = column_types[field_name]
                    expected_east = _get_postgres_east_type(oid)

                    # Check if field type matches expected type or OptionType(expected)
                    field_is_option, compatible = _check_type_compatibility(field_type, expected_east)

                    if not compatible:
                        raise Exception(
                            f"Type mismatch for column '{field_name}': PostgreSQL OID is {oid}, "
                            f"expected {expected_east} or OptionType({expected_east})"
                        )

                    field_info[field_name] = {
                        "is_option": field_is_option,
                        "oid": oid,
                    }

                # Execute query and fetch rows
                raw_rows = await conn.fetch(sql, *native_params)
                rows: list[EastStruct] = []

                for row_idx, raw_row in enumerate(raw_rows):
                    converted: dict[str, Any] = {}

                    for field in fields:
                        field_name = field["name"]
                        info = field_info[field_name]
                        value = raw_row[field_name]

                        if value is None:
                            if info["is_option"]:
                                converted[field_name] = EastVariant("none", None)
                            else:
                                raise Exception(
                                    f"null value at row[{row_idx}] for required field '{field_name}' - "
                                    f"use OptionType for nullable columns"
                                )
                        else:
                            # Convert based on OID
                            converted_value = _convert_postgres_select_value(value, info["oid"])

                            if info["is_option"]:
                                converted[field_name] = EastVariant("some", converted_value)
                            else:
                                converted[field_name] = converted_value

                    rows.append(EastStruct(converted))

                return EastArray(row_type, rows)
        except Exception as e:
            raise Exception(f"PostgreSQL select failed: {e}") from e

    return postgres_select_impl


@generic_platform_function(
    name="postgres_select",
    type_parameters=["T"],
    is_async=True,
)
def _postgres_select_factory(_platform_list: Any, T: Any) -> Any:  # noqa: N803
    return postgres_select_factory(T)


# Collected from the @platform_function / @generic_platform_function decorations above.
postgres_impl = platform_functions(__name__)

__all__ = [
    "postgres_impl",
    "postgres_connect_impl",
    "postgres_query_impl",
    "postgres_close_impl",
    "postgres_close_all_impl",
]
