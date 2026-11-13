/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The drafts an author's callbacks read a sheet's rows over (#1599): each row
 * as its person sees it — the rule a gesture begins by (east-ui-components'
 * `EditSession.startOf`), asked for the rows around the one a callback is for.
 *
 * A sheet's callbacks — a column's fill, its options, a custom parse, a link's
 * checks, the rows' readiness — read rows the grid shows, each over its
 * entry's draft: a field no column shows reaches them only so. e3-ui's bridge
 * takes a row's draft from the drafts it is handed, and reads the source for a
 * row they leave out — at the revision the source reads at now. While the rows
 * are read again, after a Save or another session's write, the grid shows them
 * as they were read and that read is on its way: a callback then saw the rows
 * around its own with every such field missing, so a check misfired and a fill
 * proposed nothing until the pages landed.
 *
 * So the sheet hands the bridge each shown row's draft itself: the session's;
 * else what a Save landed of it, while the rows have still to read that Save
 * (both the layer's); else the entry its window was read with (east-ui's
 * `CarriedWindowType`, by the row's id and its place in the source), lifted. A
 * row whose window carries no entry — a sheet over rows held whole, one that
 * writes nothing, a row not yet saved — is left to the bridge's own read, as
 * it was.
 *
 * @packageDocumentation
 */

import { decodeBeast2For, encodeBeast2For, fromEastTypeValue, type ValueTypeOf } from "@elaraai/east";
import type { SheetEditingType } from "@elaraai/e3-ui/internal";
import { liftDraft } from "./draft-values.js";
import type { RowSegment } from "./model.js";
import type { SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;

/** The drafts a sheet's callbacks read its rows over (see the module docs). */
export interface ShownDrafts {
    /**
     * The draft the entry a row was read with lifts to, encoded — made once an entry, however often it is asked for.
     *
     * @param id - The row's id
     * @param at - Its place in the source
     * @returns Its entry's draft; `undefined` for a row whose window carries no entry of it
     */
    readonly base: (id: string, at: number) => Uint8Array | undefined;
    /**
     * The drafts a callback over the rows reads them over: the layer's, and for each row it holds none of, the row's
     * own. The same map while the rows, their runs and the layer are the same ones.
     *
     * @param rows - The rows the sheet lays out, the layer applied
     * @param segments - Their contiguous runs: a row's place in the source is its run's, and its place in the run
     * @param layer - Each drafted entry's draft, and each one a Save landed that the rows have still to read
     * @returns Each row's draft, by its id, where it has one
     */
    readonly over: (rows: readonly SheetRowValue[], segments: readonly RowSegment[], layer: ReadonlyMap<string, Uint8Array>) => Map<string, Uint8Array>;
    /**
     * The drafts a check of one row reads it over: the layer's where it holds the row's, else the row's own alone.
     *
     * @param id - The id of the row the check is of — a line's group's, for a line
     * @param at - Its place in the source
     * @param layer - Each drafted entry's draft, and each one a Save landed that the rows have still to read
     * @returns The drafts to hand the check
     */
    readonly of: (id: string, at: number, layer: Map<string, Uint8Array>) => Map<string, Uint8Array>;
}

/**
 * Makes the drafts a sheet's callbacks read its rows over (see the module docs).
 *
 * @param editing - The sheet's editing declaration: its entry and draft types
 * @param entryOf - The stored entry the window standing at a row's place in the source read with it; `undefined` where
 *   the sheet's windows carry none — its rows are held whole, or another query's stand in
 * @returns The drafts, by row
 */
export function shownDrafts(editing: Editing, entryOf: ((id: string, at: number) => Uint8Array | undefined) | undefined): ShownDrafts {
    const draftType = fromEastTypeValue(editing.draftType);
    const encodeDraft = encodeBeast2For(editing.draftType);
    const decodeEntry = decodeBeast2For(editing.entryType);
    // By the entry's bytes, which its window holds while it stands: a window read again carries other bytes.
    const lifted = new WeakMap<Uint8Array, Uint8Array>();
    const base = (id: string, at: number): Uint8Array | undefined => {
        const entry = entryOf?.(id, at);
        if (entry === undefined) return undefined;
        let draft = lifted.get(entry);
        if (draft === undefined) {
            draft = encodeDraft(liftDraft(draftType, decodeEntry(entry)));
            lifted.set(entry, draft);
        }
        return draft;
    };
    let last: {
        readonly rows: readonly SheetRowValue[]; readonly segments: readonly RowSegment[];
        readonly layer: ReadonlyMap<string, Uint8Array>; readonly drafts: Map<string, Uint8Array>;
    } | undefined;
    const alone = new WeakMap<Uint8Array, Map<string, Uint8Array>>();
    return {
        base,
        over: (rows, segments, layer) => {
            if (last !== undefined && last.rows === rows && last.segments === segments && last.layer === layer) return last.drafts;
            const drafts = new Map(layer);
            if (entryOf !== undefined) {
                segments.forEach((segment, s) => {
                    // The last run holds every row after its start, as a callback's context does.
                    const end = s === segments.length - 1 ? rows.length : Math.min(segment.end, rows.length);
                    for (let i = segment.start; i < end; i++) {
                        const row = rows[i]!;
                        if (drafts.has(row.id)) continue;
                        const own = base(row.id, segment.position + (i - segment.start));
                        if (own !== undefined) drafts.set(row.id, own);
                    }
                });
            }
            last = { rows, segments, layer, drafts };
            return drafts;
        },
        of: (id, at, layer) => {
            if (layer.has(id)) return layer;
            const own = base(id, at);
            if (own === undefined) return layer;
            let one = alone.get(own);
            if (one === undefined) {
                one = new Map([[id, own]]);
                alone.set(own, one);
            }
            return one;
        },
    };
}
