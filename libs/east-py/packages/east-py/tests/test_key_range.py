#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A key range of a Dict or a Set (#1616): ``range(from_=…, to=…)`` and
``prefix(fields)`` on the python surface.

The compliance corpus holds what a range gives, on every runtime
(``Key_ranges.json``, replayed through this surface by
``test_compliance_eager.py``). Pinned here is what is python's own: how a
bound is written, the refusals — east-c's words, the ones TypeScript refuses
in — where a value is read and where a function is built, the analyzer's
check of an IR made by hand, and the printer's spelling, which rebuilds the
IR it printed.
"""

from __future__ import annotations

import pytest
from east.runtime._compiler_eastc import diff_ir

from east import (
    DictType,
    East,
    EastDict,
    EastSet,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    StructType,
)
from east.codegen import to_python_source
from east.expression.errors import ExpressionError
from east.ir.analyze import IRAnalysisError, analyze_ir
from east.ir.builders import ir_builtin, ir_function, ir_value, ir_variable, ir_variant
from east.key_bound import key_bound_refusal, written_bound_type
from east.types.coercion import EastTypeError
from east.types.types import FunctionType, NullType

# Sheets printed, keyed by press and job; a nested key as an index's is.
Key = StructType([("press", StringType), ("job", IntegerType)])
On = StructType([("hall", StringType), ("press", StringType)])
Indexed = StructType([("ik", StructType([("on", On), ("key", StringType)])), ("k", StringType)])
Sheets = DictType(Key, IntegerType)

ROWS = [("P1", 1), ("P1", 2), ("P2", 3), ("P2", 4), ("P2", 5), ("P3", 6)]

NO_LEADING = "is no leading part of the key: a bound gives the key's first fields in order — press, job"


def sheets() -> EastDict:
    d = EastDict(Key, IntegerType)
    for press, job in ROWS:
        d[{"press": press, "job": job}] = job * 100
    return d


def sheet_set() -> EastSet:
    s = EastSet(Key)
    for press, job in ROWS:
        s.add({"press": press, "job": job})
    return s


def jobs(collection) -> list[int]:
    return [key["job"] for key in collection]


# ── how a bound is written ───────────────────────────────────────────────────


def test_a_bound_is_typed_as_the_key_cut_short_to_the_fields_written():
    assert written_bound_type(Key, {"press": "P1"}) == StructType([("press", StringType)])
    # the fields in the key's order, however the dict lists them
    assert written_bound_type(Key, {"job": 1, "press": "P1"}) == Key
    # only the last field given is cut short, the same way
    assert written_bound_type(Indexed, {"ik": {"on": {"hall": "H1"}}}) == StructType(
        [("ik", StructType([("on", StructType([("hall", StringType)]))]))])
    assert written_bound_type(Indexed, {"ik": {"on": {"hall": "H1", "press": "P1"}, "key": "a"}, "k": "x"}) == Indexed
    # a key that is not a struct is bounded by its own type
    assert written_bound_type(StringType, "b") == StringType
    # fields that are not the key's first have no type
    assert written_bound_type(Key, {"job": 1}) is None
    assert written_bound_type(Key, {}) is None
    assert written_bound_type(Indexed, {"ik": {"on": {"hall": "H1"}}, "k": "x"}) is None


def test_a_refusal_is_east_cs_words():
    assert key_bound_refusal("from", Key, StructType([("press", StringType)])) is None
    assert key_bound_refusal("from", Key, None) == f"a range's `from` {NO_LEADING}"
    assert key_bound_refusal("to", Key, StructType([("job", IntegerType)])) == f"a range's `to` {NO_LEADING}"
    assert key_bound_refusal("prefix", Key, StructType([("job", IntegerType)])) == f"a prefix {NO_LEADING}"
    assert key_bound_refusal("to", StringType, IntegerType) == (
        "a range's `to` is not the key's type: a bound of a String key is a String")
    assert key_bound_refusal("prefix", StringType, StringType) == (
        "a prefix gives the first fields of a struct key, and this key is a String: "
        "read one key with `get`, or the keys between two with `range`")
    assert key_bound_refusal("from", Indexed, StructType([("k", StringType)])) == (
        "a range's `from` is no leading part of the key: a bound gives the key's first "
        "fields in order — ik.on.hall, ik.on.press, ik.key, k")
    with pytest.raises(ValueError, match="'from', 'to' or 'prefix'"):
        key_bound_refusal("until", Key, Key)


# ── on values ────────────────────────────────────────────────────────────────


def test_a_range_of_a_dict_and_of_a_set_on_values():
    d, s = sheets(), sheet_set()
    assert jobs(d.prefix({"press": "P2"})) == [3, 4, 5]
    assert jobs(s.prefix({"press": "P2"})) == [3, 4, 5]
    assert jobs(d.range(from_={"press": "P2"}, to={"press": "P3"})) == [3, 4, 5]
    assert jobs(d.range(from_={"job": 4, "press": "P2"})) == [4, 5, 6]
    assert jobs(s.range(to={"press": "P2"})) == [1, 2]
    assert jobs(d.range()) == [1, 2, 3, 4, 5, 6]
    assert jobs(d.range(from_={"press": "P3"}, to={"press": "P1"})) == []
    # a bound that is a struct value, and one the key's own type on a plain key
    assert jobs(d.range(from_=next(iter(d.range(from_={"press": "P3"}))))) == [6]
    names = EastSet(StringType)
    for name in ("a", "b", "c"):
        names.add(name)
    assert list(names.range(from_="b")) == ["b", "c"]
    assert list(names.range(from_="b", to="c")) == ["b"]
    # the values are the source's
    assert dict(d.prefix({"press": "P1"}).items()) == {k: v for k, v in d.items() if k["press"] == "P1"}


def test_a_range_is_a_new_collection():
    d = sheets()
    part = d.range(from_={"press": "P2"})
    part[{"press": "P9", "job": 9}] = 1
    part.delete({"press": "P2", "job": 3})
    assert len(part) == 4 and len(d) == 6
    whole = d.range()
    whole.clear()
    assert len(d) == 6


def test_a_bound_that_is_no_leading_part_is_refused_on_values():
    d, s = sheets(), sheet_set()
    with pytest.raises(EastTypeError) as from_error:
        d.range(from_={"job": 1})
    assert str(from_error.value) == f"a range's `from` {NO_LEADING}"
    with pytest.raises(EastTypeError) as to_error:
        s.range(to={"job": 1})
    assert str(to_error.value) == f"a range's `to` {NO_LEADING}"
    with pytest.raises(EastTypeError) as prefix_error:
        d.prefix({"job": 1})
    assert str(prefix_error.value) == f"a prefix {NO_LEADING}"
    names = EastSet(StringType)
    with pytest.raises(EastTypeError, match="this key is a String: read one key with `get`"):
        names.prefix("a")


# ── in a function ────────────────────────────────────────────────────────────


def test_a_range_and_a_prefix_in_a_function():
    count = East.function(
        [Sheets, StringType], IntegerType,
        lambda b, d, press: d.range(from_={"press": press}, to={"press": "P3"}).size())
    assert East.compile(count)(sheets(), "P2") == 3
    of_press = East.function([SetType(Key), StringType], SetType(Key), lambda b, s, press: s.prefix({"press": press}))
    assert jobs(East.compile(of_press)(sheet_set(), "P1")) == [1, 2]
    # a range of a range, and a traced bound against a captured collection
    narrowed = East.function(
        [Sheets], IntegerType, lambda b, d: d.prefix({"press": "P2"}).range(from_={"press": "P2", "job": 4}).size())
    assert East.compile(narrowed)(sheets()) == 2
    captured = sheets()
    held = East.function([StringType], IntegerType, lambda b, press: captured.prefix({"press": press}).size())
    assert East.compile(held)("P2") == 3


def _range_node(fn) -> tuple:
    """``(builtin name, type parameters, arguments)`` of the one range call a function's body is."""
    body = fn._east_ir.value["body"]
    return body.value["builtin"], list(body.value["type_parameters"]), list(body.value["arguments"])


def test_a_bounds_type_is_a_type_parameter_and_an_end_left_out_is_none_at_the_keys_type():
    fn = East.function([Sheets], Sheets, lambda b, d: d.range(from_={"press": "P2"}))
    name, tps, args = _range_node(fn)
    assert name == "DictRange"
    assert tps == [Key, IntegerType, StructType([("press", StringType)]), Key]
    assert args[1].value["case"] == "some" and args[1].value["type"] == OptionType(StructType([("press", StringType)]))
    assert args[2].value["case"] == "none" and args[2].value["type"] == OptionType(Key)
    fn = East.function([SetType(Key)], SetType(Key), lambda b, s: s.prefix({"press": "P2"}))
    name, tps, _args = _range_node(fn)
    assert name == "SetPrefix" and tps == [Key, StructType([("press", StringType)])]


def test_a_bound_that_is_no_leading_part_is_refused_where_the_function_is_built():
    with pytest.raises(ExpressionError) as from_error:
        East.function([Sheets], Sheets, lambda b, d: d.range(from_={"job": 1}))
    assert f"a range's `from` {NO_LEADING}" in str(from_error.value)
    with pytest.raises(ExpressionError) as prefix_error:
        East.function([SetType(Key)], SetType(Key), lambda b, s: s.prefix({"job": 1}))
    assert f"a prefix {NO_LEADING}" in str(prefix_error.value)
    with pytest.raises(ExpressionError, match="this key is a String: read one key with `get`"):
        East.function([SetType(StringType)], SetType(StringType), lambda b, s: s.prefix("a"))
    # an expression of a struct that is no leading part
    with pytest.raises(ExpressionError) as expr_error:
        East.function(
            [Sheets, StructType([("job", IntegerType)])], Sheets, lambda b, d, bound: d.range(to=bound))
    assert f"a range's `to` {NO_LEADING}" in str(expr_error.value)


# ── the analyzer, over an IR made by hand ────────────────────────────────────


def _by_hand(name: str, type_parameters: list, argument_types: list, out=Sheets) -> object:
    """A function of one Dict that calls a range builtin with these type parameters; each argument
    after the Dict is ``none`` at its type, or a null of a type that is no option."""
    d = ir_variable(Sheets, "d", 1)
    arguments = [d]
    for t in argument_types:
        if t.type == "Variant":
            arguments.append(ir_variant(t, "none", ir_value(NullType, None, 1), 1))
        else:
            arguments.append(ir_value(NullType, None, 1))
    call = ir_builtin(out, name, type_parameters, arguments, 7)
    return ir_function(FunctionType([Sheets], out), [], [ir_variable(Sheets, "d", 1)], call, 1)


def test_the_analyzer_refuses_a_bound_type_that_is_no_leading_part():
    job_only = StructType([("job", IntegerType)])
    analyze_ir(_by_hand("DictRange", [Key, IntegerType, Key, Key], [OptionType(Key), OptionType(Key)]))
    with pytest.raises(IRAnalysisError) as from_error:
        analyze_ir(_by_hand("DictRange", [Key, IntegerType, job_only, job_only],
                            [OptionType(job_only), OptionType(job_only)]))
    assert str(from_error.value) == f"Builtin function 'DictRange': a range's `from` {NO_LEADING} at loc_id 7"
    with pytest.raises(IRAnalysisError) as to_error:
        analyze_ir(_by_hand("DictRange", [Key, IntegerType, Key, job_only], [OptionType(Key), OptionType(job_only)]))
    assert str(to_error.value) == f"Builtin function 'DictRange': a range's `to` {NO_LEADING} at loc_id 7"
    with pytest.raises(IRAnalysisError) as prefix_error:
        analyze_ir(_by_hand("DictPrefix", [Key, IntegerType, job_only], [NullType]))
    assert str(prefix_error.value) == f"Builtin function 'DictPrefix': a prefix {NO_LEADING} at loc_id 7"


def test_the_analyzer_holds_a_range_call_to_its_type_parameters():
    with pytest.raises(IRAnalysisError, match="Builtin function 'DictRange' takes 4 type parameters, got 3 at loc_id 7"):
        analyze_ir(_by_hand("DictRange", [Key, IntegerType, Key], [OptionType(Key), OptionType(Key)]))
    press_only = StructType([("press", StringType)])
    with pytest.raises(IRAnalysisError) as argument_error:
        analyze_ir(_by_hand("DictRange", [Key, IntegerType, press_only, Key], [OptionType(Key), OptionType(Key)]))
    assert "Builtin function 'DictRange': its `from` is of type" in str(argument_error.value)
    assert "but its type parameters say" in str(argument_error.value)
    with pytest.raises(IRAnalysisError) as collection_error:
        analyze_ir(_by_hand("DictRange", [StringType, IntegerType, StringType, StringType],
                            [OptionType(StringType), OptionType(StringType)]))
    assert "Builtin function 'DictRange': its type parameters say" in str(collection_error.value)
    assert "but its first argument is of type" in str(collection_error.value)


# ── the printer ──────────────────────────────────────────────────────────────


def _rebuilt(fn) -> object:
    namespace: dict = {}
    exec(compile(to_python_source(fn), "<printed>", "exec"), namespace)  # noqa: S102 - the printer's own output
    return namespace["main"]


def test_a_range_prints_as_the_surface_writes_it_and_rebuilds_its_ir():
    fn = East.function(
        [Sheets, SetType(StringType), StringType], IntegerType,
        lambda b, d, names, press: d.range(from_={"press": press}, to={"press": "P3"}).size()
        + d.prefix({"press": press}).size()
        + d.range(to={"job": 2, "press": "P1"}).size()
        + names.range(from_="b").size()
        + d.range().size())
    source = to_python_source(fn)
    assert "d.range(from_={'press': press}, to={'press': 'P3'})" in source
    assert "d.prefix({'press': press})" in source
    assert "d.range(to={'press': 'P1', 'job': 2})" in source
    assert "names.range(from_='b')" in source
    assert "d.range()" in source
    assert "East.builtin" not in source
    assert diff_ir(fn._east_ir, _rebuilt(fn)._east_ir) is None


def test_an_end_held_as_an_option_prints_raw_and_rebuilds():
    # An end that is not `some(…)` or `none` where it stands has no keyword to print under.
    fn = East.function(
        [Sheets, OptionType(Key)], Sheets,
        lambda b, d, end: East.builtin("DictRange", [Key, IntegerType, Key, Key], [d, end, end], Sheets))
    source = to_python_source(fn)
    assert "East.builtin" in source and ".range(" not in source
    assert diff_ir(fn._east_ir, _rebuilt(fn)._east_ir) is None
