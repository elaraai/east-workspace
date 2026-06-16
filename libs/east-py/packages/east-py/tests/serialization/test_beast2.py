#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Regression tests for EastBlob.encode_beast2 / decode_beast2 (issue #37).

EastBlob.encode_beast2 / decode_beast2 document themselves as the
``BlobEncodeBeast2`` / ``BlobDecodeBeast2`` builtins, which use the
with-header (full) beast2 format. They were previously wired to the
headerless codec, which (a) silently emitted zero bytes for mutable
containers (Array/Set/Dict/Ref) and (b) was not interoperable with the
builtin / CLI / memo / TS encoders (decoding full bytes through the
headerless decoder silently returned garbage). These tests pin the
methods to the full format.
"""

from __future__ import annotations

import pytest

from east import (
    ArrayType,
    DictType,
    EastBlob,
    IntegerType,
    SetType,
    StringType,
    coerce_to,
    type_of,
)
from east.serialization.beast2 import (
    encode_beast2_for,
    encode_beast2_with_header_for,
)

# "East" magic prefix of the with-header (full) format; the trailing byte is
# the format version, which we deliberately do not pin here.
_EAST_MAGIC_PREFIX = bytes([137, 69, 97, 115, 116, 13, 10])


def _values():
    """A scalar plus one of each mutable container, with their declared types."""
    return [
        (coerce_to(42, IntegerType), IntegerType),
        (coerce_to([1, 2, 3], ArrayType(IntegerType)), ArrayType(IntegerType)),
        (coerce_to({1, 2, 3}, SetType(IntegerType)), SetType(IntegerType)),
        (
            coerce_to({"x": 1, "y": 2}, DictType(StringType, IntegerType)),
            DictType(StringType, IntegerType),
        ),
    ]


def test_encode_beast2_uses_full_format():
    """encode_beast2 emits the with-header (full) format, not headerless."""
    for value, _typ in _values():
        encoded = bytes(EastBlob.encode_beast2(value))
        assert len(encoded) > 8, "full format always carries a header + tables"
        assert encoded[:7] == _EAST_MAGIC_PREFIX


def test_encode_beast2_matches_builtin_full_bytes():
    """encode_beast2 is byte-identical to the BlobEncodeBeast2 builtin (full)."""
    for value, _typ in _values():
        method_bytes = bytes(EastBlob.encode_beast2(value))
        builtin_bytes = bytes(encode_beast2_with_header_for(type_of(value))(value))
        assert method_bytes == builtin_bytes


def test_container_roundtrip_via_methods():
    """Mutable containers round-trip through encode_beast2 / decode_beast2."""
    arr = coerce_to([1, 2, 3], ArrayType(IntegerType))
    decoded = EastBlob.encode_beast2(arr).decode_beast2(ArrayType(IntegerType))
    assert list(decoded) == [1, 2, 3]

    # Byte-stability round-trip for every container (avoids relying on Python
    # equality semantics for Set/Dict): re-encoding the decoded value reproduces
    # the original bytes.
    for value, typ in _values():
        encoded = EastBlob.encode_beast2(value)
        reencoded = EastBlob.encode_beast2(encoded.decode_beast2(typ))
        assert bytes(reencoded) == bytes(encoded)


def test_decode_interoperates_with_builtin_full_bytes():
    """decode_beast2 reads builtin/full bytes correctly (was silent corruption)."""
    full = encode_beast2_with_header_for(IntegerType)(42)
    assert EastBlob(full).decode_beast2(IntegerType) == 42

    full_arr = encode_beast2_with_header_for(ArrayType(IntegerType))(
        coerce_to([1, 2, 3], ArrayType(IntegerType))
    )
    assert list(EastBlob(full_arr).decode_beast2(ArrayType(IntegerType))) == [1, 2, 3]


def test_headerless_function_rejects_containers():
    """The low-level headerless encoder now errors loudly on a container
    instead of silently emitting zero bytes (east-c defense-in-depth)."""
    arr = coerce_to([1, 2, 3], ArrayType(IntegerType))
    with pytest.raises(RuntimeError):
        encode_beast2_for(ArrayType(IntegerType))(arr)

    # Scalars still encode headerless (the guard is container-only).
    assert len(encode_beast2_for(IntegerType)(coerce_to(42, IntegerType))) > 0
