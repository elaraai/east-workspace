/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's narrowing (#1336) on the real in-page e3: one rail over the
 * bays' and the kilns' records, in both layouts, at every width with nothing
 * leaving the toolbar; an Area chosen through it narrows the Table's rows and
 * the Timeline's lane columns; its summary counts each source on one line in
 * the shared count's type; and folded on a phone, its editor holds each
 * source's field (A91–A96).
 */
import { expect, test, type Locator } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { open, size, token } from "./allocation-page";
import { settled } from "./settle";

/** The rail's chips, as `source.field`. */
const chips = (frame: Locator) => frame.locator('[data-frame-slot="toolbar"] [data-record-slice-source][data-record-slice-field]')
    .evaluateAll(els => els.filter(el => el.getBoundingClientRect().width > 0).map(el => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`));
/**
 * Every source's field as the rail shows it at its width: a live chip, a
 * folded summary chip (`field:source.field`), or past those its one trigger,
 * named for every field it holds.
 */
const railFields = (frame: Locator) => frame.locator('[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]').first().evaluate(rail => {
    const live = [...rail.querySelectorAll("[data-record-slice-source][data-record-slice-field]")].filter(el => el.getBoundingClientRect().width > 0)
        .map(el => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`);
    const folded = [...rail.querySelectorAll("[data-slice-fold^='field:']")].map(el => el.getAttribute("data-slice-fold")!.slice(6));
    const trigger = rail.querySelector("button[aria-label^='Filters:']")?.getAttribute("aria-label") ?? "";
    return { fields: [...live, ...folded].sort(), named: /Area/.test(trigger) && /Kiln group/.test(trigger) };
});
const summary = (frame: Locator) => frame.locator('[data-frame-slot="toolbar"] [data-record-slices-summary]').first();

for (const theme of ["light", "dark"] as const) {
    test(`the one rail stands in both layouts at every width, nothing leaving the toolbar (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        for (const layout of ["Timeline", "Table"] as const) {
            await size(page, entry, 1440);
            await frame.getByRole("radio", { name: layout, exact: true }).first().click(); await settled(page);
            for (const width of [1920, 1440, 1024, 768, 390, 360, 294]) {
                await size(page, entry, width);
                expect(await toolbarFaults(frame), `${layout} ${width}px`).toEqual([]);
                // The rail is in the row, every source's field in it: live, folded to its chip, or in its one trigger's name.
                await expect(frame.locator('[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]').first(), `${layout} ${width}px`).toBeVisible();
                const shown = await railFields(frame);
                expect(shown.named || shown.fields.join() === "lanes.area,resources.group", `${layout} ${width}px: ${JSON.stringify(shown)}`).toBe(true);
            }
            // Wide, the rail's chips are live, in source order.
            await size(page, entry, 1920);
            expect(await chips(frame), layout).toEqual(["lanes.area", "resources.group"]);
        }
    });

    test(`an Area chosen through the rail narrows the Table's rows and the Timeline's lanes; the summary counts each source (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationTable", theme);
        await size(page, entry, 1920);
        const frame = entry.locator("[data-allocation-frame]").first();
        const table = frame.locator("[data-allocation-table]");
        const lanes = () => table.locator("[data-allocation-row] > span:nth-child(2)").allTextContents();
        await expect(summary(frame)).toHaveText("3 of 3 lanes·33 of 33 resources");
        expect(new Set(await lanes())).toEqual(new Set(["B-1", "B-2", "B-3"]));
        // The summary: each source's count in the shared count's type, on one line, the dot between them quieter.
        const type = await summary(frame).evaluate(el => {
            const counts = [...el.querySelectorAll("[role=status]")], gap = el.querySelector("[aria-hidden]")!;
            const s = getComputedStyle(counts[0]!), g = getComputedStyle(gap);
            return { mono: /mono/i.test(s.fontFamily), size: s.fontSize, numerals: s.fontVariantNumeric, gap: g.color,
                counts: counts.length, oneLine: new Set(counts.map(c => Math.round(c.getBoundingClientRect().top))).size === 1 };
        });
        expect(type).toEqual({ mono: true, size: "11px", numerals: "tabular-nums", gap: await token(page, "fg-subtle"), counts: 2, oneLine: true });
        await frame.locator('[data-frame-slot="toolbar"] [data-record-slice-source="lanes"][data-record-slice-field="area"]').first().click();
        await page.getByRole("button", { name: "North 2" }).click();
        await page.keyboard.press("Escape");
        await settled(page);
        await expect(summary(frame)).toHaveText("2 of 3 lanes·33 of 33 resources");
        expect(new Set(await lanes())).toEqual(new Set(["B-1", "B-2"]));
        await expect(table.locator('[data-allocation-row="bin:3101"]')).toHaveCount(0);
        await frame.getByRole("radio", { name: "Timeline", exact: true }).first().click(); await settled(page);
        expect(await frame.locator("[data-allocation-lane]").evaluateAll(els => els.map(el => el.getAttribute("data-allocation-lane")))).toEqual(["B-1", "B-2"]);
        // Two lane columns: the lane pane is as wide as its hour column and two lanes.
        expect(await frame.locator("[data-allocation-lanes] > *").first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(48 + 2 * 96);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test(`folded on a phone, the rail's editor holds each source's field, and its summary (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const entry = await open(page, "allocationTable", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        await frame.locator('[data-frame-slot="toolbar"] [data-slice-rail="record-slices"] button[aria-label^="Filters:"]').first().click();
        const editor = page.getByRole("dialog");
        await expect(editor.locator("[data-slice-section]")).toHaveCount(3);
        expect(await editor.locator("[data-slice-section] [data-record-slice-source]").evaluateAll(els => els.map(el => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`)))
            .toEqual(["lanes.area", "resources.group"]);
        await expect(editor.locator("[data-record-slices-summary]")).toHaveText("3 of 3 lanes·33 of 33 resources");
        // The editor stays inside the phone's viewport.
        const box = (await editor.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        await page.keyboard.press("Escape");
    });
}
