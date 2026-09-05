#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py lsp`` (#638, #681): the East diagnostics as a Language Server.

Two tiers, because they cost different amounts and fail differently:

- **the rules** (``east.diagnostics``) are pure ``ast`` work, run on every
  change, and still say something useful about a buffer that does not parse;
- **the build check** (``east-py check``, #653) imports the module and builds
  its East functions, which is what makes it a TYPE check — and what makes it
  cost the module's whole import.

The second is why this server exists rather than a subprocess per document.
Measured on ``east-py check`` here: a cold subprocess costs 0.12s for a module
whose dependencies import lazily and 0.81s for one that imports torch at module
scope, while a re-check in a warm process costs 0.0003s once those dependencies
are in ``sys.modules``. On SAVE a subprocess would do; debounced on CHANGE,
which is what makes a type error appear as you type, it would not. The build
tier runs on a worker thread and is debounced, so a slow or wedged build never
blocks the rules — and the client owns restarting this process if it stops
answering at all.

Built on ``pygls``: ``pip install 'elaraai-east-py-cli[lsp]'``. Without it
``east-py lsp`` says so and exits. :func:`lsp_diagnostics` and
:func:`lsp_build_diagnostics` are the protocol-shaped payloads and need no
``pygls``.
"""

from __future__ import annotations

import contextlib
import sys
import threading
from typing import Any

from east.diagnostics import run_east_rules

from east_py_cli import __version__

#: LSP DiagnosticSeverity: Error = 1, Warning = 2, Information = 3
SEVERITY = {"error": 1, "warning": 2, "suggestion": 3}
SOURCE = "east-py"
#: how long a change settles before the build tier runs, in seconds
BUILD_DEBOUNCE = 0.6


def _range(line: int, column: int, end_line: int, end_column: int) -> dict[str, Any]:
    return {
        "start": {"line": line - 1, "character": max(column - 1, 0)},
        "end": {"line": end_line - 1, "character": max(end_column - 1, 0)},
    }


def lsp_diagnostics(source: str, filename: str) -> list[dict[str, Any]]:
    """Tier one: the rules of ``source`` in LSP shape — a zero-based
    ``range``, a ``severity``, the ``EASnnn`` code, and the message."""
    from east.diagnostics import load_config

    return [
        {
            "range": _range(d.line, d.column, d.end_line, d.end_column),
            "severity": SEVERITY.get(d.category, 1),
            "code": d.flake8_code,
            "source": SOURCE,
            "message": f"{d.message} [{d.rule}]",
        }
        for d in run_east_rules(source, filename, disabled=load_config(filename).disable)
    ]


def lsp_build_diagnostics(path: str) -> list[dict[str, Any]]:
    """Tier two: the BUILD's errors for the module at ``path``, in LSP shape.

    Returns nothing unless the project opts in with ``[tool.east-py] check =
    true``. The rules READ a file; this one RUNS it, and importing a module
    executes it — an editor must not start doing that to someone's project
    because a language server happened to be installed. An explicit
    ``east-py check`` is consent in itself and does not consult the setting.

    Only findings the build reports against ``path`` itself are returned — a
    module it imports has its own document.
    """
    from east.diagnostics import load_config

    from east_py_cli.check import check_module

    if not load_config(path).check:
        return []
    try:
        findings = check_module(path)
    except BaseException:  # noqa: BLE001 - a module may do anything on import
        return []
    return [
        {
            "range": _range(f.line, f.column, f.end_line, f.end_column),
            "severity": SEVERITY.get(f.category, 1),
            "code": f.code,
            "source": SOURCE,
            "message": f"{f.message} [{f.rule}]",
        }
        for f in findings
        if f.path == path
    ]


NEEDS_PYGLS = ("east-py lsp needs pygls — install it with `pip install pygls` "
               "(or `pip install 'elaraai-east-py-cli[lsp]'`)")


def serve() -> int:
    """Serves both tiers over stdio until the client closes the connection.
    Returns the exit code."""
    try:
        from lsprotocol import types as lsp  # type: ignore[import-not-found,unused-ignore]
        from pygls.server import LanguageServer  # type: ignore[import-not-found,unused-ignore]
    except ImportError:
        print(NEEDS_PYGLS, file=sys.stderr)
        return 1

    server = LanguageServer(SOURCE, __version__)
    # path -> the build findings last computed for it, merged into every
    # publish so a keystroke does not blink them out and back.
    build_cache: dict[str, list[dict[str, Any]]] = {}
    timers: dict[str, threading.Timer] = {}
    lock = threading.Lock()

    def to_lsp(record: dict[str, Any]) -> Any:
        return lsp.Diagnostic(
            range=lsp.Range(
                start=lsp.Position(line=record["range"]["start"]["line"],
                                   character=record["range"]["start"]["character"]),
                end=lsp.Position(line=record["range"]["end"]["line"],
                                 character=record["range"]["end"]["character"]),
            ),
            severity=lsp.DiagnosticSeverity(record["severity"]),
            code=record["code"],
            source=record["source"],
            message=record["message"],
        )

    def document(ls: Any, uri: str) -> Any:
        workspace = ls.workspace
        get = getattr(workspace, "get_text_document", None) or workspace.get_document
        return get(uri)

    def publish(ls: Any, uri: str, rules: list[dict[str, Any]], path: str) -> None:
        with lock:
            merged = [*rules, *build_cache.get(path, [])]
        ls.publish_diagnostics(uri, [to_lsp(r) for r in merged])

    def run_rules(ls: Any, uri: str) -> tuple[list[dict[str, Any]], str]:
        doc = document(ls, uri)
        path = doc.path or uri
        rules = lsp_diagnostics(doc.source, path)
        publish(ls, uri, rules, path)
        return rules, path

    def build_later(ls: Any, uri: str, path: str, rules: list[dict[str, Any]]) -> None:
        """Run the build tier off the request path, debounced per document."""

        def go() -> None:
            findings = lsp_build_diagnostics(path)
            with lock:
                build_cache[path] = findings
            # Never let the build tier kill the server: it runs on a worker
            # thread, and a raise here would take the thread down silently.
            with contextlib.suppress(Exception):
                publish(ls, uri, rules, path)

        with lock:
            existing = timers.pop(path, None)
        if existing is not None:
            existing.cancel()
        timer = threading.Timer(BUILD_DEBOUNCE, go)
        timer.daemon = True
        with lock:
            timers[path] = timer
        timer.start()

    @server.feature(lsp.TEXT_DOCUMENT_DID_OPEN)
    def did_open(ls: Any, params: Any) -> None:
        uri = params.text_document.uri
        rules, path = run_rules(ls, uri)
        build_later(ls, uri, path, rules)

    @server.feature(lsp.TEXT_DOCUMENT_DID_CHANGE)
    def did_change(ls: Any, params: Any) -> None:
        uri = params.text_document.uri
        rules, path = run_rules(ls, uri)
        build_later(ls, uri, path, rules)

    @server.feature(lsp.TEXT_DOCUMENT_DID_SAVE)
    def did_save(ls: Any, params: Any) -> None:
        uri = params.text_document.uri
        rules, path = run_rules(ls, uri)
        # A save is the moment the file on disk matches the buffer, so the
        # build tier runs against it without waiting out the debounce.
        findings = lsp_build_diagnostics(path)
        with lock:
            build_cache[path] = findings
        publish(ls, uri, rules, path)

    @server.feature(lsp.TEXT_DOCUMENT_DID_CLOSE)
    def did_close(ls: Any, params: Any) -> None:
        path = document(ls, params.text_document.uri).path
        with lock:
            build_cache.pop(path, None)
            timer = timers.pop(path, None)
        if timer is not None:
            timer.cancel()

    server.start_io()
    return 0
