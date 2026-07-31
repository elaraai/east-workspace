#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Callback output types come from the TYPE SYSTEM, not from a sampled value
(issue #450).

Eager collection methods that take a key/value callback used to recover its
output type by calling it on the first element and asking `type_of` what came
back. That is lossy for variants by construction — `type_of` documents that
"for a variant, the inferred type is a single-case VariantType ... the other
cases are unknowable from one value" — so an `Option`-returning callback was
typed from whichever arm the sampled element happened to carry. Two failures
followed:

* a later element in the other case failed conversion with
  `EastError: callback raised: Unknown variant case: none`;
* even an all-`some` run silently produced a collection whose key type was a
  single-case variant rather than the real `Option`.

Sampling also *calls* the callback on a DECODED value, so any callback written
against the traced surface (`unwrap_or`, `substring`, `try_parse`, `is_some`)
died with an `AttributeError` from inside the library before it ever ran.

The types were always available: a precompiled kernel carries its signature,
and a traceable lambda gets one from the tracer. Sampling remains only as the
fallback for genuinely untraceable (impure) callbacks, which these tests also
pin so that path does not rot.
"""

import pytest

from east import (
    EastDict,
    OptionType,
    StringType,
    StructType,
    array,
    kernel,
    none,
    some,
)

ROW = StructType([("a", OptionType(StringType)), ("n", StringType)])
KEY = StructType([("a", OptionType(StringType)), ("n", StringType)])


@pytest.fixture
def rows():
    """Three rows, one of which carries `none` in the Option field."""
    return array(ROW, [{"a": some("x"), "n": "1"},
                       {"a": none, "n": "2"},
                       {"a": some("x"), "n": "3"}])


@pytest.fixture
def all_some():
    """The same shape with no `none` — the case that used to pass SILENTLY
    WRONG, so it needs a type assertion rather than a smoke check."""
    return array(ROW, [{"a": some("x"), "n": "1"},
                       {"a": some("y"), "n": "2"}])


# ── the reported failure: a `none` in the key ────────────────────────────────

def test_group_by_bare_option_key_including_none(rows):
    grouped = rows.group_by(kernel(ROW, lambda r: r["a"]))
    assert grouped.key_type == OptionType(StringType)
    assert {(k.type, k.value if k.type == "some" else None): len(v)
            for k, v in grouped.items()} == {("some", "x"): 2, ("none", None): 1}


def test_group_by_struct_key_containing_a_none(rows):
    grouped = rows.group_by(kernel(ROW, lambda r: {"a": r["a"], "n": r["n"]}))
    assert grouped.key_type == KEY
    assert len(grouped) == 3


def test_to_dict_struct_key_containing_a_none(rows):
    d = rows.to_dict(key=kernel(ROW, lambda r: {"a": r["a"], "n": r["n"]}),
                     value=kernel(ROW, lambda r: r["n"]))
    assert d.key_type == KEY
    assert len(d) == 3


# ── the SILENT half: the key type was wrong even when nothing raised ─────────

def test_all_some_key_type_is_the_full_option_not_a_single_case(all_some):
    grouped = all_some.group_by(kernel(ROW, lambda r: r["a"]))
    assert grouped.key_type == OptionType(StringType), (
        "an all-`some` sample must not narrow the key to a single-case variant")


# ── the machinery that always worked — controls, so a regression is placed ───

def test_the_same_key_has_always_been_fine_elsewhere(rows):
    """`update_many`/`to_set`/`sorted` take the identical values without
    complaint; that is what localised #450 to the callback path."""
    k = kernel(ROW, lambda r: {"a": r["a"], "n": r["n"]})
    keys = rows.map(k, out=KEY)
    d = EastDict(KEY, StringType)
    d.update_many(keys, rows.map(kernel(ROW, lambda r: r["n"]), out=StringType))
    assert len(d) == 3
    assert len(keys.to_set()) == 3
    assert len(keys.sorted()) == 3


def test_group_to_dicts_key_or_value_containing_a_none(rows):
    """`_group_pairs` backs group_to_dicts/group_to_arrays/group_to_sets and was
    MISSED by the first pass at #450 — group_by and to_dict were fixed while this
    still sampled, so a `none` anywhere in the key, second key or value failed
    with "Unknown variant case: none"."""
    out = rows.group_to_dicts(
        kernel(ROW, lambda r: r["n"]),          # key
        kernel(ROW, lambda r: r["a"]),          # key2 — Option, one row is none
        kernel(ROW, lambda r: r["a"]),          # value — Option too
    )
    assert len(out) == 3


def test_group_to_arrays_value_containing_a_none(rows):
    out = rows.group_to_arrays(kernel(ROW, lambda r: r["n"]),
                               kernel(ROW, lambda r: r["a"]))
    assert len(out) == 3


# ── traced-only methods in a plain lambda ────────────────────────────────────

def test_plain_lambda_may_use_traced_only_methods(rows):
    """`unwrap_or` exists only on the traced proxy. Sampling called the lambda
    on a decoded value, so this raised AttributeError from inside the library;
    tracing it for its type never touches a value."""
    grouped = rows.group_by(lambda r: r["a"].unwrap_or("-"))
    assert grouped.key_type == StringType
    assert sorted(str(k) for k in grouped) == ["-", "x"]


def test_dict_map_value_fn_may_use_traced_only_methods(rows):
    grouped = rows.group_by(kernel(ROW, lambda r: r["n"]))
    sizes = grouped.map(lambda v: v.first_map(lambda r: r["a"]))
    assert sizes.value_type == OptionType(StringType)


def test_captured_side_table_lambda_still_types_from_the_tracer(rows):
    """A lambda closing over an East dict cannot push DOWN (snapshot-vs-live
    semantics), but its output TYPE must still come from the tracer — sampling
    would narrow the Option to whichever case the first element produced."""
    table = EastDict(StringType, OptionType(StringType), {"1": some("hit")})
    grouped = rows.group_by(lambda r: table.get_or_default(r["n"], none))
    assert grouped.key_type == OptionType(StringType)
    assert len(grouped) == 2  # some("hit") for row "1", none for "2"/"3"


# ── the fallback must survive ────────────────────────────────────────────────

def test_impure_callback_still_falls_back_to_sampling(rows):
    """An untraceable callback has no declared type, so sampling remains the
    only answer for it. Pinned so the fallback is not dropped as dead code."""
    calls = []

    def impure(r):
        calls.append(1)          # closure mutation — refuses to trace
        return r["n"]

    grouped = rows.group_by(impure)
    assert len(grouped) == 3
    assert calls, "the impure callback should have been sampled/run in python"
