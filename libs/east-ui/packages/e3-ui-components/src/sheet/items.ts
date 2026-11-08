/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a body item is known by as the rows move: its key for the virtual rows, the source element it stands for, its
 * place in the row space and among the grid's rows, the record's rows it stands for under the lens, and its drop row.
 *
 * @packageDocumentation
 */

import { blankIdOf, bodyIndexOfId, type SheetBodyItem } from "./model.js";
import { isBlankRowId } from "./sheet-state.js";
import { dropRowOf, printDropRow } from "./drop.js";

/**
 * The record's rows a body item stands for under the lens (#1349): a row's
 * own — a line's or a sub row's, its group's — or the stretch a band reads or
 * a failed read covers; none for a proposal, which no row stands behind yet.
 */
export function spanOf(it: SheetBodyItem): { from: number; to: number } | undefined {
    switch (it.kind) {
        case "band": return { from: it.band.from, to: it.band.to };
        case "failed": return { from: it.failure.from, to: it.failure.to };
        case "proposal": return undefined;
        default: return { from: it.position, to: it.position };
    }
}

/** The boxes of the rows the virtualizer has mounted, by body index (its row wrappers carry `data-index`). */
export function mountedBoxes(scrollEl: HTMLElement): Map<number, DOMRect> {
    const out = new Map<number, DOMRect>();
    for (const w of scrollEl.querySelectorAll<HTMLElement>(":scope > div > [data-index]")) out.set(Number(w.dataset.index), w.getBoundingClientRect());
    return out;
}

/** A body item's identity for the virtual rows: it stays with the item when rows open, fold or move around it. */
export function keyOfItem(it: SheetBodyItem | undefined, i: number): string {
    if (it === undefined) return `#${i}`;
    switch (it.kind) {
        case "real": return `row:${it.row.id}`;
        case "group": return `group:${it.row.id}`;
        case "subRow": return `sub:${it.lineId}#${it.index}`;
        case "blank": return `blank:${blankIdOf(it)}`;
        // A band is a place in one run, never an item (#1398): it is keyed by the elements it stands for — a paged run's
        // band at each end, the lens's for each stretch it reads (#1349) — so a band that comes to stand for others, a
        // window landing beside it, is another item, and never carries the height the frame measured for the last.
        case "band": return `band:${it.band.at}:${it.band.from}-${it.band.to}`;
        case "failed": return `failed:${it.failure.w}`;
        case "proposal": return `proposal:${it.anchorR}#${it.index}`;
    }
    return `#${i}`;
}

/** The source element a body item belongs to (#857) — a row, or a line's or a sub row's group; `null` where no element stands behind it (a paged band, a blank). */
export function elementOf(it: SheetBodyItem): number | null {
    switch (it.kind) {
        case "real": case "group": case "subRow": return it.position;
        case "failed": return it.failure.from;
        default: return null;
    }
}

/**
 * The source element under a resting view's top (#857): its item's — or,
 * over an unloaded band, the element the band draws at that depth. A band is
 * a place in one run, never an item: a remount's bands cover other elements,
 * so what persists for one is the element. Its rows are drawn at the ledger's
 * rate, so the depth maps to an element proportionally.
 */
export function elementUnder(it: SheetBodyItem, offset: number): number | null {
    if (it.kind !== "band") return elementOf(it);
    const { from, to, px } = it.band;
    const n = to - from + 1;
    return px > 0 ? from + Math.min(n - 1, Math.max(0, Math.floor((offset / px) * n))) : from;
}

/**
 * Where a persisted anchor whose item is gone lands (#857). On a paged sheet,
 * its element is the place: the first item at or past it — the band of a
 * failed window that holds it — because an index names a place only in the
 * run it was taken from. Otherwise its index, clamped to the body.
 */
export function placeOf(body: readonly SheetBodyItem[], index: number, element: number | undefined): number {
    if (element !== undefined) {
        const at = body.findIndex((it) => (it.kind === "failed" ? it.failure.to : elementOf(it) ?? -1) >= element);
        if (at >= 0) return at;
    }
    return Math.min(index, body.length - 1);
}

/**
 * A row-space place's identity (#854): a row's or a group's id, a group's
 * blank line's (it names its group) — or, for a padding row, its place among
 * the padding: padding rows are alike, and their ids name positions that a
 * row inserted above moves (#877).
 */
export type RowSlot = { id: string } | { blank: number };

/** The identity of a row-space item. */
export function slotOf(it: SheetBodyItem): RowSlot | undefined {
    if (it.kind === "real" || it.kind === "group") return { id: it.row.id };
    if (it.kind === "blank") return it.group !== undefined ? { id: blankIdOf(it) } : { blank: it.blankIndex };
    return undefined;
}

/** Where each row-space place of `before` sits in `after` (#854) — `null` for a row that left (#877), `undefined` where `before` held nothing. */
export function followRows(before: readonly (RowSlot | undefined)[], after: readonly (RowSlot | undefined)[]): (r: number) => number | null | undefined {
    const byId = new Map<string, number>();
    const byBlank = new Map<number, number>();
    after.forEach((slot, r) => {
        if (slot === undefined) return;
        if ("id" in slot) { if (!byId.has(slot.id)) byId.set(slot.id, r); }
        else if (!byBlank.has(slot.blank)) byBlank.set(slot.blank, r);
    });
    return (r) => {
        const slot = before[r];
        if (slot === undefined) return undefined;
        return ("id" in slot ? byId.get(slot.id) : byBlank.get(slot.blank)) ?? null;
    };
}

/** What is open in a body: each group unfolded, each line whose sub rows show. */
export function openKeysOf(body: readonly SheetBodyItem[]): Set<string> {
    const out = new Set<string>();
    for (const it of body) {
        if (it.kind === "group" && !it.folded) out.add(`group:${it.row.id}`);
        else if (it.kind === "subRow") out.add(`line:${it.lineId}`);
    }
    return out;
}

/** The source position a row-space item stands at — a row's, a group's band, a blank's the place it would take; `undefined` off the row space. */
export function rowPositionOf(it: SheetBodyItem): number | undefined {
    return it.kind === "real" || it.kind === "group" || it.kind === "blank" ? it.position : undefined;
}

/**
 * A body item's place among the grid's rows (#860), counting the header as
 * the first: on a flat sheet a row's source position (a band or a failed
 * window where its first element would be; a proposal has no place of its
 * own), so the count and every index describe the whole source; on a
 * grouped sheet, the body's order — an unloaded run is one row, the Plan's
 * rule (#819).
 */
export function ariaRowIndexOf(it: SheetBodyItem, i: number, grouped: boolean): number | undefined {
    if (grouped) return i + 2;
    switch (it.kind) {
        case "real": case "blank": return it.position + 2;
        case "band": return it.band.from + 2;
        case "failed": return it.failure.from + 2;
        default: return undefined;
    }
}

/** The body index of an anchor — a real row (or a group's band) by id, a blank row or blank line by its synthetic id. */
export function anchorBodyIndex(body: readonly SheetBodyItem[], anchorId: string): number {
    if (!isBlankRowId(anchorId)) return bodyIndexOfId(body, anchorId);
    return body.findIndex((it) => it.kind === "blank" && blankIdOf(it) === anchorId);
}

/** A row-space item's drop row, printed — what its drop cell's `CellRef` carries. */
export function dropText(item: SheetBodyItem): string | undefined {
    const row = dropRowOf(item);
    return row === undefined ? undefined : printDropRow(row);
}
