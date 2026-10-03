#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The jq lexer: jq 1.8's tokens, with the spans the parser reads. The twin of ``lex.ts``.

The lexer reads the text's UTF-16 view (:func:`east.query.jq.spans.to_utf16`),
so every offset is TypeScript's; :func:`lex_jq` takes and gives python strings.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from east.query.jq.spans import from_utf16, to_utf16

#: The kind of a jq token, as the jq view highlights it (``lex.ts``'s ``JqTokenKind``).
JqTokenKind = Literal[
    "ws", "comment", "string", "variable", "field", "format", "number",
    "keyword", "builtin", "identifier", "pipe", "operator", "punctuation", "other",
]


@dataclass
class JqToken:
    """A token of jq text.

    ``from_`` and ``to`` are offsets in UTF-16 code units, ``to`` exclusive,
    and ``text`` is the token's text.
    """

    #: What the token is, for highlighting.
    kind: str
    #: Its first offset.
    from_: int
    #: The offset after its last.
    to: int
    #: Its text.
    text: str


@dataclass
class JqLexeme:
    """A token with its grammatical role and its decoded value (``lex.ts``'s ``JqLexeme``).

    ``text`` and ``value`` are UTF-16 views: ``value`` is the field, identifier
    or variable name (without ``.`` or ``$``), the format's name (without
    ``@``), a keyword, operator or punctuation's text, a number's text, or a
    string piece's decoded text. ``error`` says why a string piece's escapes
    cannot be read.
    """

    kind: str
    from_: int
    to: int
    text: str
    #: The token's role in the grammar.
    role: str
    #: The token's value, as the role reads it.
    value: str
    #: Why the token's text is not valid, when it is not.
    error: str | None = None


# The words jq reserves.
_KEYWORDS = frozenset({
    "as", "def", "if", "then", "elif", "else", "end", "reduce", "foreach", "try", "catch",
    "label", "break", "import", "include", "module", "and", "or",
})


def is_jq_keyword(word: str) -> bool:
    """Whether a word is one jq reserves, so no function or parameter can take it as a name.

    Args:
        word: The word.

    Returns:
        ``True`` for a keyword; ``not`` is a builtin, so ``False`` for it.
    """
    return word in _KEYWORDS


# A surrogate without its other half.
_LONE_SURROGATE = re.compile("[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]")


def _well_formed(text: str) -> str:
    """Replaces each lone surrogate with U+FFFD, so a string's value is well-formed UTF-16."""
    return _LONE_SURROGATE.sub("�", text)


# Operators, longest first so a scan takes the longest match.
_OPERATORS = (
    "?//", "//=", "|=", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">=", "//",
    "|", ",", "+", "-", "*", "/", "%", "<", ">", "=", "?",
)

_IDENT = re.compile(r"[a-zA-Z_][a-zA-Z_0-9]*(?:::[a-zA-Z_][a-zA-Z_0-9]*)*")
_FIELD = re.compile(r"\.[a-zA-Z_][a-zA-Z_0-9]*")
_VARIABLE = re.compile(r"\$[a-zA-Z_][a-zA-Z_0-9]*(?:::[a-zA-Z_][a-zA-Z_0-9]*)*")
_FORMAT = re.compile(r"@[a-zA-Z0-9_]+")
_NUMBER = re.compile(r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_WHITESPACE = re.compile(r"[ \t\r\n]+")
_STRING_RUN = re.compile(r'[^\\"]+')
_HEX4 = re.compile(r"[0-9a-fA-F]{4}")
_ALNUM_UP_TO_4 = re.compile(r"[a-zA-Z0-9]{0,4}")


def _match_at(pattern: re.Pattern[str], text: str, at: int) -> str | None:
    """Matches a pattern at an offset, as a sticky JavaScript regex does."""
    m = pattern.match(text, at)
    return None if m is None else m.group(0)


def _end_of_line(text: str, at: int) -> int:
    """The offset of the line break ending the line that holds ``at``, or the text's length."""
    for i in range(at, len(text)):
        if text[i] in "\n\r":
            return i
    return len(text)


def _decode_escapes(escapes: str) -> tuple[str, str | None]:
    """Decodes the escapes of a jq string, as JSON reads them.

    Args:
        escapes: One or more escapes, as a UTF-16 view.

    Returns:
        ``(text, None)`` with the decoded text, or ``("", invalid)`` with the
        first escape that cannot be read.
    """
    out: list[str] = []
    i = 0
    simple = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
    while i < len(escapes):
        c = escapes[i + 1] if i + 1 < len(escapes) else None
        if c is not None and c in simple:
            out.append(simple[c])
            i += 2
            continue
        if c == "u":
            hex_digits = escapes[i + 2:i + 6]
            if len(hex_digits) != 4 or _HEX4.fullmatch(hex_digits) is None:
                m = re.compile(r"\\u[a-zA-Z0-9]{0,4}").match(escapes, i)
                assert m is not None
                return "", m.group(0)
            out.append(chr(int(hex_digits, 16)))
            i += 6
            continue
        return "", escapes[i:i + 2]
    return _well_formed("".join(out)), None


def scan_jq(text: str) -> list[JqLexeme]:
    """Scans jq text into lexemes: every character of the text in exactly one, in order.

    Strings keep jq's lexer states: a ``\\(`` opens an interpolation that the
    matching ``)`` closes, with the brackets opened inside it balanced first. A
    string still open at the end of the text becomes one ``unterminated``
    lexeme running to the end of its first line, and scanning resumes after it
    as if the string had not begun, so the rest of the text still reads as code.

    Args:
        text: The text's UTF-16 view (:func:`east.query.jq.spans.to_utf16`).

    Returns:
        Its lexemes, their texts and values UTF-16 views.
    """
    from east.query.jq.catalog import is_jq_builtin

    out: list[JqLexeme] = []
    # Open brackets, interpolations and strings, innermost last: (kind, token index, offset).
    stack: list[tuple[str, int, int]] = []

    def push(role: str, kind: str, start: int, end: int, value: str, error: str | None = None) -> None:
        out.append(JqLexeme(kind, start, end, text[start:end], role, value, error))

    at = 0
    n = len(text)
    while True:
        if at >= n:
            opened = next((i for i, s in enumerate(stack) if s[0] == "string"), -1)
            if opened == -1:
                break
            # A string never closed: its first line is one lexeme, and what
            # follows reads as it would have without the string.
            _, token, start = stack[opened]
            del out[token:]
            del stack[opened:]
            end = _end_of_line(text, start)
            push("unterminated", "string", start, end, text[start + 1:end])
            at = end
            continue
        top = stack[-1] if stack else None
        if top is not None and top[0] == "string":
            c = text[at]
            if c == '"':
                stack.pop()
                push("string_end", "string", at, at + 1, '"')
                at += 1
            elif c == "\\" and text[at + 1:at + 2] == "(":
                stack.append(("interp", len(out), at))
                push("interp_start", "string", at, at + 2, "\\(")
                at += 2
            elif c == "\\":
                end = at
                while end < n and text[end] == "\\" and text[end + 1:end + 2] != "(" and end + 1 < n:
                    if text[end + 1] == "u":
                        m = _ALNUM_UP_TO_4.match(text[end + 2:end + 6])
                        end += 2 + (0 if m is None else len(m.group(0)))
                    else:
                        end += 2
                if end == at:
                    end = at + 1  # a backslash at the very end of the text
                decoded, invalid = _decode_escapes(text[at:end])
                if invalid is not None:
                    push("string_text", "string", at, end, "", f'invalid escape "{invalid}" in a string')
                else:
                    push("string_text", "string", at, end, decoded)
                at = end
            else:
                run = _match_at(_STRING_RUN, text, at)
                assert run is not None
                push("string_text", "string", at, at + len(run), _well_formed(run))
                at += len(run)
            continue

        c = text[at]
        ws = _match_at(_WHITESPACE, text, at)
        if ws is not None:
            push("ws", "ws", at, at + len(ws), ws)
            at += len(ws)
            continue
        if c == "#":
            end = at + 1
            while end < n:
                d = text[end]
                if d == "\\" and text[end + 1:end + 2] in ("\\", "\n") and end + 1 < n:
                    end += 2
                    continue
                if d == "\\" and text[end + 1:end + 3] == "\r\n":
                    end += 3
                    continue
                if d == "\n" or (d == "\r" and text[end + 1:end + 2] == "\n"):
                    break
                end += 1
            push("comment", "comment", at, end, text[at:end])
            at = end
            continue
        if c == '"':
            stack.append(("string", len(out), at))
            push("string_start", "string", at, at + 1, '"')
            at += 1
            continue
        if c in "([{":
            stack.append((c, len(out), at))
            push("punct", "punctuation", at, at + 1, c)
            at += 1
            continue
        if c in ")]}":
            opener = "(" if c == ")" else "[" if c == "]" else "{"
            if top is not None and top[0] == opener:
                stack.pop()
                push("punct", "punctuation", at, at + 1, c)
            elif top is not None and top[0] == "interp" and c == ")":
                stack.pop()
                push("interp_end", "string", at, at + 1, ")")
            else:
                push("punct", "punctuation", at, at + 1, c)
            at += 1
            continue
        if c == "$" and text.startswith("$__loc__", at) and len(_match_at(_VARIABLE, text, at) or "") == 8:
            push("loc", "keyword", at, at + 8, "$__loc__")
            at += 8
            continue
        variable = _match_at(_VARIABLE, text, at)
        if variable is not None:
            push("variable", "variable", at, at + len(variable), variable[1:])
            at += len(variable)
            continue
        number = _match_at(_NUMBER, text, at)
        if number is not None:
            push("number", "number", at, at + len(number), number)
            at += len(number)
            continue
        field = _match_at(_FIELD, text, at)
        if field is not None:
            push("field", "field", at, at + len(field), field[1:])
            at += len(field)
            continue
        if text.startswith("..", at):
            push("punct", "punctuation", at, at + 2, "..")
            at += 2
            continue
        if c in ".:;":
            push("punct", "punctuation", at, at + 1, c)
            at += 1
            continue
        fmt = _match_at(_FORMAT, text, at)
        if fmt is not None:
            push("format", "format", at, at + len(fmt), fmt[1:])
            at += len(fmt)
            continue
        ident = _match_at(_IDENT, text, at)
        if ident is not None:
            if ident in _KEYWORDS:
                push("keyword", "keyword", at, at + len(ident), ident)
            elif ident == "not":
                push("ident", "keyword", at, at + len(ident), ident)
            else:
                push("ident", "builtin" if is_jq_builtin(ident) else "identifier", at, at + len(ident), ident)
            at += len(ident)
            continue
        op = next((o for o in _OPERATORS if text.startswith(o, at)), None)
        if op is not None:
            push("op", "pipe" if op == "|" else "operator", at, at + len(op), op)
            at += len(op)
            continue
        # One UTF-16 code unit at a time, except a surrogate pair, which is one character.
        following = text[at + 1:at + 2]
        pair = "\ud800" <= c <= "\udbff" and following != "" and "\udc00" <= following <= "\udfff"
        width = 2 if pair else 1
        push("other", "other", at, at + width, text[at:at + width])
        at += width
    return out


def lex_jq(text: str) -> list[JqToken]:
    """Splits jq text into tokens for highlighting.

    A string's text, its quotes and the ``\\(`` / ``)`` of its interpolations
    are ``string`` tokens, merged where they touch; the tokens of an
    interpolated query keep their own kinds. A string that is never closed
    runs to the end of its first line, and the rest of the text lexes as code.

    Args:
        text: The text.

    Returns:
        Its tokens: every character of the text in exactly one, in order, with
        offsets in UTF-16 code units.

    Example:
        >>> [t.kind for t in lex_jq(".orders | length")]
        ['field', 'ws', 'pipe', 'ws', 'builtin']
    """
    units = to_utf16(text)
    tokens: list[JqToken] = []
    for lexeme in scan_jq(units):
        last = tokens[-1] if tokens else None
        if lexeme.kind == "string" and last is not None and last.kind == "string" and last.to == lexeme.from_:
            last.to = lexeme.to
        else:
            tokens.append(JqToken(lexeme.kind, lexeme.from_, lexeme.to, ""))
    for token in tokens:
        token.text = from_utf16(units[token.from_:token.to])
    return tokens


__all__ = ["JqLexeme", "JqToken", "JqTokenKind", "is_jq_keyword", "lex_jq", "scan_jq"]
