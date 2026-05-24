#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compression type definitions for East Python IO.

Provides East type definitions for compression and decompression operations,
supporting gzip, zip, and tar formats.
"""

from east.types.types import (
    ArrayType,
    BlobType,
    DictType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
)

# Compression level for gzip operations (0-9).
#
# - 0: No compression
# - 1-3: Fast compression
# - 4-6: Balanced (6 is default)
# - 7-9: Maximum compression
GzipLevelType = IntegerType

# Gzip compression options.
#
# Controls how data is compressed using gzip.
GzipOptionsType = StructType(
    [
        ("level", OptionType(GzipLevelType)),
    ]
)

# Compression level for zip operations (0-9).
#
# - 0: Store only (no compression)
# - 1-3: Fast compression
# - 4-6: Balanced (default is typically 6)
# - 7-9: Maximum compression
ZipLevelType = IntegerType

# Zip compression options.
#
# Controls how data is compressed when creating zip archives.
ZipOptionsType = StructType(
    [
        ("level", OptionType(ZipLevelType)),
    ]
)

# Entry in a ZIP archive.
#
# Contains the file name and its uncompressed data.
ZipEntryType = StructType(
    [
        ("name", StringType),
        ("data", BlobType),
    ]
)

# List of entries for creating a ZIP archive.
ZipEntriesType = ArrayType(ZipEntryType)

# Entry in a TAR archive.
#
# Contains the file name and its data.
TarEntryType = StructType(
    [
        ("name", StringType),
        ("data", BlobType),
    ]
)

# List of entries for creating a TAR archive.
TarEntriesType = ArrayType(TarEntryType)

# Extracted files from a ZIP archive as a dictionary.
#
# Maps file names to their uncompressed data.
ZipExtractedType = DictType(StringType, BlobType)

# Extracted files from a TAR archive as a dictionary.
#
# Maps file names to their data.
TarExtractedType = DictType(StringType, BlobType)

__all__ = [
    "GzipLevelType",
    "GzipOptionsType",
    "ZipLevelType",
    "ZipOptionsType",
    "ZipEntryType",
    "ZipEntriesType",
    "TarEntryType",
    "TarEntriesType",
    "ZipExtractedType",
    "TarExtractedType",
]
