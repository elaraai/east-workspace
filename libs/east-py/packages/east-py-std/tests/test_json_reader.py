#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The strict streaming JSON reader — the python half of the contract boundary.

The invariant these pin: the reader accepts exactly the documents
``json_schema_for(T)`` describes. The schema states what the ENCODER emits, so
the encoder's own output is the accept corpus and the historic decoder's
tolerances are the reject corpus. The cross-runtime replay of the TypeScript
suite (``test_compliance.py --ir-dir /tmp/east-node-std``) covers the East-level
behaviour; these cover the bridge — that python holds the bytes and the handle
correctly, and that east-c's strictness is what reaches a python caller.
"""

import gc
import json
import tracemalloc

import pytest
from east.serialization.json import encode_json_for
from east.serialization.json_reader import JsonReader
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    SetType,
    StringType,
    StructType,
    VariantType,
)

# The bound east-c applies (JSON_MAX_DEPTH). It is east-c's reader on every
# runtime now, so this is the same number everywhere rather than a python
# constant that happened to agree.
MAX_DEPTH = 2048

INT_STRUCT = StructType([("v", IntegerType)])
DATE_STRUCT = StructType([("v", DateTimeType)])
BLOB_STRUCT = StructType([("v", BlobType)])


def read(typ, text):
    """Read a whole document as ``typ``."""
    reader = JsonReader.open_value_text(text, "")
    try:
        return reader.read_value(typ)
    finally:
        reader.close()


def accepts(typ, text) -> bool:
    """Whether the reader accepts ``text`` as ``typ``."""
    try:
        read(typ, text)
    except Exception:
        return False
    return True


def test_everything_the_encoder_emits_reads_back():
    """The encoder's own output is the accept corpus."""
    row = StructType(
        [
            ("id", IntegerType),
            ("name", StringType),
            ("at", DateTimeType),
            ("ratio", FloatType),
            ("ok", BooleanType),
            ("note", VariantType([("none", NullType), ("some", StringType)])),
            ("tags", SetType(StringType)),
            ("meta", DictType(StringType, IntegerType)),
            ("raw", BlobType),
        ]
    )
    from datetime import UTC, datetime

    from east.types.values import EastBlob, EastDict, EastSet, EastStruct, EastVariant

    rows = [
        EastStruct(
            {
                "id": 0,
                "name": "a",
                "at": datetime(1970, 1, 1, tzinfo=UTC),
                "ratio": 1.5,
                "ok": True,
                "note": EastVariant("none", None),
                "tags": EastSet(StringType, ["x", "y"]),
                "meta": EastDict(StringType, IntegerType, {"k": 1}),
                "raw": EastBlob(bytes([1, 255])),
            }
        ),
        EastStruct(
            {
                "id": -9223372036854775808,
                "name": 'é中"\\\n',
                "at": datetime(2026, 2, 28, 23, 59, 59, 999000, tzinfo=UTC),
                "ratio": float("inf"),
                "ok": False,
                "note": EastVariant("some", "hi"),
                "tags": EastSet(StringType, []),
                "meta": EastDict(StringType, IntegerType, {}),
                "raw": EastBlob(b""),
            }
        ),
    ]
    array_type = ArrayType(row)
    encoded = encode_json_for(array_type)(rows).decode("utf-8")

    reader = JsonReader.open_text(encoded, "")
    out = []
    while reader.more():
        out.append(reader.next(row))
    reader.close()
    assert len(out) == 2
    for got, want in zip(out, rows, strict=True):
        for field in ("id", "name", "at", "ok", "note", "tags", "meta", "raw"):
            assert got[field] == want[field], field
        assert repr(got["ratio"]) == repr(want["ratio"])


# Each is a payload the historic decoder tolerates and the published contract
# does not. int() and the old decoder swallow every integer spelling here.
@pytest.mark.parametrize(
    ("typ", "text", "why"),
    [
        (INT_STRUCT, '{"v":"0x10"}', "hexadecimal"),
        (INT_STRUCT, '{"v":"0b101"}', "binary"),
        (INT_STRUCT, '{"v":"0o17"}', "octal"),
        (INT_STRUCT, '{"v":" 7 "}', "padded with spaces"),
        (INT_STRUCT, '{"v":"007"}', "leading zero"),
        (INT_STRUCT, '{"v":"+7"}', "explicit plus"),
        (INT_STRUCT, '{"v":"-0"}', "negative zero"),
        (INT_STRUCT, '{"v":7}', "a bare JSON number"),
        (INT_STRUCT, '{"v":"9223372036854775808"}', "past the i64 ceiling"),
        (INT_STRUCT, '{"v":"18446744073709551615"}', "an unsigned 64-bit id"),
        (DATE_STRUCT, '{"v":"2022-06-29T13:43:00.123Z"}', "a Z suffix"),
        (DATE_STRUCT, '{"v":"2022-06-29T13:43:00.123+05:00"}', "a numeric offset"),
        (DATE_STRUCT, '{"v":"2022-06-29T13:43:00+00:00"}', "no milliseconds"),
        (DATE_STRUCT, '{"v":"2026-02-30T00:00:00.000+00:00"}', "a day February lacks"),
        (DATE_STRUCT, '{"v":"2026-04-31T00:00:00.000+00:00"}', "a day April lacks"),
        (DATE_STRUCT, '{"v":"2025-02-29T00:00:00.000+00:00"}', "Feb 29 in a common year"),
        (BLOB_STRUCT, '{"v":"0xDEADBEEF"}', "uppercase hex"),
        (BLOB_STRUCT, '{"v":"0x123"}', "an odd digit count"),
        (BLOB_STRUCT, '{"v":"deadbeef"}', "no 0x prefix"),
        (INT_STRUCT, '{"v":"1","extra":1}', "an unmodelled field"),
        (INT_STRUCT, "{}", "a missing field"),
    ],
)
def test_rejects_what_the_encoder_never_emits(typ, text, why):
    assert not accepts(typ, text), why


def test_joins_an_escaped_surrogate_pair():
    """An astral character escaped as a surrogate pair is ONE code point.

    Python strings are code points, not UTF-16 code units, so decoding the
    halves separately would leave two lone surrogates where east-node and
    east-c produce the character — a document read differently on different
    runtimes.
    """
    want = "a\U0001F600b"
    for text in (json.dumps(want, ensure_ascii=False), json.dumps(want, ensure_ascii=True)):
        assert read(StringType, text) == want


def test_accepts_a_leap_day():
    assert accepts(DATE_STRUCT, '{"v":"2024-02-29T00:00:00.000+00:00"}')


def test_accepts_object_fields_in_any_order():
    """JSON objects are unordered, so the encoder's field order is not required."""
    typ = StructType([("a", IntegerType), ("b", StringType)])
    assert accepts(typ, '{"a":"1","b":"x"}')
    assert accepts(typ, '{"b":"x","a":"1"}')


def test_refuses_a_variant_whose_payload_precedes_its_tag():
    """The payload cannot be typed before the case is known."""
    typ = VariantType([("none", NullType), ("some", IntegerType)])
    assert accepts(typ, '{"type":"some","value":"1"}')
    assert not accepts(typ, '{"value":"1","type":"some"}')


def test_refuses_a_document_nested_deeper_than_the_limit():
    """The bound is east-c's, so every runtime refuses exactly the same documents."""
    deep = "[" * 100_000 + "]" * 100_000
    with pytest.raises(Exception, match=f"nests deeper than {MAX_DEPTH}"):
        JsonReader.open_text(f'{{"junk":{deep},"data":[]}}', "/data")


def test_reports_a_pointer_into_the_document():
    with pytest.raises(Exception, match=r"/1/v"):
        read(ArrayType(INT_STRUCT), '[{"v":"1"},{"v":"x"}]')


def test_reads_an_envelope_member_that_follows_a_large_array(tmp_path):
    path = tmp_path / "envelope.json"
    parts = ['{"data":[']
    parts += [f'{"," if i else ""}{{"id":"{i}"}}' for i in range(20_000)]
    parts.append('],"meta":{"n":"20000"}}')
    path.write_text("".join(parts))

    reader = JsonReader.open_value_file(str(path), "/meta")
    try:
        meta = reader.read_value(StructType([("n", IntegerType)]))
    finally:
        reader.close()
    assert meta["n"] == 20_000


def test_retention_does_not_track_the_document(tmp_path):
    """Reading four times the document must not retain four times the memory.

    Decoding through east-c carries a few MiB of fixed pool overhead that a
    baseline cannot subtract, because the pools fill as rows are read. An
    absolute budget would therefore measure the pools rather than the property.
    What actually matters is the SHAPE: retention is flat in the document's
    size, so quadrupling the rows must not quadruple what is held.
    """
    row = StructType([("id", IntegerType), ("name", StringType)])

    def retained_for(rows: int) -> tuple[int, int]:
        path = tmp_path / f"rows-{rows}.json"
        body = ",".join(f'{{"id":"{i}","name":"row-{i}"}}' for i in range(rows))
        path.write_text(f'{{"data":[{body}],"meta":{{"n":"{rows}"}}}}')
        gc.collect()
        tracemalloc.start()
        reader = JsonReader.open_file(str(path), "/data")
        count = 0
        total = 0
        try:
            while reader.more():
                total += reader.next(row)["id"]
                count += 1
        finally:
            reader.close()
        gc.collect()
        held = tracemalloc.get_traced_memory()[0]
        tracemalloc.stop()
        assert count == rows
        assert total == (rows - 1) * rows // 2
        return held, path.stat().st_size

    small, small_size = retained_for(50_000)
    large, large_size = retained_for(200_000)

    assert large_size > small_size * 3, "the larger document must actually be larger"
    # Proportional retention would be ~4x. Allow generous slack for pool
    # granularity while still failing loudly if the document is being held.
    assert large < small * 2, (
        f"retention tracked the document: {small} bytes for {small_size}, "
        f"{large} bytes for {large_size}"
    )



def test_pointer_must_be_empty_or_rooted():
    with pytest.raises(Exception, match="must be empty or start with"):
        JsonReader.open_text("[]", "data")


def test_a_pointer_that_does_not_resolve_names_the_member():
    with pytest.raises(Exception, match='no member "nope"'):
        JsonReader.open_text('{"data":[]}', "/nope")


def test_iterating_an_object_yields_key_and_value():
    reader = JsonReader.open_text('{"a":"1","b":"2"}', "")
    entry_type = StructType([("key", StringType), ("value", IntegerType)])
    entries = []
    while reader.more():
        entries.append(reader.next(entry_type))
    reader.close()
    assert [(e["key"], e["value"]) for e in entries] == [("a", 1), ("b", 2)]


def test_more_is_a_predicate_and_next_advances():
    """Reading two elements in a row needs no ``more`` between them."""
    reader = JsonReader.open_text('[{"v":"1"},{"v":"2"}]', "")
    first = reader.next(INT_STRUCT)
    second = reader.next(INT_STRUCT)
    assert (first["v"], second["v"]) == (1, 2)
    assert reader.more() is False
    reader.close()


def test_rejects_json_the_grammar_forbids():
    for text in ['{"v":"1",}', "[1,]", "{'v':'1'}", '{"v":01}', "[NaN]"]:
        assert not accepts(INT_STRUCT, text), text


def test_error_text_carries_the_pointer_like_the_node_reader():
    """The message shape is part of the cross-runtime contract."""
    try:
        read(ArrayType(INT_STRUCT), '[{"v":"1"},{"v":"nope"}]')
    except Exception as err:  # noqa: BLE001
        assert str(err).startswith("/1/v: ")
        assert json.dumps("nope") in str(err)
    else:
        pytest.fail("should have refused the document")
