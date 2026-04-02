#!/usr/bin/env python3
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
"""Check and fix license headers in Python files."""

import sys
from pathlib import Path

HEADER_LINES = [
    "# Copyright (c) 2025 Elara AI Pty Ltd",
    "# Licensed under the Business Source License 1.1. See LICENSE.md for details.",
]

PACKAGES = [
    "packages/east-py/east",
    "packages/east-py-std/east_py_std",
    "packages/east-py-io/east_py_io",
    "packages/east-py-cli/east_py_cli",
    "packages/east-py-datascience/src/east_py_datascience",
    "packages/east-py/tests",
    "packages/east-py-std/tests",
    "packages/east-py-io/tests",
    "packages/east-py-datascience/tests",
]


def has_header(content: str) -> bool:
    """Check if file has the license header."""
    lines = content.split("\n")
    # Skip shebang if present
    start = 1 if lines and lines[0].startswith("#!") else 0
    # Skip blank lines and comment block opener
    while start < len(lines) and lines[start].strip() in ("", "#"):
        start += 1
    # Check header lines
    for i, header_line in enumerate(HEADER_LINES):
        if start + i >= len(lines) or lines[start + i].strip() != header_line.strip():
            return False
    return True


def add_header(content: str) -> str:
    """Add license header to file content."""
    header = "#\n" + "\n".join(HEADER_LINES) + "\n#\n"
    lines = content.split("\n")
    if lines and lines[0].startswith("#!"):
        return lines[0] + "\n" + header + "\n".join(lines[1:])
    return header + content


def main() -> int:
    fix = "--fix" in sys.argv
    root = Path(__file__).parent.parent
    missing = []

    for pkg in PACKAGES:
        pkg_path = root / pkg
        if not pkg_path.exists():
            continue
        for py_file in pkg_path.rglob("*.py"):
            if "__pycache__" in str(py_file):
                continue
            content = py_file.read_text()
            if not content.strip():
                continue
            if not has_header(content):
                rel_path = py_file.relative_to(root)
                missing.append((py_file, rel_path))
                if fix:
                    py_file.write_text(add_header(content))
                    print(f"Fixed: {rel_path}")
                else:
                    print(f"Missing header: {rel_path}")

    if missing and not fix:
        print(f"\n{len(missing)} file(s) missing license headers.")
        print("Run with --fix to add headers automatically.")
        return 1
    if not missing:
        print("All files have license headers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
