#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Traced kernels call East function values (issue #561).

A traced lambda that references an already-compiled East function value — a
``kernel(...).bind(...)`` result, a ``compile_from_value`` function, a
runner-supplied FunctionType input — lowers the call to the IR ``Call`` node
instead of attempting to re-trace the callee: the callee rides as a hidden
trailing parameter, bound by reference after compilation, so the loop, the
kernel and the callee all execute inside east-c. ``FunctionType`` kernel
PARAMETERS are callable (and bindable) the same way. Genuinely-python
wrappers raise the strict-capture error up front (#625); the named
``NonRetraceableCallError`` cause survives for the shapes lowering declines.
"""

import pytest

from east import (
    DictType,
    EastArray,
    EastDict,
    FloatType,
    FunctionType,
    IntegerType,
    StringType,
    StructType,
    kernel,
)
from east.expression import ExpressionError
from east.runtime.compiler import compile_from_value, eager_stats
from east.runtime.errors import NonRetraceableCallError

ROW = StructType([("k", StringType), ("v", FloatType)])
TABLE_T = DictType(StringType, FloatType)


def _rows():
    return EastArray(ROW, [{"k": "a", "v": 1.0}, {"k": "b", "v": 2.0},
                           {"k": "MISS", "v": 3.0}])


def _sink():
    """A bound compiled callable — the shape of the e3 runner's ``emit``."""
    k = kernel([StringType, FloatType, FloatType], lambda key, v, base: v + base)
    return k.bind(10.0)


class TestCallLowering:
    def test_explicit_kernel_over_a_bind_result_compiles_and_matches_eager(self):
        sink = _sink()
        k = kernel([ROW], lambda r: sink(r["k"], r["v"]))
        assert [k(r) for r in _rows()] == [11.0, 12.0, 13.0]
        assert list(_rows().map(k)) == [11.0, 12.0, 13.0]

    def test_a_compile_from_value_function_is_callable_in_a_trace(self):
        from east.ir.builders import ir_builtin, ir_function, ir_value, ir_variable

        x = ir_variable(IntegerType, "x")
        body = ir_builtin(IntegerType, "IntegerAdd", [],
                          [ir_variable(IntegerType, "x"), ir_value(IntegerType, 1)])
        add1 = compile_from_value(
            ir_function(FunctionType([IntegerType], IntegerType), [], [x], body))
        assert add1(41) == 42
        k = kernel([IntegerType], lambda n: add1(n) * 2)
        assert k(20) == 42

    def test_push_down_runs_the_whole_loop_native(self):
        # The production shape: an eligible lambda calling a bound native
        # function pushes down whole — zero per-element trampolines.
        sink = _sink()
        rows = _rows()
        before = eager_stats()["trampoline_calls"]
        out = rows.map(lambda e: sink(e["k"], e["v"]) * 2.0)
        assert list(out) == [22.0, 24.0, 26.0]
        assert eager_stats()["trampoline_calls"] == before

    def test_one_callee_called_at_many_sites_binds_once(self):
        sink = _sink()
        k = kernel([ROW], lambda r: sink(r["k"], r["v"]) + sink(r["k"], 0.0))
        assert k({"k": "x", "v": 2.0}) == 12.0 + 10.0

    def test_a_bound_side_table_lookup_observes_later_mutations(self):
        # bind is BY REFERENCE (#399): the lowered Call goes through the same
        # bound function value, so the live semantics carry through the
        # nested kernel too.
        table = EastDict(StringType, FloatType, {"a": 21.0})
        lookup = kernel([StringType, TABLE_T],
                        lambda key, d: d.get_or_default(key, 0.0)).bind(table)
        outer = kernel([ROW], lambda r: lookup(r["k"]))
        assert list(_rows().map(outer)) == [21.0, 0.0, 0.0]
        table["a"] = 5.0
        table["b"] = 7.0
        assert list(_rows().map(outer)) == [5.0, 7.0, 0.0]

    def test_dict_to_array_with_a_bound_kernel_runs_native(self):
        # The #558 C repro, upgraded: the (key, value) argument-order shim
        # traces, the call on the bound kernel lowers, and the whole
        # conveniences path compiles — no ExpressionError, no trampoline.
        D = DictType(StringType, FloatType)
        d = EastDict(StringType, FloatType, {"a": 1.0, "b": 2.0})
        side = EastDict(StringType, FloatType, {"a": 10.0})
        out_t = StructType([("k", StringType), ("v", FloatType)])
        entry = kernel(
            [StringType, FloatType, D],
            lambda key, val, s: {"k": key, "v": val + s.get_or_default(key, 0.0)})
        before = eager_stats()["trampoline_calls"]
        rows = d.to_array(entry.bind(side))
        assert [(r["k"], r["v"]) for r in rows] == [("a", 11.0), ("b", 2.0)]
        assert eager_stats()["trampoline_calls"] == before
        assert rows.element_type == out_t


class TestFunctionTypeParameters:
    FT = FunctionType([FloatType], FloatType)

    def test_a_function_typed_parameter_is_callable(self):
        k = kernel([FloatType, self.FT], lambda x, f: f(x) + 1.0)
        double = kernel([FloatType], lambda v: v * 2.0)
        assert k(3.0, double) == 7.0

    def test_a_function_typed_parameter_binds_a_function_value(self):
        k = kernel([FloatType, self.FT], lambda x, f: f(x) + 1.0)
        double = kernel([FloatType], lambda v: v * 2.0)
        bound = k.bind(double)
        assert bound(3.0) == 7.0
        assert list(EastArray(FloatType, [1.0, 2.0]).map(bound)) == [3.0, 5.0]

    def test_a_wrong_signature_function_is_refused_by_bind(self):
        k = kernel([FloatType, self.FT], lambda x, f: f(x) + 1.0)
        stringy = kernel([StringType], lambda s: s)
        with pytest.raises(TypeError, match="expects"):
            k.bind(stringy)

    def test_calling_a_non_function_expression_raises(self):
        with pytest.raises(ExpressionError, match="non-function"):
            kernel([FloatType], lambda x: x(1.0))

    def test_arity_mismatch_on_a_parameter_call_raises(self):
        with pytest.raises(ExpressionError, match="argument"):
            kernel([FloatType, self.FT], lambda x, f: f(x, x))


class TestAsyncCallee:
    def test_calling_an_async_function_value_names_the_problem(self):
        from east.ir.builders import ir_async_function, ir_builtin, ir_value, ir_variable

        x = ir_variable(IntegerType, "x")
        body = ir_builtin(IntegerType, "IntegerAdd", [],
                          [ir_variable(IntegerType, "x"), ir_value(IntegerType, 1)])
        from east.types.types import AsyncFunctionType

        af = compile_from_value(
            ir_async_function(AsyncFunctionType([IntegerType], IntegerType), [], [x], body),
            is_async=True)
        with pytest.raises(ExpressionError, match="sync traced kernel"):
            kernel([IntegerType], lambda n: af(n))


class TestStrictCapture:
    def test_a_genuinely_python_wrapper_is_refused(self):
        # An impure lambda (mutating a closure list) has no East capture:
        # since #625 it raises before any row runs, and the explicit python
        # loop is the boundary for python semantics.
        sink = _sink()
        seen: list[float] = []
        with pytest.raises(ExpressionError, match="captured automatically"):
            _rows().for_each(lambda e: seen.append(sink(e["k"], e["v"])))
        assert seen == []
        for e in _rows():
            seen.append(sink(e["k"], e["v"]))
        assert seen == [11.0, 12.0, 13.0]

    def test_an_arity_mismatched_call_declines_and_raises_the_named_cause(self):
        # Lowering declines shapes it cannot type — the pre-#561 contract
        # (and the #558 C cause chain) survives for exactly those.
        sink = _sink()
        try:
            kernel([StringType], lambda s: sink(s))
        except ExpressionError as e:
            cause, found = e.__cause__, False
            for _ in range(4):
                if cause is None:
                    break
                if isinstance(cause, NonRetraceableCallError):
                    found = True
                    break
                cause = cause.__cause__
            assert found, "NonRetraceableCallError missing from the cause chain"
        else:
            raise AssertionError("expected ExpressionError")
