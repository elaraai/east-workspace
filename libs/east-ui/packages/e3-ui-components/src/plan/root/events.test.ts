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
 * page at a time each window its source serves — and the windows name the
 * snapshot of their data apart from the revision new events move (#1199), a
 * live source its narrowing with it (#1344).
 */

import { describe, test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { SortedMap, StringType, compareFor, none, printFor, some, variant } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import type { PlanLinkValue, PlanRootValue, PlanRowId, PlanWireBlock, PlanWireRow } from "../model.js";
import { NO_EDITS, rowId, timeAt, utcAt } from "../plan.test-utils.js";
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

/** A series the event kinds land on, drawing the ways given, its landing row the first's. */
const landing = (key: string, draws: readonly string[]): PlanLandingValue =>
    ({ key, name: key, icon: "cubes", draws: draws.map((draw) => variant(draw, null)), kinds: [], series: [] }) as unknown as PlanLandingValue;

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
    /** The events at a version, none placed unless given. */
    const leadAt = (version: number, placed: PlanEventPlacedValue = NOTHING_PLACED): PlanEventLead => ({
        placed, shading: new SortedMap([], compareString), cells: undefined, version, error: undefined,
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
});
