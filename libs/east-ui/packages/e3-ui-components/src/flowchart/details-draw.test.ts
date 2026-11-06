/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Pure; the flowchart's modules load east-ui-components' entry, which needs a
 * DOM as it loads.
 */

/**
 * What the canvas draws of the details beside its cards (#1510, `Flowchart
 * Records Spec.md` R30, R31, §4), over details as the payload decodes them and
 * rows as the app's bytes decode: a tag's look; the legend's rows for the
 * reads the cards and labels draw, in the details' order, and its groups of
 * the defined tags the cards show; the legend's height; and the words the
 * canvas measures as a card draws them.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { decodeBeast2For, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import {
    ESTIMATED_TEXT, flowchartDetailsModel,
    type FlowchartDetailRowValue, type FlowchartDetailsKinds, type FlowchartDetailsModel, type FlowchartDetailsRead, type FlowchartDetailsValue,
    type FlowchartReadValue, type FlowchartTagColors, type FlowchartTextMeasure,
} from "./details.js";
import { NO_LEGEND, NO_PROBE, legendHeight, legendOf, probeTextsOf, tagLookOf, type FlowchartLegendGroup, type FlowchartLegendRead } from "./details-draw.js";
import { words } from "./rows.test-utils.js";

const encodeRow = encodeBeast2For(Flowchart.Types.DetailRow);
const decodeRow = decodeBeast2For(Flowchart.Types.DetailRow);

/** One read in the details' order, and where it shows. */
type Shown = FlowchartDetailsValue["reads"][number];

/** A read on the canvas and in the inspector — the default. */
const all = (read: FlowchartReadValue): Shown => ({ show: variant("all", null), read });
/** A read in the inspector alone. */
const inspectorOnly = (read: FlowchartReadValue): Shown => ({ show: variant("inspector", null), read });

/** A row as the app's bytes decode: one value a read. */
const rowOf = (...values: FlowchartDetailRowValue): FlowchartDetailRowValue => decodeRow(encodeRow(values));
/** A row's tags. */
const tags = (...given: string[]) => variant("tags", given);
/** A row's figure. */
const figure = (n: number) => variant("figure", some(n));
/** A row's histogram, each count at its edge. */
const histogram = (...bins: readonly (readonly [from: number, count: number])[]) => variant("histogram", bins.map(([from, count]) => ({ from, count })));
/** A row's list, by name. */
const list = (...items: readonly (readonly [name: string, value: number])[]) => variant("list", items.map(([name, value]) => ({ name, value, note: none })));

/** One kind as given: its reads, the keys drawn, and the rows landed — `null` for a key the details hold no row of; a key drawn but absent has not landed. */
interface KindGiven {
    readonly reads: readonly Shown[];
    readonly drawn: readonly string[];
    readonly rows: readonly (readonly [key: string, row: FlowchartDetailRowValue | null])[];
}

/** The details model over each kind given, read by key as the depot's are, every read settled. */
function modelOver(states: KindGiven | undefined, transitions?: KindGiven): FlowchartDetailsModel {
    const details = (given: KindGiven): FlowchartDetailsValue => ({ reads: [...given.reads], rows: none, paged: some("depot-details"), values: (bytes) => decodeRow(bytes), weighed: none });
    const kinds: FlowchartDetailsKinds = {
        states: states === undefined ? undefined : { name: "Step", details: details(states) },
        transitions: transitions === undefined ? undefined : { name: "Move", details: details(transitions) },
    };
    const read = (given: KindGiven | undefined): FlowchartDetailsRead | undefined =>
        (given === undefined ? undefined : { rows: new Map(given.rows), reading: false, error: undefined });
    return flowchartDetailsModel(kinds, { states: read(states), transitions: read(transitions) }, { states: states?.drawn ?? [], transitions: transitions?.drawn ?? [] }, words);
}

// ── The depot's reads ─────────────────────────────────────────────────────

/** The parcels a state holds. */
const PARCELS: FlowchartReadValue = variant("figure", { label: "Parcels", unit: some("parcels") });
/** The parcels still in it: the inspector's alone. */
const WAITING: FlowchartReadValue = variant("figure", { label: "Still in state", unit: none });

/** Its flags in the legend: four given looks, At risk named twice — the first naming it its look. */
const FLAG_COLORS: FlowchartTagColors = [
    { tag: "Hazmat", colorPalette: variant("danger", null), variant: variant("solid", null) },
    { tag: "At risk", colorPalette: variant("warning", null), variant: variant("subtle", null) },
    { tag: "Customs", colorPalette: variant("brand", null), variant: variant("outline", null) },
    { tag: "Oversize", colorPalette: variant("orange", null), variant: variant("subtle", null) },
    { tag: "At risk", colorPalette: variant("danger", null), variant: variant("solid", null) },
];
const FLAGS: FlowchartReadValue = variant("tags", { label: "Flags", colors: FLAG_COLORS, legend: true });
/** Its equipment in the legend: the one look given, Forklift's, a tag no card shows. */
const EQUIPMENT: FlowchartReadValue = variant("tags", {
    label: "Equipment", colors: [{ tag: "Forklift", colorPalette: variant("gray", null), variant: variant("outline", null) }], legend: true,
});
/** Its shifts, not in the legend. */
const SHIFTS: FlowchartReadValue = variant("tags", {
    label: "Shifts", colors: [{ tag: "Night", colorPalette: variant("purple", null), variant: variant("solid", null) }], legend: false,
});
/** Its handling, in the legend but drawn in the inspector alone. */
const HANDLING: FlowchartReadValue = variant("tags", {
    label: "Handling", colors: [{ tag: "Fragile", colorPalette: variant("purple", null), variant: variant("subtle", null) }], legend: true,
});

/** Its time in state, in hours, on a band axis: the app's bins, or none — every row's edges merged. */
function timeInState(bins: readonly number[] | undefined, unit: "minutes" | "hours" = "hours", linear = false): FlowchartReadValue {
    return variant("histogram", {
        label: "Time in state", unit: variant(unit, null), counts: some("parcels"),
        bins: bins === undefined ? none : some([...bins]), scale: linear ? variant("linear", null) : variant("band", null), ticks: none,
    });
}
/** The app's bins for time in state: under an hour, to 12h, to 2d, to a week, and a week or more. */
const HOURS = [0, 1, 12, 48, 168];

/** Its services, the top two on a card. */
const SERVICE: FlowchartReadValue = variant("list", { label: "Service", unit: some("parcels"), top: 2n });
/** Its exceptions, the inspector's alone. */
const EXCEPTIONS: FlowchartReadValue = variant("list", { label: "Exceptions", unit: some("parcels"), top: 3n });

/** The states' nine reads, in the details' order: five on the cards, four tag lists among them, and four in the inspector alone. */
const STATE_READS: readonly Shown[] = [
    all(PARCELS), inspectorOnly(WAITING), all(FLAGS), all(EQUIPMENT), all(SHIFTS), inspectorOnly(HANDLING),
    all(timeInState(HOURS)), all(SERVICE), inspectorOnly(EXCEPTIONS),
];

/** Sort chutes: at risk, on the conveyor, every shift. */
const SORT_CHUTES = rowOf(
    figure(18290), figure(140), tags("At risk"), tags("Conveyor"), tags("Early", "Late", "Night", "Weekend"), tags("Fragile"),
    histogram([0, 9000], [1, 6000], [12, 2500], [48, 700], [168, 90]), list(["Standard", 10425], ["Priority", 4390]), list(["Missort", 41]),
);
/** Held: four flags, one no look names; no equipment; five handling tags the inspector alone draws. */
const HELD = rowOf(
    figure(1080), figure(40), tags("Oversize", "Hazmat", "Unlisted", "At risk"), tags(), tags("Late"), tags("Fragile", "Heavy", "Bulky", "Wide", "Long"),
    histogram([0, 20], [1, 140], [12, 420], [48, 380], [168, 120]), list(["International", 539], ["Standard", 335]), list(),
);

/** The depot's states drawn: sort chutes and held landed, DSP no row of, ARV not landed. */
const DEPOT_STATES: KindGiven = { reads: STATE_READS, drawn: ["ARV", "CH*", "DSP", "HLD"], rows: [["CH*", SORT_CHUTES], ["DSP", null], ["HLD", HELD]] };

/** The parcels a move moved. */
const MOVED: FlowchartReadValue = variant("figure", { label: "Moved", unit: some("parcels") });
/** Its region, the top one under its evidence. */
const REGION: FlowchartReadValue = variant("list", { label: "Region", unit: some("parcels"), top: 1n });
/** Its origins, the inspector's alone. */
const ORIGINS: FlowchartReadValue = variant("list", { label: "Origin", unit: some("parcels"), top: 3n });

/** The depot's transitions: a figure and the region on the labels, the origins in the inspector alone. */
const DEPOT_MOVES: KindGiven = {
    reads: [all(MOVED), all(REGION), inspectorOnly(ORIGINS)], drawn: ["l1"],
    rows: [["l1", rowOf(figure(18460), list(["Metro", 8491], ["Regional", 6092]), list(["Air hub", 5350]))]],
};

// ============================================================================
// A tag's look (R30)
// ============================================================================

describe("a tag's look (R30)", () => {
    test("subtle — the default — in a palette a wash of it; subtle in gray or neutral, and a tag no definition names, the neutral look; any other variant the Tag recipe's in its definition's palette, gray's too; the first definition naming a tag decides", () => {
        const colors: FlowchartTagColors = [
            ...FLAG_COLORS,
            { tag: "Weekend", colorPalette: variant("gray", null), variant: variant("subtle", null) },
            { tag: "Spare", colorPalette: variant("neutral", null), variant: variant("subtle", null) },
            { tag: "Forklift", colorPalette: variant("gray", null), variant: variant("outline", null) },
            { tag: "Night", colorPalette: variant("purple", null), variant: variant("solid", null) },
        ];
        expect(["At risk", "Oversize", "Weekend", "Spare", "Unlisted", "Hazmat", "Customs", "Forklift", "Night"].map((tag) => tagLookOf(colors, tag))).toEqual([
            { look: "wash", palette: "warning" },
            { look: "wash", palette: "orange" },
            { look: "neutral" },
            { look: "neutral" },
            { look: "neutral" },
            { look: "recipe", palette: "danger", variant: "solid" },
            { look: "recipe", palette: "brand", variant: "outline" },
            { look: "recipe", palette: "gray", variant: "outline" },
            { look: "recipe", palette: "purple", variant: "solid" },
        ]);
        // With no looks at all, every tag is neutral.
        expect(tagLookOf([], "Hazmat")).toEqual({ look: "neutral" });
    });
});

// ============================================================================
// The legend (R31, §4)
// ============================================================================

describe("the legend (R31, §4)", () => {
    test("a row for each figure, histogram and list the cards and labels draw, in the details' order — the states', then the transitions' — each its mark and its words; a tag list adds none, nor a read in the inspector alone", () => {
        const legend = legendOf(modelOver(DEPOT_STATES, DEPOT_MOVES), words);
        expect(legend.reads).toEqual<FlowchartLegendRead[]>([
            { key: "states:0", mark: "figure", text: "Parcels · a figure on each card" },
            { key: "states:6", mark: "bars", text: "Time in state · 0 to 1w+, a bar a bin" },
            { key: "states:7", mark: "lines", text: "Service · top 2, by share" },
            { key: "transitions:0", mark: "label", text: "Moved · a figure under the evidence" },
            { key: "transitions:1", mark: "label", text: "Region · top 1, under the evidence" },
        ]);
    });

    test("beside them a group for each tag list on the cards it lists: its label, then the defined tags the cards show, in the order defined, each once in its look — a tag no definition names left out, and a group whose tags no card shows yet its label alone", () => {
        const legend = legendOf(modelOver(DEPOT_STATES, DEPOT_MOVES), words);
        // Customs no card shows, Unlisted no definition names; Equipment's one look no card shows, so it is its label
        // alone; Shifts is not in the legend, and Handling is drawn in the inspector alone.
        expect(legend.groups).toEqual<FlowchartLegendGroup[]>([{
            key: "tags:2", label: "Flags", tags: [
                { tag: "Hazmat", look: { look: "recipe", palette: "danger", variant: "solid" } },
                { tag: "At risk", look: { look: "wash", palette: "warning" } },
                { tag: "Oversize", look: { look: "wash", palette: "orange" } },
            ],
        }, { key: "tags:3", label: "Equipment", tags: [] }]);
        // Before any row lands, the cards show no tag: each group its label alone.
        expect(legendOf(modelOver({ ...DEPOT_STATES, rows: [] }), words).groups).toEqual<FlowchartLegendGroup[]>([
            { key: "tags:2", label: "Flags", tags: [] },
            { key: "tags:3", label: "Equipment", tags: [] },
        ]);
    });

    test("a histogram's row names its span from the first edge to the last, open past it — one edge alone open past it, none or bins refused no span — and the scale: a bar a bin, or to scale", () => {
        const row = (read: FlowchartReadValue, rows: KindGiven["rows"] = []) => legendOf(modelOver({ reads: [all(read)], drawn: ["CH*"], rows }), words).reads[0]?.text;
        expect([
            row(timeInState([0, 60, 240, 1440], "minutes", true)),
            row(timeInState([4])),
            // No bins given: every drawn row's edges merged — none before a row lands.
            row(timeInState(undefined), [["CH*", rowOf(histogram([0, 5], [2, 3], [8, 1]))]]),
            row(timeInState(undefined)),
            // Bins the app binds that are refused: Issues lists them, and the row names no span.
            row(timeInState([0, 12, 12])),
        ]).toEqual([
            "Time in state · 0 to 1d+, to scale",
            "Time in state · 4h+, a bar a bin",
            "Time in state · 0 to 8h+, a bar a bin",
            "Time in state · a bar a bin",
            "Time in state · a bar a bin",
        ]);
    });

    test("with no read on the canvas — the details in the inspector alone, or no details — the legend draws today's rows alone", () => {
        const hidden: KindGiven = { reads: [inspectorOnly(PARCELS), inspectorOnly(FLAGS)], drawn: ["CH*"], rows: [["CH*", rowOf(figure(1), tags("Hazmat"))]] };
        expect(legendOf(modelOver(hidden, hidden), words)).toBe(NO_LEGEND);
        expect(legendOf(modelOver(undefined), words)).toBe(NO_LEGEND);
    });

    test("its height: its rows' column — its title, then 22 a row, today's four and one a read — or its groups' column — each its title, then its tags across 236, 15 a line and 4 between, one over another 12 apart — whichever is taller, in its padding and its rule, rounded up", () => {
        /** Every tag as wide as given. */
        const wide = (px: number): FlowchartTextMeasure => ({ label: () => 0, tag: () => px });
        /** A group of `n` tags. */
        const group = (n: number): FlowchartLegendGroup => ({ key: "tags:2", label: "Flags", tags: Array.from({ length: n }, (_, i) => ({ tag: `Tag ${i}`, look: { look: "neutral" } })) });
        const read: FlowchartLegendRead = { key: "states:0", mark: "figure", text: "Parcels · a figure on each card" };
        // Today's rows alone, in 10 of padding above and below and a 1px rule either side.
        expect(legendHeight(NO_LEGEND, ESTIMATED_TEXT)).toBe(Math.ceil(11.25 + 4 * 22 + 22));
        expect(legendHeight({ reads: [read, read], groups: [] }, ESTIMATED_TEXT)).toBe(Math.ceil(11.25 + 6 * 22 + 22));
        // Two tags 116 wide fit 236 with the 4 between them, two 117 wide don't: eight tags take four lines, or eight.
        expect(legendHeight({ reads: [], groups: [group(8)] }, wide(116))).toBe(Math.ceil(11.25 + 4 * 22 + 22));
        expect(legendHeight({ reads: [], groups: [group(8)] }, wide(117))).toBe(Math.ceil(11.25 + 4 + 8 * 15 + 7 * 4 + 22));
        // The groups stand one over another, 12 apart: two tags on a line over ten in five lines, past today's rows, though
        // neither alone is; ten in five lines alone, under a column of seven.
        expect(legendHeight({ reads: [], groups: [group(2), group(10)] }, wide(116))).toBe(Math.ceil((11.25 + 4 + 15) + 12 + (11.25 + 4 + 5 * 15 + 4 * 4) + 22));
        expect(legendHeight({ reads: [read, read, read], groups: [group(10)] }, wide(116))).toBe(Math.ceil(11.25 + 7 * 22 + 22));
        // The depot's own: five rows beside a group of three tags on a line over one with none yet, its title alone.
        expect(legendHeight(legendOf(modelOver(DEPOT_STATES, DEPOT_MOVES), words), ESTIMATED_TEXT)).toBe(Math.ceil(11.25 + 9 * 22 + 22));
    });
});

// ============================================================================
// The words the canvas measures (#1510)
// ============================================================================

describe("the words the canvas measures as a card draws them", () => {
    test("each tag list's label on the cards, each tag a landed row holds there, and each +n a list of them may end in — every word once; a list in the inspector alone adds none", () => {
        // Handling's five tags are the inspector's: the most a card's list holds is Shifts' four.
        expect(probeTextsOf(modelOver(DEPOT_STATES).states, words)).toEqual({
            labels: ["Equipment", "Flags", "Shifts"],
            tags: ["+1", "+2", "+3", "+4", "At risk", "Conveyor", "Early", "Hazmat", "Late", "Night", "Oversize", "Unlisted", "Weekend"],
        });
        // Before any row lands, the labels alone: the label column is measured before the card draws its tags.
        expect(probeTextsOf(modelOver({ ...DEPOT_STATES, rows: [] }).states, words)).toEqual({ labels: ["Equipment", "Flags", "Shifts"], tags: [] });
    });

    test("nothing to measure with no tag list on the cards: no details, none on the canvas, or no tag list among them", () => {
        expect(probeTextsOf(undefined, words)).toBe(NO_PROBE);
        const hidden: KindGiven = { reads: [inspectorOnly(FLAGS)], drawn: ["CH*"], rows: [["CH*", rowOf(tags("Hazmat"))]] };
        expect(probeTextsOf(modelOver(hidden).states, words)).toBe(NO_PROBE);
        const untagged: KindGiven = { reads: [all(PARCELS), all(SERVICE)], drawn: ["CH*"], rows: [["CH*", rowOf(figure(1), list(["Standard", 1]))]] };
        expect(probeTextsOf(modelOver(untagged).states, words)).toBe(NO_PROBE);
    });
});
