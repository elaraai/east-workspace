/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the queue's words load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * An Allocation target's crop, worked out (#1453, `Decision Queue Spec.md` D8,
 * P4, P13–P16, P24, P25) over days of its own, their loads and their checks
 * e3-ui's own, compiled: the resources a change's bins land on and the waiting
 * row they leave or go back to, each lane's load before → after in its tone,
 * the resources' other bins and jobs as they stand, a breach the board's check
 * says, and the sentence's clauses; and past two lanes the board's map, from
 * what the crop counts each resource takes and loses.
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, NullType, SortedMap, StringType, compareFor, equalFor, none, printFor, some, toEastTypeValue, variant } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { allocationDomain, allocationWords, type ArrivalRow, type Bin, type Context, type Day, type ResourceRow } from "../../allocation/model.js";
import { decisionQueueMessages as m, type DecisionQueueWords } from "../messages.js";
import { WAITING, allocationCrop, type AllocationCropBin, type AllocationCropInput, type AllocationCropPlan } from "./allocation-model.js";
import { mapSentence } from "./lanes.js";
import type { LanesModel } from "./lanes-model.js";
import { CROP_LANES, lanesMap } from "./map-model.js";

const byString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const printDay = printFor(DateTimeType);
/** A day from Tue 11 Mar 2031, at a time of it. */
const on = (n: number, h = 0, min = 0) => new Date(Date.UTC(2031, 2, 11 + n, h, min));

const arrival = (key: string, quantity: number, window: [Date, Date] | undefined): ArrivalRow => ({
    key, label: key, meta: none, quantity, hold: variant("days", 9), kind: none, due: none,
    window: window === undefined ? none : some({ from: window[0], to: window[1] }), details: [],
}) as unknown as ArrivalRow;
const resource = (key: string, min: number, max: number, jobs: { label: string; start: Date; end: Date }[]): ResourceRow => ({
    key, label: key, group: none, meta: none, note: none, min, max, hold: variant("days", 8), jobs,
}) as unknown as ResourceRow;
/** A bin booking an arrival — none, for a reservation — held some days, its parts on resources. */
const bin = (when: Date, of: string | undefined, quantity: number, days: number, parts: [string, number][]): Bin => ({
    lane: "L-1", at: when, arrival: of === undefined ? none : some(of), quantity, kind: none, hold: variant("days", days),
    parts: new SortedMap(parts, byString), row: null,
}) as unknown as Bin;

// R-1 takes 4–10, its last job ending as Tue 11 starts and its next planned from Thu 20; R-2 takes 10–20 and has none.
const RESOURCES = [
    resource("R-1", 4, 10, [{ label: "J-1", start: on(-13), end: on(0) }, { label: "planned", start: on(9), end: on(17) }]),
    resource("R-2", 10, 20, []),
];
const CONTEXT = {
    lanes: [{ key: "L-1", label: "L-1", offset: variant("minutes", 15) }],
    every: variant("hours", 1),
    arrivals: new SortedMap([["E-1", arrival("E-1", 8, [on(-1), on(2)])], ["E-2", arrival("E-2", 4, undefined)]], byString),
    resources: new SortedMap(RESOURCES.map(r => [r.key, r] as [string, ResourceRow]), byString),
    rules: { under: true }, unit: "m³",
} as unknown as Context;

// E-1's 8 m³ booked into R-1 at 14:15, held its nine days from the day.
const BOOKED = bin(on(0, 14, 15), "E-1", 8, 9, [["R-1", 8]]);
// E-2's 4 m³ at 06:15, held seven days: in R-2, or in R-1.
const IN_R2 = bin(on(0, 6, 15), "E-2", 4, 7, [["R-2", 4]]);
const IN_R1 = bin(on(0, 6, 15), "E-2", 4, 7, [["R-1", 4]]);

const domain = allocationDomain(toEastTypeValue(NullType));
/** A day of bins as the board assembles it: its loads and its checks, e3-ui's own. */
function planOf(day: Date, bins: [string, Bin][]): AllocationCropPlan {
    const plan = { status: variant("draft", null), bins: new SortedMap(bins, byString) } as unknown as Day;
    return { bins: plan.bins, loads: domain.loads(day, plan, CONTEXT), issues: domain.check(day, plan, CONTEXT) };
}
/** The crop of a change over Tue 11, marked, nothing knocked on, locked or shared but as given. */
const crop = (bins: readonly AllocationCropBin[], before: [string, Bin][], after: [string, Bin][], rest: Partial<AllocationCropInput> = {}): LanesModel => allocationCrop({
    bins, days: [{ day: on(0), before: planOf(on(0), before), after: planOf(on(0), after) }], lands: new SortedMap([], byString), marked: true,
    context: CONTEXT, knockOn: () => false, locked: () => false, shared: () => 0, ms: step => Number(allocationWords().ms(step)),
    words: {
        part: (code, quantity) => m.previewBin({ code: code ?? m.previewReserved({ sentence: false }), quantity: allocationWords().quantity(quantity, "m³") }),
        what: code => code ?? m.previewReserved({ sentence: true }),
        lane: (label, day) => (day === undefined ? label : m.previewWhere({ resource: label, day: printDay(day) })),
        waiting: m.previewWaiting(),
    },
    ...rest,
})!;

/** Each lane: its name, its load before → after and its tone. */
const rowsOf = (model: LanesModel) => model.rows.map(row => [row.name, row.before, row.after, row.tone]);
/** A lane's entries: each one's title, how the change marks it, how a job is drawn, and what it breaks. */
const barsOf = (model: LanesModel, i: number) => model.rows[i]!.bars.map(bar => [bar.title, bar.op, bar.look, bar.breach]);
/** What the change does to each resource, for the map: what it takes, knocks on and loses there. */
const tallyOf = (model: LanesModel) => [...model.tally].map(([resource, t]) => [resource, t.takes, t.knocks, t.loses]);
/** The new times it gives its bins, for the map's when strip: what each is, when it starts and whether it is added. */
const landingsOf = (model: LanesModel) => model.landings.map(landing => [landing.what, landing.start, landing.added]);

describe("allocationCrop", () => {
    test("an arrival the change puts on a resource leaves the waiting row — one entry moving there — each lane's load before → after; the resource's jobs as the board draws them", () => {
        const model = crop([{ key: "n1", before: undefined, after: BOOKED }], [], [["n1", BOOKED]]);
        // The resources first; the waiting row last.
        expect(rowsOf(model)).toEqual([["R-1", 0, 8, undefined], ["Waiting", 8, 0, "better"]]);
        expect(model.measure).toBe("load");
        expect(model.unit).toBe("m³");
        // A week's ruler: the bin's hold runs nine days.
        expect([model.window.from, model.window.to, model.window.unit]).toEqual([on(-2), on(10), "week"]);
        expect(barsOf(model, 0)).toEqual([
            ["J-1", undefined, "prior", undefined],
            ["planned", undefined, "next", undefined],
            ["E-1 · 8 m³", "add", undefined, undefined],
        ]);
        const booked = model.rows[0]!.bars[2]!;
        expect([booked.start, booked.end]).toEqual([on(0, 14, 15), on(9)]);
        // It waited over its window.
        const ghost = model.rows[1]!.bars[0]!;
        expect([ghost.title, ghost.op, ghost.start, ghost.end, ghost.to?.name]).toEqual(["E-1", "from", on(-1), on(2), "R-1"]);
        expect(model.clauses).toEqual([{ kind: "move", what: "E-1", from: "Waiting", to: "R-1", verb: "held", start: on(0, 14, 15), end: on(9), overlapped: undefined, knock: false }]);
        // For the map: R-1 takes the bin the waiting row loses, at its new time.
        expect(tallyOf(model)).toEqual([["R-1", 1, 0, 0], [WAITING, 0, 0, 1]]);
        expect(landingsOf(model)).toEqual([["E-1", on(0, 14, 15), false]]);
    });

    test("what the board's check says once the change is made: a resource over its maximum is bad, its new part breaches it, the bin beside it stands as it does", () => {
        const model = crop([{ key: "n1", before: undefined, after: BOOKED }], [["c1", IN_R1]], [["c1", IN_R1], ["n1", BOOKED]]);
        expect(rowsOf(model)).toEqual([["R-1", 4, 12, "bad"], ["Waiting", 8, 0, "better"]]);
        expect(barsOf(model, 0)).toEqual([
            ["E-2 · 4 m³", undefined, undefined, undefined],
            ["J-1", undefined, "prior", undefined],
            ["planned", undefined, "next", undefined],
            ["E-1 · 8 m³", "add", undefined, { kind: "issue", text: "12 m³ · max 10 · 2 over · over max" }],
        ]);
    });

    test("a part the change takes off one resource and puts on another moves there; the resource it leaves under its minimum no longer is; jobs outside the window are not drawn", () => {
        const moved = bin(on(0, 6, 15), "E-2", 4, 7, [["R-1", 4]]);
        const model = crop([{ key: "c1", before: IN_R2, after: moved }], [["c1", IN_R2]], [["c1", moved]]);
        expect(rowsOf(model)).toEqual([["R-2", 4, 0, "better"], ["R-1", 0, 4, undefined]]);
        // Tue 11 to Wed 19: R-1's last job ends as it starts, its next starts after it ends.
        expect([model.window.from, model.window.to]).toEqual([on(0), on(8)]);
        expect(model.rows[0]!.bars.map(bar => [bar.title, bar.op, bar.to?.name])).toEqual([["E-2 · 4 m³", "from", "R-1"]]);
        expect(barsOf(model, 1)).toEqual([["E-2 · 4 m³", "add", undefined, undefined]]);
        expect(model.clauses).toEqual([{ kind: "move", what: "E-2", from: "R-2", to: "R-1", verb: "held", start: on(0, 6, 15), end: on(7), overlapped: undefined, knock: false }]);
        expect(tallyOf(model)).toEqual([["R-1", 1, 0, 0], ["R-2", 0, 0, 1]]);
        expect(landingsOf(model)).toEqual([["E-2", on(0, 6, 15), false]]);
    });

    test("a part the change takes off with nowhere to go goes back to the waiting row, over the day its bin stands on, the arrival having no window", () => {
        const unlinked = bin(on(0, 6, 15), "E-2", 4, 7, []);
        const model = crop([{ key: "c1", before: IN_R1, after: unlinked }], [["c1", IN_R1]], [["c1", unlinked]]);
        expect(rowsOf(model)).toEqual([["R-1", 4, 0, undefined], ["Waiting", 0, 4, "worse"]]);
        expect(model.rows[0]!.bars.map(bar => [bar.title, bar.op, bar.to?.name])).toEqual([["J-1", undefined, undefined], ["E-2 · 4 m³", "from", "Waiting"]]);
        expect(model.rows[1]!.bars.map(bar => [bar.title, bar.op, bar.start, bar.end])).toEqual([["E-2", "add", on(0), on(1)]]);
        expect(model.clauses).toEqual([{ kind: "move", what: "E-2", from: "R-1", to: "Waiting", verb: "waits", start: on(0), end: on(1), overlapped: undefined, knock: false }]);
    });

    test("a reservation the change adds is held for its resource's own hold, named as the board names it", () => {
        const reserved = bin(on(0, 9, 15), undefined, 0, 7, [["R-2", 0]]);
        const model = crop([{ key: "r1", before: undefined, after: reserved }], [], [["r1", reserved]]);
        expect(rowsOf(model)).toEqual([["R-2", 0, 0, undefined]]);
        expect(model.rows[0]!.bars.map(bar => [bar.title, bar.op, bar.start, bar.end])).toEqual([["Reserved · 0 m³", "add", on(0, 9, 15), on(8)]]);
        expect(model.clauses).toEqual([{ kind: "add", what: "A reservation", on: "R-2", verb: "held", start: on(0, 9, 15), end: on(8) }]);
    });

    test("a bin whose parts the change leaves as they were, changing something else of it, is changed in place, breaching what the check says of it; a knock-on, a lock and other cases are the bin's", () => {
        const more = { ...IN_R2, quantity: 5 };
        const model = crop([{ key: "c1", before: IN_R2, after: more }], [["c1", IN_R2]], [["c1", more]], {
            locked: key => stringEqual(key, "c1"), shared: key => (stringEqual(key, "c1") ? 2 : 0),
        });
        expect(model.rows[0]!.bars.map(bar => [bar.op, bar.locked, bar.shared, bar.breach])).toEqual([["chg", true, 2, { kind: "issue", text: "1 m³ unallocated · L-1 06:15" }]]);
        expect(model.clauses).toEqual([{ kind: "change", what: "E-2", on: "R-2" }]);
        const knocked = crop([{ key: "c1", before: IN_R2, after: more }], [["c1", IN_R2]], [["c1", more]], { knockOn: key => stringEqual(key, "c1") });
        expect(knocked.rows[0]!.bars.map(bar => [bar.op, bar.knock])).toEqual([[undefined, true]]);
        // Changed in place, it gives no new time; knocked on, the map counts it apart, its breach the bin's.
        expect([tallyOf(model), model.landings]).toEqual([[["R-2", 1, 0, 0]], []]);
        expect(tallyOf(knocked)).toEqual([["R-2", 0, 1, 0]]);
        expect(knocked.tally.get("R-2")?.breach).toEqual({ kind: "issue", text: "1 m³ unallocated · L-1 06:15" });
    });

    test("nothing marked (P4): the waiting arrival as it stands, the resource the recommendation lands it on beside it as it stands, no clause", () => {
        const model = crop([], [], [], { marked: false, lands: new SortedMap([["n1", BOOKED]], byString) });
        expect(rowsOf(model)).toEqual([["R-1", 0, 0, undefined], ["Waiting", 8, 8, undefined]]);
        expect(barsOf(model, 0)).toEqual([["J-1", undefined, "prior", undefined], ["planned", undefined, "next", undefined]]);
        expect(barsOf(model, 1)).toEqual([["E-1", undefined, undefined, undefined]]);
        expect(model.clauses).toEqual([]);
        expect([model.tally.size, model.landings]).toEqual([0, []]);
    });

    test("bins on two days: each resource's lane names its day; the bin, under its new day's minimum, breaches it", () => {
        const later = bin(on(1, 6, 15), "E-2", 4, 7, [["R-2", 4]]);
        const model = crop([{ key: "c1", before: IN_R2, after: later }], [], [], {
            days: [
                { day: on(0), before: planOf(on(0), [["c1", IN_R2]]), after: planOf(on(0), []) },
                { day: on(1), before: planOf(on(1), []), after: planOf(on(1), [["c1", later]]) },
            ],
        });
        const r2 = (day: Date) => m.previewWhere({ resource: "R-2", day: printDay(day) });
        expect(model.rows.map(row => row.name)).toEqual([r2(on(0)), r2(on(1))]);
        expect(model.clauses).toEqual([{ kind: "move", what: "E-2", from: r2(on(0)), to: r2(on(1)), verb: "held", start: on(1, 6, 15), end: on(8), overlapped: undefined, knock: false,
            breach: { kind: "issue", text: "4 m³ · min 10 · 6 short · a warning, Save still works" } }]);
    });

    test("past two lanes, the board's map: every resource a tile, the waiting row none — the resource that takes both bins lit, the one it moves off a ghost — and a tick at each bin's new time", () => {
        const moved = bin(on(0, 6, 15), "E-2", 4, 7, [["R-1", 4]]);
        const model = crop([{ key: "n1", before: undefined, after: BOOKED }, { key: "c1", before: IN_R2, after: moved }], [["c1", IN_R2]], [["c1", moved], ["n1", BOOKED]]);
        expect(rowsOf(model).map(row => row[0])).toEqual(["R-1", "R-2", "Waiting"]);
        expect(model.rows.length).toBeGreaterThan(CROP_LANES);
        const map = lanesMap(model, RESOURCES.map(r => ({ key: r.key, name: r.label, group: "Resources" })), true);
        expect(map.rows.map(row => [row.group, row.tiles.map(tile => [tile.label, tile.op, tile.takes, tile.loses])])).toEqual([["Resources", [["1", "chg", 2, 0], ["2", "from", 0, 1]]]]);
        expect([map.changed, map.of, map.most, map.freed]).toEqual([2, 2, { name: "R-1", n: 2 }, [{ name: "R-2", loses: 1 }]]);
        // 04:00 to 17:00, a grid line every four hours.
        expect([map.when?.window.from, map.when?.window.to, map.when?.grid]).toEqual([on(0, 4), on(0, 17), [4 / 13, 8 / 13]]);
        expect(map.when?.ticks.map(tick => [tick.landing.what, tick.at])).toEqual([["E-2", 2.25 / 13], ["E-1", 10.25 / 13]]);
        const words: DecisionQueueWords = { ...formatters("en-US"), m };
        expect(mapSentence({ model: map, nouns: { event: "load", events: "loads", resources: "resources" } }, [], words)).toBe("2 of 2 resources change; R-1 takes 2 loads, R-2 loses its load");
    });
});

describe("the crop's words", () => {
    test("an entry held in a resource or waiting; a load before → after; a bin's part and a reservation", () => {
        expect(m.previewEvent({ kind: "move", what: "E-1", from: "Waiting", to: "R-1", verb: "held", start: "Tue 11 14:15", end: "Thu 20 00:00", overlapped: undefined }))
            .toBe("E-1 leaves Waiting and is held in R-1 from Tue 11 14:15 to Thu 20 00:00");
        expect(m.previewEvent({ kind: "move", what: "E-2", from: "R-1", to: "Waiting", verb: "waits", start: "Tue 11 00:00", end: "Wed 12 00:00", overlapped: undefined }))
            .toBe("E-2 leaves R-1 and waits from Tue 11 00:00 to Wed 12 00:00");
        expect(m.previewEvent({ kind: "add", what: "A reservation", on: "R-1", verb: "held", start: "09:00", end: "17:00" })).toBe("A reservation is held in R-1 from 09:00 to 17:00");
        expect(m.previewEvent({ kind: "add", what: "Loyalty cards", on: "Press A1", verb: "runs", start: "11:30", end: "15:30" })).toBe("Loyalty cards runs on Press A1 from 11:30 to 15:30");
        expect(m.previewLoad({ before: "0", after: "8 m³", same: false })).toBe("0 → 8 m³");
        expect(m.previewLoad({ before: "8", after: "8 m³", same: true })).toBe("8 m³");
        expect(m.previewBin({ code: "E-1", quantity: "8 m³" })).toBe("E-1 · 8 m³");
        expect([m.previewReserved({ sentence: false }), m.previewReserved({ sentence: true }), m.previewWaiting()]).toEqual(["Reserved", "A reservation", "Waiting"]);
    });
});
