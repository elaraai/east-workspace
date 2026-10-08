#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The python runner's profile (#1271): ``run --profile``, ``exec --profile``,
``EAST_PROFILE`` and ``EAST_PROFILE_INTERVAL``.

The profiler is east-c's, so the report is the one east-c's ``run --profile``
prints, and east-c's cli_profile gate holds the same fixtures to the same
report: a helper called 100 times listed with its call count and its source
location, a platform function an entry of its own placed by its call, the
report after the outcome, and nothing without the flag or the variable.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def _runner(*args: str, env: dict[str, str] | None = None,
            cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    base = {k: v for k, v in os.environ.items() if not k.startswith("EAST_PROFILE")}
    return subprocess.run(
        [sys.executable, "-m", "east_py_cli", *args],
        capture_output=True, text=True, env={**base, **(env or {})}, cwd=cwd,
    )


def _line_with(text: str, needle: str) -> str:
    return next((line for line in text.splitlines() if needle in line), "")


def test_run_profile_lists_each_function_by_self_time():
    proc = _runner("run", str(FIXTURES / "profile_calls.beast2"), "--profile")
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "100"
    assert "Profile (self time, 2 functions):" in proc.stderr, proc.stderr
    helper = _line_with(proc.stderr, "100 calls")
    assert re.search(r"generate_fixtures\.mjs:\d+:\d+  called at .*generate_fixtures\.mjs:\d+:\d+$",
                     helper), proc.stderr
    assert "still running" not in proc.stderr

    quiet = _runner("run", str(FIXTURES / "profile_calls.beast2"))
    assert quiet.stdout.strip() == "100"
    assert "Profile" not in quiet.stderr


def test_a_platform_function_is_an_entry_of_its_own():
    proc = _runner("run", str(FIXTURES / "profile_platform.beast2"), "-p", "east-py-std", "--profile")
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.split() == ["step", "step", "step", "3"]
    platform = _line_with(proc.stderr, "console_log")
    assert re.search(r"^  console_log +3 calls .* platform function  called at "
                     r".*generate_fixtures\.mjs:\d+:\d+$", platform), proc.stderr
    assert len(re.findall(r" 3 calls ", proc.stderr)) == 2, proc.stderr


def test_east_profile_profiles_without_the_flag():
    on = _runner("run", str(FIXTURES / "profile_calls.beast2"), env={"EAST_PROFILE": "1"})
    assert "Profile (self time" in on.stderr and "100 calls" in on.stderr, on.stderr
    off = _runner("run", str(FIXTURES / "profile_calls.beast2"), env={"EAST_PROFILE": "0"})
    assert "Profile" not in off.stderr, off.stderr


def test_exec_profile_follows_the_outcome(tmp_path):
    for name in ("profile_unit.beast2", "profile_calls.beast2",
                 "platform_call_unit.beast2", "platform_call.beast2"):
        shutil.copy(FIXTURES / name, tmp_path / name)
    proc = _runner("exec", "profile_unit.beast2", "--profile", cwd=tmp_path)
    assert proc.returncode == 0, proc.stderr
    assert "Profile (self time" in proc.stderr and "100 calls" in proc.stderr, proc.stderr
    assert "Profile" not in _runner("exec", "profile_unit.beast2", cwd=tmp_path).stderr

    # A unit that fails: its error first, then the profile, then -v's account
    # of the time — east-c's order.
    failed = _runner("exec", "platform_call_unit.beast2", "--profile", "-v", cwd=tmp_path)
    assert failed.returncode == 1, failed.stderr
    error = failed.stderr.index("Error: ")
    profile = failed.stderr.index("Profile (self time")
    timing = failed.stderr.index("Timing:")
    assert error < profile < timing, failed.stderr


def test_east_profile_interval_reports_while_the_work_runs():
    # An interval of a microsecond is due many times over 100 calls.
    proc = _runner("run", str(FIXTURES / "profile_calls.beast2"), "--profile",
                   env={"EAST_PROFILE_INTERVAL": "0.000001"})
    assert proc.returncode == 0, proc.stderr
    assert re.search(r"Profile after [\d.]+ s, still running \(self time", proc.stderr), proc.stderr[:2000]
    final = proc.stderr.rindex("\nProfile (self time")
    assert "100 calls" in proc.stderr[final:]

    bad = _runner("run", str(FIXTURES / "profile_calls.beast2"), "--profile",
                  env={"EAST_PROFILE_INTERVAL": "often"})
    assert bad.returncode == 0, bad.stderr
    assert ("Warning: EAST_PROFILE_INTERVAL takes a number of seconds greater than 0, not often"
            in bad.stderr), bad.stderr
    assert "still running" not in bad.stderr and "Profile (self time" in bad.stderr
