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

# LiteralValueType - represents any primitive value
# Matches TypeScript's LiteralValueType
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

# XLSX Types
XlsxCellType = LiteralValueType
XlsxRowType = ArrayType(XlsxCellType)
XlsxSheetType = ArrayType(XlsxRowType)

XlsxReadOptionsType = StructType(
    [
        ("sheetName", OptionType(StringType)),
    ]
)

XlsxWriteOptionsType = StructType(
    [
        ("sheetName", OptionType(StringType)),
    ]
)

XlsxSheetInfoType = StructType(
    [
        ("name", StringType),
        ("rowCount", IntegerType),
        ("columnCount", IntegerType),
    ]
)

XlsxInfoType = StructType(
    [
        ("sheets", ArrayType(XlsxSheetInfoType)),
    ]
)

# XML Types - using RecursiveType for nested elements
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

XmlParseConfigType = StructType(
    [
        ("preserveWhitespace", BooleanType),
        ("decodeEntities", BooleanType),
    ]
)

XmlSerializeConfigType = StructType(
    [
        ("indent", OptionType(StringType)),
        ("includeXmlDeclaration", BooleanType),
        ("encodeEntities", BooleanType),
        ("selfClosingTags", BooleanType),
    ]
)

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
