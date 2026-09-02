#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east-py lint`` (#638), the flake8 checker and the LSP payload: the
East rules over python files, from the command line and from an editor."""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

from east_py_cli.flake8 import EastChecker
from east_py_cli.lsp import NEEDS_PYGLS, lsp_diagnostics

BAD = ("from east import East, IntegerType\n"
       "\n"
       "@East.function([IntegerType], IntegerType)\n"
       "def halve(b, x):\n"
       "    return x // 2\n")
CLEAN = ("from east import East, IntegerType\n"
         "\n"
         "double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)\n")


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "east_py_cli", *args],
                          capture_output=True, text=True, check=False)


def _tree(tmp_path: Path) -> Path:
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "bad.py").write_text(BAD, encoding="utf-8")
    (tmp_path / "pkg" / "clean.py").write_text(CLEAN, encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_bad.py").write_text(BAD, encoding="utf-8")  # excluded by default
    return tmp_path


def test_lint_reports_one_line_per_diagnostic_and_fails(tmp_path):
    root = _tree(tmp_path)
    result = _run("lint", str(root))
    assert result.returncode == 1, result.stderr
    lines = result.stdout.splitlines()
    assert lines[0].startswith(f"{root / 'pkg' / 'bad.py'}:5:12: error [no-operator-fork] ")
    assert "clean.py" not in result.stdout and "test_bad.py" not in result.stdout
    assert lines[-1] == "Found 1 diagnostic in 1 file."


def test_lint_is_quiet_and_succeeds_on_clean_code(tmp_path):
    root = _tree(tmp_path)
    result = _run("lint", str(root / "pkg" / "clean.py"))
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "All clear."


def test_lint_json_is_the_diagnostics_as_records(tmp_path):
    root = _tree(tmp_path)
    result = _run("lint", str(root), "--format", "json")
    assert result.returncode == 1
    records = json.loads(result.stdout)
    assert len(records) == 1
    [r] = records
    assert r["path"] == str(root / "pkg" / "bad.py") and r["rule"] == "no-operator-fork"
    assert r["code"] == "EAS002" and r["category"] == "error" and r["line"] == 5 and r["column"] == 12
    assert "IntegerDivide" in r["message"]


def test_lint_disable_and_exclude(tmp_path):
    root = _tree(tmp_path)
    assert _run("lint", str(root), "--disable", "no-operator-fork").returncode == 0
    assert _run("lint", str(root), "--exclude", "pkg").returncode == 0
    unknown = _run("lint", str(root), "--disable", "no-such-rule")
    assert unknown.returncode == 2 and "no-such-rule" in unknown.stderr


def test_lint_refuses_a_missing_path(tmp_path):
    result = _run("lint", str(tmp_path / "nowhere"))
    assert result.returncode == 2 and "nowhere" in result.stderr


def test_lint_lists_the_rules():
    result = _run("lint", "--list-rules")
    assert result.returncode == 0
    assert result.stdout.splitlines()[0].startswith("EAS001  body-takes-block-first")
    assert "EAS009  no-discarded-expression" in result.stdout


def test_the_flake8_checker_yields_flake8_shaped_findings():
    findings = list(EastChecker(ast.parse(BAD), "bad.py", BAD.splitlines(keepends=True)).run())
    assert len(findings) == 1
    line, column, text, kind = findings[0]
    assert (line, column) == (5, 11) and kind is EastChecker  # flake8 columns are zero-based
    assert text.startswith("EAS002 ") and text.endswith("[no-operator-fork]")
    assert EastChecker.name == "east-py" and EastChecker.version


def test_the_lsp_payload_is_protocol_shaped():
    [d] = lsp_diagnostics(BAD, "bad.py")
    assert d["range"] == {"start": {"line": 4, "character": 11}, "end": {"line": 4, "character": 17}}
    assert d["severity"] == 1 and d["code"] == "EAS002" and d["source"] == "east-py"
    assert d["message"].endswith("[no-operator-fork]")
    assert lsp_diagnostics(CLEAN, "clean.py") == []


def test_lsp_without_pygls_says_how_to_get_it():
    try:
        import pygls  # noqa: F401
    except ImportError:
        result = _run("lsp")
        assert result.returncode == 1 and result.stderr.strip() == NEEDS_PYGLS
