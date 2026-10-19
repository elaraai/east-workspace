#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The profile's bridge split (#1357): a python platform function's entry in
east-c's profile carries what its calls spent on the bridge — converting the
arguments into python values, converting the result back — and how many
element-level crossings its body made (a row read from an East array, an
entry written to an East dict), so a bridge-bound function shows itself in a
run's own profile, under its own line."""

from __future__ import annotations

import re

from east.runtime._compiler_eastc import profile_finish, profile_start

from east import ArrayType, DictType, East, FloatType, StringType, StructType, coerce_to
from east.runtime.platform import platform_functions
from east.types.values import EastDict

RowType = StructType([("name", StringType), ("weight", FloatType)])


@East.platform_function(inputs=[ArrayType(RowType)], output=DictType(StringType, FloatType),
                        name="test.bridge_sum")
def bridge_sum(rows):
    """Reads every row across the bridge, and writes every result across it."""
    out = EastDict(StringType, FloatType)
    for row in rows:  # one crossing per row, its fields' gets with it
        out[row.get("name")] = row.get("weight") * 2.0  # one crossing per entry written
    return out


def _profile(capfd, rows_count: int) -> str:
    program = East.function([ArrayType(RowType)], DictType(StringType, FloatType),
                            lambda b, rows: bridge_sum(rows))
    run = East.compile(program, platform=platform_functions(__name__))
    rows = coerce_to([{"name": f"r{i}", "weight": float(i)} for i in range(rows_count)],
                     ArrayType(RowType))
    capfd.readouterr()
    assert profile_start(True)
    try:
        result = run(rows)
    finally:
        profile_finish()
    assert len(result) == rows_count and result["r3"] == 6.0
    return capfd.readouterr().err


def test_a_python_platform_function_reports_its_bridge(capfd):
    err = _profile(capfd, 100)
    lines = err.splitlines()
    entry = next((i for i, line in enumerate(lines) if "test.bridge_sum" in line), None)
    assert entry is not None, err
    assert " 1 calls " in lines[entry] and "platform function" in lines[entry], err
    bridge = lines[entry + 1]
    assert re.search(r"^\s+bridge\s+[\d.]+ s converting arguments\s+[\d.]+ s converting results"
                     r"\s+(\d+) element crossings$", bridge), err
    crossings = int(re.search(r"(\d+) element crossings", bridge).group(1))
    # 100 rows read and 100 entries written
    assert crossings >= 200, bridge


def test_the_crossings_grow_with_the_rows(capfd):
    def crossings(n: int) -> int:
        err = _profile(capfd, n)
        return int(re.search(r"(\d+) element crossings", err).group(1))

    assert crossings(40) - crossings(10) >= 60


def test_nothing_without_the_profiler(capfd):
    program = East.function([ArrayType(RowType)], DictType(StringType, FloatType),
                            lambda b, rows: bridge_sum(rows))
    run = East.compile(program, platform=platform_functions(__name__))
    rows = coerce_to([{"name": "a", "weight": 1.0}], ArrayType(RowType))
    capfd.readouterr()
    run(rows)
    profile_finish()
    assert "bridge" not in capfd.readouterr().err
