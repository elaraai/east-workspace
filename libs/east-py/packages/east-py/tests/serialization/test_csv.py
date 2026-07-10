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
from east.serialization.csv import (
    csv_parse_config,
    decode_csv_for,
    encode_csv_for,
    resolve_parse_config,
)
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


# ─── nullStrings default semantics (issue #252) ────────────────────────────


def test_empty_field_is_empty_string_by_default():
    """Default nullStrings is [] — empty field == empty string, so required
    String columns accept empty fields (the issue #252 repro)."""
    rows = EastBlob(b"a,b\n1,\n").decode_csv(ROW)
    assert len(rows) == 1
    assert rows[0]["a"] == "1"
    assert rows[0]["b"] == ""


def test_optional_empty_is_some_empty_by_default():
    row = StructType([("v", OptionType(StringType))])
    cfg = csv_parse_config(skip_empty_lines=False)
    rows = EastBlob(b"v\n\n").decode_csv(row, cfg)
    assert len(rows) == 1
    assert rows[0]["v"].type == "some"
    assert rows[0]["v"].value == ""


def test_null_strings_opt_in_decodes_none():
    row = StructType([("v", OptionType(StringType))])
    cfg = csv_parse_config(skip_empty_lines=False, null_strings=["", "NA"])
    rows = EastBlob(b"v\nx\n\nNA\n").decode_csv(row, cfg)
    assert [v.type for v in (r["v"] for r in rows)] == ["some", "none", "none"]


def test_null_strings_opt_in_errors_for_required():
    cfg = csv_parse_config(skip_empty_lines=False, null_strings=[""])
    with pytest.raises(ValueError, match="null value for required field 'b'"):
        EastBlob(b"a,b\n1,\n").decode_csv(ROW, cfg)


def test_explicit_empty_null_strings_matches_default():
    """Regression: an explicit empty list must not fall back to {''}."""
    cfg = csv_parse_config(null_strings=[])
    rows = EastBlob(b"a,b\n1,\n").decode_csv(ROW, cfg)
    assert rows[0]["b"] == ""
    assert resolve_parse_config(csv_parse_config(null_strings=[])).null_strings == frozenset()
    assert resolve_parse_config(None).null_strings == frozenset()


def test_csv_parse_config_passes_options_through():
    cfg = csv_parse_config(delimiter=";", trim_fields=True)
    rows = EastBlob(b"a;b\n x ; y \n").decode_csv(ROW, cfg)
    assert rows[0]["a"] == "x"
    assert rows[0]["b"] == "y"


# ─── encode/decode round trip ──────────────────────────────────────────────


def test_csv_round_trip():
    data = b"a,b\nx,y\np,q\n"
    rows = EastBlob(data).decode_csv(ROW)
    encoded = encode_csv_for(ArrayType(ROW))(rows)
    rows2 = EastBlob(encoded).decode_csv(ROW)
    assert len(rows2) == 2
    assert rows2[0]["a"] == "x"
    assert rows2[1]["b"] == "q"
