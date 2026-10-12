/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a docked pane's tab row fits its pane (#1210): one ladder, decided
 * from the tabs' widths as the row measured them with every tab drawn whole.
 *
 * 1. `full`: every tab, each with its count;
 * 2. `compact`: every tab, the counts out of the row;
 * 3. `folded`: compact, the trailing tabs that don't fit in a `+n` menu after
 *    the last that does. The open tab never folds.
 *
 * @packageDocumentation
 */

/** What the row measured, with every tab drawn whole, in CSS px. */
export interface TabRowMeasure {
    /** The room the tabs and the `+n` menu have. */
    readonly room: number;
    /** Each tab's width, with its count. */
    readonly tabs: readonly number[];
    /** What each tab's count takes: its width and the gap before it; 0 for a tab with none. */
    readonly counts: readonly number[];
    /** The gap between two tabs. */
    readonly gap: number;
    /** What the `+n` menu takes: its width and the gap before it. */
    readonly more: number;
}

/** The row's form, and which tabs it shows, by index in order. */
export interface TabRowFit {
    readonly form: "full" | "compact" | "folded";
    readonly shown: readonly number[];
    /** In `folded`, when even the open tab alone doesn't fit beside the menu: it shrinks, its name cut short. */
    readonly squeezed: boolean;
}

/** A width within half a pixel of the room fits it: the measures are fractional. */
const SLACK = 0.5;

/**
 * The form a tab row takes, and the tabs it shows.
 *
 * @param measure - What the row measured
 * @param open - The open tab's index; it always shows
 * @returns The form, the tabs on the row, and whether the open tab is squeezed
 */
export function fitTabs(measure: TabRowMeasure, open: number): TabRowFit {
    const count = measure.tabs.length;
    const all = Array.from({ length: count }, (_, i) => i);
    const across = (widths: readonly number[]) => widths.reduce((sum, w) => sum + w, 0) + measure.gap * Math.max(0, widths.length - 1);
    if (across(measure.tabs) <= measure.room + SLACK) return { form: "full", shown: all, squeezed: false };
    const compact = measure.tabs.map((w, i) => w - (measure.counts[i] ?? 0));
    if (across(compact) <= measure.room + SLACK) return { form: "compact", shown: all, squeezed: false };
    // Folded: the open tab first, then the leading tabs while they fit beside
    // the menu; the first that doesn't fit folds, and every tab after it.
    const kept = Math.min(Math.max(open, 0), count - 1);
    const room = measure.room - measure.more;
    let used = compact[kept]!;
    const shown = [kept];
    for (const i of all) {
        if (i === kept) continue;
        if (used + measure.gap + compact[i]! > room + SLACK) break;
        used += measure.gap + compact[i]!;
        shown.push(i);
    }
    return { form: "folded", shown: shown.sort((a, b) => a - b), squeezed: used > room + SLACK };
}
