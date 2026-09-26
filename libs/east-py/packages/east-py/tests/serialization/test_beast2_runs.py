#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Sorted runs, pinned across runtimes.

Each run is the canonical blob of its sorted, folded value; a key's values
fold in the order they were added; a run closes at the element cap or the
byte cap; and the runs a pinned sequence of elements closes are the runs
east-c (``tests/test_beast2_runs.c``) and TypeScript
(``east/src/serialization/beast2/v5/runs.spec.ts``) close for it, compared by
a digest of every run's bytes.

This runtime binds east-c's sorter, so what is asserted here is that the
binding is wired to it — the sink callbacks, the fold, and the errors that
cross back into python — and that the runs merge back, through east-c's
merge, into the canonical blob of the whole value."""

import re

import pytest
from east.serialization._beast2_eastc import _fnv1a64, _merge_blobs

from east import ArrayType, BlobType, DictType, East, EastDict, IntegerType, SetType, StringType
from east.serialization.beast2 import (
    RUN_MAX_BYTES,
    RUN_MAX_COUNT,
    Beast2RunSorter,
    decode_beast2_with_header_for,
    encode_beast2_paged_for,
    open_beast2_pages_for,
)

#: TypeScript's runs of the parity sequences below: fnv1a64 over every run's
#: fnv1a64, in hex, joined with ','.
PERMUTED_DICT_DIGEST = "d90d3818c52e31bb"
SET_UNION_DIGEST = "a4a7379f0468c2be"

DICT_SI = DictType(StringType, IntegerType)
DICT_SS = DictType(StringType, StringType)
SET_S = SetType(StringType)


class _Run:
    """One run's sink: its bytes, and whether it was closed."""

    def __init__(self):
        self.chunks: list[bytes] = []
        self.closed = False

    def write(self, data) -> None:
        self.chunks.append(bytes(data))

    def close(self) -> None:
        self.closed = True


def _sort(collection_type, elements, **options) -> list[bytes]:
    """Sorts ``elements`` and returns each run's bytes."""
    runs: list[_Run] = []

    def open_run(run):
        assert run == len(runs), "runs are numbered in the order they open"
        runs.append(_Run())
        return runs[-1]

    sorter = Beast2RunSorter(collection_type, open_run, **options)
    for element in elements:
        sorter.add(element)
    sorter.finish()
    assert sorter.runs == len(runs)
    assert all(run.closed for run in runs), "every run is closed"
    return [b"".join(run.chunks) for run in runs]


def _counts(collection_type, runs) -> list[int]:
    return [open_beast2_pages_for(collection_type)(run).element_count for run in runs]


def _digest(runs) -> str:
    joined = ",".join(format(_fnv1a64(run), "016x") for run in runs)
    return format(_fnv1a64(joined.encode()), "016x")


def _sum():
    return East.function([StringType, IntegerType, IntegerType], IntegerType,
                         lambda _b, _key, acc, value: acc + value)


def _concat():
    return East.function([StringType, StringType, StringType], StringType,
                         lambda _b, _key, acc, value: acc + value)


def test_a_run_is_the_canonical_blob_of_its_sorted_folded_value() -> None:
    added = [("c", 1), ("a", 2), ("c", 3), ("b", 4), ("a", 5)]
    (run,) = _sort(DICT_SI, added, merge=_sum())
    assert run == encode_beast2_paged_for(DICT_SI)({"a": 7, "b": 4, "c": 4})


def test_a_keys_values_fold_in_the_order_they_were_added() -> None:
    (run,) = _sort(DICT_SS, [("k", "a"), ("j", "x"), ("k", "b"), ("k", "c")], merge=_concat())
    assert dict(decode_beast2_with_header_for(DICT_SS)(run).items()) == {"j": "x", "k": "abc"}


def test_union_keeps_a_repeated_element_once_and_its_absence_refuses_it() -> None:
    (run,) = _sort(SET_S, ["b", "a", "b", "c", "a"], union=True)
    assert list(decode_beast2_with_header_for(SET_S)(run)) == ["a", "b", "c"]
    expected = 'beast2 v5: duplicate Set element emitted: "b" — Set elements must be unique'
    with pytest.raises(RuntimeError, match=f"^{re.escape(expected)}$"):
        _sort(SET_S, ["b", "a", "b"])


def test_a_dict_key_added_twice_is_refused_without_a_merge() -> None:
    expected = 'beast2 v5: duplicate Dict key emitted: "k" — Dict keys must be unique'
    with pytest.raises(RuntimeError, match=f"^{re.escape(expected)}$"):
        _sort(DICT_SI, [("k", 1), ("j", 2), ("k", 3)])


def test_a_run_closes_at_the_element_cap() -> None:
    n = RUN_MAX_COUNT + 10
    runs = _sort(SetType(IntegerType), [n - i for i in range(n)])
    assert _counts(SetType(IntegerType), runs) == [RUN_MAX_COUNT, 10]
    # The first run holds the elements added first, whatever their keys.
    assert list(decode_beast2_with_header_for(SetType(IntegerType))(runs[1]))[-1] == 10


def test_a_run_closes_at_the_byte_cap() -> None:
    # Elements of 2 MiB: the run that reaches the cap is written with the
    # element that reached it. Per element: the key's length prefix and 8
    # bytes, the blob's 4-byte length prefix and its bytes.
    wide = DictType(StringType, BlobType)
    payload = bytes([7]) * (2 * 1024 * 1024)
    first = -(-RUN_MAX_BYTES // (1 + 8 + 4 + len(payload)))
    runs = _sort(wide, [(f"k{i:07d}", payload) for i in range(40)], codec="none")
    assert _counts(wide, runs) == [first, 40 - first]


def test_an_element_that_fails_to_encode_leaves_the_sorter_as_it_was() -> None:
    runs: list[_Run] = []
    sorter = Beast2RunSorter(DICT_SI, lambda _run: runs.append(_Run()) or runs[-1])
    sorter.add(("b", 1))
    with pytest.raises((TypeError, ValueError)):
        sorter.add(("a", "not an integer"))
    sorter.add(("a", 2))
    sorter.finish()
    sorter.finish()
    assert dict(decode_beast2_with_header_for(DICT_SI)(b"".join(runs[0].chunks)).items()) == \
        {"a": 2, "b": 1}
    with pytest.raises(RuntimeError, match="after finish"):
        sorter.add(("c", 3))


def test_a_sink_error_crosses_back_into_python() -> None:
    class DiskFull(Exception):
        pass

    def full(_run):
        raise DiskFull("no space left")

    sorter = Beast2RunSorter(DICT_SI, full)
    sorter.add(("a", 1))
    with pytest.raises(DiskFull, match="no space left"):
        sorter.finish()

    class Failing(_Run):
        def write(self, data) -> None:
            raise DiskFull("the write failed")

    sorter = Beast2RunSorter(DICT_SI, lambda _run: Failing())
    sorter.add(("a", 1))
    with pytest.raises(DiskFull, match="the write failed"):
        sorter.finish()


def test_it_refuses_a_root_it_cannot_sort_and_a_fold_that_does_not_fit() -> None:
    def never(_run):
        raise AssertionError("no run is written")

    with pytest.raises(TypeError, match="Set or Dict values, not Array"):
        Beast2RunSorter(ArrayType(IntegerType), never)
    ints = East.function([IntegerType, IntegerType, IntegerType], IntegerType,
                         lambda _b, _key, acc, value: acc + value)
    with pytest.raises(TypeError, match="folds a Dict"):
        Beast2RunSorter(SetType(IntegerType), never, merge=ints)
    with pytest.raises(TypeError, match="collapses a Set"):
        Beast2RunSorter(DICT_SI, never, union=True)
    with pytest.raises(TypeError, match=re.escape("a merge function is (K, V, V) -> V")):
        Beast2RunSorter(DICT_SI, never, merge=ints)


class TestTwoRuntimeParity:
    # Where a run closes decides how a repeated key's values group before
    # they fold, so every runtime must close runs at the same elements and
    # write each as the same bytes.

    def test_a_permuted_dict_closes_and_writes_the_runs_typescript_writes(self) -> None:
        # 300,000 distinct keys in a permuted order: 7919 is prime to 300,000.
        n = 300_000
        runs = _sort(DICT_SI, [(f"k{(i * 7919) % n:07d}", i) for i in range(n)], parallel=True)
        assert _counts(DICT_SI, runs) == [RUN_MAX_COUNT, RUN_MAX_COUNT, n - 2 * RUN_MAX_COUNT]
        assert _digest(runs) == PERMUTED_DICT_DIGEST

    def test_a_set_under_union_closes_and_writes_the_runs_typescript_writes(self) -> None:
        # 300,000 elements over 200,000 values: each repeats, within a run
        # and across runs.
        runs = _sort(SET_S, [f"e{(i * 7919) % 200_000:06d}" for i in range(300_000)], union=True)
        assert len(runs) == 3
        assert _digest(runs) == SET_UNION_DIGEST


def test_the_runs_merge_back_into_the_canonical_blob_of_the_whole_value(tmp_path) -> None:
    # The runs and the merge together are the any-order write: whatever order
    # the elements came in and wherever the runs closed, merging the runs is
    # the canonical blob of the value.
    keys = [f"k{(i * 7919) % 200_000:07d}" for i in range(300_000)]
    totals: dict[str, int] = {}
    for i, key in enumerate(keys):
        totals[key] = totals.get(key, 0) + i
    runs = _sort(DICT_SI, list(zip(keys, range(len(keys)), strict=True)), merge=_sum())
    assert len(runs) > 1
    paths = []
    for i, run in enumerate(runs):
        paths.append(tmp_path / f"run{i}.beast2")
        paths[-1].write_bytes(run)
    out = tmp_path / "merged.beast2"
    stats = _merge_blobs(paths, out, _sum())
    assert stats["entries"] == len(totals)
    assert out.read_bytes() == encode_beast2_paged_for(DICT_SI)(EastDict(StringType, IntegerType, totals))
