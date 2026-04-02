#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Setuptools build script with optional Cython acceleration.

Discovers all .pyx files under east/ and compiles them to C extensions.
If compilation fails (e.g. no C compiler), falls back to pure Python
with no error — the import shims in each .py module handle the fallback.

Files named *_eastc.pyx (and _eastc_bridge.pyx) are linked against east-c,
which is fetched and built via CMake automatically.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from setuptools import Extension, setup
from setuptools.command.build_ext import build_ext


def build_eastc():
    """Build east-c via CMake and return (include_dirs, extra_objects).

    Returns None if CMake is not available or the build fails.
    """
    package_root = Path(__file__).parent
    cmake_src = package_root / "cmake"
    build_dir = package_root / "build" / "eastc"

    if not cmake_src.exists():
        return None

    try:
        cmake_args = [
            "cmake",
            "-B", str(build_dir),
            "-S", str(cmake_src),
            "-DEAST_USE_MIMALLOC=OFF",
            "-DBUILD_TESTING=OFF",
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
        ]
        # Pass EAST_C_SOURCE_DIR through to CMake if set
        east_c_src = os.environ.get("EAST_C_SOURCE_DIR")
        if east_c_src:
            cmake_args.append(f"-DEAST_C_SOURCE_DIR={east_c_src}")
        # If build_dir already exists with a stale cache, remove it
        cache_file = build_dir / "CMakeCache.txt"
        if cache_file.exists() and east_c_src:
            import re
            cache_text = cache_file.read_text()
            m = re.search(r'FETCHCONTENT_SOURCE_DIR_EAST-C:PATH=(.*)', cache_text)
            if m and m.group(1) != east_c_src:
                import shutil
                shutil.rmtree(build_dir)
        elif cache_file.exists() and not east_c_src:
            pass  # reuse existing cache
        subprocess.run(
            cmake_args,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["cmake", "--build", str(build_dir), "--parallel"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        print(f"Warning: east-c CMake build failed ({exc}), east-c extensions will be skipped")
        return None

    # Find the built static libraries
    eastc_lib = _find_static_lib(build_dir, "east-c")
    pcre2_lib = _find_static_lib(build_dir, "pcre2-8")

    if eastc_lib is None:
        print("Warning: libeast-c not found after CMake build")
        return None

    # Find include directory from the fetched source
    include_dirs = []
    for candidate in build_dir.rglob("include/east/types.h"):
        include_dirs.append(str(candidate.parent.parent))
        break

    if not include_dirs:
        # Try the _deps source directory (FetchContent layout)
        deps_dir = build_dir / "_deps" / "east-c-src" / "packages" / "east-c" / "include"
        if deps_dir.exists():
            include_dirs.append(str(deps_dir))

    if not include_dirs:
        # Try EAST_C_SOURCE_DIR (local checkout via FETCHCONTENT_SOURCE_DIR)
        east_c_src = os.environ.get("EAST_C_SOURCE_DIR", "")
        local_inc = Path(east_c_src) / "packages" / "east-c" / "include" if east_c_src else None
        if local_inc and local_inc.exists():
            include_dirs.append(str(local_inc))

    if not include_dirs:
        print("Warning: east-c include directory not found")
        return None

    extra_objects = [str(eastc_lib)]
    if pcre2_lib is not None:
        extra_objects.append(str(pcre2_lib))

    return include_dirs, extra_objects


def _find_static_lib(build_dir, name):
    """Find a static library (.a or .lib) by name under build_dir."""
    for pattern in [f"lib{name}.a", f"{name}.lib", f"lib{name}.lib"]:
        matches = list(build_dir.rglob(pattern))
        if matches:
            return matches[0]
    return None


class OptionalBuildExt(build_ext):
    """build_ext that treats compilation failure as non-fatal.

    If the C compiler is unavailable or compilation fails for any reason,
    the package installs as pure Python. The Cython import shims (e.g.
    ``with contextlib.suppress(ImportError): from ._foo_cy import ...``)
    will simply not find the .so files and use the Python fallback.
    """

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

    east_dir = Path(__file__).parent / "east"
    pyx_files = sorted(east_dir.rglob("*.pyx"))

    if not pyx_files:
        return []

    # Try to build east-c (returns None if unavailable)
    eastc_info = build_eastc()

    package_root = Path(__file__).parent
    extensions = []
    for pyx_path in pyx_files:
        rel_path = pyx_path.relative_to(package_root)
        module_name = str(rel_path.with_suffix("")).replace(os.sep, ".")
        stem = pyx_path.stem

        # Check if this extension needs east-c linking
        needs_eastc = stem.endswith("_eastc") or stem in ("_eastc_bridge", "_platform_bridge")

        if needs_eastc and eastc_info is None:
            print(f"Warning: Skipping {module_name} (east-c not available)")
            continue

        ext = Extension(module_name, [str(rel_path)])

        if needs_eastc:
            import numpy
            include_dirs, extra_objects = eastc_info
            ext.include_dirs = list(include_dirs) + [numpy.get_include()]
            ext.extra_objects = list(extra_objects)
            ext.libraries = ["m"]

        extensions.append(ext)

    exts = cythonize(
        extensions,
        compiler_directives={
            "language_level": 3,
            "boundscheck": False,
            "wraparound": False,
        },
    )
    # cythonize() can produce absolute paths for generated .c files,
    # which breaks wheel builds from sdists. Relativize them.
    for ext in exts:
        ext.sources = [os.path.relpath(s, package_root) for s in ext.sources]
        # Preserve extra_objects and include_dirs from the original extension
        orig = next((e for e in extensions if e.name == ext.name), None)
        if orig and orig.extra_objects:
            ext.extra_objects = orig.extra_objects
        if orig and orig.include_dirs:
            ext.include_dirs = orig.include_dirs
        if orig and orig.libraries:
            ext.libraries = orig.libraries
    return exts


setup(
    ext_modules=get_ext_modules(),
    cmdclass={"build_ext": OptionalBuildExt},
)
