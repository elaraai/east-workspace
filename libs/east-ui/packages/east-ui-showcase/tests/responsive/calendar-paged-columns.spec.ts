/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Calendar's Resources view over a paged resource kind (#1424), on the
 * real in-page e3: two thousand presses, a column each and the Unassigned one
 * after them, in a content box as wide as every column at a resource column's
 * least — and only the columns around the view drawn, each at its own offset,
 * where it would stand with every column drawn, never a grid track a column.
 * In both themes:
 *
 * - The content is as wide as the hour column and every column.
 * - Each column drawn sits at its place's offset, a column wide, its head over
 *   it at the same left and width, the next column where it ends; the hour
 *   column stays pinned at the view's left.
 * - Scrolled to the far end, the columns there draw the same way, the
 *   Unassigned one last, its right edge the content's.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROUTE = "e3/calendar/calendar-windows/calendarWindows";
const ROOT = "[data-calendar-frame]";
/** The hour column's width, and a resource column's least: the recipe's. */
const HOURS = 56;
const COLUMN = 104;

/** The Resources view's columns drawn, as the page lays them out, px from the content box's left. */
interface Drawn {
    /** How many columns the view lays out. */
    readonly count: number;
    /** The content box's width. */
    readonly width: number;
    /** Where the hour column sits, from the view's left. */
    readonly hours: number;
    /** Each column drawn: its place, its left and width, its head's, and its head's words. */
    readonly columns: readonly { readonly at: number; readonly left: number; readonly width: number; readonly head: { left: number; width: number } | null; readonly name: string }[];
}

/** The time grid's scroll box in the Calendar's main. */
const gridOf = (entry: Locator) => entry.locator("[data-calendar-main] [data-calendar-time-grid]").first();

/** Chooses a layout: its radio where the toolbar shows it, else through the View it is folded into. */
async function layout(page: Page, frame: Locator, name: string) {
    const radio = frame.getByRole("radio", { name, exact: true });
    if (await radio.isVisible()) await radio.click();
    else {
        await frame.getByRole("button", { name: "View", exact: true }).click();
        const choice = page.getByRole("menuitem", { name, exact: true });
        if (await choice.isVisible()) await choice.click();
        else { await page.getByRole("dialog").getByRole("radio", { name, exact: true }).click(); await page.keyboard.press("Escape"); }
    }
    await settled(page);
}

function drawnOf(grid: Locator): Promise<Drawn> {
    return grid.evaluate((el): Drawn => {
        const content = el.firstElementChild as HTMLElement;
        const box = content.getBoundingClientRect();
        const heads = new Map([...el.querySelectorAll<HTMLElement>("[data-calendar-header] > [data-calendar-column]")]
            .map((head) => [head.dataset["calendarColumn"]!, head] as const));
        const columns = [...el.querySelectorAll<HTMLElement>("[data-calendar-gutter] ~ [data-calendar-column]")].map((column) => {
            const at = column.dataset["calendarColumn"]!;
            const rect = column.getBoundingClientRect();
            const head = heads.get(at);
            const headRect = head?.getBoundingClientRect();
            return {
                at: Number(at), left: rect.left - box.left, width: rect.width,
                head: headRect === undefined ? null : { left: headRect.left - box.left, width: headRect.width },
                name: head?.querySelector("[data-calendar-resource-title]")?.textContent?.trim() ?? "",
            };
        }).sort((a, b) => a.at - b.at);
        return {
            count: Number(content.style.getPropertyValue("--calendar-columns")), width: box.width,
            hours: el.querySelector("[data-calendar-gutter]")!.getBoundingClientRect().left - el.getBoundingClientRect().left,
            columns,
        };
    });
}

/** What is wrong with the columns drawn, in words. */
function faults(drawn: Drawn): string[] {
    const bad: string[] = [];
    const expected = HOURS + drawn.count * COLUMN;
    if (Math.abs(drawn.width - expected) > 1) bad.push(`the content ${drawn.width}px wide, every column's ${expected}px`);
    if (Math.abs(drawn.hours) > 1) bad.push(`the hour column ${drawn.hours}px from the view's left`);
    if (drawn.columns.length === 0) bad.push("no column drawn");
    if (drawn.columns.length > 60) bad.push(`${drawn.columns.length} columns drawn`);
    drawn.columns.forEach((column, i) => {
        const left = HOURS + column.at * COLUMN;
        if (Math.abs(column.left - left) > 1) bad.push(`column ${column.at} at ${column.left}px, its place ${left}px`);
        if (Math.abs(column.width - COLUMN) > 1) bad.push(`column ${column.at} ${column.width}px wide`);
        if (column.head === null) bad.push(`column ${column.at} has no head`);
        else if (Math.abs(column.head.left - column.left) > 1 || Math.abs(column.head.width - column.width) > 1) {
            bad.push(`column ${column.at}'s head at ${column.head.left}px, ${column.head.width}px wide, over ${column.left}px, ${column.width}px`);
        }
        const last = drawn.columns[i - 1];
        if (last !== undefined && last.at === column.at - 1 && Math.abs(column.left - (last.left + last.width)) > 1) {
            bad.push(`column ${column.at} at ${column.left}px, the last ending at ${last.left + last.width}px`);
        }
    });
    return bad;
}

for (const theme of ["light", "dark"] as const) {
    test(`the Resources view lays two thousand paged presses out a column each, drawing those around the view at their own offsets (#1424) (${theme}) @desktop`, async ({ page }) => {
        const entry = await visitBuilder(page, ROUTE, ROOT, theme);
        await layout(page, entry.locator(ROOT).first(), "Resources");
        const grid = gridOf(entry);
        // At the start: the first presses' columns, in their key order.
        await expect.poll(async () => (await drawnOf(grid)).columns[0]?.name, { message: "the first press's column, named" }).toBe("Press 1001");
        const start = await drawnOf(grid);
        expect(start.count, "every press a column, and the Unassigned one").toBe(2001);
        expect(faults(start), `the start (${theme})`).toEqual([]);
        // To the far end: the columns there drawn the same way, the Unassigned one last, at the content's right edge.
        await grid.evaluate((el) => { el.scrollLeft = el.scrollWidth - el.clientWidth; });
        await expect.poll(async () => (await drawnOf(grid)).columns.at(-1)?.name, { message: "the last column, Unassigned" }).toBe("Unassigned");
        await settled(page);
        const end = await drawnOf(grid);
        expect(faults(end), `the far end (${theme})`).toEqual([]);
        const last = end.columns.at(-1)!;
        expect({ at: last.at, right: Math.round(last.left + last.width) }, "the Unassigned column ends the content").toEqual({ at: end.count - 1, right: Math.round(end.width) });
    });
}
