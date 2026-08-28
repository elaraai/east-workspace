#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``NullExpression`` — TS ``NullExpr`` (``libs/east/src/expr/null.ts``)."""

from __future__ import annotations

from east.expression.expr.base import Expression


class NullExpression(Expression):
    """A Null-typed expression: the ``east_null`` value. No operations
    beyond the comparisons every kind has."""

    __slots__ = ()
    _kind = "Null"
