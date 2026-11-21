/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The event kinds' events on the canvas's own rows (#1192, #1541). A link's
 * event end — `Plan.eventRef`'s run ref, at the kind's slot with no path — is
 * named where the event draws, however it draws: the row holding the element
 * whose key is the event's ref as East prints it, and that key; over rows read
 * a page at a time, a top-level resource's row by its id, from the events
 * placed alone (#1199). The events are read over the range the canvas draws and
 * held while they hold; the root's rows are joined with them — inline once, a
 * page at a time each window its source serves, and a window read again over
 * new events alone only in the rows whose events moved (#1712) — and the windows name the
 * snapshot of their data apart from the revision new events move (#1199), a
 * live source its narrowing with it (#1344).
 */

import { describe, test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { SortedMap, StringType, compareFor, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { Plan, ScheduleEventRefType, planChildRowKey, planHideId } from "@elaraai/e3-ui/internal";
import type { PlanLinkValue, PlanRootValue, PlanRowId, PlanWireBlock, PlanWireRow } from "../model.js";
import { NO_EDITS, rowId, timeAt, utcAt } from "../plan.test-utils.js";
import { entry } from "../row-id.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import {
    resolveEventLinks, usePlanEventPlaced, usePlanEventRoot,
    type PlanEventLead, type PlanEventPlacedValue, type PlanEventRows, type PlanEventSeamValue, type PlanLandingValue,
} from "./events.js";

const printRef = printFor(ScheduleEventRefType);
/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const elementKey = (kind: string, key: string) => printRef({ kind, key });
/** Midnight of a day, as a `time` instant. */
const at = (day: string) => timeAt(`${day}T00:00:00`);
const confirmed = variant("confirmed", null);
const compareString = compareFor(StringType);

/** A row of `kind` at `id`. */
function row(id: PlanRowId, kind: unknown): PlanWireRow {
    return {
        id, parent: none,
        gutter: { label: "row", id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind, collapsed: false, pinned: false, height: none, status: none, expand: none, edits: NO_EDITS,
    } as unknown as PlanWireRow;
}

/** An event's link end, as `Plan.eventRef` makes it. */
const eventEnd = (kind: string, key: string) => ({ row: variant("entry", { series: kind, path: [] }), run: key });

/** A link between two ends. */
const link = (key: string, from: unknown, to: unknown): PlanLinkValue =>
    ({ key, from, to, quantity: some({ value: 1, unit: none, format: none, text: none }) }) as PlanLinkValue;

/**
 * A series the event kinds land on, drawing the ways given, its landing row the first's: its resources the rows' own
 * entries unless said, and its rows beneath no other landing's unless `under` names one — a step beneath each of that
 * landing's rows, where a kind's `child` lands.
 */
const landing = (key: string, draws: readonly string[], top = true, under?: string): PlanLandingValue =>
    ({
        key, name: key, draws: draws.map((draw) => variant(draw, null)), kinds: [], series: [], top,
        under: under === undefined ? none : some(under),
    }) as unknown as PlanLandingValue;

/** Presses, whose landing row draws bars, beside a row of tiles and one of marks; crews, whose landing row draws chips. */
const LANDINGS = [landing("presses", ["span", "buckets", "marks"]), landing("crews", ["cards"])];

/** No event placed. */
const NOTHING_PLACED: PlanEventPlacedValue = { on: new SortedMap([], compareString), lost: new SortedMap([], compareString) };

/**
 * The events of a range, filed as the seam's `placed` files them: by the
 * series they land on, the way they draw, then the resource's key.
 *
 * @param events - Each event: its series, the way it draws, its resource's key, its kind and its key
 * @returns The events placed
 */
function placedOn(events: readonly (readonly [string, string, string, string, string])[]): PlanEventPlacedValue {
    const on = new SortedMap<string, SortedMap<string, SortedMap<string, unknown[]>>>([], compareString);
    for (const [series, draw, resource, kind, key] of events) {
        const byDraw = on.get(series) ?? new SortedMap<string, SortedMap<string, unknown[]>>([], compareString);
        on.set(series, byDraw);
        const byResource = byDraw.get(draw) ?? new SortedMap<string, unknown[]>([], compareString);
        byDraw.set(draw, byResource);
        const start = utcAt("2026-10-05T06:00:00");
        const end = utcAt("2026-10-05T14:00:00");
        byResource.set(resource, [...(byResource.get(resource) ?? []), {
            item: {
                kind, key, title: key, start: some(start), end: some(end), resource: some({ kind: series, key: resource }),
                status: none, minutes: 480n, due: none, state: confirmed, quantity: none, lane: none,
            },
            start, end, icon: { prefix: "fas", name: "file-lines", label: none, style: none },
        }]);
    }
    return { on, lost: new SortedMap([], compareString) } as unknown as PlanEventPlacedValue;
}

const bars = rowId("a1", "presses");
const tiles = rowId("a1", "presses.buckets");
const marks = rowId("a1", "presses.marks");
const chips = rowId("c1", "crews");

/** The rows with the events joined in: a job's bar and a check's tile on Press A1, a stop's mark beside them, a shift's chip on Crew 1. */
const BLOCKS: PlanWireBlock[] = [
    {
        fixed: false, parent: none, charts: none, rows: [
            row(bars, variant("span", {
                runs: [{ key: elementKey("job", "J-1"), start: at("2026-10-05"), end: at("2026-10-06"), label: "Job", quantity: none, state: confirmed, status: none, moved: none, icon: none }],
                decisions: [], ports: [], rollup: none,
            })),
            row(tiles, variant("buckets", {
                lanes: [],
                events: [{
                    key: elementKey("check", "K-1"), at: at("2026-10-06"), lane: none, label: none, icon: none, state: confirmed,
                    status: none, color: none, colorPalette: none, stretch: none, content: none, animation: none,
                }],
                markers: [],
            })),
            row(marks, variant("events", { marks: [{ key: elementKey("stop", "S-1"), at: at("2026-10-07"), kind: variant("milestone", null), status: none, icon: none, label: none }] })),
        ],
    },
    {
        fixed: false, parent: none, charts: none, rows: [
            row(chips, variant("cards", { chips: [{ key: elementKey("shift", "SH-1"), from: at("2026-10-05"), to: at("2026-10-06"), label: "Early", state: confirmed, icon: none }] })),
        ],
    },
] as unknown as PlanWireBlock[];

describe("a link's event ends (#1192)", () => {
    test("each names the row its event draws on, however it draws — a landing row, or one beside it — and its element's key", () => {
        const links = [
            link("job-to-shift", eventEnd("job", "J-1"), eventEnd("shift", "SH-1")),
            link("check-to-stop", eventEnd("check", "K-1"), eventEnd("stop", "S-1")),
        ] as PlanRootValue["links"];
        expect(resolveEventLinks(links, BLOCKS)).toEqual([
            { ...links[0], from: { row: bars, run: elementKey("job", "J-1") }, to: { row: chips, run: elementKey("shift", "SH-1") } },
            { ...links[1], from: { row: tiles, run: elementKey("check", "K-1") }, to: { row: marks, run: elementKey("stop", "S-1") } },
        ]);
    });

    test("an event the rows do not draw keeps its end, and so does a row's own", () => {
        const own = { row: rowId("u1", "units"), run: "run" };
        const links = [link("away", eventEnd("job", "J-9"), eventEnd("job", "J-1")), link("mixed", own, eventEnd("stop", "S-1"))] as PlanRootValue["links"];
        expect(resolveEventLinks(links, BLOCKS)).toEqual([
            { ...links[0], to: { row: bars, run: elementKey("job", "J-1") } },
            { ...links[1], to: { row: marks, run: elementKey("stop", "S-1") } },
        ]);
    });

    test("over rows read a page at a time, an event on a resource is named by its row's id from the events placed — its landing row for the first way its kinds draw, the row beside it for a further one — never looked for in a window (#1199)", () => {
        // A job's bar on Press 1700, in a window the canvas has not read; a stop's mark on Press 1001.
        const placed = placedOn([["presses", "span", "P-1700", "job", "W-1"], ["presses", "marks", "P-1001", "stop", "S-9"]]);
        const links = [
            link("job-to-stop", eventEnd("job", "W-1"), eventEnd("stop", "S-9")),
            link("job-to-shift", eventEnd("job", "W-1"), eventEnd("shift", "SH-1")),
        ] as PlanRootValue["links"];
        const press1700 = { row: variant("entry", { series: "presses", path: ["P-1700"] }), run: elementKey("job", "W-1") };
        expect(resolveEventLinks(links, BLOCKS, placed, LANDINGS)).toEqual([
            { ...links[0], from: press1700, to: { row: variant("entry", { series: "presses.marks", path: ["P-1001"] }), run: elementKey("stop", "S-9") } },
            // An event the rows draw is named where it draws, beside one placed on a resource not read.
            { ...links[1], from: press1700, to: { row: chips, run: elementKey("shift", "SH-1") } },
        ]);
        // Without the events placed, they are ends no row has.
        expect(resolveEventLinks(links, BLOCKS)[0]).toEqual(links[0]);
    });

    test("over rows read a page at a time, a resource nested beneath another row is named by the row a window holds, never from the event alone (#1541)", () => {
        // The halls' presses: a press's row stands under its hall, its path its hall and then its key.
        const nested = [landing("presses", ["span", "marks"], false)];
        const held = entry("presses", "hall-a", "a1");
        const blocks = [{ fixed: false, parent: none, charts: none, rows: [row(held, BLOCKS[0]!.rows[0]!.kind)] }] as unknown as PlanWireBlock[];
        // J-1's bar is on a row a window holds; W-1's press is in none.
        const placed = placedOn([["presses", "span", "a1", "job", "J-1"], ["presses", "span", "b9", "job", "W-1"]]);
        const links = [link("held-to-unread", eventEnd("job", "J-1"), eventEnd("job", "W-1"))] as PlanRootValue["links"];
        // The row found keeps its own id, its hall in its path; an event on a press no window holds keeps its end, where
        // a row named by the press's key alone would be no row of the canvas.
        expect(resolveEventLinks(links, blocks, placed, nested)).toEqual([{ ...links[0], from: { row: held, run: elementKey("job", "J-1") } }]);
    });

    test("a section at no path is no event, and links that name none come back as they were — the same array", () => {
        const links = [
            link("rows", { row: rowId("u1", "units"), run: "run" }, { row: rowId("u2", "units"), run: "run" }),
            link("section", { row: variant("section", { series: "job", path: [] }), run: "J-1" }, { row: rowId("u2", "units"), run: "run" }),
        ] as PlanRootValue["links"];
        expect(resolveEventLinks(links, BLOCKS)).toBe(links);
    });
});

/** A seam whose `placed` answers as given, and whose `place` hands the blocks back as they are unless told otherwise. */
function seamOf(placed: PlanEventSeamValue["placed"], place: PlanEventSeamValue["place"] = (blocks) => blocks): PlanEventSeamValue {
    return { placed, place };
}

describe("the event kinds' events over the range the canvas draws (#1192)", () => {
    /** Four weeks by the day, from Monday 5 October. */
    const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-11-02T00:00:00") }, resolution: "day" }) as PlanScale;

    test("read over the window and the periods laid out beyond it; none placed until one answers; equal events hold, and a read in flight or failed keeps the last", () => {
        const asked: [Date, Date][] = [];
        let answer: () => ReturnType<PlanEventSeamValue["placed"]> = () => none;
        // A new seam each time, so the read is evaluated again.
        const events = (): PlanEventRows => ({
            seam: seamOf((from, to) => {
                asked.push([from, to]);
                return answer();
            }),
            landings: LANDINGS,
            paged: false,
        });
        const { result, rerender } = renderHook(({ rows }) => usePlanEventPlaced(rows, scale), { initialProps: { rows: events() } });
        // The window, and the two days the scale lays out beyond each edge.
        expect(asked[0]).toEqual([utcAt("2026-10-03T00:00:00"), utcAt("2026-11-04T00:00:00")]);
        expect([result.current.version, result.current.placed]).toEqual([0, undefined]);
        const first = placedOn([["presses", "span", "a1", "job", "J-1"]]);
        answer = () => some(first);
        rerender({ rows: events() });
        expect(result.current.placed).toBe(first);
        expect(result.current.version).toBe(1);
        // The same events again are the events the canvas has.
        answer = () => some(placedOn([["presses", "span", "a1", "job", "J-1"]]));
        rerender({ rows: events() });
        expect(result.current.placed).toBe(first);
        expect(result.current.version).toBe(1);
        // In flight: the last events stand.
        answer = () => none;
        rerender({ rows: events() });
        expect(result.current.placed).toBe(first);
        // Failed: they stand still, and the canvas says why — no kind given here, so none named whose own events failed.
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            answer = () => { throw new Error("a press with no load"); };
            rerender({ rows: events() });
            expect(result.current.placed).toBe(first);
            expect(result.current.version).toBe(1);
            const failure = result.current.error;
            expect(failure).toEqual({ reason: "a press with no load", kinds: [] });
            // Failing the same way again, it is the same failure: nothing new for the canvas to draw.
            rerender({ rows: events() });
            expect(result.current.error).toBe(failure);
        } finally {
            errors.mockRestore();
        }
        // New events move, and the failure is gone; no kind is read by its cells, so nothing is shaded (#1039).
        const next = placedOn([["presses", "span", "a2", "job", "J-1"]]);
        answer = () => some(next);
        rerender({ rows: events() });
        expect(result.current.placed).toBe(next);
        expect([result.current.version, result.current.error, result.current.cells, result.current.shading.size]).toEqual([2, undefined, undefined, 0]);
    });
});

describe("the root's rows, the events joined in (#1541)", () => {
    /** A root whose own rows are `rows`. */
    const rootOf = (rows: unknown) => ({ rows, links: [] }) as unknown as PlanRootValue;
    /** The events at a version, none placed and nothing shaded unless given. */
    const leadAt = (version: number, placed: PlanEventPlacedValue = NOTHING_PLACED, shading: PlanEventLead["shading"] = new SortedMap([], compareString)): PlanEventLead => ({
        placed, shading, cells: undefined, version, error: undefined,
    });
    /** The canvas's source the hook hands it. */
    const sourceOf = (root: PlanRootValue) => (root.rows as unknown as { value: PlanPagedSourceValue }).value;
    /** What `place` was asked: how many rows, the events placed, and whether every row was at hand. */
    type Placing = { readonly rows: number; readonly placed: PlanEventPlacedValue; readonly whole: boolean };
    /** The events' rows over a seam that marks every block it places, and keeps what it was asked. */
    const placing = (asked: Placing[], paged: boolean): PlanEventRows => ({
        seam: seamOf(() => none, (blocks, placed, _shading, _hidden, whole) => {
            asked.push({ rows: blocks.reduce((n, b) => n + b.rows.length, 0), placed, whole });
            return blocks.map((b) => ({ ...b, charts: some(7n) }));
        }),
        landings: LANDINGS,
        paged,
    });

    test("rows read whole are placed once, every row at hand — so the Unassigned rows follow them — and with no events before the first read answers", () => {
        const asked: Placing[] = [];
        const events = placing(asked, false);
        const root = rootOf(variant("inline", BLOCKS));
        const { result, rerender } = renderHook(({ lead }) => usePlanEventRoot(root, root, lead, events), { initialProps: { lead: leadAt(0) } });
        expect(asked).toEqual([{ rows: 4, placed: NOTHING_PLACED, whole: true }]);
        const rows = result.current.data.rows;
        expect(rows.type).toBe("inline");
        expect(rows.type === "inline" ? rows.value.map((b) => b.charts) : []).toEqual([some(7n), some(7n)]);
        // Both roots draw the same rows.
        expect(result.current.value.rows).toEqual(rows);
        const placed = placedOn([["presses", "span", "a1", "job", "J-1"]]);
        rerender({ lead: leadAt(1, placed) });
        expect(asked.map((a) => [Object.is(a.placed, placed), a.whole])).toEqual([[false, true], [true, true]]);
    });

    test("a paged `data`: each window its source serves is placed — no Unassigned rows, an event on no row of the canvas's being in no window — and its own revision is the snapshot, which new events leave", () => {
        const asked: Placing[] = [];
        const data = { revision: "D1" };
        const src = {
            id: "data-window", page: () => some({ rows: BLOCKS, entries: [] }), total: () => some(2n), seek: none,
            revision: () => some(data.revision), refresh: () => null,
        };
        const root = rootOf(variant("pinned", src));
        const events = placing(asked, true);
        const { result, rerender } = renderHook(({ lead }) => usePlanEventRoot(root, root, lead, events), { initialProps: { lead: leadAt(1) } });
        const source = () => sourceOf(result.current.data);
        expect(result.current.data.rows.type).toBe("pinned");
        const page = source().page(0n, 200n);
        expect(page.type === "some" ? page.value.rows.map((b) => b.charts) : []).toEqual([some(7n), some(7n)]);
        expect(asked.map((a) => a.whole)).toEqual([false]);
        expect(source().snapshot?.()).toEqual(some("D1"));
        const before = source().revision?.();
        rerender({ lead: leadAt(2) });
        // Read again — the events moved — over the same data.
        expect(source().revision?.()).not.toEqual(before);
        expect(source().snapshot?.()).toEqual(some("D1"));
        // The data itself moving is a new snapshot.
        data.revision = "D2";
        expect(source().snapshot?.()).toEqual(some("D2"));
    });

    test("a live `rows` source the rail narrows (#1344): its windows name the narrowing they belong to, and the snapshot is the record's revision and the narrowing together, which new events leave", () => {
        const record = { revision: "R1", narrowing: "hall: Hall 2" };
        const src = {
            id: "rows-narrowed", page: () => some({ rows: BLOCKS, entries: [] }), total: () => some(2n), seek: none,
            revision: () => some(record.revision), refresh: () => null, query: () => record.narrowing,
        };
        const root = rootOf(variant("live", src));
        const events = placing([], true);
        const { result, rerender } = renderHook(({ lead }) => usePlanEventRoot(root, root, lead, events), { initialProps: { lead: leadAt(1) } });
        const source = () => sourceOf(result.current.data);
        expect(result.current.data.rows.type).toBe("live");
        expect(source().query?.()).toBe("hall: Hall 2");
        const first = source().snapshot?.();
        expect(first?.type).toBe("some");
        // New events over the same narrowing: the windows are read again, over the same snapshot.
        rerender({ lead: leadAt(2) });
        expect(source().snapshot?.()).toEqual(first);
        // A choice on the rail: the same source, the same record's revision — another narrowing, another snapshot.
        record.narrowing = "hall: Hall 3";
        expect(source().query?.()).toBe("hall: Hall 3");
        const chosen = source().snapshot?.();
        expect(chosen).not.toEqual(first);
        // A commit under it: another snapshot again.
        record.revision = "R2";
        expect(source().snapshot?.()).not.toEqual(chosen);
    });

    describe("a window read again over new events alone (#1712)", () => {
        const printRowId = printFor(Plan.Types.RowId);
        const rowIdEqual = equalFor(Plan.Types.RowId);
        const stringEqual = equalFor(StringType);
        const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none });
        const NO_SHADING_HERE = new SortedMap([], compareString) as PlanEventLead["shading"];

        /**
         * A `place` that joins a window row by row as the seam's does (`whole` false): each landing row's events — filed
         * under its resource's key, a row a step beneath a resource's under the pair — as its marks, and a row beneath it
         * for each further way its kinds draw; every other row as it is. It keeps the ids of the rows each call is given.
         */
        const rowByRow = (landings: readonly PlanLandingValue[], given: string[][]): PlanEventSeamValue["place"] => (blocks, placed) => {
            given.push(blocks.flatMap((block) => block.rows.map((one) => printRowId(one.id))));
            return blocks.map((block) => ({
                ...block,
                rows: block.rows.flatMap((one): PlanWireRow[] => {
                    if (one.id.type !== "entry") return [one];
                    const { series, path } = one.id.value;
                    const at = landings.find((l) => l.draws.length > 0 && stringEqual(l.key, series));
                    if (at === undefined) return [one];
                    const key = at.under.type === "some" ? planChildRowKey(path[path.length - 2]!, path[path.length - 1]!) : path[path.length - 1]!;
                    return at.draws.map((draw, i) => {
                        const marks = (placed.on.get(series)?.get(draw.type)?.get(key) ?? []).map((p) => ({ key: elementKey(p.item.kind, p.item.key) }));
                        const kind = variant("events", { marks });
                        return i === 0 ? ({ ...one, kind } as unknown as PlanWireRow) : row(entry(`${series}.${draw.type}`, ...path), kind);
                    });
                }),
            }));
        };

        /** The keys of the marks a joined row draws, by its id. */
        const marksOn = (blocks: readonly PlanWireBlock[], id: PlanRowId): readonly string[] => {
            const found = blocks.flatMap((b) => b.rows).find((one) => rowIdEqual(one.id, id));
            return found?.kind.type === "events" ? found.kind.value.marks.map((m) => m.key) : [];
        };

        /**
         * The root's wrapper over a source that gives the same blocks at each read, as the kept layer does while they hold
         * (`kept.ts`), and a `place` that joins row by row: the ids of the rows each join is given, and a read of the window.
         */
        function joining(blocks: PlanWireBlock[], landings: readonly PlanLandingValue[]) {
            const given: string[][] = [];
            const src = { id: "window", page: () => some({ rows: blocks, entries: [] }), total: () => some(40n), seek: none, revision: () => some("R1"), refresh: () => null };
            const root = rootOf(variant("pinned", src));
            const events: PlanEventRows = { seam: seamOf(() => none, rowByRow(landings, given)), landings: [...landings], paged: true };
            const { result, rerender } = renderHook(({ lead, hidden }) => usePlanEventRoot(root, root, lead, events, hidden),
                { initialProps: { lead: leadAt(1), hidden: [] as readonly string[] } });
            const read = (): PlanWireBlock[] => {
                const page = sourceOf(result.current.data).page(0n, 200n);
                return page.type === "some" ? page.value.rows : [];
            };
            return { given, read, rerender };
        }

        /** Presses P-01 … P-40 in two blocks, each a landing row drawing marks and tiles, then a row of its notes no event lands on. */
        const PRESSES = Array.from({ length: 40 }, (_x, i) => `P-${i < 9 ? "0" : ""}${i + 1}`);
        const WINDOW = [PRESSES.slice(0, 20), PRESSES.slice(20)].map((presses) => ({
            fixed: false, parent: none, charts: none,
            rows: presses.flatMap((press) => [row(entry("presses", press), spanKind), row(entry("notes", press), spanKind)]),
        })) as unknown as PlanWireBlock[];
        const ON_PRESSES = [landing("presses", ["marks", "buckets"])];

        test("events that move for two resources of a window of many join those resources' rows alone, every other row the object it was — and none, read again with nothing moved", () => {
            const { given, read, rerender } = joining(WINDOW, ON_PRESSES);
            rerender({ lead: leadAt(2, placedOn([["presses", "marks", "P-03", "job", "J-1"], ["presses", "marks", "P-07", "job", "J-2"]])), hidden: [] });
            const before = read();
            // The first read joins every row: 40 presses and their notes.
            expect(given.map((ids) => ids.length)).toEqual([80]);
            // J-2 moves to P-12 and J-3 comes to P-07; P-03 holds J-1, read again as an equal list.
            const now = placedOn([["presses", "marks", "P-03", "job", "J-1"], ["presses", "marks", "P-07", "job", "J-3"], ["presses", "marks", "P-12", "job", "J-2"]]);
            rerender({ lead: leadAt(3, now), hidden: [] });
            const after = read();
            expect(new Set(given[1])).toEqual(new Set([entry("presses", "P-07"), entry("presses", "P-12")].map((id) => printRowId(id))));
            const remade = after.flatMap((b, i) => b.rows.filter((one, j) => !Object.is(one, before[i]!.rows[j])).map((one) => printRowId(one.id)));
            expect(new Set(remade)).toEqual(new Set(
                [entry("presses", "P-07"), entry("presses.buckets", "P-07"), entry("presses", "P-12"), entry("presses.buckets", "P-12")].map((id) => printRowId(id))));
            // What a join of the whole window gives.
            expect(after).toEqual(rowByRow(ON_PRESSES, [])(WINDOW, now, NO_SHADING_HERE, [], false));
            expect([marksOn(after, entry("presses", "P-07")), marksOn(after, entry("presses", "P-12"))]).toEqual([[elementKey("job", "J-3")], [elementKey("job", "J-2")]]);
            read();
            expect(given).toHaveLength(2);
        });

        test("a resource whose events leave, and one whose events arrive, are both joined again", () => {
            const { given, read, rerender } = joining(WINDOW, ON_PRESSES);
            rerender({ lead: leadAt(2, placedOn([["presses", "marks", "P-03", "job", "J-1"]])), hidden: [] });
            read();
            rerender({ lead: leadAt(3, placedOn([["presses", "marks", "P-05", "job", "J-1"]])), hidden: [] });
            const after = read();
            expect(new Set(given[1])).toEqual(new Set([entry("presses", "P-03"), entry("presses", "P-05")].map((id) => printRowId(id))));
            expect([marksOn(after, entry("presses", "P-03")), marksOn(after, entry("presses", "P-05"))]).toEqual([[], [elementKey("job", "J-1")]]);
        });

        test("the shading moving, or what the viewer hides, joins the window whole; new events after it, their rows alone", () => {
            const { given, read, rerender } = joining(WINDOW, ON_PRESSES);
            const placed = placedOn([["presses", "marks", "P-03", "job", "J-1"]]);
            rerender({ lead: leadAt(2, placed), hidden: [] });
            read();
            // A bucket of P-03's shaded past the cap: the shading's scale is every row's.
            const shading = new SortedMap([["presses.marks", new SortedMap([["P-03", [{ at: utcAt("2026-10-05T00:00:00"), value: some(1) }]]], compareString)]], compareString) as unknown as PlanEventLead["shading"];
            rerender({ lead: leadAt(3, placed, shading), hidden: [] });
            read();
            // The jobs hidden in the Series tab: how many rows each landing row makes.
            const hidden = [planHideId.events("job")];
            rerender({ lead: leadAt(4, placed, shading), hidden });
            read();
            rerender({ lead: leadAt(5, placedOn([["presses", "marks", "P-04", "job", "J-1"]]), shading), hidden });
            read();
            expect(given.map((ids) => ids.length)).toEqual([80, 80, 80, 2]);
        });

        test("rows a step beneath their resource's are found by the pair's key — the same child's key beneath another resource another row — and each further row keeps its place", () => {
            // Presses whose tasks the jobs land on, a step beneath each press's row.
            const onTasks = [landing("presses", []), landing("tasks", ["marks", "buckets"], false, "presses")];
            const blocks = [{
                fixed: false, parent: none, charts: none,
                rows: ["P-01", "P-02"].flatMap((press) => [row(entry("presses", press), spanKind), ...["T-1", "T-2"].map((task) => row(entry("tasks", press, task), spanKind))]),
            }] as unknown as PlanWireBlock[];
            const { given, read, rerender } = joining(blocks, onTasks);
            rerender({ lead: leadAt(2, placedOn([["tasks", "marks", planChildRowKey("P-01", "T-2"), "job", "J-1"]])), hidden: [] });
            const before = read();
            // J-1 moves to P-02's T-1, and J-2 comes to P-01's T-1.
            const now = placedOn([["tasks", "marks", planChildRowKey("P-02", "T-1"), "job", "J-1"], ["tasks", "marks", planChildRowKey("P-01", "T-1"), "job", "J-2"]]);
            rerender({ lead: leadAt(3, now), hidden: [] });
            const after = read();
            expect(new Set(given[1])).toEqual(new Set([entry("tasks", "P-01", "T-1"), entry("tasks", "P-01", "T-2"), entry("tasks", "P-02", "T-1")].map((id) => printRowId(id))));
            expect(after[0]!.rows.map((one) => printRowId(one.id))).toEqual(before[0]!.rows.map((one) => printRowId(one.id)));
            expect(after).toEqual(rowByRow(onTasks, [])(blocks, now, NO_SHADING_HERE, [], false));
            expect(marksOn(after, entry("tasks", "P-02", "T-1"))).toEqual([elementKey("job", "J-1")]);
        });
    });
});
