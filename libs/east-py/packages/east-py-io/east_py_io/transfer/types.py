#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared Transfer type definitions for East Python IO.

Provides East type definitions for FTP and SFTP operations.
"""

from east.types.types import (
    ArrayType,
    BooleanType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
)

# FTP configuration
FtpConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("user", StringType),
        ("password", StringType),
        ("secure", BooleanType),
    ]
)

# SFTP configuration
SftpConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("username", StringType),
        ("password", OptionType(StringType)),
        ("privateKey", OptionType(StringType)),
    ]
)

# Connection handle
ConnectionHandleType = StringType

# File entry info
FileEntryType = StructType(
    [
        ("name", StringType),
        ("path", StringType),
        ("size", IntegerType),
        ("isDirectory", BooleanType),
        ("modifiedTime", StringType),
    ]
)

FileListType = ArrayType(FileEntryType)

__all__ = [
    "FtpConfigType",
    "SftpConfigType",
    "ConnectionHandleType",
    "FileEntryType",
    "FileListType",
]
