/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet's ring stays on screen as the keyboard moves it (#860), in a real
 * layout. End on a sheet wider than its frame — the workshop's, in its
 * frame's main, at both viewports (on a phone, beside its folded gutter,
 * #1215); on a phone the stress sheet's too, wider than the window — scrolls
 * the columns sideways until the ring's cell shows right of the sticky
 * gutter, and Home brings the first column back. On a sheet whose rows and
 * blank tail run past the bottom of its frame — the smallest sheet, in its
 * 560px box — ↓ walked past the frame's bottom scrolls the frame to the
 * ring's row, at both viewports. Every sheet scrolls its own rows in its
 * frame (#1216): there is no sheet whose rows render in flow.
 *
 * Every read is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-keys --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open one Sheet example's page — a route under `e3/sheet/` — and return its
 *  entry (the virtualized doc row holding its anchor and its live sheet). */
async function openExample(page: Page, route: string, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#e3/sheet/${route}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#e3/sheet/${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-sheet-card]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/**
 * The ring's cell — the grid's active cell — and whether it shows: sideways,
 * right of its row's gutter inside the frame the columns scroll in; down,
 * inside the nearest element that scrolls it, or the page. Sideways, a column
 * wider than what shows right of the gutter — on a phone, most: a builder's
 * main shows 128px beside its folded gutter — shows from its start; and the frame's right
 * edge is its box's: at a bounded frame's far end Chrome stops the scroll with
 * the grid's last 12 px under the reserved scrollbar gutter
 * (`virtualScrollbarCss`) — a frame's, whatever it holds.
 */
/**
 * Press a cell where it shows: the first point along its middle, from its
 * start, where the page hits the cell itself — on a phone a sheet's frame
 * shows little of a cell right of its gutter, and an unfolded gutter's seam
 * reaches over its edge.
 */
async function pressCell(page: Page, cell: Locator): Promise<void> {
    // Its row in the window's middle, the columns left where they are.
    await cell.evaluate((el) => el.closest("[role='row']")!.scrollIntoView({ block: "center", inline: "nearest" }));
    await settled(page);
    const at = await cell.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        for (let x = Math.ceil(r.left) + 1; x < r.right; x++) {
            const hit = document.elementFromPoint(x, y);
            if (hit !== null && el.contains(hit)) return { x, y };
        }
        return null;
    });
    if (at === null) throw new Error("the cell shows nowhere");
    await page.mouse.click(at.x, at.y);
}

function ring(entry: Locator): Promise<{ key: string | null; sideways: boolean; down: boolean }> {
    return entry.evaluate((root) => {
        const card = root.querySelector("[data-sheet-card]")!;
        const cell = document.getElementById(card.getAttribute("aria-activedescendant") ?? "");
        if (cell === null) return { key: null, sideways: false, down: false };
        const box = cell.getBoundingClientRect();
        const frame = card.firstElementChild as HTMLElement;
        const frameBox = frame.getBoundingClientRect();
        const gutter = cell.closest("[role='row']")!.querySelector("[role='rowheader']")!.getBoundingClientRect().width;
        const start = frameBox.left + frame.clientLeft + gutter;
        const sideways = box.left >= start - 1 && (box.right <= frameBox.right + 1 || box.left <= start + 1);
        let top = 0;
        let bottom = window.innerHeight;
        for (let p = cell.parentElement; p !== null; p = p.parentElement) {
            const overflow = getComputedStyle(p).overflowY;
            if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) {
                const b = p.getBoundingClientRect();
                top = Math.max(top, b.top + p.clientTop);
                bottom = Math.min(bottom, b.top + p.clientTop + p.clientHeight);
                break;
            }
        }
        return { key: cell.getAttribute("data-key"), sideways, down: box.top >= top - 1 && box.bottom <= bottom + 1 };
    });
}

test.describe("the Sheet's ring stays on screen (#860)", () => {
    for (const theme of ["light", "dark"] as const) {
        test(`all four selection edges stay visible beside the gutter and beneath the header (${theme})`, async ({ page, isMobile }) => {
            const entry = await openExample(page, `sheet-records/sheetRecordIndexes${isMobile ? "Mobile" : ""}`, theme);
            for (const row of [0, 3]) {
                const cell = entry.locator("[data-slot=row]").nth(row).locator("[data-slot=cell]").first();
                await pressCell(page, cell);
                await expect(cell.locator("[data-slot=ring]")).toHaveCount(1);
                const paint = await cell.evaluate(el => {
                    const ring = el.querySelector<HTMLElement>("[data-slot=ring]")!;
                    const box = ring.getBoundingClientRect();
                    const cell = el.getBoundingClientRect();
                    const row = el.closest("[data-slot=row]")!;
                    const rows = Array.from(el.closest("[data-sheet-card]")!.querySelectorAll("[data-slot=row]"));
                    const next = rows[rows.indexOf(row) + 1]!.getBoundingClientRect();
                    const shadow = getComputedStyle(ring).boxShadow;
                    const edges = [
                        [(box.left + box.right) / 2, box.top + .5],
                        [box.right - .5, (box.top + box.bottom) / 2],
                        [(box.left + box.right) / 2, box.bottom - .5],
                        [box.left + .5, (box.top + box.bottom) / 2],
                    ];
                    // Let hit-testing expose whether another painted layer
                    // covers an edge; restore the non-interactive ring at once.
                    const pointerEvents = ring.style.pointerEvents;
                    ring.style.pointerEvents = "auto";
                    try {
                        return {
                            shadow,
                            rowGap: next.top - row.getBoundingClientRect().bottom,
                            inside: box.left >= cell.left && box.top >= cell.top && box.right <= cell.right && box.bottom <= cell.bottom,
                            uncovered: edges.map(([x, y]) => document.elementFromPoint(x, y) === ring),
                        };
                    } finally { ring.style.pointerEvents = pointerEvents; }
                });
                expect(paint.shadow).toMatch(/0px 0px 0px 2px inset$/);
                expect(paint.inside).toBe(true);
                expect(paint.rowGap).toBeGreaterThanOrEqual(0);
                expect(paint.uncovered).toEqual([true, true, true, true]);
            }
        });
    }

    test("End brings the last column into view sideways, and Home the first — in the frame's main", async ({ page }) => {
        const entry = await openExample(page, "sheet/sheetWorkshop");
        // A press puts the ring on the first order's first operation — a line, never its band; a press never scrolls (the cell is under the pointer).
        await pressCell(page, entry.locator("[data-sheet-card] [data-slot='row'][data-group-id]:not([data-blank]) [data-slot='cell']").first());
        await expect.poll(async () => (await ring(entry)).key).toBe("activity");
        await page.keyboard.press("End");
        await expect.poll(() => ring(entry)).toEqual({ key: "notes", sideways: true, down: true });
        await page.keyboard.press("Home");
        await expect.poll(() => ring(entry)).toEqual({ key: "activity", sideways: true, down: true });
    });

    test("End brings the last column into view sideways, and Home the first — on a phone, a sheet wider than the window", async ({ page, isMobile }) => {
        test.skip(!isMobile, "measured on the phone, where the stress sheet is wider than the window");
        const entry = await openExample(page, "sheet/sheetStress");
        await pressCell(page, entry.locator("[data-sheet-card] [data-slot='row'] [data-slot='cell']").first());
        await expect.poll(async () => (await ring(entry)).key).toBe("start");
        await page.keyboard.press("End");
        await expect.poll(() => ring(entry)).toEqual({ key: "qty", sideways: true, down: true });
        await page.keyboard.press("Home");
        await expect.poll(() => ring(entry)).toEqual({ key: "start", sideways: true, down: true });
    });

    test("↓ walked past the bottom of the frame brings the ring's row in, the frame scrolled to it", async ({ page }) => {
        const entry = await openExample(page, "sheet/sheetBasic");
        // The frame the rows scroll in: its rows and their blank tail run past its bottom, so the walk passes it.
        const frame = entry.locator("[data-sheet-card] [data-virtual-rows='bounded']");
        await expect(frame).toHaveCount(1);
        expect(await frame.evaluate((el) => el.scrollHeight > el.clientHeight), "the rows run past the frame's bottom").toBe(true);
        await pressCell(page, entry.locator("[data-sheet-card] [data-slot='row'] [data-slot='cell']").first());
        await expect.poll(async () => (await ring(entry)).key).toBe("task");
        // Centering the first cell can leave the frame's foot below the
        // phone's viewport. Test the sheet's own scroll with its frame in view.
        await frame.scrollIntoViewIfNeeded();
        await settled(page);
        expect((await frame.boundingBox())!.y + (await frame.boundingBox())!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
        for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowDown");
        await expect.poll(async () => (await ring(entry)).down).toBe(true);
        expect(await frame.evaluate((el) => el.scrollTop > 0), "the frame scrolled to the ring's row").toBe(true);
    });
});
