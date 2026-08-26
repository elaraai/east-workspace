#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Issue #592 — the native emit sink is a CALL WRAPPER, not a value holder.

``_EmitAccumCore.function_value()`` used to return a bare hold: it carried
``_east_c_handle`` so the bridge could pass it *as a value* (all the runner
needs — there the compiled program invokes ``emit`` C-side and python never
calls it), but it had no ``__call__``. A harness that invokes a
``@platform_function`` DIRECTLY from python gets the sink handed to the body
as-is, so a PURE emit callback traced, called the hold, and died with
``'_EmitFnHold' object is not callable`` — with no fallback, because a
pure-looking callback that cannot trace raises rather than degrading.

It is now built by the same bridge conversion that produces the wrapper a
platform function receives when east-c decodes the value for it, so both
routes hand python the identical shape: callable, tagged ``_east_c_handle``,
and lowering a proxy-argument call to an IR ``Call`` (#561). These tests pin
that a python-driven body pushes down with ZERO python per row, that the
eager and value paths are unchanged, and that the shapes lowering declines
still degrade to the per-element path instead of failing the trace (#558 C).
"""

import pytest
from east._eastc_bridge import c_function_value_type
from east.serialization._beast2_eastc import _EmitAccumCore

from east import (
    DictType,
    EastArray,
    EastDict,
    FloatType,
    FunctionType,
    NullType,
    StringType,
    StructType,
    is_value_of,
    kernel,
    platform_function,
)
from east.runtime.compiler import eager_stats
from east.runtime.errors import EastError

ROW = StructType([("k", StringType), ("v", FloatType)])
EMIT_T = FunctionType([StringType, FloatType], NullType)


def _sink(kind="dict", emit_types=(StringType, FloatType)):
    """A live accumulator with inert boundary callbacks — the batch limits are
    far above every case here, so nothing crosses one."""
    return _EmitAccumCore({"array": 0, "set": 1, "dict": 2}[kind],
                          list(emit_types), 1 << 20, 1 << 20,
                          lambda: None, lambda: None, lambda: None)


def _rows():
    return EastArray(ROW, [{"k": "a", "v": 1.0}, {"k": "b", "v": 2.0},
                           {"k": "c", "v": 3.0}])


# ── the shape: what every other compiled East function value is ─────────────


class TestTheSinkIsACallWrapper:
    def test_the_function_value_is_callable(self):
        # The bug in one assertion.
        core = _sink()
        assert callable(core.function_value([StringType, FloatType]))

    def test_it_still_carries_the_conversion_fast_path_handle(self):
        # `_east_c_handle` is what lets the purity gate reference it and what
        # `_py_function_to_c` passes straight through — the value path (the
        # runner's own) must be untouched by the wrapper change.
        emit = _sink().function_value([StringType, FloatType])
        assert getattr(emit, "_east_c_handle", None) is not None

    def test_the_declared_signature_still_answers(self):
        # Signature introspection gates `bind` and `is_value_of` on function
        # values, whose contents cannot be inspected any other way.
        emit = _sink().function_value([StringType, FloatType])
        assert c_function_value_type(emit._east_c_handle) == EMIT_T
        assert is_value_of(emit, EMIT_T)


# ── the regression: a python-driven body pushes the sink down ───────────────


class TestPythonDrivenBodyPushesDown:
    def test_a_pure_emit_callback_runs_with_zero_python_per_row(self):
        # THE issue: the harness shape — a @platform_function invoked directly
        # from python, handed the sink as its emit capability. The callback is
        # pure, so it traces; the emit call lowers to a native IR Call and the
        # sink rides as a hidden bound parameter, so no python runs per row.
        core = _sink()

        @platform_function(inputs=[DictType(StringType, FloatType), EMIT_T],
                           output=NullType, name="issue592.double_all")
        def double_all(rows, emit):
            rows.for_each(lambda k, v: emit(k, v * 2.0))

        rows = EastDict(StringType, FloatType,
                        {f"k{i}": float(i) for i in range(5)})
        before = eager_stats()["trampoline_calls"]
        double_all(rows, core.function_value([StringType, FloatType]))
        moved = eager_stats()["trampoline_calls"] - before

        assert moved == 0, f"{moved} per-element python trampoline call(s)"
        keys, values = core.take_batch()
        assert list(keys) == [f"k{i}" for i in range(5)]
        assert list(values) == [2.0 * i for i in range(5)]

    def test_a_plain_traced_callback_delivers_every_row(self):
        # The same push-down without the platform-function wrapper: the sink
        # is an ordinary closure capture of the traced lambda.
        core = _sink()
        emit = core.function_value([StringType, FloatType])
        _rows().for_each(lambda r: emit(r["k"], r["v"]))

        keys, values = core.take_batch()
        assert list(keys) == ["a", "b", "c"]
        assert list(values) == [1.0, 2.0, 3.0]

    def test_one_sink_called_at_two_sites_binds_once_and_delivers_both(self):
        # The registry dedupes the callee by its C function-value pointer, so
        # two traced loops over one sink bind one hidden parameter each and
        # both sets of rows land.
        core = _sink("array", (StringType,))
        emit = core.function_value([StringType])
        _rows().for_each(lambda r: emit(r["k"]))
        _rows().for_each(lambda r: emit(r["k"]))

        (elems,) = core.take_batch()
        assert list(elems) == ["a", "b", "c", "a", "b", "c"]

    def test_the_value_path_is_unchanged(self):
        # The runner's own topology: the wrapper is passed as a VALUE to a
        # compiled body's FunctionType parameter (never called from python).
        core = _sink()
        emit = core.function_value([StringType, FloatType])
        project = kernel([ROW, EMIT_T],
                         lambda r, e: e(r["k"], r["v"])).bind(emit)
        before = eager_stats()["trampoline_calls"]
        _rows().map(project)

        assert eager_stats()["trampoline_calls"] == before
        keys, _values = core.take_batch()
        assert list(keys) == ["a", "b", "c"]


# ── the python boundary: calling it on plain values ─────────────────────────


class TestPythonBoundaryCall:
    def test_calling_it_marshals_one_row_through_the_c_path(self):
        core = _sink()
        emit = core.function_value([StringType, FloatType])
        emit("a", 1.0)
        emit("b", 2.0)

        assert core.emitted == 2
        keys, values = core.take_batch()
        assert list(keys) == ["a", "b"] and list(values) == [1.0, 2.0]

    def test_it_is_the_same_acceptance_path_as_the_core_entry(self):
        # Same rows, same C accept — so the duplicate-key refusal (and its
        # message) reaches a python caller through either door.
        core = _sink()
        emit = core.function_value([StringType, FloatType])
        emit("a", 1.0)
        with pytest.raises(EastError, match='duplicate Dict key emitted: "a"'):
            emit("a", 2.0)

    def test_it_keeps_the_accumulator_alive_on_its_own(self):
        # The wrapper is the only python reference left, and the accumulator
        # survives behind the C value's userdata retain — a runner or harness
        # may hand `function_value()` on and drop the core.
        import gc

        emit = _sink().function_value([StringType, FloatType])
        gc.collect()
        for i in range(1000):
            emit(f"k{i:04d}", float(i))  # a freed core would not answer here


# ── degradation: the shapes lowering declines keep the python path ──────────


class TestGracefulDegradation:
    def test_an_impure_callback_keeps_the_per_element_path(self):
        # A mutable python capture fails the purity gate, so the callback runs
        # per element — and every row still reaches the sink through the
        # wrapper's eager call.
        core = _sink()
        emit = core.function_value([StringType, FloatType])
        order: list[str] = []
        _rows().for_each(lambda r: (order.append(r["k"]), emit(r["k"], r["v"]))[1])

        assert order == ["a", "b", "c"]
        keys, _values = core.take_batch()
        assert list(keys) == ["a", "b", "c"]

    def test_an_arity_mismatched_call_declines_instead_of_failing_the_trace(self):
        # Lowering declines an arity mismatch, and push-down falls back rather
        # than raising (#558 C). The failure that surfaces is therefore the
        # sink's own runtime refusal from the per-element path — never a
        # ExpressionError about an untraceable lambda.
        core = _sink()
        emit = core.function_value([StringType, FloatType])
        with pytest.raises(EastError, match="emit: missing argument"):
            _rows().for_each(lambda r: emit(r["k"]))
