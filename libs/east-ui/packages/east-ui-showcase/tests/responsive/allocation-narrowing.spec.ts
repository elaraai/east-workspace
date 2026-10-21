/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's narrowing (#1336, #1339) on the real in-page e3: one rail
 * over the bays', the kilns' and the loads' records, in both layouts, at every
 * width with nothing leaving the toolbar; an Area chosen through it narrows the
 * Table's rows and the Timeline's lane columns; its summary counts each source
 * a narrowing hides rows of on one line in the shared count's type — the bins
 * the day's window holds among them (#1358); folded on a phone, its editor heads each source's
 * fields — two, three, one — with the source's name, icon and count (A95, #1358); wide, each chip
 * carries its source's icon; and the Library follows the rail, each narrowed
 * tab counting what it shows (A91–A99).
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
    return { fields: [...live, ...folded].sort(), named: /Area/.test(trigger) && /Kiln group/.test(trigger) && /Spec/.test(trigger) };
});
/** The frame wide enough for every chip of the rail live: three sources' six fields, their presets and their summary; and a page wide enough for it. */
const WIDE = 2400;
const WIDE_PAGE = 2800;
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
                expect(shown.named || shown.fields.join() === "arrivals.spec,bays.area,bays.cover,kilns.group,kilns.max,kilns.name", `${layout} ${width}px: ${JSON.stringify(shown)}`).toBe(true);
            }
            // Wide, the rail's chips are live, in source order, each carrying its source's icon at the rail's own icon's size (A95).
            await page.setViewportSize({ width: WIDE_PAGE, height: 1080 });
            await size(page, entry, WIDE);
            expect(await chips(frame), layout).toEqual(["bays.area", "bays.cover", "kilns.group", "kilns.max", "kilns.name", "arrivals.spec"]);
            const icons = await frame.locator('[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]').first().evaluate(rail => ["Area", "Cover", "Kiln group", "Max m³", "Name", "Spec", "Presets"].map(label => {
                const svg = rail.querySelector(`[title="${label}"] svg`)!, box = svg.getBoundingClientRect();
                return { icon: svg.getAttribute("data-icon"), w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 };
            }));
            // Every field its source's icon — a range and a search alike — at the rail's own icon's size.
            expect(icons.map(i => i.icon), layout).toEqual(["warehouse", "warehouse", "fire", "fire", "fire", "truck", "users"]);
            for (const i of icons) expect([i.w, i.h], `${layout} ${i.icon}`).toEqual([icons[6]!.w, icons[6]!.h]);
            await page.setViewportSize({ width: 2160, height: 1080 });
        }
    });

    test(`an Area chosen through the rail narrows the Table's rows and the Timeline's lanes; the summary counts each source a narrowing hides rows of (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: WIDE_PAGE, height: 1200 });
        const entry = await open(page, "allocationTable", theme);
        await size(page, entry, WIDE);
        const frame = entry.locator("[data-allocation-frame]").first();
        const table = frame.locator("[data-allocation-table]");
        const lanes = () => table.locator("[data-allocation-row] > span:nth-child(2)").allTextContents();
        // Nothing of the bays, the kilns or the arrivals narrowed: the summary names the bins alone, the day's window holding 26 of the record's 33.
        await expect(summary(frame)).toHaveText("26 of 33 bin events");
        expect(new Set(await lanes())).toEqual(new Set(["B-1", "B-2", "B-3"]));
        await frame.locator('[data-frame-slot="toolbar"] [data-record-slice-source="bays"][data-record-slice-field="area"]').first().click();
        await page.getByRole("button", { name: "North 2" }).click();
        await page.keyboard.press("Escape");
        await settled(page);
        await expect(summary(frame)).toHaveText("26 of 33 bin events·2 of 3 lanes");
        // A second source narrowed: each count in the shared count's type, on one line, the dot between them quieter.
        await frame.locator('[data-frame-slot="toolbar"] [data-record-slice-source="kilns"][data-record-slice-field="group"]').first().click();
        await page.getByRole("button", { name: /^Hall A/ }).first().click();
        await page.keyboard.press("Escape");
        await settled(page);
        await expect(summary(frame)).toHaveText("26 of 33 bin events·2 of 3 lanes·10 of 33 resources");
        const type = await summary(frame).evaluate(el => {
            const counts = [...el.querySelectorAll("[role=status]")], gap = el.querySelector("[aria-hidden]")!;
            const s = getComputedStyle(counts[0]!), g = getComputedStyle(gap);
            return { mono: /mono/i.test(s.fontFamily), size: s.fontSize, numerals: s.fontVariantNumeric, gap: g.color,
                counts: counts.length, oneLine: new Set(counts.map(c => Math.round(c.getBoundingClientRect().top))).size === 1 };
        });
        expect(type).toEqual({ mono: true, size: "11px", numerals: "tabular-nums", gap: await token(page, "fg-subtle"), counts: 3, oneLine: true });
        expect(new Set(await lanes())).toEqual(new Set(["B-1", "B-2"]));
        await expect(table.locator('[data-allocation-row="bin:3101"]')).toHaveCount(0);
        await frame.getByRole("radio", { name: "Timeline", exact: true }).first().click(); await settled(page);
        expect(await frame.locator("[data-allocation-lane]").evaluateAll(els => els.map(el => el.getAttribute("data-allocation-lane")))).toEqual(["B-1", "B-2"]);
        // Two lane columns: the lane pane is as wide as its hour column and two lanes.
        expect(await frame.locator("[data-allocation-lanes] > *").first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(48 + 2 * 96);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test(`folded on a phone, the rail's editor heads each source's field with its name, icon and count, then the presets; no line repeats a count (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const entry = await open(page, "allocationTable", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        await frame.locator('[data-frame-slot="toolbar"] [data-slice-rail="record-slices"] button[aria-label^="Filters:"]').first().click();
        const editor = page.getByRole("dialog");
        await expect(editor.locator("[data-slice-section]")).toHaveCount(7);
        expect(await editor.locator("[data-slice-section] [data-record-slice-source]").evaluateAll(els => els.map(el => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`)))
            .toEqual(["bays.area", "bays.cover", "kilns.group", "kilns.max", "kilns.name", "arrivals.spec"]);
        // Every source a field heads is counted in its heading; the bins, which no field heads, on the line under the fields (#1358, D9).
        await expect(editor.locator("[data-record-slices-summary]")).toHaveText("26 of 33 bin events");
        // A95: each heading the small mono caps in the quiet ink, the board's noun for its source, its icon 10px and centred on its name, over its own field;
        // its count at the heading's end on the name's line, lighter, in tabular figures (#1358).
        const heads = await editor.evaluate(root => [...root.querySelectorAll<HTMLElement>("[data-slice-group]")].map(head => {
            const label = head.querySelector<HTMLElement>("[data-rail-group-label]")!, s = getComputedStyle(label), svg = head.querySelector("svg"), l = label.getBoundingClientRect();
            const i = svg?.getBoundingClientRect(), pad = getComputedStyle(head).paddingTop, h = head.getBoundingClientRect();
            const count = head.querySelector<HTMLElement>("[data-rail-group-count]"), cs = count === null ? null : getComputedStyle(count), c = count?.getBoundingClientRect();
            return { key: head.dataset.sliceGroup, text: label.textContent, caps: s.textTransform, mono: /mono/i.test(s.fontFamily), size: s.fontSize, weight: s.fontWeight, color: s.color,
                icon: svg?.getAttribute("data-icon") ?? null, iconBox: i === undefined ? null : [Math.round(i.width), Math.round(i.height)],
                centred: i === undefined || Math.abs((i.top + i.height / 2) - (l.top + l.height / 2)) <= 1, gap: i === undefined ? null : Math.round(l.left - i.right), pad,
                heads: (head.nextElementSibling as HTMLElement | null)?.dataset.sliceSection,
                count: count === null ? null : count.textContent,
                countType: cs === null ? null : [/mono/i.test(cs.fontFamily), cs.fontSize, cs.fontWeight, cs.color, cs.fontVariantNumeric],
                countPlaced: c === undefined || (Math.abs((c.top + c.height / 2) - (l.top + l.height / 2)) <= 1 && c.left >= l.right && c.right <= h.right + 0.5) };
        }));
        const subtle = await token(page, "fg-subtle");
        expect(heads.map(h => [h.key, h.text, h.icon, h.heads, h.count])).toEqual([
            ["source:bays", "lanes", "warehouse", "field:bays.area", "3"], ["source:kilns", "resources", "fire", "field:kilns.group", "33"],
            ["source:arrivals", "arrivals", "truck", "field:arrivals.spec", "27"], ["presets", "Presets", null, "presets", null]]);
        for (const h of heads) {
            expect([h.caps, h.mono, h.size, h.weight, h.color, h.centred], h.key).toEqual(["uppercase", true, "9.5px", "600", subtle, true]);
            if (h.icon !== null) expect([h.iconBox, h.gap], h.key).toEqual([[10, 10], 6]);
            if (h.count !== null) expect([h.countType, h.countPlaced], h.key).toEqual([[true, "9.5px", "500", subtle, "tabular-nums"], true]);
        }
        // The first heading sits at the editor's top; each later one 12px under the field before it.
        expect(heads.map(h => h.pad)).toEqual(["4px", "12px", "12px", "12px"]);
        // The editor stays inside the phone's viewport.
        const box = (await editor.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        await page.keyboard.press("Escape");
    });

    test(`A98, A99 — the Library follows the rail: a narrowed tab counts what it shows, \`Resources 10 of 33\`, on one line in the tab count's type; the rail's badge and mark follow (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: WIDE_PAGE, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, WIDE);
        const frame = entry.locator("[data-allocation-frame]").first();
        const start = frame.locator('[data-frame-slot="start"]');
        const choose = async (source: string, field: string, value: RegExp) => {
            await frame.locator(`[data-frame-slot="toolbar"] [data-record-slice-source="${source}"][data-record-slice-field="${field}"]`).first().click();
            await page.getByRole("button", { name: value }).first().click();
            await page.keyboard.press("Escape");
            await settled(page);
        };
        await choose("kilns", "group", /^Hall A/);
        await expect(start.locator('[role="tab"]')).toHaveText(["Arrivals 27", "Resources 10 of 33"]);
        await start.locator('[role="tab"]').nth(1).click(); await settled(page);
        await expect(frame.locator('[data-allocation-library="resources"] [data-library-item]')).toHaveCount(10);
        // Each count on its tab's line, in one type, inside the 264px pane; the tab row still 44px.
        const tabs = await start.evaluate(el => {
            const pane = el.getBoundingClientRect();
            return [...el.querySelectorAll('[role="tab"]')].map(tab => {
                const count = tab.querySelector("[data-tab-count]")!, s = getComputedStyle(count), c = count.getBoundingClientRect(), t = tab.getBoundingClientRect();
                return { type: [s.fontFamily, s.fontSize, s.fontWeight, s.color, s.fontVariantNumeric], oneLine: c.height <= t.height && c.top >= t.top - 0.5 && c.bottom <= t.bottom + 0.5,
                    inside: t.right <= pane.right + 0.5, height: Math.round(el.querySelector("[data-dock-tabs]")!.parentElement!.getBoundingClientRect().height) };
            });
        });
        expect(tabs.map(t => [t.oneLine, t.inside, t.height])).toEqual([[true, true, 44], [true, true, 44]]);
        expect(tabs[1]!.type).toEqual(tabs[0]!.type);
        // An arrivals narrowing: the Arrivals tab and the board's bins with it; Overdue on the rail while one of its arrivals is.
        await choose("arrivals", "spec", /^MC12/);
        await expect(start.locator('[role="tab"]')).toHaveText(["Arrivals 3 of 27", "Resources 10 of 33"]);
        await expect(frame.locator("[data-allocation-timeline] [data-allocation-card]")).toHaveCount(1);
        await expect(summary(frame)).toHaveText("26 of 33 bin events·10 of 33 resources·3 of 27 arrivals");
        await start.getByRole("button", { name: "Collapse Library" }).click(); await settled(page);
        expect(await start.evaluate(el => [el.querySelector("[data-dock-badge]")!.textContent, el.querySelector("[data-dock-mark]")?.getAttribute("aria-label") ?? null])).toEqual(["10", null]);
        await start.getByRole("button", { name: "Expand Library" }).click(); await settled(page);
        await start.locator('[role="tab"]').nth(0).click(); await settled(page);
        await start.getByRole("button", { name: "Collapse Library" }).click(); await settled(page);
        expect(await start.evaluate(el => [el.querySelector("[data-dock-badge]")!.textContent, el.querySelector("[data-dock-mark]")?.getAttribute("aria-label") ?? null])).toEqual(["3", "Overdue arrival"]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}
