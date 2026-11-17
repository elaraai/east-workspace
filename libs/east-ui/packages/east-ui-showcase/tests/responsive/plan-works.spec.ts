/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The print works over plain records (#1541 §3), measured in a real browser
 * (`planPrintWorksRecords`): one record of rows read a page at a time, each
 * group a strip with its resources beneath it by their kind, and five event
 * kinds on them, each read a cell at a time.
 *
 * - A group is its strip, then its resources a level under it: a press is its
 *   landing row, where its jobs draw as bars, and the row beside it at its
 *   level, where its stops draw as marks; a bindery line draws its jobs as
 *   chips, the bay its deliveries as tiles.
 * - What a kind draws is on its resource's row: the works' jobs on their
 *   presses, the handbook's two foldings on the folder, the bay's delivery on
 *   the bay.
 * - Every row is one band and the rows tile the canvas, whatever each draws
 *   (`planBandFaults`).
 *
 * Nothing here compares pixels: every box is the browser's own. The canvas
 * draws its rows at the desktop width alone (a phone's are cards), so every
 * test is `@desktop`.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-works --project desktop`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { PLAN_EVENT_EXAMPLES, openExample, rowId, rowSel, same } from "./plan-page";
import { PLAN_INDENT, planBandFaults, planDrawn, planRowsOf } from "./plan-rows";

test.describe("The print works over plain records (#1541)", () => {
    test("planPrintWorksRecords: a group is its strip, then its resources by their kind a level under it, a press's stops on the row beside its jobs' @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorksRecords", PLAN_EVENT_EXAMPLES);
        await planDrawn(entry, rowSel("press", "1-presses-a", "a1"), "data-run", "J-9001");
        const rows = await planRowsOf(entry);
        const at = (id: string) => rows.findIndex((row) => row.id === id);
        const bad: string[] = [];
        // Hall A: its strip, then Press A1's two rows.
        const strip = rows[at(rowId("groups", "1-presses-a"))];
        const i = at(rowId("press", "1-presses-a", "a1"));
        expect(strip, "Hall A's strip is drawn").toBeDefined();
        expect(i, "Press A1's row is drawn").toBeGreaterThanOrEqual(0);
        const [landing, beside] = [rows[i]!, rows[i + 1]];
        if (beside?.id !== rowId("press.marks", "1-presses-a", "a1")) bad.push(`after Press A1's row comes ${beside?.id}`);
        const reads = [strip!, landing, beside!].map((row) => `${row.kind} ${row.label?.text}`).join(" | ");
        if (reads !== "group Hall A | span Press A1 | events Stop") bad.push(`Hall A's strip and Press A1's rows read ${reads}`);
        // The press and the row beside it a level under their group's strip, each line an indent in.
        const levels = [strip!.level, landing.level, beside!.level];
        if (levels.join() !== [strip!.level, strip!.level + 1, strip!.level + 1].join()) bad.push(`the strip, the press and the row beside it at levels ${levels.join(", ")}`);
        if (!same(landing.start, strip!.start + PLAN_INDENT) || !same(beside!.start, strip!.start + PLAN_INDENT)) {
            bad.push(`their lines start at ${strip!.start}, ${landing.start} and ${beside!.start}px: a level is ${PLAN_INDENT}px`);
        }
        // The press's jobs are bars on its own row, and none is on the row beside it.
        if (!landing.items.some((item) => item.draw === "data-run" && item.key.includes("J-9001"))) bad.push("Press A1's row draws no bar of the spring catalogue");
        if (beside!.items.some((item) => item.draw === "data-run")) bad.push("the stops' row draws a bar");
        expect(bad).toEqual([]);
    });

    test("planPrintWorksRecords: each kind draws on its resource's row, read a cell at a time, and every row is one band @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorksRecords", PLAN_EVENT_EXAMPLES);
        // The handbook's two foldings on the folder, as chips; the bay's delivery on the bay, a tile.
        await planDrawn(entry, rowSel("line", "5-bindery", "fold"), "data-chip", "B-9001");
        await planDrawn(entry, rowSel("line", "5-bindery", "fold"), "data-chip", "B-9002");
        await planDrawn(entry, rowSel("bay", "6-dispatch", "bay"), "data-event", "D-9001");
        await planDrawn(entry, rowSel("press", "1-presses-a", "a1"), "data-run", "J-9002");
        // No bindery job on a press, and no job on a line.
        await expect(entry.locator(`${rowSel("press", "1-presses-a", "a1")} [data-chip]`)).toHaveCount(0);
        await expect(entry.locator(`${rowSel("line", "5-bindery", "fold")} [data-run]`)).toHaveCount(0);
        const rows = await planRowsOf(entry);
        // The rows in view draw bars, chips and tiles: a check of none is no check.
        const draws = new Set(rows.flatMap((row) => row.items.map((item) => item.draw)));
        expect(["data-run", "data-chip"].filter((draw) => !draws.has(draw))).toEqual([]);
        expect(planBandFaults(rows)).toEqual([]);
    });
});
