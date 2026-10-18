/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's Library (#1330) on the real in-page e3: the start pane,
 * 264px beside main, its tabs with their counts, its cards' anatomy and voices
 * in both themes (§8, A50–A53); collapsed, its rail with the count and the
 * overdue mark (A54); at every width with nothing leaving the frame, and on a
 * phone over main with a strip of it left; and a card dragged onto the board
 * (§10).
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { open, size, token } from "./allocation-page";
import { settled } from "./settle";

const pane = (frame: Locator, tab: "events" | "resources") => frame.locator(`[data-allocation-library="${tab}"]`);
const item = (frame: Locator, tab: "events" | "resources", key: string) => pane(frame, tab).locator(`[data-library-item="${key}"]`);
/** Picks a Library card up with the mouse, past the 4px a drag waits for, and waits for the board to draw the drag. */
async function pickUp(page: Page, el: Locator, timeline: Locator, kind: string) {
    // Into its list's view, the pointer on it by the locator's actionability: no foot or neighbour over it.
    await el.scrollIntoViewIfNeeded();
    await el.hover();
    const at = (await el.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(at.x + at.width / 2 + i * 3, at.y + at.height / 2 + i * 2);
    await expect(timeline).toHaveAttribute("data-allocation-drag", kind);
    await settled(page);
}

for (const theme of ["light", "dark"] as const) {
    test(`A50, A51 — the Library: 264px beside main, its tabs 44px with their counts, its cards in their groups, each card's figure on its name's line (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const start = frame.locator('[data-frame-slot="start"]');
        expect(await start.evaluate(el => [el.getAttribute("data-pane-mode"), Math.round(el.getBoundingClientRect().width)])).toEqual(["pinned", 264]);
        // The tab row: 44px, each tab with its count.
        const tabs = start.locator('[role="tab"]');
        expect(await tabs.allTextContents()).toEqual(["Events 27", "Resources 33"]);
        expect(await start.locator("[data-dock-tabs]").evaluate(el => Math.round(el.parentElement!.getBoundingClientRect().height))).toBe(44);
        const events = pane(frame, "events");
        // A card: its code and its figure on one line, its meta and its ready line under them; overdue in warn-text 600.
        const late = item(frame, "events", "event:LD-2231");
        const anatomy = await late.evaluate(el => {
            const label = el.querySelector("[data-library-figure]")!.previousElementSibling!, figure = el.querySelector("[data-library-figure]")!, note = el.querySelector("[data-library-note]")!;
            const l = label.getBoundingClientRect(), f = figure.getBoundingClientRect(), c = el.getBoundingClientRect(), n = note.getBoundingClientRect();
            const s = getComputedStyle(note), fs = getComputedStyle(figure);
            return { oneLine: Math.abs((l.top + l.height / 2) - (f.top + f.height / 2)) <= 2, figureEnd: Math.round(c.right - f.right) >= 0, noteBelow: n.top >= l.bottom,
                note: [s.color, s.fontWeight, /mono/i.test(s.fontFamily)], figure: [/mono/i.test(fs.fontFamily), fs.fontVariantNumeric], grip: el.querySelector("[data-drag-grip]") !== null };
        });
        expect(anatomy).toEqual({ oneLine: true, figureEnd: true, noteBelow: true, note: [await token(page, "fg-warning"), "600", true], figure: [true, "tabular-nums"], grip: true });
        // The Overdue group's head, in warn, its triangle in the warn mark's ink.
        const overdue = events.locator("[data-library-head][data-tone=warning]");
        expect(await overdue.evaluate(el => [getComputedStyle(el.firstElementChild!).color, getComputedStyle(el.querySelector("[data-library-group-mark]")!).color]))
            .toEqual([await token(page, "fg-warning"), await token(page, "status-warn")]);
        // An Allocated card is sunken, on the paper below, with no grip.
        const allocated = item(frame, "events", "event:LD-2201");
        expect(await allocated.evaluate(el => [getComputedStyle(el).backgroundColor, el.querySelector("[data-drag-grip]") === null])).toEqual([await token(page, "bg-canvas"), true]);
        // No card leaves the pane; nothing in it scrolls sideways; the hint sits under the cards.
        const faults = await events.evaluate(root => {
            const out: string[] = [];
            const p = root.getBoundingClientRect();
            for (const card of root.querySelectorAll("[data-library-item]")) if (card.getBoundingClientRect().right > p.right + 0.5) out.push(`${card.getAttribute("data-library-item")} leaves the pane`);
            const body = root.querySelector("[data-library] [data-scrollable]")!;
            if (body.scrollWidth - body.clientWidth > 1) out.push("the cards scroll sideways");
            const hint = root.querySelector("[data-allocation-library-hint]")!.getBoundingClientRect(), library = root.querySelector("[data-library]")!.getBoundingClientRect();
            if (hint.top < library.bottom - 0.5) out.push("the hint is not under the cards");
            return out;
        });
        expect(faults).toEqual([]);
        await expect(events.locator("[data-allocation-library-hint]")).toHaveText("Drag onto a lane hour or a resource");
    });

    test(`A51, A9, A53 — a removed bin's card dashed, a picked card the shared placed state, its action under the hint (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const timeline = frame.locator("[data-allocation-timeline]");
        const bin = timeline.locator('[data-allocation-card="3113"]');
        await bin.scrollIntoViewIfNeeded();
        await bin.click(); await settled(page);
        await page.keyboard.press("Delete"); await settled(page);
        const removed = item(frame, "events", "removed:3113");
        await expect(removed).toBeVisible();
        expect(await removed.evaluate(el => [getComputedStyle(el).borderTopStyle, getComputedStyle(el).borderTopColor])).toEqual(["dashed", await token(page, "border-strong")]);
        // A pick is the shared Library's placed state: the brand's border and tint.
        const picked = item(frame, "events", "event:LD-2235");
        await picked.click(); await settled(page);
        expect(await picked.evaluate(el => [getComputedStyle(el).borderTopColor, getComputedStyle(el).backgroundColor])).toEqual([await token(page, "brand-solid"), await token(page, "brand-tint")]);
        const action = pane(frame, "events").locator("[data-allocation-library-action]");
        await expect(action).toHaveText("Click a free lane hour or a ranked resource to book LD-2235 there, or select a free slot first.");
        expect(await pane(frame, "events").evaluate(root => {
            const hint = root.querySelector("[data-allocation-library-hint]")!.getBoundingClientRect(), box = root.querySelector("[data-allocation-library-action]")!.getBoundingClientRect(), p = root.getBoundingClientRect();
            return [box.top >= hint.bottom - 0.5, box.right <= p.right + 0.5, box.bottom <= p.bottom + 0.5];
        })).toEqual([true, true, true]);
        await page.keyboard.press("Escape"); await settled(page);
        await expect(action).toHaveCount(0);
    });

    test(`A54 — collapsed, a 44px rail: the open tab's count, the overdue mark in warn, the label (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const start = frame.locator('[data-frame-slot="start"]');
        await start.getByRole("button", { name: "Collapse Library" }).click(); await settled(page);
        const rail = await start.evaluate(el => {
            const badge = el.querySelector("[data-dock-badge]")!, mark = el.querySelector("[data-dock-mark]")!;
            return { w: Math.round(el.getBoundingClientRect().width), badge: badge.textContent, mark: [mark.getAttribute("aria-label"), getComputedStyle(mark).color],
                below: mark.getBoundingClientRect().top >= badge.getBoundingClientRect().bottom, icon: mark.querySelector("svg[data-icon='triangle-exclamation']") !== null };
        });
        expect(rail).toEqual({ w: 44, badge: "27", mark: ["Overdue event", await token(page, "status-warn")], below: true, icon: true });
        await start.getByRole("button", { name: "Expand Library" }).click(); await settled(page);
        expect(await start.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(264);
    });

    test(`the Library at 1440/1024/768/390/360 and a 294px parent: nothing leaves the frame; on a phone it opens over main, a strip of main beside it (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const start = frame.locator('[data-frame-slot="start"]');
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const fit = await frame.evaluate(root => {
                const f = root.getBoundingClientRect(), start = root.querySelector('[data-frame-slot="start"]')!;
                const out: string[] = [];
                if (root.scrollWidth - root.clientWidth > 1) out.push("the frame overflows");
                if (start.getBoundingClientRect().right > f.right + 0.5) out.push("the pane leaves the frame");
                return { mode: start.getAttribute("data-pane-mode"), faults: out };
            });
            expect(fit.faults, `${width}px`).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBeLessThanOrEqual(0);
            if (width <= 390) {
                expect(fit.mode, `${width}px`).toBe("overlay");
                // Opened, it floats over main, a 48px strip of main beside it; its cards inside it.
                await start.getByRole("button", { name: "Expand Library" }).click(); await settled(page);
                const open = await frame.evaluate(root => {
                    const f = root.getBoundingClientRect(), sheet = root.querySelector('[data-frame-slot="start"] > *')!.getBoundingClientRect();
                    const cards = [...root.querySelectorAll('[data-allocation-library="events"] [data-library-item]')].filter(c => c.getBoundingClientRect().width > 0);
                    return { strip: Math.round(f.right - sheet.right), inside: cards.every(c => c.getBoundingClientRect().right <= sheet.right + 0.5), cards: cards.length };
                });
                expect(open.strip, `${width}px strip`).toBeGreaterThanOrEqual(48);
                expect([open.inside, open.cards > 0], `${width}px cards`).toEqual([true, true]);
                await start.getByRole("button", { name: "Collapse Library" }).click(); await settled(page);
            }
        }
    });

    test(`§10 — a Library event dragged onto a free lane hour books it there, its caption the slot's (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const timeline = frame.locator("[data-allocation-timeline]");
        await timeline.evaluate(el => el.scrollIntoView({ block: "center" })); await settled(page);
        const cell = timeline.locator(`[data-allocation-cell="B-1|${Date.UTC(2027, 4, 11, 0, 15)}"]`);
        await pickUp(page, item(frame, "events", "event:LD-2236"), timeline, "event");
        const target = (await cell.boundingBox())!;
        await page.mouse.move(target.x + target.width / 2 - 4, target.y + target.height / 2, { steps: 4 });
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
        await settled(page);
        await expect(page.locator("[data-drag-caption]")).toHaveText("to B-1 00:15");
        await page.mouse.up(); await settled(page);
        const booked = timeline.locator('[data-allocation-card="N1"]');
        await expect(booked.locator("[data-allocation-code]")).toHaveText("LD-2236");
        await expect(booked.locator("[data-unlinked]")).toHaveText("not linked");
        expect(await booked.evaluate((el, c) => { const b = el.getBoundingClientRect(), x = document.querySelector(`[data-allocation-cell="${c}"]`)!.getBoundingClientRect(); return b.left >= x.left && b.right <= x.right + 0.5; },
            `B-1|${Date.UTC(2027, 4, 11, 0, 15)}`)).toBe(true);
    });
}
