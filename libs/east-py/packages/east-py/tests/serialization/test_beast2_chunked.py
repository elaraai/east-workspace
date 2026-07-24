#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Chunked beast2 container (#414): bounded-memory encode/decode of large
collections. Each chunk is a self-contained beast2 blob of the SAME declared
collection type; decode merges — Array concatenates, Set unions, Dict keeps
the last occurrence of a key."""

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
    BEAST2_CHUNKED_MAGIC,
    Beast2ChunkWriter,
    decode_beast2_chunked_for,
    encode_beast2_chunked_for,
    iter_beast2_chunks_for,
)

AT = ArrayType(StringType)

#: The SAME bytes are pinned in libs/east's index.spec.ts — the two runtimes
#: must produce and accept identical chunked blobs.
SHARED_HEX = (
    "89456173740d0a431f89456173740d0a04050102010a000502016101620100"
    "0701050a00020001001c89456173740d0a04050102010a000301016301000601040a0001000000"
)


def test_array_chunks_concatenate_and_match_the_cross_runtime_fixture():
    blob = encode_beast2_chunked_for(AT)(
        [EastArray(StringType, ["a", "b"]), EastArray(StringType, ["c"]), EastArray(StringType)]
    )
    assert blob.hex() == SHARED_HEX
    assert list(decode_beast2_chunked_for(AT)(blob)) == ["a", "b", "c"]
    assert list(decode_beast2_chunked_for(AT)(bytes.fromhex(SHARED_HEX))) == ["a", "b", "c"]


def test_set_chunks_union_and_dict_chunks_keep_the_last_occurrence():
    st = SetType(IntegerType)
    s_blob = encode_beast2_chunked_for(st)(
        [EastSet(IntegerType, [3, 1]), EastSet(IntegerType, [1, 2])]
    )
    assert sorted(decode_beast2_chunked_for(st)(s_blob)) == [1, 2, 3]

    dt = DictType(StringType, IntegerType)
    d_blob = encode_beast2_chunked_for(dt)(
        [
            EastDict(StringType, IntegerType, {"a": 1, "b": 2}),
            EastDict(StringType, IntegerType, {"b": 9}),
        ]
    )
    merged = decode_beast2_chunked_for(dt)(d_blob)
    assert merged["a"] == 1 and merged["b"] == 9


def test_zero_chunks_decode_to_the_empty_collection_of_each_kind():
    assert len(decode_beast2_chunked_for(AT)(encode_beast2_chunked_for(AT)([]))) == 0
    st = SetType(IntegerType)
    assert len(decode_beast2_chunked_for(st)(encode_beast2_chunked_for(st)([]))) == 0
    dt = DictType(StringType, IntegerType)
    assert len(decode_beast2_chunked_for(dt)(encode_beast2_chunked_for(dt)([]))) == 0


def test_writer_streams_to_a_file_and_iter_streams_back(tmp_path):
    path = tmp_path / "rows.b2c"
    with open(path, "wb") as stream, Beast2ChunkWriter(AT, stream) as writer:
        writer.write(EastArray(StringType, ["a", "b"]))
        writer.write(EastArray(StringType))  # skipped — chunks are never empty
        writer.write(EastArray(StringType, ["c"]))
    assert writer.chunks == 2
    assert path.read_bytes().hex() == SHARED_HEX

    with open(path, "rb") as stream:
        batches = [list(chunk) for chunk in iter_beast2_chunks_for(AT)(stream)]
    assert batches == [["a", "b"], ["c"]]
    # bytes source too
    assert [list(c) for c in iter_beast2_chunks_for(AT)(path.read_bytes())] == batches


def test_write_after_close_and_non_collection_types_are_refused():
    with pytest.raises(TypeError, match="Array, Set or Dict"):
        encode_beast2_chunked_for(StringType)
    buf = io.BytesIO()
    writer = Beast2ChunkWriter(AT, buf)
    writer.close()
    writer.close()  # idempotent
    with pytest.raises(ValueError, match="after close"):
        writer.write(EastArray(StringType, ["x"]))


def test_malformed_streams_are_loud():
    blob = encode_beast2_chunked_for(AT)([EastArray(StringType, ["a"])])
    assert blob.startswith(BEAST2_CHUNKED_MAGIC)
    with pytest.raises(ValueError, match="bad magic"):
        list(iter_beast2_chunks_for(AT)(blob[1:]))
    with pytest.raises(ValueError, match="truncated"):
        list(iter_beast2_chunks_for(AT)(blob[:-2]))
    with pytest.raises(ValueError, match="after the terminator"):
        list(iter_beast2_chunks_for(AT)(blob + b"\x00"))
    with pytest.raises(ValueError, match="bad magic"):
        list(iter_beast2_chunks_for(AT)(io.BytesIO(blob[1:])))
