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

The second is why this server exists rather than a subprocess per document:
a re-check in a warm process costs a fraction of a millisecond once the
module's dependencies are in ``sys.modules``, against 0.1–0.8 s for a cold
subprocess. The build tier reads the module from DISK — an import does — so it
runs when the file on disk is what the editor shows: on OPEN (debounced, since
an editor restoring a session opens many files at once) and on SAVE (at
once), and only when the project has opted in with ``[tool.east-py] check =
true``. Its findings are cached per document and merged into every publish, so
a keystroke never blinks them out; the next save replaces them. A save also
evicts the saved module from ``sys.modules``, so a module that imports it is
checked against the new version next time.

The build tier runs on ONE long-lived worker thread — never on the handler,
never on a fresh thread per document. pygls runs a plain handler on its event
loop, so an import that wedges there would block every document; and an East
artifact built on a short-lived thread and collected after that thread exits
aborts the interpreter, so a ``threading.Timer`` per open would take the
server down within a few opens. One worker, a debounced queue inside it, and
the builder — which keeps its trace state in module globals — is never
entered from two threads.

Built on ``pygls``, 1.3 or 2.x (the two spell the server class and the
publish call differently; both are served). ``east-py lsp --probe`` says
whether the server can start here, for a launcher or a health check.
:func:`lsp_diagnostics` and :func:`lsp_build_diagnostics` are the
protocol-shaped payloads and need no ``pygls``.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.metadata
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from east.diagnostics import run_east_rules

from east_py_cli import __version__

#: LSP DiagnosticSeverity: Error = 1, Warning = 2, Information = 3
SEVERITY = {"error": 1, "warning": 2, "suggestion": 3}
SOURCE = "east-py"
#: how long an OPEN settles before the build tier runs, in seconds — a save
#: runs it at once
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
    except KeyboardInterrupt:
        raise
    except BaseException as e:  # noqa: BLE001 - a module may do anything on import
        print(f"east-py lsp: the build tier failed for {path}: {type(e).__name__}: {e}", file=sys.stderr)
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
        if same_file(f.path, path)
    ]


def same_file(a: str, b: str) -> bool:
    """Whether two paths name the same file.

    Not a string comparison. A finding's path comes from East's source map,
    which normalizes separators to ``/`` and relativizes against the working
    directory; the document path comes from the editor in the platform's own
    spelling. On Windows those never matched as strings, so every build finding
    was filtered out and the whole tier was silently dead.
    """
    try:
        return Path(a).resolve() == Path(b).resolve()
    except (OSError, ValueError):
        return a == b


NEEDS_PYGLS = ("east-py lsp needs pygls — install it with `pip install pygls` "
               "(or reinstall elaraai-east-py-cli, which depends on it)")


def _import_pygls() -> tuple[Any, Any]:
    """``(the LanguageServer class, lsprotocol.types)`` — pygls 2 moved the
    server class to ``pygls.lsp.server``; 1.x keeps it in ``pygls.server``.

    Raises:
        ImportError: When neither pygls nor lsprotocol is importable.
    """
    lsp = importlib.import_module("lsprotocol.types")
    for module_name in ("pygls.lsp.server", "pygls.server"):
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            continue
        server_cls = getattr(module, "LanguageServer", None)
        if server_cls is not None:
            return server_cls, lsp
    raise ImportError("pygls")


def probe() -> int:
    """``east-py lsp --probe``: whether the server can start here — what a
    launcher or a health check asks before trusting it. Prints the answer,
    returns the exit code."""
    try:
        _import_pygls()
    except ImportError:
        print(NEEDS_PYGLS, file=sys.stderr)
        return 1
    try:
        version = importlib.metadata.version("pygls")
    except importlib.metadata.PackageNotFoundError:
        version = "unknown"
    print(f"east-py lsp ok (pygls {version})")
    return 0


class _BuildWorker:
    """The build tier's ONE thread: a debounced queue of documents, checked
    one at a time, for the life of the server."""

    def __init__(self, run: Callable[[str, str], None]) -> None:
        self._run = run
        #: path -> (deadline, uri)
        self._due: dict[str, tuple[float, str]] = {}
        self._cv = threading.Condition()
        self._stopped = False
        self._thread = threading.Thread(target=self._loop, name="east-py-build", daemon=True)
        self._thread.start()

    def request(self, path: str, uri: str, delay: float) -> None:
        with self._cv:
            self._due[path] = (time.monotonic() + delay, uri)
            self._cv.notify()

    def cancel(self, path: str) -> None:
        with self._cv:
            self._due.pop(path, None)

    def stop(self) -> None:
        with self._cv:
            self._stopped = True
            self._cv.notify()

    def _loop(self) -> None:
        while True:
            with self._cv:
                while not self._stopped:
                    if not self._due:
                        self._cv.wait()
                        continue
                    path, (deadline, uri) = min(self._due.items(), key=lambda item: item[1][0])
                    wait = deadline - time.monotonic()
                    if wait <= 0:
                        del self._due[path]
                        break
                    self._cv.wait(wait)
                if self._stopped:
                    return
            try:
                self._run(path, uri)
            except Exception as e:  # noqa: BLE001 - the worker outlives any one document's failure
                print(f"east-py lsp: build tier failed for {path}: {type(e).__name__}: {e}", file=sys.stderr)


def serve() -> int:
    """Serves both tiers over stdio until the client closes the connection.
    Returns the exit code."""
    try:
        server_cls, lsp = _import_pygls()
    except ImportError:
        print(NEEDS_PYGLS, file=sys.stderr)
        return 1

    from east_py_cli.check import forget_module

    server = server_cls(SOURCE, __version__)
    # path -> the rules last computed, and the build findings last computed;
    # every publish merges both, so a keystroke never blinks a build finding out
    rules_cache: dict[str, list[dict[str, Any]]] = {}
    build_cache: dict[str, list[dict[str, Any]]] = {}
    lock = threading.Lock()
    #: the event loop the handlers run on, captured on first use, so the
    #: worker hands its publishes back to it rather than writing the transport
    #: from a second thread
    loop_holder: dict[str, Any] = {"loop": None}

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

    def document(uri: str) -> Any:
        workspace = server.workspace
        get = getattr(workspace, "get_text_document", None) or workspace.get_document
        return get(uri)

    def publish(uri: str, path: str) -> None:
        with lock:
            merged = [*rules_cache.get(path, []), *build_cache.get(path, [])]
        diagnostics = [to_lsp(r) for r in merged]
        publish_params = getattr(server, "text_document_publish_diagnostics", None)
        if publish_params is not None:  # pygls >= 2
            publish_params(lsp.PublishDiagnosticsParams(uri=uri, diagnostics=diagnostics))
        else:  # pygls 1.x
            server.publish_diagnostics(uri, diagnostics)

    def remember_loop() -> None:
        try:
            loop_holder["loop"] = asyncio.get_running_loop()
        except RuntimeError:
            loop_holder["loop"] = None

    def run_rules(uri: str) -> str:
        remember_loop()
        doc = document(uri)
        path = doc.path or uri
        found = lsp_diagnostics(doc.source, path)
        with lock:
            rules_cache[path] = found
        publish(uri, path)
        return path

    def build(path: str, uri: str) -> None:
        # on the worker thread
        findings = lsp_build_diagnostics(path)
        with lock:
            build_cache[path] = findings
        loop = loop_holder["loop"]
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(publish, uri, path)
        else:
            publish(uri, path)

    worker = _BuildWorker(build)

    @server.feature(lsp.TEXT_DOCUMENT_DID_OPEN)
    def did_open(ls: Any, params: Any) -> None:
        del ls
        uri = params.text_document.uri
        path = run_rules(uri)
        worker.request(path, uri, BUILD_DEBOUNCE)

    @server.feature(lsp.TEXT_DOCUMENT_DID_CHANGE)
    def did_change(ls: Any, params: Any) -> None:
        # Tier one only. The buffer is dirty and the build tier reads disk, so
        # running it here would republish the last SAVED version's errors at
        # that version's lines. The cached build findings stay merged in.
        del ls
        run_rules(params.text_document.uri)

    @server.feature(lsp.TEXT_DOCUMENT_DID_SAVE)
    def did_save(ls: Any, params: Any) -> None:
        del ls
        uri = params.text_document.uri
        path = run_rules(uri)
        forget_module(path)
        worker.request(path, uri, 0.0)

    @server.feature(lsp.TEXT_DOCUMENT_DID_CLOSE)
    def did_close(ls: Any, params: Any) -> None:
        del ls
        path = document(params.text_document.uri).path
        worker.cancel(path)
        with lock:
            rules_cache.pop(path, None)
            build_cache.pop(path, None)

    try:
        server.start_io()
    finally:
        worker.stop()
    return 0
