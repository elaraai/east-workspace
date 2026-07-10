#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""CSV decode/encode tests for the east-c-backed serialization layer.

Covers the eager ``EastBlob.decode_csv`` wrapper (issue #251: it must wrap the
element type in ``ArrayType`` before calling east-c, which requires the ARRAY
type) and the ``decode_csv_for`` / ``encode_csv_for`` module functions.
"""

import pytest

from east import (
    ArrayType,
    EastBlob,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
)
from east.serialization.csv import decode_csv_for, encode_csv_for
from east.types.values import is_east_variant


ROW = StructType([("a", StringType), ("b", StringType)])


# ─── EastBlob.decode_csv (issue #251 regression) ──────────────────────────


def test_blob_decode_csv_takes_element_type():
    """The documented contract: pass the ROW struct type, not ArrayType(row)."""
    rows = EastBlob(b"a,b\n1,2\n").decode_csv(ROW)
    assert len(rows) == 1
    assert rows[0]["a"] == "1"
    assert rows[0]["b"] == "2"


def test_blob_decode_csv_matches_decode_csv_for():
    data = b"a,b\nx,y\np,q\n"
    via_blob = EastBlob(data).decode_csv(ROW)
    via_module = decode_csv_for(ArrayType(ROW))(data)
    assert len(via_blob) == len(via_module) == 2
    for lhs, rhs in zip(via_blob, via_module):
        assert lhs["a"] == rhs["a"]
        assert lhs["b"] == rhs["b"]


def test_blob_decode_csv_typed_columns():
    row = StructType(
        [
            ("name", StringType),
            ("count", IntegerType),
            ("score", FloatType),
            ("note", OptionType(StringType)),
        ]
    )
    rows = EastBlob(b"name,count,score,note\nalice,3,1.5,hi\n").decode_csv(row)
    assert len(rows) == 1
    assert rows[0]["name"] == "alice"
    assert rows[0]["count"] == 3
    assert rows[0]["score"] == 1.5
    note = rows[0]["note"]
    assert is_east_variant(note)
    assert note.type == "some"
    assert note.value == "hi"


def test_blob_decode_csv_error_carries_east_c_message():
    with pytest.raises(ValueError, match="missing required column 'b'"):
        EastBlob(b"a\n1\n").decode_csv(ROW)


def test_decode_csv_for_requires_array_type():
    """The module-level function is the low-level surface: it takes the ARRAY type."""
    with pytest.raises(ValueError):
        decode_csv_for(ROW)(b"a,b\n1,2\n")


# ─── encode/decode round trip ──────────────────────────────────────────────


def test_csv_round_trip():
    data = b"a,b\nx,y\np,q\n"
    rows = EastBlob(data).decode_csv(ROW)
    encoded = encode_csv_for(ArrayType(ROW))(rows)
    rows2 = EastBlob(encoded).decode_csv(ROW)
    assert len(rows2) == 2
    assert rows2[0]["a"] == "x"
    assert rows2[1]["b"] == "q"
