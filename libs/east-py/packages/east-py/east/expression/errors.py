#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The expression builder's failure mode.

One exception type for every operation East cannot express, plus the shared
message for python syntax that cannot be overloaded (``if``/``and``/``or``,
iteration, ``len()``) and therefore has an East spelling instead.
"""

from __future__ import annotations


class ExpressionError(TypeError):
    """The body performed an operation that cannot be captured into East IR."""


#: Deprecated alias of :class:`ExpressionError` (renamed in #625; one release).
KernelTraceError = ExpressionError


def _trace_bail(op: str) -> ExpressionError:
    return ExpressionError(
        f"python `{op}` cannot be traced into an East kernel — use `&`, `|`, `~` for "
        "boolean logic and `East.if_else(cond, a, b)` for conditionals, or write "
        "an explicit python loop for genuine python semantics"
    )
