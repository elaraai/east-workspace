#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``FileSystem.openBeast`` on the python runtime (``fs_open_beast``).

The std compliance corpus pins the VALUES on every runtime; these tests pin
this runtime's mechanism — the file is mapped and served from the pager
without hydrating, the value is frozen, the mapping is the value's own, and
whatever cannot page takes the whole frozen decode. ``paged_value_is_hydrated``
is the laziness oracle.
"""

import gc
import os
import sys

import pytest
from east import (
    ArrayType,
    DictType,
    East,
    EastArray,
    EastDict,
    IntegerType,
    StringType,
    StructType,
)
from east.runtime._compiler_eastc import paged_value_is_hydrated, paged_value_ref_count
from east.runtime.errors import EastError
from east.runtime.platform import PlatformFunction
from east.serialization.beast2 import encode_beast2_v5_for, write_beast2_file

from east_py_std import fs_impl, fs_open_beast

ROW = StructType([("id", IntegerType), ("name", StringType)])
TABLE = DictType(IntegerType, ROW)
N = 300

open_beast = East.genericPlatform("fs_open_beast", ["T"], [StringType], "T")
check = East.platform("check", [TABLE], IntegerType)


def _write_table(path) -> None:
    write_beast2_file(
        path, TABLE,
        EastDict(IntegerType, ROW, {i: {"id": i, "name": f"row-{i}"} for i in range(N)}),
        segment_rows=50)


def _check(d):
    return 1 if paged_value_is_hydrated(d._c_ptr) else 0


def _compile(body, extra=()):
    return East.compile(East.function([StringType], IntegerType, body),
                        platform=[*fs_impl, *extra])


def test_keyed_reads_stay_pager_served_and_the_value_is_frozen(tmp_path):
    path = tmp_path / "table.beast2"
    _write_table(path)

    def body(b, p):
        table = b.let(open_beast([TABLE], p))
        n = b.let(table.size() + table.get(7).id)
        return check(table) * 1000 + n

    compiled = _compile(body, [PlatformFunction(
        name="check", inputs=[TABLE], output=IntegerType, type="sync", fn=_check)])
    # 0 * 1000: un-hydrated after size + a keyed read; N + 7: the reads answered.
    assert compiled(str(path)) == N + 7

    def mutate(b, p):
        table = b.let(open_beast([TABLE], p))
        b.do(table.insert(9999, {"id": 9999, "name": "new"}))
        return table.size()

    with pytest.raises(EastError, match="cannot mutate a frozen value"):
        _compile(mutate)(str(path))


def test_for_loop_streams_the_file(tmp_path):
    path = tmp_path / "table.beast2"
    _write_table(path)

    def body(b, p):
        table = b.let(open_beast([TABLE], p))
        total = b.let(0)

        def each(b, row, _i, _label):
            b.assign(total, total + row.id)

        b.for_(table, each)
        return total

    assert _compile(body)(str(path)) == sum(range(N))


def test_header_mismatch_missing_file_and_garbage_raise_the_shared_message(tmp_path):
    path = tmp_path / "table.beast2"
    _write_table(path)
    wrong = East.function(
        [StringType], IntegerType, lambda b, p: open_beast([ArrayType(IntegerType)], p).size())
    with pytest.raises(EastError, match="Failed to open beast file .*cannot open a blob of type"):
        East.compile(wrong, platform=fs_impl)(str(path))

    with pytest.raises(EastError, match="Failed to open beast file"):
        _compile(lambda b, p: open_beast([TABLE], p).size())(str(tmp_path / "missing.beast2"))

    text = tmp_path / "text.beast2"
    text.write_text("not a beast2 container")
    with pytest.raises(EastError, match="Failed to open beast file"):
        _compile(lambda b, p: open_beast([TABLE], p).size())(str(text))


def test_indexless_file_decodes_whole_and_frozen(tmp_path):
    path = tmp_path / "whole.beast2"
    path.write_bytes(encode_beast2_v5_for(ArrayType(IntegerType))(EastArray(IntegerType, [1, 2, 3])))
    body = East.function(
        [StringType], IntegerType, lambda b, p: open_beast([ArrayType(IntegerType)], p).get(1))
    assert East.compile(body, platform=fs_impl)(str(path)) == 2

    def mutate(b, p):
        values = b.let(open_beast([ArrayType(IntegerType)], p))
        b.do(values.push_last(4))
        return values.size()

    with pytest.raises(EastError, match="cannot mutate a frozen value"):
        _compile(mutate)(str(path))


def test_the_mapping_is_the_values_own(tmp_path):
    """The hold the factory returns owns its mapping: the source file may be
    unlinked once opened and reads still page from the mapping; releasing the
    hold releases the mapping (the refcount probe shows nothing else holds
    the value)."""
    path = tmp_path / "table.beast2"
    _write_table(path)
    hold = fs_open_beast(None, TABLE)(str(path))
    assert hold is not None
    assert paged_value_ref_count(hold._east_c_paged) == 1
    if sys.platform != "win32":  # a mapped file cannot be unlinked on Windows
        os.unlink(path)

    source = East.platform("source", [], TABLE)

    def body(b):
        table = b.let(source())
        return check(table) * 1000 + table.size() + table.get(7).id

    compiled = East.compile(East.function([], IntegerType, body), platform=[
        PlatformFunction(name="source", inputs=[], output=TABLE, type="sync", fn=lambda: hold),
        PlatformFunction(name="check", inputs=[TABLE], output=IntegerType, type="sync", fn=_check),
    ])
    assert compiled() == N + 7
    assert paged_value_is_hydrated(hold._east_c_paged) is False
    assert paged_value_ref_count(hold._east_c_paged) == 1
    hold = None
    gc.collect()
