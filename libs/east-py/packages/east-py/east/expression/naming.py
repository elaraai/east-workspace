#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Authoring names for IR variables (#639) — the python twin of
``libs/east/src/naming.ts``.

The IR carries a name on every variable; the builder used to mint
``__nN``. These helpers recover the names the author wrote, with no new API:

- a body's **parameters** from its signature (``lambda b, items, threshold``
  names ``items`` and ``threshold``);
- a **``b.let`` / ``b.const`` binding** from the authoring file, parsed with
  ``ast``: the assignment whose value is the call the frame is executing —
  matched by the call's exact span from the code object's position table
  (PEP 657), so a call inside another call's arguments, or one with a
  further call chained onto it, is its own — ``total = b.let(0)`` names
  ``total``.

Where a name cannot be read (a ``*args`` body, a REPL line that is gone, a
call that initializes nothing) the builder's fresh name stands, exactly as
before. Names are unique per build — captures are matched by name across
function boundaries and the compilers key their environments by name — so
a collision takes a ``_2``, ``_3``… suffix, as in TypeScript.
"""

from __future__ import annotations

import ast
import inspect
import keyword
import linecache
import sys
from typing import Any

_names_in_use: dict[str, int] = {}
#: (start line, start column, end line, end column) of a call, 1-based columns
Span = tuple[int, int, int, int]
#: file → {span of a call: the name it is assigned to}
_bindings: dict[str, dict[Span, str]] = {}
_BINDINGS_LIMIT = 256
#: id(code) → (code, its instructions' spans) — pinned by the entry so the id cannot be recycled
_spans: dict[int, tuple[Any, list[Span | None]]] = {}
_SPANS_LIMIT = 256


def reset_names() -> None:
    """Forget the names in use — called when a build opens its outermost frame."""
    _names_in_use.clear()


def authored_name(hint: str | None, fallback: Any) -> str:
    """``hint`` made unique within the build, or ``fallback()`` when the hint
    is unusable (absent, not an identifier, a keyword, the builder's own
    ``__``-prefixed spelling)."""
    if hint is None or not hint.isidentifier() or keyword.iskeyword(hint) or hint.startswith("__"):
        return fallback()
    n = _names_in_use.get(hint, 0) + 1
    _names_in_use[hint] = n
    return hint if n == 1 else f"{hint}_{n}"


def parameter_names(fn: Any) -> list[str] | None:
    """The positional parameter names of a body, the block first, or ``None``
    when the signature cannot be read."""
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return None
    names: list[str] = []
    for p in sig.parameters.values():
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            names.append(p.name)
        elif p.kind is p.VAR_POSITIONAL:
            break
    return names


def hint_at(names: list[str] | None, index: int) -> str | None:
    """``names[index]`` or ``None`` — a body may declare fewer parameters."""
    if names is None or index >= len(names):
        return None
    return names[index]


def _index_bindings(filename: str, module_globals: dict | None) -> dict[Span, str]:
    """Every ``name = <call>`` of a source file — an assignment, an annotated
    assignment, a walrus, or a tuple of them — keyed by the call's span."""
    lines = linecache.getlines(filename, module_globals)
    if not lines:
        return {}
    try:
        tree = ast.parse("".join(lines), filename)
    except (SyntaxError, ValueError):
        return {}
    index: dict[Span, str] = {}

    def bind(target: ast.expr, value: ast.expr) -> None:
        if isinstance(target, ast.Name) and isinstance(value, ast.Call) \
                and value.end_lineno is not None and value.end_col_offset is not None:
            index[(value.lineno, value.col_offset + 1, value.end_lineno, value.end_col_offset + 1)] = target.id
        elif (isinstance(target, ast.Tuple) and isinstance(value, ast.Tuple)
              and len(target.elts) == len(value.elts)):
            for t, v in zip(target.elts, value.elts, strict=True):
                bind(t, v)

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            bind(node.targets[0], node.value)
        elif isinstance(node, (ast.AnnAssign, ast.NamedExpr)) and node.value is not None:
            bind(node.target, node.value)
    return index


def _bindings_of(filename: str, module_globals: dict | None) -> dict[Span, str]:
    hit = _bindings.get(filename)
    if hit is None:
        if len(_bindings) >= _BINDINGS_LIMIT:
            _bindings.clear()
        hit = _bindings[filename] = _index_bindings(filename, module_globals)
    return hit


def _call_span(frame: Any) -> Span | None:
    """The span of the call ``frame`` is executing, from its code object's
    position table (the same table the source map reads a start from)."""
    code = frame.f_code
    entry = _spans.get(id(code))
    if entry is None or entry[0] is not code:
        spans: list[Span | None] = []
        try:
            for start_line, end_line, start_col, end_col in code.co_positions():
                spans.append(None if None in (start_line, end_line, start_col, end_col)
                             else (start_line, start_col + 1, end_line, end_col + 1))
        except Exception:  # pragma: no cover - a code object without positions
            spans = []
        if len(_spans) >= _SPANS_LIMIT:
            _spans.clear()
        _spans[id(code)] = entry = (code, spans)
    index = frame.f_lasti // 2
    spans = entry[1]
    return spans[index] if 0 <= index < len(spans) else None


def binding_name_here() -> str | None:
    """The name the innermost author frame's current call is assigned to —
    ``total = b.let(...)`` names ``total`` — or ``None``."""
    from east.expression.location import _author_path

    frame = sys._getframe(1)
    while frame is not None:
        filename = frame.f_code.co_filename
        if _author_path(filename) is not None:
            span = _call_span(frame)
            if span is None:
                return None
            return _bindings_of(filename, frame.f_globals).get(span)
        frame = frame.f_back
    return None
