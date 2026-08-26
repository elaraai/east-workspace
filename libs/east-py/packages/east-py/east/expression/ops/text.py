#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""String and regex operations on traced expressions."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import _lift
from east.expression.nodes import _builtin
from east.expression.ops import _ExprBase
from east.types.types import BooleanType, IntegerType, StringType

if TYPE_CHECKING:
    from east.expression.expr import Expression


class _TextOps(_ExprBase):
    """Traced String builtins — predicates, case, trimming, slicing, regex."""

    __slots__ = ()

    # ── string methods ─────────────────────────────────────────────────

    def _string_pred(self, name: str, other: Any) -> Expression:
        other = _lift(other)
        if self.east_type.type != "String" or other.east_type.type != "String":
            raise ExpressionError(f"{name} needs String operands")
        return self._expr(_builtin(name, BooleanType, [], [self.ir, other.ir]), BooleanType)

    def contains(self, other: Any) -> Expression:
        return self._string_pred("StringContains", other)

    def starts_with(self, other: Any) -> Expression:
        return self._string_pred("StringStartsWith", other)

    def ends_with(self, other: Any) -> Expression:
        return self._string_pred("StringEndsWith", other)

    def upper(self) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".upper() needs a String")
        return self._expr(_builtin("StringUpperCase", StringType, [], [self.ir]), StringType)

    def lower(self) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".lower() needs a String")
        return self._expr(_builtin("StringLowerCase", StringType, [], [self.ir]), StringType)

    def strip(self) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".strip() needs a String")
        return self._expr(_builtin("StringTrim", StringType, [], [self.ir]), StringType)

    def length(self) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".length() needs a String")
        return self._expr(_builtin("StringLength", IntegerType, [], [self.ir]), IntegerType)

    # ── string tail ────────────────────────────────────────────────────

    def _string_arg(self, name: str, other: Any) -> Expression:
        arg = _lift(other)
        if self.east_type.type != "String" or arg.east_type.type != "String":
            raise ExpressionError(f"{name} needs String operands")
        return arg

    def split(self, sep: Any) -> Expression:
        from east.types.types import ArrayType as _ArrayType

        arg = self._string_arg("split", sep)
        out = _ArrayType(StringType)
        return self._expr(_builtin("StringSplit", out, [], [self.ir, arg.ir]), out)

    def replace(self, old: Any, new: Any) -> Expression:
        a = self._string_arg("replace", old)
        b = self._string_arg("replace", new)
        return self._expr(_builtin("StringReplace", StringType, [], [self.ir, a.ir, b.ir]), StringType)

    def substring(self, start: Any, end: Any) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".substring() needs a String")
        s = _lift(start)
        e = _lift(end)
        if s.east_type.type != "Integer" or e.east_type.type != "Integer":
            raise ExpressionError(".substring() bounds must be Integers")
        return self._expr(
            _builtin("StringSubstring", StringType, [], [self.ir, s.ir, e.ir]), StringType
        )

    def index_of(self, other: Any) -> Expression:
        arg = self._string_arg("index_of", other)
        return self._expr(_builtin("StringIndexOf", IntegerType, [], [self.ir, arg.ir]), IntegerType)

    def repeat(self, count: Any) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".repeat() needs a String")
        n = _lift(count)
        if n.east_type.type != "Integer":
            raise ExpressionError(".repeat() count must be an Integer")
        return self._expr(_builtin("StringRepeat", StringType, [], [self.ir, n.ir]), StringType)

    def lstrip(self) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".lstrip() needs a String")
        return self._expr(_builtin("StringTrimStart", StringType, [], [self.ir]), StringType)

    def rstrip(self) -> Expression:
        if self.east_type.type != "String":
            raise ExpressionError(".rstrip() needs a String")
        return self._expr(_builtin("StringTrimEnd", StringType, [], [self.ir]), StringType)

    def regex_contains(self, pattern: Any, flags: Any = "") -> Expression:
        a = self._string_arg("regex_contains", pattern)
        f = self._string_arg("regex_contains", flags)
        return self._expr(
            _builtin("RegexContains", BooleanType, [], [self.ir, a.ir, f.ir]), BooleanType
        )

    def regex_index_of(self, pattern: Any, flags: Any = "") -> Expression:
        a = self._string_arg("regex_index_of", pattern)
        f = self._string_arg("regex_index_of", flags)
        return self._expr(
            _builtin("RegexIndexOf", IntegerType, [], [self.ir, a.ir, f.ir]), IntegerType
        )

    def regex_replace(self, pattern: Any, replacement: Any, flags: Any = "") -> Expression:
        a = self._string_arg("regex_replace", pattern)
        f = self._string_arg("regex_replace", flags)
        b = self._string_arg("regex_replace", replacement)
        return self._expr(
            _builtin("RegexReplace", StringType, [], [self.ir, a.ir, f.ir, b.ir]), StringType
        )
