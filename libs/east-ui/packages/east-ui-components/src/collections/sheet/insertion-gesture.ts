/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Stable destinations shared by insertion buttons, keyboard and previews. @packageDocumentation */
import { none, some, variant } from "@elaraai/east";
import type { Placement } from "./transactions.js";
import type { SheetEditValue, SheetRowValue } from "./values.js";

export interface InsertionAnchor {
    /** Top-level identity, independent of source/viewport position. */
    entry: string | undefined;
    /** A child's internal key; undefined means the summary or a flat entry. */
    child?: string | undefined;
    /** A group's trailing blank row. */
    tail?: boolean | undefined;
    side: "before" | "after";
}
export interface InsertRequest { kind: "row" | "group"; anchor: InsertionAnchor }

/** Group insertions snap around whole groups, never split a child array. */
export function groupInsertionSide(row: SheetRowValue, anchor: InsertionAnchor): "before" | "after" {
    if (anchor.tail) return "after";
    if (anchor.child === undefined) return anchor.side;
    const index = row.lines.findIndex(line => line.key === anchor.child);
    const slot = index + (anchor.side === "after" ? 1 : 0);
    return slot <= row.lines.length / 2 ? "before" : "after";
}

/**
 * Build one wire gesture; constructors and draft decoding still run at the
 * common transaction boundary.
 *
 * @param request - What to insert, and where
 * @param rows - The rows on screen, in order
 * @param positionOf - A row's position by its index — a failed window before it counts (#853)
 * @param grouped - Whether the rows are groups
 * @param keyed - Whether the source is keyed
 * @param makeEntry - Mints a new entry's id
 * @param makeChild - Mints a new line's key in a group
 * @returns The gesture, or `undefined` when its anchor is gone
 */
export function insertionGesture(request: InsertRequest, rows: readonly SheetRowValue[], positionOf: (index: number) => number, grouped: boolean, keyed: boolean,
    makeEntry: () => string, makeChild: (group: SheetRowValue) => string,
): { event: SheetEditValue; placement?: Placement; id: string; child?: string } | undefined {
    const { kind, anchor } = request;
    const at = anchor.entry === undefined ? -1 : rows.findIndex(row => row.id === anchor.entry);
    if (anchor.entry !== undefined && at < 0) return undefined;
    const parent = rows[at];
    if (kind === "row" && grouped) {
        if (parent === undefined) return undefined;
        const childAt = anchor.child === undefined ? -1 : parent.lines.findIndex(line => line.key === anchor.child);
        if (anchor.child !== undefined && childAt < 0) return undefined;
        const index = anchor.tail ? parent.lines.length : childAt < 0 ? 0 : childAt + (anchor.side === "after" ? 1 : 0);
        const key = makeChild(parent);
        const lines = [...parent.lines];
        lines.splice(index, 0, { key, cells: new Map(), subRows: [] });
        return { id: parent.id, child: key, event: variant("lineInsert", {
            rowId: parent.id, offset: BigInt(positionOf(at)), after: index > 0 ? some(String(index - 1)) : none,
            line: String(index), row: { ...parent, lines }, source: variant("typed", null),
        }) };
    }
    const id = makeEntry();
    if (rows.some(row => row.id === id)) throw new Error("The new row id already exists in this sheet");
    const side = kind === "group" && parent !== undefined ? groupInsertionSide(parent, anchor) : anchor.side;
    const placement: Placement = some(keyed ? variant("keyOrder", null) : variant("ordered", parent === undefined ? variant("end", null) : variant(side, parent.id)));
    const row: SheetRowValue = { id, owned: false, cells: new Map(), lines: [], band: kind === "group" ? some({ sub: "", folded: false }) : none, subRows: [] };
    return { id, placement, event: variant("insert", { afterRowId: none, row, source: variant("typed", null) }) };
}
