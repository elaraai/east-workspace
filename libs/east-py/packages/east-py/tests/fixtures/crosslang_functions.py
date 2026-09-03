#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""python-authored functions the TypeScript cross-import spec imports (#628).

Their manifest is checked in at ``libs/east/test/fixtures/py-functions.beast2``
(``EAST_UPDATE_FIXTURES=1 pytest tests/conformance/test_cross_import.py``
rewrites it; the test otherwise asserts the file still matches these
functions). Pure functions only — no platform calls to provide.
"""

from __future__ import annotations

from east import East
from east.types.types import ArrayType, FloatType, IntegerType, StringType, StructType

Row = StructType([("qty", IntegerType), ("price", FloatType)])

score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * r.price)

total = East.function(
    [ArrayType(Row)], FloatType,
    lambda b, rows: rows.map(lambda b, r: score(r)).reduce(lambda b, acc, x: acc + x, 0.0))

greet = East.function(
    [StringType, IntegerType], StringType,
    lambda b, name, times: name.concat("!").repeat(times))

east_functions = {"score": score, "total": total, "greet": greet}
