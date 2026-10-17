/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/**
 * The Allocation's Timeline (#1326) on the real in-page e3: the mock's
 * anatomy, measured in the page in both themes (`Allocation Spec.md` §8); the
 * board at every width with nothing overflowing; and the scrolls that follow a
 * selection (A12).
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const FILE = "e3/allocation/allocation";
async function open(page: Page, name = "allocationKilnYard", theme: "light" | "dark" = "light") {
    await page.goto(`/?theme=${theme}#${FILE}/${name}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-allocation-card]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}
async function size(page: Page, entry: Locator, width: number) {
    await entry.locator("[data-allocation-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}
/** A theme token as the page resolves it, as a computed colour. */
function token(page: Page, name: string) {
    return page.evaluate((n) => {
        const probe = document.createElement("span");
        probe.style.color = `var(--chakra-colors-${n})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
    }, name);
}
/** An element's type, as the page draws it. */
const type = (el: Element) => { const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, mono: /mono/i.test(s.fontFamily) }; };

for (const theme of ["light", "dark"] as const) {
    test(`Timeline anatomy is the mock's (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const timeline = entry.locator("[data-allocation-timeline]").first();
        const geometry = await timeline.evaluate((root) => {
            const r = (el: Element | null) => { const b = el!.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
            const heads = [...root.querySelectorAll(":scope [data-allocation-lanes] > * > :first-child, [data-allocation-channel] > :first-child, [data-allocation-resource-head]")].map(el => r(el).h);
            const grid = r(root.querySelector("[data-allocation-grid]"));
            const card = r(root.querySelector('[data-allocation-card="3101"]'));
            const caption = root.querySelector("[data-allocation-lanes] [data-head-caption]")!;
            const lanes = [...root.querySelectorAll("[data-allocation-lane]")].map(el => r(el).w);
            const row = root.querySelector('[data-allocation-resource="K-105"]')!;
            const label = row.firstElementChild!, labelStyle = getComputedStyle(label);
            const load = row.querySelector("[data-allocation-load]")!;
            const units = root.querySelector("[data-time-ruler=units]")!, ticks = root.querySelector("[data-time-ruler=ticks]")!;
            const badge = root.querySelector("[data-time-ruler=ticks] > [data-now] > [data-tick-label]")!;
            return {
                heads, laneCaption: r(caption).w, lanes, channel: r(root.querySelector("[data-allocation-channel]")).w,
                card: { w: card.w, h: card.h, left: card.x - grid.x, top: card.y - grid.y },
                rowH: r(row).h, label: { w: r(label).w, left: labelStyle.paddingLeft, right: labelStyle.paddingRight },
                bar: { top: r(load).y - r(row).y, h: r(load).h, radius: getComputedStyle(load).borderTopLeftRadius },
                ruler: { units: r(units).h, ticks: r(ticks).h, badge: r(badge).h },
            };
        });
        expect(geometry.heads).toEqual([48, 48, 48]);
        expect(geometry.laneCaption).toBe(48);
        expect(geometry.lanes).toEqual([96, 96, 96]);
        expect(geometry.channel).toBe(48);
        // LD-2201 is B-3's 01:55 bin: 88 × 28 at 52 + 96 × 2, the hour of 01's top + 4.
        expect(geometry.card).toEqual({ w: 88, h: 28, left: 244, top: 40 });
        expect(geometry.rowH).toBe(36);
        expect(geometry.label).toEqual({ w: 152, left: "20px", right: "12px" });
        expect(geometry.bar).toEqual({ top: 8, h: 20, radius: "4px" });
        expect(geometry.ruler).toEqual({ units: 24, ticks: 23, badge: 16 });

        const card = timeline.locator('[data-allocation-card="3101"]');
        expect(await card.locator("[data-allocation-code]").evaluate(type)).toEqual({ size: "10.5px", weight: "600", line: "12px", mono: true });
        expect(await card.locator("[data-allocation-to]").evaluate(type)).toMatchObject({ size: "9.5px", mono: true });
        expect(await card.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "border-strong"));
        const row = timeline.locator('[data-allocation-resource="K-207"]');
        expect(await row.locator("span").first().evaluate(type)).toEqual({ size: "11px", weight: "600", line: "14px", mono: true });
        const line = row.locator("[data-allocation-line]");
        expect(await line.evaluate(type)).toEqual({ size: "9.5px", weight: "600", line: "12px", mono: true });
        expect(await line.evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-danger"));
        expect(await timeline.locator('[data-allocation-resource="K-101"] [data-allocation-line]').evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-subtle"));
        expect(await timeline.locator('[data-allocation-resource="K-105"] [data-allocation-load]').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "brand-solid"));
        expect(await timeline.locator("[data-allocation-channel]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "bg-canvas"));
        expect(await timeline.locator("[data-time-ruler=ticks] > [data-now] > [data-tick-label]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "brand-solid"));

        // A13: the focus dims every other card to the rule border and ink-4 words; the pointer on one lifts it.
        await card.click(); await settled(page);
        const other = timeline.locator('[data-allocation-card="3102"]');
        await page.mouse.move(0, 0);
        expect(await other.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "border-subtle"));
        expect(await other.locator("[data-allocation-code]").evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-subtle"));
        await other.hover();
        expect(await other.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "border-strong"));
        // A21: the selected card's connector, a 22px target on its right edge holding a 10px square.
        const connector = card.locator("[data-allocation-connector]");
        expect(await connector.evaluate(el => { const b = el.getBoundingClientRect(), c = el.parentElement!.getBoundingClientRect(); return { w: b.width, h: b.height, right: Math.round(b.right - c.right), top: Math.round(b.top - c.top) }; }))
            .toEqual({ w: 22, h: 22, right: 11, top: 3 });
    });

    test(`Timeline fits 1440/1024/768/390/360 and a 294px parent (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const at = await entry.locator("[data-allocation-frame]").first().evaluate((frame) => {
                const faults: string[] = [];
                const box = frame.getBoundingClientRect();
                const main = frame.querySelector("[data-allocation-main]")!.getBoundingClientRect();
                if (frame.scrollWidth - frame.clientWidth > 1) faults.push("frame overflows");
                const timeline = frame.querySelector("[data-allocation-timeline]");
                // The Timeline is main's from 480px of main; below it, the narrow layout's cards (A78, #1333).
                if (timeline !== null && main.width >= 480) {
                    const t = timeline.getBoundingClientRect();
                    if (t.right > box.right + 1 || t.left < box.left - 1) faults.push("timeline leaves the frame");
                    for (const pane of timeline.children) if (pane.getBoundingClientRect().right > t.right + 1) faults.push(`a pane leaves the timeline`);
                }
                return { main: main.width, faults };
            });
            expect(at.main, `${width}px main`).toBeGreaterThan(0);
            expect(at.faults, `${width}px`).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBeLessThanOrEqual(0);
        }
    });

    test(`A12 — selecting follows the selection: a bin scrolls its lane hour into view and levels its resource row with it (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const timeline = entry.locator("[data-allocation-timeline]").first();
        // A bin's resource row levels with its card, snapped to rows: LD-2216 (B-3 17:56) on K-205, LD-2213 (B-3 16:55) on K-303.
        for (const [id, resource] of [["3119", "K-205"], ["3116", "K-303"]] as const) {
            const card = timeline.locator(`[data-allocation-card="${id}"]`);
            await card.scrollIntoViewIfNeeded();
            await card.click(); await settled(page);
            const level = await timeline.evaluate((root, [id, resource]) => {
                const lane = root.querySelector<HTMLElement>("[data-allocation-lanes]")!, rows = root.querySelector<HTMLElement>("[data-virtual-rows]")!;
                const card = root.querySelector(`[data-allocation-card="${id}"]`)!.getBoundingClientRect();
                const row = root.querySelector(`[data-allocation-resource="${resource}"]`)!.getBoundingClientRect();
                const view = lane.getBoundingClientRect();
                return { inView: card.top >= view.top + 48 && card.bottom <= view.bottom, apart: Math.abs((card.top + card.height / 2) - (row.top + row.height / 2)), snapped: rows.scrollTop % 36 };
            }, [id, resource]);
            expect(level.inView, id).toBe(true);
            expect(level.apart, id).toBeLessThanOrEqual(18);
            expect(level.snapped, id).toBe(0);
        }
        // A resource below the view scrolls its row into view.
        const k602 = timeline.locator('[data-allocation-resource="K-602"]');
        await timeline.locator("[data-virtual-rows]").evaluate(el => { el.scrollTop = el.scrollHeight; });
        await settled(page);
        await k602.click(); await settled(page);
        expect(await k602.evaluate(el => { const b = el.getBoundingClientRect(), p = el.closest("[data-virtual-rows]")!.getBoundingClientRect(); return b.top >= p.top + 48 && b.bottom <= p.bottom; })).toBe(true);
    });
}
