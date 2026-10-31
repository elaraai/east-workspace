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
from east.functions import FunctionExportBatchEntryType, FunctionExportBatchType
from east.runtime.compiler import compile_from_value
from east.serialization.beast2 import encode_beast2_v5_for
from east.types.types import FunctionType, IntegerType, StringType
from east.types.values import EastArray, EastStruct

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


def _run(*args: str, pythonpath: Path | None = None,
         env_extra: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    if pythonpath is not None:
        env["PYTHONPATH"] = str(pythonpath) + os.pathsep + env.get("PYTHONPATH", "")
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-m", "east_py_cli", *args],
                          capture_output=True, text=True, check=False, env=env)


def _batch(path: Path, *entries: tuple[str, list[str], list[str]]) -> Path:
    """Writes a batch of (output, packages, only) entries."""
    batch = [EastStruct({"only": EastArray(StringType, only), "output": output,
                         "packages": EastArray(StringType, packages)})
             for output, packages, only in entries]
    path.write_bytes(encode_beast2_v5_for(FunctionExportBatchType)(EastArray(FunctionExportBatchEntryType, batch)))
    return path


def test_export_functions_writes_a_manifest_that_links(tmp_path: Path):
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE, encoding="utf-8")
    (tmp_path / "acme_platform.py").write_text(PLATFORM, encoding="utf-8")
    out = tmp_path / "pricing.functions.beast2"
    result = _run("export-functions", str(module), "-o", str(out), "-p", "acme-platform",
                  "--name", "pricing", "--package-version", "2.0.0", pythonpath=tmp_path)
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


def test_export_functions_only_the_named_functions(tmp_path: Path):
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE, encoding="utf-8")
    out = tmp_path / "double.beast2"
    # `shout` calls `log`, which no -p package provides here; exporting `double` alone is fine
    result = _run("export-functions", str(module), "-o", str(out), "--only", "double")
    assert result.returncode == 0, result.stderr
    manifest = East.decode_function_manifest(out.read_bytes())
    assert [f["name"] for f in manifest["functions"]] == ["double"]
    result = _run("export-functions", str(module), "-o", str(out), "--only", "double", "--only", "nope")
    assert result.returncode == 1
    assert "exports no function nope — its east_functions are double, shout" in result.stderr


def test_export_functions_builds_only_the_functions_it_names(tmp_path: Path):
    # `broken` fails to build, so importing the module would fail; an export
    # that does not name it never builds it
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE + 'broken = East.function([IntegerType], StringType, lambda b, x: x + 1)\n'
                      'east_functions["broken"] = broken\n', encoding="utf-8")
    out = tmp_path / "double.beast2"
    result = _run("export-functions", str(module), "-o", str(out), "--only", "double")
    assert result.returncode == 0, result.stderr
    assert [f["name"] for f in East.decode_function_manifest(out.read_bytes())["functions"]] == ["double"]
    result = _run("export-functions", str(module), "-o", str(out), "--only", "broken")
    assert result.returncode == 1
    assert "body produced Integer, declared out is String" in result.stderr


def test_export_functions_batch_writes_each_manifest_from_one_import(tmp_path: Path):
    # The module says each time it is imported, so one import for the whole batch shows.
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE + '\nimport os\nopen(os.environ["IMPORT_LOG"], "a").write("imported\\n")\n',
                      encoding="utf-8")
    (tmp_path / "acme_platform.py").write_text(PLATFORM, encoding="utf-8")
    log = tmp_path / "imports.log"
    env = {"IMPORT_LOG": str(log)}
    common = ("--name", "pricing", "--package-version", "2.0.0")
    # relative outputs are relative to the batch's directory
    batch = _batch(tmp_path / "batch.beast2",
                   ("double.beast2", [], ["double"]),
                   (str(tmp_path / "all.beast2"), ["acme-platform"], []))
    result = _run("export-functions", str(module), "--batch", str(batch), *common, pythonpath=tmp_path, env_extra=env)
    assert result.returncode == 0, result.stderr
    assert log.read_text(encoding="utf-8") == "imported\n"
    assert "Exported 1 function(s) of pricing@2.0.0" in result.stderr
    assert "Exported 2 function(s) of pricing@2.0.0" in result.stderr

    # each entry's manifest is, byte for byte, the one its own call writes
    single = _run("export-functions", str(module), "-o", str(tmp_path / "double-alone.beast2"), "--only", "double",
                  *common, pythonpath=tmp_path, env_extra=env)
    assert single.returncode == 0, single.stderr
    assert (tmp_path / "double.beast2").read_bytes() == (tmp_path / "double-alone.beast2").read_bytes()
    single = _run("export-functions", str(module), "-o", str(tmp_path / "all-alone.beast2"), "-p", "acme-platform",
                  *common, pythonpath=tmp_path, env_extra=env)
    assert single.returncode == 0, single.stderr
    assert (tmp_path / "all.beast2").read_bytes() == (tmp_path / "all-alone.beast2").read_bytes()


def test_export_functions_batch_ends_at_the_first_entry_that_fails(tmp_path: Path):
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE, encoding="utf-8")
    # `shout` calls `log`, which no package of the second entry provides; the third never runs
    batch = _batch(tmp_path / "batch.beast2",
                   ("first.beast2", [], ["double"]),
                   ("second.beast2", [], ["shout"]),
                   ("third.beast2", [], ["double"]))
    result = _run("export-functions", str(module), "--batch", str(batch))
    assert result.returncode == 1
    assert "no -p package provides: log" in result.stderr
    assert [p.name for p in sorted(tmp_path.glob("*.beast2"))] == ["batch.beast2", "first.beast2"]


def test_export_functions_takes_one_manifest_or_a_batch(tmp_path: Path):
    module = tmp_path / "pricing_fns.py"
    module.write_text(MODULE, encoding="utf-8")
    batch = _batch(tmp_path / "batch.beast2", ("double.beast2", [], ["double"]))
    for args in ((), ("-o", str(tmp_path / "x.beast2"), "--batch", str(batch))):
        result = _run("export-functions", str(module), *args)
        assert result.returncode == 1
        assert "writes one manifest with -o FILE, or several with --batch FILE" in result.stderr
    result = _run("export-functions", str(module), "--batch", str(batch), "--only", "double")
    assert result.returncode == 1
    assert "with --batch, each entry names its own -p packages and --only functions" in result.stderr


def test_export_functions_needs_the_east_functions_dict(tmp_path: Path):
    module = tmp_path / "empty_mod.py"
    module.write_text("x = 1\n", encoding="utf-8")
    result = _run("export-functions", str(module), "-o", str(tmp_path / "x.beast2"))
    assert result.returncode == 1
    assert "declares no `east_functions` dict" in result.stderr
