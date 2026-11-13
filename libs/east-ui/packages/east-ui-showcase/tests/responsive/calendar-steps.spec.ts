/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Calendar's timeline steps (#1398) on the real in-page e3, with the
 * Calendar open in a second tab of the same browser, as a viewer keeps one:
 * the two tabs share the browser's storage, where the Calendar keeps its view
 * for a reload, and nothing else — each holds its own period. Each press of
 * Next moves the view's date exactly a period on and draws that period, the
 * date kept inside it, and tells the timeline to scroll nowhere: the view keeps
 * its place along the period (ruled 9 Nov 2026). The other tab never moves.
 * Day, Week and Month alike. A view another tab keeps — as the browser's
 * storage editor keeps one — moves nothing until a reload, which opens on it.
 *
 * Every scroll a timeline is told to make is recorded as it is written (an
 * init script over `scrollLeft`), so what is measured is the commits' order,
 * never a time.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROUTE = "e3/calendar/calendar-records/calendarRecordIndexes";
const ROOT = "[data-calendar-frame]";
const DAY = 86_400_000;

type Period = "day" | "week" | "month";
const LABELS: Record<Period, string> = { day: "Day", week: "Week", month: "Month" };
/** How many times Next is pressed at each period: past a week's end at Day, a month's at Week and a quarter's at Month. */
const PRESSES: Record<Period, number> = { day: 12, week: 8, month: 6 };

/** Records every scroll a Calendar timeline in the page is told to make, as it is written. Call before the page loads. */
async function recordScrolls(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const scope = window as unknown as { __calendarScrolls: number[] };
        scope.__calendarScrolls = [];
        const left = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft")!;
        Object.defineProperty(Element.prototype, "scrollLeft", {
            configurable: true,
            get(this: Element) { return left.get!.call(this) as number; },
            set(this: Element, value: number) {
                if (this.hasAttribute("data-calendar-timeline")) scope.__calendarScrolls.push(value);
                left.set!.call(this, value);
            },
        });
    });
}
/** The scrolls the page's timelines were told to make since it loaded, or since they were last forgotten. */
const scrollsOf = (page: Page) => page.evaluate(() => (window as unknown as { __calendarScrolls: number[] }).__calendarScrolls.slice());
const forgetScrolls = (page: Page) => page.evaluate(() => { (window as unknown as { __calendarScrolls: number[] }).__calendarScrolls.length = 0; });

/** What a tab's Calendar shows: the day its navigator steps from, the period its timeline's rows carry, and the view kept. */
function shown(frame: Locator) {
    return frame.evaluate((root) => {
        const navigation = root.querySelector<HTMLElement>("[data-time-navigation=calendar]")!;
        const cell = root.querySelector<HTMLElement>("[data-calendar-timeline] [data-calendar-cell]")!;
        const key = Object.keys(localStorage).find(name => name.endsWith(".calendarRecordIndexes.view"));
        const kept = key === undefined ? undefined : JSON.parse(localStorage.getItem(key)!) as { layout: string; period: string; date: number };
        return { anchor: Number(navigation.dataset["timeAnchor"]), from: Number(cell.dataset["calendarFrom"]), to: Number(cell.dataset["calendarTo"]), key, kept };
    });
}

/** A day a period on, as the navigator steps: a day, a week, or the same day of the next month, which every day below the 29th has. */
function stepOf(day: number, period: Period): number {
    if (period !== "month") return day + (period === "day" ? 1 : 7) * DAY;
    const at = new Date(day);
    expect(at.getUTCDate(), "a month's step from a day every month has").toBeLessThan(29);
    return Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** A tab of a browser context on the indexed Calendar, its frame 1440px wide. */
async function openTab(page: Page): Promise<Locator> {
    await recordScrolls(page);
    await page.setViewportSize({ width: 2560, height: 1200 });
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 1440);
    return entry.locator(ROOT).first();
}

/**
 * Two tabs on the indexed Calendar's timeline at a period, as a viewer keeps them: the first put there, and the second
 * opened after it, on the view it kept.
 */
async function twoTabs(page: Page, period: Period) {
    const first = await openTab(page);
    const toolbar = first.locator('[data-frame-slot="toolbar"]');
    await toolbar.getByRole("radio", { name: "Timeline", exact: true }).click();
    await settled(page);
    if (period !== "day") {
        await toolbar.getByRole("radio", { name: LABELS[period], exact: true }).click();
        await settled(page);
    }
    const other = await page.context().newPage();
    const second = await openTab(other);
    await page.bringToFront();
    expect(await shown(second).then(view => view.kept?.period), "the second tab opens on the view the first kept").toBe(period);
    await Promise.all([forgetScrolls(page), forgetScrolls(other)]);
    return { first, second, other, toolbar };
}

/** Presses Next in the first tab, each a period on ({@link PRESSES}), and holds both tabs to it after each. */
async function stepOn(page: Page, period: Period) {
    const { first, second, other, toolbar } = await twoTabs(page, period);
    const theirs = await shown(second);
    let at = await shown(first);
    for (let press = 1; press <= PRESSES[period]; press++) {
        await toolbar.getByRole("button", { name: `Next ${period}`, exact: true }).click();
        await settled(page);
        await settled(other);
        const now = await shown(first);
        const where = `press ${press} of Next ${period}`;
        // A period on, from the day it stepped from; the date kept is that day, inside the period drawn.
        expect(now.anchor, `${where}: the date a period on`).toBe(stepOf(at.anchor, period));
        expect(now.kept?.date, `${where}: the date kept`).toBe(now.anchor);
        expect(now.from <= now.anchor && now.anchor < now.to, `${where}: the date kept inside the period drawn`).toBe(true);
        // Neither tab's timeline told to scroll: a step keeps the view where it is along the period.
        expect([await scrollsOf(page), await scrollsOf(other)], `${where}: no scroll written`).toEqual([[], []]);
        at = now;
    }
    // The other tab's view is its own: where it was, its period and its date, all along.
    const after = await shown(second);
    expect({ anchor: after.anchor, from: after.from, to: after.to }, "the other tab where it was").toEqual({ anchor: theirs.anchor, from: theirs.from, to: theirs.to });
    return { first, second, other, at };
}

test.describe("the Calendar's timeline steps, open in two tabs (#1398) @desktop", () => {
    test("Week: each press of Next a week on, its date inside the week drawn, the timeline scrolled nowhere; another tab's kept view moves nothing until a reload opens on it", async ({ page }) => {
        test.setTimeout(240_000);
        const { first, other, at } = await stepOn(page, "week");
        // The other tab keeps a view three weeks on, as the browser's storage editor would: the first tab hears it, and moves nothing.
        await forgetScrolls(page);
        const edited = { ...at.kept!, date: at.anchor + 21 * DAY };
        await other.evaluate(({ key, view }) => { localStorage.setItem(key, JSON.stringify(view)); }, { key: at.key!, view: edited });
        await settled(page);
        expect({ anchor: (await shown(first)).anchor, scrolls: await scrollsOf(page) }, "the first tab, the other's view kept").toEqual({ anchor: at.anchor, scrolls: [] });
        expect((await shown(first)).kept, "nothing written over the view kept").toEqual(edited);
        // A reload opens on the view kept: the date edited, inside its period.
        await other.close();
        await page.reload();
        const entry = await visitBuilder(page, ROUTE, ROOT, undefined);
        await sizeBuilder(page, entry, ROOT, 1440);
        const reloaded = await shown(entry.locator(ROOT).first());
        expect({ anchor: reloaded.anchor, kept: reloaded.kept, inside: reloaded.from <= edited.date && edited.date < reloaded.to }, "reloaded")
            .toEqual({ anchor: edited.date, kept: edited, inside: true });
    });

    test("Day: each press of Next a day on, its date inside the day drawn, the timeline scrolled nowhere, the other tab where it was", async ({ page }) => {
        test.setTimeout(240_000);
        await stepOn(page, "day");
    });

    test("Month: each press of Next a month on, its date inside the month drawn, the timeline scrolled nowhere, the other tab where it was", async ({ page }) => {
        test.setTimeout(240_000);
        await stepOn(page, "month");
    });
});
