#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compression module - gzip, tar, and zip archives.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.
"""

from east_py_io.compression.gzip_impl import (
    gzip_compress,
    gzip_decompress,
    gzip_impl,
)
from east_py_io.compression.tar_impl import (
    tar_create,
    tar_extract,
    tar_impl,
)
from east_py_io.compression.types import (
    GzipLevelType,
    GzipOptionsType,
    TarEntriesType,
    TarEntryType,
    TarExtractedType,
    ZipEntriesType,
    ZipEntryType,
    ZipExtractedType,
    ZipLevelType,
    ZipOptionsType,
)
from east_py_io.compression.zip_impl import (
    zip_compress,
    zip_decompress,
    zip_impl,
)

__all__ = [
    # Types
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
    # Gzip
    "gzip_impl",
    "gzip_compress",
    "gzip_decompress",
    # Tar
    "tar_impl",
    "tar_create",
    "tar_extract",
    # Zip
    "zip_impl",
    "zip_compress",
    "zip_decompress",
]
