#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""What a build costs (#1459) — pinned as counts and garbage, never a clock.

- A function another build analyzed, spliced into a body, is analyzed at its
  boundary only: the caller's analysis does not walk the callee's body, so it
  costs the same whatever the callee's size.
- ``analyze_ir`` trusts only a closed function it was told was analyzed.
- The passes over a build's tree leave no garbage that grows with the tree:
  each keeps a memo of every node it saw, which its recursive closure — a
  cycle — would hold until the cyclic collector's next pass.
"""

from __future__ import annotations

import gc
import sys

import pytest

from east import East, IntegerType
from east.expression.finalize import _arrayify_tree, _rehome_ir, _rename_apart
from east.expression.function import _platform_deps
from east.ir import analyze
from east.ir.analyze import IRAnalysisError, analyze_ir
from east.ir.builders import ir_function, ir_variable
from east.types.types import FunctionType


def _callee(size: int):
    """An East function whose body grows with ``size``: a chain of additions."""
    def body(b, x):
        total = x
        for i in range(size):
            total = total + i
        return total
    return East.function([IntegerType], IntegerType, body)


def _visits_building_a_caller_of(callee, monkeypatch) -> int:
    """How many nodes the analysis visits building a function that calls ``callee``."""
    visits = 0
    real = analyze._Analyzer.visit

    def counting(self, node, scope, ret):
        nonlocal visits
        visits += 1
        return real(self, node, scope, ret)

    with monkeypatch.context() as m:
        m.setattr(analyze._Analyzer, "visit", counting)
        East.function([IntegerType], IntegerType, lambda b, x: callee(x) + 1)
    return visits


def test_a_spliced_function_is_analyzed_at_its_boundary_only(monkeypatch):
    small, large = _callee(2), _callee(200)
    assert _visits_building_a_caller_of(small, monkeypatch) == _visits_building_a_caller_of(large, monkeypatch)


def test_the_analysis_trusts_only_a_closed_function_it_was_told_was_analyzed():
    fn_t = FunctionType([IntegerType], IntegerType)
    # its body reads `y`, which nothing binds
    unbound = ir_function(fn_t, [], [ir_variable(IntegerType, "x")], ir_variable(IntegerType, "y"))
    with pytest.raises(IRAnalysisError, match="Variable y not in scope"):
        analyze_ir(unbound)
    analyze_ir(unbound, trusted={id(unbound): unbound})
    # a function that captures is checked against its context, trusted or not
    capturing = ir_function(fn_t, [ir_variable(IntegerType, "z")], [ir_variable(IntegerType, "x")],
                            ir_variable(IntegerType, "x"))
    with pytest.raises(IRAnalysisError, match="Captured variable z not in scope"):
        analyze_ir(capturing, trusted={id(capturing): capturing})


def _cyclic_garbage(pass_, *args) -> int:
    """How many objects the cyclic collector finds unreachable after ``pass_(*args)``."""
    gc.collect()
    was = gc.isenabled()
    gc.disable()
    try:
        pass_(*args)
        return gc.collect()
    finally:
        if was:
            gc.enable()


@pytest.mark.skipif(sys.implementation.name != "cpython", reason="the cyclic collector is CPython's")
def test_the_passes_over_a_tree_leave_no_garbage_that_grows_with_it():
    small, large = _callee(2)._east_ir, _callee(200)._east_ir
    lazy_small, lazy_large = _rehome_ir(small, None, None), _rehome_ir(large, None, None)
    for pass_, on_small, on_large in (
        (_rehome_ir, (small, None, None), (large, None, None)),
        (_arrayify_tree, (lazy_small,), (lazy_large,)),
        (_rename_apart, (lazy_small,), (lazy_large,)),
        (_platform_deps, (small,), (large,)),
    ):
        assert _cyclic_garbage(pass_, *on_small) == _cyclic_garbage(pass_, *on_large), pass_.__name__
