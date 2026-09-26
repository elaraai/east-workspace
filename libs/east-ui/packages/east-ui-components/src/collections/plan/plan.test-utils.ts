/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Row identity for the Plan renderer's hand-built test rows (#822): a test
 * names a row by a short key, and these turn it into what the canvas works in —
 * the typed id a callback receives, the key (the id's canonical text) every
 * map and DOM attribute holds, and the selector that finds the row.
 *
 * Every hand-built row is an `entry` of one series ({@link TEST_SERIES}) at
 * the path `[key]` unless a test names another series.
 */

import { equalFor, none, some, variant } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { rowIdOfKey, rowKeyOf, type PlanRowId } from "./row-key.js";
import { rowItemKey } from "./body-items.js";
import type { RowKey } from "./plan-state.js";
import type { PlanWireBlock, PlanWireRow } from "./model.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";

/** The series every hand-built test row belongs to, unless a test names one. */
export const TEST_SERIES = "t";

/** East's equality on row ids — how a test compares a payload's id. */
export const rowIdEqual: (a: PlanRowId, b: PlanRowId) => boolean = equalFor(Plan.Types.RowId);

/**
 * A test row's typed id.
 *
 * @param key - The row's key in the test
 * @param series - The series it belongs to
 * @returns `entry { series, path: [key] }`
 */
export function rowId(key: string, series: string = TEST_SERIES): PlanRowId {
    return variant("entry", { series, path: [key] }) as PlanRowId;
}

/**
 * A section header's typed id — `section { series, path }`, at its parent's
 * path: `[]` at the top of the canvas, an entry's path inside that entry.
 *
 * @param series - The section's series key
 * @param path - The path of the entry the section sits in (none at the top)
 * @returns The id
 */
export function sectionId(series: string, ...path: string[]): PlanRowId {
    return variant("section", { series, path }) as PlanRowId;
}

/**
 * A section header's canvas key — its id's canonical text.
 *
 * @param series - The section's series key
 * @param path - The path of the entry the section sits in
 * @returns The key the canvas and the DOM name the header by
 */
export function sectionKey(series: string, ...path: string[]): RowKey {
    return rowKeyOf(sectionId(series, ...path));
}

/**
 * An attribute selector matching a section header's key — its band's
 * `data-plan-group` by default.
 *
 * @param series - The section's series key
 * @param path - The path of the entry the section sits in
 * @param attr - The attribute that holds the key
 * @returns The selector
 */
export function sectionSel(series: string, path: readonly string[] = [], attr: string = "data-plan-group"): string {
    return `[${attr}=${JSON.stringify(sectionKey(series, ...path))}]`;
}

/**
 * A test row's canvas key — its id's canonical text.
 *
 * @param key - The row's key in the test
 * @param series - The series it belongs to
 * @returns The key the canvas and the DOM name the row by
 */
export function rowKey(key: string, series?: string): RowKey {
    return rowKeyOf(rowId(key, series));
}

/**
 * An attribute selector matching a test row's key, e.g. `[data-plan-row="…"]`.
 *
 * @param key - The row's key in the test
 * @param attr - The attribute that holds the key
 * @param series - The series it belongs to
 * @returns The selector (the key quoted as a CSS string)
 */
export function rowSel(key: string, attr: string = "data-plan-row", series?: string): string {
    return `[${attr}=${JSON.stringify(rowKey(key, series))}]`;
}

/**
 * An attribute selector matching a test row's body item — `data-plan-item`,
 * which holds the row's item key.
 *
 * @param key - The row's key in the test
 * @param series - The series it belongs to
 * @returns The selector
 */
export function itemSel(key: string, series?: string): string {
    return `[data-plan-item=${JSON.stringify(rowItem(key, series))}]`;
}

/**
 * A test row's body item key (`bodyItemKey` of its row item).
 *
 * @param key - The row's key in the test
 * @param series - The series it belongs to
 * @returns The item key the grid's roving tab stop names it by
 */
export function rowItem(key: string, series?: string): string {
    return rowItemKey(rowKey(key, series));
}

/** Each rows array's one-block canvas, kept — so a root rebuilt over the same
 *  rows hands the renderer the same decoded blocks (its rows keep their
 *  objects, and their memos). */
const blocksOfRows = new WeakMap<readonly unknown[], PlanWireBlock[]>();

/** The gestures a row takes when its series declares none (#880, #825) — the
 *  IR's own default (`planRow`), which a hand-built row omits. */
export const NO_EDITS = { verdict: false, drop: false, move: none } as const;

/**
 * A test's rows as the canvas the IR carries (#823) — ONE paged block of them,
 * at the top of the canvas. A row that says nothing of the gestures it takes
 * takes none, as the IR's rows do (#880).
 *
 * @param rows - The rows, in stream order
 * @returns The canvas's blocks
 */
export function oneBlock(rows: readonly unknown[]): PlanWireBlock[] {
    let blocks = blocksOfRows.get(rows);
    if (blocks === undefined) {
        const complete = rows.map((row) => ("edits" in (row as object) ? row : { ...(row as object), edits: NO_EDITS }));
        blocks = [{ fixed: false, parent: none, rows: complete as PlanWireRow[] } as unknown as PlanWireBlock];
        blocksOfRows.set(rows, blocks);
    }
    return blocks;
}

/** Each test `page`'s block-serving twin, kept per function. */
const blockPages = new WeakMap<object, (offset: bigint, limit: bigint) => unknown>();

/**
 * A test's paged source of ROWS as the paged source the IR carries (#823) —
 * each window's rows served as one paged block ({@link oneBlock}). The twin
 * `page` is kept per function, so a source rebuilt over the same functions
 * stays equivalent to the one it replaces, as it would in production.
 *
 * @param src - The test's source, its `page` answering rows
 * @returns The source, its `page` answering blocks
 */
export function blocksSource(src: unknown): PlanPagedSourceValue {
    const source = src as { page: (offset: bigint, limit: bigint) => { type: string; value?: unknown } };
    let page = blockPages.get(source.page);
    if (page === undefined) {
        const rowsPage = source.page;
        page = (offset, limit) => {
            const window = rowsPage(offset, limit);
            return window.type === "some" ? some(oneBlock(window.value as readonly unknown[])) : window;
        };
        blockPages.set(rowsPage, page);
    }
    return { ...source, page } as unknown as PlanPagedSourceValue;
}

/**
 * The test key a canvas key names — its id's path, `/`-joined — so an
 * assertion over keys reads in the test's own words.
 *
 * @param key - A canvas row key
 * @returns The path (`"m1"` for {@link rowId}`("m1")`), or the key itself when
 *   it names no id
 */
export function testKeyOf(key: RowKey): string {
    const id = rowIdOfKey(key);
    return id !== undefined ? id.value.path.join("/") : key;
}
