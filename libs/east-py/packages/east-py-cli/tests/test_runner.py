#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``run``'s lazy inputs and what a runner imports, and ``exec``'s account of the
inputs and its stdin lifeline.

The fixtures in ``tests/fixtures`` are generated from the TypeScript side by
``libs/east-c/packages/east-c-cli/tests/generate_fixtures.mjs`` and shared
with east-c's CLI gates. ``run`` opens an indexed collection input lazily,
whatever it weighs, unless ``--decode whole`` says to decode it before the
program runs (#1033), and its verbose account says how each input opened and
what reading it came to, as ``exec -v``'s does (#1004); ``exec
--exit-with-parent`` exits once its stdin pipe closes (#770). A runner whose
program holds no Vector or Matrix and calls no async platform function loads
neither numpy nor asyncio (#1128).
The errors a lazily opened input raises are runner protocol corpus cases
(test_exec_corpus.py).
"""

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


def _write_wide_table(path: Path, rows: int) -> None:
    """A Dict of ``rows`` 200-byte rows, keyed 0 to ``rows`` - 1, uncompressed —
    the wide table east-c's cli_paged gate writes."""
    write_beast2_file(
        path, INT_STR_DICT,
        EastDict(IntegerType, StringType, {i: f"row-{i}-" + chr(97 + i % 26) * 190 for i in range(rows)}),
        codec="none",
    )


def test_lazy_input_is_paged_one_segment_at_a_time(tmp_path):
    # A keyed read into a wide input, twice, each its own process: the lazy
    # run maps the file, the `--decode whole` control reads and decodes it
    # whole, and says what it holds in memory. The runner's account of the
    # lazy input pins the cost exactly — every fence probed once, ONE segment
    # decoded of many — on every operating system; peak RSS is only the coarse
    # cross-check that the lazy run stays below the whole control, because a
    # mapping's residency is the kernel's decision (a large-folio page cache
    # makes a whole file resident around a handful of touched pages).
    table = tmp_path / "wide.beast2"
    _write_wide_table(table, 160_000)
    wire_mb = table.stat().st_size / (1024 * 1024)
    assert wire_mb > 16

    def run(*flags: str) -> tuple[str, str]:
        proc = subprocess.run(
            [sys.executable, "-m", "east_py_cli", "run", str(FIXTURES / "paged_has.beast2"),
             "-i", str(table), "-v", *flags],
            capture_output=True, text=True, check=True,
        )
        return proc.stdout, proc.stderr

    lazy_out, lazy_err = run()
    eager_out, eager_err = run("--decode", "whole")
    assert lazy_out.strip() == "true" == eager_out.strip()
    assert "input 0: opened lazily — mapped from the file" in lazy_err
    assert "opened lazily" not in eager_err and "segments decoded" not in eager_err
    assert re.search(r"input 0: decoded whole — \+[\d.]+ MB resident", eager_err), eager_err
    assert "decoded whole" not in lazy_err, lazy_err
    account = re.search(r"input 0: (\d+) of (\d+) segments decoded, (\d+) fences probed", lazy_err)
    assert account is not None, lazy_err
    decoded, segments, fences = (int(g) for g in account.groups())
    assert segments >= 8
    assert decoded == 1, f"keyed read decoded {decoded} of {segments} segments"
    assert fences == segments
    lazy_rss, eager_rss = _peak_rss_mb(lazy_err), _peak_rss_mb(eager_err)
    assert lazy_rss is not None and eager_rss is not None, "each run reports its peak"
    assert lazy_rss < eager_rss, (
        f"lazy peak {lazy_rss:.1f} MB not below whole peak {eager_rss:.1f} MB")

    # `--decode lazy` is the default spelled out; anything else is refused,
    # in east-c's and east-node's words.
    assert "input 0: opened lazily" in run("--decode", "lazy")[1]
    refused = subprocess.run(
        [sys.executable, "-m", "east_py_cli", "run", str(FIXTURES / "paged_has.beast2"),
         "-i", str(table), "--decode", "eager"],
        capture_output=True, text=True,
    )
    assert refused.returncode == 1
    assert refused.stderr.strip() == "Error: --decode takes lazy or whole, not eager"


def test_a_runner_loads_neither_numpy_nor_asyncio_for_a_program_that_needs_neither(tmp_path):
    # Every e3 unit is a runner process of its own, so what one imports is
    # paid per unit (#1128): numpy and asyncio came to half of `import east`.
    # A program with no Vector or Matrix that calls no async platform function
    # loads neither, east-py-std's platform functions loaded beside it, its
    # async `time_sleep` among them. `-X importtime` lists every module the
    # process imports.
    table = tmp_path / "table.beast2"
    _write_wide_table(table, 1_000)
    proc = subprocess.run(
        [sys.executable, "-X", "importtime", "-m", "east_py_cli", "run",
         str(FIXTURES / "paged_has.beast2"), "-i", str(table), "-p", "east-py-std"],
        capture_output=True, text=True, check=True,
    )
    assert proc.stdout.strip() == "true"
    imported = {line.rsplit("|", 1)[-1].strip() for line in proc.stderr.splitlines()
                if line.startswith("import time:")}
    assert "east_py_std.time" in imported, "the runner did not load east-py-std"
    assert not imported & {"numpy", "asyncio"}, sorted(imported & {"numpy", "asyncio"})


def test_what_a_lazy_read_came_to(tmp_path, monkeypatch, capsys):
    # An operation the pager cannot serve — `toArray` — decodes the input
    # whole, once, and the account says how much resident memory that added:
    # tens of megabytes, in a process of its own, since a process that freed
    # as much before reuses it. Reads that alternate between the first and
    # the last segment, over a pager that keeps one, decode each again, and
    # the account says so, with what decoding the input whole would do
    # instead. The east-c cli_paged gate holds the same fixtures to the same
    # account.
    table = tmp_path / "wide.beast2"
    _write_wide_table(table, 160_000)

    hydrate = subprocess.run(
        [sys.executable, "-m", "east_py_cli", "run", str(FIXTURES / "paged_hydrate.beast2"),
         "-i", str(table), "-v"],
        capture_output=True, text=True, check=True,
    )
    assert hydrate.stdout.strip() == "160000"
    assert "input 0: opened lazily" in hydrate.stderr
    assert re.search(
        r"input 0: decoded whole \(an operation the pager cannot serve\) — \+[\d.]+ MB resident",
        hydrate.stderr), hydrate.stderr

    monkeypatch.setenv("EAST_PAGED_CACHE_BYTES", "1")
    run_program(FIXTURES / "paged_scatter.beast2", [], [], [table], verbose=True)
    out, err = capsys.readouterr()
    assert out.strip() == "200"
    account = re.search(
        r"input 0: (\d+) segment decodes of its (\d+) segments, (\d+) fences probed — it read "
        r"segments again that the pager no longer held \(a scan repeated, or reads at random\); "
        r"decoding it whole would decode each once, but hold the whole input at once", err)
    assert account is not None, err
    decodes, segments, fences = (int(g) for g in account.groups())
    assert decodes == 200 and segments >= 8 and fences == segments, err

    run_program(FIXTURES / "paged_scatter.beast2", [], [], [table], verbose=True, whole=True)
    out, err = capsys.readouterr()
    assert out.strip() == "200"
    assert "segment decodes" not in err, err


def test_a_manifest_input_pages_over_its_directory(tmp_path, capsys):
    # A manifest-rooted input — how e3 stages a collection input for a runner
    # that opens manifests — pages over its directory's segment files: a keyed
    # read decodes one segment, the account weighs the segments rather than
    # the manifest's own few hundred bytes, and the whole control reads the
    # same value whole and says the resident memory that added — any amount
    # here, in a process that freed as much before. The east-c CLI's gate is
    # the same.
    table = tmp_path / "wide.beast2"
    with Beast2ManifestWriter(INT_STR_DICT, table, codec="none") as writer:
        writer.add_all(EastDict(IntegerType, StringType,
                                {i: f"row-{i}-" + chr(97 + i % 26) * 190 for i in range(80_000)}))

    def run(whole: bool) -> str:
        run_program(FIXTURES / "paged_has.beast2", [], [], [table], verbose=True, whole=whole)
        out, err = capsys.readouterr()
        assert out.strip() == "true"
        return err

    lazy = run(False)
    assert "input 0: opened lazily" in lazy
    assert re.search(rf"  input 0: {re.escape(str(table))}  \([\d.]+ MB\)", lazy), \
        f"the manifest input is not weighed by its segments:\n{lazy}"
    account = re.search(r"input 0: (\d+) of (\d+) segments decoded", lazy)
    assert account is not None, lazy
    decoded, segments = (int(g) for g in account.groups())
    assert segments >= 8
    assert decoded == 1, f"a keyed read of the manifest decoded {decoded} of {segments} segments"
    whole = run(True)
    assert "opened lazily" not in whole
    assert re.search(r"input 0: decoded whole — \+[\d.]+ (B|KB|MB) resident", whole), whole


def test_a_nested_input_opens_lazily_and_frozen(tmp_path, capsys):
    # The collapsed shape gate on the Python runner (#516, #539), against the
    # fixtures the east-c cli_paged gate uses: a nested-container element
    # shape opens lazily AND frozen, so the write through a read-out element
    # raises the uniform error instead of landing in the input — from the
    # blob, and from the manifest directory e3 stages a collection as. The
    # account names the lazy open: an input that fell back to a whole decode
    # would refuse the write too.
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


def test_exec_verbose_gives_the_account_of_each_input(tmp_path):
    # exec is the protocol e3 runs a task through, and the only form whose
    # stderr reaches its log: -v gives the account `run -v` gives (#1004) —
    # the input and what it weighs, which is the collection its manifest
    # names rather than the manifest's own few kilobytes, that it opened
    # lazily, and what reading it came to. The unit's paths are relative: it
    # runs beside the program and the input it names.
    for name in ("paged_has_unit.beast2", "paged_has.beast2"):
        shutil.copy(FIXTURES / name, tmp_path / name)
    table = tmp_path / "paged_has_table.beast2"
    with Beast2ManifestWriter(INT_STR_DICT, table, codec="none") as writer:
        writer.add_all(EastDict(IntegerType, StringType,
                                {i: f"row-{i}-" + chr(97 + i % 26) * 190 for i in range(80_000)}))

    def exec_unit(*flags: str) -> str:
        proc = subprocess.run(
            [sys.executable, "-m", "east_py_cli", "exec", str(tmp_path / "paged_has_unit.beast2"),
             *flags],
            capture_output=True, text=True,
        )
        assert proc.returncode == 0, proc.stderr
        return proc.stderr

    verbose = exec_unit("-v")
    assert re.search(rf"  input 0: {re.escape(str(table))}  \([\d.]+ MB\)", verbose), \
        f"the input is not weighed by the collection its manifest names:\n{verbose}"
    assert "input 0: opened lazily — mapped from the file" in verbose
    account = re.search(r"input 0: (\d+) of (\d+) segments decoded", verbose)
    assert account is not None, verbose
    decoded, segments = (int(g) for g in account.groups())
    assert segments >= 8
    assert decoded == 1, f"a keyed read decoded {decoded} of {segments} segments"
    assert "input 0:" not in exec_unit(), "without -v the inputs are not reported"


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
