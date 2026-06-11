#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""ZIP archive platform functions for East.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
are re-exported from ``east_py_io.compression``.
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
    """Compress an array of named files into a ZIP archive.

    Args:
        entries: ``Array<ZipEntryType>`` (``EastArray``) - each element
            is an ``EastStruct`` with fields:

            - ``name`` (``String``): path/filename stored inside the
              archive; must not be empty.
            - ``data`` (``Blob``): uncompressed file content.

        options: ``ZipOptionsType`` (``EastStruct``) with fields:

            - ``level`` (``Option<Integer>``): compression level 0-9;
              0 = store only (``ZIP_STORED``), 1-9 = deflate with the
              given level (default 6).

    Returns:
        ``Blob`` (``EastBlob``) - the ZIP archive bytes.

    Raises:
        RuntimeError: ``level`` is outside 0-9, any entry has an empty
            ``name``, or archive creation fails.
    """
    try:
        level_opt = options["level"]
        level = int(level_opt.value) if level_opt.type == "some" else 6

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
    """Extract all files from a ZIP archive.

    Args:
        data: ``Blob`` (``EastBlob``) - the ZIP archive to extract.

    Returns:
        ``Dict<String, Blob>`` (``EastDict``) mapping each filename (as
        stored in the archive) to its uncompressed content. Directory
        entries (names ending in ``/``) are omitted.

    Raises:
        RuntimeError: ``data`` is not a valid ZIP archive or extraction
            fails.
    """
    try:
        result: EastDict = EastDict(StringType, BlobType)

        with zipfile.ZipFile(io.BytesIO(bytes(data)), "r") as zf:
            for name in zf.namelist():
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
