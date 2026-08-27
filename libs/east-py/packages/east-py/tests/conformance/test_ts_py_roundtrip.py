#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The IR → python → IR round trip (#627).

For every program of the exported TypeScript compliance corpus
(``/tmp/east-test-ir``, ``make test-export`` in libs/east) and every
exported ``*.examples.ts`` example (``/tmp/east-examples-ir``, ``npm run
export:examples``):

    IR₁ → east.codegen.to_python_source → python module → East.function → IR₂

and IR₂ must equal IR₁ under ``east-c ir normalize`` (loc_ids stripped,
names canonical, captures recomputed, recursive ids renumbered) — the one
equality contract, implemented once in east-c and reached here through the
bridge. Execution is checked too: an example's rebuilt function computes
its declared ``returns``; a corpus program's rebuilt IR passes the same
compliance run as the original.

Set ``EAST_CONFORMANCE_SAVE=<dir>`` to keep every printed module.

Structural equality under the normalizer already IS identical execution
(the same nodes, types and builtins, resolved by the same names), so the
corpus programs' compliance-run comparison — two full test-suite runs per
program, ~12 minutes over the corpus — is opt-in: ``EAST_CONFORMANCE_EXECUTE=1``
(``make test-conformance`` sets it). The examples always execute (fast).
"""

from __future__ import annotations

import glob
import io
import json
import os
from pathlib import Path

import pytest
from east.runtime._compiler_eastc import diff_ir

from east.codegen import to_python_source
from east.serialization.json import decode_json_for, encode_json_for
from east.types.type_of_type import IRType

CORPUS_DIR = os.environ.get("EAST_TEST_IR_DIR", "/tmp/east-test-ir")
EXAMPLES_DIR = os.environ.get("EAST_EXAMPLES_IR_DIR", "/tmp/east-examples-ir")
SAVE_DIR = os.environ.get("EAST_CONFORMANCE_SAVE")
EXECUTE_CORPUS = os.environ.get("EAST_CONFORMANCE_EXECUTE") == "1"

CORPUS = sorted(glob.glob(os.path.join(CORPUS_DIR, "*.json")))
EXAMPLES = sorted(glob.glob(os.path.join(EXAMPLES_DIR, "*", "*.json")))


def _rebuild(ir, label: str):
    """Print ``ir`` as python, build the module, return the rebuilt IR."""
    source = to_python_source(ir, name="main")
    if SAVE_DIR:
        out = Path(SAVE_DIR) / f"{label}.py"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(source, encoding="utf-8")
    namespace: dict = {}
    exec(compile(source, f"<{label}>", "exec"), namespace)
    return namespace["main"], source


def _load(path: str):
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return raw, decode_json_for(IRType)(json.dumps(raw["ir"]))


# ── the compliance corpus ────────────────────────────────────────────────────


@pytest.mark.skipif(not CORPUS, reason=f"no exported IR corpus in {CORPUS_DIR}")
@pytest.mark.parametrize("path", CORPUS, ids=[os.path.basename(f) for f in CORPUS])
def test_corpus_program_round_trips(path, tmp_path):
    _raw, ir = _load(path)
    built, _source = _rebuild(ir, "corpus/" + os.path.basename(path)[:-5])
    rebuilt = built._east_ir
    diff = diff_ir(ir, rebuilt)
    assert diff is None, f"{os.path.basename(path)}: rebuilt IR differs at {diff}"

    if not EXECUTE_CORPUS:
        return
    # Identical execution: the two programs' compliance runs agree test by
    # test. Both run in their NORMALIZED form (loc_ids 0, no source map): a
    # handful of corpus tests compare a function's beast2 bytes against a
    # TypeScript fixture that embeds the ORIGINAL loc_ids, which no rebuilt
    # program — python's or any other runtime's — can reproduce; normalizing
    # both sides makes those tests fail identically, and every other test
    # must pass identically.
    from east.runtime._compiler_eastc import normalize_ir


    expected = _compliance_report(normalize_ir(ir), tmp_path / ("original_" + os.path.basename(path)))
    got = _compliance_report(rebuilt, tmp_path / ("rebuilt_" + os.path.basename(path)))
    assert got == expected, (
        f"compliance runs differ — original {expected[0]}, rebuilt {got[0]}; "
        f"failing tests original {sorted(expected[1] - got[1])}, rebuilt {sorted(got[1] - expected[1])}")


def _compliance_report(ir, path: Path):
    """``((passed, failed), {failing test names})`` of a program's compliance run."""
    import re

    from tests.test_compliance import run_one

    encoded = encode_json_for(IRType)(ir)
    if isinstance(encoded, bytes):
        encoded = encoded.decode("utf-8")
    path.write_text(json.dumps({"ir": json.loads(encoded), "source_map": {"stacks": []}}),
                    encoding="utf-8")
    out = io.StringIO()
    counts = run_one(path, out)
    failing = set(re.findall(r"^\s*\[x\]\s+(.+?)\s*\([\d.]+ms\)$", out.getvalue(), re.M))
    return counts, failing


# ── every exported example ───────────────────────────────────────────────────


@pytest.mark.skipif(not EXAMPLES, reason=f"no exported examples in {EXAMPLES_DIR}")
@pytest.mark.parametrize(
    "path", EXAMPLES,
    ids=[f"{os.path.basename(os.path.dirname(f))}/{os.path.basename(f)[:-5]}" for f in EXAMPLES])
def test_example_round_trips_and_runs(path):
    raw, ir = _load(path)
    label = f"examples/{raw['suite']}/{raw['name']}"
    built, _source = _rebuild(ir, label)
    diff = diff_ir(ir, built._east_ir)
    assert diff is None, f"{label}: rebuilt IR differs at {diff}"

    if raw.get("async") or raw.get("returns") is None or any(v is None for v in raw["inputs"]):
        return  # no plain-value inputs/expected answer to run against
    if getattr(built, "_east_platforms", ()):
        return  # needs platform implementations
    from east.serialization.json import decode_json_for as dec
    from east.types.type_of_type import EastTypeType

    input_types = [dec(EastTypeType)(json.dumps(t)) for t in raw["input_types"]]
    output_type = dec(EastTypeType)(json.dumps(raw["output_type"]))
    inputs = [dec(t)(json.dumps(v)) for t, v in zip(input_types, raw["inputs"], strict=True)]
    expected = dec(output_type)(json.dumps(raw["returns"]))
    got = built(*inputs)
    from east.utils.ordering import equal_for

    assert equal_for(output_type)(got, expected), f"{label}: computed {got!r}, example declares {expected!r}"
