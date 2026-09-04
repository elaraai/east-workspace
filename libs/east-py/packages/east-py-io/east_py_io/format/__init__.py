#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Format module - XLSX and XML file processing.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.
"""

from east_py_io.format.types import (
    LiteralValueType,
    XlsxCellType,
    XlsxInfoType,
    XlsxReadOptionsType,
    XlsxRowType,
    XlsxSheetInfoType,
    XlsxSheetType,
    XlsxWriteOptionsType,
    XmlNodeType,
    XmlParseConfigType,
    XmlSerializeConfigType,
)
from east_py_io.format.xlsx import (
    xlsx_impl,
    xlsx_info,
    xlsx_read,
    xlsx_write,
)
from east_py_io.format.xml_impl import (
    xml_impl,
    xml_parse,
    xml_serialize,
)

__all__ = [
    # Types
    "LiteralValueType",
    "XlsxCellType",
    "XlsxRowType",
    "XlsxSheetType",
    "XlsxReadOptionsType",
    "XlsxWriteOptionsType",
    "XlsxSheetInfoType",
    "XlsxInfoType",
    "XmlNodeType",
    "XmlParseConfigType",
    "XmlSerializeConfigType",
    # XLSX
    "xlsx_impl",
    "xlsx_read",
    "xlsx_write",
    "xlsx_info",
    # XML
    "xml_impl",
    "xml_parse",
    "xml_serialize",
]
