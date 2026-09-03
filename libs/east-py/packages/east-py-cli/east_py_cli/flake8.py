#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The flake8 plugin (#638): the East rules under ``flake8``.

Registered by the ``flake8.extension`` entry point ``EAS`` (see
``pyproject.toml``), so an installed east-py-cli makes ``flake8 --select
EAS`` — or a project's usual ``flake8`` run — report every East diagnostic
as ``EASnnn <the build's message>`` at the line and column the engine
reports. flake8 itself is not a dependency: the checker is a plain class
flake8 discovers when it is present.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

from east.diagnostics import run_east_rules

from east_py_cli import __version__


class EastChecker:
    """A flake8 AST checker: one instance per file, ``run`` yields
    ``(line, column, "EASnnn message", type)`` per diagnostic."""

    name = "east-py"
    version = __version__

    def __init__(self, tree: ast.AST, filename: str = "<stdin>", lines: list[str] | None = None) -> None:
        del tree  # the engine parses the source itself: it needs the text for the noqa comments
        self.filename = filename
        self.lines = lines

    def run(self) -> Iterator[tuple[int, int, str, type]]:
        if self.lines is not None:
            source = "".join(self.lines)
        else:
            source = Path(self.filename).read_text(encoding="utf-8")
        for d in run_east_rules(source, self.filename):
            yield d.line, max(d.column - 1, 0), f"{d.flake8_code} {d.message} [{d.rule}]", type(self)
