#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The compliance runner reports in UTF-8, whatever the platform's encoding.

A test name is any East string. A Windows CI step's stdout is a pipe in the
ANSI code page (cp1252) and its locale is not UTF-8, and the runner once
crashed a whole file writing a name cp1252 cannot hold — a Bengali digit in
a JsonStrict DateTime refusal (#777). These give the runner that environment
on every platform: ``PYTHONIOENCODING=cp1252`` for its stdio, and an ASCII
locale (``LC_ALL=C``, with python's UTF-8 mode and locale coercion off) for
what a reader decodes by default.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from east import AsyncFunctionType, East, NullType, StringType
from east.serialization.json import encode_json_for
from east.types.type_of_type import IRType

RUNNER = Path(__file__).with_name("test_compliance.py")

# Names no Windows code page holds: a Bengali four, as in JsonStrict, and a
# Devanagari one.
SUITE = "names ৪"
PASSING = "reads 1963-06-1৪"
FAILING = "refuses 1963-06-1৪"
REASON = "expected ४, got ৪"

WINDOWS_STEP = {
    **os.environ,
    "PYTHONIOENCODING": "cp1252",
    "PYTHONUTF8": "0",
    "PYTHONCOERCECLOCALE": "0",
    "LC_ALL": "C",
}


def _write_suite(directory: Path) -> Path:
    """A corpus-format IR file: one passing and one failing test, named as above."""
    east_test = East.asyncPlatform("test", [StringType, AsyncFunctionType([], NullType)], NullType)
    east_describe = East.asyncPlatform(
        "describe", [StringType, AsyncFunctionType([], NullType)], NullType
    )
    east_pass = East.platform("testPass", [], NullType)
    east_fail = East.platform("testFail", [StringType], NullType)

    @East.asyncFunction([], NullType)
    def suite(b):
        @East.asyncFunction([], NullType)
        def tests(b):
            b.do(east_test(PASSING, East.asyncFunction([], NullType, lambda b: east_pass())))
            return east_test(FAILING, East.asyncFunction([], NullType, lambda b: east_fail(REASON)))

        return east_describe(SUITE, tests)

    encoded = encode_json_for(IRType)(suite._east_ir)
    if isinstance(encoded, bytes):
        encoded = encoded.decode("utf-8")
    path = directory / "Unicode_names.json"
    path.write_text(
        json.dumps({"ir": json.loads(encoded), "source_map": {"stacks": []}}, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def _run(*args: str) -> tuple[int, str, str]:
    """Run the runner in the Windows step's environment; its exit status, stdout and stderr."""
    result = subprocess.run(
        [sys.executable, str(RUNNER), *args],
        capture_output=True,
        env=WINDOWS_STEP,
        timeout=300,
        check=False,
    )
    return (
        result.returncode,
        result.stdout.decode("utf-8"),
        result.stderr.decode("utf-8", "backslashreplace"),
    )


def test_one_file_reports_every_name_and_reason_in_utf8(tmp_path):
    """Single-file mode — every file's subprocess — writes the names cp1252 cannot encode."""
    status, out, err = _run(str(_write_suite(tmp_path)))
    assert f"[+] {PASSING} (" in out, out + err
    assert f"[x] {FAILING} (" in out, out + err
    assert REASON in out, out + err
    assert "Results: 1/2 passed" in out, out + err
    assert status == 1, out + err


def test_a_run_reads_each_report_back_and_prints_a_failing_one_whole(tmp_path):
    """Directory mode decodes each file's report as UTF-8, whatever the locale, and writes it so."""
    _write_suite(tmp_path)
    status, out, err = _run("--ir-dir", str(tmp_path))
    assert "[x] Unicode_names (1/2, 1 failed)" in out, out + err
    assert f"[x] {FAILING} (" in out, out + err
    assert REASON in out, out + err
    assert "Total: 1 passed, 1 failed, 0 crashed" in out, out + err
    assert status == 1, out + err
