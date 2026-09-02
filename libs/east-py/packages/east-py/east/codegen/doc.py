#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The layout document the printer writes (#639): Wadler's algebra as
prettier and black realise it — the twin of ``libs/east/src/codegen/doc.ts``.

Source is built as a tree — text, line breaks, indentation, groups — and
rendered once, top down: a group prints on one line when its contents and
what follows it on that line fit :data:`LINE_WIDTH`, and breaks every line
of its own otherwise, its nested groups then taking their own turn. So
every break decision knows the remaining width, the enclosing structure
and what comes after — what a per-bracket rule over already-printed
strings cannot.

- :data:`line` is a space when its group is flat and a newline when it
  breaks; :data:`softline` is nothing or a newline; :data:`hardline` always
  breaks, and breaks every group around it (a ``def`` body is never flat).
- :func:`group` is the unit of the fits-or-breaks decision; :func:`indent`
  nests one level; :func:`if_break` prints one of two documents by the
  enclosing group's state (a trailing comma).
- :func:`choice` is prettier's conditional group: the first option that
  fits up to its first line break, else the last — how a call hugs a sole
  literal argument (``StructType([`` stays on the line, the entries break
  inside) and how a member chain decides between one line and one call
  per line. A choice is never itself broken by a hard line inside it, but
  the plain groups around it are.
- :func:`bracket` is a delimited, comma-separated list: one line when it
  fits, else one item per line with a trailing comma.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

__all__ = [
    "LINE_WIDTH", "Doc", "line", "softline", "hardline", "group", "indent", "if_break",
    "choice", "join", "bracket", "hug", "is_huggable", "call_args", "will_break", "render", "flat",
]

#: The width a line may fill before a group breaks — the repo's own linter width (ruff's ``line-length``).
LINE_WIDTH = 100


@dataclass(frozen=True, slots=True)
class Line:
    soft: bool
    hard: bool


@dataclass(slots=True)
class Group:
    contents: Doc
    break_: bool = False
    #: a literal a call hugs when it is the sole argument (see :func:`hug`)
    huggable: bool = False


@dataclass(frozen=True, slots=True)
class Indent:
    contents: Doc


@dataclass(frozen=True, slots=True)
class IfBreak:
    broken: Doc
    flat: Doc


@dataclass(frozen=True, slots=True)
class Choice:
    options: tuple


#: A document: text, a concatenation (a list), or a layout node.
Doc = str | list | Line | Group | Indent | IfBreak | Choice

#: A space when the group is flat, a newline when it breaks.
line: Doc = Line(soft=False, hard=False)
#: Nothing when the group is flat, a newline when it breaks.
softline: Doc = Line(soft=True, hard=False)
#: Always a newline; every enclosing group breaks.
hardline: Doc = Line(soft=False, hard=True)


def group(contents: Doc, force_break: bool = False) -> Doc:
    """The unit of layout: flat when it fits, else broken."""
    return Group(contents, force_break)


def indent(contents: Doc) -> Doc:
    """One indentation level deeper for the lines inside."""
    return Indent(contents)


def if_break(broken: Doc, flat_: Doc = "") -> Doc:
    """``broken`` when the enclosing group breaks, ``flat_`` otherwise."""
    return IfBreak(broken, flat_)


def choice(*options: Doc) -> Doc:
    """The first option that fits up to its first line break; else the last."""
    if not options:
        raise ValueError("choice needs at least one option")
    return Choice(tuple(options))


def join(separator: Doc, docs: list) -> Doc:
    """``docs`` with ``separator`` between them."""
    out: list = []
    for i, d in enumerate(docs):
        if i > 0:
            out.append(separator)
        out.append(d)
    return out


def bracket(open_: str, items: list, close: str, pad: str = "") -> Doc:
    """``open_`` + ``items`` + ``close``: on one line, comma-separated, when
    the group fits; else one item per line, indented, with a trailing comma,
    the close back at the enclosing indentation. ``pad`` is the space inside
    the flat brackets."""
    if not items:
        return open_ + close
    edge = softline if pad == "" else line
    return group([open_, indent([edge, join([",", line], items)]), if_break(","), edge, close])


def hug(doc: Doc) -> Doc:
    """Marks ``doc`` — a bracket group — as a literal a call hugs when it is
    the sole argument. The mark lives on the group itself: an ``id()``
    registry would outlive the document and hand its mark to whatever
    document next took the address."""
    if isinstance(doc, Group):
        doc.huggable = True
    return doc


def is_huggable(doc: Doc) -> bool:
    return isinstance(doc, Group) and doc.huggable


def call_args(items: list) -> Doc:
    """A call's argument list: a sole literal argument is hugged —
    ``StructType([`` stays on the line and the entries break inside — when
    the head fits; otherwise one argument per line."""
    if not items:
        return "()"
    broken = bracket("(", items, ")")
    if len(items) == 1 and is_huggable(items[0]):
        return choice(["(", items[0], ")"], ["(", group(items[0], True), ")"], broken)
    return broken


def will_break(doc: Doc) -> bool:
    """Whether ``doc`` holds a hard line anywhere (a ``def`` body)."""
    if isinstance(doc, str):
        return False
    if isinstance(doc, list):
        return any(will_break(d) for d in doc)
    if isinstance(doc, Line):
        return doc.hard
    if isinstance(doc, (Group, Indent)):
        return will_break(doc.contents)
    if isinstance(doc, IfBreak):
        return will_break(doc.broken) or will_break(doc.flat)
    return will_break(doc.options[0])  # a choice's first option is what it holds; the rest are its fallbacks


def _propagate(doc: Doc) -> bool:
    """Marks every group holding a hard line as broken (a hard line never
    prints flat). A choice is passed through, not marked: its options
    decide for themselves, and only its first option counts for the groups
    around it — a fallback option (a member chain expanded one call per
    line) holds hard lines by construction and must not break the
    enclosing call."""
    if isinstance(doc, str):
        return False
    if isinstance(doc, list):
        hard = False
        for d in doc:
            hard = _propagate(d) or hard
        return hard
    if isinstance(doc, Line):
        return doc.hard
    if isinstance(doc, Indent):
        return _propagate(doc.contents)
    if isinstance(doc, IfBreak):
        a = _propagate(doc.broken)
        b = _propagate(doc.flat)
        return a or b
    if isinstance(doc, Group):
        # a hard line inside breaks the group and every group around it; a
        # group broken by construction (a hug state) breaks only itself
        hard = _propagate(doc.contents)
        if hard:
            doc.break_ = True
        return hard
    first = _propagate(doc.options[0])
    for o in doc.options[1:]:
        _propagate(o)
    return first


_BREAK = 0
_FLAT = 1


def render(doc: Doc, width: float = LINE_WIDTH, unit: str = "    ") -> str:
    """Renders ``doc`` at ``width`` (``math.inf`` prints every group flat),
    ``unit`` being one indentation level."""
    _propagate(doc)
    out: list[str] = []
    pos = 0
    cmds: list[tuple[int, int, Any]] = [(0, _BREAK, doc)]
    while cmds:
        ind, mode, d = cmds.pop()
        if isinstance(d, str):
            if d:
                out.append(d)
                pos += len(d)
            continue
        if isinstance(d, list):
            cmds.extend((ind, mode, x) for x in reversed(d))
            continue
        if isinstance(d, Indent):
            cmds.append((ind + 1, mode, d.contents))
        elif isinstance(d, IfBreak):
            cmds.append((ind, mode, d.broken if mode == _BREAK else d.flat))
        elif isinstance(d, Group):
            if mode == _FLAT and not d.break_:
                cmds.append((ind, _FLAT, d.contents))
                continue
            flat_cmd = (ind, _FLAT, d.contents)
            if not d.break_ and _fits(flat_cmd, cmds, width - pos):
                cmds.append(flat_cmd)
            else:
                cmds.append((ind, _BREAK, d.contents))
        elif isinstance(d, Choice):
            first = d.options[0]
            if mode == _FLAT:
                cmds.append((ind, _FLAT, first))
                continue
            flat_cmd = (ind, _FLAT, first)
            if _fits(flat_cmd, cmds, width - pos):
                cmds.append(flat_cmd)
                continue
            for option in d.options[1:-1]:
                state = (ind, _FLAT, option)
                if _fits(state, cmds, width - pos):
                    cmds.append(state)
                    break
            else:
                cmds.append((ind, _BREAK, d.options[-1]))
        else:  # a Line
            if mode == _FLAT and not d.hard:
                if not d.soft:
                    out.append(" ")
                    pos += 1
                continue
            _trim_end(out)
            pad = unit * ind
            out.append("\n" + pad)
            pos = len(pad)
    return "".join(out)


def _fits(next_: tuple[int, int, Any], rest: list, width: float) -> bool:
    """Whether ``next_``, then what follows it up to the next line break,
    fits in ``width`` columns."""
    rest_idx = len(rest)
    cmds: list[tuple[int, Any]] = [(next_[1], next_[2])]
    while width >= 0:
        if not cmds:
            if rest_idx == 0:
                return True
            rest_idx -= 1
            r = rest[rest_idx]
            cmds.append((r[1], r[2]))
            continue
        mode, d = cmds.pop()
        if isinstance(d, str):
            width -= len(d)
            continue
        if isinstance(d, list):
            cmds.extend((mode, x) for x in reversed(d))
            continue
        if isinstance(d, Indent):
            cmds.append((mode, d.contents))
        elif isinstance(d, IfBreak):
            cmds.append((mode, d.broken if mode == _BREAK else d.flat))
        elif isinstance(d, Group):
            cmds.append((_BREAK if d.break_ else mode, d.contents))
        elif isinstance(d, Choice):
            cmds.append((mode, d.options[-1] if mode == _BREAK else d.options[0]))
        else:  # a Line
            if mode == _BREAK or d.hard:
                return True
            if not d.soft:
                width -= 1
    return False


def _trim_end(out: list[str]) -> None:
    """Drops the spaces at the end of the line being written."""
    while out:
        last = out[-1]
        trimmed = last.rstrip(" \t")
        if len(trimmed) == len(last):
            return
        if trimmed:
            out[-1] = trimmed
            return
        out.pop()


def flat(doc: Doc) -> str:
    """``doc`` on one line: every group flat."""
    return render(doc, float("inf"))
