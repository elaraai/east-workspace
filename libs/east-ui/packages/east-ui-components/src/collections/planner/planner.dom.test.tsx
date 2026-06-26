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
        expect(screen.getByText("N/A")).toBeTruthy();
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
