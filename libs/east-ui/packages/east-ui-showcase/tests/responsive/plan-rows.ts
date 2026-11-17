/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The rows of a Plan's canvas as a real browser lays them out, for every spec
 * that measures them: each row's band — its gutter and its plot — its level
 * and where its line and its name start, and each bar, mark, chip and tile it
 * draws; and what is wrong with them as bands, which every Plan's rows hold
 * to whatever they draw.
 */

import type { Locator } from "playwright/test";
import { same, type Edges } from "./plan-page";

/** One element a row draws: the attribute its draw carries, what it holds — the element's key — and its box. */
export interface PlanRowItem extends Edges { draw: string; key: string }

/** One row of the canvas, as the browser lays it out. */
export interface PlanRowBox extends Edges {
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
    items: PlanRowItem[];
}

/** The elements a row draws, by the attribute each way of drawing carries. */
export const PLAN_DRAWS = ["data-run", "data-mark", "data-chip", "data-event"] as const;

/** The kind of row each way of drawing is on. */
export const PLAN_KIND_OF = { "data-run": "span", "data-mark": "events", "data-chip": "cards", "data-event": "buckets" } as const;

/** A level's indent of a row's line: a caret, 14px, and its gap, 6px (`RowShell`'s `INDENT_PX`). */
export const PLAN_INDENT = 20;

/**
 * The rows the canvas's body draws, in the order it draws them, each with what it draws.
 *
 * @param entry - The example's entry
 * @returns The rows, as the browser lays them out
 */
export async function planRowsOf(entry: Locator): Promise<PlanRowBox[]> {
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
                    .map((el) => ({ draw, key: el.getAttribute(draw) ?? "", ...edges(el) }))),
            };
        });
    }, PLAN_DRAWS);
}

/** The rule under a row: its 1px line, inside its box. */
const RULE = 1;

/**
 * What is wrong with some rows as bands, each a line saying what and of which row: every row is one band — its gutter
 * and its plot start at its top and end together on its rule — the rows of one parent tile it, none over another and
 * no gap between two, and what a row draws stays in its band, on a row of the kind that draws it.
 *
 * @param rows - The rows, in the order the canvas draws them
 * @returns The faults; none where the rows hold
 */
export function planBandFaults(rows: readonly PlanRowBox[]): string[] {
    const bad: string[] = [];
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
            if (PLAN_KIND_OF[item.draw as keyof typeof PLAN_KIND_OF] !== row.kind) bad.push(`${row.id}: a ${item.draw} on a ${row.kind} row`);
        }
    });
    return bad;
}
