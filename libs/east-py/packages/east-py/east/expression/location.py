#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Authoring-frame source maps for python-built East functions (#626).

Every IR node a build constructs carries a ``loc_id``: an index into the
build's :class:`SourceMap`, whose entry is the stack of PYTHON frames that
were executing when the node was built — the lambda line that spelled the
expression, any helper between, and the ``East.function(...)`` call that
built it. A runtime error inside the compiled function resolves its node's
``loc_id`` back through that map, so ``EastError.location`` names the python
``file:line:column`` of the offending expression — on the east-py runner,
and on every other runner the function is exported to, because the map rides
the function value's beast2 encoding (the #476 wire shape reserves it).

This is the python twin of ``libs/east/src/location.ts``: ``SourceMap``
interns stacks by content with entry 0 the empty "no location" stack;
:func:`capture_frames` walks the live python stack and keeps only the
AUTHOR's frames (East's own package, the standard library and installed
third-party packages are dropped, so a stack heads with user code rather than
with the builder internals); paths are relativized, so serialized IR carries
no machine-specific paths; and the map is ambient: a build opens one with
:func:`source_map_scope`, every node built inside asks :func:`location_id`
for its id, and a build nested inside another (an ``East.function``
referenced from a body) shares the enclosing map, exactly as
``ensure_source_map`` does in TS.

A recorded stack holds the function's own frames and nothing more: the walk
stops at the frame that called ``East.function``, and a recorded path is
relative to its file's project root. Its IR is then the same whoever imported
the module, and whatever directory the process ran in, which is what a task's
hash needs of it (#1460).

Capture is per NODE at build time and never per call: a compiled function
carries its map on the C side and resolves an error's ``loc_id`` only when
one is raised. A host that builds many functions and never reads their
locations switches capture off with :func:`set_location_capture` (the twin
of TypeScript's ``setLocationCapture``, #834).
"""

from __future__ import annotations

import contextlib
import os
import sys
import sysconfig
from collections.abc import Iterator
from typing import Any

__all__ = [
    "Location",
    "SourceMap",
    "UNKNOWN_LOC_ID",
    "author_frames_from",
    "author_frames_of",
    "capture_frames",
    "current_source_map",
    "location_id",
    "normalize_frame_path",
    "set_location_base_path",
    "set_location_capture",
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
# are. Never raises. A path a source map records is relative to its file's
# project root instead (see "Recorded paths" below).

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
    pass ``None`` to reset to the automatic default: a source map records a
    path relative to its file's project root (the nearest directory above it
    holding a ``pyproject.toml``), and a traceback's frames are relative to
    the working directory. The twin of TypeScript's ``setLocationBasePath``,
    for deterministic fixtures.

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
    _map_paths.clear()


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


# ─── Recorded paths ─────────────────────────────────────────────────────────
#
# What a source map records goes into the IR, and from there into a task's
# hash. Relative to the working directory, a function's bytes would depend on
# where the process that built it ran, and one process exporting several
# packages could write each of them only one way. A recorded path is relative
# to its file's PROJECT root instead — the nearest directory above it holding
# a pyproject.toml — which places a file the same way wherever its project
# sits and whatever runs it. A file in no project keeps the working-directory
# form, and an explicit base (set_location_base_path) wins over both.

#: directory → the nearest directory at or above it holding a pyproject.toml, or None
_project_roots: dict[str, str | None] = {}

#: co_filename → the path a source map records, or None when the frame is not the author's
_map_paths: dict[str, str | None] = {}


def _project_root(directory: str) -> str | None:
    hit = _project_roots.get(directory, _MISS)
    if hit is not _MISS:
        return hit
    parent = os.path.dirname(directory)
    if os.path.isfile(os.path.join(directory, "pyproject.toml")):
        root: str | None = directory
    elif parent == directory:
        root = None
    else:
        root = _project_root(parent)
    if len(_project_roots) > _CACHE_LIMIT:
        _project_roots.clear()
    _project_roots[directory] = root
    return root


def _map_path(filename: str) -> str | None:
    hit = _map_paths.get(filename, _MISS)
    if hit is not _MISS:
        return hit
    path = _author_path(filename)
    if path is not None and not _explicit_base_set and not filename.startswith("<"):
        try:
            absolute = os.path.abspath(filename)
            root = _project_root(os.path.dirname(absolute))
            if root is not None:
                path = _clean(os.path.relpath(absolute, root))
        except (OSError, ValueError):  # pragma: no cover - a path nothing above expected
            pass
    if len(_map_paths) > _CACHE_LIMIT:
        _map_paths.clear()
    _map_paths[filename] = path
    return path


# ─── Positions ──────────────────────────────────────────────────────────────
#
# A frame's executing instruction has a (line, column) in its code object's
# position table (PEP 657, python 3.11+): the start of the expression being
# evaluated, which is the call the author wrote. The table is materialized
# ONCE per code object — one list, indexed by instruction — and code objects
# are keyed by identity, pinned by the entry so the id cannot be recycled
# (#636). Keying a memo by the code object itself hashed its whole bytecode
# on every lookup, which on a 4,479-line generated body cost more than the
# build; and a per-(code, offset) memo capped at a few thousand entries
# thrashed on exactly the programs with more instructions than that, paying
# an O(offset) walk of the table per node.

#: id(code) → (the code object, its (line, column) per instruction, or None
#: when the interpreter reports no positions)
_position_tables: dict[int, tuple[Any, list[tuple[int | None, int | None]] | None]] = {}
_TABLE_LIMIT = 256


def _position_table(code: Any) -> list[tuple[int | None, int | None]] | None:
    entry = _position_tables.get(id(code))
    if entry is not None and entry[0] is code:
        return entry[1]
    table: list[tuple[int | None, int | None]] | None
    try:
        table = [(start_line, start_col) for start_line, _end, start_col, _ecol in code.co_positions()]
    except Exception:  # pragma: no cover - a code object without positions
        table = None
    if len(_position_tables) >= _TABLE_LIMIT:
        _position_tables.clear()
    _position_tables[id(code)] = (code, table)
    return table


def _position(frame: Any) -> tuple[int, int]:
    line = frame.f_lineno
    column = 0
    table = _position_table(frame.f_code)
    if table is not None:
        index = frame.f_lasti // 2
        if 0 <= index < len(table):
            start_line, start_col = table[index]
            if start_line is not None:
                line = start_line
            if start_col is not None:
                column = start_col + 1
    return line, column


def author_frames_of(tb: Any) -> tuple[Location, ...]:
    """The author's frames of a TRACEBACK, innermost first.

    :func:`capture_frames` reads the live stack while a node is being built;
    this reads the stack a build error was raised on, which is what
    ``east-py check`` needs to say WHERE a refusal happened after catching it.
    The same filtering applies — East's own package, the standard library and
    installed packages drop out, so the stack heads with the line the author
    wrote.

    Args:
        tb: The traceback to walk (``exception.__traceback__``).

    Returns:
        The author's ``(file, line, column)`` frames, innermost first; empty
        when the raise happened entirely inside East or the standard library.
    """
    frames: list[Location] = []
    current = tb
    while current is not None:
        code = current.tb_frame.f_code
        path = _author_path(code.co_filename)
        if path is not None:
            line = current.tb_lineno
            column = 0
            table = _position_table(code)
            if table is not None:
                index = current.tb_lasti // 2
                if 0 <= index < len(table):
                    start_line, start_col = table[index]
                    if start_line is not None:
                        line = start_line
                    if start_col is not None:
                        column = start_col + 1
            frames.append((path, line, column))
        current = current.tb_next
    frames.reverse()
    return tuple(frames)


def author_frames_from(frame: Any) -> tuple[Location, ...]:
    """The author's frames of a live stack, from ``frame`` outward, named as
    :func:`author_frames_of` names a traceback's.

    What ``east-py check`` reports for a refusal raised before a body ran — a
    signature check, a declared ``out`` the body does not produce — whose
    traceback holds only East's frames: the ``East.function`` call, given as
    the frame that made it, and its callers. Paths are relative to the working
    directory, as an editor resolves them, not recorded ones.

    Args:
        frame: The innermost frame to walk from.

    Returns:
        The author's ``(file, line, column)`` frames, innermost first.
    """
    frames: list[Location] = []
    while frame is not None:
        path = _author_path(frame.f_code.co_filename)
        if path is not None:
            line, column = _position(frame)
            frames.append((path, line, column))
        frame = frame.f_back
    return tuple(frames)


_capture_enabled = True


def set_location_capture(enabled: bool) -> None:
    """Switch source-location capture on or off for every build from now on.

    On by default. Every node a build constructs records the author's frames,
    a walk of the live python stack. A host that builds many functions and
    never reads their locations can switch that off. While it is off,
    :func:`capture_frames` returns ``()`` and :func:`location_id` returns
    ``UNKNOWN_LOC_ID`` without walking the stack, so an error raised by such
    a node carries no location. Binding names read their own frame
    (``naming.py``) and are unaffected. A function built while capture was
    off stays location-free after it is switched back on. The twin of
    TypeScript's ``setLocationCapture``.

    Args:
        enabled: ``False`` to build without capturing locations, ``True`` to
            capture them again.
    """
    global _capture_enabled
    _capture_enabled = enabled


def capture_frames() -> tuple[Location, ...]:
    """The author's frames of the current call, innermost first.

    East's own frames, the standard library and installed packages are
    dropped (see the module notes), paths take the form a source map records
    ("Recorded paths"), and columns are 1-based. In a build the walk stops
    at the frame that called ``East.function`` (:func:`source_map_scope`).
    Empty when no author frame is on the stack, or while capture is switched
    off (:func:`set_location_capture`).
    """
    if not _capture_enabled:
        return ()
    frame = sys._getframe(1)
    stop = _boundary
    out: list[Location] = []
    while frame is not None:
        path = _map_path(frame.f_code.co_filename)
        if path is not None:
            line, column = _position(frame)
            out.append((path, line, column))
        if frame is stop:
            out.extend(_tail)
            break
        frame = frame.f_back
    return tuple(out)


def frame_location(frame: Any) -> tuple[Location, ...]:
    """What a build's stacks end with when ``frame`` called ``East.function``:
    the frame's own location when it is the author's, else nothing.

    A function built after its declaration (``function.deferred_builds``)
    takes it at the declaration, where the frame still is, and ends its
    stacks with it (:func:`source_map_scope`'s ``tail``), as a build at the
    declaration would."""
    if not _capture_enabled:
        return ()
    path = _map_path(frame.f_code.co_filename)
    if path is None:
        return ()
    line, column = _position(frame)
    return ((path, line, column),)


# ─── The ambient map ────────────────────────────────────────────────────────

_current: SourceMap | None = None
#: the frame the open build's stacks stop at, or None to walk the whole stack
_boundary: Any = None
#: what a stack ends with once the walk stops at the boundary
_tail: tuple[Location, ...] = ()


@contextlib.contextmanager
def source_map_scope(boundary: Any = None, tail: tuple[Location, ...] = ()) -> Iterator[SourceMap]:
    """Run a build with a source map current, yielding that map.

    A fresh map when none is open; the ENCLOSING build's when one is — a
    function built inside another body shares its map, so the nested
    function's ids resolve wherever the enclosing one's do (TS
    ``ensure_source_map``). Re-entrant safe.

    Args:
        boundary: The frame that called ``East.function``. A fresh map's
            stacks stop at it, so they hold the function's own frames — its
            body's, the helpers those called and the call that built it —
            and never those of the code that imported or called its module.
            A nested build keeps the enclosing build's. ``None`` walks the
            whole stack.
        tail: What each stack ends with after the boundary: the
            declaration's location (:func:`frame_location`) for a function
            built after it was declared, whose boundary is then a frame of
            East's own.
    """
    global _current, _boundary, _tail
    if _current is not None:
        yield _current
        return
    _current = SourceMap()
    previous = _boundary, _tail
    _boundary, _tail = boundary, tail
    try:
        yield _current
    finally:
        _current = None
        _boundary, _tail = previous


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
