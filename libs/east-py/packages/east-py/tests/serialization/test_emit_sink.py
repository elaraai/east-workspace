#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The emit sink binding (issues #560, #770).

``_EmitSinkCore`` owns one east-c library sink (``east/emit_sink.h``) — the
sink the east-c CLI runs — behind a streamTask ``emit``. Its function value's
invoke is the sink's C entry, so a compiled loop emits with zero python per
row, and batching, the ascending check, the spill/merge path and the folds all
run in C. The runner's ``_EmitSink`` validates the emit parameter and prints
the -v epilogue; these tests pin the binding's own contract: rows from a
compiled loop reach the file, the sink's exact duplicate message, the demote
to buffered emission, the merge function's signature check and wiring, and the
counters."""

import re

import pytest
from east.serialization._beast2_eastc import _EmitSinkCore

from east import (
    ArrayType,
    DictType,
    East,
    EastArray,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    SetType,
    StringType,
    StructType,
)
from east.runtime.errors import EastError
from east.serialization.beast2 import decode_beast2_with_header_for
from east.serialization.east_printer import print_type

ROW = StructType([("k", StringType), ("v", FloatType)])
STR_FLOAT = DictType(StringType, FloatType)
STR_STR = DictType(StringType, StringType)


def _concat():
    """A ``(String, String, String) -> String`` merge: the values joined in
    fold order."""
    return East.function([StringType, StringType, StringType], StringType,
                         lambda _b, _key, acc, value: acc + value)


class TestNativeRows:
    def test_a_compiled_loop_emits_with_zero_python_per_row(self, tmp_path):
        out = tmp_path / "rows.beast2"
        sink = _EmitSinkCore(2, [StringType, FloatType], out)
        emit_t = FunctionType([StringType, FloatType], NullType)
        # The streaming-projection shape: the emit callee is a hidden bound
        # parameter (#561 lowers the call), so loop + function + sink run
        # entirely inside east-c.
        project = East.function([ROW, emit_t], NullType,
                                lambda _b, r, emit: emit(r["k"], r["v"])).bind(sink.function_value())
        rows = EastArray(ROW, [{"k": f"k{i:04d}", "v": float(i)} for i in range(500)])
        rows.map(project)
        sink.finish()

        stats = sink.stats()
        assert stats["emitted"] == 500
        assert not stats["buffered"]
        table = decode_beast2_with_header_for(STR_FLOAT)(out.read_bytes())
        assert len(table) == 500
        assert table["k0000"] == 0.0 and table["k0499"] == 499.0

    def test_duplicate_adjacent_key_raises_the_sink_message_from_c(self, tmp_path):
        sink = _EmitSinkCore(2, [StringType, FloatType], tmp_path / "dup.beast2")
        sink.emit("a", 1.0)
        with pytest.raises(EastError, match='duplicate Dict key emitted: "a" — Dict keys'):
            sink.emit("a", 2.0)

    def test_out_of_order_key_demotes_once_then_buffers(self, tmp_path, capfd):
        out = tmp_path / "demote.beast2"
        sink = _EmitSinkCore(2, [StringType, FloatType], out)
        sink.emit("m", 1.0)
        sink.emit("z", 2.0)
        assert not sink.stats()["buffered"]
        sink.emit("a", 3.0)  # out of order: the prefix demotes to run 0
        sink.emit("b", 4.0)
        assert sink.stats()["buffered"]
        # The C sink writes the notice to the process's stderr.
        assert capfd.readouterr().err.count("left ascending order at element 2") == 1
        sink.finish()

        table = decode_beast2_with_header_for(STR_FLOAT)(out.read_bytes())
        assert dict(table.items()) == {"a": 3.0, "b": 4.0, "m": 1.0, "z": 2.0}
        assert not list(tmp_path.glob("demote.beast2.run*"))

    def test_a_duplicate_across_the_demote_is_found_by_the_merge(self, tmp_path):
        sink = _EmitSinkCore(2, [StringType, FloatType], tmp_path / "late.beast2")
        sink.emit("m", 1.0)
        sink.emit("a", 2.0)
        sink.emit("m", 3.0)
        with pytest.raises(EastError, match='duplicate Dict key emitted: "m"'):
            sink.finish()

    def test_set_sink_detects_duplicates_too(self, tmp_path):
        sink = _EmitSinkCore(1, [FloatType], tmp_path / "set.beast2")
        sink.emit(1.0)
        sink.emit(2.0)
        with pytest.raises(EastError, match="duplicate Set element emitted: 2"):
            sink.emit(2.0)

    def test_array_sink_keeps_arrival_order_unconditionally(self, tmp_path):
        out = tmp_path / "array.beast2"
        sink = _EmitSinkCore(0, [FloatType], out)
        for v in (3.0, 1.0, 2.0, 1.0):
            sink.emit(v)
        sink.finish()
        written = decode_beast2_with_header_for(ArrayType(FloatType))(out.read_bytes())
        assert list(written) == [3.0, 1.0, 2.0, 1.0]


class TestFolds:
    def test_merge_folds_equal_keys_in_emission_order(self, tmp_path):
        out = tmp_path / "fold.beast2"
        sink = _EmitSinkCore(2, [StringType, StringType], out, False, _concat())
        for key, value in (("b", "1"), ("a", "2"), ("b", "3"), ("a", "4"), ("a", "5")):
            sink.emit(key, value)
        sink.finish()
        table = decode_beast2_with_header_for(STR_STR)(out.read_bytes())
        assert dict(table.items()) == {"a": "245", "b": "13"}

    def test_union_keeps_the_first_of_equal_elements(self, tmp_path):
        out = tmp_path / "union.beast2"
        sink = _EmitSinkCore(1, [IntegerType], out, False, None, True)
        for v in (3, 1, 3, 2, 1):
            sink.emit(v)
        sink.finish()
        assert list(decode_beast2_with_header_for(SetType(IntegerType))(out.read_bytes())) == [1, 2, 3]

    def test_a_merge_function_of_the_wrong_shape_is_named(self, tmp_path):
        wrong = East.function([IntegerType, StringType, StringType], StringType,
                              lambda _b, _key, acc, _value: acc)
        expected = (
            "--merge: expected a function (K, V, V) -> V matching the emit parameter "
            f"(K = {print_type(StringType)}, V = {print_type(StringType)}), "
            f"got {print_type(FunctionType([IntegerType, StringType, StringType], StringType))}"
        )
        with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
            _EmitSinkCore(2, [StringType, StringType], tmp_path / "wrong.beast2", False, wrong)
        assert not (tmp_path / "wrong.beast2").exists()

    def test_a_merge_function_on_a_set_sink_is_refused(self, tmp_path):
        with pytest.raises(ValueError, match="^--merge applies to --emit dict only$"):
            _EmitSinkCore(1, [StringType], tmp_path / "set.beast2", False, _concat())


class TestCounters:
    def test_the_stats_account_for_a_merge_in_passes(self, tmp_path, monkeypatch):
        # One ascending element, then 300 out of order under a two-entry run
        # cap: 150 spills beside the demoted prefix, 151 sources — more than
        # one merge reads, so a pass of 64-run merges precedes the final one.
        monkeypatch.setenv("EAST_EMIT_RUN_ELEMENTS", "2")
        out = tmp_path / "passes.beast2"
        sink = _EmitSinkCore(1, [IntegerType], out)
        sink.emit(1000)
        for v in range(300):
            sink.emit(v)
        sink.finish()

        stats = sink.stats()
        assert (stats["spills"], stats["sources"], stats["passes"], stats["runs_per_pass"]) \
            == (150, 151, 2, 64)
        assert stats["peak_entries"] == 2
        written = decode_beast2_with_header_for(SetType(IntegerType))(out.read_bytes())
        assert list(written) == [*range(300), 1000]
        assert not list(tmp_path.glob("passes.beast2.run*"))
