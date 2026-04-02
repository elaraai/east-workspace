#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Setuptools build script with optional Cython C extensions.

Discovers .pyx files under src/east_py_datascience/ and compiles them against
east-c (via east-py's build artifacts). Falls back to pure Python if
compilation fails.
"""

from __future__ import annotations

import os
from pathlib import Path

from setuptools import Extension, setup
from setuptools.command.build_ext import build_ext


class OptionalBuildExt(build_ext):
    """build_ext that treats compilation failure as non-fatal."""

    def run(self):
        try:
            super().run()
        except Exception as exc:
            print(f"Warning: Cython extension compilation failed ({exc}), using pure Python")

    def build_extension(self, ext):
        try:
            super().build_extension(ext)
        except Exception as exc:
            print(f"Warning: Failed to compile {ext.name} ({exc}), skipping")


def get_ext_modules():
    """Discover .pyx files and cythonize them."""
    try:
        from Cython.Build import cythonize
    except ImportError:
        print("Warning: Cython not available, skipping extension compilation")
        return []

    package_root = Path(__file__).parent
    src_dir = package_root / "src" / "east_py_datascience"
    pyx_files = sorted(src_dir.rglob("*.pyx"))

    if not pyx_files:
        return []

    try:
        from east._build_info import (
            get_east_pxd_dir,
            get_eastc_extra_objects,
            get_eastc_include_dirs,
        )

        include_dirs = get_eastc_include_dirs()
        extra_objects = get_eastc_extra_objects()
        pxd_dir = get_east_pxd_dir()
    except ImportError:
        print("Warning: east-py not installed, cannot build C extensions")
        return []

    if not include_dirs or not extra_objects:
        print("Warning: east-c not built, skipping C extensions")
        return []

    import numpy

    extensions = []
    for pyx_path in pyx_files:
        rel_path = pyx_path.relative_to(package_root / "src")
        module_name = str(rel_path.with_suffix("")).replace(os.sep, ".")

        ext = Extension(
            module_name,
            [str(pyx_path.relative_to(package_root))],
            include_dirs=list(include_dirs) + [pxd_dir, numpy.get_include()],
            extra_objects=list(extra_objects),
            libraries=["m"],
        )
        extensions.append(ext)

    exts = cythonize(
        extensions,
        include_path=[pxd_dir],
        compiler_directives={
            "language_level": 3,
            "boundscheck": False,
            "wraparound": False,
        },
    )
    for ext in exts:
        ext.sources = [os.path.relpath(s, package_root) for s in ext.sources]
        orig = next((e for e in extensions if e.name == ext.name), None)
        if orig:
            ext.extra_objects = orig.extra_objects
            ext.include_dirs = orig.include_dirs
            ext.libraries = orig.libraries
    return exts


setup(
    ext_modules=get_ext_modules(),
    cmdclass={"build_ext": OptionalBuildExt},
)
