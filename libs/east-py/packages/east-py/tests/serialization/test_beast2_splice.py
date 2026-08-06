#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast2 splice (issue #484 PR A): merge indexed v5 files by byte copy.

east-c owns the container grammar (`_beast2_splice_extents` /
`_beast2_splice_tail` compose the same internals as its readers and writers);
python owns only the fds. Every assertion here goes through the east-c
readers — decode, paging, and the strict sequential walk — so C is the
oracle for what a spliced file means."""

import mmap

import pytest

from east import (
    ArrayType,
    DictType,
    EastArray,
    EastDict,
    EastSet,
    IntegerType,
    SetType,
    StringType,
    StructType,
)
from east.serialization.beast2 import (
    Beast2Writer,
    decode_beast2_with_header_for,
    encode_beast2_v5_for,
    encode_beast2_with_header_for,
    iter_beast2_segments_for,
    open_beast2_file,
    read_beast2_index,
    splice_beast2_files,
    write_beast2_file,
)

ROW = StructType([("id", IntegerType), ("name", StringType)])
AT = ArrayType(ROW)
DT = DictType(StringType, IntegerType)


def _rows(start, n):
    return [{"id": i, "name": f"n{i:05d}"} for i in range(start, start + n)]


def _write_shard(path, start, n, segment_rows=4096):
    write_beast2_file(path, AT, EastArray(ROW, _rows(start, n)), segment_rows=segment_rows)
    return path


def test_splice_round_trips_with_boundary_reads(tmp_path):
    shards = [_write_shard(tmp_path / f"s{k}.beast2", k * 10_000, 10_000) for k in range(3)]
    dest = tmp_path / "all.beast2"
    segments, elements = splice_beast2_files(dest, AT, shards, verify=True)
    assert (segments, elements) == (9, 30_000)
    assert read_beast2_index(AT, dest.read_bytes()) == (9, 30_000)

    with open_beast2_file(dest, AT) as f:
        assert len(f) == 30_000 and f.segment_count == 9 and f.self_contained
        # Point reads at every former shard boundary decode the right row.
        for row in [0, 9_999, 10_000, 19_999, 20_000, 29_999]:
            assert f[row]["id"] == row
        assert sum(len(batch) for batch in f.segments()) == 30_000
        assert [r["id"] for r in f.slice(9_998, 10_002)] == [9_998, 9_999, 10_000, 10_001]
        table = f.load()
        assert len(table) == 30_000 and table[15_000]["name"] == "n15000"


def test_spliced_file_is_indistinguishable_from_one_writer(tmp_path):
    """A single writer given the SAME batches produces the same structure."""
    shards = [_write_shard(tmp_path / f"s{k}.beast2", k * 5_000, 5_000) for k in range(2)]
    dest = tmp_path / "spliced.beast2"
    splice_beast2_files(dest, AT, shards)

    sequential = tmp_path / "sequential.beast2"
    with open_beast2_file(sequential, AT, mode="w", segment_rows=4096) as w:
        w.write(EastArray(ROW, _rows(0, 5_000)))
        w.write(EastArray(ROW, _rows(5_000, 5_000)))

    a, b = dest.read_bytes(), sequential.read_bytes()
    assert a == b, "splice must be byte-identical to one writer writing the same batches"


def test_splice_walks_the_east_c_strict_reader(tmp_path):
    """The sequential reader enforces whole-stream strictness (frames,
    terminator, index consistency) — it must accept a spliced file end to end
    and reproduce the original batching."""
    shards = [_write_shard(tmp_path / f"s{k}.beast2", k * 3_000, 3_000, 1000) for k in range(4)]
    dest = tmp_path / "all.beast2"
    splice_beast2_files(dest, AT, shards)
    with open(dest, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        sizes = [len(s) for s in iter_beast2_segments_for(AT)(mm)]
    assert sizes == [1000, 1000, 1000] * 4


def test_zero_segment_and_single_sources(tmp_path):
    empty = tmp_path / "empty.beast2"
    write_beast2_file(empty, AT, EastArray(ROW, []))  # header + index, no segments
    one = _write_shard(tmp_path / "one.beast2", 0, 10)

    dest = tmp_path / "merged.beast2"
    segments, elements = splice_beast2_files(dest, AT, [empty, one, empty])
    assert (segments, elements) == (1, 10)
    assert [r["id"] for r in decode_beast2_with_header_for(AT)(dest.read_bytes())] == list(range(10))

    only_empty = tmp_path / "only_empty.beast2"
    assert splice_beast2_files(only_empty, AT, [empty]) == (0, 0)
    assert len(decode_beast2_with_header_for(AT)(only_empty.read_bytes())) == 0


def test_sources_are_consumed_lazily(tmp_path):
    """A generator source is pulled one path at a time, after the previous
    shard has already been copied — the incremental-splice contract."""
    shards = [_write_shard(tmp_path / f"s{k}.beast2", k * 100, 100) for k in range(3)]
    dest = tmp_path / "lazy.beast2"
    pulls = []

    def feed():
        for k, path in enumerate(shards):
            pulls.append((k, dest.with_suffix(".beast2.splice-tmp").exists()))
            yield path

    splice_beast2_files(dest, AT, feed())
    # The first pull happens before any output exists; every later pull sees
    # the in-progress temp file from the shards already copied.
    assert pulls[0] == (0, False)
    assert all(in_progress for _k, in_progress in pulls[1:])
    assert len(decode_beast2_with_header_for(AT)(dest.read_bytes())) == 300


def test_dict_and_set_sources_splice_canonically_or_fail_as_corrupt(tmp_path):
    """Set/Dict wire content is the canonical value split at segment
    boundaries, so splice sources must ascend disjointly in source order —
    then the result decodes as plain concatenation. Sources whose ranges
    overlap produce a blob that is the encoding of no East value, and the
    strict decoders reject it."""
    disjoint = []
    for k in range(2):
        p = tmp_path / f"d{k}.beast2"
        write_beast2_file(p, DT, EastDict(StringType, IntegerType,
                                          {f"k{i:04d}": i for i in range(k * 500, (k + 1) * 500)}))
        disjoint.append(p)
    dest = tmp_path / "d.beast2"
    splice_beast2_files(dest, DT, disjoint)
    merged = decode_beast2_with_header_for(DT)(dest.read_bytes())
    assert len(merged) == 1000 and merged["k0750"] == 750

    st = SetType(IntegerType)
    s0, s1 = tmp_path / "set0.beast2", tmp_path / "set1.beast2"
    write_beast2_file(s0, st, EastSet(IntegerType, [1, 2, 3]))
    write_beast2_file(s1, st, EastSet(IntegerType, [4, 5]))
    sd = tmp_path / "set.beast2"
    splice_beast2_files(sd, st, [s0, s1])
    assert sorted(decode_beast2_with_header_for(st)(sd.read_bytes())) == [1, 2, 3, 4, 5]

    # Overlapping sources byte-copy fine but the result is non-canonical —
    # a duplicate key across the splice boundary is corruption on read.
    a, b = tmp_path / "o0.beast2", tmp_path / "o1.beast2"
    write_beast2_file(a, DT, EastDict(StringType, IntegerType, {"k": 1, "x": 7}))
    write_beast2_file(b, DT, EastDict(StringType, IntegerType, {"k": 2}))
    overlap = tmp_path / "o.beast2"
    splice_beast2_files(overlap, DT, [a, b])
    with pytest.raises((RuntimeError, ValueError), match="strictly ascending"):
        decode_beast2_with_header_for(DT)(overlap.read_bytes())


def test_preconditions_refuse_naming_the_path_and_leave_nothing(tmp_path):
    good = _write_shard(tmp_path / "good.beast2", 0, 100)
    dest = tmp_path / "dest.beast2"

    v4 = tmp_path / "v4.beast2"
    v4.write_bytes(encode_beast2_with_header_for(AT, version=4)(EastArray(ROW, _rows(0, 1))))
    with pytest.raises(ValueError, match=r"v4\.beast2.*v4 container"):
        splice_beast2_files(dest, AT, [good, v4])

    unindexed = tmp_path / "noix.beast2"
    unindexed.write_bytes(encode_beast2_v5_for(AT)(EastArray(ROW, _rows(0, 5))))
    with pytest.raises(ValueError, match=r"noix\.beast2.*no index"):
        splice_beast2_files(dest, AT, [good, unindexed])

    aliased = tmp_path / "aliased.beast2"
    with open(aliased, "wb") as stream, Beast2Writer(AT, stream, self_contained=False) as w:
        w.write(EastArray(ROW, _rows(0, 5)))
    with pytest.raises(ValueError, match=r"aliased\.beast2.*self-contained"):
        splice_beast2_files(dest, AT, [good, aliased])

    other_type = tmp_path / "other.beast2"
    write_beast2_file(other_type, DT, EastDict(StringType, IntegerType, {"k": 1}))
    with pytest.raises(ValueError, match=r"other\.beast2.*type section differs"):
        splice_beast2_files(dest, AT, [good, other_type])

    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"not a beast2 blob")
    with pytest.raises(ValueError, match=r"junk\.bin.*not a beast2 v5 container"):
        splice_beast2_files(dest, AT, [good, junk])

    with pytest.raises(ValueError, match="at least one source"):
        splice_beast2_files(dest, AT, [])

    assert not dest.exists()
    assert not dest.with_suffix(".beast2.splice-tmp").exists()


def test_random_shapes_sweep(tmp_path):
    import random

    rng = random.Random(4841)
    expected = []
    shards = []
    start = 0
    for k in range(5):
        n = rng.choice([0, 1, 17, 400, 5000])
        shards.append(_write_shard(tmp_path / f"r{k}.beast2", start, n,
                                   segment_rows=rng.choice([64, 1000, 8192])))
        expected.extend(range(start, start + n))
        start += n
    dest = tmp_path / "sweep.beast2"
    splice_beast2_files(dest, AT, shards, verify=True)
    assert [r["id"] for r in decode_beast2_with_header_for(AT)(dest.read_bytes())] == expected
