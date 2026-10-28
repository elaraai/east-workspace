/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Allocation (#1409, #1420), pure: the run's request over
 * the day as drafted; the result landed — diffed by key, recorded as one
 * step, and what it leaves on the bins told by what each one did (§9.5): a
 * bin added, one moved with a ghost where it stood, one removed with its
 * ghost, the lanes the run changed, whether an arrival left or came back, and
 * the links the runs added or changed with their kilns, for the highlight;
 * a run that changes nothing records nothing; the lock while a run is out;
 * and a ghost's place in the lane grid, a row of its slot's band after the
 * slot's cards.
 */
import { describe, expect, test, vi } from "vitest";
import { DateTimeType, DictType, FloatType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { Origin } from "@elaraai/east-ui-components";
import type { ScheduleChange } from "../shared/schedule/editing.js";
import type { AllocationCommands } from "./actions.js";
import type { AllocationEditing } from "./editing.js";
import type { AllocationDomain, AllocationValue, Bin, Context, Day, Roles } from "./model.js";
import { allocationOptimiseRequest, allocationPlaceWords, landAllocationOptimise, lockAllocationCommands, type AllocationOptimised } from "./optimise.js";
import { laneGrid } from "./timeline-layout.js";

/** The app's own bin row, as a test's board holds it: its bay, its time, its load, its m³ and its kilns. */
const Row = StructType({ bay: StringType, at: DateTimeType, load: OptionType(StringType), m3: FloatType, kilns: DictType(StringType, FloatType) });
type Row = ValueTypeOf<typeof Row>;
const byString = compareFor(StringType);
const sameRow = equalFor(Row);
const encodeRow = encodeBeast2For(Row), decodeRow = decodeBeast2For(Row);
const at = (h: number, m: number) => new Date(Date.UTC(2027, 4, 11, h, m));
const DAY = new Date(Date.UTC(2027, 4, 11));
const row = (bay: string, when: Date, load: string | undefined, m3: number, kilns: [string, number][]): Row =>
    ({ bay, at: when, load: load === undefined ? none : some(load), m3, kilns: new SortedMap(kilns, byString) });
/** A bin as the board reads it from its row: its roles beside the row. */
const binOf = (of: Row): Bin => ({
    lane: of.bay, at: of.at, arrival: of.load, quantity: of.m3, kind: none, hold: variant("days", 8n), parts: new SortedMap([...of.kilns], byString), row: of,
}) as unknown as Bin;
const day = (bins: [string, Row][]): Day => ({ status: variant("draft", null), bins: new SortedMap(bins.map(([id, of]) => [id, binOf(of)] as const), byString) }) as unknown as Day;
/** The board's words: the lanes by label, the loads by code and the kilns by name. */
const VALUE = {
    lanes: [{ key: "B-1", label: "Bay 1" }, { key: "B-2", label: "Bay 2" }, { key: "B-3", label: "Bay 3" }],
    bin: { kind: { key: "bin" }, read: (bytes: Uint8Array): Roles => { const of = decodeRow(bytes); return { ...binOf(of), row: undefined } as unknown as Roles; } },
} as unknown as AllocationValue;
const DOMAIN = { rowType: Row, encodeRow: encodeRow as (row: unknown) => Uint8Array, decodeRow } as unknown as AllocationDomain;
const CONTEXT = {
    arrivals: new SortedMap([["LD-1", { key: "LD-1", label: "LD-1" }], ["LD-2", { key: "LD-2", label: "LD-2" }], ["LD-3", { key: "LD-3", label: "LD-3" }]], byString),
    resources: new SortedMap([["K-1", { key: "K-1", label: "Kiln 1" }], ["K-2", { key: "K-2", label: "Kiln 2" }]], byString),
} as unknown as Context;
const A = row("B-1", at(1, 15), "LD-1", 30, [["K-1", 30]]);
const B = row("B-2", at(2, 35), "LD-2", 12, []);
const R = row("B-3", at(3, 55), undefined, 0, [["K-2", 0]]);
const PLAN = day([["a", A], ["b", B], ["r", R]]);
const ARRIVALS = [...CONTEXT.arrivals.values()];
const rows = (entries: [string, Row][]) => new SortedMap<string, unknown>(entries, byString);
/** The editing a landing records through: its one `record`, which takes the step or refuses it. */
function editing(takes = true) {
    const record = vi.fn((_changes: readonly ScheduleChange[], _origin: Origin, _label: string) => takes);
    return { editing: { schedule: { record } } as unknown as AllocationEditing, record };
}
const land = (request: ReturnType<typeof allocationOptimiseRequest>, result: SortedMap<string, unknown>, plan: Day, before: AllocationOptimised | undefined, takes = true) => {
    const { editing: held, record } = editing(takes);
    const landed = landAllocationOptimise({ value: VALUE, domain: DOMAIN, editing: held, request, result: { bins: result }, label: "Elara run #1", runText: "1", plan, context: CONTEXT, before });
    return { landed, record };
};

describe("the request (R1, R26)", () => {
    test("the day, the run's number, the day's bins by key — each the app's own row, as the session holds it — every arrival and the context", () => {
        const request = allocationOptimiseRequest(DAY, PLAN, ARRIVALS, CONTEXT, 3);
        expect([request.day, request.run, [...request.bins.keys()], request.arrivals.length]).toEqual([DAY, 3n, ["a", "b", "r"], 3]);
        expect([Object.is(request.bins.get("a"), A), Object.is(request.context, CONTEXT)]).toEqual([true, true]);
    });

    test("where a bin stands, as its provenance and its ghost say it: its lane's label, its time and its first resource, or not linked", () => {
        expect([allocationPlaceWords(VALUE, CONTEXT, binOf(A)), allocationPlaceWords(VALUE, CONTEXT, binOf(B))]).toEqual(["Bay 1 01:15 on Kiln 1", "Bay 2 02:35 · not linked"]);
    });
});

describe("the landing (R7, R8, R10, §9.5)", () => {
    test("one step: a bin added is an add, one moved a change with a ghost where it stood, one dropped a remove with its ghost; the lanes the run changed, and the arrivals moved", () => {
        const request = allocationOptimiseRequest(DAY, PLAN, ARRIVALS, CONTEXT, 1);
        const moved = row("B-3", at(3, 55), "LD-1", 30, [["K-1", 30]]);
        const added = row("B-1", at(5, 15), "LD-3", 9, []);
        const { landed, record } = land(request, rows([["a", moved], ["elara-1-LD-3", added], ["r", R]]), PLAN, undefined);
        expect(landed?.counts).toEqual({ added: 1, changed: 1, removed: 1 });
        // The one record: the changed row whole, the new one created, the dropped one removed — origin `optimise`.
        expect(record).toHaveBeenCalledTimes(1);
        const [changes, origin, label] = record.mock.calls[0]!;
        expect([origin, label]).toEqual(["optimise", "Elara run #1"]);
        expect(changes.map(change => [change.kind, change.id, "created" in change ? change.created : undefined, "remove" in change])).toEqual([
            ["bin", "a", undefined, false], ["bin", "elara-1-LD-3", true, false], ["bin", "b", undefined, true],
        ]);
        expect(changes.flatMap(change => "row" in change ? [sameRow(decodeRow(change.row), change.id === "a" ? moved : added)] : [])).toEqual([true, true]);
        const optimised = landed!.optimised!;
        expect([...optimised.ops].map(([id, op]) => [id, op.op, op.run, op.provenance])).toEqual([
            ["a", "chg", "1", "Was Bay 1 01:15 on Kiln 1 · Elara run #1"], ["elara-1-LD-3", "add", "1", "Added by Elara · run #1"],
        ]);
        expect(optimised.ghosts.map(ghost => [ghost.id, ghost.op, ghost.lane, ghost.at, ghost.label, ghost.where, ghost.title])).toEqual([
            ["a", "from", "B-1", at(1, 15), "LD-1", "Bay 1 01:15 on Kiln 1", "Moved by Elara · run #1"],
            ["b", "del", "B-2", at(2, 35), "LD-2", "Bay 2 02:35 · not linked", "Removed by Elara · run #1"],
        ]);
        expect([[...optimised.lanes].sort(), optimised.arrivalsChanged]).toEqual([["B-1", "B-2", "B-3"], true]);
        // A bin moved with its parts as they were, and one added on no kiln: no link for the highlight to draw.
        expect([optimised.links.size, optimised.resources.size]).toEqual([0, 0]);
    });

    test("the links the runs added or changed, for the highlight: a new bin's parts, a relinked bin's new or changed parts, and their kilns; a later run keeps an earlier's while the bin has the part, and drops one it took away", () => {
        const request = allocationOptimiseRequest(DAY, PLAN, ARRIVALS, CONTEXT, 1);
        const split = row("B-1", at(1, 15), "LD-1", 30, [["K-1", 26], ["K-2", 4]]);
        const added = row("B-2", at(5, 35), "LD-3", 9, [["K-2", 9]]);
        const first = land(request, rows([["a", split], ["b", B], ["elara-1-LD-3", added], ["r", R]]), PLAN, undefined).landed!.optimised!;
        const linksOf = (optimised: AllocationOptimised) => [...optimised.links].map(([id, kilns]) => [id, [...kilns].sort()] as const).sort(([a], [b]) => a.localeCompare(b));
        expect([linksOf(first), [...first.resources].sort()]).toEqual([[["a", ["K-1", "K-2"]], ["elara-1-LD-3", ["K-2"]]], ["K-1", "K-2"]]);
        // The next run takes a's part off K-2 and puts the 4 m³ back on K-1, and moves b, which has no part: a keeps K-1's link alone.
        const plan = day([["a", split], ["b", B], ["elara-1-LD-3", added], ["r", R]]);
        const again = allocationOptimiseRequest(DAY, plan, ARRIVALS, CONTEXT, 2);
        const back = row("B-1", at(1, 15), "LD-1", 30, [["K-1", 30]]);
        const second = land(again, rows([["a", back], ["b", row("B-3", at(2, 55), "LD-2", 12, [])], ["elara-1-LD-3", added], ["r", R]]), plan, first).landed!.optimised!;
        expect([linksOf(second), [...second.resources].sort()]).toEqual([[["a", ["K-1"]], ["elara-1-LD-3", ["K-2"]]], ["K-1", "K-2"]]);
    });

    test("a later run's operations over an earlier's: a bin touched again is the later run's, its earlier ghost gone, the others kept; relinked in place, no ghost and no arrival moved", () => {
        const request = allocationOptimiseRequest(DAY, PLAN, ARRIVALS, CONTEXT, 1);
        const moved = row("B-3", at(3, 55), "LD-1", 30, [["K-1", 30]]);
        const first = land(request, rows([["a", moved], ["b", B], ["r", R]]), PLAN, undefined).landed!.optimised!;
        const plan = day([["a", moved], ["b", B], ["r", R]]);
        const again = allocationOptimiseRequest(DAY, plan, ARRIVALS, CONTEXT, 2);
        const relinked = row("B-3", at(3, 55), "LD-1", 30, [["K-2", 30]]);
        const { landed } = land(again, rows([["a", relinked], ["b", B], ["r", R]]), plan, first);
        const optimised = landed!.optimised!;
        expect([...optimised.ops].map(([id, op]) => [id, op.op, op.provenance])).toEqual([["a", "chg", "Was Bay 3 03:55 on Kiln 1 · Elara run #1"]]);
        expect([optimised.ghosts, [...optimised.lanes], optimised.arrivalsChanged]).toEqual([[], ["B-3"], false]);
        expect([[...optimised.links].map(([id, kilns]) => [id, [...kilns]]), [...optimised.resources]]).toEqual([[["a", ["K-2"]]], ["K-2"]]);
        // The first run's ghost of `a` gave way; a bin it did not touch keeps its ghost.
        const other = land(again, rows([["a", moved], ["r", R]]), plan, first).landed!.optimised!;
        expect(other.ghosts.map(ghost => [ghost.id, ghost.op])).toEqual([["a", "from"], ["b", "del"]]);
        expect([...other.ops.keys()]).toEqual(["a"]);
    });

    test("R10 — a result that changes nothing records nothing and leaves what earlier runs left; a step the session refuses lands nothing", () => {
        const request = allocationOptimiseRequest(DAY, PLAN, ARRIVALS, CONTEXT, 1);
        const same = land(request, rows([["a", A], ["b", B], ["r", R]]), PLAN, undefined);
        expect([same.landed, same.record.mock.calls.length]).toEqual([{ counts: { added: 0, changed: 0, removed: 0 }, optimised: undefined }, 0]);
        const refused = land(request, rows([["a", A], ["r", R]]), PLAN, undefined, false);
        expect([refused.landed, refused.record.mock.calls.length]).toEqual([undefined, 1]);
    });

    test("R2 — the commands locked while a run is out: no gesture taken, nothing recorded, Publish off", () => {
        const book = vi.fn(() => true), remove = vi.fn(), publish = vi.fn();
        const locked = lockAllocationCommands({ available: true, canEdit: () => true, book, remove, publish } as unknown as AllocationCommands);
        expect([locked.available, locked.canEdit(), locked.book("LD-1", "B-1", at(1, 15), undefined), locked.remove("a"), locked.publish()]).toEqual([false, false, false, undefined, undefined]);
        expect([book.mock.calls.length, remove.mock.calls.length, publish.mock.calls.length]).toEqual([0, 0, 0]);
    });
});

describe("a ghost's place in the lane grid (R15)", () => {
    test("a row of its slot's band after the slot's cards — the lane's slot at or before where it stood — the band grown for it; none of a lane the grid has not", () => {
        const slots = [
            { lane: "B-1", at: at(1, 15), status: variant("booked", null), bins: ["a"] },
            { lane: "B-2", at: at(1, 35), status: variant("free", null), bins: [] },
            { lane: "B-1", at: at(2, 15), status: variant("free", null), bins: [] },
            { lane: "B-2", at: at(2, 35), status: variant("booked", null), bins: ["b"] },
        ] as never;
        const plan = day([["a", A], ["b", row("B-2", at(2, 35), "LD-2", 12, [])]]);
        const grid = laneGrid(["B-1", "B-2"], slots, plan, () => true, [{ lane: "B-1", at: at(1, 16) }, { lane: "B-2", at: at(1, 35) }, { lane: "B-1", at: at(1, 15) }, { lane: "B-9", at: at(1, 15) }]);
        expect(grid.bands.map(band => [band.row, band.span])).toEqual([[0, 3], [3, 1]]);
        expect(grid.ghosts).toEqual([{ ghost: 0, lane: 0, slot: 0, row: 1 }, { ghost: 1, lane: 1, slot: 0, row: 0 }, { ghost: 2, lane: 0, slot: 0, row: 2 }]);
        expect(grid.cards.map(card => [card.id, card.row])).toEqual([["a", 0], ["b", 3]]);
        expect(laneGrid(["B-1", "B-2"], slots, plan).ghosts).toEqual([]);
    });
});
