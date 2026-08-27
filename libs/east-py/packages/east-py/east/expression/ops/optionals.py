#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Option and general-variant access, plus the strict optional parse."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import _lift
from east.expression.location import location_id as _loc_id
from east.expression.nodes import (
    _builtin,
    _fresh_name,
    _is_option,
    _k_match,
    _literal,
    _option_inner,
    _option_type,
    _var,
)
from east.expression.ops import _ExprBase
from east.expression.statements import _Run as _RunT
from east.ir.builders import ir_error, ir_trycatch, ir_unwrap_recursive, ir_variant
from east.types.types import ArrayType, BooleanType, EastType, IntegerType, NullType, StringType
from east.types.values import EastVariant

if TYPE_CHECKING:
    from east.expression.expr import Expression


class _OptionOps(_ExprBase):
    """Traced consumption of options and general variants.

    Every one of these lowers to a Match, so exactly one arm evaluates at run
    time — the same shape the TypeScript variant expressions build.
    """

    __slots__ = ()

    # ── option access (Match IR) ───────────────────────────────────────

    def _match_option(self, some_body_fn: Any, none_value: Expression, out_t: EastType) -> Expression:
        if not _is_option(self.east_type):
            raise ExpressionError(
                f"option access on a non-Option expression ({self.east_type.type})"
            )
        inner_t = _option_inner(self.east_type)
        # Arm variables get trace-unique names: a nested match re-using a
        # fixed name rebinds it in the runtime environment, so an outer
        # binding read inside the inner arm resolves against the inner
        # payload (#603).
        some_var = _var(_fresh_name(), inner_t)
        some_body = some_body_fn(self._expr(some_var, inner_t))
        none_var = _var(_fresh_name(), NullType)
        node = _k_match(
            out_t,
            self.ir,
            [
                ("none", none_var, none_value.ir),
                ("some", some_var, some_body.ir),
            ],
        )
        return self._expr(node, out_t)

    def is_some(self) -> Expression:
        return self._match_option(
            lambda _x: self._expr(_literal(True, BooleanType), BooleanType),
            self._expr(_literal(False, BooleanType), BooleanType),
            BooleanType,
        )

    def is_none(self) -> Expression:
        return self._match_option(
            lambda _x: self._expr(_literal(False, BooleanType), BooleanType),
            self._expr(_literal(True, BooleanType), BooleanType),
            BooleanType,
        )

    def unwrap_or(self, default: Any) -> Expression:
        if not _is_option(self.east_type):
            raise ExpressionError(
                f".unwrap_or() on a non-Option expression ({self.east_type.type})"
            )
        inner_t = _option_inner(self.east_type)
        d = _lift(default, hint=inner_t)
        if d.east_type != inner_t:
            raise ExpressionError(
                f".unwrap_or() default has type {d.east_type.type}, option holds {inner_t.type}"
            )
        return self._match_option(lambda x: x, d, inner_t)

    # ── general variant access (Match IR, like the TS variant expr) ─────

    def _variant_cases(self) -> list:
        if self.east_type.type != "Variant":
            raise ExpressionError(
                f"variant access on a non-variant expression ({self.east_type.type})"
            )
        return list(self.east_type.value)

    def get_tag(self) -> Expression:
        """The case name as a String (Match over every case)."""
        cases = []
        for c in self._variant_cases():
            var = _var(_fresh_name(), c["type"])
            cases.append((c["name"], var, _literal(c["name"], StringType)))
        node = _k_match(StringType, self.ir, cases)
        return self._expr(node, StringType)

    def has_tag(self, tag: str) -> Expression:
        if not isinstance(tag, str):
            raise ExpressionError(".has_tag() takes a literal case name")
        names = [c["name"] for c in self._variant_cases()]
        if tag not in names:
            raise ExpressionError(f"variant has no case {tag!r} (cases: {', '.join(names)})")
        cases = []
        for c in self._variant_cases():
            var = _var(_fresh_name(), c["type"])
            cases.append((c["name"], var, _literal(c["name"] == tag, BooleanType)))
        node = _k_match(BooleanType, self.ir, cases)
        return self._expr(node, BooleanType)

    def match(self, cases: dict) -> Expression:
        """Traced match — the EXPRESSION form (TS ``East.match``):
        ``{case: handler(payload_expr) -> expr}``.

        Each handler runs in its own statement frame (it may append
        statements and return the arm's value, or diverge). The result type
        is the union of the arms' types — a diverging ``Never`` arm is
        absorbed, a narrower arm widens — so every arm must agree on one
        East type (a scalar handler value is lifted with the other arms'
        type as the hint). A case without a handler evaluates to ``null``,
        which only types when every other arm is Null too.
        """
        from east.expression.expr import Expression
        from east.expression.statements import _finish_run, _frames, _open_run

        declared = self._variant_cases()
        names = [c["name"] for c in declared]
        extra = [n for n in cases if n not in names]
        if extra:
            raise ExpressionError(
                f".match() must handle the variant's cases {names}; unknown {extra}"
            )
        ret_t = _frames[-1].return_type if _frames else None
        results = []
        for c in declared:
            var = _var(_fresh_name(), c["type"])
            handler = cases.get(c["name"])
            # A Expression arm is a VALUE arm, not a handler — expressions
            # became callable when Function-typed expressions gained Call
            # lowering (#561), and invoking a non-function one would raise.
            if handler is None:
                raw: Any = self._expr(_literal(None, NullType), NullType)
            elif callable(handler) and not isinstance(handler, Expression):
                # Run now, assemble once the arms have settled a type: a
                # `none` arm lifts under its `some` sibling's Option type.
                raw = _open_run(handler, (self._expr(var, c["type"]),), return_type=ret_t)
            else:
                raw = handler
            results.append((c["name"], var, raw))
        # Settle the shared output type from ANY arm that can state one
        # without a hint — a raw Expression, OR a `some(...)` result, which
        # arrives as an EastVariant WRAPPING a traced payload (the constructor
        # is a value builder, not an expression). Recognising only the bare
        # Expression left `out_t` unset whenever the only typed arm was
        # `some(expr)`, so the sibling `none` arm raised "needs a type from
        # context" — the exact pairing `if_else(...)` types fine (#558 D).
        out_t = None
        for _, _, raw in results:
            probe = raw.result if isinstance(raw, _RunT) else raw
            if isinstance(probe, Expression):
                out_t = probe.east_type
                break
            if (isinstance(probe, EastVariant) and probe.type == "some"
                    and isinstance(probe.value, Expression)):
                out_t = _option_type(probe.value.east_type)
                break
        from east.expression.lift import _coerce, _union_type

        lifted = [(name, var,
                   _finish_run(raw, "block_expr", out_t) if isinstance(raw, _RunT)
                   else _lift(raw, hint=out_t))
                  for name, var, raw in results]
        out_t = _union_type([b.east_type for _n, _v, b in lifted], ".match()")
        case_nodes = []
        for name, var, body in lifted:
            if body.east_type.type != "Never":
                body = _coerce(body, out_t)
            case_nodes.append((name, var, body.ir))
        node = _k_match(out_t, self.ir, case_nodes)
        return self._expr(node, out_t)

    def unwrap(self, tag: str | None = None) -> Expression:
        """The payload of `tag`; an East runtime error for any other case.

        On a RECURSIVE-typed expression ``.unwrap()`` takes no tag: it is the
        recursive type's one level of unrolling (TS ``RecursiveExpr.unwrap``,
        the ``UnwrapRecursive`` node) — the value as its inner type.
        """
        if self.east_type.type == "Recursive":
            from east.expression.lift import _unroll

            if tag is not None:
                raise ExpressionError(
                    ".unwrap() on a recursive-typed expression takes no case name")
            inner_t = _unroll(self.east_type)
            return self._expr(ir_unwrap_recursive(inner_t, self.ir, _loc_id()), inner_t)
        if not isinstance(tag, str):
            raise ExpressionError(".unwrap() takes a literal case name")
        declared = self._variant_cases()
        target = next((c for c in declared if c["name"] == tag), None)
        if target is None:
            names = ", ".join(c["name"] for c in declared)
            raise ExpressionError(f"variant has no case {tag!r} (cases: {names})")
        out_t = target["type"]
        case_nodes = []
        for c in declared:
            var = _var(_fresh_name(), c["type"])
            if c["name"] == tag:
                body = var
            else:
                msg = _literal(f"unwrap: expected variant case '{tag}', got '{c['name']}'", StringType)
                body = ir_error(out_t, msg, _loc_id())
            case_nodes.append((c["name"], var, body))
        node = _k_match(out_t, self.ir, case_nodes)
        return self._expr(node, out_t)

    # ── strict optional parse (TryCatch IR, #392/#393) ──────────────────

    def try_parse(self, t: EastType) -> Expression:
        """Parse this String as ``t``; ``some(value)`` on success, ``none`` on
        any parse failure (the strict whole-string parse of #392 wrapped in
        TryCatch IR). ``if_else(x.is_some(), …)`` / ``.unwrap_or(…)`` consume it.
        """
        if self.east_type.type != "String":
            raise ExpressionError(".try_parse() needs a String")
        if not isinstance(t, EastType):
            raise ExpressionError(".try_parse() takes an East type")
        from east.types.types import StructType as _StructType

        out_t = _option_type(t)
        loc = _loc_id()
        parsed = _builtin("Parse", t, [t], [self.ir])
        some_node = ir_variant(out_t, "some", parsed, loc)
        none_node = ir_variant(out_t, "none", _literal(None, NullType), loc)
        loc_t = _StructType(
            [("filename", StringType), ("line", IntegerType), ("column", IntegerType)]
        )
        node = ir_trycatch(
            out_t,
            some_node,
            none_node,
            _var(_fresh_name(), StringType),
            _var(_fresh_name(), ArrayType(loc_t)),
            finally_body=_literal(None, NullType),
            loc_id=loc,
        )
        return self._expr(node, out_t)
