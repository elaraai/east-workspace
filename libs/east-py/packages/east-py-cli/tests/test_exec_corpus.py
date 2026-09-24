#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py exec``, held to the runner protocol's conformance corpus
(``east/test/runner_corpus.spec.ts``).

Each case is a directory — ``unit.beast2`` beside the files it names, under
relative paths — and a ``case.beast2`` naming what executing it must come to:
the outcome, every file the unit writes besides its result, byte for byte,
and paths it must not write. Every case is copied and executed with ``exec``,
with every collection input opened lazily when the case asks, and held to
TypeScript's outputs and outcome — as east-node's and east-c's runners are.

The corpus is read from ``$EAST_TEST_IR_DIR/runner_corpus`` (default
``/tmp/east-test-ir``), where ``make test-export`` in libs/east writes it
beside the compliance IR. Without it the tests skip — the local default. CI
sets ``EAST_CONFORMANCE_REQUIRED=1``, under which a missing corpus is a
collection error.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from east.serialization.beast2 import decode_beast2_with_header_for, read_beast2_type
from east.utils.ordering import equal_for

CORPUS_DIR = Path(os.environ.get("EAST_TEST_IR_DIR", "/tmp/east-test-ir")) / "runner_corpus"
REQUIRED = os.environ.get("EAST_CONFORMANCE_REQUIRED") == "1"

if REQUIRED and not (CORPUS_DIR / "index.beast2").exists():
    raise RuntimeError(
        f"EAST_CONFORMANCE_REQUIRED=1 but no runner corpus in {CORPUS_DIR} "
        "(`make test-export` in libs/east, or set EAST_TEST_IR_DIR)")


def _decode(path: Path):
    data = path.read_bytes()
    t = read_beast2_type(data)
    return t, decode_beast2_with_header_for(t)(data)


CASES = list(_decode(CORPUS_DIR / "index.beast2")[1]) if (CORPUS_DIR / "index.beast2").exists() else []


@pytest.mark.skipif(not CASES, reason=f"no runner corpus in {CORPUS_DIR}")
@pytest.mark.parametrize("name", CASES)
def test_a_unit_comes_to_typescripts_outputs_and_outcome(name, tmp_path):
    case_type, case = _decode(CORPUS_DIR / name / "case.beast2")
    # A copy per case: a unit writes beside itself.
    unit_dir = tmp_path / name
    shutil.copytree(CORPUS_DIR / name, unit_dir)
    env = {**os.environ}
    if case["lazy"]:
        env["EAST_LAZY_INPUT_BYTES"] = "1"
    proc = subprocess.run(
        [sys.executable, "-m", "east_py_cli", "exec", str(unit_dir / "unit.beast2")],
        env=env, capture_output=True, text=True,
    )
    ok = case["outcome"].type == "ok"
    assert proc.returncode == (0 if ok else 1), proc.stderr

    _, result = _decode(unit_dir / "result.beast2")
    outcome_type = next(f["type"] for f in case_type.value if f["name"] == "outcome")
    assert equal_for(outcome_type)(result["outcome"], case["outcome"]), \
        f"the outcome {result['outcome']!r}, expected {case['outcome']!r}"
    assert result["peakBytes"] > 0, "the peak is measured"
    for output in case["outputs"]:
        path = unit_dir / output["path"]
        assert path.exists(), f"{output['path']} is written"
        assert path.read_bytes() == bytes(output["bytes"]), output["path"]
    for path in case["absent"]:
        assert not (unit_dir / path).exists(), f"{path} is not written"


def test_a_unit_that_cannot_be_read_leaves_no_result_and_exits_2(tmp_path):
    garbage = tmp_path / "garbage.beast2"
    garbage.write_bytes(b"not a unit")
    proc = subprocess.run(
        [sys.executable, "-m", "east_py_cli", "exec", str(garbage)], capture_output=True, text=True,
    )
    assert proc.returncode == 2
    assert proc.stderr.startswith(f"Error: exec {garbage}: ")
