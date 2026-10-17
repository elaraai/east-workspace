#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A body's keyed calls and calls of East functions are held to their
arguments' declared types at build (#1316) — the expression-surface twin of
#534.

A keyed Dict or Set builtin carries the collection's key and value types as
its type parameters, and east-c reads its arguments as those types: a key or
value of another type answered as if absent, stored garbage, or segfaulted
the process when the function ran. A call of an East function inside a body
re-ran the callee's body on whatever it was handed, building a function of
other types than the callee's, whose writes reached the runtime unchecked.
Each is now refused where it is written, naming the method, or the function
and its parameter; an argument of a subtype is widened to its slot, as the
TypeScript builder widens one. The one argument of another type a call still
takes is the column projection's narrowed row (#467), which
``tests/serialization/test_beast2_projection.py`` runs end to end.
"""

import pytest

from east import (
    ArrayType,
    BooleanType,
    DictType,
    East,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
)
from east.expression import ExpressionError
from east.types.types import is_type_equal

D = DictType(StringType, IntegerType)
S = SetType(StringType)
Row = StructType([("name", StringType)])
AB = VariantType([("a", IntegerType), ("b", StringType)])
A = VariantType([("a", IntegerType)])


@East.function([StringType], Row)
def wrap(b, name):
    return {"name": name}


def _refusal(build) -> str:
    with pytest.raises(ExpressionError) as raised:
        build()
    return str(raised.value)


# ─── keyed Dict reads ────────────────────────────────────────────────────────


@pytest.mark.parametrize(("op", "out", "read"), [
    ("has", BooleanType, lambda _b, d: d.has(7)),
    ("get", IntegerType, lambda _b, d: d.get(7)),
    ("get", IntegerType, lambda _b, d: d[7]),
    ("try_get", OptionType(IntegerType), lambda _b, d: d.try_get(7)),
    ("get_or_default", IntegerType, lambda _b, d: d.get_or_default(7, -1)),
])
def test_a_dict_read_refuses_a_key_of_another_type(op, out, read):
    # each answered as if the key were absent: False, none, the default
    assert _refusal(lambda: East.function([D], out, read)) == \
        f".{op}() takes String, got Integer"


def test_a_dict_default_of_another_type_is_refused():
    assert _refusal(lambda: East.function(
        [D], IntegerType, lambda _b, d: d.get_or_default("7", "absent"))) == \
        ".get_or_default() takes Integer, got String"


def test_dict_reads_of_the_key_type_still_answer():
    assert East.function([D], BooleanType, lambda _b, d: d.has("7"))({"7": 1}) is True
    assert East.function([D], IntegerType, lambda _b, d: d["7"])({"7": 1}) == 1
    assert East.function([D], OptionType(IntegerType), lambda _b, d: d.try_get("7"))(
        {"7": 1}) == some(1)
    assert East.function([D], OptionType(IntegerType), lambda _b, d: d.try_get("8"))(
        {"7": 1}) == none
    assert East.function([D], IntegerType, lambda _b, d: d.get_or_default("8", -1))(
        {"7": 1}) == -1


# ─── keyed Dict writes ───────────────────────────────────────────────────────


def _dict_write(write):
    def body(b):
        d = b.const(East.new_dict(StringType, IntegerType))
        b.do(write(d))
        return d
    return East.function([], D, body)


@pytest.mark.parametrize(("message", "write"), [
    # a key of another type segfaulted when the function ran
    (".insert() takes String, got Integer", lambda d: d.insert(7, 1)),
    # a value of another type stored its address as the Integer
    (".insert() takes Integer, got String", lambda d: d.insert("a", "not an integer")),
    (".insert_or_update() takes String, got Integer",
     lambda d: d.insert_or_update(7, 1, lambda _b, x, y, _k: x + y)),
    (".insert_or_update() takes Integer, got String",
     lambda d: d.insert_or_update("a", "one", lambda _b, x, y, _k: x + y)),
    (".delete() takes String, got Integer", lambda d: d.delete(7)),
    (".try_delete() takes String, got Integer", lambda d: d.try_delete(7)),
])
def test_a_dict_write_refuses_a_key_or_value_of_another_type(message, write):
    assert _refusal(lambda: _dict_write(write)) == message


def test_dict_writes_of_the_declared_types_still_run():
    def body(b):
        d = b.const(East.new_dict(StringType, IntegerType))
        b.do(d.insert("a", 1))
        b.do(d.insert_or_update("a", 2, lambda _b, x, y, _k: x + y))
        b.do(d.insert("b", 5))
        b.do(d.delete("b"))
        b.do(d.try_delete("c"))
        return d
    assert dict(East.function([], D, body)().items()) == {"a": 3}


# ─── keyed Set reads and writes ──────────────────────────────────────────────


def test_a_set_read_refuses_an_element_of_another_type():
    assert _refusal(lambda: East.function([S], BooleanType, lambda _b, s: s.has(7))) == \
        ".has() takes String, got Integer"


@pytest.mark.parametrize("op", ["insert", "try_insert", "delete", "try_delete"])
def test_a_set_write_refuses_an_element_of_another_type(op):
    def body(b):
        s = b.const(East.new_set(StringType))
        b.do(getattr(s, op)(7))
        return s
    assert _refusal(lambda: East.function([], S, body)) == f".{op}() takes String, got Integer"


def test_set_reads_and_writes_of_the_element_type_still_run():
    assert East.function([S], BooleanType, lambda _b, s: s.has("7"))({"7"}) is True

    def body(b):
        s = b.const(East.new_set(StringType))
        b.do(s.insert("a"))
        b.do(s.try_insert("b"))
        b.do(s.delete("b"))
        b.do(s.try_delete("c"))
        return s
    assert list(East.function([], S, body)()) == ["a"]


# ─── a subtype widens; one kind of two types writes both out ─────────────────


def test_a_key_of_a_subtype_is_widened_to_the_key_type():
    # a variant of fewer cases is a value of the key type, as TypeScript takes it
    def body(b, n):
        d = b.const(East.new_dict(AB, IntegerType))
        b.do(d.insert(variant("a", 1), 5))
        return d.has(East.value(variant("a", n), A))
    has = East.function([IntegerType], BooleanType, body)
    assert has(1) is True
    assert has(2) is False


def test_a_refusal_between_two_types_of_one_kind_writes_both_out():
    # `.has() takes Struct, got Struct` would name neither
    assert _refusal(lambda: East.function(
        [DictType(Row, IntegerType)], BooleanType, lambda _b, d: d.has({"name": 7}))) == \
        '.has() takes .Struct [(name="name", type=.String)], ' \
        'got .Struct [(name="name", type=.Integer)]'


# ─── calls of East functions ─────────────────────────────────────────────────


def test_a_call_refuses_an_argument_of_another_type():
    # it was accepted, and failed at the next reader: `.push_last() takes
    # Struct, got Struct`, naming neither the call nor the argument
    def caller(b, n):
        out = b.const(East.new_array(Row))
        b.do(out.push_last(wrap(n)))
        return out
    assert _refusal(lambda: East.function([IntegerType], ArrayType(Row), caller)) == \
        "wrap(): parameter 'name' takes String, got Integer"


def test_a_call_whose_body_writes_is_refused_before_it_reaches_the_runtime():
    # built, `caller` segfaulted when it ran, with no message
    holder = DictType(IntegerType, Row)

    @East.function([holder, StringType], IntegerType)
    def store(b, d, name):
        b.do(d.insert(d.size(), {"name": name}))
        return d.size()

    def caller(b, n):
        d = b.const(East.new_dict(IntegerType, Row))
        b.do(store(d, n))
        return d
    assert _refusal(lambda: East.function([IntegerType], holder, caller)) == \
        "store(): parameter 'name' takes String, got Integer"

    def literal(b, _n):
        d = b.const(East.new_dict(IntegerType, Row))
        b.do(store(d, 5))
        return d
    assert _refusal(lambda: East.function([IntegerType], holder, literal)) == \
        "store(): parameter 'name' takes String, got Integer"


def test_a_call_names_an_anonymous_function_by_its_builder():
    tag = East.function([StringType], Row, lambda _b, name: {"name": name})
    assert _refusal(lambda: East.function([IntegerType], Row, lambda _b, n: tag(n))) == \
        "East.function: parameter 'name' takes String, got Integer"


def test_a_call_with_too_few_arguments_is_refused():
    pair = East.function([StringType, StringType], StringType, lambda _b, a, c: a + c)
    assert _refusal(lambda: East.function([StringType], StringType, lambda _b, s: pair(s))) == \
        "East.function takes 2 argument(s), called with 1"


def test_a_struct_of_fewer_fields_than_the_parameter_is_refused():
    # the body reads only `left`, so re-running it against the narrower
    # struct built; a struct is let through only as the projection's
    # narrowed row
    wide = StructType([("left", IntegerType), ("right", StringType)])

    @East.function([wide], IntegerType)
    def left_of(b, r):
        return r.left

    def caller(b, n):
        narrower = b.const({"left": n})
        return left_of(narrower)

    assert _refusal(lambda: East.function([IntegerType], IntegerType, caller)) == \
        "left_of(): parameter 'r' takes .Struct [(name=\"left\", type=.Integer), " \
        "(name=\"right\", type=.String)], got .Struct [(name=\"left\", type=.Integer)]"


def test_the_projections_narrowed_row_is_let_through_to_a_helper():
    # a callback run on a masked decode hands its helpers the narrow row;
    # their bodies re-run against it (#467)
    from east.expression.project import WHOLE_MASK, narrow_type_for

    wide = StructType([("kept", IntegerType), ("skipped", StringType)])
    narrow = narrow_type_for(wide, {"kept": WHOLE_MASK})

    @East.function([wide], IntegerType)
    def kept_of(b, r):
        return r.kept

    assert East.function([narrow], IntegerType, lambda _b, r: kept_of(r) + 1)({"kept": 4}) == 5


def test_a_call_of_the_declared_types_runs_and_is_of_the_declared_output():
    seen = []

    def caller(b, s):
        call = wrap(s)
        seen.append(call.east_type)
        return call
    built = East.function([StringType], Row, caller)
    assert is_type_equal(seen[0], Row)
    assert built("x")["name"] == "x"


def test_an_argument_of_a_subtype_is_widened_to_its_parameter():
    @East.function([AB], IntegerType)
    def a_or_zero(b, v):
        return v.match({"a": lambda _b, x: x, "b": lambda _b, _s: 0})

    built = East.function(
        [IntegerType], IntegerType, lambda _b, n: a_or_zero(East.value(variant("a", 1), A)) + n)
    assert built(2) == 3
