/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The copilot runner: a row's fill providers and proposers, asked after the kind's latency against the row as it would be
 * if the open editor committed, their asynchronous answers landing as they come.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { NULL_CELL, driverKeyOf, rowIsBlank } from "./model.js";
import { provisionalCell, type Suggestions } from "./sheet-state.js";
import { runSuggest } from "./suggest.js";
import { trackWork } from "./suggest-async.js";
import type { SheetRowValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import { blankRow, withCell } from "./local-rows.js";

/** One copilot request — a run after a delay, or a result to deliver once the rows have rendered. */
export interface SuggestRequest {
    seq: number;
    rowId: string;
    ms: number;
    ready?: Suggestions;
}

/**
 * Runs the copilot for a row, once the rows have rendered (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @returns What asks the copilot to run
 */
export function useSheetCopilot(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine) {
    const {
        ahead, allColumns, columns, copilotOn, driverColumn, fillColumns, inflight, proposers, suggestMemo,
    } = sheetDecode;
    const { rows } = sheetSession;
    const { rowAt, rowOf, wireContextOf } = sheetBody;
    const { ctxRef, dispatch, uiRef } = sheetMachine;
    // ── The copilot runner (§6.2) ─────────────────────────────────────────
    const [suggestReq, setSuggestReq] = useState<SuggestRequest | null>(null);
    const requestRun = useCallback((rowId: string, ms: number) => {
        setSuggestReq((p) => ({ seq: (p?.seq ?? 0) + 1, rowId, ms }));
    }, []);
    const requestReady = useCallback((rowId: string, ready: Suggestions) => {
        setSuggestReq((p) => ({ seq: (p?.seq ?? 0) + 1, rowId, ms: 0, ready }));
    }, []);
    /** Run the providers for an anchor — against the row as it would be if the open editor committed. */
    const runFor = (rowId: string) => {
        if (!copilotOn) return;
        const r = rowOf(rowId);
        const item = r !== undefined ? rowAt(r) : undefined;
        if (r === undefined || item === undefined || (item.kind !== "real" && item.kind !== "blank")) return;
        const current = uiRef.current;
        let row: SheetRowValue = item.kind === "real" ? item.row : blankRow("", allColumns.list);
        let skipKey: string | undefined;
        if (current.edit !== null && current.edit.r === r) {
            const cell = provisionalCell(current.edit, ctxRef.current);
            if (cell === undefined) return;   // unrecognised — nothing to run against
            const meta = columns.list[current.edit.c];
            if (meta !== undefined) {
                row = withCell(row, meta.key, cell ?? NULL_CELL);
                skipKey = meta.key;
            }
        }
        if (rowIsBlank(row, allColumns)) {
            dispatch({ t: "suggest.ready", anchorId: rowId, sugg: null });
            return;
        }
        // A line runs against its group (#740): the bridge puts the line in place by its key, so the resident groups pass as they are.
        const lg = item.group;
        const residentIndex = item.kind === "real" ? item.residentIndex : rows.length;
        const rowsNow = lg !== undefined ? rows : item.kind === "real" ? rows.map((x, i) => (i === residentIndex ? row : x)) : [...rows, row];
        const below = rowAt(r + 1);
        const nextBusy = below !== undefined && below.kind === "real" && !rowIsBlank(below.row, allColumns);
        const outcome = runSuggest({
            anchorId: rowId, row, skipKey, columns: fillColumns, proposers, ahead, nextBusy,
            driverKey: driverKeyOf(row, driverColumn), driverColumn, rejected: current.rejected,
            contextOf: (rw) => wireContextOf(rw, residentIndex, item.position, rowsNow, lg),
            memo: suggestMemo.current,
        });
        const gen = inflight.current.begin();
        dispatch({ t: "suggest.ready", anchorId: rowId, sugg: outcome.sugg });
        for (const work of outcome.async) {
            trackWork(inflight.current, gen, work, (key, result) => {
                dispatch(result.kind === "fill"
                    ? { t: "suggest.landed", anchorId: rowId, key, fill: result.fill }
                    : { t: "suggest.landed", anchorId: rowId, key, rows: result.rows });
            });
        }
    };
    const runForRef = useRef(runFor);
    runForRef.current = runFor;
    useEffect(() => {
        if (suggestReq === null) return;
        if (suggestReq.ready !== undefined) {
            dispatch({ t: "suggest.ready", anchorId: suggestReq.rowId, sugg: suggestReq.ready });
            return;
        }
        const timer = setTimeout(() => runForRef.current(suggestReq.rowId), suggestReq.ms);
        return () => clearTimeout(timer);
    }, [suggestReq, dispatch]);
    useEffect(() => {
        const registry = inflight.current;
        return () => registry.cancel();
    }, [inflight]);
    return { requestReady, requestRun };
}

/** What {@link useSheetCopilot} gives the parts after it. */
export type SheetCopilot = ReturnType<typeof useSheetCopilot>;
