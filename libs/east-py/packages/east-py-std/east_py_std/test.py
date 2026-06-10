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

from east.runtime.platform import (
    PlatformFunction,
    platform_function,
    platform_functions,
)
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


@platform_function(name="testPass", inputs=[], output=NullType)
def test_pass_impl() -> None:
    """Signal that a test assertion passed (no-op at runtime).

    Returns:
        ``Null`` (``None``).
    """


@platform_function(name="testFail", inputs=[StringType], output=NullType)
def test_fail_impl(message: str) -> None:
    """Signal that a test assertion failed by raising an AssertionError.

    Args:
        message: ``String`` (``str``) - failure description surfaced in the
            test output.

    Returns:
        ``Null`` (``None``) - never reached; always raises.

    Raises:
        AssertionError: unconditionally, carrying ``message``.
    """
    raise AssertionError(message)


def test_impl_fn(name: str, body: Any) -> None:
    """Run a single named test case, tracking pass/fail and logging elapsed time.

    Invokes ``body()`` and catches any exception as a failure. Increments the
    module-level ``passed`` or ``failed`` counter and writes a ``[+]``/``[x]``
    line to ``_out``.

    Args:
        name: display name for the test case.
        body: zero-argument callable; called when not ``None``.
    """
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
        mark = "[+]" if ok else "[x]"
        _out.write(f"{indent}{mark} {name} ({dur:.6f}ms)\n")
    if ok:
        passed += 1
    else:
        failed += 1


def describe_impl(name: str, body: Any) -> None:
    """Define a named test suite, logging a header and summary with elapsed time.

    Increments the nesting depth while ``body`` runs so that nested test cases
    are indented. Writes a ``[>]`` header at depth 1 and a ``[+]``/``[x]``
    summary line when returning to depth 0.

    Args:
        name: display name for the test suite.
        body: zero-argument callable; called when not ``None``.
    """
    global _depth, failed
    t0 = time.perf_counter()
    failed_before = failed
    _depth += 1
    if _out and _depth == 1:
        _out.write(f"[>] {name}\n")
    try:
        if callable(body):
            body()
    except Exception:
        pass
    finally:
        _depth -= 1
        if _out and _depth == 0:
            dur = (time.perf_counter() - t0) * 1000
            mark = "[+]" if failed == failed_before else "[x]"
            _out.write(f"{mark} {name} ({dur:.6f}ms)\n")


# `test` and `describe` declare type="async" while their impls are plain
# `def`, so the decorator's sync/async inference would flip them — they stay
# raw PlatformFunction to preserve the declared async behavior.
test_impl = [
    *platform_functions(__name__),
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


__all__ = [
    "test_impl",
    "test_pass_impl",
    "test_fail_impl",
    "test_impl_fn",
    "describe_impl",
    "passed",
    "failed",
    "reset_counters",
]
