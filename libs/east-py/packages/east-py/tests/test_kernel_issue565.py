#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Issue #565 — ``for_each`` must not discard a traced callback's effect.

The eager ``for_each`` wrappers used to spell "call it, return null" as
``(fn(el), east_null)[1]``. On the per-element path that is correct; when the
callback is PURE, push-down traces the wrapper instead — ``fn(el)`` returns
the lowered Call EXPRESSION (#561, e.g. the streamTask runner's native emit,
#564) and the python tuple threw that expression away before it reached the
IR. The loop compiled to a null body: every emitting task "succeeded" with a
zero-row output, silently.

These tests drive the production topology end to end — a compiled IR wrapper
whose Platform call hands the python body a live ``_EmitAccumCore`` function
value, exactly what the streamTask runner passes — and assert the rows ARRIVE.
They also pin the Block path (a non-Null traced expression still executes) and
``ir_platform``'s ``optional`` field (hand-built Platform nodes must convert).
"""

from east.serialization._beast2_eastc import _EmitAccumCore

from east import (
    EastArray,
    EastDict,
    EastSet,
    FloatType,
    FunctionType,
    NullType,
    StringType,
    StructType,
    kernel,
)
from east.ir.builders import ir_function, ir_platform, ir_variable
from east.runtime.compiler import compile_from_value

ROW = StructType([("k", StringType), ("v", FloatType)])


def _rows():
    return EastArray(ROW, [{"k": "a", "v": 1.0}, {"k": "b", "v": 2.0},
                           {"k": "c", "v": 3.0}])


def _drive(name, kind, emit_types, body):
    """Run ``body(emit)`` through a compiled Platform wrapper with a live
    accumulator emit — the streamTask runner topology — and return the
    drained batch parts."""
    core = _EmitAccumCore({"array": 0, "set": 1, "dict": 2}[kind],
                          list(emit_types), 1 << 20, 1 << 20,
                          lambda: None, lambda: None, lambda: None)
    emit_t = FunctionType(list(emit_types), NullType)
    platform = [{
        "name": name, "inputs": [emit_t], "output": NullType,
        "type": "sync", "fn": body,
    }]
    wrapper = ir_function(
        FunctionType([emit_t], NullType), [], [ir_variable(emit_t, "emit")],
        ir_platform(NullType, name, [ir_variable(emit_t, "emit")]))
    compiled = compile_from_value(wrapper, platform)
    compiled(core.function_value(list(emit_types)))
    return core.take_batch()


# ── the regression: pure for_each callbacks deliver ─────────────────────────


class TestPureForEachDelivers:
    def test_array_for_each_delivers_every_row(self):
        def body(emit):
            _rows().for_each(lambda r: emit(r["k"]))

        (elems,) = _drive("issue565.array", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]

    def test_array_for_each_with_index_delivers(self):
        # the arity-2 wrapper branch
        def body(emit):
            _rows().for_each(lambda r, i: emit(r["k"]))

        (elems,) = _drive("issue565.array2", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]

    def test_dict_kind_emit_delivers_pairs(self):
        def body(emit):
            _rows().for_each(lambda r: emit(r["k"], r["v"]))

        keys, values = _drive("issue565.dict", "dict",
                              [StringType, FloatType], body)
        assert list(keys) == ["a", "b", "c"]
        assert list(values) == [1.0, 2.0, 3.0]

    def test_set_for_each_delivers(self):
        def body(emit):
            EastSet(StringType, ["x", "y"]).for_each(lambda e: emit(e))

        (elems,) = _drive("issue565.set", "array", [StringType], body)
        assert sorted(elems) == ["x", "y"]

    def test_dict_for_each_delivers(self):
        def body(emit):
            d = EastDict(StringType, FloatType, {"p": 1.0, "q": 2.0})
            d.for_each(lambda k, v: emit(k, v))

        keys, values = _drive("issue565.dfe", "dict",
                              [StringType, FloatType], body)
        assert list(keys) == ["p", "q"]
        assert list(values) == [1.0, 2.0]

    def test_for_each_matches_map_delivery(self):
        # map always delivered (its call IS the returned expression); the fix
        # makes for_each equivalent for effect.
        def via_map(emit):
            _rows().map(lambda r: emit(r["k"]))

        def via_for_each(emit):
            _rows().for_each(lambda r: emit(r["k"]))

        (m,) = _drive("issue565.viamap", "array", [StringType], via_map)
        (f,) = _drive("issue565.viafe", "array", [StringType], via_for_each)
        assert list(m) == list(f) == ["a", "b", "c"]


# ── the Block path: a non-Null traced expression still executes ─────────────


class TestNonNullCallback:
    def test_non_null_pure_body_compiles_and_runs(self):
        # The callback's traced expression is Float-typed; _sequence_effect
        # wraps it in Block([expr, null]) so the wrapper still types -> Null.
        add = kernel([FloatType, FloatType], lambda a, b: a + b).bind(1.0)
        _rows().for_each(lambda r: add(r["v"]))  # must not raise

    def test_non_null_body_before_an_emit_still_delivers_elsewhere(self):
        # A body mixing a discarded non-Null call and a Null emit call — the
        # emit is the returned expression via a wrapper lambda; delivery holds.
        add = kernel([FloatType, FloatType], lambda a, b: a + b).bind(1.0)

        def body(emit):
            _rows().for_each(lambda r: add(r["v"]))
            _rows().for_each(lambda r: emit(r["k"]))

        (elems,) = _drive("issue565.mixed", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]


# ── the eager path is unchanged ─────────────────────────────────────────────


class TestImpureCallbackKeepsPerElementPath:
    def test_python_side_effects_run_per_element(self):
        seen: list[str] = []
        _rows().for_each(lambda r: seen.append(r["k"]))
        assert seen == ["a", "b", "c"]

    def test_python_emit_wrapper_still_delivers(self):
        # the tests/drivers shape: a python wrapper over emit (impure via the
        # captured list) — per-element path, every row really lands.
        def body(emit):
            order: list[str] = []
            _rows().for_each(lambda r: (order.append(r["k"]), emit(r["k"]))[1])
            assert order == ["a", "b", "c"]

        (elems,) = _drive("issue565.pywrap", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]


# ── ir_platform carries the fields IRType declares ──────────────────────────


class TestIrPlatformBuilder:
    def test_hand_built_platform_node_compiles(self):
        # ir_platform omitted `optional`; conversion failed with
        # KeyError: 'optional' before the fix. _drive's wrapper already
        # exercises it — this pins the minimal case with a value result.
        platform = [{
            "name": "issue565.answer", "inputs": [], "output": FloatType,
            "type": "sync", "fn": lambda: 42.0,
        }]
        wrapper = ir_function(FunctionType([], FloatType), [], [],
                              ir_platform(FloatType, "issue565.answer", []))
        assert compile_from_value(wrapper, platform)() == 42.0
