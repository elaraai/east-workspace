#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Tests for @memoize content-addressed platform-function memoization.

Inert-by-default, activation via configure_memo / EAST_MEMO_DIR, key
sensitivity to inputs and salts, registry aliasing, ordering errors, and the
async path.
"""

import asyncio

import pytest

from east import (
    ArrayType,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    array,
    configure_memo,
    memoize,
    platform_function,
    platform_functions,
)
from east.runtime import memo as memo_module

RowType = StructType([("name", StringType), ("score", FloatType)])


@pytest.fixture(autouse=True)
def _deactivate_memo(monkeypatch):
    """Every test starts inert, regardless of the host environment."""
    monkeypatch.delenv("EAST_MEMO_DIR", raising=False)
    monkeypatch.delenv("EAST_MEMO_SALT", raising=False)
    monkeypatch.setattr(memo_module, "_DIR", None)
    monkeypatch.setattr(memo_module, "_SALT", "")
    monkeypatch.setattr(memo_module, "_CONFIGURED", False)


def _make_fn(calls):
    @memoize
    @platform_function(inputs=[ArrayType(RowType), FloatType], output=ArrayType(RowType))
    def boost_scores(rows, factor):
        calls.append(1)
        return array(RowType,
                     [{"name": r["name"], "score": r["score"] * factor} for r in rows])

    return boost_scores


ROWS = [{"name": "a", "score": 1.0}, {"name": "b", "score": 2.0}]


def test_inert_without_activation(tmp_path):
    calls = []
    fn = _make_fn(calls)
    fn(ROWS, 2.0)
    fn(ROWS, 2.0)
    assert len(calls) == 2  # no caching, no files
    assert list(tmp_path.iterdir()) == []


def test_hit_skips_recompute_and_roundtrips(tmp_path):
    calls = []
    fn = _make_fn(calls)
    configure_memo(str(tmp_path))
    first = fn(ROWS, 2.0)
    second = fn(ROWS, 2.0)
    assert len(calls) == 1  # second call was a hit
    assert [dict(r) for r in second] == [dict(r) for r in first]
    assert second[1]["score"] == 4.0
    assert len(list(tmp_path.glob("boost_scores-*.beast2"))) == 1


def test_different_inputs_different_keys(tmp_path):
    calls = []
    fn = _make_fn(calls)
    configure_memo(str(tmp_path))
    fn(ROWS, 2.0)
    fn(ROWS, 3.0)                                  # factor differs
    fn([{"name": "c", "score": 9.0}], 2.0)         # rows differ
    assert len(calls) == 3
    assert len(list(tmp_path.glob("boost_scores-*.beast2"))) == 3


def test_global_and_function_salts_invalidate(tmp_path):
    calls = []

    @memoize(salt="v1")
    @platform_function(inputs=[IntegerType], output=IntegerType, name="salted_double")
    def double(x):
        calls.append(1)
        return x * 2

    configure_memo(str(tmp_path))
    double(2)
    double(2)
    assert len(calls) == 1
    configure_memo(str(tmp_path), salt="bumped")   # global salt changes the key
    double(2)
    assert len(calls) == 2


def test_env_var_activation(tmp_path, monkeypatch):
    calls = []
    fn = _make_fn(calls)
    monkeypatch.setenv("EAST_MEMO_DIR", str(tmp_path))
    fn(ROWS, 2.0)
    fn(ROWS, 2.0)
    assert len(calls) == 1


def test_configure_none_overrides_env(tmp_path, monkeypatch):
    calls = []
    fn = _make_fn(calls)
    monkeypatch.setenv("EAST_MEMO_DIR", str(tmp_path))
    configure_memo(None)
    fn(ROWS, 2.0)
    fn(ROWS, 2.0)
    assert len(calls) == 2


def test_registry_points_at_memoized_wrapper(tmp_path):
    calls = []

    @memoize
    @platform_function(inputs=[IntegerType], output=IntegerType, name="registry_probe")
    def probe(x):
        calls.append(1)
        return x + 1

    pf = next(p for p in platform_functions(__name__) if p["name"] == "registry_probe")
    configure_memo(str(tmp_path))
    assert pf["fn"](1) == 2
    assert pf["fn"](1) == 2                        # hit via the registry callable
    assert probe(1) == 2                           # hit via the module attribute
    assert len(calls) == 1
    assert pf["fn"] is probe                       # one shared callable


def test_wrong_decorator_order_raises():
    with pytest.raises(TypeError, match="above @platform_function"):

        @memoize
        def plain(x):
            return x


def test_inline_wrapping_with_salt(tmp_path):
    calls = []

    @platform_function(inputs=[IntegerType], output=IntegerType, name="inline_target")
    def inc(x):
        calls.append(1)
        return x + 1

    configure_memo(str(tmp_path))
    cached = memoize(inc, salt="content-digest-abc")
    assert cached(1) == 2
    assert cached(1) == 2
    assert len(calls) == 1


def test_async_platform_function(tmp_path):
    calls = []

    @memoize
    @platform_function(inputs=[FloatType], output=FloatType, name="async_double")
    async def adouble(x):
        calls.append(1)
        return x * 2.0

    configure_memo(str(tmp_path))
    assert asyncio.run(adouble(2.0)) == 4.0
    assert asyncio.run(adouble(2.0)) == 4.0
    assert len(calls) == 1
