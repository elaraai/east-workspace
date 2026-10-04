#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The jq parser: jq 1.8's grammar into ``JqType`` values. The twin of ``parse.ts``.

Every node gets a span and every problem a ``syntax`` diagnostic, identical to
TypeScript's: the parser reads the text's UTF-16 view, so each offset is
TypeScript's, and the strings it puts in the tree are read back from it.

The tree's variants are built with ``EastVariant`` itself: ``JqType`` is
recursive, which ``variant()`` cannot check a case against. A literal's
constant is a ``JqLiteralType`` value, which ``variant()`` checks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from east.query.jq.lex import JqLexeme, scan_jq
from east.query.jq.spans import (
    JqNode,
    JqPattern,
    JqRange,
    JqSpans,
    child_path,
    from_utf16,
    jq_children,
    jq_pattern_children,
    to_query_span,
    to_utf16,
)
from east.query.types import JqLiteralType
from east.types.construct import none, some, variant
from east.types.values import EastStruct, EastVariant, east_null

_INTEGER_MAX = 9223372036854775807

_UPDATE_OPS = frozenset({"=", "|=", "+=", "-=", "*=", "/=", "%=", "//="})
_COMPARISON_OPS = frozenset({"==", "!=", "<", "<=", ">", ">="})

# Keywords that open a filter in a query position.
_FILTER_KEYWORDS = frozenset({
    "def", "label", "reduce", "foreach", "if", "try", "break", "import", "include", "module",
})

# Keywords a query may not use: they load modules.
_MODULE_KEYWORDS = frozenset({"import", "include", "module"})

_DIGITS = re.compile(r"[0-9]+")


def node(case: str, payload: Any = east_null) -> JqNode:
    """A ``JqType`` (or ``JqPatternType``) node: its case and payload."""
    return EastVariant(case, payload)


@dataclass
class ParsedJq:
    """A parsed jq program.

    ``program`` is ``none`` when any diagnostic was reported, and ``spans`` is
    then empty. Otherwise ``spans`` holds the range of text of every node of
    ``program``, the root's (``""``) covering the whole text.
    """

    #: The text that was parsed.
    text: str
    #: The program, or ``none`` when the text has a syntax problem.
    program: EastVariant
    #: Where each node of the program is in the text, by its path, in UTF-16 code units.
    spans: JqSpans
    #: The syntax problems, each with its span and any fix.
    diagnostics: list[EastStruct]
    #: The text's UTF-16 view, which every offset indexes.
    units: str = field(repr=False, default="")


def diagnostic(text: str, code: str, span: Any, message: str, fixes: list[EastStruct] | None = None) -> EastStruct:
    """Builds a diagnostic.

    Args:
        text: The parsed text's UTF-16 view.
        code: ``syntax``, or ``unsupported`` for a module keyword.
        span: The text it is about (anything with ``from_`` and ``to``), or ``None``.
        message: Its sentence.
        fixes: Its one-click fixes.

    Returns:
        The ``QueryErrorType`` value.
    """
    return EastStruct({
        "code": code,
        "fixes": list(fixes or []),
        "message": message,
        "severity": EastVariant("error", east_null),
        "span": none if span is None else some(to_query_span(text, span.from_, span.to)),
        "suggestions": [],
    })


def fix(label: str, offset: int, length: int, insert: str) -> EastStruct:
    """A one-click fix of one text edit, ``insert`` a python string."""
    return EastStruct({
        "edits": [EastStruct({"insert": insert, "length": length, "offset": offset})],
        "label": label,
    })


# The bracket a punctuation opens or closes, paired.
_CLOSER = {"(": ")", "[": "]", "{": "}"}


def _check_brackets(text: str, lexemes: list[JqLexeme]) -> list[EastStruct]:
    """Reports the brackets that do not pair: a closer with no opener, of the wrong kind, and an opener never closed."""
    problems: list[EastStruct] = []
    opened: list[JqLexeme] = []
    for t in lexemes:
        if (t.role == "punct" and t.value in _CLOSER) or t.role == "interp_start":
            opened.append(t)
        elif t.role == "punct" and t.value in (")", "]", "}"):
            top = opened[-1] if opened else None
            if top is None or top.role == "interp_start":
                problems.append(diagnostic(text, "syntax", t, f'syntax: unexpected "{t.value}".'))
            elif _CLOSER[top.value] == t.value:
                opened.pop()
            else:
                column = to_query_span(text, top.from_, top.to)["column"]
                problems.append(diagnostic(
                    text, "syntax", t,
                    f'syntax: unexpected "{t.value}" — "{top.value}" at column {column} is still open.'))
                opened.pop()
        elif t.role == "interp_end":
            while opened and opened[-1].role != "interp_start":
                problems.append(_never_closed(text, opened.pop()))
            if opened:
                opened.pop()
    for unclosed in opened:
        if unclosed.role != "interp_start":
            problems.append(_never_closed(text, unclosed))
    return problems


def _never_closed(text: str, opener: JqLexeme) -> EastStruct:
    """The diagnostic for an opening bracket never closed, with its fix."""
    return diagnostic(text, "syntax", opener, f'syntax: "{opener.value}" is never closed.',
                      [fix("Close it", len(text), 0, _CLOSER[opener.value])])


def _describe(t: JqLexeme | None) -> str:
    """Describes a token for a message: ``end of input``, ``a string``, or its text in quotes."""
    if t is None:
        return "end of input"
    if t.role in ("string_start", "unterminated"):
        return "a string"
    return f'"{from_utf16(t.text)}"'


class _JqSyntaxError(Exception):
    """Thrown to abandon a parse with its diagnostic."""

    def __init__(self, diag: EastStruct, token: int) -> None:
        super().__init__(diag["message"])
        self.diagnostic = diag
        self.token = token


@dataclass
class _StringTerm:
    """A string term: a constant (``constant`` its python string), or text with interpolations."""

    constant: str | None
    node: JqNode


class _Parser:
    """A recursive-descent parser over the significant lexemes of a text, from a starting lexeme."""

    def __init__(self, text: str, toks: list[JqLexeme], start: int) -> None:
        self.text = text
        self.toks = toks
        #: Each node's and pattern's range, by the object's id.
        self.ranges: dict[int, JqRange] = {}
        #: Where each parenthesised node's text starts: its outermost ``(``.
        self._opens: dict[int, int] = {}
        #: Every node ranged, so no id is reused while the maps hold it.
        self._alive: list[Any] = []
        self.at = start
        self._last_end = 0

    @property
    def position(self) -> int:
        """The index of the lexeme the parser is at."""
        return self.at

    def _peek(self, ahead: int = 0) -> JqLexeme | None:
        i = self.at + ahead
        return self.toks[i] if i < len(self.toks) else None

    def _next(self) -> JqLexeme:
        t = self._peek()
        if t is None:
            raise self.unexpected("a filter")
        self.at += 1
        self._last_end = t.to
        return t

    def _is_op(self, value: str, ahead: int = 0) -> bool:
        t = self._peek(ahead)
        return t is not None and t.role == "op" and t.value == value

    def _is_punct(self, value: str, ahead: int = 0) -> bool:
        t = self._peek(ahead)
        return t is not None and t.role == "punct" and t.value == value

    def _is_keyword(self, value: str, ahead: int = 0) -> bool:
        t = self._peek(ahead)
        return t is not None and t.role == "keyword" and t.value == value

    def _set_range(self, n: Any, start: int, end: int) -> None:
        self.ranges[id(n)] = JqRange(start, end)
        self._alive.append(n)

    def _mk(self, n: Any, start: int) -> Any:
        """Records a node's range, from ``start`` to the last lexeme read."""
        self._set_range(n, start, self._last_end)
        return n

    def _from(self, n: Any) -> int:
        return self.ranges[id(n)].from_

    def _start(self, n: Any) -> int:
        """Where a node's text starts with the parentheses around it: where a node built on it starts."""
        return self._opens.get(id(n), self._from(n))

    def unexpected(self, expected: str) -> _JqSyntaxError:
        """A diagnostic for the lexeme the parser is at."""
        t = self._peek()
        span = t if t is not None else JqRange(len(self.text), len(self.text))
        return _JqSyntaxError(
            diagnostic(self.text, "syntax", span, f"syntax: unexpected {_describe(t)}; expected {expected}."),
            self.at,
        )

    def _expect_punct(self, value: str, expected: str | None = None) -> JqLexeme:
        if not self._is_punct(value):
            raise self.unexpected(expected if expected is not None else f'"{value}"')
        return self._next()

    def _expect_keyword(self, value: str, expected: str | None = None) -> JqLexeme:
        if not self._is_keyword(value):
            raise self.unexpected(expected if expected is not None else f'"{value}"')
        return self._next()

    def _expect_variable(self, expected: str) -> str:
        t = self._peek()
        if t is None or t.role != "variable":
            raise self.unexpected(expected)
        self._next()
        return t.value

    def _starts_filter(self, t: JqLexeme | None) -> bool:
        """Whether a lexeme can begin a filter."""
        if t is None:
            return False
        if t.role in ("field", "ident", "loc", "variable", "format", "number", "string_start"):
            return True
        if t.role == "punct":
            return t.value in (".", "..", "(", "[", "{")
        if t.role == "op":
            return t.value == "-"
        if t.role == "keyword":
            return t.value in _FILTER_KEYWORDS
        return False

    def _pipe_then_filter(self) -> None:
        """Reads a ``|`` that must be followed by a filter."""
        bar = self._next()
        if not self._starts_filter(self._peek()):
            raise _JqSyntaxError(
                diagnostic(self.text, "syntax", bar, 'syntax: expected a filter after "|".',
                           [fix("Remove the |", bar.from_, 1, "")]),
                self.at - 1,
            )

    def parse_program(self) -> JqNode:
        """Reads the whole program."""
        n = self.parse_query()
        if self._peek() is not None:
            raise self.unexpected('"|", "," or end of input')
        return n

    def parse_query(self) -> JqNode:
        """Query: pipes, right-associative, over commas."""
        left = self._parse_comma()
        if self._is_op("|"):
            self._pipe_then_filter()
            right = self.parse_query()
            return self._mk(node("pipe", EastStruct({"left": left, "right": right})), self._start(left))
        return left

    def _parse_comma(self) -> JqNode:
        left = self._parse_binding()
        while self._is_op(","):
            self._next()
            right = self._parse_binding()
            left = self._mk(node("comma", EastStruct({"left": left, "right": right})), self._start(left))
        return left

    def _parse_binding(self) -> JqNode:
        """``def f: body; rest``, ``label $name | body``, ``source as $p | body``, or an expression."""
        t = self._peek()
        if t is not None and t.role == "keyword" and t.value == "def":
            self._next()
            name_token = self._peek()
            if name_token is None or name_token.role != "ident":
                raise self.unexpected("a function name")
            self._next()
            params: list[str] = []
            if self._is_punct("("):
                self._next()
                while True:
                    param = self._peek()
                    if param is not None and param.role == "variable":
                        params.append(f"${param.value}")
                    elif param is not None and param.role == "ident":
                        params.append(param.value)
                    else:
                        raise self.unexpected("a parameter (name or $name)")
                    self._next()
                    if self._is_punct(";"):
                        self._next()
                        continue
                    self._expect_punct(")", '";" or ")"')
                    break
            self._expect_punct(":")
            body = self.parse_query()
            self._expect_punct(";", '";" after the definition')
            rest = self.parse_query()
            return self._mk(node("def", EastStruct({
                "body": body, "name": name_token.value, "params": params, "rest": rest})), t.from_)
        if t is not None and t.role == "keyword" and t.value == "label":
            self._next()
            name = self._expect_variable("a label ($name)")
            if not self._is_op("|"):
                raise self.unexpected('"|"')
            self._pipe_then_filter()
            body = self.parse_query()
            return self._mk(node("label", EastStruct({"body": body, "name": name})), t.from_)
        source = self._parse_expr()
        if self._is_keyword("as"):
            self._next()
            patterns = [self._parse_pattern()]
            while self._is_op("?//"):
                self._next()
                patterns.append(self._parse_pattern())
            if not self._is_op("|"):
                raise self.unexpected('"|" or "?//"')
            self._pipe_then_filter()
            body = self.parse_query()
            return self._mk(node("bind", EastStruct({
                "body": body, "patterns": patterns, "source": source})), self._start(source))
        return source

    def _parse_expr(self) -> JqNode:
        """An expression: ``//`` and below."""
        left = self._parse_update()
        if self._is_op("//"):
            self._next()
            right = self._parse_expr()
            return self._mk(node("alternative", EastStruct({"left": left, "right": right})), self._start(left))
        return left

    def _parse_update(self) -> JqNode:
        """Update-assignment, non-associative."""
        path = self._parse_or()
        t = self._peek()
        if t is not None and t.role == "op" and t.value in _UPDATE_OPS:
            self._next()
            value = self._parse_or()
            again = self._peek()
            if again is not None and again.role == "op" and again.value in _UPDATE_OPS:
                raise self.unexpected(f'parentheses around one side of "{t.value}"')
            return self._mk(node("update", EastStruct({"op": t.value, "path": path, "value": value})),
                            self._start(path))
        return path

    def _parse_or(self) -> JqNode:
        left = self._parse_and()
        while self._is_keyword("or"):
            self._next()
            right = self._parse_and()
            left = self._mk(node("binary", EastStruct({"left": left, "op": "or", "right": right})), self._start(left))
        return left

    def _parse_and(self) -> JqNode:
        left = self._parse_comparison()
        while self._is_keyword("and"):
            self._next()
            right = self._parse_comparison()
            left = self._mk(node("binary", EastStruct({"left": left, "op": "and", "right": right})),
                            self._start(left))
        return left

    def _parse_comparison(self) -> JqNode:
        """Comparisons, non-associative."""
        left = self._parse_additive()
        t = self._peek()
        if t is not None and t.role == "op" and t.value in _COMPARISON_OPS:
            self._next()
            right = self._parse_additive()
            again = self._peek()
            if again is not None and again.role == "op" and again.value in _COMPARISON_OPS:
                raise self.unexpected(f'parentheses around one side of "{t.value}"')
            return self._mk(node("binary", EastStruct({"left": left, "op": t.value, "right": right})),
                            self._start(left))
        return left

    def _parse_additive(self) -> JqNode:
        left = self._parse_multiplicative()
        while True:
            t = self._peek()
            if t is None or t.role != "op" or t.value not in ("+", "-"):
                return left
            self._next()
            right = self._parse_multiplicative()
            left = self._mk(node("binary", EastStruct({"left": left, "op": t.value, "right": right})),
                            self._start(left))

    def _parse_multiplicative(self) -> JqNode:
        left = self._parse_term()
        while True:
            t = self._peek()
            if t is None or t.role != "op" or t.value not in ("*", "/", "%"):
                return left
            self._next()
            right = self._parse_term()
            left = self._mk(node("binary", EastStruct({"left": left, "op": t.value, "right": right})),
                            self._start(left))

    def _parse_term(self) -> JqNode:
        """A term: ``-`` over a term, or a postfix term."""
        t = self._peek()
        if t is not None and t.role == "op" and t.value == "-":
            self._next()
            operand = self._parse_term()
            return self._mk(node("negate", operand), t.from_)
        return self._parse_postfix()

    def _parse_postfix(self) -> JqNode:
        """A primary term and its postfix operators."""
        start = self._peek()
        n = self._parse_primary()
        # `try` takes every postfix operator into its body or handler.
        if start is not None and start.role == "keyword" and start.value == "try":
            return n
        begin = self._start(n)
        while True:
            t = self._peek()
            if t is not None and t.role == "field":
                self._next()
                optional = self._eat_optional()
                n = self._mk(node("field", EastStruct({"name": t.value, "optional": optional, "target": n})), begin)
            elif self._is_punct(".") and self._peek(1) is not None and self._peek(1).role in ("string_start", "format"):  # type: ignore[union-attr]
                self._next()
                n = self._field_or_index(n, self._parse_key_string(), begin)
            elif self._is_punct(".") and self._is_punct("[", 1):
                self._next()
                n = self._parse_bracket_suffix(n, begin)
            elif self._is_punct("["):
                n = self._parse_bracket_suffix(n, begin)
            elif self._is_op("?"):
                self._next()
                n = self._mk(node("try", EastStruct({"body": n, "catch": none})), begin)
            else:
                return n

    def _eat_optional(self) -> bool:
        if not self._is_op("?"):
            return False
        self._next()
        return True

    def _field_or_index(self, target: JqNode, key: _StringTerm, begin: int) -> JqNode:
        """``t."name"`` is a field; ``t."a\\(f)"`` indexes by the string."""
        optional = self._eat_optional()
        if key.constant is not None:
            return self._mk(node("field", EastStruct({"name": key.constant, "optional": optional, "target": target})),
                            begin)
        return self._mk(node("index", EastStruct({"index": key.node, "optional": optional, "target": target})), begin)

    def _parse_bracket_suffix(self, target: JqNode, begin: int) -> JqNode:
        """``t[]``, ``t[e]``, ``t[a:b]``, ``t[a:]``, ``t[:b]``, each with an optional ``?``."""
        self._expect_punct("[")
        if self._is_punct("]"):
            self._next()
            optional = self._eat_optional()
            return self._mk(node("iterate", EastStruct({"optional": optional, "target": target})), begin)
        if self._is_punct(":"):
            self._next()
            to = self.parse_query()
            self._expect_punct("]")
            optional = self._eat_optional()
            return self._mk(node("slice", EastStruct({
                "from": none, "optional": optional, "target": target, "to": some(to)})), begin)
        index = self.parse_query()
        if self._is_punct(":"):
            self._next()
            if self._is_punct("]"):
                self._next()
                optional = self._eat_optional()
                return self._mk(node("slice", EastStruct({
                    "from": some(index), "optional": optional, "target": target, "to": none})), begin)
            to = self.parse_query()
            self._expect_punct("]")
            optional = self._eat_optional()
            return self._mk(node("slice", EastStruct({
                "from": some(index), "optional": optional, "target": target, "to": some(to)})), begin)
        self._expect_punct("]", '"]" or ":"')
        optional = self._eat_optional()
        return self._mk(node("index", EastStruct({"index": index, "optional": optional, "target": target})), begin)

    def _parse_primary(self) -> JqNode:
        """A primary term."""
        t = self._peek()
        if t is None:
            raise self.unexpected("a filter")
        role = t.role
        if role == "field":
            self._next()
            # `.name` reads the field of `.`, whose text is the dot.
            identity = node("identity")
            self._set_range(identity, t.from_, t.from_ + 1)
            optional = self._eat_optional()
            return self._mk(node("field", EastStruct({"name": t.value, "optional": optional, "target": identity})),
                            t.from_)
        if role == "number":
            self._next()
            return self._mk(self._number_literal(t), t.from_)
        if role in ("string_start", "format"):
            return self._parse_string_term().node
        if role == "variable":
            self._next()
            return self._mk(node("variable", t.value), t.from_)
        if role == "loc":
            self._next()
            return self._mk(node("variable", "__loc__"), t.from_)
        if role == "ident":
            return self._parse_identifier(t)
        if role == "punct":
            return self._parse_punctuation(t)
        if role == "keyword":
            return self._parse_keyword_term(t)
        raise self.unexpected("a filter")

    def _parse_punctuation(self, t: JqLexeme) -> JqNode:
        v = t.value
        if v == ".":
            self._next()
            identity = self._mk(node("identity"), t.from_)
            after = self._peek()
            if after is not None and after.role in ("string_start", "format"):
                return self._field_or_index(identity, self._parse_key_string(), t.from_)
            return identity
        if v == "..":
            self._next()
            return self._mk(node("descend"), t.from_)
        if v == "(":
            self._next()
            inner = self.parse_query()
            self._expect_punct(")")
            # The node's own span leaves out its parentheses; a node built on
            # it starts at the outermost `(`.
            self._opens[id(inner)] = t.from_
            self._alive.append(inner)
            return inner
        if v == "[":
            self._next()
            if self._is_punct("]"):
                self._next()
                return self._mk(node("array", none), t.from_)
            body = self.parse_query()
            self._expect_punct("]")
            return self._mk(node("array", some(body)), t.from_)
        if v == "{":
            return self._parse_object(t)
        raise self.unexpected("a filter")

    def _parse_identifier(self, t: JqLexeme) -> JqNode:
        self._next()
        if not self._is_punct("("):
            if t.value == "null":
                return self._mk(node("literal", variant("null", None, JqLiteralType)), t.from_)
            if t.value == "true":
                return self._mk(node("literal", variant("boolean", True, JqLiteralType)), t.from_)
            if t.value == "false":
                return self._mk(node("literal", variant("boolean", False, JqLiteralType)), t.from_)
            return self._mk(node("call", EastStruct({"args": [], "name": t.value})), t.from_)
        self._next()
        args = [self.parse_query()]
        while self._is_punct(";"):
            self._next()
            args.append(self.parse_query())
        self._expect_punct(")", '";" or ")"')
        return self._mk(node("call", EastStruct({"args": args, "name": t.value})), t.from_)

    def _parse_keyword_term(self, t: JqLexeme) -> JqNode:
        v = t.value
        if v == "reduce":
            self._next()
            source = self._parse_expr()
            self._expect_keyword("as")
            pattern = self._parse_pattern()
            self._expect_punct("(")
            init = self.parse_query()
            self._expect_punct(";")
            update = self.parse_query()
            self._expect_punct(")")
            return self._mk(node("reduce", EastStruct({
                "init": init, "pattern": pattern, "source": source, "update": update})), t.from_)
        if v == "foreach":
            self._next()
            source = self._parse_expr()
            self._expect_keyword("as")
            pattern = self._parse_pattern()
            self._expect_punct("(")
            init = self.parse_query()
            self._expect_punct(";")
            update = self.parse_query()
            extract = none
            if self._is_punct(";"):
                self._next()
                extract = some(self.parse_query())
            self._expect_punct(")", '";" or ")"')
            return self._mk(node("foreach", EastStruct({
                "extract": extract, "init": init, "pattern": pattern, "source": source, "update": update})), t.from_)
        if v == "if":
            self._next()
            branches: list[EastStruct] = []
            condition = self.parse_query()
            self._expect_keyword("then")
            branches.append(EastStruct({"condition": condition, "then": self.parse_query()}))
            otherwise = none
            while True:
                if self._is_keyword("elif"):
                    self._next()
                    condition = self.parse_query()
                    self._expect_keyword("then")
                    branches.append(EastStruct({"condition": condition, "then": self.parse_query()}))
                elif self._is_keyword("else"):
                    self._next()
                    otherwise = some(self.parse_query())
                    self._expect_keyword("end")
                    break
                elif self._is_keyword("end"):
                    self._next()
                    break
                else:
                    raise self.unexpected('"elif", "else" or "end"')
            return self._mk(node("if", EastStruct({"branches": branches, "otherwise": otherwise})), t.from_)
        if v == "try":
            self._next()
            body = self._parse_term()
            handler = none
            if self._is_keyword("catch"):
                self._next()
                handler = some(self._parse_term())
            return self._mk(node("try", EastStruct({"body": body, "catch": handler})), t.from_)
        if v == "break":
            self._next()
            name = self._expect_variable("a label ($name)")
            return self._mk(node("break", name), t.from_)
        if v in _MODULE_KEYWORDS:
            raise _JqSyntaxError(
                diagnostic(self.text, "unsupported", t,
                           f"unsupported: {v} is excluded — queries are deterministic and have no host access."),
                self.at,
            )
        raise self.unexpected("a filter")

    def _number_literal(self, t: JqLexeme) -> JqNode:
        """A number literal: an Integer when written without ``.`` or an exponent."""
        if _DIGITS.fullmatch(t.value):
            value = int(t.value)
            if value > _INTEGER_MAX:
                raise _JqSyntaxError(diagnostic(
                    self.text, "syntax", t,
                    f"syntax: {t.value} is too large for an Integer; write {t.value}.0 for a Float."), self.at - 1)
            return node("literal", variant("integer", value, JqLiteralType))
        f = float(t.value)
        if f in (float("inf"), float("-inf")):
            raise _JqSyntaxError(diagnostic(self.text, "syntax", t, f"syntax: {t.value} is too large for a Float."),
                                 self.at - 1)
        return node("literal", variant("float", f, JqLiteralType))

    def _parse_key_string(self) -> _StringTerm:
        """A string naming a field or a key: ``@format`` must be followed by its string there, as in jq."""
        t = self._peek()
        assert t is not None
        after = self._peek(1)
        if t.role == "format" and (after is None or after.role != "string_start"):
            self._next()
            raise self.unexpected(f"a string after @{t.value}")
        return self._parse_string_term()

    def _parse_string_term(self) -> _StringTerm:
        """A string, with an optional ``@format`` before it, or a bare ``@format``."""
        t = self._peek()
        assert t is not None
        if t.role == "format":
            self._next()
            after = self._peek()
            if after is None or after.role != "string_start":
                return _StringTerm(None, self._mk(node("format", EastStruct({"name": t.value, "string": none})),
                                                  t.from_))
            string = self._parse_string()
            return _StringTerm(None, self._mk(node("format", EastStruct({
                "name": t.value, "string": some(string.node)})), t.from_))
        return self._parse_string()

    def _parse_string(self) -> _StringTerm:
        """A string: a constant, or a ``string`` node when it interpolates."""
        start = self._peek()
        if start is None or start.role != "string_start":
            raise self.unexpected("a string")
        self._next()
        parts: list[EastVariant] = []
        text = ""
        while True:
            t = self._next()
            if t.role == "string_text":
                text += t.value
            elif t.role == "interp_start":
                if text != "":
                    parts.append(node("text", from_utf16(text)))
                text = ""
                inner = self.parse_query()
                after = self._peek()
                if after is None or after.role != "interp_end":
                    raise self.unexpected('")" to close the interpolation')
                self._next()
                parts.append(node("interpolate", inner))
            else:
                break  # string_end: the lexer and the bracket check guarantee it
        if not parts:
            constant = from_utf16(text)
            return _StringTerm(constant, self._mk(node("literal", variant("string", constant, JqLiteralType)),
                                                  start.from_))
        if text != "":
            parts.append(node("text", from_utf16(text)))
        return _StringTerm(None, self._mk(node("string", parts), start.from_))

    def _parse_object(self, opener: JqLexeme) -> JqNode:
        """``{…}``: literal keys build Structs, computed keys Dicts."""
        self._next()
        entries: list[EastStruct] = []
        if self._is_punct("}"):
            self._next()
            return self._mk(node("object", entries), opener.from_)
        while True:
            entries.append(self._parse_object_entry())
            if self._is_op(","):
                self._next()
                if self._is_punct("}"):
                    self._next()
                    break
                continue
            self._expect_punct("}", '"," or "}"')
            break
        return self._mk(node("object", entries), opener.from_)

    def _parse_object_entry(self) -> EastStruct:
        t = self._peek()
        value_required = False
        if t is not None and t.role in ("ident", "keyword"):
            self._next()
            key = node("name", t.value)
        elif t is not None and t.role in ("string_start", "format"):
            term = self._parse_key_string()
            key = node("name", term.constant) if term.constant is not None else node("computed", term.node)
        elif t is not None and t.role == "variable":
            self._next()
            key = node("variable", t.value)
        elif t is not None and t.role == "loc":
            self._next()
            return EastStruct({"key": node("variable", "__loc__"), "value": none})
        elif t is not None and t.role == "punct" and t.value == "(":
            self._next()
            computed = self.parse_query()
            self._expect_punct(")")
            key = node("computed", computed)
            value_required = True
        else:
            raise self.unexpected("a key")
        if not self._is_punct(":"):
            if value_required:
                raise self.unexpected('":"')
            return EastStruct({"key": key, "value": none})
        self._next()
        return EastStruct({"key": key, "value": some(self._parse_object_value())})

    def _parse_object_value(self) -> JqNode:
        """An object's value: an expression, or expressions piped."""
        left = self._parse_expr()
        if self._is_op("|"):
            self._pipe_then_filter()
            right = self._parse_object_value()
            return self._mk(node("pipe", EastStruct({"left": left, "right": right})), self._start(left))
        return left

    def _parse_pattern(self) -> JqPattern:
        """A destructuring pattern."""
        t = self._peek()
        if t is not None and t.role == "variable":
            self._next()
            return self._mk(node("variable", t.value), t.from_)
        if t is not None and t.role == "punct" and t.value == "[":
            self._next()
            items = [self._parse_pattern()]
            while self._is_op(","):
                self._next()
                items.append(self._parse_pattern())
            self._expect_punct("]", '"," or "]"')
            return self._mk(node("array", items), t.from_)
        if t is not None and t.role == "punct" and t.value == "{":
            self._next()
            entries = [self._parse_object_pattern_entry()]
            while self._is_op(","):
                self._next()
                entries.append(self._parse_object_pattern_entry())
            self._expect_punct("}", '"," or "}"')
            return self._mk(node("object", entries), t.from_)
        raise self.unexpected("a pattern ($name, [...] or {...})")

    def _parse_object_pattern_entry(self) -> EastStruct:
        t = self._peek()
        if t is not None and t.role == "variable":
            self._next()
            if self._is_punct(":"):
                colon = self._peek()
                assert colon is not None
                raise _JqSyntaxError(diagnostic(
                    self.text, "syntax", JqRange(t.from_, colon.to),
                    f'syntax: "${t.value}: pattern" is not supported; write "{t.value}: pattern" '
                    f"and bind ${t.value} separately."), self.at)
            return EastStruct({"key": t.value, "value": none})
        if t is not None and t.role in ("ident", "keyword"):
            self._next()
            key = t.value
        elif t is not None and t.role in ("string_start", "format"):
            term = self._parse_key_string()
            if term.constant is None:
                raise self._computed_pattern_key(self._from(term.node))
            key = term.constant
        elif t is not None and t.role == "punct" and t.value == "(":
            raise self._computed_pattern_key(t.from_)
        else:
            raise self.unexpected("a key")
        self._expect_punct(":")
        return EastStruct({"key": key, "value": some(self._parse_pattern())})

    def _computed_pattern_key(self, start: int) -> _JqSyntaxError:
        return _JqSyntaxError(diagnostic(
            self.text, "syntax", JqRange(start, max(start + 1, self._last_end)),
            "syntax: computed keys in patterns are not supported (#875 Defer)."), self.at)


def _next_top_level_pipe(toks: list[JqLexeme], failed: int) -> int | None:
    """The index after which parsing resumes following a problem at ``failed``.

    The next ``|`` outside every bracket, ``if … end`` and ``def … ;``, or
    ``None`` when there is none.
    """
    opened: list[str] = []
    for i, t in enumerate(toks):
        if i > failed and not opened and t.role == "op" and t.value == "|":
            return i
        if (t.role == "punct" and t.value in _CLOSER) or t.role == "interp_start":
            opened.append(t.value)
        elif (t.role == "punct" and t.value in (")", "]", "}")) or t.role == "interp_end":
            if opened:
                opened.pop()
        elif t.role == "keyword" and t.value in ("if", "def"):
            opened.append(t.value)
        elif (t.role == "keyword" and t.value == "end" and opened and opened[-1] == "if") \
                or (t.role == "punct" and t.value == ";" and opened and opened[-1] == "def"):
            opened.pop()
    return None


def _spans_of(root: JqNode, ranges: dict[int, JqRange], length: int) -> JqSpans:
    """The spans of a program's nodes, by path, from the parser's ranges."""
    spans: JqSpans = {}

    def visit_pattern(pattern: JqPattern, path: str) -> None:
        spans[path] = ranges[id(pattern)]
        for step, child in jq_pattern_children(pattern):
            visit_pattern(child, child_path(path, step))

    def visit(n: JqNode, path: str) -> None:
        spans[path] = JqRange(0, length) if path == "" else ranges[id(n)]
        for child in jq_children(n):
            if child.node is not None:
                visit(child.node, child_path(path, child.step))
            else:
                visit_pattern(child.pattern, child_path(path, child.step))

    visit(root, "")
    return spans


def parse_jq(text: str) -> ParsedJq:
    """Parses jq text into a ``JqType`` program.

    The parser keeps jq's sugar, so printing gives back what was written:
    ``.a.b`` is two ``field`` nodes, ``.a?`` sets ``optional``, and ``f?`` is a
    ``try`` with no ``catch``. A literal is the typed East value it writes
    (``JqLiteralType``): a number written without ``.`` or an exponent is an
    Integer (64-bit; larger is a problem), any other number a Float, and a
    string without interpolation a String. ``$__loc__`` is the variable
    ``__loc__``; ``import``, ``include`` and ``module`` are ``unsupported``.

    A problem is a ``syntax`` diagnostic with its span, and a fix where one is
    obvious. After a problem the parser resumes at the next ``|`` outside
    every bracket, so one typo reports one problem.

    Args:
        text: jq 1.8 text.

    Returns:
        The program with the span of every node, or ``none`` with the problems
        that stopped it.

    Example:
        >>> parse_jq(".orders | length").spans["pipe.left"]
        JqRange(from_=0, to=7)
    """
    units = to_utf16(text)
    lexemes = scan_jq(units)
    diagnostics: list[EastStruct] = []
    for t in lexemes:
        if t.role == "unterminated":
            diagnostics.append(diagnostic(units, "syntax", t, "syntax: this string is never closed.",
                                          [fix("Close it", t.to, 0, '"')]))
        elif t.error is not None:
            diagnostics.append(diagnostic(units, "syntax", t, f"syntax: {from_utf16(t.error)}."))
    diagnostics.extend(_check_brackets(units, lexemes))
    significant = [t for t in lexemes if t.role not in ("ws", "comment")]
    if not diagnostics and not significant:
        diagnostics.append(diagnostic(units, "syntax", None, "syntax: empty program."))
    if diagnostics:
        return ParsedJq(text, none, {}, diagnostics, units)

    start = 0
    while True:
        parser = _Parser(units, significant, start)
        try:
            program = parser.parse_program()
            if start == 0:
                return ParsedJq(text, some(program), _spans_of(program, parser.ranges, len(units)), diagnostics, units)
            break
        except _JqSyntaxError as e:
            diagnostics.append(e.diagnostic)
            resume = _next_top_level_pipe(significant, max(e.token, parser.position) - 1)
            if resume is None or resume + 1 >= len(significant):
                break
            start = resume + 1
    return ParsedJq(text, none, {}, diagnostics, units)


__all__ = ["ParsedJq", "diagnostic", "fix", "node", "parse_jq"]
