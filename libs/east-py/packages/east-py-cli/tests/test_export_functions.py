#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py export-functions`` (#628): a module's ``east_functions`` written
as a function manifest that links and runs."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from east import East
from east.runtime.compiler import compile_from_value
from east.types.types import FunctionType, IntegerType

MODULE = '''
from east import East
from east.types.types import IntegerType, NullType, StringType

log = East.platform("log", [StringType], NullType)
double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)

@East.function([StringType], NullType)
def shout(b, s):
    b.do(log(s.upper_case()))

east_functions = {"double": double, "shout": shout}
'''

# A platform package providing `log`, resolvable through PYTHONPATH the way
# `east-py run -p acme_platform` would find it.
PLATFORM = '''
from east.runtime.platform import platform_function, platform_functions
from east.types.types import NullType, StringType

@platform_function(inputs=[StringType], output=NullType, name="log")
def log(s):
    print(s)

platform = platform_functions(__name__)
'''


def _run(*args: str, pythonpath: Path | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    if pythonpath is not None:
        env["PYTHONPATH"] = str(pythonpath) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run([sys.executable, "-m", "east_py_cli", *args],
                          capture_output=True, text=True, check=False, env=env)


def test_export_functions_writes_a_manifest_that_links(tmp_path: Path):
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE, encoding="utf-8")
    (tmp_path / "acme_platform.py").write_text(PLATFORM, encoding="utf-8")
    out = tmp_path / "pricing.functions.beast2"
    result = _run("export-functions", str(module), "-o", str(out), "-p", "acme-platform",
                  "--name", "pricing", "--version", "2.0.0", pythonpath=tmp_path)
    assert result.returncode == 0, result.stderr
    assert "Exported 2 function(s) of pricing@2.0.0" in result.stderr

    manifest = East.decode_function_manifest(out.read_bytes())
    assert manifest["package"] == "pricing"
    assert [f["name"] for f in manifest["functions"]] == ["double", "shout"]
    shout = list(manifest["functions"])[1]
    assert shout["platforms"][0]["provider"].value == "acme-platform"

    imported = East.import_function("pricing", "double", FunctionType([IntegerType], IntegerType))
    user = East.function([IntegerType], IntegerType, lambda b, x: imported(x) + 1)
    ir, _imports = East.link_imports(user, [manifest])
    assert compile_from_value(ir, [])(4) == 9


def test_export_functions_names_an_unprovided_platform(tmp_path: Path):
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE, encoding="utf-8")
    result = _run("export-functions", str(module), "-o", str(tmp_path / "x.beast2"))
    assert result.returncode == 1
    assert "no -p package provides: log" in result.stderr


def test_export_functions_needs_the_east_functions_dict(tmp_path: Path):
    module = tmp_path / "empty_mod.py"
    module.write_text("x = 1\n", encoding="utf-8")
    result = _run("export-functions", str(module), "-o", str(tmp_path / "x.beast2"))
    assert result.returncode == 1
    assert "declares no `east_functions` dict" in result.stderr
