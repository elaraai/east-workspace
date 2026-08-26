#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The eager-path trace cache and datetime lifting (issue #422).

Eager methods take a FRESH lambda object per call, so a per-group aggregate
loop — ``group_to_arrays(key).to_array(lambda k, es: {…aggregates…})`` —
used to re-trace an identical lambda once per group: 1,686 groups × ~15
inner eager calls measured 145 s of pure re-tracing, silently, from code
that reads as the idiomatic East spelling. ``try_push_down`` (and the
type-derivation twin ``_trace_out_type``) now memoise on the callback's
code object + captured bindings + declared signature.

The cache must never trade correctness for the speedup, so the tests here
pin the MISS cases as hard as the hits: a capture with a different value, a
mutated global, a different declared signature — each must trace afresh.

Also #422 item 3: python ``datetime`` values lift as DateTime literals, so
``Option<DateTime>.unwrap_or(datetime(...))`` and captured datetime
constants trace like every other scalar.
"""

import importlib
import sys
from datetime import UTC, datetime

import pytest

from east import (
    BooleanType,
    DateTimeType,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    array,
    if_else,
    kernel,
    none,
    some,
)
from east.types.values.structural import EastFunction

# `from east import kernel` shadows the module — resolve it for internals.
_K = importlib.import_module("east.expression")

Row = StructType([("g", StringType), ("v", FloatType), ("n", IntegerType)])
ROWS = [{"g": f"g{i % 3}", "v": float(i) * 1.5, "n": i} for i in range(30)]


def _rows():
    return array(Row, ROWS)


def _fresh_projection():
    """A fresh lambda OBJECT per call over one code object — the shape every
    per-group loop produces."""
    return lambda r: r["v"] * 2.0


# ── cache hits ───────────────────────────────────────────────────────────────

def test_fresh_identical_lambdas_reuse_the_compiled_kernel():
    f1 = EastFunction(_fresh_projection(), [Row], FloatType)
    f2 = EastFunction(_fresh_projection(), [Row], FloatType)
    assert f1.fn is not f2.fn                      # genuinely fresh objects
    k1 = _K.try_push_down(f1)
    k2 = _K.try_push_down(f2)
    assert k1 is not None
    assert k1 is k2                                 # the cache hit, by identity


def test_a_per_group_aggregate_loop_traces_each_lambda_once(monkeypatch):
    """The issue's exact shape, observed at the trace call itself."""
    rows = _rows()
    calls = 0
    original = _K.trace

    def counting(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    def census(a):
        return a.group_to_arrays(lambda r: r["g"]).to_array(
            lambda k, es: {
                "k": k,
                "total": es.sum(lambda r: r["v"]),
                "top": es.maximum(lambda r: r["n"]),
            })

    want = census(rows)                             # warm the cache un-counted
    monkeypatch.setattr(_K, "trace", counting)
    got = census(rows)
    assert calls == 0, f"{calls} re-trace(s) after an identical warm call"
    assert [dict(r.items()) for r in got] == [dict(r.items()) for r in want]


def test_the_out_type_derivation_is_cached_too(monkeypatch):
    from east.types.values.collections import _kernel_out_type

    t1 = _kernel_out_type(_fresh_projection(), [Row])
    calls = 0
    original = _K.trace

    def counting(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(_K, "trace", counting)
    t2 = _kernel_out_type(_fresh_projection(), [Row])
    assert calls == 0
    assert t1 == t2 == FloatType


# ── cache misses: every binding that bakes into the trace is in the key ─────

def test_different_closure_values_do_not_share_a_kernel():
    def mk(threshold):
        return lambda r: r["v"] > threshold

    rows = _rows()
    low = rows.filter(mk(3.0))
    high = rows.filter(mk(30.0))
    assert len(low) > len(high)                    # a false hit would equate them
    k_low = _K.try_push_down(EastFunction(mk(3.0), [Row], BooleanType))
    k_high = _K.try_push_down(EastFunction(mk(30.0), [Row], BooleanType))
    assert k_low is not k_high


THRESHOLD = 5.0


def test_a_mutated_global_is_a_cache_miss(monkeypatch):
    """A global scalar bakes into the trace like a closure scalar does, so
    its VALUE is part of the key — rebinding it must not hit the old bake."""
    fn = lambda r: r["v"] > THRESHOLD  # noqa: E731
    rows = _rows()
    before = rows.filter(fn)
    monkeypatch.setattr(sys.modules[__name__], "THRESHOLD", 40.0)
    after = rows.filter(fn)
    assert len(before) > len(after)


def test_different_declared_signatures_do_not_collide():
    fn = _fresh_projection()
    k_float = _K.try_push_down(EastFunction(fn, [Row], FloatType))
    # declared String output: the trace disagrees, so the capture RAISES
    # (#625) — and must not evict or answer for the Float-declared entry
    with pytest.raises(_K.ExpressionError, match="produced Float"):
        _K.try_push_down(EastFunction(fn, [Row], StringType))
    assert _K.try_push_down(EastFunction(_fresh_projection(), [Row], FloatType)) is k_float


def test_a_default_bound_mutable_accumulator_is_uncacheable():
    """Parameter DEFAULTS are bindings too. The beast2 segment folds bind
    their RUNNING accumulator as a default (`lambda gk, _acc=result: …`),
    counting on a fresh trace per segment to snapshot the current state — a
    default the key cannot soundly hold must force a miss, or segment 2
    folds into segment 1's stale snapshot."""
    from east import EastDict

    acc = EastDict(StringType, IntegerType, {"a": 1})

    def mk():
        return lambda gk, _acc=acc: _acc.get_or_default(gk, 0)

    first = _K.try_push_down(EastFunction(mk(), [StringType], IntegerType))
    acc["a"] = 100
    second = _K.try_push_down(EastFunction(mk(), [StringType], IntegerType))
    assert first is not None and second is not None
    assert first("a") == 1                          # the first snapshot
    assert second("a") == 100                       # re-traced, sees the mutation


def test_an_impure_lambda_is_refused():
    log: list = []

    def impure(r):
        log.append(1)
        return r["v"] * 2.0

    with pytest.raises(_K.ExpressionError, match="captured automatically"):
        _rows().map(impure, out=FloatType)
    assert log == []                               # refused before any element


# ── #422 item 3: datetime literals lift ──────────────────────────────────────

_EPOCH = datetime(2020, 1, 1, tzinfo=UTC)


def test_option_datetime_unwrap_or_lifts_its_default():
    D = StructType([("at", OptionType(DateTimeType))])
    k = kernel(D, lambda r: r["at"].unwrap_or(datetime(2020, 1, 1, tzinfo=UTC)))
    t = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
    assert k({"at": some(t)}) == t
    assert k({"at": none}) == _EPOCH


def test_datetime_literals_lift_in_where_branches_and_captures():
    D = StructType([("at", DateTimeType)])
    cutoff = datetime(2023, 1, 1, tzinfo=UTC)
    k = kernel(D, lambda r: if_else(r["at"] > cutoff, r["at"], cutoff))
    late = datetime(2024, 1, 1, tzinfo=UTC)
    assert k({"at": late}) == late
    assert k({"at": _EPOCH}) == cutoff


def test_a_captured_datetime_passes_the_purity_gate():
    """The auto-trace path: a datetime capture is an immutable scalar, so an
    eager callback using one pushes down instead of trampolining."""
    from east.runtime.compiler import eager_stats

    D = StructType([("at", DateTimeType), ("v", FloatType)])
    cutoff = datetime(2023, 1, 1, tzinfo=UTC)
    rows = array(D, [{"at": _EPOCH, "v": 1.0},
                     {"at": datetime(2024, 2, 2, tzinfo=UTC), "v": 2.0}])
    before = eager_stats()["trampoline_calls"]
    got = rows.filter(lambda r: r["at"] > cutoff)
    assert eager_stats()["trampoline_calls"] == before
    assert [r["v"] for r in got] == [2.0]
