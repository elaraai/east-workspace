/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Every builder's toolbar row holds what it shows, at every width (hand
 * retest, 27 Oct 2026): each item inside the row's content box, never past
 * its edge, and the history item — Undo, Redo, Discard and Save — in the row
 * and taking the pointer at each control's centre. At a phone's width the
 * Roster's and the Allocation's optimiser examples ran their row past its end,
 * Save beyond it, and every builder with a rail and a key search ran Save a few
 * px into the edge at 360: the ladder had no step left, and the row clipped at
 * its end. Below the ladder's last rung the row takes its floor
 * (`toolbar/fold.ts`' `FLOOR_RANK`): the rail's icon drops its caret, then the
 * eye leaves the row.
 *
 * Measured at the page's widths — 1440, 1024, 768, 390 and 360, where the
 * showcase's own chrome takes its share — and in a 294px parent, in both
 * themes, over each builder's example and each optimiser example. One test an
 * area (#1397): its examples share a workspace, which the page deploys once.
 *
 * Run: `pnpm exec playwright test toolbar-fit`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

/** An area's builder examples, by their showcase routes: the builder's own, and its optimiser's where it has one. */
const AREAS: readonly { readonly name: string; readonly routes: readonly string[] }[] = [
    { name: "Sheet", routes: ["e3/sheet/sheet-records/sheetRecordIndexes", "e3/sheet/optimise/sheetOptimise"] },
    { name: "Plan", routes: ["e3/plan/plan-records/planRecordIndexes", "e3/plan/optimise/planOptimise"] },
    { name: "Roster", routes: ["e3/roster/roster/rosterWarehouse", "e3/roster/optimise/rosterOptimise"] },
    { name: "Calendar", routes: ["e3/calendar/calendar/calendarOperations", "e3/calendar/optimise/calendarOptimise"] },
    { name: "Allocation", routes: ["e3/allocation/allocation/allocationKilnYard", "e3/allocation/optimise/allocationOptimise"] },
    { name: "Flowchart", routes: ["e3/flowchart/flowchart/flowchartFlows"] },
    { name: "Studio", routes: ["e3/studio/studio/studioBuilder"] },
    { name: "Query", routes: ["e3/query/query/queryBuilder"] },
    { name: "Schematic", routes: ["e3/schematic/schematic/schematicDataCentre"] },
];

/** The page's widths, widest first. */
const WIDTHS = [1440, 1024, 768, 390, 360] as const;

/** The parent the narrowest frame sits in: a 360px page's frame once the showcase's chrome has its share. */
const PARENT = 294;

/** Every builder renders in its frame. */
const ROOT = "[data-builder-frame]";

/**
 * What is wrong with the toolbar row of an entry's builder: an item past the row's content box, the history item gone
 * from the row where it showed, or one of its controls that does not take the pointer at its centre.
 *
 * @param entry - The example's entry
 * @param history - Whether the history item showed at the widest width: it must stay in the row at every width
 * @returns Each fault, in words; none when the row holds
 */
function rowFaults(entry: Locator, history: boolean): Promise<string[]> {
    return entry.locator(ROOT).first().evaluate((frame, wanted) => {
        const row = frame.querySelector<HTMLElement>("[data-frame-slot='toolbar'] [data-toolbar]");
        if (row === null) return ["no toolbar row"];
        row.scrollIntoView({ block: "center", inline: "nearest" });
        const r = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        const left = r.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
        const right = r.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
        const faults: string[] = [];
        for (const item of row.querySelectorAll<HTMLElement>(":scope > [data-toolbar-item]")) {
            const b = item.getBoundingClientRect();
            if (b.width === 0) continue;
            const key = item.getAttribute("data-toolbar-item");
            if (b.right > right + 0.5) faults.push(`${key} runs ${(b.right - right).toFixed(1)}px past the row's end`);
            if (b.left < left - 0.5) faults.push(`${key} starts ${(left - b.left).toFixed(1)}px before the row's start`);
        }
        const item = row.querySelector<HTMLElement>(":scope > [data-toolbar-item='history']");
        if (item === null) {
            if (wanted) faults.push("the history item left the row");
            return faults;
        }
        const names = ["Undo", "Redo", "Discard", "Save"];
        for (const name of names) {
            const button = item.querySelector<HTMLElement>(`button[aria-label='${name}']`);
            if (button === null) { faults.push(`no ${name} in the history item`); continue; }
            const b = button.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (hit === null || !button.contains(hit)) faults.push(`${name} does not take the pointer at its centre (${hit?.tagName.toLowerCase() ?? "nothing"} there)`);
        }
        return faults;
    }, history);
}

/** Whether an entry's builder shows a history item now. */
function hasHistory(entry: Locator): Promise<boolean> {
    return entry.locator(ROOT).first().evaluate((frame) => frame.querySelector("[data-frame-slot='toolbar'] [data-toolbar] > [data-toolbar-item='history']") !== null);
}

/** Lets the builder's box take the page's width again, after a spec sized it. */
async function unsizeBuilder(page: Page, entry: Locator): Promise<void> {
    await entry.locator(ROOT).first().locator("xpath=..").evaluate((box) => { (box as HTMLElement).style.width = ""; });
    await settled(page);
}

for (const theme of ["light", "dark"] as const) {
    for (const area of AREAS) {
        test(`${area.name}: the toolbar row holds what it shows, the history and Save in it and taking the pointer, at 1440 / 1024 / 768 / 390 / 360 and in a ${PARENT}px parent (${theme})`, async ({ page }) => {
            const faults: Record<string, string[]> = {};
            for (const [i, route] of area.routes.entries()) {
                await page.setViewportSize({ width: WIDTHS[0], height: 900 });
                const entry = await visitBuilder(page, route, ROOT, i === 0 ? theme : undefined);
                const history = await hasHistory(entry);
                for (const width of WIDTHS) {
                    await page.setViewportSize({ width, height: 900 });
                    await settled(page);
                    const found = await rowFaults(entry, history);
                    if (found.length > 0) faults[`${route} at ${width}px`] = found;
                }
                await page.setViewportSize({ width: WIDTHS[0], height: 900 });
                await sizeBuilder(page, entry, ROOT, PARENT);
                const found = await rowFaults(entry, history);
                if (found.length > 0) faults[`${route} in a ${PARENT}px parent`] = found;
                await unsizeBuilder(page, entry);
            }
            expect(faults).toEqual({});
        });
    }
}
