#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR push-down tests: traced kernels + eager-method integration (issue #256).

``east.expression`` traces pure python lambdas into East IR compiled by east-c;
eager collection methods push callbacks down automatically when the purity
gate allows, and fall back to the per-element python path otherwise.
"""

import pytest

from east import (
    EastBlob,
    ExpressionError,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    if_else,
    kernel,
    none,
    some,
)
from east.expression import _eligible, try_push_down
from east.types.values.structural import EastFunction

ROW = StructType([("sku", StringType), ("price", FloatType), ("qty", FloatType)])

CSV = b"sku,price,qty\nA-1,2.5,4.0\nB-2,150.0,1.0\nA-1,10.0,2.0\n"


def _rows():
    return EastBlob(CSV).decode_csv(ROW)


# ─── explicit kernels ────────────────────────────────────────────────────────


def test_kernel_arithmetic():
    k = kernel(ROW, lambda r: r.price * r.qty)
    assert k({"sku": "x", "price": 2.5, "qty": 4.0}) == 10.0


def test_kernel_comparison_and_boolean_algebra():
    k = kernel(ROW, lambda r: (r.sku == "A-1") & (r.price > 100.0))
    assert k({"sku": "A-1", "price": 150.0, "qty": 1.0}) is True
    assert k({"sku": "B-2", "price": 150.0, "qty": 1.0}) is False


def test_kernel_where_conditional():
    k = kernel(ROW, lambda r: if_else(r.qty > 0.0, r.price / r.qty, 0.0))
    assert k({"sku": "x", "price": 10.0, "qty": 4.0}) == 2.5
    assert k({"sku": "x", "price": 10.0, "qty": 0.0}) == 0.0


def test_kernel_multi_param_fold_step():
    step = kernel([FloatType, ROW], lambda acc, r: acc + r.price)
    assert step(1.0, {"sku": "x", "price": 2.5, "qty": 0.0}) == 3.5


def test_kernel_integer_and_string_ops():
    ki = kernel(IntegerType, lambda x: (x * x) + 1)
    assert ki(7) == 50
    ks = kernel(ROW, lambda r: r.sku.upper() + "!")
    assert ks({"sku": "abc", "price": 0.0, "qty": 0.0}) == "ABC!"


def test_kernel_untraceable_raises():
    with pytest.raises(ExpressionError, match="cannot be traced"):
        kernel(ROW, lambda r: r.price if r.qty > 0 else 0.0)


def test_kernel_out_mismatch_raises():
    with pytest.raises(TypeError, match="expected"):
        kernel(ROW, lambda r: r.price, out=StringType)


def test_kernel_type_errors_are_loud():
    with pytest.raises(ExpressionError, match="no field"):
        kernel(ROW, lambda r: r.missing)
    with pytest.raises(ExpressionError, match="coercion"):
        kernel(ROW, lambda r: r.price + r.sku.length())


# The #624 operator-fork pins live in test_expression_operators.py, spelled
# with the East.function builder (#625).


# ─── the purity gate ────────────────────────────────────────────────────────


def test_gate_accepts_pure_lambdas():
    assert _eligible(lambda r: r.price * r.qty)
    rate = 1.1
    assert _eligible(lambda r: r.price * rate)  # scalar closure is stable


def test_gate_rejects_module_and_callable_references():
    import random

    assert not _eligible(lambda r: random.random())
    model = {"weights": 1.0}
    assert not _eligible(lambda r: model["weights"])  # mutable closure


def test_gate_rejects_closure_mutation():
    count = 0

    def bump(r):
        nonlocal count
        count += 1
        return r

    assert not _eligible(bump)


def test_try_push_down_respects_declared_output():
    # Declared Boolean output but traced Float -> no push-down (the python
    # path's truthiness semantics are preserved)
    from east.types.types import BooleanType

    ef = EastFunction(lambda el, idx: el, [FloatType, IntegerType], BooleanType)
    assert try_push_down(ef) is None


# ─── eager-method integration (implicit push-down) ──────────────────────────


def test_map_pushes_down_pure_lambda():
    amounts = _rows().map(lambda r: r["price"] * r["qty"])
    assert list(amounts) == [10.0, 150.0, 20.0]


def test_map_accepts_precompiled_kernel():
    k = kernel(ROW, lambda r: r.price * r.qty)
    amounts = _rows().map(k)
    assert list(amounts) == [10.0, 150.0, 20.0]


def test_filter_pushes_down_and_matches_python_semantics():
    rows = _rows()
    hot = rows.filter(lambda r: (r["sku"] == "A-1") & (r["price"] > 5.0))
    assert [r["price"] for r in hot] == [10.0]


def test_filter_truthiness_falls_back():
    # Python truthiness on a Float is untraceable as Boolean — must still work
    rows = _rows().filter(lambda r: r["qty"] - 1.0)
    assert [r["sku"] for r in rows] == ["A-1", "A-1"]


def test_fold_pushes_down():
    total = _rows().fold(0.0, lambda acc, r: acc + r["price"] * r["qty"])
    assert total == 180.0


def test_impure_lambda_keeps_python_semantics():
    seen = []
    rows = _rows()
    doubled = rows.map(lambda r: (seen.append(r["sku"]), r["price"] * 2.0)[1])
    assert list(doubled) == [5.0, 300.0, 20.0]
    # map() samples fn on the first element to infer the output type (a
    # pre-existing behaviour), then the python path runs once per element —
    # crucially NOT once total, which is what a mis-applied trace would give
    assert seen == ["A-1", "A-1", "B-2", "A-1"]


def test_group_by_native_path():
    groups = _rows().group_by(lambda r: r["sku"])
    assert sorted(groups.keys()) == ["A-1", "B-2"]
    assert [r["price"] for r in groups["A-1"]] == [2.5, 10.0]
    assert [r["price"] for r in groups["B-2"]] == [150.0]


def test_to_dict_and_sorted_push_down():
    rows = _rows()
    total_by_sku = rows.to_dict(
        key=lambda r: r["sku"],
        value=lambda r: r["price"] * r["qty"],
        combine=lambda a, b: a + b,
    )
    assert total_by_sku["A-1"] == 30.0
    assert total_by_sku["B-2"] == 150.0

    by_price = rows.sorted(key=lambda r: r["price"])
    assert [r["price"] for r in by_price] == [2.5, 10.0, 150.0]


def test_map_with_where_and_closure_scalar():
    minimum = 5.0
    clamped = _rows().map(lambda r: if_else(r["price"] < minimum, minimum, r["price"]))
    assert list(clamped) == [5.0, 150.0, 10.0]


# ─── struct attribute access (uniform lambda DX on both paths) ──────────────


def test_struct_field_attribute_access():
    rows = _rows()
    assert rows[0].sku == "A-1"
    assert rows[0].price == 2.5
    with pytest.raises(AttributeError, match="no attribute or field"):
        _ = rows[0].missing
    # methods still shadow fields; item access always works
    assert rows[0]["qty"] == 4.0


def test_attribute_lambdas_work_on_both_paths():
    rows = _rows()
    traced = rows.map(lambda r: r.price * r.qty)
    sink = []
    python_path = rows.map(lambda r: (sink, r.price * r.qty)[1])
    assert list(traced) == list(python_path)


# ─── differential: traced and python paths must agree ───────────────────────

_DIFF_CASES = [
    ("map-arith", lambda rows, f: rows.map(f), lambda r: r.price * r.qty + 1.0),
    ("map-if-else", lambda rows, f: rows.map(f), lambda r: if_else(r.qty > 1.0, r.price, 0.0)),
    ("map-string", lambda rows, f: rows.map(f), lambda r: r.sku.lower() + "?"),
    ("filter-pred", lambda rows, f: rows.filter(f), lambda r: (r.price > 5.0) | (r.qty > 3.0)),
    ("sort-key", lambda rows, f: rows.sorted(key=f), lambda r: -r.price),
    ("toset-key", lambda rows, f: rows.to_set(f), lambda r: r.sku),
]


@pytest.mark.parametrize(("name", "invoke", "fn"), _DIFF_CASES, ids=[c[0] for c in _DIFF_CASES])
def test_traced_matches_python_path(name, invoke, fn):
    rows = _rows()

    # the natural call: gate-eligible, so it traces into a native kernel
    assert _eligible(fn), f"{name}: expected the differential lambda to be traceable"

    traced = invoke(rows, fn)

    # force the python path with a gate-defeating (but semantically inert)
    # closure over a mutable object. Declare the wrapped arity explicitly:
    # a bare *args wrapper reads as "takes everything", and the eager
    # methods would then hand it the builtin's full (el, idx) signature.
    poison = []

    def python_fn(el):
        _ = poison
        return fn(el)

    python_result = invoke(rows, python_fn)

    if hasattr(traced, "keys"):
        assert sorted(traced.keys()) == sorted(python_result.keys())
    else:
        assert list(traced) == list(python_result)


# ─── options: `none` lifts into traced kernels (issue #376) ──────────────────


def test_kernel_where_some_none_traces_and_runs():
    # `none` as the else arm — its type resolves from the `some` sibling.
    k = kernel(ROW, lambda r: if_else(r.sku == "A-1", some(r.price), none))
    rows = _rows()
    assert [k(rows[i]) for i in range(len(rows))] == [some(2.5), none, some(10.0)]


def test_kernel_where_none_some_traces_and_runs():
    # `none` as the THEN arm (first) — if_else() must lift the sibling first.
    k = kernel(ROW, lambda r: if_else(r.sku == "A-1", none, some(r.price)))
    rows = _rows()
    assert [k(rows[i]) for i in range(len(rows))] == [none, some(150.0), none]


def test_kernel_bare_none_reports_missing_type_context():
    # A bare `none` has no type to infer — the type-from-context diagnostic must
    # fire. It was dead code because `none.value` is east_null, not Python None,
    # so callers got a generic "cannot lift" instead.
    with pytest.raises(ExpressionError, match="needs a type from context"):
        kernel(ROW, lambda r: none)


def test_option_lambda_pushes_down_natively():
    # The point of #376: an option-returning lambda must trace into a native
    # kernel rather than fall back to the per-element python path.
    ef = EastFunction(
        lambda el, idx: if_else(el.sku == "A-1", some(el.price), none),
        [ROW, IntegerType],
        OptionType(FloatType),
    )
    assert try_push_down(ef) is not None


def test_map_with_option_result_runs_native():
    out = _rows().map(
        lambda r: if_else(r.sku == "A-1", some(r.price), none),
        out=OptionType(FloatType),
    )
    assert list(out) == [some(2.5), none, some(10.0)]


def test_filter_map_some_none_pushes_down():
    # filter_map keeps `some`, drops `none`; it infers the inner type (no out=).
    kept = _rows().filter_map(lambda r: if_else(r.sku == "A-1", some(r.price), none))
    assert list(kept) == [2.5, 10.0]


# ─── #393: the whole builtin surface traces ──────────────────────────────────

SROW = StructType([("id", StringType), ("data", StringType)])


def test_namespace_builtins_trace():
    from east import East

    k = kernel([SROW], lambda r: East.String.substring(r.id, 0, 3))
    assert k({"id": "hello", "data": ""}) == "hel"
    k2 = kernel([SROW], lambda r: East.String.length(r.id) + East.String.index_of(r.id, "l"))
    assert k2({"id": "hello", "data": ""}) == 5 + 2
    k3 = kernel([StructType([("f", FloatType)])], lambda r: East.Float.sqrt(r.f))
    assert k3({"f": 9.0}) == 3.0


def test_split_then_integer_index():
    k = kernel([SROW], lambda r: r.data.split("|")[1])
    assert k({"id": "", "data": "a|b|c"}) == "b"


def test_collection_transforms_with_nested_lambdas():
    rows = {"id": "!", "data": "a|b|c"}
    assert list(kernel([SROW], lambda r: r.data.split("|").map(lambda v: v + r.id))(rows)) == [
        "a!",
        "b!",
        "c!",
    ]
    assert list(
        kernel([SROW], lambda r: r.data.split("|").filter(lambda v: v != "b"))(rows)
    ) == ["a", "c"]
    assert kernel([SROW], lambda r: r.data.split("|").some(lambda v: v == "c"))(rows) is True
    assert kernel([SROW], lambda r: r.data.split("|").every(lambda v: v == "a"))(rows) is False
    assert (
        kernel([SROW], lambda r: r.data.split("|").fold(0, lambda acc, v: acc + v.length()))(rows)
        == 3
    )
    assert kernel([SROW], lambda r: r.data.split("|").string_join(","))(rows) == "a,b,c"


def test_captured_side_table_lookup():
    from east import EastDict

    table = EastDict(StringType, StringType, {"a": "A", "b": "B"})
    k = kernel([SROW], lambda r: table.get_or_default(r.id, "?"))
    assert k({"id": "a", "data": ""}) == "A"
    assert k({"id": "z", "data": ""}) == "?"
    # the multivalue TRANS shape: split -> per-value lookup -> re-join
    k2 = kernel(
        [SROW],
        lambda r: r.data.split("|").map(lambda v: table.get_or_default(v, "")).string_join("|"),
    )
    assert k2({"id": "", "data": "a|b|z"}) == "A|B|"
    # a table mutation after trace does NOT affect the compiled kernel (snapshot)
    table["a"] = "MUTATED"
    assert k({"id": "a", "data": ""}) == "A"


def test_captured_array_and_struct_constants():
    from east import EastArray, struct

    arr = EastArray(IntegerType, [10, 20, 30])
    k = kernel([StructType([("i", IntegerType)])], lambda r: arr.get(r.i))
    assert k({"i": 2}) == 30
    assert (
        kernel([StructType([("i", IntegerType)])], lambda r: arr.get_or_default(r.i, -1))({"i": 9})
        == -1
    )
    cfg = struct({"scale": 2.0}, StructType([("scale", FloatType)]))
    k2 = kernel([StructType([("f", FloatType)])], lambda r: r.f * cfg.scale)
    assert k2({"f": 3.0}) == 6.0


def test_try_get_array_and_dict():
    from east import EastDict

    table = EastDict(StringType, IntegerType, {"a": 1})
    k = kernel([SROW], lambda r: table.try_get(r.id).unwrap_or(0))
    assert k({"id": "a", "data": ""}) == 1
    assert k({"id": "z", "data": ""}) == 0
    k2 = kernel([SROW], lambda r: r.data.split("|").try_get(5).unwrap_or("na"))
    assert k2({"id": "", "data": "a"}) == "na"


def test_try_parse_strict_option():
    k = kernel([SROW], lambda r: r.id.try_parse(FloatType).unwrap_or(-1.0))
    assert k({"id": "5.5", "data": ""}) == 5.5
    # strict whole-string semantics (#392): prefix junk is none, not a prefix parse
    assert k({"id": "598-", "data": ""}) == -1.0
    assert k({"id": "$5", "data": ""}) == -1.0
    is_num = kernel([SROW], lambda r: r.id.try_parse(FloatType).is_some())
    assert is_num({"id": "2e3", "data": ""}) is True
    assert is_num({"id": "1.2.3", "data": ""}) is False


def test_struct_returning_kernel_single_pass():
    from east import EastDict

    table = EastDict(StringType, StringType, {"a": "A"})
    k = kernel(
        [SROW],
        lambda r: {
            "third": r.data.split("|").get_or_default(2, ""),
            "trans": r.data.split("|").map(lambda v: table.get_or_default(v, "")).string_join("|"),
            "n": r.id.try_parse(FloatType).unwrap_or(0.0),
        },
    )
    out = k({"id": "7.5", "data": "a|b|c"})
    assert out["third"] == "c"
    assert out["trans"] == "A||"
    assert out["n"] == 7.5


def test_rows_map_with_string_kernel():
    rows = _rows()
    k = kernel([ROW], lambda r: r.sku.split("-")[0])
    assert list(rows.map(k)) == ["A", "B", "A"]


def test_funnel_stays_eager_outside_kernels():
    from east import East

    assert East.String.substring("hello", 0, 3) == "hel"
    assert list(East.String.split("a|b", "|")) == ["a", "b"]


def test_untraceable_ops_still_fail_loud():
    with pytest.raises(ExpressionError):
        kernel([SROW], lambda r: r.data.split("|").map(lambda v: len(v)))
    with pytest.raises(ExpressionError):
        kernel([SROW], lambda r: r.id.try_parse("not a type"))


# ─── #393 hardening: differentials, empties, nesting, auto push-down ─────────


def test_traced_collection_ops_agree_with_eager():
    from east import EastArray

    data = "aa|b|ccc"
    eager = EastArray(StringType, data.split("|"))
    k_map = kernel([SROW], lambda r: r.data.split("|").map(lambda v: v.length()))
    assert list(k_map({"id": "", "data": data})) == list(
        eager.map(lambda v: v.length(), out=IntegerType)
    )
    k_filter = kernel([SROW], lambda r: r.data.split("|").filter(lambda v: v.length() > 1))
    assert list(k_filter({"id": "", "data": data})) == list(
        eager.filter(lambda v: v.length() > 1)
    )
    k_fold = kernel([SROW], lambda r: r.data.split("|").fold(0, lambda acc, v: acc + v.length()))
    assert k_fold({"id": "", "data": data}) == eager.fold(0, lambda acc, v: acc + v.length())


def test_quantifier_empty_semantics_match_eager():
    # some([]) is False, every([]) is True — on both paths.
    k_some = kernel([SROW], lambda r: r.data.split("|").filter(lambda v: v == "x").some(lambda v: True))
    k_every = kernel([SROW], lambda r: r.data.split("|").filter(lambda v: v == "x").every(lambda v: False))
    assert k_some({"id": "", "data": "a|b"}) is False
    assert k_every({"id": "", "data": "a|b"}) is True


def test_two_level_nesting_with_cross_references():
    # inner-inner lambda references BOTH the outer row and the mid lambda's
    # variable — regression for variable shadowing (fresh names per lambda).
    k = kernel(
        [SROW],
        lambda r: r.data.split(";")
        .map(
            lambda grp: grp.split("|")
            .filter(lambda v: v != grp.substring(0, 1))
            .map(lambda v: v + r.id)
            .string_join(",")
        )
        .string_join(";"),
    )
    # group "ab|c": first char "a" drops nothing -> "ab!,c!"; group "d" drops itself
    assert k({"id": "!", "data": "ab|c;d"}) == "ab!,c!;"


def test_captured_set_membership():
    from east import EastSet

    allowed = EastSet(StringType, ["a", "b"])
    k = kernel([SROW], lambda r: allowed.has(r.id))
    assert k({"id": "a", "data": ""}) is True
    assert k({"id": "z", "data": ""}) is False


def test_new_op_errors_are_loud_and_specific():
    with pytest.raises(ExpressionError, match="predicate must return Boolean"):
        kernel([SROW], lambda r: r.data.split("|").filter(lambda v: v.length()))
    with pytest.raises(ExpressionError, match="accumulator"):
        kernel([SROW], lambda r: r.data.split("|").fold(0, lambda acc, v: v))
    with pytest.raises(ExpressionError, match="string_join"):
        kernel([SROW], lambda r: r.data.split("|").map(lambda v: v.length()).string_join(","))


def test_namespace_lambda_pushes_down_automatically():
    from east import East

    fn = lambda r: East.String.upper_case(r.sku)  # noqa: E731
    assert _eligible(fn)
    pushed = try_push_down(EastFunction(fn, [ROW], StringType))
    assert pushed is not None
    assert list(_rows().map(fn)) == ["A-1", "B-2", "A-1"]


def test_method_string_lambda_pushes_down_automatically():
    fn = lambda r: r.sku.substring(0, 1)  # noqa: E731
    pushed = try_push_down(EastFunction(fn, [ROW], StringType))
    assert pushed is not None
    # Expression-only methods need out= (without it, map samples the lambda
    # on a decoded python value to infer the type - str has no .substring)
    assert list(_rows().map(fn, out=StringType)) == ["A", "B", "A"]


def test_captured_collection_does_not_auto_push_down():
    from east import EastDict

    table = EastDict(StringType, StringType, {"A-1": "first"})
    fn = lambda r: table.get_or_default(r.sku, "other")  # noqa: E731
    # mutable capture: the gate must refuse (tracing would snapshot the table)
    assert not _eligible(fn)
    assert try_push_down(EastFunction(fn, [ROW], StringType)) is None


def test_captured_constants_hoist_once_per_kernel():
    from east import EastDict
    from east.expression import trace

    table = EastDict(StringType, StringType, {"a": "A"})
    # trace() returns a homoiconic IR value (an EastVariant conforming to
    # IRType, #398) — assert the hoisting shape on the value tree directly.
    ir, _t, _binds = trace(
        lambda r: table.get_or_default(r.id, "") + table.get_or_default(r.data, ""), [SROW]
    )
    # the constant becomes ONE build-time Let (identity-deduped across both
    # use sites) captured by the kernel function - never rebuilt per call
    assert ir.type == "Block"
    lets = [s for s in ir.value["statements"] if s.type == "Let"]
    assert len(lets) == 1
    fn_node = list(ir.value["statements"])[-1]
    assert fn_node.type == "Function"
    assert len(fn_node.value["captures"]) == 1


def test_hoisted_constant_inside_nested_lambda_still_binds_once():
    from east import EastDict
    from east.expression import trace

    table = EastDict(StringType, StringType, {"a": "A"})
    ir, _t, _binds = trace(
        lambda r: r.data.split("|").map(lambda v: table.get_or_default(v, "")).string_join("|"),
        [SROW],
    )
    assert ir.type == "Block"
    assert sum(1 for s in ir.value["statements"] if s.type == "Let") == 1


# ─── #399: bind side-tables by reference (C-level partial application) ───────


def _bind_setup():
    from east import EastDict
    from east.types.types import DictType

    table = EastDict(StringType, FloatType, {"A-1": 2.0, "B-2": 3.0})
    k = kernel(
        [ROW, DictType(StringType, FloatType)],
        lambda r, t: t.get_or_default(r.sku, 0.0) * r.qty,
    )
    return table, k


def test_bind_stays_native_and_computes():
    table, k = _bind_setup()
    bound = k.bind(table)
    # the bound callable is still a native function value — eager methods
    # see _fn_val and keep the loop inside east-c (no trampoline)
    assert bound._eastc_handle._fn_val != 0
    assert list(_rows().map(bound)) == [8.0, 3.0, 4.0]
    # direct call works with the remaining arity
    assert bound({"sku": "B-2", "price": 0.0, "qty": 2.0}) == 6.0


def test_bind_live_semantics_observe_mutation():
    table, k = _bind_setup()
    bound = k.bind(table)
    assert list(_rows().map(bound)) == [8.0, 3.0, 4.0]
    # bind is BY REFERENCE: mutations after binding are observed (the
    # explicit opposite of the closure-capture snapshot contract)
    table["A-1"] = 100.0
    del table["B-2"]
    assert list(_rows().map(bound)) == [400.0, 0.0, 200.0]


def test_bind_rebinding_is_independent_and_unbound_stays_usable():
    from east import EastDict

    table, k = _bind_setup()
    bound = k.bind(table)
    other = EastDict(StringType, FloatType, {"A-1": -1.0})
    b2 = k.bind(other)
    assert list(_rows().map(b2)) == [-4.0, 0.0, -2.0]
    assert list(_rows().map(bound)) == [8.0, 3.0, 4.0]
    # the unbound kernel still takes both parameters
    assert k({"sku": "A-1", "price": 0.0, "qty": 1.0}, table) == 2.0


def test_bind_type_mismatch_is_loud():
    from east import EastDict

    _table, k = _bind_setup()
    with pytest.raises(TypeError, match="bind\\(\\) value 0 has East type"):
        k.bind(EastDict(StringType, StringType, {"x": "y"}))
    with pytest.raises(TypeError, match="needs at least one value"):
        k.bind()
    with pytest.raises(TypeError, match="3 values"):
        k.bind(_table, _table, _table)


def test_bind_requires_native_kernel():
    with pytest.raises(TypeError, match="compiled East kernel"):
        from east.runtime._compiler_eastc import bind_kernel

        bind_kernel(lambda x: x, (1.0,))


# ─── #409: precompiled kernels run natively through eager methods ────────────


def test_map_runs_precompiled_kernel_natively():
    from east.runtime.compiler import eager_stats

    k = kernel([ROW], lambda r: r.sku.substring(0, 1))
    rows = _rows()
    before = eager_stats()
    out = rows.map(k)
    after = eager_stats()
    # the kernel's native function value rides straight into ArrayMap:
    # zero per-element python, no re-trace
    assert after["trampoline_calls"] == before["trampoline_calls"]
    assert after["kernel_direct"] == before["kernel_direct"] + 1
    assert list(out) == ["A", "B", "A"]


def test_map_infers_output_from_kernel_handle_without_sampling():
    from east.runtime.compiler import eager_stats

    # struct-returning kernel, no out= — the output type comes from the
    # kernel's handle, not from sampling the kernel on a decoded row
    k = kernel([ROW], lambda r: {"s": r.sku, "v": r.price * r.qty})
    before = eager_stats()
    out = _rows().map(k)
    after = eager_stats()
    assert after["trampoline_calls"] == before["trampoline_calls"]
    assert [r["v"] for r in out] == [10.0, 150.0, 20.0]


def test_bound_kernel_maps_natively():
    from east import EastDict
    from east.runtime.compiler import eager_stats
    from east.types.types import DictType

    table = EastDict(StringType, FloatType, {"A-1": 2.0})
    k = kernel(
        [ROW, DictType(StringType, FloatType)],
        lambda r, t: t.get_or_default(r.sku, 0.0) * r.qty,
    )
    bound = k.bind(table)
    before = eager_stats()
    out = _rows().map(bound)
    after = eager_stats()
    assert after["trampoline_calls"] == before["trampoline_calls"]
    assert after["kernel_direct"] == after["kernel_direct"]  # sanity: key exists
    assert list(out) == [8.0, 0.0, 4.0]


def test_fold_runs_precompiled_step_kernel_natively():
    from east.runtime.compiler import eager_stats

    step = kernel([FloatType, ROW], lambda acc, r: acc + r.price)
    before = eager_stats()
    total = _rows().fold(0.0, step)
    after = eager_stats()
    assert after["trampoline_calls"] == before["trampoline_calls"]
    assert total == 162.5


def test_sorted_and_to_dict_run_kernel_callbacks_natively():
    from east.runtime.compiler import eager_stats

    kkey = kernel([ROW], lambda r: r.sku)
    before = eager_stats()
    out = _rows().sorted(key=kkey)
    after = eager_stats()
    assert after["trampoline_calls"] == before["trampoline_calls"]
    assert [r["sku"] for r in out] == ["A-1", "A-1", "B-2"]

    totals = _rows().to_dict(
        key=kernel([ROW], lambda r: r.sku),
        value=kernel([ROW], lambda r: r.price * r.qty),
        combine=kernel([FloatType, FloatType], lambda a, b: a + b),
    )
    assert totals["A-1"] == 30.0
    assert totals["B-2"] == 150.0


def test_builtin_shadowing_field_names_trace():
    from east import EastArray

    # A field named after a python builtin (`id`) must not poison the purity
    # gate: co_names contains ATTRIBUTE names, which are not globals.
    IdRow = StructType([("id", StringType)])
    fn = lambda r: r.id.substring(0, 3)  # noqa: E731
    assert _eligible(fn)
    rows = EastArray(IdRow, [{"id": "ABCDEF"}, {"id": "XYZ123"}])
    assert list(rows.map(fn, out=StringType)) == ["ABC", "XYZ"]
    # a REAL builtin reference still disables tracing
    assert not _eligible(lambda r: id(r))


def test_mismatched_kernel_output_falls_back_cleanly():
    from east.runtime.compiler import eager_stats

    # out= disagrees with the kernel's output type: the direct path must
    # refuse (no type confusion) and the per-element path still runs.
    k = kernel([ROW], lambda r: r.price * r.qty)  # Float out
    before = eager_stats()
    out = _rows().map(k, out=FloatType)  # matches — native
    after = eager_stats()
    assert after["trampoline_calls"] == before["trampoline_calls"]
    assert list(out) == [10.0, 150.0, 20.0]


# ─── #403: control-flow parity — first_map + short-circuiting some/every ────


def test_first_map_traces_and_matches_eager():
    from east import EastArray

    k = kernel(
        [SROW],
        lambda r: r.data.split("|")
        .first_map(lambda v: if_else(v.length() > 1, some(v.upper()), none))
        .unwrap_or("<none>"),
    )
    assert k({"id": "", "data": "a|bb|ccc"}) == "BB"
    assert k({"id": "", "data": "a|b"}) == "<none>"
    assert k({"id": "", "data": ""}) == "<none>"
    eager = EastArray(StringType, ["a", "bb", "ccc"])
    result = eager.first_map(
        lambda v: some(v.upper()) if len(v) > 1 else none, out=StringType
    )
    assert result.type == "some" and result.value == "BB"


def test_first_map_emits_firstmap_builtin_not_fold():
    from east.expression import trace

    ir, _t, _binds = trace(
        lambda r: r.data.split("|").first_map(lambda v: if_else(v == "x", some(v), none)),
        [SROW],
    )

    def builtins_in(node, acc):
        if getattr(node, "type", None) == "Builtin":
            acc.append(node.value["builtin"])
        payload = getattr(node, "value", None)
        if payload is None:
            return acc
        for field in ("arguments", "statements", "values", "captures", "parameters"):
            if field in payload:
                for child in payload[field]:
                    builtins_in(child, acc)
        for field in ("body", "struct", "variant", "value", "try_body", "catch_body"):
            if field in payload:
                builtins_in(payload[field], acc)
        return acc

    names = builtins_in(ir, [])
    assert "ArrayFirstMap" in names


def test_quantifiers_short_circuit_like_eager():
    # The deciding element must STOP the scan: the poisoned tail (integer
    # division by zero) errors if evaluated, which the old fold encoding did.
    from east import East, EastArray
    from east.types.types import ArrayType

    IROW = StructType([("data", StringType)])
    k_some = kernel(
        [ArrayType(IntegerType)],
        lambda arr: arr.some(lambda v: East.Integer.divide(10, v) > 0),
    )
    assert k_some([2, 0]) is True  # v=2 decides; v=0 never evaluates
    k_every = kernel(
        [ArrayType(IntegerType)],
        lambda arr: arr.every(lambda v: East.Integer.divide(10, v) > 100),
    )
    assert k_every([2, 0]) is False  # v=2 is the counterexample; v=0 never evaluates
    # eager path agrees on the same data — the guard is spelled with the
    # dual-mode `if_else` (a python-`if` lambda would raise: a pure callback
    # that cannot trace surfaces loudly rather than silently trampolining)
    eager = EastArray(IntegerType, [2, 0])
    assert eager.some(
        lambda v: if_else(v != 0, East.Integer.divide(10, v) > 0, False)
    ) is True
    del IROW


def test_quantifier_error_message_unchanged():
    with pytest.raises(ExpressionError, match="predicate must return Boolean"):
        kernel([SROW], lambda r: r.data.split("|").some(lambda v: v.length()))


def test_first_map_out_pins_bare_none():
    k = kernel(
        [SROW],
        lambda r: r.data.split("|").first_map(lambda _v: none, out=StringType).is_none(),
    )
    assert k({"id": "", "data": "a|b"}) is True


def test_first_map_requires_option_result():
    with pytest.raises(ExpressionError, match="must return some"):
        kernel([SROW], lambda r: r.data.split("|").first_map(lambda v: v.length()))


def test_bind_multiple_trailing_parameters():
    from east import EastDict
    from east.types.types import DictType

    t1 = EastDict(StringType, FloatType, {"A-1": 2.0})
    t2 = EastDict(StringType, FloatType, {"B-2": 5.0})
    k = kernel(
        [ROW, DictType(StringType, FloatType), DictType(StringType, FloatType)],
        lambda r, a, b: a.get_or_default(r.sku, 0.0) + b.get_or_default(r.sku, 0.0),
    )
    bound = k.bind(t1, t2)
    assert list(_rows().map(bound)) == [2.0, 5.0, 2.0]
    # chained binding: bind the tables one at a time
    chained = k.bind(t2).bind(t1)
    assert list(_rows().map(chained)) == [2.0, 5.0, 2.0]

# ─── #411: trace-time CSE — shared subexpressions bind once ─────────────────


def test_shared_subexpression_binds_once():
    from east.expression import trace

    def build(r):
        fields = r.data.split("|")
        return {"a": fields.get_or_default(0, ""), "b": fields.get_or_default(1, "")}

    ir, _t, _binds = trace(build, [SROW])
    body = ir.value["body"]
    assert body.type == "Block"
    lets = [st for st in body.value["statements"] if st.type == "Let"]
    assert len(lets) == 1
    assert lets[0].value["value"].type == "Builtin"
    assert lets[0].value["value"].value["builtin"] == "StringSplit"
    # behaviour identical to the python path
    k = kernel([SROW], build)
    out = k({"id": "", "data": "x|y|z"})
    assert (out["a"], out["b"]) == ("x", "y")


def test_loop_invariant_shared_expr_hoists_out_of_inner_lambda():
    from east.expression import trace

    def build(r):
        prefix = r.id.substring(0, 2)  # outer-param expr ...
        return (
            r.data.split("|").map(lambda v: v + prefix).string_join(",")  # ... used inside
            + prefix                                                       # ... and outside
        )

    ir, _t, _binds = trace(build, [SROW])
    assert ir.value["body"].type == "Block"  # hoisted to the kernel body
    k = kernel([SROW], build)
    assert k({"id": "AB1", "data": "x|y"}) == "xAB,yAB" + "AB"


def test_inner_param_sharing_stays_inline():
    def build(r):
        return r.data.split("|").map(lambda v: v.substring(0, 1) + v.substring(0, 1)).string_join("")

    k = kernel([SROW], build)
    assert k({"id": "", "data": "ab|cd"}) == "aacc"


def test_inner_param_shadowing_top_param_does_not_hoist():
    # Inner lambda param named like the top param: sharing (r.upper() reused
    # via the immediately-applied helper) must stay INSIDE the inner lambda.
    def build(r):
        return r.data.split("|").map(lambda r: (lambda s: s + s)(r.upper())).string_join(",")

    k = kernel([SROW], build)
    assert k({"id": "", "data": "ab|c"}) == "ABAB,CC"
