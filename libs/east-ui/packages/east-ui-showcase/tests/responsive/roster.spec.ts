/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/** Roster against the real in-page e3: the mock's geometry and shared builder behavior. */
import { expect, test, type Locator, type Page } from "playwright/test";
import { frameAt, toolbarFaults } from "./builder-frame";
import { settled } from "./settle";
const FILE = "e3/roster/roster";
async function open(page: Page, name = "rosterWarehouse", theme: "light" | "dark" = "light") {
    await page.goto(`/?theme=${theme}#${FILE}/${name}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-roster-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page); return entry;
}
async function size(page: Page, entry: Locator, width: number) {
    await entry.locator("[data-roster-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}
async function view(page: Page, frame: Locator, name: string) {
    const radio = frame.getByRole('radio', { name, exact: true });
    if (await radio.isVisible()) await radio.click();
    else { await frame.getByRole('button', { name: 'View', exact: true }).click(); const choice = page.getByRole('menuitem', { name, exact: true }); if (await choice.isVisible()) await choice.click(); else { await page.getByRole('dialog').getByRole('radio', { name, exact: true }).click(); await page.keyboard.press('Escape'); } }
    await settled(page);
}
async function closeInspector(frame: Locator) {
    const collapse = frame.getByRole('button', { name: 'Collapse Inspector' });
    if (await collapse.isVisible()) await collapse.click();
}
/** The toolbar's record rail. */
const RAIL = '[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]';
/** The warehouse rail's fields, as `source.field`, in source order. */
const ROSTER_FIELDS = ['people.team', 'people.position', 'people.trainer', 'people.agency', 'people.skills', 'people.name', 'activities.group'];
/** A frame wide enough for every chip of the rail live, its presets and its summary; and a page wide enough for it. */
const WIDE = 2400;
const WIDE_PAGE = 2800;
/**
 * Every source's field as the rail shows it at its width: a live chip, a
 * folded summary chip (`field:source.field`), or past those its one trigger,
 * named for every field it holds.
 */
const railFields = (frame: Locator) => frame.locator(RAIL).first().evaluate(rail => {
    const live = [...rail.querySelectorAll('[data-record-slice-source][data-record-slice-field]')].filter(el => el.getBoundingClientRect().width > 0)
        .map(el => `${el.getAttribute('data-record-slice-source')}.${el.getAttribute('data-record-slice-field')}`);
    const folded = [...rail.querySelectorAll("[data-slice-fold^='field:']")].map(el => el.getAttribute('data-slice-fold')!.slice(6));
    const trigger = rail.querySelector("button[aria-label^='Filters:']")?.getAttribute('aria-label') ?? '';
    return { fields: [...live, ...folded].sort(), named: ['Group', 'Position', 'Trainer', 'Agency', 'Skill', 'Name'].every(label => trigger.includes(label)) };
});
async function remount(page: Page, name: string) {
    await page.evaluate(() => { location.hash = '#e3/plan/plan/planTargetState'; });
    await expect(page.locator('[data-plan-frame]').first()).toBeVisible();
    await page.evaluate(({ file, name }) => { location.hash = `#${file}/${name}`; }, { file: FILE, name });
    const entry = page.locator('[data-index]', { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded(); await expect(entry.locator('[data-roster-frame]').first()).toBeVisible();
    return entry.locator('[data-roster-frame]').first();
}
for (const theme of ['light', 'dark'] as const) {
    test(`Roster frame fits 1440/1024/768/390/360 (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme), frame = entry.locator('[data-roster-frame]').first();
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            const geometry = await frameAt(entry), main = frame.locator('[data-roster-main]');
            expect(geometry.main.w).toBeGreaterThan(0);
            if (geometry.main.w < 480) {
                await expect(main.locator('[data-roster-agenda]')).toBeVisible();
                await expect(frame.locator('[data-draggable], [aria-roledescription="draggable"], [data-roster-grip], [data-roster-slot]')).toHaveCount(0);
                expect(await main.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
                const days = main.locator('[data-roster-seg="agenda-days"]');
                const fit = await days.evaluate(el => {
                    const strip = el.getBoundingClientRect(), border = getComputedStyle(el), parent = el.parentElement!, css = getComputedStyle(parent);
                    const cells = [...el.querySelectorAll('[role="radio"]')].map(day => day.getBoundingClientRect());
                    return {
                        count: cells.length,
                        widthError: Math.abs(strip.width - (parent.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight))),
                        spread: Math.max(...cells.map(cell => cell.width)) - Math.min(...cells.map(cell => cell.width)),
                        left: Math.abs(cells[0]!.left - strip.left - parseFloat(border.borderLeftWidth)),
                        right: Math.abs(strip.right - cells.at(-1)!.right - parseFloat(border.borderRightWidth)),
                        overflow: el.scrollWidth - el.clientWidth,
                    };
                });
                expect(fit.count).toBe(7);
                expect(fit.widthError, `${width}px day strip`).toBeLessThanOrEqual(1);
                expect(fit.spread, `${width}px equal day buttons`).toBeLessThanOrEqual(1);
                expect(fit.left).toBeLessThanOrEqual(0.25); expect(fit.right).toBeLessThanOrEqual(0.25);
                expect(fit.overflow).toBeLessThanOrEqual(1);
                expect(await main.evaluate(root => [...root.querySelectorAll('[data-roster-card]')].flatMap(card => {
                    const b = card.getBoundingClientRect(), p = root.getBoundingClientRect();
                    return b.left < p.left - 1 || b.right > p.right + 1 ? [card.getAttribute('data-roster-card')] : [];
                }))).toEqual([]);
            } else await expect(main.locator('[data-roster-grid="shifts"]')).toBeVisible();
            expect(await frame.locator('[data-roster-footer]').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        }
        // Essential domain commands survive the folded form, alongside the shared Save.
        await expect(frame.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
        await frame.getByRole('button', { name: 'View', exact: true }).click();
        await expect(page.getByRole('dialog').getByRole('button', { name: 'Publish week', exact: true })).toBeVisible();
        await expect(page.getByRole('dialog').getByRole('button', { name: 'Next day', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await frame.getByRole('button', { name: 'View', exact: true }).click();
        await expect(page.locator('[data-roster-picker-week="2028-03-05"]')).toBeVisible();
    });
    test(`week picker hover is distinct from selection and keeps keyboard focus (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Hover uses a fine pointer; touch selection is covered by narrow controls.');
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme), frame = entry.locator('[data-roster-frame]').first();
        await frame.getByRole('button', { name: 'Choose roster week', exact: true }).click();
        const chosen = page.locator('[data-roster-picker-week][data-selected]');
        const week = page.locator('[data-roster-picker-week]:not([data-selected])').first();
        const background = (row: Locator) => row.evaluate(el => getComputedStyle(el).backgroundColor);
        const selected = await background(chosen), rest = await background(week);
        await week.hover();
        expect(await background(week)).not.toBe(rest);
        expect(await background(week)).not.toBe(selected);
        expect(await background(chosen)).toBe(selected);
        await chosen.hover(); expect(await background(chosen)).toBe(selected);
        expect(await background(week)).toBe(rest);
        await week.focus(); await page.keyboard.press('Tab');
        const focus = page.locator('[data-roster-picker-week]:focus-visible');
        await expect(focus).toHaveCount(1);
        expect(await focus.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    test(`People omits period controls in every toolbar form (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme), frame = entry.locator('[data-roster-frame]').first();
        for (const width of [1440, 768, 294]) {
            await size(page, entry, width);
            await view(page, frame, 'People');
            await expect(frame.getByRole('radiogroup', { name: 'Period', exact: true })).toHaveCount(0);
            const folded = frame.getByRole('button', { name: 'View', exact: true });
            if (await folded.isVisible()) {
                await folded.click();
                await expect(page.getByRole('menuitem', { name: /^(Day|Week)$/ })).toHaveCount(0);
                await expect(page.getByRole('dialog').getByRole('radiogroup', { name: 'Period', exact: true })).toHaveCount(0);
                await page.keyboard.press('Escape');
            }
            expect(await toolbarFaults(frame)).toEqual([]);
            await view(page, frame, 'Shifts');
        }
        // Back on Shifts, its chosen period is kept: on the row from a 1920px frame, where the rail's summary and the view both fit.
        await size(page, entry, 1920);
        await expect(frame.getByRole('radio', { name: 'Day', exact: true })).toHaveAttribute('aria-checked', 'true');
    });
    test(`phone edits a named assignment and saves through e3 (${theme}) @narrow`, async ({ page }) => {
        const entry = await open(page, 'rosterMobile', theme), frame = entry.locator('[data-roster-frame]').first();
        expect(await toolbarFaults(frame)).toEqual([]);
        expect(await frame.locator('[data-roster-main]').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        const card = frame.locator('[data-roster-card="s37"]');
        await expect(card).toContainText('C. Clover');
        await card.getByRole('button', { name: 'Edit', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const b = (await dialog.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
        const overtime = dialog.locator('[data-field="overtime"] input');
        await overtime.fill('1.5'); await overtime.press('Tab');
        await dialog.getByRole('button', { name: 'Update', exact: true }).click();
        await expect(card).toHaveAttribute('data-drafted', '');
        await card.getByRole('button', { name: 'Mark agreed' }).click();
        await frame.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(card).not.toHaveAttribute('data-drafted', '');
        const again = await remount(page, 'rosterMobile');
        await again.locator('[data-roster-card="s37"]').getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(page.getByRole('dialog').locator('[data-field="overtime"] input')).toHaveValue('1.5');
    });
    test(`mobile People and Shifts preserve drafts and selection (${theme}) @narrow`, async ({ page }) => {
        const entry = await open(page, 'rosterMobile', theme), frame = entry.locator('[data-roster-frame]').first();
        const card = frame.locator('[data-roster-card="s37"]');
        await card.getByRole('button', { name: 'Remove', exact: true }).click();
        await view(page, frame, 'People');
        await expect(frame.locator('[data-roster-agenda="people"]')).toBeVisible();
        await expect(card).toHaveAttribute('data-drafted', '');
        await card.getByRole('button', { name: 'Restore', exact: true }).click();
        await closeInspector(frame);
        await expect(frame.locator('[aria-roledescription="draggable"], [data-roster-slot]')).toHaveCount(0);
        await frame.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
        await view(page, frame, 'Shifts');
        await expect(card).toHaveAttribute('data-drafted', '');
    });
    test(`desktop grid and People preserve identity through resize (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Desktop geometry; narrow actions are tested separately.');
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme); await size(page, entry, 1440);
        const frame = entry.locator('[data-roster-frame]').first();
        await expect(frame.locator('[data-roster-assignment="s37"]')).toContainText('6.0h rest');
        await expect(frame.locator('[data-roster-main] [data-roster-proposal]')).toHaveCount(2);
        await frame.locator('[data-roster-assignment="s37"]').click();
        await closeInspector(frame); await size(page, entry, 390);
        await expect(frame.locator('[data-roster-card="s37"]')).toHaveAttribute('data-selected', '');
        await size(page, entry, 1440); await view(page, frame, 'People');
        await expect(frame.locator('[data-roster-grid="people"]')).toBeVisible();
        await expect(frame.locator('[data-roster-assignment="s37"]')).toHaveAttribute('data-selected', '');
        expect(await frame.locator('[data-roster-grid="people"]').evaluate(el => getComputedStyle(el.querySelector("[data-virtual-extent]")!).minWidth)).toBe('1100px');
        await view(page, frame, 'Shifts'); await view(page, frame, 'Week');
        await expect(frame.locator('[data-roster-slot]')).toHaveCount(63);
        await frame.locator('[data-roster-slot]').first().getByRole('button').click();
        await expect(frame.locator('[data-roster-slot]')).toHaveCount(9);
    });
    test(`desktop drag shares readable previews, warnings, undo and Save (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Mobile uses explicit assignment actions.');
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme); await size(page, entry, 960);
        const frame = entry.locator('[data-roster-frame]').first();
        const collapseLibrary = frame.getByRole('button', { name: 'Collapse Library', exact: true });
        if (await collapseLibrary.isVisible()) await collapseLibrary.click();
        await settled(page); await closeInspector(frame);
        await expect(frame.getByRole('button', { name: 'Expand Inspector', exact: true })).toBeVisible();
        const source = frame.locator('[data-roster-assignment="s37"]');
        await source.scrollIntoViewIfNeeded(); await source.focus(); await page.keyboard.press('Space');
        const ghost = page.locator('[data-drag-ghost] [data-move-ghost]');
        await expect(ghost).toBeVisible(); expect((await ghost.boundingBox())!.width).toBeGreaterThan(60);
        expect(await ghost.locator('[data-move-ghost-label]').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
        await page.keyboard.press('Escape');
        const target = frame.locator('[data-roster-slot]').filter({ has: page.locator('[data-roster-assignment="s121"]') });
        const from = (await source.boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, { steps: 2 });
        await expect(ghost).toBeVisible(); await settled(page);
        // The shared frame slides panes away during dragging. Measure the new
        // destination, and point at its padding rather than a nested chip target.
        const to = (await target.boundingBox())!;
        const main = (await frame.locator('[data-roster-main]').boundingBox())!;
        await page.mouse.move(to.x + 5, Math.min(Math.max(to.y + 100, main.y + 180), main.y + main.height - 80), { steps: 12 });
        await expect(target).toHaveAttribute('data-drop-active', '');
        await expect(target.locator('[data-roster-landing]')).toContainText('C. Clover');
        await page.mouse.up();
        await expect(source).toHaveAttribute('data-drafted', '');
        await expect(frame.getByRole('button', { name: 'Expand Inspector', exact: true })).toBeVisible();
        await source.click();
        await expect(frame.getByRole('button', { name: 'Collapse Inspector', exact: true })).toBeVisible();
        await closeInspector(frame);
        await frame.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(source).not.toHaveAttribute('data-drafted', '');
        await frame.getByRole('button', { name: 'Redo', exact: true }).click();
        await frame.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(source).not.toHaveAttribute('data-drafted', '', { timeout: 15_000 });
        const again = await remount(page, 'rosterWarehouse');
        expect(await again.locator('[data-roster-assignment="s37"]').evaluate(el => el.closest('[data-roster-slot]')!.getAttribute('data-roster-slot'))).toContain('late');
    });
    test(`Library people and activities drag through real e3 Save (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Mobile uses explicit Library actions.');
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme); await size(page, entry, 960);
        const frame = entry.locator('[data-roster-frame]').first();
        await closeInspector(frame);
        const library = frame.locator('[data-frame-slot="start"]');
        const drag = async (from: Locator, into: Locator, cell = false) => {
            await into.evaluate(el => el.scrollIntoView({ block: "center", inline: "center" }));
            await from.scrollIntoViewIfNeeded(); await settled(page); const a = (await from.boundingBox())!;
            await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
            await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 2 });
            await expect(page.locator('[data-drag-ghost]')).toBeVisible(); await settled(page);
            const b = (await into.boundingBox())!;
            const main = (await frame.locator('[data-roster-main]').boundingBox())!;
            // Use the empty middle of the night cell, below its sticky header.
            // Crossing the scroll edge can move a target after its first measurement.
            if (cell) {
                await page.mouse.move(b.x + b.width / 2, Math.min(Math.max(b.y + b.height * 0.6, main.y + 110), main.y + main.height - 60), { steps: 12 });
                const at = (await into.boundingBox())!; await page.mouse.move(at.x + at.width / 2, Math.min(at.y + at.height * 0.6, main.y + main.height - 60));
            } else {
                // Hover resolves the chip after the pane transition/autoscroll;
                // clamping the pointer to the cell's safe area can miss a chip.
                await into.hover();
            }
            await expect(into).toHaveAttribute('data-drop-active', ''); await page.mouse.up();
        };
        await library.getByRole('textbox', { name: 'Search library' }).fill('Ochre');
        const person = library.locator('[data-library-item]').filter({ hasText: 'N. Ochre' });
        const night = frame.locator('[data-roster-slot]').filter({ has: page.locator('[data-roster-proposal="s317"]') });
        await drag(person, night, true);
        await expect(frame.locator('[data-roster-main] [data-roster-proposal="s317"]')).toHaveCount(0);
        await expect(frame.locator('[data-roster-assignment][data-drafted]').filter({ hasText: 'N. Ochre' })).toHaveCount(1);
        await expect(frame.getByRole('button', { name: 'Expand Inspector', exact: true })).toBeVisible();
        const expand = frame.getByRole('button', { name: 'Expand Library' });
        if (await expand.isVisible()) await expand.click();
        await library.getByRole('tab', { name: 'Activities 17' }).click();
        const activity = library.locator('[data-library-item]').filter({ hasText: 'Unloading' });
        const assignment = frame.locator('[data-roster-assignment="s37"]');
        await assignment.scrollIntoViewIfNeeded(); await drag(activity, assignment);
        await expect(assignment.getByTitle('Unloading', { exact: true })).toBeVisible();
        await frame.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(frame.locator('[data-roster-assignment][data-drafted]')).toHaveCount(0, { timeout: 15_000 });
        const again = await remount(page, 'rosterWarehouse');
        await expect(again.locator('[data-roster-assignment]').filter({ hasText: 'N. Ochre' })).toHaveCount(1);
        await expect(again.locator('[data-roster-assignment="s37"]').getByTitle('Unloading', { exact: true })).toBeVisible();
    });
    test(`People and Library mount a bounded window and reveal later rows (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, 'rosterPeople', theme), frame = entry.locator('[data-roster-frame]').first();
        await size(page, entry, 960);
        const people = frame.locator('[data-roster-grid="people"]');
        const rows = people.locator('[data-roster-person-row]');
        await expect(rows.first()).toBeVisible();
        expect(await rows.count()).toBeLessThan(30);
        const first = await rows.first().getAttribute('data-roster-person-row');
        const scroll = people.locator('[data-virtual-rows]');
        await scroll.evaluate(el => el.scrollTo({ top: el.scrollHeight })); await settled(page);
        await expect(people.locator('[data-roster-person-row="requests:dispatch"]')).toBeVisible();
        expect(await rows.count()).toBeLessThan(30);
        expect(await rows.first().getAttribute('data-roster-person-row')).not.toBe(first);
        const library = frame.locator('[data-frame-slot="start"]');
        const expand = frame.getByRole('button', { name: 'Expand Library', exact: true });
        if (await expand.isVisible()) await expand.click();
        const cards = library.getByRole('tabpanel').filter({ visible: true }).locator('[data-library-item]');
        expect(await cards.count()).toBeGreaterThan(0);
        expect(await cards.count()).toBeLessThan(30);
        await library.getByRole('textbox', { name: 'Search library' }).fill('Ochre');
        await expect(cards.filter({ hasText: 'N. Ochre' })).toHaveCount(1);
        await size(page, entry, 294);
        const agenda = frame.locator('[data-roster-agenda="people"]');
        await expect(agenda).toBeVisible();
        expect(await agenda.locator('[data-roster-person-card]').count()).toBeLessThan(10);
        await expect(frame.locator('[aria-roledescription="draggable"], [data-roster-person-day]')).toHaveCount(0);
    });
    test(`People drag after virtual scrolling preserves the row and saves (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Phone People cards use explicit actions.');
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterPeople', theme); await size(page, entry, 960);
        const frame = entry.locator('[data-roster-frame]').first();
        const collapse = frame.getByRole('button', { name: 'Collapse Library', exact: true });
        if (await collapse.isVisible()) await collapse.click();
        await settled(page); await closeInspector(frame); await settled(page);
        const scroll = frame.locator('[data-roster-grid="people"] [data-virtual-rows]');
        const rows = frame.locator('[data-roster-person-row]');
        const initial = await rows.evaluateAll(nodes => nodes.map(el => el.getAttribute('data-roster-person-row')));
        await scroll.evaluate(el => el.scrollTo({ top: el.scrollHeight })); await settled(page);
        const row = rows.filter({ has: page.locator('[data-roster-assignment]') })
            .filter({ has: page.getByRole('button', { name: 'Off · assign', exact: true }) }).last();
        const person = await row.getAttribute('data-roster-person-row');
        expect(initial).not.toContain(person);
        const source = row.locator('[data-roster-assignment]').first();
        const id = await source.getAttribute('data-roster-assignment');
        const target = row.locator('[data-roster-person-day]').filter({ has: page.getByRole('button', { name: 'Off · assign', exact: true }) }).first();
        const destination = await target.getAttribute('data-roster-person-day');
        await source.scrollIntoViewIfNeeded();
        const from = (await source.boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, { steps: 2 });
        await expect(page.locator('[data-drag-ghost]')).toBeVisible();
        await target.hover(); await expect(target).toHaveAttribute('data-drop-active', ''); await page.mouse.up();
        const moved = frame.locator(`[data-roster-person-day="${destination}"] [data-roster-assignment="${id}"]`);
        await expect(moved).toHaveAttribute('data-drafted', '');
        await expect(frame.getByRole('button', { name: 'Expand Inspector', exact: true })).toBeVisible();
        await frame.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(moved).not.toHaveAttribute('data-drafted', '');
        const again = await remount(page, 'rosterPeople'); await size(page, entry, 960);
        await again.locator('[data-roster-grid="people"] [data-virtual-rows]').evaluate(el => el.scrollTo({ top: el.scrollHeight }));
        await expect(again.locator(`[data-roster-person-day="${destination}"] [data-roster-assignment="${id}"]`)).toHaveCount(1);
    });
    test(`custom numeric inspector keeps decimal typing through Save (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Custom inspector typing; narrow default forms are tested separately.');
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterCustomInspector', theme); await size(page, entry, 1920);
        const frame = entry.locator('[data-roster-frame]').first();
        await frame.locator('[data-roster-assignment="s37"]').click();
        const overtime = frame.getByRole('spinbutton', { name: 'Custom overtime' });
        await overtime.fill(''); await overtime.pressSequentially('1.5');
        await expect(overtime).toHaveValue('1.5'); await overtime.press('Tab');
        await frame.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(frame.locator('[data-roster-assignment="s37"]')).not.toHaveAttribute('data-drafted', '');
        const again = await remount(page, 'rosterCustomInspector');
        await again.locator('[data-roster-assignment="s37"]').click();
        await expect(again.getByRole('spinbutton', { name: 'Custom overtime' })).toHaveValue('1.5');
    });
    test(`group folding is shared by Shifts, People and phone cards (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme); await size(page, entry, 960);
        const frame = entry.locator('[data-roster-frame]').first();
        await view(page, frame, 'People');
        const firstPerson = await frame.locator('[data-roster-person-row]').first().getAttribute('data-roster-person-row');
        for (const key of ['inbound', 'picking', 'dispatch']) {
            const group = frame.locator(`[data-roster-group="${key}"]`);
            await expect(group).toHaveAttribute('aria-expanded', 'true');
            await group.click();
            await expect(group).toHaveAttribute('aria-expanded', 'false');
        }
        await expect(frame.locator('[data-roster-person-row]')).toHaveCount(0);
        await view(page, frame, 'Shifts');
        await expect(frame.locator('[data-roster-group][aria-expanded="false"]')).toHaveCount(3);
        await expect(frame.locator('[data-roster-slot], [data-roster-requirement]')).toHaveCount(0);
        await view(page, frame, 'Week');
        await expect(frame.locator('[data-roster-slot]')).toHaveCount(0);
        await view(page, frame, 'People');
        const inbound = frame.locator('[data-roster-group="inbound"]');
        await inbound.focus(); await page.keyboard.press('Enter');
        await expect(inbound).toHaveAttribute('aria-expanded', 'true');
        await expect(frame.locator(`[data-roster-person-row="${firstPerson}"]`)).toBeVisible();
        await size(page, entry, 360);
        await expect(frame.locator(`[data-roster-person-card="${firstPerson}"]`)).toBeVisible();
        await inbound.click();
        await expect(frame.locator('[data-roster-person-card]')).toHaveCount(0);
        const again = await remount(page, 'rosterWarehouse'); await size(page, entry, 360);
        await expect(again.locator('[data-roster-group][aria-expanded="false"]')).toHaveCount(3);
        const reopen = again.locator('[data-roster-group="inbound"]');
        await reopen.focus(); await page.keyboard.press('Space');
        await expect(reopen).toHaveAttribute('aria-expanded', 'true');
        await expect(again.locator(`[data-roster-person-card="${firstPerson}"]`)).toBeVisible();
        expect(await again.locator('[data-roster-person-card]').count()).toBeLessThan(10);
        await expect(again.locator('[aria-roledescription="draggable"], [data-roster-person-day]')).toHaveCount(0);
    });
    test(`Roster uses app typography, quiet grips and Plan's footer (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'Desktop typography/hover; narrow geometry is tested separately.');
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme); await size(page, entry, 1920);
        const frame = entry.locator('[data-roster-frame]').first();
        const name = frame.locator('[data-roster-assignment-name]').first();
        expect(await name.evaluate(el => { const s = getComputedStyle(el); return { family: s.fontFamily, expected: s.getPropertyValue('--chakra-fonts-body').trim().split(',').map(p => p.trim()).join(', '), size: s.fontSize }; })).toMatchObject({ size: '12.5px' });
        expect(await name.evaluate(el => { const s = getComputedStyle(el); return s.fontFamily === s.getPropertyValue('--chakra-fonts-body').trim().split(',').map(p => p.trim()).join(', '); })).toBe(true);
        const grip = frame.locator('[data-roster-grip]').first(); await grip.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
        expect(await grip.evaluate(el => Number(getComputedStyle(el).opacity))).toBe(0);
        await grip.hover(); expect(await grip.evaluate(el => Number(getComputedStyle(el).opacity))).toBeLessThan(0.6);
        const railStyle = (rail: Locator) => rail.evaluate(el => { const s = getComputedStyle(el), item = getComputedStyle(el.firstElementChild!); return { height: el.getBoundingClientRect().height, background: s.backgroundColor, border: s.borderTop, padding: s.padding, gap: s.gap, family: item.fontFamily, size: item.fontSize, weight: item.fontWeight, tracking: item.letterSpacing, casing: item.textTransform, color: item.color }; });
        const proposal = frame.locator('[data-roster-main] [data-roster-proposal="s317"]');
        expect(await proposal.evaluate(el => { const s = getComputedStyle(el); return { height: el.getBoundingClientRect().height, border: s.borderTopStyle, background: s.backgroundColor }; })).toEqual({ height: 26, border: 'dashed', background: 'rgba(0, 0, 0, 0)' });
        expect(await proposal.getByRole('button', { name: 'N. Ochre', exact: true }).evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic');
        await expect(proposal.getByRole('button', { name: 'Accept proposal for N. Ochre' })).toHaveCount(1);
        await expect(proposal.getByRole('button', { name: 'Reject proposal for N. Ochre' })).toHaveCount(1);
        const footer = frame.locator('[data-roster-footer]');
        await expect(footer.locator(':scope > [data-roster-legend]')).toHaveCount(6);
        await expect(footer.locator(':scope > :not([data-roster-legend])')).toHaveCount(0);
        const actual = await railStyle(footer); expect(actual.height).toBe(28);
        const groupBands = () => frame.locator('[data-roster-group]').evaluateAll(groups => groups.map(el => {
            const b = el.getBoundingClientRect(), grid = el.parentElement!.getBoundingClientRect();
            return { left: Math.abs(b.left - grid.left) < 1, width: Math.abs(b.width - grid.width) < 1, align: getComputedStyle(el).textAlign };
        }));
        expect(await groupBands()).toEqual(Array.from({ length: 3 }, () => ({ left: true, width: true, align: 'left' })));
        const headings = frame.locator('[data-roster-column-header]');
        const headerTypography = () => headings.evaluateAll(nodes => nodes.map(node => {
            const s = getComputedStyle(node.firstElementChild ?? node);
            return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight,
                tracking: s.letterSpacing, casing: s.textTransform, numbers: s.fontVariantNumeric };
        }));
        const shiftType = (await headerTypography())[0]!;
        expect(shiftType).toMatchObject({ size: '10px', weight: '600', lineHeight: '15px', tracking: '1.2px', casing: 'uppercase' });
        expect(await headerTypography()).toEqual(Array.from({ length: 3 }, () => shiftType));
        expect(await headings.evaluateAll(nodes => nodes.length === 3 && nodes.every(el => getComputedStyle(el).textAlign === 'left'))).toBe(true);
        await view(page, frame, 'Week');
        expect(await headerTypography()).toEqual(Array.from({ length: 28 }, () => shiftType));
        expect(await headings.evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().height))).toEqual(Array(28).fill(28));
        expect(await headings.first().evaluate(el => el.parentElement!.parentElement!.getBoundingClientRect().height)).toBe(58);
        expect(await headings.evaluateAll(nodes => nodes.length > 0 && nodes.every(el => getComputedStyle(el).textAlign === 'center'))).toBe(true);
        expect(await groupBands()).toEqual(Array.from({ length: 3 }, () => ({ left: true, width: true, align: 'left' })));
        await view(page, frame, 'People');
        expect(await headerTypography()).toEqual(Array.from({ length: 7 }, () => shiftType));
        expect(await headings.evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().height))).toEqual(Array(7).fill(28));
        expect(await headings.first().evaluate(el => el.parentElement!.getBoundingClientRect().height)).toBe(29);
        expect(await headings.evaluateAll(nodes => nodes.length === 7 && nodes.every(el => getComputedStyle(el).textAlign === 'center'))).toBe(true);
        const peopleBands = await groupBands();
        expect(peopleBands.length).toBeGreaterThan(0);
        expect(peopleBands.every(b => b.left && b.width && b.align === 'left')).toBe(true);
        await size(page, entry, 768);
        const scroll = frame.locator('[data-roster-grid="people"] [data-virtual-rows]');
        await scroll.evaluate(el => { el.scrollLeft = 200; });
        expect(await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
        expect((await groupBands()).every(b => b.left && b.width && b.align === 'left')).toBe(true);
        await page.evaluate(() => { location.hash = '#e3/plan/plan-events/planPrintWorks'; });
        const planEntry = page.locator('[data-index]', { has: page.locator('a[href="#e3/plan/plan-events/planPrintWorks"]') });
        await planEntry.scrollIntoViewIfNeeded(); await settled(page);
        const plan = planEntry.locator('[data-plan-frame] [data-slot="footer"]').first(); await expect(plan).toBeVisible({ timeout: 30_000 });
        expect(await railStyle(plan)).toEqual(actual);
    });
    test(`the one rail over people and activities stands at every width, nothing leaving the toolbar (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme), frame = entry.locator('[data-roster-frame]').first();
        for (const width of [1920, 1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            // The rail is in the row, every source's field in it: live, folded to its chip, or in its one trigger's name.
            await expect(frame.locator(RAIL).first(), `${width}px`).toBeVisible();
            const shown = await railFields(frame);
            expect(shown.named || shown.fields.join() === ROSTER_FIELDS.slice().sort().join(), `${width}px: ${JSON.stringify(shown)}`).toBe(true);
        }
    });
    test(`wide, the rail's chips are live in source order, each after its source's icon (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: WIDE_PAGE, height: 1080 });
        const entry = await open(page, 'rosterWarehouse', theme), frame = entry.locator('[data-roster-frame]').first();
        await size(page, entry, WIDE);
        // Each live chip stands in its affordance, after the icon of the source it narrows; the chip itself draws only its caret.
        const chips = await frame.locator(RAIL).evaluateAll(clusters => clusters.flatMap(cluster => [...cluster.children].flatMap(affordance => {
            const chip = affordance.querySelector('[data-record-slice-source][data-record-slice-field]');
            return chip === null || chip.getBoundingClientRect().width === 0 ? [] : [{
                field: `${chip.getAttribute('data-record-slice-source')}.${chip.getAttribute('data-record-slice-field')}`,
                icon: affordance.querySelector(':scope > span svg')?.getAttribute('data-icon') ?? null,
            }];
        })));
        expect(chips.map(chip => chip.field)).toEqual(ROSTER_FIELDS);
        expect(chips.map(chip => chip.icon)).toEqual([...Array(6).fill('user'), 'list-check']);
    });
    test(`a Skill chosen through the rail's search narrows the People tab, and the summary counts each source (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: WIDE_PAGE, height: 1200 });
        const entry = await open(page, 'rosterWarehouse', theme), frame = entry.locator('[data-roster-frame]').first();
        await size(page, entry, WIDE);
        const summary = frame.locator('[data-frame-slot="toolbar"] [data-record-slices-summary]').first();
        const start = frame.locator('[data-frame-slot="start"]');
        await expect(summary).toHaveText('69 of 69 people·17 of 17 activities');
        // Skill offers its search: typing finds the skill among the staff's, and choosing it narrows the people.
        await frame.locator(`${RAIL} [data-record-slice-source="people"][data-record-slice-field="skills"]`).first().click();
        const search = page.locator('[data-record-slice-editor="skills"]:visible').getByRole('combobox');
        await search.fill('unl');
        await page.getByRole('option', { name: /^unload/ }).click();
        await page.keyboard.press('Escape');
        await settled(page);
        // 22 of the staff hold Unloading.
        await expect(summary).toHaveText('22 of 69 people·17 of 17 activities');
        // The People tab counts what the rail leaves it. The 272px pane folds its third tab, Positions, into the row's menu, which keeps its count.
        await expect(start.locator('[role="tab"]')).toHaveText(['People 22 of 69', 'Activities 17']);
        await start.getByRole('button', { name: '1 more tab', exact: true }).click();
        await expect(page.getByRole('menuitem')).toHaveText(['Positions 4']);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
        // One 44px row, every tab on it inside its pane.
        const row = await start.evaluate(el => {
            const pane = el.getBoundingClientRect();
            return { height: Math.round(el.querySelector('[data-dock-tabs]')!.parentElement!.getBoundingClientRect().height),
                inside: [...el.querySelectorAll('[role="tab"]')].every(tab => { const t = tab.getBoundingClientRect(); return t.left >= pane.left - 0.5 && t.right <= pane.right + 0.5; }) };
        });
        expect(row).toEqual({ height: 44, inside: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
    test(`a People tab the rail empties says so above the agency requests, which stay; its Clear filters clears the people (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: WIDE_PAGE, height: 1200 });
        const entry = await open(page, 'rosterWarehouse', theme), frame = entry.locator('[data-roster-frame]').first();
        await size(page, entry, WIDE);
        // No one's name starts so: a prefix through the rail's Name search.
        await frame.locator(`${RAIL} [data-record-slice-source="people"][data-record-slice-field="name"]`).first().click();
        const search = page.locator('[data-record-slice-editor="name"]:visible').getByRole('combobox');
        await search.fill('Zz'); await search.press('Enter');
        await page.keyboard.press('Escape');
        await settled(page);
        const people = frame.locator('[data-roster-library="people"]');
        await expect(frame.locator('[data-frame-slot="start"] [role="tab"]').first()).toHaveText('People 0 of 69');
        const empty = people.locator('[data-library-empty][data-narrowed]');
        await expect(empty).toContainText('No people match the filters');
        const request = people.locator('[data-library-item]').filter({ hasText: 'Northside Staffing' });
        await expect(request).toHaveCount(1);
        // The words sit above the request card, inside the pane.
        const [words, card, pane] = [(await empty.boundingBox())!, (await request.boundingBox())!, (await people.boundingBox())!];
        expect(words.y + words.height).toBeLessThanOrEqual(card.y + 0.5);
        expect([words.x >= pane.x - 0.5, words.x + words.width <= pane.x + pane.width + 0.5]).toEqual([true, true]);
        await empty.getByRole('button', { name: 'Clear filters' }).click();
        await settled(page);
        await expect(frame.locator('[data-frame-slot="start"] [role="tab"]').first()).toHaveText('People 69');
        await expect(people.locator('[data-library-empty]')).toHaveCount(0);
    });
    test(`folded on a phone, the rail's editor heads each source's fields with its noun and icon, then the presets (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const entry = await open(page, 'rosterMobile', theme), frame = entry.locator('[data-roster-frame]').first();
        await frame.locator(`${RAIL} button[aria-label^="Filters:"]`).first().click();
        const editor = page.getByRole('dialog');
        expect(await editor.locator('[data-slice-section] [data-record-slice-source]').evaluateAll(els => els.map(el => `${el.getAttribute('data-record-slice-source')}.${el.getAttribute('data-record-slice-field')}`)))
            .toEqual(ROSTER_FIELDS);
        const heads = await editor.evaluate(root => [...root.querySelectorAll<HTMLElement>('[data-slice-group]')].map(head => ({
            key: head.dataset.sliceGroup, text: head.lastElementChild!.textContent, icon: head.querySelector('svg')?.getAttribute('data-icon') ?? null,
            heads: (head.nextElementSibling as HTMLElement | null)?.dataset.sliceSection })));
        expect(heads.map(h => [h.key, h.text, h.icon, h.heads])).toEqual([
            ['source:people', 'people', 'user', 'field:people.team'], ['source:activities', 'activities', 'list-check', 'field:activities.group'], ['presets', 'Presets', null, 'presets']]);
        const box = (await editor.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        await page.keyboard.press('Escape');
    });
}
