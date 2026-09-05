#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The East rules as a ``python-lsp-server`` plugin (#681).

TypeScript surfaces its East diagnostics by riding the editor's existing
language service (``tsserver-plugin-east``), which works because tsserver has
a plugin API. Python's dominant server, Pyright/Pylance, has none — so there
is no equivalent for it, and never can be without Microsoft adding one.

``python-lsp-server`` does have one. For anyone running pylsp this is the same
trick: no second server, no East-specific configuration, the rules appearing
as ordinary squiggles beside pyflakes' and ruff's. Registered by the ``pylsp``
entry point (see ``pyproject.toml``); pylsp itself is not a dependency, since
the hook is only ever called by a pylsp that already imported it.

Rules only. The build check (#653) imports the module, which is not something
to do inside someone else's editor process on every keystroke — that tier
lives in ``east-py lsp``, which owns its own lifecycle.
"""

from __future__ import annotations

from typing import Any

from east.diagnostics import load_config, run_east_rules

#: pylsp severities: Error = 1, Warning = 2, Information = 3
SEVERITY = {"error": 1, "warning": 2, "suggestion": 3}


def _hookimpl() -> Any:
    """pylsp's pluggy marker, imported lazily so this module stays importable
    (and testable) without pylsp installed."""
    from pylsp import hookimpl  # type: ignore[import-not-found,unused-ignore]

    return hookimpl


def east_diagnostics(source: str, path: str) -> list[dict[str, Any]]:
    """The rules of ``source`` in pylsp's diagnostic shape."""
    return [
        {
            "source": "east-py",
            "code": d.flake8_code,
            "range": {
                "start": {"line": d.line - 1, "character": max(d.column - 1, 0)},
                "end": {"line": d.end_line - 1, "character": max(d.end_column - 1, 0)},
            },
            "message": f"{d.message} [{d.rule}]",
            "severity": SEVERITY.get(d.category, 1),
        }
        for d in run_east_rules(source, path, disabled=load_config(path).disable)
    ]


try:  # pragma: no cover - exercised only inside a pylsp process
    from pylsp import hookimpl  # type: ignore[import-not-found,unused-ignore]

    @hookimpl
    def pylsp_lint(document: Any) -> list[dict[str, Any]]:
        """The pylsp lint hook: East diagnostics for one document."""
        return east_diagnostics(document.source, str(document.path))

except ImportError:  # pylsp is not installed; the entry point is simply never called

    def pylsp_lint(document: Any) -> list[dict[str, Any]]:  # type: ignore[misc]
        """The pylsp lint hook: East diagnostics for one document."""
        return east_diagnostics(document.source, str(document.path))
