#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Microsoft Access platform functions for East.

Provides read-only Access database operations for East programs, including
opening databases, listing tables, and querying table data with user-defined
return types.

Supported formats:
- .mdb - Access 97, 2000, 2002/2003
- .accdb - Access 2007, 2010, 2013, 2016, 2019

Note: Requires access-parser package. Install with: pip install access-parser
or pip install east-py-io[access]
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
from east.types.values import EastArray, EastStruct, EastVariant

from .types import (
    AccessConfigType,
    AccessTablesResultType,
    ConnectionHandleType,
)

_HAS_ACCESS_SUPPORT = importlib.util.find_spec("access_parser") is not None

# Access type constants (defined locally for use in _ACCESS_TYPE_MAP)
TYPE_BOOLEAN = 1
TYPE_INT8 = 2
TYPE_INT16 = 3
TYPE_INT32 = 4
TYPE_MONEY = 5
TYPE_FLOAT32 = 6
TYPE_FLOAT64 = 7
TYPE_DATETIME = 8
TYPE_BINARY = 9
TYPE_TEXT = 10
TYPE_OLE = 11
TYPE_MEMO = 12
TYPE_GUID = 15


# Connection storage (maps handle -> AccessParser instance)
_access_connections: dict[str, Any] = {}


def _check_access_support() -> None:
    """Check if Access support is available."""
    if not _HAS_ACCESS_SUPPORT:
        raise NotImplementedError(
            "Access support requires the 'access' extra. "
            "Add east-py-io[access] to your pyproject.toml dependencies."
        )


# Access type constant to East type mapping
_ACCESS_TYPE_MAP: dict[int, str] = {
    TYPE_BOOLEAN: "Boolean",
    TYPE_INT8: "Integer",
    TYPE_INT16: "Integer",
    TYPE_INT32: "Integer",
    TYPE_MONEY: "String",  # Money formatted as string
    TYPE_FLOAT32: "Float",
    TYPE_FLOAT64: "Float",
    TYPE_DATETIME: "DateTime",
    TYPE_BINARY: "Blob",
    TYPE_TEXT: "String",
    TYPE_OLE: "Blob",
    TYPE_MEMO: "String",
    TYPE_GUID: "String",
}


def _get_east_type_for_access(access_type: int) -> str:
    """Get East type name for Access column type constant."""
    return _ACCESS_TYPE_MAP.get(access_type, "String")


def _convert_access_value(value: Any, access_type: int) -> Any:
    """Convert an Access value to the appropriate East value."""
    if value is None:
        return None

    if access_type in (TYPE_INT8, TYPE_INT16, TYPE_INT32):
        return int(value)
    elif access_type in (TYPE_FLOAT32, TYPE_FLOAT64):
        return float(value)
    elif access_type == TYPE_BOOLEAN:
        return bool(value)
    elif access_type in (TYPE_BINARY, TYPE_OLE):
        if isinstance(value, (bytes, bytearray)):
            from east.types.values import EastBlob

            return EastBlob(bytes(value))
        return value
    elif access_type == TYPE_DATETIME:
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                return None
        if isinstance(value, datetime):
            # Ensure UTC timezone and truncate to milliseconds
            value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
            ms = (value.microsecond // 1000) * 1000
            return value.replace(microsecond=ms)
        return value
    else:
        # String types - ensure string conversion
        return str(value) if value is not None else value


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


@platform_function(
    name="access_open",
    inputs=[AccessConfigType],
    output=ConnectionHandleType,
)
async def access_open_impl(config: EastStruct) -> str:
    """Open a Microsoft Access database file and return a connection handle.

    Supports ``.mdb`` (Access 97/2000/2002/2003) and ``.accdb``
    (Access 2007 and later) formats via access-parser.  Password-protected
    databases are not yet supported by access-parser.

    Args:
        config: ``AccessConfigType`` (``EastStruct``) with fields:

            - ``path`` (``String``): file-system path to the ``.mdb`` or
              ``.accdb`` file.
            - ``password`` (``Option<String>``): database password (reserved -
              not forwarded to access-parser).

    Returns:
        ``String`` - opaque connection handle, passed to
        ``access_tables_impl`` / ``access_query_factory`` /
        ``access_close_impl``.

    Raises:
        NotImplementedError: the ``access`` extra (access-parser) is not
            installed.
        Exception: access-parser fails to open the file (bad path,
            unsupported format, corrupt database).
    """
    _check_access_support()
    from access_parser import AccessParser  # type: ignore[import-untyped]

    try:
        path = config["path"]
        # Note: access-parser doesn't support password-protected databases yet
        # password_opt = config["password"]
        # password = password_opt.value if password_opt.type == "some" else None

        # Open the database
        reader = AccessParser(path)

        handle = str(uuid.uuid4())
        _access_connections[handle] = reader

        return handle
    except Exception as e:
        raise Exception(f"Access database open failed: {e}") from e


@platform_function(
    name="access_tables",
    inputs=[ConnectionHandleType],
    output=AccessTablesResultType,
)
async def access_tables_impl(handle: str) -> EastStruct:
    """List the names of all user tables in the database.

    Args:
        handle: ``String`` - connection handle from ``access_open_impl``.

    Returns:
        ``AccessTablesResultType`` (``EastStruct``): ``{tables:
        Array<String>}`` - table names in catalog order.

    Raises:
        NotImplementedError: the ``access`` extra (access-parser) is not
            installed.
        Exception: the handle is unknown, or access-parser fails to read the
            catalog.
    """
    _check_access_support()

    try:
        if handle not in _access_connections:
            raise Exception(f"Invalid connection handle: {handle}")

        reader = _access_connections[handle]
        # access-parser's catalog is a dict mapping table names to offsets
        tables = list(reader.catalog.keys())

        return EastStruct({"tables": EastArray(StringType, tables)})
    except Exception as e:
        raise Exception(f"Access tables list failed: {e}") from e


def access_query_factory(row_type: Any) -> Any:
    """Return a typed ``access_query`` implementation for a given row struct type.

    Called by the ``@generic_platform_function`` decorator with the resolved
    ``T`` type argument.  The returned coroutine validates Access column types
    against ``T`` using ``_ACCESS_TYPE_MAP`` before converting each row.
    Corrupt memo/overflow records are silently skipped via ``_safe_parse_row``.

    Args:
        row_type: East ``StructType`` describing one result row.

    Returns:
        Async callable ``(handle, options) -> EastArray(T)`` implementing
        ``access_query<T>``.
    """

    async def access_query_impl(handle: str, options: EastStruct) -> EastArray:
        """Query an Access table and return rows typed as ``Array<T>``.

        Validates Access column type codes against ``T`` and applies
        ``rowOffset`` / ``rowLimit`` slicing.  Nullable columns must be
        declared as ``Option<...>`` in ``T``.

        Args:
            handle: ``String`` - connection handle from
                ``access_open_impl``.
            options: ``AccessQueryOptionsType`` (``EastStruct``) with
                fields:

                - ``table`` (``String``): table name.
                - ``columns`` (``Option<Array<String>>``): restrict to these
                  columns (default: all).
                - ``rowOffset`` (``Option<Integer>``): skip this many rows
                  (default 0).
                - ``rowLimit`` (``Option<Integer>``): maximum rows to return
                  (default: all remaining).

        Returns:
            ``Array<T>`` (``EastArray``) - one ``EastStruct`` per result row,
            fields coerced to the types declared in ``T``.

        Raises:
            NotImplementedError: the ``access`` extra (access-parser) is not
                installed.
            Exception: the handle is unknown, the table is not found,
                ``T`` is not a ``StructType``, a required column is missing,
                a column type is incompatible with the corresponding ``T``
                field, or a non-optional field contains ``NULL`` or an
                unparseable value.
        """
        _check_access_support()

        try:
            if handle not in _access_connections:
                raise Exception(f"Invalid connection handle: {handle}")

            reader = _access_connections[handle]

            table_name = options["table"]
            row_offset_opt = options["rowOffset"]
            row_limit_opt = options["rowLimit"]

            row_offset = int(row_offset_opt.value) if row_offset_opt.type == "some" else None
            row_limit = int(row_limit_opt.value) if row_limit_opt.type == "some" else None

            # Get table
            table = reader.get_table(table_name)

            # Validate row type is a Struct
            if not is_struct_type(row_type):
                raise Exception(f"Expected row type must be a Struct, got {row_type.type}")

            fields = row_type.value

            # Get column metadata from table.columns (dict indexed by position)
            # Each column object has: col_name_str (name), type (int constant)
            col_meta: dict[str, Any] = {}
            for col in table.columns.values():
                col_meta[col.col_name_str] = col

            # Validate field types match columns
            field_info: dict[str, dict[str, Any]] = {}
            for field in fields:
                field_name = field["name"]
                field_type = field["type"]

                if field_name not in col_meta:
                    raise Exception(f"Column '{field_name}' not found in table '{table_name}'")

                col = col_meta[field_name]
                access_type = col.type if hasattr(col, "type") else TYPE_TEXT
                expected_east = _get_east_type_for_access(access_type)

                # Check if field type matches expected type or OptionType(expected)
                field_is_option, compatible = _check_type_compatibility(field_type, expected_east)

                if not compatible:
                    raise Exception(
                        f"Type mismatch for column '{field_name}': Access column type is {access_type}, "
                        f"expected {expected_east} or OptionType({expected_east})"
                    )

                field_info[field_name] = {
                    "is_option": field_is_option,
                    "access_type": access_type,
                }

            # Parse table data - returns defaultdict(list) where data[column][row_index]
            # Wrap _parse_row to gracefully handle corrupt memo/overflow records
            # in access-parser (e.g. _parse_memo crashes on None overflow data)
            import contextlib
            original_parse_row = table._parse_row
            def _safe_parse_row(record):
                with contextlib.suppress(Exception):
                    original_parse_row(record)
            table._parse_row = _safe_parse_row
            parsed_data = table.parse()

            # Get the number of rows by checking any column's length
            if not parsed_data:
                return EastArray(row_type, [])

            # Get first column to determine row count
            first_col_data: list = next(iter(parsed_data.values()), [])
            total_rows = len(first_col_data)

            # Apply offset
            start_idx = row_offset if row_offset is not None and row_offset > 0 else 0

            # Apply limit
            end_idx = total_rows
            if row_limit is not None and row_limit >= 0:
                end_idx = min(start_idx + row_limit, total_rows)

            # Convert rows
            rows: list[EastStruct] = []
            for row_idx in range(start_idx, end_idx):
                converted: dict[str, Any] = {}

                for field in fields:
                    field_name = field["name"]
                    info = field_info[field_name]

                    # Get value from parsed data
                    col_data = parsed_data.get(field_name, [])
                    value = col_data[row_idx] if row_idx < len(col_data) else None

                    if value is None:
                        if info["is_option"]:
                            converted[field_name] = EastVariant("none", None)
                        else:
                            raise Exception(
                                f"null value at row[{row_idx}] for required field '{field_name}' - "
                                f"use OptionType for nullable columns"
                            )
                    else:
                        # Convert value based on Access type
                        converted_value = _convert_access_value(value, info["access_type"])

                        if converted_value is None:
                            # Conversion produced None (e.g. unparseable date string)
                            if info["is_option"]:
                                converted[field_name] = EastVariant("none", None)
                            else:
                                raise Exception(
                                    f"invalid value at row[{row_idx}] for required field '{field_name}': {value!r}"
                                )
                        elif info["is_option"]:
                            converted[field_name] = EastVariant("some", converted_value)
                        else:
                            converted[field_name] = converted_value

                rows.append(EastStruct(converted))

            return EastArray(row_type, rows)
        except Exception as e:
            raise Exception(f"Access query failed: {e}") from e

    return access_query_impl


@generic_platform_function(
    name="access_query",
    type_parameters=["T"],
    is_async=True,
)
def _access_query_factory(_platform_list: Any, T: Any) -> Any:  # noqa: N803
    return access_query_factory(T)


@platform_function(
    name="access_close",
    inputs=[ConnectionHandleType],
    output=NullType,
)
async def access_close_impl(handle: str) -> None:
    """Release an Access database connection handle.

    access-parser does not require an explicit close call; this removes the
    internal reference so the parser object can be garbage-collected.

    Args:
        handle: ``String`` - connection handle from ``access_open_impl``.

    Raises:
        Exception: the handle is unknown.
    """
    try:
        if handle not in _access_connections:
            raise Exception(f"Invalid connection handle: {handle}")

        # access-parser doesn't need explicit close, just remove reference
        del _access_connections[handle]
    except Exception as e:
        raise Exception(f"Access close failed: {e}") from e


@platform_function(
    name="access_close_all",
    inputs=[],
    output=NullType,
)
async def access_close_all_impl() -> None:
    """Release every open Access connection handle managed by this process.

    Clears the internal connection map; useful for test teardown.
    """
    _access_connections.clear()


# Collected from the @platform_function / @generic_platform_function decorations above.
access_impl = platform_functions(__name__)

__all__ = [
    "access_impl",
    "access_open_impl",
    "access_tables_impl",
    "access_query_factory",
    "access_close_impl",
    "access_close_all_impl",
]
