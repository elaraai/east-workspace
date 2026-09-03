#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Function values crossing the python boundary (#476, items A–C).

Three boundary defects, each pinned by the round trip it used to break:

- ``compile_from_value`` attached ``_east_ir = None`` — the IR it was
  literally given — so east-py could not serialize its own compiled functions
  ("Cannot serialize function: no IR attached").
- The eager funnel invoked builtin impls with no thread context installed.
  A builtin that CONSTRUCTS function values (``BlobDecodeBeast2``) wires
  them to the thread-current registries, so decoded functions captured NULL
  and segfaulted on first call.
- ``type_of`` refused every callable, even though east-py function-ish
  objects all carry their declared signature.
"""

from east.runtime._compiler_eastc import call_builtin

from east import (
    BlobType,
    East,
    EastArray,
    FunctionType,
    IntegerType,
    type_of,
)
from east.expression import trace
from east.runtime.compiler import compile_from_value
from east.types.values.structural import EastFunction

FT = FunctionType([IntegerType], IntegerType)


def test_compile_from_value_attaches_the_source_ir():
    ir, _, _binds = trace(lambda _b, x: x + 1, [IntegerType])
    fn = compile_from_value(ir)
    assert fn._east_ir is ir


def test_a_compiled_function_round_trips_through_beast2():
    ir, _, _binds = trace(lambda _b, x: x + 1, [IntegerType])
    fn = compile_from_value(ir)
    blob = call_builtin("BlobEncodeBeast2", [FT], [fn], BlobType)
    assert len(blob.data) > 0
    back = call_builtin("BlobDecodeBeast2", [FT], [blob], FT)
    # The decoded function must be callable — the funnel installs its
    # registries as the thread context for the decode, so the reconstructed
    # function is wired to a live builtin registry, not NULL.
    assert back(41) == 42


def test_a_function_round_trips_through_beast2():
    k = East.function([IntegerType], IntegerType, lambda _b, x: x * 2)
    assert k._east_ir is not None
    blob = call_builtin("BlobEncodeBeast2", [FT], [k], BlobType)
    back = call_builtin("BlobDecodeBeast2", [FT], [blob], FT)
    assert back(21) == 42


def test_type_of_reads_declared_function_signatures():
    # An EastFunction declares its signature directly.
    ef = EastFunction(lambda _b, x: x + 1, [IntegerType], IntegerType)
    assert type_of(ef) == FT

    # A compiled function exposes it via its handle.
    ir, _, _binds = trace(lambda _b, x: x + 1, [IntegerType])
    fn = compile_from_value(ir)
    assert type_of(fn) == FT

    # A decoded C function wrapper carries it C-side (before AND after the
    # lazy first call — the two read different fields).
    blob = call_builtin("BlobEncodeBeast2", [FT], [fn], BlobType)
    back = call_builtin("BlobDecodeBeast2", [FT], [blob], FT)
    assert type_of(back) == FT
    back(1)
    assert type_of(back) == FT


def test_functions_stored_in_an_array_call_correctly():
    # A function in a value slot must cross as a REAL closure. The encode-only
    # carrier's `ir` is the Function node itself, so calling it evaluated the
    # node into a fresh closure value and union-read it as the output type —
    # a pointer-sized integer where 6 belongs (#476 D).
    arr = EastArray(FT, [
        East.function([IntegerType], IntegerType, lambda _b, x: x * 2),
        East.function([IntegerType], IntegerType, lambda _b, x: x * 3),
    ])
    assert arr[0](3) == 6
    assert arr[1](3) == 9
