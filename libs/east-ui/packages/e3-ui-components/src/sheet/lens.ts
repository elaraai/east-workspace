/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens (B§8, `Sheet Spec.md` §3.8 / §6.3, #1349) — the `rows` source's
 * narrowing DRAWN over the record's rows rather than applied to them: a row
 * the narrowing holds is a match and keeps its row number; the rows either
 * side of a match are its context; the runs the planner opened show too; and
 * everything else collapses into a band the planner can open a little at a
 * time. e3 decides which rows the narrowing holds, from the source's index
 * (`lens-layout.ts` lays it out); this module holds the parts that need no
 * record: the band controls' reach and the runs they open, the count line, a
 * view's name and the tab fold.
 *
 * Pure: no React, no DOM. A run is a stretch of the record's rows by their
 * positions, so a band control opens 1 · 3 · 10 rows or all of a run of a
 * million alike — a view keeps its runs by their rows' keys (`Sheet.Types.Reveal`).
 *
 * @packageDocumentation
 */

import { sheetMessages } from "./messages.js";
import type { SheetWords } from "./words.js";

/** The band steps — each press of a band control reaches further; past the end, all of it. */
export const LENS_STEPS: readonly number[] = [1, 3, 10];

/** A run of the record's rows, by the positions of its first and last rows (inclusive). */
export interface LensRun {
    from: number;
    to: number;
}

/** One collapsed run of hidden rows between two shown ones (or an end of the record). */
export interface LensGap {
    /** Anchored on what bounds it — a match, or a band — so a gap keeps its identity as rows open inside it. */
    key: string;
    /** The first hidden row's position. */
    from: number;
    /** The last hidden row's position. */
    to: number;
    /** `to - from + 1`. */
    hidden: number;
    /** No row shows above it (the run starts the record). */
    first: boolean;
    /** No row shows below it (the run ends the record). */
    last: boolean;
}

/**
 * Runs merged into others: sorted, disjoint, with runs that touch or overlap
 * joined.
 *
 * @param runs - Runs, sorted and disjoint
 * @param more - Runs to add, in any order
 * @returns The runs together, sorted and disjoint; `runs` itself when `more` adds nothing
 */
export function mergeRuns(runs: readonly LensRun[], more: readonly LensRun[]): readonly LensRun[] {
    if (more.length === 0) return runs;
    const all = [...runs, ...more].filter((r) => r.to >= r.from).sort((a, b) => a.from - b.from);
    const out: LensRun[] = [];
    for (const r of all) {
        const last = out[out.length - 1];
        if (last !== undefined && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
        else out.push({ from: r.from, to: r.to });
    }
    return out.length === runs.length && out.every((r, i) => r.from === runs[i]!.from && r.to === runs[i]!.to) ? runs : out;
}

/**
 * The first run that ends at or past a position.
 *
 * @param runs - Runs, sorted and disjoint
 * @param p - A position
 * @returns Its index; `runs.length` when every run ends before it
 */
export function runAtOrAfter(runs: readonly LensRun[], p: number): number {
    let lo = 0;
    let hi = runs.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (runs[mid]!.to < p) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Whether a position lies in one of the runs.
 *
 * @param runs - Runs, sorted and disjoint
 * @param p - A position
 * @returns `true` when a run holds it
 */
export function inRuns(runs: readonly LensRun[], p: number): boolean {
    const at = runs[runAtOrAfter(runs, p)];
    return at !== undefined && at.from <= p;
}

/**
 * The reach of a band control on its next press — the step at its press
 * count, capped to the run.
 *
 * @param steps - The presses so far, by `${key}:${where}`
 * @param key - The band's key
 * @param where - The control
 * @param hidden - The run's size
 * @returns How many rows the next press reveals
 */
export function nextReach(steps: ReadonlyMap<string, number>, key: string, where: "top" | "bottom" | "both", hidden: number): number {
    const step = LENS_STEPS[steps.get(`${key}:${where}`) ?? 0];
    return step === undefined ? hidden : Math.min(step, hidden);
}

/**
 * The runs a band control opens, and the steps after the press — the
 * prototype's `expandGap`: from the top, from the bottom, both ends (half
 * each), or all of it; a press past the last step opens the run.
 *
 * @param steps - The presses so far
 * @param key - The band's key
 * @param from - The run's first position
 * @param to - The run's last position
 * @param where - The control
 * @returns The runs to open and the updated steps
 */
export function revealStep(
    steps: ReadonlyMap<string, number>,
    key: string,
    from: number,
    to: number,
    where: "top" | "bottom" | "both" | "all",
): { runs: LensRun[]; steps: Map<string, number> } {
    const hidden = to - from + 1;
    const next = new Map(steps);
    if (hidden <= 0) return { runs: [], steps: next };
    if (where === "all") return { runs: [{ from, to }], steps: next };
    const pressed = steps.get(`${key}:${where}`) ?? 0;
    next.set(`${key}:${where}`, pressed + 1);
    const step = LENS_STEPS[pressed];
    if (step === undefined || step >= hidden) return { runs: [{ from, to }], steps: next };
    if (where === "top") return { runs: [{ from, to: from + step - 1 }], steps: next };
    if (where === "bottom") return { runs: [{ from: to - step + 1, to }], steps: next };
    const half = Math.max(1, Math.ceil(step / 2));
    return { runs: [{ from, to: from + half - 1 }, { from: to - half + 1, to }], steps: next };
}

/**
 * The `n matches · m context` line, in the sheet's words — its counts in the
 * app's locale (#850, #861).
 *
 * @param matches - The rows the narrowing holds
 * @param context - The other rows shown: context, and the runs the planner opened
 * @param words - The sheet's words
 * @returns The line
 */
export function lensCount(matches: number, context: number, words: SheetWords): string {
    return words.m.lensCount({ n: matches, count: words.number(matches), context: context > 0 ? words.number(context) : undefined });
}

/**
 * A view's name from its query (B§8): the query to 16 characters, else the
 * sheet's words for an unnamed view — `view n` in English (#861). The name is
 * stored with the view.
 *
 * @param query - The query the view saves
 * @param seq - The view's number
 * @param unnamed - The sheet's name for a view with no query; English when omitted
 * @returns The name
 */
export function viewName(query: string, seq: number, unnamed?: ((seq: number) => string) | undefined): string {
    const q = query.trim();
    if (q === "") return unnamed !== undefined ? unnamed(seq) : sheetMessages.viewName({ seq: String(seq) });
    return q.length > 16 ? `${q.slice(0, 15)}…` : q;
}

/**
 * The tabs that stay visible when `folded` of them must hide under width
 * pressure (B§8): the first ones in order, the active tab always kept — it
 * takes the last visible slot when it would otherwise fold. The hidden tabs
 * ride the `+n` menu, in order.
 *
 * @param views - Every view, in order
 * @param active - The active view's id (`null` = the whole sheet)
 * @param folded - How many tabs must hide
 * @returns The visible and the hidden views
 */
export function foldTabs<T extends { id: string }>(views: readonly T[], active: string | null, folded: number): { visible: T[]; hidden: T[] } {
    const keep = Math.max(0, views.length - Math.max(0, folded));
    const activeIdx = active === null ? -1 : views.findIndex((v) => v.id === active);
    if (activeIdx < 0 || activeIdx < keep) return { visible: views.slice(0, keep), hidden: views.slice(keep) };
    const head = views.slice(0, Math.max(0, keep - 1));
    return { visible: [...head, views[activeIdx]!], hidden: views.filter((_v, i) => i >= head.length && i !== activeIdx) };
}
