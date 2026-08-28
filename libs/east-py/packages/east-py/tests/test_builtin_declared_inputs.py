#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Every ``call_builtin`` argument marshals against the builtin's DECLARED
slot type (#534).

The funnel used to convert each argument as ``type_of(arg)`` while passing
the receiver's type parameters, so any wrongly-typed scalar key/value slot
was reinterpreted inside east-c: an Integer key inserted into a String-keyed
dict segfaulted on read-back (exit 139), a String element inserted into an
Integer set surfaced its heap pointer as an East Integer, and a wrongly-typed
dict value corrupted latently until a read raised ``MemoryError``. Each such
slot must instead raise a named ``TypeError`` at the call, leaving the
collection untouched, on every affected builtin slot — and the scalar
namespaces get the same discipline (``East.String.length(3)`` dereferenced
the integer as a string pointer).
"""

import pytest

from east import (
    ArrayType,
    EastArray,
    EastDict,
    EastSet,
    EastTypeError,
    FloatType,
    IntegerType,
    NullType,
    StringType,
)
from east.namespace import East
from east.types.values._helpers import _call_builtin

# ─── the issue's three reproductions ─────────────────────────────────────────


def test_dict_insert_wrong_key_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictInsert argument 1"):
        d.insert(12345, 2)
    # the refused insert wrote nothing: the dict reads back intact
    assert dict(d.items()) == {"a": 1}
    d.insert("b", 2)
    assert dict(d.items()) == {"a": 1, "b": 2}


def test_set_insert_wrong_element_type_is_refused():
    s = EastSet(IntegerType, [1])
    with pytest.raises(TypeError, match="SetInsert argument 1"):
        s.insert("hello")
    assert list(s) == [1]


def test_dict_insert_wrong_value_type_is_refused():
    d = EastDict(StringType, StringType, {"a": "x"})
    with pytest.raises(TypeError, match="DictInsert argument 2"):
        d.insert("b", 12345)
    # the latent-corruption shape: reading back must NOT raise MemoryError
    assert dict(d.items()) == {"a": "x"}


def test_wrong_key_type_is_refused_on_an_empty_dict():
    # corruption never needed existing elements; neither does the refusal
    d = EastDict(StringType, IntegerType)
    with pytest.raises(TypeError, match="DictInsert argument 1"):
        d.insert(12345, 2)
    assert len(d) == 0


# ─── every affected dict slot ────────────────────────────────────────────────


def test_dict_insert_or_update_wrong_key_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictInsertOrUpdate argument 1"):
        d.insert_or_update(12345, 2, lambda _b, existing, incoming: incoming)
    assert dict(d.items()) == {"a": 1}


def test_dict_insert_or_update_wrong_value_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictInsertOrUpdate argument 2"):
        d.insert_or_update("a", "not an integer", lambda _b, existing, incoming: incoming)
    assert dict(d.items()) == {"a": 1}


def test_dict_swap_wrong_key_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictSwap argument 1"):
        d.swap(12345, 2)
    assert dict(d.items()) == {"a": 1}


def test_dict_swap_wrong_value_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictSwap argument 2"):
        d.swap("a", "not an integer")
    assert dict(d.items()) == {"a": 1}


def test_dict_delete_wrong_key_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictDelete argument 1"):
        d.delete(12345)
    assert dict(d.items()) == {"a": 1}


def test_dict_try_delete_wrong_key_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictTryDelete argument 1"):
        d.try_delete(12345)
    assert dict(d.items()) == {"a": 1}


def test_dict_update_wrong_key_type_is_refused():
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError, match="DictGet argument 1"):
        d.update(12345, lambda _b, v: v + 1)
    assert dict(d.items()) == {"a": 1}


def test_dict_read_slots_refuse_a_wrong_key_type():
    # the read family converts the key against the DECLARED key type on the
    # proxy paths — pinned here so the whole family shares one contract
    d = EastDict(StringType, IntegerType, {"a": 1})
    with pytest.raises(TypeError):
        d[12345]
    with pytest.raises(TypeError):
        12345 in d  # noqa: B015 — the membership probe itself must raise
    with pytest.raises(TypeError):
        d.try_get(12345)
    with pytest.raises(TypeError):
        d.get_or_default(12345, 0)


# ─── every affected set slot ─────────────────────────────────────────────────


def test_set_delete_wrong_element_type_is_refused():
    s = EastSet(IntegerType, [1])
    with pytest.raises(TypeError, match="SetDelete argument 1"):
        s.delete("hello")
    assert list(s) == [1]


def test_set_try_insert_wrong_element_type_is_refused():
    s = EastSet(IntegerType, [1])
    with pytest.raises(TypeError, match="SetTryInsert argument 1"):
        s.try_insert("hello")
    assert list(s) == [1]


def test_set_try_delete_wrong_element_type_is_refused():
    s = EastSet(IntegerType, [1])
    with pytest.raises(TypeError, match="SetTryDelete argument 1"):
        s.try_delete("hello")
    assert list(s) == [1]


def test_set_has_wrong_element_type_is_refused():
    s = EastSet(IntegerType, [1])
    with pytest.raises(TypeError):
        s.has("hello")


# ─── the Array.find_* target slot ────────────────────────────────────────────


def test_array_find_first_wrong_target_type_is_refused():
    arr = EastArray(FloatType, [1.0, 2.5])
    with pytest.raises(EastTypeError):
        arr.find_first("not a float")
    with pytest.raises(EastTypeError):
        arr.find_sorted_first("not a float")


# ─── the scalar namespaces get the same discipline ───────────────────────────


def test_string_namespace_refuses_a_non_string():
    # an Integer marshalled as its own type was dereferenced as a string
    # pointer inside StringLength/StringUpperCase — the segfault shape
    with pytest.raises(TypeError, match="StringLength argument 0"):
        East.String.length(3)
    with pytest.raises(TypeError, match="StringUpperCase argument 0"):
        East.String.upper_case(3)
    with pytest.raises(TypeError, match="StringConcat argument 1"):
        East.String.concat("a", 5)


def test_float_namespace_refuses_a_non_number():
    with pytest.raises(TypeError, match="FloatSqrt argument 0"):
        East.Float.sqrt("x")


def test_integer_namespace_refuses_a_non_integer():
    with pytest.raises(TypeError, match="IntegerAdd argument 1"):
        East.Integer.add(1, "x")


def test_float_slot_widens_a_python_int():
    # previously the int marshalled as an Integer and FloatAdd read its i64
    # payload as an f64 — denormal garbage; the declared slot widens it
    assert East.Float.add(1, 2.0) == 3.0


# ─── the funnel's own contract ───────────────────────────────────────────────


def test_function_slot_refuses_a_plain_value():
    arr = EastArray(IntegerType, [1])
    with pytest.raises(TypeError, match="ArrayMap argument 1 is Function-typed"):
        _call_builtin("ArrayMap", [IntegerType, IntegerType], [arr, 42], ArrayType(IntegerType))


def test_unknown_builtin_name_has_no_signature():
    with pytest.raises(TypeError, match="no declared input signature"):
        _call_builtin("NoSuchBuiltin", [], [], NullType)


def test_argument_arity_mismatch_is_refused():
    s = EastSet(IntegerType, [1])
    with pytest.raises(TypeError, match=r"SetInsert takes 2 argument\(s\), got 1"):
        _call_builtin("SetInsert", [IntegerType], [s], NullType)


def test_type_parameter_arity_mismatch_is_refused():
    s = EastSet(IntegerType, [1])
    with pytest.raises(TypeError, match="takes 1 type parameter"):
        _call_builtin("SetInsert", [IntegerType, IntegerType], [s, 2], NullType)


def test_mislabelled_collection_slot_is_refused_by_the_funnel():
    # the by-pointer pass-through backstop: even with no method-level operand
    # guard, a mislabelled proxy in a collection slot is refused (#529/#534)
    ints = EastArray(IntegerType, [1])
    strs = EastArray(StringType, ["x"])
    with pytest.raises(TypeError, match="ArrayConcat argument 1"):
        _call_builtin("ArrayConcat", [IntegerType], [ints, strs], ArrayType(IntegerType))
