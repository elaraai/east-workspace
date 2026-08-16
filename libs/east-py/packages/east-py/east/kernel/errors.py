#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The kernel tracer's failure mode.

One exception type for every untraceable operation, plus the shared message
for python syntax that cannot be overloaded (``if``/``and``/``or``, iteration,
``len()``) and therefore has an East spelling instead.
"""

from __future__ import annotations


class KernelTraceError(TypeError):
    """The lambda performed an operation that cannot be traced into East IR."""


def _trace_bail(op: str) -> KernelTraceError:
    return KernelTraceError(
        f"python `{op}` cannot be traced into an East kernel — use `&`, `|`, `~` for "
        "boolean logic and `East.if_else(cond, a, b)` for conditionals, or let the "
        "method "
        "fall back to the per-element python path"
    )
