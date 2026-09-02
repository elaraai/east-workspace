#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Authoring-frame source maps for python-built East functions (#626).

Every IR node a build constructs carries a ``loc_id``: an index into the
build's :class:`SourceMap`, whose entry is the stack of PYTHON frames that
were executing when the node was built — the lambda line that spelled the
expression, the ``East.function(...)`` call site, and the caller's frames
above it. A runtime error inside the compiled function resolves its node's
``loc_id`` back through that map, so ``EastError.location`` names the python
``file:line:column`` of the offending expression — on the east-py runner,
and on every other runner the function is exported to, because the map rides
the function value's beast2 encoding (the #476 wire shape reserves it).

This is the python twin of ``libs/east/src/location.ts``, contract for
contract: ``SourceMap`` interns stacks by content with entry 0 the empty
"no location" stack; :func:`capture_frames` walks the live python stack and
keeps only the AUTHOR's frames (East's own package, the standard library and
installed third-party packages are dropped, so a stack heads with user code
rather than with the builder internals); paths are relativized to a base
directory — the working directory unless :func:`set_location_base_path` says
otherwise — so serialized IR carries no machine-specific paths; and the map
is ambient: a build opens one with :func:`source_map_scope`, every node
built inside asks :func:`location_id` for its id, and a build nested inside
another (an ``East.function`` referenced from a body) shares the enclosing
map, exactly as ``ensure_source_map`` does in TS.

Capture is per NODE at build time and never per call: a compiled function
carries its map on the C side and resolves an error's ``loc_id`` only when
one is raised.
"""

from __future__ import annotations

import contextlib
import itertools
import os
import sys
import sysconfig
from collections.abc import Iterator
from typing import Any

__all__ = [
    "Location",
    "SourceMap",
    "UNKNOWN_LOC_ID",
    "capture_frames",
    "current_source_map",
    "location_id",
    "normalize_frame_path",
    "set_location_base_path",
    "source_map_scope",
]

#: One authoring frame: ``(filename, line, column)`` — line and column are
#: 1-based, matching TypeScript's ``Location`` (python reports 0-based
#: columns; they are shifted on capture).
Location = tuple[str, int, int]

#: The reserved "no / unknown location" id: ``resolve(0)`` is the empty stack.
UNKNOWN_LOC_ID = 0


class SourceMap:
    """Interned location stacks, indexed by ``loc_id``.

    Entry 0 is always the empty stack. Equal stacks intern to one id, so a
    node built from the same call site as an earlier one costs no entry —
    which is what keeps a map to roughly one entry per distinct expression.
    """

    __slots__ = ("_ids", "_stacks")

    def __init__(self) -> None:
        self._stacks: list[tuple[Location, ...]] = [()]
        self._ids: dict[tuple[Location, ...], int] = {}

    def intern_stack(self, stack: tuple[Location, ...]) -> int:
        """Intern a stack and return its stable id; the empty stack is 0."""
        if not stack:
            return UNKNOWN_LOC_ID
        loc_id = self._ids.get(stack)
        if loc_id is None:
            loc_id = len(self._stacks)
            self._stacks.append(stack)
            self._ids[stack] = loc_id
        return loc_id

    def resolve(self, loc_id: int) -> tuple[Location, ...]:
        """The stack ``loc_id`` names; empty for 0 or an unknown id."""
        if 0 <= loc_id < len(self._stacks):
            return self._stacks[loc_id]
        return ()

    def entries(self) -> list[tuple[Location, ...]]:
        """Every stack in id order (entry 0 is the empty stack) — the shape
        the wire formats and the C bridge consume."""
        return list(self._stacks)

    def __len__(self) -> int:
        """The number of entries, the reserved empty entry included."""
        return len(self._stacks)

    def __repr__(self) -> str:
        return f"<SourceMap {len(self._stacks) - 1} stack(s)>"


# ─── Frame path normalization ───────────────────────────────────────────────
#
# Frame paths are absolute and machine-specific. Baked into serialized IR
# they would leak the author's filesystem layout and make the IR differ from
# machine to machine, so every captured path is relativized to a base — the
# working directory by default, or what set_location_base_path() installs
# (deterministic fixtures) — and kept with forward slashes. Paths outside the
# base stay absolute; pseudo-files (``<stdin>``, ``<string>``) stay as they
# are. Never raises.

_explicit_base: str | None = None
_explicit_base_set = False
_auto_base: str | None = None
_auto_base_computed = False


def _clean(path: str) -> str:
    cleaned = path.replace("\\", "/")
    return cleaned[:-1] if len(cleaned) > 1 and cleaned.endswith("/") else cleaned


def _current_base() -> str | None:
    global _auto_base, _auto_base_computed
    if _explicit_base_set:
        return _explicit_base
    if not _auto_base_computed:
        _auto_base_computed = True
        try:
            _auto_base = _clean(os.getcwd())
        except OSError:
            _auto_base = None
    return _auto_base


def set_location_base_path(base: str | None) -> None:
    """Set the directory captured locations are relativized against.

    Pass a path to relativize against it (paths outside it stay absolute);
    pass ``None`` to reset to the automatic default, the working directory.
    The twin of TypeScript's ``setLocationBasePath``, for deterministic
    fixtures and reproducible exports.

    Args:
        base: The base directory, or ``None`` for the default.
    """
    global _explicit_base, _explicit_base_set
    if base is None:
        _explicit_base_set = False
        _explicit_base = None
    else:
        _explicit_base_set = True
        _explicit_base = _clean(os.path.abspath(base))
    _author_paths.clear()


def normalize_frame_path(raw: str) -> str:
    """A frame path in its portable form: forward slashes, relativized to
    the current base when it sits under it. Never raises."""
    try:
        cleaned = _clean(raw)
        base = _current_base()
        if base:
            if cleaned == base:
                return "."
            if cleaned.startswith(base + "/"):
                return cleaned[len(base) + 1:]
        return cleaned
    except Exception:  # pragma: no cover - a path nothing above expected
        return raw


# ─── Which frames are the author's ──────────────────────────────────────────
#
# East's own package builds the nodes, so its frames head every raw stack and
# would bake the builder's line numbers into every map; the standard library,
# installed (site-packages) third-party packages and the interpreter's script
# directory (the `pytest` / `east-py` entry scripts) are noise for the same
# reason. Everything else — the user's modules, a test file, a REPL — is the
# author. The decision is cached per code filename: a capture walks the whole
# python stack once per node, so each frame must cost one dict hit.

#: The ``east`` package directory (this file is east/expression/location.py).
_EAST_PACKAGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_excluded_dirs: tuple[str, ...] | None = None

#: co_filename → its portable form, or None when the frame is not the author's.
_author_paths: dict[str, str | None] = {}
_MISS: Any = object()
_CACHE_LIMIT = 4096


def _excluded_directories() -> tuple[str, ...]:
    global _excluded_dirs
    if _excluded_dirs is None:
        dirs = {_EAST_PACKAGE_DIR}
        try:
            paths = sysconfig.get_paths()
            for key in ("stdlib", "platstdlib", "purelib", "platlib"):
                if paths.get(key):
                    dirs.add(os.path.abspath(paths[key]))
        except Exception:  # pragma: no cover - an exotic interpreter layout
            pass
        try:
            import site

            dirs.update(os.path.abspath(p) for p in site.getsitepackages())
            dirs.add(os.path.abspath(site.getusersitepackages()))
        except Exception:  # pragma: no cover - site is unavailable (embedded)
            pass
        if sys.executable:
            dirs.add(os.path.dirname(os.path.abspath(sys.executable)))
        _excluded_dirs = tuple(d.rstrip(os.sep) + os.sep for d in dirs)
    return _excluded_dirs


def _decide(filename: str) -> str | None:
    if filename.startswith("<"):
        # Pseudo-files: importlib's frozen modules are the interpreter's; a
        # REPL / exec'd string is the author's.
        return None if filename.startswith("<frozen ") else filename
    path = os.path.abspath(filename)
    for excluded in _excluded_directories():
        if path.startswith(excluded):
            return None
    return normalize_frame_path(path)


def _author_path(filename: str) -> str | None:
    hit = _author_paths.get(filename, _MISS)
    if hit is not _MISS:
        return hit
    if len(_author_paths) > _CACHE_LIMIT:
        _author_paths.clear()
    decision = _decide(filename)
    _author_paths[filename] = decision
    return decision


# ─── Positions ──────────────────────────────────────────────────────────────
#
# A frame's executing instruction has a (line, column) in its code object's
# position table (PEP 657, python 3.11+): the start of the expression being
# evaluated, which is the call the author wrote. Indexing the table is a walk,
# so positions memoize per (code object, instruction offset) — a call site
# builds many nodes, and an eager method captures the same lambda repeatedly.

_positions: dict[tuple[Any, int], tuple[int, int]] = {}


def _position(frame: Any) -> tuple[int, int]:
    code = frame.f_code
    lasti = frame.f_lasti
    key = (code, lasti)
    hit = _positions.get(key)
    if hit is not None:
        return hit
    line = frame.f_lineno
    column = 0
    try:
        index = lasti // 2
        pos = next(itertools.islice(code.co_positions(), index, index + 1), None)
    except Exception:  # pragma: no cover - a code object without positions
        pos = None
    if pos is not None:
        start_line, _end_line, start_col, _end_col = pos
        if start_line is not None:
            line = start_line
        if start_col is not None:
            column = start_col + 1
    if len(_positions) > _CACHE_LIMIT:
        _positions.clear()
    _positions[key] = (line, column)
    return line, column


def capture_frames() -> tuple[Location, ...]:
    """The author's frames of the current call, innermost first.

    East's own frames, the standard library and installed packages are
    dropped (see the module notes), paths are normalized, and columns are
    1-based. Empty when no author frame is on the stack.
    """
    frame = sys._getframe(1)
    out: list[Location] = []
    while frame is not None:
        path = _author_path(frame.f_code.co_filename)
        if path is not None:
            line, column = _position(frame)
            out.append((path, line, column))
        frame = frame.f_back
    return tuple(out)


# ─── The ambient map ────────────────────────────────────────────────────────

_current: SourceMap | None = None


@contextlib.contextmanager
def source_map_scope() -> Iterator[SourceMap]:
    """Run a build with a source map current, yielding that map.

    A fresh map when none is open; the ENCLOSING build's when one is — a
    function built inside another body shares its map, so the nested
    function's ids resolve wherever the enclosing one's do (TS
    ``ensure_source_map``). Re-entrant safe.
    """
    global _current
    if _current is not None:
        yield _current
        return
    _current = SourceMap()
    try:
        yield _current
    finally:
        _current = None


def current_source_map() -> SourceMap | None:
    """The map of the open build, or ``None`` outside any build."""
    return _current


def location_id() -> int:
    """The ``loc_id`` for the node being built right now.

    The interned authoring stack when a build is open; ``UNKNOWN_LOC_ID`` (0)
    when none is — nodes built outside any build (the internal helper
    functions, a type-only trace) carry no location, like TS's
    ``get_location_id`` outside a ``with_source_map`` scope.
    """
    current = _current
    if current is None:
        return UNKNOWN_LOC_ID
    return current.intern_stack(capture_frames())
