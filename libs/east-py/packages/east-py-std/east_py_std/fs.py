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
    """Read the entire contents of a file as UTF-8 text.

    Args:
        path: ``String`` (``str``) - path to the file.

    Returns:
        ``String`` (``str``) - complete file contents decoded as UTF-8.

    Raises:
        RuntimeError: If the file cannot be read or is not valid UTF-8.
    """
    return Path(path).read_text(encoding="utf-8")


@platform_function(name="fs_write_file", inputs=[StringType, StringType], output=NullType)
def fs_write_file_impl(path: str, content: str) -> None:
    """Write a UTF-8 string to a file, replacing any existing content.

    Args:
        path: ``String`` (``str``) - path to the file.
        content: ``String`` (``str``) - text to write.

    Returns:
        ``Null`` (``None``).

    Raises:
        RuntimeError: If the file cannot be written.
    """
    Path(path).write_text(content, encoding="utf-8")


@platform_function(name="fs_append_file", inputs=[StringType, StringType], output=NullType)
def fs_append_file_impl(path: str, content: str) -> None:
    """Append a UTF-8 string to the end of a file.

    Creates the file if it does not exist.

    Args:
        path: ``String`` (``str``) - path to the file.
        content: ``String`` (``str``) - text to append.

    Returns:
        ``Null`` (``None``).

    Raises:
        RuntimeError: If the file cannot be opened for appending.
    """
    with open(path, "a", encoding="utf-8") as f:
        f.write(content)


@platform_function(name="fs_delete_file", inputs=[StringType], output=NullType)
def fs_delete_file_impl(path: str) -> None:
    """Delete a file.

    Args:
        path: ``String`` (``str``) - path to the file to delete.

    Returns:
        ``Null`` (``None``).

    Raises:
        RuntimeError: If the file does not exist or cannot be removed.
    """
    os.remove(path)


@platform_function(name="fs_exists", inputs=[StringType], output=BooleanType)
def fs_exists_impl(path: str) -> bool:
    """Check whether a file or directory exists at the given path.

    Args:
        path: ``String`` (``str``) - path to check.

    Returns:
        ``Boolean`` (``bool``) - ``True`` if the path exists.
    """
    return os.path.exists(path)


@platform_function(name="fs_is_file", inputs=[StringType], output=BooleanType)
def fs_is_file_impl(path: str) -> bool:
    """Check whether a path points to a regular file.

    Args:
        path: ``String`` (``str``) - path to check.

    Returns:
        ``Boolean`` (``bool``) - ``True`` if the path exists and is a regular
        file (not a directory or symlink to one).
    """
    return os.path.isfile(path)


@platform_function(name="fs_is_directory", inputs=[StringType], output=BooleanType)
def fs_is_directory_impl(path: str) -> bool:
    """Check whether a path points to a directory.

    Args:
        path: ``String`` (``str``) - path to check.

    Returns:
        ``Boolean`` (``bool``) - ``True`` if the path exists and is a
        directory.
    """
    return os.path.isdir(path)


@platform_function(name="fs_create_directory", inputs=[StringType], output=NullType)
def fs_create_directory_impl(path: str) -> None:
    """Create a directory, including all necessary parent directories.

    Does nothing if the directory already exists.

    Args:
        path: ``String`` (``str``) - directory path to create.

    Returns:
        ``Null`` (``None``).

    Raises:
        RuntimeError: If the path exists and is not a directory, or if
            creation fails due to permissions.
    """
    os.makedirs(path, exist_ok=True)


@platform_function(name="fs_read_directory", inputs=[StringType], output=ArrayType(StringType))
def fs_read_directory_impl(path: str) -> EastArray:
    """List the names of entries within a directory.

    Args:
        path: ``String`` (``str``) - directory path to read.

    Returns:
        ``Array<String>`` (``EastArray``) - entry names (not full paths),
        in arbitrary order.

    Raises:
        RuntimeError: If the path does not exist or is not a directory.
    """
    entries = os.listdir(path)
    return EastArray(StringType, entries)


@platform_function(name="fs_read_file_bytes", inputs=[StringType], output=BlobType)
def fs_read_file_bytes_impl(path: str) -> EastBlob:
    """Read the entire contents of a file as raw binary data.

    Args:
        path: ``String`` (``str``) - path to the file.

    Returns:
        ``Blob`` (``EastBlob``) - complete raw file contents.

    Raises:
        RuntimeError: If the file cannot be read.
    """
    return EastBlob(Path(path).read_bytes())


@platform_function(name="fs_write_file_bytes", inputs=[StringType, BlobType], output=NullType)
def fs_write_file_bytes_impl(path: str, content: bytes) -> None:
    """Write raw binary data to a file, replacing any existing content.

    Args:
        path: ``String`` (``str``) - path to the file.
        content: ``Blob`` (``bytes``) - binary data to write.

    Returns:
        ``Null`` (``None``).

    Raises:
        RuntimeError: If the file cannot be written.
    """
    Path(path).write_bytes(content)


# Collected from the @platform_function decorations above.
fs_impl = platform_functions(__name__)


__all__ = [
    "fs_impl",
    "fs_read_file_impl",
    "fs_write_file_impl",
    "fs_append_file_impl",
    "fs_delete_file_impl",
    "fs_exists_impl",
    "fs_is_file_impl",
    "fs_is_directory_impl",
    "fs_create_directory_impl",
    "fs_read_directory_impl",
    "fs_read_file_bytes_impl",
    "fs_write_file_bytes_impl",
]
