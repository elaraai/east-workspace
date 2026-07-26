#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Regression tests for composite type-constructor interning (issue #83).

The TS reference (``libs/east/src/types.ts``) memoizes its composite type
constructors so that structurally-equal types are the SAME object. The beast2
value encoder dedups by object identity, so a repeated sub-structure (e.g. an
Option appearing in two struct fields) must be emitted once + a backref. Without
interning, east-py created distinct-but-equal type objects, which the encoder
emitted twice, diverging from the canonical TS encoding (65 bytes instead of
51 for the case below). These tests pin the interning behaviour.

The pinned encoding is the v5 container — the encoder default since
elaraai/east-workspace#416 — whose well-known type section names
EastTypeValueType by id and whose backref is a REF delta rather than a second
value-table definition.
"""

from __future__ import annotations

import hashlib

from east.serialization.beast2 import encode_beast2_with_header_for
from east.types.type_of_type import EastTypeType
from east.types.types import (
    IntegerType,
    OptionType,
    StructType,
    VectorType,
)

# Canonical TS-reference encoding of the repeated-composite struct below.
_CANONICAL_SHA256 = "ef6ffa47bd8d2e5681a161093cf304e6a38ff1d80b36e020c2c4ad72496e8cce"


def _repeated_composite_type():
    """A struct whose two fields share a structurally-identical Option type."""
    return StructType(
        [
            ("a", OptionType(VectorType(IntegerType))),
            ("b", OptionType(VectorType(IntegerType))),
        ]
    )


def test_composite_constructors_intern_to_same_object() -> None:
    """Structurally-equal composite types return the SAME object (memoized)."""
    assert OptionType(VectorType(IntegerType)) is OptionType(VectorType(IntegerType))


def test_repeated_composite_encodes_byte_identically() -> None:
    """Two independent constructions of T encode to identical bytes."""
    enc = encode_beast2_with_header_for(EastTypeType)
    assert enc(_repeated_composite_type()) == enc(_repeated_composite_type())


def test_repeated_composite_matches_ts_canonical_hash() -> None:
    """The encoding matches the pinned TS-canonical sha256 (51 bytes)."""
    enc = encode_beast2_with_header_for(EastTypeType)
    encoded = enc(_repeated_composite_type())
    assert len(encoded) == 51
    assert hashlib.sha256(encoded).hexdigest() == _CANONICAL_SHA256
