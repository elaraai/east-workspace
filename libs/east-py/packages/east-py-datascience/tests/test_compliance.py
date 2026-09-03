#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compliance tests: replay the TypeScript-exported IR through the datascience platform.

One pytest case per exported IR file, each run through the core compliance
runner (``packages/east-py/tests/test_compliance.py``) in its own subprocess,
exactly as CI does; the fresh process per file keeps the ML libraries' global
state from leaking between suites. Export the IR first (``make test-export``
in this package); with no IR directory the cases skip.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

_CORE_RUNNER = Path(__file__).resolve().parents[2] / "east-py" / "tests" / "test_compliance.py"
_spec = importlib.util.spec_from_file_location("east_core_compliance", _CORE_RUNNER)
assert _spec is not None and _spec.loader is not None
_core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_core)

IR_DIR: Path = _core._resolve_ir_dir(
    os.environ.get("EAST_DATASCIENCE_IR_DIR", "/tmp/east-py-datascience")
)
IR_FILES: list[Path] = _core.get_test_ir_files(IR_DIR)

if not IR_FILES:
    pytestmark = pytest.mark.skip(reason=f"no exported IR under {IR_DIR}; run `make test-export`")


@pytest.mark.parametrize("ir_file", IR_FILES, ids=[f.stem for f in IR_FILES])
def test_exported_ir(ir_file: Path) -> None:
    """Every test in the exported suite passes against ``east_py_datascience.platform``."""
    result = subprocess.run(
        [
            sys.executable,
            str(_CORE_RUNNER),
            str(ir_file),
            "--ir-dir",
            str(IR_DIR),
            "-p",
            "east_py_datascience",
        ],
        capture_output=True,
        text=True,
        timeout=900,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
