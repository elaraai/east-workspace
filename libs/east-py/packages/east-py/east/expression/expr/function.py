#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``FunctionExpression`` — TS ``FunctionExpr`` (``libs/east/src/expr/function.ts``)."""

from __future__ import annotations

from typing import Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression
from east.expression.lift import _coerce, _lift
from east.expression.nodes import _k_call, _k_call_async


class FunctionExpression(Expression):
    """A Function-typed expression — a ``FunctionType`` parameter, a
    function-typed struct field, a nested ``East.function`` referenced as a
    value. Calling it emits the IR ``Call`` node, so the callee — whatever
    function value the expression evaluates to at run time — is invoked
    natively (#561). A function value is not a body, so a slot's body-style
    call (``fn(b, *values)``) drops the leading block."""

    __slots__ = ()
    _kind = "Function"

    def _check_callable(self) -> None:
        pass

    def __call__(self, *args: Any) -> Expression:
        from east.expression.statements import _drop_block
        from east.types.types import is_subtype

        args = _drop_block(args)
        self._check_callable()
        sig = self.east_type.value
        inputs = list(sig["inputs"])
        out_t = sig["output"]
        if len(args) != len(inputs):
            raise ExpressionError(
                f"function expression takes {len(inputs)} argument(s), "
                f"called with {len(args)}"
            )
        arg_exprs = []
        for a, t in zip(args, inputs, strict=True):
            e = _lift(a, hint=t)
            if not is_subtype(e.east_type, t):
                raise ExpressionError(
                    f"function argument has East type {e.east_type.type}, "
                    f"the parameter expects {t.type}"
                )
            arg_exprs.append(_coerce(e, t))
        make = _k_call_async if self.east_type.type == "AsyncFunction" else _k_call
        return self._expr(make(out_t, self.ir, [e.ir for e in arg_exprs]), out_t)


    def call(self, *args: Any) -> Expression:
        """Call the function (TS ``call``; also ``fn(...)``)."""
        return self(*args)

    def to_ir(self) -> Any:
        """The Function IR node this expression evaluates to (TS ``toIR``)."""
        return self.ir
