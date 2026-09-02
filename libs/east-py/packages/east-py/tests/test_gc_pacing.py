#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""GC pacing regression (issue #437): fixed work must not slow down as a
long-lived accumulated structure grows.

east-c's full collections used to fire every 10,000 tracked allocations
regardless of live size, so any accumulate-then-return build paid an O(live)
walk per 10k allocations — quadratic overall (CPython bpo-4074). At 1.8M live
values, byte-identical work ran 50x slower than at zero. The fix paces full
collections on old-generation growth, and stops tracking structs/variants
whose type proves they cannot participate in a reference cycle.

The rounds here do byte-identical work while `held` grows by ~200,000 tracked
values per round (the issue's own repro sizes — each round is a 5-map
aggregate over 20k rows, ~0.1s). Pre-fix the last round measured ~12x the
first at these sizes and grew with the round count; post-fix the per-round
time is flat. The baseline is the slower of the first two rounds (warm-up
guard) and the bound is 2x on top of that.

It is a wall-clock assertion, so it is a ``perf`` benchmark (``EAST_PERF=1``,
``make bench``), not a CI test: the gate CI runs is the C-level one (east-c
tests/test_gc_pacing.c), which asserts the pacing schedule itself, count-based
and timing-free.
"""

import time

import pytest

from east import (
    ArrayType,
    East,
    FloatType,
    StringType,
    StructType,
    array,
)

Inner = StructType([("a", StringType), ("b", FloatType)])
Row = StructType([("k", StringType), ("v", ArrayType(Inner))])


@pytest.mark.perf
def test_fixed_work_stays_flat_while_live_set_grows():
    # Maps Row -> Row: allocates a struct + an array per row (both GC-kind
    # containers; mapping to a leaf kind would not exercise the collector).
    k = East.function([Row], Row, lambda _b, r: {"k": r["k"], "v": r["v"]})
    work = array(Row, [{"k": str(i), "v": [{"a": "x", "b": 1.0}]} for i in range(20_000)])

    def chunk(n: int):
        return array(
            Row,
            [
                {"k": f"{n}-{i}", "v": [{"a": "x", "b": 1.0}, {"a": "y", "b": 2.0}]}
                for i in range(50_000)
            ],
        )

    held = []
    times = []
    for n in range(5):
        t = time.perf_counter()
        for _ in range(5):
            work.map(k)
        times.append(time.perf_counter() - t)
        held.append(chunk(n))  # grow AFTER timing, so round 0 is the baseline

    # Pre-fix the last round was several times the max of the first two at
    # these sizes and grows with the round count; post-fix it is ~1.0x.
    baseline = max(times[0], times[1])
    assert times[-1] < 2 * baseline, (
        f"identical work slowed down as the live set grew: {[f'{t:.3f}' for t in times]}"
    )
