#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SQLite platform functions for East.

Provides SQLite database operations for East programs, including
connection management and parameterized query execution.

Uses APSW (Another Python SQLite Wrapper) for full SQLite C API access,
including column type metadata via sqlite3_column_decltype().
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

_HAS_SQLITE_SUPPORT = importlib.util.find_spec("apsw") is not None


def _check_sqlite_support() -> None:
    """Check if SQLite support is available."""
    if not _HAS_SQLITE_SUPPORT:
        raise NotImplementedError(
            "SQLite support requires the 'sqlite' extra. "
            "Add east-py-io[sqlite] to your pyproject.toml dependencies."
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
    SqliteConfigType,
    SqlParametersType,
    SqlParameterType,
    SqlResultType,
    SqlRowType,
)

# Connection storage
_connections: dict[str, Any] = {}

# SQLite type categories for type validation
_SQLITE_INTEGER_TYPES = {
    "INTEGER",
    "INT",
    "TINYINT",
    "SMALLINT",
    "MEDIUMINT",
    "BIGINT",
    "UNSIGNED BIG INT",
    "INT2",
    "INT8",
}
_SQLITE_FLOAT_TYPES = {
    "REAL",
    "DOUBLE",
    "DOUBLE PRECISION",
    "FLOAT",
    "NUMERIC",
    "DECIMAL",
}
_SQLITE_TEXT_TYPES = {
    "TEXT",
    "CHARACTER",
    "VARCHAR",
    "VARYING CHARACTER",
    "NCHAR",
    "NATIVE CHARACTER",
    "NVARCHAR",
    "CLOB",
    "DATE",
}


def convert_param_to_native(param: EastVariant) -> Any:
    """Convert East SQL parameter to native Python value.

    Args:
        param: East SQL parameter variant

    Returns:
        Native Python value for SQLite binding
    """
    tag = param.type
    value = param.value

    if tag == "String":
        return value
    elif tag == "Integer":
        return int(value) if value is not None else 0
    elif tag == "Float":
        return value
    elif tag == "Boolean":
        return 1 if value else 0  # SQLite uses 0/1 for booleans
    elif tag == "Null":
        return None
    elif tag == "Blob":
        return bytes(value) if value else b""
    elif tag == "DateTime":
        return value.isoformat() if value else ""  # Store as ISO string
    else:
        return None


def convert_native_to_param(value: Any, column_type: str | None = None) -> EastVariant:
    """Convert native Python value to East SQL parameter variant.

    Uses the declared column type from APSW's cursor.description to determine
    the correct East type for the value.

    Note: For literals (column_type is None), numeric values are returned as Float
    to match TypeScript behavior (JavaScript numbers are always floats).

    Args:
        value: Native Python value from SQLite
        column_type: SQLite declared column type from cursor.description

    Returns:
        East SQL parameter variant
    """
    from east.types.values import EastBlob

    if value is None:
        return EastVariant("Null", east_null)

    col_upper = column_type.upper() if column_type else None

    # Boolean - check column type first, then value type
    if col_upper == "BOOLEAN":
        return EastVariant("Boolean", bool(value))
    if column_type is None and isinstance(value, bool):
        return EastVariant("Boolean", value)

    # Integer - ONLY when column type explicitly declares it
    # For literals (column_type is None), use Float to match TypeScript
    if col_upper in _SQLITE_INTEGER_TYPES:
        return EastVariant("Integer", int(value))

    # Float - based on column type OR for untyped numeric literals
    if col_upper in _SQLITE_FLOAT_TYPES:
        return EastVariant("Float", float(value))
    # For literals (no column type), numeric values become Float (matching TypeScript)
    if column_type is None and isinstance(value, (int, float)) and not isinstance(value, bool):
        return EastVariant("Float", float(value))

    # String - based on column type
    if col_upper in _SQLITE_TEXT_TYPES:
        return EastVariant("String", str(value))
    if column_type is None and isinstance(value, str):
        return EastVariant("String", value)

    # DateTime - based on column type
    if col_upper == "DATETIME":
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
        elif isinstance(value, datetime):
            dt = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
        # Truncate to milliseconds
        ms = (dt.microsecond // 1000) * 1000
        return EastVariant("DateTime", dt.replace(microsecond=ms))
    if column_type is None and isinstance(value, datetime):
        dt = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        ms = (dt.microsecond // 1000) * 1000
        return EastVariant("DateTime", dt.replace(microsecond=ms))

    # Blob - based on column type
    if col_upper == "BLOB":
        return EastVariant("Blob", EastBlob(bytes(value) if not isinstance(value, bytes) else value))
    if column_type is None and isinstance(value, bytes):
        return EastVariant("Blob", EastBlob(value))

    # Unknown column type - infer from value
    if isinstance(value, bool):
        return EastVariant("Boolean", value)
    if isinstance(value, (int, float)):
        return EastVariant("Float", float(value))
    if isinstance(value, str):
        return EastVariant("String", value)
    if isinstance(value, bytes):
        return EastVariant("Blob", EastBlob(value))

    return EastVariant("Null", east_null)


def _get_expected_east_type(col_type: str | None) -> str:
    """Get the expected East type name from a SQLite column type."""
    if col_type is None:
        return "Integer"  # Default for expressions

    col_upper = col_type.upper()

    if col_upper in _SQLITE_INTEGER_TYPES:
        return "Integer"
    elif col_upper in _SQLITE_FLOAT_TYPES:
        return "Float"
    elif col_upper in _SQLITE_TEXT_TYPES:
        return "String"
    elif col_upper == "DATETIME":
        return "DateTime"
    elif col_upper == "BLOB":
        return "Blob"
    elif col_upper == "BOOLEAN":
        return "Boolean"
    else:
        return "Integer"  # Unknown - default to Integer


def _convert_value_for_type(
    value: Any, expected_type: Any, col_name: str, col_type: str | None
) -> Any:
    """Convert a SQLite value to match the expected East type with validation.

    Args:
        value: Raw value from SQLite
        expected_type: Expected East type from row_type
        col_name: Column name for error messages
        col_type: Declared SQLite column type from cursor.description

    Returns:
        Converted value matching the expected type

    Raises:
        Exception: If column type doesn't match expected type
    """
    from east.types.values import EastBlob

    expected_east_type = _get_expected_east_type(col_type)

    if is_integer_type(expected_type):
        if expected_east_type not in ("Integer", "Float", "Boolean"):
            raise Exception(
                f"Type mismatch for column '{col_name}': SQLite column is {col_type}, "
                f"got Integer but expected {expected_east_type} or OptionType({expected_east_type})"
            )
        return int(value)
    elif is_float_type(expected_type):
        if expected_east_type not in ("Integer", "Float"):
            raise Exception(
                f"Type mismatch for column '{col_name}': SQLite column is {col_type}, "
                f"got Float but expected {expected_east_type} or OptionType({expected_east_type})"
            )
        return float(value)
    elif is_boolean_type(expected_type):
        if expected_east_type not in ("Boolean", "Integer"):
            raise Exception(
                f"Type mismatch for column '{col_name}': SQLite column is {col_type}, "
                f"got Boolean but expected {expected_east_type} or OptionType({expected_east_type})"
            )
        return bool(value)
    elif is_string_type(expected_type):
        if expected_east_type != "String":
            raise Exception(
                f"Type mismatch for column '{col_name}': SQLite column is {col_type}, "
                f"got String but expected {expected_east_type} or OptionType({expected_east_type})"
            )
        return value
    elif is_blob_type(expected_type):
        if expected_east_type != "Blob":
            raise Exception(
                f"Type mismatch for column '{col_name}': SQLite column is {col_type}, "
                f"got Blob but expected {expected_east_type} or OptionType({expected_east_type})"
            )
        return EastBlob(bytes(value) if not isinstance(value, bytes) else value)
    elif is_datetime_type(expected_type):
        if expected_east_type != "DateTime":
            raise Exception(
                f"Type mismatch for column '{col_name}': SQLite column is {col_type}, "
                f"got DateTime but expected {expected_east_type} or OptionType({expected_east_type})"
            )
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
        elif isinstance(value, datetime):
            dt = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
        # Truncate to milliseconds
        ms = (dt.microsecond // 1000) * 1000
        return dt.replace(microsecond=ms)
    else:
        # Unknown type - return as-is
        return value


@platform_function(
    name="sqlite_connect",
    inputs=[SqliteConfigType],
    output=ConnectionHandleType,
)
async def sqlite_connect_impl(config: EastStruct) -> str:
    """Connect to a SQLite database.

    Args:
        config: SQLite connection configuration

    Returns:
        Connection handle (opaque string)

    Raises:
        NotImplementedError: If apsw is not installed
        Exception: If connection fails
    """
    _check_sqlite_support()
    import apsw

    try:
        path = config["path"]
        read_only = False
        memory = False

        read_only_opt = config["readOnly"]
        if read_only_opt.type == "some":
            read_only = read_only_opt.value

        memory_opt = config["memory"]
        if memory_opt.type == "some":
            memory = memory_opt.value

        actual_path = ":memory:" if memory else path

        # Create connection with appropriate flags
        flags = apsw.SQLITE_OPEN_READONLY if read_only else (
            apsw.SQLITE_OPEN_READWRITE | apsw.SQLITE_OPEN_CREATE
        )

        conn = apsw.Connection(actual_path, flags=flags)

        # Enable foreign keys by default
        conn.execute("PRAGMA foreign_keys = ON")

        # Generate handle
        handle = str(uuid.uuid4())
        _connections[handle] = conn

        return handle
    except Exception as e:
        raise Exception(f"SQLite connection failed: {e}") from e


@platform_function(
    name="sqlite_query",
    inputs=[ConnectionHandleType, StringType, SqlParametersType],
    output=SqlResultType,
)
async def sqlite_query_impl(handle: str, sql: str, params: EastArray) -> EastVariant:
    """Execute a SQL query with parameterized values.

    Args:
        handle: Connection handle
        sql: SQL query string
        params: Query parameters

    Returns:
        Query result variant

    Raises:
        NotImplementedError: If apsw is not installed
        Exception: If query fails or handle is invalid
    """
    _check_sqlite_support()

    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        conn = _connections[handle]

        # Convert East parameters to native values
        native_params = tuple(convert_param_to_native(p) for p in params)

        # Determine query type from SQL first (APSW doesn't allow description access after completion)
        trimmed_sql = sql.strip().upper()

        # Execute query
        cursor = conn.cursor()

        if trimmed_sql.startswith("SELECT"):
            # SELECT query - need to get description before consuming rows
            cursor.execute(sql, native_params)
            description = cursor.description
            column_info = [(desc[0], desc[1]) for desc in description] if description else []

            # Fetch all rows by iterating cursor
            rows = list(cursor)

            # Convert rows to East format
            east_rows: EastArray = EastArray(SqlRowType, [])
            for row in rows:
                row_dict: EastDict = EastDict(StringType, SqlParameterType)
                for (col_name, col_type), value in zip(column_info, row, strict=True):
                    row_dict[col_name] = convert_native_to_param(value, col_type)
                east_rows.append(row_dict)

            return EastVariant("select", EastStruct({"rows": east_rows}))
        elif trimmed_sql.startswith("INSERT"):
            # INSERT query
            cursor.execute(sql, native_params)
            rows_affected = conn.changes()
            last_insert_id = conn.last_insert_rowid()

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
            cursor.execute(sql, native_params)
            rows_affected = conn.changes()
            return EastVariant("update", EastStruct({"rowsAffected": rows_affected}))
        elif trimmed_sql.startswith("DELETE"):
            # DELETE query
            cursor.execute(sql, native_params)
            rows_affected = conn.changes()
            return EastVariant("delete", EastStruct({"rowsAffected": rows_affected}))
        else:
            # Other queries (CREATE, DROP, etc.) - treat as update
            cursor.execute(sql, native_params)
            rows_affected = conn.changes()
            return EastVariant("update", EastStruct({"rowsAffected": rows_affected}))
    except Exception as e:
        raise Exception(f"SQLite query failed: {e}") from e


@platform_function(
    name="sqlite_close",
    inputs=[ConnectionHandleType],
    output=NullType,
)
async def sqlite_close_impl(handle: str) -> None:
    """Close a SQLite database connection.

    Args:
        handle: Connection handle

    Raises:
        NotImplementedError: If apsw is not installed
        Exception: If handle is invalid
    """
    _check_sqlite_support()

    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        conn = _connections[handle]
        conn.close()
        del _connections[handle]
    except Exception as e:
        raise Exception(f"SQLite close failed: {e}") from e


@platform_function(
    name="sqlite_close_all",
    inputs=[],
    output=NullType,
)
async def sqlite_close_all_impl() -> None:
    """Close all SQLite connections.

    Useful for test cleanup.
    """
    for conn in _connections.values():
        conn.close()
    _connections.clear()


def sqlite_select_factory(*args: Any) -> Any:
    """Factory for sqlite_select that captures the type parameter.

    Args:
        args: Type parameters - expects single row_type parameter

    Returns:
        Async implementation function for sqlite_select
    """
    if len(args) != 1:
        raise ValueError(f"sqlite_select_factory expects 1 type parameter, got {len(args)}: {args}")
    row_type = args[0]

    async def sqlite_select_impl(handle: str, sql: str, params: EastArray) -> EastArray:
        """Execute a SELECT query with typed results.

        Args:
            handle: Connection handle
            sql: SQL SELECT query string
            params: Query parameters

        Returns:
            Array of rows matching the type parameter T

        Raises:
            NotImplementedError: If apsw is not installed
            Exception: If query fails or types don't match
        """
        _check_sqlite_support()
        import apsw

        try:
            if handle not in _connections:
                raise Exception(f"Invalid connection handle: {handle}")

            conn = _connections[handle]

            # Convert East parameters to native values
            native_params = tuple(convert_param_to_native(p) for p in params)

            # Execute query and get description immediately (before consuming rows)
            # APSW requires getting description before the cursor completes
            cursor = conn.cursor()
            rows_iter = cursor.execute(sql, native_params)

            # Get description - may fail for empty results in APSW
            try:
                description = cursor.getdescription()
            except apsw.ExecutionCompleteError:
                # For empty results, APSW considers cursor complete
                # We'll get column info from row_type instead
                description = None

            # Validate row type T is a Struct
            if not is_struct_type(row_type):
                raise Exception(f"Expected row type must be a Struct, got {row_type.type}")

            # Get column metadata - APSW provides (name, decltype) tuples
            # For empty results where description is unavailable, use row_type fields
            if description:
                column_info = [(desc[0], desc[1]) for desc in description]
                column_names = {name for name, _ in column_info}
                column_type_map = dict(column_info)
            else:
                # Empty result - no column validation against SQLite metadata
                # Build column_info from row_type for consistency
                fields = row_type.value
                column_info = [(f["name"], None) for f in fields]
                column_names = {name for name, _ in column_info}
                column_type_map = {name: None for name, _ in column_info}

            # Validate field names and types
            fields = row_type.value
            field_info: dict[str, dict[str, Any]] = {}

            def get_east_type_name(t: Any) -> str:
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

            for field in fields:
                field_name = field["name"]
                field_type = field["type"]

                # Only validate column existence if we have description
                if description and field_name not in column_names:
                    raise Exception(f"Column '{field_name}' not found in query result")

                # Determine if this is an optional field and extract the inner type
                field_is_option = is_option_type(field_type)
                inner_type = get_option_inner_type(field_type) if field_is_option else field_type

                # Get the declared column type from SQLite
                col_type = column_type_map.get(field_name)

                # Only validate type compatibility if we have column type info
                if description and col_type is not None:
                    expected_east_type = _get_expected_east_type(col_type)
                    requested_type = get_east_type_name(inner_type)

                    # Check type compatibility
                    compatible = False
                    if expected_east_type == requested_type or expected_east_type == "Integer" and requested_type in ("Float", "Boolean") or expected_east_type == "Float" and requested_type == "Integer" or expected_east_type == "Boolean" and requested_type == "Integer":
                        compatible = True

                    if not compatible:
                        raise Exception(
                            f"Type mismatch for column '{field_name}': SQLite column is {col_type}, "
                            f"got {requested_type} but expected {expected_east_type} or OptionType({expected_east_type})"
                        )

                field_info[field_name] = {
                    "is_option": field_is_option,
                    "inner_type": inner_type,
                    "col_type": col_type,
                }

            # Fetch and convert rows (use the iterator we got from execute)
            raw_rows = list(rows_iter)
            rows: list[EastStruct] = []

            for row_idx, raw_row in enumerate(raw_rows):
                converted: dict[str, Any] = {}
                for (col_name, _col_type), value in zip(column_info, raw_row, strict=True):
                    info = field_info.get(col_name)
                    if info is None:
                        continue  # Column not in expected type

                    if value is None:
                        if info["is_option"]:
                            converted[col_name] = EastVariant("none", None)
                        else:
                            raise Exception(
                                f"null value at row[{row_idx}] for required field '{col_name}' - "
                                f"use OptionType for nullable columns"
                            )
                    else:
                        # Convert based on expected type from row_type
                        converted_value = _convert_value_for_type(
                            value, info["inner_type"], col_name, info["col_type"]
                        )

                        if info["is_option"]:
                            converted[col_name] = EastVariant("some", converted_value)
                        else:
                            converted[col_name] = converted_value

                rows.append(EastStruct(converted))

            return EastArray(row_type, rows)
        except Exception as e:
            raise Exception(f"SQLite select failed: {e}") from e

    return sqlite_select_impl


@generic_platform_function(
    name="sqlite_select",
    type_parameters=["T"],
    is_async=True,
)
def _sqlite_select_factory(_platform_list: Any, T: Any) -> Any:  # noqa: N803
    return sqlite_select_factory(T)


# Collected from the @platform_function / @generic_platform_function decorations above.
sqlite_impl = platform_functions(__name__)


__all__ = [
    "sqlite_impl",
    "SqliteConfigType",
    "ConnectionHandleType",
    "SqlParametersType",
    "SqlResultType",
    "SqlParameterType",
    "SqlRowType",
]
