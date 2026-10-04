#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Importing east loads neither numpy nor asyncio (#1128).

Every east-py unit is a process of its own, so what ``import east`` loads is
paid once per unit: numpy came to 32 ms of a 65 ms import, and asyncio to
17 ms. numpy now loads where a value needs it: a Vector or a Matrix made, or
crossing to east-c through ``east._tensor_bridge``, the module that holds the
numpy C-API code, or a numpy column. asyncio loads where an async platform
function runs.

Each case runs a fresh interpreter, since this one has both loaded, and pins
which modules it holds rather than a clock (see conftest.py). Each result is
compared with ``equal_for``, which compares in python: ``East.equal`` runs in
east-c, so a value that crossed to east-c wrongly would reach it crossed the
same wrong way, and compare equal.
"""

import json
import subprocess
import sys


def _facts(script: str) -> dict:
    """The JSON object ``script`` prints last, run in a fresh interpreter."""
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=300, check=False)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.splitlines()[-1])


IMPORT = """
import json
import sys

import east

print(json.dumps({name: name in sys.modules for name in ("numpy", "asyncio", "east._tensor_bridge")}))
"""

# Every kind of value but a Vector and a Matrix, to east-c and back; a sync
# platform function; an Array built from list columns and extended, the paths
# that take numpy columns asking first whether numpy is loaded; and an Integer
# Array coerced, which asks whether its element could be a Vector's.
NO_TENSORS = """
import json
import sys
from datetime import UTC, datetime

from east import (ArrayType, BlobType, DateTimeType, DictType, East, EastArray, FloatType, IntegerType,
                  OptionType, SetType, StringType, StructType, coerce_to, equal_for, some)

Row = StructType([("id", IntegerType), ("name", StringType)])
Everything = StructType([
    ("rows", ArrayType(Row)),
    ("scores", DictType(StringType, FloatType)),
    ("tags", SetType(StringType)),
    ("at", DateTimeType),
    ("data", BlobType),
    ("maybe", OptionType(IntegerType)),
])


@East.platform_function(inputs=[IntegerType], output=IntegerType)
def bump(x):
    return x + 1


value = coerce_to({
    "rows": [{"id": 1, "name": "a"}, {"id": 2, "name": "b"}],
    "scores": {"a": 1.5, "b": 2},
    "tags": {"x", "y"},
    "at": datetime(2026, 10, 4, tzinfo=UTC),
    "data": b"east",
    "maybe": some(3),
}, Everything)
same = East.function([Everything], Everything, lambda _b, v: v)
count = East.compile(East.function([ArrayType(Row)], IntegerType, lambda _b, rows: bump(rows.size())),
                     platform=[bump.east_platform_function])
columns = EastArray.from_columns(Row, {"id": [3, 4], "name": ["c", "d"]})
columns.extend([{"id": 5, "name": "e"}])
ids = EastArray(IntegerType, [1, 2])
print(json.dumps({
    "round_trip": equal_for(Everything)(same(value), value),
    "rows_plus_one": count(value["rows"]),
    "columns": equal_for(ArrayType(Row))(columns, coerce_to(
        [{"id": 3, "name": "c"}, {"id": 4, "name": "d"}, {"id": 5, "name": "e"}], ArrayType(Row))),
    "ids": equal_for(ArrayType(IntegerType))(coerce_to(ids, ArrayType(IntegerType)), ids),
    **{name: name in sys.modules for name in ("numpy", "asyncio", "east._tensor_bridge")},
}))
"""

TENSORS = """
import json
import sys

from east import East, EastVector, FloatType, MatrixType, VectorType, coerce_to, equal_for

scale = East.function([VectorType(FloatType)], VectorType(FloatType), lambda _b, v: v.scale(2.0))
sums = East.function([MatrixType(FloatType)], VectorType(FloatType), lambda _b, m: m.row_sums())
facts = {"numpy_once_built": "numpy" in sys.modules}
vector = coerce_to([1.0, 2.5], VectorType(FloatType))
matrix = coerce_to([[1.0, 2.0], [3.0, 4.0]], MatrixType(FloatType))
facts["numpy_once_made"] = "numpy" in sys.modules
facts["bridge_before_crossing"] = "east._tensor_bridge" in sys.modules
same_vector = equal_for(VectorType(FloatType))
facts["scaled"] = same_vector(scale(vector), EastVector(FloatType, [2.0, 5.0]))
facts["row_sums"] = same_vector(sums(matrix), EastVector(FloatType, [3.0, 7.0]))
facts["bridge_once_crossed"] = "east._tensor_bridge" in sys.modules
facts["asyncio"] = "asyncio" in sys.modules
print(json.dumps(facts))
"""

ASYNC = """
import json
import sys

from east import East, IntegerType


@East.platform_function(inputs=[IntegerType], output=IntegerType)
def half(x):
    return x // 2


@East.platform_function(inputs=[IntegerType], output=IntegerType)
async def slow_double(x):
    return x * 2


facts = {"once_decorated": "asyncio" in sys.modules}
halve = East.compile(East.function([IntegerType], IntegerType, lambda _b, x: half(x)),
                     platform=[half.east_platform_function])
facts["sync_result"] = halve(10)
facts["once_a_sync_platform_function_ran"] = "asyncio" in sys.modules
run = East.compileAsync(East.asyncFunction([IntegerType], IntegerType, lambda _b, x: slow_double(x) + 1),
                        platform=[slow_double.east_platform_function])
pending = run(3)
facts["once_an_async_function_is_called"] = "asyncio" in sys.modules
# Driven by hand, so that only the platform bridge can import asyncio.
try:
    pending.send(None)
except StopIteration as done:
    facts["async_result"] = done.value
facts["once_an_async_platform_function_ran"] = "asyncio" in sys.modules
print(json.dumps(facts))
"""


def test_importing_east_loads_neither_numpy_nor_asyncio():
    assert _facts(IMPORT) == {"numpy": False, "asyncio": False, "east._tensor_bridge": False}


def test_a_program_with_no_vector_or_matrix_loads_neither():
    assert _facts(NO_TENSORS) == {
        "round_trip": True,
        "rows_plus_one": 3,
        "columns": True,
        "ids": True,
        "numpy": False,
        "asyncio": False,
        "east._tensor_bridge": False,
    }


def test_numpy_loads_with_a_vector_or_matrix_and_the_tensor_bridge_as_one_crosses():
    """Building a function over Vectors needs no numpy: making one does, and
    the tensor bridge is imported by the first that crosses to east-c."""
    assert _facts(TENSORS) == {
        "numpy_once_built": False,
        "numpy_once_made": True,
        "bridge_before_crossing": False,
        "scaled": True,
        "row_sums": True,
        "bridge_once_crossed": True,
        "asyncio": False,
    }


def test_asyncio_loads_when_an_async_platform_function_runs():
    """Not when one is decorated, which asks ``inspect`` whether it is async,
    nor when a sync one runs, nor when an async function is called: when the
    bridge is handed an async platform function's coroutine to run."""
    assert _facts(ASYNC) == {
        "once_decorated": False,
        "sync_result": 5,
        "once_a_sync_platform_function_ran": False,
        "once_an_async_function_is_called": False,
        "async_result": 7,
        "once_an_async_platform_function_ran": True,
    }
