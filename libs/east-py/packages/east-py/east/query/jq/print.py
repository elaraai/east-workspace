#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The jq printer: one canonical text for every ``JqType`` program. The twin of ``print.ts``.

Every node's span is recorded in UTF-16 code units, as the parser gives them
for the same text.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from east.query.jq.lex import is_jq_keyword
from east.query.jq.literals import JqLiteral
from east.query.jq.spans import JqNode, JqPattern, JqRange, JqSpans, child_path, utf16_length
from east.serialization.east_printer import print_for
from east.types.types import BooleanType, FloatType, IntegerType

# How tightly a node binds, loosest first: one level per function of the
# parser's descent (`parse.py`).
_PIPE = 0
_COMMA = 1
_BINDING = 2
_ALTERNATIVE = 3
_UPDATE = 4
_OR = 5
_AND = 6
_COMPARISON = 7
_ADDITIVE = 8
_MULTIPLICATIVE = 9
_TERM = 10
_POSTFIX = 11

# Each binary operator's level, and the levels its operands need.
_BINARY: dict[str, tuple[int, int, int]] = {
    "or": (_OR, _OR, _AND),
    "and": (_AND, _AND, _COMPARISON),
    "==": (_COMPARISON, _ADDITIVE, _ADDITIVE),
    "!=": (_COMPARISON, _ADDITIVE, _ADDITIVE),
    "<": (_COMPARISON, _ADDITIVE, _ADDITIVE),
    "<=": (_COMPARISON, _ADDITIVE, _ADDITIVE),
    ">": (_COMPARISON, _ADDITIVE, _ADDITIVE),
    ">=": (_COMPARISON, _ADDITIVE, _ADDITIVE),
    "+": (_ADDITIVE, _ADDITIVE, _MULTIPLICATIVE),
    "-": (_ADDITIVE, _ADDITIVE, _MULTIPLICATIVE),
    "*": (_MULTIPLICATIVE, _MULTIPLICATIVE, _TERM),
    "/": (_MULTIPLICATIVE, _MULTIPLICATIVE, _TERM),
    "%": (_MULTIPLICATIVE, _MULTIPLICATIVE, _TERM),
}

_UPDATE_OPS = frozenset({"=", "|=", "+=", "-=", "*=", "/=", "%=", "//="})

# A name a field or a key is written with bare: `.name`, `{name: …}`.
_SIMPLE_NAME = re.compile(r"[a-zA-Z_][a-zA-Z_0-9]*")
# A function's or a variable's name, as the lexer reads one.
_NAME = re.compile(r"[a-zA-Z_][a-zA-Z_0-9]*(?:::[a-zA-Z_][a-zA-Z_0-9]*)*")
# A format's name, without its `@`.
_FORMAT_NAME = re.compile(r"[a-zA-Z0-9_]+")

_print_boolean = print_for(BooleanType)
_print_integer = print_for(IntegerType)
_print_float = print_for(FloatType)


def json_string(value: str) -> str:
    """A string in jq's syntax, which is JSON's: the twin of TypeScript's ``jsonString`` (``literals.ts``).

    jq's string literal is a JSON string. East's text printer, in every
    runtime, escapes only a backslash and a quote and leaves control characters
    as they are, which a jq string cannot hold, so it is not used here.
    """
    return json.dumps(value, ensure_ascii=False)


@dataclass
class PrintedJq:
    """A printed jq program."""

    #: The canonical text.
    text: str
    #: Where each node of the program is in the text, by its path, as ``parse_jq`` gives them for the same text.
    spans: JqSpans


@dataclass(frozen=True)
class _Literal:
    """A literal's text and how it prints."""

    #: Its East type's name.
    type: str
    #: Its jq text.
    text: str
    #: Whether the text starts with `-`, so it binds as a negation.
    negative: bool
    #: Whether it is an Integer's digits, which a `.name` after would read as a Float's point.
    digits: bool


def _literal_of(literal: JqLiteral) -> _Literal:
    """The jq text of a literal, as East prints the value."""
    kind = literal.type
    value = literal.value
    if kind == "null":
        return _Literal("Null", "null", False, False)
    if kind == "boolean":
        return _Literal("Boolean", _print_boolean(value), False, False)
    if kind == "integer":
        text = _print_integer(value)
        negative = text.startswith("-")
        return _Literal("Integer", text, negative, not negative)
    if kind == "float":
        # East prints an integral Float with its `.0`, so it reads back as a
        # Float; jq writes the values East prints as NaN and Infinity with its
        # builtins.
        printed = _print_float(value)
        text = {"NaN": "nan", "Infinity": "infinite", "-Infinity": "-infinite"}.get(printed, printed)
        return _Literal("Float", text, text.startswith("-"), False)
    if kind == "string":
        return _Literal("String", json_string(value), False, False)
    raise ValueError(f"printJq: a jq literal has no case {kind}")


def _check_name(ok: bool, what: str, name: str) -> None:
    """Checks a name before printing it, so a program never prints as text that reads back as another."""
    if not ok:
        raise ValueError(f"printJq: {json_string(name)} is not a jq {what}")


def _is(pattern: re.Pattern[str], text: str) -> bool:
    return pattern.fullmatch(text) is not None


class _Printer:
    """Prints one program, recording each node's span as it goes."""

    def __init__(self, pipeline: bool) -> None:
        self.pipeline = pipeline
        self.parts: list[str] = []
        #: The text's length so far, in UTF-16 code units.
        self.length = 0
        self.spans: JqSpans = {}
        #: Each literal's text, by the literal's id, the literal held beside it. An id is unique only among the
        #: objects alive, and a decoded program makes the nodes under an array part (a call's arguments, an
        #: object's entries) afresh each time they are read, so a literal printed earlier can be gone, its id
        #: another literal's: each entry keeps its literal alive for as long as the printer is.
        self._literals: dict[int, tuple[JqLiteral, _Literal]] = {}

    def emit(self, s: str) -> None:
        self.parts.append(s)
        self.length += utf16_length(s)

    def literal(self, value: JqLiteral) -> _Literal:
        held = self._literals.get(id(value))
        if held is not None and held[0] is value:
            return held[1]
        lit = _literal_of(value)
        self._literals[id(value)] = (value, lit)
        return lit

    def postfix_try(self, body: JqNode) -> bool:
        """Whether a ``try`` without ``catch`` prints its body with a ``?`` after it."""
        if body.type in ("call", "variable", "string", "format", "array", "object", "reduce", "foreach", "if"):
            return True
        if body.type == "literal":
            return not self.literal(body.value).negative
        return False

    def open_try(self, n: JqNode) -> bool:
        """Whether a node prints as ``try body`` with no ``catch``: it would take a ``catch`` that followed it."""
        return n.type == "try" and n.value["catch"].type == "none" and not self.postfix_try(n.value["body"])

    def level(self, n: JqNode) -> int:
        kind = n.type
        if kind == "pipe":
            return _PIPE
        if kind == "comma":
            return _COMMA
        if kind in ("bind", "def", "label"):
            return _BINDING
        if kind == "alternative":
            return _ALTERNATIVE
        if kind == "update":
            return _UPDATE
        if kind == "binary":
            return self.binary(n.value["op"])[0]
        if kind == "negate":
            return _TERM
        if kind == "try":
            return _POSTFIX if n.value["catch"].type == "none" and self.postfix_try(n.value["body"]) else _TERM
        if kind == "literal":
            return _TERM if self.literal(n.value).negative else _POSTFIX
        return _POSTFIX

    def binary(self, op: str) -> tuple[int, int, int]:
        levels = _BINARY.get(op)
        if levels is None:
            raise ValueError(f"printJq: {json_string(op)} is not a jq binary operator")
        return levels

    def program(self, program: JqNode) -> None:
        if self.pipeline:
            self.spine(program, "")
        else:
            self.node(program, "", _PIPE, True)

    def node(self, n: JqNode, path: str, min_level: int, is_open: bool, before_catch: bool = False) -> None:
        """Prints a node where the grammar needs at least ``min_level``, in parentheses when it binds more loosely."""
        level = self.level(n)
        if level < min_level or (level == _BINDING and not is_open) or (before_catch and self.open_try(n)):
            self.emit("(")
            self.bare(n, path, True, False, False)
            self.emit(")")
        else:
            self.bare(n, path, is_open, before_catch, False)

    def chain(self, n: JqNode, path: str, is_open: bool, spine: bool) -> None:
        """A pipe chain's continuation: on the spine in the pipeline layout."""
        if spine:
            self.spine(n, path)
        else:
            self.node(n, path, _PIPE, is_open)

    def spine(self, n: JqNode, path: str) -> None:
        """A node on the pipeline layout's spine: the top-level chain."""
        if n.type in ("pipe", "bind", "label", "def"):
            self.bare(n, path, True, False, True)
        else:
            self.node(n, path, _PIPE, True)

    def target(self, n: JqNode, path: str, is_field: bool) -> None:
        """The target of a postfix operator, in parentheses when a postfix would not read as applying to it."""
        if (self.level(n) < _POSTFIX or n.type == "descend"
                or (is_field and n.type == "literal" and self.literal(n.value).digits)):
            self.emit("(")
            self.bare(n, path, True, False, False)
            self.emit(")")
        else:
            self.bare(n, path, True, False, False)

    def object_value(self, n: JqNode, path: str) -> None:
        """An object's value: pipes of expressions, as jq's object values are."""
        if n.type != "pipe":
            self.node(n, path, _ALTERNATIVE, False)
            return
        start = self.length
        self.node(n.value["left"], child_path(path, "pipe.left"), _ALTERNATIVE, False)
        self.emit(" | ")
        self.object_value(n.value["right"], child_path(path, "pipe.right"))
        self.spans[path] = JqRange(start, self.length)

    def bare(self, n: JqNode, path: str, is_open: bool, before_catch: bool, spine: bool) -> None:  # noqa: C901
        """A node's own text, without parentheses around it."""
        start = self.length

        def at(step: str) -> str:
            return child_path(path, step)

        kind = n.type
        v = n.value
        if kind == "pipe":
            self.node(v["left"], at("pipe.left"), _COMMA, False)
            self.emit("\n| " if spine else " | ")
            self.chain(v["right"], at("pipe.right"), is_open, spine)
        elif kind == "comma":
            self.node(v["left"], at("comma.left"), _COMMA, False)
            self.emit(", ")
            self.node(v["right"], at("comma.right"), _BINDING, is_open)
        elif kind == "bind":
            patterns = v["patterns"]
            if len(patterns) == 0:
                raise ValueError("printJq: an `as` with no pattern")
            self.node(v["source"], at("bind.source"), _ALTERNATIVE, False)
            self.emit(" as ")
            for i, pattern in enumerate(patterns):
                if i > 0:
                    self.emit(" ?// ")
                self.pattern(pattern, at(f"bind.patterns[{i}]"))
            self.emit("\n| " if spine else " | ")
            self.chain(v["body"], at("bind.body"), is_open, spine)
        elif kind == "label":
            name = v["name"]
            _check_name(_is(_NAME, name) and name != "__loc__", "label", name)
            self.emit(f"label ${name}")
            self.emit("\n| " if spine else " | ")
            self.chain(v["body"], at("label.body"), is_open, spine)
        elif kind == "def":
            name = v["name"]
            params = list(v["params"])
            _check_name(_is(_NAME, name) and not is_jq_keyword(name), "function name", name)
            for param in params:
                bare_name = param[1:] if param.startswith("$") else param
                _check_name(_is(_NAME, bare_name)
                            and (bare_name != "__loc__" if param.startswith("$") else not is_jq_keyword(bare_name)),
                            "parameter", param)
            self.emit(f"def {name}{'(' + '; '.join(params) + ')' if params else ''}: ")
            self.node(v["body"], at("def.body"), _PIPE, True)
            self.emit(";\n" if spine else "; ")
            self.chain(v["rest"], at("def.rest"), is_open, spine)
        elif kind == "alternative":
            self.node(v["left"], at("alternative.left"), _UPDATE, False)
            self.emit(" // ")
            self.node(v["right"], at("alternative.right"), _ALTERNATIVE, False)
        elif kind == "update":
            op = v["op"]
            if op not in _UPDATE_OPS:
                raise ValueError(f"printJq: {json_string(op)} is not a jq update operator")
            self.node(v["path"], at("update.path"), _OR, False)
            self.emit(f" {op} ")
            self.node(v["value"], at("update.value"), _OR, False)
        elif kind == "binary":
            _, left, right = self.binary(v["op"])
            self.node(v["left"], at("binary.left"), left, False)
            self.emit(f" {v['op']} ")
            self.node(v["right"], at("binary.right"), right, False)
        elif kind == "negate":
            operand = v
            self.emit("-")
            # `- -1`, not `--1`: a minus the operand starts with stays apart.
            unparenthesised = self.level(operand) >= _TERM and not (before_catch and self.open_try(operand))
            if unparenthesised and (operand.type == "negate"
                                    or (operand.type == "literal" and self.literal(operand.value).negative)):
                self.emit(" ")
            self.node(operand, at("negate"), _TERM, True, before_catch)
        elif kind == "try":
            body = v["body"]
            handler = v["catch"]
            if handler.type == "some":
                self.emit("try ")
                self.node(body, at("try.body"), _TERM, True, True)
                self.emit(" catch ")
                self.node(handler.value, at("try.catch.some"), _TERM, True, before_catch)
            elif self.postfix_try(body):
                self.node(body, at("try.body"), _POSTFIX, True)
                self.emit("?")
            else:
                self.emit("try ")
                self.node(body, at("try.body"), _TERM, True)
        elif kind == "field":
            name = v["name"]
            target = v["target"]
            if target.type == "identity":
                # `.name`: the target's text is the dot.
                self.spans[at("field.target")] = JqRange(self.length, self.length + 1)
            else:
                self.target(target, at("field.target"), True)
            self.emit(f".{name if _is(_SIMPLE_NAME, name) else json_string(name)}{'?' if v['optional'] else ''}")
        elif kind == "index":
            self.target(v["target"], at("index.target"), False)
            self.emit("[")
            self.node(v["index"], at("index.index"), _PIPE, True)
            self.emit("]?" if v["optional"] else "]")
        elif kind == "iterate":
            self.target(v["target"], at("iterate.target"), False)
            self.emit("[]?" if v["optional"] else "[]")
        elif kind == "slice":
            self.target(v["target"], at("slice.target"), False)
            self.emit("[")
            if v["from"].type == "some":
                self.node(v["from"].value, at("slice.from.some"), _PIPE, True)
            self.emit(":")
            if v["to"].type == "some":
                self.node(v["to"].value, at("slice.to.some"), _PIPE, True)
            self.emit("]?" if v["optional"] else "]")
        elif kind == "call":
            args = v["args"]
            name = v["name"]
            _check_name(_is(_NAME, name) and not is_jq_keyword(name)
                        and not (len(args) == 0 and name in ("null", "true", "false")), "function name", name)
            self.emit(name)
            if len(args) > 0:
                self.emit("(")
                for i, arg in enumerate(args):
                    if i > 0:
                        self.emit("; ")
                    self.node(arg, at(f"call.args[{i}]"), _PIPE, True)
                self.emit(")")
        elif kind == "literal":
            self.emit(self.literal(v).text)
        elif kind == "variable":
            _check_name(_is(_NAME, v), "variable", v)
            self.emit(f"${v}")
        elif kind == "break":
            _check_name(_is(_NAME, v) and v != "__loc__", "label", v)
            self.emit(f"break ${v}")
        elif kind == "identity":
            self.emit(".")
        elif kind == "descend":
            self.emit("..")
        elif kind == "array":
            self.emit("[")
            if v.type == "some":
                self.node(v.value, at("array.some"), _PIPE, True)
            self.emit("]")
        elif kind == "object":
            self.emit("{")
            for i, entry in enumerate(v):
                if i > 0:
                    self.emit(", ")
                key = entry["key"]
                if key.type == "name":
                    self.emit(key.value if _is(_SIMPLE_NAME, key.value) else json_string(key.value))
                elif key.type == "variable":
                    _check_name(_is(_NAME, key.value) and (key.value != "__loc__" or entry["value"].type == "none"),
                                "object key variable", key.value)
                    self.emit(f"${key.value}")
                else:
                    computed = key.value
                    if computed.type == "string" or (computed.type == "format"
                                                     and computed.value["string"].type == "some"):
                        # A string with interpolations, or a format with its
                        # string, is a key as it is: `{"a\(f)": v}`, `{@base64 "x"}`.
                        self.bare(computed, at(f"object[{i}].key.computed"), True, False, False)
                    else:
                        if entry["value"].type == "none":
                            raise ValueError("printJq: a computed key `(k)` needs a value")
                        self.emit("(")
                        self.node(computed, at(f"object[{i}].key.computed"), _PIPE, True)
                        self.emit(")")
                if entry["value"].type == "some":
                    self.emit(": ")
                    self.object_value(entry["value"].value, at(f"object[{i}].value.some"))
            self.emit("}")
        elif kind == "string":
            self.emit('"')
            for i, part in enumerate(v):
                if part.type == "text":
                    self.emit(json_string(part.value)[1:-1])
                else:
                    self.emit("\\(")
                    self.node(part.value, at(f"string[{i}].interpolate"), _PIPE, True)
                    self.emit(")")
            self.emit('"')
        elif kind == "format":
            name = v["name"]
            string = v["string"]
            _check_name(_is(_FORMAT_NAME, name), "format", name)
            self.emit(f"@{name}")
            if string.type == "some":
                text = string.value
                if text.type != "string" and not (text.type == "literal" and self.literal(text.value).type == "String"):
                    raise ValueError(f"printJq: @{name} applies to a string, not a {text.type} node")
                self.emit(" ")
                self.bare(text, at("format.string.some"), True, False, False)
        elif kind in ("reduce", "foreach"):
            self.emit(f"{kind} ")
            self.node(v["source"], at(f"{kind}.source"), _ALTERNATIVE, False)
            self.emit(" as ")
            self.pattern(v["pattern"], at(f"{kind}.pattern"))
            self.emit(" (")
            self.node(v["init"], at(f"{kind}.init"), _PIPE, True)
            self.emit("; ")
            self.node(v["update"], at(f"{kind}.update"), _PIPE, True)
            if kind == "foreach" and v["extract"].type == "some":
                self.emit("; ")
                self.node(v["extract"].value, at("foreach.extract.some"), _PIPE, True)
            self.emit(")")
        elif kind == "if":
            branches = v["branches"]
            if len(branches) == 0:
                raise ValueError("printJq: an `if` with no branch")
            for i, branch in enumerate(branches):
                self.emit("if " if i == 0 else " elif ")
                self.node(branch["condition"], at(f"if.branches[{i}].condition"), _PIPE, True)
                self.emit(" then ")
                self.node(branch["then"], at(f"if.branches[{i}].then"), _PIPE, True)
            if v["otherwise"].type == "some":
                self.emit(" else ")
                self.node(v["otherwise"].value, at("if.otherwise.some"), _PIPE, True)
            self.emit(" end")
        self.spans[path] = JqRange(start, self.length)

    def pattern(self, pattern: JqPattern, path: str) -> None:
        """A destructuring pattern."""
        start = self.length
        if pattern.type == "variable":
            _check_name(_is(_NAME, pattern.value) and pattern.value != "__loc__", "variable", pattern.value)
            self.emit(f"${pattern.value}")
        elif pattern.type == "array":
            if len(pattern.value) == 0:
                raise ValueError("printJq: an array pattern with no element")
            self.emit("[")
            for i, item in enumerate(pattern.value):
                if i > 0:
                    self.emit(", ")
                self.pattern(item, child_path(path, f"array[{i}]"))
            self.emit("]")
        elif pattern.type == "object":
            if len(pattern.value) == 0:
                raise ValueError("printJq: an object pattern with no entry")
            self.emit("{")
            for i, entry in enumerate(pattern.value):
                if i > 0:
                    self.emit(", ")
                key = entry["key"]
                if entry["value"].type == "none":
                    # `$name` binds the field of its name.
                    _check_name(_is(_NAME, key) and key != "__loc__", "variable", key)
                    self.emit(f"${key}")
                else:
                    self.emit(f"{key if _is(_SIMPLE_NAME, key) else json_string(key)}: ")
                    self.pattern(entry["value"].value, child_path(path, f"object[{i}].value.some"))
            self.emit("}")
        self.spans[path] = JqRange(start, self.length)


def print_jq(program: JqNode, *, layout: Literal["line", "pipeline"] = "line") -> PrintedJq:
    """Prints a jq program as its canonical text.

    Every program has one canonical text: one space around binary operators
    and ``|``, none inside brackets; ``, `` and ``; `` between items; a field or
    key bare when it is an identifier and a JSON string otherwise; literals as
    East prints them; strings with JSON's minimal escapes; parentheses only
    where the grammar needs them; no comments. For every program the parser
    accepts, ``parse_jq(print_jq(p).text)`` gives ``p`` back, and the same spans.

    Args:
        program: The program, as ``parse_jq`` or a builder makes it.
        layout: ``line`` (the default) prints the program on one line;
            ``pipeline`` breaks the top-level pipe chain, and the bodies of
            the ``as``, ``label`` and ``def`` that lead it, one segment per line.

    Returns:
        The text, and the span of every node in it in UTF-16 code units.

    Raises:
        ValueError: When the program holds something no jq text reads back as.

    Example:
        >>> print_jq(parse_jq(".customers as $c|.orders|length # count").program.value).text
        '.customers as $c | .orders | length'
    """
    printer = _Printer(layout == "pipeline")
    printer.program(program)
    return PrintedJq("".join(printer.parts), printer.spans)


__all__ = ["PrintedJq", "json_string", "print_jq"]
