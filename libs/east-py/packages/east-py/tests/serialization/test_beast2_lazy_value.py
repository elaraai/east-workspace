#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast2 files as first-class lazy East values (issue #560, phase 1).

``open_beast2_file`` returns a read-only SUBCLASS of the eager collection
class, so the file is an ordinary East value: it answers ``isinstance`` and
``type_of``, binds into kernels by reference (keyed reads inside the compiled
body answer from the pager, one frame per hit/miss), passes straight into
compiled function calls, and refuses mutation. The managed writer batches
byte-adaptively, so pathologically wide rows produce right-sized segments,
and the pager's decoded-segment cache is budgeted in BYTES
(``EAST_PAGED_CACHE_BYTES``)."""

import os

import pytest

from east import (
    ArrayType,
    BlobType,
    BooleanType,
    DictType,
    East,
    EastArray,
    EastBlob,
    EastDict,
    EastSet,
    FloatType,
    IntegerType,
    SetType,
    StringType,
    StructType,
    type_of,
)
from east.runtime.errors import EastError
from east.serialization.beast2 import open_beast2_file, write_beast2_file

ROW = StructType([("k", StringType), ("v", FloatType)])
A_ROW = ArrayType(ROW)
D_SF = DictType(StringType, FloatType)


def _dict_path(tmp_path, n=200, seg=16):
    path = tmp_path / "table.beast2"
    write_beast2_file(path, D_SF,
                      EastDict(StringType, FloatType,
                               {f"k{i:04d}": i * 1.5 for i in range(n)}),
                      segment_rows=seg)
    return path


class TestValueSemantics:
    def test_the_file_is_its_collection_value(self, tmp_path):
        with open_beast2_file(_dict_path(tmp_path), D_SF) as d:
            assert isinstance(d, EastDict)
            assert type_of(d) == D_SF  # O(1): declared, never content-inferred
        at_path = tmp_path / "arr.beast2"
        write_beast2_file(at_path, A_ROW,
                          EastArray(ROW, [{"k": "a", "v": 1.0}]))
        with open_beast2_file(at_path, A_ROW) as f:
            assert isinstance(f, EastArray)
            assert type_of(f) == A_ROW
        st_path = tmp_path / "set.beast2"
        write_beast2_file(st_path, SetType(IntegerType), EastSet(IntegerType, [1, 2]))
        with open_beast2_file(st_path) as s:
            assert isinstance(s, EastSet)
            assert type_of(s) == SetType(IntegerType)

    def test_mutation_refuses_on_every_flavor(self, tmp_path):
        with open_beast2_file(_dict_path(tmp_path), D_SF) as d:
            with pytest.raises(EastError, match="read-only view"):
                d["k0000"] = 9.9
            with pytest.raises(EastError, match="read-only view"):
                d.insert("zz", 1.0)
            with pytest.raises(EastError, match="read-only view"):
                d.update_many(["a"], [1.0])
        at_path = tmp_path / "arr.beast2"
        write_beast2_file(at_path, A_ROW, EastArray(ROW, [{"k": "a", "v": 1.0}]))
        with open_beast2_file(at_path) as f:
            with pytest.raises(EastError, match="read-only view"):
                f.append({"k": "b", "v": 2.0})
            with pytest.raises(EastError, match="read-only view"):
                f += EastArray(ROW, [])
            with pytest.raises(EastError, match="read-only view"):
                f.sort()
        st_path = tmp_path / "set.beast2"
        write_beast2_file(st_path, SetType(IntegerType), EastSet(IntegerType, [1]))
        with open_beast2_file(st_path) as s:
            with pytest.raises(EastError, match="read-only view"):
                s.add(9)
            with pytest.raises(EastError, match="read-only view"):
                s.union_in_place(EastSet(IntegerType, [2]))

    def test_inherited_eager_methods_answer_via_iteration(self, tmp_path):
        # No segment-streamed override — the inherited eager method converts
        # through ordinary iteration and must agree with load().
        at_path = tmp_path / "sortme.beast2"
        rows = [{"k": f"s{9 - i}", "v": float(i)} for i in range(10)]
        write_beast2_file(at_path, A_ROW, EastArray(ROW, rows), segment_rows=3)
        with open_beast2_file(at_path) as f:
            got = f.sorted(key=lambda _b, r: r["k"])
            want = f.load().sorted(key=lambda _b, r: r["k"])
            assert [r["k"] for r in got] == [r["k"] for r in want]
            # copy() is the mutable escape hatch
            copied = f.copy()
            copied.append({"k": "zz", "v": 0.0})
            assert len(copied) == len(f) + 1

    def test_segments_is_a_deprecated_alias(self, tmp_path):
        with open_beast2_file(_dict_path(tmp_path, n=30, seg=10)) as d:
            with pytest.warns(DeprecationWarning, match="first-class collection value"):
                total = sum(len(batch) for batch in d.segments())
            assert total == 30

    def test_repr_never_decodes_the_elements(self, tmp_path):
        with open_beast2_file(_dict_path(tmp_path)) as d:
            assert "Beast2DictFile" in repr(d) and "200 elements" in repr(d)


class TestKernelBind:
    def test_a_bound_lazy_dict_answers_get_or_default_natively(self, tmp_path):
        with open_beast2_file(_dict_path(tmp_path, n=500, seg=16)) as d:
            lookup = East.function([ROW, D_SF], FloatType,
                            lambda _b, r, t: t.get_or_default(r["k"], -1.0)).bind(d)
            rows = EastArray(ROW, [{"k": "k0000", "v": 0.0},
                                   {"k": "k0250", "v": 0.0},
                                   {"k": "k0499", "v": 0.0},
                                   {"k": "MISS", "v": 0.0}])
            out = list(rows.map(lookup))
            assert out == [0.0, 375.0, 748.5, -1.0]

    def test_bind_under_a_one_byte_cache_budget_still_answers(self, tmp_path, monkeypatch):
        # A degenerate budget forces eviction on every miss — the answers
        # must not change, only the cache hit rate.
        monkeypatch.setenv("EAST_PAGED_CACHE_BYTES", "1")
        with open_beast2_file(_dict_path(tmp_path, n=200, seg=8)) as d:
            lookup = East.function([StringType, D_SF], FloatType,
                            lambda _b, k, t: t.get_or_default(k, -1.0)).bind(d)
            for i in range(0, 200, 7):
                assert lookup(f"k{i:04d}") == i * 1.5
            assert lookup("nope") == -1.0

    def test_the_file_passes_straight_into_a_compiled_call(self, tmp_path):
        with open_beast2_file(_dict_path(tmp_path, n=50, seg=8)) as d:
            size = East.function([D_SF], IntegerType, lambda _b, t: t.size())
            assert size(d) == 50
            probe = East.function([StringType, D_SF], BooleanType, lambda _b, k, t: t.has(k))
            assert probe("k0001", d) is True
            assert probe("zz", d) is False

    def test_fused_pipeline_lazy_dict_through_a_nested_call(self, tmp_path):
        # The #560/#561 composition: a bound lazy-dict lookup CALLED from
        # another kernel lowers to an IR Call, so the whole projection —
        # loop, kernel, callee and pager — runs inside east-c.
        with open_beast2_file(_dict_path(tmp_path, n=300, seg=16)) as d:
            lookup = East.function([StringType, D_SF], FloatType,
                            lambda _b, k, t: t.get_or_default(k, 0.0)).bind(d)
            project = East.function([ROW], FloatType, lambda _b, r: r["v"] + lookup(r["k"]))
            rows = EastArray(ROW, [{"k": "k0000", "v": 1.0},
                                   {"k": "k0123", "v": 2.0},
                                   {"k": "MISS", "v": 3.0}])
            assert list(rows.map(project)) == [1.0, 2.0 + 123 * 1.5, 3.0]

    def test_close_defers_while_a_bind_still_holds_the_value(self, tmp_path):
        # Closing under a live bind would leave the native callee reading
        # unmapped memory — close defers, the bound kernel keeps answering,
        # and dropping the bind lets a later close complete.
        d = open_beast2_file(_dict_path(tmp_path))
        lookup = East.function([StringType, D_SF], FloatType,
                        lambda _b, k, t: t.get_or_default(k, -1.0)).bind(d)
        assert lookup("k0000") == 0.0
        d.close()
        assert not d.closed
        assert lookup("k0001") == 1.5
        del lookup
        import gc

        gc.collect()  # the bound callable holds a self-referential cycle
        d.close()
        assert d.closed


class TestWideRows:
    def test_the_managed_writer_batches_by_bytes_not_rows(self, tmp_path):
        # 24 rows of ~1 MiB each: the old fixed 8192-row grain would write ONE
        # segment whose decode costs ~24 MiB; the byte-adaptive default must
        # split near the 2 MiB wire target instead.
        wide_row = StructType([("id", IntegerType), ("payload", BlobType)])
        blob = os.urandom(1024 * 1024)  # incompressible, so wire ≈ decoded
        rows = EastArray(wide_row, [{"id": i, "payload": EastBlob(blob)}
                                    for i in range(24)])
        path = tmp_path / "wide.beast2"
        write_beast2_file(path, ArrayType(wide_row), rows)
        with open_beast2_file(path) as f:
            assert len(f) == 24
            assert f.segment_count >= 8, (
                f"wide rows landed in {f.segment_count} segment(s) — the "
                "byte-adaptive batching did not engage")
            assert f.get(23)["id"] == 23

    def test_wide_row_point_reads_under_a_small_budget(self, tmp_path, monkeypatch):
        wide_row = StructType([("id", IntegerType), ("payload", BlobType)])
        blob = os.urandom(256 * 1024)
        rows = EastArray(wide_row, [{"id": i, "payload": EastBlob(blob)}
                                    for i in range(16)])
        path = tmp_path / "wide2.beast2"
        write_beast2_file(path, ArrayType(wide_row), rows)
        monkeypatch.setenv("EAST_PAGED_CACHE_BYTES", str(512 * 1024))
        with open_beast2_file(path) as f:
            get = East.function([IntegerType, ArrayType(wide_row)], IntegerType,
                         lambda _b, i, a: a.get(i)["id"]).bind(f)
            for i in (0, 15, 7, 0, 11, 3):
                assert get(i) == i

    def test_an_explicit_segment_rows_still_pins_the_row_grain(self, tmp_path):
        at = ArrayType(IntegerType)
        path = tmp_path / "pinned.beast2"
        write_beast2_file(path, at, EastArray(IntegerType, range(100)),
                          segment_rows=10)
        with open_beast2_file(path) as f:
            assert f.segment_count == 10
