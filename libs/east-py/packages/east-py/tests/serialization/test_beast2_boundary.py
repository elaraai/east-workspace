#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The content-defined segment boundary, pinned across runtimes.

Segments of a Set or Dict must fall at the same keys here, in east-c
(``tests/test_beast2_boundary.c``) and in TypeScript
(``east/src/serialization/beast2/v5/boundary.spec.ts``) — that is the whole
claim the segment-object layout rests on: equal values produce equal segment
sets, so a state shares every segment a write did not touch, and a manifest one
runtime maintains equals the one another rebuilds.

This runtime does not implement the rule; it binds east-c's, so what is
asserted here is that the binding is wired to the right thing and that the
paged encoder actually uses it. The fixtures and the expected digests are the
same on all three sides."""

from east.serialization._beast2_eastc import (
    _encode_beast2_fence,
    _fnv1a64,
    _is_segment_boundary_key,
    _segment_starts,
)

from east import DictType, EastDict, EastSet, IntegerType, SetType, StringType
from east.serialization.beast2 import (
    SEGMENT_MAX_COUNT,
    SEGMENT_MIN_COUNT,
    encode_beast2_paged_for,
    open_beast2_pages_for,
)

#: fnv1a64 over the per-segment counts joined with ',', for the fixtures below.
DICT_COUNTS_DIGEST = "20251373dc14fe4e"
SET_COUNTS_DIGEST = "cb54163306a3a43d"


def _digest(counts) -> str:
    return format(_fnv1a64(",".join(str(c) for c in counts).encode()), "016x")


def _parity_dict() -> EastDict:
    d = EastDict(StringType, IntegerType)
    for i in range(50_000):
        d[f"k{i:07d}"] = i
    return d


def _parity_set() -> EastSet:
    s = EastSet(StringType)
    for i in range(50_000):
        s.add(f"e{i:07d}")
    return s


def _counts(collection_type, blob) -> list[int]:
    pages = open_beast2_pages_for(collection_type)(blob)
    return [pages.counts[i] for i in range(pages.segment_count)]


def test_fnv1a64_reference_vectors() -> None:
    assert _fnv1a64(b"") == 0xCBF29CE484222325
    assert _fnv1a64(b"a") == 0xAF63DC4C8601EC8C
    assert _fnv1a64(b"foobar") == 0x85944171F73967E8


def test_fence_bytes_depend_on_the_key_alone() -> None:
    once = _encode_beast2_fence(StringType, "k0000000")
    twice = _encode_beast2_fence(StringType, "k0000000")
    assert once == twice
    assert isinstance(once, bytes) and len(once) > 0


def test_segment_starts_agree_with_the_hash_test() -> None:
    value = _parity_dict()
    starts = _segment_starts(DictType(StringType, IntegerType), value)
    assert starts and starts[0] >= SEGMENT_MIN_COUNT
    keys = list(value.keys())
    for at in starts:
        # Every start is either a boundary key, or a segment forced out at the
        # maximum — the two ways the rule cuts.
        fence = _encode_beast2_fence(StringType, keys[at])
        assert _is_segment_boundary_key(fence) or at % SEGMENT_MAX_COUNT == 0


def test_dict_cuts_where_east_c_and_typescript_cut() -> None:
    counts = _counts(
        DictType(StringType, IntegerType),
        encode_beast2_paged_for(DictType(StringType, IntegerType))(_parity_dict()),
    )
    assert len(counts) == 53
    assert _digest(counts) == DICT_COUNTS_DIGEST
    for count in counts[:-1]:
        assert SEGMENT_MIN_COUNT <= count <= SEGMENT_MAX_COUNT


def test_set_cuts_where_east_c_and_typescript_cut() -> None:
    counts = _counts(
        SetType(StringType),
        encode_beast2_paged_for(SetType(StringType))(_parity_set()),
    )
    assert len(counts) == 41
    assert _digest(counts) == SET_COUNTS_DIGEST


def test_segmentation_is_a_pure_function_of_the_value() -> None:
    dict_type = DictType(StringType, IntegerType)
    ascending = EastDict(StringType, IntegerType)
    for i in range(20_000):
        ascending[f"k{i:07d}"] = i
    descending = EastDict(StringType, IntegerType)
    for i in reversed(range(20_000)):
        descending[f"k{i:07d}"] = i
    encode = encode_beast2_paged_for(dict_type)
    assert encode(ascending) == encode(descending)


def test_a_short_collection_is_one_segment() -> None:
    dict_type = DictType(StringType, IntegerType)
    short = EastDict(StringType, IntegerType)
    for i in range(SEGMENT_MIN_COUNT - 1):
        short[f"k{i:07d}"] = i
    assert len(_counts(dict_type, encode_beast2_paged_for(dict_type)(short))) == 1


def test_a_named_byte_target_takes_the_positional_path() -> None:
    # Naming a geometry of your own is the opt-out; the default is the rule.
    dict_type = DictType(StringType, IntegerType)
    value = _parity_dict()
    positional = _counts(
        dict_type,
        encode_beast2_paged_for(dict_type, batch_size=1_000)(value),
    )
    assert _digest(positional) != DICT_COUNTS_DIGEST
    assert all(count <= 1_000 for count in positional)
