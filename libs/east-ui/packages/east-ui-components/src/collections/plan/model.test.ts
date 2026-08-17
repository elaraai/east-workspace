/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Row-height rules (`Plan Spec.md` §8) — heat rows fit their gutter and
 * two-line gutters floor at 42px.
 */

import { describe, test, expect } from "vitest";
import { some, none, variant } from "@elaraai/east";
import {
    rowHeight, deriveBands, deriveHeatCells, deriveTableCells, deriveLinkFamily, derivePlan, elideForFocus, indexRows, linkedRowKeys,
    HEAT_ROW_H, ROW_H, ROW_H_STACKED, GROUP_STRIP_H, GROUP_H, STRIP_H,
    RAIL_H,
    type PlanLinkValue, type PlanRowValue, type VisibleRow,
} from "./model.js";

function row(kind: unknown, opts?: { sub?: string; stacked?: boolean; expand?: unknown }): PlanRowValue {
    return {
        key: "r",
        parent: none,
        gutter: {
            label: "R", id: none,
            sub: opts?.sub !== undefined ? some(opts.sub) : none,
            value: none, meta: none,
            stacked: opts?.stacked === true ? some(true) : none,
            swatches: [],
        },
        kind,
        pinned: none, height: none, status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanRowValue;
}

function visible(r: PlanRowValue, opts?: { collapsed?: boolean }): VisibleRow {
    return { row: r, depth: 0, collapsed: opts?.collapsed === true };
}

const heatKind = variant("heat", { cells: variant("heat", { cells: [], min: none, max: none, warnAt: none }), aggregate: none });
const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none, bands: [] });

describe("Plan rowHeight (§8)", () => {
    test("heat rows fit a one-line gutter and floor at 42px with a sub line", () => {
        expect(rowHeight(visible(row(heatKind)), false, new Set())).toBe(HEAT_ROW_H);
        expect(rowHeight(visible(row(heatKind, { sub: "%/wk" })), false, new Set())).toBe(ROW_H_STACKED);
        expect(rowHeight(visible(row(heatKind, { stacked: true })), false, new Set())).toBe(ROW_H_STACKED);
    });

    test("span rows: 32 default, 42 with a sub line", () => {
        expect(rowHeight(visible(row(spanKind)), false, new Set())).toBe(ROW_H);
        expect(rowHeight(visible(row(spanKind, { sub: "120 t" })), false, new Set())).toBe(ROW_H_STACKED);
    });

    test("chart rows: spark 32; expanded uses expandedHeight over the 88 default; fixed wins outright", () => {
        const chart = (height: unknown, expandedHeight: unknown) => variant("chart", {
            layers: [], left: none, right: none, height, expandedHeight, expandable: some(true),
        });
        const spark = row(chart(variant("spark", null), none));
        expect(rowHeight(visible(spark), false, new Set())).toBe(32);
        // Toggled open: the declared expandedHeight replaces the 88 default.
        expect(rowHeight(visible(spark), false, new Set(["r"]))).toBe(88);
        // Heights are CSS px sizes (the shared component-height String type).
        const custom = row(chart(variant("spark", null), some("120px")));
        expect(rowHeight(visible(custom), false, new Set(["r"]))).toBe(120);
        expect(rowHeight(visible(row(chart(variant("expanded", null), some("96px")))), false, new Set())).toBe(96);
        expect(rowHeight(visible(row(chart(variant("fixed", "140px"), some("96px")))), false, new Set())).toBe(140);
    });

    test("vertical multi-series table rows grow per stacked line", () => {
        const two = variant("table", {
            series: [
                { cells: [], format: none, tone: none, strong: none, rollup: none },
                { cells: [], format: none, tone: none, strong: none, rollup: none },
            ],
            split: variant("vertical", null),
            aggregate: none, format: none, emphasis: variant("body", null),
        });
        expect(rowHeight(visible(row(two)), false, new Set())).toBe(28);       // 6 + 2×11
        const flat = variant("table", {
            series: [{ cells: [], format: none, tone: none, strong: none, rollup: none }],
            split: variant("vertical", null),
            aggregate: none, format: none, emphasis: variant("body", null),
        });
        expect(rowHeight(visible(row(flat)), false, new Set())).toBe(24);      // single series never grows
    });

    test("laned bucket rows grow to fit their stacked lane cells", () => {
        const laned = variant("buckets", {
            lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
            events: [], markers: [],
        });
        const unlaned = variant("buckets", { lanes: [], events: [], markers: [] });
        expect(rowHeight(visible(row(laned)), false, new Set())).toBe(52);      // 6 + 2×22 + 2
        expect(rowHeight(visible(row(unlaned)), false, new Set())).toBe(ROW_H);
    });

    test("group bands: 26 expanded, 28 as a collapsed summary strip", () => {
        const strip = variant("group", {
            summary: some(variant("heat", { cells: [], min: none, max: none, warnAt: none })),
            summaryAggregate: none,
            collapsed: some(true),
        });
        const bare = variant("group", { summary: none, summaryAggregate: none, collapsed: none });
        expect(rowHeight(visible(row(strip), { collapsed: true }), false, new Set())).toBe(GROUP_STRIP_H);
        expect(rowHeight(visible(row(bare)), false, new Set())).toBe(GROUP_H);
    });
});

describe("Plan row focus heights (R1 rails)", () => {
    const expand = (height?: string) => ({
        render: () => null,
        height: height !== undefined ? some(height) : none,
        axis: variant("keep", null),
    });

    test("links focus: family + groups keep height, everything else rails at 11", () => {
        const family = new Set(["fam"]);
        const focus = { kind: "links" as const, key: "focus", family };
        const other = { ...row(spanKind), key: "other" } as PlanRowValue;
        const fam = { ...row(spanKind), key: "fam" } as PlanRowValue;
        expect(rowHeight(visible(other), false, new Set(), focus)).toBe(RAIL_H);
        expect(rowHeight(visible(fam), false, new Set(), focus)).toBe(ROW_H);
        const grp = { ...row(variant("group", { summary: none, summaryAggregate: none, collapsed: none })), key: "g" } as PlanRowValue;
        expect(rowHeight(visible(grp), false, new Set(), focus)).toBe(GROUP_H);
    });

    test("expand focus: the focal row keeps its kind height, every other DATA row strips to 16px", () => {
        // R2 grows the canvas UNDER the row (its own body item), never the row
        // itself — so the focus is exactly as tall as it was at rest.
        const focus = { kind: "expand" as const, key: "r" };
        expect(rowHeight(visible(row(spanKind, { expand: expand("140px") })), false, new Set(), focus)).toBe(ROW_H);
        const other = { ...row(spanKind), key: "other" } as PlanRowValue;
        expect(rowHeight(visible(other), false, new Set(), focus)).toBe(STRIP_H);
    });

    test("a strip is 16px whatever the row's kind, its gutter or its explicit height", () => {
        const focus = { kind: "expand" as const, key: "focal" };
        const other = (kind: unknown, opts?: { sub?: string }) =>
            ({ ...row(kind, opts), key: "other" } as PlanRowValue);
        // Kinds that are 28 / 24 / 88 / 42 at rest all land on the same rhythm.
        expect(rowHeight(visible(other(heatKind)), false, new Set(), focus)).toBe(STRIP_H);
        expect(rowHeight(visible(other(spanKind, { sub: "120 t" })), false, new Set(), focus)).toBe(STRIP_H);
        // An explicit per-row height is a REST height; it does not survive a
        // focus, or one tall row would break the strip rhythm for all of them.
        const tall = { ...row(spanKind), key: "other", height: some("140px") } as PlanRowValue;
        expect(rowHeight(visible(tall), false, new Set(), focus)).toBe(STRIP_H);
    });

    test("group bands never strip — they are the wayfinding a wall of strips needs", () => {
        const focus = { kind: "expand" as const, key: "focal" };
        const g = { ...row(variant("group", { summary: none, summaryAggregate: none, collapsed: none })),
            key: "g" } as PlanRowValue;
        expect(rowHeight(visible(g), false, new Set(), focus)).toBe(GROUP_H);
    });
});

describe("Plan links-focus elision (R1 at scale)", () => {
    const groupKind = variant("group", { summary: none, summaryAggregate: none, collapsed: none });
    const mk = (key: string, kind: unknown = spanKind, extra?: Partial<PlanRowValue>): PlanRowValue =>
        ({ ...row(kind), key, ...extra } as PlanRowValue);
    const withParent = (r: PlanRowValue, parent: string): PlanRowValue =>
        ({ ...r, parent: some(parent) } as PlanRowValue);
    const focusOn = (key: string, family: string[]) =>
        ({ kind: "links" as const, key, family: new Set(family) });

    test("a LONE unrelated data row stays a rail entry; a run coalesces to ONE gap", () => {
        const rows = [mk("f"), mk("x"), mk("a"), mk("y1"), mk("y2"), mk("y3"), mk("b")];
        const items = elideForFocus(rows.map((r) => visible(r)), indexRows(rows), focusOn("f", ["a", "b"]));
        expect(items.map((i) => (i.kind === "row" ? i.row.row.key : `gap:${i.gap.rows}`)))
            .toEqual(["f", "x", "a", "gap:3", "b"]);
    });

    test("a family-less group and its subtree join the gap; a group HOLDING family keeps its band", () => {
        const rows = [
            mk("f"),
            mk("g-empty", groupKind), withParent(mk("t1"), "g-empty"), withParent(mk("t2"), "g-empty"),
            mk("g-fam", groupKind), withParent(mk("fam"), "g-fam"),
        ];
        const items = elideForFocus(rows.map((r) => visible(r)), indexRows(rows), focusOn("f", ["fam"]));
        expect(items.map((i) => (i.kind === "row" ? i.row.row.key : `gap:${i.gap.rows}/${i.gap.groups}`)))
            .toEqual(["f", "gap:2/1", "g-fam", "fam"]);
    });

    test("a collapsed elided group counts its hidden subtree; the gap wears the worst hidden tone", () => {
        const rows = [
            mk("f"),
            mk("g", groupKind), withParent(mk("t1"), "g"), withParent(mk("t2"), "g"),
            mk("w", spanKind, { status: some(variant("warning", null)) } as Partial<PlanRowValue>),
            mk("d", spanKind, { status: some(variant("danger", null)) } as Partial<PlanRowValue>),
            mk("fam"),
        ];
        const index = indexRows(rows);
        // The group is collapsed: only its band is visible; t1/t2 hide inside.
        const vis = [visible(rows[0]!), visible(rows[1]!, { collapsed: true }),
            visible(rows[4]!), visible(rows[5]!), visible(rows[6]!)];
        const items = elideForFocus(vis, index, focusOn("f", ["fam"]));
        expect(items).toHaveLength(3);
        const gap = items[1]!;
        expect(gap.kind).toBe("gap");
        if (gap.kind === "gap") {
            expect(gap.gap.rows).toBe(4);        // t1 + t2 (through the collapse) + w + d
            expect(gap.gap.groups).toBe(1);
            expect(gap.gap.tone).toBe("danger"); // pessimistic over warning
        }
    });
});

describe("Plan link graph (R1)", () => {
    const link = (from: string, to: string): PlanLinkValue => ({
        fromRow: from, fromRun: "a", toRow: to, toRun: "b", quantity: 10, label: "10 t",
    } as unknown as PlanLinkValue);

    test("linkedRowKeys collects every touched row", () => {
        expect([...linkedRowKeys([link("a", "b"), link("b", "c")])].sort()).toEqual(["a", "b", "c"]);
    });

    test("deriveLinkFamily walks the TRANSITIVE closure both ways, across chains", () => {
        // a → b → focus → c → d, plus unrelated x → y.
        const links = [link("a", "b"), link("b", "f"), link("f", "c"), link("c", "d"), link("x", "y")];
        const fam = deriveLinkFamily(links, "f");
        expect([...fam.upstream].sort()).toEqual(["a", "b"]);
        expect([...fam.downstream].sort()).toEqual(["c", "d"]);
        expect(fam.all.has("x")).toBe(false);
        // A diamond back-edge lands a row in BOTH sets (the LINKED tag).
        const both = deriveLinkFamily([link("f", "m"), link("m", "f")], "f");
        expect(both.upstream.has("m")).toBe(true);
        expect(both.downstream.has("m")).toBe(true);
    });
});

// ── Derivations (§4.2 — the semantics the IR used to precompute) ────────────

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const W30 = new Date("2026-07-20T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const W32 = new Date("2026-08-03T00:00:00Z");

function mkRun(key: string, start: Date, end: Date, state: unknown, qty?: number) {
    return {
        key, start, end, label: key,
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
        expect(bands[0]).toMatchObject({ from: W27, to: W30, count: 2, quantity: "146 t" });
        expect((bands[0]!.state as { type: string }).type).toBe("confirmed");   // rank 2 < actual 3
        expect(bands[1]).toMatchObject({ from: W31, to: W32, count: 1, quantity: "88 t" });
    });

    test("rejected runs are excluded; a missing qty suppresses the sum", () => {
        const bands = deriveBands([
            mkRun("r1", W27, W28, variant("actual", null)),
            mkRun("r2", W29, W30, variant("rejected", null), 10),
        ], "union", "t");
        expect(bands).toHaveLength(1);
        expect(bands[0]!.from).toBe(W27);
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

/** One decoded row at a key, optionally parented. */
function trow(key: string, parent: string | undefined, kind: unknown): PlanRowValue {
    return {
        key,
        parent: parent !== undefined ? some(parent) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanRowValue;
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
    const cell = (at: Date, v: number) => ({ at, value: some(v), text: none, tone: none });
    return [
        trow("gp", undefined, tableKind([], true)),
        trow("mid", "gp", tableKind([], true)),
        trow("a", "mid", tableKind([cell(W27, 96)], false)),
        trow("b", "mid", tableKind([cell(W27, 54)], false)),
        trow("leaf", "gp", tableKind([cell(W27, 10)], false)),
    ];
}

describe("Plan derived heat / table aggregates", () => {
    test("heat mean skips no-data cells and prints whole-number labels", () => {
        const cells = deriveHeatCells([
            { at: W27, value: some(40), label: none },
            { at: W27, value: some(60), label: none },
            { at: W28, value: some(60), label: none },
            { at: W28, value: none, label: none },
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

    test("the walk follows the TREE, not the container order (#568)", () => {
        // The collection is a Dict, so its order is KEY order and a parent can
        // sit after its own children. Feeding a bottom-up aggregation the wrong
        // order produces WRONG NUMBERS, not an error — this is the regression
        // that guards `derivePlan`'s post-order traversal. Same rows, three
        // orders (depth-first, key order, and reversed), identical results.
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
                { cells: [{ at: W27, value: some(a), text: none, tone: none }],
                  format: none, tone: none, strong: some(true), rollup: none },
                { cells: [{ at: W27, value: some(b), text: none, tone: none }],
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
                { cells: [{ at: W27, value: some(a), text: none, tone: none }],
                  format: none, tone: none, strong: none, rollup: some(true) },
                { cells: [{ at: W27, value: some(b), text: none, tone: none }],
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
        const vmulti = (a: number, b: number) => variant("table", {
            series: [
                { cells: [{ at: W27, value: some(a), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
                { cells: [{ at: W27, value: some(b), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
            ],
            split: variant("vertical", null), aggregate: none, format: none, emphasis: variant("body", null),
        });
        const parent = variant("table", {
            series: [], split: variant("vertical", null),
            aggregate: some(variant("sum", null)), format: none, emphasis: variant("body", null),
        });
        const rows = [trow("p", undefined, parent), trow("x", "p", vmulti(1, 2))];
        const index = indexRows(rows);
        const derived = derivePlan(index);
        const pv = visible(index.byKey.get("p")!);
        // Without the derived width it estimates the bare 24px floor.
        expect(rowHeight(pv, false, new Set())).toBe(24);
        // With it, the same 6 + n×11 the members use.
        expect(rowHeight(pv, false, new Set(), undefined, derived)).toBe(28);
    });

    test("a group's member count is DERIVED, not carried by the IR (#568)", () => {
        // A group parent synthesized once per paged window would otherwise bake
        // that window's count into the row; the renderer counts the members it
        // actually has.
        const group = (key: string, parent?: string) => trow(key, parent,
            variant("group", { summary: none, summaryAggregate: none, collapsed: none }));
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

    test("table sum subtotals carry raw values; text and tone stay renderer-owned", () => {
        const cells = deriveTableCells([
            { at: W27, value: some(96), text: none, tone: none },
            { at: W27, value: some(54), text: none, tone: none },
            { at: W28, value: some(-4), text: none, tone: none },
            { at: W29, value: none, text: none, tone: none },
        ] as unknown as Parameters<typeof deriveTableCells>[0], "sum");
        expect(cells[0]).toMatchObject({ value: { type: "some", value: 150 } });
        expect(cells[1]).toMatchObject({ value: { type: "some", value: -4 }, text: { type: "none" }, tone: { type: "none" } });
        expect(cells[2]).toMatchObject({ value: { type: "none" } });
    });
});
