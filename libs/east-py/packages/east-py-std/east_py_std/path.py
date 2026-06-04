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
    """Join path segments into a single path.

    Args:
        segments: Array of path segments to join

    Returns:
        Joined path, using forward slashes (/) on every platform
    """
    if len(segments) == 0:
        return "."
    return posixpath.join(*segments)


@platform_function(name="path_resolve", inputs=[StringType], output=StringType)
def path_resolve_impl(path: str) -> str:
    """Resolve path to an absolute path.

    Args:
        path: Path to resolve (relative or absolute)

    Returns:
        Absolute path
    """
    return str(PathLib(path).resolve())


@platform_function(name="path_dirname", inputs=[StringType], output=StringType)
def path_dirname_impl(path: str) -> str:
    """Get directory name from a path.

    Args:
        path: File path to extract directory from

    Returns:
        Directory portion of the path
    """
    return posixpath.dirname(path)


@platform_function(name="path_basename", inputs=[StringType], output=StringType)
def path_basename_impl(path: str) -> str:
    """Get base name (file name) from a path.

    Args:
        path: File path to extract filename from

    Returns:
        File name portion of the path (including extension)
    """
    return posixpath.basename(path)


@platform_function(name="path_extname", inputs=[StringType], output=StringType)
def path_extname_impl(path: str) -> str:
    """Get file extension from a path.

    Args:
        path: File path to extract extension from

    Returns:
        File extension including the dot (e.g., ".txt"), or empty string if none
    """
    return posixpath.splitext(path)[1]


# Collected from the @platform_function decorations above.
path_impl = platform_functions(__name__)


__all__ = ["path_impl"]
