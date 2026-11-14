#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A key range of a lazily opened Dict or Set is a view the pager serves (#1616, D4).

east-c's gates pin the view itself (``test_paged_range``) and each read of one
through a body (``test_paged_range_body``). East-py's pager is east-c's, so
what is pinned here is what is python's own: that a body python wrote reads a
range of a lazily opened input at the cost of the range, and that a python
platform function handed such an input takes a range of it as a value that
still reads from the pager — its size, its keyed reads, its iteration and a
range of it again — where every other read decodes the range's own rows and
leaves the input lazy.

What a read cost is the segments the input's pager decoded
(``paged_value_stats``): a count, never a clock.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from east.runtime._compiler_eastc import (
    open_paged_value,
    paged_value_is_hydrated,
    paged_value_stats,
)

from east import DictType, East, EastDict, EastSet, IntegerType, SetType
from east.runtime.errors import EastError
from east.runtime.platform import PlatformFunction
from tests.segments import write_in_segments

# Row r is 3r -> 10r, so a bound can fall between keys. A segment holds 8 rows:
# segment s is rows 8s to 8s + 7, and its first key is 24s.
ROWS = 96
PER_SEGMENT = 8
Sheets = DictType(IntegerType, IntegerType)
Jobs = SetType(IntegerType)


def _dict_blob(tmp_path) -> bytes:
    path = tmp_path / "sheets.beast2"
    write_in_segments(path, Sheets, {3 * i: 10 * i for i in range(ROWS)}, PER_SEGMENT)
    return Path(path).read_bytes()


def _set_blob(tmp_path) -> bytes:
    path = tmp_path / "jobs.beast2"
    write_in_segments(path, Jobs, {3 * i for i in range(ROWS)}, PER_SEGMENT)
    return Path(path).read_bytes()


def _open_lazy(compiled, data: bytes, frozen: bool = True):
    lazy = open_paged_value(compiled._eastc_handle._input_types[0], data, frozen=frozen)
    assert lazy is not None, "input did not open as a lazy paged value"
    return lazy


def _decoded(lazy) -> int:
    """Segments the input's pager has decoded so far."""
    return paged_value_stats(lazy._east_c_paged)[1]


def _lazy(lazy) -> bool:
    return paged_value_is_hydrated(lazy._east_c_paged) is False


def _probe(input_type, impl):
    """A compiled program whose body hands its input to one python platform function."""
    probe = East.platform("probe", [input_type], IntegerType)
    fn = East.function([input_type], IntegerType, lambda b, d: probe(d))
    return East.compile(fn, platform=[PlatformFunction(
        name="probe", inputs=[input_type], output=IntegerType, type="sync", fn=impl)])


# ── a body python wrote ──────────────────────────────────────────────────────


def test_a_bodys_size_of_a_range_places_its_two_ends(tmp_path):
    size = East.compile(East.function(
        [Sheets], IntegerType, lambda b, d: d.range(from_=30, to=108).size()))
    lazy = _open_lazy(size, _dict_blob(tmp_path))
    assert size(lazy) == 26
    assert _decoded(lazy) == 2, "a size reads the segment each end lands in, and none between"
    assert _lazy(lazy)


def test_a_bodys_loop_over_a_range_reads_its_segments_each_once(tmp_path):
    def body(b, d):
        total = b.let(0)

        def each(b, value, _key, _label):
            b.assign(total, total + value)

        b.for_(d.range(from_=30, to=108), each)
        return total

    summed = East.compile(East.function([Sheets], IntegerType, body))
    lazy = _open_lazy(summed, _dict_blob(tmp_path))
    assert summed(lazy) == sum(10 * r for r in range(10, 36))
    assert _decoded(lazy) == 4, "the range's four segments, each once"
    assert _lazy(lazy)


def test_a_bodys_keyed_read_of_a_range_tests_the_bounds_first(tmp_path):
    has = East.compile(East.function(
        [Sheets, IntegerType], IntegerType,
        lambda b, d, key: d.range(from_=30, to=60).has(key).if_else(lambda b: 1, lambda b: 0)))
    lazy = _open_lazy(has, _dict_blob(tmp_path))
    assert has(lazy, 3) == 0
    assert _decoded(lazy) == 0, "a key outside the bounds is absent, and nothing is read to say so"
    assert has(lazy, 33) == 1
    assert _decoded(lazy) == 1, "a key inside them is the input's keyed read"
    assert _lazy(lazy)


def test_a_range_of_a_set_in_a_body(tmp_path):
    size = East.compile(East.function([Jobs], IntegerType, lambda b, s: s.range(from_=30, to=108).size()))
    lazy = _open_lazy(size, _set_blob(tmp_path))
    assert size(lazy) == 26
    assert _decoded(lazy) == 2
    assert _lazy(lazy)


# ── a python platform function handed the input ──────────────────────────────


def test_a_platform_function_takes_a_range_that_still_reads_from_the_pager(tmp_path):
    seen = {}

    def impl(d):
        r = d.range(from_=30, to=60)
        seen["made"] = _decoded(lazy)
        seen["is_dict"] = isinstance(r, EastDict)
        seen["len"] = len(r)
        seen["sized"] = _decoded(lazy)
        seen["outside"] = 3 in r
        seen["inside"] = 33 in r
        seen["value"] = r[33]
        seen["items"] = list(r.items())
        seen["narrower"] = list(r.range(from_=36, to=600))
        seen["read"] = _decoded(lazy)
        return len(r)

    compiled = _probe(Sheets, impl)
    lazy = _open_lazy(compiled, _dict_blob(tmp_path))
    assert compiled(lazy) == 10
    assert seen["made"] == 0, "making a range reads nothing"
    assert seen["is_dict"]
    assert seen["len"] == 10
    assert seen["sized"] == 2, "its size places its two ends"
    assert seen["outside"] is False
    assert seen["inside"] is True
    assert seen["value"] == 110
    assert seen["items"] == [(3 * r, 10 * r) for r in range(10, 20)]
    assert seen["narrower"] == [3 * r for r in range(12, 20)]
    assert seen["read"] == 2, "every read after its size was of the two segments already held"
    assert _lazy(lazy), "a range read through the pager leaves the input lazy"


def test_a_range_of_a_frozen_input_is_a_collection_python_may_change(tmp_path):
    seen = {}

    def impl(d):
        r = d.range(from_=30, to=60)
        r[31] = 0
        seen["len"] = len(r)
        seen["keys"] = list(r)[:3]
        with pytest.raises(EastError, match="cannot mutate a frozen value"):
            d[31] = 0
        seen["input"] = len(d)
        return len(r)

    compiled = _probe(Sheets, impl)
    lazy = _open_lazy(compiled, _dict_blob(tmp_path))
    assert compiled(lazy) == 11
    assert seen == {"len": 11, "keys": [30, 31, 33], "input": ROWS}
    assert _decoded(lazy) == 2, "the range's own rows, and no others"
    assert _lazy(lazy), "changing a range leaves the input lazy and as it was"


def test_a_read_the_pager_does_not_serve_decodes_the_ranges_own_rows(tmp_path):
    def impl(d):
        r = d.range(from_=30, to=108)
        return int(r.to_array(lambda _b, v: v, out=IntegerType).sum())

    compiled = _probe(Sheets, impl)
    lazy = _open_lazy(compiled, _dict_blob(tmp_path))
    assert compiled(lazy) == sum(10 * r for r in range(10, 36))
    assert _decoded(lazy) == 4, "the range's four segments, each once"
    assert _lazy(lazy), "the input stays lazy: the range decoded its own rows"


def test_a_range_of_a_set_handed_to_a_platform_function(tmp_path):
    seen = {}

    def impl(s):
        r = s.range(from_=30, to=108)
        seen["is_set"] = isinstance(r, EastSet)
        seen["len"] = len(r)
        seen["sum"] = sum(r)
        seen["has"] = (33 in r, 3 in r)
        return len(r)

    compiled = _probe(Jobs, impl)
    lazy = _open_lazy(compiled, _set_blob(tmp_path))
    assert compiled(lazy) == 26
    assert seen == {"is_set": True, "len": 26, "sum": sum(3 * r for r in range(10, 36)), "has": (True, False)}
    assert _decoded(lazy) == 4, "its two ends through the cache, and the two segments between them"
    assert _lazy(lazy)
