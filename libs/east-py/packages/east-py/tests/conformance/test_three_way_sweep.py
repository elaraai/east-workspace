#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The three-way sweep (#628): IR₁ → python → IR₂ → TypeScript → IR₃.

For every program of the exported TypeScript compliance corpus and every
exported ``*.examples.ts`` example (the same inputs as
``test_ts_py_roundtrip``):

    IR₁ (TS)  → east.codegen.to_python_source → East.function → IR₂
    IR₂       → east-node transpile (East.toSource) → East.function → IR₃

and IR₁ ≡ IR₂ ≡ IR₃ under ``east-c ir normalize`` (``diff_ir``) — the
epic's acceptance criterion: the two printers and the two builders agree
on one IR, so a program authored in either language crosses to the other
and back without loss. Every runnable example's IR₃ also executes on
east-c (through the python bridge) and must compute its declared
``returns``; the TypeScript codegen spec executes the same rebuilt
programs on east-node, and ``test_ts_py_roundtrip`` executes IR₂ here.

The TypeScript leg runs once for the whole sweep: every IR₂ is written to
a directory (as IR JSON, the form ``east-node`` reads) and one ``east-node
transpile <dir> -o <ts> --rebuild <ir3>`` prints and rebuilds them all,
each IR₃ coming back as a beast2 IR bundle. The CLI is found at ``EAST_NODE_CLI`` (the
path of ``bin/east-node.mjs`` or an installed ``east-node``), else on
``PATH``; without it the sweep SKIPS — the local default. CI sets
``EAST_SWEEP_REQUIRED=1``, under which a missing CLI is a collection
error. ``EAST_CONFORMANCE_SAVE=<dir>`` keeps every printed TypeScript
module under ``<dir>/ts``.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from east.runtime._compiler_eastc import diff_ir

from east.serialization.beast2 import decode_beast2_with_header_for
from east.serialization.json import encode_json_for
from east.types.type_of_type import IRType
from tests.conformance.test_ts_py_roundtrip import CORPUS, EXAMPLES, SAVE_DIR, _load, _rebuild

EAST_NODE = os.environ.get("EAST_NODE_CLI") or shutil.which("east-node")
REQUIRED = os.environ.get("EAST_SWEEP_REQUIRED") == "1"

if REQUIRED and not EAST_NODE:
    raise RuntimeError(
        "EAST_SWEEP_REQUIRED=1 but no east-node CLI: set EAST_NODE_CLI to "
        "libs/east-node/packages/east-node-cli/bin/east-node.mjs (built) or put east-node on PATH")

PROGRAMS: list[tuple[str, str]] = (
    [(f"corpus/{os.path.basename(p)[:-5]}", p) for p in CORPUS]
    + [(f"examples/{os.path.basename(os.path.dirname(p))}/{os.path.basename(p)[:-5]}", p) for p in EXAMPLES])


def _east_node(*args: str) -> list[str]:
    """The ``east-node`` command line: ``node <bin.mjs>`` or the installed binary."""
    assert EAST_NODE is not None
    if EAST_NODE.endswith((".mjs", ".js")):
        return ["node", EAST_NODE, *args]
    return [EAST_NODE, *args]


def _stem(label: str) -> str:
    return label.replace("/", "__")


@pytest.fixture(scope="session")
def sweep(tmp_path_factory):
    """Every program's (record, IR₁, IR₂) plus the directories of the TypeScript leg."""
    root = tmp_path_factory.mktemp("three-way")
    ir2_dir, ts_dir, ir3_dir = root / "ir2", root / "ts", root / "ir3"
    ir2_dir.mkdir()
    encode = encode_json_for(IRType)
    programs: dict[str, tuple[dict, object, object]] = {}
    for label, path in PROGRAMS:
        raw, ir1 = _load(path)
        built, _source = _rebuild(ir1, label)
        ir2 = built._east_ir
        encoded = encode(ir2)
        (ir2_dir / f"{_stem(label)}.json").write_bytes(
            encoded if isinstance(encoded, bytes) else encoded.encode("utf-8"))
        programs[label] = (raw, ir1, ir2)
    result = subprocess.run(
        _east_node("transpile", str(ir2_dir), "-o", str(ts_dir), "--rebuild", str(ir3_dir)),
        capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, f"east-node transpile failed:\n{result.stdout}\n{result.stderr}"
    if SAVE_DIR:
        shutil.copytree(ts_dir, Path(SAVE_DIR) / "ts", dirs_exist_ok=True)
    return programs, ts_dir, ir3_dir


@pytest.mark.skipif(not EAST_NODE, reason="no east-node CLI (EAST_NODE_CLI unset, east-node not on PATH)")
@pytest.mark.skipif(not PROGRAMS, reason="no exported IR corpus or examples")
@pytest.mark.parametrize("label", [label for label, _ in PROGRAMS])
def test_three_way(label, sweep):
    programs, ts_dir, ir3_dir = sweep
    raw, ir1, ir2 = programs[label]
    stem = _stem(label)
    source = (ts_dir / f"{stem}.ts").read_text(encoding="utf-8")
    assert "East.function(" in source or "East.asyncFunction(" in source, f"{label}: no builder in the printed module"

    ir3 = decode_beast2_with_header_for(IRType)((ir3_dir / f"{stem}.beast2").read_bytes())
    diff = diff_ir(ir1, ir3)
    assert diff is None, f"{label}: IR₁ (TypeScript) ≠ IR₃ (python → TypeScript) at {diff}"
    diff = diff_ir(ir2, ir3)
    assert diff is None, f"{label}: IR₂ (python) ≠ IR₃ (python → TypeScript) at {diff}"

    if not label.startswith("examples/"):
        return
    if raw.get("async") or raw.get("returns") is None or any(v is None for v in raw["inputs"]):
        return  # no plain-value inputs/expected answer to run against
    if _uses_platform(ir3):
        return  # needs platform implementations
    from east.runtime.compiler import compile_from_value
    from east.serialization.json import decode_json_for
    from east.types.type_of_type import EastTypeType
    from east.utils.ordering import equal_for

    input_types = [decode_json_for(EastTypeType)(json.dumps(t)) for t in raw["input_types"]]
    output_type = decode_json_for(EastTypeType)(json.dumps(raw["output_type"]))
    inputs = [decode_json_for(t)(json.dumps(v)) for t, v in zip(input_types, raw["inputs"], strict=True)]
    expected = decode_json_for(output_type)(json.dumps(raw["returns"]))
    got = compile_from_value(ir3, [])(*inputs)
    assert equal_for(output_type)(got, expected), f"{label}: IR₃ computed {got!r}, the example declares {expected!r}"


def _uses_platform(ir) -> bool:
    """Whether an IR value holds a Platform node (needs implementations to run)."""
    from east.serialization.json import encode_json_for

    encoded = encode_json_for(IRType)(ir)
    text = encoded.decode("utf-8") if isinstance(encoded, bytes) else encoded
    return '"Platform"' in text
