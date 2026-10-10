/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/** Roster against the real in-page e3: the mock's geometry and shared builder behavior. */
import { expect, test, type Locator, type Page } from "playwright/test";
import { frameAt } from "./builder-frame";
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
async function toolbarFaults(frame: Locator) {
    return frame.evaluate(root => {
        const band = root.querySelector('[data-frame-slot="toolbar"]')!;
        const row = band.querySelector('[data-toolbar]')!;
        const box = band.getBoundingClientRect(), r = row.getBoundingClientRect();
        const faults: string[] = [];
        if (Math.abs(box.height - 44) > 0.5) faults.push(`height ${box.height}`);
        for (const item of row.querySelectorAll('[data-toolbar-item]')) {
            const b = item.getBoundingClientRect(); if (!b.width) continue;
            if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < box.top - 0.5 || b.bottom > box.bottom + 0.5) faults.push(`overflow ${item.getAttribute('data-toolbar-item')}`);
        }
        const ladder = (row.getAttribute('data-toolbar-ladder') ?? '').split(' ');
        if (ladder.some(s => s.startsWith('history>')) && !ladder.at(-1)?.startsWith('history>')) faults.push('history must fold last');
        return faults;
    });
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
        await expect(page.getByRole('dialog').getByRole('button', { name: 'Next week', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await frame.getByRole('button', { name: 'View', exact: true }).click();
        await expect(page.locator('[data-roster-picker-week="2028-03-05"]')).toBeVisible();
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
        await size(page, entry, 1440);
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
        expect(await headings.evaluateAll(nodes => nodes.length === 3 && nodes.every(el => getComputedStyle(el).textAlign === 'left'))).toBe(true);
        await view(page, frame, 'Week');
        expect(await headings.evaluateAll(nodes => nodes.length > 0 && nodes.every(el => getComputedStyle(el).textAlign === 'center'))).toBe(true);
        expect(await groupBands()).toEqual(Array.from({ length: 3 }, () => ({ left: true, width: true, align: 'left' })));
        await view(page, frame, 'People');
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
        const plan = page.locator('[data-plan-frame] [data-slot="footer"]').first(); await expect(plan).toBeVisible({ timeout: 30_000 });
        expect(await railStyle(plan)).toEqual(actual);
    });
}
