#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``NeverExpression`` — TS ``NeverExpr`` (``libs/east/src/expr/never.ts``)."""

from __future__ import annotations

from east.expression.expr.base import Expression


class NeverExpression(Expression):
    """A diverging expression — an ``East.error``, a jump. It produces no
    value, so it has no operations; an ``if_else`` arm of any type absorbs
    it."""

    __slots__ = ()
    _kind = "Never"
