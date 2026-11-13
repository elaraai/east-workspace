/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Calendar's timeline shows the period chosen and scrolls only within it
 * (ruled 9 Nov 2026), as the Roster's grid does: Day a day, Week a week, Month
 * a month — its plot those days exactly, its scroll no further. A scroll to
 * either end, again and again, moves neither the period nor its label: the
 * period changes only by Previous and Next, Today, the date picker or a pick
 * of Search Records. Previous and Next each move it a period exactly, the view
 * kept where it was along the period, and a period narrower than the view is
 * drawn across the whole of it. On the indexed Calendar, on the real in-page
 * e3.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROUTE = "e3/calendar/calendar-records/calendarRecordIndexes";
const ROOT = "[data-calendar-frame]";
const DAY = 86_400_000;
/** The timeline's resource column, px: what every row starts with, beside its plot. */
const GUTTER = 184;

type Period = "day" | "week" | "month";
const PERIODS = ["day", "week", "month"] as const satisfies readonly Period[];
const LABELS: Record<Period, string> = { day: "Day", week: "Week", month: "Month" };

/**
 * The period a day falls in, as the Calendar's own: its day, its week from Monday — the Calendar's first day unless it
 * says otherwise, as this one does not — or its month.
 *
 * @param day - The day, as an epoch
 * @param period - The period
 * @returns Its half-open bounds, as epochs
 */
function periodOf(day: number, period: Period): { from: number; to: number } {
    const at = new Date(day);
    const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    if (period === "day") return { from: midnight, to: midnight + DAY };
    if (period === "week") {
        const from = midnight - ((at.getUTCDay() + 6) % 7) * DAY;
        return { from, to: from + 7 * DAY };
    }
    return { from: Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1), to: Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1) };
}

/**
 * What the timeline shows: the day its navigator stands on and the label it says, the window every row's plot carries,
 * and its scroll: where it is, the view's width and its box's — its scrollbar's gutter too — how far it goes, and the
 * plot's and the ruler's widths.
 */
function shown(frame: Locator) {
    return frame.evaluate((root) => {
        const navigation = root.querySelector<HTMLElement>("[data-time-navigation=calendar]")!;
        const timeline = root.querySelector<HTMLElement>("[data-calendar-timeline]")!;
        const cells = [...timeline.querySelectorAll<HTMLElement>("[data-calendar-cell]")];
        const windows = [...new Set(cells.map(cell => `${cell.dataset["calendarFrom"]}:${cell.dataset["calendarTo"]}`))];
        const [from, to] = (windows[0] ?? "NaN:NaN").split(":").map(Number) as [number, number];
        return {
            anchor: Number(navigation.dataset["timeAnchor"]),
            label: navigation.querySelector<HTMLElement>("[data-time-trigger]")?.title ?? "",
            windows: windows.length, from, to,
            left: timeline.scrollLeft, width: timeline.clientWidth, box: timeline.offsetWidth, scrollWidth: timeline.scrollWidth,
            plot: cells[0]?.getBoundingClientRect().width ?? 0,
            ruler: timeline.querySelector('[data-calendar-ruler="ticks"]')?.getBoundingClientRect().width ?? 0,
        };
    });
}

/**
 * Scrolls the timeline along time — to its start, to its end, or a px offset — and waits for the page at rest.
 *
 * @returns Where the browser took the view, read as the scroll is made: at its end, the browser's furthest, which a
 * headless browser's hidden scrollbars put short of `scrollWidth - clientWidth` by the gutter they keep
 */
async function scrollTimeline(page: Page, frame: Locator, to: "start" | "end" | number): Promise<number> {
    const went = await frame.locator("[data-calendar-timeline]").evaluate((timeline, at) => {
        timeline.scrollLeft = at === "start" ? 0 : at === "end" ? timeline.scrollWidth : at;
        return timeline.scrollLeft;
    }, to);
    await settled(page);
    return went;
}

test.describe("the Calendar's timeline shows the period chosen and scrolls only within it (ruled 9 Nov 2026) @desktop", () => {
    test("Day, Week and Month: the plot the period exactly, its scroll no further; a scroll to either end, again and again, moves neither the period nor its label; Previous and Next a period exactly, the view kept along it; a period narrower than the view drawn across it", async ({ page }) => {
        test.setTimeout(240_000);
        await page.setViewportSize({ width: 2560, height: 1200 });
        const entry = await visitBuilder(page, ROUTE, ROOT, "light");
        await sizeBuilder(page, entry, ROOT, 1440);
        const frame = entry.locator(ROOT).first();
        const toolbar = frame.locator('[data-frame-slot="toolbar"]');
        await toolbar.getByRole("radio", { name: "Timeline", exact: true }).click();
        await settled(page);
        for (const period of PERIODS) {
            await test.step(`${LABELS[period]}, its frame 1440px wide`, async () => {
                if (period !== "day") {
                    await toolbar.getByRole("radio", { name: LABELS[period], exact: true }).click();
                    await settled(page);
                }
                const opened = await shown(frame);
                // The plot is the period, exactly — every row's the same — and the scroll goes no further: the resource
                // column, then the period's days, at least the period's own width a day and wider than the view here.
                expect({ windows: opened.windows, from: opened.from, to: opened.to }, "the plot's window").toEqual({ windows: 1, ...periodOf(opened.anchor, period) });
                expect(opened.scrollWidth, "the scroll's width: the resource column and the plot").toBeCloseTo(GUTTER + opened.plot, 0);
                expect(opened.scrollWidth, "the period wider than the view at 1440").toBeGreaterThan(opened.width);
                // To either end, again and again: the view stays where the scroll took it, and the period, its label and
                // the day the navigator stands on stay as they were.
                for (const [i, end] of (["end", "start", "end", "start", "end", "start"] as const).entries()) {
                    const went = await scrollTimeline(page, frame, end);
                    const now = await shown(frame);
                    const where = `scroll ${i + 1}, to its ${end}`;
                    // Its end the browser's furthest: past the scroll width less the view's whole box, its gutter too.
                    if (end === "end") expect(went, `${where}: the scroll went to the end`).toBeGreaterThanOrEqual(now.scrollWidth - now.box - 0.5);
                    else expect(went, `${where}: the scroll went to the start`).toBe(0);
                    expect(now.left, `${where}: the view where the scroll took it`).toBeCloseTo(went, 0);
                    expect({ anchor: now.anchor, label: now.label, windows: now.windows, from: now.from, to: now.to }, `${where}: the period and its label`)
                        .toEqual({ anchor: opened.anchor, label: opened.label, windows: 1, from: opened.from, to: opened.to });
                }
                // Next, then Previous: a period on and back, exactly, and the view where it was along the period.
                const along = Math.round((opened.scrollWidth - opened.width) / 3);
                await scrollTimeline(page, frame, along);
                await toolbar.getByRole("button", { name: `Next ${period}`, exact: true }).click();
                await settled(page);
                const next = await shown(frame);
                expect({ windows: next.windows, from: next.from, to: next.to }, "Next: the period after").toEqual({ windows: 1, ...periodOf(opened.to, period) });
                expect(next.left, "Next: the view kept along the period").toBeCloseTo(Math.min(along, next.scrollWidth - next.width), 0);
                await toolbar.getByRole("button", { name: `Previous ${period}`, exact: true }).click();
                await settled(page);
                const back = await shown(frame);
                expect({ windows: back.windows, from: back.from, to: back.to, label: back.label }, "Previous: the period it opened on")
                    .toEqual({ windows: 1, from: opened.from, to: opened.to, label: opened.label });
                expect(back.left, "Previous: the view kept along the period").toBeCloseTo(Math.min(along, back.scrollWidth - back.width), 0);
            });
        }
        // A frame wider than a week or a month at their own width a day: the period drawn across the whole view, the
        // ruler over it, and nothing to scroll.
        await sizeBuilder(page, entry, ROOT, 2400);
        for (const period of ["week", "month"] as const) {
            await test.step(`${LABELS[period]}, its frame 2400px wide`, async () => {
                await toolbar.getByRole("radio", { name: LABELS[period], exact: true }).click();
                await settled(page);
                const wide = await shown(frame);
                expect({ windows: wide.windows, from: wide.from, to: wide.to }, "the plot's window").toEqual({ windows: 1, ...periodOf(wide.anchor, period) });
                expect(wide.scrollWidth, "nothing to scroll").toBeLessThanOrEqual(wide.width);
                expect(wide.plot, "the plot across the view beside the resource column").toBeCloseTo(wide.width - GUTTER, 0);
                expect(wide.ruler, "the ruler over the plot").toBeCloseTo(wide.plot, 0);
            });
        }
    });
});
