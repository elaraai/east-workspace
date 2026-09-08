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

Three things make it a checker rather than an import:

- **Every build, not the first failure.** ``collect_build_errors`` records a
  failed build and hands back a placeholder, so one run reports every broken
  function in the module.
- **A guard the module can see.** Importing a module executes it. ``EAST_CHECK``
  is set to ``1`` for the duration, and the documented contract is that a module
  skips its module-level side effects — reading files, calling platform
  implementations, ``East.compile`` — when it is set. A module that ignores the
  guard still gets checked; it just does its import-time work first, which is
  why a caller runs this in a subprocess with a timeout.
- **A fresh execution every time.** A ``.py`` target is executed under a
  private module name and unregistered afterwards; a dotted target is evicted
  from ``sys.modules`` and re-imported, since ``import_module`` alone hands a
  warm process the cached module and reports nothing. The modules a target
  IMPORTS stay cached for the process's life — that is what makes a warm
  re-check cheap — so a language server evicts a module when its file is saved
  (:func:`forget_module`), and a one-shot CLI never has the problem.

One check runs at a time per process: the guard, ``sys.path`` and
``sys.modules`` are process-wide state, and the builder itself is not
thread-safe.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
import threading
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from east.expression.location import Location

#: the environment variable a module can read to skip its import-time work
GUARD = "EAST_CHECK"

#: this package's own directory — the checker's frames are never the author's,
#: but an editable install puts them outside site-packages, where the source
#: map's filter would otherwise count them as authored
_SELF_DIR = Path(__file__).resolve().parent

#: one check at a time per process
_LOCK = threading.RLock()


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


def expand_targets(targets: Iterable[str], *, excludes: Iterable[str] = ()) -> list[str]:
    """A directory becomes every ``.py`` file under it, walked as ``east-py
    lint`` walks (the default excludes plus the project's own); a ``.py`` path
    or a dotted module name stays as it is."""
    from east.diagnostics import DEFAULT_EXCLUDES, load_config, python_files

    out: list[str] = []
    for target in targets:
        path = Path(target)
        if path.is_dir():
            config = load_config(path)
            skip = (*DEFAULT_EXCLUDES, *config.exclude, *excludes)
            out.extend(str(file) for file in python_files([path], excludes=skip))
        else:
            out.append(target)
    return out


def forget_module(path: str | os.PathLike[str]) -> list[str]:
    """Evict from ``sys.modules`` every module that was loaded from ``path``.

    What a warm language server does when a file is SAVED, so the next check of
    a module that imports it re-executes the new version rather than the cached
    one. East's own packages are never evicted — re-importing the builder into a
    running process would split its state.

    Returns:
        The names evicted, for the caller's log.
    """
    try:
        target = Path(path).resolve()
    except OSError:
        return []
    evicted: list[str] = []
    for name, module in list(sys.modules.items()):
        if name == "east" or name.startswith(("east.", "east_py_cli")):
            continue
        file = getattr(module, "__file__", None)
        if not file:
            continue
        try:
            same = Path(file).resolve() == target
        except OSError:
            continue
        if same:
            del sys.modules[name]
            evicted.append(name)
    return evicted


def _import(target: str) -> None:
    """Execute ``target`` afresh — a dotted module name, or a path to a ``.py`` file."""
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
        return
    # A dotted name is re-executed, not looked up: `import_module` hands a warm
    # process the cached module back, and a second check would report nothing.
    had = target in sys.modules
    previous = sys.modules.pop(target, None)
    try:
        importlib.import_module(target)
    finally:
        if had:
            sys.modules[target] = previous  # type: ignore[assignment]
        else:
            sys.modules.pop(target, None)


def check_module(target: str) -> list[BuildFinding]:
    """Build every East function in ``target`` and report what failed.

    Args:
        target: A ``.py`` path, or a dotted module name. (A directory is
            expanded first by :func:`expand_targets`.)

    Returns:
        The findings, in source order. A module that fails to import at all
        yields one finding describing that — the module cannot be checked
        until it imports.
    """
    from east.expression.function import collect_build_errors

    findings: list[BuildFinding] = []
    default = str(Path(target).resolve()) if target.endswith(".py") else target
    with _LOCK, guarded(), collect_build_errors() as errors:
        try:
            _import(target)
        except KeyboardInterrupt:
            raise
        except BaseException as e:  # noqa: BLE001 - a module may raise anything on import, SystemExit included
            findings.append(_import_failure(e, default))
    for error in errors:
        path, line, column = _innermost(error.frames, default)
        findings.append(BuildFinding(
            path=path, line=line, column=max(column, 1),
            end_line=line, end_column=max(column, 1) + 1,
            rule="build", code="EAS900", category="error",
            message=f"{error.name}: {error.message}",
        ))
    findings.sort(key=lambda f: (f.path, f.line, f.column))
    return findings


def check_targets(targets: Iterable[str], *, only_if_enabled: bool = False) -> list[BuildFinding]:
    """Check every target — directories expanded — and concatenate the findings.

    Args:
        targets: ``.py`` paths, directories, or dotted module names.
        only_if_enabled: Skip a target whose project has not opted into the
            build tier (``[tool.east-py] check = true``) — what an editor hook
            asks, since it imports the module on the author's behalf. The
            command line never asks: running it is consent in itself.
    """
    from east.diagnostics import load_config

    findings: list[BuildFinding] = []
    for target in expand_targets(targets):
        if only_if_enabled and not load_config(target if target.endswith(".py") else ".").check:
            continue
        findings.extend(check_module(target))
    return findings


def _is_self(path: str) -> bool:
    try:
        return Path(path).resolve().is_relative_to(_SELF_DIR)
    except OSError:
        return False


def _innermost(frames: tuple[Location, ...], default: str) -> Location:
    """The innermost AUTHOR frame — the checker's own frames dropped — or the
    default location when there is none."""
    for frame in frames:
        if not _is_self(frame[0]):
            return frame
    return (default, 1, 1)


def _import_failure(error: BaseException, default: str) -> BuildFinding:
    """The module did not import — report it where the author's stack ends."""
    from east.expression.location import author_frames_of

    path, line, column = _innermost(author_frames_of(error.__traceback__), default)
    return BuildFinding(
        path=path, line=line, column=max(column, 1),
        end_line=line, end_column=max(column, 1) + 1,
        rule="import", code="EAS901", category="error",
        message=(f"{type(error).__name__}: {error} — the module must import before its East "
                 f"functions can be checked (set {GUARD} to skip import-time work)"),
    )
