/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Saving edits: a gesture's cell writes into the local layer as wire events — a row's commits, a new row, a group's lines —
 * its rows removed, and a proposed row inserted. The session records the events as one step once the gesture ends.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, type RefObject } from "react";
import { equalFor, none, some, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { NULL_CELL, bodyIndexOfId, cellIsBlank, isRowSpace, lineAddress, lineId, rowIsBlank, withLine, withoutLines, type SheetColumnMeta } from "./model.js";
import type { EditSource } from "./sheet-state.js";
import { SheetRefused } from "./creation.js";
import type { LocalLayer } from "./use-editing.js";
import type { SheetCellValue, SheetEditValue, SheetRowValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import { applyLayer, blankRow, mintLineKey, withCell } from "./local-rows.js";

const cellEqual = equalFor(Sheet.Types.Cell);

/**
 * One cell write the component turns into a wire event; `extra` names the k-th
 * NEW row a write lands on past a group's blank line (a paste, #740 G9), or
 * past a loose row (#846 — a paste, a proposal). `key` names the write's
 * column in place of `c`, the grid's: a proposed row's cell under a column
 * the grid hides lands too (#1186).
 */
export interface CellWrite {
    r: number;
    c: number;
    key?: string | undefined;
    cell: SheetCellValue;
    extra?: number | undefined;
    /** Written though its column is not the viewer's to edit: a band cell an action's `updates` sets (#1477). */
    force?: boolean | undefined;
}

/**
 * The writes' East values, by their types' names: a value's inferred type carries East's variant brand, which the
 * declaration build cannot name (TS4058).
 */
interface SheetWritesValues {
    readonly gestureEvents: RefObject<SheetEditValue[]>;
}

/**
 * Writes a gesture's edits into the local layer, as the session's events (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @returns The writes, the removal and the proposals' inserts
 */
export function useSheetWrites(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody) {
    const { allColumns, canInsertRows, capabilities, columns, group, keyOrder } = sheetDecode;
    const { canEdit, dispatchStore, editingState, layerRef, mintAmong, setLayer, sourceRows, takenKeys } = sheetSession;
    const { blankLineRowOf, body, metaAt, rowAt, rowCount, rowSpace } = sheetBody;
    // ── Writes — the local layer, then the host ───────────────────────────
    const gestureEvents = useRef<SheetEditValue[]>([]);
    const emitEdit = useCallback((edit: SheetEditValue) => { gestureEvents.current.push(edit); }, []);
    /** A gesture that failed: one the sheet refuses says why in the footer, in its words (#1536); anything else is logged, and says its own. */
    const failed = useCallback((error: unknown) => {
        if (error instanceof SheetRefused) {
            dispatchStore({ t: "patch", patch: { msg: error.notice } });
            return;
        }
        console.error("Sheet transaction failure", error);
        dispatchStore({ t: "patch", patch: { msg: { id: "text", text: error instanceof Error ? error.message : String(error) } } });
    }, [dispatchStore]);
    /**
     * Write cells: a real row's commits land in the layer's edits (one
     * `commit` event per changed cell, each carrying the row AFTER it); a
     * blank row's cells become one inserted row (one `insert` event), and so
     * do the k-th rows past a loose row (#846), each placed after the one
     * before. Returns the row-space index the FIRST inserted row landed on, so
     * the ring can follow a blank row that just became real, and the ids of
     * the rows written, in order. A new row whose key is refused (#1536)
     * refuses the whole write: nothing is written, the footer says why, and
     * `refused` says so.
     */
    const writeCells = useCallback((writes: readonly CellWrite[], source: EditSource): { firstInserted: number | undefined; ids: string[]; refused?: boolean } => {
        if (!canEdit || !editingState.available) return { firstInserted: undefined, ids: [] };
        // Writes group by row, and by the extra new line they land on past a group's blank line.
        const byRow = new Map<string, { r: number; extra: number; list: CellWrite[] }>();
        for (const w of writes) {
            const extra = w.extra ?? 0;
            const k = `${w.r}#${extra}`;
            const entry = byRow.get(k) ?? { r: w.r, extra, list: [] };
            entry.list.push(w);
            byRow.set(k, entry);
        }
        // A write's column: the one it names, hidden or not, else the grid's at its index.
        const metaOf = (w: CellWrite): SheetColumnMeta | undefined => (w.key !== undefined ? allColumns.byKey.get(w.key) : columns.list[w.c]);
        const base = layerRef.current;
        const rowsNow = applyLayer(sourceRows, base, keyOrder);
        const edits = new Map(base.edits);
        const appended = [...base.appended];
        const events: SheetEditValue[] = [];
        const ids: string[] = [];
        let lastId = rowsNow.length > 0 ? rowsNow[rowsNow.length - 1]!.id : undefined;
        let firstInserted: number | undefined;
        let inserted = 0;
        const src = variant(source, null);
        // The keys a new row's must not be (#1536) — one set per write, grown as
        // its rows are minted, never a scan of the rows per new row (#859).
        const takenIds = takenKeys();
        for (const x of rowsNow) takenIds.add(x.id);
        for (const x of appended) takenIds.add(x.id);
        // The last new loose row placed after each loose row (#846): the next lands after it.
        const chained = new Map<string, string>();
        // A group's latest row through the layer (#740), and how a rewritten group lands back in it.
        const currentGroup = (g: SheetRowValue): SheetRowValue => edits.get(g.id) ?? appended.find((x) => x.id === g.id) ?? g;
        const setGroup = (g: SheetRowValue) => {
            const at = appended.findIndex((x) => x.id === g.id);
            if (at >= 0) appended[at] = g;
            else edits.set(g.id, g);
        };
        const entries = [...byRow.values()].sort((a, b) => a.r - b.r || a.extra - b.extra);
        try {
            for (const { r, extra, list } of entries) {
                const it = rowAt(r);
                if (group !== undefined && it !== undefined) {
                    // A line: its cells change inside its group; each changed cell commits the group after it.
                    if (it.kind === "real" && it.group !== undefined) {
                        const lg = it.group;
                        let g = currentGroup(lg.row);
                        const line = g.lines.find((l) => l.key === lg.key);
                        const cells = new Map(line?.cells ?? it.row.cells);
                        let changed = false;
                        for (const w of list) {
                            const meta = metaOf(w);
                            if (meta === undefined) continue;
                            if (cellEqual(cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                            cells.set(meta.key, w.cell);
                            changed = true;
                            g = withLine(g, lg.key, new Map(cells));
                            events.push(variant("lineCommit", { rowId: g.id, offset: BigInt(it.position), line: lineAddress(lg.index), key: meta.key, row: g, source: src }));
                        }
                        if (changed) setGroup(g);
                        ids.push(it.row.id);
                        continue;
                    }
                    // A group's blank line (or the k-th line past it): one line inserted at the end of the group.
                    if (it.kind === "blank" && it.group !== undefined) {
                        if (!canInsertRows) continue;
                        const g0 = currentGroup(it.group.row);
                        const cells = new Map<string, SheetCellValue>(allColumns.list.map((c) => [c.key, NULL_CELL]));
                        for (const w of list) {
                            const meta = metaOf(w);
                            if (meta !== undefined) cells.set(meta.key, w.cell);
                        }
                        if (allColumns.list.every((c) => cellIsBlank(cells.get(c.key)))) continue;
                        const key = mintLineKey(g0);
                        const index = g0.lines.length;
                        const last = g0.lines[index - 1];
                        const g: SheetRowValue = { ...g0, lines: [...g0.lines, { key, cells, subRows: [] }] };
                        events.push(variant("lineInsert", {
                            rowId: g.id, offset: BigInt(it.position),
                            after: last !== undefined ? some(lineAddress(index - 1)) : none,
                            line: lineAddress(index), row: g, source: src,
                        }));
                        setGroup(g);
                        ids.push(lineId(g.id, key));
                        if (firstInserted === undefined) firstInserted = r + extra;
                        continue;
                    }
                    // Past a loose row (#846) — a paste's rows beyond the run, a
                    // proposal under it: the k-th new loose row, after the one before.
                    if (it.kind === "real" && it.loose !== undefined && extra > 0) {
                        if (!canInsertRows) continue;
                        let row = blankRow("", allColumns.list);
                        for (const w of list) {
                            const meta = metaOf(w);
                            if (meta !== undefined) row = withCell(row, meta.key, w.cell);
                        }
                        if (allColumns.list.every((c) => cellIsBlank(row.cells.get(c.key)))) continue;
                        row = { ...row, id: mintAmong(takenIds) };
                        const after = chained.get(it.row.id) ?? it.row.id;
                        appended.push(row);
                        events.push(variant("insert", { afterRowId: some(after), row, source: src }));
                        chained.set(it.row.id, row.id);
                        ids.push(row.id);
                        if (firstInserted === undefined) firstInserted = r + extra;
                        continue;
                    }
                    // A band cell: the group's own field commits.
                    if (it.kind === "group") {
                        const g0 = currentGroup(it.row);
                        let g = g0;
                        for (const w of list) {
                            const meta = w.key !== undefined ? group.cells.get(w.key) : metaAt(r, w.c);
                            if (meta === undefined || (!meta.editable && w.force !== true)) continue;
                            if (cellEqual(g.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                            const cells = new Map(g.cells);
                            cells.set(meta.key, w.cell);
                            g = { ...g, cells };
                            events.push(variant("commit", { rowId: g.id, offset: BigInt(it.position), key: meta.key, row: g, source: src }));
                        }
                        if (!Object.is(g, g0)) setGroup(g);
                        ids.push(g.id);
                        continue;
                    }
                }
                if (it !== undefined && it.kind === "real") {
                    let row = edits.get(it.row.id) ?? it.row;
                    for (const w of list) {
                        const meta = metaOf(w);
                        if (meta === undefined) continue;
                        if (cellEqual(row.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                        row = withCell(row, meta.key, w.cell);
                        events.push(variant("commit", { rowId: row.id, offset: BigInt(it.position), key: meta.key, row, source: src }));
                    }
                    if (!Object.is(row, it.row)) edits.set(row.id, row);
                    ids.push(row.id);
                    continue;
                }
                if (it !== undefined && !isRowSpace(it)) continue;
                if (group !== undefined || !canInsertRows) continue;
                // A blank row (or a row past the padding): one inserted row, keyed once it holds a value.
                let row = blankRow("", allColumns.list);
                for (const w of list) {
                    const meta = metaOf(w);
                    if (meta !== undefined) row = withCell(row, meta.key, w.cell);
                }
                if (allColumns.list.every((c) => cellIsBlank(row.cells.get(c.key)))) continue;
                row = { ...row, id: mintAmong(takenIds) };
                appended.push(row);
                events.push(variant("insert", { afterRowId: lastId !== undefined ? some(lastId) : none, row, source: src }));
                lastId = row.id;
                ids.push(row.id);
                if (firstInserted === undefined) firstInserted = rowsNow.length + inserted;
                inserted += 1;
            }
        } catch (error) {
            // A new row's key refused (#1536): nothing is written — the layer, the rows and the events are this write's own until it ends.
            if (!(error instanceof SheetRefused)) throw error;
            failed(error);
            return { firstInserted: undefined, ids: [], refused: true };
        }
        if (events.length === 0) return { firstInserted: undefined, ids };
        const next: LocalLayer = { edits, appended, removed: base.removed, placements: base.placements };
        layerRef.current = next;
        setLayer(() => next);
        for (const e of events) emitEdit(e);
        return { firstInserted, ids };
    }, [sourceRows, rowAt, columns, allColumns, group, metaAt, takenKeys, mintAmong, failed, setLayer, emitEdit, canEdit, canInsertRows, keyOrder, editingState.available, layerRef]);
    /**
     * Delete whole rows. On a grouped sheet (#740, G7) lines in the range
     * leave their groups (`lineRemove`) and loose rows in it leave the sheet
     * (#846, `remove`); with neither in the range, the empty groups whose
     * bands are in it leave the sheet (`remove`) — the two-step ladder: the
     * rows, then the group.
     */
    const deleteRows = useCallback((r0: number, r1: number): { n: number; what: "rows" | "lines" | "groups"; emptiedBandR: number | undefined } => {
        if (!canEdit || !editingState.available) return { n: 0, what: "rows", emptiedBandR: undefined };
        const base = layerRef.current;
        if (group !== undefined) {
            const currentGroup = (g: SheetRowValue): SheetRowValue => base.edits.get(g.id) ?? base.appended.find((x) => x.id === g.id) ?? g;
            const byGroup = new Map<string, { row: SheetRowValue; position: number; keys: string[]; addresses: string[] }>();
            const bands: { row: SheetRowValue }[] = [];
            const looseIds: string[] = [];
            // The row-space rows this step removes, to find where an emptied band lands once they have gone.
            const removedRs: number[] = [];
            for (let r = r0; r <= r1; r++) {
                const it = rowAt(r);
                if (it === undefined) continue;
                if (it.kind === "real" && it.group !== undefined) {
                    const entry = byGroup.get(it.group.row.id) ?? { row: it.group.row, position: it.position, keys: [], addresses: [] };
                    entry.keys.push(it.group.key);
                    entry.addresses.push(lineAddress(it.group.index));
                    byGroup.set(it.group.row.id, entry);
                    removedRs.push(r);
                } else if (it.kind === "real" && it.loose !== undefined) {
                    looseIds.push(it.row.id);
                    removedRs.push(r);
                } else if (it.kind === "group") {
                    bands.push({ row: it.row });
                }
            }
            if (byGroup.size > 0 || looseIds.length > 0) {
                const what = looseIds.length === 0 ? "lines" : "rows";
                if (!capabilities.removeRows) return { n: 0, what, emptiedBandR: undefined };
                const edits = new Map(base.edits);
                const appended = [...base.appended];
                let n = 0;
                // The first group left empty: the ring selects its band, so ⌫ again removes the group (G7) —
                // where the band lands once the rows above it in the range have gone.
                let emptiedBandR: number | undefined;
                for (const { row, position, keys, addresses } of byGroup.values()) {
                    const g = withoutLines(currentGroup(row), new Set(keys));
                    const at = appended.findIndex((x) => x.id === g.id);
                    if (at >= 0) appended[at] = g; else edits.set(g.id, g);
                    emitEdit(variant("lineRemove", { rowId: g.id, offset: BigInt(position), lines: addresses, row: g }));
                    n += keys.length;
                    if (emptiedBandR === undefined && g.lines.length === 0) {
                        const bandBi = bodyIndexOfId(body, g.id);
                        const bandR = bandBi >= 0 ? rowSpace.rowOf[bandBi] : undefined;
                        if (bandR !== undefined && bandR >= 0) emptiedBandR = bandR - removedRs.filter((r) => r < bandR).length;
                    }
                }
                // Loose rows leave the sheet as entries of their own (#846).
                if (looseIds.length > 0) emitEdit(variant("remove", { rowIds: looseIds }));
                n += looseIds.length;
                const removed = looseIds.length > 0 ? new Set([...base.removed, ...looseIds]) : base.removed;
                const next: LocalLayer = { edits, appended, removed, placements: base.placements };
                layerRef.current = next;
                setLayer(() => next);
                return { n, what, emptiedBandR };
            }
            if (!capabilities.removeGroups) return { n: 0, what: "groups", emptiedBandR: undefined };
            const ids = bands.filter((b) => currentGroup(b.row).lines.length === 0).map((b) => b.row.id);
            if (ids.length === 0) return { n: 0, what: "groups", emptiedBandR: undefined };
            const next: LocalLayer = { ...base, removed: new Set([...base.removed, ...ids]) };
            layerRef.current = next;
            setLayer(() => next);
            emitEdit(variant("remove", { rowIds: ids }));
            return { n: ids.length, what: "groups", emptiedBandR: undefined };
        }
        if (!capabilities.removeRows) return { n: 0, what: "rows", emptiedBandR: undefined };
        const ids: string[] = [];
        for (let r = r0; r <= r1; r++) {
            const it = rowAt(r);
            if (it !== undefined && it.kind === "real") ids.push(it.row.id);
        }
        if (ids.length === 0) return { n: 0, what: "rows", emptiedBandR: undefined };
        const next: LocalLayer = { ...base, removed: new Set([...base.removed, ...ids]) };
        layerRef.current = next;
        setLayer(() => next);
        emitEdit(variant("remove", { rowIds: ids }));
        return { n: ids.length, what: "rows", emptiedBandR: undefined };
    }, [group, rowAt, body, rowSpace, setLayer, emitEdit, canEdit, capabilities, editingState.available, layerRef]);
    /** What a proposed row writes: its set cells under the editable columns — every declared one, the grid's hidden ones too (#1186). */
    const proposalWrites = useCallback((cells: ReadonlyMap<string, SheetCellValue>): { key: string; cell: SheetCellValue }[] => {
        const writes: { key: string; cell: SheetCellValue }[] = [];
        for (const meta of allColumns.list) {
            if (!meta.editable || meta.kind === "stamped" || meta.kind === "action") continue;
            const cell = cells.get(meta.key);
            if (cell !== undefined && !cellIsBlank(cell)) writes.push({ key: meta.key, cell });
        }
        return writes;
    }, [allColumns]);
    /** Insert one proposed row after a row: into the blank slot below it (B§5.2), else appended; on a grouped sheet into the anchor's group (#740, G11). */
    const insertProposal = useCallback((afterR: number, cells: ReadonlyMap<string, SheetCellValue>, extra = 0): { id: string; r: number } | undefined => {
        if (!canInsertRows) return undefined;
        const writes = proposalWrites(cells);
        if (writes.length === 0) return undefined;
        if (group !== undefined) {
            const anchor = rowAt(afterR);
            const gid = anchor !== undefined && (anchor.kind === "real" || anchor.kind === "blank") ? anchor.group?.row.id : undefined;
            const blankR = gid !== undefined ? blankLineRowOf(gid) : undefined;
            if (blankR === undefined) return undefined;
            const res = writeCells(writes.map((w) => ({ r: blankR, c: -1, key: w.key, cell: w.cell, extra })), "pattern");
            const id = res.ids[0];
            return id === undefined ? undefined : { id, r: blankR + extra };
        }
        const next = rowAt(afterR + 1);
        let target: number;
        if (next !== undefined && next.kind === "blank") target = afterR + 1;
        else if (next !== undefined && next.kind === "real" && rowIsBlank(next.row, allColumns)) target = afterR + 1;
        else {
            const firstBlank = rowSpace.bodyIndexOf.findIndex((bi) => body[bi]!.kind === "blank");
            target = firstBlank < 0 ? rowCount : firstBlank;
        }
        const res = writeCells(writes.map((w) => ({ r: target, c: -1, key: w.key, cell: w.cell })), "pattern");
        const id = res.ids[0];
        if (id === undefined) return undefined;
        return { id, r: res.firstInserted ?? target };
    }, [proposalWrites, allColumns, group, rowAt, blankLineRowOf, rowSpace, body, rowCount, writeCells, canInsertRows]);
    /** Insert proposed rows under a loose row (#846): new loose rows after it, in order — one write, so each lands after the one before. Returns their ids. */
    const insertLooseProposals = useCallback((afterR: number, proposals: readonly { cells: ReadonlyMap<string, SheetCellValue> }[]): string[] => {
        if (!canInsertRows) return [];
        const writes = proposals.flatMap((p, i) => proposalWrites(p.cells).map((w) => ({ r: afterR, c: -1, key: w.key, cell: w.cell, extra: i + 1 })));
        return writes.length === 0 ? [] : writeCells(writes, "pattern").ids;
    }, [canInsertRows, proposalWrites, writeCells]);
    const named: SheetWritesValues = { gestureEvents };
    return { deleteRows, emitEdit, failed, insertLooseProposals, insertProposal, writeCells, ...named };
}

/** What {@link useSheetWrites} gives the parts after it. */
export type SheetWrites = ReturnType<typeof useSheetWrites>;
