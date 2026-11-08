/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The local layer over the decoded rows: the rows with its edits, appends, removals and placements applied, a row
 * with one cell replaced, a blank row, a line's minted key, and the words a row is named by.
 *
 * @packageDocumentation
 */

import { none } from "@elaraai/east";
import { NEW_LINE_KEY, NULL_CELL, type SheetColumnIndex, type SheetColumnMeta } from "./model.js";
import { placeInOrder } from "./placement.js";
import type { LocalLayer } from "./use-editing.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";

/** A row as the sheet names it — its first text column's text — where it holds one. */
export function rowNameOf(row: SheetRowValue | undefined, columns: SheetColumnIndex): string | undefined {
    if (row === undefined) return undefined;
    for (const column of columns.list) {
        if (column.kind !== "text") continue;
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

/** A row with one cell replaced. */
export function withCell(row: SheetRowValue, key: string, cell: SheetCellValue): SheetRowValue {
    const cells = new Map(row.cells);
    cells.set(key, cell);
    return { ...row, cells };
}

/** A fresh row — every declared cell blank; no lines and no band (a flat row, or a line as a pseudo row). */
export function blankRow(id: string, columns: readonly SheetColumnMeta[]): SheetRowValue {
    return { id, owned: false, cells: new Map(columns.map((c) => [c.key, NULL_CELL])), lines: [], band: none, subRows: [] };
}

export let mintCounter = 0;

/** A renderer-minted line key (#740) — never a source index, unique within the group. */
export function mintLineKey(group: SheetRowValue): string {
    for (;;) {
        const key = `${NEW_LINE_KEY}${(mintCounter++).toString(36)}`;
        if (!group.lines.some((l) => l.key === key)) return key;
    }
}
