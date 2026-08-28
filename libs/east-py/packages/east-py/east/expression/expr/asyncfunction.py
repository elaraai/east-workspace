#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``AsyncFunctionExpression`` — TS ``AsyncFunctionExpr`` (``libs/east/src/expr/asyncfunction.ts``)."""

from __future__ import annotations

from east.expression.errors import ExpressionError
from east.expression.expr.function import FunctionExpression


class AsyncFunctionExpression(FunctionExpression):
    """An AsyncFunction-typed expression: callable only inside an
    ``East.asyncFunction`` body (the ``CallAsync`` node)."""

    __slots__ = ()
    _kind = "AsyncFunction"

    def _check_callable(self) -> None:
        from east.expression.function import _in_async_build

        if not _in_async_build():
            raise ExpressionError(
                "an AsyncFunction value cannot be called inside a sync traced "
                "kernel — call it from an East.asyncFunction body (a CallAsync) "
                "or from python (per-element) instead"
            )
