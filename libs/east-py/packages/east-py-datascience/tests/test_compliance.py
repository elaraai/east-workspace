#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compliance tests: replay the TypeScript-exported IR through the datascience platform.

One pytest case per exported IR file, each run through the core compliance
runner (``packages/east-py/tests/test_compliance.py``) in its own subprocess,
exactly as CI does; the fresh process per file keeps the ML libraries' global
state from leaking between suites. Export the IR first (``make test-export``
in this package, into ``EAST_DATASCIENCE_IR_DIR``, which the root
``paths.mk`` sets); with no IR directory the cases skip.
"""

import importlib.util
import os
from pathlib import Path

import pytest

_CORE_RUNNER = Path(__file__).resolve().parents[2] / "east-py" / "tests" / "test_compliance.py"
_spec = importlib.util.spec_from_file_location("east_core_compliance", _CORE_RUNNER)
assert _spec is not None and _spec.loader is not None
_core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_core)

_IR = os.environ.get("EAST_DATASCIENCE_IR_DIR")
IR_DIR: Path | None = Path(_IR) if _IR else None
IR_FILES: list[Path] = _core.get_test_ir_files(IR_DIR) if IR_DIR else []

if not IR_FILES:
    pytestmark = pytest.mark.skip(
        reason=f"no exported IR under {IR_DIR}; run `make test-export`" if IR_DIR
        else "EAST_DATASCIENCE_IR_DIR is unset: run it through make (make test)")


@pytest.mark.parametrize("ir_file", IR_FILES, ids=[f.stem for f in IR_FILES])
def test_exported_ir(ir_file: Path) -> None:
    """Every test in the exported suite passes against ``east_py_datascience.platform``."""
    assert IR_DIR is not None
    result = _core.run_one_in_subprocess(ir_file, IR_DIR, ["east_py_datascience"], timeout=900)
    assert result.returncode == 0, result.stdout + result.stderr
