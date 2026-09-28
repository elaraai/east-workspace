#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Where the nodes of a jq program are in its text: the twin of ``spans.ts``.

A ``JqType`` value is an East value and carries no positions, so the parser
and the printer return them beside it: a map from each node's path in the tree
to its range of text.

Spans count UTF-16 code units, as TypeScript indexes strings (#919). The front
end works on a *UTF-16 view* of the text — :func:`to_utf16` writes each
character outside the Basic Multilingual Plane as its two surrogates — so every
offset, slice and length it computes is TypeScript's; what leaves the front end
as an East value is read back with :func:`from_utf16`.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from east.types.values import EastStruct

#: A node of a jq program: a ``JqType`` value.
JqNode = Any
#: A destructuring pattern of a jq program: a ``JqPatternType`` value.
JqPattern = Any
#: The ranges of text a program's nodes cover, by the nodes' paths.
JqSpans = dict[str, "JqRange"]


def to_utf16(text: str) -> str:
    """The UTF-16 view of a text: each character outside the BMP as its two surrogates.

    Indexing the view indexes UTF-16 code units, as TypeScript indexes strings.

    Args:
        text: A python string.

    Returns:
        The same text, one python character per UTF-16 code unit.
    """
    if text.isascii() or all(ord(c) < 0x10000 for c in text):
        return text
    out: list[str] = []
    for c in text:
        o = ord(c)
        if o < 0x10000:
            out.append(c)
        else:
            o -= 0x10000
            out.append(chr(0xD800 + (o >> 10)))
            out.append(chr(0xDC00 + (o & 0x3FF)))
    return "".join(out)


def from_utf16(units: str) -> str:
    """A UTF-16 view read back as a string: surrogate pairs joined, a lone surrogate U+FFFD.

    A lone surrogate becomes U+FFFD as TypeScript's UTF-8 encoder writes it, so
    a string leaving the front end is the one TypeScript's would encode to.

    Args:
        units: A UTF-16 view, as :func:`to_utf16` gives.

    Returns:
        The python string.
    """
    if units.isascii() or all(ord(c) < 0xD800 or ord(c) > 0xDFFF for c in units):
        return units
    return units.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace")


def utf16_length(text: str) -> int:
    """A python string's length in UTF-16 code units."""
    return len(text) + sum(1 for c in text if ord(c) >= 0x10000)


class JqRange(NamedTuple):
    """A range of text: ``from_`` to ``to``, exclusive, in UTF-16 code units."""

    #: Its first offset.
    from_: int
    #: The offset after its last.
    to: int


class JqChild(NamedTuple):
    """A child of a node, with the step that leads to it: a node, or a pattern."""

    step: str
    node: JqNode | None
    pattern: JqPattern | None


def child_path(path: str, step: str) -> str:
    """Joins a node's path and a step to a child.

    Args:
        path: The node's path.
        step: The step, as :func:`jq_children` gives it.

    Returns:
        The child's path.
    """
    return step if path == "" else f"{path}.{step}"


def jq_children(node: JqNode) -> list[JqChild]:
    """The children of a node, in the order they are written, with the steps that lead to them.

    Args:
        node: A program node.

    Returns:
        Its children.
    """

    def n(step: str, child: JqNode) -> JqChild:
        return JqChild(step, child, None)

    def p(step: str, child: JqPattern) -> JqChild:
        return JqChild(step, None, child)

    def some_(step: str, option: Any) -> list[JqChild]:
        return [n(f"{step}.some", option.value)] if option.type == "some" else []

    kind = node.type
    v = node.value
    if kind in ("alternative", "comma", "pipe", "binary"):
        return [n(f"{kind}.left", v["left"]), n(f"{kind}.right", v["right"])]
    if kind == "array":
        return some_("array", v)
    if kind == "bind":
        return [
            n("bind.source", v["source"]),
            *(p(f"bind.patterns[{i}]", pattern) for i, pattern in enumerate(v["patterns"])),
            n("bind.body", v["body"]),
        ]
    if kind == "call":
        return [n(f"call.args[{i}]", arg) for i, arg in enumerate(v["args"])]
    if kind == "def":
        return [n("def.body", v["body"]), n("def.rest", v["rest"])]
    if kind == "field":
        return [n("field.target", v["target"])]
    if kind == "foreach":
        return [
            n("foreach.source", v["source"]), p("foreach.pattern", v["pattern"]),
            n("foreach.init", v["init"]), n("foreach.update", v["update"]),
            *some_("foreach.extract", v["extract"]),
        ]
    if kind == "format":
        return some_("format.string", v["string"])
    if kind == "if":
        out: list[JqChild] = []
        for i, branch in enumerate(v["branches"]):
            out.append(n(f"if.branches[{i}].condition", branch["condition"]))
            out.append(n(f"if.branches[{i}].then", branch["then"]))
        return [*out, *some_("if.otherwise", v["otherwise"])]
    if kind == "index":
        return [n("index.target", v["target"]), n("index.index", v["index"])]
    if kind == "iterate":
        return [n("iterate.target", v["target"])]
    if kind == "label":
        return [n("label.body", v["body"])]
    if kind == "negate":
        return [n("negate", v)]
    if kind == "object":
        out = []
        for i, entry in enumerate(v):
            if entry["key"].type == "computed":
                out.append(n(f"object[{i}].key.computed", entry["key"].value))
            out.extend(some_(f"object[{i}].value", entry["value"]))
        return out
    if kind == "reduce":
        return [
            n("reduce.source", v["source"]), p("reduce.pattern", v["pattern"]),
            n("reduce.init", v["init"]), n("reduce.update", v["update"]),
        ]
    if kind == "slice":
        return [n("slice.target", v["target"]), *some_("slice.from", v["from"]), *some_("slice.to", v["to"])]
    if kind == "string":
        return [n(f"string[{i}].interpolate", part.value) for i, part in enumerate(v) if part.type == "interpolate"]
    if kind == "try":
        return [n("try.body", v["body"]), *some_("try.catch", v["catch"])]
    if kind == "update":
        return [n("update.path", v["path"]), n("update.value", v["value"])]
    return []  # break, descend, identity, literal, variable


def jq_pattern_children(pattern: JqPattern) -> list[tuple[str, JqPattern]]:
    """The children of a pattern, with the steps that lead to them.

    Args:
        pattern: A pattern.

    Returns:
        Its sub-patterns, each as ``(step, pattern)``.
    """
    if pattern.type == "array":
        return [(f"array[{i}]", item) for i, item in enumerate(pattern.value)]
    if pattern.type == "object":
        return [
            (f"object[{i}].value.some", entry["value"].value)
            for i, entry in enumerate(pattern.value) if entry["value"].type == "some"
        ]
    return []


def span_of(spans: JqSpans, path: str) -> JqRange | None:
    """The range a node covers.

    Args:
        spans: A program's spans, from the parser or the printer.
        path: The node's path.

    Returns:
        Its range, or ``None`` when the program has no such node.
    """
    return spans.get(path)


def path_at(spans: JqSpans, offset: int) -> str | None:
    """The innermost node covering an offset.

    Args:
        spans: A program's spans, from the parser or the printer.
        offset: An offset in the text, in UTF-16 code units, from 0 to its length.

    Returns:
        The path of the smallest range that holds the offset (its ends
        included), the deeper of two equal ranges; ``None`` when none does.
    """
    best: tuple[str, int] | None = None
    for path, (start, end) in spans.items():
        if offset < start or offset > end:
            continue
        width = end - start
        if best is None or width < best[1] or (width == best[1] and len(path) > len(best[0])):
            best = (path, width)
    return None if best is None else best[0]


def to_query_span(text: str, start: int, end: int) -> EastStruct:
    """Locates a range of text as a ``QuerySpanType`` value.

    A line ends at ``\\n``, ``\\r\\n`` or a lone ``\\r``. A tab is one column, and
    a character outside the Basic Multilingual Plane is two.

    Args:
        text: The text's UTF-16 view (:func:`to_utf16`).
        start: The range's first offset, in UTF-16 code units.
        end: The offset after its last.

    Returns:
        The span: ``offset`` 0-based, ``line`` and ``column`` 1-based, all in
        UTF-16 code units.
    """
    line = 1
    line_start = 0
    i = 0
    limit = min(start, len(text))
    while i < limit:
        c = text[i]
        if c == "\n" or (c == "\r" and text[i + 1:i + 2] != "\n"):
            line += 1
            line_start = i + 1
        i += 1
    return EastStruct({"column": start - line_start + 1, "length": end - start, "line": line, "offset": start})


__all__ = [
    "JqChild",
    "JqNode",
    "JqPattern",
    "JqRange",
    "JqSpans",
    "child_path",
    "from_utf16",
    "jq_children",
    "jq_pattern_children",
    "path_at",
    "span_of",
    "to_query_span",
    "to_utf16",
    "utf16_length",
]
