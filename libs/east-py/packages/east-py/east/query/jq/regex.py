#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Regular expressions a query writes, checked as TypeScript's checker checks them.

TypeScript's checker builds a query's pattern with ``new RegExp`` and says why
it cannot, in V8's words, then holds it to ``validateCrossPlatformCompatible``
(``libs/east/src/expr/regex_validation.ts``). This module is the twin of both:
a syntax check of ECMAScript's pattern grammar without the ``u`` flag (with
Annex B's web-compatibility rules, as V8 reads it) that gives V8's messages,
and the cross-platform rules, so python reports the same diagnostic.
"""

from __future__ import annotations

import re
import unicodedata

from east.query.jq.spans import from_utf16, to_utf16


class _RegexSyntaxError(Exception):
    pass


def _is_id_start(c: str) -> bool:
    if c in "$_":
        return True
    return unicodedata.category(c) in ("Lu", "Ll", "Lt", "Lm", "Lo", "Nl")


def _is_id_part(c: str) -> bool:
    if c in "$_\u200c\u200d":
        return True
    return unicodedata.category(c) in ("Lu", "Ll", "Lt", "Lm", "Lo", "Nl", "Mn", "Mc", "Nd", "Pc")


class _Parser:
    """ECMAScript's pattern grammar, non-unicode, as V8 parses it: syntax only."""

    def __init__(self, pattern: str) -> None:
        self.p = pattern
        self.i = 0
        self.names: list[str] = []
        self.references: list[str] = []
        self.has_named = re.search(r"\(\?<(?![=!])", pattern) is not None

    def peek(self, ahead: int = 0) -> str | None:
        j = self.i + ahead
        return self.p[j] if j < len(self.p) else None

    def fail(self, message: str) -> _RegexSyntaxError:
        return _RegexSyntaxError(message)

    def parse(self) -> None:
        self.disjunction(top=True)
        for name in self.references:
            if name not in self.names:
                raise self.fail("Invalid named capture referenced")

    def disjunction(self, top: bool) -> None:
        while True:
            self.alternative()
            c = self.peek()
            if c == "|":
                self.i += 1
                continue
            if c == ")":
                if top:
                    raise self.fail("Unmatched ')'")
                return
            if c is None:
                if not top:
                    raise self.fail("Unterminated group")
                return

    def alternative(self) -> None:
        while True:
            c = self.peek()
            if c is None or c in "|)":
                return
            quantifiable = self.term()
            if self.quantifier_here():
                if quantifiable is None:
                    raise self.fail("Nothing to repeat")
                if quantifiable is False:
                    raise self.fail("Invalid quantifier")
                self.quantifier()

    def quantifier_here(self) -> bool:
        c = self.peek()
        if c in ("*", "+", "?"):
            return True
        return c == "{" and self.interval(consume=False) is not None

    def quantifier(self) -> None:
        c = self.peek()
        if c in ("*", "+", "?"):
            self.i += 1
        else:
            bounds = self.interval(consume=True)
            assert bounds is not None
            low, high = bounds
            if high is not None and low > high:
                raise self.fail("numbers out of order in {} quantifier")
        if self.peek() == "?":
            self.i += 1

    def interval(self, consume: bool) -> tuple[int, int | None] | None:
        m = re.compile(r"\{([0-9]+)(?:(,)([0-9]*))?\}").match(self.p, self.i)
        if m is None:
            return None
        if consume:
            self.i = m.end()
        low = int(m.group(1))
        if m.group(2) is None:
            return low, low
        return low, int(m.group(3)) if m.group(3) else None

    def term(self) -> bool | None:
        """Parses one term: whether it can be quantified (``None``: an assertion, ``False``: a lookbehind)."""
        c = self.peek()
        assert c is not None
        if c in "^$":
            self.i += 1
            return None
        if c in "*+?":
            raise self.fail("Nothing to repeat")
        if c == "{":
            if self.interval(consume=False) is not None:
                raise self.fail("Nothing to repeat")
            self.i += 1
            return True
        if c == "\\":
            return self.atom_escape()
        if c == "[":
            self.character_class()
            return True
        if c == "(":
            return self.group()
        self.i += 1
        return True

    def atom_escape(self) -> bool | None:
        self.i += 1
        c = self.peek()
        if c is None:
            raise self.fail("\\ at end of pattern")
        if c in "bB":
            self.i += 1
            return None
        if c == "k" and self.has_named:
            self.i += 1
            m = re.compile(r"<([^>]*)>").match(self.p, self.i)
            if m is None or not self.valid_name(m.group(1)):
                raise self.fail("Invalid named reference")
            self.references.append(m.group(1))
            self.i = m.end()
            return True
        self.i += 1
        return True

    def valid_name(self, name: str) -> bool:
        units = from_utf16(name)
        return units != "" and _is_id_start(units[0]) and all(_is_id_part(ch) for ch in units[1:])

    def group(self) -> bool:
        self.i += 1
        if self.peek() == "?":
            self.i += 1
            c = self.peek()
            if c == ":" or c in ("=", "!"):
                self.i += 1
                self.disjunction(top=False)
                self.i += 1
                return True
            if c == "<":
                after = self.peek(1)
                if after in ("=", "!"):
                    self.i += 2
                    self.disjunction(top=False)
                    self.i += 1
                    return False
                self.i += 1
                end = self.p.find(">", self.i)
                name = self.p[self.i:end] if end != -1 else None
                if name is None or not self.valid_name(name):
                    raise self.fail("Invalid capture group name")
                if name in self.names:
                    raise self.fail("Duplicate capture group name")
                self.names.append(name)
                self.i = end + 1
                self.disjunction(top=False)
                self.i += 1
                return True
            raise self.fail("Invalid group")
        self.disjunction(top=False)
        self.i += 1
        return True

    def class_atom(self) -> str | None:
        """One class atom: its character, or ``None`` for a class escape (``\\d``) that is no one character."""
        c = self.peek()
        if c is None:
            raise self.fail("Unterminated character class")
        if c != "\\":
            self.i += 1
            return c
        self.i += 1
        e = self.peek()
        if e is None:
            raise self.fail("\\ at end of pattern")
        self.i += 1
        if e in "dDsSwW":
            return None
        simple = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "0": "\0"}
        if e in simple and not (e == "0" and (self.peek() or "").isdigit()):
            return simple[e]
        if e == "x":
            m = re.compile(r"[0-9a-fA-F]{2}").match(self.p, self.i)
            if m is not None:
                self.i = m.end()
                return chr(int(m.group(0), 16))
            return "x"
        if e == "u":
            m = re.compile(r"[0-9a-fA-F]{4}").match(self.p, self.i)
            if m is not None:
                self.i = m.end()
                return chr(int(m.group(0), 16))
            return "u"
        if e == "c":
            letter = self.peek()
            if letter is not None and (letter.isascii() and (letter.isalnum() or letter == "_")):
                self.i += 1
                return chr(ord(letter) % 32)
            self.i -= 1
            return "\\"
        if e.isdigit():
            m = re.compile(r"[0-7]{1,2}").match(self.p, self.i) if e in "01234567" else None
            digits = e + (m.group(0) if m is not None else "")
            if m is not None:
                self.i = m.end()
            if e in "89":
                return e
            return chr(int(digits, 8) & 0xFF)
        return e

    def character_class(self) -> None:
        self.i += 1
        if self.peek() == "^":
            self.i += 1
        while True:
            c = self.peek()
            if c is None:
                raise self.fail("Unterminated character class")
            if c == "]":
                self.i += 1
                return
            first = self.class_atom()
            if self.peek() == "-" and self.peek(1) not in (None, "]"):
                self.i += 1
                second = self.class_atom()
                if first is not None and second is not None and ord(first) > ord(second):
                    raise self.fail("Range out of order in character class")


def js_regex_error(pattern: str, flags: str) -> str | None:
    """Why ``new RegExp(pattern, flags)`` throws, as TypeScript's checker quotes it.

    Args:
        pattern: The pattern, as the query wrote it.
        flags: Its flags, without ``g``.

    Returns:
        V8's message without its ``Invalid regular expression: `` prefix and
        trailing period — ``/[/: Unterminated character class`` — or ``None``
        when the pattern is valid.
    """
    if len(set(flags)) != len(flags) or any(f not in "dgimsuvy" for f in flags):
        return f"Invalid flags supplied to RegExp constructor '{flags}'"
    units = to_utf16(pattern)
    try:
        _Parser(units).parse()
    except _RegexSyntaxError as e:
        return f"/{pattern}/{flags}: {e}"
    return None


def _source(pattern: str) -> str:
    """``RegExp.prototype.source``: the pattern with ``/`` escaped outside a class, and line terminators escaped."""
    if pattern == "":
        return "(?:)"
    out: list[str] = []
    in_class = False
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == "\\" and i + 1 < len(pattern):
            out.append(pattern[i:i + 2])
            i += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        if c == "/" and not in_class:
            out.append("\\/")
        else:
            out.append({"\n": "\\n", "\r": "\\r", "\u2028": "\\u2028", "\u2029": "\\u2029"}.get(c, c))
        i += 1
    return "".join(out)


_JS_ONLY = (
    (re.compile(r"\\k<\w+>", re.ASCII), "Named backreferences \\k<name> are JavaScript-specific extensions"),
    (re.compile(r"\(\?<[=!]"), "Lookbehind assertions have inconsistent support across regex engines"),
    (re.compile(r"\\p\{.*?\}"), "Unicode property escapes \\p{...} are not consistently supported"),
    (re.compile(r"\\u\{[0-9a-fA-F]+\}"), "Extended Unicode codepoint escapes \\u{...} are JavaScript-specific"),
)
_PCRE_ONLY = (
    (re.compile(r"\(\*[A-Z_]+\)"), "PCRE control verbs (*SKIP, *FAIL, etc.) are not in the common subset"),
    (re.compile(r"\\K"), "Keep assertion \\K is PCRE-specific and not supported in JavaScript"),
    (re.compile(r"\(\?\+|\*\+|\+\+|\?\+"), "Possessive quantifiers are PCRE-specific extensions"),
    (re.compile(r"\(\?\?\)"), "Branch reset groups (?|...) are PCRE-specific extensions"),
)


def validate_cross_platform(pattern: str, flags: str) -> list[str]:
    """``validateCrossPlatformCompatible``'s errors for a pattern and its flags.

    Args:
        pattern: The pattern.
        flags: Its flags.

    Returns:
        The errors, in TypeScript's order; empty when the pattern is valid on
        every backend.
    """
    errors: list[str] = []
    for flag in "".join(sorted(flags, key="dgimsuvy".index)):
        if flag in ("g", "y", "u", "d"):
            errors.append(f"Flag '{flag}' is JavaScript-specific and not in the common PCRE subset")
    source = _source(pattern)
    # `.` in a JavaScript regex matches no line terminator, as python's does
    # not match `\n` alone: the detector over the source, whose terminators are escaped.
    for regex, message in (*_JS_ONLY, *_PCRE_ONLY):
        if regex.search(source):
            errors.append(message)
    return errors


__all__ = ["js_regex_error", "validate_cross_platform"]
