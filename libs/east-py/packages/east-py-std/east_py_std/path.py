#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Path manipulation platform functions for East.

Provides path operations for East programs running in Python.
"""

import posixpath
from pathlib import Path as PathLib

from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, StringType
from east.types.values import EastArray


@platform_function(name="path_join", inputs=[ArrayType(StringType)], output=StringType)
def path_join_impl(segments: EastArray) -> str:
    """Join path segments into a single path using forward slashes.

    Args:
        segments: ``Array<String>`` (``EastArray``) - path segments to join.
            Returns ``"."`` when the array is empty.

    Returns:
        ``String`` (``str``) - joined path using ``/`` separators on every
        platform.
    """
    if len(segments) == 0:
        return "."
    return posixpath.join(*segments)


@platform_function(name="path_resolve", inputs=[StringType], output=StringType)
def path_resolve_impl(path: str) -> str:
    """Resolve a path to an absolute path relative to the current working directory.

    Args:
        path: ``String`` (``str``) - relative or absolute path to resolve.

    Returns:
        ``String`` (``str``) - absolute path with all symlinks and ``..``
        components resolved.
    """
    return str(PathLib(path).resolve())


@platform_function(name="path_dirname", inputs=[StringType], output=StringType)
def path_dirname_impl(path: str) -> str:
    """Extract the directory portion of a path.

    Args:
        path: ``String`` (``str``) - path to extract the directory from.

    Returns:
        ``String`` (``str``) - all path components before the final separator,
        or an empty string if the path has no directory component.
    """
    return posixpath.dirname(path)


@platform_function(name="path_basename", inputs=[StringType], output=StringType)
def path_basename_impl(path: str) -> str:
    """Extract the final component (file name) from a path.

    Args:
        path: ``String`` (``str``) - path to extract the file name from.

    Returns:
        ``String`` (``str``) - final path component including the extension,
        or an empty string if the path ends with a separator.
    """
    return posixpath.basename(path)


@platform_function(name="path_extname", inputs=[StringType], output=StringType)
def path_extname_impl(path: str) -> str:
    """Extract the file extension from a path.

    Args:
        path: ``String`` (``str``) - path to extract the extension from.

    Returns:
        ``String`` (``str``) - file extension including the leading dot
        (e.g., ``".txt"``), or an empty string when the path has no
        extension.
    """
    return posixpath.splitext(path)[1]


# Collected from the @platform_function decorations above.
path_impl = platform_functions(__name__)


__all__ = [
    "path_impl",
    "path_join_impl",
    "path_resolve_impl",
    "path_dirname_impl",
    "path_basename_impl",
    "path_extname_impl",
]
