#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Filesystem platform functions for East.

Provides filesystem operations for East programs running in Python.
"""

import os
from pathlib import Path

from east.runtime.platform import PlatformFunction
from east.types.types import ArrayType, BlobType, BooleanType, NullType, StringType
from east.types.values import EastArray, EastBlob


def fs_read_file_impl(path: str) -> str:
    """Read entire file contents as UTF-8 text.

    Args:
        path: File path to read

    Returns:
        File contents as UTF-8 string
    """
    return Path(path).read_text(encoding="utf-8")


def fs_write_file_impl(path: str, content: str) -> None:
    """Write UTF-8 string to file.

    Args:
        path: File path to write
        content: Content to write
    """
    Path(path).write_text(content, encoding="utf-8")


def fs_append_file_impl(path: str, content: str) -> None:
    """Append UTF-8 string to end of file.

    Args:
        path: File path to append to
        content: Content to append
    """
    with open(path, "a", encoding="utf-8") as f:
        f.write(content)


def fs_delete_file_impl(path: str) -> None:
    """Delete a file.

    Args:
        path: File path to delete
    """
    os.remove(path)


def fs_exists_impl(path: str) -> bool:
    """Check if file or directory exists.

    Args:
        path: Path to check

    Returns:
        True if path exists
    """
    return os.path.exists(path)


def fs_is_file_impl(path: str) -> bool:
    """Check if path is a regular file.

    Args:
        path: Path to check

    Returns:
        True if path exists and is a regular file
    """
    return os.path.isfile(path)


def fs_is_directory_impl(path: str) -> bool:
    """Check if path is a directory.

    Args:
        path: Path to check

    Returns:
        True if path exists and is a directory
    """
    return os.path.isdir(path)


def fs_create_directory_impl(path: str) -> None:
    """Create directory with all necessary parent directories.

    Args:
        path: Directory path to create
    """
    os.makedirs(path, exist_ok=True)


def fs_read_directory_impl(path: str) -> EastArray:
    """List files and directories within a directory.

    Args:
        path: Directory path to read

    Returns:
        Array of names (not full paths)
    """
    entries = os.listdir(path)
    return EastArray(StringType, entries)


def fs_read_file_bytes_impl(path: str) -> EastBlob:
    """Read entire file contents as raw binary data.

    Args:
        path: File path to read

    Returns:
        File contents as EastBlob
    """
    return EastBlob(Path(path).read_bytes())


def fs_write_file_bytes_impl(path: str, content: bytes) -> None:
    """Write raw binary data to file.

    Args:
        path: File path to write
        content: Binary content to write
    """
    Path(path).write_bytes(content)


# Platform function implementations
fs_impl = [
    PlatformFunction(
        name="fs_read_file",
        inputs=[StringType],
        output=StringType,
        type="sync",
        fn=fs_read_file_impl,
    ),
    PlatformFunction(
        name="fs_write_file",
        inputs=[StringType, StringType],
        output=NullType,
        type="sync",
        fn=fs_write_file_impl,
    ),
    PlatformFunction(
        name="fs_append_file",
        inputs=[StringType, StringType],
        output=NullType,
        type="sync",
        fn=fs_append_file_impl,
    ),
    PlatformFunction(
        name="fs_delete_file",
        inputs=[StringType],
        output=NullType,
        type="sync",
        fn=fs_delete_file_impl,
    ),
    PlatformFunction(
        name="fs_exists",
        inputs=[StringType],
        output=BooleanType,
        type="sync",
        fn=fs_exists_impl,
    ),
    PlatformFunction(
        name="fs_is_file",
        inputs=[StringType],
        output=BooleanType,
        type="sync",
        fn=fs_is_file_impl,
    ),
    PlatformFunction(
        name="fs_is_directory",
        inputs=[StringType],
        output=BooleanType,
        type="sync",
        fn=fs_is_directory_impl,
    ),
    PlatformFunction(
        name="fs_create_directory",
        inputs=[StringType],
        output=NullType,
        type="sync",
        fn=fs_create_directory_impl,
    ),
    PlatformFunction(
        name="fs_read_directory",
        inputs=[StringType],
        output=ArrayType(StringType),
        type="sync",
        fn=fs_read_directory_impl,
    ),
    PlatformFunction(
        name="fs_read_file_bytes",
        inputs=[StringType],
        output=BlobType,
        type="sync",
        fn=fs_read_file_bytes_impl,
    ),
    PlatformFunction(
        name="fs_write_file_bytes",
        inputs=[StringType, BlobType],
        output=NullType,
        type="sync",
        fn=fs_write_file_bytes_impl,
    ),
]


__all__ = ["fs_impl"]
