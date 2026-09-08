#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East JSON's one type-directed choice of form, at the python bridge.

An ``Option<T>`` encodes as ``null`` for ``none`` and as ``T``'s own encoding
for ``some`` whenever that encoding can never be ``null``; only ``Option<Null>``
and ``Option<Option<T>>`` keep the tagged object, which is what keeps
``some(none)`` distinct from ``none``. The codec is east-c's, so these pin that
the rule reaches a python caller byte for byte, and that the rule the schema
applies in python agrees with what the codec does.
"""

import pytest

from east.serialization.json import decode_json_for, encode_json_for
from east.serialization.json_schema import _flat_option_payload
from east.types.types import (
    ArrayType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    RecursiveType,
    StringType,
    StructType,
    VariantType,
)
from east.types.values import EastArray, EastDict, EastStruct, EastVariant


def option(inner):
    """The Option encoding, spelled as the variant it is."""
    return VariantType([("none", NullType), ("some", inner)])


NONE = EastVariant("none", None)

# The ordinary linked list: an Option of the struct itself, flat at every depth.
CHAIN = RecursiveType(lambda self: StructType([("head", IntegerType), ("next", option(self))]))

# A wrapper around an Option is judged as that Option: flat itself, tagged as
# the payload of another Option.
MAYBE_CHAIN = RecursiveType(
    lambda self: option(StructType([("head", IntegerType), ("next", self)]))
)

OK_ERR = VariantType([("ok", NullType), ("err", StringType)])


@pytest.mark.parametrize(
    ("typ", "value", "text"),
    [
        (option(StringType), NONE, b"null"),
        (option(StringType), EastVariant("some", "x"), b'"x"'),
        (option(StringType), EastVariant("some", ""), b'""'),
        (option(IntegerType), EastVariant("some", 7), b'"7"'),
        (option(FloatType), EastVariant("some", float("nan")), b'"NaN"'),
        (option(FloatType), EastVariant("some", 1.5), b"1.5"),
        (
            option(StructType([("a", IntegerType)])),
            EastVariant("some", EastStruct({"a": 1})),
            b'{"a":"1"}',
        ),
        # A variant is always an object, so it is a flat payload -- Null case and all.
        (
            option(OK_ERR),
            EastVariant("some", EastVariant("ok", None)),
            b'{"type":"ok","value":null}',
        ),
        (option(OK_ERR), NONE, b"null"),
        (
            ArrayType(option(StringType)),
            EastArray(option(StringType), [NONE, EastVariant("some", "x")]),
            b'[null,"x"]',
        ),
        (
            DictType(StringType, option(IntegerType)),
            EastDict(StringType, option(IntegerType), {"a": NONE, "b": EastVariant("some", 1)}),
            b'[{"key":"a","value":null},{"key":"b","value":"1"}]',
        ),
        # The two payloads that can themselves be null keep the tagged form.
        (option(option(StringType)), NONE, b'{"type":"none","value":null}'),
        (option(option(StringType)), EastVariant("some", NONE), b'{"type":"some","value":null}'),
        (
            option(option(StringType)),
            EastVariant("some", EastVariant("some", "x")),
            b'{"type":"some","value":"x"}',
        ),
        (option(NullType), NONE, b'{"type":"none","value":null}'),
        (option(NullType), EastVariant("some", None), b'{"type":"some","value":null}'),
        # A recursive payload is judged by what the wrapper encodes.
        (
            CHAIN,
            EastStruct(
                {"head": 2, "next": EastVariant("some", EastStruct({"head": 1, "next": NONE}))}
            ),
            b'{"head":"2","next":{"head":"1","next":null}}',
        ),
        (option(CHAIN), NONE, b"null"),
        (
            option(CHAIN),
            EastVariant("some", EastStruct({"head": 1, "next": NONE})),
            b'{"head":"1","next":null}',
        ),
        (
            MAYBE_CHAIN,
            EastVariant("some", EastStruct({"head": 1, "next": NONE})),
            b'{"head":"1","next":null}',
        ),
        (option(MAYBE_CHAIN), EastVariant("some", NONE), b'{"type":"some","value":null}'),
    ],
)
def test_an_option_encodes_flat_where_its_payload_cannot_be_null(typ, value, text):
    assert encode_json_for(typ)(value) == text
    # What it writes, it reads back -- compared through the encoder again, since
    # a NaN never equals itself.
    assert encode_json_for(typ)(decode_json_for(typ)(text)) == text


def test_the_tagged_object_is_refused_under_a_flat_option():
    """A cut, not a negotiation: the payload's own decoder speaks."""
    with pytest.raises(ValueError, match=r'expected string, got \{"type":"none","value":null\}'):
        decode_json_for(option(StringType))(b'{"type":"none","value":null}')
    with pytest.raises(
        ValueError, match=r'expected string representing integer, got \{"type":"some","value":"7"\}'
    ):
        decode_json_for(option(IntegerType))(b'{"type":"some","value":"7"}')
    # ...and a bare null under a tagged Option is refused as the object it is not.
    with pytest.raises(
        ValueError, match="expected object with type and value for Variant, got null"
    ):
        decode_json_for(option(option(StringType)))(b"null")
    with pytest.raises(
        ValueError, match="expected object with type and value for Variant, got null"
    ):
        decode_json_for(option(NullType))(b"null")


def test_the_schema_rule_names_the_payload_of_a_flat_option_and_nothing_else():
    """The one rule the schema applies, pinned case by case beside the codec's bytes above."""
    assert _flat_option_payload(option(StringType)) == StringType
    assert _flat_option_payload(option(OK_ERR)) == OK_ERR
    assert _flat_option_payload(option(NullType)) is None
    assert _flat_option_payload(option(option(StringType))) is None
    # Not an Option at all: another type, another shape of variant, or a none
    # that carries data -- which no bare null could stand for.
    assert _flat_option_payload(StringType) is None
    assert _flat_option_payload(VariantType([("ok", IntegerType), ("err", StringType)])) is None
    assert _flat_option_payload(VariantType([("none", IntegerType), ("some", StringType)])) is None
    assert (
        _flat_option_payload(
            VariantType([("none", NullType), ("some", StringType), ("other", NullType)])
        )
        is None
    )
    # A wrapper is judged by what it wraps; a back-reference by the inner type
    # of the wrapper it names, which the scope supplies.
    assert _flat_option_payload(option(CHAIN)) == CHAIN
    wrapper = CHAIN.value.value
    inner = wrapper["inner"]
    next_field = next(field["type"] for field in inner.value if field["name"] == "next")
    with pytest.raises(ValueError, match="unresolved recursive reference"):
        _flat_option_payload(next_field)
    assert _flat_option_payload(next_field, {wrapper["id"]: inner}) == next_field.value[1]["type"]
    assert _flat_option_payload(option(MAYBE_CHAIN)) is None
