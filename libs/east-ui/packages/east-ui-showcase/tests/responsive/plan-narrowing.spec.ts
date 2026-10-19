/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Plan's narrowing (#1344) on the real in-page e3: the print works' one
 * rail over its ten records — the jobs' and the shifts', read through their
 * interval indexes, the presses', the customers' and each templates record's.
 * At every width of its frame, in both themes, the rail stands in the
 * toolbar's one row, nothing leaving it, and every source's field is in it —
 * live, folded to its chip, or named by its one trigger — but the jobs' and
 * the shifts' start, which is the one window, the date navigator's and never a
 * field of the rail.
 *
 * Each source narrows its own places alone: the presses' Hall the presses'
 * rows, never the crews'; the customers' District the Customers tab, `6 of
 * 16`; and a stock the jobs on the canvas and the Backlog, which counts `N of
 * M`. At every width the Customers tab, or the collapsed pane's badge, says
 * what it shows.
 *
 * The window is every event source's: the date navigator's Range panel, its
 * arrows and the horizon brush each write it into the jobs' source and the
 * shifts' alike, and the rail counts each kind's events in it: the toolbar's
 * summary while the window hides some, or, the row short of room, the rail's
 * editor — the jobs in their heading, the shifts, which have no field of the
 * rail's, in the line under the fields (#1340, #1358).
 *
 * The Filters popover counts each source in its heading — the total, or `N of
 * M` while narrowed — on the heading's line, and no line repeats a count or
 * names a source a narrowing hides nothing of (#1358).
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { PLAN_EVENT_EXAMPLES, openExample, rowSel, sizePlanFrame } from "./plan-page";
import { expectSourceCounts } from "./record-counts";
import { recordField } from "./record-slice";
import { settled } from "./settle";

/** The rail, in the toolbar's row. */
const RAIL = '[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]';
/** The rail's fields, as `source.field`, sorted: every source's but the jobs' and the shifts' start, which is the window. */
const FIELDS = "bindingTemplates.group,customers.district,deliveryTemplates.group,job.stock,jobTemplates.group,platesTemplates.group,presses.hall,shiftTemplates.group,stopTemplates.group";
/** Each field's label, as the folded rail's one trigger names the fields it holds. */
const LABELS = ["Stock", "Hall", "District", "Job templates", "Stop templates", "Shift templates", "Plates templates", "Bindery templates", "Delivery templates"];

/** The print works' frame. */
const frameOf = (entry: Locator) => entry.locator("[data-plan-frame]").first();

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

/** Opens a library tab by its name: on the row, or — the row short of room — from its menu of folded tabs. */
async function openTab(page: Page, start: Locator, name: RegExp): Promise<void> {
    const tab = start.locator('[role="tab"]', { hasText: name });
    if (await tab.count() > 0) await tab.click();
    else {
        await start.getByRole("button", { name: /^\d+ more tabs?$/ }).click();
        await page.getByRole("menuitem", { name }).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
    }
    await settled(page);
}

/**
 * Waits for the rail to count the jobs and the shifts in the window as given,
 * each `[shown, total]` — both held by the window, so narrowed — where it gives
 * them ({@link expectSourceCounts}).
 */
async function expectCounts(page: Page, frame: Locator, jobs: readonly [number, number], shifts: readonly [number, number]): Promise<void> {
    await expectSourceCounts(page, frame, RAIL, {
        job: { shown: jobs[0], total: jobs[1], narrowed: true, noun: "print job events" },
        shift: { shown: shifts[0], total: shifts[1], narrowed: true, noun: "crew shift events" },
    });
}

/** Each source heading the rail's sources get in its editor, by source: its heading's own count, as a Library tab counts — the total, or `N of M` while narrowed. */
const HEADINGS: Readonly<Record<string, RegExp>> = {
    job: /^22 of 30$/, presses: /^6$/, customers: /^16$/, jobTemplates: /^4$/, stopTemplates: /^2$/,
    shiftTemplates: /^3$/, platesTemplates: /^1$/, bindingTemplates: /^1$/, deliveryTemplates: /^1$/,
};

/**
 * The rail's editor as it counts its sources (#1358): each source heading's
 * count, and whether it sits on its heading's line inside the popover; and
 * the sources a line under the fields counts, each with its `N of M`.
 */
const editorCounts = (dialog: Locator) => dialog.evaluate((popover) => {
    const box = popover.getBoundingClientRect();
    const heads = [...popover.querySelectorAll("[data-slice-group^='source:']")].map((head) => {
        const count = head.querySelector("[data-rail-group-count]");
        const b = head.getBoundingClientRect(), c = count?.getBoundingClientRect();
        return {
            source: head.getAttribute("data-slice-group")!.slice("source:".length),
            count: (count?.textContent ?? "").replace(/\s+/g, " ").trim(),
            // On its heading's line, and inside the popover.
            placed: c !== undefined && c.width > 0 && c.top >= b.top - 0.5 && c.bottom <= b.bottom + 0.5 && c.left >= box.left - 0.5 && c.right <= box.right + 0.5,
        };
    });
    const line = [...popover.querySelectorAll("[data-record-slices-summary] [data-record-slice-source]")].map((el) => ({
        source: el.getAttribute("data-record-slice-source")!,
        said: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    }));
    return { heads, line };
});

for (const theme of ["light", "dark"] as const) {
    test(`the Filters popover counts each source in its heading, on its line — the total, or N of M while narrowed — and a line under the fields names only what no heading counts and a narrowing hides rows of (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
        const frame = frameOf(entry);
        // A phone's frame: the rail folds into its one trigger, whose editor heads each source's fields.
        await sizePlanFrame(page, entry, 390);
        await frame.locator(`${RAIL} button[aria-label^="Filters:"]`).first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toHaveCount(1);
        await expect.poll(async () => (await editorCounts(dialog)).heads.every((head) => head.count !== "")).toBe(true);
        const { heads, line } = await editorCounts(dialog);
        // Every source with fields is headed, each with its count on its own line.
        expect(heads.map((head) => head.source).sort()).toEqual(Object.keys(HEADINGS).sort());
        for (const head of heads) {
            expect(head.count, head.source).toMatch(HEADINGS[head.source]!);
            expect(head.placed, `${head.source}'s count on its heading's line, inside the popover`).toBe(true);
        }
        // No count twice, and none saying nothing: the line names only sources no heading counts, each hiding rows.
        for (const named of line) {
            expect(heads.some((head) => head.source === named.source), `${named.source} counted in its heading and the line`).toBe(false);
            const counted = named.said.match(/^([\d,]+) of ([\d,]+) /);
            expect(counted, `${named.source}'s count, landed: ${named.said}`).not.toBeNull();
            const [shown, total] = counted!.slice(1).map((n) => Number(n.replace(/,/g, "")));
            expect(shown!, `${named.said}: a narrowing hides rows of it`).toBeLessThan(total!);
        }
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
    });

    test(`the one rail stands at every width, nothing leaving the toolbar, every source's field in it but the window's dates (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
        const frame = frameOf(entry);
        for (const width of [1920, 1440, 1024, 768, 390, 360, 294]) {
            await sizePlanFrame(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            // The rail is in the row, every source's field in it: live, folded to its chip, or in its one trigger's name.
            await expect(frame.locator(RAIL).first(), `${width}px`).toBeVisible();
            const shown = await railFields(frame);
            expect(shown.named || shown.fields === FIELDS, `${width}px: ${JSON.stringify(shown)}`).toBe(true);
            // The jobs' and the shifts' start is the one window — the date navigator's, never the rail's.
            expect(shown.dates, `${width}px: the trigger names the dates`).toBe(false);
            await expect(frame.locator(`${RAIL} [data-record-slice-field="start"]`), `${width}px`).toHaveCount(0);
        }
    });

    test(`each source narrows its own places alone: the presses' Hall their rows, never the crews'; the customers' District the Customers tab, \`6 of 16\`; a stock the jobs on the canvas and the Backlog, \`N of M\`; at every width the Customers tab, or the pane's badge, says what it shows (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
        await sizePlanFrame(page, entry, 1920);
        const frame = frameOf(entry);
        const start = frame.locator('[data-frame-slot="start"]');
        const choose = async (source: string, field: string, value: RegExp) => {
            const editor = await recordField(page, frame, field, source);
            await editor.getByRole("button", { name: value }).first().click();
            await page.keyboard.press("Escape");
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await settled(page);
        };
        await expect.poll(() => tabs(page, start)).toEqual(["Events 12", "Backlog 8", "Series 15", "Customers 16"]);
        // The presses' Hall: the presses' rows, and their group strips; the crews follow no source.
        await expect(frame.locator(rowSel("presses.span", "Hall B", "b1"))).toHaveCount(1);
        await choose("presses", "hall", /^Hall A/);
        await expect(frame.locator(rowSel("presses.span", "Hall B", "b1"))).toHaveCount(0);
        await expect(frame.locator(rowSel("presses.span", "Hall A", "a1"))).toHaveCount(1);
        await expect(frame.locator(rowSel("crews.cards", "Hall B", "c3"))).toHaveCount(1);
        await expect.poll(() => tabs(page, start)).toEqual(["Events 12", "Backlog 8", "Series 15", "Customers 16"]);
        // The customers' District: the Customers tab, which names the customers' source, alone.
        await choose("customers", "district", /^Old Town/);
        await expect.poll(() => tabs(page, start)).toEqual(["Events 12", "Backlog 8", "Series 15", "Customers 6 of 16"]);
        // A stock: the jobs on the canvas — Press A1's menu cards are on board, its spring catalogue is coated — and the Backlog.
        const a1 = frame.locator(`${rowSel("presses.span", "Hall A", "a1")} [data-run]`);
        await expect.poll(async () => (await said(a1)).some((text) => text.includes("Spring catalogue"))).toBe(true);
        await choose("job", "stock", /^board/i);
        await expect.poll(async () => (await said(a1)).some((text) => text.includes("Spring catalogue"))).toBe(false);
        await expect.poll(async () => (await said(a1)).some((text) => text.includes("Menu cards"))).toBe(true);
        await expect.poll(() => tabs(page, start)).toEqual(["Events 12", "Backlog 1 of 8", "Series 15", "Customers 6 of 16"]);
        // The Customers tab open: the open tab stays on the row, however narrow the pane.
        await openTab(page, start, /^Customers/);
        // At every width the Customers tab says what it shows — or, the pane on its rail, its badge counts the backlog — the row whole.
        for (const width of [1920, 1440, 1024, 768, 560, 390, 360]) {
            await sizePlanFrame(page, entry, width);
            const collapsed = await start.evaluate((el) => el.hasAttribute("data-collapsed"));
            if (collapsed) {
                await expect(start.locator("[data-dock-badge]"), `${width}px, collapsed`).toHaveText("1");
            } else {
                expect((await tabs(page, start)).find((tab) => tab.startsWith("Customers")), `${width}px, open`).toBe("Customers 6 of 16");
            }
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test(`the window is every event source's: the Range panel, the date navigator and the brush each move the jobs' and the shifts' counts together (${theme}) @desktop`, async ({ page }) => {
        // The Range panel's presets are relative to now: the last seven days from noon on the 20th run from noon on the 13th.
        await page.clock.setFixedTime(new Date("2026-10-20T12:00:00Z"));
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
        await sizePlanFrame(page, entry, 1920);
        const frame = frameOf(entry);
        const nav = frame.locator("[data-time-navigation=plan]");
        // The axis's four weeks, 5 October to 2 November: every scheduled job and every shift, the backlog's eight jobs outside it.
        await expectCounts(page, frame, [22, 30], [24, 24]);
        // The Range panel, the jobs' start: the last seven days, noon on the 13th to noon on the 20th, written into the
        // shifts' source exactly as the jobs' holds it — the canvas draws the eight days they touch.
        await nav.locator("[data-time-trigger]").click();
        await page.getByRole("dialog").getByRole("radio", { name: "Range", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "7d", exact: true }).click();
        await page.keyboard.press("Escape");
        await expect(page.locator("[role=dialog][data-state=open]")).toHaveCount(0);
        await expect(nav).toHaveAttribute("data-time-anchor", String(Date.UTC(2026, 9, 13)));
        await expectCounts(page, frame, [9, 30], [9, 24]);
        // The navigator's arrows, two days on: its eight whole days from the 15th to the 23rd, in both sources.
        for (let step = 0; step < 2; step++) {
            await nav.locator("[data-time-trigger]").click();
            await page.getByRole("dialog").getByRole("button", { name: "Next day", exact: true }).click();
            await expect(page.locator("[role=dialog][data-state=open]")).toHaveCount(0);
        }
        await expect(nav).toHaveAttribute("data-time-anchor", String(Date.UTC(2026, 9, 15)));
        await expectCounts(page, frame, [8, 30], [6, 24]);
        // The brush: the lens's body slid three days on, the 18th to the 26th, committed once on release into both sources.
        const track = frame.locator('[data-slot="horizon"] [data-brush-track]');
        await track.scrollIntoViewIfNeeded();
        await track.hover();
        const lens = await frame.locator("[data-plan-lens] line").evaluateAll((lines) => lines.map((line) => Number(line.getAttribute("x1")) / 1000));
        const [from, to] = lens as [number, number];
        const box = (await track.boundingBox())!;
        // The lens spans the window's eight days.
        const day = (to - from) / 8;
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width * (from + to) / 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * ((from + to) / 2 + 3 * day), y, { steps: 12 });
        // A record's query moves once a gesture: while the lens is held the window is where it was.
        await expect(nav).toHaveAttribute("data-time-anchor", String(Date.UTC(2026, 9, 15)));
        await page.mouse.up();
        await expect(nav).toHaveAttribute("data-time-anchor", String(Date.UTC(2026, 9, 18)));
        await expectCounts(page, frame, [6, 30], [4, 24]);
    });
}
