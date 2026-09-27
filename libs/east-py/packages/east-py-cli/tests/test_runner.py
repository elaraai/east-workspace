#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``run``'s lazy inputs, and ``exec``'s stdin lifeline.

The fixtures in ``tests/fixtures`` are generated from the TypeScript side by
``libs/east-c/packages/east-c-cli/tests/generate_fixtures.mjs`` and shared
with east-c's CLI gates. ``run`` opens an indexed collection input lazily at
or above ``EAST_LAZY_INPUT_BYTES``, and its verbose account says what paging
came to; ``exec --exit-with-parent`` exits once its stdin pipe closes (#770).
The errors a lazily opened input raises are runner protocol corpus cases
(test_exec_corpus.py).
"""

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest
from east import ArrayType, DictType, EastDict, IntegerType, StringType, StructType
from east.runtime.errors import EastError
from east.serialization.beast2 import (
    Beast2ManifestWriter,
    decode_beast2_with_header_for,
    write_beast2_file,
)

from east_py_cli.runner import run_program

FIXTURES = Path(__file__).parent / "fixtures"
INT_ARRAY = ArrayType(IntegerType)
INT_STR_DICT = DictType(IntegerType, StringType)


def _peak_rss_mb(stderr: str) -> float | None:
    for line in stderr.splitlines():
        if "Peak RSS:" in line:
            number, unit = line.split("Peak RSS:")[1].split()
            return float(number) / (1024.0 if unit == "KB" else 1.0)
    return None


def test_lazy_input_is_paged_one_segment_at_a_time(tmp_path):
    # A keyed read into a wide input, twice, each its own process: the lazy
    # run maps the file, the eager control reads and decodes it whole. The
    # runner's account of the lazy input pins the cost exactly — every fence
    # probed once, ONE segment decoded of many — on every operating system;
    # peak RSS is only the coarse cross-check that the lazy run stays below
    # the eager control, because a mapping's residency is the kernel's
    # decision (a large-folio page cache makes a whole file resident around
    # a handful of touched pages).
    table = tmp_path / "wide.beast2"
    rows = 160_000
    write_beast2_file(
        table, INT_STR_DICT,
        EastDict(IntegerType, StringType, {i: f"row-{i}-" + chr(97 + i % 26) * 190 for i in range(rows)}),
        codec="none",
    )
    wire_mb = table.stat().st_size / (1024 * 1024)
    assert wire_mb > 16

    def run(threshold: str) -> tuple[str, str]:
        proc = subprocess.run(
            [sys.executable, "-m", "east_py_cli", "run", str(FIXTURES / "paged_has.beast2"),
             "-i", str(table), "-v"],
            env={**os.environ, "EAST_LAZY_INPUT_BYTES": threshold},
            capture_output=True, text=True, check=True,
        )
        return proc.stdout, proc.stderr

    lazy_out, lazy_err = run("1")
    eager_out, eager_err = run("0")
    assert lazy_out.strip() == "true" == eager_out.strip()
    assert "input 0: opened lazily — mapped from the file" in lazy_err
    assert "opened lazily" not in eager_err and "segments decoded" not in eager_err
    account = re.search(r"input 0: (\d+) of (\d+) segments decoded, (\d+) fences probed", lazy_err)
    assert account is not None, lazy_err
    decoded, segments, fences = (int(g) for g in account.groups())
    assert segments >= 8
    assert decoded == 1, f"keyed read decoded {decoded} of {segments} segments"
    assert fences == segments
    lazy_rss, eager_rss = _peak_rss_mb(lazy_err), _peak_rss_mb(eager_err)
    assert lazy_rss is not None and eager_rss is not None, "each run reports its peak"
    assert lazy_rss < eager_rss, (
        f"lazy peak {lazy_rss:.1f} MB not below eager peak {eager_rss:.1f} MB")


def test_a_manifest_input_pages_over_its_directory(tmp_path, monkeypatch, capsys):
    # A manifest-rooted input — how e3 stages a collection input for a runner
    # that opens manifests — pages over its directory's segment files: a keyed
    # read decodes one segment, the lazy threshold weighs the segments rather
    # than the manifest's own few hundred bytes, and the eager control reads
    # the same value whole. The east-c CLI's gate is the same.
    table = tmp_path / "wide.beast2"
    with Beast2ManifestWriter(INT_STR_DICT, table, codec="none") as writer:
        writer.add_all(EastDict(IntegerType, StringType,
                                {i: f"row-{i}-" + chr(97 + i % 26) * 190 for i in range(80_000)}))

    def run(threshold: str) -> str:
        monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", threshold)
        run_program(FIXTURES / "paged_has.beast2", [], [], [table], verbose=True)
        out, err = capsys.readouterr()
        assert out.strip() == "true"
        return err

    lazy = run("1")
    assert "input 0: opened lazily" in lazy
    account = re.search(r"input 0: (\d+) of (\d+) segments decoded", lazy)
    assert account is not None, lazy
    decoded, segments = (int(g) for g in account.groups())
    assert segments >= 8
    assert decoded == 1, f"a keyed read of the manifest decoded {decoded} of {segments} segments"
    # 1 MiB: far above the manifest file, far below its segments.
    assert "input 0: opened lazily" in run(str(1024 * 1024))
    assert "opened lazily" not in run("0")


def test_a_nested_input_opens_lazily_and_frozen(tmp_path, monkeypatch, capsys):
    # The collapsed shape gate on the Python runner (#516, #539), against the
    # fixtures the east-c cli_paged gate uses: a nested-container element
    # shape opens lazily AND frozen, so the write through a read-out element
    # raises the uniform error instead of landing in the input — from the
    # blob, and from the manifest directory e3 stages a collection as. The
    # account names the lazy open: an input that fell back to a whole decode
    # would refuse the write too.
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "1")
    nested = FIXTURES / "paged_nested.beast2"
    manifest = tmp_path / "paged_nested_manifest.beast2"
    nested_type = DictType(IntegerType, StructType([("xs", INT_ARRAY)]))
    with Beast2ManifestWriter(nested_type, manifest, codec="none") as writer:
        writer.add_all(decode_beast2_with_header_for(nested_type)(nested.read_bytes()))
    for source in (nested, manifest):
        capsys.readouterr()
        with pytest.raises(EastError, match="cannot mutate a frozen value"):
            run_program(FIXTURES / "paged_nested_mutate.beast2", [], [], [source], verbose=True)
        assert "input 0: opened lazily" in capsys.readouterr().err, source


def test_a_runner_given_the_stdin_lifeline_exits_once_stdin_closes(tmp_path):
    # With --exit-with-parent and a stdin pipe nobody writes, the runner exits
    # once that pipe closes — through east-c's native watcher, which runs
    # while the program holds the GIL. The unit's program loops forever after
    # one emission, and its sink creates the output directory before the
    # program runs, so the directory's appearance is the sign the runner is up
    # and computing. The unit's paths are relative: it runs beside the
    # program, wherever the two are copied.
    for name in ("lifeline_unit.beast2", "emit_spin.beast2"):
        shutil.copy(FIXTURES / name, tmp_path / name)
    output = tmp_path / "lifeline_output"
    proc = subprocess.Popen(
        [sys.executable, "-m", "east_py_cli", "exec", "--exit-with-parent",
         str(tmp_path / "lifeline_unit.beast2")],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    try:
        # Bounded liveness waits: the interpreter's start-up, then the watcher.
        deadline = time.monotonic() + 60
        while not output.is_dir():
            assert proc.poll() is None, proc.stderr.read().decode(errors="replace")
            assert time.monotonic() < deadline, "the runner did not create its output in 60 s"
            time.sleep(0.05)
        assert proc.stdin is not None and proc.stderr is not None
        proc.stdin.close()  # the lifeline closes
        try:
            returncode = proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pytest.fail("the runner outlived its closed stdin by 10 s")
        stderr = proc.stderr.read()
        # The watcher's exit, not a failure's: exit 1 with nothing reported.
        assert returncode == 1
        assert b"Error" not in stderr, stderr.decode(errors="replace")
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
