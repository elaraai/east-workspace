#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``blob.open_beast`` (#659): the frozen lazy paged open at the expression
level and on the eager value surface.

The compliance corpus pins the VALUES on every runtime; these tests pin the
mechanism — that the opened value is served from the pager and never hydrates
for the served reads, that it is frozen, and that whatever cannot page takes
the whole frozen decode. ``paged_value_is_hydrated`` is the laziness oracle.
"""

from pathlib import Path

import pytest
from east.runtime._compiler_eastc import paged_value_is_hydrated

from east import (
    ArrayType,
    BlobType,
    DictType,
    East,
    EastBlob,
    EastDict,
    IntegerType,
    StringType,
    StructType,
)
from east.expression.errors import ExpressionError
from east.runtime.errors import EastError
from east.runtime.platform import PlatformFunction
from east.serialization.beast2 import write_beast2_file

ROW = StructType([("id", IntegerType), ("name", StringType)])
TABLE = DictType(IntegerType, ROW)
N = 300


def _table_blob(tmp_path) -> bytes:
    path = tmp_path / "table.beast2"
    write_beast2_file(
        path, TABLE,
        EastDict(IntegerType, ROW, {i: {"id": i, "name": f"row-{i}"} for i in range(N)}),
        segment_rows=50)
    return Path(path).read_bytes()


def test_expression_open_beast_serves_reads_from_the_pager(tmp_path):
    """Inside a compiled body the opened value is the paged kind: a platform
    probe receiving it sees size / keyed reads / membership answered without
    hydration, and the body's own reads compute the right values."""
    seen = {}

    def impl(d):
        seen["len"] = len(d)
        seen["row7"] = d[7]["name"]
        seen["has"] = 42 in d
        seen["missing"] = 9999 in d
        seen["hydrated"] = paged_value_is_hydrated(d._c_ptr)
        return d[7]["id"]

    probe = East.platform("probe", [TABLE], IntegerType)
    fn = East.function(
        [BlobType], IntegerType,
        lambda b, blob: probe(blob.open_beast(TABLE)) + blob.open_beast(TABLE).size())
    compiled = East.compile(fn, platform=[PlatformFunction(
        name="probe", inputs=[TABLE], output=IntegerType, type="sync", fn=impl)])

    assert compiled(EastBlob(_table_blob(tmp_path))) == 7 + N
    assert seen == {"len": N, "row7": "row-7", "has": True, "missing": False, "hydrated": False}


def test_expression_for_loop_streams_and_the_value_is_frozen(tmp_path):
    def body(b, blob):
        table = b.let(blob.open_beast(TABLE))
        total = b.let(0)

        def each(b, row, _i, _label):
            b.assign(total, total + row.id)

        b.for_(table, each)
        return total

    fn = East.function([BlobType], IntegerType, body)
    assert East.compile(fn)(EastBlob(_table_blob(tmp_path))) == sum(range(N))

    def mutate(b, blob):
        table = b.let(blob.open_beast(TABLE))
        b.do(table.insert(9999, {"id": 9999, "name": "new"}))
        return table.size()

    with pytest.raises(EastError, match="cannot mutate a frozen value"):
        East.compile(East.function([BlobType], IntegerType, mutate))(EastBlob(_table_blob(tmp_path)))


def test_expression_wire_type_mismatch_and_indexless_fallback(tmp_path):
    data = EastBlob(_table_blob(tmp_path))
    wrong = East.function(
        [BlobType], IntegerType, lambda b, blob: blob.open_beast(ArrayType(IntegerType)).size())
    with pytest.raises(EastError, match="cannot open a blob of type"):
        East.compile(wrong)(data)

    # An index-less blob (what East.Blob.encode_beast writes) decodes whole.
    indexless = East.function(
        [], IntegerType,
        lambda b: East.Blob.encode_beast(b.const([1, 2, 3], ArrayType(IntegerType)), "v2")
        .open_beast(ArrayType(IntegerType)).get(1))
    assert East.compile(indexless)() == 2


def test_expression_rejects_a_non_collection_type():
    with pytest.raises(ExpressionError, match="Array, Set or Dict"):
        East.function([BlobType], IntegerType, lambda b, blob: blob.open_beast(IntegerType))


def test_eager_open_beast_is_a_paged_proxy(tmp_path):
    """The value-level twin returns the same pager-backed proxy a task input
    opens as: served reads stay un-hydrated, a whole-value operation hydrates
    once, mutation refuses, and the wire type is checked."""
    blob = EastBlob(_table_blob(tmp_path))
    table = blob.open_beast(TABLE)
    assert len(table) == N
    assert table[7]["name"] == "row-7"
    assert 42 in table
    assert 9999 not in table
    assert paged_value_is_hydrated(table._c_ptr) is False

    with pytest.raises(Exception, match="cannot mutate a frozen value"):
        table[9999] = {"id": 9999, "name": "new"}
    assert paged_value_is_hydrated(table._c_ptr) is False

    total = int(table.to_array(lambda _b, v: v["id"], out=IntegerType).sum())
    assert total == sum(range(N))
    assert paged_value_is_hydrated(table._c_ptr) is True

    with pytest.raises(EastError, match="cannot open a blob of type"):
        blob.open_beast(ArrayType(IntegerType))
    with pytest.raises(TypeError, match="Array, Set or Dict"):
        blob.open_beast(IntegerType)
