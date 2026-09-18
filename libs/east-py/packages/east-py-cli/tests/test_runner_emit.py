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
validation) over east-c's library sink (batching, the ascending check and its
duplicate-key and out-of-order errors — issues #518, #770 — and finalization:
terminator + index + footer), and the native function value that carries the
sink's ``emit`` into the compiled body (issue #560 phase 2). One case drives
the sink from python instead of from a compiled program — the harness route
that issue #592 closed.

The issue #770 gates pin the folding sink (``--merge`` / ``--union`` write the
bytes the flag-less sink writes for the folded sequence, over ascending
emissions only), the blob merge behind ``east-py merge`` (``merge_blobs``:
byte-identical to the sink over the fold, the account, the refusals) and the
``--exit-with-parent`` stdin lifeline.
"""

import os
import re
import subprocess
import sys
import time
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

from east_py_cli.runner import _EmitSink, _peak_rss_kb, merge_blobs, run_program

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


def test_dict_emit_rejects_out_of_order_keys(tmp_path, capfd):
    # Set/Dict emissions must ascend in East order (#770): the sink writes
    # one pass and never buffers, so a key below the previous one is the
    # error — in the same words on every runner — and nothing is reported
    # on stderr on the way there.
    out = tmp_path / "out.beast2"
    expected = ("beast2 v5: Dict key emitted out of order: 1 after 2 — Set/Dict emissions "
                "must ascend in East order")
    with pytest.raises(EastError, match=f"^{re.escape(expected)}$"):
        run_program(FIXTURES / "emit_dict_disorder.beast2", [], [], [], out, emit="dict")
    assert capfd.readouterr().err == ""


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


@pytest.mark.parametrize("program", ["emit_merge_ascending", "emit_union_ascending"])
def test_folding_sink_writes_the_folded_sequence_byte_for_byte(tmp_path, program):
    # Issue #770: with --merge (dict) or --union (set) the sink folds adjacent
    # equal keys in emission order, and the output is byte-identical to what
    # the flag-less sink writes for the folded sequence — key 999 folding
    # into a full batch's last entry included.
    kind = "dict" if program.startswith("emit_merge") else "set"
    expected = tmp_path / "expected.beast2"
    run_program(FIXTURES / f"{program}_folded.beast2", [], [], [], expected, emit=kind)

    folded = tmp_path / "folded.beast2"
    run_program(
        FIXTURES / f"{program}.beast2", [], [], [], folded, emit=kind,
        merge=MERGE_CONCAT if kind == "dict" else None, union=kind == "set",
    )
    assert folded.read_bytes() == expected.read_bytes()


def test_a_fold_does_not_admit_out_of_order_keys(tmp_path):
    # The folds are over ADJACENT equal keys: an out-of-order key is the
    # same error under --merge as without it.
    with pytest.raises(EastError, match="Dict key emitted out of order: 1 after 2"):
        run_program(
            FIXTURES / "emit_dict_disorder.beast2", [], [], [], tmp_path / "out.beast2",
            emit="dict", merge=MERGE_CONCAT,
        )


def test_a_runner_given_the_stdin_lifeline_exits_once_stdin_closes(tmp_path):
    # Issue #770 gate (c): with --exit-with-parent and a stdin pipe nobody
    # writes, the runner exits once that pipe closes — through east-c's
    # native watcher, which runs while the body holds the GIL. The sink
    # opens the output file before the body runs, so the file's existence
    # is the sign the runner is up and computing (the body loops forever
    # after one emission).
    out = tmp_path / "spin.beast2"
    proc = subprocess.Popen(
        [sys.executable, "-m", "east_py_cli", "run", "--exit-with-parent",
         str(FIXTURES / "emit_spin.beast2"), "--emit", "set", "-o", str(out)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    try:
        # Bounded liveness waits: the interpreter's start-up, then the watcher.
        deadline = time.monotonic() + 60
        while not out.exists():
            assert proc.poll() is None, proc.stderr.read().decode(errors="replace")
            assert time.monotonic() < deadline, "the runner did not open its output in 60 s"
            time.sleep(0.05)
        assert proc.stdin is not None and proc.stderr is not None
        proc.stdin.close()  # the lifeline closes
        try:
            returncode = proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pytest.fail("the runner outlived its closed stdin by 10 s")
        stderr = proc.stderr.read()
        # The watcher's exit, not an error's: exit 1 with nothing reported.
        assert returncode == 1
        assert b"Error" not in stderr, stderr.decode(errors="replace")
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()


# ---- The blob merge behind `east-py merge` (#770) ---------------------------

MERGE_INPUTS = [FIXTURES / f"merge_in_{name}.beast2" for name in "abc"]
MERGE_SETS = [FIXTURES / f"merge_set_{name}.beast2" for name in "abc"]


def test_merge_writes_the_fold_byte_identical_to_the_ascending_sink(tmp_path):
    # Three sorted Dict inputs with overlapping keys (a = 0..19, b = 10..29,
    # c = {5, 15, 25, 40}) fold in input order under the concatenating merge,
    # and the blob is exactly what `run --emit dict` writes for the folded
    # sequence emitted ascending.
    expected = tmp_path / "expected.beast2"
    run_program(FIXTURES / "merge_expected_dict.beast2", [], [], [], expected, emit="dict")
    out = tmp_path / "merged.beast2"
    assert merge_blobs(MERGE_INPUTS, [], out, merge=MERGE_CONCAT) == {
        "inputs": 3, "entries": 31, "folds": 13,
    }
    assert out.read_bytes() == expected.read_bytes()
    table = decode_beast2_with_header_for(INT_STR_DICT)(out.read_bytes())
    assert table[15] == "a15b15c15" and table[40] == "c40"


def test_merge_unions_set_inputs_byte_identical_to_the_ascending_sink(tmp_path):
    expected = tmp_path / "expected.beast2"
    run_program(FIXTURES / "merge_expected_set.beast2", [], [], [], expected, emit="set")
    out = tmp_path / "union.beast2"
    assert merge_blobs(MERGE_SETS, [], out, union=True) == {"inputs": 3, "entries": 31, "folds": 13}
    assert out.read_bytes() == expected.read_bytes()
    assert read_beast2_index(SetType(IntegerType), out.read_bytes())[1] == 31


def test_merge_without_a_fold_refuses_a_shared_key(tmp_path):
    out = tmp_path / "dup.beast2"
    with pytest.raises(ValueError, match="^beast2 v5: duplicate Dict key emitted: 10 — Dict keys "
                                         "must be unique$"):
        merge_blobs(MERGE_INPUTS[:2], [], out)
    # The aborted output is left unfinalised: not an indexed blob.
    with pytest.raises((ValueError, RuntimeError)):
        open_beast2_pages_for(INT_STR_DICT)(out.read_bytes())


def test_merge_names_the_input_of_another_type(tmp_path):
    other = FIXTURES / "merge_mismatch.beast2"
    with pytest.raises(ValueError, match=re.escape(f"merge: input 1 ({other}) has type ")):
        merge_blobs([MERGE_INPUTS[0], other], [], tmp_path / "x.beast2", merge=MERGE_CONCAT)


def test_merge_refuses_an_array_input_and_a_descending_one(tmp_path):
    with pytest.raises(ValueError, match="^merge: inputs must be Set or Dict blobs, got Array"):
        merge_blobs([FIXTURES / "events.beast2"], [], tmp_path / "array.beast2")
    # paged_corrupt.beast2 splices a high key range before a low one: the
    # reader's canonical-order error, prefixed with the input — the same
    # sentence east-c and east-node give.
    corrupt = FIXTURES / "paged_corrupt.beast2"
    expected = (f"merge: input 0 ({corrupt}): beast2 v5: Dict keys are not strictly ascending in "
                "East order — the wire must hold the canonical value (corrupt or pre-contract blob)")
    with pytest.raises(ValueError, match=f"^{re.escape(expected)}$"):
        merge_blobs([corrupt], [], tmp_path / "descending.beast2")


def test_merge_names_a_fold_of_the_wrong_signature(tmp_path):
    # emit_fold.beast2 is (Array<Integer>, emit) -> Null: not a fold.
    with pytest.raises(ValueError, match=re.escape(
            "--merge: expected a function (K, V, V) -> V matching the inputs (K = ")):
        merge_blobs(MERGE_INPUTS[:1], [], tmp_path / "wrong.beast2", merge=FIXTURES / "emit_fold.beast2")


def test_merge_folds_apply_to_their_own_kind(tmp_path):
    with pytest.raises(ValueError, match="^--merge applies to Dict inputs only$"):
        merge_blobs(MERGE_SETS[:1], [], tmp_path / "m.beast2", merge=MERGE_CONCAT)
    with pytest.raises(ValueError, match="^--union applies to Set inputs only$"):
        merge_blobs(MERGE_INPUTS[:1], [], tmp_path / "u.beast2", union=True)


def test_an_empty_input_contributes_nothing(tmp_path):
    with_empty = tmp_path / "with_empty.beast2"
    merge_blobs([FIXTURES / "merge_empty.beast2", MERGE_INPUTS[0]], [], with_empty, merge=MERGE_CONCAT)
    alone = tmp_path / "alone.beast2"
    merge_blobs(MERGE_INPUTS[:1], [], alone)
    assert with_empty.read_bytes() == alone.read_bytes()
    assert read_beast2_index(INT_STR_DICT, alone.read_bytes())[1] == 20
    empty = tmp_path / "empty.beast2"
    merge_blobs([FIXTURES / "merge_empty.beast2"], [], empty)
    assert read_beast2_index(INT_STR_DICT, empty.read_bytes())[1] == 0


def test_the_merge_command_prints_its_account(tmp_path):
    out = tmp_path / "merged.beast2"
    proc = subprocess.run(
        [sys.executable, "-m", "east_py_cli", "merge", "--merge", str(MERGE_CONCAT),
         *(arg for path in MERGE_INPUTS for arg in ("-i", str(path))), "-o", str(out), "-v"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "merge: 3 input(s), 31 entries, 13 fold(s)" in proc.stderr
    assert read_beast2_index(INT_STR_DICT, out.read_bytes())[1] == 31

    both = subprocess.run(
        [sys.executable, "-m", "east_py_cli", "merge", "--merge", str(MERGE_CONCAT), "--union",
         "-i", str(MERGE_INPUTS[0]), "-o", str(tmp_path / "both.beast2")],
        capture_output=True, text=True,
    )
    assert both.returncode == 1
    assert "Error: --merge and --union are two folds — give one" in both.stderr
