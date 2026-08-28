#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``StringExpression`` — TS ``StringExpr`` (``libs/east/src/expr/string.ts``)."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError, _trace_bail
from east.expression.expr.base import Expression, _deprecated_alias
from east.expression.lift import _lift
from east.expression.location import location_id as _loc_id
from east.expression.nodes import _builtin, _fresh_name, _literal, _option_type, _var
from east.ir.builders import ir_trycatch, ir_variant
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    EastType,
    IntegerType,
    NullType,
    StringType,
)

if TYPE_CHECKING:
    from east.expression.expr.array import ArrayExpression
    from east.expression.expr.blob import BlobExpression
    from east.expression.expr.boolean import BooleanExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.variant import VariantExpression


class StringExpression(Expression):
    """String predicates, case, trimming, slicing, splitting, regex, and
    the strict parse. ``+`` is StringConcat; ``s[a:b]`` is StringSubstring."""

    __slots__ = ()
    _kind = "String"

    # ── concatenation and slicing ───────────────────────────────────────

    def __add__(self, other: Any) -> StringExpression:
        rhs = _lift(other)
        if rhs.east_type.type != "String":
            raise ExpressionError("string concatenation needs a String on both sides")
        return self._expr(_builtin("StringConcat", StringType, [], [self.ir, rhs.ir]), StringType)

    def __radd__(self, other: Any) -> StringExpression:
        return _lift(other).__add__(self)

    def __getitem__(self, name: Any) -> StringExpression:
        if isinstance(name, slice):
            # `s[a:b]` — the eager slicing spelling, traced as StringSubstring.
            # Python's from-the-end negatives and steps have no East twin.
            if name.step is not None:
                raise _trace_bail("stepped slice")
            start = name.start if name.start is not None else 0
            if (isinstance(start, int) and start < 0) or \
                    (isinstance(name.stop, int) and name.stop < 0):
                raise _trace_bail("negative slice bound")
            if name.stop is None:
                return self._with_bound_receiver(
                    lambda recv: recv.substring(start, recv.length()))
            return self.substring(start, name.stop)
        raise _trace_bail(f"[{name!r}] indexing")

    # ── predicates ──────────────────────────────────────────────────────

    def _string_arg(self, name: str, other: Any) -> StringExpression:
        arg: Any = _lift(other)
        if arg.east_type.type != "String":
            raise ExpressionError(f"{name} needs String operands")
        return arg

    def _string_pred(self, name: str, other: Any) -> BooleanExpression:
        other = self._string_arg(name, other)
        return self._expr(_builtin(name, BooleanType, [], [self.ir, other.ir]), BooleanType)

    def contains(self, other: Any) -> BooleanExpression:
        """Traced StringContains — or RegexContains for a compiled ``re``
        pattern (TS ``contains(substring | RegExp)``)."""
        if isinstance(other, re.Pattern):
            return self.regex_contains(other.pattern, _regex_flags(other))
        return self._string_pred("StringContains", other)

    def starts_with(self, other: Any) -> BooleanExpression:
        return self._string_pred("StringStartsWith", other)

    def ends_with(self, other: Any) -> BooleanExpression:
        return self._string_pred("StringEndsWith", other)

    # ── case, trimming, length ──────────────────────────────────────────

    def _string_fn(self, name: str) -> StringExpression:
        return self._expr(_builtin(name, StringType, [], [self.ir]), StringType)

    def length(self) -> IntegerExpression:
        """Traced StringLength: the length in Unicode code points."""
        return self._expr(_builtin("StringLength", IntegerType, [], [self.ir]), IntegerType)

    # ── splitting, replacing, searching ─────────────────────────────────

    def split(self, sep: Any) -> ArrayExpression:
        arg = self._string_arg("split", sep)
        out = ArrayType(StringType)
        return self._expr(_builtin("StringSplit", out, [], [self.ir, arg.ir]), out)

    def replace(self, old: Any, new: Any) -> StringExpression:
        """Traced StringReplace of every occurrence — or RegexReplace for a
        compiled ``re`` pattern (TS ``replace(substring | RegExp, text)``)."""
        if isinstance(old, re.Pattern):
            return self.regex_replace(old.pattern, new, _regex_flags(old))
        a = self._string_arg("replace", old)
        b = self._string_arg("replace", new)
        return self._expr(
            _builtin("StringReplace", StringType, [], [self.ir, a.ir, b.ir]), StringType)

    def substring(self, start: Any, end: Any) -> StringExpression:
        s = _lift(start)
        e = _lift(end)
        if s.east_type.type != "Integer" or e.east_type.type != "Integer":
            raise ExpressionError(".substring() bounds must be Integers")
        return self._expr(
            _builtin("StringSubstring", StringType, [], [self.ir, s.ir, e.ir]), StringType)

    def index_of(self, other: Any) -> IntegerExpression:
        """Traced StringIndexOf (-1 when absent) — or RegexIndexOf for a
        compiled ``re`` pattern (TS ``indexOf(substring | RegExp)``)."""
        if isinstance(other, re.Pattern):
            return self.regex_index_of(other.pattern, _regex_flags(other))
        arg = self._string_arg("index_of", other)
        return self._expr(
            _builtin("StringIndexOf", IntegerType, [], [self.ir, arg.ir]), IntegerType)

    def repeat(self, count: Any) -> StringExpression:
        n = _lift(count)
        if n.east_type.type != "Integer":
            raise ExpressionError(".repeat() count must be an Integer")
        return self._expr(_builtin("StringRepeat", StringType, [], [self.ir, n.ir]), StringType)

    # ── regex ───────────────────────────────────────────────────────────

    def regex_contains(self, pattern: Any, flags: Any = "") -> BooleanExpression:
        a = self._string_arg("regex_contains", pattern)
        f = self._string_arg("regex_contains", flags)
        return self._expr(
            _builtin("RegexContains", BooleanType, [], [self.ir, a.ir, f.ir]), BooleanType)

    def regex_index_of(self, pattern: Any, flags: Any = "") -> IntegerExpression:
        a = self._string_arg("regex_index_of", pattern)
        f = self._string_arg("regex_index_of", flags)
        return self._expr(
            _builtin("RegexIndexOf", IntegerType, [], [self.ir, a.ir, f.ir]), IntegerType)

    def regex_replace(self, pattern: Any, replacement: Any, flags: Any = "") -> StringExpression:
        a = self._string_arg("regex_replace", pattern)
        f = self._string_arg("regex_replace", flags)
        b = self._string_arg("regex_replace", replacement)
        return self._expr(
            _builtin("RegexReplace", StringType, [], [self.ir, a.ir, f.ir, b.ir]), StringType)

    # ── parsing and encoding ────────────────────────────────────────────

    def parse(self, typ: EastType) -> Expression:
        """Traced Parse: this String in East's canonical text format as a
        value of ``typ`` (TS ``parse``) — an East runtime error when it is
        not; :meth:`try_parse` is the Option-returning form."""
        if not isinstance(typ, EastType):
            raise ExpressionError(".parse() takes an East type")
        return self._expr(_builtin("Parse", typ, [typ], [self.ir]), typ)

    def parse_json(self, typ: EastType) -> Expression:
        """Traced StringParseJSON: this JSON text as a value of ``typ``."""
        if not isinstance(typ, EastType):
            raise ExpressionError(".parse_json() takes an East type")
        return self._expr(_builtin("StringParseJSON", typ, [typ], [self.ir]), typ)

    def encode_utf8(self) -> BlobExpression:
        """Traced StringEncodeUtf8: the UTF-8 bytes as a Blob."""
        return self._expr(_builtin("StringEncodeUtf8", BlobType, [], [self.ir]), BlobType)

    def encode_utf16(self) -> BlobExpression:
        """Traced StringEncodeUtf16: the little-endian UTF-16 bytes as a Blob."""
        return self._expr(_builtin("StringEncodeUtf16", BlobType, [], [self.ir]), BlobType)

    # ── strict optional parse (TryCatch IR, #392/#393) ──────────────────

    def try_parse(self, t: EastType) -> VariantExpression:
        """Parse this String as ``t``; ``some(value)`` on success, ``none`` on
        any parse failure (the strict whole-string parse of #392 wrapped in
        TryCatch IR). ``if_else(x.is_some(), …)`` / ``.unwrap_or(…)`` consume it.
        """
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

    # ── the TypeScript names; the python idioms are deprecated aliases ──

    def concat(self, other: Any) -> StringExpression:
        """Traced StringConcat (TS ``concat``; also ``+``)."""
        return self + other

    def upper_case(self) -> StringExpression:
        """Traced StringUpperCase (TS ``upperCase``)."""
        return self._string_fn("StringUpperCase")

    def lower_case(self) -> StringExpression:
        """Traced StringLowerCase (TS ``lowerCase``)."""
        return self._string_fn("StringLowerCase")

    def trim(self) -> StringExpression:
        """Traced StringTrim (TS ``trim``)."""
        return self._string_fn("StringTrim")

    def trim_start(self) -> StringExpression:
        """Traced StringTrimStart (TS ``trimStart``)."""
        return self._string_fn("StringTrimStart")

    def trim_end(self) -> StringExpression:
        """Traced StringTrimEnd (TS ``trimEnd``)."""
        return self._string_fn("StringTrimEnd")

    upper = _deprecated_alias("upper", "upper_case")
    lower = _deprecated_alias("lower", "lower_case")
    strip = _deprecated_alias("strip", "trim")
    lstrip = _deprecated_alias("lstrip", "trim_start")
    rstrip = _deprecated_alias("rstrip", "trim_end")
    size = _deprecated_alias("size", "length")


_RE_FLAGS = ((re.IGNORECASE, "i"), (re.MULTILINE, "m"), (re.DOTALL, "s"))


def _regex_flags(pattern: re.Pattern) -> str:
    """A compiled pattern's flags as the East (JavaScript) flag string."""
    unsupported = pattern.flags & ~(re.IGNORECASE | re.MULTILINE | re.DOTALL | re.UNICODE)
    if unsupported:
        raise ExpressionError(
            "a regex pattern here may only use re.IGNORECASE, re.MULTILINE and "
            f"re.DOTALL — got flags {pattern.flags}")
    return "".join(letter for flag, letter in _RE_FLAGS if pattern.flags & flag)
