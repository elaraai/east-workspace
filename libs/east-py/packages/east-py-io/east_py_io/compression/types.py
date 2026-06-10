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

GzipLevelType = IntegerType
"""Compression level for gzip operations (``Integer`` 0-9).

- 0: no compression (store only)
- 1-3: fast compression
- 4-6: balanced (6 is the default)
- 7-9: maximum compression
"""

GzipOptionsType = StructType(
    [
        ("level", OptionType(GzipLevelType)),
    ]
)
"""Options for gzip compression.

Fields: ``level`` (``Option<Integer>`` 0-9, default 6).
"""

ZipLevelType = IntegerType
"""Compression level for zip operations (``Integer`` 0-9).

- 0: store only (no compression; uses ``ZIP_STORED``)
- 1-3: fast compression
- 4-6: balanced (default is typically 6)
- 7-9: maximum compression
"""

ZipOptionsType = StructType(
    [
        ("level", OptionType(ZipLevelType)),
    ]
)
"""Options for zip archive creation.

Fields: ``level`` (``Option<Integer>`` 0-9, default 6; level 0 stores
without compression).
"""

ZipEntryType = StructType(
    [
        ("name", StringType),
        ("data", BlobType),
    ]
)
"""A single file entry to be stored in a ZIP archive.

Fields: ``name`` (``String`` - path/filename inside the archive),
``data`` (``Blob`` - uncompressed file content).
"""

ZipEntriesType = ArrayType(ZipEntryType)
"""List of ``ZipEntryType`` entries passed to ``zip_compress``."""

TarEntryType = StructType(
    [
        ("name", StringType),
        ("data", BlobType),
    ]
)
"""A single file entry to be stored in a TAR archive.

Fields: ``name`` (``String`` - path/filename inside the archive),
``data`` (``Blob`` - file content).
"""

TarEntriesType = ArrayType(TarEntryType)
"""List of ``TarEntryType`` entries passed to ``tar_create``."""

ZipExtractedType = DictType(StringType, BlobType)
"""Files extracted from a ZIP archive.

``Dict<String, Blob>`` mapping each filename (as stored in the archive)
to its uncompressed content. Directory entries (names ending in ``/``)
are omitted.
"""

TarExtractedType = DictType(StringType, BlobType)
"""Files extracted from a TAR archive.

``Dict<String, Blob>`` mapping each member filename to its content.
Only regular files are included; directories and symlinks are omitted.
"""

__all__ = [
    "GzipLevelType",
    "GzipOptionsType",
    "ZipLevelType",
    "ZipOptionsType",
    "ZipEntryType",
    "ZipEntriesType",
    "ZipExtractedType",
    "TarEntryType",
    "TarEntriesType",
    "TarExtractedType",
]
