/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens (B§8, `Sheet Spec.md` §3.8 / §6.3, #1349) — the `rows` source's
 * narrowing applied to the record's rows as a filtered spreadsheet applies its
 * filter: only the rows the narrowing holds show, one after another in the
 * record's order, each keeping its row number. e3 decides which rows the
 * narrowing holds, from the source's index (`lens-layout.ts` lays them out);
 * this module holds the parts that need no record: the count line, a view's
 * name and the tab fold.
 *
 * Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

import { sheetMessages } from "./messages.js";
import type { SheetWords } from "./words.js";

/**
 * The `n matches` line, in the sheet's words — its count in the app's locale
 * (#850, #861).
 *
 * @param matches - The rows the narrowing holds
 * @param words - The sheet's words
 * @returns The line
 */
export function lensCount(matches: number, words: SheetWords): string {
    return words.m.lensCount({ n: matches, count: words.number(matches) });
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
