#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The query wire types' python twins encode to TypeScript's bytes (#919 T1).

``libs/east/test/fixtures/query-corpus.beast2`` opens with a header holding
every query wire type's type value as TypeScript encodes it: canonically
numbered (each recursive wrapper numbered in preorder from 0, as TypeScript's
``canonicalTypeValue`` and python's ``canonical_type_value`` number it) and
written as self-describing beast2. Each
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
from east.types.type_of_type import EastTypeType, canonical_type_value

CORPUS = Path(__file__).resolve().parents[4] / "east" / "test" / "fixtures" / "query-corpus.beast2"


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
