#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Python-spelling regressions for the expression surface.

The pins the strict surface keeps LOCAL (test policy, #623): behavior that is
east-py's own spelling of the expression layer, not what a builtin computes.
Runtime-shared values belong to the TS compliance corpus, which every runtime
inherits.

Consolidated in #625 phase 3 from the issue-numbered suites — #558
(conditional hoisting, bind subsumption, the non-retraceable callee, match arm
typing), #561 (call lowering), #565 (for_each effect delivery) and #592 (the
runner emit sink) — which had grown three copies of the emit-sink helper, three
of the cause-chain walk, and three all-but-identical impure-callback refusals.
Each section keeps its issue's repro and its reason.
"""

import pytest
from east._eastc_bridge import c_function_value_type
from east.serialization._beast2_eastc import _EmitAccumCore

from east import (
    DictType,
    East,
    EastArray,
    EastDict,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    coerce_to,
    if_else,
    is_value_of,
    none,
    platform_function,
    some,
)
from east.expression import ExpressionError
from east.ir.builders import ir_function, ir_platform, ir_variable
from east.runtime.compiler import compile_from_value
from east.runtime.errors import EastError, NonRetraceableCallError

ROW = StructType([("k", StringType), ("v", FloatType)])
KEY_ROW = StructType([("k", StringType)])
TABLE_T = DictType(StringType, FloatType)
EMIT_T = FunctionType([StringType, FloatType], NullType)
LINE = StructType([("name", StringType), ("price", FloatType)])


def _rows() -> EastArray:
    return EastArray(ROW, [{"k": "a", "v": 1.0}, {"k": "b", "v": 2.0},
                           {"k": "c", "v": 3.0}])


def _key_rows() -> EastArray:
    return EastArray(KEY_ROW, [{"k": "hit"}, {"k": "MISS"}])


def _table() -> EastDict:
    return EastDict(StringType, FloatType, {"hit": 21.0})


def _python_helper(s):
    """A module-level helper that does python work — a refusal fixture."""
    return len(s)


def _bound_sink(base: float = 10.0):
    """A bound compiled callable — the shape of the e3 runner's ``emit``."""
    return East.function([StringType, FloatType, FloatType], FloatType,
                  lambda _b, key, v, b: v + b).bind(base)


def _accum(kind: str = "dict", emit_types=(StringType, FloatType)):
    """A live emit accumulator with inert boundary callbacks — the batch
    limits are far above every case here, so nothing crosses one."""
    return _EmitAccumCore({"array": 0, "set": 1, "dict": 2}[kind],
                          list(emit_types), 1 << 20, 1 << 20,
                          lambda: None, lambda: None, lambda: None)


def _drive(name, kind, emit_types, body):
    """Run ``body(emit)`` through a compiled Platform wrapper with a live
    accumulator emit — the streamTask runner topology — and return the
    drained batch parts."""
    core = _accum(kind, emit_types)
    emit_t = FunctionType(list(emit_types), NullType)
    platform = [{
        "name": name, "inputs": [emit_t], "output": NullType,
        "type": "sync", "fn": body,
    }]
    wrapper = ir_function(
        FunctionType([emit_t], NullType), [], [ir_variable(emit_t, "emit")],
        ir_platform(NullType, name, [ir_variable(emit_t, "emit")]))
    compile_from_value(wrapper, platform)(core.function_value(list(emit_types)))
    return core.take_batch()


def _assert_named_cause(call, cause_type=NonRetraceableCallError):
    """The capture failed AND named the real problem in its cause chain.

    The distinguished cause is what tells a reader which shape lowering
    declined (#558 C); without it the capture error alone reads as a generic
    refusal.
    """
    with pytest.raises(ExpressionError) as caught:
        call()
    cause = caught.value.__cause__
    for _ in range(6):
        if cause is None:
            break
        if isinstance(cause, cause_type):
            return
        cause = cause.__cause__
    raise AssertionError(f"{cause_type.__name__} missing from the cause chain")


# ── struct() is dual-mode, like if_else (#625) ──────────────────────────────


class TestStructConstructor:
    """``struct({...}, T)`` is the documented way to build a row, and it must
    mean the same thing inside a captured callback as outside one. Building an
    EAGER struct around expression proxies is the failure it replaces: the
    result would lift as a build-time "constant" referencing the callback's own
    parameters."""

    def test_struct_builds_the_row_inside_a_captured_callback(self):
        from east import struct

        items = EastArray(LINE, [{"name": "a", "price": 1.0},
                                 {"name": "b", "price": 2.0}])
        fx = 1.5
        out = items.map(lambda _b, r: struct(
            {"name": r["name"], "price": r["price"] * fx}, LINE))
        assert out.element_type == LINE
        assert [dict(r.items()) for r in out] == [
            {"name": "a", "price": 1.5}, {"name": "b", "price": 3.0}]
        # ...and the eager form on plain values is untouched
        assert dict(struct({"price": 1, "name": "a"}, LINE).items()) == \
            {"name": "a", "price": 1.0}

    def test_the_declared_type_fixes_the_field_order(self):
        # The eager `struct(fields, T)` REORDERS to the type's order; a dict
        # written in another order must not yield a differently-typed struct
        # just because its values happened to be traced.
        from east import struct

        items = EastArray(LINE, [{"name": "a", "price": 1.0}])
        out = items.map(lambda _b, r: struct({"price": r["price"], "name": r["name"]}, LINE))
        assert out.element_type == LINE

    def test_fields_that_do_not_match_the_declared_type_are_named(self):
        from east import struct

        items = EastArray(LINE, [{"name": "a", "price": 1.0}])
        with pytest.raises(ExpressionError, match=r"missing \['price'\]"):
            items.map(lambda _b, r: struct({"name": r["name"]}, LINE))

    def test_traced_parts_below_the_top_level_still_build_ir(self):
        # The proxy may sit BELOW the top level — inside a nested dict
        # literal or a some(...) — and the constructor must still build IR.
        # An eager struct built around one registered as a build-time
        # constant referencing the callback's own parameter, unbound where
        # the constant is evaluated: `RuntimeError: Undefined variable: __k0`.
        from east import struct

        Nested = StructType([("name", StringType),
                             ("inner", StructType([("x", FloatType)])),
                             ("o", OptionType(FloatType))])
        items = EastArray(LINE, [{"name": "a", "price": 1.0}])
        out = items.map(lambda _b, r: struct(
            {"name": r["name"], "inner": {"x": r["price"] * 2.0},
             "o": some(r["price"])}, Nested))
        assert out.element_type == Nested
        assert out[0]["inner"]["x"] == 2.0
        assert out[0]["o"] == some(1.0)

    def test_a_typed_variant_is_dual_mode_too(self):
        # `variant(case, payload, T)` eagerly COERCES the payload, which
        # cannot see a proxy — the 3-arg form builds Variant IR instead,
        # checking the case and the payload's type right here.
        from east import variant

        Source = VariantType([("vessel", StringType), ("added", NullType)])
        items = EastArray(LINE, [{"name": "a", "price": 1.0}])
        out = items.map(lambda _b, r: variant("vessel", r["name"], Source))
        assert [(v.type, v.value) for v in out] == [("vessel", "a")]
        with pytest.raises(ExpressionError, match="not in"):
            items.map(lambda _b, r: variant("boat", r["name"], Source))
        with pytest.raises(ExpressionError, match="payload has type Float"):
            items.map(lambda _b, r: variant("vessel", r["price"], Source))
        # ...and the eager form on plain values is untouched
        assert variant("added", None, Source).type == "added"


# ── a refusal names the binding it choked on (#625) ─────────────────────────


class TestRefusalNamesTheBinding:
    """"it does python work" is true but unactionable — the author has to
    guess WHICH reference has no East form. Each refusal names it, and for a
    callback the eager method wrapped, it names the binding the USER's body
    reads rather than the library wrapper's parameter."""

    @staticmethod
    def _refusal(fn) -> str:
        rows = EastArray(LINE, [{"name": "a", "price": 1.0}])
        with pytest.raises(ExpressionError, match="captured automatically") as caught:
            rows.map(fn)
        return str(caught.value)

    def test_a_module_reference_is_named(self):
        import random

        assert "references random" in self._refusal(lambda _b, r: random.random())

    def test_a_python_builtin_is_named(self):
        assert "references len" in self._refusal(lambda _b, r: len(r["name"]))

    def test_a_captured_mutable_collection_is_named(self):
        table = EastDict(StringType, FloatType, {"a": 1.0})
        assert "references table" in self._refusal(
            lambda _b, r: table.get_or_default(r["name"], 0.0))

    def test_a_mutated_python_capture_is_named(self):
        seen: list = []
        assert "references seen" in self._refusal(
            lambda _b, r: (seen.append(r["name"]), r["price"])[1])
        assert seen == []

    def test_a_global_helper_is_named_as_the_body_spells_it(self):
        # A refused GLOBAL is reported by the name the body reads — not by
        # whatever the helper reads internally, which the author never wrote.
        assert "references _python_helper" in self._refusal(
            lambda _b, r: _python_helper(r["name"]))

    def test_a_wrapped_callback_names_the_wrapped_bodys_binding(self):
        # The eager methods' arity adapters hold the user callback in a
        # closure cell; through THAT the refusal descends, so the name is the
        # user's binding, not the adapter's cell.
        import random

        def user_callback(r):
            return random.random()

        def adapter(r):
            return user_callback(r)

        assert "references random" in self._refusal(adapter)


class TestCallbackSlotArguments:
    def test_a_non_callable_in_a_callback_slot_is_named(self):
        # `_function_out_type` used to answer None for a non-callable and the
        # method then died on `None.value` — the caller's mistake surfaced as
        # an AttributeError deep inside the library.
        for call in (lambda: _rows().map(5), lambda: _rows().flat_map(5),
                     lambda: _rows().sum(5), lambda: _rows().to_dict(5)):
            with pytest.raises(TypeError, match="callback slot takes"):
                call()


# ── the CSE must not hoist across a conditional boundary (#558 A) ───────────


class TestConditionalHoist:
    """A shared Let hoisted above an ``if_else`` evaluates on the miss path
    too: the guarded `if_else(d.has(k), some(build(d[k])), none)` spelling
    raised `Dict does not contain key` whenever `build` read the hit through
    one shared variable. An occurrence on an unconditional path keeps the
    hoist."""

    def test_guarded_lookup_shared_by_a_build_survives_the_miss_path(self):
        # The repro: the hit is read through ONE shared variable (three field
        # uses -> one CSE'd Let).
        V = StructType([("a", FloatType), ("b", FloatType), ("c", FloatType)])
        D = DictType(StringType, V)
        t = EastDict(StringType, V)
        t.insert("hit", {"a": 1.0, "b": 2.0, "c": 3.0})

        def build(v):
            return {"x": v["a"], "y": v["b"], "z": v["c"]}

        k = East.function(
            [KEY_ROW, D],
            OptionType(StructType([("x", FloatType), ("y", FloatType), ("z", FloatType)])),
            lambda _b, r, d: if_else(d.has(r["k"]), some(build(d[r["k"]])), none))
        out = list(_key_rows().map(k.bind(t)))
        assert out[0].type == "some" and out[0].value["x"] == 1.0
        assert out[1].type == "none"

    def test_an_unconditional_occurrence_keeps_the_hoist(self):
        # The same shared expression used in the PREDICATE and the branch is
        # evaluated on every path, so hoisting it stays legal — and the
        # result must be unchanged.
        k = East.function([KEY_ROW, TABLE_T], FloatType,
                   lambda _b, r, d: if_else(d.get_or_default(r["k"], 0.0) > 1.0,
                                        d.get_or_default(r["k"], 0.0), 0.0))
        assert list(_key_rows().map(k.bind(_table()))) == [21.0, 0.0]

    def test_a_guarded_partial_read_inside_match_does_not_leak_either(self):
        # Match case bodies are conditional arms too.
        k = East.function([KEY_ROW, TABLE_T], FloatType,
                   lambda _b, r, d: d.try_get(r["k"]).match({
                       "some": lambda _b, v: v + v,          # shared payload use
                       "none": lambda _b, _: 0.0,
                   }))
        assert list(_key_rows().map(k.bind(_table()))) == [42.0, 0.0]


# ── bind() type-checks by SUBSUMPTION, not content inference (#558 B) ───────


class TestBindSubsumption:
    """`bind()` compared parameters by CONTENT inference (`type_of`), so a
    struct holding an Option field could never bind — a `none` infers as a
    degenerate none-only variant. The check is `is_value_of` against the
    declared parameter type."""

    V = StructType([("name", OptionType(StringType)), ("qty", OptionType(FloatType)),
                    ("tag", StringType)])

    def test_a_none_valued_struct_binds_against_its_declared_type(self):
        sentinel = coerce_to({"name": none, "qty": none, "tag": ""}, self.V)
        k = East.function([StringType, self.V], StringType, lambda _b, s, ab: ab["name"].unwrap_or(s))
        assert k.bind(sentinel)("fallback") == "fallback"

    def test_a_some_valued_struct_binds_too(self):
        filled = coerce_to({"name": some("x"), "qty": some(1.0), "tag": "t"}, self.V)
        k = East.function([StringType, self.V], StringType, lambda _b, s, ab: ab["name"].unwrap_or(s))
        assert k.bind(filled)("fallback") == "x"

    def test_a_genuinely_wrong_value_is_still_refused(self):
        with pytest.raises(TypeError, match="expects"):
            East.function([StringType, self.V], StringType,
                   lambda _b, s, ab: ab["tag"]).bind(coerce_to(1.0, FloatType))


# ── calling an already-compiled East function from a captured body (#561) ───


class TestCallLowering:
    """A captured body that CALLS a compiled East function value — a `.bind`
    result, a `compile_from_value` function, a runner-supplied FunctionType
    input — lowers the call to the IR ``Call`` node instead of re-tracing the
    callee: the callee rides as a hidden trailing parameter, bound by
    reference after compilation, so the loop, the function and the callee all
    execute inside east-c."""

    def test_explicit_function_over_a_bind_result_compiles_and_matches_eager(self):
        sink = _bound_sink()
        k = East.function([ROW], FloatType, lambda _b, r: sink(r["k"], r["v"]))
        assert [k(r) for r in _rows()] == [11.0, 12.0, 13.0]
        assert list(_rows().map(k)) == [11.0, 12.0, 13.0]

    def test_a_compile_from_value_function_is_callable_in_a_trace(self):
        from east.ir.builders import ir_builtin, ir_value

        x = ir_variable(IntegerType, "x")
        body = ir_builtin(IntegerType, "IntegerAdd", [],
                          [ir_variable(IntegerType, "x"), ir_value(IntegerType, 1)])
        add1 = compile_from_value(
            ir_function(FunctionType([IntegerType], IntegerType), [], [x], body))
        assert add1(41) == 42
        assert East.function([IntegerType], IntegerType, lambda _b, n: add1(n) * 2)(20) == 42

    def test_the_captured_loop_runs_whole_native(self):
        # The production shape: a capturable lambda calling a bound native
        # function captures whole — the call lowers to an IR Call, and the
        # capture succeeding IS the proof there is no python per element.
        sink = _bound_sink()
        assert list(_rows().map(lambda _b, e: sink(e["k"], e["v"]) * 2.0)) == \
            [22.0, 24.0, 26.0]

    def test_one_callee_called_at_many_sites_binds_once(self):
        sink = _bound_sink()
        k = East.function([ROW], FloatType, lambda _b, r: sink(r["k"], r["v"]) + sink(r["k"], 0.0))
        assert k({"k": "x", "v": 2.0}) == 12.0 + 10.0

    def test_a_bound_side_table_lookup_observes_later_mutations(self):
        # bind is BY REFERENCE (#399): the lowered Call goes through the same
        # bound function value, so the live semantics carry through the
        # nested function too.
        table = EastDict(StringType, FloatType, {"a": 21.0})
        lookup = East.function([StringType, TABLE_T], FloatType,
                        lambda _b, key, d: d.get_or_default(key, 0.0)).bind(table)
        outer = East.function([ROW], FloatType, lambda _b, r: lookup(r["k"]))
        assert list(_rows().map(outer)) == [21.0, 0.0, 0.0]
        table["a"] = 5.0
        table["b"] = 7.0
        assert list(_rows().map(outer)) == [5.0, 7.0, 0.0]

    def test_dict_to_array_with_a_bound_function_runs_native(self):
        # The #558 C repro, upgraded: the Dict callback takes the builtin's
        # own (value, key) order, the call on the bound function lowers, and
        # the whole conveniences path compiles — no ExpressionError.
        d = EastDict(StringType, FloatType, {"a": 1.0, "b": 2.0})
        side = EastDict(StringType, FloatType, {"a": 10.0})
        out_t = StructType([("k", StringType), ("v", FloatType)])
        entry = East.function(
            [FloatType, StringType, TABLE_T], ROW,
            lambda _b, val, key, s: {"k": key, "v": val + s.get_or_default(key, 0.0)})
        rows = d.to_array(entry.bind(side))
        assert [(r["k"], r["v"]) for r in rows] == [("a", 11.0), ("b", 2.0)]
        assert rows.element_type == out_t

    def test_a_well_typed_call_compiles_where_it_once_raised(self):
        # Superseded by #561: the call lowers to the IR Call node, so the
        # explicit function that used to raise now compiles and runs.
        sink = _bound_sink(0.0)
        assert East.function([StringType], FloatType, lambda _b, s: sink(s, 1.0))("x") == 1.0


class TestFunctionTypeParameters:
    """``FunctionType`` parameters are callable — and bindable — the same way."""

    FT = FunctionType([FloatType], FloatType)

    def test_a_function_typed_parameter_is_callable(self):
        k = East.function([FloatType, self.FT], FloatType, lambda _b, x, f: f(x) + 1.0)
        assert k(3.0, East.function([FloatType], FloatType, lambda _b, v: v * 2.0)) == 7.0

    def test_a_function_typed_parameter_binds_a_function_value(self):
        k = East.function([FloatType, self.FT], FloatType, lambda _b, x, f: f(x) + 1.0)
        bound = k.bind(East.function([FloatType], FloatType, lambda _b, v: v * 2.0))
        assert bound(3.0) == 7.0
        assert list(EastArray(FloatType, [1.0, 2.0]).map(bound)) == [3.0, 5.0]

    def test_a_wrong_signature_function_is_refused_by_bind(self):
        k = East.function([FloatType, self.FT], FloatType, lambda _b, x, f: f(x) + 1.0)
        with pytest.raises(TypeError, match="expects"):
            k.bind(East.function([StringType], StringType, lambda _b, s: s))

    def test_calling_a_non_function_expression_raises(self):
        with pytest.raises(ExpressionError, match="non-function"):
            East.function([FloatType], FloatType, lambda _b, x: x(1.0))

    def test_arity_mismatch_on_a_parameter_call_raises(self):
        with pytest.raises(ExpressionError, match="argument"):
            East.function([FloatType, self.FT], FloatType, lambda _b, x, f: f(x, x))


class TestAsyncCallee:
    def test_calling_an_async_function_value_names_the_problem(self):
        from east.ir.builders import ir_async_function, ir_builtin, ir_value
        from east.types.types import AsyncFunctionType

        x = ir_variable(IntegerType, "x")
        body = ir_builtin(IntegerType, "IntegerAdd", [],
                          [ir_variable(IntegerType, "x"), ir_value(IntegerType, 1)])
        af = compile_from_value(
            ir_async_function(AsyncFunctionType([IntegerType], IntegerType), [], [x], body),
            is_async=True)
        with pytest.raises(ExpressionError, match="sync East function body"):
            East.function([IntegerType], IntegerType, lambda _b, n: af(n))


class TestStrictCapture:
    """python work around a native callee has no capture (#625): the raise
    lands before any row runs, and the explicit loop is the sanctioned
    boundary for python semantics."""

    def test_a_genuinely_python_wrapper_is_refused(self):
        sink = _bound_sink()
        seen: list[float] = []
        with pytest.raises(ExpressionError, match="captured automatically"):
            _rows().for_each(lambda _b, e: seen.append(sink(e["k"], e["v"])))
        assert seen == []
        for e in _rows():
            seen.append(sink(e["k"], e["v"]))
        assert seen == [11.0, 12.0, 13.0]

    def test_an_arity_mismatched_call_declines_and_raises_the_named_cause(self):
        # Lowering declines shapes it cannot type — the pre-#561 contract
        # (and the #558 C cause chain) survives for exactly those.
        sink = _bound_sink()
        _assert_named_cause(
            lambda: East.function([StringType], FloatType, lambda _b, s: sink(s)))


# ── match settles its output type from a some(...) arm (#558 D) ─────────────


class TestMatchArmTyping:
    """`.match()` settles from ANY arm that can state a type without a hint —
    including a `some(expr)` arm, which arrives as an EastVariant wrapping the
    traced payload — so a sibling bare-`none` arm types from it, exactly as
    `if_else(...)` always has."""

    def test_a_none_arm_types_from_the_sibling_some_arm(self):
        k = East.function([KEY_ROW, TABLE_T], OptionType(FloatType),
                   lambda _b, r, d: d.try_get(r["k"]).match({
                       "some": lambda _b, v: some(v * 2.0),
                       "none": lambda _b, _: none,
                   }))
        out = list(_key_rows().map(k.bind(_table())))
        assert out[0].type == "some" and out[0].value == 42.0
        assert out[1].type == "none"

    def test_arm_order_does_not_matter(self):
        # Option declares `none` first, so the none HANDLER is evaluated
        # first — the settle pass must look across all arms, not stop at
        # the first.
        k = East.function([KEY_ROW, TABLE_T], OptionType(FloatType),
                   lambda _b, r, d: d.try_get(r["k"]).match({
                       "none": lambda _b, _: none,
                       "some": lambda _b, v: some(v + 1.0),
                   }))
        out = list(_key_rows().map(k.bind(_table())))
        assert out[0].value == 22.0 and out[1].type == "none"


# ── for_each must not discard a captured callback's effect (#565) ───────────


class TestForEachDelivers:
    """The eager ``for_each`` wrappers used to spell "call it, return null" as
    ``(fn(el), east_null)[1]``. Captured, ``fn(el)`` returns the lowered Call
    EXPRESSION (#561, e.g. the streamTask runner's native emit) and the python
    tuple threw it away before it reached the IR: the loop compiled to a null
    body and every emitting task "succeeded" with a zero-row output."""

    def test_array_for_each_delivers_every_row(self):
        def body(emit):
            _rows().for_each(lambda _b, r: emit(r["k"]))

        (elems,) = _drive("regr565.array", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]

    def test_array_for_each_with_index_delivers(self):
        # the arity-2 wrapper branch
        def body(emit):
            _rows().for_each(lambda _b, r, i: emit(r["k"]))

        (elems,) = _drive("regr565.array2", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]

    def test_dict_kind_emit_delivers_pairs(self):
        def body(emit):
            _rows().for_each(lambda _b, r: emit(r["k"], r["v"]))

        keys, values = _drive("regr565.dict", "dict", [StringType, FloatType], body)
        assert list(keys) == ["a", "b", "c"]
        assert list(values) == [1.0, 2.0, 3.0]

    def test_set_for_each_delivers(self):
        from east import EastSet

        def body(emit):
            EastSet(StringType, ["x", "y"]).for_each(lambda _b, e: emit(e))

        (elems,) = _drive("regr565.set", "array", [StringType], body)
        assert sorted(elems) == ["x", "y"]

    def test_dict_for_each_delivers(self):
        def body(emit):
            EastDict(StringType, FloatType, {"p": 1.0, "q": 2.0}).for_each(
                lambda _b, v, k: emit(k, v))

        keys, values = _drive("regr565.dfe", "dict", [StringType, FloatType], body)
        assert list(keys) == ["p", "q"]
        assert list(values) == [1.0, 2.0]

    def test_for_each_matches_map_delivery(self):
        # map always delivered (its call IS the returned expression); the fix
        # makes for_each equivalent for effect.
        def via_map(emit):
            _rows().map(lambda _b, r: emit(r["k"]))

        def via_for_each(emit):
            _rows().for_each(lambda _b, r: emit(r["k"]))

        (m,) = _drive("regr565.viamap", "array", [StringType], via_map)
        (f,) = _drive("regr565.viafe", "array", [StringType], via_for_each)
        assert list(m) == list(f) == ["a", "b", "c"]


class TestNonNullCallback:
    """A non-Null captured expression still executes: ``_sequence_effect``
    wraps it in ``Block([expr, null])`` so the wrapper still types -> Null."""

    def test_non_null_pure_body_compiles_and_runs(self):
        add = East.function([FloatType, FloatType], FloatType, lambda _b, a, b: a + b).bind(1.0)
        _rows().for_each(lambda _b, r: add(r["v"]))  # must not raise

    def test_non_null_body_before_an_emit_still_delivers_elsewhere(self):
        add = East.function([FloatType, FloatType], FloatType, lambda _b, a, b: a + b).bind(1.0)

        def body(emit):
            _rows().for_each(lambda _b, r: add(r["v"]))
            _rows().for_each(lambda _b, r: emit(r["k"]))

        (elems,) = _drive("regr565.mixed", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]


class TestPythonEffectBoundary:
    def test_python_side_effects_need_an_explicit_loop(self):
        seen: list[str] = []
        with pytest.raises(ExpressionError, match="captured automatically"):
            _rows().for_each(lambda _b, r: seen.append(r["k"]))
        assert seen == []
        for r in _rows():
            seen.append(r["k"])
        assert seen == ["a", "b", "c"]

    def test_python_emit_wrapper_delivers_through_an_explicit_loop(self):
        # the tests/drivers shape: python work around emit — the explicit
        # loop is the boundary, and emit called on plain values marshals one
        # row through the C path per call.
        def body(emit):
            order: list[str] = []
            for r in _rows():
                order.append(r["k"])
                emit(r["k"])
            assert order == ["a", "b", "c"]

        (elems,) = _drive("regr565.pywrap", "array", [StringType], body)
        assert list(elems) == ["a", "b", "c"]


class TestIrPlatformBuilder:
    def test_hand_built_platform_node_compiles(self):
        # ir_platform omitted `optional`; conversion failed with
        # KeyError: 'optional' before the fix. _drive's wrapper already
        # exercises it — this pins the minimal case with a value result.
        platform = [{
            "name": "regr565.answer", "inputs": [], "output": FloatType,
            "type": "sync", "fn": lambda: 42.0,
        }]
        wrapper = ir_function(FunctionType([], FloatType), [], [],
                              ir_platform(FloatType, "regr565.answer", []))
        assert compile_from_value(wrapper, platform)() == 42.0


# ── the native emit sink is a CALL WRAPPER, not a value holder (#592) ───────


class TestTheSinkIsACallWrapper:
    """``_EmitAccumCore.function_value()`` used to return a bare hold: it
    carried ``_east_c_handle`` so the bridge could pass it *as a value* (all
    the runner needs), but it had no ``__call__``. A harness invoking a
    ``@platform_function`` DIRECTLY from python gets the sink handed to the
    body as-is, so a capturable emit callback captured, called the hold, and
    died with ``'_EmitFnHold' object is not callable``."""

    def test_the_function_value_is_callable(self):
        assert callable(_accum().function_value([StringType, FloatType]))

    def test_it_still_carries_the_conversion_fast_path_handle(self):
        # `_east_c_handle` is what lets the capture reference it and what
        # `_py_function_to_c` passes straight through — the value path (the
        # runner's own) must be untouched by the wrapper change.
        emit = _accum().function_value([StringType, FloatType])
        assert getattr(emit, "_east_c_handle", None) is not None

    def test_the_declared_signature_still_answers(self):
        # Signature introspection gates `bind` and `is_value_of` on function
        # values, whose contents cannot be inspected any other way.
        emit = _accum().function_value([StringType, FloatType])
        assert c_function_value_type(emit._east_c_handle) == EMIT_T
        assert is_value_of(emit, EMIT_T)


class TestPythonDrivenBodyCaptures:
    def test_a_pure_emit_callback_runs_with_zero_python_per_row(self):
        # THE issue: the harness shape — a @platform_function invoked directly
        # from python, handed the sink as its emit capability. The callback
        # captures; the emit call lowers to a native IR Call and the sink
        # rides as a hidden bound parameter, so no python runs per row.
        core = _accum()

        @platform_function(inputs=[DictType(StringType, FloatType), EMIT_T],
                           output=NullType, name="regr592.double_all")
        def double_all(rows, emit):
            rows.for_each(lambda _b, v, k: emit(k, v * 2.0))

        rows = EastDict(StringType, FloatType,
                        {f"k{i}": float(i) for i in range(5)})
        double_all(rows, core.function_value([StringType, FloatType]))

        keys, values = core.take_batch()
        assert list(keys) == [f"k{i}" for i in range(5)]
        assert list(values) == [2.0 * i for i in range(5)]

    def test_a_plain_captured_callback_delivers_every_row(self):
        # The same capture without the platform-function wrapper: the sink
        # is an ordinary closure capture of the callback.
        core = _accum()
        emit = core.function_value([StringType, FloatType])
        _rows().for_each(lambda _b, r: emit(r["k"], r["v"]))

        keys, values = core.take_batch()
        assert list(keys) == ["a", "b", "c"]
        assert list(values) == [1.0, 2.0, 3.0]

    def test_one_sink_called_at_two_sites_binds_once_and_delivers_both(self):
        # The registry dedupes the callee by its C function-value pointer, so
        # two captured loops over one sink bind one hidden parameter each and
        # both sets of rows land.
        core = _accum("array", (StringType,))
        emit = core.function_value([StringType])
        _rows().for_each(lambda _b, r: emit(r["k"]))
        _rows().for_each(lambda _b, r: emit(r["k"]))

        (elems,) = core.take_batch()
        assert list(elems) == ["a", "b", "c", "a", "b", "c"]

    def test_the_value_path_is_unchanged(self):
        # The runner's own topology: the wrapper is passed as a VALUE to a
        # compiled body's FunctionType parameter (never called from python).
        core = _accum()
        emit = core.function_value([StringType, FloatType])
        project = East.function([ROW, EMIT_T], NullType,
                                lambda _b, r, e: e(r["k"], r["v"])).bind(emit)
        _rows().map(project)

        keys, _values = core.take_batch()
        assert list(keys) == ["a", "b", "c"]


class TestSinkPythonBoundaryCall:
    def test_calling_it_marshals_one_row_through_the_c_path(self):
        core = _accum()
        emit = core.function_value([StringType, FloatType])
        emit("a", 1.0)
        emit("b", 2.0)

        assert core.emitted == 2
        keys, values = core.take_batch()
        assert list(keys) == ["a", "b"] and list(values) == [1.0, 2.0]

    def test_it_is_the_same_acceptance_path_as_the_core_entry(self):
        # Same rows, same C accept — so the duplicate-key refusal (and its
        # message) reaches a python caller through either door.
        core = _accum()
        emit = core.function_value([StringType, FloatType])
        emit("a", 1.0)
        with pytest.raises(EastError, match='duplicate Dict key emitted: "a"'):
            emit("a", 2.0)

    def test_it_keeps_the_accumulator_alive_on_its_own(self):
        # The wrapper is the only python reference left, and the accumulator
        # survives behind the C value's userdata retain — a runner or harness
        # may hand `function_value()` on and drop the core.
        import gc

        emit = _accum().function_value([StringType, FloatType])
        gc.collect()
        for i in range(1000):
            emit(f"k{i:04d}", float(i))  # a freed core would not answer here


class TestSinkStrictBoundary:
    def test_an_impure_callback_is_refused_up_front(self):
        core = _accum()
        emit = core.function_value([StringType, FloatType])
        order: list[str] = []
        with pytest.raises(ExpressionError, match="captured automatically"):
            _rows().for_each(lambda _b, r: (order.append(r["k"]), emit(r["k"], r["v"]))[1])
        assert order == []
        for r in _rows():
            order.append(r["k"])
            emit(r["k"], r["v"])

        assert order == ["a", "b", "c"]
        keys, _values = core.take_batch()
        assert list(keys) == ["a", "b", "c"]

    def test_an_arity_mismatched_call_on_the_sink_names_its_cause(self):
        # The foreign-function-value callee (not a bound function): lowering
        # declines the arity mismatch, the capture then raises (#625) with
        # NonRetraceableCallError in the cause chain (#558 C) — instead of the
        # old per-element fallback surfacing the sink's own runtime refusal.
        emit = _accum().function_value([StringType, FloatType])
        _assert_named_cause(lambda: _rows().for_each(lambda _b, r: emit(r["k"])))
