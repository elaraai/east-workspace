/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Row-height rules (`Plan Spec.md` §8) — heat rows fit their gutter and
 * two-line gutters floor at 42px — the row-focus heights, `pxOf`, the at-rest
 * window height the ledger records, and the row stream (#822): keying rows by
 * their ids, repeated ids, and the visible walk over the stream.
 */

import { describe, test, expect } from "vitest";
import { some, none, variant } from "@elaraai/east";
import {
    canvasRowsOf, indexRows, rowHeight, rowIdOfKey, rowKeyOf, pxOf, toCanvasRows, visibleRows, windowRestHeight,
    HEAT_ROW_H, ROW_H, ROW_H_STACKED, GROUP_STRIP_H, GROUP_H, STRIP_H, RAIL_H,
    type PlanRowValue, type PlanWireRow, type VisibleRow,
} from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { rowId, rowIdEqual, rowKey } from "./plan.test-utils.js";

/** Instants on each arm — REAL East variant values, as the decoder yields them (#631). */
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

interface RowOpts {
    sub?: string;
    stacked?: boolean;
    expand?: unknown;
    parent?: string;
    collapsed?: boolean;
    pinned?: boolean;
    height?: string;
}

/** One WIRE row, as the source serves it — named by its test key. */
function wire(key: string, kind: unknown, opts?: RowOpts): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: {
            label: key.toUpperCase(), id: none,
            sub: opts?.sub !== undefined ? some(opts.sub) : none,
            value: none, meta: none,
            stacked: opts?.stacked === true ? some(true) : none,
            swatches: [],
        },
        kind,
        collapsed: opts?.collapsed !== undefined ? some(opts.collapsed) : none,
        pinned: opts?.pinned === true ? some(true) : none,
        height: opts?.height !== undefined ? some(opts.height) : none,
        status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanWireRow;
}

/** One canvas row keyed `key` (default `r`). */
function row(kind: unknown, opts?: RowOpts & { key?: string }): PlanRowValue {
    return toCanvasRows([wire(opts?.key ?? "r", kind, opts)])[0]!;
}

function visible(r: PlanRowValue, opts?: { collapsed?: boolean }): VisibleRow {
    return { row: r, depth: 0, collapsed: opts?.collapsed === true };
}

const heatKind = variant("heat", { cells: variant("heat", { cells: [], min: none, max: none, warnAt: none }), aggregate: none });
const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none });
const groupKind = (summary?: unknown) => variant("group", { summary: summary !== undefined ? some(summary) : none, summaryAggregate: none });

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
        expect(rowHeight(visible(spark), false, new Set([rowKey("r")]))).toBe(88);
        // Heights are CSS px sizes (the shared component-height String type).
        const custom = row(chart(variant("spark", null), some("120px")));
        expect(rowHeight(visible(custom), false, new Set([rowKey("r")]))).toBe(120);
        expect(rowHeight(visible(row(chart(variant("expanded", null), some("96px")))), false, new Set())).toBe(96);
        expect(rowHeight(visible(row(chart(variant("fixed", "140px"), some("96px")))), false, new Set())).toBe(140);
    });

    test("a two-line gutter floors a chart SPARK row too — the sub-line has to fit", () => {
        const chart = (height: unknown, expandedHeight: unknown) => variant("chart", {
            layers: [], left: none, right: none, height, expandedHeight, expandable: none,
        });
        // Every other kind ran through the two-line `floor()`; chart returned
        // its spark height directly, so a chart row carrying a sub-line clipped
        // it. Found by rendering one, not by a test.
        const spark = chart(variant("spark", null), none);
        expect(rowHeight(visible(row(spark)), false, new Set())).toBe(32);
        expect(rowHeight(visible(row(spark, { sub: "utilisation %" })), false, new Set())).toBe(ROW_H_STACKED);
        expect(rowHeight(visible(row(spark, { stacked: true })), false, new Set())).toBe(ROW_H_STACKED);
        // A DECLARED px is the author's word and stays unfloored — the same
        // rule the row-level `height` override follows.
        expect(rowHeight(visible(row(chart(variant("fixed", "24px"), none), { sub: "x" })), false, new Set())).toBe(24);
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
        // Two lines still FIT the shared 32px default, so the row holds it —
        // the stack grows the row only once it outruns that.
        expect(rowHeight(visible(row(two)), false, new Set())).toBe(ROW_H);
        const three = variant("table", {
            series: [
                { cells: [], format: none, tone: none, strong: none, rollup: none },
                { cells: [], format: none, tone: none, strong: none, rollup: none },
                { cells: [], format: none, tone: none, strong: none, rollup: none },
            ],
            split: variant("vertical", null),
            aggregate: none, format: none, emphasis: variant("body", null),
        });
        expect(rowHeight(visible(row(three)), false, new Set())).toBe(39);     // 6 + 3×11
        const flat = variant("table", {
            series: [{ cells: [], format: none, tone: none, strong: none, rollup: none }],
            split: variant("vertical", null),
            aggregate: none, format: none, emphasis: variant("body", null),
        });
        expect(rowHeight(visible(row(flat)), false, new Set())).toBe(ROW_H);   // single series never grows
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
        const strip = groupKind(variant("heat", { cells: [], min: none, max: none, warnAt: none }));
        expect(rowHeight(visible(row(strip, { collapsed: true }), { collapsed: true }), false, new Set())).toBe(GROUP_STRIP_H);
        expect(rowHeight(visible(row(groupKind())), false, new Set())).toBe(GROUP_H);
    });
});

describe("Plan row focus heights (R1 rails)", () => {
    const expand = (height?: string) => ({
        render: () => null,
        height: height !== undefined ? some(height) : none,
        axis: variant("keep", null),
    });

    test("links focus: family + groups keep height, everything else rails at 11", () => {
        const focus = { kind: "links" as const, key: rowKey("focus"), family: new Set([rowKey("fam")]) };
        expect(rowHeight(visible(row(spanKind, { key: "other" })), false, new Set(), focus)).toBe(RAIL_H);
        expect(rowHeight(visible(row(spanKind, { key: "fam" })), false, new Set(), focus)).toBe(ROW_H);
        expect(rowHeight(visible(row(groupKind(), { key: "g" })), false, new Set(), focus)).toBe(GROUP_H);
    });

    test("expand focus: the focal row keeps its kind height, every other DATA row strips to 16px", () => {
        // R2 grows the canvas UNDER the row (its own body item), never the row
        // itself — so the focus is exactly as tall as it was at rest.
        const focus = { kind: "expand" as const, key: rowKey("r") };
        expect(rowHeight(visible(row(spanKind, { expand: expand("140px") })), false, new Set(), focus)).toBe(ROW_H);
        expect(rowHeight(visible(row(spanKind, { key: "other" })), false, new Set(), focus)).toBe(STRIP_H);
    });

    test("a strip is 16px whatever the row's kind, its gutter or its explicit height", () => {
        const focus = { kind: "expand" as const, key: rowKey("focal") };
        // Kinds that are 28 / 24 / 88 / 42 at rest all land on the same rhythm.
        expect(rowHeight(visible(row(heatKind, { key: "other" })), false, new Set(), focus)).toBe(STRIP_H);
        expect(rowHeight(visible(row(spanKind, { key: "other", sub: "120 t" })), false, new Set(), focus)).toBe(STRIP_H);
        // An explicit per-row height is a REST height; it does not survive a
        // focus, or one tall row would break the strip rhythm for all of them.
        expect(rowHeight(visible(row(spanKind, { key: "other", height: "140px" })), false, new Set(), focus)).toBe(STRIP_H);
    });

    test("group bands never strip — they are the wayfinding a wall of strips needs", () => {
        const focus = { kind: "expand" as const, key: rowKey("focal") };
        expect(rowHeight(visible(row(groupKind(), { key: "g" })), false, new Set(), focus)).toBe(GROUP_H);
    });
});

describe("Plan pxOf (#615)", () => {
    test("accepts px and bare numbers; rejects percentages and keywords, as documented", () => {
        expect(pxOf("120px")).toBe(120);
        expect(pxOf("120")).toBe(120);
        expect(pxOf("119.5px")).toBe(119.5);
        // `parseFloat("50%") === 50` — the silent 50px this guards against.
        expect(pxOf("50%")).toBeUndefined();
        expect(pxOf("fill")).toBeUndefined();
        expect(pxOf("100vh")).toBeUndefined();
        expect(pxOf("")).toBeUndefined();
    });

    test("a percentage row height falls back to the KIND height, never 50px", () => {
        expect(rowHeight(visible(row(spanKind, { height: "50%" })), false, new Set())).toBe(ROW_H);
    });
});

describe("Plan windowRestHeight (#613)", () => {
    // The signature is the guarantee: it takes NO focus context, NO toggled
    // chart set, NO live UI state — a window landing mid-focus cannot record
    // strip-compressed rows because the transient state cannot reach it.

    test("declared collapse hides the subtree; pinned rows measure nothing (they render in the header)", () => {
        const rows = toCanvasRows([
            wire("g", groupKind(), { collapsed: true }),
            wire("a", spanKind, { parent: "g" }),
            wire("b", spanKind, { parent: "g" }),
            wire("plain", spanKind),
            wire("pin", spanKind, { pinned: true }),
        ]);
        expect(windowRestHeight(rows, "resource", false)).toBe(GROUP_H + ROW_H);
        // An OPEN declared group measures its members.
        const open = toCanvasRows([
            wire("g", groupKind(), { collapsed: false }),
            wire("a", spanKind, { parent: "g" }),
        ]);
        expect(windowRestHeight(open, "resource", false)).toBe(GROUP_H + ROW_H);
    });

    test("chart expansion measures at its DECLARED state, never a toggle's", () => {
        const chart = (height: unknown) => variant("chart", {
            layers: [], left: none, right: none, height, expandedHeight: none, expandable: some(true),
        });
        expect(windowRestHeight(toCanvasRows([wire("s", chart(variant("spark", null)))]), "resource", false)).toBe(32);
        expect(windowRestHeight(toCanvasRows([wire("e", chart(variant("expanded", null)))]), "resource", false)).toBe(88);
    });

    test("the GROUP grain collapses root groups at rest", () => {
        const rows = toCanvasRows([
            wire("g", groupKind()),
            wire("a", spanKind, { parent: "g" }),
        ]);
        expect(windowRestHeight(rows, "group", false)).toBe(GROUP_H);
        expect(windowRestHeight(rows, "resource", false)).toBe(GROUP_H + ROW_H);
    });

    test("a vertical subtotal parent measures with its window-local DERIVED width", () => {
        const vmulti = variant("table", {
            series: [
                { cells: [{ at: t(W27), value: some(1), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
                { cells: [{ at: t(W27), value: some(2), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
                { cells: [{ at: t(W27), value: some(3), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none },
            ],
            split: variant("vertical", null), aggregate: none, format: none, emphasis: variant("body", null),
        });
        const parent = variant("table", {
            series: [], split: variant("vertical", null),
            aggregate: some(variant("sum", null)), format: none, emphasis: variant("body", null),
        });
        const rows = toCanvasRows([
            wire("p", parent),
            wire("x", vmulti, { parent: "p" }),
        ]);
        // Both stack three derived positions: 6 + 3×11 each — the parent must
        // not fall back to its own (empty) series and measure one line.
        expect(windowRestHeight(rows, "resource", false)).toBe(39 + 39);
    });
});

describe("the row stream (#822)", () => {
    test("each row keys by its id's canonical text, and nests under its parent's", () => {
        const [a, b] = toCanvasRows([wire("a", spanKind), wire("b", spanKind, { parent: "a" })]);
        expect(a!.key).toBe(rowKeyOf(rowId("a")));
        expect(a!.key).toBe('.entry (series="t", path=["a"])');
        expect(a!.parent).toEqual(none);
        expect(b!.parent).toEqual(some(a!.key));
        // The typed id rides along for every payload that names the row.
        expect(rowIdEqual(b!.id, rowId("b"))).toBe(true);
        expect(a!.duplicateOf).toBeUndefined();
    });

    test("a repeated id keeps a key of its own and names the row it repeats — never a silent drop", () => {
        const rows = toCanvasRows([wire("a", spanKind), wire("b", spanKind), wire("a", heatKind), wire("a", spanKind)]);
        expect(rows.map((r) => r.key)).toEqual([rowKey("a"), rowKey("b"), `${rowKey("a")}#1`, `${rowKey("a")}#2`]);
        expect(rows.map((r) => r.duplicateOf)).toEqual([undefined, undefined, rowKey("a"), rowKey("a")]);
        expect(new Set(rows.map((r) => r.key)).size).toBe(4);
    });

    test("rowIdOfKey inverts the key — a repeat's `#n` names the same id; other text names none", () => {
        const id = rowId("with \"quotes\" and #7", "s#2");
        const key = rowKeyOf(id);
        expect(rowIdEqual(rowIdOfKey(key)!, id)).toBe(true);
        expect(rowIdEqual(rowIdOfKey(`${key}#3`)!, id)).toBe(true);
        const section = variant("section", { series: "line2", path: [] }) as PlanRowValue["id"];
        expect(rowIdEqual(rowIdOfKey(rowKeyOf(section))!, section)).toBe(true);
        expect(rowIdOfKey("m03")).toBeUndefined();
    });

    test("canvasRowsOf keys a decoded stream once — the controller and the canvas share its rows", () => {
        const stream = [wire("a", spanKind), wire("b", spanKind)];
        const first = canvasRowsOf(stream);
        expect(canvasRowsOf(stream)).toBe(first);
        expect(canvasRowsOf([...stream])).not.toBe(first);
        expect(canvasRowsOf([...stream])).toEqual(first);
    });

    test("the walk follows the stream: a collapsed row hides exactly its descendants, wherever they sit", () => {
        // An entry's view rows (`views`), then its children — nested under the
        // FIRST view row, so they follow the second: not a tree walk's order.
        const index = indexRows(toCanvasRows([
            wire("v1", spanKind),
            wire("v2", heatKind),
            wire("c1", spanKind, { parent: "v1" }),
            wire("c2", spanKind, { parent: "c1" }),
            wire("next", spanKind),
        ]));
        const keys = (collapsed: string[]) => visibleRows(index, { grain: "resource", collapsed: new Set(collapsed.map((k) => rowKey(k))) })
            .map((v) => [v.row.key, v.depth]);
        expect(keys([])).toEqual([[rowKey("v1"), 0], [rowKey("v2"), 0], [rowKey("c1"), 1], [rowKey("c2"), 2], [rowKey("next"), 0]]);
        // Collapsing v1 hides its subtree and nothing else — v2 sits between.
        expect(keys(["v1"])).toEqual([[rowKey("v1"), 0], [rowKey("v2"), 0], [rowKey("next"), 0]]);
        expect(keys(["c1"])).toEqual([[rowKey("v1"), 0], [rowKey("v2"), 0], [rowKey("c1"), 1], [rowKey("next"), 0]]);
    });

    test("a row whose parent is nowhere in the stream is not drawn", () => {
        const index = indexRows(toCanvasRows([wire("a", spanKind), wire("lost", spanKind, { parent: "gone" })]));
        expect(visibleRows(index, { grain: "resource", collapsed: new Set() }).map((v) => v.row.key)).toEqual([rowKey("a")]);
    });

    test("any row with children may start collapsed — the declaration rides the row", () => {
        const index = indexRows(toCanvasRows([
            wire("p", spanKind, { collapsed: true }),
            wire("c", spanKind, { parent: "p" }),
            wire("q", spanKind, { collapsed: false }),
        ]));
        expect([...index.initiallyCollapsed]).toEqual([rowKey("p")]);
    });
});

// ── Derivations (§4.2 — the semantics the IR used to precompute) ────────────

const W27 = new Date("2026-06-29T00:00:00Z");
