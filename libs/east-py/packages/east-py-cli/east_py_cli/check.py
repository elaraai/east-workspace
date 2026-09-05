#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py check`` (#653): the BUILD's own errors, at edit time.

``east-py lint`` reads a file's syntax. This runs it. East's type checker is
the builder — ``East.function`` traces the body over expression proxies and
computes types by construction — so the only way to type-check a python East
body is to build it, and what comes back is the real refusal rather than an
approximation of one. A slot type mismatch, an ``out`` that does not match the
body, a callback the capture refuses, an ``IRAnalysisError``: none of these are
visible to the rules, and all of them are visible here.

Two things make it a checker rather than an import:

- **Every build, not the first failure.** ``collect_build_errors`` records a
  failed build and hands back a placeholder, so one run reports every broken
  function in the module.
- **A guard the module can see.** Importing a module executes it. ``EAST_CHECK``
  is set to ``1`` for the duration, and the documented contract is that a module
  skips its module-level side effects — reading files, calling platform
  implementations, ``East.compile`` — when it is set. A module that ignores the
  guard still gets checked; it just does its import-time work first, which is
  why the caller runs this in a subprocess with a timeout.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: the environment variable a module can read to skip its import-time work
GUARD = "EAST_CHECK"


@dataclass(frozen=True)
class BuildFinding:
    """One build failure, shaped like a lint diagnostic so the two merge."""

    path: str
    line: int
    column: int
    end_line: int
    end_column: int
    rule: str
    code: str
    category: str
    message: str

    def format(self, filename: str) -> str:
        """``file:line:col: category [rule] message`` — the lint spelling."""
        return f"{filename}:{self.line}:{self.column}: {self.category} [{self.rule}] {self.message}"

    def as_record(self) -> dict[str, Any]:
        return {
            "path": self.path, "line": self.line, "column": self.column,
            "end_line": self.end_line, "end_column": self.end_column,
            "rule": self.rule, "code": self.code, "category": self.category,
            "message": self.message,
        }


@contextmanager
def guarded() -> Iterator[None]:
    """Set the guard for the duration, restoring whatever was there."""
    previous = os.environ.get(GUARD)
    os.environ[GUARD] = "1"
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(GUARD, None)
        else:
            os.environ[GUARD] = previous


def _import(target: str) -> None:
    """Import ``target`` — a dotted module name, or a path to a ``.py`` file."""
    if target.endswith(".py"):
        path = Path(target).resolve()
        spec = importlib.util.spec_from_file_location(path.stem, path)
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot load {path}")
        module = importlib.util.module_from_spec(spec)
        # Importable siblings: a checked file usually imports from its own package.
        parent = str(path.parent)
        added = parent not in sys.path
        if added:
            sys.path.insert(0, parent)
        # A name that cannot collide with a real module. Registering the file
        # under its bare stem overwrote whatever `models` / `types` / `config`
        # the process had genuinely imported, and popping it afterwards evicted
        # the real one — so in a warm server the next `import models` re-executed
        # it. Whatever was there is restored either way.
        key = f"_east_check_{path.stem}"
        had = key in sys.modules
        previous = sys.modules.get(key)
        try:
            sys.modules[key] = module
            spec.loader.exec_module(module)
        finally:
            if had:
                sys.modules[key] = previous  # type: ignore[assignment]
            else:
                sys.modules.pop(key, None)
            if added and sys.path and sys.path[0] == parent:
                sys.path.pop(0)
    else:
        importlib.import_module(target)


def check_module(target: str) -> list[BuildFinding]:
    """Build every East function in ``target`` and report what failed.

    Args:
        target: A ``.py`` path, or a dotted module name.

    Returns:
        The findings, in source order. A module that fails to import at all
        yields one finding describing that — the module cannot be checked
        until it imports.
    """
    from east.expression.function import collect_build_errors

    findings: list[BuildFinding] = []
    default = str(Path(target).resolve()) if target.endswith(".py") else target
    with guarded(), collect_build_errors() as errors:
        try:
            _import(target)
        except BaseException as e:  # noqa: BLE001 - a module may raise anything on import
            findings.append(_import_failure(e, default))
    for error in errors:
        where = error.location
        path, line, column = where if where is not None else (default, 1, 1)
        findings.append(BuildFinding(
            path=path, line=line, column=max(column, 1),
            end_line=line, end_column=max(column, 1) + 1,
            rule="build", code="EAS900", category="error",
            message=f"{error.name}: {error.message}",
        ))
    findings.sort(key=lambda f: (f.path, f.line, f.column))
    return findings


def _import_failure(error: BaseException, default: str) -> BuildFinding:
    """The module did not import — report it where the author's stack ends."""
    from east.expression.location import author_frames_of

    frames = author_frames_of(error.__traceback__)
    path, line, column = frames[0] if frames else (default, 1, 1)
    return BuildFinding(
        path=path, line=line, column=max(column, 1),
        end_line=line, end_column=max(column, 1) + 1,
        rule="import", code="EAS901", category="error",
        message=(f"{type(error).__name__}: {error} — the module must import before its East "
                 f"functions can be checked (set {GUARD} to skip import-time work)"),
    )
