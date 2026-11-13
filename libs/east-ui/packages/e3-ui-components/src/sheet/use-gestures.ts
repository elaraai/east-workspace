/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The gestures that wait for an open editor to commit: a step of the history, a draft's discard and an insertion, and
 * where the ring lands once the body holds a row a gesture made.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import type { HistoryAction } from "@elaraai/east-ui-components";
import { lineId } from "./model.js";
import type { Origin } from "./transactions.js";
import { anchorAt, insertionGesture, type InsertRequest, type InsertionAnchor } from "./insertion-gesture.js";
import type { SheetSeeds } from "./use-editing.js";
import { discardDraft } from "./draft-state.js";
import type { SheetHost } from "./parts.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetWrites } from "./use-writes.js";
import type { SheetEffects } from "./use-effects.js";
import { mintLineKey } from "./local-rows.js";

/** Where a gesture's new entry comes from when it is not the sheet's own: a dropped template's seeds, and its origin (#1187). */
export interface SheetInsertFrom {
    seeds: SheetSeeds;
    origin: Origin;
}

/**
 * Takes a history step, a discard or an insertion once any open editor has committed (see the module docs).
 *
 * @param host - What the frame hands the parts
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetWrites - The cell writes, the removal and the proposals' inserts
 * @param sheetEffects - The effect runner and what its effects reach
 * @returns The history's runner, the discard and the insertion
 */
export function useSheetGestures(host: SheetHost, sheetDecode: SheetDecode, sheetSession: SheetSession,
    sheetBody: SheetBody, sheetMachine: SheetMachine, sheetWrites: SheetWrites, sheetEffects: SheetEffects) {
    const {
        canInsertGroups, canInsertRows, columns, declaredNoun, driverColumn, group, keyed, loose,
    } = sheetDecode;
    const {
        canEdit, childField, dispatchStore, draftType, editingState, locked, mintAmong, recordGesture, rows, runLayout, session,
        store, takenKeys, ui,
    } = sheetSession;
    const { endPosition, rowAt, rowOf, rowSpace } = sheetBody;
    const { ctxRef, dispatch, uiRef } = sheetMachine;
    const { failed } = sheetWrites;
    const { cardRef, runEffects, setScrollTarget } = sheetEffects;
    const pendingHistoryAction = useRef<HistoryAction | undefined>(undefined);
    // A run's highlight ends with Undo, Apply and Discard; a Redo of its step replays its landing (R9, R16) — heard
    // first, by the parts of the run (`use-assembled.tsx`), through a ref: they are built once the rows and their words are.
    const actedRef = useRef<(action: HistoryAction, redoOrigin: string | undefined) => void>(() => undefined);
    // The host hears each step (#1533), through a ref: the history's one runner stays as it is.
    const onHistoryRef = useRef(host.onHistory);
    onHistoryRef.current = host.onHistory;
    const executeHistory = useCallback((action: HistoryAction) => {
        actedRef.current(action, session.nextRedo?.origin);
        // The footer's message said what the last gesture did: a step of the history moves past it (F13 of the hand test).
        if (action !== "refresh") dispatchStore({ t: "patch", patch: { msg: null } });
        // Told before the step, as the session stands; what it answers once the step is taken.
        const after = action === "refresh" ? undefined : onHistoryRef.current?.(action, session);
        if (action === "apply") void session.apply().then(after);
        else if (action === "refresh") session.refresh();
        else {
            session[action]();
            after?.();
        }
    }, [session, dispatchStore]);
    const onHistoryAction = useCallback((action: HistoryAction) => {
        // The lock (R2): no history action while a run's call is out — its item says so, and the keys are ignored.
        if (locked) return;
        if (uiRef.current.edit !== null && action !== "refresh") {
            pendingHistoryAction.current = action;
            dispatch({ t: "editor.blur" });
        } else executeHistory(action);
    }, [dispatch, executeHistory, locked, uiRef]);
    useLayoutEffect(() => {
        const action = pendingHistoryAction.current;
        if (action === undefined) return;
        pendingHistoryAction.current = undefined;
        if (ui.edit === null) executeHistory(action);
    }, [ui.edit, store.fxSeq, executeHistory]);

    const pendingDiscard = useRef<{ id: string; child: string | undefined } | undefined>(undefined);
    const executeDiscard = useCallback((id: string, child?: string) => {
        if (!canEdit) return;
        if (discardDraft(session, draftType, childField, id, child)) {
            dispatchStore({ t: "patch", patch: { sugg: null, msg: { id: "discarded" } } });
            cardRef.current?.focus({ preventScroll: true });
        }
    }, [session, draftType, childField, canEdit, cardRef, dispatchStore]);
    const onDiscardDraft = useCallback((id: string, child?: string) => {
        const open = uiRef.current.edit;
        if (open !== null) {
            const item = rowAt(open.r);
            const target = item?.kind === "group" ? child === undefined && item.row.id === id
                : item?.kind === "real" && (item.group !== undefined
                    ? item.group.row.id === id && (child === undefined || item.group.key === child)
                    : child === undefined && item.row.id === id);
            if (!target) {
                // Finish another row's editor before changing the row space.
                pendingDiscard.current = { id, child };
                dispatch({ t: "editor.blur" });
                return;
            }
            // A discarded draft includes its uncommitted editor buffer.
            dispatch({ t: "editor.key", key: "Escape", shift: false, meta: false, alt: false, atEnd: true });
        }
        executeDiscard(id, child);
    }, [rowAt, dispatch, executeDiscard, uiRef]);
    // The rows' one discard: stable, so no row's memo sees it change (#858).
    const discardRef = useRef(onDiscardDraft);
    discardRef.current = onDiscardDraft;
    const onRowDiscard = useCallback((id: string, child?: string) => discardRef.current(id, child), []);
    useLayoutEffect(() => {
        const target = pendingDiscard.current;
        if (target === undefined || ui.edit !== null) return;
        pendingDiscard.current = undefined;
        executeDiscard(target.id, target.child);
    }, [ui.edit, store.fxSeq, executeDiscard]);

    // Insertion retains identities while an open editor commits, then resolves
    // the destination against the latest local collection.
    const pendingInsertion = useRef<{ request: InsertRequest; from?: SheetInsertFrom | undefined; key?: string | undefined } | undefined>(undefined);
    /**
     * The row a gesture made, set or moved, once the body holds it: its
     * editor opens on an insert of the sheet's own — or, where a host names
     * the column (#1533), the ring lands there, a cell that edits out of place
     * opening where the host edits it and any other its editor; after a drop
     * (#1187) it is selected — on the column a card set first, when the grid
     * shows it.
     */
    const pendingInsertFocus = useRef<{ id: string; child?: string; edit: boolean; key?: string | undefined } | undefined>(undefined);
    const anchorFor = useCallback((r: number, side: "before" | "after"): InsertionAnchor => anchorAt(rowAt(r), side), [rowAt]);
    /**
     * Inserts a row or a group where a request says, as one transaction —
     * seeded and labelled as a drop says, when it is one (#1187).
     *
     * @param request - What to insert, and where
     * @param from - A drop's seeds and origin
     * @param key - The column the ring lands on in the new row — a host's (#1533); the driver's, else the first editable, by default
     * @returns Whether the session recorded it
     */
    const executeInsertion = useCallback((request: InsertRequest, from?: SheetInsertFrom, key?: string): boolean => {
        if (!canEdit || !editingState.available || (request.kind === "row" ? !canInsertRows : !canInsertGroups)) return false;
        // A new entry whose key is refused, or a gesture the session cannot take, inserts nothing: the footer says why (#1536).
        try {
            const gesture = insertionGesture(request, rows, (i) => runLayout.positions[i] ?? endPosition, group !== undefined, keyed,
                () => mintAmong(takenKeys()), mintLineKey, loose);
            if (gesture === undefined) return false;
            const recorded = recordGesture([gesture.event], gesture.placement === undefined ? undefined : new Map([[gesture.id, gesture.placement]]), from?.origin ?? "insert", undefined, from?.seeds);
            if (!recorded) return false;
            pendingInsertFocus.current = { id: gesture.id, ...(gesture.child === undefined ? {} : { child: gesture.child }), edit: from === undefined, key };
        } catch (error) {
            failed(error);
            return false;
        }
        // A drop is announced by the drag layer: the footer says nothing more.
        dispatchStore({ t: "patch", patch: { sugg: null, selEnd: null, ...(from !== undefined ? {} : { msg: request.kind === "group" ? { id: "newGroup", noun: declaredNoun?.singular } : { id: "newRow" } }) } });
        return true;
    }, [canEdit, editingState.available, canInsertRows, canInsertGroups, rows, runLayout, endPosition, group, loose, declaredNoun, keyed, takenKeys, mintAmong, failed, recordGesture, dispatchStore]);
    /** An insertion — once an open editor has committed. */
    const insertWhenClosed = useCallback((request: InsertRequest, from?: SheetInsertFrom, key?: string): boolean => {
        if (uiRef.current.edit === null) return executeInsertion(request, from, key);
        pendingInsertion.current = { request, from, key };
        dispatch({ t: "editor.blur" });
        return true;
    }, [dispatch, executeInsertion, uiRef]);
    const onInsert = useCallback((kind: "row" | "group", r: number, side: "before" | "after") => {
        insertWhenClosed({ kind, anchor: anchorFor(r, side) });
    }, [anchorFor, insertWhenClosed]);
    useLayoutEffect(() => {
        if (ui.edit !== null || pendingInsertion.current === undefined) return;
        const { request, from, key } = pendingInsertion.current;
        pendingInsertion.current = undefined;
        executeInsertion(request, from, key);
    }, [ui.edit, store.fxSeq, executeInsertion]);
    useLayoutEffect(() => {
        const target = pendingInsertFocus.current;
        if (target === undefined) return;
        const id = target.child === undefined ? target.id : lineId(target.id, target.child);
        const r = rowOf(id);
        if (r === undefined) {
            const parentR = rowOf(target.id);
            if (target.child !== undefined && parentR !== undefined && rowAt(parentR)?.kind === "group") {
                const parent = rowAt(parentR);
                if (parent?.kind === "group" && parent.folded) dispatch({ t: "fold.toggle", r: parentR });
            }
            return;
        }
        pendingInsertFocus.current = undefined;
        const item = rowAt(r);
        // The view on the row, whatever the ring does: a row put where the ring stood — the ring keeps its place as the
        // sheet's own rows move under it — leaves the ring no move to make, and so no scroll of its own to ask for. A
        // fresh request, for the last may have named the index the row now holds.
        const bi = rowSpace.bodyIndexOf[r];
        if (bi !== undefined) setScrollTarget({ index: bi, align: "auto" }, true);
        if (!target.edit) {
            // A drop's row, selected: on the column a card set first, else where the ring was.
            const keyC = target.key === undefined ? -1 : columns.list.findIndex(col => col.key === target.key);
            dispatch({ t: "select.move", r, c: item?.kind === "group" ? 0 : keyC >= 0 ? keyC : uiRef.current.sel.c });
            return;
        }
        if (item?.kind === "group" && item.folded) dispatch({ t: "fold.toggle", r });
        const keyC = target.key === undefined || item?.kind === "group" ? -1 : columns.list.findIndex(col => col.key === target.key);
        if (keyC >= 0) {
            // A host's column (#1533): the ring on it — and a cell that edits out of place opens where the host edits it,
            // as a press on it does.
            if (ctxRef.current.opensAt?.(r, keyC) === true) {
                dispatch({ t: "select.move", r, c: keyC });
                // The press's own effects, run here: a press dispatched in this commit too would leave the store its
                // effects alone, the move's lost.
                runEffects([{ t: "focus.sheet" }, { t: "open", r, c: keyC }]);
                return;
            }
            // Else its editor opens in the cell, as the sheet's own insert's does — the move after it then moving nothing
            // — or, where the cell takes no editor, the move lands the ring on it.
            dispatch({ t: "cell.dbl", r, c: keyC });
            dispatch({ t: "select.move", r, c: keyC });
            return;
        }
        const driverC = columns.list.findIndex(col => col.editable && col.key === driverColumn);
        const c = item?.kind === "group" ? 0 : driverC >= 0 ? driverC : Math.max(0, columns.list.findIndex(col => col.editable));
        dispatch({ t: "cell.dbl", r, c });
    }, [rows, rowOf, rowAt, columns, driverColumn, dispatch, ctxRef, uiRef, rowSpace, setScrollTarget, runEffects]);
    return { actedRef, anchorFor, insertWhenClosed, onHistoryAction, onInsert, onRowDiscard, pendingInsertFocus };
}

/** What {@link useSheetGestures} gives the parts after it. */
export type SheetGestures = ReturnType<typeof useSheetGestures>;
