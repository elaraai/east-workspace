#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East diagnostics for python (#638): the rule engine over East bodies —
the twin of ``@elaraai/east-diagnostics`` / ``tsserver-plugin-east``.

The strict ``East.function`` surface (#625) makes every python-side mistake
loud at BUILD time: a ``lambda x:`` body, ``//`` or ``%`` on an expression,
an f-string over one, python ``and`` / ``or`` / ``if`` collapsing one to a
bool, ``round()``, a callback reaching for a module object, a statement on
an outer block. These rules say the same thing at EDIT time — one message,
two moments: every rule's text is the build-time refusal it mirrors, taken
from the builder where the builder keeps it as a constant and pinned
against the raised exception otherwise (``tests/diagnostics``).

Rules are syntactic and name-based (the ``ast``): they see which callables
are East bodies (``east.diagnostics.scope``), which names hold expressions
inside them, and what python does to those names. Type inference of the
expressions themselves is the build's job and is not repeated here.

One engine, several surfaces:

- ``run_east_rules(source, filename)`` — the API (and ``lint_paths`` over a tree);
- ``east-py lint <paths>`` — the CLI, and a flake8 plugin (``EAS`` codes);
- ``east-py lsp`` — a Language Server (pygls) publishing the same diagnostics,
  plus the BUILD tier (``east-py check``) that runs the module and reports the
  builder's own errors — the type errors these rules cannot see;
- a ``python-lsp-server`` plugin carrying the rules.

A line ending in ``# noqa`` or ``# noqa: EAS001, …`` suppresses its
diagnostics, as under flake8/ruff. A file that does not import ``east`` is
never diagnosed.
"""

from __future__ import annotations

import ast
import os
import re
from collections.abc import Iterable
from pathlib import Path

from east.diagnostics.config import EastPyConfig, find_pyproject, load_config
from east.diagnostics.rules import ALL_RULES, RULES_BY_NAME
from east.diagnostics.scope import collect_bodies, collect_module_scope, is_east_module
from east.diagnostics.types import CODE_PREFIX, Body, Context, Diagnostic, ModuleRule, Rule

__all__ = [
    "ALL_RULES",
    "RULES_BY_NAME",
    "Diagnostic",
    "Rule",
    "run_east_rules",
    "lint_paths",
    "python_files",
    "DEFAULT_EXCLUDES",
    "EastPyConfig",
    "find_pyproject",
    "load_config",
]

_NOQA = re.compile(r"#\s*noqa(?::\s*([A-Za-z0-9_,\s-]+))?\s*$")

#: directory names never diagnosed: vendored, built, or the tests that
#: deliberately write what the rules refuse
DEFAULT_EXCLUDES: tuple[str, ...] = (".venv", "venv", "node_modules", "dist", "build", ".git", "__pycache__", "tests", "test")


def run_east_rules(source: str, filename: str = "<string>", *,
                   disabled: Iterable[str] = ()) -> list[Diagnostic]:
    """Diagnose one file's source.

    Args:
        source: The python source text.
        filename: Its path, for messages.
        disabled: Rule names to skip.

    Returns:
        The diagnostics, in source order. A syntax error is reported as one
        diagnostic (rule ``syntax``, code 0); a file that does not import
        ``east`` yields none.
    """
    try:
        tree = ast.parse(source, filename)
    except SyntaxError as e:
        return [Diagnostic(rule="syntax", code=0, message=f"syntax error: {e.msg}",
                           line=e.lineno or 1, column=e.offset or 1,
                           end_line=e.lineno or 1, end_column=(e.offset or 1) + 1)]
    if not is_east_module(tree):
        return []
    ctx = Context(source, filename, tree)
    collect_module_scope(ctx)
    collect_bodies(ctx)
    off = set(disabled)
    rules = [r for r in ALL_RULES if r.name not in off]

    # module scope first: the build-time concerns that sit in no body
    for rule in rules:
        if isinstance(rule, ModuleRule):
            rule.check_module(ctx)

    def visit(body: Body) -> None:
        for rule in rules:
            rule.check(body, ctx)
        for child in body.children:
            visit(child)

    for body in ctx.bodies:
        visit(body)
    out = [d for d in ctx.diagnostics if not _suppressed(d, ctx.lines)]
    out.sort(key=lambda d: (d.line, d.column, d.code))
    return out


def _suppressed(d: Diagnostic, lines: list[str]) -> bool:
    if d.line - 1 >= len(lines):
        return False
    m = _NOQA.search(lines[d.line - 1])
    if m is None:
        return False
    codes = m.group(1)
    if codes is None:
        return True
    wanted = {c.strip().upper() for c in codes.split(",") if c.strip()}
    return d.flake8_code in wanted or CODE_PREFIX in wanted or d.rule in {c.lower() for c in wanted}


def lint_paths(paths: Iterable[str | os.PathLike[str]], *, disabled: Iterable[str] = (),
               excludes: Iterable[str] = DEFAULT_EXCLUDES) -> dict[str, list[Diagnostic]]:
    """Diagnose every ``.py`` file under ``paths`` (files or directories).

    Returns:
        ``{path: diagnostics}`` for the files with at least one diagnostic,
        paths sorted.
    """
    out: dict[str, list[Diagnostic]] = {}
    for file in python_files(paths, excludes):
        try:
            source = Path(file).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            out[str(file)] = [Diagnostic(rule="io", code=0, message=str(e), line=1, column=1, end_line=1, end_column=1)]
            continue
        found = run_east_rules(source, str(file), disabled=disabled)
        if found:
            out[str(file)] = found
    return out


def python_files(paths: Iterable[str | os.PathLike[str]],
                 excludes: Iterable[str] = DEFAULT_EXCLUDES) -> list[Path]:
    """Every ``.py`` file under ``paths`` (files or directories), sorted — the
    walk ``east-py lint`` and ``east-py check`` share, skipping the excluded
    directory names."""
    skip = set(excludes)
    files: list[Path] = []
    for p in paths:
        path = Path(p)
        if path.is_file():
            if path.suffix == ".py":
                files.append(path)
            continue
        for root, dirs, names in os.walk(path):
            dirs[:] = sorted(d for d in dirs if d not in skip)
            files.extend(Path(root) / n for n in sorted(names) if n.endswith(".py"))
    return sorted(files)
