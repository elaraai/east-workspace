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
from east.serialization.json_reader import JsonReader, JsonReadError
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
STRING_STRUCT = StructType([("v", StringType)])


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
    typ = VariantType([("ok", IntegerType), ("err", StringType)])
    assert accepts(typ, '{"type":"ok","value":"1"}')
    assert not accepts(typ, '{"value":"1","type":"ok"}')


def test_reads_an_option_as_null_or_its_payload_and_tagged_only_where_the_payload_can_be_null():
    """The one type-directed choice of form East JSON makes, as east-c reads it for python.

    An Option whose payload can never encode as null is null or the payload,
    so the tagged object there is refused as the payload it is not, in the
    payload's own words. Option<Option<T>> and Option<Null> keep the tagged
    form, so a bare null there is refused as the object it is not.
    """
    from east.types.values import EastVariant

    option_int = VariantType([("none", NullType), ("some", IntegerType)])
    flat = StructType([("v", option_int)])
    assert read(flat, '{"v":null}')["v"] == EastVariant("none", None)
    assert read(flat, '{"v":"7"}')["v"] == EastVariant("some", 7)
    assert refusal(flat, '{"v":{"type":"some","value":"7"}}') == (
        "/v: expected Integer as a quoted decimal string, got an object"
    )
    assert refusal(flat, '{"v":{"type":"none","value":null}}') == (
        "/v: expected Integer as a quoted decimal string, got an object"
    )
    assert refusal(flat, '{"v":"x"}') == '/v: "x" is not a 64-bit integer in East JSON\'s form'

    nested = StructType([("v", VariantType([("none", NullType), ("some", option_int)]))])
    assert read(nested, '{"v":{"type":"some","value":null}}')["v"] == EastVariant(
        "some", EastVariant("none", None)
    )
    assert read(nested, '{"v":{"type":"some","value":"1"}}')["v"] == EastVariant(
        "some", EastVariant("some", 1)
    )
    assert refusal(nested, '{"v":null}') == "/v: expected an object, got null"
    assert refusal(nested, '{"v":"1"}') == "/v: expected an object, got a string"

    unit = StructType([("v", VariantType([("none", NullType), ("some", NullType)]))])
    assert read(unit, '{"v":{"type":"none","value":null}}')["v"] == EastVariant("none", None)
    assert read(unit, '{"v":{"type":"some","value":null}}')["v"] == EastVariant("some", None)
    assert refusal(unit, '{"v":null}') == "/v: expected an object, got null"

    # A recursive payload is judged by what the wrapper encodes: the ordinary
    # linked list, next: Option<self>, is flat at every depth.
    from east.types.types import RecursiveType

    chain = RecursiveType(
        lambda self: StructType(
            [("head", IntegerType), ("next", VariantType([("none", NullType), ("some", self)]))]
        )
    )
    got = read(chain, '{"head":"2","next":{"head":"1","next":null}}')
    assert got["head"] == 2
    assert got["next"].type == "some"
    assert got["next"].value["head"] == 1
    assert got["next"].value["next"] == EastVariant("none", None)
    assert refusal(chain, '{"head":"1","next":{"type":"none","value":null}}') == (
        '/next: unexpected field "type"'
    )


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


def refusal(typ, text) -> str:
    """The exact text the reader refuses ``text`` with."""
    try:
        read(typ, text)
    except JsonReadError as err:
        return str(err)
    pytest.fail(f"should have refused {text!r}")


@pytest.mark.parametrize(
    ("typ", "text", "message"),
    [
        (INT_STRUCT, '{"v":7}', "/v: expected Integer as a quoted decimal string, got a number"),
        (INT_STRUCT, '{"v":"x"}', '/v: "x" is not a 64-bit integer in East JSON\'s form'),
        (
            DATE_STRUCT,
            '{"v":"2026-02-30T00:00:00.000+00:00"}',
            '/v: "2026-02-30T00:00:00.000+00:00" is not a real date',
        ),
        (
            DATE_STRUCT,
            '{"v":"2022-06-29T13:43:00.123Z"}',
            '/v: "2022-06-29T13:43:00.123Z" is not East JSON\'s UTC date-time form',
        ),
        (STRING_STRUCT, '{"v":"a\\qb"}', '/v: invalid escape "\\q"'),
        (STRING_STRUCT, '{"v":"a\x01b"}', "/v: unescaped control character U+0001 in string"),
        (STRING_STRUCT, '{"v":"\\uzzzz"}', '/v: invalid \\u escape "\\uzzzz"'),
        (STRING_STRUCT, '{"v":1}', "/v: expected a String, got a number"),
        (INT_STRUCT, '{v:"1"}', 'expected a field name, got "v"'),
        (INT_STRUCT, "{}", 'missing field "v"'),
        (INT_STRUCT, "[1]", "expected an object, got an array"),
        (INT_STRUCT, "", "expected an object, got end of document"),
        (INT_STRUCT, "☃", 'expected an object, got "☃"'),
    ],
)
def test_error_text_is_the_node_readers_word_for_word(typ, text, message):
    """The message shape is part of the cross-runtime contract.

    The shared corpus pins the whole table through the runners; this pins a
    sample at the bridge, so a divergence is caught here before the replay.
    """
    assert refusal(typ, text) == message


def test_error_text_carries_the_pointer_like_the_node_reader():
    err = refusal(ArrayType(INT_STRUCT), '[{"v":"1"},{"v":"nope"}]')
    assert err == '/1/v: "nope" is not a 64-bit integer in East JSON\'s form'
    assert json.dumps("nope") in err


def test_a_quoted_value_is_clipped_at_200_code_points():
    long = "é" * 250
    err = refusal(INT_STRUCT, json.dumps({"v": long}))
    assert err == f'/v: "{"é" * 200}…" is not a 64-bit integer in East JSON\'s form'


def test_refuses_invalid_utf8_rather_than_repairing_it(tmp_path):
    """Node used to substitute U+FFFD, east-c to pass the bytes through."""
    path = tmp_path / "invalid-utf8.json"
    for raw in (b"\xff", b"\xc0\x80", b"\xed\xa0\x80", b"\xf4\x90\x80\x80"):
        path.write_bytes(b'{"v":"a' + raw + b'b"}')
        reader = JsonReader.open_value_file(str(path), "")
        try:
            with pytest.raises(JsonReadError) as excinfo:
                reader.read_value(STRING_STRUCT)
        finally:
            reader.close()
        assert str(excinfo.value) == "/v: invalid UTF-8 in string"
    assert read(STRING_STRUCT, '{"v":"é😀"}')["v"] == "é😀"


def test_reads_vector_matrix_ref_and_nested_arrays():
    from east.types.types import MatrixType, RefType, VectorType

    vec = read(StructType([("v", VectorType(FloatType))]), '{"v":[1.5,"NaN",-2e3]}')["v"]
    assert list(vec.to_numpy())[0] == 1.5
    assert list(vec.to_numpy())[2] == -2000.0
    mat = read(StructType([("v", MatrixType(IntegerType))]), '{"v":[["1","2"],["3","4"]]}')["v"]
    assert mat.rows() == 2
    assert mat.cols() == 2
    assert mat.get(1, 1) == 4
    cell = read(StructType([("v", RefType(IntegerType))]), '{"v":["7"]}')["v"]
    assert cell.get() == 7
    grid = read(StructType([("v", ArrayType(ArrayType(IntegerType)))]), '{"v":[["1"],[]]}')["v"]
    assert [list(row) for row in grid] == [[1], []]
    assert refusal(StructType([("v", MatrixType(IntegerType))]), '{"v":[["1","2"],["3"]]}') == (
        "/v: Matrix row 1 has 1 columns, expected 2"
    )
    assert refusal(StructType([("v", RefType(IntegerType))]), '{"v":["1","2"]}') == (
        "/v: expected a Ref to hold exactly one element"
    )


def test_iterates_an_object_as_entries_in_either_field_order():
    """The struct is built in the type's own order, so its fields pair with their values."""
    for entry_type in (
        StructType([("key", StringType), ("value", IntegerType)]),
        StructType([("value", IntegerType), ("key", StringType)]),
    ):
        reader = JsonReader.open_text('{"a":"1","b":"2"}', "")
        entries = []
        while reader.more():
            entries.append(reader.next(entry_type))
        reader.close()
        assert [(e["key"], e["value"]) for e in entries] == [("a", 1), ("b", 2)]


def test_a_bad_member_is_located_by_its_name():
    reader = JsonReader.open_text('{"a":"1","b~/c":"x"}', "")
    entry_type = StructType([("key", StringType), ("value", IntegerType)])
    try:
        reader.next(entry_type)
        with pytest.raises(JsonReadError) as excinfo:
            reader.next(entry_type)
    finally:
        reader.close()
    assert str(excinfo.value) == '/b~0~1c: "x" is not a 64-bit integer in East JSON\'s form'
    assert excinfo.value.pointer == "/b~0~1c"


def test_a_wrong_entry_type_is_refused_at_the_container():
    reader = JsonReader.open_text('{"a":"1"}', "")
    try:
        with pytest.raises(JsonReadError, match="^iterating an object needs a Struct with exactly"):
            reader.next(IntegerType)
        with pytest.raises(JsonReadError, match="^iterating an object needs a String key$"):
            reader.next(StructType([("key", IntegerType), ("value", IntegerType)]))
    finally:
        reader.close()


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ('{"junk":[1,,2],"data":[]}', 'unexpected character ","'),
        ('{"junk":trux,"data":[]}', "expected true"),
        ('{"junk":"a\\qb","data":[]}', 'invalid escape "\\q"'),
        ('{"junk":{"a" 1},"data":[]}', 'expected ":" after a field name, got a number'),
        ('{"junk":[1 2],"data":[]}', 'expected "," or "]" in array'),
        ('{"junk":[1,2', "unexpected end of document"),
        ('{"junk":' + '{"a":[' * 1500 + "1" + "]}" * 1500 + ',"data":[]}',
         "document nests deeper than 2048"),
    ],
)
def test_a_skipped_value_is_held_to_the_grammar(text, message):
    """Navigating past a value is not reading it, but it is still JSON."""
    with pytest.raises(JsonReadError) as excinfo:
        JsonReader.open_text(text, "/data")
    assert str(excinfo.value) == message


def test_an_empty_file_is_refused_by_name(tmp_path):
    path = tmp_path / "empty.json"
    path.write_bytes(b"")
    with pytest.raises(JsonReadError, match="^the document is empty$"):
        JsonReader.open_file(str(path), "")


def test_floats_read_the_same_under_a_comma_decimal_locale():
    """A comma locale's strtod stops at the point; the reader must not."""
    import locale

    chosen = None
    for name in ("de_DE.UTF-8", "de_DE.utf8", "de_DE", "fr_FR.UTF-8", "de-DE"):
        try:
            locale.setlocale(locale.LC_NUMERIC, name)
        except locale.Error:
            continue
        chosen = name
        break
    if chosen is None or locale.localeconv()["decimal_point"] != ",":
        pytest.skip("no comma-decimal locale on this host")
    try:
        values = read(ArrayType(FloatType), "[1.5,2.25,1.5e2,1e-3]")
        assert list(values) == [1.5, 2.25, 150.0, 0.001]
        assert encode_json_for(ArrayType(FloatType))(values) == b"[1.5,2.25,150,0.001]"
    finally:
        locale.setlocale(locale.LC_NUMERIC, "C")
