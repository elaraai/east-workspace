# Design Document: Porting Microsoft Access Support and SQL Select Functions to east-py-io

**Source:** TypeScript commit `510531773b9cff644cd28a2918612fb53ed1614c` in `/home/crambelsoupy/src/east-node`
**Target:** Python package `east-py-io` at `/home/crambelsoupy/src/east-py/packages/east-py-io`

---

## 1. Overview

This document describes how to port the Microsoft Access database module and generic SQL select functions from the TypeScript `east-node-io` implementation to the Python `east-py-io` package.

### What Changed in TypeScript

| Component | Change | Port to Python? |
|-----------|--------|-----------------|
| `sql/access.ts` | New Access module with 6 platform functions | Yes |
| `sql/sqlite.ts` | Added `sqlite_select` generic platform function | Yes |
| `sql/postgres.ts` | Added `postgres_select` generic platform function | Yes |
| `sql/mysql.ts` | Added `mysql_select` generic platform function | Yes |
| `sql/types.ts` | Added Access-related type definitions | Yes |
| `sql/index.ts` | Added `SQL.Access` namespace and select exports | Yes |
| MySQL TEXT/BLOB handling | Fixed field type 252 handling | Check Python behavior |

### Benefits

- **Microsoft Access support**: Read-only access to `.mdb` and `.accdb` files (Access 97-2019)
- **Type-safe SELECT queries**: Generic `*_select` functions return user-defined row types instead of dynamic `SqlResultType`
- **Better type validation**: Validates column types match expected East types at runtime
- **Null safety**: Explicit error for null values in non-optional fields

---

## 2. New Access Module

### 2.1 Access Platform Functions

| Function | Description | Signature |
|----------|-------------|-----------|
| `access_open` | Open Access database file | `(config: AccessConfigType) -> String` |
| `access_open_blob` | Open Access database from binary data | `(config: AccessBlobConfigType) -> String` |
| `access_tables` | List all table names | `(handle: String) -> AccessTablesResultType` |
| `access_query` | Query table with typed results | `<T>(handle: String, options: AccessQueryOptionsType) -> Array<T>` |
| `access_close` | Close database connection | `(handle: String) -> Null` |
| `access_close_all` | Close all connections | `() -> Null` |

### 2.2 Access Type Definitions

Add to `east_py_io/sql/types.py`:

```python
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
```

### 2.3 Python Library Choice

TypeScript uses `mdb-reader` (npm package). For Python, we need an equivalent library.

**Options:**

1. **mdbtools** via `subprocess` - External dependency, requires system installation
2. **mdb-parser** (`pip install mdb-parser`) - Pure Python, may have limitations
3. **pypyodbc** with Access ODBC driver - Requires ODBC driver installation (Windows-specific)

**Recommended:** Use `mdb-parser` or `pypyodbc` with conditional import, similar to how TypeScript handles it.

**Note:** If `mdb-parser` or similar is unavailable/insufficient, implement a stub that raises `NotImplementedError` with instructions for manual installation.

### 2.4 Access Implementation (`east_py_io/sql/access.py`)

```python
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
"""

import uuid
from typing import Any

from east.runtime.platform import GenericPlatformFunction, PlatformFunction
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
)
from east.types.values import EastArray, EastStruct, EastVariant

from .types import (
    AccessConfigType,
    AccessBlobConfigType,
    AccessQueryOptionsType,
    AccessTablesResultType,
    ConnectionHandleType,
)

# Try to import mdb-parser or similar library
try:
    # Placeholder - actual import depends on chosen library
    from mdb_parser import MDBParser  # type: ignore
    _HAS_MDB_SUPPORT = True
except ImportError:
    _HAS_MDB_SUPPORT = False


# Connection storage
_access_connections: dict[str, Any] = {}


def _check_mdb_support() -> None:
    """Check if MDB support is available."""
    if not _HAS_MDB_SUPPORT:
        raise NotImplementedError(
            "Microsoft Access support requires mdb-parser. "
            "Install with: pip install mdb-parser"
        )


async def access_open(config: EastStruct) -> str:
    """Open a Microsoft Access database file."""
    _check_mdb_support()

    try:
        path = config["path"]
        password_opt = config["password"]
        password = password_opt.value if password_opt.type == "some" else None

        # Open the database
        # Implementation depends on chosen library
        reader = MDBParser(path, password=password)

        handle = str(uuid.uuid4())
        _access_connections[handle] = reader

        return handle
    except Exception as e:
        raise Exception(f"Access database open failed: {e}") from e


async def access_open_blob_impl(config: EastStruct) -> str:
    """Open a Microsoft Access database from binary data."""
    _check_mdb_support()

    try:
        data = config["data"]
        password_opt = config["password"]
        password = password_opt.value if password_opt.type == "some" else None

        # Convert to bytes if needed
        if isinstance(data, (bytes, bytearray)):
            buffer = bytes(data)
        else:
            buffer = bytes(data)

        # Open from bytes
        # Implementation depends on chosen library
        reader = MDBParser.from_bytes(buffer, password=password)

        handle = str(uuid.uuid4())
        _access_connections[handle] = reader

        return handle
    except Exception as e:
        raise Exception(f"Access database open from blob failed: {e}") from e


async def access_tables(handle: str) -> EastStruct:
    """List all table names in the database."""
    _check_mdb_support()

    try:
        if handle not in _access_connections:
            raise Exception(f"Invalid connection handle: {handle}")

        reader = _access_connections[handle]
        tables = reader.get_table_names()  # Implementation-specific

        return EastStruct({"tables": EastArray(StringType, tables)})
    except Exception as e:
        raise Exception(f"Access tables list failed: {e}") from e


def access_query_factory(T: Any) -> Any:
    """Factory for access_query that captures the type parameter."""

    async def access_query_impl(handle: str, options: EastStruct) -> EastArray:
        """Query data from an Access table with typed results."""
        _check_mdb_support()

        try:
            if handle not in _access_connections:
                raise Exception(f"Invalid connection handle: {handle}")

            reader = _access_connections[handle]

            table_name = options["table"]
            columns_opt = options["columns"]
            row_offset_opt = options["rowOffset"]
            row_limit_opt = options["rowLimit"]

            columns = list(columns_opt.value) if columns_opt.type == "some" else None
            row_offset = int(row_offset_opt.value) if row_offset_opt.type == "some" else None
            row_limit = int(row_limit_opt.value) if row_limit_opt.type == "some" else None

            # Get table data
            # Implementation depends on chosen library
            raw_data = reader.get_table_data(
                table_name,
                columns=columns,
                offset=row_offset,
                limit=row_limit
            )

            # Validate and convert rows based on type T
            # Type T is an EastTypeValue (IR format)
            rows = _convert_access_rows(raw_data, T, table_name, reader)

            return EastArray(T, rows)
        except Exception as e:
            raise Exception(f"Access query failed: {e}") from e

    return access_query_impl


def _convert_access_rows(raw_data: list, row_type: Any, table_name: str, reader: Any) -> list:
    """Convert raw Access rows to typed East values.

    Validates column types match expected East types and handles null values.
    """
    # Get column metadata for type validation
    column_meta = reader.get_column_metadata(table_name)  # Implementation-specific

    # Validate row type is a Struct
    if row_type.get("type") != "Struct":
        raise Exception(f"Expected row type must be a Struct, got {row_type.get('type')}")

    # Map Access types to East types
    access_to_east = {
        "boolean": BooleanType,
        "byte": IntegerType,
        "integer": IntegerType,
        "long": IntegerType,
        "bigint": IntegerType,
        "float": FloatType,
        "double": FloatType,
        "text": StringType,
        "memo": StringType,
        "datetime": DateTimeType,
        "binary": BlobType,
        "ole": BlobType,
    }

    # Validate field types
    fields = row_type.get("value", [])
    for field in fields:
        field_name = field["name"]
        field_type = field["type"]

        col_meta = column_meta.get(field_name)
        if col_meta is None:
            raise Exception(f"Column '{field_name}' not found in table '{table_name}'")

        # Determine expected East type
        access_type = col_meta["type"].lower()
        expected_base = access_to_east.get(access_type)
        if expected_base is None:
            raise Exception(f"Unsupported Access column type '{access_type}' for column '{field_name}'")

        # Type validation logic - check base type or OptionType
        # (Implementation similar to TypeScript version)

    # Convert rows
    rows = []
    for raw_row in raw_data:
        converted = _convert_single_row(raw_row, fields, column_meta)
        rows.append(EastStruct(converted))

    return rows


def _convert_single_row(raw_row: dict, fields: list, column_meta: dict) -> dict:
    """Convert a single raw Access row to typed values."""
    converted = {}

    for field in fields:
        field_name = field["name"]
        value = raw_row.get(field_name)
        col_meta = column_meta.get(field_name, {})
        is_nullable = col_meta.get("nullable", True)

        if value is None:
            if is_nullable:
                converted[field_name] = EastVariant("none", None)
            else:
                raise Exception(f"Null value in non-nullable column '{field_name}'")
        else:
            # Convert based on Access type
            access_type = col_meta.get("type", "").lower()
            converted_value = _convert_access_value(value, access_type)

            if is_nullable:
                converted[field_name] = EastVariant("some", converted_value)
            else:
                converted[field_name] = converted_value

    return converted


def _convert_access_value(value: Any, access_type: str) -> Any:
    """Convert an Access value to the appropriate East value."""
    if access_type in ("byte", "integer", "long", "bigint"):
        return int(value)
    elif access_type in ("float", "double"):
        return float(value)
    elif access_type == "boolean":
        return bool(value)
    elif access_type in ("binary", "ole"):
        return bytes(value) if value else b""
    else:
        return value


async def access_close(handle: str) -> None:
    """Close an Access database connection."""
    try:
        if handle not in _access_connections:
            raise Exception(f"Invalid connection handle: {handle}")

        # mdb-parser doesn't need explicit close, just remove reference
        del _access_connections[handle]
    except Exception as e:
        raise Exception(f"Access close failed: {e}") from e


async def access_close_all() -> None:
    """Close all Access connections."""
    _access_connections.clear()


# Platform function implementations
access_impl = [
    PlatformFunction(
        name="access_open",
        inputs=[AccessConfigType],
        output=ConnectionHandleType,
        type="async",
        fn=access_open,
    ),
    PlatformFunction(
        name="access_open_blob",
        inputs=[AccessBlobConfigType],
        output=ConnectionHandleType,
        type="async",
        fn=access_open_blob_impl,
    ),
    PlatformFunction(
        name="access_tables",
        inputs=[ConnectionHandleType],
        output=AccessTablesResultType,
        type="async",
        fn=access_tables,
    ),
    GenericPlatformFunction(
        name="access_query",
        type_parameters=["T"],
        type="async",
        fn=lambda _platform_list, T: access_query_factory,

    ),
    PlatformFunction(
        name="access_close",
        inputs=[ConnectionHandleType],
        output=NullType,
        type="async",
        fn=access_close,
    ),
    PlatformFunction(
        name="access_close_all",
        inputs=[],
        output=NullType,
        type="async",
        fn=access_close_all,
    ),
]

__all__ = [
    "access_impl",
    "AccessConfigType",
    "AccessBlobConfigType",
    "AccessQueryOptionsType",
    "AccessTablesResultType",
]
```

---

## 3. Generic Select Functions

### 3.1 Overview

The TypeScript commit adds generic `*_select` functions to SQLite, PostgreSQL, and MySQL that return typed rows instead of dynamic `SqlResultType`. This enables:

- Type-safe access to query results
- Compile-time validation of expected column types
- Better null handling (error on null in non-optional fields)

### 3.2 Function Signatures

| Function | Signature |
|----------|-----------|
| `sqlite_select` | `<T>(handle: String, sql: String, params: Array<SqlParam>) -> Array<T>` |
| `postgres_select` | `<T>(handle: String, sql: String, params: Array<SqlParam>) -> Array<T>` |
| `mysql_select` | `<T>(handle: String, sql: String, params: Array<SqlParam>) -> Array<T>` |

### 3.3 SQLite Select Implementation

Add to `east_py_io/sql/sqlite.py`:

```python
from east.runtime.platform import GenericPlatformFunction
from east.types.values import EastArray, EastStruct, EastVariant


def sqlite_select_factory(T: Any) -> Any:
    """Factory for sqlite_select that captures the type parameter T."""

    async def sqlite_select_impl(handle: str, sql: str, params: EastArray) -> EastArray:
        """Execute a SELECT query with typed results."""
        try:
            if handle not in _connections:
                raise Exception(f"Invalid connection handle: {handle}")

            conn = _connections[handle]

            # Convert East parameters to native values
            native_params = [convert_param_to_native(p) for p in params]

            # Execute query
            cursor = conn.cursor()
            cursor.execute(sql, native_params)

            # Verify this is a SELECT query
            if not cursor.description:
                raise Exception(
                    "sqlite_select only supports SELECT queries. "
                    "Use sqlite_query for INSERT/UPDATE/DELETE."
                )

            # Get column metadata
            column_info = [(desc[0], desc[1]) for desc in cursor.description]

            # Validate row type T is a Struct
            if T.get("type") != "Struct":
                raise Exception(f"Expected row type must be a Struct, got {T.get('type')}")

            # Validate field types match columns
            fields = T.get("value", [])
            field_info = _validate_fields(fields, column_info)

            # Fetch and convert rows
            raw_rows = cursor.fetchall()
            rows = []

            for row_idx, raw_row in enumerate(raw_rows):
                converted = {}
                for (col_name, col_type), value in zip(column_info, raw_row, strict=True):
                    info = field_info.get(col_name)
                    if info is None:
                        continue  # Column not in expected type

                    if value is None:
                        if info["is_option"]:
                            converted[col_name] = EastVariant("none", None)
                        else:
                            raise Exception(
                                f"null value at row[{row_idx}] for required field '{col_name}' - "
                                f"use OptionType({info['base_type']}) for nullable columns"
                            )
                    else:
                        # Convert based on column type
                        converted_value = _convert_sqlite_value(value, col_type)

                        if info["is_option"]:
                            converted[col_name] = EastVariant("some", converted_value)
                        else:
                            converted[col_name] = converted_value

                rows.append(EastStruct(converted))

            return EastArray(T, rows)
        except Exception as e:
            raise Exception(f"SQLite select failed: {e}") from e

    return sqlite_select_impl


def _validate_fields(fields: list, column_info: list) -> dict:
    """Validate field types match column types.

    Returns a dict mapping column names to field info.
    """
    column_types = {name: col_type for name, col_type in column_info}
    field_info = {}

    for field in fields:
        field_name = field["name"]
        field_type = field["type"]

        if field_name not in column_types:
            raise Exception(f"Column '{field_name}' not found in query result")

        col_type = column_types[field_name]

        # Determine expected East type from SQLite column type
        base_type, type_name = _get_expected_type(col_type)

        # Check if field type matches base type or OptionType(base type)
        is_option = _is_option_type(field_type, base_type)
        is_base = _is_matching_type(field_type, base_type)

        if not is_base and not is_option:
            raise Exception(
                f"Type mismatch for column '{field_name}': SQLite column is {col_type}, "
                f"expected {type_name} or OptionType({type_name})"
            )

        field_info[field_name] = {
            "is_option": is_option,
            "base_type": type_name,
        }

    return field_info


def _get_expected_type(col_type: str | None) -> tuple[str, str]:
    """Get expected East type from SQLite column type."""
    if col_type is None:
        return "Float", "Float"  # Default for literals

    col_upper = col_type.upper()

    integer_types = {
        "INTEGER", "INT", "TINYINT", "SMALLINT", "MEDIUMINT",
        "BIGINT", "UNSIGNED BIG INT", "INT2", "INT8"
    }
    float_types = {
        "REAL", "DOUBLE", "DOUBLE PRECISION", "FLOAT", "NUMERIC", "DECIMAL"
    }
    text_types = {
        "TEXT", "CHARACTER", "VARCHAR", "VARYING CHARACTER",
        "NCHAR", "NATIVE CHARACTER", "NVARCHAR", "CLOB", "DATE"
    }

    if col_upper in integer_types:
        return "Integer", "Integer"
    elif col_upper in float_types:
        return "Float", "Float"
    elif col_upper in text_types:
        return "String", "String"
    elif col_upper == "DATETIME":
        return "DateTime", "DateTime"
    elif col_upper == "BLOB":
        return "Blob", "Blob"
    elif col_upper == "BOOLEAN":
        return "Boolean", "Boolean"
    else:
        return "Float", "Float"  # Unknown - default to Float


def _is_option_type(field_type: dict, base_type: str) -> bool:
    """Check if field_type is OptionType(base_type)."""
    if field_type.get("type") != "Option":
        return False
    inner = field_type.get("value")
    return inner is not None and inner.get("type") == base_type


def _is_matching_type(field_type: dict, base_type: str) -> bool:
    """Check if field_type matches base_type."""
    return field_type.get("type") == base_type


def _convert_sqlite_value(value: Any, col_type: str | None) -> Any:
    """Convert SQLite value to East value."""
    if col_type is None:
        return value

    col_upper = col_type.upper()

    integer_types = {
        "INTEGER", "INT", "TINYINT", "SMALLINT", "MEDIUMINT",
        "BIGINT", "UNSIGNED BIG INT", "INT2", "INT8"
    }

    if col_upper in integer_types:
        return int(value)
    elif col_upper == "DATETIME":
        from datetime import datetime
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value
    elif col_upper == "BLOB" and isinstance(value, bytes):
        return value
    else:
        return value


# Add to sqlite_impl list:
# GenericPlatformFunction(
#     name="sqlite_select",
#     type_parameters=["T"],
#     type="async",
#     fn=sqlite_select_factory,
# ),
```

### 3.4 PostgreSQL and MySQL Select

Similar implementations for `postgres_select` and `mysql_select` following the same pattern, with database-specific type mapping.

---

## 4. Type Mapping Tables

### 4.1 Access Type Mapping

| Access Type | East Type | Python Type |
|------------|-----------|-------------|
| boolean | BooleanType | bool |
| byte, integer, long, bigint | IntegerType | int |
| float, double | FloatType | float |
| text, memo, currency, numeric, repid | StringType | str |
| datetime, datetimeextended | DateTimeType | datetime |
| binary, ole | BlobType | bytes |

### 4.2 SQLite Type Mapping

| SQLite Type | East Type | Python Type |
|------------|-----------|-------------|
| INTEGER, INT, TINYINT, SMALLINT, MEDIUMINT, BIGINT | IntegerType | int |
| REAL, DOUBLE, FLOAT, NUMERIC, DECIMAL | FloatType | float |
| TEXT, VARCHAR, NCHAR, etc. | StringType | str |
| DATETIME | DateTimeType | datetime |
| BLOB | BlobType | bytes |
| BOOLEAN | BooleanType | bool |

### 4.3 PostgreSQL Type Mapping

| PostgreSQL OID | East Type | Python Type |
|---------------|-----------|-------------|
| 16 (bool) | BooleanType | bool |
| 20, 21, 23 (bigint, smallint, integer) | IntegerType | int |
| 700, 701, 1700 (float4, float8, numeric) | FloatType | float |
| 25, 1042, 1043 (text, char, varchar) | StringType | str |
| 1114, 1184 (timestamp, timestamptz) | DateTimeType | datetime |
| 17 (bytea) | BlobType | bytes |

### 4.4 MySQL Type Mapping

| MySQL Field Type | East Type | Python Type |
|-----------------|-----------|-------------|
| 1 (TINYINT), 2, 3, 8, 9 | IntegerType | int |
| 4, 5, 246 (FLOAT, DOUBLE, DECIMAL) | FloatType | float |
| 15, 253, 254 (VARCHAR, STRING, CHAR) | StringType | str |
| 252 (TEXT/BLOB) | StringType or BlobType | str or bytes |
| 7, 10, 11, 12 (TIMESTAMP, DATE, TIME, DATETIME) | DateTimeType | datetime |
| 16 (BIT) | BooleanType | bool |

---

## 5. Implementation Tasks

### 5.1 Phase 1: Type Definitions

- [ ] Add `AccessConfigType` to `east_py_io/sql/types.py`
- [ ] Add `AccessBlobConfigType` to `east_py_io/sql/types.py`
- [ ] Add `AccessQueryOptionsType` to `east_py_io/sql/types.py`
- [ ] Add `AccessTablesResultType` to `east_py_io/sql/types.py`
- [ ] Update `__all__` in `types.py`

### 5.2 Phase 2: Access Module

- [ ] Create `east_py_io/sql/access.py`
- [ ] Implement `access_open`
- [ ] Implement `access_open_blob_impl`
- [ ] Implement `access_tables`
- [ ] Implement `access_query_factory` (GenericPlatformFunction)
- [ ] Implement `access_close`
- [ ] Implement `access_close_all`
- [ ] Add `access_impl` to module exports
- [ ] Update `east_py_io/sql/__init__.py`

### 5.3 Phase 3: Generic Select Functions

- [ ] Add `sqlite_select_factory` to `sqlite.py`
- [ ] Add `GenericPlatformFunction` to `sqlite_impl`
- [ ] Add `postgres_select_factory` to `postgres.py`
- [ ] Add `GenericPlatformFunction` to `postgres_impl`
- [ ] Add `mysql_select_factory` to `mysql.py`
- [ ] Add `GenericPlatformFunction` to `mysql_impl`

### 5.4 Phase 4: Package Integration

- [ ] Update `east_py_io/__init__.py` to export Access module
- [ ] Add `mdb-parser` or equivalent to `pyproject.toml` (optional dependency)
- [ ] Update README.md with Access documentation

### 5.5 Phase 5: Testing

- [ ] Add Access compliance tests (requires test database)
- [ ] Add sqlite_select tests
- [ ] Add postgres_select tests
- [ ] Add mysql_select tests
- [ ] Verify type validation error messages

---

## 6. Dependencies

### 6.1 Required Python Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `mdb-parser` | >= 0.1.0 | Microsoft Access database reading |

**Note:** `mdb-parser` may need to be an optional dependency since Access support is specialized. Consider using:

```toml
[project.optional-dependencies]
access = ["mdb-parser>=0.1.0"]
```

### 6.2 Alternative: mdbtools

If `mdb-parser` is insufficient, consider using `mdbtools` via subprocess:

```python
import subprocess
import json

def read_mdb_table(path: str, table: str) -> list[dict]:
    """Read Access table using mdbtools."""
    result = subprocess.run(
        ["mdb-json", path, table],
        capture_output=True,
        text=True,
        check=True
    )
    return json.loads(result.stdout)
```

This requires system installation of `mdbtools` but is more reliable for complex databases.

---

## 7. Backwards Compatibility

### 7.1 Existing Functions Unchanged

- `sqlite_connect`, `sqlite_query`, `sqlite_close` - unchanged
- `postgres_connect`, `postgres_query`, `postgres_close` - unchanged
- `mysql_connect`, `mysql_query`, `mysql_close` - unchanged

### 7.2 New Functions Are Additive

All new functions (`*_select`, `access_*`) are additive and don't affect existing behavior.

---

## 8. Validation Checklist

- [ ] Access platform functions work with test `.mdb` files
- [ ] Access type validation rejects mismatched types
- [ ] Access null handling works correctly with OptionType
- [ ] `sqlite_select` returns correctly typed rows
- [ ] `postgres_select` returns correctly typed rows
- [ ] `mysql_select` returns correctly typed rows
- [ ] Select functions throw on null in non-optional fields
- [ ] Compliance tests pass against TypeScript implementation
- [ ] Error messages match TypeScript behavior

---

## 9. TypeScript Reference Files

For implementation reference, see:

- `packages/east-node-io/src/sql/access.ts` - Access implementation
- `packages/east-node-io/src/sql/access.spec.ts` - Access tests
- `packages/east-node-io/src/sql/sqlite.ts:sqlite_select` - SQLite select implementation
- `packages/east-node-io/src/sql/postgres.ts:postgres_select` - PostgreSQL select implementation
- `packages/east-node-io/src/sql/mysql.ts:mysql_select` - MySQL select implementation
- `packages/east-node-io/src/sql/types.ts` - Type definitions
