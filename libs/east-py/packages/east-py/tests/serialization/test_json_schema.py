#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""JSON Schema emission for East types — the python half of the contract.

The schema describes what ``print_json`` emits and what a strict reader
accepts, so a producer validating against it cannot send a payload that would
then be rejected. It pins the ENCODER's canonical output rather than the
historic decoder's tolerance, and it must match the TypeScript implementation
byte for byte — the two languages hand the same partner the same document.
"""

import hashlib
import json
import re

import pytest

from east.serialization.json_schema import EAST_JSON_PATTERNS, json_schema_for
from east.types.types import (
    ArrayType,
    AsyncFunctionType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    FunctionType,
    IntegerType,
    MatrixType,
    NeverType,
    NullType,
    RecursiveType,
    RefType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
)

RECURSIVE_TYPE = RecursiveType(
    lambda self: VariantType(
        [("nil", NullType), ("cons", StructType([("head", IntegerType), ("tail", self)]))]
    )
)


def option(inner):
    """The Option encoding, spelled as the variant it is."""
    return VariantType([("none", NullType), ("some", inner)])


# The corpus the cross-language digest is taken over. The TypeScript suite
# holds the same list in the same order (json_schema.spec.ts).
CORPUS = [
    ("Null", NullType),
    ("Boolean", BooleanType),
    ("Integer", IntegerType),
    ("Float", FloatType),
    ("String", StringType),
    ("DateTime", DateTimeType),
    ("Blob", BlobType),
    ("Array", ArrayType(IntegerType)),
    ("Set", SetType(StringType)),
    ("Dict", DictType(StringType, IntegerType)),
    ("Struct", StructType([("a", StringType), ("b", IntegerType), ("c", DateTimeType)])),
    ("Variant", VariantType([("ok", IntegerType), ("err", StringType)])),
    ("Option", option(StringType)),
    ("Ref", RefType(IntegerType)),
    ("Vector", VectorType(FloatType)),
    ("Matrix", MatrixType(IntegerType)),
    (
        "nested",
        ArrayType(
            StructType(
                [
                    ("id", IntegerType),
                    ("tags", SetType(StringType)),
                    ("note", option(StringType)),
                    ("when", DateTimeType),
                ]
            )
        ),
    ),
    ("recursive", RECURSIVE_TYPE),
    ("arrayRecursive", ArrayType(RECURSIVE_TYPE)),
]

DRAFTS = ("2020-12", "draft-07", "openapi-3.0")


def test_matches_the_cross_language_corpus_digest():
    """The TypeScript suite asserts this same digest over the same corpus.

    Two languages agreeing on one hash is what keeps a partner from being handed
    different contracts. Changing the emitted bytes deliberately means updating
    both constants, which is the point.
    """
    lines = []
    for draft in DRAFTS:
        for name, typ in CORPUS:
            document = json.dumps(json_schema_for(typ, draft=draft), separators=(",", ":"))
            lines.append(f"{draft}|{name}={document}")
    assert len(lines) == 57
    digest = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
    assert digest == "1e81eb8f85b480e3029ea589c02ae71e465d5b391814a1ddb0ed22325201cf3c"


def test_stamps_schema_for_the_releases_that_carry_one():
    assert (
        json_schema_for(StringType)["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    )
    assert (
        json_schema_for(StringType, draft="draft-07")["$schema"]
        == "http://json-schema.org/draft-07/schema#"
    )
    # An OpenAPI 3.0 schema object lives inside an OpenAPI document.
    assert "$schema" not in json_schema_for(StringType, draft="openapi-3.0")


@pytest.mark.parametrize(
    "text",
    ["0", "1", "-1", "42", "9223372036854775807", "-9223372036854775808"],
)
def test_integer_pattern_accepts_the_i64_range(text):
    assert re.match(EAST_JSON_PATTERNS.integer, text)


@pytest.mark.parametrize(
    "text",
    [
        "9223372036854775808",  # one past the ceiling
        "-9223372036854775809",  # one past the floor
        "18446744073709551615",  # an unsigned 64-bit id
        "9999999999999999999",  # what the naive pattern would admit
        "0x10",
        "0b101",
        "0o17",
        " 7 ",
        "+7",
        "007",
        "-0",
        "",
        "1e3",
        "7.5",
    ],
)
def test_integer_pattern_rejects_what_the_encoder_never_emits(text):
    """Every one of these is swallowed by ``int()`` or the historic decoder."""
    assert re.match(EAST_JSON_PATTERNS.integer, text) is None


@pytest.mark.parametrize(
    "text",
    [
        "2022-06-29T13:43:00.123Z",  # the decoder takes Z; the encoder never writes it
        "2022-06-29T13:43:00.123+05:00",
        "2022-13-29T13:43:00.123+00:00",
        "2022-06-32T13:43:00.123+00:00",
        "2022-06-29T24:43:00.123+00:00",
        "2022-06-29T13:43:00+00:00",
    ],
)
def test_datetime_pattern_rejects_non_canonical_text(text):
    assert re.match(EAST_JSON_PATTERNS.datetime, text) is None


def test_datetime_pattern_accepts_the_canonical_form():
    assert re.match(EAST_JSON_PATTERNS.datetime, "2022-06-29T13:43:00.123+00:00")


@pytest.mark.parametrize("text", ["0xDEADBEEF", "0x123", "deadbeef", "0xgg"])
def test_blob_pattern_rejects_non_canonical_text(text):
    assert re.match(EAST_JSON_PATTERNS.blob, text) is None


def test_blob_pattern_accepts_lowercase_hex():
    assert re.match(EAST_JSON_PATTERNS.blob, "0x")
    assert re.match(EAST_JSON_PATTERNS.blob, "0xdeadbeef")


def test_struct_is_closed_and_fully_required():
    schema = json_schema_for(StructType([("a", StringType), ("b", BooleanType)]))
    assert schema["type"] == "object"
    assert schema["required"] == ["a", "b"]
    assert schema["additionalProperties"] is False


def test_variant_pins_each_tag():
    schema = json_schema_for(VariantType([("ok", IntegerType), ("err", StringType)]))
    # VariantType sorts its cases, so the order is fixed by the type.
    tags = [alt["properties"]["type"]["const"] for alt in schema["oneOf"]]
    assert tags == ["err", "ok"]


def test_openapi_uses_an_enum_where_the_release_has_no_const():
    schema = json_schema_for(option(StringType), draft="openapi-3.0")
    tag = schema["oneOf"][0]["properties"]["type"]
    assert tag["enum"] == ["none"]
    assert "const" not in tag


def test_null_has_no_null_type_on_openapi():
    assert json_schema_for(NullType, draft="openapi-3.0") == {"nullable": True, "enum": [None]}


def test_recursive_lifts_into_defs_named_by_encounter_order():
    schema = json_schema_for(RECURSIVE_TYPE)
    assert schema["$ref"] == "#/$defs/Recursive1"
    assert "Recursive1" in schema["$defs"]
    # Scope ids come from a process-global counter, so a document keyed on them
    # would differ between runs and between languages.
    assert json.dumps(schema) == json.dumps(json_schema_for(RECURSIVE_TYPE))


def test_recursive_uses_the_release_definitions_keyword():
    schema = json_schema_for(RECURSIVE_TYPE, draft="draft-07")
    assert schema["$ref"] == "#/definitions/Recursive1"
    assert "definitions" in schema
    assert "$defs" not in schema


@pytest.mark.parametrize(
    ("typ", "message"),
    [
        (NeverType, "cannot describe Never"),
        (FunctionType([], IntegerType), "cannot describe Function"),
        (AsyncFunctionType([], IntegerType), "cannot describe AsyncFunction"),
        (StructType([("f", FunctionType([], IntegerType))]), "cannot describe Function"),
    ],
)
def test_refuses_types_with_no_json_form(typ, message):
    with pytest.raises(TypeError, match=message):
        json_schema_for(typ)


def test_refuses_a_release_it_does_not_emit():
    with pytest.raises(ValueError, match="does not emit"):
        json_schema_for(StringType, draft="draft-04")
