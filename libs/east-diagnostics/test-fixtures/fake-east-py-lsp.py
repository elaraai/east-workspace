#
# Copyright (c) 2025 Elara AI Pty Ltd
# Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
#
"""A stand-in `east-py lsp` for the proxy tests.

Speaks just enough LSP to be a real child of `PythonLspProxy`: it answers
`initialize` and publishes one diagnostic for any document whose text imports
east. Keeping it a FILE rather than a string built inside the test avoids
escaping python through a TypeScript template literal, which is how the first
version of this silently produced a server that never answered.
"""

import json
import sys

DIAGNOSTIC = {
    "range": {"start": {"line": 4, "character": 11}, "end": {"line": 4, "character": 17}},
    "severity": 1,
    "code": "no-operator-fork",
    "source": "east-py",
    "message": "python `//` floors",
}


def send(message):
    body = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
    sys.stdout.buffer.flush()


def main():
    buffer = b""
    while True:
        chunk = sys.stdin.buffer.read(1)
        if not chunk:
            return
        buffer += chunk
        while True:
            end = buffer.find(b"\r\n\r\n")
            if end < 0:
                break
            header = buffer[:end].decode("utf-8")
            length = None
            for line in header.split("\r\n"):
                if line.lower().startswith("content-length"):
                    length = int(line.split(":")[1].strip())
            if length is None or len(buffer) < end + 4 + length:
                break
            message = json.loads(buffer[end + 4:end + 4 + length])
            buffer = buffer[end + 4 + length:]
            handle(message)


def handle(message):
    method = message.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"capabilities": {}}})
        return
    if method not in ("textDocument/didOpen", "textDocument/didChange", "textDocument/didSave"):
        return
    params = message["params"]
    document = params["textDocument"]
    text = document.get("text")
    if text is None:
        text = params.get("text")
    if text is None:
        changes = params.get("contentChanges") or [{}]
        text = changes[-1].get("text", "")
    # `from east import East` and `import east` both count — the same two
    # shapes the real PYTHON_EAST_IMPORT matches.
    imports_east = "from east import" in text or "import east" in text
    found = [DIAGNOSTIC] if imports_east else []
    send({"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics",
          "params": {"uri": document["uri"], "diagnostics": found}})


if __name__ == "__main__":
    main()
