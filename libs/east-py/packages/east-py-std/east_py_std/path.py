#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Path manipulation platform functions for East.

Provides path operations for East programs running in Python.
"""

import os
from pathlib import Path as PathLib

from east.runtime.platform import PlatformFunction
from east.types.types import ArrayType, StringType
from east.types.values import EastArray


def path_join_impl(segments: EastArray) -> str:
    """Join path segments into a single path.

    Args:
        segments: Array of path segments to join

    Returns:
        Joined path with platform-specific separators
    """
    if len(segments) == 0:
        return "."
    return os.path.join(*segments)


def path_resolve_impl(path: str) -> str:
    """Resolve path to an absolute path.

    Args:
        path: Path to resolve (relative or absolute)

    Returns:
        Absolute path
    """
    return str(PathLib(path).resolve())


def path_dirname_impl(path: str) -> str:
    """Get directory name from a path.

    Args:
        path: File path to extract directory from

    Returns:
        Directory portion of the path
    """
    return os.path.dirname(path)


def path_basename_impl(path: str) -> str:
    """Get base name (file name) from a path.

    Args:
        path: File path to extract filename from

    Returns:
        File name portion of the path (including extension)
    """
    return os.path.basename(path)


def path_extname_impl(path: str) -> str:
    """Get file extension from a path.

    Args:
        path: File path to extract extension from

    Returns:
        File extension including the dot (e.g., ".txt"), or empty string if none
    """
    return os.path.splitext(path)[1]


# Platform function implementations
path_impl = [
    PlatformFunction(
        name="path_join",
        inputs=[ArrayType(StringType)],
        output=StringType,
        type="sync",
        fn=path_join_impl,
    ),
    PlatformFunction(
        name="path_resolve",
        inputs=[StringType],
        output=StringType,
        type="sync",
        fn=path_resolve_impl,
    ),
    PlatformFunction(
        name="path_dirname",
        inputs=[StringType],
        output=StringType,
        type="sync",
        fn=path_dirname_impl,
    ),
    PlatformFunction(
        name="path_basename",
        inputs=[StringType],
        output=StringType,
        type="sync",
        fn=path_basename_impl,
    ),
    PlatformFunction(
        name="path_extname",
        inputs=[StringType],
        output=StringType,
        type="sync",
        fn=path_extname_impl,
    ),
]


__all__ = ["path_impl"]
