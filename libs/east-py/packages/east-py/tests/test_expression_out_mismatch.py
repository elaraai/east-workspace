#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A compiled function whose declared output type contradicts a declared ``out=`` is
rejected at the call, not written into a mislabelled collection (issue #467).

``map(k, out=T)`` used to accept a compiled East function whose declared output
was not ``T`` and label the function's values as ``T``. Both types were known
statically — the function carries its signature and ``out=`` was explicit — but
nothing compared them. The mislabelled collection then read fine (``len``,
type labels, the ``update_many`` label check) and the process died with
SIGSEGV at the first element decode, arbitrarily far from the cause: a
mismatched scalar/variant field raised a cryptic per-element error, while a
mismatched COLLECTION crossed the bridge by pointer with only a type-kind
check and corrupted silently.

Three layers now hold, and each is pinned here:

* every eager method taking a compiled function plus a declared type raises
  ``EastTypeError`` at the call site;
* the bridge refuses the by-pointer pass-through of a C-backed value whose
  element type is not the declared one (covers plain lambdas too);
* a compiled function whose INPUT prefix does not match the callback signature no
  longer runs native (it would read elements as the wrong type — the same
  corruption from the other side).
"""

import pytest

from east import (
    ArrayType,
    East,
    EastDict,
    EastTypeError,
    ExpressionError,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    array,
    some,
)

ROW = StructType([("id", StringType), ("csv", StringType)])
KEY = StructType([
    ("chit", StringType),
    ("tank", OptionType(StringType)),
    ("side", StringType),
])
# What the reported function actually emitted: a bare String in the Option slot.
BAD_KEY_FUNCTION = East.function([ROW], StructType([("chit", StringType), ("tank", StringType), ("side", StringType)]), lambda _b, r: {
    "chit": r["id"],
    "tank": r["csv"],
    "side": "from",
})


@pytest.fixture
def rows():
    return array(ROW, [{"id": "c1", "csv": "T1,T2"},
                       {"id": "c2", "csv": "T3"}])


# ── the reported failure: map(function, out=T) with function output ≠ T ──────────

def test_map_rejects_function_whose_output_is_not_out(rows):
    with pytest.raises(EastTypeError, match="function output is"):
        rows.map(BAD_KEY_FUNCTION, out=KEY)


def test_map_rejects_mismatched_function_even_on_an_empty_array():
    """The mismatch is static — an empty input must not hide it."""
    empty = array(ROW, [])
    with pytest.raises(EastTypeError, match="function output is"):
        empty.map(BAD_KEY_FUNCTION, out=KEY)


def test_map_rejects_the_shape_that_used_to_segfault(rows):
    """A compiled function emitting Array<String> under out=Array<Option<String>> used to
    be accepted SILENTLY — the array crossed the bridge by pointer, and the
    first read decoded String bytes as a variant header (SIGSEGV, exit 139)."""
    k = East.function([ROW], ArrayType(StringType), lambda _b, r: r["csv"].split(","))
    with pytest.raises(EastTypeError, match="function output is"):
        rows.map(k, out=ArrayType(OptionType(StringType)))


def test_matched_function_with_out_still_runs(rows):
    k = East.function([ROW], ArrayType(StringType), lambda _b, r: r["csv"].split(","))
    tags = rows.map(k, out=ArrayType(StringType))
    assert [list(t) for t in tags] == [["T1", "T2"], ["T3"]]


# ── the same contract on the sibling out=-taking methods ─────────────────────

def test_filter_map_checks_the_option_wrapped_output(rows):
    """``out=`` names the INNER type; the function must emit some(...)/none."""
    plain = East.function([ROW], StringType, lambda _b, r: r["id"])          # String, not Option<String>
    with pytest.raises(EastTypeError, match="function output is"):
        rows.filter_map(plain, out=StringType)
    good = East.function([ROW], OptionType(StringType), lambda _b, r: some(r["id"]))
    assert list(rows.filter_map(good, out=StringType)) == ["c1", "c2"]


def test_first_map_checks_the_option_wrapped_output(rows):
    plain = East.function([ROW], StringType, lambda _b, r: r["id"])
    with pytest.raises(EastTypeError, match="function output is"):
        rows.first_map(plain, out=StringType)


def test_flat_map_checks_the_array_wrapped_output(rows):
    scalar = East.function([ROW], StringType, lambda _b, r: r["id"])         # String, not Array<String>
    with pytest.raises(EastTypeError, match="function output is"):
        rows.flat_map(scalar, out=StringType)


def test_generate_checks_element_type():
    k = East.function([IntegerType], IntegerType, lambda _b, i: i + 1)        # Integer
    with pytest.raises(EastTypeError, match="function output is"):
        array(IntegerType, []).generate(3, k, element_type=StringType)


def test_set_and_dict_map_check_out(rows):
    ids = rows.map(East.function([ROW], StringType, lambda _b, r: r["id"]), out=StringType)
    s = ids.to_set()
    wrong = East.function([StringType], IntegerType, lambda _b, x: x.length())    # Integer, not String
    with pytest.raises(EastTypeError, match="function output is"):
        s.map(wrong, out=StringType)
    d = s.map(East.function([StringType], IntegerType, lambda _b, x: x.length()), out=IntegerType)
    with pytest.raises(EastTypeError, match="function output is"):
        d.map(East.function([IntegerType], IntegerType, lambda _b, v: v + 1), out=StringType)
    assert sorted(d.values()) == [2, 2]


# ── update_many: the propagation vector in the report ────────────────────────

def test_update_many_still_rejects_wrong_key_array_labels(rows):
    """The pre-existing label check — pinned because the report leaned on it."""
    ids = rows.map(East.function([ROW], StringType, lambda _b, r: r["id"]), out=StringType)
    ones = rows.map(East.function([ROW], IntegerType, lambda _b, r: 1), out=IntegerType)
    d = EastDict(KEY, IntegerType)
    with pytest.raises(EastTypeError, match="keyed by"):
        d.update_many(ids, ones)


def test_update_many_rejects_a_mismatched_combine_function(rows):
    """A precompiled combine runs C-to-C with no conversion; its signature is
    the only check its values ever get."""
    ids = rows.map(East.function([ROW], StringType, lambda _b, r: r["id"]), out=StringType)
    ones = rows.map(East.function([ROW], IntegerType, lambda _b, r: 1), out=IntegerType)
    d = EastDict(StringType, IntegerType)
    bad_combine = East.function([StringType, StringType], StringType, lambda _b, a, b: a + b)
    with pytest.raises(EastTypeError, match="combine function"):
        d.update_many(ids, ones, combine=bad_combine)
    d.update_many(ids, ones, combine=East.function([IntegerType, IntegerType], IntegerType,
                                            lambda _b, a, b: a + b))
    assert dict(d.items()) == {"c1": 1, "c2": 1}


# ── the strict wrap backstops the label before anything crosses ──────────────

def test_plain_lambda_capturing_a_mislabelled_array_is_refused(rows):
    """No function involved, so the call-site guard cannot fire — and no
    per-element python path exists either (#625): the mutable array capture
    is refused at the wrap, before any mislabelled pointer could cross."""
    wrong = array(StringType, ["a", "b"])
    with pytest.raises(ExpressionError, match="captured automatically"):
        rows.map(lambda _b, r: wrong, out=ArrayType(OptionType(StringType)))


def test_wrong_input_function_does_not_run_native(rows):
    """Output matches, inputs do not: running native would read elements as
    the wrong type. The failure is loud and EARLY now — the signature check
    refuses the native value, the re-trace against the real element type
    names the missing field, and the capture's loud contract raises it
    (previously the wrong function silently fell back to a runtime error)."""
    other = StructType([("zz", StringType)])
    k = East.function([other], StringType, lambda _b, r: r["zz"])
    with pytest.raises(ExpressionError, match="no field 'zz'"):
        rows.map(k, out=StringType)


def test_scalar_variant_mismatch_gets_a_named_error(rows):
    """A traceable lambda whose expression is a String cannot fill a declared
    Option slot: the strict capture names both types up front (#625) —
    previously the per-element conversion died with "'str' object has no
    attribute 'type'"."""
    with pytest.raises(ExpressionError, match="produced String"):
        rows.map(lambda _b, r: r["id"], out=OptionType(StringType))


# ── nested collection fields: the exact latent shape from the report ─────────

def test_struct_with_mislabelled_collection_field_is_refused(rows):
    """The silent route: a scalar mismatch raised per element, but a
    collection FIELD crossed by pointer and corrupted. Both types statically
    known -> rejected at the call."""
    inner = StructType([("id", StringType), ("tags", ArrayType(OptionType(StringType)))])
    k = East.function([ROW], StructType([("id", StringType), ("tags", ArrayType(StringType))]), lambda _b, r: {"id": r["id"], "tags": r["csv"].split(",")})
    with pytest.raises(EastTypeError, match="function output is"):
        rows.map(k, out=inner)
