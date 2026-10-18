/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Library tab's count while a builder's rail may narrow it (#1339, #1341):
 * `10 of 33` while it narrows, else the count alone, which the pane formats —
 * a tab over resident cards and a paged tab over a record alike.
 *
 * @packageDocumentation
 */

import type { option } from "@elaraai/east";

/** What a count is written with: the app's number formatter. */
export interface CountWords {
    number: (value: number) => string;
}

/**
 * A tab's count over resident cards.
 *
 * @param words - The app's number formatter
 * @param shown - The cards the narrowing shows
 * @param total - Every card the tab would list
 * @param narrowing - Whether a narrowing is in force
 * @returns `10 of 33` while it narrows, else the count alone
 */
export function narrowedCount(words: CountWords, shown: number, total: number, narrowing: boolean): string | number {
    return narrowing ? `${words.number(shown)} of ${words.number(total)}` : total;
}

/** What a paged tab's count reads of its record Slice: whether a choice narrows it, and its exact counts. */
export interface PagedCountSource {
    read(): { where: ReadonlyMap<string, unknown> };
    /** The narrowed count; `none` while it is read. */
    count(): option<bigint>;
    /** Every row of the record; `none` while it is read. */
    total(): option<bigint>;
}

/**
 * A paged tab's count over a record Slice: `40 of 2,048` from its exact
 * narrowed count and its record's total while a choice narrows it, else the
 * total alone; none while a count it needs is read. Its caller subscribes to
 * the slice (`useSliceReactivity`), so the count follows it.
 *
 * @param words - The app's number formatter
 * @param slice - The record Slice the tab pages
 * @returns The tab's count, or `undefined` while it is read
 */
export function pagedCount(words: CountWords, slice: PagedCountSource): string | number | undefined {
    const total = slice.total();
    if (total.type === "none") return undefined;
    if (slice.read().where.size === 0) return Number(total.value);
    const count = slice.count();
    return count.type === "none" ? undefined : narrowedCount(words, Number(count.value), Number(total.value), true);
}
