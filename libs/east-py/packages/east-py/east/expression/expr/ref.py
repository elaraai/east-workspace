#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``RefExpression`` — TS ``RefExpr`` (``libs/east/src/expr/ref.ts``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression, _deprecated_alias, _is_body
from east.expression.lift import _lift, _trace_inner_fn
from east.expression.nodes import _builtin
from east.types.types import NullType

if TYPE_CHECKING:
    from east.expression.expr.null import NullExpression


class RefExpression(Expression):
    """A mutable cell (``East.ref``): read it with :meth:`get`, replace its
    contents with :meth:`update`, fold into it with :meth:`merge`."""

    __slots__ = ()
    _kind = "Ref"

    def get(self) -> Expression:
        """Traced RefGet: the cell's contents."""
        inner_t = self.east_type.value
        return self._expr(_builtin("RefGet", inner_t, [inner_t], [self.ir]), inner_t)

    def update(self, value: Any) -> NullExpression:
        """Traced RefUpdate: replace the cell's contents (TS ``update``; yields
        Null). The python read-modify-write spelling ``update(fn)`` — ``fn(b,
        current)`` becoming the new contents — is deprecated: write
        ``ref.update(f(ref.get()))``."""
        inner_t = self._mutable("update").value
        if _is_body(value):
            import warnings

            from east.expression.statements import _frames, _run_block

            warnings.warn(
                ".update(fn) is deprecated: TypeScript's update(value) stores a "
                "value — spell the read-modify-write as ref.update(f(ref.get()))",
                DeprecationWarning,
                stacklevel=2,
            )
            current = self._expr(_builtin("RefGet", inner_t, [inner_t], [self.ir]), inner_t)
            ret_t = _frames[-1].return_type if _frames else None
            nxt = _run_block(value, (current,), return_type=ret_t, mode="block_expr",
                             out=inner_t)
            if nxt.east_type != inner_t:
                raise ExpressionError(
                    f".update() returns {nxt.east_type.type}, the cell holds {inner_t.type}")
            return self._effect(
                "update", _builtin("RefUpdate", NullType, [inner_t], [self.ir, nxt.ir]), NullType)
        v = _lift(value, hint=inner_t)
        if v.east_type != inner_t:
            raise ExpressionError(
                f".update() takes {inner_t.type}, got {v.east_type.type}")
        return self._effect(
            "update", _builtin("RefUpdate", NullType, [inner_t], [self.ir, v.ir]), NullType)

    set = _deprecated_alias("set", "update")

    def merge(self, value: Any, fn: Any) -> NullExpression:
        """Traced RefMerge: the cell takes ``fn(current, value)`` (yields Null)."""
        inner_t = self._mutable("merge").value
        v = _lift(value)
        node, got = _trace_inner_fn(fn, [inner_t, v.east_type], out_hint=inner_t)
        if got != inner_t and got.type != "Never":
            raise ExpressionError(
                f"callback returns {got.type}, the builtin expects {inner_t.type}")
        return self._effect(
            "merge",
            _builtin("RefMerge", NullType, [inner_t, v.east_type], [self.ir, v.ir, node]),
            NullType,
        )
