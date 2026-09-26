#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The blob merge binding (issue #770).

``_merge_blobs`` is east-c's blob merge (``east/merge.h``), the code a merge
unit runs, pinned here at the binding: the fold in input order, the account,
and the refusals, in the words east-node gives for the same inputs. The
beast2 corpus holds the merged bytes to TypeScript's."""

import re

import pytest
from east.serialization._beast2_eastc import _merge_blobs

from east import (
    ArrayType,
    DictType,
    East,
    EastArray,
    EastDict,
    EastSet,
    FloatType,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    StructType,
    none,
    some,
)
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_v5_for,
    encode_beast2_with_header_for,
    splice_beast2_files,
    write_beast2_file,
)
from east.serialization.east_printer import print_type

STR_FLOAT = DictType(StringType, FloatType)
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


def _write_dict(path, pairs):
    write_beast2_file(path, INT_STR, EastDict(IntegerType, StringType, dict(pairs)), codec="none")


def _write_set(path, elements):
    write_beast2_file(path, INT_SET, EastSet(IntegerType, elements), codec="none")


def _write_range(path, key_type, lower, upper):
    """A key range: the bounds struct over ``key_type``, an absent bound
    open."""
    bounds = StructType([("from", OptionType(key_type)), ("to", OptionType(key_type))])
    path.write_bytes(encode_beast2_with_header_for(bounds)({"from": lower, "to": upper}))


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

    def test_an_input_whose_keys_do_not_ascend_is_refused(self, tmp_path):
        # A high key range spliced before a low one: the reader's
        # canonical-order error, prefixed with the input.
        high, low, corrupt = tmp_path / "high.beast2", tmp_path / "low.beast2", tmp_path / "corrupt.beast2"
        _write_dict(high, [(1000, "x"), (1001, "y")])
        _write_dict(low, [(1, "a"), (2, "b")])
        splice_beast2_files(corrupt, INT_STR, [high, low])
        expected = (f"merge: input 0 ({corrupt}): beast2 v5: Dict keys are not strictly ascending "
                    "in East order — the wire must hold the canonical value (corrupt or "
                    "pre-contract blob)")
        with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
            _merge_blobs([corrupt], tmp_path / "out.beast2")

    def test_a_fold_of_the_wrong_signature_is_named(self, tmp_path):
        a = tmp_path / "a.beast2"
        _write_dict(a, [(1, "x")])
        with pytest.raises(ValueError, match=re.escape(
                "merge function: expected a function (K, V, V) -> V matching the inputs "
                f"(K = {print_type(IntegerType)}, V = {print_type(StringType)}), got ")):
            _merge_blobs([a], tmp_path / "wrong.beast2", _concat())

    def test_the_folds_apply_to_their_own_kind(self, tmp_path):
        d, s = tmp_path / "d.beast2", tmp_path / "s.beast2"
        _write_dict(d, [(1, "x")])
        _write_set(s, [1])
        with pytest.raises(ValueError, match="^merge: union applies to Set inputs only$"):
            _merge_blobs([d], tmp_path / "u.beast2", None, True)
        with pytest.raises(ValueError, match="^merge: a merge function applies to Dict inputs only$"):
            _merge_blobs([s], tmp_path / "m.beast2", _concat_int_keys())
        with pytest.raises(ValueError, match="^merge: a merge function and union are two folds — "
                                             "give one$"):
            _merge_blobs([d], tmp_path / "b.beast2", _concat_int_keys(), True)

    def test_a_missing_input_is_named(self, tmp_path):
        missing = tmp_path / "missing.beast2"
        expected = f"merge: input 0 ({missing}): cannot open the file"
        with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
            _merge_blobs([missing], tmp_path / "out.beast2")

    def test_bounds_of_another_key_type_are_named(self, tmp_path):
        a, bounds = tmp_path / "a.beast2", tmp_path / "range.beast2"
        _write_dict(a, [(1, "x")])
        _write_range(bounds, StringType, some("a"), none)
        with pytest.raises(ValueError, match=re.escape(f"merge: range ({bounds}) has type ")) as caught:
            _merge_blobs([a], tmp_path / "out.beast2", range_path=bounds)
        assert str(caught.value).endswith(" (bounds over the inputs' key type)")

    def test_a_missing_range_file_is_named(self, tmp_path):
        a, missing = tmp_path / "a.beast2", tmp_path / "missing.beast2"
        _write_dict(a, [(1, "x")])
        expected = f"merge: range ({missing}): cannot open the file"
        with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
            _merge_blobs([a], tmp_path / "out.beast2", range_path=missing)

    def test_a_file_that_is_not_a_blob_is_refused_in_the_readers_words(self, tmp_path):
        # An empty file or a file without the magic, as an input or as the
        # range: the sentence east-node gives for the same bytes.
        a, empty, text = tmp_path / "a.beast2", tmp_path / "empty.beast2", tmp_path / "text.beast2"
        _write_dict(a, [(1, "x")])
        empty.write_bytes(b"")
        text.write_bytes(b"not a blob")
        short = "Data too short for Beast2 format: 0 bytes"
        magic = "Invalid Beast2 magic at offset 0: expected 0x89, got 0x6e"
        for inputs, range_path, expected in [
            ([empty], None, f"merge: input 0 ({empty}): {short}"),
            ([a, text], None, f"merge: input 1 ({text}): {magic}"),
            ([a], empty, f"merge: range ({empty}): {short}"),
            ([a], text, f"merge: range ({text}): {magic}"),
        ]:
            with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
                _merge_blobs(inputs, tmp_path / "out.beast2", range_path=range_path)

    def test_a_blob_without_the_paging_index_is_refused(self, tmp_path):
        # A whole-value encode, not what a runner writes.
        whole = tmp_path / "whole.beast2"
        whole.write_bytes(encode_beast2_v5_for(INT_STR)(EastDict(IntegerType, StringType, {1: "a"})))
        expected = (f"merge: input 0 ({whole}): beast2 v5: blob carries no index — ranged reads "
                    "need one (write with the index enabled, the default)")
        with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
            _merge_blobs([whole], tmp_path / "out.beast2")
