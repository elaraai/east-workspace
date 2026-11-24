/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Record's sparkline cells (east-workspace#1729), measured in the page: the
 * machines' example (`recordSparkline`) at each of its three densities,
 * stepped through its own control, in both themes, and in a phone's frame at
 * 390 and in a 294px parent. Each sparkline fills its cell (S2): its line's
 * box the cell's width between its paddings, and its room's height less 6 at
 * its top and its foot, a whole number of pixels under the row's edge and
 * inside the row's rule. Its line reads at 3:1 or more on every wash a row
 * wears (S8): a row at rest, the ring's row, and a row holding a draft.
 *
 * Run: `pnpm exec playwright test record-sparkline`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { installColourReader, type ColourReader } from "./colour";
import { settled } from "./settle";

const ROUTE = "e3/record/record-display/recordSparkline";
const ROOT = "[data-builder-frame]";

/** Each density, as its control names it: its rows' height, and a sparkline's — the room over the rule less 6 at its top and its foot. */
const DENSITIES = [
    { name: "COMFORTABLE", row: 36, line: 22 },
    { name: "COMPACT", row: 32, line: 18 },
    { name: "CONDENSED", row: 28, line: 14 },
] as const;

/** How far a sparkline's line stands in from its cell's room, at its top and its foot. */
const INSET = 6;

/** One sparkline as the page draws it, in its cell and its row. */
interface LineBox {
    /** Its row and its column, for a failure to name. */
    at: string;
    /** Its line's box. */
    box: { left: number; right: number; top: number; bottom: number };
    /** Its cell's room: the cell less its paddings. */
    room: { left: number; right: number; top: number; bottom: number };
    /** Its row's top edge, and the top of the row's rule. */
    rowTop: number;
    rule: number;
    /** Its svg's overflow: `visible`, so a line along the box's top or foot draws its whole stroke in the cell's inset. */
    overflow: string;
}

/**
 * Every sparkline the grid draws, measured: its line's box, its cell's room and its row.
 *
 * @param entry - The example's entry
 * @returns The sparklines
 */
function measure(entry: Locator): Promise<LineBox[]> {
    return entry.locator("[data-record]").evaluate((root) => {
        const out: LineBox[] = [];
        for (const row of root.querySelectorAll<HTMLElement>('[data-slot="row"]')) {
            const r = row.getBoundingClientRect();
            const rule = r.bottom - parseFloat(getComputedStyle(row).borderBottomWidth);
            for (const svg of row.querySelectorAll<SVGSVGElement>('[data-slot="display"][data-kind="sparkline"] svg')) {
                const cell = svg.closest<HTMLElement>('[data-slot="cell"]')!;
                const c = cell.getBoundingClientRect();
                const s = getComputedStyle(cell);
                const b = svg.getBoundingClientRect();
                out.push({
                    at: `${row.getAttribute("data-row-id")}/${cell.getAttribute("data-key")}`,
                    box: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
                    room: {
                        left: c.left + parseFloat(s.paddingLeft), right: c.right - parseFloat(s.paddingRight),
                        top: c.top + parseFloat(s.paddingTop), bottom: c.bottom - parseFloat(s.paddingBottom),
                    },
                    rowTop: r.top, rule,
                    overflow: getComputedStyle(svg).overflow,
                });
            }
        }
        return out;
    });
}

/** A length to the 64th of a pixel the page lays out in. */
const px = (n: number) => Math.round(n * 64) / 64;

/**
 * Holds each sparkline to its cell (S2): its cell's width between its paddings, its room's height less the inset at its
 * top and its foot — the line's height given, where it is — a whole number of pixels under the row's edge, and inside
 * the row's rule.
 *
 * @param lines - The sparklines measured
 * @param height - Their height, px; `undefined` to hold them to their room alone
 * @param where - What a failure names
 */
function fills(lines: LineBox[], height: number | undefined, where: string): void {
    expect(lines.length, `sparklines drawn, ${where}`).toBeGreaterThan(0);
    for (const l of lines) {
        const at = `${l.at}, ${where}`;
        expect(Math.abs(l.box.left - l.room.left) <= 0.5 && Math.abs(l.box.right - l.room.right) <= 0.5, `${at}: across its cell's paddings ${JSON.stringify([l.box, l.room])}`).toBe(true);
        expect([px(l.box.top - l.room.top), px(l.room.bottom - l.box.bottom)], `${at}: ${INSET}px in at its top and its foot`).toEqual([INSET, INSET]);
        if (height !== undefined) expect(px(l.box.bottom - l.box.top), `${at}: its height`).toBe(height);
        const under = px(l.box.top - l.rowTop);
        expect(Number.isInteger(under), `${at}: ${under}px under the row's edge, a whole pixel`).toBe(true);
        expect(l.box.bottom <= l.rule + 0.25, `${at}: inside the row's rule`).toBe(true);
    }
}

/** The machines' rows a wash is read on: one at rest, the ring's, and one holding a draft. */
const WASHED = { rest: "M-01", draft: "M-02", ring: "M-03" } as const;

/**
 * A row's sparkline lines against the row's own wash (S8): the least contrast of any of its lines on it.
 *
 * @param entry - The example's entry
 * @param id - The row's key
 * @returns The least contrast, and the row's state as its data attributes say it
 */
function leastContrast(entry: Locator, id: string): Promise<{ least: number; draft: boolean; selected: boolean }> {
    return entry.locator(`[data-record] [data-slot="row"][data-row-id="${id}"]`).evaluate((row) => {
        const c = (window as unknown as { __colour: ColourReader }).__colour;
        const ground = getComputedStyle(row).backgroundColor;
        const strokes = [...row.querySelectorAll<SVGPathElement>('[data-slot="display"][data-kind="sparkline"] svg path[fill="none"]')]
            .map((path) => getComputedStyle(path).stroke);
        return { least: Math.min(...strokes.map((stroke) => c.contrast(stroke, ground))), draft: row.hasAttribute("data-draft"), selected: row.hasAttribute("data-selected") };
    });
}

for (const theme of ["light", "dark"] as const) {
    test(`each sparkline at each density fills its cell on whole pixels, and its line holds 3:1 on a row at rest, the ring's row and a row holding a draft (${theme}) @desktop`, async ({ page }) => {
        // Wide enough for the example's frame to draw the grid whole, every column at its own width.
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await visitBuilder(page, ROUTE, ROOT, theme);
        await expect(entry.locator('[data-record] [role="grid"]').first()).not.toHaveAttribute("data-phone");
        for (const density of DENSITIES) {
            // The segment's own words, as a person presses it: its radio is the hidden input under them.
            await entry.getByText(density.name, { exact: true }).click();
            await expect(entry.getByRole("radio", { name: density.name, exact: true })).toBeChecked();
            await expect(entry.locator('[data-record] [data-slot="row"]').first()).toHaveCSS("height", `${density.row}px`);
            await settled(page);
            const lines = await measure(entry);
            fills(lines, density.line, `${density.name.toLowerCase()}, ${theme}`);
            // A line along its box's top or foot — a value at or past either end of its domain — draws its whole stroke.
            expect(lines.filter((line) => line.overflow !== "visible").map((line) => line.at), `${density.name.toLowerCase()}, ${theme}`).toEqual([]);
        }

        // S8: a draft on Lathe 2 — its name typed over in Details — then the ring on Mill 1, Lathe 1 at rest.
        const cellOf = (id: string, key: string) => entry.locator(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);
        await cellOf(WASHED.draft, "name").click();
        const name = entry.locator('[data-record-details="row"] [data-field="name"] input');
        await expect(name).toBeFocused();
        await name.fill("Lathe 2, rebuilt");
        await name.press("Enter");
        // Details lies over the grid at this width: its scrim closes it, as a press beside the pane does — at the scrim's
        // far corner from the pane, which lies over the scrim's middle.
        const scrim = entry.locator("[data-scrim]");
        if (await scrim.count() > 0) await scrim.click({ position: { x: 8, y: 8 } });
        await expect(scrim).toHaveCount(0);
        await cellOf(WASHED.ring, "output").click();
        await page.mouse.move(0, 0);
        await settled(page);
        await installColourReader(page);
        const read = {
            rest: await leastContrast(entry, WASHED.rest),
            draft: await leastContrast(entry, WASHED.draft),
            ring: await leastContrast(entry, WASHED.ring),
        };
        expect([read.rest.draft, read.rest.selected, read.draft.draft, read.draft.selected, read.ring.selected], `the rows' states, ${theme}`)
            .toEqual([false, false, true, false, true]);
        for (const [state, { least }] of Object.entries(read)) expect(least, `the line on the row ${state === "rest" ? "at rest" : state === "ring" ? "the ring is on" : "holding a draft"}, ${theme}`).toBeGreaterThanOrEqual(3);
    });
}

test("each sparkline in a phone's frame, at 390 and in a 294px parent, fills its cell on whole pixels @mobile", async ({ page }) => {
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    await expect(entry.locator('[data-record] [role="grid"]').first()).toHaveAttribute("data-phone", "");
    fills(await measure(entry), undefined, "390");
    await sizeBuilder(page, entry, ROOT, 294);
    fills(await measure(entry), undefined, "294");
});
