#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The emit sink and blob merge bindings (issues #560, #770).

``_EmitSinkCore`` owns one east-c library sink (``east/emit_sink.h``) — the
sink the east-c CLI runs — behind a streamTask ``emit``. Its function value's
invoke is the sink's C entry, so a compiled loop emits with zero python per
row, and batching, the ascending check and the folds all run in C. The
runner's ``_EmitSink`` validates the emit parameter; these tests pin the
binding's own contract: rows from a compiled loop reach the file, the sink's
exact duplicate and out-of-order messages, the merge function's signature
check and wiring, the adjacent-key folds, and the counter. ``_merge_blobs``
is the fan-in's twin — east-c's blob merge (``east/merge.h``) behind
``east-py merge`` — pinned here at the binding: the fold in input order, the
account, and the refusals in east-c's words."""

import re

import pytest
from east.serialization._beast2_eastc import _EmitSinkCore, _merge_blobs

from east import (
    ArrayType,
    DictType,
    East,
    EastArray,
    EastDict,
    EastSet,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    SetType,
    StringType,
    StructType,
)
from east.runtime.errors import EastError
from east.serialization.beast2 import decode_beast2_with_header_for, write_beast2_file
from east.serialization.east_printer import print_type

ROW = StructType([("k", StringType), ("v", FloatType)])
STR_FLOAT = DictType(StringType, FloatType)
STR_STR = DictType(StringType, StringType)
INT_STR = DictType(IntegerType, StringType)
INT_SET = SetType(IntegerType)


def _concat():
    """A ``(String, String, String) -> String`` merge: the values joined in
    fold order."""
    return East.function([StringType, StringType, StringType], StringType,
                         lambda _b, _key, acc, value: acc + value)


def _concat_int_keys():
    """The same fold over Integer keys."""
    return East.function([IntegerType, StringType, StringType], StringType,
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

        assert sink.stats() == {"emitted": 500}
        table = decode_beast2_with_header_for(STR_FLOAT)(out.read_bytes())
        assert len(table) == 500
        assert table["k0000"] == 0.0 and table["k0499"] == 499.0

    def test_duplicate_adjacent_key_raises_the_sink_message_from_c(self, tmp_path):
        sink = _EmitSinkCore(2, [StringType, FloatType], tmp_path / "dup.beast2")
        sink.emit("a", 1.0)
        with pytest.raises(EastError, match='duplicate Dict key emitted: "a" — Dict keys'):
            sink.emit("a", 2.0)

    def test_an_out_of_order_key_raises_the_sink_message_from_c(self, tmp_path):
        # Set/Dict emissions must ascend in East order (#770): the sink
        # writes one pass and never buffers, so a key below the previous one
        # is the error, in the same words on every runner.
        sink = _EmitSinkCore(2, [StringType, FloatType], tmp_path / "order.beast2")
        sink.emit("m", 1.0)
        sink.emit("z", 2.0)
        expected = ('beast2 v5: Dict key emitted out of order: "a" after "z" — Set/Dict '
                    "emissions must ascend in East order")
        with pytest.raises(EastError, match=f"^{re.escape(expected)}$"):
            sink.emit("a", 3.0)

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
    def test_merge_folds_adjacent_equal_keys_in_emission_order(self, tmp_path):
        out = tmp_path / "fold.beast2"
        sink = _EmitSinkCore(2, [StringType, StringType], out, _concat())
        for key, value in (("a", "1"), ("a", "2"), ("b", "3"), ("b", "4"), ("b", "5")):
            sink.emit(key, value)
        sink.finish()
        assert sink.stats() == {"emitted": 5}
        table = decode_beast2_with_header_for(STR_STR)(out.read_bytes())
        assert dict(table.items()) == {"a": "12", "b": "345"}

    def test_union_keeps_the_first_of_adjacent_equal_elements(self, tmp_path):
        out = tmp_path / "union.beast2"
        sink = _EmitSinkCore(1, [IntegerType], out, None, True)
        for v in (1, 1, 2, 3, 3):
            sink.emit(v)
        sink.finish()
        assert list(decode_beast2_with_header_for(INT_SET)(out.read_bytes())) == [1, 2, 3]

    def test_a_fold_does_not_admit_an_out_of_order_key(self, tmp_path):
        # The fold is over ADJACENT equal keys: a key below the previous one
        # is the out-of-order error under --merge exactly as without it.
        sink = _EmitSinkCore(2, [StringType, StringType], tmp_path / "late.beast2", _concat())
        sink.emit("b", "1")
        with pytest.raises(EastError, match='Dict key emitted out of order: "a" after "b"'):
            sink.emit("a", "2")

    def test_a_merge_function_of_the_wrong_shape_is_named(self, tmp_path):
        wrong = East.function([IntegerType, StringType, StringType], StringType,
                              lambda _b, _key, acc, _value: acc)
        expected = (
            "--merge: expected a function (K, V, V) -> V matching the emit parameter "
            f"(K = {print_type(StringType)}, V = {print_type(StringType)}), "
            f"got {print_type(FunctionType([IntegerType, StringType, StringType], StringType))}"
        )
        with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
            _EmitSinkCore(2, [StringType, StringType], tmp_path / "wrong.beast2", wrong)
        assert not (tmp_path / "wrong.beast2").exists()

    def test_a_merge_function_on_a_set_sink_is_refused(self, tmp_path):
        with pytest.raises(ValueError, match="^--merge applies to --emit dict only$"):
            _EmitSinkCore(1, [StringType], tmp_path / "set.beast2", _concat())


def _write_dict(path, pairs):
    write_beast2_file(path, INT_STR, EastDict(IntegerType, StringType, dict(pairs)), codec="none")


def _write_set(path, elements):
    write_beast2_file(path, INT_SET, EastSet(IntegerType, elements), codec="none")


class TestMergeBlobs:
    def test_equal_keys_fold_in_input_order(self, tmp_path):
        a, b, c = tmp_path / "a.beast2", tmp_path / "b.beast2", tmp_path / "c.beast2"
        _write_dict(a, [(k, f"a{k}") for k in range(0, 20)])
        _write_dict(b, [(k, f"b{k}") for k in range(10, 30)])
        _write_dict(c, [(k, f"c{k}") for k in (5, 15, 25, 40)])
        out = tmp_path / "merged.beast2"
        stats = _merge_blobs([a, b, c], out, _concat_int_keys())
        assert stats == {"inputs": 3, "entries": 31, "folds": 13}
        table = decode_beast2_with_header_for(INT_STR)(out.read_bytes())
        assert len(table) == 31
        assert table[5] == "a5c5" and table[15] == "a15b15c15" and table[40] == "c40"

    def test_union_keeps_the_first_of_equal_elements_across_inputs(self, tmp_path):
        a, b = tmp_path / "a.beast2", tmp_path / "b.beast2"
        _write_set(a, [1, 2, 3])
        _write_set(b, [2, 3, 4])
        out = tmp_path / "union.beast2"
        assert _merge_blobs([a, b], out, None, True) == {"inputs": 2, "entries": 4, "folds": 2}
        assert list(decode_beast2_with_header_for(INT_SET)(out.read_bytes())) == [1, 2, 3, 4]

    def test_a_shared_key_without_a_fold_is_the_duplicate_error(self, tmp_path):
        a, b = tmp_path / "a.beast2", tmp_path / "b.beast2"
        _write_dict(a, [(1, "x"), (2, "y")])
        _write_dict(b, [(2, "z")])
        with pytest.raises(ValueError, match="^beast2 v5: duplicate Dict key emitted: 2 — Dict "
                                             "keys must be unique$"):
            _merge_blobs([a, b], tmp_path / "dup.beast2")

    def test_an_input_of_another_type_is_named(self, tmp_path):
        a, other = tmp_path / "a.beast2", tmp_path / "other.beast2"
        _write_dict(a, [(1, "x")])
        write_beast2_file(other, STR_FLOAT, EastDict(StringType, FloatType, {"k": 1.0}),
                          codec="none")
        with pytest.raises(ValueError, match=re.escape(f"merge: input 1 ({other}) has type ")):
            _merge_blobs([a, other], tmp_path / "mismatch.beast2")

    def test_an_array_input_is_refused(self, tmp_path):
        rows = tmp_path / "rows.beast2"
        write_beast2_file(rows, ArrayType(IntegerType), EastArray(IntegerType, [1, 2]), codec="none")
        with pytest.raises(ValueError, match="^merge: inputs must be Set or Dict blobs, got Array"):
            _merge_blobs([rows], tmp_path / "array.beast2")

    def test_a_fold_of_the_wrong_signature_is_named(self, tmp_path):
        a = tmp_path / "a.beast2"
        _write_dict(a, [(1, "x")])
        with pytest.raises(ValueError, match=re.escape(
                "--merge: expected a function (K, V, V) -> V matching the inputs "
                f"(K = {print_type(IntegerType)}, V = {print_type(StringType)}), got ")):
            _merge_blobs([a], tmp_path / "wrong.beast2", _concat())

    def test_the_folds_apply_to_their_own_kind(self, tmp_path):
        d, s = tmp_path / "d.beast2", tmp_path / "s.beast2"
        _write_dict(d, [(1, "x")])
        _write_set(s, [1])
        with pytest.raises(ValueError, match="^--union applies to Set inputs only$"):
            _merge_blobs([d], tmp_path / "u.beast2", None, True)
        with pytest.raises(ValueError, match="^--merge applies to Dict inputs only$"):
            _merge_blobs([s], tmp_path / "m.beast2", _concat_int_keys())

    def test_a_missing_input_is_named(self, tmp_path):
        missing = tmp_path / "missing.beast2"
        with pytest.raises(ValueError, match=re.escape(f"merge: input 0 ({missing}): ")):
            _merge_blobs([missing], tmp_path / "out.beast2")
