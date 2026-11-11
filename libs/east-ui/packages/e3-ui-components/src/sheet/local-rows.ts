/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The local layer over the decoded rows: the rows with its edits, appends, removals and placements applied, what it
 * adds to a count of them and takes off it, a row with one cell replaced, a blank row, a line's minted key, and the
 * words a row is named by.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none } from "@elaraai/east";
import { NEW_LINE_KEY, NULL_CELL, type SheetColumnIndex, type SheetColumnMeta } from "./model.js";
import { placeInOrder } from "./placement.js";
import type { LocalLayer } from "./use-editing.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";

/** A row as the sheet names it — a Record's title, else its first text column's text — where it holds one. */
export function rowNameOf(row: SheetRowValue | undefined, columns: SheetColumnIndex): string | undefined {
    if (row === undefined) return undefined;
    const named = [...columns.list.filter((column) => column.kind === "title"), ...columns.list.filter((column) => column.kind === "text")];
    for (const column of named) {
        const cell = row.cells.get(column.key);
        if (cell?.type === "String" && cell.value.trim().length > 0) return cell.value;
    }
    return undefined;
}

/** The decoded rows with the local layer applied — its placements in one linear pass (#859), and a keyed source's rows in key order (#1182). */
export function applyLayer(source: readonly SheetRowValue[], layer: LocalLayer, keyOrder?: (a: string, b: string) => number): SheetRowValue[] {
    if (layer.edits.size === 0 && layer.appended.length === 0 && layer.removed.size === 0 && layer.placements.size === 0) return source as SheetRowValue[];
    const out: SheetRowValue[] = [];
    for (const r of source) {
        if (layer.removed.has(r.id)) continue;
        out.push(layer.edits.get(r.id) ?? r);
    }
    for (const r of layer.appended) if (!layer.removed.has(r.id)) out.push(layer.edits.get(r.id) ?? r);
    const placed = placeInOrder(out, (row) => row.id, layer.placements);
    if (keyOrder !== undefined) placed.sort((a, b) => keyOrder(a.id, b.id));
    return placed;
}

const stringEqual = equalFor(StringType);

/**
 * What the local layer adds to a count of the source's rows, and takes off it (#1536): each new row, and each row a
 * draft removes — but a Save's, only over a count read at the revision it was drafted at, which holds nothing of it;
 * a count read since holds it already.
 *
 * @param layer - The local layer
 * @param savedFrom - Each entry the layer draws as a Save sent it, by the revision it was drafted at
 * @param at - The revision the count was read at; `undefined` where it is not known, which counts each
 * @param among - The rows a narrowing's count is of: only a removed one among them is taken off. None for the record's
 * @returns The rows the layer adds, and those it takes off
 */
export function layerCounts(layer: LocalLayer, savedFrom: ReadonlyMap<string, string>, at: string | undefined, among?: readonly SheetRowValue[]): { added: number; removed: number } {
    const counted = (id: string): boolean => {
        const from = savedFrom.get(id);
        return from === undefined || at === undefined || stringEqual(from, at);
    };
    let added = 0;
    for (const row of layer.appended) if (counted(row.id)) added += 1;
    let removed = 0;
    if (among === undefined) {
        for (const id of layer.removed) if (counted(id)) removed += 1;
    } else {
        for (const row of among) if (layer.removed.has(row.id) && counted(row.id)) removed += 1;
    }
    return { added, removed };
}

/** A row with one cell replaced. */
export function withCell(row: SheetRowValue, key: string, cell: SheetCellValue): SheetRowValue {
    const cells = new Map(row.cells);
    cells.set(key, cell);
    return { ...row, cells };
}

/** A fresh row — every declared cell blank; no lines and no band (a flat row, or a line as a pseudo row). */
export function blankRow(id: string, columns: readonly SheetColumnMeta[]): SheetRowValue {
    return { id, owned: false, cells: new Map(columns.map((c) => [c.key, NULL_CELL])), lines: [], band: none, subRows: [], entry: none };
}

export let mintCounter = 0;

/** A renderer-minted line key (#740) — never a source index, unique within the group. */
export function mintLineKey(group: SheetRowValue): string {
    for (;;) {
        const key = `${NEW_LINE_KEY}${(mintCounter++).toString(36)}`;
        if (!group.lines.some((l) => l.key === key)) return key;
    }
}
