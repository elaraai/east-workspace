/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Ribbon endpoints come from the model (#818): a row's top is the sum of the
 * body items' exact heights above it, its bar sits centred in its plot cell at
 * the geometry table's height, and a run's x is its window fraction across the
 * plot — with no DOM anywhere. A bounded view clamps an endpoint past an edge to it.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import {
    indexRows, rowKeyOf, toCanvasRows,
    type PlanBodyItem, type PlanLinkValue, type PlanRowValue, type PlanWireRow, type VisibleRow,
} from "../model.js";
import { rowId, rowKey, testKeyOf } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import {
    RIBBON_FADE_W, RIBBON_OPACITY_MAX, RIBBON_OPACITY_MIN, layoutRibbons, ribbonBody,
    type RibbonLayoutInput, type RibbonViewport,
} from "./ribbon-layout.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;
const at = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const scale = planScale({ kind: "time", window: { min: W27, max: W39 }, resolution: "week" }) as PlanScale;

const G = PLAN_GEOMETRY.default;
const PLOT = { left: 168, width: 1000 };
/** Where a bar centres: in its row's plot cell — the row less the rule under it. */
const centre = (top: number, h: number) => top + (h - G.rule) / 2;

function spanRow(key: string, opts?: { parent?: string; sub?: boolean }): PlanRowValue {
    return toCanvasRows([{
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: {
            label: key, id: none, sub: opts?.sub === true ? some("sub") : none,
            value: none, meta: none, stacked: none, swatches: [],
        },
        kind: variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none }),
        collapsed: none, pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanWireRow])[0]!;
}
const rowItem = (r: PlanRowValue, collapsed = false): PlanBodyItem =>
    ({ kind: "row", row: { row: r, depth: 0, collapsed } as VisibleRow });
const gapItem = (key: string): PlanBodyItem =>
    ({ kind: "gap", gap: { key, first: key, rows: 3, groups: 0, tone: undefined } });
/** A link names its ends by row id (#822). */
const link = (from: string, fromRun: string, to: string, toRun: string, quantity = 10, label = "10 t"): PlanLinkValue =>
    ({ fromRow: rowId(from), fromRun, toRow: rowId(to), toRun, quantity, label }) as PlanLinkValue;

/** Runs by `row|run` (the row's test key): [start, end]. */
function runDatesOf(runs: Record<string, [Date, Date]>): RibbonLayoutInput["runDates"] {
    return (row, run) => {
        const r = runs[`${testKeyOf(row)}|${run}`];
        return r !== undefined ? { start: t(r[0]), end: t(r[1]) } : undefined;
    };
}

/** The x a window fraction lands at on the plot. */
const xOf = (d: Date) => PLOT.left + scale.fracOf(t(d)) * PLOT.width;

function input(over: Partial<RibbonLayoutInput> & Pick<RibbonLayoutInput, "links" | "body" | "runDates">): RibbonLayoutInput {
    return {
        visibleKeys: new Set(over.links.flatMap((l) => [rowKeyOf(l.fromRow), rowKeyOf(l.toRow)])),
        beyond: () => undefined,
        scale, plot: PLOT, viewport: undefined,
        ...over,
    };
}

describe("the ribbon body (#818)", () => {
    test("each row's top is the sum of every item above it — rows, gaps and bands alike", () => {
        const a = spanRow("a");
        const b = spanRow("b", { sub: true });
        const items: PlanBodyItem[] = [
            { kind: "band", band: { at: "head", from: 0, to: 199, px: 640 } },
            rowItem(a), gapItem("gap-x"), rowItem(b),
            { kind: "band", band: { at: "tail", from: 400, to: 999, px: 900 } },
        ];
        const body = ribbonBody(items, [640, 32, 22, 42, 900], indexRows([a, b]), G);
        expect(body.slots.get(rowKey("a"))).toEqual({ top: 640, height: 32, bar: G.bar });
        expect(body.slots.get(rowKey("b"))).toEqual({ top: 640 + 32 + 22, height: 42, bar: G.bar });
        expect(body.height).toBe(640 + 32 + 22 + 42 + 900);
    });

    test("a collapsed span parent's runs ride its rollup bar; an open one's the full bar", () => {
        const p = spanRow("p");
        const c = spanRow("c", { parent: "p" });
        const index = indexRows([p, c]);
        expect(ribbonBody([rowItem(p, true)], [32], index, G).slots.get(rowKey("p"))!.bar).toBe(G.rollBar);
        expect(ribbonBody([rowItem(p, false), rowItem(c)], [32, 32], index, G).slots.get(rowKey("p"))!.bar).toBe(G.bar);
        // Dense tightens the bar the table says.
        expect(ribbonBody([rowItem(c)], [24], index, PLAN_GEOMETRY.dense).slots.get(rowKey("c"))!.bar).toBe(PLAN_GEOMETRY.dense.bar);
    });
});

describe("ribbon endpoints come from the model (#818)", () => {
    const a = spanRow("a");
    const b = spanRow("b");
    const c = spanRow("c", { sub: true });
    const index = indexRows([a, b, c]);
    const items = [rowItem(a), gapItem("gap-x"), rowItem(b), rowItem(c)];
    const heights = [32, 22, 32, 42];
    const body = ribbonBody(items, heights, index, G);
    const runDates = runDatesOf({
        "a|ra": [at("2026-06-29"), at("2026-07-13")],
        "b|rb": [at("2026-07-20"), at("2026-08-03")],
        "c|rc": [at("2026-07-06"), at("2026-07-27")],
        // Wholly before the window, and wholly after it.
        "c|early": [at("2026-05-04"), at("2026-06-01")],
        "c|late": [at("2026-10-05"), at("2026-10-19")],
        // Straddling the window's start.
        "b|straddle": [at("2026-06-01"), at("2026-07-06")],
    });

    test("x is the run's window fraction across the plot; y is its row's bar, centred", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("a", "ra", "b", "rb")], body, runDates }));
        expect(ribbons).toHaveLength(1);
        const r = ribbons[0]!;
        expect(r.from).toEqual({
            leftX: xOf(at("2026-06-29")), rightX: xOf(at("2026-07-13")),
            top: centre(0, 32) - G.bar / 2, bottom: centre(0, 32) + G.bar / 2,
        });
        // b sits below a (32) and the gap band (22).
        expect(r.to).toEqual({
            leftX: xOf(at("2026-07-20")), rightX: xOf(at("2026-08-03")),
            top: centre(54, 32) - G.bar / 2, bottom: centre(54, 32) + G.bar / 2,
        });
        expect(r.link).toBe(0);
        expect(r.label).toBe("10 t");
    });

    test("a two-line row's bar is centred in its full plot cell", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("a", "ra", "c", "rc")], body, runDates }));
        const mid = centre(32 + 22 + 32, 42);
        expect([ribbons[0]!.to.top, ribbons[0]!.to.bottom]).toEqual([mid - G.bar / 2, mid + G.bar / 2]);
    });

    test("a run straddling the window keeps its window-clamped extent, as its bar draws", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("b", "straddle", "c", "rc")], body, runDates }));
        expect(ribbons[0]!.from.leftX).toBe(PLOT.left);
        expect(ribbons[0]!.from.rightX).toBe(xOf(at("2026-07-06")));
    });

    test("a run outside the window lands at the plot edge it lies past, behind a fade", () => {
        const { ribbons, fades } = layoutRibbons(input({
            links: [link("c", "early", "a", "ra"), link("a", "ra", "c", "late")], body, runDates,
        }));
        const mid = centre(32 + 22 + 32, 42);
        expect(ribbons[0]!.from.leftX).toBe(PLOT.left);
        expect(ribbons[0]!.from.rightX).toBe(PLOT.left);
        expect(ribbons[1]!.to.leftX).toBe(PLOT.left + PLOT.width);
        expect(fades).toEqual([
            { x: PLOT.left, y: mid - G.bar / 2, h: G.bar, side: "left" },
            { x: PLOT.left + PLOT.width - RIBBON_FADE_W, y: mid - G.bar / 2, h: G.bar, side: "right" },
        ]);
    });

    test("a row with no such run is met across its whole plot", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("a", "ra", "b", "nope")], body, runDates }));
        expect([ribbons[0]!.to.leftX, ribbons[0]!.to.rightX]).toEqual([PLOT.left, PLOT.left + PLOT.width]);
    });

    test("the ribbons follow the heights — a band that goes moves every endpoint below it by exactly its height", () => {
        const before = layoutRibbons(input({ links: [link("a", "ra", "b", "rb")], body, runDates })).ribbons[0]!;
        const collapsed = ribbonBody([rowItem(a), rowItem(b), rowItem(c)], [32, 32, 42], index, G);
        const after = layoutRibbons(input({ links: [link("a", "ra", "b", "rb")], body: collapsed, runDates })).ribbons[0]!;
        expect(after.from).toEqual(before.from);
        expect(after.to.top).toBe(before.to.top - 22);
        expect(after.stroke).not.toBe(before.stroke);
    });

    test("an edge with an end outside the focus's family is not drawn", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "ra", "b", "rb"), link("a", "ra", "c", "rc")], body, runDates,
            visibleKeys: new Set([rowKey("a"), rowKey("b")]),
        }));
        expect(ribbons.map((r) => r.link)).toEqual([0]);
    });
});

describe("the view (#818)", () => {
    // Rows at 0–32, 200–232, 400–432, 600–632.
    const rows = ["r0", "r1", "r2", "r3"].map((k) => spanRow(k));
    const index = indexRows(rows);
    const items = rows.flatMap((r, i) => (i === 0 ? [rowItem(r)] : [gapItem(`g${i}`), rowItem(r)]));
    const heights = items.map((it) => (it.kind === "gap" ? 168 : 32));
    const body = ribbonBody(items, heights, index, G);
    const runDates = runDatesOf({
        "r0|x": [at("2026-06-29"), at("2026-07-06")],
        "r1|x": [at("2026-07-13"), at("2026-07-20")],
        "r2|x": [at("2026-07-27"), at("2026-08-03")],
        "r3|x": [at("2026-08-10"), at("2026-08-17")],
    });
    const view: RibbonViewport = { top: 150, bottom: 450 };

    test("an endpoint past the bottom of the view sits on it, and the ribbon ends in a stub toward its row", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("r1", "x", "r3", "x")], body, runDates, viewport: view }));
        const r = ribbons[0]!;
        expect(r.from.off).toBeUndefined();
        expect(r.to).toMatchObject({ off: "below", bottom: 450, top: 450 - G.bar });
        expect(r.tail).toBe("");
    });

    test("an endpoint past the top sits on the top edge, a stub at the ribbon's start", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("r0", "x", "r2", "x")], body, runDates, viewport: view }));
        const r = ribbons[0]!;
        expect(r.from).toMatchObject({ off: "above", top: 150, bottom: 150 + G.bar });
        expect(r.to.off).toBeUndefined();
        expect(r.tail).not.toBe("");
    });

    test("both ends past the same edge: nothing of it is in view, so it is not drawn", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("r2", "x", "r3", "x")], body, runDates, viewport: { top: 0, bottom: 120 },
        }));
        expect(ribbons).toEqual([]);
    });

    test("ends past opposite edges: one band across the view", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("r0", "x", "r3", "x")], body, runDates, viewport: { top: 100, bottom: 500 },
        }));
        expect(ribbons[0]!.from.off).toBe("above");
        expect(ribbons[0]!.to.off).toBe("below");
    });

    test("an unbounded frame shows every row — nothing clamps", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("r0", "x", "r3", "x")], body, runDates }));
        expect(ribbons[0]!.from.off).toBeUndefined();
        expect(ribbons[0]!.to.off).toBeUndefined();
        expect(ribbons[0]!.to.top).toBe(centre(600, 32) - G.bar / 2);
    });

    test("a fade is drawn only where its row is in view", () => {
        const late = runDatesOf({ "r0|x": [at("2026-06-29"), at("2026-07-06")], "r3|x": [at("2026-10-05"), at("2026-10-12")] });
        expect(layoutRibbons(input({ links: [link("r0", "x", "r3", "x")], body, runDates: late })).fades).toHaveLength(1);
        expect(layoutRibbons(input({
            links: [link("r0", "x", "r3", "x")], body, runDates: late, viewport: { top: 0, bottom: 300 },
        })).fades).toEqual([]);
    });
});

describe("rows the body does not hold (#818)", () => {
    const a = spanRow("a");
    const body = ribbonBody([rowItem(a)], [32], indexRows([a]), G);
    const runDates = runDatesOf({ "a|x": [at("2026-07-13"), at("2026-07-20")], "pin|y": [at("2026-06-29"), at("2026-07-06")] });

    test("a pinned row sits past the rows' top — the ribbon meets it with a stub pointing up at the header", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("pin", "y", "a", "x")], body, runDates,
            beyond: (key) => (key === rowKey("pin") ? "above" : undefined),
        }));
        expect(ribbons[0]!.from).toMatchObject({ off: "above", top: 0, bottom: G.bar });
        expect(ribbons[0]!.tail).not.toBe("");
    });

    test("a row with no place is not drawn", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("gone", "y", "a", "x")], body, runDates }));
        expect(ribbons).toEqual([]);
    });
});

describe("ribbon ink and captions (#818)", () => {
    const rows = ["a", "b", "c"].map((k) => spanRow(k));
    const body = ribbonBody(rows.map((r) => rowItem(r)), [32, 32, 32], indexRows(rows), G);
    const runDates = runDatesOf({
        "a|x": [at("2026-06-29"), at("2026-07-06")],
        "b|x": [at("2026-07-27"), at("2026-08-03")],
        "c|x": [at("2026-07-27"), at("2026-08-03")],
    });

    test("opacity is the quantity's share of the family's largest", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "x", "b", "x", 40), link("a", "x", "c", "x", 10)], body, runDates,
        }));
        expect(ribbons[0]!.opacity).toBeCloseTo(RIBBON_OPACITY_MAX);
        expect(ribbons[1]!.opacity).toBeCloseTo(RIBBON_OPACITY_MIN + 0.25 * (RIBBON_OPACITY_MAX - RIBBON_OPACITY_MIN));
    });

    test("captions that would land on one another are nudged apart a line at a time", () => {
        // Two ribbons from one source into two rows: their S-captions share a spot.
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "x", "b", "x"), link("a", "x", "b", "x")], body, runDates,
        }));
        expect(ribbons[1]!.ly - ribbons[0]!.ly).toBe(12);
        expect(ribbons[1]!.lx).toBe(ribbons[0]!.lx);
    });
});
