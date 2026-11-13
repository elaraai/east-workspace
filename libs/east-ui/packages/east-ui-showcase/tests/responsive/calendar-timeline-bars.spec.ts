/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Calendar's timeline draws its events in the middle of their rows: each
 * row's plot as tall as its row, its rule aside, and its bars a block in the
 * plot's middle — as much room above its first lane as below its last — and
 * each shade bar too. At Day, Week and Month; on rows of one lane (the
 * operations Calendar's machines and people) and of several (the indexed
 * Calendar's presses); and on rows whose head needs more height than their
 * lanes, as a compact density's rows do, which the spec makes by giving every
 * head a taller least height. Measured in the page: its layout's geometry, on
 * the real in-page e3.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROOT = "[data-calendar-frame]";
const ROUTES = {
    /** Its presses' jobs overlap: rows of six lanes and more. */
    indexed: "e3/calendar/calendar-records/calendarRecordIndexes",
    /** Its machines' and people's events do not: rows of one lane. */
    operations: "e3/calendar/calendar/calendarOperations",
} as const;
type Period = "Day" | "Week" | "Month";
const PERIODS: readonly Period[] = ["Day", "Week", "Month"];
/** How far apart the gaps above and below may be, px: a row's height may be a fraction of a pixel, as its head's text makes it. */
const LEEWAY = 1;
/** The least height the spec gives every row's head, px: taller than a row of one lane. */
const TALL_HEAD = 72;

/** A timeline row's geometry, px: what it holds and where its bars and shade bars stand in its plot. */
interface RowBars {
    readonly name: string;
    /** The row's height, its rule in. */
    readonly row: number;
    /** Its rule's width. */
    readonly rule: number;
    /** The head's height. */
    readonly head: number;
    /** The plot's top, from the row's top, and its height. */
    readonly plotTop: number;
    readonly plot: number;
    /** The lanes its bars stand in: their distinct tops. */
    readonly lanes: number;
    /** The gap above its first lane's bars and below its last's; `null` with no bar. */
    readonly above: number | null;
    readonly below: number | null;
    /** Each shade bar's gaps above and below. */
    readonly shades: readonly { readonly above: number; readonly below: number }[];
}

/** Each timeline row mounted, and where its bars stand in it. */
function rowsOf(frame: Locator): Promise<RowBars[]> {
    return frame.evaluate((root) => [...root.querySelectorAll<HTMLElement>("[data-calendar-timeline] [data-calendar-resource-row]")].map((row): RowBars => {
        const r = row.getBoundingClientRect();
        const plot = row.querySelector<HTMLElement>("[data-calendar-cell]")!.getBoundingClientRect();
        const bars = [...row.querySelectorAll<HTMLElement>("[data-calendar-event]")].map((bar) => bar.getBoundingClientRect()).filter((bar) => bar.height > 0);
        const top = Math.min(...bars.map((bar) => bar.top)), bottom = Math.max(...bars.map((bar) => bar.bottom));
        return {
            name: row.querySelector("[data-calendar-resource-title]")?.textContent ?? "",
            row: r.height,
            rule: parseFloat(getComputedStyle(row).borderBottomWidth),
            head: row.querySelector("[data-calendar-row-head]")!.getBoundingClientRect().height,
            plotTop: plot.top - r.top,
            plot: plot.height,
            lanes: new Set(bars.map((bar) => Math.round(bar.top - plot.top))).size,
            above: bars.length === 0 ? null : top - plot.top,
            below: bars.length === 0 ? null : plot.bottom - bottom,
            shades: [...row.querySelectorAll<HTMLElement>('[data-calendar-shade][data-along="x"]')].map((shade) => shade.getBoundingClientRect())
                .filter((shade) => shade.height > 0).map((shade) => ({ above: shade.top - plot.top, below: plot.bottom - shade.bottom })),
        };
    }));
}

/**
 * What is wrong of the rows' bars, each said with its row: a plot short of its row or not at its top, a block of bars
 * nearer one edge of the plot than the other, a shade bar the same.
 */
function offCentre(rows: readonly RowBars[]): string[] {
    const wrong: string[] = [];
    const px = (n: number) => `${Math.round(n * 100) / 100}px`;
    for (const row of rows) {
        if (Math.abs(row.plotTop) > 0.5 || Math.abs(row.plot - (row.row - row.rule)) > 0.5) {
            wrong.push(`${row.name}: its plot ${px(row.plot)} tall at ${px(row.plotTop)}, in a row ${px(row.row - row.rule)} tall`);
        }
        if (row.above !== null && row.below !== null && Math.abs(row.above - row.below) > LEEWAY) {
            wrong.push(`${row.name}: ${px(row.above)} above its bars and ${px(row.below)} below, in ${row.lanes} lane${row.lanes === 1 ? "" : "s"}`);
        }
        for (const shade of row.shades) {
            if (Math.abs(shade.above - shade.below) > LEEWAY) wrong.push(`${row.name}: ${px(shade.above)} above a shade bar and ${px(shade.below)} below`);
        }
    }
    return wrong;
}

test.describe("the Calendar's timeline draws its events in the middle of their rows @desktop", () => {
    test("Day, Week and Month, on rows of one lane and of several and on rows whose head is the taller: each plot as tall as its row, its bars as far from its top as from its bottom", async ({ page }) => {
        test.setTimeout(240_000);
        await page.setViewportSize({ width: 2560, height: 1200 });
        const lanes = new Set<number>();
        for (const [example, route] of Object.entries(ROUTES)) {
            const entry = await visitBuilder(page, route, ROOT, example === "indexed" ? "light" : undefined);
            await sizeBuilder(page, entry, ROOT, 1440);
            const frame = entry.locator(ROOT).first();
            const toolbar = frame.locator('[data-frame-slot="toolbar"]');
            await toolbar.getByRole("radio", { name: "Timeline", exact: true }).click();
            await settled(page);
            for (const period of PERIODS) {
                await test.step(`${example}, ${period}`, async () => {
                    await toolbar.getByRole("radio", { name: period, exact: true }).click();
                    await settled(page);
                    const rows = await rowsOf(frame);
                    const drawn = rows.filter((row) => row.lanes > 0);
                    expect(drawn.length, "rows with events drawn").toBeGreaterThan(0);
                    for (const row of drawn) lanes.add(Math.min(row.lanes, 2));
                    expect(offCentre(rows), "what is off the middle").toEqual([]);
                });
            }
            if (example !== "operations") continue;
            // Every head taller than a row of one lane, as a compact density's head is: the head decides the row, the
            // plot fills it, and the bars stay in its middle.
            await test.step("operations, Week, every head taller than its lanes", async () => {
                await toolbar.getByRole("radio", { name: "Week", exact: true }).click();
                await page.addStyleTag({ content: `[data-calendar-timeline] [data-calendar-row-head] { min-height: ${TALL_HEAD}px; }` });
                await settled(page);
                const rows = await rowsOf(frame);
                const drawn = rows.filter((row) => row.lanes === 1);
                expect(drawn.length, "rows of one lane drawn").toBeGreaterThan(0);
                for (const row of drawn) expect(row.head, `${row.name}: its head`).toBeCloseTo(TALL_HEAD, 0);
                expect(offCentre(rows), "what is off the middle").toEqual([]);
            });
        }
        // Both kinds of row were measured: of one lane, and of several.
        expect([...lanes].sort(), "the rows measured: of one lane, and of several").toEqual([1, 2]);
    });
});
