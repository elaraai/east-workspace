/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pointer and the keyboard: the ring following a host's controlled selection, a press, a drag and a hover on a cell,
 * the grid's keys — the history's, ⏎ on an action cell, a phone's paging of the columns, the machine's — and the clipboard.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, type MouseEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import { getSomeorUndefined, historyShortcut, takeKey } from "@elaraai/east-ui-components";
import { exportMatrix } from "./clipboard.js";
import { sheetReducer, selectionRect, type SheetEvent } from "./sheet-state.js";
import type { ActionCase } from "./actions/model.js";
import type { SheetActionHost } from "./actions/host.js";
import { pageWindow } from "./Pager.js";
import type { StripModel } from "./Strip.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetEffects } from "./use-effects.js";
import type { SheetGestures } from "./use-gestures.js";

/** The action cells' calls as the sheet stands (#1475): made afresh each render, read through a ref by the one host. */
export interface SheetActionApi extends Omit<SheetActionHost, "subscribe" | "version"> {
    /** ⏎ on an action cell (K2). */
    enter: (r: number, key: string) => void;
    /** Take a case with its value at a cell — on a range down its column, every row of it (T8) — as one transaction (T1); `false` where a row may not take it. */
    take: (r: number, key: string, c: ActionCase, value: unknown) => boolean;
    /** Take a case with its value on rows, as one transaction. */
    takeOn: (rs: readonly number[], key: string, c: ActionCase, value: unknown) => boolean;
    /** The strip over an action (R2, R3), where it shows one. */
    strip: () => StripModel | undefined;
    /** What taking a case with a value would write, worded (F8). */
    consequence: (c: ActionCase, value: unknown) => string;
    /** Close the overlay (K6). */
    close: () => void;
    /** What taking a case with a value at a row would write, worded. */
    consequenceAt: (r: number, key: string, c: ActionCase, value: unknown) => string;
    /** What a case's form opens with at a row (F10). */
    initial: (r: number, key: string, c: ActionCase) => unknown;
}

/**
 * Turns the pointer, the keys and the clipboard into the machine's events (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetEffects - The effect runner and what its effects reach
 * @param sheetGestures - The history's runner, the discard and the insertion
 * @returns The cells' and the grid's handlers
 */
export function useSheetInput(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine, sheetEffects: SheetEffects, sheetGestures: SheetGestures) {
    const { columns, pagerColumns, phoneColumns, phoneFrame, selection, slotPx, words } = sheetDecode;
    const { dispatchStore, setBarClosedAt, store } = sheetSession;
    const { body, cellAt, rowAt, rowSpace } = sheetBody;
    const { clearJump, ctxRef, dispatch, uiRef, viewportRef } = sheetMachine;
    const { jumpBy, ringMoves, seekIntent } = sheetEffects;
    const { onHistoryAction, onInsert } = sheetGestures;
    // ── Controlled selection (§3.14) ──────────────────────────────────────
    const controlledRowId = selection !== undefined ? getSomeorUndefined(selection.rowId) : undefined;
    const controlledLine = selection !== undefined ? getSomeorUndefined(selection.line) : undefined;
    const controlledKey = selection !== undefined ? getSomeorUndefined(selection.key) : undefined;
    const controlledR = useMemo(() => {
        if (controlledRowId === undefined) return undefined;
        const bi = body.findIndex((it) =>
            it.kind === "real"
                ? (it.group !== undefined ? it.group.row.id === controlledRowId && it.group.key === controlledLine : it.row.id === controlledRowId)
                : it.kind === "group" && it.row.id === controlledRowId && controlledLine === undefined);
        return bi >= 0 ? rowSpace.rowOf[bi] : undefined;
    }, [controlledRowId, controlledLine, body, rowSpace]);
    const controlledC = useMemo(
        () => (controlledKey === undefined ? undefined : columns.list.findIndex((c) => c.key === controlledKey)),
        [controlledKey, columns],
    );
    useEffect(() => {
        if (selection === undefined) return;
        if (controlledR === undefined && (controlledC === undefined || controlledC < 0)) return;
        const current = uiRef.current.sel;
        dispatch({ t: "select.set", r: controlledR ?? current.r, c: controlledC !== undefined && controlledC >= 0 ? controlledC : current.c });
    }, [selection, controlledR, controlledC, dispatch, uiRef]);

    // The action cells' calls as the sheet stands (#1475): ⏎ on an action cell asks them, and the action column makes them.
    const actionApi = useRef<SheetActionApi | undefined>(undefined);

    // ── Input ─────────────────────────────────────────────────────────────
    // A range drag is a press followed by pointer MOVEMENT; a mouseenter with
    // no movement (the sheet moved under a stationary pointer — a paged
    // window landing, a fill changing a row) never extends the range. The
    // drag is over as its button lifts, and as much when its lift is never
    // heard — let go off the window, or under another app: a move with the
    // button no longer held ends it, and so does the window losing the page,
    // so no range is left following a pointer that holds nothing (the rule
    // every gesture is held to, east-ui-components' `src/pointer/`).
    const pressed = useRef(false);
    const dragging = useRef(false);
    useEffect(() => {
        const up = () => { pressed.current = false; dragging.current = false; };
        const move = (e: globalThis.MouseEvent) => {
            if ((e.buttons & 1) === 0) up();
            else if (pressed.current) dragging.current = true;
        };
        window.addEventListener("mouseup", up);
        window.addEventListener("mousemove", move);
        window.addEventListener("blur", up);
        return () => {
            window.removeEventListener("mouseup", up);
            window.removeEventListener("mousemove", move);
            window.removeEventListener("blur", up);
        };
    }, []);
    /**
     * A gesture on the ring (#860): counted — a key's move past the rows read lands only if none came after it — and,
     * when it is no such move itself, it abandons one still on its way at once, the rows that move holds put back as
     * they were (#1398, CL10): a window landing after the gesture never draws its rows over the place the viewer is at.
     */
    const ringGesture = useCallback((seeks = false) => {
        ringMoves.current += 1;
        if (seeks || seekIntent.current === undefined || jumpBy.current !== "key") return;
        seekIntent.current = undefined;
        clearJump();
    }, [clearJump, jumpBy, ringMoves, seekIntent]);
    const onCellDown = useCallback((r: number, c: number, e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        pressed.current = !e.shiftKey;
        dragging.current = false;
        ringGesture();
        // A press opens a phone's action bar again, wherever it was closed (SH9).
        setBarClosedAt(undefined);
        dispatch({ t: "cell.down", r, c, shift: e.shiftKey });
    }, [dispatch, ringGesture, setBarClosedAt]);
    const onCellDouble = useCallback((r: number, c: number) => { ringGesture(); dispatch({ t: "cell.dbl", r, c }); }, [dispatch, ringGesture]);
    const onCellEnter = useCallback((r: number, c: number) => dispatch({ t: "cell.enter", r, c, dragging: dragging.current }), [dispatch]);
    // The pointer leaving a host's grid (#1531): no cell is hovered, and its strip returns to the ring's cell.
    const onGridLeave = useCallback(() => dispatch({ t: "cell.leave" }), [dispatch]);
    const onRowPick = useCallback((r: number, e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        ringGesture();
        dispatch({ t: "row.pick", r, shift: e.shiftKey });
    }, [dispatch, ringGesture]);
    const onTake = useCallback((key: string) => dispatch({ t: "fill.take", key }), [dispatch]);
    const onFillRow = useCallback(() => dispatch({ t: "fill.row" }), [dispatch]);
    const onProposalPick = useCallback((i: number) => dispatch({ t: "proposal.pick", i }), [dispatch]);
    const onProposalAccept = useCallback((i: number) => dispatch({ t: "proposal.take", i }), [dispatch]);
    const onProposalReject = useCallback((i: number) => dispatch({ t: "proposal.reject", i }), [dispatch]);
    // Every key the grid acts on goes no further than the Sheet (#1398): a printable key that starts an edit — `[` among
    // them — never reaches a shortcut of the page around it.
    const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        if (e.altKey && e.key === "Insert") {
            takeKey(e); ringGesture(); onInsert("row", store.ui.sel.r, e.shiftKey ? "before" : "after"); return;
        }
        const meta = e.metaKey || e.ctrlKey;
        // The history keys every collection shares (#988).
        const historyKey = historyShortcut(e);
        if (historyKey !== undefined) {
            takeKey(e);
            ringGesture();
            onHistoryAction(historyKey);
            return;
        }
        // The browser's own clipboard keys become copy / paste events.
        if (meta && (e.key === "c" || e.key === "v" || e.key === "x" || e.key === "a")) return;
        // ⏎ on an action cell takes the offer's first case (K2): a button at once, a choice's Menu, a form's Popover.
        const single = store.ui.selEnd === null || (store.ui.selEnd.r === store.ui.sel.r && store.ui.selEnd.c === store.ui.sel.c);
        if (e.key === "Enter" && !e.shiftKey && !meta && !e.altKey && single && !store.ui.ringless) {
            const at = ctxRef.current.kindAt(store.ui.sel.r, store.ui.sel.c) === "action" ? columns.list[store.ui.sel.c] : undefined;
            if (at !== undefined) {
                takeKey(e);
                actionApi.current?.enter(store.ui.sel.r, at.key);
                return;
            }
        }
        // On a phone's frame ← and → page the columns while the grid has the focus, the ring where it is (SH8.1, R4).
        if (phoneFrame && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && !meta && !e.altKey) {
            takeKey(e);
            const frame = viewportRef.current?.frame;
            if (frame !== undefined && slotPx > 0) {
                const first = Math.round(frame.scrollLeft / slotPx);
                pageWindow(frame, slotPx, Math.max(0, pagerColumns.length - phoneColumns), first + (e.key === "ArrowRight" ? 1 : -1));
            }
            return;
        }
        const handled = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Tab", "Enter", "F2", "Escape", "Backspace", "Delete"];
        const printable = e.key.length === 1 && !meta && !e.altKey;
        const toSearch = meta && (e.key === "/" || e.key === "f");
        if (!handled.includes(e.key) && !printable && !toSearch) return;
        // A Tab the sheet has no use for — the ring on the row's last column
        // (⇧: its first), nothing pending — is the browser's (#860): focus
        // leaves the grid, which is never a keyboard trap. The reducer is
        // pure, so asking it is free.
        if (e.key === "Tab") {
            const probe = sheetReducer(uiRef.current, { t: "key", key: "Tab", shift: e.shiftKey, meta, alt: e.altKey }, ctxRef.current);
            if (probe.state === uiRef.current && probe.effects.length === 0) return;
        }
        takeKey(e);
        const event: SheetEvent = { t: "key", key: e.key, shift: e.shiftKey, meta, alt: e.altKey };
        // A key that goes past the rows read again takes a move still on its way over (#1398): asked of the pure reducer.
        const seeks = seekIntent.current !== undefined
            && sheetReducer(uiRef.current, event, ctxRef.current).effects.some((fx) => fx.t === "seek.step" || fx.t === "seek.edge");
        ringGesture(seeks);
        dispatch(event);
    }, [dispatch, store.ui.edit, store.ui.sel.r, store.ui.sel.c, store.ui.selEnd, store.ui.ringless, columns, onHistoryAction, onInsert, ringGesture, phoneFrame, slotPx, pagerColumns, phoneColumns, ctxRef, seekIntent, uiRef, viewportRef]);
    // A band never copies (G9): a whole-group selection copies its lines.
    const isBandRow = useCallback((r: number) => { const k = rowAt(r)?.kind; return k === "group"; }, [rowAt]);
    const onCopy = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
        // With no ring placed, nothing is selected to copy (#1531).
        if (store.ui.edit !== null || store.ui.ringless) return;
        e.preventDefault();
        const rect = selectionRect(store.ui);
        e.clipboardData.setData("text/plain", exportMatrix(cellAt, columns.list, rect, words, isBandRow));
        let copied = 0;
        for (let r = rect.r0; r <= rect.r1; r++) if (!isBandRow(r)) copied += 1;
        dispatchStore({ t: "patch", patch: { msg: { id: "copied", rows: copied, cols: rect.c1 - rect.c0 + 1 } } });
    }, [store.ui, cellAt, columns, isBandRow, words, dispatchStore]);
    const onPaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        const text = e.clipboardData.getData("text/plain");
        if (text === "") return;
        e.preventDefault();
        dispatch({ t: "clipboard.paste", text });
    }, [dispatch, store.ui.edit]);
    return {
        actionApi, onCellDouble, onCellDown, onCellEnter, onCopy, onFillRow, onGridLeave, onKeyDown, onPaste,
        onProposalAccept, onProposalPick, onProposalReject, onRowPick, onTake, ringGesture,
    };
}

/** What {@link useSheetInput} gives the parts after it. */
export type SheetInput = ReturnType<typeof useSheetInput>;
