/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's Table (#1329) on the real in-page e3: the mock's anatomy —
 * its column heads, a bin's row and a free row, the chips, the placeholders
 * and the statuses — and the shared Chooser where a cell lays it (#1322),
 * measured in the page in both themes (`Allocation Spec.md` §8); the Table at
 * every width, scrolling inside main with nothing overflowing the page; and a
 * chip's drag onto a free row (A45, A47).
 */
import { expect, test, type Locator } from "playwright/test";
import { open, size, token } from "./allocation-page";
import { settled } from "./settle";

/** An element's type, as the page draws it. */
const type = (el: Element) => { const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, mono: /mono/i.test(s.fontFamily) }; };
/** A free row's key: its lane and its slot's time. */
const freeRow = (table: Locator, lane: string, hh: string, mm: string) => table.locator(`[data-allocation-row="slot:${lane}|2027-05-11T${hh}:${mm}:00.000"]`);

for (const theme of ["light", "dark"] as const) {
    test(`Table anatomy is the mock's: heads, a bin's row, a free row, chips, placeholders, statuses (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationTable", theme);
        await size(page, entry, 1440);
        const table = entry.locator("[data-allocation-table]").first();
        // The heads: 36px over a rule, mono 10px 600 uppercase tracked 0.14em in ink-4; the columns' fixed widths.
        const head = table.locator("[data-allocation-table-head]");
        expect(await head.evaluate(el => { const s = getComputedStyle(el); return [el.getBoundingClientRect().height, s.fontSize, s.fontWeight, s.textTransform, s.letterSpacing, /mono/i.test(s.fontFamily)]; }))
            .toEqual([36, "10px", "600", "uppercase", "1.4px", true]);
        expect(await head.evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-subtle"));
        const widths = await head.evaluate(el => [...el.children].map(c => Math.round(c.getBoundingClientRect().width)));
        expect([widths[0], widths[1], widths[3], widths[4], widths[6], widths[7]]).toEqual([84, 64, 64, 72, 144, 128]);
        // A bin's row: 36px; its time ink 11px 500, its lane ink-3 10.5px 500.
        const bin = table.locator('[data-allocation-row="bin:3101"]');
        expect(await bin.evaluate(el => el.getBoundingClientRect().height)).toBe(36);
        const [time, lane] = [bin.locator(":scope > span").nth(0), bin.locator(":scope > span").nth(1)];
        expect(await time.evaluate(type)).toEqual({ size: "11px", weight: "500", mono: true });
        expect(await time.evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg"));
        expect(await lane.evaluate(type)).toEqual({ size: "10.5px", weight: "500", mono: true });
        expect(await lane.evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-muted"));
        // Its chip: 28px on the rule-strong border, radius 4; the code 11px 600 in ink, the meta 10px ink-4; its chevron and × 20px targets.
        const chip = bin.locator("[data-allocation-chip=event]");
        expect(await chip.evaluate(el => { const s = getComputedStyle(el); return [el.getBoundingClientRect().height, s.borderTopStyle, s.borderTopColor, s.borderTopLeftRadius]; }))
            .toEqual([28, "solid", await token(page, "border-strong"), "4px"]);
        expect(await chip.locator("span").nth(1).evaluate(type)).toEqual({ size: "11px", weight: "600", mono: true });
        expect(await chip.locator("span").nth(2).evaluate(el => [getComputedStyle(el).fontSize, getComputedStyle(el).color])).toEqual(["10px", await token(page, "fg-subtle")]);
        expect(await chip.locator("button").evaluateAll(els => els.map(e => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]))).toEqual([[20, 20], [20, 20]]);
        // Its quantity right-aligned 11px; its load 10.5px 500 in ink-2; its status 10.5px 600 uppercase tracked 0.1em in ink-3, an 8px dot in pos.
        const units = bin.locator(":scope > span").nth(2);
        expect(await units.evaluate(el => [getComputedStyle(el).fontSize, getComputedStyle(el).textAlign])).toEqual(["11px", "right"]);
        const load = bin.locator(":scope > span").nth(4);
        expect(await load.evaluate(el => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight, getComputedStyle(el).color])).toEqual(["10.5px", "500", await token(page, "fg-strong")]);
        const status = bin.locator("[data-status]");
        expect(await status.evaluate(el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.textTransform, s.letterSpacing, s.color]; }))
            .toEqual(["10.5px", "600", "uppercase", "1.05px", await token(page, "fg-muted")]);
        expect(await status.locator("span").evaluate(el => [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height), getComputedStyle(el).backgroundColor]))
            .toEqual([8, 8, await token(page, "status-pos")]);
        // A free row: dashed placeholders, italic 10.5px ink-4, the event's spanning its quantity and the app's columns; its time ink-3; Free in ink-5.
        const free = freeRow(table, "B-1", "00", "15");
        const placeholder = free.locator("[data-allocation-placeholder=event]");
        expect(await placeholder.evaluate(el => { const s = getComputedStyle(el); return [el.getBoundingClientRect().height, s.borderTopStyle, s.borderTopColor, s.fontStyle, s.fontSize, s.color]; }))
            .toEqual([28, "dashed", await token(page, "border-strong"), "italic", "10.5px", await token(page, "fg-subtle")]);
        expect(await placeholder.evaluate(el => Math.round(el.parentElement!.getBoundingClientRect().width))).toBe(widths[2]! + widths[3]! + widths[4]!);
        expect(await free.locator(":scope > span").first().evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-muted"));
        expect(await free.locator("[data-status] span").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "fg-faint"));
        // A band: the shared group band, its row count a 16px badge on paper-3.
        const band = table.locator("[data-allocation-band]").first();
        await expect(band).toHaveAttribute("aria-expanded", "true");
        const count = band.locator("[data-schedule-group-content] > span").nth(1);
        expect(await count.evaluate(el => [Math.round(el.getBoundingClientRect().height), getComputedStyle(el).backgroundColor])).toEqual([16, await token(page, "bg-subtle")]);
    });

    test(`the Chooser where a cell lays it: the popover's 320px, a 32px search, 24px heads, 40px options, the reasons, a 32px foot (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationTable", theme);
        await size(page, entry, 1440);
        const table = entry.locator("[data-allocation-table]").first();
        await table.locator('[data-allocation-row="bin:3101"] [data-allocation-cell-side=resource] [aria-haspopup=listbox]').click();
        const list = page.locator("[data-chooser]");
        await expect(list.getByRole("option", { name: /K-601/ })).toBeVisible();
        await expect(list.locator("[role=group][aria-label='Gaps that fit']")).toHaveCount(1);
        await page.locator("[data-chooser]").evaluate(el => Promise.all(el.closest("[data-scope=popover]")!.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)));
        const measure = await list.evaluate(root => {
            const r = (el: Element | null) => el === null ? null : Math.round(el.getBoundingClientRect().height);
            const option = root.querySelector("[role=option][data-state=refused]")!;
            const text = option.children[1]!;
            const style = (el: Element) => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.color]; };
            return {
                width: Math.round(root.closest("[data-scope=popover][data-part=content]")!.getBoundingClientRect().width),
                search: r(root.querySelector("label")), head: r(root.querySelector("[role=group] > [aria-hidden]")), option: r(root.querySelector("[role=option]")),
                foot: r(root.lastElementChild), label: style(text.children[0]!), line: style(text.children[1]!), range: style(option.children[2]!),
                headType: (() => { const s = getComputedStyle(root.querySelector("[role=group] > [aria-hidden]")!); return [s.fontSize, s.fontWeight, s.textTransform]; })(),
            };
        });
        expect([measure.width, measure.search, measure.head, measure.foot]).toEqual([320, 32, 24, 32]);
        expect(measure.option).toBeGreaterThanOrEqual(40);
        expect(measure.headType).toEqual(["10px", "600", "uppercase"]);
        // A resource that doesn't fit: its name and range muted, its reason in the warning's text.
        expect(measure.label.slice(0, 2)).toEqual(["11px", "600"]);
        expect(measure.line).toEqual(["9.5px", "400", await token(page, "fg-warning")]);
        expect(measure.range.slice(0, 2)).toEqual(["10.5px", "500"]);
        await page.keyboard.press("Escape");
    });

    test(`the yard's own words and shifts (#1338): every heading in its column, none cut; the bands head the yard's shifts (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationLabels", theme);
        await size(page, entry, 1440);
        const table = entry.locator("[data-allocation-table]").first();
        const head = table.locator("[data-allocation-table-head]");
        expect(await head.evaluate(el => [...el.children].map(c => c.textContent))).toEqual(["Time", "Bay", "Delivery", "Vol", "Spec", "Kiln", "Load", "Status"]);
        // The columns keep their widths whatever their words, and no heading is cut; a longer one would end in an ellipsis.
        const widths = await head.evaluate(el => [...el.children].map(c => Math.round(c.getBoundingClientRect().width)));
        expect([widths[0], widths[1], widths[3], widths[4], widths[6], widths[7]]).toEqual([84, 64, 64, 72, 144, 128]);
        expect(await head.evaluate(el => [...el.children].filter(c => c.scrollWidth > c.clientWidth).map(c => c.textContent))).toEqual([]);
        expect(await head.evaluate(el => [getComputedStyle(el.children[3]!).textOverflow, el.children[3]!.getAttribute("title")])).toEqual(["ellipsis", "Vol"]);
        // Nothing narrowed: the summary names no source (#1358).
        await expect(entry.locator('[data-frame-slot="toolbar"] [data-record-slices-summary]')).toHaveCount(0);
        // The bands: the yard's shifts, folded to their heads.
        for (let i = 0; i < 3; i++) {
            const unfolded = table.locator("[data-allocation-band][aria-expanded=true]").first();
            if (await unfolded.count() === 0) break;
            await unfolded.click(); await settled(page);
        }
        expect(await table.locator("[data-allocation-band]").evaluateAll(els => els.map(e => e.textContent))).toEqual([
            "Night207 bins · 13 free · 208 m³ · collapsed", "Day shift4013 bins · 27 free · 208 m³ · collapsed", "Evening206 bins · 14 free · 140 m³ · collapsed",
        ]);
        // A bay's area chosen through its chip, live on a frame wide enough for every chip: the summary counts the bays in the yard's word.
        await page.setViewportSize({ width: 2800, height: 1200 });
        await size(page, entry, 2400);
        await entry.locator('[data-frame-slot="toolbar"] [data-record-slice-source="lanes"][data-record-slice-field="area"]').first().click();
        await page.getByRole("button", { name: "North 2" }).click();
        await page.keyboard.press("Escape");
        await settled(page);
        await expect(entry.locator('[data-frame-slot="toolbar"] [data-record-slices-summary]').first()).toHaveText("2 of 3 bays");
    });

    test(`Table fits 1440/1024/768/390/360 and a 294px parent, scrolling inside main; below 480px of main, its cards (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationTable", theme);
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const at = await entry.locator("[data-allocation-frame]").first().evaluate((frame) => {
                const faults: string[] = [];
                const box = frame.getBoundingClientRect();
                if (frame.scrollWidth - frame.clientWidth > 1) faults.push("frame overflows");
                const table = frame.querySelector("[data-allocation-table]");
                // The Table is main's from 480px of main; below it, the narrow layout's cards (A78, #1333).
                const main = frame.querySelector("[data-allocation-main]")!.getBoundingClientRect(), cards = frame.querySelector('[data-allocation-cards="table"]');
                if (main.width < 480 && (table !== null || cards === null)) faults.push("below 480px of main, main is not the Table's cards");
                if (main.width >= 480 && (table === null || cards !== null)) faults.push("from 480px of main, main is not the Table");
                if (table !== null) {
                    const t = table.getBoundingClientRect();
                    if (t.right > box.right + 1 || t.left < box.left - 1) faults.push("table leaves the frame");
                    const pane = table.querySelector("[data-virtual-rows]") as HTMLElement | null;
                    if (pane !== null && pane.getBoundingClientRect().right > t.right + 1) faults.push("the pane leaves the table");
                }
                return faults;
            });
            expect(at, `${width}px`).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBeLessThanOrEqual(0);
        }
    });

    test(`A45, A47 — a chip's drag: every free row's event placeholder a brand-d target; the one under the pointer brand-tint, \`drop to move here\` (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationTable", theme);
        await size(page, entry, 1440);
        const table = entry.locator("[data-allocation-table]").first();
        await table.evaluate(el => el.scrollIntoView({ block: "center" })); await settled(page);
        const chip = table.locator('[data-allocation-row="bin:3103"] [data-allocation-chip=event]');
        const b = (await chip.boundingBox())!;
        await page.mouse.move(b.x + 30, b.y + b.height / 2); await page.mouse.down();
        for (let i = 1; i <= 4; i++) await page.mouse.move(b.x + 30 + i * 3, b.y + b.height / 2 + i * 2);
        await expect(table).toHaveAttribute("data-allocation-drag", "body");
        const target = freeRow(table, "B-2", "00", "35").locator("[data-allocation-placeholder=event]");
        const other = freeRow(table, "B-3", "00", "55").locator("[data-allocation-placeholder=event]");
        expect(await other.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "brand-solid"));
        const t = (await target.boundingBox())!;
        await page.mouse.move(t.x + 60, t.y + t.height / 2, { steps: 4 }); await page.mouse.move(t.x + 64, t.y + t.height / 2); await settled(page);
        expect(await target.evaluate(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.fontStyle]; }))
            .toEqual([await token(page, "brand-tint"), await token(page, "brand-pressed"), "normal"]);
        await expect(target.locator("[data-say=drop]")).toBeVisible();
        await expect(target.locator("[data-say=idle]")).toBeHidden();
        await page.mouse.up(); await settled(page);
        // Dropped, the bin is in that row's lane and time.
        await expect(table.locator('[data-allocation-row="bin:3103"] > span').first()).toHaveText("00:35");
    });
}
