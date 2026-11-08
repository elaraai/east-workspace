/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The body the grid walks — the rows, bands, sub rows, blanks and proposals in order — and its row space, with what a
 * transition asks of a place in it: the item, the column, the cell and the member at a row and column, and the contexts a
 * provider, a check and a parse are given there.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { StringType, equalFor, none, some } from "@elaraai/east";
import { NEW_LINE_KEY, NULL_CELL, blankIdOf, buildBody, buildLensBody, driverKeyOf, isLooseRow, isRowSpace, lineRowsOf, resolveMember as resolveRegisterMember, segmentOf, withProposals, type LineGroup, type SheetBodyItem, type SheetColumnMeta } from "./model.js";
import { lensBodyItems } from "./lens-layout.js";
import type { CandidateContext } from "./candidates.js";
import type { ParseContext } from "./parse/index.js";
import { useSheetLinks } from "./use-links.js";
import { membershipAt } from "./membership.js";
import { namesMember } from "./Rows.js";
import type { SheetCellValue, SheetContextValue, SheetLinkValue, SheetRegisterMemberValue, SheetRowValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import { anchorBodyIndex } from "./items.js";

const stringEqual = equalFor(StringType);

/**
 * Lays out the body and answers what a row and a column hold (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @returns The body, the row space and what each place in it holds
 */
export function useSheetBody(sheetDecode: SheetDecode, sheetSession: SheetSession) {
    const {
        allColumns, blanks, columns, driver, driverColumn, group, loose, registers, titleMeta, today, words,
    } = sheetDecode;
    const {
        drafts, exhausted, foldedOf, lens, lensDrawn, paging, rows, rowsOffset, runLayout, subRowsOpenOf, ui,
    } = sheetSession;
    // ── The body ──────────────────────────────────────────────────────────
    // Under the lens, what it laid out over the record, the local layer applied
    // to its rows (#1349); else the rows, the paged arm's bands, and the blanks.
    const lensLayout = lensDrawn ? lens.layout : undefined;
    const bodyBase = useMemo<SheetBodyItem[]>(() => {
        const grouped = group !== undefined ? { foldedOf, subRowsOpen: subRowsOpenOf } : undefined;
        if (lensLayout !== undefined) return buildLensBody(lensBodyItems(lensLayout, rows, runLayout.positions), grouped);
        return buildBody({
            rows, rowsOffset, positions: runLayout.positions, failures: runLayout.failures,
            blanks: group !== undefined ? blanks : blanks + ui.appended, exhausted,
            total: paging.total, head: paging.head, tail: paging.tail, grouped,
        });
    }, [lensLayout, rows, rowsOffset, runLayout, blanks, ui.appended, exhausted, paging.total, paging.head, paging.tail, group, foldedOf, subRowsOpenOf]);
    // The copilot's proposed rows sit under their anchor, outside the row space.
    const body = useMemo<SheetBodyItem[]>(() => {
        const sugg = ui.sugg;
        if (sugg === null || sugg.rows.length === 0) return bodyBase;
        return withProposals(bodyBase, anchorBodyIndex(bodyBase, sugg.anchorId), sugg.rows);
    }, [bodyBase, ui.sugg]);
    // Row space — the body without its runs not read or failed, its sub rows and its proposals.
    const rowSpace = useMemo(() => {
        const bodyIndexOf: number[] = [];
        const rowOf: number[] = new Array<number>(body.length).fill(-1);
        body.forEach((it, i) => {
            if (!isRowSpace(it)) return;
            rowOf[i] = bodyIndexOf.length;
            bodyIndexOf.push(i);
        });
        return { bodyIndexOf, rowOf };
    }, [body]);
    const rowCount = rowSpace.bodyIndexOf.length;
    const colCount = columns.list.length;
    // Under the lens (#1349): the stretches it has not read — or whose read failed — beyond the rows it draws, by the
    // record's rows they stand for: the first of them and the last, and the nearest before its first row and past its
    // last. A key that crosses an end goes into them through the lens's jump, as a paged sheet's goes through its
    // pages' (#860, #1398, CL10) — never stopping at the rows read.
    const lensEnds = useMemo(() => {
        if (!lensDrawn) return undefined;
        const unread = (it: SheetBodyItem | undefined): { from: number; to: number } | undefined => (it?.kind === "band" ? { from: it.band.from, to: it.band.to }
            : it?.kind === "failed" ? { from: it.failure.from, to: it.failure.to } : undefined);
        const firstRow = rowSpace.bodyIndexOf[0] ?? body.length;
        const lastRow = rowSpace.bodyIndexOf[rowSpace.bodyIndexOf.length - 1] ?? -1;
        let first: { from: number; to: number } | undefined;
        let before: { from: number; to: number } | undefined;
        for (let i = 0; i < firstRow; i++) {
            const span = unread(body[i]);
            if (span === undefined) continue;
            first ??= span;
            before = span;
        }
        let after: { from: number; to: number } | undefined;
        let last: { from: number; to: number } | undefined;
        for (let i = body.length - 1; i > lastRow; i--) {
            const span = unread(body[i]);
            if (span === undefined) continue;
            last ??= span;
            after = span;
        }
        return { first, before, after, last };
    }, [lensDrawn, body, rowSpace]);
    // Each body item's place in its group's rail, once per body (#858): a
    // row is handed its own entry, which holds still until the body moves.
    const memberships = useMemo(() => body.map((_it, i) => membershipAt(body, i)), [body]);
    const rowAt = useCallback((r: number): SheetBodyItem | undefined => {
        const bi = rowSpace.bodyIndexOf[r];
        return bi === undefined ? undefined : body[bi];
    }, [rowSpace, body]);
    /** The meta of the cell at a row and column — a band's cell under the column (the title over the first columns), else the column's (#740). */
    const metaAt = useCallback((r: number, c: number): SheetColumnMeta | undefined => {
        const col = columns.list[c];
        if (group === undefined) return col;
        const it = rowAt(r);
        if (it === undefined) return col;
        if (it.kind === "group") return c < group.titleSpan ? titleMeta : col !== undefined ? group.cells.get(col.key) : undefined;
        return col;
    }, [columns, group, titleMeta, rowAt]);
    const cellAt = useCallback((r: number, c: number): SheetCellValue | undefined => {
        const it = rowAt(r);
        const meta = metaAt(r, c);
        if (it === undefined || meta === undefined) return undefined;
        if (it.kind === "real" || it.kind === "group") return it.row.cells.get(meta.key);
        return undefined;
    }, [rowAt, metaAt]);
    // The cells of a row-space row (a line's, a band's; a blank line's are empty), for a date column's level.
    const cellsAt = useCallback((r: number): ReadonlyMap<string, SheetCellValue> => {
        const it = rowAt(r);
        return it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row.cells : new Map();
    }, [rowAt]);
    /** A date column's level for a row (#844). */
    const levelAt = useCallback((r: number, meta: SheetColumnMeta) => (meta.kind === "date" && meta.level !== undefined ? meta.level(cellsAt(r)) : undefined), [cellsAt]);
    /** The register member a cell holds the key of (#1536) — the one its label shows for, as the cell draws it. */
    const memberAt = useCallback((r: number, c: number): SheetRegisterMemberValue | undefined => {
        const meta = metaAt(r, c);
        const cell = cellAt(r, c);
        if (meta === undefined || !namesMember(meta) || cell?.type !== "String") return undefined;
        const member = resolveRegisterMember(registers, meta.register, cell.value);
        return member !== undefined && stringEqual(member.key, cell.value) ? member : undefined;
    }, [metaAt, cellAt, registers]);
    const rowOf = useCallback((id: string): number | undefined => {
        const bi = anchorBodyIndex(body, id);
        if (bi < 0) return undefined;
        const r = rowSpace.rowOf[bi];
        return r === undefined || r < 0 ? undefined : r;
    }, [body, rowSpace]);
    const idAt = useCallback((r: number): string | undefined => {
        const it = rowAt(r);
        if (it === undefined) return undefined;
        switch (it.kind) {
            case "real": case "group": return it.row.id;
            case "blank": return blankIdOf(it);
            default: return undefined;
        }
    }, [rowAt]);
    /** The row-space index of a group's blank line (#740). */
    const blankLineRowOf = useCallback((groupId: string): number | undefined => {
        const r = rowSpace.bodyIndexOf.findIndex((bi) => { const it = body[bi]; return it !== undefined && it.kind === "blank" && it.group?.row.id === groupId; });
        return r < 0 ? undefined : r;
    }, [rowSpace, body]);

    // ── What a transition may ask ─────────────────────────────────────────
    // A column's options rule (#844) reads the row's wire context; the context builder is declared below, so it is reached through a ref.
    const wireContextForRef = useRef<((r: number) => SheetContextValue) | undefined>(undefined);
    // The loose rows between the groups (#846), in order: what a loose row's candidates rank against.
    const looseRows = useMemo(() => (loose ? rows.filter(isLooseRow) : []), [loose, rows]);
    // A line's candidates rank against ITS GROUP's lines (the row above is the line above); a loose row's, against the loose rows.
    const candidateCtxFor = useCallback((r: number): CandidateContext => {
        const allowed = (meta: SheetColumnMeta): ReadonlySet<string> | undefined => {
            const rule = meta.options;
            const wire = wireContextForRef.current;
            if (rule === undefined || wire === undefined) return undefined;
            try {
                const keys = rule(wire(r));
                return keys === undefined ? undefined : new Set(keys);
            } catch (err) {
                console.error(`[Sheet] options rule failed on column "${meta.key}":`, err);
                return undefined;
            }
        };
        const it = rowAt(r);
        const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
        if (lg !== undefined) return { registers, rows: lineRowsOf(lg.row), rowIndex: lg.index, driverColumn, allowed };
        if (it !== undefined && it.kind === "real" && it.loose !== undefined) return { registers, rows: looseRows, rowIndex: it.loose, driverColumn, allowed };
        return { registers, rows, rowIndex: it !== undefined && it.kind === "real" ? it.residentIndex : -1, driverColumn, allowed };
    }, [rowAt, registers, rows, looseRows, driverColumn]);
    /** The wire context over a row — the copilot's, a check's, a custom parse's (§4.4); a line's names its group and its key (#740). */
    const wireContextOf = useCallback((row: SheetRowValue | undefined, residentIndex: number, position: number, rowsNow: SheetRowValue[], lg?: LineGroup): SheetContextValue => {
        const driverKey = driverKeyOf(row, driverColumn);
        // The rows an author sees are the contiguous run around this one: a
        // failed window is never inside them, so `rowsOffset + index` stays
        // each one's position — the bridge reads their entries by it (#853).
        const segments = runLayout.segments;
        const seg = segmentOf(segments, residentIndex);
        const last = seg === segments[segments.length - 1];
        return {
            drafts,
            rowIndex: BigInt(lg !== undefined ? lg.index : residentIndex - seg.start),
            rowId: lg !== undefined ? lg.row.id : row?.id ?? "",
            offset: BigInt(position),
            line: lg !== undefined ? some(lg.key === "" ? NEW_LINE_KEY : lg.key) : none,
            row: row?.cells ?? new Map(allColumns.list.map((c) => [c.key, NULL_CELL])),
            rows: rowsNow.slice(seg.start, last ? undefined : seg.end),
            rowsOffset: BigInt(seg.position),
            partial: !exhausted,
            driver: driverKey !== undefined ? some(driverKey) : none,
            today,
        };
    }, [driverColumn, allColumns, runLayout, exhausted, today, drafts]);
    // The position after the last row — where a blank row or an append lands.
    const lastSegment = runLayout.segments[runLayout.segments.length - 1]!;
    const endPosition = lastSegment.position + (lastSegment.end - lastSegment.start);
    const wireContextFor = useCallback((r: number): SheetContextValue => {
        const it = rowAt(r);
        const row = it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row : undefined;
        const position = it !== undefined && (it.kind === "real" || it.kind === "blank" || it.kind === "group") ? it.position : endPosition;
        const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
        return wireContextOf(row, it !== undefined && (it.kind === "real" || it.kind === "group") ? it.residentIndex : rows.length, position, rows, lg);
    }, [rowAt, rows, endPosition, wireContextOf]);
    wireContextForRef.current = wireContextFor;
    // The link editor predicts from the column's pending fill (B§4.5).
    const predictedLink = useCallback((r: number, key: string): SheetLinkValue | undefined => {
        const sugg = ui.sugg;
        if (sugg === null || sugg.anchorId !== idAt(r)) return undefined;
        const f = sugg.fill.get(key);
        return f !== undefined && f.cell.type === "Link" ? f.cell.value : undefined;
    }, [ui.sugg, idAt]);
    // A link column's options rule narrows what a row is offered.
    const allowedFor = useCallback((r: number, meta: SheetColumnMeta) => candidateCtxFor(r).allowed?.(meta), [candidateCtxFor]);
    const links = useSheetLinks({ drafts, columns, registers, driver, driverColumn, body, rowAt, predictedLink, allowedFor, words });
    const { linkVocabularies, linkColumns, linkCellCtx, linkCtxFor } = links;
    const parseCtxFor = useCallback((r: number, meta: SheetColumnMeta): ParseContext => {
        let baseDate: Date | undefined;
        if (meta.kind === "date" && meta.base !== undefined) {
            const it = rowAt(r);
            const b = it !== undefined && it.kind === "real" ? it.row.cells.get(meta.base) : undefined;
            if (b !== undefined && b.type === "DateTime") baseDate = b.value;
        }
        return {
            ...candidateCtxFor(r),
            words,
            today,
            baseDate,
            wireContext: meta.kind === "custom" ? wireContextFor(r) : undefined,
            linkVocab: meta.kind === "link" || meta.kind === "set" ? linkVocabularies.get(meta.key) : undefined,
        };
    }, [rowAt, candidateCtxFor, words, today, wireContextFor, linkVocabularies]);
    return {
        allowedFor, blankLineRowOf, body, candidateCtxFor, cellAt, colCount, endPosition, idAt, lensEnds, lensLayout,
        levelAt, linkCellCtx, linkColumns, linkCtxFor, linkVocabularies, memberAt, memberships, metaAt, parseCtxFor,
        rowAt, rowCount, rowOf, rowSpace, wireContextFor, wireContextOf,
    };
}

/** What {@link useSheetBody} gives the parts after it. */
export type SheetBody = ReturnType<typeof useSheetBody>;
