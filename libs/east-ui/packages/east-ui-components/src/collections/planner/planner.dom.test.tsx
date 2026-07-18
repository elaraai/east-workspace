/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Per-cell bucketing (#120 item 6). Bucketing is decided per CELL, not per row:
 * within one row a bucketed column (am/pm) and a flat column coexist, and a
 * bucketless event lands in its column's flat cell instead of vanishing (the old
 * per-row test dropped any bucketless event whenever the row had any other
 * bucketed event). When a single cell accidentally mixes a bucketed + a
 * bucketless event, the orphan falls into a synthetic "N/A" lane (and a warning
 * fires) rather than being silently swallowed.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { utcDay } from "d3-time";
import { system } from "../../theme/index.js";
import { EastChakraPlanner, type PlannerRootValue, type PlannerRowValue, type PlannerEventValue } from "./index.js";

afterEach(cleanup);

/** A minimal point event value (all the optional knobs absent). */
function ev(slot: number, bucket: string | undefined, label: string, state: unknown = variant("committed", null)): PlannerEventValue {
    return {
        key: none,
        slot: variant("number", slot),
        endSlot: none,
        bucket: bucket !== undefined ? some(bucket) : none,
        label,
        state,
        popover: none,
        stretch: none,
        content: none,
        tone: none,
        animation: none,
        hovercard: none,
    } as unknown as PlannerEventValue;
}

function row(name: string, events: PlannerEventValue[]): PlannerRowValue {
    return {
        group: none,
        cells: new Map([["name", { value: name, sublabel: none }]]),
        events,
        markers: [],
        status: none,
        approval: none,
    } as unknown as PlannerRowValue;
}

/** A point planner over a 1..3 numeric axis with am/pm buckets. */
function plannerRoot(rows: PlannerRowValue[]): PlannerRootValue {
    return {
        variant: variant("point", null),
        axis: {
            scale: variant("number", null),
            buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }],
            range: some(variant("number", { min: 1, max: 3 })),
            format: none,
            resolution: none,
        },
        columns: [{ key: "name", header: "Name", width: none, frozen: some(true), align: none }],
        rows,
        now: none,
        density: none,
        slotMinWidth: none,
        onSelectRow: none,
        review: none,
        rowHover: none,
    } as unknown as PlannerRootValue;
}

describe("Planner per-cell bucketing (#120)", () => {
    test("a bucketless event in its own column renders flat; a same-cell mix gets an N/A lane", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        render(
            <ChakraProvider value={system}>
                <EastChakraPlanner
                    value={plannerRoot([
                        row("Press A", [
                            ev(1, "am", "Setup"),
                            ev(1, "pm", "Run"),
                            // Same-cell mix: a bucketless event sharing the bucketed
                            // day-1 cell → falls into the N/A lane (not dropped).
                            ev(1, undefined, "Note", variant("proposed", variant("added", null))),
                            // Flat (bucketless) day-2 cell in a row that also has
                            // bucketed cells — the old per-row test dropped this.
                            ev(2, undefined, "Idle"),
                        ]),
                    ])}
                    storageKey="p1"
                />
            </ChakraProvider>,
        );

        // The bucketless event in its own flat column is no longer silently dropped.
        expect(screen.getByText("Idle")).toBeTruthy();
        // The orphan bucketless event sharing a bucketed cell lands in an N/A lane.
        expect(screen.getByText("Note")).toBeTruthy();
        // Once a row needs an N/A lane, every bucketed cell in the row carries one
        // (empty where unused) so the sub-grid stays aligned — so there is ≥1 "N/A".
        expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(1);
        // The declared buckets still render.
        expect(screen.getByText("Setup")).toBeTruthy();
        expect(screen.getByText("Run")).toBeTruthy();
        // The accidental same-cell mix is surfaced to the author.
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test("a clean per-cell-bucketed row renders no N/A lane and emits no warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        render(
            <ChakraProvider value={system}>
                <EastChakraPlanner
                    value={plannerRoot([
                        row("Press B", [
                            ev(1, "am", "Setup"),   // day-1 bucketed
                            ev(2, undefined, "Flat"), // day-2 flat — no same-cell mix
                        ]),
                    ])}
                    storageKey="p2"
                />
            </ChakraProvider>,
        );

        expect(screen.getByText("Setup")).toBeTruthy();
        expect(screen.getByText("Flat")).toBeTruthy();
        expect(screen.queryByText("N/A")).toBeNull();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

// ============================================================================
// Time-axis resolution (#309, #326). Dates are UTC instants (`Date.UTC` / ISO-Z)
// and the renderer floors / steps / formats in UTC (d3 `utc*` intervals, like
// Gantt), so day columns are timezone-independent — the same window renders
// identically under any runner TZ. ISO drop-key expectations use the same
// `utcDay` floor the renderer uses.
// ============================================================================

/** A minimal time-slot point event value. */
function tev(slot: Date, label: string): PlannerEventValue {
    return {
        key: none,
        slot: variant("time", slot),
        endSlot: none,
        bucket: none,
        label,
        state: variant("committed", null),
        popover: none,
        stretch: none,
        content: none,
        tone: none,
        animation: none,
        hovercard: none,
    } as unknown as PlannerEventValue;
}

/** A point planner over a time axis; range / format / resolution per test. */
function timeRoot(rows: PlannerRowValue[], axis: {
    range?: { min: Date; max: Date };
    format?: string;
    resolution?: string;
}, root?: { onDrag?: boolean }): PlannerRootValue {
    return {
        variant: variant("point", null),
        axis: {
            scale: variant("time", null),
            buckets: [],
            range: axis.range !== undefined ? some(variant("time", axis.range)) : none,
            format: axis.format !== undefined ? some(axis.format) : none,
            resolution: axis.resolution !== undefined ? some(variant(axis.resolution, null)) : none,
        },
        columns: [{ key: "name", header: "Name", width: none, frozen: some(true), align: none }],
        rows,
        now: none,
        density: none,
        slotMinWidth: none,
        onSelectRow: none,
        review: none,
        rowHover: none,
        id: root?.onDrag ? "plan" : "",
        sources: [],
        onDrag: root?.onDrag ? some(() => {}) : none,
        canDrop: none,
    } as unknown as PlannerRootValue;
}

/** The rendered slot-axis header labels (`data-slot="headerCell"`). */
function headerLabels(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[data-slot="headerCell"]')).map((n) => n.textContent ?? "");
}

function renderPlanner(value: PlannerRootValue, key: string) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlanner value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

describe("Planner time-axis resolution (#309)", () => {
    test("a pinned ≤14-day range infers day columns — half-open [min, max), ddd DD default labels", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [tev(new Date(Date.UTC(2026, 3, 1, 10)), "Run")])],
            { range: { min: new Date(Date.UTC(2026, 2, 30)), max: new Date(Date.UTC(2026, 3, 6)) } },
        ), "t1");
        // Mon Mar 30 … Sun Apr 5 — exactly seven day columns, none for Apr 6.
        expect(headerLabels(container)).toEqual(["Mon 30", "Tue 31", "Wed 01", "Thu 02", "Fri 03", "Sat 04", "Sun 05"]);
        // The event's instant floors into its day column.
        expect(screen.getByText("Run")).toBeTruthy();
    });

    test("axis format overrides the day-column label pattern", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [])],
            { range: { min: new Date(Date.UTC(2026, 2, 30)), max: new Date(Date.UTC(2026, 3, 2)) }, format: "DD/MM" },
        ), "t2");
        expect(headerLabels(container)).toEqual(["30/03", "31/03", "01/04"]);
    });

    test("a pinned >14-day range keeps month columns", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [])],
            { range: { min: new Date(Date.UTC(2026, 0, 15)), max: new Date(Date.UTC(2026, 3, 20)) } },
        ), "t3");
        expect(headerLabels(container)).toEqual(["Jan", "Feb", "Mar", "Apr"]);
    });

    test("a data-derived extent never infers day columns (pinned ranges only), and stays closed", () => {
        const { container } = renderPlanner(timeRoot(
            // 5-day event spread, no pinned range — month columns, and the max
            // slot's month keeps its column (closed extent).
            [row("Press A", [tev(new Date(Date.UTC(2026, 2, 30, 9)), "a"), tev(new Date(Date.UTC(2026, 3, 3, 9)), "b")])],
            {},
        ), "t4");
        expect(headerLabels(container)).toEqual(["Mar", "Apr"]);
    });

    test("explicit hour resolution derives one column per hour", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [tev(new Date(Date.UTC(2026, 2, 30, 10, 30)), "Stamp")])],
            { range: { min: new Date(Date.UTC(2026, 2, 30)), max: new Date(Date.UTC(2026, 2, 31)) }, resolution: "hour" },
        ), "t5");
        const labels = headerLabels(container);
        expect(labels.length).toBe(24);
        expect(labels[0]).toBe("00:00");
        expect(labels[23]).toBe("23:00");
        expect(screen.getByText("Stamp")).toBeTruthy();
    });

    test("explicit week resolution floors columns to week starts", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [])],
            { range: { min: new Date(Date.UTC(2026, 0, 5)), max: new Date(Date.UTC(2026, 2, 2)) }, resolution: "week" },
        ), "t6");
        // Jan 5 2026 is a Monday — weeks floor to Sundays: Jan 04 … Mar 01.
        const labels = headerLabels(container);
        expect(labels[0]).toBe("Jan 04");
        expect(labels[labels.length - 1]).toBe("Mar 01");
        expect(labels.length).toBe(9);
    });

    test("explicit month resolution honours format across years", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [])],
            { range: { min: new Date(Date.UTC(2025, 10, 10)), max: new Date(Date.UTC(2026, 1, 10)) }, format: "MMM YY" },
        ), "t7");
        expect(headerLabels(container)).toEqual(["Nov 25", "Dec 25", "Jan 26", "Feb 26"]);
    });

    test("day-resolution drop slots carry the day-start ISO instant (#269 keys stay instants)", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [])],
            { range: { min: new Date("2026-03-30T00:00:00Z"), max: new Date("2026-04-02T00:00:00Z") } },
            { onDrag: true },
        ), "t8");
        const slots = Array.from(container.querySelectorAll("[data-drop-slot]")).map((n) => n.getAttribute("data-drop-slot"));
        expect(slots).toContain(utcDay.floor(new Date("2026-03-30T00:00:00Z")).toISOString());
        expect(slots).toContain(utcDay.floor(new Date("2026-04-01T00:00:00Z")).toISOString());
    });

    test("a pinned range is authoritative — out-of-range events are culled (#326)", () => {
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [
                tev(new Date("2026-03-29T09:00:00Z"), "BeforeMin"),  // < min → dropped
                tev(new Date("2026-03-31T09:00:00Z"), "InRange"),    // in window → kept
                tev(new Date("2026-04-02T09:00:00Z"), "AtMax"),      // == max (exclusive) → dropped
            ])],
            { range: { min: new Date("2026-03-30T00:00:00Z"), max: new Date("2026-04-02T00:00:00Z") } },
        ), "cull");
        // [Mar 30, Apr 2) → exactly three half-open day columns; the range is the
        // authority, so it neither grows to fit the stray events nor renders them.
        expect(headerLabels(container)).toEqual(["Mon 30", "Tue 31", "Wed 01"]);
        expect(screen.queryByText("InRange")).toBeTruthy();
        expect(screen.queryByText("BeforeMin")).toBeNull();
        expect(screen.queryByText("AtMax")).toBeNull();
    });

    test("an absurd extent × fine resolution truncates at the column cap with a warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { container } = renderPlanner(timeRoot(
            [row("Press A", [])],
            { range: { min: new Date(Date.UTC(2026, 0, 1)), max: new Date(Date.UTC(2027, 0, 1)) }, resolution: "hour" },
        ), "t9");
        expect(headerLabels(container).length).toBe(500);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("truncated"));
        warn.mockRestore();
    });
});
