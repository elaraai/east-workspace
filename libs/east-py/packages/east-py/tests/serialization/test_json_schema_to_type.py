#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Building an East type from a JSON Schema — the python twin of typeFromJsonSchema.

The one place the full JSON Schema vocabulary is confronted. It runs at build
time, so everything it rejects is rejected before any runtime sees it, and every
refusal names the keyword and its RFC 6901 pointer.
"""

import pytest

from east.serialization.json_schema import json_schema_for
from east.serialization.json_schema_to_type import (
    JsonSchemaUnsupportedError,
    type_from_json_schema,
)
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    MatrixType,
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
    return VariantType([("none", NullType), ("some", inner)])


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


@pytest.mark.parametrize("draft", ["2020-12", "draft-07", "openapi-3.0"])
@pytest.mark.parametrize(("name", "typ"), CORPUS, ids=[n for n, _ in CORPUS])
def test_inverts_every_corpus_type_exactly(draft, name, typ):
    assert type_from_json_schema(json_schema_for(typ, draft=draft)) == typ


def test_maps_the_primitive_types_of_a_foreign_document():
    assert type_from_json_schema({"type": "null"}) == NullType
    assert type_from_json_schema({"type": "boolean"}) == BooleanType
    assert type_from_json_schema({"type": "string"}) == StringType
    assert type_from_json_schema({"type": "number"}) == FloatType
    assert type_from_json_schema({"type": "integer"}) == IntegerType


def test_reads_openapi_nullable():
    assert type_from_json_schema({"nullable": True, "enum": [None]}) == NullType


def test_maps_a_closed_fully_required_object_to_a_struct():
    built = type_from_json_schema(
        {
            "type": "object",
            "properties": {"a": {"type": "string"}, "b": {"type": "integer"}},
            "required": ["a", "b"],
            "additionalProperties": False,
        }
    )
    assert built == StructType([("a", StringType), ("b", IntegerType)])


@pytest.mark.parametrize(
    "tag", [{"const": "ok"}, {"enum": ["ok"]}], ids=["const", "single-valued enum"]
)
def test_maps_a_tagged_oneof_to_a_variant(tag):
    built = type_from_json_schema(
        {
            "oneOf": [
                {
                    "type": "object",
                    "properties": {"type": tag, "value": {"type": "integer"}},
                    "required": ["type", "value"],
                    "additionalProperties": False,
                }
            ]
        }
    )
    assert built == VariantType([("ok", IntegerType)])


def test_without_annotations_a_set_is_indistinguishable_from_an_array():
    """The documented limit of the best-effort mapping.

    ``uniqueItems`` is not enough to recover Set, so an un-annotated document
    does not promise to round-trip.
    """
    built = type_from_json_schema(
        {"type": "array", "items": {"type": "string"}, "uniqueItems": True}
    )
    assert built == ArrayType(StringType)


def test_reads_definitions_from_either_keyword():
    modern = type_from_json_schema({"$ref": "#/$defs/Leaf", "$defs": {"Leaf": {"type": "string"}}})
    legacy = type_from_json_schema(
        {"$ref": "#/definitions/Leaf", "definitions": {"Leaf": {"type": "string"}}}
    )
    assert modern == StringType
    assert legacy == StringType


@pytest.mark.parametrize("draft", ["2020-12", "draft-07"])
def test_honours_schema_on_the_releases_it_emits(draft):
    schema = json_schema_for(ArrayType(IntegerType), draft=draft)
    assert "$schema" in schema
    assert type_from_json_schema(schema) == ArrayType(IntegerType)


def test_accepts_a_fragment_carrying_no_schema():
    """An OpenAPI 3.0 schema object carries no ``$schema`` of its own.

    It is a fragment of a larger document, so requiring one would reject
    exactly what ``json_schema_for(..., draft="openapi-3.0")`` emits.
    """
    schema = json_schema_for(ArrayType(IntegerType), draft="openapi-3.0")
    assert "$schema" not in schema
    assert type_from_json_schema(schema) == ArrayType(IntegerType)
    assert type_from_json_schema({"type": "string"}) == StringType


@pytest.mark.parametrize(
    "uri",
    [
        "http://json-schema.org/draft-04/schema#",
        "https://json-schema.org/draft/2019-09/schema",
    ],
)
def test_refuses_a_release_it_cannot_read(uri):
    with pytest.raises(JsonSchemaUnsupportedError, match="cannot read the JSON Schema release") as e:
        type_from_json_schema({"$schema": uri, "type": "string"})
    assert e.value.pointer == "/$schema"


@pytest.mark.parametrize(
    "uri",
    [
        "https://json-schema.org/draft/2020-12/schema",
        "http://json-schema.org/draft/2020-12/schema#",
        "http://json-schema.org/draft-07/schema#",
        "https://json-schema.org/draft-07/schema",
    ],
)
def test_ignores_the_scheme_and_a_trailing_hash(uri):
    """Neither is significant in a ``$schema`` value, and producers vary."""
    assert type_from_json_schema({"$schema": uri, "type": "string"}) == StringType


def test_refuses_a_non_string_schema():
    with pytest.raises(JsonSchemaUnsupportedError, match=r'expected "\$schema" to be a string'):
        type_from_json_schema({"$schema": 7, "type": "string"})


def test_resolves_draft_07_definitions_it_declares():
    built = type_from_json_schema(
        {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "$ref": "#/definitions/Leaf",
            "definitions": {"Leaf": {"type": "string"}},
        }
    )
    assert built == StringType


def test_refuses_mutually_recursive_definitions():
    with pytest.raises(JsonSchemaUnsupportedError, match="mutually recursive"):
        type_from_json_schema(
            {
                "$ref": "#/$defs/A",
                "$defs": {
                    "A": {
                        "type": "object",
                        "properties": {"b": {"$ref": "#/$defs/B"}},
                        "required": ["b"],
                        "additionalProperties": False,
                    },
                    "B": {
                        "type": "object",
                        "properties": {"a": {"$ref": "#/$defs/A"}},
                        "required": ["a"],
                        "additionalProperties": False,
                    },
                },
            }
        )


@pytest.mark.parametrize(
    ("schema", "message", "pointer"),
    [
        ({"type": "object", "allOf": [{"type": "string"}]}, "have no intersection", "/allOf"),
        ({"not": {"type": "string"}}, "have no negation", "/not"),
        ({"anyOf": [{"type": "string"}]}, "variants are discriminated", "/anyOf"),
        ({"if": {"type": "string"}, "then": {"type": "string"}}, "have no conditionals", "/if"),
        (
            {"type": "object", "patternProperties": {"^a": {"type": "string"}}},
            "no pattern-keyed record",
            "/patternProperties",
        ),
        (
            {"type": "array", "prefixItems": [{"type": "string"}]},
            "no tuple type",
            "/prefixItems",
        ),
    ],
)
def test_refuses_keywords_east_cannot_express(schema, message, pointer):
    with pytest.raises(JsonSchemaUnsupportedError, match=message) as excinfo:
        type_from_json_schema(schema)
    assert excinfo.value.pointer == pointer


def test_refuses_an_open_record():
    with pytest.raises(JsonSchemaUnsupportedError, match="East structs are closed"):
        type_from_json_schema(
            {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]}
        )


def test_refuses_an_optional_property_pointing_at_it():
    with pytest.raises(JsonSchemaUnsupportedError, match="model it as an Option") as excinfo:
        type_from_json_schema(
            {
                "type": "object",
                "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
                "required": ["a"],
                "additionalProperties": False,
            }
        )
    assert excinfo.value.pointer == "/properties/b"


def test_refuses_a_union_of_primitive_types():
    with pytest.raises(JsonSchemaUnsupportedError, match="discriminated variants"):
        type_from_json_schema({"type": ["string", "null"]})


def test_refuses_an_unconstrained_schema():
    with pytest.raises(JsonSchemaUnsupportedError, match="unconstrained schema"):
        type_from_json_schema({"description": "anything at all"})


def test_refuses_an_untagged_oneof():
    with pytest.raises(JsonSchemaUnsupportedError, match="untagged union") as excinfo:
        type_from_json_schema({"oneOf": [{"type": "string"}, {"type": "number"}]})
    assert excinfo.value.pointer == "/oneOf/0"


def test_refuses_a_reference_it_cannot_resolve():
    with pytest.raises(JsonSchemaUnsupportedError, match="no such definition"):
        type_from_json_schema({"$ref": "#/$defs/Nope"})
    with pytest.raises(JsonSchemaUnsupportedError, match="only local"):
        type_from_json_schema({"$ref": "https://example.com/other.json"})


def test_points_into_the_document_not_just_at_the_root():
    with pytest.raises(JsonSchemaUnsupportedError, match="have no negation") as excinfo:
        type_from_json_schema(
            {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"inner": {"not": {"type": "string"}}},
                    "required": ["inner"],
                    "additionalProperties": False,
                },
            }
        )
    assert excinfo.value.pointer == "/items/properties/inner/not"
