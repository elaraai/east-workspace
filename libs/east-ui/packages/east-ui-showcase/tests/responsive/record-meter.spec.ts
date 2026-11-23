/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * A Record's meter cells (east-workspace#1730), measured in the page: the
 * machines' example (`recordMeter`) at each of its three densities, stepped
 * through its own control, and in a phone's frame at 390 and in a 294px
 * parent — in the light theme: each fill is measured against its theme token,
 * which the token guard holds in both. Each meter's fill takes the Meter
 * recipe's colour for the row's tone — danger, warning, neutral's muted ink,
 * or the brand's where the column gives no tone (M4); its bar is the value's share of
 * the row's max, held to its track (M2, M3); and the bar and its percent sit
 * inside the cell between its paddings, a whole number of pixels under the
 * row's edge, inside the row's rule — the percent beside the bar wherever the
 * cell's room is 56px or more, and under it — a phone's 62px column — the bar
 * alone, as Meter draws it in a narrow container.
 *
 * Run: `pnpm exec playwright test record-meter`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";
import { token } from "./tokens";

const ROUTE = "e3/record/record-display/recordMeter";
const ROOT = "[data-builder-frame]";

/** Each density, as its control names it, and its rows' height. */
const DENSITIES = [
    { name: "COMFORTABLE", row: 36 },
    { name: "COMPACT", row: 32 },
    { name: "CONDENSED", row: 28 },
] as const;

/** A box on the page. */
interface Box { left: number; right: number; top: number; bottom: number }

/** One meter as the page draws it, in its cell and its row. */
interface MeterBox {
    /** Its row and its column, for a failure to name: `M-02/booked`. */
    at: string;
    /** Its cell's room: the cell less its paddings. */
    room: Box;
    /** Its bar's track, its fill, and its percent beside them — `undefined` where Meter draws none. */
    track: Box;
    fill: Box;
    percent: Box | undefined;
    /** Its fill's colour, as the page computes it. */
    fillColor: string;
    /** Its row's top edge, and the top of the row's rule. */
    rowTop: number;
    rule: number;
}

/**
 * Every meter the grid draws, measured: its track, its fill, its percent, its cell's room and its row.
 *
 * @param entry - The example's entry
 * @returns The meters
 */
function measure(entry: Locator): Promise<MeterBox[]> {
    return entry.locator("[data-record]").evaluate((root) => {
        const box = (el: Element): Box => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        const out: MeterBox[] = [];
        for (const row of root.querySelectorAll<HTMLElement>('[data-slot="row"]')) {
            const r = row.getBoundingClientRect();
            const rule = r.bottom - parseFloat(getComputedStyle(row).borderBottomWidth);
            for (const display of row.querySelectorAll<HTMLElement>('[data-slot="display"][data-kind="meter"]')) {
                const cell = display.closest<HTMLElement>('[data-slot="cell"]')!;
                const c = cell.getBoundingClientRect();
                const s = getComputedStyle(cell);
                // The Meter: its root, then its track — holding its fill — and its percent, its one span.
                const meter = display.firstElementChild!;
                const track = meter.firstElementChild!;
                const fill = track.firstElementChild!;
                const percent = meter.querySelector("span")!;
                out.push({
                    at: `${row.getAttribute("data-row-id")}/${cell.getAttribute("data-key")}`,
                    room: {
                        left: c.left + parseFloat(s.paddingLeft), right: c.right - parseFloat(s.paddingRight),
                        top: c.top + parseFloat(s.paddingTop), bottom: c.bottom - parseFloat(s.paddingBottom),
                    },
                    track: box(track), fill: box(fill), percent: percent.getClientRects().length > 0 ? box(percent) : undefined,
                    fillColor: getComputedStyle(fill).backgroundColor,
                    rowTop: r.top, rule,
                });
            }
        }
        return out;
    });
}

/** A length to the 64th of a pixel the page lays out in. */
const px = (n: number) => Math.round(n * 64) / 64;

/** The least room a meter draws its percent in, beside a bar worth drawing (Meter's recipe). */
const PERCENT_ROOM = 56;

/**
 * Holds each meter to its cell: its track and its percent inside the cell's paddings and the row's rule, each a whole
 * number of pixels under the row's edge, its fill inside its track, and its percent drawn where its room is 56px or more.
 *
 * @param meters - The meters measured
 * @param where - What a failure names
 */
function sits(meters: MeterBox[], where: string): void {
    expect(meters.length, `meters drawn, ${where}`).toBeGreaterThan(0);
    for (const meter of meters) {
        const at = `${meter.at}, ${where}`;
        const room = meter.room.right - meter.room.left;
        expect(meter.percent !== undefined, `${at}: its percent drawn in ${room}px of room`).toBe(room >= PERCENT_ROOM);
        const parts: [string, Box][] = [["track", meter.track], ...(meter.percent !== undefined ? [["percent", meter.percent] as [string, Box]] : [])];
        for (const [part, b] of parts) {
            expect(b.left >= meter.room.left - 0.5 && b.right <= meter.room.right + 0.5, `${at}: its ${part} across the cell's paddings ${JSON.stringify([b, meter.room])}`).toBe(true);
            expect(b.top >= meter.room.top - 0.25 && b.bottom <= Math.min(meter.room.bottom, meter.rule) + 0.25, `${at}: its ${part} inside the cell and the row's rule ${JSON.stringify([b, meter.room, meter.rule])}`).toBe(true);
            const under = px(b.top - meter.rowTop);
            expect(Number.isInteger(under), `${at}: its ${part} ${under}px under the row's edge, a whole pixel`).toBe(true);
        }
        expect(meter.fill.left >= meter.track.left - 0.25 && meter.fill.right <= meter.track.right + 0.25, `${at}: its fill inside its track`).toBe(true);
    }
}

/** The tone each machine's meter is drawn in, where it is not neutral's: booked past capacity, and time past 90% or 100%. */
const TONED: Readonly<Record<string, string>> = {
    // Press 1 is booked 20 hours and can run none: past its capacity, its empty bar danger's.
    "M-03/booked": "status-neg", "M-05/booked": "status-neg", "M-03/used": "status-neg",
    "M-01/used": "status-warn", "M-08/used": "status-warn", "M-10/used": "status-warn",
};

/** The colour token a meter's fill takes: its tone's, neutral's muted ink, or — the yield, given no tone — the brand's. */
const colourOf = (at: string) => TONED[at] ?? (at.endsWith("/good") ? "brand-solid" : "fg-muted");

/** Each bar's share of its track, where it says something: part of the max, past it, of no max, and of one for every row. */
const SHARES: Readonly<Record<string, number>> = {
    "M-02/booked": 31.5 / 40, "M-03/booked": 1, "M-05/booked": 0, "M-01/used": 0.92, "M-10/good": 220 / 230,
};

/**
 * Holds each meter's fill to its tone's colour (M4) and its bar to its share (M2, M3).
 *
 * @param page - The page
 * @param meters - The meters measured
 * @param where - What a failure names
 */
async function draws(page: Page, meters: MeterBox[], where: string): Promise<void> {
    const colours = new Map<string, string>();
    for (const name of new Set(meters.map((meter) => colourOf(meter.at)))) colours.set(name, await token(page, name));
    for (const meter of meters) {
        expect(meter.fillColor, `${meter.at}: its fill in ${colourOf(meter.at)}, ${where}`).toBe(colours.get(colourOf(meter.at)));
        const share = SHARES[meter.at];
        if (share === undefined) continue;
        const width = meter.track.right - meter.track.left;
        expect(Math.abs((meter.fill.right - meter.fill.left) - share * width), `${meter.at}: its bar ${share} of its track, ${where}`).toBeLessThanOrEqual(1);
    }
}

for (const theme of LAYOUT_THEMES) {
    test(`each meter at each density: its fill in its tone's colour, its bar its share, and the bar and its percent inside the cell on whole pixels (${theme}) @desktop`, async ({ page }) => {
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
            const meters = await measure(entry);
            // Ten machines, three meters each — but Saw 1's yield, which is none.
            expect(meters.length, `meters drawn, ${density.name.toLowerCase()}`).toBe(29);
            sits(meters, `${density.name.toLowerCase()}, ${theme}`);
            await draws(page, meters, `${density.name.toLowerCase()}, ${theme}`);
        }
    });
}

test("each meter in a phone's frame, at 390 and in a 294px parent: the bar and its percent inside the cell on whole pixels @mobile", async ({ page }) => {
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    await expect(entry.locator('[data-record] [role="grid"]').first()).toHaveAttribute("data-phone", "");
    sits(await measure(entry), "390");
    await sizeBuilder(page, entry, ROOT, 294);
    sits(await measure(entry), "294");
});
