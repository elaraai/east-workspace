#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Traced-kernel defects from issue #558 — four fixes, each pinned by its repro.

A. CSE must not hoist a shared Let across an IfElse boundary: the guarded
   `where(d.has(k), some(build(d[k])), none)` spelling raised
   `Dict does not contain key` on the miss path whenever `build` read the hit
   through one shared variable, because the hoisted Let evaluated the lookup
   unconditionally. An occurrence on an unconditional path keeps the hoist.

B. `bind()` type-checked struct parameters by CONTENT inference (`type_of`),
   so a struct holding an Option field could never bind — a `none` infers as
   a degenerate none-only variant. The check is subsumption (`is_value_of`)
   against the declared parameter type.

C. A traced lambda calling an already-compiled East function (a `.bind`
   result; the e3 runner's streamTask `emit`) cannot re-trace the callee.
   Speculative push-down declines and falls back to the per-element python
   path (the ≤1.0.61 contract) — and since #561 a well-typed call LOWERS to
   the IR Call node instead, so these lambdas now compile whole; the decline
   (and the named error for explicit `kernel(...)`) survives for the shapes
   lowering cannot type, and for genuinely-python callees.

D. `.match()` settles its output type from ANY arm that can state one
   without a hint — including a `some(expr)` arm, which arrives as an
   EastVariant wrapping the traced payload — so a sibling bare-`none` arm
   types from it, exactly as `where(...)` always has.
"""

import pytest

from east import (
    DictType,
    EastArray,
    EastDict,
    FloatType,
    OptionType,
    StringType,
    StructType,
    coerce_to,
    kernel,
    none,
    some,
    where,
)
from east.kernel import KernelTraceError
from east.runtime.errors import NonRetraceableCallError

ROW = StructType([("k", StringType)])
TABLE_T = DictType(StringType, FloatType)


def _rows():
    return EastArray(ROW, [{"k": "hit"}, {"k": "MISS"}])


def _table():
    return EastDict(StringType, FloatType, {"hit": 21.0})


# ── A. no hoist across an IfElse boundary ───────────────────────────────────


class TestConditionalHoist:
    def test_guarded_lookup_shared_by_a_build_survives_the_miss_path(self):
        # the repro: the hit is read through ONE shared variable (three field
        # uses -> one CSE'd Let). Before the fix the Let hoisted above the
        # IfElse and the miss row raised `Dict does not contain key`.
        V = StructType([("a", FloatType), ("b", FloatType), ("c", FloatType)])
        D = DictType(StringType, V)
        t = EastDict(StringType, V)
        t.insert("hit", {"a": 1.0, "b": 2.0, "c": 3.0})

        def build(v):
            return {"x": v["a"], "y": v["b"], "z": v["c"]}

        k = kernel([ROW, D], lambda r, d: where(d.has(r["k"]),
                                                some(build(d[r["k"]])), none))
        out = list(_rows().map(k.bind(t)))
        assert out[0].type == "some" and out[0].value["x"] == 1.0
        assert out[1].type == "none"

    def test_an_unconditional_occurrence_keeps_the_hoist(self):
        # the same shared expression used in the PREDICATE and the branch is
        # evaluated on every path, so hoisting it stays legal — and the
        # result must be unchanged.
        k = kernel([ROW, TABLE_T],
                   lambda r, d: where(d.get_or_default(r["k"], 0.0) > 1.0,
                                      d.get_or_default(r["k"], 0.0), 0.0))
        out = list(_rows().map(k.bind(_table())))
        assert out == [21.0, 0.0]

    def test_a_guarded_partial_read_inside_match_does_not_leak_either(self):
        # Match case bodies are conditional arms too.
        k = kernel([ROW, TABLE_T],
                   lambda r, d: d.try_get(r["k"]).match({
                       "some": lambda v: v + v,          # shared payload use
                       "none": lambda _: 0.0,
                   }))
        assert list(_rows().map(k.bind(_table()))) == [42.0, 0.0]


# ── B. bind() subsumption for Option-bearing values ─────────────────────────


class TestBindSubsumption:
    V = StructType([("name", OptionType(StringType)), ("qty", OptionType(FloatType)),
                    ("tag", StringType)])

    def test_a_none_valued_struct_binds_against_its_declared_type(self):
        sentinel = coerce_to({"name": none, "qty": none, "tag": ""}, self.V)
        k = kernel([StringType, self.V],
                   lambda s, ab: ab["name"].unwrap_or(s))
        bound = k.bind(sentinel)
        assert bound("fallback") == "fallback"

    def test_a_some_valued_struct_binds_too(self):
        filled = coerce_to({"name": some("x"), "qty": some(1.0), "tag": "t"},
                           self.V)
        k = kernel([StringType, self.V],
                   lambda s, ab: ab["name"].unwrap_or(s))
        assert k.bind(filled)("fallback") == "x"

    def test_a_genuinely_wrong_value_is_still_refused(self):
        with pytest.raises(TypeError, match="expects"):
            kernel([StringType, self.V],
                   lambda s, ab: ab["tag"]).bind(coerce_to(1.0, FloatType))


# ── C. non-retraceable callee: decline speculatively, raise explicitly ──────


def _native_sink():
    """A compiled East callable — the shape of the e3 runner's `emit`."""
    k = kernel([StringType, FloatType, FloatType],
               lambda key, v, base: v + base)
    return k.bind(0.0)


class TestNonRetraceableCallee:
    def test_for_each_over_a_native_sink_falls_back_and_runs(self):
        # the production regression: every streamTask projection emits
        # per-row through a runner-supplied native function. Speculative
        # push-down must decline, not raise.
        sink = _native_sink()
        seen: list[float] = []
        rows = EastArray(StructType([("k", StringType), ("v", FloatType)]),
                         [{"k": "a", "v": 1.0}, {"k": "b", "v": 2.0}])
        rows.for_each(lambda e: seen.append(sink(e["k"], e["v"])))
        assert seen == [1.0, 2.0]

    def test_map_over_a_lambda_calling_a_native_fn_still_answers(self):
        # Since #561 this shape LOWERS to a native Call rather than falling
        # back — the pinned contract here is that the answer is unchanged.
        sink = _native_sink()
        rows = EastArray(StructType([("k", StringType), ("v", FloatType)]),
                         [{"k": "a", "v": 1.0}])
        assert list(rows.map(lambda e: sink(e["k"], e["v"]) * 2.0)) == [2.0]

    def test_explicit_kernel_over_a_well_typed_call_now_compiles(self):
        # Superseded by #561: the call lowers to the IR Call node, so the
        # explicit kernel() that used to raise now compiles and runs.
        sink = _native_sink()
        k = kernel([StringType], lambda s: sink(s, 1.0))
        assert k("x") == 1.0

    def test_the_distinguished_error_reaches_the_cause_chain(self):
        # An arity-mismatched call is a shape #561's lowering declines, so
        # the #558 C loud contract — NonRetraceableCallError in the cause
        # chain — still holds there.
        sink = _native_sink()
        try:
            kernel([StringType], lambda s: sink(s))
        except KernelTraceError as e:
            cause, found = e.__cause__, False
            for _ in range(4):
                if cause is None:
                    break
                if isinstance(cause, NonRetraceableCallError):
                    found = True
                    break
                cause = cause.__cause__
            assert found, "NonRetraceableCallError missing from the cause chain"
        else:
            raise AssertionError("expected KernelTraceError")


# ── D. match settles its type from a some(...) arm ──────────────────────────


class TestMatchArmTyping:
    def test_a_none_arm_types_from_the_sibling_some_arm(self):
        k = kernel([ROW, TABLE_T],
                   lambda r, d: d.try_get(r["k"]).match({
                       "some": lambda v: some(v * 2.0),
                       "none": lambda _: none,
                   }))
        out = list(_rows().map(k.bind(_table())))
        assert out[0].type == "some" and out[0].value == 42.0
        assert out[1].type == "none"

    def test_arm_order_does_not_matter(self):
        # Option declares `none` first, so the none HANDLER is evaluated
        # first — the settle pass must look across all arms, not stop at
        # the first.
        k = kernel([ROW, TABLE_T],
                   lambda r, d: d.try_get(r["k"]).match({
                       "none": lambda _: none,
                       "some": lambda v: some(v + 1.0),
                   }))
        out = list(_rows().map(k.bind(_table())))
        assert out[0].value == 22.0 and out[1].type == "none"
