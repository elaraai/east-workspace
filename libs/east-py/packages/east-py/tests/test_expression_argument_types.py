#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A body's builtin calls and calls of East functions are held to their
arguments' declared types at build (#1316) — the expression-surface twin of
#534.

A builtin carries its arguments' types as its type parameters, and east-c
reads each argument as its declared input: a Dict key or value of another
type answered as if absent, stored garbage, or segfaulted the process when
the function ran. A call of an East function inside a body re-ran the
callee's body on whatever it was handed, building a function of other types
than the callee's, whose writes reached the runtime unchecked. Each is now
refused where it is written, naming the method, the builtin, or the function
and its parameter; an argument of a subtype is widened to its slot, as the
TypeScript builder widens one. The one argument of another type a call still
takes is a row of the column projection's narrowed decode (#467), while that
decode runs.
"""

import pytest

from east import (
    ArrayType,
    BooleanType,
    DictType,
    East,
    EastArray,
    FloatType,
    FunctionType,
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
from east.runtime.compiler import eager_stats
from east.serialization.beast2 import open_beast2_file
from east.types.types import is_type_equal
from tests.segments import write_in_segments

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


def test_a_call_with_too_many_arguments_is_refused():
    # the extras were dropped without a word: wrap(s, 99) built wrap(s)
    assert _refusal(lambda: East.function([StringType], Row, lambda _b, s: wrap(s, 99))) == \
        "wrap() takes 1 argument(s), called with 2"
    zero = East.function([], IntegerType, lambda _b: 7)
    assert _refusal(lambda: East.function([IntegerType], IntegerType, lambda _b, n: zero(n))) == \
        "East.function takes 0 argument(s), called with 1"


def test_a_callback_slot_still_hands_a_function_the_prefix():
    # ArrayMap's callback signature is (element, index): a function of one
    # parameter takes the element alone, as the eager arity adapter does
    def caller(b, names):
        return names.map(wrap)
    built = East.function([ArrayType(StringType)], ArrayType(Row), caller)
    assert [r["name"] for r in built(["x", "y"])] == ["x", "y"]


def test_a_struct_of_fewer_fields_than_the_parameter_is_refused():
    # the body reads only `left`, so re-running it against the narrower
    # struct built; a struct is let through only as a projected decode's
    # narrowed row, while that decode runs
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


def test_a_bound_function_value_still_reaches_the_body():
    # a .bind result has no IR to embed, so the callee's body re-runs and
    # its call of the value lowers to a Call of it (#561)
    add = East.function([IntegerType, IntegerType], IntegerType, lambda _b, x, y: x + y)
    inc = add.bind(1)

    @East.function([FunctionType([IntegerType], IntegerType), IntegerType], IntegerType)
    def apply_then_inc(b, f, n):
        return inc(f(n))

    assert East.function([IntegerType], IntegerType,
                         lambda _b, n: apply_then_inc(inc, n))(5) == 7


def test_a_re_run_body_returns_its_declared_output():
    # a body calling a compiled value re-runs rather than embeds; the dict it
    # returns is lifted under the declared output, so the caller reads a
    # field of it (it used to be a python dict: "no attribute 'b'")
    add = East.function([IntegerType, IntegerType], IntegerType, lambda _b, x, y: x + y)
    inc = add.bind(1)
    pair = StructType([("a", IntegerType), ("b", IntegerType)])

    @East.function([IntegerType], pair)
    def pair_of(b, n):
        return {"a": n, "b": inc(n)}

    assert East.function([IntegerType], IntegerType, lambda _b, n: pair_of(n).b)(4) == 5


# ─── the column projection's narrowed rows (#467) ────────────────────────────


WIDE = StructType([("kept", IntegerType), ("skipped", StringType)])
NARROW = StructType([("kept", IntegerType)])


@East.function([WIDE], IntegerType)
def kept_of(b, r):
    return r.kept


@pytest.fixture
def wide_file(tmp_path):
    path = tmp_path / "wide.beast2"
    write_in_segments(path, ArrayType(WIDE), EastArray(
        WIDE, [{"kept": i, "skipped": f"s{i}"} for i in range(12)]), 5)
    return path


def _projected(run):
    before = eager_stats()["beast2_segments_projected"]
    result = run()
    assert eager_stats()["beast2_segments_projected"] > before
    return result


def test_the_projections_narrowed_row_is_let_through_to_a_helper(wide_file):
    # the callback reads only `kept`, so each segment decodes {kept} alone,
    # and the helper's body re-runs against that row
    with open_beast2_file(wide_file) as f:
        assert list(_projected(lambda: f.map(lambda _b, r: kept_of(r) + 1))) == \
            list(range(1, 13))


def test_a_narrowed_row_is_refused_once_its_decode_has_ended(wide_file):
    # whatever ran before, a struct of the narrow type built anywhere else
    # is refused: the decode admits its rows only while it runs
    with open_beast2_file(wide_file) as f:
        _projected(lambda: f.map(lambda _b, r: kept_of(r) + 1))
    assert _refusal(lambda: East.function([NARROW], IntegerType, lambda _b, r: kept_of(r))) == \
        "kept_of(): parameter 'r' takes .Struct [(name=\"kept\", type=.Integer), " \
        "(name=\"skipped\", type=.String)], got .Struct [(name=\"kept\", type=.Integer)]"


def test_a_helper_on_a_narrowed_row_is_of_its_declared_output(wide_file):
    # the dict the re-run body returns is lifted under the declared output
    pair = StructType([("a", IntegerType), ("b", IntegerType)])

    @East.function([WIDE], pair)
    def pair_of(b, r):
        return {"a": r.kept, "b": r.kept * 2}

    with open_beast2_file(wide_file) as f:
        assert list(_projected(lambda: f.map(lambda _b, r: pair_of(r).b))) == \
            [i * 2 for i in range(12)]


def test_a_compiled_callback_over_another_row_is_refused_naming_the_row(wide_file):
    # its parameter does not take the row, so nothing it reads narrows the
    # decode, and the refusal names the file's row, as it does in memory
    zz = East.function([StructType([("zz", StringType)])], StringType, lambda _b, r: r.zz)
    with open_beast2_file(wide_file) as f, pytest.raises(ExpressionError) as raised:
        f.map(zz)
    assert str(raised.value) == (
        "East.function: parameter 'r' takes .Struct [(name=\"zz\", type=.String)], "
        "got .Struct [(name=\"kept\", type=.Integer), (name=\"skipped\", type=.String)]")


def test_an_explicitly_projected_file_is_a_collection_of_its_projected_type(wide_file):
    # project= makes every read serve the projected rows, so its callbacks
    # and the functions they call take that type; one declared over the
    # wire's row is refused, as any argument of another type is
    @East.function([NARROW], IntegerType)
    def narrow_kept(b, r):
        return r.kept

    with open_beast2_file(wide_file, project=ArrayType(NARROW)) as f:
        assert list(f.map(lambda _b, r: narrow_kept(r) * 10)) == [i * 10 for i in range(12)]
        with pytest.raises(ExpressionError, match=r"^kept_of\(\): parameter 'r' takes"):
            f.map(lambda _b, r: kept_of(r))


# ─── a subtype widens wherever a value fills a typed slot ───────────────────


def test_a_default_or_a_search_target_of_a_subtype_is_widened():
    def defaults(b, d, xs):
        a = East.value(variant("a", 1), A)
        return East.value([
            d.get(9, lambda _b, _k: a).match({"a": lambda _b, x: x, "b": lambda _b, _s: -1}),
            d.get_or_default(9, a).match({"a": lambda _b, x: x, "b": lambda _b, _s: -1}),
            xs.get(9, lambda _b, _i: a).match({"a": lambda _b, x: x, "b": lambda _b, _s: -1}),
            xs.get_or_default(9, a).match({"a": lambda _b, x: x, "b": lambda _b, _s: -1}),
            xs.find_first(a).unwrap_or(-1),
            xs.find_all(a).size(),
        ], ArrayType(IntegerType))

    built = East.function([DictType(IntegerType, AB), ArrayType(AB)], ArrayType(IntegerType),
                          defaults)
    assert list(built({}, [variant("b", "x"), variant("a", 1)])) == [1, 1, 1, 1, 1, 1]


def test_a_default_of_another_type_is_refused_naming_both():
    assert _refusal(lambda: East.function(
        [DictType(IntegerType, Row)], Row,
        lambda _b, d: d.get(1, lambda _b, _k: {"name": 7}))) == \
        '.get() default returns .Struct [(name="name", type=.Integer)], ' \
        'values are .Struct [(name="name", type=.String)]'


# ─── every builtin is held to its signature ──────────────────────────────────


def test_a_raw_builtin_is_held_to_its_signature():
    # the spelling of last resort reached east-c unchecked: DictHas read the
    # Integer as a String key and answered False
    assert _refusal(lambda: East.function(
        [D, IntegerType], BooleanType,
        lambda _b, d, n: East.builtin("DictHas", [StringType, IntegerType], [d, n], BooleanType))) == \
        "DictHas: argument 2 takes String, got Integer"


def test_a_python_literal_fills_a_builtin_slot_as_its_type():
    # `2` reached FloatPow as an Integer, whose bits east-c read as a Float
    # (about 1e-323), so 3.0 ** 2 answered 1.0
    assert East.function([FloatType], FloatType, lambda _b, x: East.Float.pow(x, 2))(3.0) == 9.0
    assert East.function([FloatType], FloatType, lambda _b, x: East.builtin(
        "FloatAdd", [], [x, 1], FloatType))(0.5) == 1.5


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
