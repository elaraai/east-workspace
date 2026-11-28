/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The Plan's adapter to the shared cells' reader (#1039), worked out with no
 * read: the buckets a range is cut into at the canvas's resolution, and where
 * the canvas reports its paged rows in view — at rest, the rows its view
 * shows, the span standing while it shows only rows not read, or a span of no
 * row while its rows stand for no resource (#1795); and the
 * resources a window's rows are read by, a row beneath a resource by the one
 * it stands beneath (#1541, U1). What the reader wants and decides is the
 * shared reader's (`shared/schedule/cells.test.ts`).
 */

import { describe, test, expect, vi } from "vitest";
import { none, some, variant } from "@elaraai/east";
import type { PlanWireBlock } from "../model.js";
import { utcAt } from "../plan.test-utils.js";
import { entry } from "../row-id.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import { bucketsOver, cellSpanOf, createCellSpanStore, keptLinkEnds, landingKeysOf, shownCellSpan } from "./cells.js";
import { readPathOf, readResourceOf, type PlanLandingValue } from "./landings.js";

const day = (text: string) => new Date(`${text}T00:00:00Z`);

/** One run of rows in view, its ends by their windows and their keys, under a narrowing. */
const oneRun = (first: readonly [number, string], last: readonly [number, string], narrowing: string | undefined) =>
    ({ runs: [{ first: { w: first[0], key: first[1] }, last: { w: last[0], key: last[1] } }], narrowing });

describe("the buckets a range is cut into (#1039)", () => {
    test("whole periods of the scale's resolution, in order", () => {
        const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-10-19T00:00:00") }, resolution: "month" }) as PlanScale;
        expect(bucketsOver(scale, day("2026-09-01"), day("2026-12-01"))).toEqual([
            { start: day("2026-09-01").getTime(), end: day("2026-10-01").getTime() },
            { start: day("2026-10-01").getTime(), end: day("2026-11-01").getTime() },
            { start: day("2026-11-01").getTime(), end: day("2026-12-01").getTime() },
        ]);
    });
});

describe("where the canvas reports its rows in view (#1039)", () => {
    test("the first and the last row a paged window placed, each by its window and its resource's key, under the narrowing their windows are", () => {
        const origin = new Map([["r1", { w: 0 }], ["r2", { w: 0 }], ["r3", { w: 1 }]]);
        const items = [
            { key: "stock", path: ["board"] },
            { key: "r1", path: ["P-1001"] },
            { key: "r2", path: ["P-1002"] },
            { key: "r3", path: ["P-1201"] },
        ];
        expect(cellSpanOf(items, origin, undefined)).toEqual(oneRun([0, "P-1001"], [1, "P-1201"], undefined));
        // A kind its source narrows (#1344): the rows are the narrowing's, and say so.
        expect(cellSpanOf(items, origin, "hall: Hall 2")).toEqual(oneRun([0, "P-1001"], [1, "P-1201"], "hall: Hall 2"));
        // A row no paged window placed — the Plan's own — is never a paged kind's.
        expect(cellSpanOf([{ key: "stock", path: ["board"] }], origin, undefined)).toBeUndefined();
    });

    test("a view running from one series of the paged rows into another over the same windows — rows beside a group at the top — is a run each, in the view's order (#1710)", () => {
        // The halls as rows, a window each, then the halls as groups: their own rows, then their presses from the first window on.
        const origin = new Map([["a6", { w: 6 }], ["a7", { w: 7 }], ["g0", { w: 0 }], ["p0", { w: 0 }], ["p1", { w: 1 }]]);
        const items = [
            { key: "a6", path: ["H-107"] }, { key: "a7", path: ["H-108"] },
            { key: "g0", path: [] }, { key: "p0", path: ["H-101", "P-1001"] }, { key: "p1", path: ["H-102", "P-1011"] },
        ];
        expect(cellSpanOf(items, origin, undefined)).toEqual({
            runs: [
                { first: { w: 6, key: "H-107" }, last: { w: 7, key: "H-108" } },
                { first: { w: 0, key: "P-1001", under: ["H-101"] }, last: { w: 1, key: "P-1011", under: ["H-102"] } },
            ],
            narrowing: undefined,
        });
    });

    test("at rest: the paged rows the view shows; a view showing rows not read yet and none read keeps the span standing — never the opening's first block, a view away — and one showing neither reports none", () => {
        const origin = new Map([["r6", { w: 5 }], ["r7", { w: 5 }]]);
        const standing = oneRun([0, "JOB-10090"], [0, "JOB-10180"], "status: Ready");
        const shown = [{ key: "r6", path: ["JOB-49999"] }, { key: "r7", path: ["JOB-49909"] }];
        // Rows in view, a run below them: their span.
        expect(shownCellSpan(shown, true, standing, origin, "status: Ready")).toEqual(oneRun([5, "JOB-49999"], [5, "JOB-49909"], "status: Ready"));
        // A run not read alone — the view sent far into it — the span standing, or none while none stands.
        expect(shownCellSpan([], true, standing, origin, "status: Ready")).toBe(standing);
        expect(shownCellSpan([{ key: "stock", path: ["board"] }], true, undefined, origin, undefined)).toBeUndefined();
        // Nothing paged and no run — a narrowing of no row: none, the opening's.
        expect(shownCellSpan([], false, standing, origin, "status: Ready")).toBeUndefined();
    });

    test("a row that stands for no resource — a group's own row, its path none — is passed over, first, last or between (#1711)", () => {
        const origin = new Map([["h1", { w: 0 }], ["p1", { w: 0 }], ["h2", { w: 0 }], ["p2", { w: 0 }], ["h3", { w: 0 }]]);
        const items = [
            { key: "h1", path: [] },
            { key: "p1", path: ["H-1", "P-11"] },
            { key: "h2", path: [] },
            { key: "p2", path: ["H-2", "P-21"] },
            { key: "h3", path: [] },
        ];
        expect(cellSpanOf(items, origin, undefined)).toEqual({
            runs: [{ first: { w: 0, key: "P-11", under: ["H-1"] }, last: { w: 0, key: "P-21", under: ["H-2"] } }],
            narrowing: undefined,
        });
    });

    test("at rest over paged rows none of which stands for a resource — every group folded: a span of no row under the narrowing the windows are now, never the rows that stood, so no row's events are read while it lasts (#1795)", () => {
        const origin = new Map([["h1", { w: 0 }], ["h2", { w: 0 }]]);
        const standing = oneRun([0, "P-11"], [0, "P-21"], "status: Ready");
        const halls = [{ key: "h1", path: [] }, { key: "h2", path: [] }];
        expect(shownCellSpan(halls, false, standing, origin, "status: Ready")).toEqual({ runs: [], narrowing: "status: Ready" });
        // Whatever stood: under another narrowing, and before any span was reported — a page opened folded.
        expect(shownCellSpan(halls, false, standing, origin, "status: Done")).toEqual({ runs: [], narrowing: "status: Done" });
        expect(shownCellSpan(halls, false, undefined, origin, undefined)).toEqual({ runs: [], narrowing: undefined });
        // And whatever a run not read yet beside them holds: its rows report their own once they are drawn.
        expect(shownCellSpan(halls, true, standing, origin, "status: Ready")).toEqual({ runs: [], narrowing: "status: Ready" });
        // A row no paged window placed is no paged row: the Plan's own rows alone report none.
        expect(shownCellSpan([{ key: "stock", path: [] }], false, standing, origin, "status: Ready")).toBeUndefined();
    });

    test("cellSpanOf preserves slot and group under path when reported so duplicate keys across slots or groups stay distinct", () => {
        const origin = new Map([["r1", { w: 0 }], ["r2", { w: 0 }]]);
        const items = [
            { key: "r1", path: ["H-1", "P-1"], slot: "presses" },
            { key: "r2", path: ["H-2", "P-1"], slot: "presses" },
        ];
        expect(cellSpanOf(items, origin, undefined)).toEqual({
            runs: [{ first: { w: 0, key: "P-1", slot: "presses", under: ["H-1"] }, last: { w: 0, key: "P-1", slot: "presses", under: ["H-2"] } }],
            narrowing: undefined,
        });
    });

    test("the store holds the span reported last, and tells its listeners only of one that moves — its rows, its runs or its narrowing", () => {
        const store = createCellSpanStore();
        const heard = vi.fn();
        const stop = store.subscribe(heard);
        expect(store.get()).toBeUndefined();
        store.set(oneRun([0, "P-1001"], [0, "P-1018"], undefined));
        store.set(oneRun([0, "P-1001"], [0, "P-1018"], undefined));
        expect(heard).toHaveBeenCalledTimes(1);
        store.set(oneRun([0, "P-1002"], [0, "P-1019"], undefined));
        expect(heard).toHaveBeenCalledTimes(2);
        expect(store.get()).toEqual(oneRun([0, "P-1002"], [0, "P-1019"], undefined));
        // The same rows under another narrowing are other rows (#1344).
        store.set(oneRun([0, "P-1002"], [0, "P-1019"], "hall: Hall 2"));
        expect(heard).toHaveBeenCalledTimes(3);
        // A second run is other rows in view (#1710); the same two runs again move nothing.
        const two = { runs: [{ first: { w: 6, key: "H-107" }, last: { w: 7, key: "H-108" } }, { first: { w: 0, key: "P-1002" }, last: { w: 0, key: "P-1019" } }], narrowing: "hall: Hall 2" };
        store.set(two);
        store.set({ ...two, runs: two.runs.map((run) => ({ ...run })) });
        expect(heard).toHaveBeenCalledTimes(4);
        stop();
        store.set(undefined);
        expect(heard).toHaveBeenCalledTimes(4);
        expect(store.get()).toBeUndefined();
    });
});

describe("the resources a window's rows are read by (#1541, U1)", () => {
    /** The presses, and the kinds of task beneath each: a kind's `child` lands on the kinds' rows. */
    const presses: PlanLandingValue = {
        key: "press", name: "Presses", draws: [variant("buckets", null)], kinds: [], series: ["temperature"], top: true, under: none, within: [], depth: 1n,
    };
    const kinds: PlanLandingValue = {
        key: "kinds", name: "Tasks", draws: [variant("buckets", null)], kinds: ["task"], series: [], top: false, under: some("press"), within: ["press"], depth: 2n,
    };
    const landings = [presses, kinds];
    /** A window's rows, each by its id alone: what the reader reads of them. */
    const block = (...ids: ReturnType<typeof entry>[]): PlanWireBlock[] => [{ rows: ids.map((id) => ({ id })) } as never];

    test("a landing row is read by its own resource, and a row beneath a resource by the one it stands beneath", () => {
        expect(readResourceOf(presses, ["P03"])).toEqual({ slot: "press", key: "P03" });
        expect(readResourceOf(kinds, ["P03", ".ink_fill"])).toEqual({ slot: "press", key: "P03" });
        // A path too short to hold the resource names none.
        expect(readResourceOf(kinds, [".ink_fill"])).toBeUndefined();
        // Rows by key, each under its parent: the press, a kind of task beneath it, a heat row of the kind's own and a row
        // a step beneath that.
        const rows = new Map([
            ["press", { id: entry("press", "P03"), parent: none }],
            ["kind", { id: entry("kinds", "P03", ".ink_fill"), parent: some("press") }],
            ["kind-heat", { id: entry("kind-heat", "P03", ".ink_fill"), parent: some("kind") }],
            ["kind-part", { id: entry("kind-parts", "P03", ".ink_fill", "nozzle"), parent: some("kind-heat") }],
            ["temperature", { id: entry("temperature", "P03"), parent: some("press") }],
        ]);
        const pathOf = (key: string) => readPathOf(rows.get(key)!, landings, (k) => rows.get(k));
        expect(pathOf("press")).toEqual(["P03"]);
        expect(pathOf("kind")).toEqual(["P03"]);
        // Any row beneath a row a step beneath the press is read by the press too: a series of the kind's own, and a row
        // a further step down (#1660's review).
        expect(pathOf("kind-heat")).toEqual(["P03"]);
        expect(pathOf("kind-part")).toEqual(["P03"]);
        // A row of no landing beneath the press — a series of its own — is read by the press.
        expect(pathOf("temperature")).toEqual(["P03"]);
    });

    test("a row with no landing row at or above it stands for no resource, and a row of another series beneath a resource's row is read by the resource (#1711)", () => {
        // Halls, each its presses, each press its tasks: every kind lands on a task, a step beneath its press.
        const press: PlanLandingValue = { key: "press", name: "Presses", draws: [], kinds: [], series: [], top: false, under: none, within: ["halls"], depth: 2n };
        const tasks: PlanLandingValue = {
            key: "tasks", name: "Tasks", draws: [variant("marks", null)], kinds: ["job"], series: [], top: false, under: some("press"), within: ["halls", "press"], depth: 3n,
        };
        const rows = new Map([
            ["hall", { id: entry("halls", "H-1"), parent: none }],
            ["note", { id: entry("notes", "H-1", "n-1"), parent: some("hall") }],
            ["press", { id: entry("press", "H-1", "P-11"), parent: some("hall") }],
            ["task", { id: entry("tasks", "H-1", "P-11", "t-1"), parent: some("press") }],
            ["measure", { id: entry("measures", "H-1", "P-11", "m-1"), parent: some("press") }],
        ]);
        const pathOf = (key: string) => readPathOf(rows.get(key)!, [press, tasks], (k) => rows.get(k));
        // A group's own row, and a row beneath it of a series no kind lands on: no resource.
        expect(pathOf("hall")).toEqual([]);
        expect(pathOf("note")).toEqual([]);
        // A resource's own row, though every kind lands a step beneath it; and every row beneath it, the press's.
        expect(pathOf("press")).toEqual(["H-1", "P-11"]);
        expect(pathOf("task")).toEqual(["H-1", "P-11"]);
        expect(pathOf("measure")).toEqual(["H-1", "P-11"]);
    });

    /** The rows beneath a resource a kind's `child` lands on, each by its series and its own key. */
    const beneath = (...keys: string[]) => keys.map((key) => ({ slot: "kinds", key }));

    test("a resource's own row and the rows beneath it name it once, in the order the rows draw them — with those rows, each counted on its own", () => {
        expect(landingKeysOf(block(
            entry("folder", "F1"),
            entry("press", "P03"), entry("temperature", "P03"), entry("kinds", "P03", ".blanket_wash"), entry("kinds", "P03", ".ink_fill"),
            entry("press", "P04"), entry("kinds", "P04", ".blanket_wash"),
            entry("press", "P05"),
        ), landings)).toEqual([
            { slot: "press", key: "P03", children: beneath(".blanket_wash", ".ink_fill") },
            { slot: "press", key: "P04", children: beneath(".blanket_wash") },
            // A press with no row beneath it lists none.
            { slot: "press", key: "P05" },
        ]);
    });

    test("a page that draws no row of a resource's own names it by the rows beneath it", () => {
        expect(landingKeysOf(block(
            entry("temperature", "P03"), entry("kinds", "P03", ".blanket_wash"), entry("kinds", "P03", ".ink_fill"), entry("kinds", "P03", ".plate_check"),
        ), landings)).toEqual([{ slot: "press", key: "P03", children: beneath(".blanket_wash", ".ink_fill", ".plate_check") }]);
    });

    test("a resource beneath a group names the rows it stands under, outermost first; one under no row names none (#1710)", () => {
        expect(landingKeysOf(block(
            entry("halls", "H-1"),
            entry("press", "H-1", "P03"), entry("kinds", "H-1", "P03", ".ink_fill"),
            entry("press", "H-1", "P04"),
            entry("halls", "H-2"),
            entry("press", "H-2", "P03"),
            // A page that draws no row of the press's own names where it stands by the row beneath it.
            entry("kinds", "H-2", "P09", ".ink_fill"),
            entry("press", "S-1", "H-3", "P10"),
            entry("press", "P11"),
        ), landings)).toEqual([
            { slot: "press", key: "P03", under: ["H-1"], children: beneath(".ink_fill") }, { slot: "press", key: "P04", under: ["H-1"] },
            { slot: "press", key: "P03", under: ["H-2"] }, { slot: "press", key: "P09", under: ["H-2"], children: beneath(".ink_fill") },
            { slot: "press", key: "P10", under: ["S-1", "H-3"] },
            { slot: "press", key: "P11" },
        ]);
    });
});

describe("the events the canvas's links name at their ends, as the cells' reader holds them (#1541, U10)", () => {
    /** A link between two events, as a link kind's row joins them: each end at no path, its run the event's key. */
    const link = (from: readonly [kind: string, key: string], to: readonly [kind: string, key: string]) => ({
        from: { row: entry(from[0]), run: from[1] }, to: { row: entry(to[0]), run: to[1] },
    });
    /** Some links, as the canvas hands them over. */
    const links = (...made: ReturnType<typeof link>[]) => made as unknown as Parameters<typeof keptLinkEnds>[1];
    const KINDS = ["job", "binding", "delivery"];

    test("each kind's events named at an end, in the links' order, and none for a kind no link names", () => {
        const ends = keptLinkEnds(undefined, links(link(["job", "J-1"], ["binding", "B-1"]), link(["binding", "B-1"], ["delivery", "D-1"])), KINDS);
        expect([...ends]).toEqual([["job", ["J-1"]], ["binding", ["B-1", "B-1"]], ["delivery", ["D-1"]]]);
    });

    test("links made anew over the same ends are the ends held, the same object: the reader reads nothing again", () => {
        const first = keptLinkEnds(undefined, links(link(["job", "J-1"], ["binding", "B-1"])), KINDS);
        expect(keptLinkEnds(first, links(link(["job", "J-1"], ["binding", "B-1"])), KINDS)).toBe(first);
    });

    test("a link drawn to another event moves its kind's ends alone: every other kind's list is the one held", () => {
        const first = keptLinkEnds(undefined, links(link(["job", "J-1"], ["binding", "B-1"])), KINDS);
        const next = keptLinkEnds(first, links(link(["job", "J-1"], ["binding", "B-1"]), link(["binding", "B-1"], ["delivery", "D-1"])), KINDS);
        expect(next).not.toBe(first);
        expect(next.get("job")).toBe(first.get("job"));
        expect(next.get("delivery")).toEqual(["D-1"]);
        // And a kind taken away moves them too.
        expect(keptLinkEnds(next, links(), ["job"])).not.toBe(next);
    });
});
