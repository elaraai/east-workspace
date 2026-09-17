#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Streaming execution (``--emit`` / ``--stream``) through ``run_program``.

The IR fixtures in ``tests/fixtures`` are generated from the TypeScript side
by ``libs/east-c/packages/east-c-cli/tests/generate_fixtures.mjs`` and mirror
``east-node-cli/src/runner.spec.ts``, so all three runners are pinned against
the same programs. ``events.beast2`` is written by the TS paged writer, which
makes the stream-fold case a cross-runtime decode of TS-writer bytes.

These cases exercise the whole seam end to end: ``_EmitSink`` (output
validation) over east-c's library sink (batching, the order-robust spill/merge
path and its duplicate-key check — issues #518, #770 — and finalization:
terminator + index + footer), and the native function value that carries the
sink's ``emit`` into the compiled body (issue #560 phase 2). The C sink writes
its demote notice to the process's stderr, so those checks capture file
descriptors. One case drives the sink from python instead of from a compiled
program — the harness route that issue #592 closed.

The issue #770 gates pin the folding sink (``--merge`` / ``--union`` write the
bytes the flag-less sink writes for the folded sequence), its bounded runs (the
``-v`` account: peak entries and bytes independent of the output's size, only
the merge passes growing) and the ``EAST_EXIT_WITH_PARENT`` stdin lifeline.
"""

import os
import re
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from east import (
    ArrayType,
    DictType,
    EastDict,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    SetType,
    StringType,
    platform_function,
)
from east.runtime.errors import EastError
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    open_beast2_pages_for,
    read_beast2_index,
)

from east_py_cli.runner import _EmitSink, _peak_rss_kb, run_program

FIXTURES = Path(__file__).parent / "fixtures"
INT_ARRAY = ArrayType(IntegerType)
INT_STR_DICT = DictType(IntegerType, StringType)
STR_FLOAT_DICT = DictType(StringType, FloatType)


def test_producer_emits_indexed_array(tmp_path):
    out = tmp_path / "out.beast2"
    run_program(FIXTURES / "emit_producer.beast2", [], [], [], out, emit="array")

    blob = out.read_bytes()
    index = read_beast2_index(INT_ARRAY, blob)
    assert index is not None and index[1] == 2500

    pages = open_beast2_pages_for(INT_ARRAY)(blob)
    assert pages.element_count == 2500
    assert pages.self_contained
    assert pages.element(1234) == 2468

    decoded = list(decode_beast2_with_header_for(INT_ARRAY)(blob))
    assert decoded == [2 * i for i in range(2500)]


def test_stream_fold_reads_ts_written_input(tmp_path):
    out = tmp_path / "out.beast2"
    run_program(
        FIXTURES / "emit_fold.beast2",
        [],
        [],
        [FIXTURES / "events.beast2"],
        out,
        emit="array",
        stream_inputs=[0],
    )

    sums = list(decode_beast2_with_header_for(INT_ARRAY)(out.read_bytes()))
    assert len(sums) == 2500
    assert sums[0] == 0
    assert sums[99] == 99 * 100 // 2
    assert sums[-1] == 2499 * 2500 // 2


def test_threshold_forces_the_lazy_input_path(tmp_path, monkeypatch):
    # A 1-byte threshold lazily opens EVERY indexed collection input, so this
    # run and the (eager, threshold-disabled) control must agree — the paged
    # value kind is observationally equivalent to the whole decode (#505).
    out_lazy = tmp_path / "lazy.beast2"
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "1")
    run_program(
        FIXTURES / "emit_fold.beast2", [], [], [FIXTURES / "events.beast2"], out_lazy, emit="array"
    )
    out_eager = tmp_path / "eager.beast2"
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "0")
    run_program(
        FIXTURES / "emit_fold.beast2", [], [], [FIXTURES / "events.beast2"], out_eager, emit="array"
    )
    assert out_lazy.read_bytes() == out_eager.read_bytes()


def test_lazy_input_is_mapped_and_reported(tmp_path, monkeypatch, capsys):
    # A lazily opened input is mapped, not read whole, and the verbose header
    # says so; the run itself agrees with the eager control byte for byte.
    out = tmp_path / "lazy.beast2"
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "1")
    run_program(
        FIXTURES / "emit_fold.beast2", [], [], [FIXTURES / "events.beast2"], out,
        verbose=True, emit="array",
    )
    err = capsys.readouterr().err
    assert "input 0: opened lazily — mapped from the file" in err
    # The memory block is printed only where the runner can report a peak
    # (not on Windows: no `resource` module and no /proc).
    if _peak_rss_kb() is not None:
        assert "Peak RSS" in err
    control = tmp_path / "eager.beast2"
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "0")
    run_program(
        FIXTURES / "emit_fold.beast2", [], [], [FIXTURES / "events.beast2"], control,
        verbose=True, emit="array",
    )
    assert "opened lazily" not in capsys.readouterr().err
    assert out.read_bytes() == control.read_bytes()


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
    import re

    from east import EastDict
    from east.serialization.beast2 import write_beast2_file

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
    if lazy_rss is not None and eager_rss is not None:
        assert lazy_rss < eager_rss, (
            f"lazy peak {lazy_rss:.1f} MB not below eager peak {eager_rss:.1f} MB")


def test_dict_emit_decodes_with_index(tmp_path):
    out = tmp_path / "out.beast2"
    run_program(FIXTURES / "emit_dict.beast2", [], [], [], out, emit="dict")

    blob = out.read_bytes()
    index = read_beast2_index(INT_STR_DICT, blob)
    assert index is not None and index[1] == 1000

    table = decode_beast2_with_header_for(INT_STR_DICT)(blob)
    assert len(table) == 1000
    assert table[42] == "row-42"


def test_dict_emit_accepts_out_of_order_keys(tmp_path, capfd):
    # Since issue #518 the sink absorbs out-of-order emission (demote →
    # spill → merge) instead of erroring; the output is the canonical dict
    # and the transition is reported on stderr.
    out = tmp_path / "out.beast2"
    run_program(FIXTURES / "emit_dict_disorder.beast2", [], [], [], out, emit="dict")

    blob = out.read_bytes()
    assert read_beast2_index(INT_STR_DICT, blob) is not None
    table = decode_beast2_with_header_for(INT_STR_DICT)(blob)
    assert dict(table.items()) == {1: "a", 2: "b"}
    assert "left ascending order" in capfd.readouterr().err


def test_dict_emit_shuffled_spills_and_merges_byte_identical(tmp_path, monkeypatch):
    # The shuffled fixture emits the same 1000 pairs as emit_dict; a tiny
    # run cap forces spill runs, and the merged blob must be byte-identical
    # to the ordered producer's, with the runs cleaned up (issue #518).
    ordered = tmp_path / "ordered.beast2"
    run_program(FIXTURES / "emit_dict.beast2", [], [], [], ordered, emit="dict")

    shuffled = tmp_path / "shuffled.beast2"
    monkeypatch.setenv("EAST_EMIT_RUN_ELEMENTS", "32")
    run_program(FIXTURES / "emit_dict_shuffled.beast2", [], [], [], shuffled, emit="dict")

    assert shuffled.read_bytes() == ordered.read_bytes()
    assert not list(tmp_path.glob("shuffled.beast2.run*"))


def test_dict_emit_duplicate_key_raises(tmp_path):
    # The surviving hard error of the old strictly-ascending contract:
    # Dict keys must be unique under any emission order.
    with pytest.raises(EastError, match="duplicate Dict key emitted"):
        run_program(
            FIXTURES / "emit_dict_duplicate.beast2", [], [], [], tmp_path / "out.beast2",
            emit="dict",
        )


def test_emit_requires_beast2_output(tmp_path):
    with pytest.raises(ValueError, match=r"--emit requires a \.beast2 output file"):
        run_program(FIXTURES / "emit_producer.beast2", [], [], [], tmp_path / "out.json", emit="array")


def test_emit_kind_must_match_the_emit_parameter_arity(tmp_path):
    with pytest.raises(ValueError, match=r"2 argument\(s\), got 1"):
        run_program(FIXTURES / "emit_producer.beast2", [], [], [], tmp_path / "out.beast2", emit="dict")


def test_emit_on_zero_parameter_function_raises_the_shaped_error(tmp_path):
    # No trailing parameter exists to be the emit capability — the canonical
    # message, never an IndexError traceback (#516).
    with pytest.raises(ValueError, match="trailing parameter to be the emit capability"):
        run_program(FIXTURES / "zero_param.beast2", [], [], [], tmp_path / "out.beast2", emit="array")


def test_stream_index_rejected_on_a_zero_input_program(tmp_path):
    # east-node / east-c parity: `--stream 0` with no file inputs is an
    # error, not a silently ignored flag (#516).
    with pytest.raises(ValueError, match=r"--stream index 0 out of range \(0 inputs\)"):
        run_program(
            FIXTURES / "emit_producer.beast2", [], [], [], tmp_path / "out.beast2",
            emit="array", stream_inputs=[0],
        )


def test_wide_rows_rebatch_toward_the_segment_byte_target(tmp_path):
    # 1500 × ~4 KiB rows: the first batch fills the element cap, and the
    # byte-adaptive refinement must shrink subsequent batches — a row-count
    # sink would put all remaining rows in one grossly oversized segment.
    out = tmp_path / "wide.beast2"
    run_program(FIXTURES / "emit_wide.beast2", [], [], [], out, emit="array")

    pages = open_beast2_pages_for(ArrayType(StringType))(out.read_bytes())
    assert pages.element_count == 1500
    assert pages.segment_count >= 2
    # Batches after the cap-sized first one target ~2 MiB / ~4 KiB ≈ 512 rows.
    assert max(pages.counts[1:]) < 1000


def test_lazy_paged_input_pins(tmp_path, monkeypatch):
    # The lazy paged-input contract end to end on the Python runner
    # (#516, #539), against the same fixtures the east-c cli_paged gate uses.
    monkeypatch.setenv("EAST_LAZY_INPUT_BYTES", "1")

    # Inputs are frozen: mutating a dict input (inside its own $.for) raises
    # the uniform copy-first error on a lazily-opened input, refused before
    # any hydration.
    with pytest.raises(EastError, match="cannot mutate a frozen value"):
        run_program(FIXTURES / "paged_for_mutate.beast2", [], [], [FIXTURES / "paged_table.beast2"])

    # A keyed `has` over a corrupt blob (non-disjoint spliced key ranges)
    # propagates the pager error instead of answering false.
    with pytest.raises(EastError, match="not disjoint ascending key ranges"):
        run_program(FIXTURES / "paged_has.beast2", [], [], [FIXTURES / "paged_corrupt.beast2"])

    # The collapsed shape gate: a nested-container element shape opens
    # lazily AND frozen, so the write through a read-out element raises the
    # uniform error instead of landing in the input.
    with pytest.raises(EastError, match="cannot mutate a frozen value"):
        run_program(
            FIXTURES / "paged_nested_mutate.beast2", [], [], [FIXTURES / "paged_nested.beast2"]
        )


def test_sink_drives_a_python_invoked_platform_function_natively(tmp_path):
    # Issue #592: a harness that calls a @platform_function DIRECTLY from
    # python — a unit test, a probe, a driver — hands it `function_value()`
    # as-is. That used to be a non-callable value holder, so a PURE emit
    # callback raised "'_EmitFnHold' object is not callable" with no
    # fallback. It is now the same call wrapper east-c hands a platform
    # function, so the callback captures: the emit lowers to a native IR
    # Call (a callback that cannot capture raises, so there is no python per
    # row to measure) and the sink writes the real beast2 file.
    emit_t = FunctionType([StringType, FloatType], NullType)

    @platform_function(inputs=[STR_FLOAT_DICT, emit_t], output=NullType,
                       name="issue592.double_all")
    def double_all(rows, emit):
        rows.for_each(lambda _b, v, k: emit(k, v * 2.0))

    out = tmp_path / "doubled.beast2"
    sink = _EmitSink("dict", emit_t, out)
    emit = sink.function_value()
    assert callable(emit)

    rows = EastDict(StringType, FloatType, {f"k{i}": float(i) for i in range(50)})
    double_all(rows, emit)
    sink.finish()

    table = decode_beast2_with_header_for(STR_FLOAT_DICT)(out.read_bytes())
    assert dict(table.items()) == {f"k{i}": 2.0 * i for i in range(50)}


def test_snapshot_capture_refuses_streaming_flags(tmp_path, capsys):
    # The snapshot manifest (format v1) carries no streaming flags, so a
    # captured emit invocation would replay with the wrong arity — the CLI
    # refuses the combination at capture time (issue #508).
    import argparse

    from east_py_cli.cli import cmd_run

    args = argparse.Namespace(
        ir_file=FIXTURES / "emit_producer.beast2",
        package=[],
        input=[],
        output=tmp_path / "out.beast2",
        verbose=False,
        snapshot=tmp_path / "snap.east-snapshot",
        from_snapshot=None,
        emit="array",
        stream=None,
    )
    assert cmd_run(args) == 1
    assert "--snapshot does not capture --emit/--stream" in capsys.readouterr().err
    assert not (tmp_path / "snap.east-snapshot").exists()


MERGE_CONCAT = FIXTURES / "emit_merge_concat.beast2"


@pytest.mark.parametrize(
    ("program", "run_cap", "demotes"),
    [
        ("emit_merge_ascending", None, False),
        ("emit_merge_scattered", None, True),
        ("emit_merge_scattered", "16", True),
        ("emit_merge_scattered", "2", True),
        ("emit_union_ascending", None, False),
        ("emit_union_scattered", None, True),
        ("emit_union_scattered", "16", True),
        ("emit_union_scattered", "2", True),
    ],
)
def test_folding_sink_writes_the_folded_sequence_byte_for_byte(
    tmp_path, monkeypatch, capfd, program, run_cap, demotes
):
    # Issue #770: with --merge (dict) or --union (set) the sink folds equal
    # keys in emission order, and the output is byte-identical to what the
    # flag-less sink writes for the folded sequence. The ascending sequence
    # folds on the straight-through path — key 999 into a full batch's last
    # entry; the scattered one demotes, a duplicate of a prefix key follows,
    # and the run cap moves its folds into the tail (the default), across
    # runs (16), or across the runs of a two-pass merge (2).
    kind = "dict" if program.startswith("emit_merge") else "set"
    expected = tmp_path / "expected.beast2"
    run_program(FIXTURES / f"{program}_folded.beast2", [], [], [], expected, emit=kind)

    if run_cap is not None:
        monkeypatch.setenv("EAST_EMIT_RUN_ELEMENTS", run_cap)
    capfd.readouterr()
    folded = tmp_path / "folded.beast2"
    run_program(
        FIXTURES / f"{program}.beast2", [], [], [], folded, emit=kind,
        merge=MERGE_CONCAT if kind == "dict" else None, union=kind == "set",
    )

    assert ("left ascending order" in capfd.readouterr().err) == demotes
    assert folded.read_bytes() == expected.read_bytes()
    assert not list(tmp_path.glob("folded.beast2.run*"))


_EMIT_EPILOGUE = re.compile(
    r"emit: merged (?P<sources>\d+) source\(s\) in (?P<passes>\d+) pass\(es\) "
    r"\((?P<runs_per_pass>\d+) runs per pass\); (?P<spills>\d+) spill\(s\), "
    r"peak (?P<peak_entries>\d+) entries / (?P<peak_bytes>[\d.]+ [KM]?B) buffered"
)


def test_merge_passes_grow_while_the_sink_peak_stays_bounded(tmp_path, monkeypatch, capfd):
    # Issue #770 gate (a): the sink's memory is bounded by its run caps, not by
    # the output. Under a 64-entry run cap, 50,000 and 400,000 out-of-order
    # emissions (every element encoded in the same number of bytes) report the
    # same peak entries and bytes and merge 64 runs at once; only the passes
    # grow — 783 sources (the demoted prefix, 781 spills, the tail) in 2,
    # 6,251 in 3. A byte cap below one run's bytes spills by bytes: fewer
    # entries per run than the element cap allows.
    monkeypatch.setenv("EAST_EMIT_RUN_ELEMENTS", "64")

    def account(fixture: str, out: str) -> dict[str, str]:
        capfd.readouterr()
        run_program(FIXTURES / fixture, [], [], [], tmp_path / out, verbose=True, emit="set")
        err = capfd.readouterr().err
        match = _EMIT_EPILOGUE.search(err)
        assert match is not None, f"-v printed no emit epilogue:\n{err}"
        return match.groupdict()

    small = account("emit_scatter_50k.beast2", "small.beast2")
    large = account("emit_scatter_400k.beast2", "large.beast2")
    monkeypatch.setenv("EAST_EMIT_RUN_BYTES", "256")
    by_bytes = account("emit_scatter_50k.beast2", "by_bytes.beast2")

    assert small["peak_bytes"] == large["peak_bytes"]
    assert (small["peak_entries"], small["runs_per_pass"]) == ("64", "64")
    assert (large["peak_entries"], large["runs_per_pass"]) == ("64", "64")
    assert (small["sources"], small["passes"]) == ("783", "2")
    assert (large["sources"], large["passes"]) == ("6251", "3")
    assert 0 < int(by_bytes["peak_entries"]) < 64
    assert int(by_bytes["spills"]) > int(small["spills"])
    assert read_beast2_index(SetType(IntegerType), (tmp_path / "large.beast2").read_bytes())[1] == 400_000
    assert not list(tmp_path.glob("*.run*"))


def test_a_runner_given_the_stdin_lifeline_exits_once_stdin_closes(tmp_path):
    # Issue #770 gate (c): with EAST_EXIT_WITH_PARENT=1 and a stdin pipe
    # nobody writes, the runner exits once that pipe closes — through east-c's
    # native watcher, which runs while the body holds the GIL. The fixture's
    # out-of-order second emission prints the sink's demote notice (the body
    # is running), then the body loops forever.
    proc = subprocess.Popen(
        [sys.executable, "-m", "east_py_cli", "run", str(FIXTURES / "emit_spin.beast2"),
         "--emit", "set", "-o", str(tmp_path / "spin.beast2")],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        env={**os.environ, "EAST_EXIT_WITH_PARENT": "1"},
    )
    stderr: list[bytes] = []
    running = threading.Event()

    def read_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr.append(line)
            if b"left ascending order" in line:
                running.set()

    reader = threading.Thread(target=read_stderr, daemon=True)
    reader.start()
    try:
        # Bounded liveness waits: the interpreter's start-up, then the watcher.
        assert running.wait(timeout=60), b"".join(stderr).decode(errors="replace")
        assert proc.stdin is not None
        proc.stdin.close()  # the lifeline closes
        try:
            returncode = proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pytest.fail("the runner outlived its closed stdin by 10 s")
        reader.join(timeout=10)
        # The watcher's exit, not an error's: exit 1 with nothing reported.
        assert returncode == 1
        assert b"Error" not in b"".join(stderr), b"".join(stderr).decode(errors="replace")
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        reader.join(timeout=10)
