/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The rows beneath a resource, and a kind landing on them (#1541, U1, U2),
 * measured in a real browser on the press tasks' two pages:
 *
 * - the works' page (`planPressTasks`): a press is its own row, then its ink
 *   temperature and a row for each kind of task it takes, each a level under
 *   it; a task is a tile on its kind's row, in the cell of its day and of the
 *   half it is done in — the morning's lane the upper half of the row's plot,
 *   the afternoon's the lower — and the press's own row draws none;
 * - one press's own page (`planOnePress`): the press's own row is not drawn,
 *   so its kinds' rows stand at the root, its pinned ink temperature over
 *   them, its tasks on them all the same; and the page's
 *   press chosen again draws the other press's rows and tasks, never the
 *   first's.
 *
 * A task's cell is read with a day a column: the pages' four weeks open a week
 * a column at this width (#1740), so each check of a day's cell presses the
 * days first.
 *
 * On both, every row is one band and the rows tile the canvas
 * (`planBandFaults`). The machines are read a page at a time through their
 * nested series index, their kinds' rows keyed by a variant, and the tasks a
 * cell at a time by their press: what the pages draw is what e3 holds.
 *
 * Nothing here compares pixels: every box is the browser's own. The canvas
 * draws its rows at the desktop width alone (a phone's are cards), so every
 * test is `@desktop`.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-press --project desktop`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { PLAN_EVENT_EXAMPLES, openExample, pressPeriod, rowId, rowSel, same } from "./plan-page";
import { PLAN_INDENT, planBandFaults, planDrawn, planEventOn, planRowsOf } from "./plan-rows";

/** A press's own row, its ink temperature's, and its row of a kind of task: the kind's key as East prints it. */
const pressRow = (press: string) => rowId("press", press);
const temperatureRow = (press: string) => rowId("temperature", press);
const kindRow = (press: string, kind: string) => rowId("kinds", press, `.${kind}`);
const kindSel = (press: string, kind: string) => rowSel("kinds", press, `.${kind}`);

/** A task's tile on a row, folded into its cell's count or not. */
const taskOn = (entry: Locator, row: string, key: string): Locator => planEventOn(entry, row, "data-event", key);

/** Waits until a task is on a row: the tasks are read a cell at a time once the rows are. */
const drawn = (entry: Locator, row: string, key: string): Promise<void> => planDrawn(entry, row, "data-event", key);

/**
 * Where a task's tile sits: the cell holding it — its day's place among the buckets and its lane's among the row's —
 * and that cell's band within its row's plot.
 */
async function cellOf(entry: Locator, row: string, key: string): Promise<{ cell: string | null; top: number; bottom: number; plot: number }> {
    return taskOn(entry, row, key).evaluate((tile) => {
        const cell = tile.closest("[data-plan-cell]")!;
        const plot = tile.closest('[role="gridcell"]')!.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        return { cell: cell.getAttribute("data-plan-cell"), top: box.top - plot.top, bottom: box.bottom - plot.top, plot: plot.height };
    });
}

/**
 * What is wrong with where some tasks sit on a row, each a line saying what: each in the cell of its day and its half,
 * the morning's lane within the upper half of the row's plot and the afternoon's within the lower.
 */
async function laneFaults(entry: Locator, row: string, tasks: readonly (readonly [key: string, day: number, half: "am" | "pm"])[]): Promise<string[]> {
    const bad: string[] = [];
    for (const [key, day, half] of tasks) {
        const at = await cellOf(entry, row, key);
        const lane = half === "am" ? 0 : 1;
        if (at.cell !== `${day}:${lane}`) bad.push(`${key}: in cell ${at.cell}, where day ${day} and its ${half} lane is ${day}:${lane}`);
        const mid = at.plot / 2;
        // A lane is half the plot: a pixel either way for the row's rule.
        if (half === "am" ? at.bottom > mid + 1 : at.top < mid - 1) {
            bad.push(`${key}: its ${half} cell spans ${at.top}–${at.bottom}px of a ${at.plot}px plot`);
        }
    }
    return bad;
}

test.describe("Rows beneath a resource, and a kind landing on them (#1541)", () => {
    test("planPressTasks: a press is its own row, then its ink temperature and a row for each kind of task it takes, a level under it @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPressTasks", PLAN_EVENT_EXAMPLES);
        await drawn(entry, kindSel("P03", "blanket_wash"), "T-01");
        const rows = await planRowsOf(entry);
        const bad: string[] = [];
        const i = rows.findIndex((row) => row.id === pressRow("P03"));
        expect(i, "Heidelberg 3's own row is drawn").toBeGreaterThanOrEqual(0);
        const [press, temperature, ...kinds] = rows.slice(i, i + 5);
        // In order: the press, its ink temperature, then the kinds it takes.
        expect([temperature?.id, ...kinds.map((row) => row.id)]).toEqual([
            temperatureRow("P03"), kindRow("P03", "blanket_wash"), kindRow("P03", "ink_fill"), kindRow("P03", "plate_check"),
        ]);
        if (press!.label?.text !== "Heidelberg 3") bad.push(`the press's row reads ${press!.label?.text}`);
        if (press!.items.length > 0) bad.push(`the press's own row draws ${press!.items.length} of its tasks`);
        // Each kind's row is named by the kind, draws tiles, and stands a level under its press, its line an indent in.
        const names = ["Blanket wash", "Ink fill", "Plate check"];
        kinds.forEach((row, n) => {
            if (row.label?.text !== names[n]) bad.push(`${row.id}: reads ${row.label?.text}`);
            if (row.kind !== "buckets") bad.push(`${row.id}: a ${row.kind} row`);
            if (row.level !== press!.level + 1) bad.push(`${row.id}: at level ${row.level}, its press at ${press!.level}`);
            if (!same(row.start, press!.start + PLAN_INDENT)) bad.push(`${row.id}: its line starts at ${row.start}px, its press's at ${press!.start}px`);
        });
        if (temperature!.level !== press!.level + 1) bad.push(`the ink temperature at level ${temperature!.level}, its press at ${press!.level}`);
        expect(bad).toEqual([]);
    });

    test("planPressTasks: each task is on its kind's row in the cell of its day and its half, a lane half the row, and every row is one band @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPressTasks", PLAN_EVENT_EXAMPLES);
        await pressPeriod(page, entry, "DAY");
        await drawn(entry, kindSel("P03", "blanket_wash"), "T-05");
        await drawn(entry, kindSel("P03", "ink_fill"), "T-03");
        const bad = [
            // Tuesday 6 October, the morning; Friday 9 October, the afternoon.
            ...await laneFaults(entry, kindSel("P03", "blanket_wash"), [["T-01", 1, "am"], ["T-05", 4, "pm"]]),
            ...await laneFaults(entry, kindSel("P03", "ink_fill"), [["T-02", 1, "pm"], ["T-03", 2, "am"]]),
            ...await laneFaults(entry, kindSel("P03", "plate_check"), [["T-04", 3, "am"]]),
            ...planBandFaults(await planRowsOf(entry)),
        ];
        expect(bad).toEqual([]);
        // The press's own row holds none of them.
        await expect(entry.locator(`${rowSel("press", "P03")} [data-event]`)).toHaveCount(0);
    });

    test("planOnePress: the press's own row is not drawn, its kinds' rows stand at the root under its pinned ink temperature, and its tasks are on them @desktop", async ({ page }) => {
        const entry = await openExample(page, "planOnePress", PLAN_EVENT_EXAMPLES);
        await pressPeriod(page, entry, "DAY");
        await drawn(entry, kindSel("P03", "blanket_wash"), "T-01");
        const rows = await planRowsOf(entry);
        // The pinned ink temperature, then the kinds' rows alone: no row of the press's own, and none of another machine.
        expect(rows.map((row) => row.id)).toEqual([
            temperatureRow("P03"), kindRow("P03", "blanket_wash"), kindRow("P03", "ink_fill"), kindRow("P03", "plate_check"),
        ]);
        const bad: string[] = [];
        const [pinned, ...kinds] = rows;
        const [first] = kinds;
        // At the root: one level and one start, a level and an indent less than a kind's row beneath a press's own stands at.
        for (const row of kinds) {
            if (row.level !== 1 || !same(row.start, first!.start)) bad.push(`${row.id}: at level ${row.level}, its line from ${row.start}px, the first's from ${first!.start}px`);
        }
        // The ink temperature is pinned: over the rows that scroll, its chart drawn from the press's readings — 28 to 30 °C.
        if (pinned!.bottom > first!.top + 0.5) bad.push(`the pinned ink temperature ends at ${pinned!.bottom}px, the first row starts at ${first!.top}px`);
        await expect(entry.locator(rowSel("temperature", "P03")).locator("[data-plan-chart]")).toHaveAttribute("aria-label", /28.*30/, { timeout: 20_000 });
        bad.push(
            ...await laneFaults(entry, kindSel("P03", "blanket_wash"), [["T-01", 1, "am"], ["T-05", 4, "pm"]]),
            ...await laneFaults(entry, kindSel("P03", "ink_fill"), [["T-02", 1, "pm"], ["T-03", 2, "am"]]),
            ...planBandFaults(rows),
        );
        expect(bad).toEqual([]);
        await expect(entry.locator(rowSel("press", "P03"))).toHaveCount(0);
    });

    test("planOnePress: the page's press chosen again draws that press's rows and tasks, and none of the first's @desktop", async ({ page }) => {
        const entry = await openExample(page, "planOnePress", PLAN_EVENT_EXAMPLES);
        await pressPeriod(page, entry, "DAY");
        await drawn(entry, kindSel("P03", "blanket_wash"), "T-01");
        // The page's parameter, chosen here: an app's page takes it from its route.
        await entry.getByRole("combobox").first().click();
        await page.getByRole("option", { name: "Heidelberg 4" }).click();
        await drawn(entry, kindSel("P04", "roller_wash"), "T-07");
        const rows = await planRowsOf(entry);
        expect(rows.map((row) => row.id)).toEqual([temperatureRow("P04"), kindRow("P04", "blanket_wash"), kindRow("P04", "roller_wash")]);
        const bad = [
            ...await laneFaults(entry, kindSel("P04", "blanket_wash"), [["T-06", 1, "pm"]]),
            ...await laneFaults(entry, kindSel("P04", "roller_wash"), [["T-07", 2, "am"], ["T-08", 4, "am"]]),
            ...planBandFaults(rows),
        ];
        expect(bad).toEqual([]);
        // Nothing of Heidelberg 3 stands over: the scope is the page's, and every read carries it.
        await expect(entry.locator("[data-event*='T-01'], [data-event*='T-02']")).toHaveCount(0);
        await expect(entry.locator(rowSel("temperature", "P04")).locator("[data-plan-chart]")).toHaveAttribute("aria-label", /27/, { timeout: 20_000 });
    });
});
