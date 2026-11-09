/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The effect runner: what each of the machine's transitions leaves to the component — a write, a clear, a paste, a copy, a
 * removal, a focus, a scroll, a jump past the rows read — run once the store has its batch, each gesture one step of the
 * history.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { none, some, variant } from "@elaraai/east";
import { focusKeySearch, getSomeorUndefined } from "@elaraai/east-ui-components";
import { NULL_CELL, cellIsBlank, latencyOf, markOf, takesClear, type SheetBodyItem, type SheetColumnMeta } from "./model.js";
import type { SheetCellRefusalWord } from "./messages.js";
import { SHEET_PAGE_SIZE } from "./paging.js";
import { writeNarrowing, writeSheetViews } from "./view-state.js";
import { parseCell } from "./parse/index.js";
import { exportMatrix, layoutPaste, parseMatrix } from "./clipboard.js";
import { isBlankRowId, type SheetEffect } from "./sheet-state.js";
import type { SheetNotice } from "./sheet-types.js";
import { LATENCY_MS } from "./suggest.js";
import { editsOutOfPlace, stepsInPlace } from "./steps.js";
import type { EditorFocusRequest } from "./Editor.js";
import type { SheetSelectionValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { CellWrite, SheetWrites } from "./use-writes.js";
import type { SheetCopilot } from "./use-copilot.js";

/**
 * Runs the machine's effects (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetWrites - The cell writes, the removal and the proposals' inserts
 * @param sheetCopilot - What asks the copilot to run
 * @returns The runner, and the refs and requests its effects reach
 */
export function useSheetEffects(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine, sheetWrites: SheetWrites, sheetCopilot: SheetCopilot) {
    const {
        chrome, columns, copilotOn, declaredNoun, declaredViews, group, hostGrid, onSelectFn, onViewsChangeFn,
        setViewsState, triggers, viewsRef, words,
    } = sheetDecode;
    const { canEdit, dispatchStore, paging, recordGesture, store } = sheetSession;
    const { blankLineRowOf, cellAt, colCount, idAt, lensEnds, metaAt, parseCtxFor, rowAt, rowOf, rowSpace, writableAt } = sheetBody;
    const { dispatch, expectedNarrowing, jumpToElement, lensJumpTo } = sheetMachine;
    const { deleteRows, failed, gestureEvents, insertLooseProposals, insertProposal, writeCells } = sheetWrites;
    const { requestReady, requestRun } = sheetCopilot;
    // ── Effects ───────────────────────────────────────────────────────────
    const cardRef = useRef<HTMLDivElement | null>(null);
    // Where the toolbar's items are placed — the frame's toolbar: ⌘F looks
    // in it for the key search, else a search box.
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    /**
     * A key's move across an unloaded run (#860), waiting for its window: the
     * source element it is headed for, the window its jump pins, where the
     * ring lands — the first row at or past the element, the last at or
     * before it, or the last there that is not blank padding — the column,
     * and the viewer's gestures counted when the key came.
     */
    const seekIntent = useRef<{ element: number; window: number; land: "first" | "last" | "end"; c: number; moves: number } | undefined>(undefined);
    /** The viewer's gestures on the ring — keys, presses — counted: a key's move across an unloaded run lands only if none came after it (#860). */
    const ringMoves = useRef(0);
    /**
     * Who asked for the driver's pending jump (#860): a key's move across an
     * unloaded run, the key search, a remount's restore of its scroll, or the
     * hidden pick's go to the row it revealed. The driver holds one jump — a
     * key's move gives way to one it did not ask for, and the search drops
     * only its own.
     */
    const jumpBy = useRef<"key" | "search" | "anchor" | "reveal" | undefined>(undefined);
    // A keyboard move's reveal (#860): bumped with every `scroll.to`, and read once the frame has asked for its row.
    const [revealSeq, setRevealSeq] = useState(0);
    const [editorFocus, setEditorFocus] = useState<EditorFocusRequest>({ seq: 0, selectAll: true });
    /**
     * The body item a scroll brings into view, and how: the row the ring or a
     * search lands on by the least scroll, and a new narrowing's first item at
     * the top (#1349) — under the lens it may be a band taller than the view,
     * which the least scroll would show by its end. The frame serves a target
     * whose index moved; a `fresh` one (`nonce`) it serves though its index is
     * the last one's — a jump asked for again, a new row put in the place of
     * the row the last target named.
     */
    const [scrollTarget, setScrollTargetState] = useState<{ index: number; align: "auto" | "start"; nonce: number } | undefined>(undefined);
    const setScrollTarget = useCallback((target: { index: number; align: "auto" | "start" }, fresh = false) => {
        setScrollTargetState((was) => ({ ...target, nonce: (was?.nonce ?? 0) + (fresh ? 1 : 0) }));
    }, []);
    const runEffects = useCallback((effects: readonly SheetEffect[]) => {
        gestureEvents.current = [];
        /** The writes so far as one gesture: one step of the history. */
        const recordSoFar = () => {
            try { recordGesture(gestureEvents.current); }
            catch (error) { failed(error); }
            finally { gestureEvents.current = []; }
        };
        /** After a write: the ring follows an insert, a blank anchor's suggestions follow the new id, the copilot re-runs. */
        const afterWrite = (r: number, res: { firstInserted: number | undefined; ids: string[] }, rerun: boolean) => {
            const anchorBefore = idAt(r);
            if (res.firstInserted !== undefined) {
                // The blank row became real at the end of the sheet: the ring
                // follows it, keeping whatever move the commit made.
                const delta = store.ui.sel.r - r;
                dispatchStore({ t: "patch", patch: { sel: { r: res.firstInserted + delta, c: store.ui.sel.c }, selEnd: null } });
                if (anchorBefore !== undefined && isBlankRowId(anchorBefore) && res.ids[0] !== undefined) {
                    dispatch({ t: "suggest.rekey", from: anchorBefore, to: res.ids[0] });
                }
            }
            if (rerun && copilotOn && res.ids[0] !== undefined) requestRun(res.ids[0], 0);
        };
        /** Why a cell takes no edit: a mark's lock, in its words, else its column is read only. */
        const lockedAt = (r: number, meta: SheetColumnMeta): SheetCellRefusalWord => {
            const it = rowAt(r);
            const mark = markOf(meta, it?.kind === "real" || it?.kind === "group" ? it.row.cells : undefined);
            return mark?.lock === true ? { why: "locked", words: mark.words } : { why: "readOnly", header: meta.header };
        };
        for (const eff of effects) {
            switch (eff.t) {
                case "write": {
                    const meta = metaAt(eff.r, eff.c);
                    const cell = eff.cell ?? NULL_CELL;
                    if (meta === undefined) break;
                    // A cell locked since the editor opened takes no write, nor a blank a cell whose value is never empty,
                    // nor text no column reads a column from data, which keeps none: the footer says why.
                    const refused: SheetCellRefusalWord | undefined = !writableAt(eff.r, eff.c) ? lockedAt(eff.r, meta)
                        : cellIsBlank(cell) && !takesClear(meta) ? { why: "noClear", header: meta.header }
                            : cell.type === "Invalid" && getSomeorUndefined(meta.raw.from) !== undefined ? { why: "unread", header: meta.header, text: cell.value }
                                : undefined;
                    if (refused !== undefined) {
                        dispatchStore({ t: "patch", patch: { msg: { id: "editRefused", word: refused } } });
                        break;
                    }
                    const res = writeCells([{ r: eff.r, c: eff.c, cell }], "typed");
                    afterWrite(eff.r, res, triggers.size === 0 || triggers.has(meta.key));
                    break;
                }
                case "write.many": {
                    // A cell locked since the fill was proposed keeps its value (#1560).
                    const writes = eff.writes.filter((w) => writableAt(eff.r, w.c));
                    if (writes.length === 0) break;
                    const res = writeCells(writes.map((w) => ({ r: eff.r, c: w.c, cell: w.cell })), eff.source);
                    afterWrite(eff.r, res, true);
                    break;
                }
                case "gesture.end":
                    recordSoFar();
                    break;
                case "open": {
                    // A cell that edits out of place (#1531): the host opens it once this commit is drawn, as `onSelect` is told of a move.
                    const key = columns.list[eff.c]?.key;
                    const onOpen = hostGrid?.onOpen;
                    if (key !== undefined && onOpen !== undefined) queueMicrotask(() => onOpen(eff.r, key));
                    break;
                }
                case "insert.rows": {
                    let afterR = eff.anchorR;
                    let lastId: string | undefined;
                    const anchorItem = rowAt(eff.anchorR);
                    if (anchorItem !== undefined && anchorItem.kind === "real" && anchorItem.loose !== undefined) {
                        // Under a loose row (#846): new loose rows after it.
                        lastId = insertLooseProposals(eff.anchorR, eff.rows).at(-1);
                    } else {
                        for (const [i, p] of eff.rows.entries()) {
                            const landed = insertProposal(afterR, p.cells, group !== undefined ? i : 0);
                            if (landed === undefined) break;
                            lastId = landed.id;
                            if (group === undefined) afterR = landed.r;
                        }
                    }
                    if (lastId === undefined) break;
                    // Re-anchor on the row just taken: the rest are already waiting, else look forward again.
                    if (eff.rest.length > 0) requestReady(lastId, { anchorId: lastId, fill: new Map(), rows: eff.rest, pending: [] });
                    else if (copilotOn) requestRun(lastId, 0);
                    break;
                }
                case "clear": {
                    const writes: CellWrite[] = [];
                    // The cells it leaves as they were, and why the first was: the footer says so.
                    let kept = 0;
                    let refused: SheetCellRefusalWord | undefined;
                    // ⌫ on one cell alone (#1585): it says why it leaves that cell as it is, though the cell is blank.
                    const one = eff.r0 === eff.r1 && eff.c0 === eff.c1;
                    for (let r = eff.r0; r <= eff.r1; r++) {
                        for (let c = eff.c0; c <= eff.c1; c++) {
                            const meta = metaAt(r, c);
                            if (meta === undefined || !canEdit) continue;
                            const it = rowAt(r);
                            // Each cell a clear leaves as it is says why, as a paste does (#1585): an action cell, which only its
                            // actions change; a locked one, and one read only — a stamped one's among them; one that steps in place
                            // on an owned row, which takes no step there (T9); one that edits out of place, which is cleared where
                            // it edits, never in the grid (#1531); one whose value isn't an option.
                            const why: SheetCellRefusalWord | undefined = meta.kind === "action" ? { why: "action", header: meta.header }
                                : meta.kind === "stamped" || !writableAt(r, c) ? lockedAt(r, meta)
                                    : hostGrid !== undefined && stepsInPlace(meta) && (it?.kind === "real" || it?.kind === "group") && it.row.owned
                                        ? { why: "owned", header: meta.header }
                                        : editsOutOfPlace(meta, hostGrid) ? { why: "opens", header: meta.header }
                                            : !takesClear(meta) ? { why: "noClear", header: meta.header } : undefined;
                            // A blank has nothing to clear — but that one cell is told why all the same, unless only that it can't be empty.
                            if (cellIsBlank(cellAt(r, c)) && (!one || why === undefined || why.why === "noClear")) continue;
                            if (why !== undefined) {
                                kept += 1;
                                refused ??= why;
                                continue;
                            }
                            writes.push({ r, c, cell: NULL_CELL });
                        }
                    }
                    if (writes.length > 0) writeCells(writes, "typed");
                    if (refused !== undefined) dispatchStore({ t: "patch", patch: { msg: { id: "clearRefused", n: kept, cleared: writes.length, word: refused } } });
                    break;
                }
                case "delete.rows": {
                    if (!canEdit) break;
                    const out = deleteRows(eff.r0, eff.r1);
                    if (out.n === 0) break;
                    const msg: SheetNotice = {
                        id: "deleted", n: out.n, what: out.what, noun: declaredNoun?.singular, nouns: declaredNoun?.plural,
                        // The group is left empty: ⌫ again removes it.
                        again: out.emptiedBandR !== undefined,
                    };
                    if (out.emptiedBandR !== undefined) {
                        dispatchStore({ t: "patch", patch: {
                            sel: { r: out.emptiedBandR, c: 0 }, selEnd: { r: out.emptiedBandR, c: Math.max(0, colCount - 1) },
                            msg,
                        } });
                    } else {
                        dispatchStore({ t: "patch", patch: { msg } });
                    }
                    break;
                }
                case "copy": {
                    // A band never copies (G9): a whole-group selection copies its lines.
                    const text = exportMatrix(cellAt, columns.list, eff, words, (r) => { const k = rowAt(r)?.kind; return k === "group"; });
                    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
                        void navigator.clipboard.writeText(text).catch(() => {});
                    }
                    break;
                }
                case "paste": {
                    if (!canEdit) break;
                    const matrix = parseMatrix(eff.text);
                    if (matrix.length === 0) break;
                    const laid = layoutPaste(matrix, columns.list, eff.c);
                    const writes: CellWrite[] = [];
                    let skipped = 0;
                    // The action cells it passes by (T7): said apart, never as unrecognised (the hand test's F18).
                    let actions = 0;
                    // Why the first cell it skips is left as it was, where that is known: the footer says so.
                    let refused: SheetCellRefusalWord | undefined;
                    // On a grouped sheet a paste lands on the anchor's group — its lines from the ring, its blank line, then new lines past it — never across a band (G9).
                    const anchor = rowAt(eff.r);
                    const gid = group !== undefined && anchor !== undefined && (anchor.kind === "real" || anchor.kind === "blank") ? anchor.group?.row.id : undefined;
                    // On a loose row (#846): the loose rows from the ring down, then new loose rows after the last of them — never across a band.
                    const isLoose = (it: SheetBodyItem | undefined): boolean => it !== undefined && it.kind === "real" && it.loose !== undefined;
                    let looseEnd: number | undefined;
                    if (isLoose(anchor)) for (looseEnd = eff.r; isLoose(rowAt(looseEnd + 1)); looseEnd++);
                    if (group !== undefined && gid === undefined && looseEnd === undefined) break;
                    const blankR = gid !== undefined ? blankLineRowOf(gid) : looseEnd;
                    for (const p of laid.cells) {
                        const meta = columns.list[p.c];
                        if (meta === undefined) continue;
                        // An action cell takes no paste (T7); a cell that edits out of place takes it where it edits (#1531) —
                        // said so, or why it takes none there either (#1585).
                        if (meta.kind === "action") { actions += 1; continue; }
                        const r = eff.r + p.dr;
                        // A stamped or read-only column takes none, and is said as skipped, and why (#1585).
                        if (meta.kind === "stamped" || !meta.editable) { skipped += 1; refused ??= lockedAt(r, meta); continue; }
                        if (editsOutOfPlace(meta, hostGrid)) {
                            skipped += 1;
                            refused ??= writableAt(r, p.c) ? { why: "opens", header: meta.header } : lockedAt(r, meta);
                            continue;
                        }
                        const outcome = parseCell(meta, p.text, parseCtxFor(Math.min(r, blankR ?? r), meta));
                        const cell = outcome.kind === "unrecognised" ? variant("Invalid", p.text) : outcome.kind === "cell" ? outcome.cell : NULL_CELL;
                        // A blank lands only where the cell takes a clear, text no column reads only where it can stand —
                        // a column from data keeps none — and a cell it lands on in place only when it takes an edit, never
                        // one that steps in place on an owned row, which takes no step there (T9): each is said as skipped,
                        // and why.
                        const kept: SheetCellRefusalWord | undefined = cellIsBlank(cell) && !takesClear(meta) ? { why: "noClear", header: meta.header }
                            : outcome.kind === "unrecognised" && getSomeorUndefined(meta.raw.from) !== undefined ? { why: "unread", header: meta.header, text: p.text }
                                : undefined;
                        if (kept !== undefined) {
                            skipped += 1;
                            refused ??= kept;
                            continue;
                        }
                        const inPlace = { r, c: p.c, cell };
                        const it = rowAt(r);
                        const owned = hostGrid !== undefined && stepsInPlace(meta) && (it?.kind === "real" || it?.kind === "group") && it.row.owned;
                        const lands = writableAt(r, p.c) && !owned;
                        const why = (): SheetCellRefusalWord => (owned && writableAt(r, p.c) ? { why: "owned", header: meta.header } : lockedAt(r, meta));
                        if (looseEnd !== undefined) {
                            if (r > looseEnd) writes.push({ r: looseEnd, c: p.c, cell, extra: r - looseEnd });
                            else if (lands) writes.push(inPlace);
                            else { skipped += 1; refused ??= why(); }
                            continue;
                        }
                        if (gid !== undefined) {
                            const target = rowAt(r);
                            const inPlan = target !== undefined && (target.kind === "real" || target.kind === "blank") && target.group?.row.id === gid;
                            if (inPlan && (blankR === undefined || r <= blankR) && lands) writes.push(inPlace);
                            else if (blankR !== undefined && r > blankR) writes.push({ r: blankR, c: p.c, cell, extra: r - blankR });
                            else skipped += 1;
                            continue;
                        }
                        if (lands) writes.push(inPlace);
                        else { skipped += 1; refused ??= why(); }
                    }
                    // A paste whose new rows' keys are refused writes nothing, and the footer says why (#1536).
                    if (writes.length > 0 && writeCells(writes, "pasted").refused === true) break;
                    const wide = Math.max(1, laid.width);
                    dispatchStore({ t: "patch", patch: {
                        selEnd: { r: eff.r + matrix.length - 1, c: Math.min(colCount - 1, eff.c + wide - 1) },
                        msg: { id: "pasted", rows: matrix.length, cols: matrix[0]?.length ?? 0, skipped, actions, wrote: writes.length > 0, refused },
                    } });
                    break;
                }
                case "focus.sheet":
                    cardRef.current?.focus({ preventScroll: true });
                    break;
                case "focus.editor":
                    setEditorFocus((f) => ({ seq: f.seq + 1, selectAll: eff.selectAll }));
                    break;
                case "emit.select": {
                    if (onSelectFn === undefined) break;
                    const it = rowAt(eff.r);
                    const meta = metaAt(eff.r, eff.c);
                    const lg = it !== undefined && it.kind === "real" ? it.group : undefined;
                    const sel: SheetSelectionValue = {
                        rowId: it !== undefined && it.kind === "real" ? some(lg !== undefined ? lg.row.id : it.row.id) : it !== undefined && it.kind === "group" ? some(it.row.id) : none,
                        line: lg !== undefined ? some(lg.key) : none,
                        key: meta !== undefined ? some(meta.key) : none,
                    };
                    queueMicrotask(() => onSelectFn(sel));
                    break;
                }
                case "scroll.to": {
                    const bi = rowSpace.bodyIndexOf[eff.r];
                    if (bi !== undefined) setScrollTarget({ index: bi, align: "auto" });
                    setRevealSeq((n) => n + 1);
                    break;
                }
                case "seek.step":
                case "seek.edge": {
                    // Across an unloaded run (#860): the window beyond is fetched the
                    // way a key search jumps, and the ring lands once it is in (`use-jumps.ts`).
                    const step = eff.t === "seek.step";
                    if (lensEnds !== undefined) {
                        // Under the lens (#1349): into the stretch it has not read past the rows it draws — a step's or a
                        // page's the nearest that way, crossing in at its edge, as a grouped sheet's page does, for the
                        // lens's rows are no run of elements; an end's the narrowing's first or last — read where it is
                        // by the lens's jump, the rows shown drawn meanwhile, and the ring lands on its row once the lens
                        // has drawn it (`use-jumps.ts`).
                        const span = step ? (eff.dir > 0 ? lensEnds.after : lensEnds.before) : eff.edge === "first" ? lensEnds.first : lensEnds.last;
                        if (span === undefined) break;
                        const forward = step ? eff.dir > 0 : eff.edge === "first";
                        const element = forward ? span.from : span.to;
                        seekIntent.current = { element, window: element, land: forward ? "first" : step ? "last" : "end", c: eff.c, moves: ringMoves.current };
                        jumpBy.current = "key";
                        lensJumpTo(element);
                        break;
                    }
                    const edge = step
                        ? (eff.dir > 0 ? paging.tail?.from : paging.head?.to)
                        : eff.edge === "first" ? 0 : paging.total !== undefined && paging.total > 0 ? paging.total - 1 : undefined;
                    if (edge === undefined) break;
                    // A page (#1398, CL10): a page's rows on from the row it pages from — on a flat sheet each row an
                    // element, so the element a page on — into the run, and never past the source's ends; a grouped sheet's
                    // rows are not its elements, and its page crosses into the run at its edge.
                    const page = step ? eff.page : undefined;
                    const from = page === undefined || group !== undefined ? undefined : rowAt(page.from);
                    const paged = page === undefined || from === undefined || (from.kind !== "real" && from.kind !== "blank") ? undefined
                        : from.position + (eff.t === "seek.step" && eff.dir > 0 ? page.rows : -page.rows);
                    const last = paging.total !== undefined && paging.total > 0 ? paging.total - 1 : paging.tail?.to;
                    const element = paged === undefined ? edge
                        : step && eff.dir > 0 ? Math.min(last ?? paged, Math.max(edge, paged)) : Math.max(0, Math.min(edge, paged));
                    const land = step ? (eff.dir > 0 ? "first" : "last") : eff.edge === "first" ? "first" : "end";
                    seekIntent.current = { element, window: Math.floor(element / SHEET_PAGE_SIZE), land, c: eff.c, moves: ringMoves.current };
                    jumpBy.current = "key";
                    // Fetch, then move (#1398, CL10): the rows shown stand in, retained, the ring where it is, until the
                    // window it goes to is in — then the ring lands there in the commit that draws it (`use-jumps.ts`).
                    jumpToElement(element, true);
                    break;
                }
                case "select.id": {
                    // The body has re-formed (a fold-all): the ring re-finds its group's band by id.
                    const r = rowOf(eff.id);
                    if (r !== undefined) dispatch({ t: "select.set", r, c: eff.c });
                    break;
                }
                case "schedule.suggest": {
                    // The copilot runs against the row as it would be, after the kind's latency (B§3).
                    if (!copilotOn) break;
                    const edit = store.ui.edit;
                    if (edit === null) break;
                    const id = idAt(edit.r);
                    if (id === undefined) break;
                    const kind = metaAt(edit.r, edit.c)?.kind ?? "text";
                    requestRun(id, eff.latency === "instant" || latencyOf(kind) === "instant" ? LATENCY_MS.instant : LATENCY_MS.idle);
                    break;
                }
                case "emit.views": {
                    // The views land locally at once (the interactive-state pattern) and reach the host in a microtask.
                    const next = eff.views;
                    setViewsState({ over: declaredViews, views: next });
                    viewsRef.current = next;
                    queueMicrotask(() => writeSheetViews(next, onViewsChangeFn));
                    break;
                }
                case "slice.write": {
                    // The sheet's own write places the ring itself: the change detector must not move it.
                    // Every source takes its narrowing, as a view saved it (#1345).
                    expectedNarrowing.current = eff.state;
                    if (chrome !== undefined) writeNarrowing(chrome, eff.state);
                    break;
                }
                case "focus.search": {
                    // The key search, in either form — its box, or folded to its icon its popover (#1221); else the first box in the row.
                    if (focusKeySearch(toolbarRef.current)) break;
                    const input = toolbarRef.current?.querySelector<HTMLInputElement>("input");
                    input?.focus();
                    input?.select();
                    break;
                }
            }
        }
        recordSoFar();
    }, [recordGesture, failed, writeCells, deleteRows, insertProposal, insertLooseProposals, columns, group, declaredNoun, words, metaAt, blankLineRowOf, canEdit, cellAt, colCount, parseCtxFor, onSelectFn, rowAt, rowOf, rowSpace, store.ui.sel, store.ui.edit, writableAt, idAt, copilotOn, triggers, requestRun, requestReady, dispatch, declaredViews, onViewsChangeFn, chrome, paging.head, paging.tail, paging.total, jumpToElement, lensEnds, lensJumpTo, hostGrid, dispatchStore, expectedNarrowing, gestureEvents, setViewsState, viewsRef, setScrollTarget]);
    const drainedFx = useRef(0);
    useLayoutEffect(() => {
        if (store.fxSeq === drainedFx.current) return;
        drainedFx.current = store.fxSeq;
        runEffects(store.fx);
    }, [store.fxSeq, store.fx, runEffects]);
    return {
        cardRef, editorFocus, jumpBy, revealSeq, ringMoves, runEffects, scrollTarget, seekIntent, setScrollTarget,
        toolbarRef,
    };
}

/** What {@link useSheetEffects} gives the parts after it. */
export type SheetEffects = ReturnType<typeof useSheetEffects>;
