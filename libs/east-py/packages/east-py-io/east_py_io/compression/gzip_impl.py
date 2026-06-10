#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Gzip compression platform functions for East.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
are re-exported from ``east_py_io.compression``.
"""

import gzip
import io

from east.runtime.platform import platform_function, platform_functions
from east.types.types import BlobType
from east.types.values import EastBlob, EastStruct

from .types import GzipOptionsType


@platform_function(name="gzip_compress", inputs=[BlobType, GzipOptionsType], output=BlobType)
async def gzip_compress_impl(data: EastBlob, options: EastStruct) -> EastBlob:
    """Compress a binary blob using gzip.

    Args:
        data: ``Blob`` (``EastBlob``) - the uncompressed input data.
        options: ``GzipOptionsType`` (``EastStruct``) with fields:

            - ``level`` (``Option<Integer>``): compression level 0-9;
              0 = no compression, 1-3 = fast, 4-6 = balanced (default 6),
              7-9 = maximum.

    Returns:
        ``Blob`` (``EastBlob``) - the gzip-compressed output.

    Raises:
        RuntimeError: ``level`` is outside the 0-9 range, or gzip
            compression fails.
    """
    try:
        level_opt = options["level"]
        level = int(level_opt.value) if level_opt.type == "some" else 6

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
    """Decompress a gzip-compressed binary blob.

    Args:
        data: ``Blob`` (``EastBlob``) - the gzip-compressed input.

    Returns:
        ``Blob`` (``EastBlob``) - the decompressed output.

    Raises:
        RuntimeError: ``data`` is not valid gzip data or decompression
            fails.
    """
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
