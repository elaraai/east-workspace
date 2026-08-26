#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``scan`` — the running fold — across the eager, traced and file surfaces (#524).

The motivating trap: with no ``scan``, a forward-fill inside a kernel had to
be spelled as a per-element backward rescan (``slice(0, i+1).reversed()
.first_map(...)``) — O(n²), measured at 6h02m for 729k rows on a real ingest.
These tests pin the operation that removes it:

* the fold algebra — ``scan(init, f)[-1] == fold(init, f)`` for non-empty
  input, empty in → empty out, and result length == input length (the n vs
  n+1 convention, pinned to n: the seed is not emitted);
* the motivating forward-fill (a "same as above" encoding), including a
  sequence OPENING with a marker (resolves to the seed) and 500+-element
  runs — the shape the quadratic reformulation made pathological;
* the eager-lambda, precompiled-kernel and traced (``kernel()``) paths agree
  exactly, and both the pushed-down eager form and the traced form move zero
  ``trampoline_calls`` — the check that proves the scan runs natively rather
  than silently falling back;
* Set and Dict scans visit East order and agree with ``reduce``;
* float accumulation order is identical between the eager and traced paths;
* a multi-segment beast2 file's ``scan`` equals ``load().scan`` exactly —
  the accumulator must thread the segments in stream order, and ``(acc, el,
  idx)`` steps must see GLOBAL row indices.
"""

import pytest

from east import (
    ArrayType,
    DictType,
    East,
    FloatType,
    IntegerType,
    SetType,
    StringType,
    array,
    if_else,
    kernel,
)
from east.kernel import greatest
from east.runtime.compiler import eager_stats
from east.types.values.collections import EastDict, EastSet


def _ffill_step(acc, c):
    """The forward-fill step, dual-mode: eager on values, IR under a trace."""
    return if_else(c == "", acc, c)


# ── the fold algebra, pinned ─────────────────────────────────────────────────

def test_scan_matches_fold_for_nonempty_input():
    xs = array(IntegerType, [5, 2, 8, 1])
    scanned = xs.scan(100, lambda acc, x: acc + x)
    assert list(scanned) == [105, 107, 115, 116]
    assert scanned[len(scanned) - 1] == xs.fold(100, lambda acc, x: acc + x)


def test_scan_is_element_aligned_not_n_plus_1():
    xs = array(IntegerType, [1, 2, 3])
    assert len(xs.scan(0, lambda acc, x: acc + x)) == len(xs)


def test_scan_on_empty_returns_empty():
    assert list(array(IntegerType, []).scan(0, lambda acc, x: acc + x)) == []


def test_scan_running_maximum():
    xs = array(IntegerType, [3, 1, 4, 1, 5])
    assert list(xs.scan(0, lambda acc, x: greatest(acc, x))) == [3, 3, 4, 4, 5]


# ── the motivating forward-fill ──────────────────────────────────────────────

def test_forward_fill_paths_agree_and_run_native():
    """Eager lambda, precompiled kernel step, and a whole traced kernel all
    produce the same fill — long runs included — with zero per-element python
    on the pushed-down and traced paths."""
    cells = ["a", "", "", "b"] + [""] * 600 + ["c", ""]
    arr = array(StringType, cells)
    expected = []
    last = "seed"
    for c in cells:
        last = c if c != "" else last
        expected.append(last)

    before = eager_stats()["trampoline_calls"]
    assert list(arr.scan("seed", _ffill_step)) == expected

    step = kernel([StringType, StringType], _ffill_step)
    assert list(arr.scan("seed", step)) == expected

    # kernel() raises KernelTraceError rather than falling back, so this
    # compiling at all proves scan is on the traced surface.
    k = kernel(ArrayType(StringType), lambda a: a.scan("seed", _ffill_step))
    assert list(k(arr)) == expected
    assert eager_stats()["trampoline_calls"] == before


def test_forward_fill_opening_marker_takes_the_seed():
    arr = array(StringType, ["", "a", "", "b", ""])
    assert list(arr.scan("seed", _ffill_step)) == ["seed", "a", "a", "b", "b"]


# ── Set and Dict scans ───────────────────────────────────────────────────────

def test_set_scan_visits_east_order_and_matches_reduce():
    s = EastSet(IntegerType, [3, 1, 2])
    scanned = s.scan(0, lambda acc, x: acc + x)
    assert list(scanned) == [1, 3, 6]
    assert scanned[2] == s.reduce(0, lambda acc, x: acc + x)
    assert list(EastSet(IntegerType).scan(0, lambda acc, x: acc + x)) == []


def test_dict_scan_visits_key_order_and_matches_reduce():
    d = EastDict(StringType, IntegerType, {"b": 2, "a": 1, "c": 3})
    scanned = d.scan(0, lambda acc, _k, v: acc + v)
    assert list(scanned) == [1, 3, 6]
    assert scanned[2] == d.reduce(0, lambda acc, _k, v: acc + v)
    assert list(
        EastDict(StringType, IntegerType).scan(0, lambda acc, _k, v: acc + v)
    ) == []


def test_traced_set_and_dict_scan():
    ks = kernel(SetType(IntegerType), lambda s: s.scan(0, lambda acc, x: acc + x))
    assert list(ks(EastSet(IntegerType, [3, 1, 2]))) == [1, 3, 6]

    kd = kernel(DictType(StringType, IntegerType),
                lambda d: d.scan(0, lambda acc, _k, v: acc + v))
    assert list(kd(EastDict(StringType, IntegerType, {"b": 2, "a": 1}))) == [1, 3]


# ── float accumulation order ─────────────────────────────────────────────────

def test_float_accumulation_order_traced_equals_eager():
    """An order-sensitive float sequence must scan bit-identically on the
    eager and traced paths (both run the same east-c left fold)."""
    values = [0.1, 0.2, 0.3, 1e16, -1e16, 0.1]
    arr = array(FloatType, values)
    eager = list(arr.scan(0.0, lambda acc, x: acc + x))
    k = kernel(ArrayType(FloatType), lambda a: a.scan(0.0, lambda acc, x: acc + x))
    assert list(k(arr)) == eager


def test_eager_scan_pushes_down():
    arr = array(FloatType, [float(i) for i in range(300)])
    before = eager_stats()["trampoline_calls"]
    out = arr.scan(0.0, lambda acc, x: acc + x)
    assert eager_stats()["trampoline_calls"] == before
    assert out[299] == pytest.approx(sum(range(300)))


# ── beast2 file surface ──────────────────────────────────────────────────────

def test_beast2_array_file_scan_threads_segments(tmp_path):
    from east.serialization.beast2 import open_beast2_file, write_beast2_file

    arr = array(IntegerType, [i % 7 for i in range(1000)])
    path = tmp_path / "scan.beast2"
    write_beast2_file(path, ArrayType(IntegerType), arr, segment_rows=64)
    with open_beast2_file(path) as f:
        assert f.segment_count > 1
        assert list(f.scan(0, lambda acc, x: acc + x)) == \
            list(f.load().scan(0, lambda acc, x: acc + x))
        # (acc, el, idx) steps must see GLOBAL row indices across segments.
        step = lambda acc, x, i: if_else(East.Integer.remainder(i, 2) == 0, acc + x, acc)  # noqa: E731
        assert list(f.scan(0, step)) == list(f.load().scan(0, step))


def test_beast2_set_and_dict_file_scan(tmp_path):
    from east.serialization.beast2 import open_beast2_file, write_beast2_file

    s = EastSet(IntegerType, list(range(500)))
    sp = tmp_path / "scan-set.beast2"
    write_beast2_file(sp, SetType(IntegerType), s, segment_rows=64)
    with open_beast2_file(sp) as f:
        assert f.segment_count > 1
        assert list(f.scan(0, lambda acc, x: acc + x)) == \
            list(f.load().scan(0, lambda acc, x: acc + x))

    d = EastDict(IntegerType, IntegerType, {i: i * 2 for i in range(500)})
    dp = tmp_path / "scan-dict.beast2"
    write_beast2_file(dp, DictType(IntegerType, IntegerType), d, segment_rows=64)
    with open_beast2_file(dp) as f:
        assert f.segment_count > 1
        assert list(f.scan(0, lambda acc, k, v: acc + k + v)) == \
            list(f.load().scan(0, lambda acc, k, v: acc + k + v))
