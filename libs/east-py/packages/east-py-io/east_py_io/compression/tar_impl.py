#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""TAR archive platform functions for East.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
are re-exported from ``east_py_io.compression``.
"""

import io
import tarfile

from east.runtime.platform import platform_function, platform_functions
from east.types.types import BlobType, StringType
from east.types.values import EastArray, EastBlob, EastDict

from .types import TarEntriesType, TarExtractedType


@platform_function(name="tar_create", inputs=[TarEntriesType], output=BlobType)
async def tar_create(entries: EastArray) -> EastBlob:
    """Create a TAR archive from an array of named file entries.

    Args:
        entries: ``Array<TarEntryType>`` (``EastArray``) - each element is
            an ``EastStruct`` with fields:

            - ``name`` (``String``): path/filename stored inside the
              archive; must not be empty.
            - ``data`` (``Blob``): file content.

    Returns:
        ``Blob`` (``EastBlob``) - the uncompressed TAR archive bytes.

    Raises:
        RuntimeError: any entry has an empty ``name``, or archive
            creation fails.
    """
    try:
        output = io.BytesIO()

        with tarfile.open(fileobj=output, mode="w") as tar:
            for entry in entries:
                name = entry["name"]
                data = entry["data"]

                if not name or len(name) == 0:
                    raise Exception("File name cannot be empty")

                info = tarfile.TarInfo(name=name)
                info.size = len(data)

                tar.addfile(info, io.BytesIO(bytes(data)))

        return EastBlob(output.getvalue())
    except Exception as e:
        raise Exception(f"Tar create failed: {e}") from e


@platform_function(name="tar_extract", inputs=[BlobType], output=TarExtractedType)
async def tar_extract(data: EastBlob) -> EastDict:
    """Extract all regular files from a TAR archive.

    Args:
        data: ``Blob`` (``EastBlob``) - the TAR archive to extract
            (uncompressed; gzip/bz2 streams are auto-detected by
            ``tarfile.open`` in ``r`` mode).

    Returns:
        ``Dict<String, Blob>`` (``EastDict``) mapping each member
        filename to its content. Directory entries and symlinks are
        omitted.

    Raises:
        RuntimeError: ``data`` is not a valid TAR archive or extraction
            fails.
    """
    try:
        result: EastDict = EastDict(StringType, BlobType)

        with tarfile.open(fileobj=io.BytesIO(bytes(data)), mode="r") as tar:
            for member in tar.getmembers():
                if member.isfile():
                    f = tar.extractfile(member)
                    content = f.read() if f else b""
                    result[member.name] = EastBlob(content)

        return result
    except Exception as e:
        raise Exception(f"Tar extract failed: {e}") from e


# Collected from the @platform_function decorations above.
tar_impl = platform_functions(__name__)

__all__ = [
    "tar_impl",
    "tar_create",
    "tar_extract",
]
