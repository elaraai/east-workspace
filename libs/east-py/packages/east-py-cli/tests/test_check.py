#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py check`` (#653): the BUILD's own errors at their authoring lines.

The rules read a file; this one runs it. East's type checker IS the builder,
so these are real type errors — the ones `lint` structurally cannot see.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from east_py_cli.check import GUARD, check_module, guarded

THREE_BROKEN = '''
from east import East
from east.types.types import IntegerType, StringType

ok = East.function([IntegerType], IntegerType, lambda b, x: x + 1)
wrong_out = East.function([IntegerType], StringType, lambda b, x: x + 1)
bad_arity = East.function([IntegerType], IntegerType, lambda x: x)


@East.function([IntegerType], StringType)
def formatted(b, x):
    return f"value {x}"
'''

CLEAN = '''
from east import East
from east.types.types import IntegerType

double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)
'''


def _module(tmp_path: Path, source: str, name: str = "mod.py") -> str:
    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    return str(path)


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "east_py_cli", *args],
                          capture_output=True, text=True, check=False)


def test_a_module_with_three_broken_functions_reports_all_three(tmp_path):
    """One run, every error — the point of the collector. A build normally
    raises out of the import at the first failure."""
    findings = check_module(_module(tmp_path, THREE_BROKEN))
    assert len(findings) == 3, [f.message for f in findings]
    assert {f.rule for f in findings} == {"build"}
    assert [f.line for f in findings] == sorted(f.line for f in findings)


def test_a_declared_output_mismatch_is_reported_at_its_line(tmp_path):
    """The type error the rules cannot see: the body builds, its type differs
    from `out`, and only the build knows."""
    findings = check_module(_module(tmp_path, THREE_BROKEN))
    [mismatch] = [f for f in findings if "declared out" in f.message]
    assert mismatch.line == 6
    assert "produced Integer" in mismatch.message and "String" in mismatch.message


def test_every_finding_carries_the_authors_own_file_and_line(tmp_path):
    path = _module(tmp_path, THREE_BROKEN)
    for finding in check_module(path):
        # Compare as PATHS: East's source map normalizes separators to `/` and
        # may relativize, so the string spellings differ on Windows.
        assert Path(finding.path).resolve() == Path(path).resolve(), finding
        assert finding.line >= 1 and finding.column >= 1


def test_an_arity_refusal_falls_back_to_the_call_site(tmp_path):
    """It raises before the body ever runs, so the traceback holds no author
    frame — the `East.function` call site stands in."""
    findings = check_module(_module(tmp_path, THREE_BROKEN))
    [arity] = [f for f in findings if "takes the block first" in f.message]
    assert arity.line == 7


def test_a_clean_module_reports_nothing(tmp_path):
    assert check_module(_module(tmp_path, CLEAN)) == []


def test_a_module_that_cannot_import_says_so_rather_than_failing_silently(tmp_path):
    source = "from east import East\nraise RuntimeError('boom')\n"
    [finding] = check_module(_module(tmp_path, source))
    assert finding.rule == "import"
    assert "RuntimeError" in finding.message and "boom" in finding.message


def test_the_guard_is_set_during_the_check_and_restored_after(tmp_path):
    source = ("import os\n"
              "from east import East\n"
              "SAW_GUARD = os.environ.get('EAST_CHECK')\n"
              "with open(os.environ['EAST_CHECK_PROBE'], 'w') as f:\n"
              "    f.write(SAW_GUARD or 'unset')\n")
    probe = tmp_path / "probe.txt"
    os.environ["EAST_CHECK_PROBE"] = str(probe)
    before = os.environ.get(GUARD)
    try:
        check_module(_module(tmp_path, source))
        assert probe.read_text() == "1", "a module must be able to see the guard and skip its work"
    finally:
        os.environ.pop("EAST_CHECK_PROBE", None)
    assert os.environ.get(GUARD) == before, "the guard must not leak out of the check"


def test_guarded_restores_a_pre_existing_value():
    os.environ[GUARD] = "outer"
    try:
        with guarded():
            assert os.environ[GUARD] == "1"
        assert os.environ[GUARD] == "outer"
    finally:
        os.environ.pop(GUARD, None)


def test_the_cli_prints_ruff_like_lines_and_exits_1(tmp_path):
    result = _run("check", _module(tmp_path, THREE_BROKEN))
    assert result.returncode == 1, result.stderr
    assert result.stdout.count("[build]") == 3
    assert "Found 3 build errors." in result.stdout


def test_the_cli_json_matches_the_lint_record_shape(tmp_path):
    result = _run("check", "--format", "json", _module(tmp_path, THREE_BROKEN))
    assert result.returncode == 1
    records = json.loads(result.stdout)
    assert len(records) == 3
    for record in records:
        assert set(record) == {"path", "line", "column", "end_line", "end_column",
                               "rule", "code", "category", "message"}
        assert record["category"] == "error"
        assert record["code"] == "EAS900"


def test_the_cli_is_clean_and_exits_0_for_a_module_that_builds(tmp_path):
    result = _run("check", _module(tmp_path, CLEAN))
    assert result.returncode == 0, result.stderr
    assert "All clear." in result.stdout


def test_the_cli_refuses_a_missing_file(tmp_path):
    result = _run("check", str(tmp_path / "nope.py"))
    assert result.returncode == 2
    assert "no such file" in result.stderr
