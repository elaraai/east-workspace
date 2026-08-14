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

import math
import mmap

import pytest

from east import (
    ArrayType,
    BooleanType,
    DictType,
    EastArray,
    EastDict,
    EastSet,
    FloatType,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    StructType,
    kernel,
    none,
    some,
    where,
)
from east.runtime.errors import EastError
from east.serialization.beast2 import (
    Beast2ArrayFile,
    Beast2DictFile,
    Beast2SetFile,
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


def _swap_wire_bytes(path, a: bytes, b: bytes) -> None:
    """Swap two equal-length byte runs of a ``codec="none"`` blob in place —
    manufacturing the non-canonical wire the writers can no longer emit."""
    blob = bytearray(path.read_bytes())
    ia, ib = blob.index(a), blob.index(b)
    blob[ia:ia + len(a)] = b
    blob[ib:ib + len(b)] = a
    path.write_bytes(bytes(blob))


def test_writer_rejects_non_canonical_batches(tmp_path):
    """Set/Dict segment content is the canonical value split at segment
    boundaries: a batch at or below the previous batch's greatest key — out
    of key order or overlapping — is refused at write time, so nothing
    non-canonical reaches disk."""
    with open(tmp_path / "unsorted.beast2", "wb") as stream:
        writer = Beast2Writer(DT, stream)
        writer.write(EastDict(StringType, IntegerType, {"m": 1, "z": 2}))
        with pytest.raises(RuntimeError, match="strictly ascending"):
            writer.write(EastDict(StringType, IntegerType, {"a": 3, "b": 4}))
    with open(tmp_path / "overlap.beast2", "wb") as stream:
        writer = Beast2Writer(DT, stream)
        writer.write(EastDict(StringType, IntegerType, {"a": 1, "m": 2}))
        with pytest.raises(RuntimeError, match="strictly ascending"):
            writer.write(EastDict(StringType, IntegerType, {"b": 3, "z": 4}))


def test_keyed_reads_detect_corrupt_non_canonical_blobs(tmp_path):
    """Keyed reads trust the canonical-order contract only after verifying
    it — a corrupt blob (bytes reordered after writing) fails loudly instead
    of reporting false misses. Both shapes: fences out of order (caught by
    the one-time fence verification) and overlapping ranges behind ascending
    fences (caught by the decoded segment's tail guard)."""
    unsorted_path = tmp_path / "unsorted.beast2"
    write_beast2_file(unsorted_path, DT, EastDict(StringType, IntegerType,
                                                  {"a": 1, "c": 2, "e": 3}),
                      codec="none", segment_rows=1)
    _swap_wire_bytes(unsorted_path, b"\x01a\x02", b"\x01c\x04")  # fences now c, a, e
    with (
        open_beast2_file(unsorted_path, DT) as bad,
        pytest.raises(RuntimeError, match="not disjoint ascending"),
    ):
        bad.has("e")

    overlap_path = tmp_path / "overlap.beast2"
    write_beast2_file(overlap_path, DT,
                      EastDict(StringType, IntegerType,
                               {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6}),
                      codec="none", segment_rows=2)
    _swap_wire_bytes(overlap_path, b"\x01b\x04", b"\x01c\x06")  # segments {a,c} {b,d} {e,f}
    with (
        open_beast2_file(overlap_path, DT) as bad,
        pytest.raises(RuntimeError, match="not disjoint ascending"),
    ):
        bad.has("a")  # lands on segment 0, whose tail "c" >= next fence "b"


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


# ── Segment-streamed compute (issue #481 W4) ──────────────────────────────
#
# Every compute method's oracle is exact: `f.method(...)` must produce what
# `f.load().method(...)` produces — East equality, error type and message
# included. The tables below are the hand-authored spec (one row per method
# and argument shape); the harness just runs every row against every fixture
# so no method or edge silently escapes.

W4_ROW = StructType([("sku", StringType), ("qty", IntegerType), ("amt", FloatType)])
W4_AT = ArrayType(W4_ROW)


def _w4_rows(n):
    return [{"sku": f"S{i % 5}", "qty": i, "amt": i * 0.37 - 3.0} for i in range(n)]


def _outcome(run, collection):
    """Run one case and capture its result OR its error — both are parity."""
    try:
        return ("ok", run(collection))
    except Exception as exc:  # noqa: BLE001 — error parity is the point
        return ("raise", type(exc).__name__, str(exc))


def _same(a, b) -> bool:
    """East-aware sameness for parity results.

    Python ``==`` first; a miss retries under East equality (east-c's, where
    NaN == NaN) so NaN-carrying containers compare the way the runtime does.
    """
    if isinstance(a, float) and isinstance(b, float):
        return a == b or (math.isnan(a) and math.isnan(b))
    if isinstance(a, tuple) and isinstance(b, tuple):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b, strict=True))
    if a == b:
        return True
    import east.types.values as _ev
    from east.namespace import East

    try:
        return bool(East.equal(_ev.type_of(a), a, b))
    except Exception:  # noqa: BLE001 — not an East value pair; == was the answer
        return False


ARRAY_COMPUTE_CASES = [
    ("map", lambda c: c.map(lambda r: r["qty"] * 2)),
    ("map_global_idx", lambda c: list(c.map(lambda r, i: r["qty"] + i * 1000))),
    ("map_out", lambda c: c.map(lambda r: r["amt"], out=FloatType)),
    ("filter", lambda c: c.filter(lambda r: r["amt"] > 3.0)),
    ("filter_map", lambda c: c.filter_map(
        lambda r: some(r["qty"]) if r["qty"] % 3 == 0 else none, out=IntegerType)),
    ("first_map", lambda c: c.first_map(
        lambda r: some(r["sku"]) if r["qty"] > 17 else none, out=StringType)),
    ("fold_float", lambda c: c.fold(0.0, lambda a, r: a + r["amt"])),
    ("fold_global_idx", lambda c: c.fold(0, lambda a, r, i: a + i)),
    ("map_reduce_noncommutative", lambda c: c.map_reduce(
        lambda r: r["sku"], lambda a, b: a + b)),
    ("sum", lambda c: c.sum(lambda r: r["amt"])),
    ("sum_no_fn", lambda c: c.map(lambda r: r["qty"], out=IntegerType)),
    ("mean", lambda c: c.mean(lambda r: r["amt"])),
    ("maximum", lambda c: c.maximum(by=lambda r: r["amt"])),
    ("minimum", lambda c: c.minimum(by=lambda r: r["qty"])),
    ("every", lambda c: c.every(lambda r: r["qty"] >= 0)),
    ("some", lambda c: c.some(lambda r: r["qty"] > 33)),
    ("find_first", lambda c: c.find_first("S3", key=lambda r: r["sku"])),
    ("find_all", lambda c: list(c.find_all("S2", by=lambda r: r["sku"]))),
    ("find_maximum", lambda c: c.find_maximum(by=lambda r: r["amt"])),
    ("find_minimum", lambda c: c.find_minimum(by=lambda r: r["amt"])),
    ("is_sorted", lambda c: c.is_sorted(key=lambda r: r["qty"])),
    ("to_set", lambda c: c.to_set(lambda r: r["sku"])),
    ("unique_skus", lambda c: c.map(lambda r: r["sku"], out=StringType)),
    ("to_dict", lambda c: c.to_dict(lambda r: r["qty"])),
    ("to_dict_combine", lambda c: c.to_dict(
        lambda r: r["sku"], value=lambda r: r["qty"], combine=lambda a, b: a + b)),
    ("to_dict_dup_error", lambda c: c.to_dict(lambda r: r["sku"])),
    ("group_by", lambda c: {k: [r["qty"] for r in v]
                            for k, v in c.group_by(lambda r: r["sku"]).items()}),
    ("group_reduce", lambda c: c.group_reduce(
        lambda r: r["sku"], lambda _k: 0.0, lambda a, r: a + r["amt"])),
    ("group_size", lambda c: c.group_size(lambda r: r["sku"])),
    ("group_sum_float", lambda c: c.group_sum(lambda r: r["sku"], lambda r: r["amt"])),
    ("group_mean", lambda c: c.group_mean(lambda r: r["sku"], lambda r: r["amt"])),
    ("group_maximum", lambda c: c.group_maximum(lambda r: r["sku"], by=lambda r: r["amt"])),
    ("group_minimum", lambda c: c.group_minimum(lambda r: r["sku"], by=lambda r: r["amt"])),
    # #526: the group-find family reports GLOBAL row indices, so a
    # segment-streamed file must rebase them and merge in stream order.
    ("group_find_all", lambda c: {k: list(v) for k, v in c.group_find_all(
        lambda r: r["sku"], "S2", lambda r: r["sku"]).items()}),
    ("group_find_all_miss", lambda c: {k: list(v) for k, v in c.group_find_all(
        lambda r: r["sku"], "nope", lambda r: r["sku"]).items()}),
    ("group_find_first", lambda c: c.group_find_first(
        lambda r: r["sku"], "S2", lambda r: r["sku"])),
    ("group_find_maximum", lambda c: c.group_find_maximum(
        lambda r: r["sku"], lambda r: r["amt"])),
    ("group_find_minimum", lambda c: c.group_find_minimum(
        lambda r: r["sku"], lambda r: r["amt"])),
    ("group_find_max_ties", lambda c: c.group_find_maximum(lambda r: r["sku"], lambda _r: 0)),
    ("group_find_min_ties", lambda c: c.group_find_minimum(lambda r: r["sku"], lambda _r: 0)),
    ("scan", lambda c: list(c.scan(0, lambda a, r: a + r["qty"]))),
    ("scan_idx", lambda c: list(c.scan(0, lambda a, r, i: a + r["qty"] + i))),
    ("group_every", lambda c: c.group_every(lambda r: r["sku"], lambda r: r["qty"] > 2)),
    ("group_some", lambda c: c.group_some(lambda r: r["sku"], lambda r: r["qty"] > 30)),
    ("group_to_arrays", lambda c: c.group_to_arrays(lambda r: r["sku"], lambda r: r["qty"])),
    ("group_to_sets", lambda c: c.group_to_sets(lambda r: r["sku"], lambda r: r["qty"])),
    ("group_to_dicts", lambda c: c.group_to_dicts(
        lambda r: r["sku"], lambda r: r["qty"], lambda r: r["amt"])),
    ("flatten_to_array", lambda c: list(c.flatten_to_array(
        lambda r: EastArray(IntegerType, [r["qty"], -r["qty"]])))),
    ("flatten_to_set", lambda c: c.flatten_to_set(
        lambda r: EastSet(StringType, [r["sku"]]))),
    ("flatten_to_dict", lambda c: c.flatten_to_dict(
        lambda r: EastDict(IntegerType, StringType, {r["qty"]: r["sku"]}))),
    ("iter_boxes", lambda c: [r["qty"] for r in c]),
]


def test_array_compute_matches_load(tmp_path):
    for label, rows, seg in [
        ("multi-segment", _w4_rows(40), 7),
        ("single-segment", _w4_rows(9), 10_000),
        ("empty", [], 7),
    ]:
        path = tmp_path / f"{label}.beast2"
        write_beast2_file(path, W4_AT, EastArray(W4_ROW, rows), segment_rows=seg)
        with open_beast2_file(path, W4_AT) as f:
            table = f.load()
            for name, run in ARRAY_COMPUTE_CASES:
                got, want = _outcome(run, f), _outcome(run, table)
                assert _same(got, want), f"{name} [{label}]: {got!r} != {want!r}"


def test_array_compute_on_ordering_hostile_floats(tmp_path):
    """NaN / signed zero / infinities exercise East's total order through
    every merge path — any python comparison would diverge here."""
    at = ArrayType(FloatType)
    values = [float("nan"), -0.0, 0.0, float("inf"), float("-inf"), 1.5, -2.5, float("nan")]
    path = tmp_path / "hostile.beast2"
    write_beast2_file(path, at, EastArray(FloatType, values), segment_rows=3)
    cases = [
        ("maximum", lambda c: c.maximum()),
        ("minimum", lambda c: c.minimum()),
        ("sum", lambda c: c.sum()),
        ("mean", lambda c: c.mean()),
        ("unique", lambda c: c.unique()),
        ("group_maximum", lambda c: c.group_maximum(lambda x: 0)),
        ("group_minimum", lambda c: c.group_minimum(lambda x: 0)),
        ("to_set", lambda c: c.to_set()),
        ("find_maximum", lambda c: c.find_maximum()),
    ]
    with open_beast2_file(path, at) as f:
        table = f.load()
        for name, run in cases:
            got, want = _outcome(run, f), _outcome(run, table)
            assert _same(got, want), f"{name}: {got!r} != {want!r}"


def test_array_compute_string_join_and_columns(tmp_path):
    import numpy as np

    st = ArrayType(StringType)
    words = [f"w{i}" for i in range(11)]
    path = tmp_path / "words.beast2"
    write_beast2_file(path, st, EastArray(StringType, words), segment_rows=4)
    with open_beast2_file(path, st) as f:
        assert f.string_join("-") == f.load().string_join("-")

    path2 = tmp_path / "cols.beast2"
    write_beast2_file(path2, W4_AT, EastArray(W4_ROW, _w4_rows(23)), segment_rows=5)
    with open_beast2_file(path2, W4_AT) as f:
        table = f.load()
        fc, tc = f.to_columns(), table.to_columns()
        assert set(fc) == set(tc)
        assert np.array_equal(fc["qty"], tc["qty"]) and np.array_equal(fc["amt"], tc["amt"])
        assert fc["sku"] == tc["sku"]
        got = f.map_batches(lambda cols: {**cols, "qty": cols["qty"] * 2}, batch_size=6)
        want = table.map_batches(lambda cols: {**cols, "qty": cols["qty"] * 2}, batch_size=6)
        assert list(got.map(lambda r: r["qty"], out=IntegerType)) == \
            list(want.map(lambda r: r["qty"], out=IntegerType))


DICT_COMPUTE_CASES = [
    ("reduce", lambda c: c.reduce(0.0, lambda a, k, v: a + v)),
    ("scan", lambda c: list(c.scan(0.0, lambda a, k, v: a + v))),
    ("mean", lambda c: c.mean()),
    ("mean_proj", lambda c: c.mean(lambda k, v: v * 2.0)),
    # #526: Dict gained every/some/sum, so the file surface mirrors them.
    ("sum", lambda c: c.sum()),
    ("sum_proj", lambda c: c.sum(lambda k, v: v * 2.0)),
    ("every", lambda c: c.every(lambda k, v: v >= 0.0)),
    ("every_false", lambda c: c.every(lambda k, v: v > 5.0)),
    ("some", lambda c: c.some(lambda k, v: v > 5.0)),
    ("some_false", lambda c: c.some(lambda k, v: v > 1e9)),
    ("map", lambda c: c.map(lambda v: v * 2)),
    ("map_with_key", lambda c: c.map(lambda v, k: k)),
    ("filter", lambda c: c.filter(lambda k, v: v > 5.0)),
    ("filter_map", lambda c: c.filter_map(
        lambda k, v: some(v) if v > 5.0 else none, out=FloatType)),
    ("first_map", lambda c: c.first_map(
        lambda k, v: some(k) if v > 5.0 else none, out=StringType)),
    ("map_reduce", lambda c: c.map_reduce(lambda k, v: k, lambda a, b: a + b)),
    ("to_array", lambda c: list(c.to_array(lambda k, v: k))),
    ("to_set", lambda c: c.to_set(lambda k, v: k[:2])),
    # Collision-heavy re-key: a COUNTING combine (1.0 sums are exact under
    # any association) — cross-segment float-sum collisions carry the
    # documented associativity caveat, pinned separately below.
    ("to_dict", lambda c: c.to_dict(
        lambda k, v: k[:2], lambda k, v: 1.0, lambda a, b, _k: a + b)),
    ("flatten_to_array", lambda c: list(c.flatten_to_array(
        lambda k, v: EastArray(FloatType, [v, v])))),
    ("flatten_to_set", lambda c: c.flatten_to_set(lambda k, v: EastSet(StringType, [k]))),
    ("flatten_to_dict", lambda c: c.flatten_to_dict(
        lambda k, v: EastDict(StringType, FloatType, {k: v}))),
    ("group_reduce", lambda c: c.group_reduce(
        lambda k, v: k[:2], lambda _k: 0.0, lambda a, k, v: a + v)),
    ("group_size", lambda c: c.group_size(lambda k, v: k[:2])),
    ("group_sum", lambda c: c.group_sum(lambda k, v: k[:2])),
    ("group_mean", lambda c: c.group_mean(lambda k, v: k[:2])),
    ("group_every", lambda c: c.group_every(lambda k, v: k[:2], lambda k, v: v >= 0.0)),
    ("group_some", lambda c: c.group_some(lambda k, v: k[:2], lambda k, v: v > 8.0)),
    ("group_to_arrays", lambda c: c.group_to_arrays(lambda k, v: k[:2], lambda k, v: v)),
    ("group_to_sets", lambda c: c.group_to_sets(lambda k, v: k[:2], lambda k, v: k)),
    ("group_to_dicts", lambda c: c.group_to_dicts(
        lambda k, v: k[:2], lambda k, v: k, lambda k, v: v)),
]


def test_dict_compute_matches_load(tmp_path):
    dt = DictType(StringType, FloatType)
    for label, data, seg in [
        ("multi-segment", {f"k{i:03d}": i * 0.61 for i in range(37)}, 6),
        ("empty", {}, 6),
    ]:
        path = tmp_path / f"{label}.beast2"
        write_beast2_file(path, dt, EastDict(StringType, FloatType, data), segment_rows=seg)
        with open_beast2_file(path, dt) as d:
            table = d.load()
            for name, run in DICT_COMPUTE_CASES:
                got, want = _outcome(run, d), _outcome(run, table)
                assert _same(got, want), f"{name} [{label}]: {got!r} != {want!r}"


def test_dict_file_every_and_some_without_a_predicate(tmp_path):
    """The Boolean-values spelling of the #526 additions.

    The Float-valued fixture above can only reach ``every``/``some`` WITH a
    predicate, so the ``pred is None`` branch — which requires Boolean values
    and short-circuits across segments — needs its own file. The
    counterexample sits in the LAST segment, so a short-circuit that stopped
    early would answer wrongly rather than merely slowly.
    """
    dt = DictType(StringType, BooleanType)
    for label, data, expect_every, expect_some in [
        ("all-true", {f"k{i:03d}": True for i in range(20)}, True, True),
        ("last-false", {f"k{i:03d}": i != 19 for i in range(20)}, False, True),
        ("all-false", {f"k{i:03d}": False for i in range(20)}, False, False),
        ("empty", {}, True, False),
    ]:
        path = tmp_path / f"bool-{label}.beast2"
        write_beast2_file(path, dt, EastDict(StringType, BooleanType, data), segment_rows=4)
        with open_beast2_file(path, dt) as d:
            assert d.every() is expect_every, f"every [{label}]"
            assert d.some() is expect_some, f"some [{label}]"
            assert d.every() == d.load().every(), f"every vs load [{label}]"
            assert d.some() == d.load().some(), f"some vs load [{label}]"

    # Non-Boolean values raise the same TypeError the eager dict raises.
    numeric = tmp_path / "bool-numeric.beast2"
    ndt = DictType(StringType, IntegerType)
    write_beast2_file(numeric, ndt, EastDict(StringType, IntegerType, {"a": 1}))
    with open_beast2_file(numeric, ndt) as d:
        with pytest.raises(TypeError, match="Boolean values"):
            d.every()
        with pytest.raises(TypeError, match="Boolean values"):
            d.some()


def test_cross_segment_float_collisions_carry_the_documented_caveat(tmp_path):
    """A non-associative (float-sum) ``combine`` on keys colliding ACROSS
    segments combines partials left-associatively in stream order — equal to
    the eager element-order result up to float associativity, which is the
    documented contract (same class as ``map_reduce``'s 'should be
    associative'). Pin it as approximate so a real regression still fails."""
    dt = DictType(StringType, FloatType)
    data = {f"k{i:03d}": i * 0.61 for i in range(37)}
    path = tmp_path / "collide.beast2"
    write_beast2_file(path, dt, EastDict(StringType, FloatType, data), segment_rows=6)
    with open_beast2_file(path, dt) as d:
        table = d.load()
        got = d.to_dict(lambda k, v: k[:2], lambda k, v: v, lambda a, b, _k: a + b)
        want = table.to_dict(lambda k, v: k[:2], lambda k, v: v, lambda a, b, _k: a + b)
        assert set(got.keys()) == set(want.keys())
        for k in want.keys():  # noqa: SIM118 — EastDict, not a python dict
            assert math.isclose(got[k], want[k], rel_tol=1e-12), k


def test_dict_compute_with_variant_keys(tmp_path):
    """Option-typed keys: any python-order fallback in a merge would break
    here — East compares variants by case NAME."""
    dt = DictType(OptionType(IntegerType), FloatType)
    data = EastDict(OptionType(IntegerType), FloatType)
    data[none] = 0.5
    for i in range(9):
        data[some(i)] = i * 1.5
    path = tmp_path / "variant.beast2"
    write_beast2_file(path, dt, data, segment_rows=3)
    with open_beast2_file(path, dt) as d:
        table = d.load()
        assert d.reduce(0.0, lambda a, k, v: a + v) == table.reduce(0.0, lambda a, k, v: a + v)
        got = d.group_reduce(lambda k, v: k.type, lambda _k: 0.0, lambda a, k, v: a + v)
        want = table.group_reduce(lambda k, v: k.type, lambda _k: 0.0, lambda a, k, v: a + v)
        assert dict(got.items()) == dict(want.items())


def test_file_group_fold_aliases_warn_and_delegate(tmp_path):
    """The #535 rename reaches the file surface: `group_fold` on the Dict and
    Set flavors warns and answers exactly like `group_reduce`."""
    dict_path = tmp_path / "alias_d.beast2"
    write_beast2_file(dict_path, DictType(StringType, FloatType),
                      EastDict(StringType, FloatType,
                               {f"k{i:02d}": float(i) for i in range(9)}),
                      segment_rows=3)
    with open_beast2_file(dict_path) as d:
        want = d.group_reduce(lambda k, v: k[:2], lambda _k: 0.0,
                              lambda a, k, v: a + v)
        with pytest.warns(DeprecationWarning, match="group_reduce"):
            got = d.group_fold(lambda k, v: k[:2], lambda _k: 0.0,
                               lambda a, k, v: a + v)
        assert dict(got.items()) == dict(want.items())

    set_path = tmp_path / "alias_s.beast2"
    write_beast2_file(set_path, SetType(IntegerType),
                      EastSet(IntegerType, range(9)), segment_rows=3)
    with open_beast2_file(set_path) as s:
        want = s.group_reduce(lambda el: el % 3, lambda _k: 0, lambda a, el: a + el)
        with pytest.warns(DeprecationWarning, match="group_reduce"):
            got = s.group_fold(lambda el: el % 3, lambda _k: 0, lambda a, el: a + el)
        assert dict(got.items()) == dict(want.items())


SET_COMPUTE_CASES = [
    ("reduce", lambda c: c.reduce(0, lambda a, el: a + el)),
    ("scan", lambda c: list(c.scan(0, lambda a, el: a + el))),
    ("sum", lambda c: c.sum()),
    ("mean", lambda c: c.mean()),
    ("map", lambda c: c.map(lambda el: el * 2)),
    ("filter", lambda c: c.filter(lambda el: el % 2 == 0)),
    ("filter_map", lambda c: c.filter_map(
        lambda el: some(el) if el > 10 else none, out=IntegerType)),
    ("first_map", lambda c: c.first_map(
        lambda el: some(el) if el > 10 else none, out=IntegerType)),
    ("map_reduce", lambda c: c.map_reduce(lambda el: el, lambda a, b: a + b)),
    ("every", lambda c: c.every(lambda el: el >= 0)),
    ("some", lambda c: c.some(lambda el: el > 50)),
    ("to_array", lambda c: list(c.to_array())),
    ("to_array_proj", lambda c: list(c.to_array(lambda el: el * 10))),
    ("to_set", lambda c: c.to_set(lambda el: el % 7, out=IntegerType)),
    ("to_dict", lambda c: c.to_dict(lambda el: el, lambda el: el * 2)),
    ("flatten_to_array", lambda c: list(c.flatten_to_array(
        lambda el: EastArray(IntegerType, [el, el])))),
    ("flatten_to_set", lambda c: c.flatten_to_set(
        lambda el: EastSet(IntegerType, [el, el + 1000]))),
    ("group_reduce", lambda c: c.group_reduce(
        lambda el: el % 3, lambda _k: 0, lambda a, el: a + el)),
    ("group_size", lambda c: c.group_size(lambda el: el % 3)),
    ("group_sum", lambda c: c.group_sum(lambda el: el % 3)),
    ("group_mean", lambda c: c.group_mean(lambda el: el % 3)),
    ("group_every", lambda c: c.group_every(lambda el: el % 3, lambda el: el >= 0)),
    ("group_some", lambda c: c.group_some(lambda el: el % 3, lambda el: el > 50)),
    ("group_to_arrays", lambda c: c.group_to_arrays(lambda el: el % 3, lambda el: el)),
    ("group_to_sets", lambda c: c.group_to_sets(lambda el: el % 3, lambda el: el)),
    ("group_to_dicts", lambda c: c.group_to_dicts(
        lambda el: el % 3, lambda el: el, lambda el: el * 2)),
]


def test_set_compute_matches_load(tmp_path):
    st = SetType(IntegerType)
    for label, data, seg in [
        ("multi-segment", set(range(0, 90, 3)), 6),
        ("empty", set(), 6),
    ]:
        path = tmp_path / f"{label}.beast2"
        write_beast2_file(path, st, EastSet(IntegerType, data), segment_rows=seg)
        with open_beast2_file(path, st) as s:
            table = s.load()
            for name, run in SET_COMPUTE_CASES:
                got, want = _outcome(run, s), _outcome(run, table)
                assert _same(got, want), f"{name} [{label}]: {got!r} != {want!r}"
            other = EastSet(IntegerType, range(0, 90, 5))
            for name, run in [
                ("union", lambda c, o=other: c.union(o)),
                ("intersect", lambda c, o=other: c.intersect(o)),
                ("diff", lambda c, o=other: c.diff(o)),
                ("sym_diff", lambda c, o=other: c.sym_diff(o)),
                ("is_subset", lambda c, o=other: c.is_subset(o)),
                ("is_disjoint", lambda c, o=other: c.is_disjoint(o)),
                # #526: is_superset_of — the file drains the outstanding
                # remainder segment by segment, so it must agree with the
                # whole-value answer for covered AND uncovered `other`s.
                ("is_superset_of", lambda c, o=other: c.is_superset_of(o)),
                ("is_superset_of_subset", lambda c: c.is_superset_of(
                    EastSet(IntegerType, [0, 3, 6]))),
                ("is_superset_of_empty", lambda c: c.is_superset_of(EastSet(IntegerType))),
                ("is_superset_of_self", lambda c, o=table: c.is_superset_of(o)),
            ]:
                got, want = _outcome(run, s), _outcome(run, table)
                assert _same(got, want), f"{name} [{label}]: {got!r} != {want!r}"


def test_compute_callback_modes_stay_native(tmp_path):
    """Traced lambdas and precompiled kernels must run ZERO python per
    element across the whole file-level call; an impure callback keeps
    per-element python semantics — all three modes agree with the oracle."""
    from east.runtime.compiler import eager_stats

    path = tmp_path / "modes.beast2"
    rows = _w4_rows(40)
    write_beast2_file(path, W4_AT, EastArray(W4_ROW, rows), segment_rows=7)
    with open_beast2_file(path, W4_AT) as f:
        table = f.load()
        double = kernel(W4_ROW, lambda r: r.qty * 2)

        before = eager_stats().get("trampoline_calls", 0)
        via_kernel = list(f.map(double))
        via_traced = list(f.map(lambda r: r.qty * 2))
        traced_sum = f.sum(lambda r: r.amt)
        assert eager_stats().get("trampoline_calls", 0) == before, \
            "kernel/traced file compute trampolined into python"

        assert via_kernel == via_traced == list(table.map(double))
        assert traced_sum == table.sum(lambda r: r.amt)

        # The group-find family, which rebases per-segment indices to global
        # rows: doing that to the GROUPED result costs one python call per
        # group per segment — O(rows) on a finely segmented file — so the
        # rebase folds into the traced probe instead (#526 review). A `value`
        # that matches nothing is the worst case: every group needs filling.
        sku = kernel(W4_ROW, lambda r: r.sku)
        qty = kernel(W4_ROW, lambda r: r.qty)
        before = eager_stats().get("trampoline_calls", 0)
        find_all = f.group_find_all(sku, -1, qty)
        find_first = f.group_find_first(sku, -1, qty)
        find_max = f.group_find_maximum(sku, qty)
        find_min = f.group_find_minimum(sku, qty)
        moved = eager_stats().get("trampoline_calls", 0) - before
        assert moved == 0, f"group-find file compute trampolined {moved} time(s)"

        assert {k: list(v) for k, v in find_all.items()} == \
            {k: list(v) for k, v in table.group_find_all(sku, -1, qty).items()}
        assert dict(find_first.items()) == dict(table.group_find_first(sku, -1, qty).items())
        assert dict(find_max.items()) == dict(table.group_find_maximum(sku, qty).items())
        assert dict(find_min.items()) == dict(table.group_find_minimum(sku, qty).items())

        seen = []

        def impure(r):
            seen.append(r["qty"])
            return r["qty"] * 2

        assert list(f.map(impure, out=IntegerType)) == via_kernel
        assert len(seen) == len(rows)


def test_first_map_short_circuits_segment_decoding(tmp_path, monkeypatch):
    """A hit in the first segment must stop the scan — later segments never
    decode (the whole point of streaming the fold)."""
    path = tmp_path / "short.beast2"
    write_beast2_file(path, W4_AT, EastArray(W4_ROW, _w4_rows(40)), segment_rows=7)
    consumed = 0
    original = Beast2ArrayFile._iter_segments

    def counting(self):
        nonlocal consumed
        for segment in original(self):
            consumed += 1
            yield segment

    monkeypatch.setattr(Beast2ArrayFile, "_iter_segments", counting)
    with open_beast2_file(path, W4_AT) as f:
        # The dual-mode `where` spelling: a python-`if` lambda would raise
        # (a pure callback that cannot trace surfaces loudly).
        hit = f.first_map(lambda r: where(r["qty"] >= 2, some(r["qty"]), none),
                          out=IntegerType)
        assert hit.value == 2
        assert consumed == 1
        consumed = 0
        assert f.some(lambda r: r["qty"] >= 2)
        assert consumed == 1


def test_compute_works_without_an_index(tmp_path):
    """Array compute needs only the sequential stream, so even an index-less
    blob (random access refused) folds fine."""
    at = ArrayType(IntegerType)
    path = tmp_path / "noix.beast2"
    path.write_bytes(encode_beast2_v5_for(at)(EastArray(IntegerType, [3, 1, 4, 1, 5])))
    with open_beast2_file(path, at) as f:
        assert f.indexed is False
        assert f.sum() == 14
        assert list(f.map(lambda x: x * 2)) == [6, 2, 8, 2, 10]


def test_dict_set_compute_requires_canonical_segments(tmp_path):
    """Dict/Set compute streams disjointness-verified segments; a corrupt
    blob (bytes reordered after writing) fails loudly instead of folding
    wrong data."""
    path = tmp_path / "bad.beast2"
    write_beast2_file(path, DT, EastDict(StringType, IntegerType, {"a": 1, "c": 2, "e": 3}),
                      codec="none", segment_rows=1)
    _swap_wire_bytes(path, b"\x01a\x02", b"\x01c\x04")
    with (
        open_beast2_file(path, DT) as bad,
        pytest.raises(RuntimeError, match="not disjoint ascending"),
    ):
        bad.reduce(0, lambda a, k, v: a + v)


def test_file_surface_covers_the_eager_read_surface():
    """The completeness gate: every public eager read method must be either
    implemented on the file flavor or consciously excluded here with a
    reason — a new eager method fails this test until W4 covers it."""
    excluded = {
        Beast2ArrayFile: {
            # mutators — the file is read-only
            "sort", "reverse", "insert", "append", "extend", "pop", "remove", "clear",
            # whole-collection materializers/reorderers — load() first
            "sorted", "reversed", "copy", "concat",
            # constructors / statics
            "generate", "range", "linspace", "from_columns",
        },
        Beast2SetFile: {
            # mutators
            "add", "insert", "try_insert", "remove", "delete", "try_delete",
            "discard", "clear", "union_in_place",
            # materializer / constructor
            "copy", "generate",
        },
        Beast2DictFile: {
            # mutators
            "insert", "get_or_insert", "insert_or_update", "update", "swap",
            "delete", "try_delete", "pop", "clear", "update_many", "merge_all",
            "union_in_place", "merge_key",
            # materializers / constructor — `union` (and its deprecated `merge`
            # spelling, #527) would pull the whole file into one dict, so it
            # keeps the exclusion the old `merge` name already had.
            "union", "merge", "copy", "generate",
        },
    }
    pairs = [
        (EastArray(IntegerType, []), Beast2ArrayFile),
        (EastSet(IntegerType), Beast2SetFile),
        (EastDict(StringType, IntegerType), Beast2DictFile),
    ]
    missing = []
    for instance, file_cls in pairs:
        names = set()
        for klass in type(instance).__mro__:
            if klass.__module__.startswith("east"):
                names.update(
                    name for name, member in vars(klass).items()
                    if not name.startswith("_") and callable(member)
                )
        for name in sorted(names):
            if not hasattr(file_cls, name) and name not in excluded[file_cls]:
                missing.append(f"{file_cls.__name__}.{name}")
    assert not missing, f"eager read methods without a file counterpart: {missing}"


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
