#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The wire types of typed jq queries over East values.

The python twins of ``libs/east/src/query/types.ts``. A query's text is parsed
and checked once, in an SDK, into a ``QueryType`` value: the program as a
``JqType`` tree, the type it was checked against, the type of each output, and
how many outputs it gives. A runtime evaluates a checked query and never reads
query text.

Struct fields are declared alphabetically in both languages, so each type
encodes to the same bytes as its TypeScript twin; ``tests/test_query_types.py``
compares them against the header of ``libs/east/test/fixtures/query-corpus.beast2``.
``libs/east/devdocs/QUERY.md`` is the normative account of what the values mean.
"""

from __future__ import annotations

from east.types.type_of_type import EastTypeType
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    recursive_type,
)

# A destructuring pattern, as ``as``, ``reduce`` and ``foreach`` bind one:
# ``array`` ``[$a, $b]``; ``object`` ``{name: $n, $id}``, whose entries read the
# field named by ``key`` (an entry with no ``value`` binds the variable named
# ``key``); ``variable`` ``$x``, named without its ``$``.
JqPatternType = recursive_type(
    lambda pattern: VariantType(
        [
            ("array", ArrayType(pattern)),
            (
                "object",
                ArrayType(StructType([("key", StringType), ("value", OptionType(pattern))])),
            ),
            ("variable", StringType),
        ]
    )
)

# A jq program, as a tree. The parser keeps jq's sugar (``.a.b`` is two
# ``field`` nodes, ``f?`` is a ``try`` with no ``catch``), and a ``literal``
# holds its constant as a self-describing beast2 blob. Operators, builtin
# names and error codes are strings, so a new one never changes this type.
JqType = recursive_type(
    lambda jq: VariantType(
        [
            ("alternative", StructType([("left", jq), ("right", jq)])),
            ("array", OptionType(jq)),
            ("binary", StructType([("left", jq), ("op", StringType), ("right", jq)])),
            (
                "bind",
                StructType(
                    [("body", jq), ("patterns", ArrayType(JqPatternType)), ("source", jq)]
                ),
            ),
            ("break", StringType),
            ("call", StructType([("args", ArrayType(jq)), ("name", StringType)])),
            ("comma", StructType([("left", jq), ("right", jq)])),
            (
                "def",
                StructType(
                    [
                        ("body", jq),
                        ("name", StringType),
                        ("params", ArrayType(StringType)),
                        ("rest", jq),
                    ]
                ),
            ),
            ("descend", NullType),
            (
                "field",
                StructType([("name", StringType), ("optional", BooleanType), ("target", jq)]),
            ),
            (
                "foreach",
                StructType(
                    [
                        ("extract", OptionType(jq)),
                        ("init", jq),
                        ("pattern", JqPatternType),
                        ("source", jq),
                        ("update", jq),
                    ]
                ),
            ),
            ("format", StructType([("name", StringType), ("string", OptionType(jq))])),
            ("identity", NullType),
            (
                "if",
                StructType(
                    [
                        (
                            "branches",
                            ArrayType(StructType([("condition", jq), ("then", jq)])),
                        ),
                        ("otherwise", OptionType(jq)),
                    ]
                ),
            ),
            (
                "index",
                StructType([("index", jq), ("optional", BooleanType), ("target", jq)]),
            ),
            ("iterate", StructType([("optional", BooleanType), ("target", jq)])),
            ("label", StructType([("body", jq), ("name", StringType)])),
            ("literal", BlobType),
            ("negate", jq),
            (
                "object",
                ArrayType(
                    StructType(
                        [
                            (
                                "key",
                                VariantType(
                                    [
                                        ("computed", jq),
                                        ("name", StringType),
                                        ("variable", StringType),
                                    ]
                                ),
                            ),
                            ("value", OptionType(jq)),
                        ]
                    )
                ),
            ),
            ("pipe", StructType([("left", jq), ("right", jq)])),
            (
                "reduce",
                StructType(
                    [
                        ("init", jq),
                        ("pattern", JqPatternType),
                        ("source", jq),
                        ("update", jq),
                    ]
                ),
            ),
            (
                "slice",
                StructType(
                    [
                        ("from", OptionType(jq)),
                        ("optional", BooleanType),
                        ("target", jq),
                        ("to", OptionType(jq)),
                    ]
                ),
            ),
            (
                "string",
                ArrayType(VariantType([("interpolate", jq), ("text", StringType)])),
            ),
            ("try", StructType([("body", jq), ("catch", OptionType(jq))])),
            ("update", StructType([("op", StringType), ("path", jq), ("value", jq)])),
            ("variable", StringType),
        ]
    )
)

# How many outputs a query gives: exactly one, none or one, or many. The result
# is the element type T, Option<T> or Array<T> respectively.
QueryMultiplicityType = VariantType([("many", NullType), ("maybe", NullType), ("one", NullType)])

# A checked query, version 1: the type of each output, the type it was checked
# against, how many outputs it gives, and the program with the checker's
# rewrites applied.
QueryV1Type = StructType(
    [
        ("element_type", EastTypeType),
        ("input_type", EastTypeType),
        ("multiplicity", QueryMultiplicityType),
        ("program", JqType),
    ]
)

# The versioned envelope every runtime accepts. A structural change is a new
# case sorting after ``v1``; readers accept every released version.
QueryType = VariantType([("v1", QueryV1Type)])

# A range of query text, in UTF-16 code units (the unit browsers and
# TypeScript index strings in): ``column`` and ``line`` are 1-based, ``offset``
# is 0-based over the whole text.
QuerySpanType = StructType(
    [
        ("column", IntegerType),
        ("length", IntegerType),
        ("line", IntegerType),
        ("offset", IntegerType),
    ]
)

# One text edit: replace ``length`` UTF-16 code units at ``offset`` with ``insert``.
QueryEditType = StructType([("insert", StringType), ("length", IntegerType), ("offset", IntegerType)])

# A one-click fix: its label and the edits that make it, applied together.
QueryFixType = StructType([("edits", ArrayType(QueryEditType)), ("label", StringType)])

# A diagnostic from checking a query, or an error from evaluating one.
QueryErrorType = StructType(
    [
        ("code", StringType),
        ("fixes", ArrayType(QueryFixType)),
        ("message", StringType),
        ("severity", VariantType([("error", NullType), ("warning", NullType)])),
        ("span", OptionType(QuerySpanType)),
        ("suggestions", ArrayType(StringType)),
    ]
)

__all__ = [
    "JqPatternType",
    "JqType",
    "QueryEditType",
    "QueryErrorType",
    "QueryFixType",
    "QueryMultiplicityType",
    "QuerySpanType",
    "QueryType",
    "QueryV1Type",
]
