/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/** Calendar against the real in-page e3: responsive geometry, explicit phone edits and desktop drag. */
import { expect, test, type Locator, type Page } from "playwright/test";
import { frameAt } from "./builder-frame";
import { settled } from "./settle";
const FILE = "e3/calendar/calendar";
async function open(page: Page, name = "calendarOperations", theme: "light" | "dark" = "light") {
    await page.goto(`/?theme=${theme}#${FILE}/${name}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-calendar-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}
async function size(page: Page, entry: Locator, width: number) {
    await entry.locator("[data-calendar-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}
async function toolbarFaults(entry: Locator) {
    return entry.locator("[data-calendar-frame]").first().evaluate(root => {
        const band = root.querySelector('[data-frame-slot="toolbar"]')!;
        const row = band.querySelector('[data-toolbar]')!;
        const box = band.getBoundingClientRect(); const r = row.getBoundingClientRect();
        const bad: string[] = [];
        if (Math.abs(box.height - 44) > 0.5) bad.push(`toolbar height ${box.height}`);
        for (const item of row.querySelectorAll('[data-toolbar-item]')) {
            const b = item.getBoundingClientRect(); if (b.width === 0) continue;
            if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < box.top - 0.5 || b.bottom > box.bottom + 0.5) bad.push(`overflow ${item.getAttribute("data-toolbar-item")}`);
        }
        const ladder = (row.getAttribute("data-toolbar-ladder") ?? "").split(" ");
        if (ladder.some(step => step.startsWith("history>")) && !ladder.at(-1)?.startsWith("history>")) bad.push("history does not fold last");
        return bad;
    });
}
async function viewChoice(page: Page, frame: Locator, name: string) {
    const radio = frame.getByRole("radio", { name, exact: true });
    if (await radio.isVisible()) await radio.click();
    else { await frame.getByRole("button", { name: "View", exact: true }).click(); await page.getByRole("menuitem", { name, exact: true }).click(); }
    await settled(page);
}
async function movePointer(page: Page, source: Locator, x: number, y: number) {
    await source.scrollIntoViewIfNeeded();
    const box = (await source.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 2 });
    await page.mouse.move(x, y, { steps: 10 });
}
for (const theme of ["light", "dark"] as const) {
    test(`Calendar frame at 1440/1024/768/390/360 (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "calendarOperations", theme);
        for (const width of [1440, 1024, 768, 390, 360]) {
            await size(page, entry, width);
            expect(await toolbarFaults(entry), `${width}px toolbar`).toEqual([]);
            const frame = await frameAt(entry);
            const main = entry.locator("[data-calendar-main]").first();
            expect((await main.boundingBox())!.width).toBeGreaterThan(0);
            if (frame.main.w < 480) {
                await expect(entry.locator("[data-calendar-agenda]").first()).toBeVisible();
                await expect(entry.locator("[data-calendar-main] [data-draggable], [data-calendar-main] [data-edge], [data-calendar-main] [data-calendar-cell]")).toHaveCount(0);
                expect(await main.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
                const faults = await main.evaluate(root => [...root.querySelectorAll('[data-calendar-card]')].flatMap(card => {
                    const box = card.getBoundingClientRect(); const parent = root.getBoundingClientRect();
                    return box.left < parent.left - 1 || box.right > parent.right + 1 ? [card.textContent] : [];
                }));
                expect(faults).toEqual([]);
            } else {
                await expect(entry.locator("[data-calendar-time-grid]").first()).toBeVisible();
                expect(await main.evaluate(root => [...root.querySelectorAll('[data-calendar-event-title], [data-calendar-event-detail]')].flatMap(text => {
                    if (getComputedStyle(text).visibility === "hidden") return [];
                    const box = text.getBoundingClientRect(); const event = text.closest('[data-calendar-event]')!.getBoundingClientRect();
                    return box.left < event.left - 1 || box.right > event.right + 1 || box.top < event.top - 1 || box.bottom > event.bottom + 1
                        ? [text.textContent] : [];
                })), `${width}px event text stays within its block`).toEqual([]);
            }
        }
    });
    test(`Resources omits period controls in expanded and folded toolbars (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'calendarOperations', theme), frame = entry.locator('[data-calendar-frame]').first();
        await size(page, entry, 1440); await viewChoice(page, frame, 'Week');
        for (const width of [1440, 768, 360, 294]) {
            await size(page, entry, width); await viewChoice(page, frame, 'Resources');
            await expect(frame.getByRole('radiogroup', { name: 'Period', exact: true })).toHaveCount(0);
            const folded = frame.getByRole('button', { name: 'View', exact: true });
            if (await folded.isVisible()) {
                await folded.click();
                await expect(page.getByRole('menuitem', { name: /^(Day|Week|Month)$/ })).toHaveCount(0);
                await page.keyboard.press('Escape');
            }
            expect(await toolbarFaults(entry)).toEqual([]);
            await viewChoice(page, frame, 'Calendar');
        }
        await size(page, entry, 1440);
        await expect(frame.getByRole('radio', { name: 'Week', exact: true })).toHaveAttribute('aria-checked', 'true');
    });
    test(`phone example schedules and saves a backlog row through e3 (${theme}) @narrow`, async ({ page }) => {
        const entry = await open(page, "calendarMobile", theme);
        const frame = entry.locator("[data-calendar-frame]").first();
        await expect(frame.locator("[data-calendar-agenda]")).toBeVisible();
        expect(await toolbarFaults(entry)).toEqual([]);
        await frame.getByRole("button", { name: "Expand Library" }).click();
        const backlog = frame.getByRole("tab", { name: "Backlog" });
        if (await backlog.isVisible()) await backlog.click();
        else {
            await frame.getByRole("button", { name: /more tabs/ }).click();
            await page.getByRole("menuitem", { name: /Backlog/ }).click();
        }
        await frame.locator('[data-library-item]').filter({ hasText: "Torque-test fixtures" }).click();
        await frame.getByRole("button", { name: "Schedule", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
        await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
        const collapse = frame.getByRole("button", { name: "Collapse Library" });
        if (await collapse.isVisible()) await collapse.click();
        await settled(page);
        const card = frame.locator('[data-calendar-card]').filter({ hasText: "Torque-test fixtures" });
        await expect(card).toHaveAttribute("data-drafted", "");
        await frame.getByRole("button", { name: "Save", exact: true }).click();
        await expect(card).not.toHaveAttribute("data-drafted", "");
        // A route remount retains the record commit in the in-page e3, independently of the old DOM.
        await page.evaluate(() => { location.hash = "#e3/plan/plan/planTargetState"; });
        await expect(page.locator("[data-plan-frame]").first()).toBeVisible();
        await page.evaluate(file => { location.hash = `#${file}/calendarMobile`; }, FILE);
        await expect(entry.locator('[data-calendar-card]').filter({ hasText: "Torque-test fixtures" }).first()).toBeVisible();
    });
    test(`desktop views preserve geometry, selection and view through resize (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "Desktop geometry; explicit actions cover the phone projects.");
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "calendarOperations", theme); await size(page, entry, 1440);
        const frame = entry.locator("[data-calendar-frame]").first();
        await viewChoice(page, frame, "Timeline");
        const timeline = frame.locator('[data-calendar-timeline]');
        expect(await timeline.evaluate(root => {
            const ruler = root.querySelector('[data-calendar-ruler="ticks"]')!.getBoundingClientRect();
            return [...root.querySelectorAll('[data-calendar-cell]')].every(cell => {
                const b = cell.getBoundingClientRect(); return Math.abs(b.left - ruler.left) < 1 && Math.abs(b.width - ruler.width) < 1;
            });
        })).toBe(true);
        const before = await timeline.evaluate(el => { el.scrollLeft = 1; return Number(el.querySelector<HTMLElement>('[data-calendar-cell]')!.dataset.calendarFrom); });
        await expect.poll(async () => Number(await timeline.locator('[data-calendar-cell]').first().getAttribute('data-calendar-from'))).toBeLessThan(before);
        await viewChoice(page, frame, "Calendar"); await viewChoice(page, frame, "Month");
        await expect(frame.locator('[data-calendar-month-grid]')).toBeVisible();
        await expect(frame.locator('[data-outside]').first()).toBeVisible();
        await frame.getByRole("button", { name: "Today", exact: true }).click();
        const more = frame.getByRole('button', { name: /more$/ }).first();
        await expect(more).toBeVisible(); await more.click();
        await expect(frame.locator('[data-calendar-time-grid]')).toBeVisible();
        const first = frame.locator('[data-calendar-event]').first(); await first.click();
        const selected = await first.getAttribute('data-calendar-event');
        await size(page, entry, 390);
        await expect(frame.locator('[data-calendar-card][data-selected]')).toHaveAttribute('data-calendar-card', selected!);
        await expect(frame.locator('[aria-roledescription="draggable"]')).toHaveCount(0);
        await size(page, entry, 1440);
        await expect(frame.locator('[data-calendar-time-grid]')).toBeVisible();
        await expect(frame.locator('[data-calendar-event][data-selected]')).toHaveAttribute('data-calendar-event', selected!);
    });
    test(`desktop template, resize and keyboard move save to e3 (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "Phone scheduling uses explicit actions.");
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "calendarOperations", theme); await size(page, entry, 1440);
        const frame = entry.locator("[data-calendar-frame]").first();
        await viewChoice(page, frame, "Resources");
        const cell = frame.locator('[data-calendar-cell]').first();
        const at = async (hour: number) => cell.evaluate((el, h) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * h / 24 }; }, hour);
        const target = await at(12.5);
        const source = frame.locator('[data-library-item]').filter({ hasText: "Bracket batch" });
        await movePointer(page, source, target.x, target.y);
        await expect(cell).toHaveAttribute('data-drop-active', '');
        await expect(cell.locator('[data-calendar-landing]')).toBeVisible();
        await page.mouse.up();
        const created = frame.locator('[data-calendar-event]').filter({ hasText: 'Bracket batch' });
        await expect(created).toHaveCount(1); await expect(created).toHaveAttribute('data-drafted', '');
        await viewChoice(page, frame, "Calendar"); await viewChoice(page, frame, "Day");
        const job = frame.locator('[data-calendar-event]').filter({ hasText: 'Mounting brackets' });
        const edge = job.getByRole('button', { name: 'Resize end of Mounting brackets' });
        await edge.scrollIntoViewIfNeeded();
        const end = await job.evaluate(el => { const b = el.closest('[data-calendar-cell]')!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 11 / 24 }; });
        await movePointer(page, edge, end.x, end.y);
        await page.mouse.up(); await expect(job).toHaveAttribute('data-drafted', '');
        await job.focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
        await expect(job).toHaveAttribute('aria-label', /6:15|06:15/);
        await frame.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(created).not.toHaveAttribute('data-drafted', ''); await expect(job).not.toHaveAttribute('data-drafted', '');
        await page.evaluate(() => { location.hash = '#e3/plan/plan/planTargetState'; });
        await expect(page.locator('[data-plan-frame]').first()).toBeVisible();
        await page.evaluate(file => { location.hash = `#${file}/calendarOperations`; }, FILE);
        await expect(entry.locator('[data-calendar-event]').filter({ hasText: 'Bracket batch' }).first()).toBeVisible();
        await expect(entry.locator('[data-calendar-event]').filter({ hasText: 'Mounting brackets' }).first()).toHaveAttribute('aria-label', /6:15|06:15/);
    });
    test(`Timeline preview and footer use Plan's shared styles (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "Narrow Calendar has explicit actions instead of dragging.");
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "calendarOperations", theme); await size(page, entry, 1440);
        const frame = entry.locator('[data-calendar-frame]').first();
        await viewChoice(page, frame, "Timeline");
        const short = frame.locator('[data-calendar-event]').filter({ hasText: 'Preventive maintenance' }).first();
        await short.scrollIntoViewIfNeeded(); await short.focus(); await page.keyboard.press('Space');
        const ghost = page.locator('[data-drag-ghost] [data-move-ghost]');
        await expect(ghost).toBeVisible();
        expect((await ghost.boundingBox())!.width).toBeGreaterThan(100);
        expect((await ghost.boundingBox())!.height).toBeLessThan(50);
        expect(await ghost.locator('[data-move-ghost-label]').evaluate(el => {
            const style = getComputedStyle(el); const box = el.getBoundingClientRect();
            return { wraps: style.whiteSpace !== 'nowrap', lines: box.height / parseFloat(style.lineHeight) };
        })).toEqual({ wraps: false, lines: 1 });
        await page.keyboard.press('Escape');
        const railStyle = async (rail: Locator) => rail.evaluate(el => {
            const s = getComputedStyle(el); const item = getComputedStyle(el.firstElementChild!);
            return { height: el.getBoundingClientRect().height, background: s.backgroundColor,
                border: s.borderTop, padding: s.padding, gap: s.gap,
                family: item.fontFamily, size: item.fontSize, weight: item.fontWeight,
                tracking: item.letterSpacing, casing: item.textTransform, color: item.color };
        });
        const calendarFooter = await railStyle(frame.locator('[data-calendar-footer]'));
        await expect(frame.locator('[data-calendar-footer] > [data-calendar-legend]')).toHaveCount(3);
        await expect(frame.locator('[data-calendar-footer] > :not([data-calendar-legend])')).toHaveCount(0);
        expect(calendarFooter.height).toBe(28);
        expect(calendarFooter.background).not.toBe('rgba(0, 0, 0, 0)');
        await size(page, entry, 390);
        const footer = frame.locator('[data-calendar-footer]');
        await expect(footer).toHaveAttribute('data-builder-narrow', '');
        expect(await footer.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        await page.evaluate(() => { location.hash = '#e3/plan/plan-events/planPrintWorks'; });
        const plan = page.locator('[data-plan-frame] [data-slot="footer"]').first();
        await expect(plan).toBeVisible({ timeout: 30_000 });
        expect(await railStyle(plan)).toEqual(calendarFooter);
    });

    test(`indexed events inspect by key and save without losing fields (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "The paged source is independent of the responsive action layout.");
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "calendarWindowed", theme); await size(page, entry, 1440);
        const frame = entry.locator('[data-calendar-frame]').first();
        await expect(frame.locator('[data-toolbar-item="calendar.scope"]').getByText('Loaded window', { exact: true })).toBeVisible();
        await frame.locator('[data-calendar-event]').filter({ hasText: 'Mounting brackets' }).click();
        const customer = frame.locator('[data-field="customer"] input');
        await customer.fill('Windowed customer'); await customer.press('Enter');
        await frame.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(frame.locator('[data-calendar-event][data-drafted]')).toHaveCount(0);
        await page.evaluate(() => { location.hash = '#e3/plan/plan/planTargetState'; });
        await expect(page.locator('[data-plan-frame]').first()).toBeVisible();
        await page.evaluate(file => { location.hash = `#${file}/calendarWindowed`; }, FILE);
        const again = entry.locator('[data-calendar-frame]').first();
        await again.locator('[data-calendar-event]').filter({ hasText: 'Mounting brackets' }).click();
        await expect(again.locator('[data-field="customer"] input')).toHaveValue('Windowed customer');
    });

}

for (const theme of ["light", "dark"] as const) {
    test(`Calendar uses shared typography, one range line and quiet resize grips (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "Desktop type and hover; agenda interaction is covered on phones.");
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, "calendarOperations", theme); await size(page, entry, 1920);
        const frame = entry.locator("[data-calendar-frame]").first();
        const range = frame.locator('[data-calendar-range]');
        await expect(range).toBeVisible();
        const fonts = await range.evaluate(el => {
            const cs = getComputedStyle(el);
            return Object.fromEntries(["heading", "body", "mono"].map(name => [name, cs.getPropertyValue(`--chakra-fonts-${name}`).trim().split(",").map(part => part.trim()).join(", ")]));
        });
        const typography = async (element: Locator) => element.evaluate(el => {
            const s = getComputedStyle(el);
            return { family: s.fontFamily, size: parseFloat(s.fontSize), weight: s.fontWeight, casing: s.textTransform };
        });
        const heading = await typography(range.locator('span').first());
        expect(heading.family).toBe(fonts.heading); expect(heading.size).toBe(15); expect(heading.weight).toBe("700");
        expect(await range.evaluate(el => {
            const boxes = [...el.children].map(child => child.getBoundingClientRect());
            return boxes[1]!.left >= boxes[0]!.right && Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.top)) < 24;
        })).toBe(true);
        const weekday = await typography(frame.locator('[data-calendar-day-heading] > span').first());
        expect(weekday.family).toBe(fonts.mono); expect(weekday.size).toBe(10); expect(weekday.weight).toBe("600"); expect(weekday.casing).toBe("uppercase");
        const title = await typography(frame.locator('[data-calendar-event-title]:visible').first());
        expect(title.family).toBe(fonts.body); expect(title.size).toBe(12.5); expect(title.weight).toBe("600");
        const calendarAxis = await frame.locator('[data-calendar-cell]').first().evaluate(cell => {
            const s = getComputedStyle(cell.parentElement!.firstElementChild!);
            return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, casing: s.textTransform };
        });
        expect(calendarAxis.family).toBe(fonts.mono);
        const grip = frame.locator('[data-edge]').first();
        await grip.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
        const opacity = () => grip.evaluate(el => Number(getComputedStyle(el, "::after").opacity));
        await expect.poll(opacity).toBe(0);
        await grip.hover(); await expect.poll(opacity).toBeGreaterThan(0.5);
        await page.mouse.move(0, 0); await expect.poll(opacity).toBe(0);
        await page.keyboard.press("Tab"); await grip.focus(); await expect.poll(opacity).toBeGreaterThan(0.5);
        await grip.locator('..').click();
        const inspectorTitle = frame.locator('[data-inspector-title]');
        await expect(inspectorTitle).toBeVisible();
        const inspected = await typography(inspectorTitle);
        expect(inspected.family).toBe(fonts.heading); expect(inspected.size).toBe(18); expect(inspected.weight).toBe("600");
        const icon = frame.locator('[data-calendar-event-icon] svg').first();
        expect(await icon.getAttribute('data-prefix')).toBe('fas');
        expect(await icon.evaluate(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height])).toEqual([9, 9]);
        await viewChoice(page, frame, "Resources");
        const resourceTitle = await typography(frame.locator('[data-calendar-resource-title]').first());
        expect(resourceTitle.family).toBe(fonts.body); expect(resourceTitle.size).toBe(12.5); expect(resourceTitle.weight).toBe("600");
        await viewChoice(page, frame, "Timeline");
        const tick = await typography(frame.locator('[data-calendar-ruler="ticks"] > div').first());
        expect(tick.family).toBe(fonts.mono); expect(tick.size).toBe(10); expect(tick.weight).toBe("600");
        await viewChoice(page, frame, "Calendar"); await viewChoice(page, frame, "Month");
        const monthHeading = await typography(frame.locator('[data-calendar-month-grid] [data-month] > div > div').first());
        expect(monthHeading).toEqual(weekday);
        // The time axis shares the Plan's actual computed type, not just a similar font family.
        await page.evaluate(() => { location.hash = "#e3/plan/plan/planTargetState"; });
        const planTick = page.locator('[data-plan-frame] [data-slot="rulerTick"]').first();
        await expect(planTick).toBeVisible({ timeout: 30_000 });
        expect(await planTick.evaluate(el => {
            const s = getComputedStyle(el);
            return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, casing: s.textTransform };
        })).toEqual(calendarAxis);
    });
}
