#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Tar platform functions for East.

Provides tar archive creation and extraction for East programs.
"""

import io
import tarfile

from east.runtime.platform import PlatformFunction
from east.types.types import BlobType, StringType
from east.types.values import EastArray, EastBlob, EastDict

from .types import TarEntriesType, TarExtractedType


async def tar_create_impl(entries: EastArray) -> EastBlob:
    """Create a tar archive from entries.

    Args:
        entries: Array of {name, data} entries to archive

    Returns:
        Tar archive as blob
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


async def tar_extract_impl(data: EastBlob) -> EastDict:
    """Extract all files from a tar archive.

    Args:
        data: Tar archive blob

    Returns:
        Dict mapping file names to their data
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


# Platform function implementations
tar_impl = [
    PlatformFunction(
        name="tar_create",
        inputs=[TarEntriesType],
        output=BlobType,
        type="async",
        fn=tar_create_impl,
    ),
    PlatformFunction(
        name="tar_extract",
        inputs=[BlobType],
        output=TarExtractedType,
        type="async",
        fn=tar_extract_impl,
    ),
]

__all__ = [
    "tar_impl",
    "tar_create_impl",
    "tar_extract_impl",
]
