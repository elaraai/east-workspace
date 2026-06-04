#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Filesystem platform functions for East.

Provides filesystem operations for East programs running in Python.
"""

import os
from pathlib import Path

from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, BlobType, BooleanType, NullType, StringType
from east.types.values import EastArray, EastBlob


@platform_function(name="fs_read_file", inputs=[StringType], output=StringType)
def fs_read_file_impl(path: str) -> str:
    """Read entire file contents as UTF-8 text.

    Args:
        path: File path to read

    Returns:
        File contents as UTF-8 string
    """
    return Path(path).read_text(encoding="utf-8")


@platform_function(name="fs_write_file", inputs=[StringType, StringType], output=NullType)
def fs_write_file_impl(path: str, content: str) -> None:
    """Write UTF-8 string to file.

    Args:
        path: File path to write
        content: Content to write
    """
    Path(path).write_text(content, encoding="utf-8")


@platform_function(name="fs_append_file", inputs=[StringType, StringType], output=NullType)
def fs_append_file_impl(path: str, content: str) -> None:
    """Append UTF-8 string to end of file.

    Args:
        path: File path to append to
        content: Content to append
    """
    with open(path, "a", encoding="utf-8") as f:
        f.write(content)


@platform_function(name="fs_delete_file", inputs=[StringType], output=NullType)
def fs_delete_file_impl(path: str) -> None:
    """Delete a file.

    Args:
        path: File path to delete
    """
    os.remove(path)


@platform_function(name="fs_exists", inputs=[StringType], output=BooleanType)
def fs_exists_impl(path: str) -> bool:
    """Check if file or directory exists.

    Args:
        path: Path to check

    Returns:
        True if path exists
    """
    return os.path.exists(path)


@platform_function(name="fs_is_file", inputs=[StringType], output=BooleanType)
def fs_is_file_impl(path: str) -> bool:
    """Check if path is a regular file.

    Args:
        path: Path to check

    Returns:
        True if path exists and is a regular file
    """
    return os.path.isfile(path)


@platform_function(name="fs_is_directory", inputs=[StringType], output=BooleanType)
def fs_is_directory_impl(path: str) -> bool:
    """Check if path is a directory.

    Args:
        path: Path to check

    Returns:
        True if path exists and is a directory
    """
    return os.path.isdir(path)


@platform_function(name="fs_create_directory", inputs=[StringType], output=NullType)
def fs_create_directory_impl(path: str) -> None:
    """Create directory with all necessary parent directories.

    Args:
        path: Directory path to create
    """
    os.makedirs(path, exist_ok=True)


@platform_function(name="fs_read_directory", inputs=[StringType], output=ArrayType(StringType))
def fs_read_directory_impl(path: str) -> EastArray:
    """List files and directories within a directory.

    Args:
        path: Directory path to read

    Returns:
        Array of names (not full paths)
    """
    entries = os.listdir(path)
    return EastArray(StringType, entries)


@platform_function(name="fs_read_file_bytes", inputs=[StringType], output=BlobType)
def fs_read_file_bytes_impl(path: str) -> EastBlob:
    """Read entire file contents as raw binary data.

    Args:
        path: File path to read

    Returns:
        File contents as EastBlob
    """
    return EastBlob(Path(path).read_bytes())


@platform_function(name="fs_write_file_bytes", inputs=[StringType, BlobType], output=NullType)
def fs_write_file_bytes_impl(path: str, content: bytes) -> None:
    """Write raw binary data to file.

    Args:
        path: File path to write
        content: Binary content to write
    """
    Path(path).write_bytes(content)


# Collected from the @platform_function decorations above.
fs_impl = platform_functions(__name__)


__all__ = ["fs_impl"]
