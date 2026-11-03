#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The loop projection corpus (``east/test/loop_projection_corpus.spec.ts``),
run here and held to TypeScript's answers and segment counts (#1112).

TypeScript writes loops over a paged input, each with the projection its body
admits, and the piece programs of #1093's benchmark queries, each inside a
function that collects what it emits. This runtime compiles a program with
east-c's compiler, whose paged loop infers the projection; east-c's own test
checks the type it infers for each loop. What is asserted here is that a
program compiled through this runtime meets its inputs paged, as a runner
opens them, and decodes as many segments projected and whole as TypeScript's
did, with the same answer.

The corpus is read from ``$EAST_TEST_IR_DIR/loop_projection``, which the root
``paths.mk`` sets when the run goes through make; ``make test-export`` in
libs/east writes it beside the compliance IR. Without it the tests skip — the
local default. CI sets ``EAST_CONFORMANCE_REQUIRED=1``, under which a missing
corpus is a collection error.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from east.runtime._compiler_eastc import open_paged_value_view

from east.runtime.compiler import compile_from_beast2, eager_stats
from east.serialization.beast2 import decode_beast2_with_header_for, read_beast2_type
from east.utils.ordering import equal_for

_TEST_IR_DIR = os.environ.get("EAST_TEST_IR_DIR")
CORPUS_DIR = Path(_TEST_IR_DIR) / "loop_projection" if _TEST_IR_DIR else None
CORPUS_WHERE = str(CORPUS_DIR) if CORPUS_DIR else "EAST_TEST_IR_DIR, which is unset (run it through make)"
REQUIRED = os.environ.get("EAST_CONFORMANCE_REQUIRED") == "1"

if REQUIRED and not (CORPUS_DIR and (CORPUS_DIR / "loops.beast2").exists()):
    raise RuntimeError(
        f"EAST_CONFORMANCE_REQUIRED=1 but no loop projection corpus in {CORPUS_WHERE} "
        "(`make test-export` in libs/east)")


def _cases(name: str) -> list:
    if CORPUS_DIR is None:
        return []
    path = CORPUS_DIR / f"{name}.beast2"
    if not path.exists():
        return []
    data = path.read_bytes()
    return list(decode_beast2_with_header_for(read_beast2_type(data))(data))


LOOPS = _cases("loops")
PIECES = _cases("pieces")


def _run(fn_blob, blobs, result_blob):
    """Runs a case's function over its inputs opened paged and frozen, as a
    runner opens a task's inputs: its answer, TypeScript's, and the segments
    its loops decoded projected and whole."""
    fn = compile_from_beast2(bytes(fn_blob))
    inputs = []
    for blob in blobs:
        opened = open_paged_value_view(read_beast2_type(bytes(blob)), bytes(blob), frozen=True)
        assert opened is not None, "the input opens paged"
        inputs.append(opened)
    before = eager_stats()
    got = fn(*inputs)
    after = eager_stats()
    t = read_beast2_type(bytes(result_blob))
    want = decode_beast2_with_header_for(t)(bytes(result_blob))
    assert equal_for(t)(got, want), "the answer is TypeScript's"
    return (after["beast2_paged_loop_segments_projected"] - before["beast2_paged_loop_segments_projected"],
            after["beast2_paged_loop_segments_whole"] - before["beast2_paged_loop_segments_whole"])


@pytest.mark.skipif(not LOOPS, reason=f"no loop projection corpus in {CORPUS_WHERE}")
@pytest.mark.parametrize("case", LOOPS, ids=[c["name"] for c in LOOPS])
def test_a_loop_decodes_its_segments_as_typescript_did(case):
    segments = case["segments"]
    projected = case["projected"].type == "some"
    counted = _run(case["fn"], [case["input"]], case["result"])
    assert counted == ((segments, 0) if projected else (0, segments)), \
        "projected where TypeScript inferred a projection, whole where it declined"


@pytest.mark.skipif(not PIECES, reason=f"no loop projection corpus in {CORPUS_WHERE}")
@pytest.mark.parametrize("case", PIECES, ids=[c["name"] for c in PIECES])
def test_a_benchmark_piece_decodes_its_segments_as_typescript_did(case):
    counted = _run(case["fn"], list(case["inputs"]), case["result"])
    assert counted == (case["projected"], case["whole"])
