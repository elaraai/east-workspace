/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Every control in a builder's toolbar row is 28px tall, measured in a real
 * browser (ruled 23 Oct 2026, the Schematic's Find standing taller than the
 * strips beside it, and every builder held to it): the rail's chip, a segment
 * strip, a View chip, the date navigator, a count, the key search's box, a
 * tab strip and every button — Find's and the history's height, the design system's toolbar
 * search pill's — and centred on the row. In every builder laid out in a
 * `BuilderFrame`: the Sheet, the Plan, the Roster, the Calendar, the
 * Allocation, the Flowchart, Studio's builder, the query builder and the
 * Schematic; with room for every item at its widest, and in a box narrow
 * enough to fold some into their chips; both themes. On a touch screen a
 * control keeps its size and takes its 44px target from its halo
 * (`toolbar-touch.spec.ts`).
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test toolbar-row-heights`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** One example of each builder laid out in a `BuilderFrame`, by its showcase entry. */
const BUILDERS: readonly (readonly [name: string, hash: string])[] = [
    ["Sheet", "e3/sheet/sheet-records/sheetRecordIndexes"],
    ["Plan", "e3/plan/plan-records/planRecordIndexes"],
    ["Roster", "e3/roster/roster/rosterWarehouse"],
    ["Calendar", "e3/calendar/calendar/calendarOperations"],
    ["Allocation", "e3/allocation/allocation/allocationKilnYard"],
    ["Flowchart", "e3/flowchart/flowchart/flowchartFlows"],
    ["Studio", "e3/studio/studio/studioBuilder"],
    ["Query", "e3/query/query/queryBuilder"],
    ["Schematic", "e3/schematic/schematic/schematicDataCentre"],
];

/**
 * Each control in a frame's toolbar row that is not 28px tall and centred on the row: its item, its name and its
 * height and offset. A control is the outermost one of its kind in its item — a segment strip's buttons are its parts,
 * as a key search's input is its box's.
 */
function offControls(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => {
        const round = (n: number) => Math.round(n * 10) / 10;
        const row = root.querySelector("[data-frame-slot='toolbar'] [data-toolbar]");
        if (row === null) return ["no toolbar row"];
        const r = row.getBoundingClientRect();
        const off: string[] = [];
        const outer = (el: Element) => el.getAttribute("role") === "radiogroup" || el.getAttribute("role") === "group" || el.getAttribute("role") === "tablist"
            || (el.getAttribute("data-scope") === "combobox" && el.getAttribute("data-part") === "control");
        for (const item of row.querySelectorAll("[data-toolbar-item]")) {
            const controls = [...item.querySelectorAll("button, [role='radiogroup'], [role='group'], [role='tablist'], [data-scope='combobox'][data-part='control'], input:not([type='hidden'])")]
                .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
            for (const el of controls) {
                if (controls.some((other) => other !== el && outer(other) && other.contains(el))) continue;
                const b = el.getBoundingClientRect();
                const height = round(b.height), offCentre = round((b.top + b.height / 2) - (r.top + r.height / 2));
                if (height === 28 && Math.abs(offCentre) <= 0.5) continue;
                const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24);
                off.push(`${item.getAttribute("data-toolbar-item")}: ${name} ${height}px, ${offCentre} off the row's centre`);
            }
        }
        return off;
    });
}

/** Opens a builder's entry by its hash, as a link does — the page's e3 already started — and waits for it at rest. */
async function openEntry(page: Page, hash: string): Promise<Locator> {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded({ timeout: 30_000 });
    await expect(entry.locator("[data-frame-slot='toolbar'] [data-toolbar]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** Sizes a builder's box, the element its frame fills: the box an example gives it, set to a width. */
async function sizeFrame(page: Page, entry: Locator, width: number): Promise<void> {
    await entry.locator("[data-builder-frame]").first().evaluate((frame, w) => {
        const box = (frame.parentElement ?? frame) as HTMLElement;
        box.style.width = `${w}px`;
        box.style.maxWidth = "none";
    }, width);
    await settled(page);
}

test.describe("Every control in a builder's toolbar row", () => {
    test.skip(({ isMobile }) => isMobile, "a fine pointer's row: on a touch screen a control keeps its size and its halo (toolbar-touch.spec.ts)");

    for (const theme of ["light", "dark"] as const) {
        test(`is 28px tall and centred on the row, in every builder, unfolded and folded (${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 1700, height: 1000 });
            await page.goto(`/?theme=${theme}#${BUILDERS[0]![1]}`);
            await page.waitForSelector("header", { timeout: 20_000 });
            const faults: Record<string, string[]> = {};
            for (const [name, hash] of BUILDERS) {
                await test.step(name, async () => {
                    const entry = await openEntry(page, hash);
                    for (const width of [1600, 768]) {
                        await sizeFrame(page, entry, width);
                        const off = await offControls(entry);
                        if (off.length > 0) faults[`${name} at ${width}px`] = off;
                    }
                });
            }
            expect(faults).toEqual({});
        });
    }
});
