#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Running a jq query from a host: checked, translated, compiled once and cached, then called.

The twin of ``libs/east/src/query/evaluate.ts`` (``libs/east/devdocs/QUERY.md`` §15).
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from east.expression.errors import ExpressionError
from east.query.jq.check import CheckJqResult, check_jq
from east.query.jq.messages import report
from east.query.jq.print import print_jq
from east.query.jq.spans import JqNode, JqRange, child_path, jq_children
from east.query.jq.translate import JqTranslation, translate_jq
from east.runtime.errors import EastError
from east.serialization.east_printer import print_for
from east.types.type_of_type import EastTypeType, canonical_type_value
from east.types.types import EastType
from east.types.values import EastStruct


class QueryError(Exception):
    """A query that does not check, or whose run raised an error: its diagnostics.

    ``diagnostics`` holds the checker's diagnostics, lints included, when the
    query does not check; for an error raised while it ran, one ``runtime``
    diagnostic whose message is the East error's and whose span is the jq node
    that raised it. The message lists each error with its line and column in
    the jq text, as TypeScript's ``QueryError`` does.
    """

    def __init__(self, diagnostics: list[EastStruct]) -> None:
        errors = [d for d in diagnostics if d["severity"].type == "error"]
        lines = []
        for d in errors or diagnostics:
            span = d["span"]
            where = f"jq {span.value['line']}:{span.value['column']}: " if span.type == "some" else ""
            lines.append(f"{where}{d['message']}")
        super().__init__("\n".join(lines))
        #: The diagnostics, in the order found (``QueryErrorType`` values).
        self.diagnostics = diagnostics


class QueryBuildError(QueryError, ExpressionError):
    """A query ``East.jq`` refuses in a build: a :class:`QueryError`, and the builder's own failure mode.

    A builder reports an :class:`~east.expression.errors.ExpressionError` its
    body raises as it is, and wraps anything else as a body it cannot build.
    So a query that does not check reaches the author of an ``East.function``
    as the ``QueryError`` it is, with the checker's diagnostics, as it does in
    TypeScript.
    """


@dataclass(frozen=True)
class _Compiled:
    """A compiled query, and how to give it its input."""

    translation: JqTranslation
    checked: CheckJqResult
    run: Any


#: Compiled queries by their canonical text, input type and options, the oldest dropped past the cache's size.
_CACHE: OrderedDict[str, _Compiled] = OrderedDict()
_CACHE_SIZE = 64
_print_type_value = print_for(EastTypeType)


def evaluate_jq(program: str | CheckJqResult, input_: Any, *, input_type: EastType | None = None, root: bool = False,
                tooling: bool = False, platform: list[Any] | None = None) -> Any:
    """Checks, translates, compiles and runs a jq query over a value.

    The compiled function is cached by the query's canonical text, its input
    type and the options, so a query run again compiles once. With ``root``
    the input is a struct and each field the query reads is its own argument.

    Args:
        program: The query's text, or what ``check_jq`` made of it.
        input_: The input: a decoded value, or a lazy one.
        input_type: The input's type: required with a program's text.
        root: The input is an e3 root, a struct of datasets: each field the
            query reads is passed alone, so a lazy one stays lazy.
        tooling: Allow the tooling-only builtins.
        platform: Platform functions, for function values in the input that need them.

    Returns:
        The result: the element for a ``one`` query, an option for ``maybe``,
        an array for ``many``.

    Raises:
        QueryError: When the query does not check, carrying the checker's
            diagnostics; or when its run raises an error, as one ``runtime``
            diagnostic at the jq node that raised it.
        TypeError: When a program's text comes without ``input_type``.
    """
    return _run(_compile(program, input_type, root, tooling, platform), input_)


def _run(compiled: _Compiled, input_: Any) -> Any:
    """Calls a compiled query on its input: the input itself, or each root field it reads."""
    args = [input_ if i.name is None else input_[i.name] for i in compiled.translation.inputs]
    try:
        return compiled.run(*args)
    except EastError as e:
        raise QueryError([_runtime_diagnostic(compiled.checked, e)]) from e


def _compile(program: str | CheckJqResult, input_type: EastType | None, root: bool, tooling: bool,
             platform: list[Any] | None) -> _Compiled:
    """A query checked, translated and compiled, from the cache when it was before."""
    if isinstance(program, str):
        if input_type is None:
            raise TypeError("evaluate_jq: a query's text needs input_type")
        type_key = _print_type_value(canonical_type_value(input_type))
        key = f"{program}\0{type_key}\0{root}\0{tooling}"
        hit = _CACHE.get(key)
        if hit is not None:
            return hit
        checked = check_jq(program, input_type, root=root, tooling=tooling)
    else:
        checked = program
        if checked.query is None:
            raise QueryError(checked.diagnostics)
        q = checked.query.value
        key = f"{print_jq(q['program']).text}\0{_print_type_value(q['input_type'])}\0{checked.source.root}\0{tooling}"
        hit = _CACHE.get(key)
        if hit is not None:
            return hit
    if checked.query is None:
        raise QueryError(checked.diagnostics)
    translation = translate_jq(checked, tooling=tooling)
    from east.expression.location import source_map_scope
    from east.runtime.compiler import compile_from_value

    with source_map_scope() as source_map:
        ir = translation.function_ir()
    run = compile_from_value(ir, list(platform or []), source_map=source_map)
    compiled = _Compiled(translation, checked, run)
    if len(_CACHE) >= _CACHE_SIZE:
        _CACHE.popitem(last=False)
    _CACHE[key] = compiled
    return compiled


# The kinds of node that cannot raise an error.
_LEAVES = frozenset({"identity", "literal", "variable"})


def _runtime_diagnostic(checked: CheckJqResult, error: EastError) -> EastStruct:
    """A ``runtime`` diagnostic for an East error a query raised: at the jq node it names, when it names one."""
    text = checked.source.units
    at = next((frame for frame in error.location if frame["filename"] == "jq"), None)
    span: JqRange | None = None
    if at is not None:
        # The node that raised it: the innermost that starts at that line and
        # column and can raise (a literal, `.` or a variable cannot).
        offset = _offset_of(text, int(at["line"]), int(at["column"]))
        kinds = {} if checked.query is None else _node_kinds(checked.query.value["program"])
        for path, candidate in checked.source.spans.items():
            if candidate.from_ != offset or kinds.get(path, "") in _LEAVES:
                continue
            if span is None or candidate.to - candidate.from_ < span.to - span.from_:
                span = candidate
        if span is None:
            span = JqRange(offset, offset)
    return report(text, "runtime", span, f"runtime: {error.message}")


def _node_kinds(program: JqNode) -> dict[str, str]:
    """Each node's kind, by its path."""
    kinds: dict[str, str] = {}

    def visit(n: JqNode, path: str) -> None:
        kinds[path] = n.type
        for child in jq_children(n):
            if child.node is not None:
                visit(child.node, child_path(path, child.step))
    visit(program, "")
    return kinds


def _offset_of(text: str, line: int, column: int) -> int:
    """The offset of a line and column in a text's UTF-16 view, both 1-based."""
    current = 1
    start = 0
    i = 0
    while i < len(text) and current < line:
        c = text[i]
        if c == "\n" or (c == "\r" and text[i + 1:i + 2] != "\n"):
            current += 1
            start = i + 1
        i += 1
    return min(len(text), start + column - 1)


__all__ = ["QueryBuildError", "QueryError", "evaluate_jq"]
