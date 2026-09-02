#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The cross-language compliance stem (#628): the same programs authored in
TypeScript (``libs/east/test/crosslang.examples.ts``) and in python, here,
construct for construct — the two builders must produce the same IR under
``east-c ir normalize``, and both programs must compute the example's
declared ``returns`` on east-c.

The TypeScript side is read from the exported examples
(``/tmp/east-examples-ir/crosslang``, ``npm run export:examples`` in
libs/east); without it the stem SKIPS, and under
``EAST_CONFORMANCE_REQUIRED=1`` (CI) a missing export is a collection error
(``test_ts_py_roundtrip`` raises it first).
"""

from __future__ import annotations

import json
import os

import pytest
from east.runtime._compiler_eastc import diff_ir

from east import East
from east.functions import function_ir
from east.runtime.compiler import compile_from_value
from east.serialization.json import decode_json_for
from east.types.type_of_type import EastTypeType
from east.types.types import (
    ArrayType,
    DictType,
    FloatType,
    IntegerType,
    SetType,
    StringType,
    StructType,
    VariantType,
)
from east.utils.ordering import equal_for
from tests.conformance.test_ts_py_roundtrip import EXAMPLES_DIR, _load

# ── the python twins ─────────────────────────────────────────────────────────

arithmetic = East.function(
    [IntegerType, FloatType], FloatType,
    lambda b, n, x: (n * 2 + 1).to_float() * x - 0.5)


@East.function([ArrayType(IntegerType)], IntegerType)
def statements(b, xs):
    total = b.let(0)

    def step(b, x):
        b.if_(x > 2, lambda b: b.assign(total, total + x))

    b.for_(xs, step)
    return total


callbacks = East.function(
    [ArrayType(IntegerType)], IntegerType,
    lambda b, xs: xs.filter(lambda b, x: x.remainder(2) == 0)
    .map(lambda b, x: x * x)
    .reduce(lambda b, acc, x: acc + x, 0))

Person = StructType([("name", StringType), ("age", IntegerType)])

struct_if_else = East.function(
    [Person], StringType,
    lambda b, p: East.if_else(p.age < 18, p.name.concat(" (minor)"), p.name))

Shape = VariantType([("circle", FloatType), ("square", FloatType)])

variant_match = East.function(
    [Shape], FloatType,
    lambda b, s: s.match({
        "circle": lambda b, r: r * r * 3.0,
        "square": lambda b, w: w * w,
    }))

dict_set = East.function(
    [DictType(StringType, IntegerType), SetType(StringType)], IntegerType,
    lambda b, d, keys: keys.reduce(lambda b, acc, k: acc + d.get(k, lambda b, _k: 0), 0))

strings_datetime = East.function(
    [StringType, IntegerType], IntegerType,
    lambda b, s, ms: s.upper_case().length() + East.DateTime.from_epoch_milliseconds(ms).get_year())


@East.function([ArrayType(IntegerType)], IntegerType)
def try_catch(b, xs):
    r = b.let(0)
    b.try_(lambda b: b.assign(r, xs.get(99))).catch(lambda b, _message, _stack: b.assign(r, -1))
    return r


@East.function([IntegerType], IntegerType)
def while_loop(b, n):
    i = b.let(0)
    acc = b.let(0)

    def body(b, label):
        b.assign(i, i + 1)
        b.if_(i == 3, lambda b: b.continue_(label))
        b.assign(acc, acc + i)

    b.while_(i < n, body)
    return acc


STEM = {
    "crosslangArithmetic": arithmetic,
    "crosslangStatements": statements,
    "crosslangCallbacks": callbacks,
    "crosslangStructIfElse": struct_if_else,
    "crosslangVariantMatch": variant_match,
    "crosslangDictSet": dict_set,
    "crosslangStringsDatetime": strings_datetime,
    "crosslangTryCatch": try_catch,
    "crosslangWhile": while_loop,
}

STEM_DIR = os.path.join(EXAMPLES_DIR, "crosslang")


@pytest.mark.skipif(not os.path.isdir(STEM_DIR), reason=f"no exported crosslang examples in {STEM_DIR}")
@pytest.mark.parametrize("name", list(STEM))
def test_same_program_same_ir_same_result(name):
    raw, ts_ir = _load(os.path.join(STEM_DIR, f"{name}.json"))
    py_fn = STEM[name]
    py_ir = function_ir(py_fn)
    diff = diff_ir(ts_ir, py_ir)
    assert diff is None, f"{name}: the TypeScript and python builds differ at {diff}"

    input_types = [decode_json_for(EastTypeType)(json.dumps(t)) for t in raw["input_types"]]
    output_type = decode_json_for(EastTypeType)(json.dumps(raw["output_type"]))
    inputs = [decode_json_for(t)(json.dumps(v)) for t, v in zip(input_types, raw["inputs"], strict=True)]
    expected = decode_json_for(output_type)(json.dumps(raw["returns"]))
    same = equal_for(output_type)
    assert same(compile_from_value(ts_ir, [])(*inputs), expected), f"{name}: the TypeScript build computes a different value"
    assert same(py_fn(*inputs), expected), f"{name}: the python build computes a different value"


def test_every_exported_stem_example_has_a_python_twin():
    if not os.path.isdir(STEM_DIR):
        pytest.skip(f"no exported crosslang examples in {STEM_DIR}")
    exported = sorted(f[:-5] for f in os.listdir(STEM_DIR) if f.endswith(".json"))
    assert exported == sorted(STEM), "every TypeScript stem example needs its python twin here"
