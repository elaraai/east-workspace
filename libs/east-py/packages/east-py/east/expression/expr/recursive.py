#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``RecursiveExpression`` — TS ``RecursiveExpr`` (``libs/east/src/expr/recursive.ts``)."""

from __future__ import annotations

from typing import Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression
from east.expression.location import location_id as _loc_id
from east.ir.builders import ir_unwrap_recursive


class RecursiveExpression(Expression):
    """A value of a recursive type: :meth:`unwrap` is its one level of
    unrolling (the ``UnwrapRecursive`` node); ``East.wrap_recursive`` is the
    inverse (TS ``RecursiveExpr.wrap``)."""

    __slots__ = ()
    _kind = "Recursive"

    def unwrap(self, tag: Any = None) -> Expression:
        """The value as its inner (unrolled) type — TS ``RecursiveExpr.unwrap``."""
        from east.expression.lift import _unroll

        if tag is not None:
            raise ExpressionError(
                ".unwrap() on a recursive-typed expression takes no case name")
        inner_t = _unroll(self.east_type)
        return self._expr(ir_unwrap_recursive(inner_t, self.ir, _loc_id()), inner_t)
