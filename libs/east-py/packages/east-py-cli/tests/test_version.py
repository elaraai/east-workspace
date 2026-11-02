#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py version``: each package's version as its installed distribution
records it, which a release sets — e3's export cache keys a package's
manifests on what it prints, so another east-py exports them again (#1459)."""

from __future__ import annotations

import importlib.metadata
import subprocess
import sys


def _version(*args: str) -> list[str]:
    result = subprocess.run([sys.executable, "-m", "east_py_cli", "version", *args],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    return result.stdout.splitlines()


def test_version_names_the_installed_east_py_cli_and_east_py():
    lines = _version()
    assert lines[0] == f"east-py-cli {importlib.metadata.version('elaraai-east-py-cli')}"
    assert lines[1].startswith(f"east-py {importlib.metadata.version('elaraai-east-py')} ("), lines


def test_version_names_each_platform_package_by_its_distribution():
    lines = _version("-p", "east-py-std")
    std = f"  east-py-std {importlib.metadata.version('elaraai-east-py-std')} ("
    assert any(line.startswith(std) for line in lines), lines
