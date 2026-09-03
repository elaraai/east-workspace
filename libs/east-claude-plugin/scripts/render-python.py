#
# Copyright (c) 2025 Elara AI Pty Ltd
# Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
#
"""Fill the python renderings of the example index (#654).

``generate-index`` stores every program example as its IR and the TypeScript
printed from it; the python printing is this script's — the same IR through
``east.codegen.to_python_source``, exact by the round-trip contract. Run after
the generator, from an environment where ``east`` imports::

    uv run --project ../east-py python scripts/render-python.py index.json

Every entry with an ``ir`` gets its ``python``; entries without one (UI,
hand-written stubs) are left alone. The file is rewritten in place.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from east.codegen import to_python_source
from east.serialization.json import decode_json_for
from east.types.type_of_type import IRType


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: render-python.py <index.json>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    decode = decode_json_for(IRType)
    rendered = 0
    for entry in data["entries"]:
        ir = entry.get("ir")
        if ir is None:
            continue
        name = entry["id"].rsplit(":", 1)[1]
        entry["python"] = to_python_source(decode(ir.encode("utf-8")), name=name)
        rendered += 1
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[+] Rendered {rendered} example(s) as python in {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
