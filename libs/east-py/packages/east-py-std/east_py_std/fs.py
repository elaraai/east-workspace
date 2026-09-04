#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Filesystem platform functions for East.

Provides filesystem operations for East programs running in Python.
"""

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from east.runtime._compiler_eastc import load_frozen_value, open_paged_file
from east.runtime.platform import (
    generic_platform_function,
    platform_function,
    platform_functions,
)
from east.types.types import ArrayType, BlobType, BooleanType, EastType, NullType, StringType
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
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as err:
        # Cross-runtime error-message parity (#64): east-node-std and east-c
        # raise "Failed to read file <path>: <detail>" — match it so shared
        # compliance tests (and callers matching on messages) agree.
        raise RuntimeError(f"Failed to read file {path}: {err}") from err


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
    try:
        Path(path).write_text(content, encoding="utf-8")
    except OSError as err:
        raise RuntimeError(f"Failed to write file {path}: {err}") from err


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
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(content)
    except OSError as err:
        raise RuntimeError(f"Failed to append to file {path}: {err}") from err


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
    try:
        return EastBlob(Path(path).read_bytes())
    except OSError as err:
        raise RuntimeError(f"Failed to read file bytes {path}: {err}") from err


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
    try:
        Path(path).write_bytes(content)
    except OSError as err:
        raise RuntimeError(f"Failed to write file bytes {path}: {err}") from err


@generic_platform_function(type_parameters=["T"], name="fs_open_beast")
def fs_open_beast_impl(_platform_list: Any, T: EastType) -> Callable[[str], Any]:  # noqa: N803
    """Open an indexed beast2 collection file as a frozen, lazily paged value.

    The factory behind ``FileSystem.openBeast`` (``fs_open_beast([T], path)``
    in a body): called with the resolved ``T`` — an ``Array``, ``Set`` or
    ``Dict`` type — it returns ``open(path)``. The file is memory-mapped and
    opened as a paged value whose ``size``, keyed reads and ``for`` loop
    decode one segment at a time, exactly as ``blob.open_beast`` does; the
    mapping is released when the value dies, so nothing else has to keep it
    alive. A file without a paging index (what ``East.Blob.encode_beast``
    writes) or whose element shape holds ``Ref`` or function values decodes
    whole, frozen. The file's header must carry exactly ``T``.

    Args:
        _platform_list: The platform list being registered (unused).
        T: ``EastType`` - the collection type the file was written with.

    Returns:
        ``open(path)`` - takes ``String`` (``str``) and returns the frozen
        collection of type ``T`` as a paged hold the compiled body reads at
        O(segment).

    Raises:
        RuntimeError: From ``open(path)`` when the file cannot be opened as
            ``T``: ``Failed to open beast file <path>: <detail>``, naming
            both types on a header mismatch — the message every runtime
            raises.
    """

    def open_beast(path: str) -> Any:
        try:
            hold = open_paged_file(T, path, frozen=True)
            if hold is not None:
                return hold
            # Not pageable (index-less, or a gated element shape): the whole
            # frozen decode, the same value every runtime produces.
            return load_frozen_value(T, Path(path).read_bytes())
        except (OSError, ValueError) as err:
            raise RuntimeError(f"Failed to open beast file {path}: {err}") from err

    return open_beast


# Collected from the @platform_function / @generic_platform_function decorations above.
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
    "fs_open_beast_impl",
]
