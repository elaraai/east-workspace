/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * What a group's own row counts of the events beneath it (#1716), worked out
 * with no read: the records a row counts — those whose kinds land on a series
 * nested in its own, by the fields their series index in time order files
 * their events under first, each the key of the step of the row's path it
 * names — and those it names on its hover instead; a row's narrowing, the
 * source's with its group chosen; the tile it reads a record's totals at, or
 * why it reads none; and the stores the canvas and its rows share. What it
 * reads and draws on e3 is `frame/plan-grouped-examples.dom.test.tsx`'s.
 */

import { describe, test, expect, vi } from "vitest";
import {
    ArrayType, DateTimeType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, toEastTypeValue,
    variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceWhereType, type RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { RecordSliceKeptCells } from "@elaraai/east-ui-components/internal";
import { planHideId } from "@elaraai/e3-ui/internal";
import {
    bandRead, bandWhere, createBandCountsStore, createBandSpanStore, planBandSources, readBandCounts, type PlanBandCounts, type PlanBandInView,
} from "./band-counts.js";
import type { PlanLandingValue } from "./landings.js";

type Kind = Parameters<typeof planBandSources>[1][number];
type Part = Parameters<typeof planBandSources>[3][number];
type Config = ValueTypeOf<typeof RecordSliceConfigType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = ValueTypeOf<typeof RecordSliceChoiceType>;

const compareString = compareFor(StringType);
const sameWhere = equalFor(RecordSliceWhereType);

/** A narrowing: each field's choice. */
const narrowing = (...choices: [string, Choice][]): Where => new SortedMap<string, Choice>(choices, compareString);
/** A choice of exact values, as `.east` literals. */
const values = (...literals: string[]): Choice => variant("values", literals);

// The print works' halls, as the grouped example nests them: the halls as rows beside the halls as groups (`floors`),
// each hall its folders and bays beside its lines, each line its guillotine beside its presses, each press its tasks.
const Inspection = StructType({ hall: StringType, start: DateTimeType, end: DateTimeType });
const Run = StructType({ hall: StringType, folder: StringType, title: StringType, start: DateTimeType, end: DateTimeType });
const Delivery = StructType({ hall: StringType, bay: StringType, at: DateTimeType });
const Job = StructType({ hall: StringType, line: StringType, press: StringType, task: StringType, start: DateTimeType, end: DateTimeType });
const Trim = StructType({ hall: StringType, line: StringType, guillotine: StringType, at: DateTimeType });

/** An event kind, as the payload carries what a row's counts read of it: its key, name and source, and its cells' type. */
const kind = (key: string, name: string, row: StructType, source = key): Kind =>
    ({ key, name, source, cellsType: toEastTypeValue(ArrayType(StructType({ key: StringType, row }))) }) as Kind;

/** A series kinds land on: what it nests in, outermost first, and how many steps its rows' paths hold. */
const landing = (key: string, kinds: string[], within: string[], depth: bigint, under?: string): PlanLandingValue => ({
    key, name: key, draws: [variant("span", null)], kinds, series: [], top: within.length === 0, under: under === undefined ? none : some(under), within, depth,
});

/** A record's indexes, as its source's config holds them. */
interface Indexes {
    /** Its series index's leading fields, its key, and its order. */
    readonly series: { readonly on: readonly string[]; readonly key: string; readonly order?: "time" | "key" };
    /** Its totals: each led by some fields, at a tile. */
    readonly totals: readonly (readonly [fields: readonly string[], tile: "day" | "week" | "month" | "quarter" | "year"])[];
}

/** A source's config over a record's indexes, the fields its page's scope holds among it: a decoded East value. */
function configOf({ series, totals }: Indexes, scope: Where = narrowing()): Config {
    const plain = { sets: new Set<string>(), structured: true, interval: none, area: none, series: none, summary: none, entries: false };
    const indexes = [
        { ...plain, name: "by_series", fields: [...series.on],
            series: some({ key: series.key, from: "start", to: "end", tile: variant("week", null), order: variant(series.order ?? "time", null), copy: false }) },
        ...totals.map(([fields, tile]) => ({ ...plain, name: `by_${fields.join("_")}_${tile}_totals`, fields: [...fields],
            summary: some(variant("totals", { from: "start", to: "end", tile: variant(tile, null) })) })),
    ];
    const config = { fields: [], indexes, range: some("start"), search: [], presets: [], scope };
    return decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)(config as never));
}

/** A kind narrowed through its source: its part's config, and the narrowing it reads now. */
const partOf = (of: Kind, indexes: Indexes, where: Where = narrowing(), scope?: Where): Part =>
    ({ kind: of, part: { key: `slice.${of.source}`, config: configOf(indexes, scope), read: () => ({ where }) } }) as unknown as Part;

const BY_HALL: Indexes = {
    series: { on: ["hall"], key: "folder" },
    totals: [[[], "month"], [["hall"], "day"], [["hall"], "week"], [["hall"], "month"]],
};
const BY_LINE: Indexes = {
    series: { on: ["hall", "line"], key: "press" },
    totals: [[[], "month"], [["hall"], "day"], [["hall"], "week"], [["hall"], "month"], [["hall", "line"], "day"], [["hall", "line"], "week"]],
};

const INSPECTION = kind("inspection", "Inspection", Inspection);
const FOLDING = kind("folding", "Folding run", Run);
const DELIVERY = kind("delivery", "Paper delivery", Delivery);
const JOB = kind("job", "Print job", Job);
const TRIM = kind("trim", "Trim", Trim);
const KINDS = [INSPECTION, FOLDING, DELIVERY, JOB, TRIM];

/** The series the kinds land on: the halls' own rows at the top, and every series nested in the halls as groups. */
const landings = ({ bays = ["floors"] }: { bays?: string[] } = {}): PlanLandingValue[] => [
    landing("halls", ["inspection"], [], 1n),
    landing("folders", ["folding"], ["floors"], 2n),
    landing("bays", ["delivery"], bays, 2n),
    landing("guillotines", ["trim"], ["floors", "lines"], 3n),
    landing("presses", [], ["floors", "lines"], 3n),
    landing("tasks", ["job"], ["floors", "lines", "presses"], 4n, "presses"),
];

const PARTS = [
    partOf(INSPECTION, { series: { on: [], key: "hall", order: "key" }, totals: [[[], "month"]] }),
    partOf(FOLDING, BY_HALL),
    partOf(DELIVERY, { ...BY_HALL, series: { on: ["hall"], key: "bay" } }),
    partOf(JOB, BY_LINE),
    partOf(TRIM, { ...BY_LINE, series: { on: ["hall", "line"], key: "guillotine" } }),
];

/** A group's own row in view, by its series and its path. */
const band = (series: string, ...path: string[]): PlanBandInView => ({ key: `${series}:${path.join("/")}`, series, path });

/** What a row's plan names of each record it counts: its source, its kinds' names, the hidden among them, and its choices. */
const counted = (plan: ReturnType<typeof planBandSources>) => plan.sources.map((s) => ({ source: s.source, names: s.names, hidden: s.hidden, choices: s.choices }));

const HALL = (key: string) => ({ field: "hall", literal: `"${key}"` });
const LINE = (key: string) => ({ field: "line", literal: `"${key}"` });

describe("the records a group's own row counts (#1716)", () => {
    test("a hall's row: each record whose kinds land on a series nested in its own, by the field its series index files them under first — the hall's key — and none of the halls' own rows beside the groups", () => {
        const plan = planBandSources(band("floors", "H-101"), KINDS, landings(), PARTS, []);
        expect(counted(plan)).toEqual([
            { source: "folding", names: ["Folding run"], hidden: [], choices: [HALL("H-101")] },
            { source: "delivery", names: ["Paper delivery"], hidden: [], choices: [HALL("H-101")] },
            { source: "trim", names: ["Trim"], hidden: [], choices: [HALL("H-101")] },
            { source: "job", names: ["Print job"], hidden: [], choices: [HALL("H-101")] },
        ]);
        // The inspections land on the halls' own rows, beside the groups: beneath none, so named nowhere.
        expect(plan.uncounted).toEqual([]);
    });

    test("a line's row: the records landing beneath the line, by the hall and the line, outermost first", () => {
        const plan = planBandSources(band("lines", "H-101", "L-101-1"), KINDS, landings(), PARTS, []);
        expect(counted(plan)).toEqual([
            { source: "trim", names: ["Trim"], hidden: [], choices: [HALL("H-101"), LINE("L-101-1")] },
            { source: "job", names: ["Print job"], hidden: [], choices: [HALL("H-101"), LINE("L-101-1")] },
        ]);
    });

    test("a section's header inside a group counts the records landing within the section alone, by the group's fields; one at the top counts nothing", () => {
        const sections = landings({ bays: ["floors", "loading"] });
        expect(counted(planBandSources(band("loading", "H-101"), KINDS, sections, PARTS, []))).toEqual([
            { source: "delivery", names: ["Paper delivery"], hidden: [], choices: [HALL("H-101")] },
        ]);
        // The hall's own row still counts the deliveries beneath the section, beside the rest.
        expect(counted(planBandSources(band("floors", "H-101"), KINDS, sections, PARTS, [])).map((s) => s.source)).toEqual(["folding", "delivery", "trim", "job"]);
        // At the top a section's rows span every window: it counts nothing, and names nothing.
        expect(planBandSources(band("loading"), KINDS, sections, PARTS, [])).toEqual({ sources: [], uncounted: [] });
    });

    test("a record whose source keeps no totals led by the group's fields, or reads its events through no series index in time order, is named with the fields — never counted", () => {
        const parts = [
            ...PARTS.filter((p) => p.kind.key !== "job" && p.kind.key !== "folding"),
            partOf(JOB, { ...BY_LINE, totals: [[[], "month"]] }),
            partOf(FOLDING, { ...BY_HALL, series: { on: ["hall"], key: "folder", order: "key" } }),
        ];
        const plan = planBandSources(band("floors", "H-101"), KINDS, landings(), parts, []);
        expect(plan.sources.map((s) => s.source)).toEqual(["delivery", "trim"]);
        expect(plan.uncounted).toEqual([
            // In key order: no field of its index stands for the rows above its resources.
            { names: "Folding run", why: "totals", fields: [] },
            { names: "Print job", why: "totals", fields: ["hall"] },
        ]);
    });

    test("a kind the viewer hides is counted while another of its record's shows, and named hidden; a record every kind of which is hidden, or on a series hidden, is counted nowhere", () => {
        // A second kind of the jobs' record, on the same tasks: the reworks, read through the jobs' source.
        const rework = kind("rework", "Rework", Job, "job");
        const kinds = [...KINDS, rework];
        const withRework = landings().map((one) => (one.key === "tasks" ? { ...one, kinds: ["job", "rework"] } : one));
        const parts = [...PARTS, partOf(rework, BY_LINE)];
        const job = (hidden: string[]) => counted(planBandSources(band("floors", "H-101"), kinds, withRework, parts, hidden)).find((s) => s.source === "job");
        expect(job([])).toEqual({ source: "job", names: ["Print job", "Rework"], hidden: [], choices: [HALL("H-101")] });
        expect(job([planHideId.events("rework")])).toEqual({ source: "job", names: ["Print job"], hidden: ["Rework"], choices: [HALL("H-101")] });
        expect(job([planHideId.events("rework"), planHideId.events("job")])).toBeUndefined();
        // The bays' series hidden: the deliveries land nowhere the canvas draws.
        const shown = planBandSources(band("floors", "H-101"), kinds, withRework, parts, [planHideId.series("bays")]);
        expect(shown.sources.map((s) => s.source)).toEqual(["folding", "trim", "job"]);
        expect(shown.uncounted).toEqual([]);
    });
});

describe("a row's narrowing, and the totals it reads (#1716)", () => {
    /** The window's range of the runs' start, the rail's own. */
    const WINDOW = variant("range", { from: "2026-10-05T00:00:00.000", to: "2026-11-02T00:00:00.000" }) as Choice;
    /** Whether a read is of these totals' tile, under this narrowing. */
    const readsAt = (read: ReturnType<typeof bandRead>, tile: string, where: Where) => "tile" in read && read.tile === tile && sameWhere(read.where, where);

    test("the source's narrowing with the group's fields chosen as its keys; where the rail chooses values of one, the key among them alone, or none of the row's; any other choice of it unanswerable", () => {
        const chosen = (where: Where) => bandWhere(where, [HALL("H-101")]);
        const was = narrowing(["start", WINDOW]);
        expect(sameWhere(chosen(was) as Where, narrowing(["hall", values('"H-101"')], ["start", WINDOW]))).toBe(true);
        // Two halls chosen on the rail: the row's alone.
        expect(sameWhere(chosen(narrowing(["hall", values('"H-101"', '"H-102"')])) as Where, narrowing(["hall", values('"H-101"')]))).toBe(true);
        // Another hall chosen: none of the row's events.
        expect(chosen(narrowing(["hall", values('"H-102"')]))).toBe("none");
        expect(chosen(narrowing(["hall", variant("prefix", "H-1")]))).toBeUndefined();
        // The narrowing the source holds is never changed.
        expect(sameWhere(was, narrowing(["start", WINDOW]))).toBe(true);
    });

    test("at the largest tile dividing the columns that the record keeps totals led by the group's fields at, the window's own range no filter", () => {
        const config = configOf(BY_HALL);
        expect(readsAt(bandRead(config, narrowing(["start", WINDOW]), [HALL("H-101")], ["week", "day"]), "week",
            narrowing(["hall", values('"H-101"')], ["start", WINDOW]))).toBe(true);
        // A record that keeps them a day alone: read a day at a time.
        const daily = configOf({ ...BY_HALL, totals: [[["hall"], "day"]] });
        expect(readsAt(bandRead(daily, narrowing(), [HALL("H-101")], ["week", "day"]), "day", narrowing(["hall", values('"H-101"')]))).toBe(true);
        // The rail choosing another hall: nothing to read.
        expect(bandRead(config, narrowing(["hall", values('"H-102"')]), [HALL("H-101")], ["week", "day"])).toEqual({ none: true });
    });

    test("why it reads none: the filters, which the totals cannot answer; the zoom, at which none is kept; or no totals led by the group's fields at all", () => {
        // A rail filter of the runs' title, which leads no totals: counting would leave it out.
        expect(bandRead(configOf(BY_HALL), narrowing(["title", values('"Fold: Labels"')]), [HALL("H-101")], ["week", "day"])).toEqual({ why: "filters" });
        // Kept a month at a time, and the columns a week's: no month divides them.
        expect(bandRead(configOf({ ...BY_HALL, totals: [[["hall"], "month"]] }), narrowing(), [HALL("H-101")], ["week", "day"])).toEqual({ why: "zoom" });
        // A hall's row over totals led by the hall and the line alone: none led by the hall.
        expect(bandRead(configOf({ ...BY_LINE, totals: [[["hall", "line"], "day"]] }), narrowing(), [HALL("H-101")], ["day"])).toEqual({ why: "totals" });
    });

    test("on a scoped page, the scope's choices held to: totals led by the scope's fields and the group's serve it, and a filter beside them is still the filters'", () => {
        const scope = narrowing(["site", values('"S-1"')]);
        const config = configOf({ series: { on: ["site", "hall"], key: "folder" }, totals: [[["site", "hall"], "day"]] }, scope);
        expect(readsAt(bandRead(config, narrowing(["site", values('"S-1"')]), [HALL("H-101")], ["day"]), "day",
            narrowing(["hall", values('"H-101"')], ["site", values('"S-1"')]))).toBe(true);
        expect(bandRead(config, narrowing(["site", values('"S-1"')], ["title", values('"Fold: Labels"')]), [HALL("H-101")], ["day"])).toEqual({ why: "filters" });
    });
});

describe("a row's counts with nothing to read (#1716)", () => {
    test("a row whose records its filters leave unanswered draws no column, and names each with why; a row that counts nothing is left out", () => {
        const filtered = [
            ...PARTS.filter((p) => p.kind.key !== "folding"),
            partOf(FOLDING, BY_HALL, narrowing(["title", values('"Fold: Labels"')])),
        ];
        const rows = [band("floors", "H-101"), band("loading")];
        const plans = [
            { sources: planBandSources(rows[0]!, [FOLDING], landings(), filtered, []).sources, uncounted: [] },
            planBandSources(rows[1]!, KINDS, landings({ bays: ["floors", "loading"] }), filtered, []),
        ];
        const day = { start: Date.UTC(2026, 9, 5), end: Date.UTC(2026, 9, 6) };
        const over = { from: new Date(Date.UTC(2026, 9, 1)), to: new Date(Date.UTC(2026, 10, 1)) };
        const counts = readBandCounts(rows, plans, "day", [day], over, new RecordSliceKeptCells(), "test");
        expect(counts).not.toBe("reading");
        const held = counts as Map<string, PlanBandCounts>;
        expect([...held.keys()]).toEqual([rows[0]!.key]);
        expect(held.get(rows[0]!.key)).toEqual({
            columns: [], top: 0, hidden: [], period: "day",
            uncounted: [{ names: "Folding run", why: "filters", fields: ["hall"] }],
        });
    });
});

describe("the stores the canvas and its group rows share (#1716)", () => {
    test("the rows in view tell their listeners only of rows that move; the counts, only of a new hand-over", () => {
        const spans = createBandSpanStore();
        const heard = vi.fn();
        const stop = spans.subscribe(heard);
        expect(spans.get()).toEqual([]);
        spans.set([band("floors", "H-101"), band("lines", "H-101", "L-101-1")]);
        spans.set([band("floors", "H-101"), band("lines", "H-101", "L-101-1")]);
        expect(heard).toHaveBeenCalledTimes(1);
        spans.set([band("floors", "H-102")]);
        expect(heard).toHaveBeenCalledTimes(2);
        stop();
        spans.set([]);
        expect(heard).toHaveBeenCalledTimes(2);

        const counts = createBandCountsStore();
        const told = vi.fn();
        counts.subscribe(told);
        const one = new Map<string, PlanBandCounts>([["floors:H-101", { columns: [], top: 0, uncounted: [], hidden: [], period: "day" }]]);
        counts.set(one);
        counts.set(one);
        expect(told).toHaveBeenCalledTimes(1);
        expect(counts.get("floors:H-101")).toBe(one.get("floors:H-101"));
        expect(counts.get("floors:H-102")).toBeUndefined();
    });
});
