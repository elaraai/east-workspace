/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Library's cards (#1330, #1372), pure, over a small day of their own: the
 * Arrivals groups and their order, each card's ready line and place (A51), and the
 * Resources by the day's states, each its line (A52) — the loads e3-ui's
 * own, compiled.
 */
import { describe, expect, test } from "vitest";
import { NullType, SortedMap, StringType, compareFor, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { arrivalCards, resourceCards, type LibraryWords } from "./library.js";
import { DEFAULT_NOUNS } from "./nouns.js";
import { allocationDomain, allocationWords, type ArrivalRow, type Bin, type Context, type Day, type ResourceRow } from "./model.js";

const byString = compareFor(StringType);
const DAY = new Date(Date.UTC(2027, 4, 11));
const on = (n: number, h = 0, m = 0) => new Date(Date.UTC(2027, 4, 11 + n, h, m));
const arrival = (key: string, quantity: number, due: Date | undefined, window: [Date, Date] | undefined): ArrivalRow => ({
    key, label: key, meta: some(`${key} meta`), quantity, hold: variant("days", 8), kind: none,
    due: due === undefined ? none : some(due), window: window === undefined ? none : some({ from: window[0], to: window[1] }), details: [],
}) as unknown as ArrivalRow;
const resource = (key: string, min: number, max: number, jobs: { label: string; start: Date; end: Date }[]): ResourceRow => ({
    key, label: key, group: some("Hall"), meta: none, note: none, min, max, hold: variant("days", 8), jobs,
}) as unknown as ResourceRow;
const bin = (lane: string, when: Date, of: string | undefined, quantity: number, parts: [string, number][]): Bin => ({
    lane, at: when, arrival: of === undefined ? none : some(of), quantity, kind: none, hold: variant("days", 7), parts: new SortedMap(parts, byString), row: null,
}) as unknown as Bin;
const day = (bins: [string, Bin][]): Day => ({ status: variant("draft", null), bins: new SortedMap(bins, byString) }) as unknown as Day;
const RESOURCES = [
    resource("R-1", 10, 20, []),
    resource("R-2", 10, 20, [{ label: "planned", start: on(3), end: on(9) }]),
    resource("R-3", 10, 40, [{ label: "J-1", start: on(-3), end: on(2) }]),
    resource("R-4", 10, 40, [{ label: "planned", start: on(6), end: on(12) }]),
    resource("R-5", 10, 40, [{ label: "planned", start: on(8), end: on(14) }]),
    resource("R-6", 10, 40, []),
];
const CONTEXT = {
    lanes: [{ key: "L-1", label: "L-1", offset: variant("minutes", 15) }, { key: "L-2", label: "L-2", offset: variant("minutes", 35) }],
    every: variant("hours", 1),
    arrivals: new SortedMap([
        ["E-1", arrival("E-1", 10, on(-2), [on(-3), on(1)])], ["E-2", arrival("E-2", 12, on(1), undefined)], ["E-3", arrival("E-3", 8, undefined, [on(0), on(3)])],
        ["E-4", arrival("E-4", 6, undefined, undefined)], ["E-5", arrival("E-5", 20, on(0), undefined)], ["E-6", arrival("E-6", 30, on(0), undefined)],
        ["E-7", arrival("E-7", 4, on(0), undefined)],
    ], byString),
    resources: new SortedMap(RESOURCES.map(r => [r.key, r] as const), byString),
    rules: { under: true }, unit: "m³",
} as unknown as Context;
const WORDS: LibraryWords = { nouns: DEFAULT_NOUNS, layout: "timeline", lane: key => key, quantity: v => `${v} m³`, number: v => `${v}` };

// The record holds E-5 (two bins, one of them since removed) and E-6; the drafts book E-7 twice, and a second bin of E-6.
const HELD = day([
    ["c1", bin("L-1", on(0, 2, 15), "E-5", 12, [["R-1", 12]])],
    ["c2", bin("L-2", on(0, 1, 35), "E-5", 8, [["R-1", 8]])],
    ["c3", bin("L-1", on(0, 5, 15), "E-6", 30, [["R-4", 20], ["R-1", 10]])],
]);
const PLAN = day([
    ["c1", bin("L-1", on(0, 2, 15), "E-5", 12, [["R-1", 12]])],
    ["c3", bin("L-1", on(0, 5, 15), "E-6", 30, [["R-4", 20], ["R-1", 10]])],
    ["n1", bin("L-2", on(0, 9, 35), "E-7", 2, [])],
    ["n2", bin("L-1", on(0, 8, 15), "E-7", 2, [["R-1", 2]])],
    ["n3", bin("L-2", on(0, 4, 35), "E-6", 5, [])],
    ["v1", bin("L-2", on(0, 0, 35), undefined, 0, [["R-2", 0]])],
]);

describe("arrivalCards (A51)", () => {
    const cards = arrivalCards({ context: CONTEXT, day: DAY, plan: PLAN, held: HELD, words: WORDS });
    test("the groups in order: Overdue, Ready around now, Removed from plan, Allocated — draft bookings first, then by their first bin's time", () => {
        expect(cards.map(c => [c.group, c.key])).toEqual([
            ["Overdue", "arrival:E-1"],
            ["Ready around now", "arrival:E-2"], ["Ready around now", "arrival:E-3"], ["Ready around now", "arrival:E-4"],
            ["Removed from plan", "removed:c2"],
            ["Allocated", "arrival:E-7"], ["Allocated", "arrival:E-5"], ["Allocated", "arrival:E-6"],
        ]);
    });

    test("an arrival still to book: its ready line from its due date and its window, or none; overdue in warn", () => {
        const ready = (key: string) => cards.find(c => c.key === key)!.ready;
        expect(ready("arrival:E-1")).toEqual({ text: "was due Sun 9 · overdue", tone: "warning" });
        expect(ready("arrival:E-2")).toEqual({ text: "due Wed 12" });
        expect(ready("arrival:E-3")).toEqual({ text: "window Tue–Thu" });
        expect(ready("arrival:E-4")).toBeUndefined();
        expect(cards.find(c => c.key === "arrival:E-1")!.sub).toBe("E-1 meta · 8 d");
    });

    test("a removed bin is booked again with its own bin; its arrival, with another bin the day holds, is Allocated too", () => {
        const removed = cards.find(c => c.key === "removed:c2")!;
        expect([removed.grip, removed.figure, removed.ready, removed.sub]).toEqual([{ kind: "removed", bin: "c2" }, "8 m³", { text: "was L-2 01:35 on R-1" }, "E-5 meta · 7 d"]);
        const allocated = cards.find(c => c.key === "arrival:E-5")!;
        expect([allocated.grip, allocated.bins, allocated.ready, allocated.draft]).toEqual([undefined, ["c1"], { text: "in L-1 02:15 on R-1" }, false]);
    });

    test("a draft booking's bins by time, not linked in warn; an arrival with a committed bin is no draft; a split bin's place names its largest part `+ 1`", () => {
        const draft = cards.find(c => c.key === "arrival:E-7")!;
        expect([draft.draft, draft.bins, draft.figure, draft.ready, draft.tip]).toEqual([true, ["n2", "n1"], "4 m³",
            { text: "2 bins · L-1 08:15 on R-1 · L-2 09:35 · not linked", tone: "warning" }, "Allocated · click to show its bin"]);
        const mixed = cards.find(c => c.key === "arrival:E-6")!;
        expect([mixed.draft, mixed.bins, mixed.ready!.text, mixed.tip]).toEqual([false, ["n3", "c3"], "2 bins · L-2 04:35 · not linked · L-1 05:15 on R-4 + 1",
            "In the plan · click to highlight its 2 bins"]);
    });

    test("the Table's words: an arrival drags onto a free row", () => {
        const table = arrivalCards({ context: CONTEXT, day: DAY, plan: PLAN, held: HELD, words: { ...WORDS, layout: "table" } });
        expect(table.find(c => c.key === "arrival:E-2")!.tip).toBe("Click to see where E-2 fits · drag it onto a free row");
    });
});

describe("resourceCards (A52)", () => {
    const domain = allocationDomain(toEastTypeValue(NullType));
    const loads = domain.loads(DAY, PLAN, CONTEXT);
    const lines = new Map(RESOURCES.map(r => [r.key, allocationWords().line(DAY, r, loads.get(r.key)!, "m³")] as const));
    const cards = resourceCards({ resources: RESOURCES, plan: PLAN, loads, lines, words: WORDS });

    test("free first, in key order, then loading by their first bin's time, then busy, each its line: over max in danger, into its next job in warn", () => {
        expect(cards.map(c => [c.group, c.key, c.line.text, c.line.tone ?? ""])).toEqual([
            ["Free today", "R-5", "free · next job Wed 19", ""],
            ["Free today", "R-6", "free · no next job", ""],
            // Holding only a reservation: its own hold, and none of its quantity.
            ["Loading today", "R-2", "0 m³ today · to Tue 18 · 5 d into next job", "warning"],
            ["Loading today", "R-1", "24 m³ today · to Mon 17 · 4 m³ over", "danger"],
            ["Loading today", "R-4", "20 m³ today · to Mon 17 · 1 d into next job", "warning"],
            ["Busy today", "R-3", "busy until Thu 13", ""],
        ]);
        const card = cards.find(c => c.key === "R-1")!;
        expect([card.figure, card.sub, card.tip]).toEqual(["10–20 m³", "Hall", "Click to highlight its bins · drag R-1 onto a bin or an empty lane hour"]);
    });
});
