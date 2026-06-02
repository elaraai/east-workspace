#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Gzip platform functions for East.

Provides gzip compression and decompression for East programs.
"""

import gzip
import io

from east.runtime.platform import platform_function, platform_functions
from east.types.types import BlobType
from east.types.values import EastBlob, EastStruct

from .types import GzipOptionsType


@platform_function(name="gzip_compress", inputs=[BlobType, GzipOptionsType], output=BlobType)
async def gzip_compress_impl(data: EastBlob, options: EastStruct) -> EastBlob:
    """Compress data using gzip.

    Args:
        data: Uncompressed data to compress
        options: Compression options with optional level (0-9)

    Returns:
        Compressed data as gzip blob
    """
    try:
        # Extract compression level (default to 6)
        level_opt = options["level"]
        level = int(level_opt.value) if level_opt.type == "some" else 6

        # Validate level
        if level < 0 or level > 9:
            raise Exception(f"Invalid compression level: {level}. Must be 0-9.")

        output = io.BytesIO()
        with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=level) as f:
            f.write(data.data)
        return EastBlob(output.getvalue())
    except Exception as e:
        raise Exception(f"Gzip compress failed: {e}") from e


@platform_function(name="gzip_decompress", inputs=[BlobType], output=BlobType)
async def gzip_decompress_impl(data: EastBlob) -> EastBlob:
    """Decompress gzip data."""
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data.data), mode="rb") as f:
            return EastBlob(f.read())
    except Exception as e:
        raise Exception(f"Gzip decompress failed: {e}") from e


# Collected from the @platform_function decorations above.
gzip_impl = platform_functions(__name__)

__all__ = [
    "gzip_impl",
    "gzip_compress_impl",
    "gzip_decompress_impl",
]
