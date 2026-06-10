#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Format type definitions for East Python IO.

Provides East type definitions for XLSX and XML operations.
"""

from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    RecursiveType,
    StringType,
    StructType,
    VariantType,
)

LiteralValueType = VariantType(
    [
        ("Null", NullType),
        ("Boolean", BooleanType),
        ("Integer", IntegerType),
        ("Float", FloatType),
        ("String", StringType),
        ("DateTime", DateTimeType),
        ("Blob", BlobType),
    ]
)
"""Any primitive East value, used as the cell type in XLSX sheets.

Cases: ``Null``, ``Boolean``, ``Integer``, ``Float``, ``String``,
``DateTime``, ``Blob``. Matches the TypeScript ``LiteralValueType``.
Note: Excel stores all numbers as floats internally, so numeric cells
are returned as ``Float`` regardless of whether they look like integers.
"""

XlsxCellType = LiteralValueType
"""Alias for ``LiteralValueType`` - the type of a single XLSX cell."""

XlsxRowType = ArrayType(XlsxCellType)
"""A row in an XLSX sheet - ``Array<LiteralValueType>``."""

XlsxSheetType = ArrayType(XlsxRowType)
"""An XLSX sheet - ``Array<Array<LiteralValueType>>`` (rows of cells)."""

XlsxReadOptionsType = StructType(
    [
        ("sheetName", OptionType(StringType)),
    ]
)
"""Options for reading an XLSX file with ``xlsx_read``.

Fields: ``sheetName`` (``Option<String>`` - sheet to read; defaults to
the workbook's active sheet when absent).
"""

XlsxWriteOptionsType = StructType(
    [
        ("sheetName", OptionType(StringType)),
    ]
)
"""Options for writing an XLSX file with ``xlsx_write``.

Fields: ``sheetName`` (``Option<String>`` - name for the written sheet;
defaults to ``"Sheet1"`` when absent).
"""

XlsxSheetInfoType = StructType(
    [
        ("name", StringType),
        ("rowCount", IntegerType),
        ("columnCount", IntegerType),
    ]
)
"""Metadata for a single sheet returned by ``xlsx_info``.

Fields: ``name`` (``String``), ``rowCount`` (``Integer``),
``columnCount`` (``Integer``).
"""

XlsxInfoType = StructType(
    [
        ("sheets", ArrayType(XlsxSheetInfoType)),
    ]
)
"""Workbook metadata returned by ``xlsx_info``.

Fields: ``sheets`` (``Array<XlsxSheetInfoType>`` - one entry per sheet,
in workbook order).
"""

XmlNodeType = RecursiveType(
    lambda self: StructType(
        [
            ("tag", StringType),
            ("attributes", DictType(StringType, StringType)),
            (
                "children",
                ArrayType(
                    VariantType(
                        [
                            ("TEXT", StringType),
                            ("ELEMENT", self),
                        ]
                    )
                ),
            ),
        ]
    )
)
"""A parsed XML element node (recursive).

Fields: ``tag`` (``String`` - element tag name), ``attributes``
(``Dict<String, String>`` - attribute map), ``children``
(``Array<Variant<TEXT: String, ELEMENT: XmlNodeType>>`` - ordered
child text and element nodes). Comments and processing instructions
are discarded during parsing.
"""

XmlParseConfigType = StructType(
    [
        ("preserveWhitespace", BooleanType),
        ("decodeEntities", BooleanType),
    ]
)
"""Configuration for ``xml_parse``.

Fields: ``preserveWhitespace`` (``Boolean`` - when ``False``, text
content is stripped of leading/trailing whitespace and empty text nodes
are dropped), ``decodeEntities`` (``Boolean`` - when ``True``, standard
XML entities such as ``&lt;``, ``&amp;``, and numeric character
references are decoded in text and attribute values).
"""

XmlSerializeConfigType = StructType(
    [
        ("indent", OptionType(StringType)),
        ("includeXmlDeclaration", BooleanType),
        ("encodeEntities", BooleanType),
        ("selfClosingTags", BooleanType),
    ]
)
"""Configuration for ``xml_serialize``.

Fields: ``indent`` (``Option<String>`` - indent string per level, e.g.
``"  "``; no indentation when absent or empty), ``includeXmlDeclaration``
(``Boolean`` - prepend ``<?xml version="1.0" encoding="UTF-8"?>``),
``encodeEntities`` (``Boolean`` - encode ``<``, ``>``, ``&``, ``"``,
``'`` in text and attribute values), ``selfClosingTags`` (``Boolean`` -
emit empty elements as ``<tag/>`` rather than ``<tag></tag>``).
"""

__all__ = [
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
]
