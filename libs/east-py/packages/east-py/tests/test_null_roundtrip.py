#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Null / ``none`` value round-trips through east-c decode.

The canonical NullType value is the ``east_null`` sentinel — what construction
and coercion produce. A decoded value must use the same representation, or a
``none`` that has been through east-c (via an eager collection method or a
beast2 decode) silently compares unequal to the ``none`` constant and disagrees
with ``is_east_null`` — filtering or counting on ``none`` then drops rows with
no error.

Both decode paths share the ``c_value_to_py`` chokepoint, so one identity test
covers them; the defensive ``EastNull``/``None`` equality is checked too.
"""

import pytest

pytest.importorskip("east._eastc_bridge")

from east import (  # noqa: E402
    BooleanType,
    EastBlob,
    EastVariant,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    array,
    is_east_null,
    none,
    some,
)
from east.types.values import east_null  # noqa: E402

_ELEMENT_TYPES = [StringType, IntegerType, FloatType, BooleanType]


@pytest.mark.parametrize("elem", _ELEMENT_TYPES)
def test_none_survives_array_roundtrip(elem):
    # array(...)[0] decodes `none` back out of east-c via an eager method.
    back = array(OptionType(elem), [none])[0]
    assert back == none
    assert back.type == none.type
    assert back.value is east_null
    assert is_east_null(back.value)
    assert is_east_null(back.value) == is_east_null(none.value)


@pytest.mark.parametrize("elem", _ELEMENT_TYPES)
def test_none_survives_beast2_roundtrip(elem):
    back = EastBlob.encode_beast2(none).decode_beast2(OptionType(elem))
    assert back == none
    assert is_east_null(back.value)


def test_some_still_roundtrips():
    # The `some` side was never broken — guard against a fix for `none` that
    # regresses `some`.
    back = array(OptionType(StringType), [some("x")])[0]
    assert back == some("x")
    assert back.value == "x"


def test_filtering_on_none_counts_every_none():
    opts = array(OptionType(StringType), [none, some("x"), none])
    # The obvious absence test must not silently under-count.
    assert sum(1 for c in opts if c == none) == 2
    assert sum(1 for c in opts if c.type == "none") == 2


def test_east_null_equals_python_none():
    # Defensive: the two NullType representations compare equal in both
    # directions, a hand-built None payload matches the `none` constant, and
    # equality agrees with the hash.
    py_none = None
    assert east_null == py_none
    assert py_none == east_null
    assert EastVariant("none", None) == none
    assert hash(east_null) == hash(py_none)
