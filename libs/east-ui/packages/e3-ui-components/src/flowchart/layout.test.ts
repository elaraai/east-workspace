/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the flowchart's modules load east-ui-components'
 * entry, which needs one as it loads.
 */

/**
 * The Flowchart's layout (#1509, `Flowchart Records Spec.md` R22–R24, R32,
 * R40, §4), pure, over rows as the read holds them: a phone's window of
 * lanes; cards as big as their reads — rows as tall as their tallest card,
 * its cards centred in it, top down lanes as tall as the tallest card, a
 * ghost the card's width and 40; each link's sides as today's, its route
 * meeting its cards' own sides and crossing no card; room for labels between
 * cards side by side; and labels placed clear of the cards, of each other and
 * of the diamonds — over the depot, at today's sizes and the visual spec's.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { StringType, equalFor } from "@elaraai/east";
import { NODE_H, NODE_W, computeLayout, labelBox, placeLabel, type FlowchartLayout, type LabelBox, type LayoutOptions, type Rect, type RouteSeg } from "./layout.js";
import type { FlowchartModel, FlowchartRows } from "./model.js";
import { decisionRow, laneRow, modelOf, rowsOf, stateRow, transitionRow } from "./rows.test-utils.js";

const keyEqual = equalFor(StringType);

// ============================================================================
// The rows under test
// ============================================================================

/** A transition's evidence in parcels: its badge's volume and count. */
const parcels = (volume: number, count: bigint) => ({ volume, unit: "parcels", count });

/**
 * The depot, as the examples hold it: five lanes, the parcels' flow and the
 * returns' beside it, two decisions, a transition in place, and one ending at
 * a state no row is keyed by — a ghost in Dispatch.
 */
const DEPOT: FlowchartRows = rowsOf({
    lanes: [laneRow("intake", "Intake", 1), laneRow("induct", "Induct", 2), laneRow("sort", "Sort", 3), laneRow("hold", "Hold", 4), laneRow("dispatch", "Dispatch", 5)],
    states: [
        stateRow("ARV", "Arrived", { lane: "intake", order: 1 }),
        stateRow("SCN", "Scanned", { lane: "intake", order: 2 }),
        stateRow("RCV", "Received", { lane: "intake", order: 3 }),
        stateRow("IND", "Inducted", { lane: "induct", order: 1 }),
        stateRow("LBL", "Relabelled", { lane: "induct", order: 2 }),
        stateRow("CH*", "Sort chutes (class)", { lane: "sort", order: 1 }),
        stateRow("SRD", "Sorted", { lane: "sort", order: 2 }),
        stateRow("HLD", "Held", { lane: "hold", order: 1 }),
        stateRow("CLR", "Cleared", { lane: "hold", order: 2 }),
        stateRow("INS", "Inspected", { lane: "hold", order: 3 }),
        stateRow("LDD", "Loaded", { lane: "dispatch", order: 1 }),
        stateRow("DSP", "Dispatched", { lane: "dispatch", order: 2 }),
        stateRow("RSD", "Resent", { lane: "dispatch", order: 3 }),
    ],
    transitions: [
        transitionRow("l1", "ARV", "SCN", { evidence: parcels(18460, 412n) }),
        transitionRow("l2", "SCN", "IND", { evidence: parcels(18390, 409n) }),
        transitionRow("l3", "IND", "IND", { kind: "observed" }),
        transitionRow("l4", "IND", "CH*", { decision: "route", evidence: parcels(17350, 386n) }),
        transitionRow("l5", "CH*", "SRD", { evidence: parcels(18210, 405n) }),
        transitionRow("l6", "SRD", "HLD", { evidence: parcels(8420, 188n) }),
        transitionRow("l7", "HLD", "CLR", { decision: "customs", evidence: parcels(8350, 186n) }),
        transitionRow("l8", "CLR", "LDD", { evidence: parcels(8240, 183n) }),
        transitionRow("l9", "LDD", "DSP", { evidence: parcels(17030, 378n) }),
        transitionRow("l10", "DSP", "DLV"),
        transitionRow("l11", "IND", "LBL", { kind: "observed", evidence: parcels(980, 22n) }),
        transitionRow("l12", "LBL", "CH*", { kind: "observed", evidence: parcels(975, 22n) }),
        transitionRow("l13", "SRD", "LDD", { evidence: parcels(8790, 195n) }),
        transitionRow("r1", "RCV", "INS", { evidence: parcels(640, 15n) }),
        transitionRow("r2", "INS", "RSD", { evidence: parcels(610, 14n) }),
    ],
    decisions: [decisionRow("route", "route"), decisionRow("customs", "customs")],
});

const depot = modelOf(DEPOT);

/** The visual spec's depot cards: 272 wide, each as tall as its reads — the ghost, no row, left at 40. */
const DEPOT_CARDS: NonNullable<LayoutOptions["cards"]> = {
    width: 272,
    heights: new Map([
        ["ARV", 216], ["SCN", 264], ["RCV", 216], ["IND", 283], ["LBL", 216], ["CH*", 283], ["SRD", 264],
        ["HLD", 283], ["CLR", 264], ["INS", 216], ["LDD", 216], ["DSP", 264], ["RSD", 216],
    ]),
};

/** The visual spec's depot labels: each transition's evidence line, then its list's top line. */
const DEPOT_LABELS: ReadonlyMap<string, LabelBox> = new Map(
    depot.links.flatMap((link) => (link.badgeText === undefined ? [] : [[link.key, labelBox([link.badgeText, "Metro 47%"])] as const])),
);

/** The depot at today's sizes, or the visual spec's. */
const SIZES = [
    { name: "today's", sized: {} },
    { name: "the details'", sized: { cards: DEPOT_CARDS, labels: DEPOT_LABELS } },
] as const;

/** The widths the spec checks the depot's labels at. */
const WIDTHS = [800, 1062, 1200] as const;

/**
 * Lanes A, B and C holding cards of mixed heights — A1 and A2 in A, B1 in B,
 * C1 in C — and B1 → GONE, a ghost in C after C1.
 */
const MIXED: FlowchartRows = rowsOf({
    lanes: [laneRow("a", "A", 1), laneRow("b", "B", 2), laneRow("c", "C", 3)],
    states: [
        stateRow("A1", "A1", { lane: "a", order: 1 }),
        stateRow("A2", "A2", { lane: "a", order: 2 }),
        stateRow("B1", "B1", { lane: "b", order: 1 }),
        stateRow("C1", "C1", { lane: "c", order: 1 }),
    ],
    transitions: [transitionRow("t1", "A1", "B1"), transitionRow("t2", "B1", "GONE")],
});

const mixed = modelOf(MIXED);

/** The mixed cards: 272 wide, A1 120, A2 200, B1 80 and C1 160 tall. */
const MIXED_CARDS: NonNullable<LayoutOptions["cards"]> = {
    width: 272,
    heights: new Map([["A1", 120], ["A2", 200], ["B1", 80], ["C1", 160]]),
};

// ============================================================================
// What a test reads off a layout
// ============================================================================

/** Whether two boxes overlap: touching edges do not. */
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Whether an H/V segment passes through a box's inside: along its edge is outside it. */
const crosses = (seg: RouteSeg, r: Rect): boolean =>
    Math.min(seg.a.x, seg.b.x) < r.x + r.w && Math.max(seg.a.x, seg.b.x) > r.x && Math.min(seg.a.y, seg.b.y) < r.y + r.h && Math.max(seg.a.y, seg.b.y) > r.y;

/**
 * Each routed link's sides, in the model's order: the side it leaves its
 * card by and the side it enters its other by.
 *
 * @param drawing - The layout
 * @param model - What it lays out
 * @returns A line a link
 */
function sidesOf(drawing: FlowchartLayout, model: FlowchartModel): readonly string[] {
    const side = (node: string, link: string): string | undefined =>
        drawing.handles.get(node)?.find((info) => info.links.some((key) => keyEqual(key, link)))?.side;
    return model.links.map((link) => `${link.key}: ${link.from} ${side(link.from, link.key)} → ${link.to} ${side(link.to, link.key)}`);
}

/**
 * Every route that passes through a card — its own cards' too.
 *
 * @param drawing - The layout
 * @returns A line a route and card
 */
function crossingsOf(drawing: FlowchartLayout): readonly string[] {
    const out: string[] = [];
    for (const route of drawing.routes) {
        for (const [key, card] of drawing.nodes) if (route.segs.some((seg) => crosses(seg, card))) out.push(`${route.key} × ${key}`);
    }
    return out;
}

/**
 * Every label that stands on a card, on another label or on a diamond.
 *
 * @param drawing - The layout
 * @param model - What it lays out
 * @returns A line a label and what it stands on
 */
function labelsCoveringOf(drawing: FlowchartLayout, model: FlowchartModel): readonly string[] {
    const out: string[] = [];
    const labelled = drawing.routes.filter((route) => route.label !== undefined);
    for (const [i, route] of labelled.entries()) {
        const box = route.label!;
        for (const [key, card] of drawing.nodes) if (overlaps(box, card)) out.push(`${route.key} on ${key}`);
        for (const other of labelled.slice(i + 1)) if (overlaps(box, other.label!)) out.push(`${route.key} on ${other.key}'s label`);
        const link = model.links.find((l) => keyEqual(l.key, route.key));
        if (link?.trigger !== undefined && overlaps(box, { x: route.mid.x - 14, y: route.mid.y - 14, w: 28, h: 28 })) out.push(`${route.key} on its diamond`);
    }
    return out;
}

// ============================================================================
// A phone's window of lanes
// ============================================================================

describe("computeLayout's laneWidth (a phone's window of lanes)", () => {
    const one = {
        lanes: [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }],
        nodes: [{ key: "n", laneIndex: 1, laneOrder: 0 }],
        nodesByKey: new Map(),
        links: [],
    } as unknown as FlowchartModel;

    test("each lane takes the width given, and a state stands in its lane's middle", () => {
        const layout = computeLayout(one, { width: 336, orientation: "LR", laneWidth: 168 });
        expect(layout.lanes.map((lane) => [lane.x, lane.w])).toEqual([[0, 168], [168, 168], [336, 168]]);
        expect(layout.nodes.get("n")!.x).toBe(168 + 84 - NODE_W / 2);
    });

    test("left out, the lanes fill the width, as on a wide frame", () => {
        const layout = computeLayout(one, { width: 1000, orientation: "LR" });
        expect(layout.lanes[0]!.w).toBe(Math.floor((1000 - 78) / 3));
    });

    test("where the details draw on the cards, a window holding one lane: each lane at least the window's width, so no other lane shows beside it; a wider one keeps its width", () => {
        const lanesAt = (labels: ReadonlyMap<string, LabelBox>) =>
            computeLayout(mixed, { width: 390, orientation: "LR", cards: MIXED_CARDS, labels, laneWindow: 390 }).lanes.map((lane) => lane.w);
        // The least room, 50: a lane of 322, widened to the window's 390.
        expect(lanesAt(new Map())).toEqual([390, 390, 390]);
        // Room for a label 130 wide: 426, wider than the window, kept.
        expect(lanesAt(new Map([["t1", labelBox(["18,460 parcels · 412"])]]))).toEqual([426, 426, 426]);
        // Top down, the lanes stack: the window sets none of them.
        expect(computeLayout(mixed, { width: 390, orientation: "TD", cards: MIXED_CARDS, laneWindow: 390 }).lanes[0]!.h).toBe(272);
    });
});

// ============================================================================
// Cards as big as their reads (R22)
// ============================================================================

describe("cards as big as their reads (R22)", () => {
    test("left to right, each row is as tall as its tallest card, its cards centred in it, 56 between rows; a ghost is the card's width and 40, centred in its slot", () => {
        const layout = computeLayout(mixed, { width: 1200, orientation: "LR", cards: MIXED_CARDS });
        // Row 0 holds A1, B1 and C1 — C1's 160 the tallest; row 1 holds A2 and the ghost; the row past the last is a ghost's 40.
        expect(layout.rows).toEqual([{ start: 56, size: 160 }, { start: 272, size: 200 }, { start: 528, size: 40 }]);
        // The lanes fill the width: 374 each, past the card's 272 and the least room, 50.
        expect(layout.lanes.map((lane) => [lane.x, lane.w])).toEqual([[0, 374], [374, 374], [748, 374]]);
        const card = (key: string) => { const r = layout.nodes.get(key)!; return [r.x, r.y, r.w, r.h]; };
        expect(card("A1")).toEqual([51, 76, 272, 120]);
        expect(card("B1")).toEqual([425, 96, 272, 80]);
        expect(card("C1")).toEqual([799, 56, 272, 160]);
        expect(card("A2")).toEqual([51, 272, 272, 200]);
        expect(card("GONE")).toEqual([799, 352, 272, 40]);
        for (const node of mixed.nodes) {
            const r = layout.nodes.get(node.key)!;
            const row = layout.rows[node.laneOrder]!;
            expect(r.y + r.h / 2).toBe(row.start + row.size / 2);
        }
        // Each lane's "+ STATE" cell: the card's width and 40, centred in the row after its last.
        expect([...layout.laneGhosts.values()]).toEqual([
            { x: 51, y: 528, w: 272, h: 40 },
            { x: 425, y: 352, w: 272, h: 40 },
            { x: 799, y: 528, w: 272, h: 40 },
        ]);
        expect(layout.cellAcross).toBe(272);
    });

    test("top down, the lanes are as tall as the tallest card and 72, its cards centred in them; each row is the card's width, widening as today where the width allows; a ghost the card's width and 40", () => {
        const layout = computeLayout(mixed, { width: 1200, orientation: "TD", cards: MIXED_CARDS });
        // 1,200 wide: the room between rows widens from the least, 52, to today's most, 144.
        expect(layout.rows).toEqual([{ start: 56, size: 272 }, { start: 472, size: 272 }, { start: 888, size: 272 }]);
        // A2's 200 the tallest: 272 a lane.
        expect(layout.lanes.map((lane) => [lane.y, lane.h])).toEqual([[0, 272], [272, 272], [544, 272]]);
        const card = (key: string) => { const r = layout.nodes.get(key)!; return [r.x, r.y, r.w, r.h]; };
        expect(card("A1")).toEqual([56, 76, 272, 120]);
        expect(card("B1")).toEqual([56, 368, 272, 80]);
        expect(card("C1")).toEqual([56, 600, 272, 160]);
        expect(card("A2")).toEqual([472, 36, 272, 200]);
        expect(card("GONE")).toEqual([472, 660, 272, 40]);
        expect([...layout.laneGhosts.values()]).toEqual([
            { x: 888, y: 116, w: 272, h: 40 },
            { x: 472, y: 388, w: 272, h: 40 },
            { x: 888, y: 660, w: 272, h: 40 },
        ]);
        expect(layout.cellAcross).toBe(200);
    });

    test("top down, a lane takes 26 more for each line a label adds", () => {
        const at = (lines: readonly string[]) => computeLayout(mixed, {
            width: 1200, orientation: "TD", cards: MIXED_CARDS, labels: new Map([["t1", labelBox(lines)]]),
        }).lanes[0]!.h;
        expect([at(["8,420 parcels · 188"]), at(["8,420 parcels · 188", "Metro 47%"]), at(["8,420 parcels · 188", "Metro 47%", "Hub 31%"])]).toEqual([272, 298, 324]);
    });

    test("left out, every card is today's 116 × 40 and the rows today's 96 apart", () => {
        const layout = computeLayout(mixed, { width: 0, orientation: "LR" });
        expect(layout.rows).toEqual([{ start: 56, size: 40 }, { start: 152, size: 40 }, { start: 248, size: 40 }]);
        expect([...layout.nodes.values()].map((r) => [r.w, r.h])).toEqual(mixed.nodes.map(() => [NODE_W, NODE_H]));
        expect(layout.lanes[0]!.w).toBe(166);
    });

    test("the depot at the visual spec's sizes takes the spec's geometry: lanes 426 wide and rows 339 and 320 apart left to right; top down, lanes 381 tall and rows 426 apart; the ghost 272 × 40", () => {
        const lr = computeLayout(depot, { width: 1200, orientation: "LR", cards: DEPOT_CARDS, labels: DEPOT_LABELS });
        expect(lr.lanes.map((lane) => lane.w)).toEqual([426, 426, 426, 426, 426]);
        expect([lr.rows[1]!.start - lr.rows[0]!.start, lr.rows[2]!.start - lr.rows[1]!.start]).toEqual([339, 320]);
        const ghost = lr.nodes.get("DLV")!;
        expect([ghost.w, ghost.h]).toEqual([272, 40]);
        const td = computeLayout(depot, { width: 1200, orientation: "TD", cards: DEPOT_CARDS, labels: DEPOT_LABELS });
        expect(td.lanes.map((lane) => lane.h)).toEqual([381, 381, 381, 381, 381]);
        expect(td.rows[1]!.start - td.rows[0]!.start).toBe(426);
    });
});

// ============================================================================
// Sides as today (R23)
// ============================================================================

describe("each link's sides as today's (R23)", () => {
    for (const orientation of ["LR", "TD"] as const) {
        for (const width of WIDTHS) {
            test(`${orientation} at ${width}px, every depot link leaves and enters its cards by today's sides, meets the cards' own sides, and crosses no card`, () => {
                const today = computeLayout(depot, { width, orientation });
                const sized = computeLayout(depot, { width, orientation, cards: DEPOT_CARDS, labels: DEPOT_LABELS });
                expect(sidesOf(sized, depot)).toEqual(sidesOf(today, depot));
                expect(sidesOf(sized, depot).filter((line) => line.includes("undefined"))).toEqual([]);
                for (const drawing of [today, sized]) {
                    for (const [key, infos] of drawing.handles) {
                        const card = drawing.nodes.get(key)!;
                        for (const info of infos) expect(info.pt).toEqual(card[info.side]);
                    }
                    expect(crossingsOf(drawing)).toEqual([]);
                }
            });
        }
    }

    test("a card taller than it is wide turns no link between lanes out of its top or bottom: Sort's cards meet Hold's beside them by their sides", () => {
        const sized = computeLayout(depot, { width: 1062, orientation: "LR", cards: DEPOT_CARDS, labels: DEPOT_LABELS });
        expect(sidesOf(sized, depot).filter((line) => line.startsWith("l6:"))).toEqual(["l6: SRD right → HLD left"]);
    });
});

// ============================================================================
// Room for labels (R24) and where they stand (R32)
// ============================================================================

describe("room for labels (R24)", () => {
    test("where the details draw on the cards, two cards side by side keep the widest label's width and 24 between them — left to right across lanes, top down along them", () => {
        const wide = new Map([["t1", labelBox(["18,460 parcels · 412"])]]);
        const lr = computeLayout(mixed, { width: 0, orientation: "LR", cards: MIXED_CARDS, labels: wide });
        expect(lr.lanes[0]!.w).toBe(272 + 130 + 24);
        const td = computeLayout(mixed, { width: 0, orientation: "TD", cards: MIXED_CARDS, labels: wide });
        expect(td.rows[1]!.start - (td.rows[0]!.start + td.rows[0]!.size)).toBe(130 + 24);
    });

    test("today's 50 and 52 stay the least: no label, or a narrow one, keeps them", () => {
        const narrow = new Map([["t1", labelBox(["9"])]]);
        for (const labels of [new Map<string, LabelBox>(), narrow]) {
            const lr = computeLayout(mixed, { width: 0, orientation: "LR", cards: MIXED_CARDS, labels });
            expect(lr.lanes[0]!.w).toBe(272 + 50);
            const td = computeLayout(mixed, { width: 0, orientation: "TD", cards: MIXED_CARDS, labels });
            expect(td.rows[1]!.start - (td.rows[0]!.start + td.rows[0]!.size)).toBe(52);
        }
    });

    test("with no cards given, the lanes and rows are today's, whatever the labels", () => {
        const wide = new Map([["t1", labelBox(["18,460 parcels · 412"])]]);
        expect(computeLayout(mixed, { width: 0, orientation: "LR", labels: wide }).lanes[0]!.w).toBe(166);
    });
});

describe("a transition's label (R32)", () => {
    test("its box is 18 high and 13 for each line past its first, as wide as its longest line: 5.8 a character and 14 — a line still to land counting toward its height", () => {
        expect(labelBox(["18,460 parcels · 412"])).toEqual({ w: 130, h: 18 });
        expect(labelBox(["18,460 parcels · 412", "Metro 47%"])).toEqual({ w: 130, h: 31 });
        expect(labelBox(["980 parcels · 22", "", ""])).toEqual({ w: 106.8, h: 44 });
    });

    for (const { name, sized } of SIZES) {
        for (const orientation of ["LR", "TD"] as const) {
            test(`at ${name} sizes, ${orientation}, the depot's labels stand clear of the cards, of each other and of the diamonds at 800, 1,062 and 1,200px`, () => {
                for (const width of WIDTHS) {
                    const drawing = computeLayout(depot, { width, orientation, legendPad: 122, ...sized });
                    expect({ width, covering: labelsCoveringOf(drawing, depot) }).toEqual({ width, covering: [] });
                    // Every transition with evidence draws its label; l10, with none, draws none.
                    expect(drawing.routes.filter((route) => route.label !== undefined).map((route) => route.key))
                        .toEqual(depot.links.filter((link) => link.badgeText !== undefined).map((link) => link.key));
                }
            });
        }
    }

    test("labels given draw only for the transitions they name", () => {
        const drawing = computeLayout(depot, { width: 1062, orientation: "LR", cards: DEPOT_CARDS, labels: new Map([["l5", labelBox(["18,210 parcels · 405"])]]) });
        expect(drawing.routes.filter((route) => route.label !== undefined).map((route) => route.key)).toEqual(["l5"]);
    });
});

describe("the label placer (R32)", () => {
    const size: LabelBox = { w: 60, h: 18 };
    /** A horizontal segment, 300 long, and a vertical one, 100, from its end. */
    const segs: RouteSeg[] = [{ a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }, { a: { x: 300, y: 0 }, b: { x: 300, y: 100 } }];

    test("today's place first: the longest segment's middle, a horizontal one's label just above its line", () => {
        expect(placeLabel(segs, size, [], [], [])).toEqual({ x: 120, y: -22, w: 60, h: 18 });
    });

    test("then the steps off every segment, the longest first: where the longest's are all on a card, a step off the next", () => {
        // A card over the horizontal segment, and all but the far side of the vertical one.
        const card: Rect = { x: -50, y: -150, w: 400, h: 300 };
        expect(placeLabel(segs, size, [card], [], [])).toEqual({ x: 364, y: 41, w: 60, h: 18 });
    });

    test("where no place is clear, the place tried that covers least of the cards — never a fixed place", () => {
        // Cards above and below the horizontal segment, the one below 25 under it: a step 22 below covers least.
        const cards: Rect[] = [{ x: -500, y: -500, w: 1300, h: 490 }, { x: -500, y: 25, w: 1300, h: 475 }];
        const one: RouteSeg[] = [segs[0]!];
        expect(placeLabel(one, size, cards, [], [])).toEqual({ x: 120, y: 13, w: 60, h: 18 });
    });

    test("then of the labels: a place on no card wins over one covering less of the labels on a card", () => {
        const one: RouteSeg[] = [segs[0]!];
        const labels: Rect[] = [{ x: -500, y: -500, w: 1300, h: 490 }, { x: -500, y: 25, w: 1300, h: 475 }];
        // Labels alone: the step 22 below covers least of them.
        expect(placeLabel(one, size, [], [], labels)).toEqual({ x: 120, y: 13, w: 60, h: 18 });
        // A card where that step stands: today's place, on no card, wins though it covers more of the labels.
        expect(placeLabel(one, size, [{ x: 100, y: 12, w: 100, h: 20 }], [], labels)).toEqual({ x: 120, y: -22, w: 60, h: 18 });
    });

    test("a decision's diamond keeps the middle: its label steps beside it", () => {
        const one: RouteSeg[] = [{ a: { x: 0, y: 0 }, b: { x: 0, y: 300 } }];
        const diamond: Rect = { x: -14, y: 136, w: 28, h: 28 };
        const box = placeLabel(one, size, [], [diamond], []);
        expect(overlaps(box, diamond)).toBe(false);
        expect(box).toEqual({ x: -30, y: 87, w: 60, h: 18 });
    });
});
