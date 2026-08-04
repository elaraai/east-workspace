#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""write_beast2_file_parallel (issue #484 PR B): fork + write + splice.

One contract, two strategies: forked children on POSIX (Linux/macOS — the
context `produce` closes over is inherited copy-on-write and east-c never
needs thread safety, since each child owns a whole process), the same code
run inline sequentially on Windows. The output must be byte-identical either
way, so most tests here run on every OS; fork-specific behavior (ordering
under delay, signal death, concurrency caps) is skipped where fork does not
exist."""

import os
import time

import pytest

from east import ArrayType, EastArray, IntegerType, StringType, StructType
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    open_beast2_file,
    write_beast2_file_parallel,
)

ROW = StructType([("id", IntegerType), ("name", StringType)])
AT = ArrayType(ROW)
HAS_FORK = hasattr(os, "fork")
fork_only = pytest.mark.skipif(not HAS_FORK, reason="needs os.fork (POSIX)")


def _rows(start, n):
    return [{"id": i, "name": f"n{i:05d}"} for i in range(start, start + n)]


def _spans(total, shards):
    step = -(-total // shards)
    return [(k * step, min((k + 1) * step, total) - k * step) for k in range(shards)]


def _produce(span):
    start, n = span
    return EastArray(ROW, _rows(start, n))  # a single collection = one batch


def test_parallel_output_is_byte_identical_to_inline(tmp_path):
    """auto (fork where the platform has it) and inline must produce the same
    bytes — the same batches, spliced in the same order."""
    parts = _spans(10_000, 4)
    a, b = tmp_path / "auto.beast2", tmp_path / "inline.beast2"
    result = write_beast2_file_parallel(a, AT, parts, _produce, segment_rows=1024)
    write_beast2_file_parallel(b, AT, parts, _produce, strategy="inline", segment_rows=1024)
    assert a.read_bytes() == b.read_bytes()
    assert result == (12, 10_000)  # 4 shards x ceil(2500/1024) segments

    with open_beast2_file(a, AT) as f:
        assert len(f) == 10_000 and f.self_contained
        assert f[0]["id"] == 0 and f[9_999]["id"] == 9_999
    assert [r["id"] for r in decode_beast2_with_header_for(AT)(a.read_bytes())] == list(
        range(10_000)
    )


def test_produce_may_yield_batches(tmp_path):
    """produce may return an iterable of batches (python builtins included)."""

    def produce(span):
        start, n = span
        third = n // 3
        yield _rows(start, third)
        yield _rows(start + third, third)
        yield EastArray(ROW, _rows(start + 2 * third, n - 2 * third))

    dest = tmp_path / "gen.beast2"
    write_beast2_file_parallel(dest, AT, _spans(600, 2), produce)
    assert [r["id"] for r in decode_beast2_with_header_for(AT)(dest.read_bytes())] == list(
        range(600)
    )


@fork_only
def test_partition_order_survives_completion_order(tmp_path):
    """Partition 0 finishes LAST; the file must still hold its rows first."""

    def produce(span):
        if span[0] == 0:
            time.sleep(0.3)
        return _produce(span)

    dest = tmp_path / "ordered.beast2"
    write_beast2_file_parallel(dest, AT, _spans(400, 2), produce, processes=2)
    assert [r["id"] for r in decode_beast2_with_header_for(AT)(dest.read_bytes())] == list(
        range(400)
    )


def _assert_no_leftovers(tmp_path, dest):
    assert not dest.exists()
    leftovers = [p.name for p in tmp_path.iterdir()]
    assert leftovers == [], f"leftover files: {leftovers}"


def test_worker_exception_fails_atomically(tmp_path):
    def produce(span):
        if span[0] >= 200:
            raise ValueError(f"boom on {span[0]}")
        return _produce(span)

    dest = tmp_path / "fails.beast2"
    expected = RuntimeError if HAS_FORK else ValueError
    with pytest.raises(expected, match="boom on 200"):
        write_beast2_file_parallel(dest, AT, _spans(300, 3), produce)
    _assert_no_leftovers(tmp_path, dest)


def test_inline_strategy_exception_everywhere(tmp_path):
    def produce(span):
        if span[0] >= 100:
            raise ValueError("inline boom")
        return _produce(span)

    dest = tmp_path / "inline_fails.beast2"
    with pytest.raises(ValueError, match="inline boom"):
        write_beast2_file_parallel(dest, AT, _spans(200, 2), produce, strategy="inline")
    _assert_no_leftovers(tmp_path, dest)


@fork_only
def test_worker_signal_death_fails_atomically(tmp_path):
    import signal

    def produce(span):
        if span[0] >= 100:
            os.kill(os.getpid(), signal.SIGKILL)
        return _produce(span)

    dest = tmp_path / "killed.beast2"
    with pytest.raises(RuntimeError, match="signal 9"):
        write_beast2_file_parallel(dest, AT, _spans(200, 2), produce, processes=1)
    _assert_no_leftovers(tmp_path, dest)


@fork_only
def test_processes_caps_concurrency(tmp_path):
    """9 partitions, 2 slots: correct output and never more than 2 running,
    observed via an O_APPEND event log written by the children."""
    log = tmp_path / "events.log"

    def produce(span):
        with open(log, "a") as f:
            f.write(f"start {span[0]}\n")
        time.sleep(0.05)
        rows = _produce(span)
        with open(log, "a") as f:
            f.write(f"end {span[0]}\n")
        return rows

    dest = tmp_path / "capped.beast2"
    write_beast2_file_parallel(dest, AT, _spans(900, 9), produce, processes=2)
    assert [r["id"] for r in decode_beast2_with_header_for(AT)(dest.read_bytes())] == list(
        range(900)
    )
    depth = peak = 0
    for line in log.read_text().splitlines():
        depth += 1 if line.startswith("start") else -1
        peak = max(peak, depth)
    assert 1 <= peak <= 2
    log.unlink()


def test_auto_degrades_and_fork_refuses_without_fork(tmp_path, monkeypatch):
    """Simulates Windows on POSIX (and is a no-op re-check on Windows)."""
    monkeypatch.delattr(os, "fork", raising=False)
    dest = tmp_path / "nofork.beast2"
    write_beast2_file_parallel(dest, AT, _spans(100, 2), _produce)
    assert len(decode_beast2_with_header_for(AT)(dest.read_bytes())) == 100
    with pytest.raises(ValueError, match="os.fork"):
        write_beast2_file_parallel(dest, AT, _spans(100, 2), _produce, strategy="fork")


def test_keep_shards_leaves_valid_files(tmp_path):
    dest = tmp_path / "kept.beast2"
    write_beast2_file_parallel(dest, AT, _spans(300, 3), _produce, keep_shards=True)
    shards = sorted(tmp_path.glob("kept.beast2.shard*.tmp"))
    assert len(shards) == 3
    with open_beast2_file(shards[1], AT) as shard:
        assert [r["id"] for r in shard.load()][:1] == [100]


def test_verify_and_validation(tmp_path):
    dest = tmp_path / "verified.beast2"
    segments, elements = write_beast2_file_parallel(
        dest, AT, _spans(500, 2), _produce, verify=True
    )
    assert elements == 500 and segments >= 2
    with pytest.raises(ValueError, match="at least one partition"):
        write_beast2_file_parallel(dest, AT, [], _produce)
    with pytest.raises(ValueError, match="strategy"):
        write_beast2_file_parallel(dest, AT, _spans(10, 1), _produce, strategy="threads")
