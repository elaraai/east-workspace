/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/**
 * The Roster's People layout by week and by month (#1406) against the real
 * in-page e3: the grids at every width, each row one line at the density's
 * pitch; the tiles in the shifts' colour tokens and the ink the shade takes;
 * a pattern dropped on a person's row, saved through e3 and read back after
 * a remount; a month not read drawn at once with its placeholders, the
 * months either side read ahead (#1398); and both densities.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { leaveBuilder } from "./builder-page";
import { RECORD_READS, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";
const FILE = "e3/roster/roster";
async function open(page: Page, name: string, theme: "light" | "dark") {
    await page.goto(`/?theme=${theme}#${FILE}/${name}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-roster-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page); return entry;
}
async function size(page: Page, entry: Locator, width: number, holding = false) {
    await entry.locator("[data-roster-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page, { holding });
}
async function closeInspector(frame: Locator) {
    const collapse = frame.getByRole("button", { name: "Collapse Inspector" });
    if (await collapse.isVisible()) await collapse.click();
}
/** The Roster's example unmounted and mounted again, what it shows read back from e3. */
async function remount(page: Page, name: string) {
    await leaveBuilder(page);
    await page.evaluate(({ file, name }) => { location.hash = `#${file}/${name}`; }, { file: FILE, name });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded(); await expect(entry.locator("[data-roster-frame]").first()).toBeVisible();
    return entry.locator("[data-roster-frame]").first();
}
/** The theme's token as the page resolves it. */
const resolve = (page: Page, property: "color" | "backgroundColor", token: string) => page.evaluate(({ property, token }) => {
    const probe = document.createElement("span");
    probe.style[property] = `var(${token})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe)[property];
    probe.remove();
    return resolved;
}, { property, token });
/** Each mounted People row's height, rounded. */
const rowHeights = (frame: Locator) => frame.locator("[data-roster-person-row]").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
/** Each day cell's live tile label in a row: the shift, or null for a day off. */
const rowLabels = (row: Locator) => row.locator("[data-roster-person-day]").evaluateAll(cells => cells.map(c => c.querySelector("[data-roster-tile]:not([data-removed]) [data-roster-assignment-name]")?.textContent ?? null));
/** The shifts' colour tokens, as the warehouse seeds them (teal 300, orange 300, purple 700), and the ink each shade takes. */
const SHIFTS = [["Early", "teal-300", "gray-900"], ["Late", "orange-300", "gray-900"], ["Night", "purple-700", "white"]] as const;
/**
 * What a header draws of its words that is cut or crowded (the hand retest, R3): each element's words — its own text,
 * whole, when it is not hidden and is laid out — cut by a box of the header that clips them, or, as far as they show,
 * on a line with another's closer than a pixel. Measured from the words' own box, so an ellipsis is a cut.
 */
const headerFaults = (header: Locator) => header.evaluate((root) => {
    const faults: string[] = [];
    const shown: { text: string; left: number; right: number; top: number; bottom: number }[] = [];
    for (const el of [root, ...root.querySelectorAll("*")]) {
        const texts = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
        if (texts.length === 0 || getComputedStyle(el).visibility !== "visible") continue;
        const range = document.createRange();
        range.setStartBefore(texts[0]!);
        range.setEndAfter(texts[texts.length - 1]!);
        const box = range.getBoundingClientRect();
        if (box.width === 0) continue;
        const text = texts.map((node) => node.textContent ?? "").join("").trim();
        let left = box.left, right = box.right, cut = false;
        for (let clip: Element | null = el; clip !== null && clip !== root.parentElement; clip = clip.parentElement) {
            if (getComputedStyle(clip).overflowX === "visible") continue;
            const edge = clip.getBoundingClientRect();
            if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5) cut = true;
            left = Math.max(left, edge.left);
            right = Math.min(right, edge.right);
        }
        if (cut) faults.push(`"${text}" is cut`);
        if (right > left) shown.push({ text, left, right, top: box.top, bottom: box.bottom });
    }
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i]!, b = shown[j]!;
        if (a.top >= b.bottom || b.top >= a.bottom) continue;
        if (Math.max(a.left, b.left) - Math.min(a.right, b.right) < 1) faults.push(`"${a.text}" touches "${b.text}"`);
    }
    return faults;
});

for (const theme of ["light", "dark"] as const) {
    test(`People week and month fit 1440/1024/768/390/360 and a 294px parent: a row one line at the density's pitch, a 36px header, seven marks a cell lettered by the 13px rule, and the phone's cards by week alone (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        for (const name of ["rosterPeople", "rosterPeopleMonth"] as const) {
            const entry = await open(page, name, theme), frame = entry.locator("[data-roster-frame]").first();
            for (const width of [1440, 1024, 768, 390, 360, 294]) {
                await size(page, entry, width);
                expect(await toolbarFaults(frame), `${name} ${width}px`).toEqual([]);
                const main = frame.locator("[data-roster-main]");
                const mainWidth = await main.evaluate(el => el.getBoundingClientRect().width);
                if (mainWidth < 480) {
                    // The phone's cards, by week alone (P31): no grid, no drag source or target, no month cell.
                    await expect(main.locator('[data-roster-agenda="people"]'), `${name} ${width}px`).toBeVisible();
                    await expect(frame.locator('[data-draggable], [aria-roledescription="draggable"], [data-roster-person-day], [data-roster-person-week]')).toHaveCount(0);
                    expect(await main.evaluate(el => el.scrollWidth - el.clientWidth), `${name} ${width}px`).toBeLessThanOrEqual(1);
                    continue;
                }
                const heights = await rowHeights(frame);
                expect(heights.length, `${name} ${width}px rows`).toBeGreaterThan(0);
                expect(new Set(heights), `${name} ${width}px row pitch`).toEqual(new Set([36]));
                if (name === "rosterPeople") {
                    await expect(main.locator('[data-roster-grid="people"]')).toBeVisible();
                    const heads = frame.locator("[data-roster-people-head] [data-roster-column-header]");
                    await expect(heads).toHaveCount(7);
                    expect(await heads.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)))).toEqual(Array(7).fill(36));
                    expect(await frame.locator("[data-roster-people-head]").evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(37);
                    // A tile is 24px, inside its 36px row.
                    const tiles = await frame.locator("[data-roster-tile]").evaluateAll(els => els.slice(0, 20).map(el => Math.round(el.getBoundingClientRect().height)));
                    expect(tiles.length).toBeGreaterThan(0);
                    expect(new Set(tiles)).toEqual(new Set([24]));
                } else {
                    await expect(main.locator('[data-roster-grid="people-month"]')).toBeVisible();
                    await expect(frame.locator("[data-roster-week-column]")).toHaveCount(5);
                    const marks = await frame.locator("[data-roster-person-week]").first().locator("[data-roster-mark]").count();
                    expect(marks, `${name} ${width}px marks a cell`).toBe(7);
                    // The letters follow the 13px rule (P13): every lettered mark at least that wide, none narrower.
                    const lettered = await frame.locator("[data-roster-mark][data-shift]").evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, letter: (el.textContent ?? "").length > 0 })));
                    expect(lettered.length).toBeGreaterThan(0);
                    const wide = lettered.every(mark => mark.width >= 13), narrow = lettered.every(mark => mark.width < 12);
                    if (wide) expect(lettered.every(mark => mark.letter), `${width}px letters shown`).toBe(true);
                    if (narrow) expect(lettered.every(mark => !mark.letter), `${width}px letters hidden`).toBe(true);
                    // No hours in a month's name cells (P16).
                    await expect(frame.locator("[data-roster-week-hours]")).toHaveCount(0);
                }
            }
        }
    });
    test(`the month's header and the week's hold every word whole at 1440/1024/768/390/360 and a 294px parent: no week label, day letter or day number cut or touching another — a day's number only where it fits its day, a week's label dropping its month name first (retest R3) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        for (const name of ["rosterPeopleMonth", "rosterPeople"] as const) {
            const entry = await open(page, name, theme), frame = entry.locator("[data-roster-frame]").first();
            const header = frame.locator(name === "rosterPeopleMonth" ? "[data-roster-month-head]" : "[data-roster-people-head]");
            let measured = 0;
            for (const width of [1440, 1024, 768, 390, 360, 294]) {
                await size(page, entry, width);
                // A phone's People is its cards, by week alone: no header to measure.
                if (await header.count() === 0) continue;
                measured += 1;
                expect(await headerFaults(header), `${name} ${width}px`).toEqual([]);
                if (name === "rosterPeopleMonth") {
                    // Every week keeps its number whole, whatever else its label drops.
                    const labels = await header.locator("[data-roster-week-column]").evaluateAll(els => els.map(el => el.textContent ?? ""));
                    expect(labels.every(label => /W\d+/.test(label)), `${name} ${width}px week numbers`).toBe(true);
                }
            }
            expect(measured, `${name}: a width with its header`).toBeGreaterThan(0);
        }
    });
    test(`tiles take the shifts' colour tokens, their words in the ink the shade takes — the same in both themes (D6, P7) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "rosterPeople", theme), frame = entry.locator("[data-roster-frame]").first();
        await size(page, entry, 1440);
        const tiles = frame.locator('[data-roster-grid="people"] [data-roster-tile]:not([data-removed])');
        expect(await tiles.count()).toBeGreaterThan(0);
        let seen = 0;
        for (const [label, hue, ink] of SHIFTS) {
            const tile = tiles.filter({ has: page.locator(`[data-roster-assignment-name]:text-is("${label}")`) }).first();
            if (await tile.count() === 0) continue;
            seen += 1;
            expect(await tile.evaluate(el => getComputedStyle(el).backgroundColor), `${label}'s fill`).toBe(await resolve(page, "backgroundColor", `--chakra-colors-${hue}`));
            expect(await tile.evaluate(el => getComputedStyle(el).color), `${label}'s ink`).toBe(await resolve(page, "color", `--chakra-colors-${ink}`));
        }
        expect(seen).toBeGreaterThan(0);
        // The Patterns tab's marks and the assign menu's swatches take the same fill.
        const library = frame.locator('[data-frame-slot="start"]');
        const expand = frame.getByRole("button", { name: "Expand Library", exact: true });
        if (await expand.isVisible()) await expand.click();
        await library.getByRole("tab", { name: /^Patterns/ }).click();
        const early = library.locator('[data-library-item="e5m"] [data-roster-pattern-strip] > *').nth(1);
        expect(await early.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await resolve(page, "backgroundColor", "--chakra-colors-teal-300"));
        expect(await library.locator('[data-library-item="e5m"] [data-roster-pattern-strip] > *').nth(0).evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await resolve(page, "backgroundColor", "--chakra-colors-teal-300"));
    });
    test(`a pattern dropped on a person's row previews, replaces the week as one step, saves through e3 and reads back after a remount (D4, P17, P19) (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "Phone People cards use explicit actions.");
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, "rosterPeople", theme); await size(page, entry, 1200);
        const frame = entry.locator("[data-roster-frame]").first();
        await closeInspector(frame); await settled(page);
        const library = frame.locator('[data-frame-slot="start"]');
        const expand = frame.getByRole("button", { name: "Expand Library", exact: true });
        if (await expand.isVisible()) await expand.click();
        await library.getByRole("tab", { name: /^Patterns/ }).click();
        await library.getByRole("textbox", { name: "Search library" }).fill("Forward");
        const card = library.locator('[data-library-item="fwd"]');
        await expect(card).toBeVisible();
        const row = frame.locator("[data-roster-person-row]").filter({ has: page.locator("[data-roster-person-head]") }).first();
        const person = await row.locator("[data-roster-person-head]").getAttribute("data-roster-person-head");
        const target = row.locator("[data-roster-person-day]").nth(2);
        const a = (await card.boundingBox())!;
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 2 });
        await expect(page.locator("[data-drag-ghost]")).toBeVisible(); await settled(page);
        // The panes slide off main while a card is carried: the cell is measured where it rests now.
        await target.hover();
        await expect(target).toHaveAttribute("data-drop-active", "");
        await expect(page.locator("[data-drag-caption]")).toContainText("Forward rotation →");
        await expect(row.locator("[data-roster-person-day][data-pattern-hover]")).toHaveCount(7);
        await expect(row.locator("[data-roster-preview]").first()).toBeVisible();
        await page.mouse.up();
        const expected = ["Early", "Early", "Late", "Late", "Night", null, null];
        await expect.poll(() => rowLabels(row)).toEqual(expected);
        await expect(row.locator("[data-roster-person-name]")).toHaveAttribute("data-selected", "");
        await frame.getByRole("button", { name: "Undo", exact: true }).click();
        await expect(row.locator("[data-roster-tile][data-drafted]")).toHaveCount(0);
        await frame.getByRole("button", { name: "Redo", exact: true }).click();
        await expect.poll(() => rowLabels(row)).toEqual(expected);
        await frame.getByRole("button", { name: "Save", exact: true }).click();
        await expect(frame.locator("[data-roster-tile][data-drafted]")).toHaveCount(0, { timeout: 15_000 });
        const again = await remount(page, "rosterPeople"); await size(page, entry, 1200);
        const rowAgain = again.locator(`[data-roster-person-row="${person}"]`);
        await expect(rowAgain).toBeVisible();
        await expect.poll(() => rowLabels(rowAgain)).toEqual(expected);
    });
    test(`a month not read draws its header, bands, names and placeholder marks at once, the footer's line naming its weeks; the months either side are read ahead, so a step shows the next at once (#1398 on #1406, P26–P28) (${theme}) @desktop`, async ({ page }) => {
        await installE3Faults(page);
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "rosterPeopleMonth", theme); await size(page, entry, 1440);
        const frame = entry.locator("[data-roster-frame]").first();
        const next = frame.locator('[data-frame-slot="toolbar"]').getByRole("button", { name: /^Next /, exact: false });
        const held = await holdE3(page, { kinds: [...RECORD_READS] });
        // The month after, read ahead: shown whole with every read held.
        await next.click();
        await settled(page, { holding: true });
        await expect(frame.locator("[data-roster-week-column]")).toHaveCount(6);
        await expect(frame.locator("[data-roster-unread]")).toHaveCount(0);
        await expect(frame.locator("[data-builder-loading]")).toHaveCount(0);
        // Two months on, not read: the geometry first, a placeholder a mark, never Off, the toolbar live, the line naming the weeks.
        await next.click();
        await settled(page, { holding: true });
        await expect(frame.locator("[data-builder-loading]")).toHaveCount(0);
        await expect(frame.locator("[data-roster-person-row][data-roster-unread]").first()).toBeAttached();
        await expect(frame.locator("[data-roster-person-head]").first()).toBeVisible();
        await expect(frame.locator("[data-roster-mark][data-shift], [data-roster-mark][data-off], [data-roster-tile], [data-roster-assign]")).toHaveCount(0);
        await expect(frame.locator("[data-roster-mark][data-pending]").first()).toBeAttached();
        expect(new Set(await rowHeights(frame))).toEqual(new Set([36]));
        await expect(frame.locator("[data-roster-footer] [data-footer-line]")).toContainText(/W\d+–W\d+/);
        expect(await toolbarFaults(frame)).toEqual([]);
        // Released, the month lands in place: a month the warehouse rosters no one in says Off in every cell, only now (CL13).
        await releaseE3(page, held);
        await expect(frame.locator("[data-roster-unread]")).toHaveCount(0, { timeout: 30_000 });
        await settled(page);
        await expect(frame.locator("[data-roster-mark][data-off]").first()).toBeAttached();
        await expect(frame.locator("[data-roster-mark][data-pending]")).toHaveCount(0);
    });
    test(`compact spacing takes 4px off each People row and tile, by week and by month (P30) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        for (const name of ["rosterPeople", "rosterPeopleMonth"] as const) {
            const entry = await open(page, name, theme), frame = entry.locator("[data-roster-frame]").first();
            await size(page, entry, 1440);
            expect(new Set(await rowHeights(frame))).toEqual(new Set([36]));
            await frame.getByRole("button", { name: "Display", exact: true }).click();
            await page.getByRole("menuitem", { name: "Compact spacing", exact: true }).click();
            await settled(page);
            expect(new Set(await rowHeights(frame))).toEqual(new Set([32]));
            if (name === "rosterPeople") expect(new Set(await frame.locator("[data-roster-tile]").evaluateAll(els => els.slice(0, 20).map(el => Math.round(el.getBoundingClientRect().height))))).toEqual(new Set([20]));
            else expect(new Set(await frame.locator("[data-roster-mark-strip]").evaluateAll(els => els.slice(0, 20).map(el => Math.round(el.getBoundingClientRect().height))))).toEqual(new Set([20]));
            await frame.getByRole("button", { name: "Display", exact: true }).click();
            await page.getByRole("menuitem", { name: "Comfortable spacing", exact: true }).click();
            await settled(page);
            expect(new Set(await rowHeights(frame))).toEqual(new Set([36]));
        }
    });
}
