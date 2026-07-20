/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Calendar heatmap surface: the eight-step ramp fills each cell (with the
 * on-ramp ink flip), missing cells render the hatched empty fill, the weekly
 * totals rail and the per-weekday aggregate row reduce with the shared
 * sum/mean vocabulary, and selecting a cell populates the footer (value /
 * compare / delta chip) and cross-highlights its row + column.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraCalendar, type CalendarValue, type CalendarCellValue } from "./index.js";

afterEach(cleanup);

function cell(week: string, day: string, value: number, over: { compare?: number; text?: string } = {}): CalendarCellValue {
    return {
        week, day, value,
        text: over.text ?? String(value),
        compare: over.compare !== undefined ? some(over.compare) : none,
        summary: none,
    };
}

const AGG = (tag: string) => variant(tag, null);

function calendarValue(over: Partial<CalendarValue> = {}): CalendarValue {
    return {
        cells: [
            cell("W1", "Mon", 96, { compare: 89 }), cell("W1", "Tue", 100), cell("W1", "Thu", 131, { compare: 112 }),
            cell("W2", "Mon", 112), cell("W2", "Tue", 130), cell("W2", "Thu", 154),
        ],
        values: true,
        scale: none,
        domain: none,
        totals: none,
        aggregateRow: none,
        footer: none,
        actionLabel: none,
        onAction: none,
        onSelect: none,
        density: none,
        plotGutter: none,
        height: none,
        maxHeight: none,
        ...over,
    } as CalendarValue;
}

function renderCal(value: CalendarValue) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraCalendar value={value} storageKey="t" />
        </ChakraProvider>,
    );
}

describe("EastChakraCalendar", () => {
    test("renders the day headers, week labels, values, and a hatched empty cell", () => {
        renderCal(calendarValue());
        for (const day of ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]) expect(screen.getByText(day)).toBeTruthy();
        expect(screen.getByText("W1")).toBeTruthy();
        expect(screen.getByText("131")).toBeTruthy();
        // W1/Wed and W1/Fri..Sun are absent → hatched empty cells (text "–").
        expect(document.querySelectorAll("[data-empty]").length).toBeGreaterThan(0);
    });

    test("values={false} drops the in-cell numbers", () => {
        renderCal(calendarValue({ values: false } as Partial<CalendarValue>));
        expect(screen.queryByText("131")).toBeNull();
    });

    test("the totals rail reduces each week by sum with the rail header", () => {
        renderCal(calendarValue({
            totals: some({ aggregate: AGG("sum"), label: "Σ wk", bar: true }),
        } as Partial<CalendarValue>));
        expect(screen.getByText("Σ wk")).toBeTruthy();
        // W1 = 96 + 100 + 131 = 327; W2 = 112 + 130 + 154 = 396.
        expect(screen.getByText("327")).toBeTruthy();
        expect(screen.getByText("396")).toBeTruthy();
    });

    test("the aggregate row reduces each weekday by mean", () => {
        renderCal(calendarValue({
            aggregateRow: some({ aggregate: AGG("mean"), label: "mean" }),
        } as Partial<CalendarValue>));
        expect(screen.getByText("mean")).toBeTruthy();
        // Mon mean = round((96 + 112) / 2) = 104; Thu mean = round((131 + 154) / 2) = 143.
        expect(screen.getByText("104")).toBeTruthy();
        expect(screen.getByText("143")).toBeTruthy();
    });

    test("selecting a cell fills the footer with value, compare, and the delta chip", () => {
        renderCal(calendarValue({
            footer: some({ valueLabel: "predicted", compareLabel: "last yr", legend: some({ low: "low", high: "high" }) }),
        } as Partial<CalendarValue>));
        // Before selection: the prompt.
        expect(screen.getByText(/pick a day/)).toBeTruthy();
        // Legend captions render.
        expect(screen.getByText("low")).toBeTruthy();
        expect(screen.getByText("high")).toBeTruthy();
        // Select W1/Thu = 131 (compare 112 → +17%).
        fireEvent.click(screen.getByText("131"));
        expect(screen.getByText("predicted")).toBeTruthy();
        expect(screen.getByText("last yr")).toBeTruthy();
        expect(screen.getByText("Thu W1")).toBeTruthy();
        expect(screen.getByText("▲ +17%")).toBeTruthy();
    });
});
