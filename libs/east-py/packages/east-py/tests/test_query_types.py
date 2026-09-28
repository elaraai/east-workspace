#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The query wire types' python twins encode to TypeScript's bytes (#919 T1).

``libs/east/test/fixtures/query-corpus.beast2`` opens with a header holding
every query wire type's type value as TypeScript encodes it: canonically
numbered (each recursive wrapper numbered in preorder from 0, as TypeScript's
``canonicalTypeValue`` numbers it) and written as self-describing beast2. Each
python twin in ``east/query/types.py``, numbered the same way, must encode to
exactly those bytes. ``make query-corpus`` in ``libs/east`` rewrites the file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from east.query import types as query_types
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_with_header_for,
    read_beast2_type,
)
from east.types.type_of_type import EastTypeType
from east.types.values import EastVariant

CORPUS = Path(__file__).resolve().parents[4] / "east" / "test" / "fixtures" / "query-corpus.beast2"

_PRIMITIVE_KINDS = {"Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"}


def canonical_type_value(typ: EastVariant) -> EastVariant:
    """Renumber a type's recursive wrappers as TypeScript's ``canonicalTypeValue`` does.

    Each ``wrapper`` is numbered in preorder from 0, and each ``ref`` takes the
    number of the innermost enclosing wrapper it names. A wrapper's id is a
    runtime artefact (python mints process-unique ids), so a type written as
    data is renumbered first, and equal types then encode to equal bytes.

    Args:
        typ: A type (in python, a type is its own type value).

    Returns:
        An equal type whose recursive ids depend on the type alone, built from
        fresh containers.
    """
    next_id = 0
    scope: list[tuple[int, int]] = []

    def rename(t: EastVariant) -> EastVariant:
        nonlocal next_id
        kind, value = t.type, t.value
        if kind in _PRIMITIVE_KINDS:
            return t
        if kind in ("Ref", "Array", "Set", "Vector", "Matrix"):
            return EastVariant(kind, rename(value))
        if kind == "Dict":
            return EastVariant("Dict", {"key": rename(value["key"]), "value": rename(value["value"])})
        if kind in ("Struct", "Variant"):
            return EastVariant(kind, [{"name": m["name"], "type": rename(m["type"])} for m in value])
        if kind in ("Function", "AsyncFunction"):
            return EastVariant(
                kind,
                {"inputs": [rename(i) for i in value["inputs"]], "output": rename(value["output"])},
            )
        if kind == "Recursive":
            if value.type == "ref":
                for bound, renamed in reversed(scope):
                    if bound == value.value:
                        return EastVariant("Recursive", EastVariant("ref", renamed))
                return t
            renamed = next_id
            next_id += 1
            scope.append((value.value["id"], renamed))
            try:
                inner = rename(value.value["inner"])
            finally:
                scope.pop()
            return EastVariant("Recursive", EastVariant("wrapper", {"id": renamed, "inner": inner}))
        raise AssertionError(f"not a type: {kind}")

    return rename(typ)


@pytest.fixture(scope="module")
def header() -> dict[str, bytes]:
    """The corpus fixture's header: each wire type's bytes, by name."""
    assert CORPUS.is_file(), f"{CORPUS} is missing: `make query-corpus` in libs/east writes it"
    data = CORPUS.read_bytes()
    corpus: Any = decode_beast2_with_header_for(read_beast2_type(data))(data)
    return {name: bytes(blob) for name, blob in corpus["types"].items()}


def test_the_header_names_every_python_twin(header: dict[str, bytes]) -> None:
    assert sorted(header) == sorted(query_types.__all__)


@pytest.mark.parametrize("name", query_types.__all__)
def test_the_python_twin_encodes_to_typescripts_bytes(header: dict[str, bytes], name: str) -> None:
    encode = encode_beast2_with_header_for(EastTypeType)
    assert encode(canonical_type_value(getattr(query_types, name))) == header[name], (
        f"{name} in east/query/types.py differs from libs/east/src/query/types.ts"
    )


def test_canonical_numbering_depends_on_the_type_alone() -> None:
    encode = encode_beast2_with_header_for(EastTypeType)
    once = canonical_type_value(query_types.JqType)
    assert encode(canonical_type_value(once)) == encode(once)
