#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Test platform functions for East.

Provides test assertion and organization operations for East programs running in Python.
These functions mirror the test utilities in east-node for running East tests.

Tracks pass/fail counts and logs results with timing, matching the
compliance test harness in east-py.
"""

import sys
import time
from typing import Any

from east.runtime.platform import PlatformFunction
from east.types.types import FunctionType, NullType, StringType

# Module-level counters — accessed by the compliance test runner
passed = 0
failed = 0
_depth = 0
_out = sys.stderr


def reset_counters(out=None):
    """Reset pass/fail counters and optionally set output stream."""
    global passed, failed, _depth, _out
    passed = 0
    failed = 0
    _depth = 0
    if out is not None:
        _out = out


def test_pass_impl() -> None:
    """Signal that a test assertion passed."""


def test_fail_impl(message: str) -> None:
    """Signal that a test assertion failed with a message."""
    raise AssertionError(message)


def test_impl_fn(name: str, body: Any) -> None:
    """Run a single test case with pass/fail tracking and logging."""
    global passed, failed
    t0 = time.perf_counter()
    ok = True
    try:
        if callable(body):
            body()
    except Exception:
        ok = False
    dur = (time.perf_counter() - t0) * 1000
    if _out:
        indent = "  " * _depth
        mark = "\u2714" if ok else "\u2716"
        _out.write(f"{indent}{mark} {name} ({dur:.6f}ms)\n")
    if ok:
        passed += 1
    else:
        failed += 1


def describe_impl(name: str, body: Any) -> None:
    """Define a test suite/group with logging."""
    global _depth, failed
    t0 = time.perf_counter()
    failed_before = failed
    _depth += 1
    if _out and _depth == 1:
        _out.write(f"\u25b6 {name}\n")
    try:
        if callable(body):
            body()
    except Exception:
        pass
    finally:
        _depth -= 1
        if _out and _depth == 0:
            dur = (time.perf_counter() - t0) * 1000
            mark = "\u2714" if failed == failed_before else "\u2716"
            _out.write(f"{mark} {name} ({dur:.6f}ms)\n")


# Platform function implementations
test_impl = [
    PlatformFunction(
        name="testPass",
        inputs=[],
        output=NullType,
        type="sync",
        fn=test_pass_impl,
    ),
    PlatformFunction(
        name="testFail",
        inputs=[StringType],
        output=NullType,
        type="sync",
        fn=test_fail_impl,
    ),
    PlatformFunction(
        name="test",
        inputs=[StringType, FunctionType([], NullType)],
        output=NullType,
        type="async",
        fn=test_impl_fn,
    ),
    PlatformFunction(
        name="describe",
        inputs=[StringType, FunctionType([], NullType)],
        output=NullType,
        type="async",
        fn=describe_impl,
    ),
]


__all__ = ["test_impl", "passed", "failed", "reset_counters"]
