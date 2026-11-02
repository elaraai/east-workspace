#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""What a build costs (#1459) — pinned as counts and garbage, never a clock.

- A function another build analyzed, spliced into a body, is analyzed at its
  boundary only: the caller's analysis does not walk the callee's body, so it
  costs the same whatever the callee's size.
- A call of a built function copies nothing: the caller's tree holds a
  reference, the same whatever the callee's size, and an export finalizes
  each function it exports once and no function they call. The platform
  functions a built function calls, its callees' included, are read
  without expanding it.
- ``analyze_ir`` trusts only a closed function it was told was analyzed.
- The passes over a build's tree leave no garbage that grows with the tree:
  each keeps a memo of every node it saw, which its recursive closure — a
  cycle — would hold until the cyclic collector's next pass.
- While builds are deferred, as an export defers them, a function is built
  on its first use and compiled when it runs, and it writes the IR and the
  source map a build at its declaration writes.
"""

from __future__ import annotations

import contextlib
import gc
import importlib
import sys

import pytest

from east import East, IntegerType, NullType
from east.expression import finalize
from east.expression.finalize import (
    _arrayify_tree,
    _calls,
    _expand,
    _finalized,
    _node_children,
    _rehome_ir,
    _rename_apart,
    _stacks,
    _unnamed,
)
from east.expression.function import _platform_deps, deferred_builds
from east.expression.location import SourceMap
from east.ir import analyze
from east.ir.analyze import IRAnalysisError, analyze_ir
from east.ir.builders import ir_function, ir_variable
from east.runtime import compiler
from east.serialization.beast2 import encode_beast2_with_header_for
from east.types.type_of_type import IRType
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


def _caller_of(callee):
    return East.function([IntegerType], IntegerType, lambda b, x: callee(x) + 1)


def _tree_size(root) -> int:
    """The nodes of a skeleton, a reference counted as the node it is."""
    seen: dict[int, object] = {}
    stack = [root]
    while stack:
        node = stack.pop()
        if id(node) not in seen:
            seen[id(node)] = node
            stack.extend(_node_children(node))
    return len(seen)


def test_a_call_of_a_built_function_copies_nothing(monkeypatch):
    small, large = _callee(2), _callee(200)

    def refuse(*_args):
        raise AssertionError("a callee was copied at its call")

    with monkeypatch.context() as m:
        m.setattr(finalize, "_rehome_ir", refuse)
        m.setattr(finalize, "_rename_apart", refuse)
        callers = _caller_of(small), _caller_of(large)
    assert _tree_size(callers[0]._east_skeleton.root) == _tree_size(callers[1]._east_skeleton.root)


def test_an_export_finalizes_what_it_exports_once_and_nothing_it_calls(monkeypatch):
    with deferred_builds():
        inner = _callee(50)
        outer = East.function([IntegerType], IntegerType, lambda b, x: inner(x) * 2)
        calls = 0
        real = finalize._arrayify

        def counted(*args, **kwargs):
            nonlocal calls
            calls += 1
            return real(*args, **kwargs)

        with monkeypatch.context() as m:
            m.setattr(finalize, "_arrayify", counted)
            manifest = East.export_functions("p", "1", {"outer": outer})
        assert calls == _tree_size(manifest["functions"][0]["ir"])
        assert inner.resolve()._final is None and outer.resolve()._final is None


def test_the_platform_functions_a_built_function_calls_are_read_without_expanding_it(monkeypatch):
    shown = East.platform("t.cost_show", [IntegerType], NullType)
    function = importlib.import_module("east.expression.function")

    def refuse(*_args, **_kwargs):
        raise AssertionError("a function was expanded to read its platform functions")

    for defer in (False, True):
        with deferred_builds() if defer else contextlib.nullcontext():
            @East.function([IntegerType], NullType)
            def inner(b, x):
                b.do(shown(x))

            @East.function([IntegerType], NullType)
            def outer(b, x):
                b.do(inner(x + 1))

            with monkeypatch.context() as m:
                for name in ("_expand", "_expand_reference", "_arrayify_tree"):
                    m.setattr(finalize, name, refuse)
                m.setattr(function, "_finalized", refuse)
                names = [d["name"] for d in East.platform_dependencies(outer)]
            assert names == ["t.cost_show"], defer


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
    calling_small, calling_large = _caller_of(_callee(2))._east_skeleton, _caller_of(_callee(200))._east_skeleton
    for pass_, on_small, on_large in (
        (_rehome_ir, (small, None, None), (large, None, None)),
        (_arrayify_tree, (lazy_small,), (lazy_large,)),
        (_rename_apart, (lazy_small,), (lazy_large,)),
        (_platform_deps, (small,), (large,)),
        (_expand, (calling_small, SourceMap()), (calling_large, SourceMap())),
        (_finalized, (calling_small,), (calling_large,)),
        (_unnamed, (calling_small.root, calling_small.references),
         (calling_large.root, calling_large.references)),
        (_stacks, (calling_small.root, calling_small.references, calling_small.source_map),
         (calling_large.root, calling_large.references, calling_large.source_map)),
        (_calls, (calling_small.root,), (calling_large.root,)),
    ):
        assert _cyclic_garbage(pass_, *on_small) == _cyclic_garbage(pass_, *on_large), pass_.__name__


def _declare_pair():
    inc = East.function([IntegerType], IntegerType, lambda b, x: x + 1)
    twice = East.function([IntegerType], IntegerType, lambda b, x: inc(inc(x)))
    return inc, twice


def test_a_deferred_function_is_built_on_its_first_use_and_compiled_when_it_runs(monkeypatch):
    function = importlib.import_module("east.expression.function")
    builds, compiles = [], []
    build, compile_ = function._build_strict, compiler.compile_from_value

    def counted_build(*args, **kwargs):
        builds.append(args[2])
        return build(*args, **kwargs)

    def counted_compile(*args, **kwargs):
        compiles.append(args[0])
        return compile_(*args, **kwargs)

    monkeypatch.setattr(function, "_build_strict", counted_build)
    monkeypatch.setattr(compiler, "compile_from_value", counted_compile)
    with deferred_builds():
        _inc, twice = _declare_pair()
        assert builds == []
        assert twice._east_ir is not None  # its first use builds it, and the function it calls
        assert (len(builds), compiles) == (2, [])
        assert twice(1) == 3  # it runs, so it is compiled
        assert len(compiles) == 1


def test_a_function_built_on_its_first_use_writes_what_a_build_at_its_declaration_writes():
    encode = encode_beast2_with_header_for(IRType)
    _inc, eager = _declare_pair()
    with deferred_builds():
        _inc, deferred = _declare_pair()
        assert encode(deferred._east_ir) == encode(eager._east_ir)
        assert deferred._east_source_map.entries() == eager._east_source_map.entries()
