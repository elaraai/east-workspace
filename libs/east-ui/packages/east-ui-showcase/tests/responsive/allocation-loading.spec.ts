/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Allocation's day reads on the real in-page e3 (#1398), held and failed
 * through the showcase's e3 fault hook (`e3-faults.ts`), in both themes:
 *
 * - A step to a day not read yet covers nothing (CL5). The toolbar's status,
 *   issues and Publish hold their slots (CL1): each stands where it stood
 *   while the day was read once the day lands. The Timeline draws the day's
 *   lanes, hours and resources at once (CL2): each lane-hour cell washed edge
 *   to edge between its rules, the bands' rules drawn over it, the ink at 6%;
 *   each lane head's figures an 8px bar on its line's middle; each today's load
 *   a 20px rect where the load starts, the plan day's column, 8px down its
 *   36px row; no bin. The Table: each band's count the Count's 24 × 16 rect,
 *   and one 36px placeholder row in it, its shapes on the row's middle.
 * - A day whose read failed says so once (CL11): across the lane cells of the
 *   first row in view — from the hour column's rule to the lanes' end, the
 *   row's height but its rule — one line, its Retry whole inside it; in the
 *   Table across its first placeholder row; and on a phone inside the first
 *   card.
 * - A started day with no bins — every bin of the day taken off — says so
 *   once its read has landed (CL13), in the failed line's slot: one line, its
 *   words whole, its hint after them whole or dropped whole, never cut.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { open, size, token } from "./allocation-page";
import { RECORD_READS, failE3, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";

/** A read the fault hook fails: as e3 answers one it cannot serve. */
const FAILURE = { status: 500, type: "internal", message: "the store is down" } as const;

/** Where the toolbar's held slots stand: the status's start, the issues' and Publish's ends, and the history's start. */
function slotsOf(frame: Locator) {
    return frame.locator('[data-frame-slot="toolbar"]').evaluate((bar) => {
        const box = (selector: string) => bar.querySelector(selector)?.getBoundingClientRect();
        const round = (n: number | undefined) => n === undefined ? null : Math.round(n);
        return {
            status: round(box("[data-allocation-status]")?.left), issues: round(box("[data-allocation-issues]")?.right),
            history: round(box('[data-toolbar-item="history"]')?.left), publish: round(box('[data-toolbar-item="allocation.publish"]')?.left),
        };
    });
}

/** The colour the shared wash resolves to: the ink at 6% over nothing. */
function washInk(page: Page): Promise<string> {
    return page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.background = "color-mix(in oklch, var(--chakra-colors-fg) 6%, transparent)";
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
    });
}

/** The Timeline of a day not read yet, as the page lays it out. */
function unreadTimeline(frame: Locator) {
    return frame.evaluate((el) => {
        const grid = el.querySelector("[data-allocation-grid]")!;
        const kids = [...grid.children];
        const cells = kids.filter((kid) => kid.hasAttribute("data-allocation-cell"));
        const bands = kids.filter((kid) => kid.hasAttribute("data-allocation-band"));
        // Each lane hour's wash, between its rules: its own left rule kept, the band's rule drawn after it, over it.
        const washes = cells.slice(0, 9).map((cell) => {
            const c = cell.getBoundingClientRect(), wash = cell.querySelector("[data-loading-wash]")?.getBoundingClientRect();
            if (wash === undefined) return null;
            const rule = Number.parseFloat(getComputedStyle(cell).borderLeftWidth);
            return [wash.left - c.left - rule, c.right - wash.right, wash.top - c.top, c.bottom - wash.bottom].map(Math.round);
        });
        const meta = [...el.querySelectorAll<HTMLElement>("[data-allocation-lane] [data-pending]")].map((line) => {
            const shape = line.querySelector("[data-shape]")?.getBoundingClientRect(), l = line.getBoundingClientRect();
            return shape === undefined ? null : { height: Math.round(shape.height), offset: Math.round((shape.top + shape.height / 2) - (l.top + l.height / 2)) };
        });
        const tick = el.querySelector('[data-time-ruler="ticks"] [data-now]')!.getBoundingClientRect();
        const loads = [...el.querySelectorAll("[data-allocation-resource]")].slice(0, 6).map((row) => {
            const r = row.getBoundingClientRect(), rect = row.querySelector("[data-allocation-load-pending]")?.getBoundingClientRect();
            return rect === undefined ? null : { height: Math.round(rect.height), top: Math.round(rect.top - r.top), left: Math.round(rect.left - tick.left), width: Math.round(rect.width - tick.width) };
        });
        return {
            under: cells.length > 0 && bands.length > 0 && kids.indexOf(cells[cells.length - 1]!) < kids.indexOf(bands[0]!)
                && [...cells, ...bands].every((node) => getComputedStyle(node).zIndex === "auto"),
            washes, meta, loads, rows: Math.round(el.querySelector("[data-allocation-resource]")!.getBoundingClientRect().height),
            cards: el.querySelectorAll("[data-allocation-card]").length,
            ink: getComputedStyle(cells[0]!.querySelector("[data-loading-wash]")!).backgroundColor,
        };
    });
}

/** The Table of a day not read yet: each band's count, and its placeholder row's height and shapes. */
function unreadTable(frame: Locator) {
    return frame.evaluate((el) => {
        const counts = [...el.querySelectorAll("[data-allocation-table] [data-shape=count]")].map((shape) => {
            const r = shape.getBoundingClientRect();
            return [Math.round(r.width), Math.round(r.height)];
        });
        const rows = [...el.querySelectorAll<HTMLElement>("[data-allocation-unread-row]")].map((row) => {
            const r = row.getBoundingClientRect();
            const shapes = [...row.querySelectorAll("[data-shape]")].map((shape) => {
                const s = shape.getBoundingClientRect();
                return Math.round((s.top + s.height / 2) - (r.top + r.height / 2));
            });
            return { height: Math.round(r.height), shapes: shapes.length, offsets: Math.max(0, ...shapes.map(Math.abs)) };
        });
        return { counts, rows, real: el.querySelectorAll("[data-allocation-row]").length };
    });
}

/** A line said once in place, as the page lays it out: where it sits against its slot, whether it is one line, and whether its words and Retry are whole. */
function lineIn(line: Locator, slot: string) {
    return line.evaluate((el, slotSelector) => {
        const box = el.getBoundingClientRect();
        const lines = [...el.querySelectorAll<HTMLElement>("[data-loading-failed], [data-loading-empty]")];
        const inner = lines[0]!;
        const message = inner.querySelector<HTMLElement>("[data-loading-failed-message], [data-loading-empty-message]")!;
        const retry = inner.querySelector<HTMLElement>("[data-loading-retry]");
        const hint = inner.querySelector<HTMLElement>("[data-loading-empty-hint]");
        const lead = (message.parentElement ?? message).getBoundingClientRect(), innerBox = inner.getBoundingClientRect();
        const r = retry?.getBoundingClientRect(), h = hint?.getBoundingClientRect();
        const around = el.closest(slotSelector)?.getBoundingClientRect();
        return {
            lines: lines.length, height: Math.round(box.height), inner: Math.round(innerBox.height),
            // From its slot's start, within its rows: a line never across a row's rule.
            inside: around === undefined ? null : box.left >= around.left - 0.5 && box.top >= around.top - 0.5 && box.bottom <= around.bottom + 0.5,
            whole: message.scrollWidth <= message.clientWidth + 1,
            retry: r === undefined ? null : r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.height >= 20 && r.width > 0,
            // Its hint after its words on their one line, whole — or dropped whole, below the line's one line.
            hint: h === undefined ? null : Math.abs(h.top - lead.top) <= 1 && h.right <= innerBox.right + 0.5 ? "whole" : h.top >= innerBox.bottom - 0.5 ? "dropped" : "cut",
        };
    }, slot);
}

for (const theme of ["light", "dark"] as const) {
    test(`a day not read yet draws at once with its placeholders, the toolbar's slots held; a day whose read failed says so once, in the first row in view; a started day with no bins says so once its read lands (#1398, CL1, CL2, CL5, CL11, CL13) (${theme}) @desktop`, async ({ page }) => {
        test.setTimeout(300_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const toolbar = frame.locator('[data-frame-slot="toolbar"]');
        const next = toolbar.getByRole("button", { name: "Next day", exact: true });
        const radio = (name: string) => toolbar.getByRole("radio", { name, exact: true });

        await test.step("a day not read yet", async () => {
            const held = await holdE3(page, { kinds: [...RECORD_READS] });
            // Past the day read ahead, to one not read: two days on.
            await next.click(); await next.click();
            await settled(page, { holding: true });
            await expect(frame.locator("[data-builder-loading]")).toHaveCount(0);
            const grid = frame.locator("[data-allocation-grid]");
            await expect(grid).toHaveAttribute("data-allocation-unread", "pending");
            await expect(grid.locator("[data-allocation-cell] [data-loading-wash]").first()).toBeAttached();
            const unread = await unreadTimeline(frame);
            expect(unread.under, "the bands' rules drawn over the cells' wash").toBe(true);
            expect(unread.washes.every((wash) => wash !== null && wash.every((side) => side === 0)), `each lane hour washed edge to edge: ${JSON.stringify(unread.washes)}`).toBe(true);
            expect(unread.ink).toBe(await washInk(page));
            expect(unread.meta.length).toBeGreaterThan(0);
            expect(unread.meta.every((meta) => meta !== null && meta.height === 8 && Math.abs(meta.offset) <= 1), `each lane's figures: ${JSON.stringify(unread.meta)}`).toBe(true);
            expect(unread.rows).toBe(36);
            expect(unread.loads.every((load) => load !== null && load.height === 20 && load.top === 8 && Math.abs(load.left) <= 1 && Math.abs(load.width) <= 1),
                `each today's load: ${JSON.stringify(unread.loads)}`).toBe(true);
            expect(unread.cards).toBe(0);
            const unreadSlots = await slotsOf(frame);
            // The Table: its bands at once, each count a placeholder and one placeholder row in it.
            await radio("Table").click();
            await settled(page, { holding: true });
            const table = await unreadTable(frame);
            expect(table.counts.length).toBeGreaterThan(0);
            expect(table.counts.every(([w, h]) => w === 24 && h === 16), `each band's count: ${JSON.stringify(table.counts)}`).toBe(true);
            expect(table.rows.length).toBeGreaterThan(0);
            expect(table.rows.every((row) => row.height === 36 && row.shapes > 0 && row.offsets <= 1), `each placeholder row: ${JSON.stringify(table.rows)}`).toBe(true);
            expect(table.real).toBe(0);
            await radio("Timeline").click();
            await settled(page, { holding: true });
            // Released, the day lands, and the toolbar's status, issues and Publish stand where they stood.
            await releaseE3(page, held);
            await expect(grid).not.toHaveAttribute("data-allocation-unread", /./, { timeout: 30_000 });
            await settled(page);
            expect(await slotsOf(frame)).toEqual(unreadSlots);
        });

        await test.step("a day whose read failed", async () => {
            const fault = await failE3(page, { kinds: [...RECORD_READS] }, FAILURE);
            await next.click(); await next.click();
            const line = frame.locator("[data-allocation-read-line]");
            await expect(line).toHaveCount(1, { timeout: 30_000 });
            await expect(line).toHaveAttribute("data-allocation-read-line", "failed");
            await settled(page, { holding: true });
            // Across the lane cells of the first row in view: from the hour column's rule to the lanes' end, its row's height but the rule.
            const at = await line.evaluate((el) => {
                const box = el.getBoundingClientRect(), grid = el.closest("[data-allocation-grid]")!.getBoundingClientRect();
                const pane = el.closest("[data-allocation-lanes]")!, head = pane.querySelector("[data-allocation-lane]")!.parentElement!.getBoundingClientRect();
                const lanes = [...pane.querySelectorAll("[data-allocation-lane]")].map((lane) => lane.getBoundingClientRect());
                return { left: Math.round(box.left - grid.left), right: Math.round(lanes[lanes.length - 1]!.right - box.right), top: Math.round(box.top - head.bottom), height: Math.round(box.height) };
            });
            expect(at).toEqual({ left: 48, right: 0, top: 0, height: 35 });
            expect(await lineIn(line, "[data-allocation-grid]")).toMatchObject({ lines: 1, height: 35, inside: true, retry: true });
            expect((await lineIn(line, "[data-allocation-grid]")).inner).toBeLessThanOrEqual(35);
            // The Table says it once, across its first placeholder row.
            await radio("Table").click();
            await settled(page, { holding: true });
            await expect(line).toHaveCount(1);
            expect(await lineIn(line, "[data-allocation-unread-row]")).toMatchObject({ lines: 1, inside: true, retry: true });
            // On a phone, inside its first card.
            await size(page, entry, 390);
            await settled(page, { holding: true });
            await expect(frame.locator("[data-allocation-cards] [data-loading-failed]")).toHaveCount(1);
            const card = await frame.locator("[data-allocation-cards] [data-loading-failed]").evaluate((el) => {
                const box = el.getBoundingClientRect(), card = el.closest("[data-allocation-row-card]")!.getBoundingClientRect();
                const retry = el.querySelector("[data-loading-retry]")!.getBoundingClientRect();
                return { inside: box.left >= card.left && box.right <= card.right + 0.5, retry: retry.right <= box.right + 0.5, oneLine: box.height <= retry.height + 1 };
            });
            expect(card).toEqual({ inside: true, retry: true, oneLine: true });
            await size(page, entry, 1440);
            await radio("Timeline").click();
            // The fault gone, Retry lands the day.
            await releaseE3(page, fault);
            await line.locator("[data-loading-retry]").click();
            await expect(line).toHaveCount(0, { timeout: 30_000 });
            await settled(page);
        });

        await test.step("a started day with no bins", async () => {
            // Back to Tue 11, its row a draft, and every bin of it taken off.
            const previous = toolbar.getByRole("button", { name: "Previous day", exact: true });
            for (let i = 0; i < 4; i++) await previous.click();
            await settled(page);
            const cards = frame.locator("[data-allocation-timeline] [data-allocation-card]");
            await expect(cards.first()).toBeVisible();
            while (await cards.count() > 0) {
                await cards.first().click();
                await page.keyboard.press("Delete");
            }
            await settled(page);
            const line = frame.locator("[data-allocation-read-line]");
            await expect(line).toHaveAttribute("data-allocation-read-line", "empty");
            const said = await lineIn(line, "[data-allocation-grid]");
            expect(said).toMatchObject({ lines: 1, height: 35, inside: true, whole: true, inner: 20 });
            expect(["whole", "dropped"], `its hint ${said.hint}`).toContain(said.hint);
            await expect(line.locator("[data-loading-empty-message]")).toHaveText(/^No bins on \S/);
            // Its glyph the rule's strong ink, its words the ink.
            const inks = await line.locator("[data-loading-empty]").evaluate((el) => ({
                glyph: getComputedStyle(el.querySelector("svg")!).color, words: getComputedStyle(el.querySelector("[data-loading-empty-message]")!).color }));
            expect(inks).toEqual({ glyph: await token(page, "border-strong"), words: await token(page, "fg") });
        });
    });
}
