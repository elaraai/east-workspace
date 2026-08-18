#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Option and general-variant access, plus the strict optional parse."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.ir.builders import ir_error, ir_trycatch, ir_variant
from east.kernel.errors import KernelTraceError
from east.kernel.lift import _lift
from east.kernel.nodes import (
    _builtin,
    _fresh_name,
    _is_option,
    _k_match,
    _literal,
    _option_inner,
    _option_type,
    _var,
)
from east.kernel.ops import _ExprBase
from east.types.types import ArrayType, BooleanType, EastType, IntegerType, NullType, StringType
from east.types.values import EastVariant

if TYPE_CHECKING:
    from east.kernel.expr import KernelExpr


class _OptionOps(_ExprBase):
    """Traced consumption of options and general variants.

    Every one of these lowers to a Match, so exactly one arm evaluates at run
    time — the same shape the TypeScript variant expressions build.
    """

    __slots__ = ()

    # ── option access (Match IR) ───────────────────────────────────────

    def _match_option(self, some_body_fn: Any, none_value: KernelExpr, out_t: EastType) -> KernelExpr:
        if not _is_option(self.east_type):
            raise KernelTraceError(
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

    def is_some(self) -> KernelExpr:
        return self._match_option(
            lambda _x: self._expr(_literal(True, BooleanType), BooleanType),
            self._expr(_literal(False, BooleanType), BooleanType),
            BooleanType,
        )

    def is_none(self) -> KernelExpr:
        return self._match_option(
            lambda _x: self._expr(_literal(False, BooleanType), BooleanType),
            self._expr(_literal(True, BooleanType), BooleanType),
            BooleanType,
        )

    def unwrap_or(self, default: Any) -> KernelExpr:
        if not _is_option(self.east_type):
            raise KernelTraceError(
                f".unwrap_or() on a non-Option expression ({self.east_type.type})"
            )
        inner_t = _option_inner(self.east_type)
        d = _lift(default, hint=inner_t)
        if d.east_type != inner_t:
            raise KernelTraceError(
                f".unwrap_or() default has type {d.east_type.type}, option holds {inner_t.type}"
            )
        return self._match_option(lambda x: x, d, inner_t)

    # ── general variant access (Match IR, like the TS variant expr) ─────

    def _variant_cases(self) -> list:
        if self.east_type.type != "Variant":
            raise KernelTraceError(
                f"variant access on a non-variant expression ({self.east_type.type})"
            )
        return list(self.east_type.value)

    def get_tag(self) -> KernelExpr:
        """The case name as a String (Match over every case)."""
        cases = []
        for c in self._variant_cases():
            var = _var(_fresh_name(), c["type"])
            cases.append((c["name"], var, _literal(c["name"], StringType)))
        node = _k_match(StringType, self.ir, cases)
        return self._expr(node, StringType)

    def has_tag(self, tag: str) -> KernelExpr:
        if not isinstance(tag, str):
            raise KernelTraceError(".has_tag() takes a literal case name")
        names = [c["name"] for c in self._variant_cases()]
        if tag not in names:
            raise KernelTraceError(f"variant has no case {tag!r} (cases: {', '.join(names)})")
        cases = []
        for c in self._variant_cases():
            var = _var(_fresh_name(), c["type"])
            cases.append((c["name"], var, _literal(c["name"] == tag, BooleanType)))
        node = _k_match(BooleanType, self.ir, cases)
        return self._expr(node, BooleanType)

    def match(self, cases: dict) -> KernelExpr:
        """Exhaustive traced match: {case: handler(payload_expr) -> expr}.

        Every case must be handled and all handler results must share one
        East type (a scalar handler value is lifted, with the other
        branches' type as the hint).
        """
        from east.kernel.expr import KernelExpr

        declared = self._variant_cases()
        names = [c["name"] for c in declared]
        missing = [n for n in names if n not in cases]
        extra = [n for n in cases if n not in names]
        if missing or extra:
            raise KernelTraceError(
                f".match() must handle exactly the variant's cases {names}; "
                f"missing {missing}, unknown {extra}"
            )
        results = []
        for c in declared:
            var = _var(_fresh_name(), c["type"])
            handler = cases[c["name"]]
            # A KernelExpr arm is a VALUE arm, not a handler — expressions
            # became callable when Function-typed expressions gained Call
            # lowering (#561), and invoking a non-function one would raise.
            run = callable(handler) and not isinstance(handler, KernelExpr)
            raw = handler(self._expr(var, c["type"])) if run else handler
            results.append((c["name"], var, raw))
        # Settle the shared output type from ANY arm that can state one
        # without a hint — a raw KernelExpr, OR a `some(...)` result, which
        # arrives as an EastVariant WRAPPING a traced payload (the constructor
        # is a value builder, not an expression). Recognising only the bare
        # KernelExpr left `out_t` unset whenever the only typed arm was
        # `some(expr)`, so the sibling `none` arm raised "needs a type from
        # context" — the exact pairing `if_else(...)` types fine (#558 D).
        out_t = None
        for _, _, raw in results:
            if isinstance(raw, KernelExpr):
                out_t = raw.east_type
                break
            if (isinstance(raw, EastVariant) and raw.type == "some"
                    and isinstance(raw.value, KernelExpr)):
                out_t = _option_type(raw.value.east_type)
                break
        case_nodes = []
        for name, var, raw in results:
            body = _lift(raw, hint=out_t)
            if out_t is None:
                out_t = body.east_type
            elif body.east_type != out_t:
                raise KernelTraceError(
                    f".match() case {name!r} returns {body.east_type.type}, "
                    f"other cases return {out_t.type}"
                )
            case_nodes.append((name, var, body.ir))
        node = _k_match(out_t, self.ir, case_nodes)
        return self._expr(node, out_t)

    def unwrap(self, tag: str) -> KernelExpr:
        """The payload of `tag`; an East runtime error for any other case."""
        if not isinstance(tag, str):
            raise KernelTraceError(".unwrap() takes a literal case name")
        declared = self._variant_cases()
        target = next((c for c in declared if c["name"] == tag), None)
        if target is None:
            names = ", ".join(c["name"] for c in declared)
            raise KernelTraceError(f"variant has no case {tag!r} (cases: {names})")
        out_t = target["type"]
        case_nodes = []
        for c in declared:
            var = _var(_fresh_name(), c["type"])
            if c["name"] == tag:
                body = var
            else:
                msg = _literal(f"unwrap: expected variant case '{tag}', got '{c['name']}'", StringType)
                body = ir_error(out_t, msg)
            case_nodes.append((c["name"], var, body))
        node = _k_match(out_t, self.ir, case_nodes)
        return self._expr(node, out_t)

    # ── strict optional parse (TryCatch IR, #392/#393) ──────────────────

    def try_parse(self, t: EastType) -> KernelExpr:
        """Parse this String as ``t``; ``some(value)`` on success, ``none`` on
        any parse failure (the strict whole-string parse of #392 wrapped in
        TryCatch IR). ``if_else(x.is_some(), …)`` / ``.unwrap_or(…)`` consume it.
        """
        if self.east_type.type != "String":
            raise KernelTraceError(".try_parse() needs a String")
        if not isinstance(t, EastType):
            raise KernelTraceError(".try_parse() takes an East type")
        from east.types.types import StructType as _StructType

        out_t = _option_type(t)
        parsed = _builtin("Parse", t, [t], [self.ir])
        some_node = ir_variant(out_t, "some", parsed)
        none_node = ir_variant(out_t, "none", _literal(None, NullType))
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
        )
        return self._expr(node, out_t)
