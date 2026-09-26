#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The beast2 conformance corpus (``east/test/beast2_corpus.spec.ts``),
written again here and held to TypeScript's bytes.

Every value's whole-value blob, paged blob and manifest directory; every
emission sequence's runs and their merge; every merge of sorted inputs, as a
blob and as a manifest directory. This runtime binds east-c's writers, sorter
and merge, so what is asserted is that the binding reaches them whole: a value
that crosses into python and back writes TypeScript's bytes, a fold compiled
from the IR the corpus carries folds as TypeScript's did, and a manifest
written through the binding is TypeScript's.

The corpus is read from ``$EAST_TEST_IR_DIR/beast2_corpus`` (default
``/tmp/east-test-ir``), where ``make test-export`` in libs/east writes it
beside the compliance IR. Without it the tests skip — the local default. CI
sets ``EAST_CONFORMANCE_REQUIRED=1``, under which a missing corpus is a
collection error.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from east.serialization._beast2_eastc import _merge_blobs

from east.runtime.compiler import compile_from_beast2
from east.serialization.beast2 import (
    Beast2ManifestWriter,
    Beast2RunSorter,
    decode_beast2_with_header_for,
    encode_beast2_paged_for,
    encode_beast2_with_header_for,
    load_beast2_manifest,
    read_beast2_type,
)
from east.utils.ordering import equal_for

CORPUS_DIR = Path(os.environ.get("EAST_TEST_IR_DIR", "/tmp/east-test-ir")) / "beast2_corpus"
REQUIRED = os.environ.get("EAST_CONFORMANCE_REQUIRED") == "1"

if REQUIRED and not (CORPUS_DIR / "values.beast2").exists():
    raise RuntimeError(
        f"EAST_CONFORMANCE_REQUIRED=1 but no beast2 corpus in {CORPUS_DIR} "
        "(`make test-export` in libs/east, or set EAST_TEST_IR_DIR)")


def _cases(name: str) -> list:
    path = CORPUS_DIR / f"{name}.beast2"
    if not path.exists():
        return []
    data = path.read_bytes()
    return list(decode_beast2_with_header_for(read_beast2_type(data))(data))


VALUES = _cases("values")
RUNS = _cases("runs")
MERGES = _cases("merges")


def _write_all(directory: Path, prefix: str, blobs) -> list[Path]:
    paths = []
    for i, blob in enumerate(blobs):
        paths.append(directory / f"{prefix}-{i}.beast2")
        paths[-1].write_bytes(blob)
    return paths


@pytest.mark.skipif(not VALUES, reason=f"no beast2 corpus in {CORPUS_DIR}")
@pytest.mark.parametrize("case", VALUES, ids=[c["name"] for c in VALUES])
def test_a_value_writes_typescripts_bytes(case, tmp_path):
    t = read_beast2_type(case["value"])
    value = decode_beast2_with_header_for(t)(case["value"])
    assert encode_beast2_with_header_for(t)(value) == case["value"], "the whole-value blob"
    assert encode_beast2_paged_for(t)(value) == case["paged"], "the paged blob"
    assert equal_for(t)(decode_beast2_with_header_for(t)(case["paged"]), value), \
        "the paged blob decodes to the value"
    path = tmp_path / "value.beast2"
    with Beast2ManifestWriter(t, path) as writer:
        writer.add_all(value)
    assert path.read_bytes() == case["manifest"], "the manifest"
    assert equal_for(t)(load_beast2_manifest(path), value), "the directory reads back as the value"


class _Run:
    """One run's sink: its bytes."""

    def __init__(self):
        self.chunks: list[bytes] = []

    def write(self, data) -> None:
        self.chunks.append(bytes(data))

    def close(self) -> None:
        pass


@pytest.mark.skipif(not RUNS, reason=f"no beast2 corpus in {CORPUS_DIR}")
@pytest.mark.parametrize("case", RUNS, ids=[c["name"] for c in RUNS])
def test_an_emission_sequence_closes_and_merges_typescripts_runs(case, tmp_path):
    t = read_beast2_type(case["merged"])
    elements = decode_beast2_with_header_for(read_beast2_type(case["elements"]))(case["elements"])
    # The fold travels as the IR of a (K, V, V) -> V function.
    merge = compile_from_beast2(bytes(case["merge"].value)) if case["merge"].type == "some" else None
    runs: list[_Run] = []

    def open_run(run):
        assert run == len(runs), "runs are numbered in the order they open"
        runs.append(_Run())
        return runs[-1]

    sorter = Beast2RunSorter(t, open_run, merge=merge, union=case["union"], parallel=True)
    if t.type == "Dict":
        for element in elements:
            sorter.add((element["key"], element["value"]))
    else:
        for element in elements:
            sorter.add(element)
    sorter.finish()
    assert [b"".join(run.chunks) for run in runs] == list(case["runs"]), "the runs"

    out = tmp_path / "merged.beast2"
    _merge_blobs(_write_all(tmp_path, "run", case["runs"]), out, merge, case["union"])
    assert out.read_bytes() == case["merged"], "the runs merged"


@pytest.mark.skipif(not MERGES, reason=f"no beast2 corpus in {CORPUS_DIR}")
@pytest.mark.parametrize("case", MERGES, ids=[c["name"] for c in MERGES])
def test_sorted_inputs_merge_to_typescripts_bytes(case, tmp_path):
    paths = _write_all(tmp_path, "input", case["inputs"])
    merge = compile_from_beast2(bytes(case["merge"].value)) if case["merge"].type == "some" else None
    range_path = None
    if case["range"].type == "some":
        range_path = tmp_path / "range.beast2"
        range_path.write_bytes(case["range"].value)

    out = tmp_path / "merged.beast2"
    _merge_blobs(paths, out, merge, case["union"], range_path)
    assert out.read_bytes() == case["expected"], "the merge"

    directory = tmp_path / "directory.beast2"
    _merge_blobs(paths, directory, merge, case["union"], range_path, output_manifest=True)
    assert directory.read_bytes() == case["manifest"], "the merge's manifest"
