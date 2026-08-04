#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""read_beast2_type + self-describing opens (issue #484 PR C).

beast2-full blobs always carry their root type; exposing it makes loader
regeneration a header read instead of a re-export, lets generic tooling
inspect unknown files, and lets ``open_beast2_file`` run without a declared
type — or validate a declared one at open instead of decoding garbage."""

import mmap

import pytest

from east import (
    ArrayType,
    DictType,
    EastArray,
    EastDict,
    IntegerType,
    StringType,
    StructType,
)
from east.serialization.beast2 import (
    Beast2ArrayFile,
    Beast2DictFile,
    encode_beast2_with_header_for,
    open_beast2_file,
    read_beast2_type,
    write_beast2_file,
)

ROW = StructType([("id", IntegerType), ("name", StringType)])
AT = ArrayType(ROW)
DT = DictType(StringType, IntegerType)


@pytest.fixture
def array_path(tmp_path):
    path = tmp_path / "rows.beast2"
    write_beast2_file(path, AT, EastArray(ROW, [{"id": i, "name": f"n{i}"} for i in range(500)]))
    return path


def test_read_type_from_path_bytes_and_mmap(array_path):
    assert read_beast2_type(array_path) == AT
    blob = array_path.read_bytes()
    assert read_beast2_type(blob) == AT
    with open(array_path, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        assert read_beast2_type(mm) == AT


def test_read_type_accepts_v4_blobs():
    """Old exports are self-describing too — regeneration works on them."""
    v4 = encode_beast2_with_header_for(AT, version=4)(EastArray(ROW, [{"id": 1, "name": "x"}]))
    assert v4[7] == 0x04
    assert read_beast2_type(v4) == AT


def test_read_type_refuses_junk(tmp_path):
    with pytest.raises(ValueError):
        read_beast2_type(b"not a beast2 blob")
    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"nope")
    with pytest.raises(ValueError, match=r"junk\.bin"):
        read_beast2_type(junk)
    empty = tmp_path / "empty.bin"
    empty.write_bytes(b"")
    with pytest.raises(ValueError, match="too short"):
        read_beast2_type(empty)


def test_open_without_type_is_self_describing(array_path, tmp_path):
    with open_beast2_file(array_path) as f:
        assert isinstance(f, Beast2ArrayFile)
        assert f.collection_type == AT and f.wire_type == AT
        assert f[42]["id"] == 42
        assert len(f.load()) == 500

    dict_path = tmp_path / "d.beast2"
    write_beast2_file(dict_path, DT, EastDict(StringType, IntegerType, {"a": 1, "b": 2}))
    with open_beast2_file(dict_path) as d:
        assert isinstance(d, Beast2DictFile)
        assert d.collection_type == DT
        assert len(d.load()) == 2


def test_declared_type_is_validated_at_open(array_path):
    with open_beast2_file(array_path, AT) as f:  # matching type: unchanged behavior
        assert f.wire_type == AT
        assert len(f) == 500
    with pytest.raises(ValueError, match="declared type does not match the file"):
        open_beast2_file(array_path, DT)


def test_write_mode_requires_a_type(tmp_path):
    with pytest.raises(ValueError, match="write mode requires collection_type"):
        open_beast2_file(tmp_path / "x.beast2", mode="w")
