#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Streaming execution (``--emit`` / ``--stream``) through ``run_program``.

The IR fixtures in ``tests/fixtures`` are generated from the TypeScript side
by ``libs/east-c/packages/east-c-cli/tests/generate_fixtures.mjs`` and mirror
``east-node-cli/src/runner.spec.ts``, so all three runners are pinned against
the same programs. ``events.beast2`` is written by the TS paged writer, which
makes the stream-fold case a cross-runtime decode of TS-writer bytes.

These cases exercise the whole seam end to end: ``_EmitSink`` (batching, the
strictly-ascending check, output validation), the ``foreign_function_value``
bridge that passes the sink's ``emit`` into the compiled body, and
``Beast2FileWriter`` finalization (terminator + index + footer).
"""

from pathlib import Path

import pytest
from east import ArrayType, DictType, IntegerType, StringType
from east.runtime.errors import EastError
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    open_beast2_pages_for,
    read_beast2_index,
)

from east_py_cli.runner import run_program

FIXTURES = Path(__file__).parent / "fixtures"
INT_ARRAY = ArrayType(IntegerType)
INT_STR_DICT = DictType(IntegerType, StringType)


def test_producer_emits_indexed_array(tmp_path):
    out = tmp_path / "out.beast2"
    run_program(FIXTURES / "emit_producer.beast2", [], [], [], out, emit="array")

    blob = out.read_bytes()
    index = read_beast2_index(INT_ARRAY, blob)
    assert index is not None and index[1] == 2500

    pages = open_beast2_pages_for(INT_ARRAY)(blob)
    assert pages.element_count == 2500
    assert pages.self_contained
    assert pages.element(1234) == 2468

    decoded = list(decode_beast2_with_header_for(INT_ARRAY)(blob))
    assert decoded == [2 * i for i in range(2500)]


def test_stream_fold_reads_ts_written_input(tmp_path):
    out = tmp_path / "out.beast2"
    run_program(
        FIXTURES / "emit_fold.beast2",
        [],
        [],
        [FIXTURES / "events.beast2"],
        out,
        emit="array",
        stream_input=0,
    )

    sums = list(decode_beast2_with_header_for(INT_ARRAY)(out.read_bytes()))
    assert len(sums) == 2500
    assert sums[0] == 0
    assert sums[99] == 99 * 100 // 2
    assert sums[-1] == 2499 * 2500 // 2


def test_threshold_forces_the_lazy_input_path(tmp_path, monkeypatch):
    # A 1-byte threshold lazily opens EVERY indexed collection input, so this
    # run and the (eager, threshold-disabled) control must agree — the paged
    # value kind is observationally equivalent to the whole decode (#505).
    out_lazy = tmp_path / "lazy.beast2"
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "1")
    run_program(
        FIXTURES / "emit_fold.beast2", [], [], [FIXTURES / "events.beast2"], out_lazy, emit="array"
    )
    out_eager = tmp_path / "eager.beast2"
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "0")
    run_program(
        FIXTURES / "emit_fold.beast2", [], [], [FIXTURES / "events.beast2"], out_eager, emit="array"
    )
    assert out_lazy.read_bytes() == out_eager.read_bytes()


def test_dict_emit_decodes_with_index(tmp_path):
    out = tmp_path / "out.beast2"
    run_program(FIXTURES / "emit_dict.beast2", [], [], [], out, emit="dict")

    blob = out.read_bytes()
    index = read_beast2_index(INT_STR_DICT, blob)
    assert index is not None and index[1] == 1000

    table = decode_beast2_with_header_for(INT_STR_DICT)(blob)
    assert len(table) == 1000
    assert table[42] == "row-42"


def test_dict_emit_rejects_out_of_order_keys(tmp_path):
    with pytest.raises(EastError, match="strictly ascending in East key order"):
        run_program(
            FIXTURES / "emit_dict_disorder.beast2", [], [], [], tmp_path / "out.beast2", emit="dict"
        )


def test_emit_requires_beast2_output(tmp_path):
    with pytest.raises(ValueError, match=r"--emit requires a \.beast2 output file"):
        run_program(FIXTURES / "emit_producer.beast2", [], [], [], tmp_path / "out.json", emit="array")


def test_emit_kind_must_match_the_emit_parameter_arity(tmp_path):
    with pytest.raises(ValueError, match=r"2 argument\(s\), got 1"):
        run_program(FIXTURES / "emit_producer.beast2", [], [], [], tmp_path / "out.beast2", emit="dict")
