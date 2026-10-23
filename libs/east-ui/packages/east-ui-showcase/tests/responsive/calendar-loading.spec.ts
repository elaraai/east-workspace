/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Calendar's period reads on the real in-page e3 (#1398), held and failed
 * through the showcase's e3 fault hook (`e3-faults.ts`), in both themes:
 *
 * - A step to a period not read yet draws that period's grid at once (CL5):
 *   its own days under their own headings, never the old period's events.
 *   Each day column is washed edge to edge between its rules, the ink at 6%,
 *   its hour rules drawn over the wash; each day's count an 8px bar on its
 *   line's middle (CL2, CL13). A month's cell is washed below its date, the
 *   date line clear, and says no "+N more". The Backlog counts "…" and draws
 *   the Library's pending rows, never "No backlog events".
 * - A period whose read failed keeps its grid and says so once (CL11): in a
 *   box just inside its body's top-left in view — under the sticky head,
 *   beside the hour column — its Retry whole inside it.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { RECORD_READS, failE3, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";

const ROUTE = "e3/calendar/calendar/calendarOperations";
const ROOT = "[data-calendar-frame]";
/** A read the fault hook fails: as e3 answers one it cannot serve. */
const FAILURE = { status: 500, type: "internal", message: "the store is down" } as const;

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

/** A time grid of a period not read yet: each column's wash against its rules, its hour rules' order over it, and its count. */
function unreadGrid(frame: Locator) {
    return frame.locator("[data-calendar-time-grid]").evaluate((grid) => {
        const columns = [...grid.querySelectorAll<HTMLElement>("[data-calendar-cell]")];
        const washes = columns.map((column) => {
            const c = column.getBoundingClientRect(), wash = column.querySelector(":scope > [data-loading-wash]");
            if (wash === null) return null;
            const w = wash.getBoundingClientRect(), rule = Number.parseFloat(getComputedStyle(column).borderLeftWidth);
            // The column's first child: its hour rules, its shading and its now line come after it, so they draw over it.
            const under = column.firstElementChild === wash;
            return { sides: [w.left - c.left - rule, c.right - w.right, w.top - c.top, c.bottom - w.bottom].map(Math.round), under };
        });
        const counts = [...grid.querySelectorAll<HTMLElement>("[data-calendar-day-count]")].map((line) => {
            const shape = line.querySelector("[data-shape]")?.getBoundingClientRect(), l = line.getBoundingClientRect();
            return shape === undefined ? null : { height: Math.round(shape.height), offset: Math.round((shape.top + shape.height / 2) - (l.top + l.height / 2)) };
        });
        return { washes, counts, events: grid.querySelectorAll("[data-calendar-event]").length,
            ink: getComputedStyle(columns[0]!.querySelector("[data-loading-wash]")!).backgroundColor };
    });
}

for (const theme of ["light", "dark"] as const) {
    test(`a period not read yet draws its own grid at once, washed, its counts placeholders and its Backlog pending; a period whose read failed says so once at its grid's top-left (#1398, CL2, CL5, CL11, CL13) (${theme}) @desktop`, async ({ page }) => {
        test.setTimeout(240_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 2560, height: 1200 });
        const entry = await visitBuilder(page, ROUTE, ROOT, theme);
        await sizeBuilder(page, entry, ROOT, 1440);
        const frame = entry.locator(ROOT).first();
        const toolbar = frame.locator('[data-frame-slot="toolbar"]');
        const next = toolbar.getByRole("button", { name: /^Next (day|week|month)$/ }).first();
        await toolbar.getByRole("radio", { name: "Week", exact: true }).click();
        await settled(page);

        await test.step("a week not read yet", async () => {
            const held = await holdE3(page, { kinds: [...RECORD_READS] });
            await next.click(); await next.click();
            await settled(page, { holding: true });
            const grid = frame.locator("[data-calendar-time-grid]");
            await expect(grid).toHaveAttribute("data-calendar-unread", "pending");
            await expect(grid.locator("[data-calendar-cell] > [data-loading-wash]").first()).toBeAttached();
            const unread = await unreadGrid(frame);
            expect(unread.events).toBe(0);
            expect(unread.washes.length).toBeGreaterThan(0);
            expect(unread.washes.every((wash) => wash !== null && wash.under && wash.sides.every((side) => side === 0)), `each column washed edge to edge, under its rules: ${JSON.stringify(unread.washes)}`).toBe(true);
            expect(unread.ink).toBe(await washInk(page));
            expect(unread.counts.every((count) => count !== null && count.height === 8 && Math.abs(count.offset) <= 1), `each day's count: ${JSON.stringify(unread.counts)}`).toBe(true);
            // The Backlog: "…", and the Library's pending rows where its cards go, never empty before its read.
            await frame.locator('[data-frame-slot="start"]').getByRole("tab", { name: /Backlog/ }).click();
            const start = frame.locator('[data-frame-slot="start"]');
            await expect(start.locator("[data-library-pending]")).toBeVisible();
            await expect(start).not.toContainText("No backlog events");
            const rows = await start.locator("[data-library-pending] > *").evaluateAll((all) => all.map((row) => Math.round(row.getBoundingClientRect().height)));
            expect(new Set(rows).size, `the pending rows: ${JSON.stringify(rows)}`).toBe(1);
            // A month not read yet: each cell washed below its date, the date line clear; no "+N more".
            await toolbar.getByRole("radio", { name: "Month", exact: true }).click();
            await settled(page, { holding: true });
            const month = frame.locator("[data-calendar-month-grid]");
            await expect(month.locator("[data-calendar-cell] [data-loading-wash]").first()).toBeAttached();
            const cells = await month.evaluate((grid) => [...grid.querySelectorAll<HTMLElement>("[data-calendar-cell]")].slice(0, 8).map((cell) => {
                const c = cell.getBoundingClientRect(), date = cell.querySelector("[data-calendar-day-number]")!.getBoundingClientRect();
                const wash = cell.querySelector("[data-loading-wash]")!.getBoundingClientRect();
                return { below: wash.top >= date.bottom - 0.5, sides: [wash.left - c.left, c.right - wash.right - Number.parseFloat(getComputedStyle(cell).borderRightWidth)].map(Math.round) };
            }));
            expect(cells.every((cell) => cell.below && cell.sides.every((side) => side === 0)), `each month cell washed below its date: ${JSON.stringify(cells)}`).toBe(true);
            await expect(month).not.toContainText(/\+\d+ more/);
            await toolbar.getByRole("radio", { name: "Week", exact: true }).click();
            await releaseE3(page, held);
            await expect(grid).not.toHaveAttribute("data-calendar-unread", /./, { timeout: 30_000 });
            await settled(page);
        });

        await test.step("a week whose read failed", async () => {
            const fault = await failE3(page, { kinds: [...RECORD_READS] }, FAILURE);
            await next.click(); await next.click();
            const box = frame.locator("[data-loading-failed-box]");
            await expect(box).toHaveCount(1, { timeout: 30_000 });
            await settled(page, { holding: true });
            // Just inside the body's top-left in view: under the sticky head, beside the hour column, 8px in.
            const at = await box.evaluate((el) => {
                const b = el.getBoundingClientRect(), grid = el.parentElement!.querySelector("[data-calendar-time-grid]")!;
                const head = grid.querySelector("[data-calendar-header]")!.getBoundingClientRect();
                const gutter = grid.querySelector("[data-calendar-gutter]")!.getBoundingClientRect();
                const retry = el.querySelector("[data-loading-retry]")!.getBoundingClientRect();
                return { top: Math.round(b.top - head.bottom), left: Math.round(b.left - gutter.right), retry: retry.right <= b.right + 0.5 && retry.left >= b.left - 0.5,
                    oneLine: el.querySelector("[data-loading-failed-message]")!.getBoundingClientRect().height <= retry.height };
            });
            expect(at).toEqual({ top: 8, left: 8, retry: true, oneLine: true });
            await expect(frame.locator("[data-calendar-time-grid]")).toHaveAttribute("data-calendar-unread", "failed");
            await releaseE3(page, fault);
            await box.getByRole("button", { name: "Retry" }).click();
            await expect(box).toHaveCount(0, { timeout: 30_000 });
        });
    });
}
