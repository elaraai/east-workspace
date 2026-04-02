#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Build info for downstream Cython extensions that link against east-c.

Downstream packages (east-py-std, east-py-datascience, etc.) call these
functions from their setup.py to find east-c headers and libraries.

Usage in a downstream setup.py:
    from east._build_info import get_eastc_include_dirs, get_eastc_extra_objects
    ext.include_dirs = get_eastc_include_dirs()
    ext.extra_objects = get_eastc_extra_objects()
"""

from __future__ import annotations

import os
from pathlib import Path


def _get_east_package_root() -> Path:
    """Return the root of the east-py package (where setup.py lives)."""
    return Path(__file__).parent.parent


def _find_static_lib(build_dir: Path, name: str) -> Path | None:
    """Find a static library by name under build_dir."""
    for pattern in [f"lib{name}.a", f"{name}.lib", f"lib{name}.lib"]:
        matches = list(build_dir.rglob(pattern))
        if matches:
            return matches[0]
    return None


def get_eastc_include_dirs() -> list[str]:
    """Return include directories for east-c headers.

    Searches the build directory and EAST_C_SOURCE_DIR for headers.
    """
    package_root = _get_east_package_root()
    build_dir = package_root / "build" / "eastc"

    include_dirs = []

    # Try rglob for the header in the build tree
    for candidate in build_dir.rglob("include/east/types.h"):
        include_dirs.append(str(candidate.parent.parent))
        break

    if not include_dirs:
        deps_dir = build_dir / "_deps" / "east-c-src" / "packages" / "east-c" / "include"
        if deps_dir.exists():
            include_dirs.append(str(deps_dir))

    if not include_dirs:
        east_c_src = os.environ.get("EAST_C_SOURCE_DIR", "")
        local_inc = Path(east_c_src) / "packages" / "east-c" / "include" if east_c_src else None
        if local_inc and local_inc.exists():
            include_dirs.append(str(local_inc))

    return include_dirs


def get_eastc_extra_objects() -> list[str]:
    """Return static library paths for linking against east-c."""
    package_root = _get_east_package_root()
    build_dir = package_root / "build" / "eastc"

    extra_objects = []

    eastc_lib = _find_static_lib(build_dir, "east-c")
    if eastc_lib:
        extra_objects.append(str(eastc_lib))

    pcre2_lib = _find_static_lib(build_dir, "pcre2-8")
    if pcre2_lib:
        extra_objects.append(str(pcre2_lib))

    return extra_objects


def get_east_pxd_dir() -> str:
    """Return the directory containing east's .pxd files (for cimport)."""
    return str(Path(__file__).parent.parent)
