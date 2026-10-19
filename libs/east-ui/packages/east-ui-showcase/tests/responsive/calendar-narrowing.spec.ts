/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Calendar's narrowing (#1343) on the real in-page e3: the operations
 * calendar's one rail over its eight records — each event kind's, read
 * through its interval indexes, the machines', the people's and each
 * templates record's. At every width, in both themes, the rail stands in the
 * toolbar's one row, nothing leaving it, and every source's field is in it —
 * live, folded to its chip, or named by its one trigger — but the event
 * kinds' start, which is the one date window, the time navigator's and never
 * a field of the rail.
 *
 * Each source narrows its own places alone, and the rail counts each in its
 * own words — the summary the sources a narrowing hides rows of, the folded
 * editor each source in its heading (#1358): the machines' Area narrows the Resources layout's
 * machine columns; a templates record's group, the Templates tab, `Templates
 * 5 of 6`; the people's Team, the Technicians tab, `Technicians 2 of 3`, and
 * the people's columns; and a production status, the production events and
 * the Backlog, which counts `N of M`, says so when it is emptied, and whose
 * Clear filters clears the status and keeps the window. At every width the
 * Templates tab, or the collapsed pane's badge, says what it shows.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { expectSourceCounts, type SourceCount } from "./record-counts";
import { recordField } from "./record-slice";
import { settled } from "./settle";

const HASH = "e3/calendar/calendar/calendarOperations";
/** The rail, in the toolbar's row. */
const RAIL = '[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]';
/** The rail's fields, as `source.field`, sorted: every source's but an event kind's start, which is the window. */
const FIELDS = "job.machine,job.status,jobTemplates.group,machines.area,people.team,service.machine,serviceTemplates.group,shift.person,shiftTemplates.group";
/** Each field's label, as the folded rail's one trigger names the fields it holds. */
const LABELS = ["Status", "Machine", "Person", "Area", "Team", "Job template", "Service template", "Shift template"];

/** Opens the operations calendar in a theme, at rest. */
async function open(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-calendar-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** Sets the width of the box the calendar's frame fills, and waits for the page at rest. */
async function size(page: Page, entry: Locator, width: number): Promise<void> {
    await entry.locator("[data-calendar-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

/**
 * Every source's field as the rail shows it at its width: a live chip, a
 * folded chip (`field:source.field`), or past those its one trigger, named for
 * every field it holds — and whether that trigger names the window's dates.
 */
const railFields = (frame: Locator) => frame.locator(RAIL).first().evaluate((rail, labels) => {
    const live = [...rail.querySelectorAll("[data-record-slice-source][data-record-slice-field]")].filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`);
    const folded = [...rail.querySelectorAll("[data-slice-fold^='field:']")].map((el) => el.getAttribute("data-slice-fold")!.slice(6));
    const trigger = rail.querySelector("button[aria-label^='Filters:']")?.getAttribute("aria-label") ?? "";
    return { fields: [...new Set([...live, ...folded])].sort().join(), named: labels.every((label) => trigger.includes(label)), dates: trigger.includes("Dates") };
}, LABELS);

/** What each element says, its whitespace folded. */
const said = (els: Locator) => els.evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()));

/** The nouns the operations calendar counts its sources in. */
const NOUNS = { job: "production events", jobTemplates: "production templates", machines: "machines", people: "people" } as const;

/**
 * A source's count: what it shows of its total, and whether a narrowing is in force on it — an event kind's always, its
 * window. The rail gives it in the toolbar's summary or, folded, in the editor's heading ({@link expectSourceCounts}).
 */
const counted = (source: keyof typeof NOUNS, shown: number, total: number, narrowed: boolean): [string, SourceCount] =>
    [source, { shown, total, narrowed, noun: NOUNS[source] }];

/** Waits for the rail to count each source as given. */
const expectSummary = (page: Page, frame: Locator, counts: readonly [string, SourceCount][]) =>
    expectSourceCounts(page, frame, RAIL, Object.fromEntries(counts));

/** The library's tabs as they read: those on its row, then those its row folded into its menu. */
async function tabs(page: Page, start: Locator): Promise<string[]> {
    const row = await said(start.locator('[role="tab"]'));
    const more = start.getByRole("button", { name: /^\d+ more tabs?$/ });
    if (await more.count() === 0) return row;
    await more.click();
    const menu = await said(page.getByRole("menuitem"));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    return [...row, ...menu];
}

for (const theme of ["light", "dark"] as const) {
    test(`the one rail stands at every width, nothing leaving the toolbar, every source's field in it but the window's dates (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, theme);
        const frame = entry.locator("[data-calendar-frame]").first();
        for (const width of [1920, 1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            // The rail is in the row, every source's field in it: live, folded to its chip, or in its one trigger's name.
            await expect(frame.locator(RAIL).first(), `${width}px`).toBeVisible();
            const shown = await railFields(frame);
            expect(shown.named || shown.fields === FIELDS, `${width}px: ${JSON.stringify(shown)}`).toBe(true);
            // The event kinds' start is the one date window — the time navigator's, never the rail's.
            expect(shown.dates, `${width}px: the trigger names the dates`).toBe(false);
            await expect(frame.locator(`${RAIL} [data-record-slice-field="start"]`), `${width}px`).toHaveCount(0);
        }
    });

    test(`each source narrows its own places alone, and the summary counts each in its own words; the Backlog counts \`N of M\`, says so emptied, and its Clear filters keeps the window; at every width the Templates tab, or the pane's badge, says what it shows (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, theme);
        await size(page, entry, 1920);
        const frame = entry.locator("[data-calendar-frame]").first();
        const start = frame.locator('[data-frame-slot="start"]');
        const choose = async (source: string, field: string, value: RegExp) => {
            const editor = await recordField(page, frame, field, source);
            await editor.getByRole("button", { name: value }).first().click();
            await page.keyboard.press("Escape");
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await settled(page);
        };
        const layout = async (name: string) => {
            await frame.getByRole("radiogroup", { name: "Layout", exact: true }).getByRole("radio", { name, exact: true }).click();
            await settled(page);
        };
        const columns = () => said(frame.locator("[data-calendar-resource-title]"));
        // The week of 1 Oct: six of the ten production events, every template, machine and person.
        await expectSummary(page, frame, [counted("job", 6, 10, true), counted("jobTemplates", 2, 2, false), counted("machines", 4, 4, false), counted("people", 3, 3, false)]);
        await expect.poll(() => tabs(page, start)).toEqual(["Templates 6", "Backlog 4", "Technicians 3"]);
        // The machines' Area: the machine columns the Resources layout draws, and no tab.
        await layout("Resources");
        await expect.poll(columns).toEqual(expect.arrayContaining(["Press 1", "Press 2", "Lathe 1", "Lathe 2", "A. Ash", "B. Birch", "C. Cedar"]));
        await choose("machines", "area", /^Press shop/);
        await expectSummary(page, frame, [counted("machines", 2, 4, true)]);
        await expect.poll(async () => (await columns()).filter((title) => title.startsWith("Lathe"))).toEqual([]);
        await expect.poll(columns).toEqual(expect.arrayContaining(["Press 1", "Press 2", "A. Ash", "B. Birch", "C. Cedar"]));
        await expect.poll(() => tabs(page, start)).toEqual(["Templates 6", "Backlog 4", "Technicians 3"]);
        // The people's Team: the Technicians tab, which names the people's source, and the people's columns.
        await choose("people", "team", /^Maintenance/);
        await expectSummary(page, frame, [counted("people", 2, 3, true)]);
        await expect.poll(async () => (await columns()).filter((title) => title === "B. Birch")).toEqual([]);
        await layout("Calendar");
        await expect.poll(() => tabs(page, start)).toEqual(["Templates 6", "Backlog 4", "Technicians 2 of 3"]);
        // The job templates' group: the Templates tab alone.
        await choose("jobTemplates", "group", /^Fabrication/);
        await expectSummary(page, frame, [counted("jobTemplates", 1, 2, true), counted("job", 6, 10, true)]);
        await expect.poll(() => tabs(page, start)).toEqual(["Templates 5 of 6", "Backlog 4", "Technicians 2 of 3"]);
        // A production status: the production events in the window, and the Backlog — emptied, it says so.
        await choose("job", "status", /^active/i);
        await expectSummary(page, frame, [counted("job", 1, 10, true)]);
        await expect.poll(() => tabs(page, start)).toEqual(["Templates 5 of 6", "Backlog 0 of 4", "Technicians 2 of 3"]);
        await start.locator('[role="tab"]', { hasText: /^Backlog/ }).click();
        await settled(page);
        const emptied = start.locator("[data-library-empty][data-narrowed]");
        await expect(emptied).toContainText("No backlog events match the filters");
        // Its Clear filters clears the status and keeps the window, and every other source's choice.
        await emptied.getByRole("button", { name: "Clear filters" }).click();
        await settled(page);
        await expectSummary(page, frame, [counted("job", 6, 10, true), counted("jobTemplates", 1, 2, true), counted("machines", 2, 4, true), counted("people", 2, 3, true)]);
        await expect.poll(() => tabs(page, start)).toEqual(["Templates 5 of 6", "Backlog 4", "Technicians 2 of 3"]);
        await start.locator('[role="tab"]', { hasText: /^Templates/ }).click();
        await settled(page);
        // At every width the Templates tab says what it shows — or, the pane on its rail, its badge counts the backlog — the row whole.
        for (const width of [1920, 1440, 1024, 768, 560, 390, 360]) {
            await size(page, entry, width);
            const read = await start.evaluate((el) => (el.hasAttribute("data-collapsed")
                ? { collapsed: true, said: el.querySelector("[data-dock-badge]")?.textContent ?? null }
                : { collapsed: false, said: (el.querySelector('[role="tab"]')?.textContent ?? "").replace(/\s+/g, " ").trim() }));
            expect(read.said, `${width}px, ${read.collapsed ? "collapsed" : "open"}`).toBe(read.collapsed ? "4" : "Templates 5 of 6");
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}
