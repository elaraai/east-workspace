#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cross-language imports, both directions (#628).

**TypeScript → python.** ``east-node export-functions`` writes the manifest
of ``libs/east-node/packages/east-node-cli/test-fixtures/crosslang-functions.mjs``;
python imports its functions by name, links them and runs the result on
east-c — no TypeScript at run time. Needs the built east-node CLI
(``EAST_NODE_CLI``, as for the three-way sweep); skips otherwise.

**python → TypeScript.** The manifest of ``tests/fixtures/crosslang_functions.py``
is checked in at ``libs/east/test/fixtures/py-functions.beast2`` for
``libs/east/src/functions.crossimport.spec.ts`` to link and run. The test
here keeps the file current: it regenerates the manifest and asserts every
function's IR is unchanged (under the normalizer — variable names are
per-build); ``EAST_UPDATE_FIXTURES=1`` rewrites the file instead.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from east.runtime._compiler_eastc import diff_ir

from east import East
from east.runtime.compiler import compile_from_value
from east.types.types import ArrayType, FloatType, FunctionType, IntegerType, StringType, StructType
from east.types.values import EastStruct
from tests.conformance.test_three_way_sweep import EAST_NODE, _east_node
from tests.fixtures import crosslang_functions as py_fixture

HERE = Path(__file__).resolve()
TS_FIXTURE = Path(os.environ.get(
    "EAST_CROSS_IMPORT_MODULE",
    str(Path(EAST_NODE).resolve().parent.parent / "test-fixtures" / "crosslang-functions.mjs")
    if EAST_NODE else ""))
PY_MANIFEST = HERE.parents[5] / "east" / "test" / "fixtures" / "py-functions.beast2"

Row = StructType([("qty", IntegerType), ("price", FloatType)])
ROWS = [EastStruct({"qty": 2, "price": 1.5}), EastStruct({"qty": 3, "price": 2.0})]


@pytest.mark.skipif(not EAST_NODE or not TS_FIXTURE.is_file(),
                    reason="needs the east-node CLI (EAST_NODE_CLI) and its crosslang-functions fixture")
def test_typescript_functions_import_into_python(tmp_path):
    manifest_path = tmp_path / "crosslang_ts.functions.beast2"
    result = subprocess.run(
        _east_node("export-functions", str(TS_FIXTURE), "-o", str(manifest_path),
                   "--name", "crosslang_ts", "--package-version", "1.0.0"),
        capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, f"east-node export-functions failed:\n{result.stderr}"
    manifest = East.decode_function_manifest(manifest_path.read_bytes())
    assert [f["name"] for f in manifest["functions"]] == ["greet", "score", "total"]

    total = East.import_function("crosslang_ts", "total", FunctionType([ArrayType(Row)], FloatType))
    greet = East.import_function("crosslang_ts", "greet", FunctionType([StringType, IntegerType], StringType))
    user = East.function(
        [ArrayType(Row), StringType], StringType,
        lambda b, rows, name: greet(name, 2).concat(" ").concat(East.print(total(rows))))
    ir, imports = East.link_imports(user, [manifest])
    assert [i["name"] for i in imports] == ["greet", "total"]
    assert compile_from_value(ir, [])(ROWS, "hi") == "hi!hi! 9.0"


def test_python_functions_manifest_is_current_for_typescript():
    manifest = East.export_functions("crosslang_py", "1.0.0", py_fixture.east_functions)
    encoded = East.encode_function_manifest(manifest)
    if os.environ.get("EAST_UPDATE_FIXTURES") == "1":
        PY_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        PY_MANIFEST.write_bytes(encoded)
    assert PY_MANIFEST.is_file(), f"{PY_MANIFEST} is missing — EAST_UPDATE_FIXTURES=1 writes it"
    checked_in = East.decode_function_manifest(PY_MANIFEST.read_bytes())
    assert checked_in["package"] == "crosslang_py"
    assert [f["name"] for f in checked_in["functions"]] == [f["name"] for f in manifest["functions"]]
    for fresh, stored in zip(manifest["functions"], checked_in["functions"], strict=True):
        diff = diff_ir(fresh["ir"], stored["ir"])
        assert diff is None, (
            f"{fresh['name']}: the checked-in manifest differs from tests/fixtures/crosslang_functions.py "
            f"at {diff} — EAST_UPDATE_FIXTURES=1 pytest tests/conformance/test_cross_import.py rewrites it")
