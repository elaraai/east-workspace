#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py lsp`` (#638): the East diagnostics as a Language Server.

The server speaks the Language Server Protocol over stdio and publishes the
engine's diagnostics for every python document an editor opens, changes or
saves — the python twin of the TypeScript language-service plugin
(``tsserver-plugin-east``). It is built on ``pygls``, an optional extra
(``pip install 'elaraai-east-py-cli[lsp]'``): without it ``east-py lsp``
says so and exits. :func:`lsp_diagnostics` is the protocol-shaped payload
(zero-based positions, LSP severities) and needs no ``pygls``.
"""

from __future__ import annotations

import sys
from typing import Any

from east.diagnostics import run_east_rules

from east_py_cli import __version__

#: LSP DiagnosticSeverity: Error = 1, Warning = 2, Information = 3
SEVERITY = {"error": 1, "warning": 2, "suggestion": 3}
SOURCE = "east-py"


def lsp_diagnostics(source: str, filename: str) -> list[dict[str, Any]]:
    """The engine's diagnostics of ``source`` in LSP shape: a zero-based
    ``range``, a ``severity``, the ``EASnnn`` code, and the message."""
    out: list[dict[str, Any]] = []
    for d in run_east_rules(source, filename):
        out.append({
            "range": {
                "start": {"line": d.line - 1, "character": max(d.column - 1, 0)},
                "end": {"line": d.end_line - 1, "character": max(d.end_column - 1, 0)},
            },
            "severity": SEVERITY.get(d.category, 1),
            "code": d.flake8_code,
            "source": SOURCE,
            "message": f"{d.message} [{d.rule}]",
        })
    return out


NEEDS_PYGLS = ("east-py lsp needs pygls — install it with `pip install pygls` "
               "(or `pip install 'elaraai-east-py-cli[lsp]'`)")


def serve() -> int:
    """Serves the diagnostics over stdio until the client closes the
    connection. Returns the exit code."""
    try:
        from lsprotocol import types as lsp  # type: ignore[import-not-found,unused-ignore]
        from pygls.server import LanguageServer  # type: ignore[import-not-found,unused-ignore]
    except ImportError:
        print(NEEDS_PYGLS, file=sys.stderr)
        return 1

    server = LanguageServer(SOURCE, __version__)

    def publish(ls: Any, uri: str) -> None:
        workspace = ls.workspace
        get = getattr(workspace, "get_text_document", None) or workspace.get_document
        document = get(uri)
        ls.publish_diagnostics(uri, [
            lsp.Diagnostic(
                range=lsp.Range(
                    start=lsp.Position(line=d["range"]["start"]["line"], character=d["range"]["start"]["character"]),
                    end=lsp.Position(line=d["range"]["end"]["line"], character=d["range"]["end"]["character"]),
                ),
                severity=lsp.DiagnosticSeverity(d["severity"]),
                code=d["code"],
                source=d["source"],
                message=d["message"],
            )
            for d in lsp_diagnostics(document.source, document.path or uri)
        ])

    @server.feature(lsp.TEXT_DOCUMENT_DID_OPEN)
    def did_open(ls: Any, params: Any) -> None:
        publish(ls, params.text_document.uri)

    @server.feature(lsp.TEXT_DOCUMENT_DID_CHANGE)
    def did_change(ls: Any, params: Any) -> None:
        publish(ls, params.text_document.uri)

    @server.feature(lsp.TEXT_DOCUMENT_DID_SAVE)
    def did_save(ls: Any, params: Any) -> None:
        publish(ls, params.text_document.uri)

    server.start_io()
    return 0
