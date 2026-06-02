#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Zip platform functions for East.

Provides zip archive creation and extraction for East programs.
"""

import io
import zipfile

from east.runtime.platform import platform_function, platform_functions
from east.types.types import BlobType, StringType
from east.types.values import EastArray, EastBlob, EastDict, EastStruct

from .types import ZipEntriesType, ZipExtractedType, ZipOptionsType


@platform_function(
    name="zip_compress",
    inputs=[ZipEntriesType, ZipOptionsType],
    output=BlobType,
)
def zip_compress_impl(
    entries: EastArray,
    options: EastStruct,
) -> EastBlob:
    """Compress files into a zip archive.

    Args:
        entries: Array of {name, data} entries to compress
        options: Compression options with optional level (0-9)

    Returns:
        Compressed zip archive as blob
    """
    try:
        # Extract compression level (default to 6)
        level_opt = options["level"]
        level = int(level_opt.value) if level_opt.type == "some" else 6

        # Validate level
        if level < 0 or level > 9:
            raise Exception(f"Invalid compression level: {level}. Must be 0-9.")

        output = io.BytesIO()
        compression = zipfile.ZIP_DEFLATED if level > 0 else zipfile.ZIP_STORED

        with zipfile.ZipFile(output, "w", compression, compresslevel=level) as zf:
            for entry in entries:
                name = entry["name"]
                data = entry["data"]

                if not name or len(name) == 0:
                    raise Exception("File name cannot be empty")

                # Write entry to zip
                zf.writestr(name, bytes(data))

        return EastBlob(output.getvalue())
    except Exception as e:
        raise Exception(f"Zip compress failed: {e}") from e


@platform_function(
    name="zip_decompress",
    inputs=[BlobType],
    output=ZipExtractedType,
)
def zip_decompress_impl(data: EastBlob) -> EastDict:
    """Decompress a zip archive.

    Args:
        data: Compressed zip archive blob

    Returns:
        Dict mapping file names to their uncompressed data
    """
    try:
        result: EastDict = EastDict(StringType, BlobType)

        with zipfile.ZipFile(io.BytesIO(bytes(data)), "r") as zf:
            for name in zf.namelist():
                # Skip directories
                if not name.endswith("/"):
                    content = zf.read(name)
                    result[name] = EastBlob(content)

        return result
    except Exception as e:
        raise Exception(f"Zip decompress failed: {e}") from e


# Collected from the @platform_function decorations above.
zip_impl = platform_functions(__name__)

__all__ = [
    "zip_impl",
    "zip_compress_impl",
    "zip_decompress_impl",
]
