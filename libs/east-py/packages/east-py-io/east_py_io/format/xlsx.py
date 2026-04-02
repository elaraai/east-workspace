#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""XLSX platform functions for East.

Provides Excel file reading and writing for East programs.
"""

import importlib.util
import io
from datetime import UTC, datetime
from typing import Any

from east.runtime.platform import PlatformFunction
from east.types.types import BlobType
from east.types.values import EastArray, EastBlob, EastStruct, EastVariant, east_null

_HAS_XLSX_SUPPORT = importlib.util.find_spec("openpyxl") is not None


def _check_xlsx_support() -> None:
    """Check if XLSX support is available."""
    if not _HAS_XLSX_SUPPORT:
        raise NotImplementedError(
            "XLSX support requires the 'xlsx' extra. "
            "Add east-py-io[xlsx] to your pyproject.toml dependencies."
        )

from .types import (
    LiteralValueType,
    XlsxInfoType,
    XlsxReadOptionsType,
    XlsxRowType,
    XlsxSheetInfoType,
    XlsxSheetType,
    XlsxWriteOptionsType,
)


def convert_cell_to_east(value: Any, data_type: str | None = None) -> EastVariant:
    """Convert an Excel cell value to East LiteralValueType variant.

    Note: Excel stores all numbers as floats internally, so we return Float
    for all numeric values to match TypeScript behavior.

    Args:
        value: The cell value
        data_type: The cell's data_type attribute ('s', 'inlineStr', 'n', etc.)
    """
    if value is None:
        # Check data_type to detect empty strings (stored as inlineStr or 's')
        if data_type in ("s", "inlineStr"):
            return EastVariant("String", "")
        return EastVariant("Null", east_null)
    elif isinstance(value, bool):
        return EastVariant("Boolean", value)
    elif isinstance(value, int):
        # Excel stores all numbers as floats, return Float to match TypeScript
        return EastVariant("Float", float(value))
    elif isinstance(value, float):
        return EastVariant("Float", value)
    elif isinstance(value, datetime):
        # Ensure UTC timezone and truncate to milliseconds to match TypeScript behavior
        value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        # Truncate microseconds to milliseconds (keep first 3 digits of microseconds)
        ms = (value.microsecond // 1000) * 1000
        value = value.replace(microsecond=ms)
        return EastVariant("DateTime", value)
    elif isinstance(value, str):
        # Preserve empty strings as String, not Null
        return EastVariant("String", value)
    else:
        return EastVariant("String", str(value))


def convert_east_to_cell(value: EastVariant) -> Any:
    """Convert East LiteralValueType variant to Excel cell value."""
    tag = value.type
    val = value.value

    if tag == "Null":
        return None
    elif tag == "Boolean":
        return val
    elif tag == "Integer":
        return int(val) if val is not None else 0
    elif tag == "DateTime":
        # Excel doesn't support timezones - strip timezone info
        if val is not None and hasattr(val, "tzinfo") and val.tzinfo is not None:
            return val.replace(tzinfo=None)
        return val
    elif tag == "Blob":
        return val.hex() if hasattr(val, "hex") else str(val)
    else:
        return val


def xlsx_read_impl(blob: EastBlob, options: EastStruct) -> EastArray:
    """Read an XLSX file."""
    _check_xlsx_support()
    from openpyxl import load_workbook

    try:
        # Get options
        sheet_name_opt = options["sheetName"]
        sheet_name = sheet_name_opt.value if sheet_name_opt.type == "some" else None

        # Load workbook - need read_only=False to get cell data_type for empty strings
        wb = load_workbook(filename=io.BytesIO(bytes(blob)), read_only=False, data_only=True)

        # Get sheet
        try:
            ws = wb[sheet_name] if sheet_name else wb.active
        except KeyError:
            wb.close()
            raise Exception(f'Sheet "{sheet_name}" not found in workbook') from None

        if ws is None:
            wb.close()
            return EastArray(XlsxRowType, [])

        # Read data - pass cell.data_type to detect empty strings
        result: EastArray = EastArray(XlsxRowType, [])
        for row in ws.iter_rows():
            row_data: EastArray = EastArray(
                LiteralValueType, [convert_cell_to_east(cell.value, cell.data_type) for cell in row]
            )
            result.append(row_data)

        wb.close()
        return result
    except Exception as e:
        if "not found in workbook" in str(e):
            raise  # Don't wrap our custom error
        raise Exception(f"XLSX read failed: {e}") from e


def xlsx_write_impl(data: EastArray, options: EastStruct) -> EastBlob:
    """Write data to an XLSX file."""
    _check_xlsx_support()
    from openpyxl import Workbook

    try:
        # Get options
        sheet_name_opt = options["sheetName"]
        sheet_name = sheet_name_opt.value if sheet_name_opt.type == "some" else "Sheet1"

        # Create workbook
        wb = Workbook()
        ws = wb.active
        if ws is None:
            ws = wb.create_sheet()
        ws.title = sheet_name

        # Write data
        for row_idx, row in enumerate(data, start=1):
            for col_idx, cell in enumerate(row, start=1):
                ws.cell(row=row_idx, column=col_idx, value=convert_east_to_cell(cell))

        # Save to bytes
        output = io.BytesIO()
        wb.save(output)
        wb.close()

        return EastBlob(output.getvalue())
    except Exception as e:
        raise Exception(f"XLSX write failed: {e}") from e


def xlsx_info_impl(blob: EastBlob) -> EastStruct:
    """Get information about an XLSX file."""
    _check_xlsx_support()
    from openpyxl import load_workbook

    try:
        wb = load_workbook(filename=io.BytesIO(bytes(blob)), read_only=True)

        sheets: EastArray = EastArray(XlsxSheetInfoType, [])
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            sheets.append(
                EastStruct(
                    {
                        "name": sheet_name,
                        "rowCount": ws.max_row or 0,
                        "columnCount": ws.max_column or 0,
                    }
                )
            )

        wb.close()
        return EastStruct({"sheets": sheets})
    except Exception as e:
        raise Exception(f"XLSX info failed: {e}") from e


# Platform function implementations
xlsx_impl = [
    PlatformFunction(
        name="xlsx_read",
        inputs=[BlobType, XlsxReadOptionsType],
        output=XlsxSheetType,
        type="sync",
        fn=xlsx_read_impl,
    ),
    PlatformFunction(
        name="xlsx_write",
        inputs=[XlsxSheetType, XlsxWriteOptionsType],
        output=BlobType,
        type="sync",
        fn=xlsx_write_impl,
    ),
    PlatformFunction(
        name="xlsx_info",
        inputs=[BlobType],
        output=XlsxInfoType,
        type="sync",
        fn=xlsx_info_impl,
    ),
]

__all__ = [
    "xlsx_impl",
    "xlsx_read_impl",
    "xlsx_write_impl",
    "xlsx_info_impl",
]
