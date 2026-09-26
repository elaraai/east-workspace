#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The content-defined cut rule, pinned across runtimes.

Segments of a collection must fall at the same elements here, in east-c
(``tests/test_beast2_boundary.c``) and in TypeScript
(``east/src/serialization/beast2/v5/boundary.spec.ts``) — that is the whole
claim the segment-object layout rests on: equal values produce equal segment
sets, so a state shares every segment a write did not touch, and a manifest one
runtime maintains equals the one another rebuilds.

This runtime does not implement the rule; it binds east-c's writer, so what is
asserted here is that the binding is wired to the right thing and that every
python writer goes through it. The fixtures and the expected digests are the
same on all three sides."""

import io

import pytest
from east.serialization._beast2_eastc import (
    _encode_beast2_fence,
    _fnv1a64,
    _segment_boundary_hash,
    _segment_is_boundary,
    _segment_starts,
    _starts_segment_after,
)

from east import ArrayType, BlobType, DictType, EastDict, EastSet, IntegerType, SetType, StringType
from east.serialization.beast2 import (
    SEGMENT_MAX_BYTES,
    SEGMENT_MAX_COUNT,
    SEGMENT_MIN_BYTES,
    SEGMENT_MIN_COUNT,
    SEGMENT_TARGET_BYTES,
    SEGMENT_TARGET_COUNT,
    Beast2ElementWriter,
    decode_beast2_with_header_for,
    encode_beast2_paged_for,
    open_beast2_pages_for,
)

#: The TypeScript writer's segmentation of the fixtures below: the segment
#: count, and fnv1a64 over the per-segment counts joined with ','.
DICT_SEGMENTS, DICT_COUNTS_DIGEST = 38, "2d1d1a2f011d367d"
SET_SEGMENTS, SET_COUNTS_DIGEST = 44, "617fc98188343a6a"
ARRAY_SEGMENTS, ARRAY_COUNTS_DIGEST = 43, "4b14a976ccd91c65"

TABLE = DictType(StringType, IntegerType)


def _digest(counts) -> str:
    return format(_fnv1a64(",".join(str(c) for c in counts).encode()), "016x")


def _parity_dict() -> EastDict:
    d = EastDict(StringType, IntegerType)
    for i in range(50_000):
        d[f"k{i:07d}"] = i
    return d


def _counts(collection_type, blob) -> list[int]:
    pages = open_beast2_pages_for(collection_type)(blob)
    return [pages.counts[i] for i in range(pages.segment_count)]


def _narrow_boundary_fence() -> bytes:
    """The fence of the first ``k0000000``-style key whose hash falls under
    the narrow threshold."""
    i = 0
    while True:
        fence = _encode_beast2_fence(StringType, f"k{i:07d}")
        if _segment_is_boundary(_segment_boundary_hash(fence), 1, 1):
            return fence
        i += 1


def test_fnv1a64_reference_vectors() -> None:
    assert _fnv1a64(b"") == 0xCBF29CE484222325
    assert _fnv1a64(b"a") == 0xAF63DC4C8601EC8C
    assert _fnv1a64(b"foobar") == 0x85944171F73967E8


def test_boundary_hash_vectors() -> None:
    assert _segment_boundary_hash(b"") == 0x2C773E2C
    assert _segment_boundary_hash(b"a") == 0xA3EABD3F
    assert _segment_boundary_hash(b"foobar") == 0x1F341994
    assert _segment_boundary_hash(b"k0000000") == 0xC8CA7941


def test_the_threshold_is_normalized_around_the_target_count() -> None:
    # One narrow element in the target count is the base: a quarter of it short
    # of the target, four times it past.
    narrow = 2**32 // SEGMENT_TARGET_COUNT
    assert _segment_is_boundary(narrow // 4 - 1, SEGMENT_MIN_COUNT, 16 * SEGMENT_MIN_COUNT)
    assert not _segment_is_boundary(narrow // 4, SEGMENT_MIN_COUNT, 16 * SEGMENT_MIN_COUNT)
    assert _segment_is_boundary(narrow * 4 - 1, SEGMENT_TARGET_COUNT, 16 * SEGMENT_TARGET_COUNT)
    assert not _segment_is_boundary(narrow * 4, SEGMENT_TARGET_COUNT, 16 * SEGMENT_TARGET_COUNT)


def test_the_threshold_rises_with_the_average_element_size() -> None:
    # An average of 64 KiB is one sixteenth of the byte target: a quarter of
    # that short of the target, four times it once the segment holds 1 MiB; at
    # an average of the byte target, every element starts a segment.
    wide = 2**32 // 16
    assert _segment_is_boundary(wide // 4 - 1, 2, 2 * 64 * 1024)
    assert not _segment_is_boundary(wide // 4, 2, 2 * 64 * 1024)
    assert _segment_is_boundary(wide * 4 - 1, 16, 16 * 64 * 1024)
    assert not _segment_is_boundary(wide * 4, 16, 16 * 64 * 1024)
    assert _segment_is_boundary(0xFFFFFFFF, 1, SEGMENT_TARGET_BYTES)
    assert not _segment_is_boundary(0xFFFFFFFF, 1, SEGMENT_TARGET_BYTES - 1)


def test_the_bounds_force_and_forbid_cuts() -> None:
    # No threshold admits the empty input's hash at the maximum count, so
    # only the bound can cut there.
    assert not _segment_is_boundary(_segment_boundary_hash(b""), SEGMENT_MAX_COUNT, SEGMENT_MAX_COUNT)
    assert _starts_segment_after(SEGMENT_MAX_COUNT, 1, b"")
    assert _starts_segment_after(1, SEGMENT_MAX_BYTES, b"")
    fence = _narrow_boundary_fence()
    assert not _starts_segment_after(1, 1, fence), "below both minimums the hash is not consulted"
    assert _starts_segment_after(1, SEGMENT_MIN_BYTES, fence)


def test_fence_bytes_depend_on_the_key_alone() -> None:
    once = _encode_beast2_fence(StringType, "k0000000")
    twice = _encode_beast2_fence(StringType, "k0000000")
    assert once == twice
    assert isinstance(once, bytes) and len(once) > 0


def test_segment_starts_follow_the_rule() -> None:
    # Replays the rule over the table: each entry's logical size is its key's
    # and value's bytes, and the key's fence bytes are what it hashes.
    value = _parity_dict()
    expected = []
    count = size = 0
    for i, (key, number) in enumerate(value.items()):
        fence = _encode_beast2_fence(StringType, key)
        if count and _starts_segment_after(count, size, fence):
            expected.append(i)
            count = size = 0
        count += 1
        size += len(fence) + len(_encode_beast2_fence(IntegerType, number))
    assert _segment_starts(TABLE, value) == expected


def test_dict_cuts_where_east_c_and_typescript_cut() -> None:
    counts = _counts(TABLE, encode_beast2_paged_for(TABLE)(_parity_dict()))
    assert (len(counts), _digest(counts)) == (DICT_SEGMENTS, DICT_COUNTS_DIGEST)
    for count in counts[:-1]:
        assert SEGMENT_MIN_COUNT <= count <= SEGMENT_MAX_COUNT


def test_set_cuts_where_east_c_and_typescript_cut() -> None:
    elements = EastSet(StringType)
    for i in range(50_000):
        elements.add(f"e{i:07d}")
    counts = _counts(SetType(StringType), encode_beast2_paged_for(SetType(StringType))(elements))
    assert (len(counts), _digest(counts)) == (SET_SEGMENTS, SET_COUNTS_DIGEST)


def test_array_cuts_where_east_c_and_typescript_cut() -> None:
    elements = [f"a{i:07d}" for i in range(50_000)]
    counts = _counts(ArrayType(StringType), encode_beast2_paged_for(ArrayType(StringType))(elements))
    assert (len(counts), _digest(counts)) == (ARRAY_SEGMENTS, ARRAY_COUNTS_DIGEST)


def test_wide_rows_cut_near_the_byte_target() -> None:
    # 64 rows of 256 KiB: a count-only rule would hold all 16 MiB in one
    # segment.
    wide = DictType(StringType, BlobType)
    rows = {f"r{i:03d}": bytes([i]) * (256 * 1024) for i in range(64)}
    blob = encode_beast2_paged_for(wide, codec="none")(rows)
    pages = open_beast2_pages_for(wide)(blob)
    assert pages.segment_count > 4
    assert max(pages.counts) < 64


def test_segmentation_is_a_pure_function_of_the_value() -> None:
    ascending = EastDict(StringType, IntegerType)
    for i in range(20_000):
        ascending[f"k{i:07d}"] = i
    descending = EastDict(StringType, IntegerType)
    for i in reversed(range(20_000)):
        descending[f"k{i:07d}"] = i
    encode = encode_beast2_paged_for(TABLE)
    assert encode(ascending) == encode(descending)


def test_a_short_collection_is_one_segment() -> None:
    short = EastDict(StringType, IntegerType)
    for i in range(SEGMENT_MIN_COUNT - 1):
        short[f"k{i:07d}"] = i
    assert len(_counts(TABLE, encode_beast2_paged_for(TABLE)(short))) == 1


def test_the_element_writer_writes_the_paged_bytes_however_it_is_fed() -> None:
    value = _parity_dict()
    expected = encode_beast2_paged_for(TABLE)(value)
    one_by_one = io.BytesIO()
    with Beast2ElementWriter(TABLE, one_by_one) as writer:
        for entry in list(value.items())[:10_000]:
            writer.add(entry)
        rest = EastDict(StringType, IntegerType)
        for key, number in list(value.items())[10_000:]:
            rest[key] = number
        writer.add_all(rest)
    assert one_by_one.getvalue() == expected


def test_the_element_writer_refuses_a_key_that_does_not_ascend() -> None:
    out = io.BytesIO()
    writer = Beast2ElementWriter(TABLE, out)
    writer.add(("b", 1))
    with pytest.raises(RuntimeError, match="strictly ascending"):
        writer.add(("a", 2))
    with pytest.raises(RuntimeError, match="strictly ascending"):
        writer.add(("b", 2))
    writer.add(("c", 3))
    writer.close()
    assert dict(decode_beast2_with_header_for(TABLE)(out.getvalue()).items()) == {"b": 1, "c": 3}
