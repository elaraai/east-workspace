#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast2 v5 (issue #416): the segment-terminated record stream.

Bounded-memory encode via :class:`Beast2Writer` (one root segment per batch),
whole decode through the ordinary entry points (magic dispatch), segment-wise
decode via ``iter_beast2_segments_for``. Array segments concatenate, Set
segments union, Dict segments keep the last occurrence of a key."""

import io

import pytest

from east import (
    ArrayType,
    DictType,
    EastArray,
    EastDict,
    EastSet,
    IntegerType,
    SetType,
    StringType,
)
from east.serialization.beast2 import (
    BEAST2_V5_MAGIC,
    Beast2Writer,
    decode_beast2_with_header_for,
    encode_beast2_segments_for,
    encode_beast2_v5_for,
    encode_beast2_with_header_for,
    iter_beast2_segments_for,
    read_beast2_index,
)

AT = ArrayType(StringType)

#: The SAME bytes are pinned in libs/east's v5/index.spec.ts and east-c's
#: test_beast2_hardening.c — the three runtimes must produce and accept
#: identical v5 streams for this canonical fixture (codec "none",
#: self-contained, indexed; batches ["a","b"] + ["c"], empty batch skipped).
SHARED_HEX = (
    "89456173740d0a0500050102010a00010000010100000505020161016200030301016300010100"
    "010215020801270000000000000089456173740d0af5"
)

#: TS-encoded whole-value v5 blob with one raw-DEFLATE frame (100 integers,
#: i % 10) — proves this runtime's inflate accepts zlib-produced streams.
TS_DEFLATE_HEX = "89456173740d0a0500050102020a000100016710634861606261e3e0e2e11310a2210b00"


def test_writer_matches_the_cross_runtime_fixture(tmp_path):
    path = tmp_path / "rows.beast2"
    with open(path, "wb") as stream, Beast2Writer(AT, stream, codec="none") as writer:
        writer.write(EastArray(StringType, ["a", "b"]))
        writer.write(EastArray(StringType))  # skipped — segments are never empty
        writer.write(EastArray(StringType, ["c"]))
    assert writer.segments == 2
    blob = path.read_bytes()
    assert blob.hex() == SHARED_HEX
    assert blob.startswith(BEAST2_V5_MAGIC)

    # Whole decode merges the segments through the ordinary entry point.
    assert list(decode_beast2_with_header_for(AT)(blob)) == ["a", "b", "c"]
    # Segment iteration sees the original batching, from bytes and streams.
    assert [list(s) for s in iter_beast2_segments_for(AT)(blob)] == [["a", "b"], ["c"]]
    with open(path, "rb") as stream:
        assert [list(s) for s in iter_beast2_segments_for(AT)(stream)] == [["a", "b"], ["c"]]
    # O(1) length from the trailing index.
    assert read_beast2_index(AT, blob) == (2, 3)


def test_encode_segments_convenience_matches_the_writer():
    blob = encode_beast2_segments_for(AT, codec="none")(
        [EastArray(StringType, ["a", "b"]), EastArray(StringType, ["c"]), EastArray(StringType)]
    )
    assert blob.hex() == SHARED_HEX


def test_whole_value_v5_round_trips_and_v4_still_decodes():
    at = ArrayType(IntegerType)
    rows = EastArray(IntegerType, list(range(100)) * 3)
    for codec in ("none", "deflate"):
        blob = encode_beast2_v5_for(at, codec=codec)(rows)
        assert blob.startswith(BEAST2_V5_MAGIC)
        assert list(decode_beast2_with_header_for(at)(blob)) == list(rows)
    # deflate actually shrinks this repetitive payload
    assert len(encode_beast2_v5_for(at, codec="deflate")(rows)) < len(
        encode_beast2_v5_for(at, codec="none")(rows)
    )
    # v4 blobs keep decoding through the same entry point
    v4 = encode_beast2_with_header_for(at)(rows)
    assert v4[7] == 0x04
    assert list(decode_beast2_with_header_for(at)(v4)) == list(rows)


def test_ts_deflate_blob_decodes():
    blob = bytes.fromhex(TS_DEFLATE_HEX)
    decoded = decode_beast2_with_header_for(ArrayType(IntegerType))(blob)
    assert list(decoded) == [i % 10 for i in range(100)]


def test_set_segments_union_and_dict_segments_keep_the_last_occurrence():
    st = SetType(IntegerType)
    s_blob = encode_beast2_segments_for(st)(
        [EastSet(IntegerType, [3, 1]), EastSet(IntegerType, [1, 2])]
    )
    assert sorted(decode_beast2_with_header_for(st)(s_blob)) == [1, 2, 3]

    dt = DictType(StringType, IntegerType)
    d_blob = encode_beast2_segments_for(dt)(
        [
            EastDict(StringType, IntegerType, {"a": 1, "b": 2}),
            EastDict(StringType, IntegerType, {"b": 9}),
        ]
    )
    merged = decode_beast2_with_header_for(dt)(d_blob)
    assert merged["a"] == 1 and merged["b"] == 9
    assert len(merged) == 2


def test_zero_batches_decode_to_the_empty_collection_of_each_kind():
    assert len(decode_beast2_with_header_for(AT)(encode_beast2_segments_for(AT)([]))) == 0
    st = SetType(IntegerType)
    assert len(decode_beast2_with_header_for(st)(encode_beast2_segments_for(st)([]))) == 0
    dt = DictType(StringType, IntegerType)
    assert len(decode_beast2_with_header_for(dt)(encode_beast2_segments_for(dt)([]))) == 0


def test_bounded_memory_shape_many_batches():
    at = ArrayType(IntegerType)
    buf = io.BytesIO()
    expected = []
    with Beast2Writer(at, buf) as writer:
        for b in range(20):
            rows = list(range(b * 500, (b + 1) * 500))
            expected.extend(rows)
            writer.write(EastArray(IntegerType, rows))
    blob = buf.getvalue()
    assert list(decode_beast2_with_header_for(at)(blob)) == expected
    assert read_beast2_index(at, blob) == (20, 10000)
    seen = 0
    for segment in iter_beast2_segments_for(at)(blob):
        seen += len(segment)
    assert seen == 10000


def test_write_after_close_and_non_collection_types_are_refused():
    with pytest.raises(TypeError, match="Array, Set or Dict"):
        encode_beast2_segments_for(StringType)
    with pytest.raises(TypeError, match="Array, Set or Dict"):
        iter_beast2_segments_for(StringType)
    buf = io.BytesIO()
    writer = Beast2Writer(AT, buf)
    writer.close()
    writer.close()  # idempotent
    with pytest.raises(ValueError, match="after close"):
        writer.write(EastArray(StringType, ["x"]))


def test_malformed_streams_are_loud():
    blob = bytes.fromhex(SHARED_HEX)
    with pytest.raises((RuntimeError, ValueError)):
        list(iter_beast2_segments_for(AT)(blob[1:]))  # bad magic
    with pytest.raises((RuntimeError, ValueError)):
        list(iter_beast2_segments_for(AT)(blob[:30]))  # truncated mid-stream
    with pytest.raises((RuntimeError, ValueError)):
        decode_beast2_with_header_for(AT)(blob[:30])
    # Unknown container version byte fails loudly through the v4/v5 dispatch.
    unknown = bytearray(blob)
    unknown[7] = 0x77
    with pytest.raises((RuntimeError, ValueError)):
        decode_beast2_with_header_for(AT)(bytes(unknown))
