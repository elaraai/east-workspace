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

Each program example is also printed as **eager** python where it can be: the
same code over East values rather than inside an ``East.function``, since an
eager method and its expression twin are one builtin under one name. A body of
bindings and a ``return`` — ``x = b.let(literal, T)`` becoming
``x = coerce_to(literal, T)``, ``x = b.let(expr)`` becoming ``x = expr``,
callbacks left as the bodies they are — is rewritten so, then RUN, and kept as
an entry of its own (``<id>:eager``, package ``east-values``, searched only when
named: another job than writing an East function) only when it returns
the example's result: an eager rendering is tested as it is made. Core East's
examples alone (a platform package's would run its effects, a file written or a
request sent, as it is checked), and no async one; a body that needs the block
anywhere else (``b.if_``, a loop, a ``b.match_``) has none.

A platform call prints as the implementing package's own function and a
struct or variant type the package names prints by that name (#667) — the
python reading of what the TypeScript rendering spells through the
library's handles — for every stock package this environment can import;
a package that does not import here (an optional dependency missing) is
skipped with a warning and its calls print as declarations.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any

from east.codegen import Providers, to_python_source
from east.serialization.json import decode_json_for
from east.types.type_of_type import IRType

#: The stock platform packages, in provider order.
STOCK_PACKAGES = ("east_py_std", "east_py_io", "east_py_datascience")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: render-python.py <index.json>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    decode = decode_json_for(IRType)
    providers = Providers()
    for package in STOCK_PACKAGES:
        try:
            providers.add_module(package)
        except Exception as e:  # noqa: BLE001 — an optional dependency this environment lacks
            print(f"[!] {package} does not import here ({e}); its calls print as declarations",
                  file=sys.stderr)
    rendered = 0
    eager: list[dict[str, Any]] = []
    for entry in data["entries"]:
        ir = entry.get("ir")
        if ir is None:
            continue
        name = entry["id"].rsplit(":", 1)[1]
        entry["python"] = to_python_source(decode(ir.encode("utf-8")), name=name, providers=providers)
        rendered += 1
        made = eager_entry(entry)
        if made is not None:
            eager.append(made)
    data["entries"] = [e for e in data["entries"] if not e["id"].endswith(":eager")] + eager
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[+] Rendered {rendered} example(s) as python in {path}, {len(eager)} of them eagerly", file=sys.stderr)
    return 0


def _binding(stmt: ast.stmt) -> tuple[str, ast.Call] | None:
    """``x = b.let(…)`` / ``x = b.const(…)``: the name and the call, else None."""
    if not (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name)):
        return None
    call = stmt.value
    if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name)
            and call.func.value.id == "b" and call.func.attr in ("let", "const") and not call.keywords and 1 <= len(call.args) <= 2):
        return stmt.targets[0].id, call
    return None


def _uses_block(node: ast.AST) -> bool:
    """Whether a node reads the block ``b`` outside the callbacks (lambdas) it holds."""
    if isinstance(node, ast.Lambda):
        return False
    if isinstance(node, ast.Name) and node.id == "b":
        return True
    return any(_uses_block(child) for child in ast.iter_child_nodes(node))


def eager_source(python: str) -> str | None:
    """A program example's python printing rewritten as eager code, or None when its body needs the block.

    The printed module is the imports and one ``@East.function`` taking only
    the block; its body must be bindings (``b.let`` / ``b.const``) and a final
    ``return``. The result is the imports, ``coerce_to`` among them, the
    bindings as plain assignments and ``result = <the returned expression>``.
    """
    module = ast.parse(python)
    imports = [n for n in module.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    functions = [n for n in module.body if isinstance(n, ast.FunctionDef)]
    if len(functions) != 1 or len(module.body) != len(imports) + 1:
        return None
    fn = functions[0]
    if [a.arg for a in fn.args.args] != ["b"] or not fn.body or not isinstance(fn.body[-1], ast.Return) or fn.body[-1].value is None:
        return None
    lines: list[str] = []
    for stmt in fn.body[:-1]:
        bound = _binding(stmt)
        if bound is None:
            return None
        target, call = bound
        if any(_uses_block(arg) for arg in call.args):
            return None
        value = ast.unparse(call.args[0])
        lines.append(f"{target} = coerce_to({value}, {ast.unparse(call.args[1])})" if len(call.args) == 2 else f"{target} = {value}")
    returned = fn.body[-1].value
    if _uses_block(returned):
        return None
    lines.append(f"result = {ast.unparse(returned)}")
    head = "\n".join(ast.unparse(n) for n in imports)
    return f"{head}\nfrom east import coerce_to\n\n" + "\n".join(lines) + "\n"


def eager_entry(entry: dict[str, Any]) -> dict[str, Any] | None:
    """The eager entry for a program example, run and checked against its result; None when it has none or it differs."""
    # Core East alone: a platform package's example runs its effects (a file, a fetch) as it is checked.
    signature = entry.get("signature") or {}
    if entry.get("skill") != "east" or signature.get("inputs") or signature.get("async"):
        return None
    source = eager_source(entry["python"])
    if source is None:
        return None
    scope: dict[str, Any] = {}
    try:
        exec(compile(source, entry["id"], "exec"), scope)  # noqa: S102 — the index's own examples, printed here
        result = scope["result"]
        out_type = eval(entry["signature"]["output"], scope)  # noqa: S307 — a type the printer wrote
        expected = decode_json_for(out_type)(entry["returns"].encode("utf-8"))
        from east import East
        if not East.equal(out_type, result, expected):
            return None
    except Exception:  # noqa: BLE001 — an example that does not run eagerly is left out, not failed
        return None
    return {
        **{k: entry[k] for k in ("skill", "suite", "test", "keywords", "returns") if k in entry},
        "id": f"{entry['id']}:eager",
        "skill": "east-py",
        "package": "east-values",
        "file": entry.get("file"),
        "keywords": [*entry.get("keywords", []), "eager", "East values", "value"],
        "imports": [],
        "languages": ["python"],
        "python": "# The same example over East values: each eager method runs in east-c now.\n" + source,
        "ir": None,
        "ts": None,
        "signature": None,
        "inputs": None,
        "builtins": entry.get("builtins"),
    }


if __name__ == "__main__":
    sys.exit(main(sys.argv))
