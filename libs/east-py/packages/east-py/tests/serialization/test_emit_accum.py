#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The native emit accumulator (issue #560, phase 2).

``_EmitAccumCore`` is the per-row half of the streamTask emit sink: an east-c
foreign function value whose invoke does the compare + append in C, calling
back into python only at batch boundaries. The runner's ``_EmitSink`` owns
every policy decision; these tests pin the core's own contract — zero python
per row from a compiled loop, C-side duplicate detection with the sink's
exact message, the mode flip on the first out-of-order key, and boundary
callback cadence."""

import pytest
from east.serialization._beast2_eastc import _EmitAccumCore

from east import (
    East,
    EastArray,
    FloatType,
    FunctionType,
    NullType,
    StringType,
    StructType,
)
from east.runtime.errors import EastError

ROW = StructType([("k", StringType), ("v", FloatType)])


def _dict_core(limit=1000, run_cap=100_000, hooks=None):
    hooks = hooks if hooks is not None else []
    return _EmitAccumCore(
        2, [StringType, FloatType], limit, run_cap,
        lambda: hooks.append("flush"),
        lambda: hooks.append("demote"),
        lambda: hooks.append("spill"))


class TestNativeRows:
    def test_a_compiled_loop_emits_with_zero_python_per_row(self):
        hooks: list = []
        core = _EmitAccumCore(2, [StringType, FloatType], 10_000, 100_000,
                              lambda: hooks.append("flush"),
                              lambda: hooks.append("demote"),
                              lambda: hooks.append("spill"))
        emit_hold = core.function_value([StringType, FloatType])
        emit_t = FunctionType([StringType, FloatType], NullType)
        # The streaming-projection shape: the emit callee is a hidden bound
        # parameter (#561 lowers the call), so loop + function + sink run
        # entirely inside east-c.
        project = East.function([ROW, emit_t], NullType,
                         lambda _b, r, emit: emit(r["k"], r["v"])).bind(emit_hold)
        rows = EastArray(ROW, [{"k": f"k{i:04d}", "v": float(i)}
                               for i in range(500)])
        rows.map(project)
        assert core.emitted == 500
        assert hooks == []  # under the limit: no boundary crossed
        keys, values = core.take_batch()
        assert len(keys) == len(values) == 500
        assert keys[0] == "k0000" and values[499] == 499.0

    def test_flush_callback_fires_per_limit_not_per_row(self):
        # The boundary callback drains (as the sink's _flush does) — the
        # cadence is then one crossing per LIMIT rows, never per row.
        flushes: list = []
        box: dict = {}

        def flush():
            flushes.append(len(box["core"].take_batch()[0]))

        core = _EmitAccumCore(2, [StringType, FloatType], 100, 100_000,
                              flush, lambda: None, lambda: None)
        box["core"] = core
        for i in range(350):
            core.emit(f"k{i:04d}", float(i))
        assert flushes == [100, 100, 100]
        assert core.pending() == 50

    def test_duplicate_adjacent_key_raises_the_sink_message_from_c(self):
        core = _dict_core()
        core.emit("a", 1.0)
        with pytest.raises(EastError,
                           match='duplicate Dict key emitted: "a" — Dict keys'):
            core.emit("a", 2.0)

    def test_out_of_order_key_demotes_once_then_buffers(self):
        hooks: list = []
        core = _dict_core(hooks=hooks)
        core.emit("m", 1.0)
        core.emit("z", 2.0)
        assert core.mode == 0
        core.emit("a", 3.0)  # out of order: demote, then buffered append
        assert hooks == ["demote"]
        assert core.mode == 1
        core.emit("z", 9.9)  # buffered mode accepts anything (merge dedups)
        assert core.emitted == 4

    def test_set_core_detects_duplicates_too(self):
        hooks: list = []
        core = _EmitAccumCore(1, [FloatType], 1000, 100_000,
                              lambda: hooks.append("flush"),
                              lambda: hooks.append("demote"),
                              lambda: hooks.append("spill"))
        core.emit(1.0)
        core.emit(2.0)
        with pytest.raises(EastError, match="duplicate Set element emitted: 2"):
            core.emit(2.0)

    def test_array_core_keeps_arrival_order_unconditionally(self):
        core = _EmitAccumCore(0, [FloatType], 1000, 100_000,
                              lambda: None, lambda: None, lambda: None)
        for v in (3.0, 1.0, 2.0, 1.0):
            core.emit(v)
        (elems,) = core.take_batch()
        assert list(elems) == [3.0, 1.0, 2.0, 1.0]
        assert elems.element_type == FloatType
        assert isinstance(elems, EastArray)
