/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
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
import { PLAN_CELL_INSET, PLAN_GEOMETRY } from "../geometry.js";
import { PLAN_WORDS } from "../words.js";
import {
    RIBBON_CAPTION_CHAR, RIBBON_CAPTION_PAD, linkedElement, layoutRibbons, ribbonBody, ribbonWeight,
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
            label: key, id: false, sub: opts?.sub === true ? some("sub") : none,
            value: none, meta: none, stacked: false, swatches: [],
        },
        kind: variant("span", { runs: [], decisions: [], ports: [], rollup: none }),
        collapsed: false, pinned: false, height: none, status: none, expand: none,
    } as unknown as PlanWireRow])[0]!;
}
const rowItem = (r: PlanRowValue, collapsed = false): PlanBodyItem =>
    ({ kind: "row", row: { row: r, depth: 0, collapsed } as VisibleRow });
const gapItem = (key: string): PlanBodyItem =>
    ({ kind: "gap", gap: { key, first: key, rows: 3, groups: 0, tone: undefined } });
/** A link names its ends by run ref — a row id (#822) and a run key — and
 *  carries its quantity in sheets (#824); `null` carries none. (Not
 *  `undefined`: passed explicitly, it would take the default.) */
const link = (from: string, fromRun: string, to: string, toRun: string, quantity: number | null = 10): PlanLinkValue =>
    ({
        key: `${from}.${fromRun}>${to}.${toRun}`,
        from: { row: rowId(from), run: fromRun }, to: { row: rowId(to), run: toRun },
        quantity: quantity !== null ? some({ value: quantity, unit: some("k sheets"), format: none, text: none }) : none,
    }) as PlanLinkValue;

/** Runs by `row|run` (the row's test key): [start, end], each drawn as a bar. */
function barsOf(runs: Record<string, [Date, Date]>): RibbonLayoutInput["element"] {
    return (row, run) => {
        const r = runs[`${testKeyOf(row)}|${run}`];
        return r !== undefined ? { start: t(r[0]), end: t(r[1]), draw: { kind: "bar" } } : undefined;
    };
}

/** The x a window fraction lands at on the plot. */
const xOf = (d: Date) => PLOT.left + scale.fracOf(t(d)) * PLOT.width;

function input(over: Partial<RibbonLayoutInput> & Pick<RibbonLayoutInput, "links" | "body" | "element">): RibbonLayoutInput {
    return {
        visibleKeys: new Set(over.links.flatMap((l) => [rowKeyOf(l.from.row), rowKeyOf(l.to.row)])),
        beyond: () => undefined,
        scale, plot: PLOT, viewport: undefined, words: PLAN_WORDS,
        ...over,
    };
}

describe("the ribbon body (#818)", () => {
    test("each row's top is the sum of every item above it — rows, gaps and bands alike", () => {
        const a = spanRow("a");
        const b = spanRow("b", { sub: true });
        const items: PlanBodyItem[] = [
            { kind: "band", band: { block: 0, at: "head", from: 0, to: 199, px: 640 } },
            rowItem(a), gapItem("gap-x"), rowItem(b),
            { kind: "band", band: { block: 0, at: "tail", from: 400, to: 999, px: 900 } },
        ];
        const body = ribbonBody(items, [640, 32, 22, 42, 900], indexRows([a, b]), G);
        expect(body.slots.get(rowKey("a"))).toEqual({ top: 640, height: 32, bar: G.bar });
        expect(body.slots.get(rowKey("b"))).toEqual({ top: 640 + 32 + 22, height: 42, bar: G.bar });
        expect(body.height).toBe(640 + 32 + 22 + 42 + 900);
        // Each band's top, by block and end — where an evicted row is placed from (#823).
        expect(body.bands).toEqual(new Map([["0:head", 0], ["0:tail", 640 + 32 + 22 + 42]]));
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
    const element = barsOf({
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
        const { ribbons } = layoutRibbons(input({ links: [link("a", "ra", "b", "rb")], body, element }));
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
        expect(r.label).toBe("10 k sheets");
    });

    test("a two-line row's bar is centred in its full plot cell", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("a", "ra", "c", "rc")], body, element }));
        const mid = centre(32 + 22 + 32, 42);
        expect([ribbons[0]!.to.top, ribbons[0]!.to.bottom]).toEqual([mid - G.bar / 2, mid + G.bar / 2]);
    });

    test("a run straddling the window keeps its window-clamped extent, as its bar draws", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("b", "straddle", "c", "rc")], body, element }));
        expect(ribbons[0]!.from.leftX).toBe(PLOT.left);
        expect(ribbons[0]!.from.rightX).toBe(xOf(at("2026-07-06")));
    });

    test("a run outside the window lands on the plot edge it lies past, in a dashed slot as tall as its bar (#1258)", () => {
        const { ribbons, edgeSlots } = layoutRibbons(input({
            links: [link("c", "early", "a", "ra"), link("a", "ra", "c", "late")], body, element,
        }));
        const mid = centre(32 + 22 + 32, 42);
        expect(ribbons[0]!.from.leftX).toBe(PLOT.left);
        expect(ribbons[0]!.from.rightX).toBe(PLOT.left);
        expect([ribbons[1]!.to.leftX, ribbons[1]!.to.rightX]).toEqual([PLOT.left + PLOT.width, PLOT.left + PLOT.width]);
        // Each slot opens onto its edge; the overlay draws it 40 into the plot.
        expect(edgeSlots).toEqual([
            { x: PLOT.left, y: mid - G.bar / 2, h: G.bar, side: "left" },
            { x: PLOT.left + PLOT.width, y: mid - G.bar / 2, h: G.bar, side: "right" },
        ]);
    });

    test("a caption near the plot's edges moves in with its knockout — its text at the widest a letter draws — before any step (#1258)", () => {
        // Out of a run ended before the window into one at its start, and on into one starting after it.
        const { ribbons } = layoutRibbons(input({
            links: [link("c", "early", "a", "ra"), link("a", "ra", "c", "late")], body, element,
        }));
        const half = ("10 k sheets".length * RIBBON_CAPTION_CHAR) / 2 + RIBBON_CAPTION_PAD;
        expect(ribbons[0]!.lx).toBe(PLOT.left + half);
        expect(ribbons[1]!.lx).toBe(PLOT.left + PLOT.width - half);
    });

    test("a row with no such run is met across its whole plot", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("a", "ra", "b", "nope")], body, element }));
        expect([ribbons[0]!.to.leftX, ribbons[0]!.to.rightX]).toEqual([PLOT.left, PLOT.left + PLOT.width]);
    });

    test("the ribbons follow the heights — a band that goes moves every endpoint below it by exactly its height", () => {
        const before = layoutRibbons(input({ links: [link("a", "ra", "b", "rb")], body, element })).ribbons[0]!;
        const collapsed = ribbonBody([rowItem(a), rowItem(b), rowItem(c)], [32, 32, 42], index, G);
        const after = layoutRibbons(input({ links: [link("a", "ra", "b", "rb")], body: collapsed, element })).ribbons[0]!;
        expect(after.from).toEqual(before.from);
        expect(after.to.top).toBe(before.to.top - 22);
        expect(after.stroke).not.toBe(before.stroke);
    });

    test("an edge with an end outside the focus's family is not drawn", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "ra", "b", "rb"), link("a", "ra", "c", "rc")], body, element,
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
    const element = barsOf({
        "r0|x": [at("2026-06-29"), at("2026-07-06")],
        "r1|x": [at("2026-07-13"), at("2026-07-20")],
        "r2|x": [at("2026-07-27"), at("2026-08-03")],
        "r3|x": [at("2026-08-10"), at("2026-08-17")],
    });
    const view: RibbonViewport = { top: 150, bottom: 450 };

    test("an endpoint past the bottom of the view sits on it, and the ribbon ends in a stub toward its row", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("r1", "x", "r3", "x")], body, element, viewport: view }));
        const r = ribbons[0]!;
        expect(r.from.off).toBeUndefined();
        expect(r.to).toMatchObject({ off: "below", bottom: 450, top: 450 - G.bar });
        expect(r.tail).toBe("");
    });

    test("an endpoint past the top sits on the top edge, a stub at the ribbon's start", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("r0", "x", "r2", "x")], body, element, viewport: view }));
        const r = ribbons[0]!;
        expect(r.from).toMatchObject({ off: "above", top: 150, bottom: 150 + G.bar });
        expect(r.to.off).toBeUndefined();
        expect(r.tail).not.toBe("");
    });

    test("both ends past the same edge: nothing of it is in view, so it is not drawn", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("r2", "x", "r3", "x")], body, element, viewport: { top: 0, bottom: 120 },
        }));
        expect(ribbons).toEqual([]);
    });

    test("ends past opposite edges: one band across the view", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("r0", "x", "r3", "x")], body, element, viewport: { top: 100, bottom: 500 },
        }));
        expect(ribbons[0]!.from.off).toBe("above");
        expect(ribbons[0]!.to.off).toBe("below");
    });

    test("an unbounded frame shows every row — nothing clamps", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("r0", "x", "r3", "x")], body, element }));
        expect(ribbons[0]!.from.off).toBeUndefined();
        expect(ribbons[0]!.to.off).toBeUndefined();
        expect(ribbons[0]!.to.top).toBe(centre(600, 32) - G.bar / 2);
    });

    test("a slot is drawn only while its row is in view (#1258)", () => {
        const late = barsOf({ "r0|x": [at("2026-06-29"), at("2026-07-06")], "r3|x": [at("2026-10-05"), at("2026-10-12")] });
        expect(layoutRibbons(input({ links: [link("r0", "x", "r3", "x")], body, element: late })).edgeSlots).toHaveLength(1);
        expect(layoutRibbons(input({
            links: [link("r0", "x", "r3", "x")], body, element: late, viewport: { top: 0, bottom: 300 },
        })).edgeSlots).toEqual([]);
    });
});

describe("rows the body does not hold (#818)", () => {
    const a = spanRow("a");
    const body = ribbonBody([rowItem(a)], [32], indexRows([a]), G);
    const element = barsOf({ "a|x": [at("2026-07-13"), at("2026-07-20")], "pin|y": [at("2026-06-29"), at("2026-07-06")] });

    test("a pinned row sits past the rows' top — the ribbon meets it with a stub pointing up at the header", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("pin", "y", "a", "x")], body, element,
            beyond: (key) => (key === rowKey("pin") ? { off: "above" } : undefined),
        }));
        expect(ribbons[0]!.from).toMatchObject({ off: "above", top: 0, bottom: G.bar });
        expect(ribbons[0]!.tail).not.toBe("");
    });

    test("a row with no place is not drawn", () => {
        const { ribbons } = layoutRibbons(input({ links: [link("gone", "y", "a", "x")], body, element }));
        expect(ribbons).toEqual([]);
    });

    test("a row in an evicted window is placed in its band, then clamps and stubs like any row out of view (#823)", () => {
        // A tail band 5,000px tall below `a`; the evicted row's window sits
        // 3,000px into it.
        const tall = ribbonBody(
            [rowItem(a), { kind: "band", band: { block: 0, at: "tail", from: 200, to: 9_999, px: 5_000 } }],
            [32, 5_000], indexRows([a]), G);
        const place = { y: 32 + 3_000 };
        const beyond = (key: string) => (key === rowKey("far") ? place : undefined);
        const dates = barsOf({ "a|x": [at("2026-07-13"), at("2026-07-20")], "far|y": [at("2026-07-27"), at("2026-08-03")] });
        // Unbounded: drawn AT its place.
        const open = layoutRibbons(input({ links: [link("a", "x", "far", "y")], body: tall, element: dates, beyond })).ribbons[0]!;
        expect(open.to).toMatchObject({ top: place.y, bottom: place.y + G.bar });
        expect(open.to.off).toBeUndefined();
        // In a bounded view above it: on the view's bottom edge, a stub pointing down.
        const clamped = layoutRibbons(input({
            links: [link("a", "x", "far", "y")], body: tall, element: dates, beyond, viewport: { top: 0, bottom: 400 },
        })).ribbons[0]!;
        expect(clamped.to).toMatchObject({ off: "below", bottom: 400 });
    });
});

describe("where a link's end meets its row (#1192)", () => {
    /** A row of `kind`, keyed `key`. */
    const rowOfKind = (key: string, kind: unknown): PlanRowValue => ({ ...spanRow(key), kind }) as PlanRowValue;
    const confirmed = variant("confirmed", null);
    const runOf = (key: string, start: Date, end: Date) =>
        ({ key, start: t(start), end: t(end), label: key, quantity: none, state: confirmed, status: none, moved: none, icon: none });
    const chipOf = (key: string, from: Date, to: Date) => ({ key, from: t(from), to: t(to), label: key, state: confirmed, icon: none });
    const tileOf = (key: string, on: Date, lane: string | null = null) => ({
        key, at: t(on), lane: lane === null ? none : some(lane), label: none, icon: none, state: confirmed, tone: none,
        color: none, colorPalette: none, stretch: none, content: none, animation: none,
    });
    const markOf = (key: string, on: Date, kind: "milestone" | "decision" | "exception", icon = false) => ({
        key, at: t(on), kind: kind === "decision" ? variant("decision", { applied: false }) : variant(kind, null),
        icon: icon ? some({ prefix: "fas", name: "flag" }) : none, label: none,
    });
    const hour = (iso: string) => new Date(`${iso}Z`);
    const bars = rowOfKind("bars", variant("span", {
        runs: [runOf("r", at("2026-07-08"), at("2026-07-22")), runOf("tiny", hour("2026-07-08T06:00"), hour("2026-07-08T08:00")),
            runOf("late", hour("2026-09-20T23:00"), at("2026-09-28"))],
        decisions: [], ports: [], rollup: none,
    }));
    const chips = rowOfKind("chips", variant("cards", {
        chips: [chipOf("c", at("2026-07-13"), at("2026-07-27")), chipOf("short", hour("2026-08-03T06:00"), hour("2026-08-03T14:00"))],
    }));
    const tiles = rowOfKind("tiles", variant("buckets", { lanes: [], events: [tileOf("e", at("2026-07-08"))], markers: [] }));
    // Two lanes: a tile in the second; another bucket where a lane-less tile takes the whole cell, and the laned
    // tile beside it with it.
    const laned = rowOfKind("laned", variant("buckets", {
        lanes: [{ key: "l1", label: none }, { key: "l2", label: none }],
        events: [tileOf("in2", at("2026-07-15"), "l2"), tileOf("whole", at("2026-08-12")), tileOf("beside", at("2026-08-13"), "l1")],
        markers: [],
    }));
    const marks = rowOfKind("marks", variant("events", {
        marks: [markOf("m", at("2026-08-05"), "milestone"), markOf("d", at("2026-08-12"), "decision"),
            markOf("x", at("2026-08-19"), "exception"), markOf("i", at("2026-08-26"), "milestone", true),
            markOf("edge", W27, "milestone"), markOf("before", at("2026-06-22"), "milestone")],
    }));

    test("a run, a chip, the cell a tile sits in, a mark — and how each draws", () => {
        expect(linkedElement(bars, "r", scale)).toEqual({ start: t(at("2026-07-08")), end: t(at("2026-07-22")), draw: { kind: "bar" } });
        expect(linkedElement(chips, "c", scale)).toEqual({ start: t(at("2026-07-13")), end: t(at("2026-07-27")), draw: { kind: "chip" } });
        // A Wednesday's tile fills its week's cell — the whole of it in a row with no lanes.
        expect(linkedElement(tiles, "e", scale)).toEqual({
            start: t(at("2026-07-06")), end: t(at("2026-07-13")), draw: { kind: "cell", lane: 0, span: 1, lanes: 1 },
        });
        // In lanes: its own lane's cell, or the whole cell where a lane-less tile takes its bucket.
        expect(linkedElement(laned, "in2", scale)!.draw).toEqual({ kind: "cell", lane: 1, span: 1, lanes: 2 });
        expect(linkedElement(laned, "whole", scale)!.draw).toEqual({ kind: "cell", lane: 0, span: 2, lanes: 2 });
        expect(linkedElement(laned, "beside", scale)!.draw).toEqual({ kind: "cell", lane: 0, span: 2, lanes: 2 });
        // A mark at its instant: its kind's glyph, or its icon's box.
        expect(linkedElement(marks, "m", scale)).toEqual({
            start: t(at("2026-08-05")), end: t(at("2026-08-05")), draw: { kind: "mark", glyph: "dot" },
        });
        expect(["d", "x", "i"].map((k) => linkedElement(marks, k, scale)!.draw))
            .toEqual([{ kind: "mark", glyph: "diamond" }, { kind: "mark", glyph: "triangle" }, { kind: "mark", glyph: "icon" }]);
    });

    test("a key the row draws no element of, or a row that draws none, meets nothing", () => {
        expect(linkedElement(bars, "c", scale)).toBeUndefined();
        expect(linkedElement(marks, "r", scale)).toBeUndefined();
        const strip: PlanRowValue["kind"] = variant("group", { summary: variant("none", null) });
        expect(linkedElement(rowOfKind("strip", strip), "r", scale)).toBeUndefined();
    });

    describe("each end meets its element where it draws (#1258)", () => {
        // The rows at 0, 32, 64, 96 (the laned row 52 tall) and 148.
        const rows = [bars, chips, tiles, laned, marks];
        const heights = [32, 32, 32, 52, 32];
        const index = indexRows(rows);
        const body = ribbonBody(rows.map((r) => rowItem(r)), heights, index, G);
        const element: RibbonLayoutInput["element"] = (row, key) => {
            const r = index.byKey.get(row);
            return r !== undefined ? linkedElement(r, key, scale) : undefined;
        };
        /** The end a link from the bars row's long run meets at `row`'s `key`. */
        const endAt = (row: string, key: string) =>
            layoutRibbons(input({ links: [link("bars", "r", row, key)], body, element })).ribbons[0]!.to;
        const mid = (top: number, h: number) => top + (h - G.rule) / 2;
        const around = (top: number, h: number, size: number) => ({ top: mid(top, h) - size / 2, bottom: mid(top, h) + size / 2 });

        test("a run shorter than its padding draws the narrowest bar from its start — a link leaves the end it shows", () => {
            const from = layoutRibbons(input({ links: [link("bars", "tiny", "chips", "c")], body, element })).ribbons[0]!.from;
            const x = xOf(hour("2026-07-08T06:00"));
            expect(from).toEqual({ leftX: x, rightX: x + G.barMinWidth, ...around(0, 32, G.bar) });
        });

        test("a chip in from its ends by the cell inset, at least the narrowest chip, at the chip's height", () => {
            expect(endAt("chips", "c")).toEqual({
                leftX: xOf(at("2026-07-13")) + PLAN_CELL_INSET, rightX: xOf(at("2026-07-27")) - PLAN_CELL_INSET, ...around(32, 32, G.chip),
            });
            const short = endAt("chips", "short");
            expect(short.rightX - short.leftX).toBe(G.chipMinWidth);
            expect(short.leftX).toBe(xOf(hour("2026-08-03T06:00")) + PLAN_CELL_INSET);
        });

        test("a tile's cell in from its bucket and its lane by the cell inset — its own lane's, or the whole cell its bucket shares", () => {
            const x0 = xOf(at("2026-07-06")) + PLAN_CELL_INSET;
            const x1 = xOf(at("2026-07-13")) - PLAN_CELL_INSET;
            expect(endAt("tiles", "e")).toEqual({ leftX: x0, rightX: x1, top: 64 + PLAN_CELL_INSET, bottom: 64 + 31 - PLAN_CELL_INSET });
            // The laned row's plot cell is 51 tall: the second lane's cell is its lower half, in by the inset.
            const half = 51 / 2;
            expect(endAt("laned", "in2")).toMatchObject({ top: 96 + half + PLAN_CELL_INSET, bottom: 96 + 2 * half - PLAN_CELL_INSET });
            expect(endAt("laned", "beside")).toMatchObject({ top: 96 + PLAN_CELL_INSET, bottom: 96 + 51 - PLAN_CELL_INSET });
        });

        test("a mark across its glyph, centred on its instant: the dot, the turned diamond, the triangle, the icon's box", () => {
            const glyph = (key: string, on: Date, w: number, h: number) =>
                expect(endAt("marks", key), key).toEqual({ leftX: xOf(on) - w / 2, rightX: xOf(on) + w / 2, ...around(148, 32, h) });
            glyph("m", at("2026-08-05"), G.markDotWidth, G.markDotWidth);
            glyph("d", at("2026-08-12"), G.markDiamondWidth * Math.SQRT2, G.markDiamondWidth * Math.SQRT2);
            glyph("x", at("2026-08-19"), G.markTriangleWidth, G.markTriangle);
            glyph("i", at("2026-08-26"), G.markIconWidth, G.markIconWidth);
        });

        test("drawn past the plot's edge, an element is met where the plot clips it", () => {
            // A run an hour short of the window's end draws past it: its end is the plot's edge.
            const late = layoutRibbons(input({ links: [link("bars", "late", "chips", "c")], body, element })).ribbons[0]!.from;
            expect([late.leftX, late.rightX]).toEqual([xOf(hour("2026-09-20T23:00")), PLOT.left + PLOT.width]);
            // A mark at the window's start is half drawn: its start is the plot's edge.
            expect([endAt("marks", "edge").leftX, endAt("marks", "edge").rightX]).toEqual([PLOT.left, PLOT.left + G.markDotWidth / 2]);
        });

        test("a mark past the window lands on the plot's edge, in a slot as tall as its glyph", () => {
            const { ribbons, edgeSlots } = layoutRibbons(input({ links: [link("marks", "before", "bars", "r")], body, element }));
            expect([ribbons[0]!.from.leftX, ribbons[0]!.from.rightX]).toEqual([PLOT.left, PLOT.left]);
            expect(edgeSlots).toEqual([{ x: PLOT.left, y: mid(148, 32) - G.markDotWidth / 2, h: G.markDotWidth, side: "left" }]);
        });
    });
});

describe("link weights and captions (`Plan links.html` §15, #1258)", () => {
    const rows = ["a", "b", "c", "d"].map((k) => spanRow(k));
    const body = ribbonBody(rows.map((r) => rowItem(r)), [32, 32, 32, 32], indexRows(rows), G);
    const element = barsOf({
        "a|x": [at("2026-06-29"), at("2026-07-06")],
        "b|x": [at("2026-07-27"), at("2026-08-03")],
        "c|x": [at("2026-07-27"), at("2026-08-03")],
        "d|x": [at("2026-07-27"), at("2026-08-03")],
    });

    test("a weight is its quantity's third of the family's largest: above two thirds 8, above one third 4, else 2", () => {
        // The spec's family: 96 t, 60 t and 24 t of a 96 t largest.
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "x", "b", "x", 96), link("a", "x", "c", "x", 60), link("a", "x", "d", "x", 24)], body, element,
        }));
        expect(ribbons.map((r) => r.weight)).toEqual([8, 4, 2]);
        // The stroke is the weight.
        expect(ribbons.map((r) => r.width)).toEqual([8, 4, 2]);
        // A third or two thirds exactly is not above it.
        expect([ribbonWeight(64, 96), ribbonWeight(32, 96), ribbonWeight(65, 96), ribbonWeight(33, 96)]).toEqual([4, 2, 8, 4]);
        expect(ribbonWeight(0, 0)).toBe(2);
    });

    test("a link with no quantity weighs 1.5, and says nothing — no caption, no tooltip (#824)", () => {
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "x", "b", "x", 40), link("a", "x", "c", "x", null)], body, element,
        }));
        expect(ribbons[0]!.weight).toBe(8);
        expect(ribbons[1]!.weight).toBe(1.5);
        expect(ribbons[1]!.label).toBeUndefined();
    });

    test("the largest is the family's, over every link the focus gathers — a link keeps its weight as others scroll away", () => {
        // A 96 t link between rows the view no longer shows still weighs the
        // family: the 24 t link in view stays 2.
        const tall = ribbonBody(rows.map((r) => rowItem(r)), [32, 400, 32, 32], indexRows(rows), G);
        const { ribbons } = layoutRibbons(input({
            links: [link("c", "x", "d", "x", 96), link("a", "x", "b", "x", 24)], body: tall, element,
            viewport: { top: 0, bottom: 300 },
        }));
        expect(ribbons.map((r) => [r.link, r.weight])).toEqual([[1, 2]]);
    });

    test("a caption is the quantity's — its text, else its value through its format, then its unit (#824)", () => {
        const with_ = (quantity: unknown) => ({ ...link("a", "x", "b", "x"), quantity: some(quantity) }) as PlanLinkValue;
        const oneDp = variant("number", { minimumFractionDigits: some(1n), maximumFractionDigits: some(1n), signDisplay: none });
        const [told, formatted] = layoutRibbons(input({
            links: [
                with_({ value: 24, unit: some("k sheets"), format: none, text: some("−24 k sheets") }),
                with_({ value: 1234.25, unit: some("k sheets"), format: some(oneDp), text: none }),
            ],
            body, element,
        })).ribbons;
        expect(told!.label).toBe("−24 k sheets");
        expect(formatted!.label).toBe("1,234.3 k sheets");
        // Weighed by value, whatever the caption says.
        expect([told!.weight, formatted!.weight]).toEqual([2, 8]);
    });

    test("a caption within 60 × 12 of an earlier one steps down 12 until clear", () => {
        // Two ribbons from one source into two rows: their S-captions share a spot.
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "x", "b", "x"), link("a", "x", "b", "x")], body, element,
        }));
        expect(ribbons[1]!.ly - ribbons[0]!.ly).toBe(12);
        expect(ribbons[1]!.lx).toBe(ribbons[0]!.lx);
    });

    test("a caption 50 across from an earlier one steps down; one 60 or more across stays on its riser", () => {
        // Three S's out of one run end into one row: each caption sits on its
        // riser, 27 short of its destination's start — at 473, 523 and 593.
        const atPx = (px: number) => new Date(W27.getTime() + ((px - PLOT.left) / PLOT.width) * 84 * 86_400_000);
        const dates = barsOf({
            "a|x": [at("2026-06-29"), atPx(300)],
            "b|p": [atPx(500), atPx(540)], "b|q": [atPx(550), atPx(590)], "b|r": [atPx(620), atPx(660)],
        });
        const { ribbons } = layoutRibbons(input({
            links: [link("a", "x", "b", "p"), link("a", "x", "b", "q"), link("a", "x", "b", "r")], body, element: dates,
        }));
        expect(ribbons.map((r) => Math.round(r.lx))).toEqual([473, 523, 593]);
        const ly = ribbons[0]!.ly;
        expect(ribbons.map((r) => r.ly)).toEqual([ly, ly + 12, ly]);
    });
});
