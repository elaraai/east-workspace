#!/usr/bin/env python3
"""Stage native sources into a package's ``_vendor/`` so it builds without the
monorepo present — i.e. from a PyPI sdist or inside a cibuildwheel container,
where only the package directory is available.

Dev builds inside the monorepo don't need this: the CMakeLists locate the
sibling ``libs/east-c`` (and east-py ``.pxd``) sources directly. Run this only
when producing a publishable artifact, before ``uv build`` / cibuildwheel.

  python vendor-native.py --package libs/east-py/packages/east-py
  python vendor-native.py --package libs/east-py/packages/east-py-datascience --with-east-py-pxd
"""
import argparse
import shutil
import sys
from pathlib import Path

# east-c build artifacts and VCS noise — never part of the vendored source.
_IGNORE = shutil.ignore_patterns(
    "build", "build-*", "_deps", "__pycache__", ".git",
    "*.o", "*.a", "*.so", "*.dylib", "*.pyc",
)


def find_monorepo_root(start: Path) -> Path:
    d = start.resolve()
    while not (d / "pnpm-workspace.yaml").exists():
        if d.parent == d:
            sys.exit("vendor-native: could not locate monorepo root (pnpm-workspace.yaml)")
        d = d.parent
    return d


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--package", required=True,
                    help="package directory to vendor sources into")
    ap.add_argument("--with-east-py-pxd", action="store_true",
                    help="also vendor east-py's .pxd files (east-py-datascience needs them)")
    args = ap.parse_args()

    root = find_monorepo_root(Path(__file__).parent)
    vendor = Path(args.package).resolve() / "_vendor"
    if vendor.exists():
        shutil.rmtree(vendor)
    vendor.mkdir(parents=True)

    shutil.copytree(root / "libs/east-c/packages/east-c", vendor / "east-c", ignore=_IGNORE)
    print(f"vendor-native: east-c -> {vendor / 'east-c'}")

    if args.with_east_py_pxd:
        # Copy the .pxd declarations plus the __init__ package markers — Cython
        # needs the latter to resolve `from east cimport _eastc` as a package.
        east = root / "libs/east-py/packages/east-py/east"
        for src in sorted(east.rglob("*")):
            if src.is_file() and (src.suffix == ".pxd" or src.name in ("__init__.py", "__init__.pxd")):
                dest = vendor / "east-py" / src.relative_to(east.parent)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
        print(f"vendor-native: east-py .pxd + markers -> {vendor / 'east-py'}")


if __name__ == "__main__":
    main()
