/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The reader renders as a hook; the rest is pure. The flowchart's modules load
 * east-ui-components' entry, which needs a DOM as it loads.
 */

/**
 * The Flowchart's details model (#1508, #1509, `Flowchart Records Spec.md`
 * R19, R22, R26, R27, R32, R33, R34, R38), over details as the payload decodes
 * them and rows as bytes: the rows drawn; the details read whole, and by the
 * drawn rows' keys in one request — delayed, and failing, the last settled
 * read standing; the app's bins over a Dict's durations and an Array's counts,
 * refused as they land, and every drawn row's edges merged; bars and the axis
 * on both scales; a list's top lines; each card's size, as the visual spec
 * measures it; and a transition label's lines.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, some, variant, type option } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import {
    axisAt, barsOf, binsRefusal, countIntoBins, detailsCardOf, detailsLabelOf, drawnKeysOf, flowchartDetailsModel, listLines, useFlowchartDetails,
    type FlowchartDetailBytes, type FlowchartDetailRowValue, type FlowchartDetailsData, type FlowchartDetailsKinds, type FlowchartDetailsValue,
    type FlowchartDrawnKeys, type FlowchartPagedRows, type FlowchartReadValue,
} from "./details.js";
import { modelOf, rowsOf, stateRow, transitionRow, words } from "./rows.test-utils.js";

const encodeRow = encodeBeast2For(Flowchart.Types.DetailRow);
const decodeRow = decodeBeast2For(Flowchart.Types.DetailRow);
const compareKey = compareFor(StringType);

/** One read in the details' order, and where it shows. */
type Shown = FlowchartDetailsValue["reads"][number];

/** A read on the canvas and in the inspector — the default. */
const all = (read: FlowchartReadValue): Shown => ({ show: variant("all", null), read });
/** A read in the inspector alone. */
const inspectorOnly = (read: FlowchartReadValue): Shown => ({ show: variant("inspector", null), read });

/** A parcel depot's figure: the parcels a state holds. */
const PARCELS: FlowchartReadValue = variant("figure", { label: "Parcels", unit: some("parcels") });

/** Its flags, three of them given looks. */
const FLAGS: FlowchartReadValue = variant("tags", {
    label: "Flags",
    colors: [
        { tag: "Hazmat", colorPalette: variant("danger", null), variant: variant("subtle", null) },
        { tag: "At risk", colorPalette: variant("warning", null), variant: variant("subtle", null) },
        { tag: "Customs", colorPalette: variant("blue", null), variant: variant("subtle", null) },
    ],
    legend: true,
});

/** Its time in state, in hours: the app's bins, or none — every row's edges merged. */
function timeInState(bins: readonly number[] | undefined, linear = false): FlowchartReadValue {
    return variant("histogram", {
        label: "Time in state", unit: variant("hours", null), counts: some("parcels"),
        bins: bins === undefined ? none : some([...bins]), scale: linear ? variant("linear", null) : variant("band", null), ticks: none,
    });
}

/** Its services, the top two on a card. */
const SERVICE: FlowchartReadValue = variant("list", { label: "Service", unit: some("parcels"), top: 2n });

/** The app's bins for time in state: under an hour, to 12h, to 2d, to a week, and a week or more. */
const HOURS = [0, 1, 12, 48, 168];

/** A details row as the app's bytes: one value a read. */
const bytesOf = (...values: FlowchartDetailRowValue): Uint8Array => encodeRow(values);

/** A row's histogram, each count at its edge. */
const histogram = (...bins: readonly (readonly [from: number, count: number])[]) => variant("histogram", bins.map(([from, count]) => ({ from, count })));

/** A row's list, by name. */
const list = (...items: readonly (readonly [name: string, value: number])[]) => variant("list", items.map(([name, value]) => ({ name, value, note: none })));

/** Sort chutes: 18,290 parcels, at risk, mostly through within the hour. */
const SORT_CHUTES = bytesOf(
    variant("figure", some(18290)), variant("tags", ["At risk"]),
    histogram([0, 9000], [1, 6000], [12, 2500], [48, 700], [168, 90]),
    list(["Standard", 10425], ["Priority", 4390], ["Economy", 3475]),
);

/** Held: 1,080 parcels, five flags, most waiting a day or more. */
const HELD = bytesOf(
    variant("figure", some(1080)), variant("tags", ["Oversize", "Hazmat", "Cold chain", "At risk", "Customs"]),
    histogram([0, 20], [1, 140], [12, 420], [48, 380], [168, 120]),
    list(["Standard", 335], ["International", 539], ["Priority", 130], ["Economy", 76]),
);

/** The depot's four reads, in the visual spec's order. */
const DEPOT_READS: readonly Shown[] = [all(PARCELS), all(FLAGS), all(timeInState(HOURS)), all(SERVICE)];

/** Details read whole, through `rows`. */
function wholeDetails(reads: readonly Shown[], rows: () => option<Map<string, Uint8Array>>): FlowchartDetailsValue {
    return { reads: [...reads], rows: some(rows), paged: none, values: (bytes) => decodeRow(bytes) };
}

/** Details read by key, through the paged read named. */
function pagedDetails(reads: readonly Shown[]): FlowchartDetailsValue {
    return { reads: [...reads], rows: none, paged: some("depot-details"), values: (bytes) => decodeRow(bytes) };
}

/** A record's rows, by key. */
const record = (...rows: readonly (readonly [key: string, bytes: Uint8Array])[]) => new SortedMap<string, Uint8Array>(rows.map(([key, bytes]) => [key, bytes]), compareKey);

/** The states' details alone. */
const statesOnly = (details: FlowchartDetailsValue): FlowchartDetailsKinds => ({ states: { name: "Step", details }, transitions: undefined });

/** The states drawn, and no transition. */
const drawnStates = (...states: string[]): FlowchartDrawnKeys => ({ states, transitions: [] });

/** A paged read held by a test: what it holds, the keys each request asks, and whether it answers, waits or fails. */
function pagedRead(held: ReadonlyMap<string, Uint8Array>) {
    const asked: string[][] = [];
    let now: "answers" | "waits" | "fails" = "answers";
    const read: FlowchartPagedRows = (_paged, keys) => {
        asked.push([...keys]);
        if (now === "waits") return none;
        if (now === "fails") throw new Error("Data.bindPaged: the read failed");
        return some(new Map(keys.map((key) => [key, held.get(key) ?? null])) as FlowchartDetailBytes);
    };
    return { read, asked, set: (next: typeof now) => { now = next; } };
}

/** The model over one read, and the states' card at a key. */
function modelOver(kinds: FlowchartDetailsKinds, data: FlowchartDetailsData, drawn: FlowchartDrawnKeys) {
    return flowchartDetailsModel(kinds, data, drawn, words);
}

describe("the rows drawn (R19)", () => {
    test("every state but a ghost, and every transition — routed, and in place — each kind in key order", () => {
        const model = modelOf(rowsOf({
            states: [stateRow("SRD", "Sorted"), stateRow("CH*", "Sort chutes"), stateRow("HLD", "Held")],
            transitions: [transitionRow("t2", "CH*", "SRD"), transitionRow("t1", "CH*", "HLD"), transitionRow("t3", "HLD", "HLD"), transitionRow("t4", "HLD", "GONE")],
        }));
        expect(drawnKeysOf(model)).toEqual({ states: ["CH*", "HLD", "SRD"], transitions: ["t1", "t2", "t3", "t4"] });
    });
});

describe("the details, read as the kind is (R19, R33, R34)", () => {
    test("read whole beside a kind read whole: each drawn row matched by its key, one the details hold none of no row, and one keyed as no row drawn left out", () => {
        const kinds = statesOnly(wholeDetails([all(PARCELS)], () => some(record(["CH*", bytesOf(variant("figure", some(18290)))], ["OLD", bytesOf(variant("figure", some(4)))]))));
        const { result } = renderHook(() => useFlowchartDetails(kinds, drawnStates("CH*", "HLD"), 0));
        expect(result.current.states).toEqual({
            rows: new Map([["CH*", [variant("figure", some(18290))]], ["HLD", null]]), reading: false, error: undefined,
        });
        expect(result.current.transitions).toBeUndefined();
    });

    test("read by the drawn rows' keys beside one read through its source: every key in one request, and nothing else asked", () => {
        const paged = pagedRead(record(["CH*", SORT_CHUTES], ["HLD", HELD], ["OLD", SORT_CHUTES]));
        const kinds = statesOnly(pagedDetails(DEPOT_READS));
        const drawn = drawnStates("CH*", "HLD", "SRD");
        const { result } = renderHook(() => useFlowchartDetails(kinds, drawn, 0, paged.read));
        expect(paged.asked.length).toBeGreaterThan(0);
        for (const keys of paged.asked) expect(keys).toEqual(["CH*", "HLD", "SRD"]);
        expect(result.current.states?.rows).toEqual(new Map([["CH*", decodeRow(SORT_CHUTES)], ["HLD", decodeRow(HELD)], ["SRD", null]]));
    });

    test("a delayed binding: nothing landed draws placeholders, sized as drawn in full; once it lands, its rows — the same object while it reads again as it was", () => {
        let landed = false;
        const kinds = statesOnly(wholeDetails(DEPOT_READS, () => (landed ? some(record(["HLD", HELD])) : none)));
        const drawn = drawnStates("HLD");
        const { result, rerender } = renderHook(({ attempt }) => useFlowchartDetails(kinds, drawn, attempt), { initialProps: { attempt: 0 } });
        expect(result.current.states).toEqual({ rows: new Map(), reading: true, error: undefined });
        const waiting = modelOver(kinds, result.current, drawn).states!;
        const placeholder = detailsCardOf(waiting, "HLD")!;
        expect(placeholder.reads.map((read) => [read.draws.kind, read.height])).toEqual([["placeholder", 16], ["placeholder", 15], ["placeholder", 62], ["placeholder", 54]]);
        expect(placeholder.height).toBe(264);

        landed = true;
        rerender({ attempt: 1 });
        const first = result.current.states!;
        expect(first.reading).toBe(false);
        expect(first.rows.get("HLD")).toEqual(decodeRow(HELD));
        rerender({ attempt: 2 });
        expect(result.current.states).toBe(first);
    });

    test("a failing binding: why, said once; what the last settled read held stands, and a read in flight keeps it too", () => {
        const paged = pagedRead(record(["HLD", HELD]));
        const kinds = statesOnly(pagedDetails(DEPOT_READS));
        const drawn = drawnStates("HLD");
        const { result, rerender } = renderHook(({ attempt }) => useFlowchartDetails(kinds, drawn, attempt, paged.read), { initialProps: { attempt: 0 } });
        const settled = result.current.states!.rows;
        expect(settled.get("HLD")).toEqual(decodeRow(HELD));

        paged.set("waits");
        rerender({ attempt: 1 });
        expect(result.current.states!.reading).toBe(true);
        expect(result.current.states!.rows).toBe(settled);

        paged.set("fails");
        rerender({ attempt: 2 });
        expect(result.current.states!.error).toBe("Data.bindPaged: the read failed");
        expect(result.current.states!.reading).toBe(false);
        expect(result.current.states!.rows).toBe(settled);

        // Never landed and failing: no row held, every card's reads placeholders, the failure said.
        const cold = pagedRead(record());
        cold.set("fails");
        const { result: never } = renderHook(() => useFlowchartDetails(kinds, drawn, 0, cold.read));
        expect(never.current.states).toEqual({ rows: new Map(), reading: false, error: "Data.bindPaged: the read failed" });
    });
});

describe("the flowchart's bins (R26, R27)", () => {
    test("the app's bins over a Dict's durations: each in the bin that holds it, one under the first edge in the first, past the last in the open last", () => {
        const counted = countIntoBins([{ from: -1, count: 2 }, { from: 0, count: 3 }, { from: 0.5, count: 4 }, { from: 1, count: 5 }, { from: 12, count: 6 }, { from: 500, count: 7 }], HOURS);
        expect(counted).toEqual({ counts: [9, 5, 6, 0, 7], total: 27, unheld: false });
    });

    test("the app's bins over an Array's counts: a bin each; another number of them — at NaN, as e3-ui puts them, an empty Array too — no bin holds, listed in Issues, its bars drawn absent", () => {
        const held = record(
            ["CH*", bytesOf(histogram([0, 9000], [1, 6000], [12, 2500], [48, 700], [168, 90]))],
            ["HLD", bytesOf(histogram([NaN, 20], [NaN, 140], [NaN, 420]))],
            ["SRD", bytesOf(histogram([NaN, 0]))],
        );
        const kinds = statesOnly(wholeDetails([all(timeInState(HOURS))], () => some(held)));
        const drawn = drawnStates("CH*", "HLD", "SRD");
        const { result } = renderHook(() => useFlowchartDetails(kinds, drawn, 0));
        const model = modelOver(kinds, result.current, drawn);
        const states = model.states!;
        expect(states.bins).toEqual([{ edges: HOURS, scale: "band" }]);
        expect(states.rows.get("CH*")?.counts).toEqual([{ counts: [9000, 6000, 2500, 700, 90], total: 18290, unheld: false }]);
        expect(states.rows.get("HLD")?.counts).toEqual([{ counts: [0, 0, 0, 0, 0], total: 0, unheld: true }]);
        expect(model.findings).toEqual([
            { finding: "counts", sort: "states", key: "HLD", read: "Time in state" },
            { finding: "counts", sort: "states", key: "SRD", read: "Time in state" },
        ]);
        expect(detailsCardOf(states, "CH*")!.reads[0]!.draws.kind).toBe("bars");
        expect(detailsCardOf(states, "HLD")!.reads[0]!.draws).toEqual({ kind: "noData" });
    });

    test("no bins given: every drawn row's edges merged, so a bar is the same span on each — a row keyed as no row drawn adds none", () => {
        const held = record(
            ["CH*", bytesOf(histogram([0, 5], [2, 3], [8, 1]))],
            ["HLD", bytesOf(histogram([0, 1], [4, 6], [8, 2], [NaN, 1]))],
            ["OLD", bytesOf(histogram([1000, 9]))],
        );
        const kinds = statesOnly(wholeDetails([all(timeInState(undefined))], () => some(held)));
        const drawn = drawnStates("CH*", "HLD");
        const { result } = renderHook(() => useFlowchartDetails(kinds, drawn, 0));
        const model = modelOver(kinds, result.current, drawn);
        expect(model.states!.bins).toEqual([{ edges: [0, 2, 4, 8], scale: "band" }]);
        expect(model.states!.rows.get("CH*")?.counts).toEqual([{ counts: [5, 3, 0, 1], total: 9, unheld: false }]);
        expect(model.states!.rows.get("HLD")?.counts).toEqual([{ counts: [1, 0, 6, 2], total: 9, unheld: true }]);
        expect(model.findings).toEqual([{ finding: "counts", sort: "states", key: "HLD", read: "Time in state" }]);
    });

    test("bins the app binds, checked as they land: none, an edge that is no finite number, or two that do not ascend — listed in Issues in the app's locale, the read drawn on no card", () => {
        expect(binsRefusal(HOURS)).toBeUndefined();
        expect(binsRefusal([])).toEqual({ why: "empty" });
        expect(binsRefusal([0, NaN])).toEqual({ why: "number", edge: NaN });
        expect(binsRefusal([0, 1500, 1500])).toEqual({ why: "order", before: 1500, after: 1500 });
        const kinds = statesOnly(wholeDetails([all(timeInState([0, 1500, 1500])), all(timeInState([])), all(timeInState([0, Infinity]))], () => some(record(["CH*", bytesOf(histogram([0, 1]), histogram([0, 1]), histogram([0, 1]))]))));
        const drawn = drawnStates("CH*");
        const { result } = renderHook(() => useFlowchartDetails(kinds, drawn, 0));
        const model = modelOver(kinds, result.current, drawn);
        expect(model.states!.bins).toEqual([undefined, undefined, undefined]);
        expect(model.findings).toEqual([
            { finding: "bins", sort: "states", kind: "Step", read: "Time in state", refusal: { why: "order", before: "1,500", after: "1,500" } },
            { finding: "bins", sort: "states", kind: "Step", read: "Time in state", refusal: { why: "empty" } },
            { finding: "bins", sort: "states", kind: "Step", read: "Time in state", refusal: { why: "number", edge: "∞" } },
        ]);
        expect(detailsCardOf(model.states!, "CH*")!.reads.map((read) => read.draws.kind)).toEqual(["noData", "noData", "noData"]);
    });
});

describe("bars and the axis (R26, R28)", () => {
    const edges = [0, 1, 2, 4];
    const counts = [2, 4, 1, 3];

    test("band, the default: a bar a bin, equal widths whatever its span, each as tall as its count against the card's tallest", () => {
        expect(barsOf({ edges, scale: "band" }, counts)).toEqual([
            { from: 0, to: 0.25, height: 0.5, count: 2 },
            { from: 0.25, to: 0.5, height: 1, count: 4 },
            { from: 0.5, to: 0.75, height: 0.25, count: 1 },
            { from: 0.75, to: 1, height: 0.75, count: 3 },
        ]);
    });

    test("linear: each bar as wide as its span and as tall as its count over it, so its area is its count — the open last bin as wide as the one before it", () => {
        const bars = barsOf({ edges, scale: "linear" }, counts);
        // Spans 1, 1, 2 and — open, as wide as the one before — 2: six across.
        [[0, 1], [1, 2], [2, 4], [4, 6]].forEach(([from, to], i) => {
            expect(bars[i]!.from * 6).toBeCloseTo(from!, 9);
            expect(bars[i]!.to * 6).toBeCloseTo(to!, 9);
        });
        expect(bars.map((bar) => bar.height)).toEqual([0.5, 1, 0.125, 0.375]);
        const areas = bars.map((bar) => (bar.to - bar.from) * bar.height * 24);
        areas.forEach((area, i) => expect(area).toBeCloseTo(counts[i]!, 9));
    });

    test("a duration's place across the axis: on a band axis as far across its bin as across its span, on a linear one to scale; under the first edge its start, past the end its end", () => {
        const band = { edges, scale: "band" as const };
        expect([-3, 0, 0.5, 1, 3, 4, 5, 6, 100].map((at) => axisAt(band, at))).toEqual([0, 0, 0.125, 0.25, 0.625, 0.75, 0.875, 1, 1]);
        const linear = { edges, scale: "linear" as const };
        expect([-3, 0, 3, 6, 9].map((at) => axisAt(linear, at))).toEqual([0, 0, 0.5, 1, 1]);
    });
});

describe("each card's size, as the visual spec draws it (R22, R29, R30, R33)", () => {
    const held = record(["CH*", SORT_CHUTES], ["HLD", HELD]);
    const kinds = statesOnly(wholeDetails(DEPOT_READS, () => some(held)));
    const drawn = drawnStates("CH*", "HLD", "LBL");

    /** The states' details as read. */
    function states() {
        const { result } = renderHook(() => useFlowchartDetails(kinds, drawn, 0));
        return modelOver(kinds, result.current, drawn).states!;
    }

    test("272 wide: its head, a rule, then each read 12 apart inside 12 of padding — 264 with a line of tags, 283 with two, 216 for a row there is none of", () => {
        const depot = states();
        const sort = detailsCardOf(depot, "CH*")!;
        expect([sort.width, sort.height]).toEqual([272, 264]);
        // Each read's block where the visual spec's DOM puts it: under the card's edge, its head, the rule and the padding.
        expect(sort.reads.map((read) => [read.top, read.height])).toEqual([[68, 16], [96, 15], [123, 62], [197, 54]]);
        const hold = detailsCardOf(depot, "HLD")!;
        expect(hold.height).toBe(283);
        expect(hold.reads[1]).toEqual({
            index: 1, top: 96, height: 34, column: 37,
            draws: { kind: "tags", lines: [["Hazmat", "At risk", "Customs"], ["Oversize", "Cold chain"]], rest: [] },
        });
        const none = detailsCardOf(depot, "LBL")!;
        expect(none.reads.map((read) => [read.draws.kind, read.height])).toEqual([["noData", 16], ["noData", 15], ["noData", 34], ["noData", 34]]);
        expect(none.height).toBe(216);
    });

    test("a list's top lines by value, ties in the row's order, each its share of the whole list; the tags in the order their looks are defined, then the row's", () => {
        const hold = detailsCardOf(states(), "HLD")!;
        expect(hold.reads[3]!.draws).toEqual({
            kind: "list", lines: [
                { name: "International", value: 539, share: 539 / 1080, note: undefined },
                { name: "Standard", value: 335, share: 335 / 1080, note: undefined },
            ],
        });
        expect(listLines([{ name: "Late", value: 2, note: none }, { name: "Early", value: 2, note: some("weekend") }, { name: "Night", value: 4, note: none }], 3)).toEqual([
            { name: "Night", value: 4, share: 0.5, note: undefined },
            { name: "Late", value: 2, share: 0.25, note: undefined },
            { name: "Early", value: 2, share: 0.25, note: "weekend" },
        ]);
    });

    test("tags wrap to three lines at most, then +n — a tag at a time leaving the third until the +n fits beside it", () => {
        const many = record(["HLD", bytesOf(
            variant("figure", some(1080)),
            variant("tags", ["Oversize", "Cold chain", "Fragile", "Late", "Return", "Signed", "Priority", "Weekend", "Remote", "Hazmat", "At risk", "Customs"]),
            histogram([0, 1]), list(["Standard", 1]),
        )]);
        const tagged = statesOnly(wholeDetails(DEPOT_READS, () => some(many)));
        const { result } = renderHook(() => useFlowchartDetails(tagged, drawnStates("HLD"), 0));
        const card = detailsCardOf(modelOver(tagged, result.current, drawnStates("HLD")).states!, "HLD")!;
        expect(card.reads[1]!.draws).toEqual({
            kind: "tags",
            lines: [["Hazmat", "At risk", "Customs"], ["Oversize", "Cold chain", "Fragile"], ["Late", "Return", "Signed"]],
            rest: ["Priority", "Weekend", "Remote"],
        });
        expect(card.reads[1]!.height).toBe(53);
        // Its list holds one item: one line under its title.
        expect(card.reads.map((read) => read.height)).toEqual([16, 53, 62, 34]);
        expect(card.height).toBe(282);
    });

    test("only the reads shown on the canvas size it: one shown in the inspector alone adds nothing, and with none on the canvas the card is today's", () => {
        const mixed = statesOnly(wholeDetails([all(PARCELS), inspectorOnly(SERVICE)], () => some(held)));
        const { result } = renderHook(() => useFlowchartDetails(mixed, drawnStates("CH*"), 0));
        const card = detailsCardOf(modelOver(mixed, result.current, drawnStates("CH*")).states!, "CH*")!;
        expect(card.reads.map((read) => read.index)).toEqual([0]);
        // Its edges, its head, the rule, a figure's line inside the padding.
        expect(card.height).toBe(1 + 54 + 1 + 12 + 16 + 12 + 1);
        const hidden = statesOnly(wholeDetails([inspectorOnly(PARCELS)], () => some(held)));
        const { result: none } = renderHook(() => useFlowchartDetails(hidden, drawnStates("CH*"), 0));
        expect(detailsCardOf(modelOver(hidden, none.current, drawnStates("CH*")).states!, "CH*")).toBeUndefined();
    });
});

describe("a transition label's lines (R32, R33, R34)", () => {
    /** A move's figure: the parcels it moved. */
    const MOVED: FlowchartReadValue = variant("figure", { label: "Moved", unit: some("parcels") });
    /** The moves' reads: the figure and the services on the label, the parcels in the inspector alone. */
    const READS: readonly Shown[] = [all(MOVED), inspectorOnly(PARCELS), all(SERVICE)];
    /** One move with every value, one lacking its figure and holding no service, and none for a third. */
    const MOVES = record(
        ["t1", bytesOf(variant("figure", some(4200)), variant("figure", some(1)), list(["Economy", 600], ["Standard", 2100], ["Priority", 1500]))],
        ["t2", bytesOf(variant("figure", none), variant("figure", none), list())],
    );
    /** The transitions' details alone. */
    const movesOnly = (details: FlowchartDetailsValue): FlowchartDetailsKinds => ({ states: undefined, transitions: { name: "Move", details } });
    const drawn: FlowchartDrawnKeys = { states: [], transitions: ["t1", "t2", "t3"] };

    /** The transitions' details as read. */
    function moves(kinds: FlowchartDetailsKinds) {
        const { result } = renderHook(() => useFlowchartDetails(kinds, drawn, 0));
        return modelOver(kinds, result.current, drawn).transitions!;
    }

    test("a figure a line and a list its top items by value, each its share of the whole list, in the details' order — a read in the inspector alone adds none; a figure the row lacks says no data, a list with no items none", () => {
        const read = moves(movesOnly(wholeDetails(READS, () => some(MOVES))));
        expect(detailsLabelOf(read, "t1")).toEqual([
            { kind: "figure", label: "Moved", value: 4200, unit: "parcels" },
            { kind: "item", name: "Standard", share: 0.5 },
            { kind: "item", name: "Priority", share: 1500 / 4200 },
        ]);
        expect(detailsLabelOf(read, "t2")).toEqual([{ kind: "figure", label: "Moved", value: undefined, unit: "parcels" }, { kind: "none" }]);
        // A row there is none of: no line, so its label is its evidence line alone.
        expect(detailsLabelOf(read, "t3")).toEqual([]);
    });

    test("while the row lands, each read's lines as placeholders — a list's its top — so the label is as tall as it will be; with no read on the canvas, no line", () => {
        const landing = moves(movesOnly(wholeDetails(READS, () => none)));
        expect(detailsLabelOf(landing, "t1")).toEqual([{ kind: "placeholder" }, { kind: "placeholder" }, { kind: "placeholder" }]);
        const hidden = moves(movesOnly(wholeDetails([inspectorOnly(MOVED)], () => some(MOVES))));
        expect(detailsLabelOf(hidden, "t1")).toEqual([]);
    });
});
