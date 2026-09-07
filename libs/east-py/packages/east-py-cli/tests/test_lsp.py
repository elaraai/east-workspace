#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py lsp`` (#681): the REAL server, over stdio, both tiers.

The payload functions are unit-tested elsewhere; this starts the process the
plugin and an editor start, speaks the protocol to it, and reads what it
publishes. A stand-in server proves a proxy's framing; only this proves the
server.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Empty, Queue

import pytest

BAD = ("from east import East, IntegerType\n"
       "\n"
       "@East.function([IntegerType], IntegerType)\n"
       "def halve(b, x):\n"
       "    return x // 2\n")
CLEAN = ("from east import East, IntegerType\n"
         "\n"
         "double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)\n")
WRONG_OUT = ("from east import East\n"
             "from east.types.types import IntegerType, StringType\n"
             "\n"
             "wrong = East.function([IntegerType], StringType, lambda b, x: x + 1)\n")


class Server:
    """A running ``east-py lsp`` and the messages it has published."""

    def __init__(self, cwd: Path) -> None:
        self.process = subprocess.Popen(
            [sys.executable, "-m", "east_py_cli", "lsp"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        self.messages: Queue = Queue()
        self._next_id = 1
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        stream = self.process.stdout
        assert stream is not None
        while True:
            header = b""
            while not header.endswith(b"\r\n\r\n"):
                byte = stream.read(1)
                if not byte:
                    return
                header += byte
            length = int(next(line.split(b":")[1] for line in header.split(b"\r\n")
                              if line.lower().startswith(b"content-length")))
            self.messages.put(json.loads(stream.read(length)))

    def send(self, method: str, params: dict, *, request: bool = False) -> int | None:
        message: dict = {"jsonrpc": "2.0", "method": method, "params": params}
        ident = None
        if request:
            ident = self._next_id
            self._next_id += 1
            message["id"] = ident
        body = json.dumps(message).encode("utf-8")
        assert self.process.stdin is not None
        self.process.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        self.process.stdin.flush()
        return ident

    def wait_for(self, predicate, timeout: float = 30.0) -> dict:
        deadline = time.monotonic() + timeout
        seen: list[dict] = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                stderr = self.process.stderr.read().decode() if self.process.poll() is not None else ""
                raise AssertionError(f"timed out; saw {[m.get('method', m.get('id')) for m in seen]}; stderr: {stderr}")
            try:
                message = self.messages.get(timeout=remaining)
            except Empty:
                continue
            seen.append(message)
            if predicate(message):
                return message

    def published(self, uri: str, *, timeout: float = 30.0, want=None) -> list[dict]:
        message = self.wait_for(
            lambda m: m.get("method") == "textDocument/publishDiagnostics"
            and m["params"]["uri"] == uri and (want is None or want(m["params"]["diagnostics"])),
            timeout,
        )
        return message["params"]["diagnostics"]

    def close(self) -> None:
        with_stdin = self.process.stdin
        if with_stdin is not None:
            with_stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()


@pytest.fixture
def project(tmp_path: Path):
    (tmp_path / "pyproject.toml").write_text('[tool.east-py]\ncheck = true\n', encoding="utf-8")
    return tmp_path


def open_document(server: Server, path: Path, text: str) -> str:
    uri = path.as_uri()
    path.write_text(text, encoding="utf-8")
    server.send("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "python", "version": 1, "text": text}})
    return uri


def test_the_probe_says_the_server_can_start():
    result = subprocess.run([sys.executable, "-m", "east_py_cli", "lsp", "--probe"], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert "pygls" in result.stdout


def test_the_real_server_publishes_the_rules_on_open_and_change(project):
    server = Server(project)
    try:
        ident = server.send("initialize", {"processId": None, "rootUri": project.as_uri(), "capabilities": {}}, request=True)
        reply = server.wait_for(lambda m: m.get("id") == ident)
        assert "capabilities" in reply["result"]
        server.send("initialized", {})

        uri = open_document(server, project / "mod.py", BAD)
        found = server.published(uri, want=lambda ds: any(d["code"] == "EAS002" for d in ds))
        [rule] = [d for d in found if d["code"] == "EAS002"]
        assert rule["source"] == "east-py" and rule["severity"] == 1
        assert rule["range"]["start"] == {"line": 4, "character": 11}
        assert "no-operator-fork" in rule["message"]

        server.send("textDocument/didChange", {"textDocument": {"uri": uri, "version": 2}, "contentChanges": [{"text": CLEAN}]})
        assert server.published(uri, want=lambda ds: not any(d["code"] == "EAS002" for d in ds)) == []
    finally:
        server.close()


def test_the_build_tier_publishes_on_save_when_the_project_opts_in(project):
    server = Server(project)
    try:
        ident = server.send("initialize", {"processId": None, "rootUri": project.as_uri(), "capabilities": {}}, request=True)
        server.wait_for(lambda m: m.get("id") == ident)
        uri = open_document(server, project / "wrong.py", WRONG_OUT)
        # on open the build tier is debounced; on save it runs at once
        server.send("textDocument/didSave", {"textDocument": {"uri": uri}, "text": WRONG_OUT})
        found = server.published(uri, want=lambda ds: any(d["code"] == "EAS900" for d in ds))
        [build] = [d for d in found if d["code"] == "EAS900"]
        assert "declared out is String" in build["message"]
        assert build["range"]["start"]["line"] == 3
        # a keystroke keeps the build finding until the next save replaces it
        server.send("textDocument/didChange", {"textDocument": {"uri": uri, "version": 2}, "contentChanges": [{"text": WRONG_OUT + "\n"}]})
        still = server.published(uri, want=lambda ds: any(d["code"] == "EAS900" for d in ds))
        assert any(d["code"] == "EAS900" for d in still)
        # fixed and saved: the build finding goes
        (project / "wrong.py").write_text(CLEAN, encoding="utf-8")
        server.send("textDocument/didSave", {"textDocument": {"uri": uri}, "text": CLEAN})
        assert server.published(uri, want=lambda ds: ds == []) == []
    finally:
        server.close()


def test_the_build_tier_stays_silent_without_consent(tmp_path):
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "demo"\n', encoding="utf-8")
    server = Server(tmp_path)
    try:
        ident = server.send("initialize", {"processId": None, "rootUri": tmp_path.as_uri(), "capabilities": {}}, request=True)
        server.wait_for(lambda m: m.get("id") == ident)
        uri = open_document(server, tmp_path / "wrong.py", WRONG_OUT)
        server.send("textDocument/didSave", {"textDocument": {"uri": uri}, "text": WRONG_OUT})
        # the rules publish (nothing to say); the build tier must not import the module
        assert server.published(uri) == []
        with pytest.raises(AssertionError):
            server.published(uri, timeout=2.0, want=lambda ds: any(d["code"] == "EAS900" for d in ds))
    finally:
        server.close()


def test_a_buffer_that_does_not_parse_still_gets_the_rules_tier(project):
    server = Server(project)
    try:
        ident = server.send("initialize", {"processId": None, "rootUri": project.as_uri(), "capabilities": {}}, request=True)
        server.wait_for(lambda m: m.get("id") == ident)
        uri = open_document(server, project / "broken.py", "from east import East\ndef f(:\n")
        found = server.published(uri, want=lambda ds: len(ds) > 0)
        assert found[0]["code"] == "EAS000" and "syntax error" in found[0]["message"]
    finally:
        server.close()


def test_a_saved_sibling_is_re_executed_by_the_next_check(project):
    """The warm process caches what a checked module imports; a save evicts
    the saved module so an importer's next check sees the new version."""
    (project / "helpers.py").write_text("LIMIT = 'one'\n", encoding="utf-8")
    importer = ("from east import East\n"
                "from east.types.types import IntegerType, StringType\n"
                "from helpers import LIMIT\n"
                "\n"
                "wrong = East.function([IntegerType], StringType, lambda b, x: x + LIMIT)\n")
    server = Server(project)
    try:
        ident = server.send("initialize", {"processId": None, "rootUri": project.as_uri(), "capabilities": {}}, request=True)
        server.wait_for(lambda m: m.get("id") == ident)
        uri = open_document(server, project / "importer.py", importer)
        server.send("textDocument/didSave", {"textDocument": {"uri": uri}, "text": importer})
        first = server.published(uri, want=lambda ds: any(d["code"] == "EAS900" for d in ds))
        assert any("LIMIT" in d["message"] or "String" in d["message"] or "not traceable" in d["message"] for d in first)
        # fix the SIBLING and save it: the importer's next check must see the new version
        (project / "helpers.py").write_text("LIMIT = 1\n", encoding="utf-8")
        helpers_uri = open_document(server, project / "helpers.py", "LIMIT = 1\n")
        server.send("textDocument/didSave", {"textDocument": {"uri": helpers_uri}, "text": "LIMIT = 1\n"})
        server.published(helpers_uri)
        (project / "importer.py").write_text(importer.replace("StringType, lambda", "IntegerType, lambda"), encoding="utf-8")
        fixed = importer.replace("StringType, lambda", "IntegerType, lambda")
        server.send("textDocument/didSave", {"textDocument": {"uri": uri}, "text": fixed})
        assert server.published(uri, want=lambda ds: ds == []) == []
    finally:
        server.close()
