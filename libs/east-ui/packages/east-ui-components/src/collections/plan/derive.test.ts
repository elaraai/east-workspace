/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The renderer-side derivations (`derive.ts`) — rollup bands, heat / table
 * aggregates, their cost at scale (#810), and diagnostic rows (#811, #822).
 *
 * (Split out of `model.test.ts` with the module it tests, #815.)
 */

import { describe, test, expect } from "vitest";
import { some, none, variant } from "@elaraai/east";
import {
    rowHeight, deriveBands, deriveHeatCells, deriveTableCells, derivePlan, indexRows, toCanvasRows, windowRestHeight,
    axisKindMismatches, HEAT_ROW_H, ROW_H, ROW_H_DENSE, GROUP_STRIP_H, GROUP_H, type PlanRowValue,
    type PlanWireRow, type VisibleRow,
} from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { rowId, rowKey } from "./plan.test-utils.js";

/** Instants on each arm — REAL East variant values, as the decoder yields them (#631). */
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;
const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;
const o = (v: string): PlanInstantValue => variant("ordinal", v) as PlanInstantValue;

function visible(r: PlanRowValue, opts?: { collapsed?: boolean }): VisibleRow {
    return { row: r, depth: 0, collapsed: opts?.collapsed === true };
}
const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none });

// ── Derivations (§4.2 — the semantics the IR used to precompute) ────────────

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const W30 = new Date("2026-07-20T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const W32 = new Date("2026-08-03T00:00:00Z");

function mkRun(key: string, start: Date, end: Date, state: unknown, qty?: number) {
    return {
        key, start: t(start), end: t(end), label: key,
        quantity: none, qty: qty !== undefined ? some(qty) : none,
        state, status: none, moved: none, icon: none, popover: none, hovercard: none,
    } as unknown as Parameters<typeof deriveBands>[0][number];
}

describe("Plan derived bands (§4·K1 rollups)", () => {
    test("union merges overlaps with peak concurrency, summed qty and pessimistic state", () => {
        const bands = deriveBands([
            mkRun("ra", W27, W29, variant("actual", null), 96),
            mkRun("rb", W28, W30, variant("confirmed", null), 50),
            mkRun("rc", W31, W32, variant("proposed", variant("recommended", null)), 88),
        ], "union", "t");
        expect(bands).toHaveLength(2);
        expect(bands[0]).toMatchObject({ from: t(W27), to: t(W30), count: 2, quantity: "146 t" });
        expect((bands[0]!.state as { type: string }).type).toBe("confirmed");   // rank 2 < actual 3
        expect(bands[1]).toMatchObject({ from: t(W31), to: t(W32), count: 1, quantity: "88 t" });
    });

    test("rejected runs are excluded; a missing qty suppresses the sum", () => {
        const bands = deriveBands([
            mkRun("r1", W27, W28, variant("actual", null)),
            mkRun("r2", W29, W30, variant("rejected", null), 10),
        ], "union", "t");
        expect(bands).toHaveLength(1);
        expect(bands[0]!.from).toEqual(t(W27));
        expect(bands[0]!.quantity).toBeUndefined();
    });

    test("byStatus keeps overlapping runs of different states in separate bands", () => {
        const bands = deriveBands([
            mkRun("r1", W27, W29, variant("actual", null)),
            mkRun("r2", W28, W30, variant("confirmed", null)),
        ], "byStatus", undefined);
        expect(bands).toHaveLength(2);
        expect((bands[0]!.state as { type: string }).type).toBe("actual");
        expect((bands[1]!.state as { type: string }).type).toBe("confirmed");
    });
});

/**
 * One canvas row at a key, optionally parented. The derivations treat keys as
 * opaque, so these rows key by the test's own words rather than by their ids'
 * canonical text — every map below reads `"mid"`, not the id printed.
 */
function trow(key: string, parent: string | undefined, kind: unknown, opts?: { collapsed?: boolean }): PlanRowValue {
    return {
        id: rowId(key),
        key,
        parent: parent !== undefined ? some(parent) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        collapsed: opts?.collapsed !== undefined ? some(opts.collapsed) : none,
        pinned: none, height: none, status: none, approval: none, expand: none,
        duplicateOf: undefined,
    } as unknown as PlanRowValue;
}

/** One WIRE row, for the tests that need the stream's own keying. */
function wire(key: string, parent: string | undefined, kind: unknown): PlanWireRow {
    return {
        id: rowId(key),
        parent: parent !== undefined ? some(rowId(parent)) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        collapsed: none, pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanWireRow;
}

/** `gp → (mid → a, b), leaf` — two declared-subtotal levels over raw cells. */
function nestedTableRows(): PlanRowValue[] {
    const tableKind = (cells: unknown[], aggregate: boolean) => variant("table", {
        series: cells.length > 0
            ? [{ cells, format: none, tone: none, strong: none, rollup: none }]
            : [],
        split: variant("horizontal", null),
        aggregate: aggregate ? some(variant("sum", null)) : none,
        format: none,
        emphasis: variant("body", null),
    });
    const cell = (at: Date, v: number) => ({ at: t(at), value: some(v), text: none, tone: none });
    return [
        trow("gp", undefined, tableKind([], true)),
        trow("mid", "gp", tableKind([], true)),
        trow("a", "mid", tableKind([cell(W27, 96)], false)),
        trow("b", "mid", tableKind([cell(W27, 54)], false)),
        trow("leaf", "gp", tableKind([cell(W27, 10)], false)),
    ];
}

describe("Plan derived heat / table aggregates", () => {
    test("heat mean skips no-data cells and labels through the shared formatter", () => {
        const cells = deriveHeatCells([
            { at: t(W27), value: some(40), label: none },
            { at: t(W27), value: some(60), label: none },
            { at: t(W28), value: some(60), label: none },
            { at: t(W28), value: none, label: none },
        ] as unknown as Parameters<typeof deriveHeatCells>[0], "mean");
        expect(cells).toHaveLength(2);
        expect(cells[0]).toMatchObject({ value: { type: "some", value: 50 }, label: { type: "some", value: "50" } });
        expect(cells[1]).toMatchObject({ value: { type: "some", value: 60 } });
    });

    test("declared parents nest — a grandparent aggregates its children's DERIVED cells", () => {
        const derived = derivePlan(indexRows(nestedTableRows()));
        expect(derived.tableSeries.get("mid")![0]!.cells[0]).toMatchObject({ value: { type: "some", value: 150 } });
        expect(derived.tableSeries.get("gp")![0]!.cells[0]).toMatchObject({ value: { type: "some", value: 160 } });    // 150 derived + 10 leaf
    });

    test("the walk follows the TREE, not the container order (#568, #822)", () => {
        // The stream puts a parent before its subtree, but not always right
        // before it (`views` puts an entry's children after all of its view
        // rows), and a keyed collection once sorted parents after children.
        // Feeding a bottom-up aggregation the wrong order produces WRONG
        // NUMBERS, not an error — this guards `derivePlan`'s post-order
        // traversal. Same rows, three orders (depth-first, key order, and
        // reversed), identical results.
        const depthFirst = nestedTableRows();
        const keyOrder = [...depthFirst].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
        const reversed = [...depthFirst].reverse();
        expect(keyOrder.map((r) => r.key)).toEqual(["a", "b", "gp", "leaf", "mid"]);   // parents interleaved
        const fromDepthFirst = derivePlan(indexRows(depthFirst));
        for (const order of [keyOrder, reversed]) {
            const derived = derivePlan(indexRows(order));
            expect(derived.tableSeries.get("mid")![0]!.cells[0]).toMatchObject({ value: { type: "some", value: 150 } });
            expect(derived.tableSeries.get("gp")![0]!.cells[0]).toMatchObject({ value: { type: "some", value: 160 } });
            expect(derived.tableSeries).toEqual(fromDepthFirst.tableSeries);
        }
    });

    test("a subtotal mirrors its members' SHAPE — every position rolls up, not just the first", () => {
        // The defect this replaced: `rollup` defaulted to "the first series",
        // so a parent over two-position children printed one number per bucket
        // and looked complete. A subtotal that silently drops a column is worse
        // than no subtotal.
        const multi = (a: number, b: number) => variant("table", {
            series: [
                { cells: [{ at: t(W27), value: some(a), text: none, tone: none }],
                  format: none, tone: none, strong: some(true), rollup: none },
                { cells: [{ at: t(W27), value: some(b), text: none, tone: none }],
                  format: none, tone: some(variant("muted", null)), strong: none, rollup: none },
            ],
            split: variant("horizontal", null), aggregate: none, format: none,
            emphasis: variant("body", null),
        });
        const empty = variant("table", {
            series: [], split: variant("horizontal", null),
            aggregate: some(variant("sum", null)), format: none, emphasis: variant("body", null),
        });
        const derived = derivePlan(indexRows([
            trow("p", undefined, empty),
            trow("x", "p", multi(96, -8)),
            trow("y", "p", multi(54, -2)),
        ]));
        const positions = derived.tableSeries.get("p")!;
        expect(positions).toHaveLength(2);
        expect(positions[0]!.cells[0]).toMatchObject({ value: { type: "some", value: 150 } });
        expect(positions[1]!.cells[0]).toMatchObject({ value: { type: "some", value: -10 } });
        // ...and each derived position wears its members' declarations, so the
        // subtotal is styled like the numbers it totals.
        expect(positions[0]!.strong).toMatchObject({ type: "some", value: true });
        expect(positions[1]!.tone).toMatchObject({ type: "some", value: { type: "muted" } });
    });

    test("`rollup: true` still NARROWS — an author can say which position is the number", () => {
        const flagged = (a: number, b: number) => variant("table", {
            series: [
                { cells: [{ at: t(W27), value: some(a), text: none, tone: none }],
                  format: none, tone: none, strong: none, rollup: some(true) },
                { cells: [{ at: t(W27), value: some(b), text: none, tone: none }],
                  format: none, tone: none, strong: none, rollup: none },
            ],
            split: variant("horizontal", null), aggregate: none, format: none,
            emphasis: variant("body", null),
        });
        const empty = variant("table", {
            series: [], split: variant("horizontal", null),
            aggregate: some(variant("sum", null)), format: none, emphasis: variant("body", null),
        });
        const derived = derivePlan(indexRows([
            trow("p", undefined, empty),
            trow("x", "p", flagged(96, -8)),
            trow("y", "p", flagged(54, -2)),
        ]));
        const positions = derived.tableSeries.get("p")!;
        expect(positions).toHaveLength(1);                                   // the Δ is commentary
        expect(positions[0]!.cells[0]).toMatchObject({ value: { type: "some", value: 150 } });
    });

    test("a VERTICAL subtotal grows for its DERIVED positions, not its (empty) own", () => {
        // A subtotal parent carries no series of its own — they are derived —
        // so estimating from `kind.value.series.length` would call a two-line
        // stack one line and render taller than the virtualizer was told.
        // THREE positions, so the stack clears the shared 32px default and the
        // derived width is observable as a height difference.
        const vmulti = (a: number, b: number, c: number) => variant("table", {
            series: [
                { cells: [{ at: t(W27), value: some(a), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
                { cells: [{ at: t(W27), value: some(b), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
                { cells: [{ at: t(W27), value: some(c), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
            ],
            split: variant("vertical", null), aggregate: none, format: none, emphasis: variant("body", null),
        });
        const parent = variant("table", {
            series: [], split: variant("vertical", null),
            aggregate: some(variant("sum", null)), format: none, emphasis: variant("body", null),
        });
        const rows = [trow("p", undefined, parent), trow("x", "p", vmulti(1, 2, 3))];
        const index = indexRows(rows);
        const derived = derivePlan(index);
        const pv = visible(index.byKey.get("p")!);
        // Without the derived width it estimates the shared default.
        expect(rowHeight(pv, false, new Set())).toBe(ROW_H);
        // With it, the same 6 + n×11 the members use.
        expect(rowHeight(pv, false, new Set(), undefined, derived)).toBe(39);
    });

    test("a group's member count is DERIVED, not carried by the IR (#568)", () => {
        // A count is an aggregate like any other: the renderer counts the
        // members the group actually has.
        const group = (key: string, parent?: string) => trow(key, parent,
            variant("group", { summary: none, summaryAggregate: none }));
        const rows = [
            group("g"),
            trow("m1", "g", spanKind),
            trow("m2", "g", spanKind),
            group("nested", "g"),
            trow("m3", "nested", spanKind),
        ];
        const derived = derivePlan(indexRows(rows));
        expect(derived.groupMembers.get("g")).toBe(3);          // m1, m2 and the nested group
        expect(derived.groupMembers.get("nested")).toBe(1);
    });

    test("ordinal cells derive in DECLARED order when the axis's index is given; without it, insertion order (#631)", () => {
        const PH = new Map([["INTAKE", 0], ["PREP", 1], ["BUILD", 2], ["QC", 3]]);
        const cells = [
            { at: o("QC"), value: some(4), label: none },
            { at: o("PREP"), value: some(1), label: none },
            { at: o("PREP"), value: some(3), label: none },
            { at: o("INTAKE"), value: some(9), label: none },
        ] as unknown as Parameters<typeof deriveHeatCells>[0];
        expect(deriveHeatCells(cells, "mean", PH).map((c) => (c.at.type === "ordinal" ? c.at.value : "?")))
            .toEqual(["INTAKE", "PREP", "QC"]);
        expect(deriveHeatCells(cells, "mean", PH)[1]).toMatchObject({ value: { type: "some", value: 2 } });
        // The ledger's height measure derives without the axis — order is
        // insertion, the numbers are the same.
        expect(deriveHeatCells(cells, "mean").map((c) => (c.at.type === "ordinal" ? c.at.value : "?")))
            .toEqual(["QC", "PREP", "INTAKE"]);
        // Number instants order numerically, no map needed.
        const nums = [
            { at: n(3), value: some(1), text: none, tone: none },
            { at: n(1), value: some(2), text: none, tone: none },
        ] as unknown as Parameters<typeof deriveTableCells>[0];
        expect(deriveTableCells(nums, "sum").map((c) => (c.at.type === "number" ? c.at.value : NaN))).toEqual([1, 3]);
    });

    test("ordinal rollup bands close on the END's own bucket — an end names its last bucket (#631)", () => {
        const PH = new Map([["INTAKE", 0], ["PREP", 1], ["BUILD", 2], ["QC", 3], ["PACK", 4]]);
        const run = (key: string, start: string, end: string) => ({
            key, start: o(start), end: o(end), label: key,
            quantity: none, qty: none, state: variant("confirmed", null), status: none, moved: none, icon: none,
        }) as unknown as Parameters<typeof deriveBands>[0][number];
        // [INTAKE, PREP] and [BUILD, QC] touch at the PREP|BUILD edge — on a
        // half-open axis they would merge; with inclusive ends PREP is covered
        // by the first run, so BUILD starts a NEW band.
        const bands = deriveBands([run("a", "INTAKE", "PREP"), run("b", "BUILD", "QC")], "union", undefined, PH);
        expect(bands).toHaveLength(2);
        expect(bands[0]).toMatchObject({ from: o("INTAKE"), to: o("PREP") });
        // [INTAKE, BUILD] and [BUILD, QC] share BUILD — one band, ×2.
        const merged = deriveBands([run("a", "INTAKE", "BUILD"), run("b", "BUILD", "QC")], "union", undefined, PH);
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ from: o("INTAKE"), to: o("QC"), count: 2 });
    });

    test("axisKindMismatches names every row whose instants ride another arm (#631)", () => {
        const heat = (at: PlanInstantValue) => variant("heat", {
            cells: variant("heat", { cells: [{ at, value: some(1), label: none }], min: none, max: none, warnAt: none }),
            aggregate: none,
        });
        const rows = [
            trow("ok", undefined, heat(n(2))),
            trow("bad", undefined, heat(t(W27))),
            trow("worse", undefined, variant("events", { marks: [{ key: "m", at: o("QC"), kind: variant("milestone", null), icon: none, label: none }] })),
            trow("empty", undefined, variant("events", { marks: [] })),
        ];
        expect(axisKindMismatches(indexRows(rows), "number")).toEqual([
            { row: "bad", found: "time" },
            { row: "worse", found: "ordinal" },
        ]);
        expect(axisKindMismatches(indexRows(rows), "time")).toEqual([
            { row: "ok", found: "number" },
            { row: "worse", found: "ordinal" },
        ]);
    });

    test("a table parent with values of its own shows them; one with none shows its subtree's subtotal (#822)", () => {
        // A recursive table's parent is the same series as its children, so
        // it declares `aggregate` whether or not the data gave it numbers.
        const tableKind = (v: number | undefined) => variant("table", {
            series: [{
                cells: v !== undefined ? [{ at: t(W27), value: some(v), text: none, tone: none }] : [],
                format: none, tone: none, strong: none, rollup: none,
            }],
            split: variant("horizontal", null),
            aggregate: some(variant("sum", null)), format: none, emphasis: variant("body", null),
        });
        const derived = derivePlan(indexRows([
            trow("own", undefined, tableKind(7)),
            trow("a", "own", tableKind(96)),
            trow("empty", undefined, tableKind(undefined)),
            trow("b", "empty", tableKind(54)),
            trow("mid", "empty", tableKind(undefined)),
            trow("c", "mid", tableKind(10)),
        ]));
        // Its own 7 stands — never replaced by the 96 beneath it.
        expect(derived.tableSeries.has("own")).toBe(false);
        // An empty parent subtotals its subtree, through an empty parent too.
        expect(derived.tableSeries.get("mid")![0]!.cells[0]).toMatchObject({ value: { type: "some", value: 10 } });
        expect(derived.tableSeries.get("empty")![0]!.cells[0]).toMatchObject({ value: { type: "some", value: 64 } });
    });

    test("table sum subtotals carry raw values; text and tone stay renderer-owned", () => {
        const cells = deriveTableCells([
            { at: t(W27), value: some(96), text: none, tone: none },
            { at: t(W27), value: some(54), text: none, tone: none },
            { at: t(W28), value: some(-4), text: none, tone: none },
            { at: t(W29), value: none, text: none, tone: none },
        ] as unknown as Parameters<typeof deriveTableCells>[0], "sum");
        expect(cells[0]).toMatchObject({ value: { type: "some", value: 150 } });
        expect(cells[1]).toMatchObject({ value: { type: "some", value: -4 }, text: { type: "none" }, tone: { type: "none" } });
        expect(cells[2]).toMatchObject({ value: { type: "none" } });
    });
});

// ── Derivations at scale (#810) ─────────────────────────────────────────────

describe("Plan derivations at scale (#810)", () => {
    // Past ~125,000 arguments a spread into a call throws RangeError — the
    // engine's argument limit, measured under vitest on Node 22. 100,000
    // still survives a spread there, so these run at 250,000: a size the old
    // spreads cannot survive, so the tests fail on any that comes back.
    const N = 250_000;
    const confirmed = variant("confirmed", null);
    const numRun = (key: string, start: number, end: number) => ({
        key, start: n(start), end: n(end), label: key,
        quantity: none, qty: none, state: confirmed, status: none, moved: none, icon: none, popover: none, hovercard: none,
    }) as unknown as Parameters<typeof deriveBands>[0][number];
    const span = (runs: unknown[], rollup: boolean) => variant("span", {
        runs, decisions: [], ports: [],
        rollup: rollup ? some(variant("union", null)) : none,
        unit: none, bands: [],
    });

    test("band counts: touching runs are sequential, identical and nested ones stack, a lone empty run counts 1", () => {
        const bands = deriveBands([
            numRun("a", 0, 10),
            numRun("b", 0, 10),     // identical to a
            numRun("c", 2, 4),      // nested in both
            numRun("d", 10, 12),    // touches a / b — a NEW band on a half-open axis
            numRun("e", 11, 11),    // zero-length, inside d's band
            numRun("f", 20, 20),    // zero-length, alone
        ], "union", undefined);
        expect(bands.map((b) => ({ from: b.from.value, to: b.to.value, count: b.count }))).toEqual([
            { from: 0, to: 10, count: 3 },
            { from: 10, to: 12, count: 1 },
            { from: 20, to: 20, count: 1 },
        ]);
    });

    test("a 250,000-run rollup band derives — no RangeError, no quadratic count", () => {
        // Each run overlaps the next, so the whole subtree is ONE band whose
        // peak is 2 — the old per-member count was 6×10¹⁰ comparisons here,
        // and gathering the subtree's runs was a spread.
        const runs = Array.from({ length: N }, (_, i) => numRun(`r${i}`, i, i + 2));
        const derived = derivePlan(indexRows([
            trow("p", undefined, span([], true)),
            trow("c", "p", span(runs, false)),
        ]));
        expect(derived.bands.get("p")).toEqual([
            expect.objectContaining({ from: n(0), to: n(N + 1), count: 2 }),
        ]);
    });

    test("250,000 cells in one bucket aggregate — max / min without a spread", () => {
        const at = n(1);
        const heat = Array.from({ length: N }, (_, i) => ({ at, value: some(i % 1000), label: none }));
        expect(deriveHeatCells(heat as unknown as Parameters<typeof deriveHeatCells>[0], "max"))
            .toEqual([expect.objectContaining({ value: some(999) })]);
        const table = Array.from({ length: N }, (_, i) => ({ at, value: some(i - 5), text: none, tone: none }));
        const cells = table as unknown as Parameters<typeof deriveTableCells>[0];
        expect(deriveTableCells(cells, "min")).toEqual([expect.objectContaining({ value: some(-5) })]);
        expect(deriveTableCells(cells, "max")).toEqual([expect.objectContaining({ value: some(N - 6) })]);
    });

    test("a group strip over 250,000 heat members inherits their widest scale", () => {
        const heatOn = (min: number, max: number, warnAt: number) => variant("heat", {
            cells: variant("heat", { cells: [{ at: n(1), value: some(50), label: none }], min: some(min), max: some(max), warnAt: some(warnAt) }),
            aggregate: none,
        });
        const kinds = [heatOn(0, 100, 90), heatOn(-5, 100, 80), heatOn(0, 120, 95)];
        const member = trow("m", "g", kinds[0]);
        const rows: PlanRowValue[] = [
            trow("g", undefined, variant("group", { summary: none, summaryAggregate: some(variant("max", null)) })),
        ];
        // One shared kind object per scale — 250,000 rows, not 250,000 kinds.
        for (let i = 0; i < N; i++) rows.push({ ...member, key: `m${i}`, kind: kinds[i % kinds.length] } as unknown as PlanRowValue);
        const derived = derivePlan(indexRows(rows));
        expect(derived.groupMembers.get("g")).toBe(N);
        expect(derived.groupSummaryScale.get("g")).toEqual({ min: -5, max: 120, warnAt: 80 });
        expect(derived.groupSummary.get("g")).toEqual([expect.objectContaining({ value: some(50) })]);
    });

    test("derived numbers print through the shared formatter (en-US): a heat mean labels 0.787, a band total captions 1,234.5 t", () => {
        const mean = deriveHeatCells([0.82, 0.64, 0.9].map((v) => ({ at: t(W27), value: some(v), label: none })) as unknown as Parameters<typeof deriveHeatCells>[0], "mean");
        expect(mean[0]!.label).toEqual(some("0.787"));      // was "1" — `toFixed(0)`
        const bands = deriveBands([
            mkRun("ra", W27, W29, variant("confirmed", null), 1000),
            mkRun("rb", W28, W30, variant("confirmed", null), 234.5),
        ], "union", "t");
        expect(bands[0]!.quantity).toBe("1,234.5 t");       // was "1235 t"
    });
});

// ── Failure is local (#811) ─────────────────────────────────────────────────

describe("Plan diagnostic rows (#811)", () => {
    const numRun = (key: string, start: PlanInstantValue, end: PlanInstantValue, qty: number) => ({
        key, start, end, label: key, quantity: none, qty: some(qty),
        state: variant("confirmed", null), status: none, moved: none, icon: none,
    });
    const span = (runs: unknown[], rollup?: boolean) => variant("span", {
        runs, decisions: [], ports: [],
        rollup: rollup === true ? some(variant("union", null)) : none,
        unit: rollup === true ? some("t") : none,
    });
    const heatAt = (at: PlanInstantValue, v: number, scale?: [number, number]) => variant("heat", {
        cells: variant("heat", {
            cells: [{ at, value: some(v), label: none }],
            min: scale !== undefined ? some(scale[0]) : none,
            max: scale !== undefined ? some(scale[1]) : none,
            warnAt: none,
        }),
        aggregate: none,
    });
    /** A number-axis canvas where every declared parent has one child on
     *  the axis's arm and one on ANOTHER (time) arm. */
    const mixedRows = () => [
        trow("p", undefined, span([], true)),
        trow("ok", "p", span([numRun("r", n(1), n(3), 5)])),
        trow("bad", "p", span([numRun("x", t(W27), t(W29), 7)])),
        trow("hp", undefined, variant("heat", {
            cells: variant("heat", { cells: [], min: none, max: none, warnAt: none }),
            aggregate: some(variant("mean", null)),
        })),
        trow("h1", "hp", heatAt(n(1), 10)),
        trow("h2", "hp", heatAt(t(W27), 90)),
        trow("g", undefined, variant("group", { summary: none, summaryAggregate: some(variant("max", null)) })),
        trow("h3", "g", heatAt(n(1), 20, [0, 100])),
        trow("h4", "g", heatAt(t(W27), 99, [-50, 500])),
    ];

    test("a row on another arm is recorded — and derives NOTHING into any parent; it still counts as a member", () => {
        const derived = derivePlan(indexRows(mixedRows()), undefined, "number");
        expect([...derived.diagnostics]).toEqual([
            ["bad", { kind: "axis", found: "time", expected: "number" }],
            ["h2", { kind: "axis", found: "time", expected: "number" }],
            ["h4", { kind: "axis", found: "time", expected: "number" }],
        ]);
        // The rollup band is the placeable child's alone — not "12 t".
        expect(derived.bands.get("p")).toEqual([expect.objectContaining({ from: n(1), to: n(3), count: 1, quantity: "5 t" })]);
        // The aggregate has one bucket on the axis, not a second at a time instant.
        expect(derived.heatCells.get("hp")).toEqual([expect.objectContaining({ at: n(1), value: some(10) })]);
        // The strip and its inherited scale come from the placeable member only.
        expect(derived.groupSummary.get("g")).toEqual([expect.objectContaining({ at: n(1), value: some(20) })]);
        expect(derived.groupSummaryScale.get("g")).toEqual({ min: 0, max: 100, warnAt: undefined });
        // ...while the band still counts both members: the skipped one renders.
        expect(derived.groupMembers.get("g")).toBe(2);
    });

    test("without an axis kind nothing is diagnosed (the ledger measures raw windows the same way)", () => {
        expect(derivePlan(indexRows(mixedRows())).diagnostics.size).toBe(0);
    });

    test("a diagnostic row is one line at the shared default; a diagnosed group keeps its band, not a strip", () => {
        const rows = [
            trow("heatbad", undefined, heatAt(t(W27), 1)),
            trow("grp", undefined, variant("group", {
                summary: some(variant("heat", { cells: [{ at: t(W27), value: some(1), label: none }], min: none, max: none, warnAt: none })),
                summaryAggregate: none,
            }), { collapsed: true }),
        ];
        const index = indexRows(rows);
        const derived = derivePlan(index, undefined, "number");
        const heatV = visible(index.byKey.get("heatbad")!);
        const grpV = visible(index.byKey.get("grp")!, { collapsed: true });
        // At rest a heat row is 28px; as a diagnostic it is the one-line default.
        expect(rowHeight(heatV, false, new Set())).toBe(HEAT_ROW_H);
        expect(rowHeight(heatV, false, new Set(), undefined, derived)).toBe(ROW_H);
        expect(rowHeight(heatV, true, new Set(), undefined, derived)).toBe(ROW_H_DENSE);
        // A collapsed group with a strip is 28px; diagnosed, its strip cannot
        // be placed, so it is the plain band.
        expect(rowHeight(grpV, false, new Set())).toBe(GROUP_STRIP_H);
        expect(rowHeight(grpV, false, new Set(), undefined, derived)).toBe(GROUP_H);
        // The ledger measures the window the way it renders — as a diagnostic.
        expect(windowRestHeight([rows[0]!], "resource", false)).toBe(HEAT_ROW_H);
        expect(windowRestHeight([rows[0]!], "resource", false, "number")).toBe(ROW_H);
    });

    test("a repeated id is a diagnostic row of its own — it derives nothing, and the first keeps its numbers (#822)", () => {
        // Hand-built rows can repeat an id; the stream keeps both rows, the
        // second keyed apart and naming the first.
        const rows = toCanvasRows([
            wire("p", undefined, span([], true)),
            wire("c", "p", span([numRun("r1", n(1), n(3), 5)])),
            wire("c", "p", span([numRun("r2", n(6), n(8), 7)])),
        ]);
        const derived = derivePlan(indexRows(rows), undefined, "number");
        expect([...derived.diagnostics]).toEqual([
            [`${rowKey("c")}#1`, { kind: "duplicate", of: rowKey("c") }],
        ]);
        // The rollup is the first c's runs alone — the repeat's 7 t is not in it.
        expect(derived.bands.get(rowKey("p"))).toEqual([expect.objectContaining({ from: n(1), to: n(3), quantity: "5 t" })]);
        // A repeat is diagnosed with or without an axis kind: it is never a
        // second row answering to one id.
        expect(derivePlan(indexRows(rows)).diagnostics.size).toBe(1);
    });
});

// A timing budget is opt-in, never a CI gate: a shared runner's CPU is not a
// deterministic signal (the e3-ui-cli perf.spec precedent). CI keeps the
// deterministic proof above — 250,000 members, a count linear in them.
describe.skipIf(process.env["E3_UI_PERF"] !== "1")("Plan derivations — timing (E3_UI_PERF=1; not a CI gate)", () => {
    test("a 4,000-run union band derives in < 20 ms", () => {
        // The review's probe shape: hour-staggered two-day runs, so all 4,000
        // union into one band with a peak of 48 — 208 ms per derive before.
        const HOUR = 3_600_000;
        const t0 = W27.getTime();
        const runs = Array.from({ length: 4_000 }, (_, i) =>
            mkRun(`r${i}`, new Date(t0 + i * HOUR), new Date(t0 + (i + 48) * HOUR), variant("confirmed", null), 10));
        expect(deriveBands(runs, "union", "t")).toEqual([expect.objectContaining({ count: 48 })]);
        const samples: number[] = [];
        for (let i = 0; i < 7; i++) {
            const start = performance.now();
            deriveBands(runs, "union", "t");
            samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        expect(samples[3]!).toBeLessThan(20);
    });
});
