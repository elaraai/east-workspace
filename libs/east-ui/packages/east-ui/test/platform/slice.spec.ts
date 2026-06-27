/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    East,
    variant,
    some,
    none,
    OptionType,
    StringType,
    IntegerType,
    FloatType,
    DateTimeType,
    BooleanType,
    StructType,
    ArrayType,
} from "@elaraai/east";
import { Slice, SliceApplyImpl } from "@elaraai/east-ui/internal";
import * as ex from "./slice.examples.js";

// ---------------------------------------------------------------------------
// Slice — every test below is self-contained: the row type, the slice
// config, the state value, and the rows are all built inside the test
// body so the doc extractor renders complete, runnable snippets.
//
// Style rules:
//   - never nest `$.const(East.value(...))` inside an Assert.equal / Slice.apply.* call
//   - bind rows / states / configs at statement level, then reference by name
//   - assert actual element values — never just length / tag
// ---------------------------------------------------------------------------

describeEast("Slice", (test) => {
    Assert.examples(test, {
        sliceBindDefault:          ex.sliceBindDefault,
        sliceAddIntegerPredicate:  ex.sliceAddIntegerPredicate,
        sliceAddStringInPredicate: ex.sliceAddStringInPredicate,
        sliceSetRangePreset:       ex.sliceSetRangePreset,
        sliceSetRangeCustomDateTime: ex.sliceSetRangeCustomDateTime,
        sliceSetRangeInteger:      ex.sliceSetRangeInteger,
        sliceDefineCohort:         ex.sliceDefineCohort,
        sliceSetBreakdown:         ex.sliceSetBreakdown,
        sliceSetSearch:            ex.sliceSetSearch,
        sliceSetVisible:           ex.sliceSetVisible,
    });

    // -----------------------------------------------------------------------
    // Range — variant carries the right tag + payload at each level
    // -----------------------------------------------------------------------

    test("SliceRange datetimePreset carries the inner DateTimePreset tag", $ => {
        const r = $.const(East.value(
            variant("datetimePreset", variant("last30d", null)),
            Slice.Types.Range,
        ));
        const preset = $.let(r.unwrap("datetimePreset"));
        $(Assert.equal(r.getTag(), "datetimePreset"));
        $(Assert.equal(preset.getTag(), "last30d"));
    });

    test("SliceRange datetime carries a pinned DateTimeRange { from, to }", $ => {
        const r = $.const(East.value(
            variant("datetime", {
                from: new Date("2025-01-01T00:00:00Z"),
                to:   new Date("2025-03-31T23:59:59Z"),
            }),
            Slice.Types.Range,
        ));
        const inner = $.let(r.unwrap("datetime"));
        $(Assert.equal(inner.from, new Date("2025-01-01T00:00:00Z")));
        $(Assert.equal(inner.to,   new Date("2025-03-31T23:59:59Z")));
    });

    test("SliceRange integer variant carries an IntegerRange", $ => {
        const r = $.const(East.value(
            variant("integer", { from: 5n, to: 100n }),
            Slice.Types.Range,
        ));
        const inner = $.let(r.unwrap("integer"));
        $(Assert.equal(inner.from, 5n));
        $(Assert.equal(inner.to,   100n));
    });

    test("SliceRange float variant carries a FloatRange", $ => {
        const r = $.const(East.value(
            variant("float", { from: 0.0, to: 1.0 }),
            Slice.Types.Range,
        ));
        const inner = $.let(r.unwrap("float"));
        $(Assert.equal(inner.from, 0.0));
        $(Assert.equal(inner.to,   1.0));
    });

    // -----------------------------------------------------------------------
    // Predicate — typed nested variant: outer = type family, inner = op
    // -----------------------------------------------------------------------

    test("SlicePredicate integer/gte carries a typed IntegerType op value", $ => {
        const p = $.const(East.value(
            variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
            Slice.Types.Predicate,
        ));
        const inner = $.let(p.unwrap("integer"));
        $(Assert.equal(p.getTag(), "integer"));
        $(Assert.equal(inner.fieldId, "sessions"));
        $(Assert.equal(inner.op.getTag(), "gte"));
        $(Assert.equal(inner.op.unwrap("gte"), 10n));
    });

    test("SlicePredicate string/in carries a typed SetType<StringType>", $ => {
        const p = $.const(East.value(
            variant("string", {
                fieldId: "country",
                op:      variant("in", new Set(["US", "UK", "DE"])),
            }),
            Slice.Types.Predicate,
        ));
        const inner = $.let(p.unwrap("string"));
        const setExpr = $.let(inner.op.unwrap("in"));
        $(Assert.equal(inner.fieldId, "country"));
        $(Assert.equal(inner.op.getTag(), "in"));
        $(Assert.equal(setExpr.has("US"), true));
        $(Assert.equal(setExpr.has("UK"), true));
        $(Assert.equal(setExpr.has("DE"), true));
        $(Assert.equal(setExpr.has("FR"), false));
    });

    test("SlicePredicate datetime/between carries a DateTimeRange", $ => {
        const p = $.const(East.value(
            variant("datetime", {
                fieldId: "timestamp",
                op:      variant("between", {
                    from: new Date("2025-01-01T00:00:00Z"),
                    to:   new Date("2025-03-31T23:59:59Z"),
                }),
            }),
            Slice.Types.Predicate,
        ));
        const inner = $.let(p.unwrap("datetime"));
        const rng = $.let(inner.op.unwrap("between"));
        $(Assert.equal(inner.fieldId, "timestamp"));
        $(Assert.equal(rng.from, new Date("2025-01-01T00:00:00Z")));
        $(Assert.equal(rng.to,   new Date("2025-03-31T23:59:59Z")));
    });

    // -----------------------------------------------------------------------
    // Cohort, Breakdown, State construction
    // -----------------------------------------------------------------------

    test("SliceCohort holds typed AND-of-predicates", $ => {
        const c = $.const(East.value({
            id:   "power-users",
            name: "Power users",
            filters: [
                variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                variant("string",  { fieldId: "country",  op: variant("eq",  "US") }),
            ],
        }, Slice.Types.Cohort));
        const intFilter = $.let(c.filters.get(0n).unwrap("integer"));
        const strFilter = $.let(c.filters.get(1n).unwrap("string"));
        $(Assert.equal(c.id,   "power-users"));
        $(Assert.equal(c.name, "Power users"));
        $(Assert.equal(intFilter.fieldId, "sessions"));
        $(Assert.equal(intFilter.op.unwrap("gte"), 10n));
        $(Assert.equal(strFilter.fieldId, "country"));
        $(Assert.equal(strFilter.op.unwrap("eq"), "US"));
    });

    test("SliceBreakdown carries fieldId + optional top-N", $ => {
        const b = $.const(East.value(
            { fieldId: "country", limit: some(5n) },
            Slice.Types.Breakdown,
        ));
        $(Assert.equal(b.fieldId, "country"));
        $(Assert.equal(b.limit.unwrap("some"), 5n));
    });

    test("Slice.state defaults every field when no options given", $ => {
        const s = $.const(Slice.state());
        $(Assert.equal(s.range.getTag(),         "none"));
        $(Assert.equal(s.filters.length(),       0n));
        $(Assert.equal(s.cohorts.length(),       0n));
        $(Assert.equal(s.activeCohorts.size(),   0n));
        $(Assert.equal(s.breakdown.getTag(),     "none"));
        $(Assert.equal(s.search.getTag(),        "none"));
        $(Assert.equal(s.visible.getTag(),       "none"));
        $(Assert.equal(s.selectedIndex.getTag(), "none"));
    });

    test("Slice.state preserves activeCohorts members", $ => {
        const s = $.const(Slice.state({
            activeCohorts: new Set(["power-users", "trial-converted"]),
        }));
        $(Assert.equal(s.activeCohorts.has("power-users"),     true));
        $(Assert.equal(s.activeCohorts.has("trial-converted"), true));
        $(Assert.equal(s.activeCohorts.has("missing"),         false));
    });

    test("Slice.state visible whitelist preserves Set members", $ => {
        const s = $.const(Slice.state({
            visible: some(new Set(["US", "UK"])),
        }));
        const seen = $.let(s.visible.unwrap("some"));
        $(Assert.equal(seen.has("US"), true));
        $(Assert.equal(seen.has("UK"), true));
        $(Assert.equal(seen.has("DE"), false));
    });

    test("SliceState round-trips through East.diff + East.applyPatch", $ => {
        const before = $.const(Slice.state());
        const after = $.const(Slice.state({
            range: some(variant("datetimePreset", variant("last30d", null))),
            filters: [
                variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
            ],
        }));
        const patch  = $.const(East.diff(before, after));
        const result = $.const(East.applyPatch(before, patch), Slice.Types.State);
        const filter = $.let(result.filters.get(0n).unwrap("integer"));
        $(Assert.equal(result.range.getTag(), "some"));
        $(Assert.equal(result.range.unwrap("some").getTag(), "datetimePreset"));
        $(Assert.equal(filter.fieldId, "sessions"));
        $(Assert.equal(filter.op.unwrap("gte"), 10n));
    });

    // =======================================================================
    // Slice.apply.matches — exhaustive impl tests
    // =======================================================================

    // -----------------------------------------------------------------------
    // String ops: eq, neq, in, notIn, contains, matches
    // -----------------------------------------------------------------------

    test("config carries explicit per-field hints (#131)", $ => {
        const RowType = StructType({ country: StringType });
        const cfg = $.let(Slice.config(RowType, {
            fields: { country: { label: "Country", hints: ["NA", "EU", "APAC"] } },
        }));
        $(Assert.equal(cfg.fieldHints.get("country").length(), 3n));
        $(Assert.equal(cfg.fieldHints.get("country").get(0n), "NA"));
    });

    test("apply.matches: string/eq", $ => {
        const RowType = StructType({ country: StringType });
        const cfg   = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } } }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "country", op: variant("eq", "US") })],
        }));
        const rUS    = $.const(East.value({ country: "US" }, RowType));
        const rUK    = $.const(East.value({ country: "UK" }, RowType));
        const rEmpty = $.const(East.value({ country: "" },   RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS),    true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUK),    false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEmpty), false));
    });

    test("apply.matches: string/neq", $ => {
        const RowType = StructType({ country: StringType });
        const cfg   = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } } }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "country", op: variant("neq", "US") })],
        }));
        const rUS = $.const(East.value({ country: "US" }, RowType));
        const rUK = $.const(East.value({ country: "UK" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUK), true));
    });

    test("apply.matches: string/in", $ => {
        const RowType = StructType({ country: StringType });
        const cfg   = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } } }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "country", op: variant("in", new Set(["US", "UK", "DE"])) })],
        }));
        const rUS = $.const(East.value({ country: "US" }, RowType));
        const rUK = $.const(East.value({ country: "UK" }, RowType));
        const rDE = $.const(East.value({ country: "DE" }, RowType));
        const rFR = $.const(East.value({ country: "FR" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUK), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rDE), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rFR), false));
    });

    test("apply.matches: string/notIn", $ => {
        const RowType = StructType({ country: StringType });
        const cfg   = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } } }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "country", op: variant("notIn", new Set(["US", "UK"])) })],
        }));
        const rUS = $.const(East.value({ country: "US" }, RowType));
        const rDE = $.const(East.value({ country: "DE" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rDE), true));
    });

    test("apply.matches: string/contains", $ => {
        const RowType = StructType({ sku: StringType });
        const cfg   = $.let(Slice.config(RowType, { fields: { sku: { label: "SKU" } } }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "sku", op: variant("contains", "ABC") })],
        }));
        const rHit  = $.const(East.value({ sku: "SKU-ABC-001" }, RowType));
        const rMiss = $.const(East.value({ sku: "SKU-XYZ-001" }, RowType));
        const rPart = $.const(East.value({ sku: "ABC" },         RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rHit),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rMiss), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rPart), true));
    });

    test("apply.matches: string/matches (regex)", $ => {
        const RowType = StructType({ sku: StringType });
        const cfg   = $.let(Slice.config(RowType, { fields: { sku: { label: "SKU" } } }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "sku", op: variant("matches", "^SKU-[A-Z]+$") })],
        }));
        const rHit = $.const(East.value({ sku: "SKU-ABC" },  RowType));
        const rNum = $.const(East.value({ sku: "SKU-123" },  RowType));
        const rMid = $.const(East.value({ sku: "X-SKU-AB" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rHit), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rNum), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rMid), false));
    });

    // -----------------------------------------------------------------------
    // Integer ops: eq, neq, lt, lte, gt, gte, in
    // -----------------------------------------------------------------------

    test("apply.matches: integer/eq", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("eq", 10n) })],
        }));
        const r10  = $.const(East.value({ n: 10n  }, RowType));
        const r5   = $.const(East.value({ n: 5n   }, RowType));
        const rNeg = $.const(East.value({ n: -10n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r10),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),   false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rNeg), false));
    });

    test("apply.matches: integer/neq", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("neq", 10n) })],
        }));
        const r10 = $.const(East.value({ n: 10n }, RowType));
        const r5  = $.const(East.value({ n: 5n  }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r10), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),  true));
    });

    test("apply.matches: integer/lt", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("lt", 10n) })],
        }));
        const r5  = $.const(East.value({ n: 5n  }, RowType));
        const r10 = $.const(East.value({ n: 10n }, RowType));
        const r15 = $.const(East.value({ n: 15n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r10), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r15), false));
    });

    test("apply.matches: integer/lte", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("lte", 10n) })],
        }));
        const r5  = $.const(East.value({ n: 5n  }, RowType));
        const r10 = $.const(East.value({ n: 10n }, RowType));
        const r15 = $.const(East.value({ n: 15n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r10), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r15), false));
    });

    test("apply.matches: integer/gt", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("gt", 10n) })],
        }));
        const r5  = $.const(East.value({ n: 5n  }, RowType));
        const r10 = $.const(East.value({ n: 10n }, RowType));
        const r15 = $.const(East.value({ n: 15n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),  false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r10), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r15), true));
    });

    test("apply.matches: integer/gte", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("gte", 10n) })],
        }));
        const r5  = $.const(East.value({ n: 5n  }, RowType));
        const r10 = $.const(East.value({ n: 10n }, RowType));
        const r15 = $.const(East.value({ n: 15n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),  false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r10), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r15), true));
    });

    test("apply.matches: integer/in", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("in", new Set([5n, 10n, 15n])) })],
        }));
        const r5  = $.const(East.value({ n: 5n  }, RowType));
        const r10 = $.const(East.value({ n: 10n }, RowType));
        const r7  = $.const(East.value({ n: 7n  }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r10), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r7),  false));
    });

    // -----------------------------------------------------------------------
    // Float ops: lt, lte, gt, gte (East-helper semantics)
    // -----------------------------------------------------------------------

    test("apply.matches: float/lt", $ => {
        const RowType = StructType({ x: FloatType });
        const cfg = $.let(Slice.config(RowType, { fields: { x: { label: "X" } } }));
        const state = $.const(Slice.state({
            filters: [variant("float", { fieldId: "x", op: variant("lt", 0.5) })],
        }));
        const rBelow = $.const(East.value({ x: 0.3  }, RowType));
        const rEq    = $.const(East.value({ x: 0.5  }, RowType));
        const rAbove = $.const(East.value({ x: 0.7  }, RowType));
        const rNeg   = $.const(East.value({ x: -1.0 }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rBelow), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEq),    false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAbove), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rNeg),   true));
    });

    test("apply.matches: float/lte", $ => {
        const RowType = StructType({ x: FloatType });
        const cfg = $.let(Slice.config(RowType, { fields: { x: { label: "X" } } }));
        const state = $.const(Slice.state({
            filters: [variant("float", { fieldId: "x", op: variant("lte", 0.5) })],
        }));
        const rBelow = $.const(East.value({ x: 0.3 }, RowType));
        const rEq    = $.const(East.value({ x: 0.5 }, RowType));
        const rAbove = $.const(East.value({ x: 0.7 }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rBelow), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEq),    true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAbove), false));
    });

    test("apply.matches: float/gt", $ => {
        const RowType = StructType({ x: FloatType });
        const cfg = $.let(Slice.config(RowType, { fields: { x: { label: "X" } } }));
        const state = $.const(Slice.state({
            filters: [variant("float", { fieldId: "x", op: variant("gt", 0.5) })],
        }));
        const rBelow = $.const(East.value({ x: 0.3 }, RowType));
        const rEq    = $.const(East.value({ x: 0.5 }, RowType));
        const rAbove = $.const(East.value({ x: 0.7 }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rBelow), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEq),    false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAbove), true));
    });

    test("apply.matches: float/gte", $ => {
        const RowType = StructType({ x: FloatType });
        const cfg = $.let(Slice.config(RowType, { fields: { x: { label: "X" } } }));
        const state = $.const(Slice.state({
            filters: [variant("float", { fieldId: "x", op: variant("gte", 0.5) })],
        }));
        const rBelow = $.const(East.value({ x: 0.3 }, RowType));
        const rEq    = $.const(East.value({ x: 0.5 }, RowType));
        const rAbove = $.const(East.value({ x: 0.7 }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rBelow), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEq),    true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAbove), true));
    });

    // -----------------------------------------------------------------------
    // DateTime ops: before, after, between
    // -----------------------------------------------------------------------

    test("apply.matches: datetime/before", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, { fields: { ts: { label: "TS" } } }));
        const state = $.const(Slice.state({
            filters: [variant("datetime", { fieldId: "ts", op: variant("before", new Date("2025-06-01T00:00:00Z")) })],
        }));
        const rEarly = $.const(East.value({ ts: new Date("2025-05-01T00:00:00Z") }, RowType));
        const rEq    = $.const(East.value({ ts: new Date("2025-06-01T00:00:00Z") }, RowType));
        const rLate  = $.const(East.value({ ts: new Date("2025-07-01T00:00:00Z") }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEarly), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEq),    false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rLate),  false));
    });

    test("apply.matches: datetime/after", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, { fields: { ts: { label: "TS" } } }));
        const state = $.const(Slice.state({
            filters: [variant("datetime", { fieldId: "ts", op: variant("after", new Date("2025-06-01T00:00:00Z")) })],
        }));
        const rEarly = $.const(East.value({ ts: new Date("2025-05-01T00:00:00Z") }, RowType));
        const rEq    = $.const(East.value({ ts: new Date("2025-06-01T00:00:00Z") }, RowType));
        const rLate  = $.const(East.value({ ts: new Date("2025-07-01T00:00:00Z") }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEarly), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rEq),    false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rLate),  true));
    });

    test("apply.matches: datetime/between (closed interval)", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, { fields: { ts: { label: "TS" } } }));
        const state = $.const(Slice.state({
            filters: [variant("datetime", { fieldId: "ts", op: variant("between", {
                from: new Date("2025-01-01T00:00:00Z"),
                to:   new Date("2025-12-31T00:00:00Z"),
            }) })],
        }));
        const rInside = $.const(East.value({ ts: new Date("2025-06-15T00:00:00Z") }, RowType));
        const rAtFrom = $.const(East.value({ ts: new Date("2025-01-01T00:00:00Z") }, RowType));
        const rAtTo   = $.const(East.value({ ts: new Date("2025-12-31T00:00:00Z") }, RowType));
        const rBefore = $.const(East.value({ ts: new Date("2024-12-31T00:00:00Z") }, RowType));
        const rAfter  = $.const(East.value({ ts: new Date("2026-01-01T00:00:00Z") }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rInside), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAtFrom), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAtTo),   true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rBefore), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAfter),  false));
    });

    // -----------------------------------------------------------------------
    // Boolean op
    // -----------------------------------------------------------------------

    test("apply.matches: boolean/is true", $ => {
        const RowType = StructType({ active: BooleanType });
        const cfg = $.let(Slice.config(RowType, { fields: { active: { label: "Active" } } }));
        const state = $.const(Slice.state({
            filters: [variant("boolean", { fieldId: "active", op: variant("is", true) })],
        }));
        const rT = $.const(East.value({ active: true  }, RowType));
        const rF = $.const(East.value({ active: false }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rT), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rF), false));
    });

    test("apply.matches: boolean/is false", $ => {
        const RowType = StructType({ active: BooleanType });
        const cfg = $.let(Slice.config(RowType, { fields: { active: { label: "Active" } } }));
        const state = $.const(Slice.state({
            filters: [variant("boolean", { fieldId: "active", op: variant("is", false) })],
        }));
        const rT = $.const(East.value({ active: true  }, RowType));
        const rF = $.const(East.value({ active: false }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rT), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rF), true));
    });

    // -----------------------------------------------------------------------
    // Range — pinned datetime / integer / float
    // -----------------------------------------------------------------------

    test("apply.matches: pinned datetime range narrows on the configured field (closed)", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { ts: { label: "TS" } },
            rangeFieldId: "ts",
        }));
        const state = $.const(Slice.state({
            range: some(variant("datetime", {
                from: new Date("2025-06-01T00:00:00Z"),
                to:   new Date("2025-06-30T23:59:59Z"),
            })),
        }));
        const rInside = $.const(East.value({ ts: new Date("2025-06-15T00:00:00Z") }, RowType));
        const rAtFrom = $.const(East.value({ ts: new Date("2025-06-01T00:00:00Z") }, RowType));
        const rAtTo   = $.const(East.value({ ts: new Date("2025-06-30T23:59:59Z") }, RowType));
        const rAbove  = $.const(East.value({ ts: new Date("2025-07-01T00:00:00Z") }, RowType));
        const rBelow  = $.const(East.value({ ts: new Date("2025-05-31T23:59:59Z") }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rInside), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAtFrom), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAtTo),   true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rAbove),  false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rBelow),  false));
    });

    test("apply.matches: integer range (closed)", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { n: { label: "N" } },
            rangeFieldId: "n",
        }));
        const state = $.const(Slice.state({
            range: some(variant("integer", { from: 5n, to: 100n })),
        }));
        const r5   = $.const(East.value({ n: 5n   }, RowType));
        const r100 = $.const(East.value({ n: 100n }, RowType));
        const r50  = $.const(East.value({ n: 50n  }, RowType));
        const r4   = $.const(East.value({ n: 4n   }, RowType));
        const r101 = $.const(East.value({ n: 101n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5),   true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r100), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r50),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r4),   false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r101), false));
    });

    test("apply.matches: float range (closed)", $ => {
        const RowType = StructType({ x: FloatType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { x: { label: "X" } },
            rangeFieldId: "x",
        }));
        const state = $.const(Slice.state({
            range: some(variant("float", { from: 0.0, to: 1.0 })),
        }));
        const r0   = $.const(East.value({ x: 0.0   }, RowType));
        const r05  = $.const(East.value({ x: 0.5   }, RowType));
        const r1   = $.const(East.value({ x: 1.0   }, RowType));
        const rNeg = $.const(East.value({ x: -0.01 }, RowType));
        const rBig = $.const(East.value({ x: 1.01  }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r0),   true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r05),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r1),   true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rNeg), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rBig), false));
    });

    // -----------------------------------------------------------------------
    // Range — datetime presets (today / last7d / last30d / last90d / ytd)
    //
    // Presets resolve relative to "now" at apply time. To make tests
    // robust, the row's timestamp is set to clearly inside (a few ms ago)
    // or clearly outside (5+ years ago) the rolling window.
    // -----------------------------------------------------------------------

    test("apply.matches: datetime preset 'today' includes a row just before now, excludes a year ago", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { ts: { label: "TS" } },
            rangeFieldId: "ts",
        }));
        const state = $.const(Slice.state({
            range: some(variant("datetimePreset", variant("today", null))),
        }));
        const rRecent  = $.const(East.value({ ts: new Date(Date.now() - 100) }, RowType));
        const rYearAgo = $.const(East.value({ ts: new Date(Date.now() - 365 * 24 * 3600 * 1000) }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rRecent),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rYearAgo), false));
    });

    test("apply.matches: datetime preset 'last7d' admits a row 1 day old, excludes 30 days old", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { ts: { label: "TS" } },
            rangeFieldId: "ts",
        }));
        const state = $.const(Slice.state({
            range: some(variant("datetimePreset", variant("last7d", null))),
        }));
        const rIn  = $.const(East.value({ ts: new Date(Date.now() - 1  * 24 * 3600 * 1000) }, RowType));
        const rOut = $.const(East.value({ ts: new Date(Date.now() - 30 * 24 * 3600 * 1000) }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rIn),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rOut), false));
    });

    test("apply.matches: datetime preset 'last30d' admits a row 7 days old, excludes 100 days old", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { ts: { label: "TS" } },
            rangeFieldId: "ts",
        }));
        const state = $.const(Slice.state({
            range: some(variant("datetimePreset", variant("last30d", null))),
        }));
        const rIn  = $.const(East.value({ ts: new Date(Date.now() - 7   * 24 * 3600 * 1000) }, RowType));
        const rOut = $.const(East.value({ ts: new Date(Date.now() - 100 * 24 * 3600 * 1000) }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rIn),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rOut), false));
    });

    test("apply.matches: datetime preset 'last90d' admits a row 30 days old, excludes 365 days old", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { ts: { label: "TS" } },
            rangeFieldId: "ts",
        }));
        const state = $.const(Slice.state({
            range: some(variant("datetimePreset", variant("last90d", null))),
        }));
        const rIn  = $.const(East.value({ ts: new Date(Date.now() - 30  * 24 * 3600 * 1000) }, RowType));
        const rOut = $.const(East.value({ ts: new Date(Date.now() - 365 * 24 * 3600 * 1000) }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rIn),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rOut), false));
    });

    test("apply.matches: datetime preset 'ytd' admits a row from this year, excludes 5 years ago", $ => {
        const RowType = StructType({ ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, {
            fields:       { ts: { label: "TS" } },
            rangeFieldId: "ts",
        }));
        const state = $.const(Slice.state({
            range: some(variant("datetimePreset", variant("ytd", null))),
        }));
        const thisYear = new Date().getFullYear();
        const rIn  = $.const(East.value({ ts: new Date(`${thisYear}-01-01T12:00:00Z`)     }, RowType));
        const rOut = $.const(East.value({ ts: new Date(`${thisYear - 5}-06-15T00:00:00Z`) }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rIn),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rOut), false));
    });

    // -----------------------------------------------------------------------
    // Cohorts
    // -----------------------------------------------------------------------

    test("apply.matches: active cohort filters AND with state.filters", $ => {
        const RowType = StructType({ country: StringType, sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, {
            fields: {
                country:  { label: "Country"  },
                sessions: { label: "Sessions" },
            },
        }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "country", op: variant("eq", "US") })],
            cohorts: [
                {
                    id: "power",
                    name: "Power",
                    filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
                },
            ],
            activeCohorts: new Set(["power"]),
        }));
        const rUS10 = $.const(East.value({ country: "US", sessions: 10n }, RowType));
        const rUS5  = $.const(East.value({ country: "US", sessions: 5n  }, RowType));
        const rUK10 = $.const(East.value({ country: "UK", sessions: 10n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS10), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS5),  false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUK10), false));
    });

    test("apply.matches: multiple active cohorts all AND-ed", $ => {
        const RowType = StructType({ country: StringType, sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, {
            fields: {
                country:  { label: "Country"  },
                sessions: { label: "Sessions" },
            },
        }));
        const state = $.const(Slice.state({
            cohorts: [
                {
                    id: "us-only",
                    name: "US only",
                    filters: [variant("string", { fieldId: "country", op: variant("eq", "US") })],
                },
                {
                    id: "power",
                    name: "Power",
                    filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
                },
            ],
            activeCohorts: new Set(["us-only", "power"]),
        }));
        const rUS10 = $.const(East.value({ country: "US", sessions: 10n }, RowType));
        const rUK10 = $.const(East.value({ country: "UK", sessions: 10n }, RowType));
        const rUS5  = $.const(East.value({ country: "US", sessions: 5n  }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS10), true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUK10), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUS5),  false));
    });

    test("apply.matches: inactive cohort is ignored", $ => {
        const RowType = StructType({ sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { sessions: { label: "Sessions" } } }));
        const state = $.const(Slice.state({
            cohorts: [
                {
                    id: "power",
                    name: "Power",
                    filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
                },
            ],
        }));
        const r5 = $.const(East.value({ sessions: 5n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5), true));
    });

    test("apply.matches: activeCohorts entry referencing missing cohort is a no-op", $ => {
        const RowType = StructType({ sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { sessions: { label: "Sessions" } } }));
        const state = $.const(Slice.state({
            activeCohorts: new Set(["ghost"]),
        }));
        const r5 = $.const(East.value({ sessions: 5n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r5), true));
    });

    // -----------------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------------

    test("apply.matches: search hits any configured search field (case-insensitive)", $ => {
        const RowType = StructType({ sku: StringType, country: StringType });
        const cfg = $.let(Slice.config(RowType, {
            fields: {
                sku:     { label: "SKU"     },
                country: { label: "Country" },
            },
            searchFieldIds: ["sku", "country"],
        }));
        const state = $.const(Slice.state({
            search: some("abc"),
        }));
        const rSku  = $.const(East.value({ sku: "SKU-ABC", country: "DE"       }, RowType));
        const rCty  = $.const(East.value({ sku: "OTHER",   country: "abc-land" }, RowType));
        const rNone = $.const(East.value({ sku: "OTHER",   country: "DE"       }, RowType));
        const rUp   = $.const(East.value({ sku: "ABC123",  country: "DE"       }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rSku),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rCty),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rNone), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, rUp),   true));
    });

    test("apply.matches: search auto-derives string fields when searchFieldIds omitted (#129)", $ => {
        const RowType = StructType({ sku: StringType });
        // No explicit searchFieldIds ⇒ defaults to every string field, so the
        // search works out of the box.
        const cfg = $.let(Slice.config(RowType, { fields: { sku: { label: "SKU" } } }));
        const state = $.const(Slice.state({
            search: some("abc"),
        }));
        const r = $.const(East.value({ sku: "SKU-ABC" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), true));
    });

    test("apply.matches: a config with no string fields searches nothing", $ => {
        const RowType = StructType({ count: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { count: { label: "Count" } } }));
        const state = $.const(Slice.state({
            search: some("abc"),
        }));
        const r = $.const(East.value({ count: 5n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), false));
    });

    // =======================================================================
    // Combinations — every narrowing composes as a strict AND. The "search does
    // weird stuff" class of bugs lives in how search interacts with the rest.
    // =======================================================================

    test("apply.matches: search AND a filter both narrow", $ => {
        const RowType = StructType({ country: StringType, sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, {
            fields: { country: { label: "Country" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["country"],
        }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
            search: some("ger"),
        }));
        const both       = $.const(East.value({ country: "Germany", sessions: 20n }, RowType));
        const searchOnly = $.const(East.value({ country: "Germany", sessions: 5n  }, RowType));
        const filterOnly = $.const(East.value({ country: "France",  sessions: 20n }, RowType));
        const neither    = $.const(East.value({ country: "France",  sessions: 5n  }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, both),       true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, searchOnly), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, filterOnly), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, neither),    false));
    });

    test("apply.matches: two filters on the SAME field AND together (a manual between)", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [
                variant("integer", { fieldId: "n", op: variant("gte", 5n) }),
                variant("integer", { fieldId: "n", op: variant("lte", 10n) }),
            ],
        }));
        const inLo  = $.const(East.value({ n: 5n  }, RowType));
        const mid   = $.const(East.value({ n: 7n  }, RowType));
        const inHi  = $.const(East.value({ n: 10n }, RowType));
        const below = $.const(East.value({ n: 4n  }, RowType));
        const above = $.const(East.value({ n: 11n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, inLo),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, mid),   true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, inHi),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, below), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, above), false));
    });

    test("apply.matches: contradictory filters match nothing", $ => {
        const RowType = StructType({ country: StringType });
        const cfg = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } } }));
        const state = $.const(Slice.state({
            filters: [
                variant("string", { fieldId: "country", op: variant("eq", "US") }),
                variant("string", { fieldId: "country", op: variant("eq", "UK") }),
            ],
        }));
        const us = $.const(East.value({ country: "US" }, RowType));
        const uk = $.const(East.value({ country: "UK" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, us), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, uk), false));
    });

    test("apply.matches: filters on DIFFERENT fields AND together", $ => {
        const RowType = StructType({ country: StringType, sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { country: { label: "Country" }, sessions: { label: "Sessions" } } }));
        const state = $.const(Slice.state({
            filters: [
                variant("string",  { fieldId: "country",  op: variant("eq", "US") }),
                variant("integer", { fieldId: "sessions", op: variant("gt", 10n) }),
            ],
        }));
        const both  = $.const(East.value({ country: "US", sessions: 20n }, RowType));
        const one   = $.const(East.value({ country: "US", sessions: 5n  }, RowType));
        const other = $.const(East.value({ country: "UK", sessions: 20n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, both),  true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, one),   false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, other), false));
    });

    test("apply.matches: search AND an active cohort AND a filter all narrow", $ => {
        const RowType = StructType({ country: StringType, tier: StringType, sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, {
            fields: { country: { label: "Country" }, tier: { label: "Tier" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["country"],
        }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
            search: some("ger"),
            cohorts: [{ id: "pro", name: "Pro", filters: [variant("string", { fieldId: "tier", op: variant("eq", "pro") })] }],
            activeCohorts: new Set(["pro"]),
        }));
        const all      = $.const(East.value({ country: "Germany", tier: "pro",  sessions: 20n }, RowType));
        const noTier   = $.const(East.value({ country: "Germany", tier: "free", sessions: 20n }, RowType));
        const noSearch = $.const(East.value({ country: "France",  tier: "pro",  sessions: 20n }, RowType));
        const noFilter = $.const(East.value({ country: "Germany", tier: "pro",  sessions: 5n  }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, all),      true));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, noTier),   false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, noSearch), false));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, noFilter), false));
    });

    test("apply.matches: clearing search (none) drops the search narrowing", $ => {
        const RowType = StructType({ country: StringType });
        const cfg = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } }, searchFieldIds: ["country"] }));
        const withSearch = $.const(Slice.state({ search: some("zzz") }));
        const cleared    = $.const(Slice.state({ search: none }));
        const r = $.const(East.value({ country: "Germany" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], withSearch, cfg, r), false)); // "germany" has no "zzz"
        $(Assert.equal(Slice.apply.matches([RowType], cleared,    cfg, r), true));  // no search ⇒ passes
    });

    test("apply.matches: empty state passes every row", $ => {
        const RowType = StructType({ country: StringType });
        const cfg = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } } }));
        const state = $.const(Slice.state({}));
        const r = $.const(East.value({ country: "anything" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), true));
    });

    // =======================================================================
    // Robustness — a kind-mismatched / missing / malformed predicate must not
    // crash or silently mis-coerce (adversarial bug-hunt repros). Each matcher
    // validates the value against its East type (`isValueOf`) before comparing.
    // =======================================================================

    test("apply.matches: string/matches with an invalid regex narrows to nothing, not a crash", $ => {
        const RowType = StructType({ sku: StringType });
        const cfg   = $.let(Slice.config(RowType, { fields: { sku: { label: "SKU" } } }));
        const state = $.const(Slice.state({
            filters: [variant("string", { fieldId: "sku", op: variant("matches", "(US") })],   // half-typed regex
        }));
        const r = $.const(East.value({ sku: "US-123" }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), false));
    });

    test("apply.matches: integer predicate on a float field is a clean non-match, not a RangeError", $ => {
        const RowType = StructType({ x: FloatType });
        const cfg = $.let(Slice.config(RowType, { fields: { x: { label: "X" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "x", op: variant("eq", 3n) })],
        }));
        const r = $.const(East.value({ x: 3.5 }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), false));
    });

    test("apply.matches: integer predicate on a field absent from the row is a clean non-match", $ => {
        const RowType = StructType({ sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { sessions: { label: "Sessions" } } }));
        const state = $.const(Slice.state({
            cohorts: [{ id: "c1", name: "C1", filters: [variant("integer", { fieldId: "missing", op: variant("gte", 1n) })] }],
            activeCohorts: new Set(["c1"]),
        }));
        const r = $.const(East.value({ sessions: 5n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), false));
    });

    test("apply.matches: string predicate on an absent field doesn't spuriously match via 'undefined'", $ => {
        const RowType = StructType({ sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { sessions: { label: "Sessions" } } }));
        const state = $.const(Slice.state({
            cohorts: [{ id: "c1", name: "C1", filters: [variant("string", { fieldId: "tier", op: variant("neq", "pro") })] }],
            activeCohorts: new Set(["c1"]),
        }));
        const r = $.const(East.value({ sessions: 5n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), false));
    });

    test("range: datetime arm on an integer rangeFieldId is inert (row passes), not a crash", $ => {
        const RowType = StructType({ sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { sessions: { label: "Sessions" } }, rangeFieldId: "sessions" }));
        const state = $.const(Slice.state({
            range: some(variant("datetimePreset", variant("last30d", null))),
        }));
        const r = $.const(East.value({ sessions: 7n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), true));
    });

    test("range: integer arm on a datetime rangeFieldId is inert, not a silent epoch-millis compare", $ => {
        const RowType = StructType({ when: DateTimeType });
        const cfg = $.let(Slice.config(RowType, { fields: { when: { label: "When" } }, rangeFieldId: "when" }));
        const state = $.const(Slice.state({
            range: some(variant("integer", { from: 0n, to: 100n })),
        }));
        const r = $.const(East.value({ when: new Date("2023-06-01T00:00:00Z") }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), true));
    });

    test("apply.matches: search falls back to a string field when searchFieldIds names only a non-string one", $ => {
        const RowType = StructType({ region: StringType, sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, {
            fields: { region: { label: "Region" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["sessions"],   // names ONLY the non-string field
        }));
        const state = $.const(Slice.state({ search: some("apac") }));
        const r = $.const(East.value({ region: "APAC", sessions: 5n }, RowType));
        $(Assert.equal(Slice.apply.matches([RowType], state, cfg, r), true));
    });

    test("apply.breakdown: a datetime breakdown key is a stable ISO string", $ => {
        const RowType = StructType({ when: DateTimeType });
        const cfg = $.let(Slice.config(RowType, { fields: { when: { label: "When" } }, breakdownFieldIds: ["when"] }));
        const state = $.const(Slice.state({ breakdown: some({ fieldId: "when", limit: none }) }));
        const data = $.const(East.value([
            { when: new Date("2023-06-01T00:00:00Z") },
            { when: new Date("2023-06-01T00:00:00Z") },
        ], ArrayType(RowType)));
        const bd = $.let(Slice.apply.breakdown([RowType], state, cfg, data), ArrayType(Slice.Types.BreakdownGroup));
        $(Assert.equal(bd.length(), 1n));
        $(Assert.equal(bd.get(0n).count, 2n));
        $(Assert.equal(bd.get(0n).key, "2023-06-01T00:00:00.000Z"));
    });

    test("apply.breakdown: a non-positive top-N limit means 'no limit' (no collapse into one 'other' bucket)", $ => {
        const RowType = StructType({ region: StringType });
        const cfg = $.let(Slice.config(RowType, { fields: { region: { label: "Region" } }, breakdownFieldIds: ["region"] }));
        const state = $.const(Slice.state({ breakdown: some({ fieldId: "region", limit: some(0n) }) }));
        const data = $.const(East.value(
            [{ region: "EU" }, { region: "NA" }, { region: "APAC" }],
            ArrayType(RowType),
        ));
        const bd = $.let(Slice.apply.breakdown([RowType], state, cfg, data), ArrayType(Slice.Types.BreakdownGroup));
        // limit 0 must NOT collapse all categories into a single "other" bucket.
        $(Assert.equal(bd.length(), 3n));
        $(Assert.equal(bd.filter(($, g) => East.equal(g.key, "other")).length(), 0n));
    });

    // =======================================================================
    // Slice.apply.where — element-level assertions, not just length
    // =======================================================================

    test("apply.where: filters down and preserves element values", $ => {
        const RowType = StructType({ sku: StringType, sessions: IntegerType });
        const cfg = $.let(Slice.config(RowType, {
            fields: {
                sku:      { label: "SKU"      },
                sessions: { label: "Sessions" },
            },
        }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
        }));
        const data = $.const(East.value([
            { sku: "A", sessions: 5n  },
            { sku: "B", sessions: 10n },
            { sku: "C", sessions: 20n },
            { sku: "D", sessions: 8n  },
            { sku: "E", sessions: 99n },
        ], ArrayType(RowType)));
        const filtered = $.let(Slice.apply.where([RowType], state, cfg, data), ArrayType(RowType));
        $(Assert.equal(filtered.length(),         3n));
        $(Assert.equal(filtered.get(0n).sku,      "B"));
        $(Assert.equal(filtered.get(0n).sessions, 10n));
        $(Assert.equal(filtered.get(1n).sku,      "C"));
        $(Assert.equal(filtered.get(1n).sessions, 20n));
        $(Assert.equal(filtered.get(2n).sku,      "E"));
        $(Assert.equal(filtered.get(2n).sessions, 99n));
    });

    test("apply.where: empty state preserves order and every element", $ => {
        const RowType = StructType({ sku: StringType });
        const cfg = $.let(Slice.config(RowType, { fields: { sku: { label: "SKU" } } }));
        const state = $.const(Slice.state());
        const data = $.const(East.value([
            { sku: "A" },
            { sku: "B" },
            { sku: "C" },
        ], ArrayType(RowType)));
        const filtered = $.let(Slice.apply.where([RowType], state, cfg, data), ArrayType(RowType));
        $(Assert.equal(filtered.length(),    3n));
        $(Assert.equal(filtered.get(0n).sku, "A"));
        $(Assert.equal(filtered.get(1n).sku, "B"));
        $(Assert.equal(filtered.get(2n).sku, "C"));
    });

    test("apply.where: composes range + filter + active cohort", $ => {
        const RowType = StructType({ country: StringType, sessions: IntegerType, ts: DateTimeType });
        const cfg = $.let(Slice.config(RowType, {
            fields: {
                country:  { label: "Country"  },
                sessions: { label: "Sessions" },
                ts:       { label: "TS"       },
            },
            rangeFieldId: "ts",
        }));
        const state = $.const(Slice.state({
            range: some(variant("datetime", {
                from: new Date("2025-01-01T00:00:00Z"),
                to:   new Date("2025-12-31T00:00:00Z"),
            })),
            filters: [variant("string", { fieldId: "country", op: variant("eq", "US") })],
            cohorts: [
                {
                    id: "power",
                    name: "Power",
                    filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
                },
            ],
            activeCohorts: new Set(["power"]),
        }));
        const data = $.const(East.value([
            { country: "US", sessions: 5n,  ts: new Date("2025-06-01T00:00:00Z") },  // fail (sessions)
            { country: "US", sessions: 10n, ts: new Date("2025-06-01T00:00:00Z") },  // pass
            { country: "UK", sessions: 20n, ts: new Date("2025-06-01T00:00:00Z") },  // fail (country)
            { country: "US", sessions: 30n, ts: new Date("2024-12-31T00:00:00Z") },  // fail (ts)
            { country: "US", sessions: 99n, ts: new Date("2025-12-01T00:00:00Z") },  // pass
        ], ArrayType(RowType)));
        const filtered = $.let(Slice.apply.where([RowType], state, cfg, data), ArrayType(RowType));
        $(Assert.equal(filtered.length(),         2n));
        $(Assert.equal(filtered.get(0n).sessions, 10n));
        $(Assert.equal(filtered.get(1n).sessions, 99n));
    });

    test("apply.where: returns an empty array when no row matches", $ => {
        const RowType = StructType({ n: IntegerType });
        const cfg = $.let(Slice.config(RowType, { fields: { n: { label: "N" } } }));
        const state = $.const(Slice.state({
            filters: [variant("integer", { fieldId: "n", op: variant("gt", 1000n) })],
        }));
        const data = $.const(East.value([
            { n: 1n }, { n: 2n }, { n: 3n },
        ], ArrayType(RowType)));
        const filtered = $.let(Slice.apply.where([RowType], state, cfg, data), ArrayType(RowType));
        $(Assert.equal(filtered.length(), 0n));
    });

    // =======================================================================
    // Slice.apply.breakdownKey — unwrap and assert exact value
    // =======================================================================

    test("apply.breakdownKey: returns some(<string>) when breakdown is on a string field", $ => {
        const RowType = StructType({ country: StringType });
        const cfg = $.let(Slice.config(RowType, {
            fields:            { country: { label: "Country" } },
            breakdownFieldIds: ["country"],
        }));
        const state = $.const(Slice.state({
            breakdown: some({ fieldId: "country", limit: none }),
        }));
        const rUS = $.const(East.value({ country: "US" }, RowType));
        const rUK = $.const(East.value({ country: "UK" }, RowType));
        const keyUS = $.let(Slice.apply.breakdownKey([RowType], state, cfg, rUS), OptionType(StringType));
        const keyUK = $.let(Slice.apply.breakdownKey([RowType], state, cfg, rUK), OptionType(StringType));
        $(Assert.equal(keyUS.unwrap("some"), "US"));
        $(Assert.equal(keyUK.unwrap("some"), "UK"));
    });

    test("apply.breakdownKey: stringifies non-string fields", $ => {
        const RowType = StructType({ n: IntegerType, active: BooleanType });
        const cfg = $.let(Slice.config(RowType, {
            fields: {
                n:      { label: "N"      },
                active: { label: "Active" },
            },
            breakdownFieldIds: ["n", "active"],
        }));
        const stateInt  = $.const(Slice.state({ breakdown: some({ fieldId: "n",      limit: none }) }));
        const stateBool = $.const(Slice.state({ breakdown: some({ fieldId: "active", limit: none }) }));
        const r = $.const(East.value({ n: 42n, active: true }, RowType));
        const keyInt  = $.let(Slice.apply.breakdownKey([RowType], stateInt,  cfg, r), OptionType(StringType));
        const keyBool = $.let(Slice.apply.breakdownKey([RowType], stateBool, cfg, r), OptionType(StringType));
        $(Assert.equal(keyInt.unwrap("some"),  "42"));
        $(Assert.equal(keyBool.unwrap("some"), "true"));
    });

    test("apply.breakdownKey: returns none when no breakdown is active", $ => {
        const RowType = StructType({ country: StringType });
        const cfg = $.let(Slice.config(RowType, { fields: { country: { label: "Country" } } }));
        const state = $.const(Slice.state());
        const r = $.const(East.value({ country: "US" }, RowType));
        const key = $.let(Slice.apply.breakdownKey([RowType], state, cfg, r), OptionType(StringType));
        $(Assert.equal(key.getTag(), "none"));
    });
}, { platformFns: [...TestImpl, ...SliceApplyImpl] });
