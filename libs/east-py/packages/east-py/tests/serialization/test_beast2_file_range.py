#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A key range of an open beast2 file (#1616, D6): ``Beast2DictFile.range`` and
``.prefix``, and ``Beast2SetFile``'s.

A range of a file is a read-only East value of the file's kind over the same
open file, read at the cost of the range and never of the file:

- a file opened without ``project=`` gives a collection that still reads from
  the pager — east-c's view (pinned by its own gates) — so its size reads no
  segment between its ends, a keyed read tests the bounds first, and iterating
  it reads its segments each once;
- under ``project=`` the rows are read by the file's own pager as a view reads
  them — placed by the keys as the wire holds them, the segments they span
  read once each, its end segments through the cache — into a collection
  frozen at every depth;
- a prefix is always written, so ``prefix(None)`` is refused, and a bound
  written in a function's body is refused — the body takes the range of the
  file passed to it, which the pager serves.

What a read cost is the segments a pager decoded — a count, never a clock.
"""

from __future__ import annotations

import gc

import pytest
from east.runtime._compiler_eastc import paged_value_is_hydrated, paged_value_stats

from east import (
    ArrayType,
    DictType,
    East,
    EastDict,
    EastSet,
    IntegerType,
    SetType,
    StringType,
    StructType,
)
from east.expression.errors import ExpressionError
from east.runtime.errors import EastError
from east.serialization.beast2 import open_beast2_file
from east.types.coercion import EastTypeError
from tests.segments import write_in_segments

# Row r is 3r -> 10r, so a bound can fall between keys. A segment holds 8 rows:
# segment s is rows 8s to 8s + 7, and its first key is 24s.
ROWS = 96
PER_SEGMENT = 8
Counts = DictType(IntegerType, IntegerType)
Numbers = SetType(IntegerType)

# Sheets printed, keyed by press and job: 8 jobs a press, so a segment is one press.
Key = StructType([("press", StringType), ("job", IntegerType)])
Sheet = StructType([("count", IntegerType), ("note", StringType)])
Sheets = DictType(Key, Sheet)
Narrow = DictType(Key, StructType([("count", IntegerType)]))
# The same sheets, each with its operators: an Array a projection keeps.
Crewed = DictType(Key, StructType([("count", IntegerType), ("crew", ArrayType(StringType)),
                                   ("note", StringType)]))
CrewOnly = DictType(Key, StructType([("crew", ArrayType(StringType))]))


def _counts(tmp_path):
    path = tmp_path / "counts.beast2"
    write_in_segments(path, Counts, {3 * i: 10 * i for i in range(ROWS)}, PER_SEGMENT)
    return path


def _numbers(tmp_path):
    path = tmp_path / "numbers.beast2"
    write_in_segments(path, Numbers, {3 * i for i in range(ROWS)}, PER_SEGMENT)
    return path


def _sheets(tmp_path):
    path = tmp_path / "sheets.beast2"
    rows = EastDict(Key, Sheet)
    for i in range(ROWS):
        rows[{"press": f"P{i // PER_SEGMENT:02d}", "job": i % PER_SEGMENT}] = {
            "count": i, "note": f"sheet {i}"}
    write_in_segments(path, Sheets, rows, PER_SEGMENT)
    return path


def _crewed(tmp_path):
    path = tmp_path / "crewed.beast2"
    rows = EastDict(Key, Crewed.value["value"])
    for i in range(ROWS):
        rows[{"press": f"P{i // PER_SEGMENT:02d}", "job": i % PER_SEGMENT}] = {
            "count": i, "crew": [f"operator {i}"], "note": f"sheet {i}"}
    write_in_segments(path, Crewed, rows, PER_SEGMENT)
    return path


def _decoded(f) -> int:
    """Segments the file's lazily opened value has decoded so far."""
    return paged_value_stats(f._east_c_paged)[1]


# ── a file that reads on from the pager ──────────────────────────────────────


def test_a_range_of_a_dict_file_reads_at_the_cost_of_the_range(tmp_path):
    with open_beast2_file(_counts(tmp_path), Counts) as f:
        r = f.range(from_=30, to=108)
        assert isinstance(r, EastDict)
        assert _decoded(f) == 0, "making a range reads nothing"
        assert len(r) == 26
        assert _decoded(f) == 2, "its size places its two ends, and reads none between"
        assert 3 not in r
        assert 33 in r
        assert r[33] == 110
        assert _decoded(f) == 2, "a keyed read inside it was of a segment already held"
        assert list(r.items()) == [(3 * i, 10 * i) for i in range(10, 36)]
        assert _decoded(f) == 4, "iterating it reads the two segments between its ends"
        assert not paged_value_is_hydrated(f._east_c_paged), "the file was never decoded whole"
        del r


def test_a_range_of_a_file_is_read_only_and_copies_to_change(tmp_path):
    with open_beast2_file(_counts(tmp_path), Counts) as f:
        r = f.range(from_=30, to=60)
        with pytest.raises(EastError, match="cannot mutate a frozen value"):
            r[31] = 0
        with pytest.raises(EastError, match="cannot mutate a frozen value"):
            r.delete(33)
        changed = r.copy()
        changed[31] = 0
        assert len(changed) == 11
        assert len(r) == 10
        assert len(f) == ROWS
        del r, changed


def test_a_ranges_other_methods_decode_its_own_rows(tmp_path):
    with open_beast2_file(_counts(tmp_path), Counts) as f:
        r = f.range(from_=30, to=108)
        assert r.sum() == sum(10 * i for i in range(10, 36))
        assert _decoded(f) == 4, "the range's four segments, each once"
        assert r.to_array(lambda _b, v, k: k + v, out=IntegerType)[0] == 30 + 100
        assert _decoded(f) == 4, "its rows were decoded once, and kept"
        assert not paged_value_is_hydrated(f._east_c_paged)
        del r


def test_ends_left_out_empty_and_inverted_ranges(tmp_path):
    with open_beast2_file(_counts(tmp_path), Counts) as f:
        whole = f.load()
        for from_, to in [(None, 15), (270, None), (None, None), (31, 31), (60, 30),
                          (3000, None), (0, 24), (24, 48)]:
            got = f.range(from_=from_, to=to)
            want = whole.range(from_=from_, to=to)
            assert list(got.items()) == list(want.items()), (from_, to)
            del got


def test_a_prefix_of_a_dict_file(tmp_path):
    with open_beast2_file(_sheets(tmp_path), Sheets) as f:
        r = f.prefix({"press": "P03"})
        assert len(r) == PER_SEGMENT
        assert _decoded(f) == 2, "the segment before the press, and the press's own"
        assert [k["job"] for k in r] == list(range(PER_SEGMENT))
        assert r[{"press": "P03", "job": 2}]["count"] == 26
        # a range by the key's first field, and by the whole key
        tail = f.range(from_={"press": "P10"}, to={"press": "P11", "job": 3})
        assert [(k["press"], k["job"]) for k in tail] == \
            [("P10", j) for j in range(PER_SEGMENT)] + [("P11", j) for j in range(3)]
        del r, tail


def test_a_range_and_a_prefix_of_a_set_file(tmp_path):
    with open_beast2_file(_numbers(tmp_path), Numbers) as f:
        r = f.range(from_=30, to=108)
        assert isinstance(r, EastSet)
        assert len(r) == 26
        assert _decoded(f) == 2
        assert 33 in r and 3 not in r
        assert list(r) == [3 * i for i in range(10, 36)]
        with pytest.raises(EastError, match="cannot mutate a frozen value"):
            r.add(31)
        del r
    path = tmp_path / "keys.beast2"
    keys = EastSet(Key)
    for i in range(ROWS):
        keys.add({"press": f"P{i // PER_SEGMENT:02d}", "job": i % PER_SEGMENT})
    write_in_segments(path, SetType(Key), keys, PER_SEGMENT)
    with open_beast2_file(path, SetType(Key)) as f:
        r = f.prefix({"press": "P05"})
        assert [k["job"] for k in r] == list(range(PER_SEGMENT))
        del r


def test_a_bound_that_is_no_leading_part_of_the_key_is_refused(tmp_path):
    words = "is no leading part of the key: a bound gives the key's first fields in order — press, job"
    with open_beast2_file(_sheets(tmp_path), Sheets) as f:
        with pytest.raises(EastTypeError, match=words):
            f.range(from_={"job": 1})
        with pytest.raises(EastTypeError, match=words):
            f.prefix({"job": 1})
    with open_beast2_file(_counts(tmp_path), Counts) as f, pytest.raises(EastTypeError):
        f.prefix(3)


def test_a_prefix_is_always_written(tmp_path):
    with open_beast2_file(_sheets(tmp_path), Sheets) as f:
        with pytest.raises(EastTypeError):
            f.prefix(None)
        whole = f.load()
        with pytest.raises(EastTypeError):
            whole.prefix(None)
    with open_beast2_file(_counts(tmp_path), Counts) as f, pytest.raises(EastTypeError):
        f.prefix(None)
    with open_beast2_file(_numbers(tmp_path), Numbers) as f, pytest.raises(EastTypeError):
        f.prefix(None)


def test_a_bound_written_in_a_body_is_refused_for_the_file_passed_in(tmp_path):
    words = "Pass the file to the function"
    with open_beast2_file(_sheets(tmp_path), Sheets) as f:
        with pytest.raises(ExpressionError, match=words):
            East.function([StringType], IntegerType,
                          lambda _b, press: f.prefix({"press": press}).size())
        with pytest.raises(ExpressionError, match=words):
            East.function([StringType], IntegerType,
                          lambda _b, press: f.range(from_={"press": press}).size())
        assert not paged_value_is_hydrated(f._east_c_paged), "nothing of the file was read"
        # The file passed to the function: the body's prefix is the pager's.
        jobs = East.function([StringType, Sheets], IntegerType,
                             lambda _b, press, d: d.prefix({"press": press}).size()).bind(f)
        assert jobs("P03") == PER_SEGMENT
        assert not paged_value_is_hydrated(f._east_c_paged)
        del jobs
    with open_beast2_file(_numbers(tmp_path), Numbers) as f, \
            pytest.raises(ExpressionError, match=words):
        East.function([IntegerType], IntegerType,
                      lambda _b, n: f.range(from_=n).size())


def test_a_range_holds_the_file_open(tmp_path):
    f = open_beast2_file(_counts(tmp_path), Counts)
    r = f.range(from_=30, to=60)
    f.close()
    assert not f.closed, "a range still reads through the mapping: the close waits for it"
    assert len(r) == 10
    assert r[33] == 110
    del r
    gc.collect()
    f.close()
    assert f.closed
    with pytest.raises(ValueError, match="closed Beast2File"):
        f.range(from_=30, to=60)


# ── under project= ───────────────────────────────────────────────────────────


def test_a_range_under_a_projection_reads_the_segments_it_spans(tmp_path):
    with open_beast2_file(_sheets(tmp_path), project=Narrow) as f:
        assert f._lazy is None, "a projected file reads through its own pager alone"
        core = f._pages._core
        r = f.range(from_={"press": "P02", "job": 4}, to={"press": "P05", "job": 2})
        # rows 20 to 41: segments 2 to 5, each read once — its end segments
        # through the cache, where placing its ends left them — and no segment
        # outside them.
        assert core.stats()[0] == 4
        assert isinstance(r, EastDict)
        assert [(k["press"], k["job"]) for k in r] == \
            [(f"P{i // PER_SEGMENT:02d}", i % PER_SEGMENT) for i in range(20, 42)]
        assert r[{"press": "P03", "job": 0}] == {"count": 24}, "its rows are the projected ones"
        with pytest.raises(EastError, match="cannot mutate a frozen value"):
            r[{"press": "P03", "job": 0}] = {"count": 0}
        assert core.stats()[0] == 4, "reading the range decodes nothing more"
        # a prefix, and a range that holds nothing
        assert [k["job"] for k in f.prefix({"press": "P07"})] == list(range(PER_SEGMENT))
        assert len(f.range(from_={"press": "P02", "job": 9}, to={"press": "P02", "job": 9})) == 0
        del core  # it borrows the mapping the file closes


def test_a_range_under_a_projection_refuses_a_change_at_any_depth(tmp_path):
    with open_beast2_file(_crewed(tmp_path), project=CrewOnly) as f:
        r = f.range(from_={"press": "P02", "job": 4}, to={"press": "P05", "job": 2})
        # P02 is an end segment of the range, P03 one between its ends.
        for key in ({"press": "P02", "job": 5}, {"press": "P03", "job": 0}):
            crew = r[key]["crew"]
            with pytest.raises(EastError, match="cannot mutate a frozen value"):
                crew.push_last("another operator")
            assert list(r[key]["crew"]) == [f"operator {PER_SEGMENT * int(key['press'][1:]) + key['job']}"]
        # A change is made to copies, as a frozen value's refusal says: the
        # range's copy takes a row, and a copy of the row's crew an operator.
        key = {"press": "P03", "job": 0}
        changed = r.copy()
        crew = changed[key]["crew"].copy()
        crew.push_last("another operator")
        changed[key] = {"crew": crew}
        assert list(changed[key]["crew"]) == ["operator 24", "another operator"]
        assert list(r[key]["crew"]) == ["operator 24"]
        del r, changed, crew


def test_a_range_under_a_projection_is_what_the_loaded_file_holds(tmp_path):
    with open_beast2_file(_sheets(tmp_path), project=Narrow) as f:
        whole = f.load()
        for from_, to in [(None, {"press": "P01"}), ({"press": "P10", "job": 5}, None), (None, None),
                          ({"press": "P04"}, {"press": "P04"}), ({"press": "P09"}, {"press": "P03"}),
                          ({"press": "P99"}, None)]:
            got = f.range(from_=from_, to=to)
            want = whole.range(from_=from_, to=to)
            assert list(got.items()) == list(want.items()), (from_, to)
