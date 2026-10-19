/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's frame (#1325) on the real in-page e3: its one toolbar row
 * at every width, the combined View fold that keeps the date, the layout and
 * Publish reachable in the narrowest frame (A1), the date picker's day marks
 * (A2), and the footer — Plan's rail, the layout's legend only (A79) — in both
 * themes.
 */
import { expect, test } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { open, size, token } from "./allocation-page";
import { settled } from "./settle";

for (const theme of ["light", "dark"] as const) {
    test(`A1 — one toolbar row at every width, history folding last; at 294px the date, the layout, Save and Publish stay reachable (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            expect(await frame.locator("[data-allocation-footer]").evaluate(el => el.scrollWidth - el.clientWidth), `${width}px footer`).toBeLessThanOrEqual(1);
        }
        await expect(frame.getByRole("button", { name: "Save", exact: true })).toBeVisible();
        await frame.getByRole("button", { name: "View", exact: true }).click();
        const fold = page.getByRole("dialog");
        await expect(fold.getByRole("radio", { name: "Table", exact: true })).toBeVisible();
        await expect(fold.getByRole("radio", { name: "Timeline", exact: true })).toBeVisible();
        await expect(fold.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
        await expect(fold.locator("[data-time-day]").first()).toBeVisible();
        await page.keyboard.press("Escape");
    });

    test(`A1, A13 — with a focus set, one toolbar row at every width: the focus chip, its icon, then at 294px inside the View with the controls, its Show all there (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        await size(page, entry, 1440);
        const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3113"]');
        await card.scrollIntoViewIfNeeded(); await card.click(); await settled(page);
        await expect(frame.locator('[data-frame-slot="toolbar"] [data-allocation-focus]')).toHaveCount(1);
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
        }
        // In the narrowest frame the chip is the View's: its Show all clears the focus.
        await expect(frame.locator('[data-frame-slot="toolbar"] [data-allocation-focus]')).toHaveCount(0);
        await frame.getByRole("button", { name: "View", exact: true }).click();
        const fold = page.getByRole("dialog");
        await expect(fold.locator("[data-allocation-focus]")).toBeVisible();
        await fold.getByRole("button", { name: "Show all", exact: true }).click(); await settled(page);
        await expect(page.locator("[data-allocation-focus]")).toHaveCount(0);
    });

    // On a touch screen a tooltip the keyboard's focus shows closes as the page reflows, before the row can be measured holding it:
    // the toolbar's own DOM tests hold it for every pointer, and this its real case where it stays.
    test(`A1 — a tooltip holds nothing in the toolbar: with Discard's tooltip showing as the frame narrows to 294px, the history still folds, nothing past the row's end (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        await size(page, entry, 1440);
        // A draft, so Discard takes the focus: bin 3113 an hour later; then no focus chip, so the history is what folds last.
        const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3113"]');
        await card.scrollIntoViewIfNeeded(); await card.click(); await settled(page);
        await frame.locator('[data-frame-slot="end"]').getByRole("button", { name: "One hour later" }).click(); await settled(page);
        await frame.locator('[data-frame-slot="toolbar"] [data-allocation-focus]').getByRole("button", { name: "Show all" }).click(); await settled(page);
        await size(page, entry, 360);
        await expect(frame.locator('[data-toolbar-item="history"]')).toHaveAttribute("data-toolbar-form", "0");
        // Discard's tooltip showing — here from the keyboard's focus, so it stays wherever the pointer is, as one shows on an item a
        // narrowing row moves under a resting pointer.
        const toolbar = frame.locator('[data-frame-slot="toolbar"]'), discard = toolbar.getByRole("button", { name: "Discard", exact: true });
        // Tabbed to from Undo: a tooltip opens for the keyboard's focus, never a programmatic one.
        await toolbar.getByRole("button", { name: "Undo", exact: true }).focus(); await page.keyboard.press("Tab");
        await expect(discard).toBeFocused();
        const tip = page.getByRole("tooltip", { name: "Discard changes" });
        await expect(tip).toBeVisible();
        await size(page, entry, 294);
        // The tooltip still shows, and the row folded all the same: the history in its buttons, nothing past the row's end.
        await expect(tip).toBeVisible();
        await expect(frame.locator('[data-toolbar-item="history"]')).toHaveAttribute("data-toolbar-form", "1");
        expect(await toolbarFaults(frame)).toEqual([]);
    });

    test(`A79 — the footer is Plan's rail with the layout's legend only, each item on its own (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1920);
        const footer = entry.locator("[data-allocation-footer]").first();
        await expect(footer.locator(":scope > [data-allocation-legend]")).toHaveCount(8);
        await expect(footer.locator(":scope > :not([data-allocation-legend])")).toHaveCount(0);
        const rail = await footer.evaluate(el => { const s = getComputedStyle(el), item = getComputedStyle(el.firstElementChild!);
            return { height: el.getBoundingClientRect().height, gap: s.columnGap, size: item.fontSize, weight: item.fontWeight, casing: item.textTransform, wrap: s.flexWrap }; });
        expect(rail).toEqual({ height: 28, gap: "14px", size: "10px", weight: "600", casing: "uppercase", wrap: "nowrap" });
        await expect(footer.locator("[data-allocation-legend=link]")).toHaveText("Link");
        // Narrower than its legend, the rail wraps and stays wrapped: each item on its own, nothing past its edge.
        const needed = await footer.evaluate(el => { const s = getComputedStyle(el), items = [...el.children];
            return items.reduce((w, i) => w + i.getBoundingClientRect().width, 0) + parseFloat(s.columnGap) * (items.length - 1)
                + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight); });
        await size(page, entry, Math.floor(needed) - 40);
        const wrapped = await footer.evaluate(el => ({ wrap: getComputedStyle(el).flexWrap, overflow: el.scrollWidth - el.clientWidth,
            items: [...el.children].every(item => item.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5) }));
        expect(wrapped).toEqual({ wrap: "wrap", overflow: 0, items: true });
        await settled(page);
        expect(await footer.evaluate(el => getComputedStyle(el).flexWrap)).toBe("wrap");
    });

    test(`A2 — the picker marks each day Published · Draft · Not started: a 6px dot under its number, out of the day's flow (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        await entry.getByRole("button", { name: "Choose plan day" }).first().click();
        const picker = page.getByRole("dialog");
        // The popover opens with a zoom: measure once its own animations have finished.
        await picker.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)));
        const day = (iso: string) => picker.locator(`[data-time-day="${Date.parse(iso)}"]`);
        const mark = (iso: string) => day(iso).locator("[data-state]").evaluate(el => {
            const s = getComputedStyle(el), b = el.getBoundingClientRect(), d = el.closest("[data-time-day]")!.getBoundingClientRect();
            return { state: el.getAttribute("data-state"), w: b.width, h: b.height, radius: s.borderTopLeftRadius, fill: s.backgroundColor, ring: s.borderTopColor,
                centred: Math.abs((b.left + b.width / 2) - (d.left + d.width / 2)) <= 0.5, bottom: Math.round(d.bottom - b.bottom) };
        });
        const published = await mark("2027-05-04T00:00:00Z"), draft = await mark("2027-05-11T00:00:00Z"), empty = await mark("2027-05-13T00:00:00Z");
        const [success, brand, subtle] = [await token(page, "fg-success"), await token(page, "brand-solid"), await token(page, "fg-subtle")];
        expect(published).toEqual({ state: "published", w: 6, h: 6, radius: "50%", fill: success, ring: success, centred: true, bottom: 4 });
        expect(draft).toEqual({ state: "draft", w: 6, h: 6, radius: "50%", fill: brand, ring: brand, centred: true, bottom: 4 });
        expect(empty).toEqual({ state: "empty", w: 6, h: 6, radius: "50%", fill: "rgba(0, 0, 0, 0)", ring: subtle, centred: true, bottom: 4 });
        // Out of the day's flow: every day's number sits where an unmarked one would, at one height across the month.
        const numbers = await picker.locator("[data-time-day]").evaluateAll(days => days.map(d => {
            const b = d.getBoundingClientRect(), text = [...d.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
            const range = document.createRange(); if (text) range.selectNodeContents(text);
            return Math.round((text ? range.getBoundingClientRect().top : b.top) - b.top);
        }));
        expect(new Set(numbers).size).toBe(1);
        await expect(picker).toContainText("Published · Draft · Not started");
        await page.keyboard.press("Escape");
    });
}
