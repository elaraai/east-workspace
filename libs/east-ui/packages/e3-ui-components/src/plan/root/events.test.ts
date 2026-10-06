/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * A link's event ends (#1192): an end that names an event — `Plan.eventRef`'s
 * run ref, at the kind's slot with no path — is named where the event draws,
 * however it draws: the row holding the element whose key is the event's ref
 * as East prints it, and that key.
 */

import { describe, test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { none, printFor, some, variant } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import type { PlanLinkValue, PlanRootValue, PlanRowId, PlanWireBlock, PlanWireRow } from "../model.js";
import { NO_EDITS, rowId, timeAt, utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import { resolveEventLinks, usePlanEventBlocks, type PlanEventBlocksValue, type PlanEventRows } from "./events.js";

const printRef = printFor(ScheduleEventRefType);
/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const elementKey = (kind: string, key: string) => printRef({ kind, key });
/** Midnight of a day, as a `time` instant. */
const at = (day: string) => timeAt(`${day}T00:00:00`);
const confirmed = variant("confirmed", null);

/** A row of `kind` at `id`. */
function row(id: PlanRowId, kind: unknown): PlanWireRow {
    return {
        id, parent: none,
        gutter: { label: "row", id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind, collapsed: false, pinned: false, height: none, status: none, approval: none, expand: none, edits: NO_EDITS,
    } as unknown as PlanWireRow;
}

/** An event's link end, as `Plan.eventRef` makes it. */
const eventEnd = (kind: string, key: string) => ({ row: variant("entry", { series: kind, path: [] }), run: key });

/** A link between two ends. */
const link = (key: string, from: unknown, to: unknown): PlanLinkValue =>
    ({ key, from, to, quantity: some({ value: 1, unit: none, format: none, text: none }) }) as PlanLinkValue;

const bars = rowId("a1", "presses.span");
const tiles = rowId("a1", "presses.buckets");
const chips = rowId("c1", "crews.cards");
const marks = rowId("a1", "presses.marks");

/** The event kinds' rows: a job's bar and a check's tile on Press A1, a shift's chip on Crew 1, a stop's mark on Press A1. */
const BLOCKS: PlanWireBlock[] = [
    {
        fixed: true, parent: none, rows: [
            row(bars, variant("span", {
                runs: [{ key: elementKey("job", "J-1"), start: at("2026-10-05"), end: at("2026-10-06"), label: "Job", quantity: none, state: confirmed, status: none, moved: none, icon: none }],
                decisions: [], ports: [], rollup: none,
            })),
            row(tiles, variant("buckets", {
                lanes: [],
                events: [{
                    key: elementKey("check", "K-1"), at: at("2026-10-06"), lane: none, label: none, icon: none, state: confirmed,
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none,
                }],
                markers: [],
            })),
            row(marks, variant("events", { marks: [{ key: elementKey("stop", "S-1"), at: at("2026-10-07"), kind: variant("milestone", null), icon: none, label: none }] })),
        ],
    },
    {
        fixed: true, parent: none, rows: [
            row(chips, variant("cards", { chips: [{ key: elementKey("shift", "SH-1"), from: at("2026-10-05"), to: at("2026-10-06"), label: "Early", state: confirmed, icon: none }] })),
        ],
    },
    { fixed: true, parent: none, rows: [] },
] as unknown as PlanWireBlock[];

describe("a link's event ends (#1192)", () => {
    test("each names the row its event draws on, however it draws, and its element's key", () => {
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

    test("a section at no path is no event, and links that name none come back as they were — the same array", () => {
        const links = [
            link("rows", { row: rowId("u1", "units"), run: "run" }, { row: rowId("u2", "units"), run: "run" }),
            link("section", { row: variant("section", { series: "job", path: [] }), run: "J-1" }, { row: rowId("u2", "units"), run: "run" }),
        ] as PlanRootValue["links"];
        expect(resolveEventLinks(links, BLOCKS)).toBe(links);
    });
});

describe("the event kinds' rows over the range the canvas draws (#1192)", () => {
    /** Four weeks by the day, from Monday 5 October. */
    const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-11-02T00:00:00") }, resolution: "day" }) as PlanScale;
    /** A resource kind's block of a bar row per key, and the Unassigned rows'. */
    const blocksOf = (...keys: string[]): PlanWireBlock[] => [
        { fixed: true, parent: none, rows: keys.map((k) => row(rowId(k, "presses.span"), variant("span", { runs: [], decisions: [], ports: [], rollup: none }))) },
        { fixed: true, parent: none, rows: [] },
    ] as unknown as PlanWireBlock[];

    test("read over the window and the periods laid out beyond it; until one answers, empty fixed blocks stand in; equal rows hold, and a read in flight or failed keeps the last", () => {
        const asked: [Date, Date][] = [];
        let answer: () => ReturnType<PlanEventBlocksValue> = () => none;
        // A new seam each time, so the read is evaluated again.
        const seam = (): PlanEventRows => ({
            count: 2,
            blocks: (from, to) => {
                asked.push([from, to]);
                return answer();
            },
        });
        const { result, rerender } = renderHook(({ events }) => usePlanEventBlocks(events, scale), { initialProps: { events: seam() } });
        // The window, and the two days the scale lays out beyond each edge.
        expect(asked[0]).toEqual([utcAt("2026-10-03T00:00:00"), utcAt("2026-11-04T00:00:00")]);
        expect(result.current.version).toBe(0);
        expect(result.current.blocks.map((b) => [b.fixed, b.rows.length])).toEqual([[true, 0], [true, 0]]);
        const first = blocksOf("a1", "a2");
        answer = () => some(first);
        rerender({ events: seam() });
        expect(result.current.blocks).toBe(first);
        expect(result.current.version).toBe(1);
        // The same rows again are the rows the canvas has.
        answer = () => some(blocksOf("a1", "a2"));
        rerender({ events: seam() });
        expect(result.current.blocks).toBe(first);
        expect(result.current.version).toBe(1);
        // In flight: the last rows stand.
        answer = () => none;
        rerender({ events: seam() });
        expect(result.current.blocks).toBe(first);
        // Failed: they stand still, and the canvas says why.
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            answer = () => { throw new Error("a press with no load"); };
            rerender({ events: seam() });
            expect(result.current.blocks).toBe(first);
            expect(result.current.version).toBe(1);
            expect(result.current.error).toBe("a press with no load");
        } finally {
            errors.mockRestore();
        }
        // New rows move, and the failure is gone.
        const next = blocksOf("a2");
        answer = () => some(next);
        rerender({ events: seam() });
        expect(result.current).toEqual({ blocks: next, version: 2, error: undefined });
    });
});
