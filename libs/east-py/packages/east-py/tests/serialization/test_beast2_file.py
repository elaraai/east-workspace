#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast2 managed file interface (issue #481 W1 + W2).

``open_beast2_file`` / ``write_beast2_file`` own the fd + mmap and mirror the
root collection's read surface; the writer re-batches into target-sized
segments. W2 adds the keyed reads: Dict/Set point lookups and Array
``find_sorted_*`` navigate by segment *fences* (each segment's first key,
decoded from a bounded probe of its frame) and decode only the owning
segment. Also pins the buffer-acceptance fixes this workstream shipped: the
v5 entry points borrow mmaps zero-copy (previously ``_as_buffer`` treated an
mmap as a stream — whole-file copy, and the advanced file position made a
second call on the same mmap see empty bytes), and the full decoder accepts
any C-contiguous buffer instead of only ``bytes``."""

import mmap

import pytest

from east import (
    ArrayType,
    DictType,
    EastArray,
    EastDict,
    EastSet,
    IntegerType,
    SetType,
    StringType,
    StructType,
)
from east.runtime.errors import EastError
from east.serialization.beast2 import (
    Beast2ArrayFile,
    Beast2DictFile,
    Beast2Writer,
    decode_beast2_with_header_for,
    encode_beast2_v5_for,
    encode_beast2_with_header_for,
    iter_beast2_segments_for,
    open_beast2_file,
    open_beast2_pages_for,
    write_beast2_file,
)

ROW = StructType([("id", IntegerType), ("name", StringType)])
AT = ArrayType(ROW)
DT = DictType(StringType, IntegerType)


def _rows(start, n):
    return [{"id": i, "name": f"n{i:05d}"} for i in range(start, start + n)]


@pytest.fixture
def array_path(tmp_path):
    path = tmp_path / "rows.beast2"
    write_beast2_file(path, AT, EastArray(ROW, _rows(0, 30_000)))
    return path


# ── Buffer acceptance (the root-caused mmap bugs) ─────────────────────────


def test_mmap_sources_borrow_and_stay_reusable(tmp_path):
    """An mmap passes through as a buffer: no whole-file copy, and — the
    regression — no advanced file position, so a SECOND call on the same
    mmap still sees the blob instead of empty bytes."""
    at = ArrayType(IntegerType)
    path = tmp_path / "ints.beast2"
    with open(path, "wb") as stream, Beast2Writer(at, stream) as writer:
        writer.write(EastArray(IntegerType, [1, 2, 3]))
        writer.write(EastArray(IntegerType, [4, 5]))

    with open(path, "rb") as stream, mmap.mmap(
        stream.fileno(), 0, access=mmap.ACCESS_READ
    ) as mm:
        first = [list(s) for s in iter_beast2_segments_for(at)(mm)]
        second = [list(s) for s in iter_beast2_segments_for(at)(mm)]
        assert first == second == [[1, 2, 3], [4, 5]]

        pages = open_beast2_pages_for(at)(mm)
        assert pages.element(4) == 5
        # The pager borrows the mapping — release it before the mmap closes.
        del pages

        assert list(decode_beast2_with_header_for(at)(mm)) == [1, 2, 3, 4, 5]


def test_full_decoder_accepts_any_buffer(tmp_path):
    at = ArrayType(IntegerType)
    blob = encode_beast2_v5_for(at)(EastArray(IntegerType, [7, 8, 9]))
    decode = decode_beast2_with_header_for(at)
    assert list(decode(bytearray(blob))) == [7, 8, 9]
    assert list(decode(memoryview(blob))) == [7, 8, 9]


def test_reader_names_bad_inputs_like_the_pager():
    at = ArrayType(IntegerType)
    v4 = encode_beast2_with_header_for(at, version=4)(EastArray(IntegerType, [1]))
    with pytest.raises(RuntimeError, match="v4 container"):
        list(iter_beast2_segments_for(at)(v4))
    with pytest.raises(RuntimeError, match="not a beast2 v5 container"):
        list(iter_beast2_segments_for(at)(b"definitely not beast2"))
    with pytest.raises(RuntimeError, match="too short"):
        list(iter_beast2_segments_for(at)(b"\x89"))


# ── Beast2File: Array flavor ──────────────────────────────────────────────


def test_array_file_mirrors_the_eager_read_surface(array_path):
    with open_beast2_file(array_path, AT) as f:
        assert isinstance(f, Beast2ArrayFile)
        assert len(f) == 30_000
        assert f.segment_count == 4  # managed 8192-row segments
        assert f.self_contained is True

        table = f.load()
        assert len(table) == 30_000

        # Point reads: East verbs + pythonic protocol, same semantics as the
        # eager array.
        assert f.get(12_345)["name"] == table.get(12_345)["name"]
        assert f[-1]["id"] == table[-1]["id"]
        assert f.has(29_999) and not f.has(30_000)
        assert f.try_get(30_000).type == "none"
        assert f.try_get(3).type == "some"
        assert f.get_or_default(-1, None) is None
        with pytest.raises(EastError, match="Array index 30000 out of bounds"):
            f.get(30_000)
        with pytest.raises(IndexError):
            f[30_000]

        # Slices clamp exactly like EastArray.slice, spanning segments.
        for start, end in [(8_190, 8_195), (-5, 2), (2, 1), (29_990, 99_999)]:
            assert [r["id"] for r in f.slice(start, end)] == [
                r["id"] for r in table.slice(start, end)
            ]
        assert [r["id"] for r in f[29_998:30_005]] == [29_998, 29_999]
        with pytest.raises(ValueError, match="contiguous"):
            f[0:10:2]

        # Batched gather: input order kept, one decode per owning segment.
        assert [r["id"] for r in f.get_keys([29_999, 0, 8_192])] == [29_999, 0, 8_192]
        with pytest.raises(EastError, match="out of bounds"):
            f.get_keys([0, 99_999])

        # Streaming + whole-file forms agree.
        assert sum(len(batch) for batch in f.segments()) == 30_000

        # find_sorted pages by element order; a key= projection cannot.
        with pytest.raises(ValueError, match="projections"):
            f.find_sorted_first(table.get(0), key=lambda r: r["id"])


# ── Beast2File: Dict + Set flavors ────────────────────────────────────────


def test_dict_file_rebatches_key_disjoint_and_streams(tmp_path):
    path = tmp_path / "big.beast2"
    write_beast2_file(path, DT, EastDict(StringType, IntegerType,
                                         {f"k{i:05d}": i for i in range(20_000)}))
    with open_beast2_file(path, DT) as d:
        assert isinstance(d, Beast2DictFile)
        assert d.segment_count == 3  # 20k rows re-batched at the managed size
        assert len(d) == d.size() == 20_000  # disjoint segments: counts are exact

        # Segment key ranges are disjoint and ordered — the shape W2 requires.
        previous_last = None
        for segment in d.segments():
            keys = list(segment.keys())
            assert keys == sorted(keys)
            if previous_last is not None:
                assert keys[0] > previous_last
            previous_last = keys[-1]

        assert len(d.keys_set()) == 20_000
        merged = d.load()
        assert merged["k00042"] == 42
        first_key, first_value = next(iter(d.items()))
        assert (first_key, first_value) == ("k00000", 0)


def test_set_file_streams_and_writer_takes_python_builtins(tmp_path):
    path = tmp_path / "set.beast2"
    st = SetType(IntegerType)
    with open_beast2_file(path, st, mode="w", segment_rows=100) as writer:
        writer.write(EastSet(IntegerType, range(500)))  # split into 5 segments
        writer.write({997, 998, 999})
        writer.write(set())  # skipped
    assert writer.segments == 6
    with open_beast2_file(path, st) as s:
        assert len(s) == 503
        assert sum(1 for _ in s) == 503
        assert 42 in s and s.has(999)
        assert 700 not in s and not s.has(-1)


# ── Keyed reads (issue #481 W2) ───────────────────────────────────────────


def test_dict_keyed_reads_match_the_eager_dict(tmp_path):
    """Every keyed verb answers exactly like the eager EastDict over the same
    pairs — probed at each segment's first and last key (the fence boundaries,
    where an off-by-one search would land wrong) plus misses below the first
    fence, between keys, and past the end."""
    path = tmp_path / "keyed.beast2"
    write_beast2_file(path, DT, EastDict(StringType, IntegerType,
                                         {f"k{i:05d}": i * 3 for i in range(10_000)}),
                      segment_rows=1000)
    with open_beast2_file(path, DT) as d:
        table = d.load()
        boundaries = [f"k{i:05d}" for i in range(0, 10_000, 1000)]
        boundaries += [f"k{i:05d}" for i in range(999, 10_000, 1000)]
        for key in boundaries:
            assert d[key] == table[key]
            assert d.get(key) == table.get(key)
            assert d.get_or_default(key, -1) == table.get_or_default(key, -1)
            assert d.try_get(key).value == table.try_get(key).value
            assert d.has(key) and key in d
        for miss in ["a", "k00500x", "k10000", "zzz"]:
            assert miss not in d and not d.has(miss)
            assert d.get(miss) is None and d.get(miss, -1) == -1
            assert d.get_or_default(miss, -1) == -1
            assert d.try_get(miss).type == "none"
        with pytest.raises(KeyError, match="Dict does not contain key"):
            d["k99999"]

        # Batched gather mirrors EastDict.get_keys exactly, fill included,
        # decoding each owning segment once.
        requested = EastSet(StringType, ["k00000", "k00999", "k01000", "absent-a",
                                         "k09999", "absent-b"])
        got = d.get_keys(requested, lambda k: -1)
        want = table.get_keys(requested, lambda k: -1)
        assert dict(got.items()) == dict(want.items())
        # Plain iterables coerce like the eager surface's Set argument.
        got_from_list = d.get_keys(["k00000", "absent-a"], lambda k: -1)
        assert dict(got_from_list.items()) == {"k00000": 0, "absent-a": -1}


def test_array_find_sorted_matches_the_eager_array(tmp_path):
    """Global insertion indices agree with the eager builtins on every probe —
    including duplicates spanning segment boundaries, targets below the first
    row, between rows, and past the last."""
    at = ArrayType(IntegerType)
    rows = [1, 2, 2, 2, 3, 5, 5, 8, 8, 8, 13]
    path = tmp_path / "sorted.beast2"
    write_beast2_file(path, at, EastArray(IntegerType, rows), segment_rows=3)
    with open_beast2_file(path, at) as f:
        assert f.segment_count == 4
        table = f.load()
        for target in [0, 1, 2, 3, 4, 5, 8, 13, 99]:
            assert f.find_sorted_first(target) == table.find_sorted_first(target)
            assert f.find_sorted_last(target) == table.find_sorted_last(target)
            span = f.find_sorted_range(target)
            eager_span = table.find_sorted_range(target)
            assert (span["start"], span["end"]) == (eager_span["start"], eager_span["end"])


def test_keyed_reads_detect_non_disjoint_segments(tmp_path):
    """Keyed reads require key-disjoint segments; a foreign writer that broke
    the contract fails loudly instead of reporting false misses. Both shapes:
    batches written out of key order (fences not ascending — caught by the
    one-time fence verification) and overlapping ranges behind ascending
    fences (caught by the decoded segment's tail guard)."""
    unsorted_path = tmp_path / "unsorted.beast2"
    with open(unsorted_path, "wb") as stream, Beast2Writer(DT, stream) as writer:
        writer.write(EastDict(StringType, IntegerType, {"m": 1, "z": 2}))
        writer.write(EastDict(StringType, IntegerType, {"a": 3, "b": 4}))
    with (
        open_beast2_file(unsorted_path, DT) as bad,
        pytest.raises(RuntimeError, match="not key-disjoint"),
    ):
        bad.has("a")

    overlap_path = tmp_path / "overlap.beast2"
    with open(overlap_path, "wb") as stream, Beast2Writer(DT, stream) as writer:
        writer.write(EastDict(StringType, IntegerType, {"a": 1, "m": 2}))
        writer.write(EastDict(StringType, IntegerType, {"b": 3, "z": 4}))
    with (
        open_beast2_file(overlap_path, DT) as bad,
        pytest.raises(RuntimeError, match="not key-disjoint"),
    ):
        bad.has("a")  # lands on segment 0, whose tail "m" >= next fence "b"


def test_keyed_reads_refuse_non_self_contained_blobs(tmp_path):
    path = tmp_path / "aliased.beast2"
    with open(path, "wb") as stream, Beast2Writer(DT, stream, self_contained=False) as writer:
        writer.write(EastDict(StringType, IntegerType, {"a": 1}))
        writer.write(EastDict(StringType, IntegerType, {"b": 2}))
    with (
        open_beast2_file(path, DT) as d,
        pytest.raises(RuntimeError, match="self-contained"),
    ):
        d.has("a")


def test_empty_collection_files_answer_keyed_reads(tmp_path):
    """Zero-segment files: every lookup misses, every insertion index is 0."""
    dict_path = tmp_path / "empty_dict.beast2"
    write_beast2_file(dict_path, DT, EastDict(StringType, IntegerType))
    with open_beast2_file(dict_path, DT) as d:
        assert "k" not in d and d.try_get("k").type == "none"
        got = d.get_keys(["k"], lambda k: -1)
        assert dict(got.items()) == {"k": -1}

    at = ArrayType(IntegerType)
    array_path = tmp_path / "empty_arr.beast2"
    write_beast2_file(array_path, at, EastArray(IntegerType))
    with open_beast2_file(array_path, at) as f:
        assert f.find_sorted_first(5) == 0 and f.find_sorted_last(5) == 0
        span = f.find_sorted_range(5)
        assert (span["start"], span["end"]) == (0, 0)


# ── Writer management ─────────────────────────────────────────────────────


def test_writer_rebatching_policy(tmp_path):
    at = ArrayType(IntegerType)
    path = tmp_path / "policy.beast2"
    with open_beast2_file(path, at, mode="w", segment_rows=1000) as writer:
        writer.write(list(range(1500)))  # ≤ 2x target: one segment, no copy
        writer.write(EastArray(IntegerType))  # empty: skipped
        writer.write(list(range(1500, 6000)))  # > 2x target: split
    assert writer.segments == 1 + 5
    with open_beast2_file(path, at) as f:
        assert list(f.load()) == list(range(6000))
    with pytest.raises(ValueError, match="after close"):
        writer.write([1])
    writer.close()  # idempotent


def test_open_mode_and_option_validation(tmp_path):
    with pytest.raises(ValueError, match="'r' or 'w'"):
        open_beast2_file(tmp_path / "x.beast2", AT, mode="a")
    with pytest.raises(ValueError, match="write-mode options"):
        open_beast2_file(tmp_path / "x.beast2", AT, segment_rows=10)
    with pytest.raises(ValueError, match="positive"):
        open_beast2_file(tmp_path / "x.beast2", AT, mode="w", segment_rows=0)
    with pytest.raises(TypeError, match="Array, Set or Dict"):
        open_beast2_file(tmp_path / "x.beast2", IntegerType)


# ── Degraded blobs and lifecycle ──────────────────────────────────────────


def test_index_less_blob_degrades_to_stream_only(tmp_path):
    at = ArrayType(IntegerType)
    path = tmp_path / "noix.beast2"
    path.write_bytes(encode_beast2_v5_for(at)(EastArray(IntegerType, [7, 8, 9])))
    with open_beast2_file(path, at) as f:
        assert f.indexed is False
        assert [list(b) for b in f.segments()] == [[7, 8, 9]]
        assert list(f.load()) == [7, 8, 9]
        for random_access in [lambda: len(f), lambda: f[0], lambda: f.slice(0, 1)]:
            with pytest.raises(RuntimeError, match="no index"):
                random_access()


def test_v4_and_non_beast2_files_refuse_with_direction(tmp_path):
    at = ArrayType(IntegerType)
    v4_path = tmp_path / "old.beast2"
    v4_path.write_bytes(encode_beast2_with_header_for(at, version=4)(EastArray(IntegerType, [1])))
    with pytest.raises(ValueError, match="v4 container"):
        open_beast2_file(v4_path, at)

    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"not a beast2 blob at all")
    with pytest.raises(ValueError, match="not a beast2 v5 container"):
        open_beast2_file(junk, at)

    short = tmp_path / "short.bin"
    short.write_bytes(b"\x89")
    with pytest.raises(ValueError, match="too short"):
        open_beast2_file(short, at)


def test_close_is_idempotent_and_guards_live_borrows(array_path):
    f = open_beast2_file(array_path, AT)
    iterator = f.segments()
    next(iterator)
    with pytest.raises(BufferError, match="segments\\(\\) iterator"):
        f.close()
    iterator.close()
    f.close()
    f.close()  # idempotent
    assert f.closed
    with pytest.raises(ValueError, match="closed Beast2File"):
        f.load()
