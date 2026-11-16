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
 * - The row beside a landing row sits where the landing row does: at its
 *   level, its line starting where the landing row's does. A resource's own
 *   series is nested a level under it, its line a level's indent further in,
 *   and both stand a level under their group's strip. A row with no caret
 *   starts its name exactly where the row it is under starts its own (#949).
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

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { PLAN_EVENT_EXAMPLES, openExample, rowId } from "./plan-page";
import { printWorksPressId, type PrintWorksPress } from "./plan-builder-page";

/** A box's edges, in client px. */
interface Edges { top: number; bottom: number; left: number; right: number }

/** One element a row draws: the attribute its draw carries, and its box. */
interface Item extends Edges { draw: string }

/** One row of the canvas, as the browser lays it out. */
interface Row extends Edges {
    id: string;
    kind: string;
    level: number;
    gutter: Edges;
    plot: Edges;
    /** Where its line starts: its gutter's edge, in by its level's indent. */
    start: number;
    /** The rows it is laid out among: those of one parent tile it. */
    among: number;
    /** Where its name starts, and what it reads. */
    label: { left: number; text: string } | null;
    sub: string | null;
    items: Item[];
}

/** The elements a row draws, by the attribute each way of drawing carries. */
const DRAWS = ["data-run", "data-mark", "data-chip", "data-event"] as const;

/** The kind of row each way of drawing is on. */
const KIND_OF = { "data-run": "span", "data-mark": "events", "data-chip": "cards", "data-event": "buckets" } as const;

/** A level's indent of a row's line: a caret, 14px, and its gap, 6px (`RowShell`'s `INDENT_PX`). */
const INDENT = 20;

/** The rows the canvas draws, in the order it draws them, each with what it draws. */
async function rowsOf(entry: Locator): Promise<Row[]> {
    return entry.locator("[data-plan-body]").first().evaluate((body, draws) => {
        const edges = (el: Element) => {
            const box = el.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        };
        const parents: Element[] = [];
        // A group's strip is a row as any other is, under its own attribute.
        return [...body.querySelectorAll<HTMLElement>("[data-plan-row], [data-plan-group]")].map((row) => {
            const label = row.querySelector('[data-plan-gutter="label"]');
            const sub = row.querySelector('[data-plan-gutter="sub"]');
            const gutter = row.querySelector('[role="rowheader"]')!;
            const parent = row.parentElement!;
            if (!parents.includes(parent)) parents.push(parent);
            return {
                ...edges(row),
                id: (row.getAttribute("data-plan-row") ?? row.getAttribute("data-plan-group"))!,
                kind: row.getAttribute("data-plan-kind") ?? "group",
                level: Number(row.getAttribute("aria-level")),
                gutter: edges(gutter),
                plot: edges(row.querySelector('[role="gridcell"]')!),
                start: gutter.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(gutter).paddingLeft),
                among: parents.indexOf(parent),
                label: label === null ? null : { left: label.getBoundingClientRect().left, text: label.textContent ?? "" },
                sub: sub === null ? null : sub.textContent,
                items: draws.flatMap((draw) => [...row.querySelectorAll(`[role="gridcell"] [${draw}]`)]
                    // A mark's hit target is its button, its dot inside carrying the same attribute; a tile its cell
                    // folds into a count is not drawn.
                    .filter((el) => el.parentElement?.closest(`[${draw}]`) === null && !el.hasAttribute("data-folded"))
                    .map((el) => ({ draw, ...edges(el) }))),
            };
        });
    }, DRAWS);
}

/** The rule under a row: its 1px line, inside its box. */
const RULE = 1;

/** Whether two edges are the same line, to the half pixel a browser lays out by. */
const same = (a: number, b: number) => Math.abs(a - b) <= 0.5;

test.describe("A resource's rows on the Plan (#1541)", () => {
    test("planPrintWorks: a press is its landing row, the row beside it at its level and its own series nested under it, together and in order @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        const rows = await rowsOf(entry);
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
            // The row beside it sits where it does; its own series a level under it; the strip a level over both.
            const levels = [strip.level, landing.level, beside.level, own.level];
            if (levels.join() !== [strip.level, strip.level + 1, strip.level + 1, strip.level + 2].join()) {
                bad.push(`${press}: the strip, the landing row, the row beside it and its own series at levels ${levels.join(", ")}`);
            }
            const starts = [strip.start, landing.start, beside.start, own.start];
            const stepped = [strip.start, strip.start + INDENT, strip.start + INDENT, strip.start + 2 * INDENT];
            if (!starts.every((start, n) => same(start, stepped[n]!))) {
                bad.push(`${press}: their lines start at ${starts.join(", ")}px — a level is ${INDENT}px, so ${stepped.join(", ")}px`);
            }
            // A row with no caret starts its name where the row it is under starts its own.
            if (strip.label === null || landing.label === null || beside.label === null || own.label === null) { bad.push(`${press}: a row with no name`); continue; }
            if (!same(beside.label.left, strip.label.left)) {
                bad.push(`${press}: the row beside it starts its name at ${beside.label.left}px, its hall's strip at ${strip.label.left}px`);
            }
            if (!same(own.label.left, landing.label.left)) {
                bad.push(`${press}: its own series starts its name at ${own.label.left}px, the landing row at ${landing.label.left}px`);
            }
        }
        expect(bad).toEqual([]);
    });

    test("planPrintWorks: every row is one band, the rows tile the canvas, and what a row draws stays in its band, on a row of its kind @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        const rows = await rowsOf(entry);
        const bad: string[] = [];
        // The print works draws bars, marks and chips in what stands in view: a check of none is no check.
        const drawn = new Set(rows.flatMap((row) => row.items.map((item) => item.draw)));
        expect(["data-run", "data-mark", "data-chip"].filter((draw) => !drawn.has(draw))).toEqual([]);
        rows.forEach((row, i) => {
            // One band: its gutter and its plot start at its top and end together, on the row's rule or at its bottom.
            for (const [name, part] of [["gutter", row.gutter], ["plot", row.plot]] as const) {
                if (!same(part.top, row.top) || part.bottom > row.bottom + 0.5 || part.bottom < row.bottom - RULE - 0.5) {
                    bad.push(`${row.id}: its ${name} spans ${part.top}–${part.bottom}px, the row ${row.top}–${row.bottom}px`);
                }
            }
            if (!same(row.gutter.bottom, row.plot.bottom)) bad.push(`${row.id}: its gutter ends at ${row.gutter.bottom}px, its plot at ${row.plot.bottom}px`);
            if (!same(row.gutter.right, row.plot.left)) bad.push(`${row.id}: its gutter ends at ${row.gutter.right}px, its plot starts at ${row.plot.left}px`);
            // The rows tile: each starts where the one before it, among the rows it is laid out with, ends.
            const before = rows[i - 1];
            if (before !== undefined && before.among === row.among && !same(row.top, before.bottom)) {
                bad.push(`${row.id}: starts at ${row.top}px, the row before it ends at ${before.bottom}px`);
            }
            // What it draws stays in its band, on a row of the kind that draws it.
            for (const item of row.items) {
                if (item.top < row.plot.top - 0.5 || item.bottom > row.plot.bottom + 0.5) {
                    bad.push(`${row.id}: a ${item.draw} spans ${item.top}–${item.bottom}px, out of its band ${row.plot.top}–${row.plot.bottom}px`);
                }
                if (KIND_OF[item.draw as keyof typeof KIND_OF] !== row.kind) bad.push(`${row.id}: a ${item.draw} on a ${row.kind} row`);
            }
        });
        expect(bad).toEqual([]);
    });
});
