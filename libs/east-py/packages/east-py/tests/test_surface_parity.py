#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Surface-parity tests (issue #296): the tracer's expanded op set and the
TS-expr-sugar reductions/groupings on Array/Set/Dict — all composed over
east-c builtins with native kernels."""

from datetime import UTC, datetime

import pytest

from east import (
    ArrayType,
    DateTimeType,
    East,
    EastBlob,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    greatest,
    kernel,
    least,
    none,
    some,
    variant,
    where,
)

ROW = StructType([("sku", StringType), ("price", FloatType), ("qty", IntegerType)])
CSV = b"sku,price,qty\nA,2.5,4\nB,150.0,1\nA,10.0,2\nB,3.0,5\n"


def _rows():
    return EastBlob(CSV).decode_csv(ROW)


# ─── tracer: math / string / datetime / option / variant / collections ──────


def test_traced_math_tail():
    Row = StructType([("x", FloatType), ("n", IntegerType)])
    r = {"x": 4.0, "n": -7}
    assert kernel(Row, lambda v: v.x.log().exp())(r) == pytest.approx(4.0)
    assert kernel(Row, lambda v: v.x.sqrt().sign())(r) == 1.0
    assert kernel(Row, lambda v: v.n.sign())(r) == -1
    assert kernel(Row, lambda v: v.x.sin() ** 2.0 + v.x.cos() ** 2.0)(r) == pytest.approx(1.0)


def test_traced_string_tail():
    Row = StructType([("s", StringType)])
    r = {"s": "  a,b,c  "}
    assert kernel(Row, lambda v: v.s.strip().split(",").size())(r) == 3
    assert kernel(Row, lambda v: v.s.lstrip().rstrip().replace(",", "-"))(r) == "a-b-c"
    assert kernel(Row, lambda v: v.s.strip().substring(0, 3))(r) == "a,b"
    assert kernel(Row, lambda v: v.s.index_of("b"))(r) == 4
    assert kernel(Row, lambda v: v.s.strip().repeat(2).length())(r) == 10
    assert kernel(Row, lambda v: v.s.regex_contains("[abc],"))(r) is True
    assert kernel(Row, lambda v: v.s.regex_replace("[bc]", "x").strip())(r) == "a,x,x"


def test_traced_datetime():
    Row = StructType([("ts", DateTimeType)])
    r = {"ts": datetime(2026, 7, 10, 12, 30, tzinfo=UTC)}
    assert kernel(Row, lambda v: v.ts.get_year() * 100 + v.ts.get_month())(r) == 202607
    assert kernel(Row, lambda v: v.ts.add_days(2).get_day_of_month())(r) == 12
    assert kernel(Row, lambda v: v.ts.subtract_hours(13).get_day_of_month())(r) == 9
    assert kernel(Row, lambda v: v.ts.duration_days(v.ts.add_hours(36)))(r) == -1.5
    assert kernel(Row, lambda v: v.ts.add_days(2).print_format("YYYY-MM-DD"))(r) == "2026-07-12"
    epoch = kernel(Row, lambda v: v.ts.to_epoch_milliseconds())(r)
    assert epoch == int(r["ts"].timestamp() * 1000)


def test_traced_option_access_and_construction():
    Row = StructType([("p", OptionType(FloatType))])
    k_unwrap = kernel(Row, lambda v: v.p.unwrap_or(0.0))
    assert k_unwrap({"p": some(2.0)}) == 2.0
    assert k_unwrap({"p": none}) == 0.0
    assert kernel(Row, lambda v: v.p.is_some())({"p": none}) is False
    assert kernel(Row, lambda v: v.p.is_none())({"p": none}) is True
    k_fill = kernel(Row, lambda v: where(v.p.is_some(), v.p, some(9.0)))
    assert k_fill({"p": none}).value == 9.0
    assert k_fill({"p": some(1.0)}).value == 1.0


def test_traced_general_variants():
    Status = VariantType([("active", FloatType), ("closed", NullType)])
    Row = StructType([("st", Status)])
    act = {"st": variant("active", 2.5, Status)}
    clo = {"st": variant("closed", None, Status)}
    assert kernel(Row, lambda v: v.st.get_tag())(act) == "active"
    assert kernel(Row, lambda v: v.st.has_tag("closed"))(clo) is True
    m = kernel(Row, lambda v: v.st.match({"active": lambda x: x, "closed": lambda _x: 0.0}))
    assert m(act) == 2.5
    assert m(clo) == 0.0
    u = kernel(Row, lambda v: v.st.unwrap("active"))
    assert u(act) == 2.5
    with pytest.raises(Exception, match="unwrap: expected variant case"):
        u(clo)
    c = kernel(Row, lambda v: where(v.st.has_tag("active"), v.st, variant("active", -1.0)))
    assert c(clo).value == -1.0


def test_traced_collection_reads_and_struct_construction():
    Row = StructType([("tags", ArrayType(StringType))])
    r = {"tags": ["x", "y", "z"]}
    assert kernel(Row, lambda v: v.tags.size())(r) == 3
    assert kernel(Row, lambda v: v.tags.has(2))(r) is True
    assert kernel(Row, lambda v: v.tags.get(1))(r) == "y"
    assert kernel(Row, lambda v: v.tags.get_or_default(9, "?"))(r) == "?"
    pair = kernel([Row, IntegerType], lambda v, i: {"i": i, "first": v.tags.get(0)})
    out = pair(r, 5)
    assert out["i"] == 5 and out["first"] == "x"


def test_runtime_variant_methods():
    v = variant("a", 1.0, VariantType([("a", FloatType), ("b", NullType)]))
    assert v.get_tag() == "a"
    assert v.has_tag("a") and not v.has_tag("b")
    assert v.unwrap("a") == 1.0
    with pytest.raises(ValueError, match="unwrap: expected variant case"):
        v.unwrap("b")


def test_greatest_least_dual_mode():
    assert greatest(1.0, 2.0) == 2.0 and least("b", "a") == "a"
    Row = StructType([("x", FloatType), ("y", FloatType)])
    assert kernel(Row, lambda v: greatest(v.x, v.y))({"x": 1.0, "y": 3.0}) == 3.0
    assert kernel(Row, lambda v: least(v.x, 0.5))({"x": 1.0, "y": 3.0}) == 0.5


# ─── array sugar ─────────────────────────────────────────────────────────────


def test_array_sum_mean():
    rows = _rows()
    assert rows.sum(lambda r: r.price) == 165.5
    assert rows.sum(lambda r: r.qty) == 12
    assert rows.mean(lambda r: r.price) == pytest.approx(41.375)
    prices = rows.map(lambda r: r.price)
    assert prices.sum() == 165.5
    empty = prices.filter(lambda p: p > 1e9)
    assert empty.sum() == 0.0
    import math

    assert math.isnan(empty.mean())


def test_array_maximum_minimum_find():
    rows = _rows()
    assert rows.maximum(lambda r: r.price) == 150.0
    assert rows.minimum(lambda r: r.price) == 2.5
    assert rows.find_maximum(lambda r: r.price).value == 1
    assert rows.find_minimum(lambda r: r.price).value == 0
    assert rows.filter(lambda r: r.price > 1e9).find_maximum(lambda r: r.price).type == "none"
    from east import EastError

    with pytest.raises(EastError):
        rows.filter(lambda r: r.price > 1e9).maximum(lambda r: r.price)


def test_array_every_some_find_all():
    rows = _rows()
    assert rows.every(lambda r: r.price > 0.0) is True
    assert rows.every(lambda r: r.qty > 1) is False
    assert rows.some(lambda r: r.price > 100.0) is True
    assert rows.some(lambda r: r.price > 1000.0) is False
    assert list(rows.find_all("A", by=lambda r: r.sku)) == [0, 2]
    bools = rows.map(lambda r: r.qty > 1)
    assert bools.every() is False and bools.some() is True


def test_array_group_family():
    rows = _rows()
    assert dict(rows.group_size(lambda r: r.sku).items()) == {"A": 2, "B": 2}
    assert dict(rows.group_sum(lambda r: r.sku, lambda r: r.price).items()) == {"A": 12.5, "B": 153.0}
    means = rows.group_mean(lambda r: r.sku, lambda r: r.price)
    assert means["A"] == pytest.approx(6.25) and means["B"] == pytest.approx(76.5)
    assert dict(rows.group_maximum(lambda r: r.sku, lambda r: r.price).items()) == {"A": 10.0, "B": 150.0}
    assert dict(rows.group_minimum(lambda r: r.sku, lambda r: r.price).items()) == {"A": 2.5, "B": 3.0}
    assert dict(rows.group_every(lambda r: r.sku, lambda r: r.qty > 1).items()) == {"A": True, "B": False}
    assert dict(rows.group_some(lambda r: r.sku, lambda r: r.qty > 4).items()) == {"A": False, "B": True}
    arrays = rows.group_to_arrays(lambda r: r.sku, lambda r: r.price)
    assert {k: list(v) for k, v in arrays.items()} == {"A": [2.5, 10.0], "B": [150.0, 3.0]}
    sets = rows.group_to_sets(lambda r: r.sku, lambda r: r.qty)
    assert {k: sorted(v.to_array()) for k, v in sets.items()} == {"A": [2, 4], "B": [1, 5]}
    dicts = rows.group_to_dicts(lambda r: r.sku, lambda r: r.qty, lambda r: r.price)
    assert {k: dict(v.items()) for k, v in dicts.items()} == {"A": {2: 10.0, 4: 2.5}, "B": {1: 150.0, 5: 3.0}}


def test_array_group_reduce():
    rows = _rows()
    joined = rows.group_reduce(
        lambda r: r.sku, lambda _k: "", lambda acc, r: acc + r.sku
    )
    assert dict(joined.items()) == {"A": "AA", "B": "BB"}


def test_group_to_dicts_combine():
    rows = _rows()
    d = rows.group_to_dicts(
        lambda r: r.sku, lambda _r: "all", lambda r: r.price, combine=lambda a, b: a + b
    )
    assert {k: dict(v.items()) for k, v in d.items()} == {"A": {"all": 12.5}, "B": {"all": 153.0}}


# ─── set / dict sugar ────────────────────────────────────────────────────────


def test_set_sugar():
    s = _rows().to_set(lambda r: r.qty)  # {1, 2, 4, 5}
    assert s.sum() == 12
    assert s.mean() == pytest.approx(3.0)
    assert s.every(lambda x: x > 0) is True
    assert s.every(lambda x: x > 3) is False
    assert s.some(lambda x: x > 4) is True
    assert dict(s.group_sum(lambda x: x % 2).items()) == {0: 6, 1: 6}
    assert dict(s.group_size(lambda x: x % 2).items()) == {0: 2, 1: 2}
    assert {k: sorted(v) for k, v in s.group_to_arrays(lambda x: x % 2).items()} == {0: [2, 4], 1: [1, 5]}


def test_dict_sugar():
    d = _rows().to_dict(lambda r: r.sku, lambda r: r.price, combine=lambda a, b: a + b)
    assert d.mean() == pytest.approx(82.75)
    assert dict(d.group_size(lambda k, _v: k).items()) == {"A": 1, "B": 1}
    assert dict(d.group_sum(lambda _k, _v: "all").items()) == {"all": 165.5}
    assert dict(d.group_mean(lambda _k, _v: "all").items())["all"] == pytest.approx(82.75)
    assert dict(d.group_every(lambda _k, _v: "all", lambda _k, v: v > 1.0).items()) == {"all": True}
    arrays = d.group_to_arrays(lambda _k, _v: "g", lambda _k, v: v)
    assert {k: sorted(v) for k, v in arrays.items()} == {"g": [12.5, 153.0]}
    dicts = d.group_to_dicts(lambda _k, _v: "g", lambda k, _v: k, lambda _k, v: v)
    assert {k: dict(v.items()) for k, v in dicts.items()} == {"g": {"A": 12.5, "B": 153.0}}


def test_set_first_map_none_decodes():
    """Regression for the bridge decode: SetFirstMap's none result carries no
    case index and must resolve by name."""
    s = _rows().to_set(lambda r: r.qty)
    result = s.first_map(lambda _x: none, out=IntegerType)
    assert result.type == "none"


# ─── East.DateTime namespace sugar ───────────────────────────────────────────


def test_datetime_namespace_sugar():
    dt = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
    assert East.DateTime.add_days(dt, 2) == datetime(2026, 7, 12, 12, 0, tzinfo=UTC)
    assert East.DateTime.add_days(dt, 1.5) == datetime(2026, 7, 12, 0, 0, tzinfo=UTC)
    assert East.DateTime.subtract_hours(dt, 6) == datetime(2026, 7, 10, 6, 0, tzinfo=UTC)
    assert East.DateTime.duration_days(East.DateTime.add_weeks(dt, 1), dt) == 7.0
    assert East.DateTime.duration_seconds(dt, East.DateTime.add_minutes(dt, 1)) == -60.0
    assert East.DateTime.duration_hours(East.DateTime.add_seconds(dt, 7200), dt) == 2.0
