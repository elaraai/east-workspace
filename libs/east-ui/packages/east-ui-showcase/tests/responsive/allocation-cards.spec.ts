/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's narrow layout (#1333, `Allocation Spec.md` §9.12, A78) on
 * the real in-page e3: below 480px of main the Timeline is a card per
 * resource and the Table a card per row, each card the shared agenda part's
 * (the Roster's and the Calendar's) inside main, its actions whole and their
 * popovers inside the window, nothing to drag; resizing across 480px keeps
 * the layout, the selection and the drafts — measured at 390 and 360 and in a
 * 294px parent inside a wide window, in both themes, with no page overflow.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { open, size, token } from "./allocation-page";
import { settled } from "./settle";

/** What nothing on a narrow board may carry: a drag source, a drop target, a grip or a connector. */
const DRAG = "[data-draggable], [data-drag-cell], [data-allocation-grip], [data-allocation-connector]";
/** The page scrolls sideways by this much: nothing may. */
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * What of main's cards leaves main or its card, a card's look, and each button
 * whose words are cut: every mounted card, by its key.
 */
const cardFaults = (frame: Locator, selector: string) => frame.locator("[data-allocation-main]").evaluate((main, selector) => {
    const m = main.getBoundingClientRect(), out: string[] = [];
    const inside = (b: DOMRect, p: DOMRect) => b.left >= p.left - 0.5 && b.right <= p.right + 0.5;
    const cards = [...main.querySelectorAll<HTMLElement>(selector)];
    if (cards.length === 0) out.push("no card");
    for (const card of cards) {
        const key = card.getAttribute(selector.slice(1, -1)), c = card.getBoundingClientRect();
        if (!inside(c, m)) out.push(`${key} leaves main`);
        for (const el of card.querySelectorAll("*")) {
            const b = el.getBoundingClientRect();
            if (b.width > 0 && !inside(b, c)) out.push(`${key}: a ${el.tagName.toLowerCase()} leaves its card`);
        }
        for (const b of card.querySelectorAll("button")) if (b.scrollWidth - b.clientWidth > 1) out.push(`${key}: ${b.textContent} is cut`);
    }
    return out;
}, selector);

/** A card's look, and its title's type: the shared agenda part's. */
const cardLook = (card: Locator) => card.evaluate(el => {
    const s = getComputedStyle(el), title = getComputedStyle(el.querySelector("button > :first-child")!);
    return { padding: s.paddingTop, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, radius: s.borderTopLeftRadius, background: s.backgroundColor,
        title: [title.fontSize, title.fontWeight] };
});

/** Main's width, in px. */
const mainWidth = (frame: Locator) => frame.locator("[data-allocation-main]").evaluate(el => el.getBoundingClientRect().width);

for (const theme of ["light", "dark"] as const) {
    test(`A78 — the Timeline's cards at 390/360 and in a 294px parent: each inside main and its parts inside it, the shared agenda's look, their actions whole, Book an event…'s popover inside the window, nothing to drag (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const [subtle, surface, panel] = [await token(page, "border-subtle"), await token(page, "bg-surface"), await token(page, "bg-panel")];
        for (const width of [390, 360, 294]) {
            await size(page, entry, width);
            expect(await mainWidth(frame), `${width}px main`).toBeLessThan(480);
            const cards = frame.locator('[data-allocation-cards="timeline"]');
            await expect(cards, `${width}px`).toBeVisible();
            // The list at its top: it is virtualised, and an action's click scrolls its card into view.
            await cards.locator("[data-virtual-rows]").evaluate(el => { el.scrollTop = 0; }); await settled(page);
            await expect(frame.locator("[data-allocation-timeline]")).toHaveCount(0);
            await expect(frame.locator(DRAG), `${width}px`).toHaveCount(0);
            expect(await cardFaults(frame, "[data-allocation-resource-card]"), `${width}px`).toEqual([]);
            // The shared agenda part: the list on the panel, each card 12px in, in the subtle rule, radius sm, on the surface; its title the row's.
            expect(await cards.locator("[data-virtual-rows]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(panel);
            expect(await cardLook(frame.locator('[data-allocation-resource-card="K-101"]')), `${width}px`)
                .toEqual({ padding: "12px", border: `1px solid ${subtle}`, radius: "4px", background: surface, title: ["15px", "600"] });
            // The cards 8px apart, as the shared agenda's cards in a group are.
            expect(await cards.locator("[data-allocation-resource-card]").evaluateAll(els => Math.round(els[1]!.getBoundingClientRect().top - els[0]!.getBoundingClientRect().bottom)), `${width}px gap`).toBe(8);
            // A card's actions are reachable: Book an event…'s Chooser opens inside the window, over the page.
            await frame.locator('[data-allocation-resource-card="K-101"]').getByRole("button", { name: "Book an event…" }).click(); await settled(page);
            const popover = page.locator('[data-allocation-choices="resource:K-101|book"]');
            await expect(popover.getByRole("option").first(), `${width}px`).toBeVisible();
            expect(await popover.evaluate(el => { const c = el.closest("[role=dialog]")!.getBoundingClientRect(); return c.left >= -0.5 && c.right <= window.innerWidth + 0.5; }), `${width}px popover`).toBe(true);
            await page.keyboard.press("Escape"); await settled(page);
            expect(await pageOverflow(page), `${width}px page`).toBeLessThanOrEqual(0);
        }
    });

    test(`A78 — the Table's cards at 390/360 and in a 294px parent: each inside main, its band the shared group band, its status the Status cell's word, a free row's Book… inside the window, nothing to drag (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationTable", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const muted = await token(page, "fg-muted");
        for (const width of [390, 360, 294]) {
            await size(page, entry, width);
            const cards = frame.locator('[data-allocation-cards="table"]');
            await expect(cards, `${width}px`).toBeVisible();
            await expect(frame.locator("[data-allocation-table]")).toHaveCount(0);
            await expect(frame.locator(DRAG), `${width}px`).toHaveCount(0);
            expect(await cardFaults(frame, "[data-allocation-row-card]"), `${width}px`).toEqual([]);
            // The first band heads its cards, as the Table's do; the first card is the day's first slot, free, in the Status cell's word.
            await expect(cards.locator("[data-allocation-band]").first()).toHaveAttribute("aria-expanded", "true");
            const free = cards.locator('[data-allocation-row-card][data-kind="free"]').first();
            const status = await free.locator("[data-status]").evaluate(el => { const s = getComputedStyle(el); return [el.textContent, s.fontSize, s.fontWeight, s.textTransform, s.color]; });
            expect(status, `${width}px`).toEqual(["Free", "10.5px", "600", "uppercase", muted]);
            await free.getByRole("button", { name: "Book…" }).click(); await settled(page);
            const popover = page.locator(`[data-allocation-choices="${await free.getAttribute("data-allocation-row-card")}|event"]`);
            await expect(popover.getByRole("option").first(), `${width}px`).toBeVisible();
            expect(await popover.evaluate(el => { const c = el.closest("[role=dialog]")!.getBoundingClientRect(); return c.left >= -0.5 && c.right <= window.innerWidth + 0.5; }), `${width}px popover`).toBe(true);
            await page.keyboard.press("Escape"); await settled(page);
            expect(await pageOverflow(page), `${width}px page`).toBeLessThanOrEqual(0);
        }
    });

    test(`A78 — resizing across 480px of main keeps the layout, the selection and the drafts: bin 3113 an hour later, selected, on its card and back on the Timeline (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        await size(page, entry, 1440);
        const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3113"]');
        await card.scrollIntoViewIfNeeded(); await card.click(); await settled(page);
        await frame.locator('[data-frame-slot="end"]').getByRole("button", { name: "One hour later" }).click(); await settled(page);
        await size(page, entry, 294);
        const line = frame.locator('[data-allocation-resource-card="K-108"] [data-allocation-card-bin="3113"]');
        await expect(line).toBeVisible();
        expect(await line.evaluate(el => [el.hasAttribute("data-selected"), el.hasAttribute("data-draft"), el.querySelector("button")!.textContent])).toEqual([true, true, "11:35 · B-2LD-221032 m³"]);
        await size(page, entry, 1440);
        await expect(card).toHaveAttribute("data-selected", "");
        await expect(card).toHaveAttribute("data-draft", "");
        await expect(frame.locator("[data-allocation-main]")).toHaveAttribute("data-allocation-layout", "timeline");
    });

    test(`A78 — the phone example in its 390px container: the kilns' cards, every action reachable, nothing to drag (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationMobile", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        await expect(frame.locator('[data-allocation-cards="timeline"]')).toBeVisible();
        await expect(frame.locator(DRAG)).toHaveCount(0);
        expect(await cardFaults(frame, "[data-allocation-resource-card]")).toEqual([]);
        // K-101's card: bin 3125's Unlink, Move and Back to Events, and Book an event….
        const k101 = frame.locator('[data-allocation-resource-card="K-101"]');
        await expect(k101.locator('[data-allocation-card-bin="3125"]').getByRole("button")).toHaveText(["22:35 · B-2LD-222031 m³", "Unlink", "Move", "Back to Events"]);
        await expect(k101.getByRole("button", { name: "Book an event…" })).toBeVisible();
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
}
