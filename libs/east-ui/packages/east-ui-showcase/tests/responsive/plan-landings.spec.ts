/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What a resource draws as rows of the record (#1541, U1, U2), measured in a
 * real browser on the print works (`planPrintWorks`): one record of groups,
 * each group's resources drawn by their kind (`Plan.series.kinds`), the event
 * kinds landing on them.
 *
 * - A press is three rows that stand together, in this order and touching: its
 *   landing row, where its jobs draw as bars; the row beside it, where its
 *   stops draw as marks; and its own series' row, its utilisation.
 * - The row beside a landing row and its own series both stand beneath it, a
 *   level under it, so they fold with it (#1541), and the landing row stands a
 *   level under its group's strip. Each line starts a level's indent past the
 *   line of the row it is under, and every line has its caret's cell, so each
 *   name starts that indent past the name of the row it is under (#1680's
 *   review).
 * - Every row is one band: its gutter and its plot start at its top and end
 *   together on its rule, the 1px line under it; and the rows of the canvas
 *   tile it, none over another and no gap between two.
 * - What a row draws stays in its band: no bar, mark, chip or tile reaches
 *   over the row above or below, and each is on a row of the kind that draws
 *   it. A tile its cell folds into a count draws nothing, and is not measured.
 *
 * Nothing here compares pixels: every box is the browser's own. The canvas
 * draws its rows at the desktop width alone (a phone's are cards), so every
 * test is `@desktop`.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-landings --project desktop`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { PLAN_EVENT_EXAMPLES, openExample, rowId, same } from "./plan-page";
import { printWorksPressId, type PrintWorksPress } from "./plan-builder-page";
import { PLAN_INDENT, planBandFaults, planRowsOf } from "./plan-rows";

test.describe("A resource's rows on the Plan (#1541)", () => {
    test("planPrintWorks: a press is its landing row, then the row beside it and its own series nested under it, together and in order @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        const rows = await planRowsOf(entry);
        const at = (id: string) => rows.findIndex((row) => row.id === id);
        const bad: string[] = [];
        // Hall A's first two presses: what stands in view, the canvas drawing only the rows that do.
        const presses: [PrintWorksPress, string, string][] = [["a1", "Press A1", "12,000 sheets/h"], ["a2", "Press A2", "10,000 sheets/h"]];
        for (const [press, name, speed] of presses) {
            const i = at(printWorksPressId(press));
            if (i < 0) { bad.push(`${press}: its landing row is not drawn`); continue; }
            const [landing, beside, own] = [rows[i]!, rows[i + 1], rows[i + 2]];
            // In order: the landing row, the row beside it, its own series' row.
            if (beside?.id !== printWorksPressId(press, "presses.marks") || own?.id !== printWorksPressId(press, "util")) {
                bad.push(`${press}: after its landing row come ${beside?.id} and ${own?.id}`);
                continue;
            }
            // Each by its way of drawing, and its name.
            const drawn = [landing, beside, own].map((row) => `${row.kind} ${row.label?.text}`).join(" | ");
            if (drawn !== `span ${name} | events Stop | heat Utilisation`) bad.push(`${press}: its rows read ${drawn}`);
            if (landing.sub !== speed) bad.push(`${press}: its landing row's second line reads ${landing.sub}`);
            // Under its hall's strip, a level above.
            const strip = rows[at(rowId("groups", "1-presses-a"))];
            if (strip === undefined || strip.kind !== "group" || strip.top > landing.top) {
                bad.push(`${press}: its hall's strip is ${strip === undefined ? "not drawn" : `a ${strip.kind} row at ${strip.top}px`}`);
                continue;
            }
            // The row beside it and its own series a level under it; the strip a level over it.
            const levels = [strip.level, landing.level, beside.level, own.level];
            if (levels.join() !== [strip.level, strip.level + 1, strip.level + 2, strip.level + 2].join()) {
                bad.push(`${press}: the strip, the landing row, the row beside it and its own series at levels ${levels.join(", ")}`);
            }
            const starts = [strip.start, landing.start, beside.start, own.start];
            const stepped = [strip.start, strip.start + PLAN_INDENT, strip.start + 2 * PLAN_INDENT, strip.start + 2 * PLAN_INDENT];
            if (!starts.every((start, n) => same(start, stepped[n]!))) {
                bad.push(`${press}: their lines start at ${starts.join(", ")}px — a level is ${PLAN_INDENT}px, so ${stepped.join(", ")}px`);
            }
            // Each name a level's indent past the name of the row it is under, a caret's cell or none.
            if (strip.label === null || landing.label === null || beside.label === null || own.label === null) { bad.push(`${press}: a row with no name`); continue; }
            const names = [strip.label.left, landing.label.left, beside.label.left, own.label.left];
            const indented = [strip.label.left, strip.label.left + PLAN_INDENT, strip.label.left + 2 * PLAN_INDENT, strip.label.left + 2 * PLAN_INDENT];
            if (!names.every((left, n) => same(left, indented[n]!))) {
                bad.push(`${press}: their names start at ${names.join(", ")}px — a level is ${PLAN_INDENT}px, so ${indented.join(", ")}px`);
            }
        }
        expect(bad).toEqual([]);
    });

    test("planPrintWorks: every row is one band, the rows tile the canvas, and what a row draws stays in its band, on a row of its kind @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        const rows = await planRowsOf(entry);
        const bad: string[] = [];
        // The print works draws bars, marks and chips in what stands in view: a check of none is no check.
        const drawn = new Set(rows.flatMap((row) => row.items.map((item) => item.draw)));
        expect(["data-run", "data-mark", "data-chip"].filter((draw) => !drawn.has(draw))).toEqual([]);
        bad.push(...planBandFaults(rows));
        expect(bad).toEqual([]);
    });
});
