/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The action buttons: an action column's cells, its Menu and its form, a case taken on a row or down a range as one
 * transaction, the strip over an action, the inspector's action field, and a phone's bottom container — the ring's action
 * bar, or its cell editor.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { equalFor } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { NULL_CELL, TITLE_KEY, cellText, cellWritable, lineId, resolveMember as resolveRegisterMember, type SheetColumnMeta } from "./model.js";
import { selectionRect } from "./sheet-state.js";
import type { EntryVersion } from "./transactions.js";
import { editsOutOfPlace, stepsInPlace } from "./steps.js";
import { actionCell, actionColumnOf, canTake, caseOf, offerOf, verbOf, type ActionCase } from "./actions/model.js";
import { createActionStore, type SheetActionHost } from "./actions/host.js";
import { ActionForm, ActionMenu, type ActionOverlayState } from "./actions/ActionOverlay.js";
import { ActionPanel, type ActionPanelApi } from "./actions/ActionPanel.js";
import { ActionBar } from "./actions/ActionBar.js";
import type { DraftEdit } from "./use-editing.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";
import type { SheetHost } from "./parts.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { CellWrite, SheetWrites } from "./use-writes.js";
import type { SheetEffects } from "./use-effects.js";
import type { SheetInput } from "./use-input.js";

const cellEqual = equalFor(Sheet.Types.Cell);

/** The dwell before the strip previews the action the pointer rests on, and the grace before it lets it go (P8, N5). */
const PREVIEW_MS = 120;

/**
 * Builds the action column's host and what it opens (see the module docs).
 *
 * @param host - What the frame hands the parts
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetWrites - The cell writes, the removal and the proposals' inserts
 * @param sheetEffects - The effect runner and what its effects reach
 * @param sheetInput - The cells' and the grid's handlers
 * @returns The action host, its overlay, the phone's bar and cell editor
 */
export function useSheetActions(host: SheetHost, sheetDecode: SheetDecode, sheetSession: SheetSession,
    sheetBody: SheetBody, sheetMachine: SheetMachine, sheetWrites: SheetWrites, sheetEffects: SheetEffects,
    sheetInput: SheetInput) {
    const {
        allColumns, columns, framePx, gridId, group, hostGrid, phoneFrame, readOnly, registers, words,
    } = sheetDecode;
    const {
        barClosedAt, canEdit, dispatchStore, draftVersion, editingState, recordGesture, rows, session, setBarClosedAt,
        ui,
    } = sheetSession;
    const { idAt, metaAt, rowAt, rowOf, wireContextFor, writableAt } = sheetBody;
    const { dispatch } = sheetMachine;
    const { failed, gestureEvents, writeCells } = sheetWrites;
    const { cardRef } = sheetEffects;
    const { actionApi, ringGesture } = sheetInput;
    // ── The action column (#1475–#1477) ────────────────────────────────
    // Every row's action cells ask one host, held still for the sheet's life (#858); what they read is the sheet as it
    // stands (`actionApi`, made afresh each render), and its store tells them to look again as the rows, the drafts or
    // the overlay move — only they draw again. A taken action is one transaction (T1): its field's new case, the cells
    // its `updates` writes on the row and on its group's band, and the entry drawn again as the record would show it.
    const hasActions = useMemo(() => allColumns.list.some((col) => col.kind === "action"), [allColumns]);
    const actionStore = useMemo(createActionStore, []);
    // The overlay is held by its rows' ids, never their places: a window landing above them, or a row another session
    // adds, moves them, and a place would then name another row — the one a pick would take its case on. It is drawn
    // at their places as they stand, and closes once one of them is gone.
    const [heldOverlay, setHeldOverlay] = useState<{ overlay: ActionOverlayState; id: string; ids: readonly string[] } | undefined>(undefined);
    const setActionOverlay = (overlay: ActionOverlayState | undefined) => {
        if (overlay === undefined) { setHeldOverlay(undefined); return; }
        const id = idAt(overlay.r);
        const ids = overlay.rs.flatMap((r) => { const at = idAt(r); return at === undefined ? [] : [at]; });
        if (id !== undefined && ids.length === overlay.rs.length) setHeldOverlay({ overlay, id, ids });
    };
    const actionOverlay = useMemo((): ActionOverlayState | undefined => {
        if (heldOverlay === undefined) return undefined;
        const { overlay } = heldOverlay;
        const r = rowOf(heldOverlay.id);
        const rs = heldOverlay.ids.flatMap((id) => { const at = rowOf(id); return at === undefined ? [] : [at]; });
        if (r === undefined || rs.length !== heldOverlay.ids.length) return undefined;
        return r === overlay.r && rs.every((at, i) => at === overlay.rs[i]) ? overlay : { ...overlay, r, rs };
    }, [heldOverlay, rowOf]);
    // The action the pointer rests on, previewed in the strip (P8), and the dwell before it shows or goes.
    const [actionPreview, setActionPreview] = useState<{ r: number; key: string; c: ActionCase } | undefined>(undefined);
    const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => { if (previewTimer.current !== undefined) clearTimeout(previewTimer.current); }, []);
    const actionHost = useMemo<SheetActionHost>(() => ({
        subscribe: actionStore.subscribe,
        version: actionStore.version,
        offer: (r, key) => actionApi.current?.offer(r, key),
        controls: (r, key) => actionApi.current?.controls(r, key) ?? false,
        startable: (r, key) => actionApi.current?.startable(r, key) ?? false,
        held: (r, key) => actionApi.current?.held(r, key),
        dirty: (r, key) => actionApi.current?.dirty(r, key) ?? false,
        next: (r, key, c, anchor) => actionApi.current?.next(r, key, c, anchor),
        more: (r, key, anchor) => actionApi.current?.more(r, key, anchor),
        preview: (r, key, c) => actionApi.current?.preview(r, key, c),
    }), [actionStore, actionApi]);
    /** The action cell at a row: its row, its column and its machine — a line's or a flat row's, never a band's or a blank's. */
    const actionAt = (r: number, key: string) => {
        const it = rowAt(r);
        const meta = allColumns.byKey.get(key);
        const column = actionColumnOf(meta);
        if (it === undefined || it.kind !== "real" || meta === undefined || column === undefined) return undefined;
        return { it, meta, column, cell: it.row.cells.get(key), lg: it.group };
    };
    /** A rule cell's text on a row (an action column's summary, name or title), if it holds one. */
    const ruleText = (row: SheetRowValue, key: string | undefined): string | undefined => {
        const cell = key === undefined ? undefined : row.cells.get(key);
        return cell?.type === "String" && cell.value !== "" ? cell.value : undefined;
    };
    /** What a case's `updates` would write, as facts (R5): each cell it changes, `{header} {value}`, the row's then the band's. */
    const actionFacts = (r: number, key: string, c: ActionCase, bytes: Uint8Array): { updates: ReturnType<NonNullable<ActionCase["updates"]>> | undefined; facts: string[] } => {
        const updates = c.updates?.(bytes, wireContextFor(r), new Date());
        const facts: string[] = [];
        const a = actionAt(r, key);
        // A value in words: a register member by its label, anything else as its column prints it.
        const said = (cell: SheetCellValue, meta: SheetColumnMeta): string => {
            const member = meta.register !== undefined && cell.type === "String" ? resolveRegisterMember(registers, meta.register, cell.value) : undefined;
            return member !== undefined && member.label !== "" ? member.label : cellText(cell, meta, words);
        };
        // The row's cells in the columns' order (R5), then the band's, named by the group: `WO-1042 On hold`.
        for (const meta of allColumns.list) {
            const cell = updates?.row.get(meta.key);
            if (cell === undefined || (a !== undefined && cellEqual(a.it.row.cells.get(meta.key) ?? NULL_CELL, cell))) continue;
            facts.push(`${meta.header} ${said(cell, meta)}`);
        }
        const groupName = a?.lg !== undefined ? a.lg.row.id : undefined;
        for (const [k, cell] of updates?.group ?? []) {
            const meta = group?.cells.get(k);
            if (meta === undefined || (a?.lg !== undefined && cellEqual(a.lg.row.cells.get(k) ?? NULL_CELL, cell))) continue;
            facts.push(`${groupName ?? meta.header} ${said(cell, meta)}`);
        }
        return { updates, facts };
    };
    const projectEntry = editingState.project;
    /**
     * Take a case with its value on rows, as one transaction (T1, T8): on each, its field's new case, the cells its
     * `updates` writes on the row and on its group's band, and its entry drawn again as the record would show its draft.
     * Every row must be offered the case now, or nothing is taken.
     */
    const takeAction = (rs: readonly number[], key: string, c: ActionCase, value: unknown): boolean => {
        if (!canEdit || !editingState.available || rs.length === 0) return false;
        const at = rs.map((r) => ({ r, a: actionAt(r, key) }));
        if (at.some(({ r, a }) => {
            if (a === undefined) return true;
            const offer = offerOf(a.column, a.cell, wireContextFor(r));
            return !canTake(offer) || !offer.offered.some((o) => o.name === c.name);
        })) return false;
        const writes: CellWrite[] = [];
        const edits = new Map<string, DraftEdit>();
        const facts: string[] = [];
        let bytes: Uint8Array;
        try {
            bytes = c.encode(value);
            for (const { r, a } of at) {
                const taken = actionFacts(r, key, c, bytes);
                if (rs.length === 1) for (const fact of taken.facts) facts.push(fact);
                writes.push({ r, c: -1, key, cell: actionCell(c, bytes) });
                for (const [k, cell] of taken.updates?.row ?? []) writes.push({ r, c: -1, key: k, cell });
                const bandR = a!.lg !== undefined ? rowOf(a!.lg.row.id) : undefined;
                if (bandR !== undefined) for (const [k, cell] of taken.updates?.group ?? []) writes.push({ r: bandR, c: -1, key: k, cell, force: true });
                const entry = a!.lg !== undefined ? a!.lg.row.id : a!.it.row.id;
                // The entry drawn again as the record would show its draft: its summary and every rule cell read the new case.
                edits.set(entry, (version: EntryVersion): EntryVersion => {
                    const projected = projectEntry(entry, version.draft, version.wire);
                    if (projected === undefined || version.wire === undefined) return version;
                    const keys = version.wire.lines;
                    return { ...version, wire: { ...projected, id: version.wire.id, lines: projected.lines.map((line, i) => ({ ...line, key: keys[i]?.key ?? line.key })) } };
                });
            }
        } catch (error) {
            console.error(`[Sheet] the action "${c.name}" failed on column "${key}":`, error);
            dispatchStore({ t: "patch", patch: { msg: { id: "text", text: words.m.actionFailed({ verb: c.label, reason: error instanceof Error ? error.message : String(error) }) } } });
            return false;
        }
        gestureEvents.current = [];
        let recorded = false;
        try {
            writeCells(writes, "typed");
            recorded = recordGesture(gestureEvents.current, undefined, "action", edits, undefined, c.label);
        } catch (error) {
            failed(error);
        } finally {
            gestureEvents.current = [];
        }
        if (!recorded) return false;
        // What the strip previewed is taken: the ring's cell says itself again (P8).
        if (previewTimer.current !== undefined) { clearTimeout(previewTimer.current); previewTimer.current = undefined; }
        setActionPreview(undefined);
        const first = at[0]!.a!;
        const name = rs.length === 1 ? ruleText(first.it.row, first.column.name) : words.m.inspectorSeveral({ n: rs.length, count: words.number(rs.length), lines: group !== undefined });
        dispatchStore({ t: "patch", patch: { msg: { id: "text", text: words.m.noticeActionTaken({ state: c.state, name, n: facts.length, count: words.number(facts.length), facts }) } } });
        return true;
    };
    /**
     * The rows an action at a cell is taken on (T8): a range down the action column, every one of its rows an action
     * row; else the cell's own row.
     */
    const actionRows = (r: number, key: string): number[] => {
        const ci = columns.list.findIndex((col) => col.key === key);
        const rect = selectionRect(ui);
        if (ui.selEnd === null || rect.c0 !== ci || rect.c1 !== ci || r < rect.r0 || r > rect.r1 || rect.r0 === rect.r1) return [r];
        const rs: number[] = [];
        for (let k = rect.r0; k <= rect.r1; k++) if (actionAt(k, key) !== undefined) rs.push(k);
        return rs.length === 0 ? [r] : rs;
    };
    /** What every row of a range is offered (T8): the first row's offer, less a case another row is not offered — none taken while any row may not act. */
    const rangeOffer = (rs: readonly number[], key: string): ActionCase[] => {
        const offers = rs.map((r) => { const a = actionAt(r, key); return a === undefined ? undefined : offerOf(a.column, a.cell, wireContextFor(r)); });
        if (offers.some((o) => o === undefined || !canTake(o))) return [];
        const [head, ...rest] = offers as NonNullable<(typeof offers)[number]>[];
        return (head?.offered ?? []).filter((c) => rest.every((o) => o.offered.some((x) => x.name === c.name)));
    };
    /** The menu's head and the form's eyebrow name the row (M5, F4): its name and title rule cells, else its number. */
    const actionHead = (r: number, key: string): { name: string | undefined; title: string | undefined } => {
        const a = actionAt(r, key);
        if (a === undefined) return { name: undefined, title: undefined };
        const name = ruleText(a.it.row, a.column.name) ?? (a.lg !== undefined ? words.m.lineName({ number: String(a.lg.number), group: ruleText(a.lg.row, TITLE_KEY) ?? a.lg.row.id }) : words.m.rowName({ number: String(a.it.position + 1) }));
        return { name, title: ruleText(a.it.row, a.column.title) };
    };
    /** What a form opens with (F10): the case's `initial`, else the row's value while it holds this case, else nothing. */
    const initialOf = (r: number, key: string, c: ActionCase): unknown => {
        const a = actionAt(r, key);
        if (a === undefined) return undefined;
        try {
            return c.initial !== undefined ? c.decode(c.initial(wireContextFor(r)))
                : a.cell?.type === "Action" && caseOf(a.cell) === c.name ? c.decode(a.cell.value.value) : undefined;
        } catch (error) {
            console.error(`[Sheet] the form of "${c.name}" could not open with its value:`, error);
            return undefined;
        }
    };
    const openForm = (r: number, key: string, c: ActionCase, anchor: HTMLElement, part: "next" | "more", rs: readonly number[] = [r]) => {
        if (actionAt(r, key) === undefined) return;
        const head = actionHead(r, key);
        // A range's form asks once (T8): it opens on the first row's value, and its answer goes to every row.
        setActionOverlay({ kind: "form", r, rs, key, part, anchor, case: c, initial: rs.length > 1 ? undefined : initialOf(r, key, c), name: head.name, meta: head.title });
    };
    /** What taking a case with a value would write, worded (F8, R2). */
    const consequenceAt = (r: number, key: string, c: ActionCase, value: unknown): string => {
        try { return words.m.actionSets({ facts: actionFacts(r, key, c, c.encode(value)).facts }); }
        catch { return ""; }
    };
    /** Whether a row takes actions at a column (T9): a sheet that takes edits, a cell it writes that no mark locks (#1560), a row no system owns. */
    const actionWritable = (r: number, key: string): boolean => {
        const a = actionAt(r, key);
        return a !== undefined && canEdit && cellWritable(a.meta, a.it.row.cells) && !(a.lg?.row ?? a.it.row).owned;
    };
    const ringOn = (r: number, key: string) => {
        const c = columns.list.findIndex((col) => col.key === key);
        if (c >= 0) { ringGesture(); dispatch({ t: "select.move", r, c }); }
    };
    /**
     * A press on a cell's control takes no focus of its own (K1), so the grid takes it: ⏎ then takes the next case, and
     * ⌘Z undoes the one taken — from a page whose focus was never in the grid too (review of #1481, finding 1). An
     * overlay the press opens moves the focus into itself, and gives it back to the grid as it closes (K6).
     */
    const focusOnPress = () => { cardRef.current?.focus({ preventScroll: true }); };
    const closeOverlay = () => {
        setActionOverlay(undefined);
        // What the overlay's items previewed goes with it, taken or not (P9; F2 of the hand retest).
        if (previewTimer.current !== undefined) { clearTimeout(previewTimer.current); previewTimer.current = undefined; }
        setActionPreview(undefined);
        // Focus goes back to the grid, whose ring is on the cell (K6) — unless another overlay took its place.
        queueMicrotask(() => { if (actionOverlayRef.current === undefined) cardRef.current?.focus({ preventScroll: true }); });
    };
    actionApi.current = !hasActions ? undefined : {
        offer: (r, key) => {
            const a = actionAt(r, key);
            if (a === undefined) return undefined;
            return offerOf(a.column, a.cell, canEdit && editingState.available ? wireContextFor(r) : undefined);
        },
        // Owned rows, a read-only sheet, a column that takes no edit, and a phone's frame show the state alone (T9, X4).
        controls: (r, key) => actionWritable(r, key) && !phoneFrame,
        // A phone's cell with nothing taken, its row free to act and offered a case now: `▶ Start` (SH7).
        startable: (r, key) => {
            if (!phoneFrame || !actionWritable(r, key) || !editingState.available) return false;
            const a = actionAt(r, key);
            if (a === undefined || a.cell?.type === "Action") return false;
            return canTake(offerOf(a.column, a.cell, wireContextFor(r)));
        },
        held: (r, key) => (actionOverlay !== undefined && actionOverlay.r === r && actionOverlay.key === key ? actionOverlay.part : undefined),
        dirty: (r, key) => {
            const a = actionAt(r, key);
            if (a === undefined) return false;
            // Against what the record held where the drafts began; an entry no gesture touched is no draft.
            const began = session.originals.get(a.lg !== undefined ? a.lg.row.id : a.it.row.id);
            if (began === undefined) return false;
            const wire = began.wire;
            const was = a.lg !== undefined ? wire?.lines.find((line) => line.key === a.lg!.key)?.cells.get(key) : wire?.cells.get(key);
            return !cellEqual(was ?? NULL_CELL, a.cell ?? NULL_CELL);
        },
        next: (r, key, c, anchor) => {
            // Over a range down the column, the case on every row of it (T8); else the ring moves to the cell first (P2–P4).
            const rs = actionRows(r, key);
            if (rs.length > 1) { if (!rangeOffer(rs, key).some((o) => o.name === c.name)) return; }
            else ringOn(r, key);
            focusOnPress();
            if (c.kind === "button") takeAction(rs, key, c, null);
            else if (c.kind === "form") openForm(r, key, c, anchor, "next", rs);
            else setActionOverlay({ kind: "menu", r, rs, key, part: "next", anchor, cases: [c], head: words.m.actionMenuHead(actionHead(r, key)) });
        },
        more: (r, key, anchor) => {
            const rs = actionRows(r, key);
            if (rs.length === 1) ringOn(r, key);
            focusOnPress();
            const a = actionAt(r, key);
            if (a === undefined) return;
            const offer = offerOf(a.column, a.cell, wireContextFor(r));
            if (!canTake(offer)) return;
            const first = offer.offered[0];
            const cases = rs.length > 1 ? rangeOffer(rs, key).filter((c) => c.name !== first?.name) : offer.offered.slice(1);
            // Nothing more every row of a range is offered: no Menu, and the footer says why (T8; F12 of the hand retest).
            if (cases.length === 0) {
                if (rs.length > 1) dispatchStore({ t: "patch", patch: { msg: { id: "text", text: words.m.actionRangeNothing() } } });
                return;
            }
            setActionOverlay({ kind: "menu", r, rs, key, part: "more", anchor, cases, head: words.m.actionMenuHead(actionHead(r, key)) });
        },
        preview: (r, key, c) => {
            // The strip previews an action the pointer rests on, after a dwell, and lets it go a grace after it leaves (P8, N5).
            if (previewTimer.current !== undefined) clearTimeout(previewTimer.current);
            previewTimer.current = setTimeout(() => {
                previewTimer.current = undefined;
                setActionPreview(c === undefined ? undefined : { r, key, c });
            }, PREVIEW_MS);
        },
        enter: (r, key) => {
            // ⏎ on an action cell (K2): the offer's first case, its control the anchor — the cell where none is drawn.
            const a = actionAt(r, key);
            if (a === undefined) return;
            const offer = offerOf(a.column, a.cell, canEdit && editingState.available ? wireContextFor(r) : undefined);
            const first = offer.offered[0];
            if (first === undefined || !canTake(offer)) return;
            const c = columns.list.findIndex((col) => col.key === key);
            const cellEl = document.getElementById(`${gridId}-${r}-${c}`);
            const anchor = cellEl?.querySelector<HTMLElement>("[data-slot=actionNext]") ?? cellEl;
            if (anchor === null || anchor === undefined) return;
            actionApi.current?.next(r, key, first, anchor);
        },
        take: (r, key, c, value) => takeAction(actionRows(r, key), key, c, value),
        consequence: (c, value) => (actionOverlay === undefined ? "" : consequenceAt(actionOverlay.r, actionOverlay.key, c, value)),
        takeOn: takeAction,
        consequenceAt,
        initial: initialOf,
        close: closeOverlay,
        strip: () => {
            // The strip over an action (R2, R3): the action the pointer rests on, else the ring's action cell.
            if (ui.edit !== null || ui.sugg !== null) return undefined;
            const preview = actionPreview;
            if (preview !== undefined) {
                const a = actionAt(preview.r, preview.key);
                if (a === undefined) return undefined;
                const { c } = preview;
                const name = actionHead(preview.r, preview.key).name;
                let text: string;
                try {
                    text = c.kind === "form" ? words.m.actionOpensForm()
                        : c.kind === "button" ? words.m.actionSets({ facts: actionFacts(preview.r, preview.key, c, c.encode(null)).facts })
                            : words.m.actionPickReason({ facts: [] });
                } catch { text = ""; }
                return { on: true, label: words.m.actionStripLabel({ verb: verbOf(c), name }), chips: [{ key: "v", label: text, on: false, flat: true, title: text }], meta: "", keys: "" };
            }
            const ringMeta = metaAt(ui.sel.r, ui.sel.c);
            if (ui.ringless || ui.selEnd !== null || ringMeta?.kind !== "action") return undefined;
            const a = actionAt(ui.sel.r, ringMeta.key);
            if (a === undefined) return undefined;
            const offer = offerOf(a.column, a.cell, canEdit && editingState.available ? wireContextFor(ui.sel.r) : undefined);
            const text = words.m.actionStripState({
                state: offer.state?.state, summary: ruleText(a.it.row, a.column.summary) ?? "", offers: offer.offered.map(verbOf),
                blocked: offer.blocked, incomplete: offer.incomplete, readOnly: !(actionApi.current?.controls(ui.sel.r, ringMeta.key) ?? false),
            });
            // ⏎ is offered only where it takes something (R3).
            const takes = canTake(offer) && (actionApi.current?.controls(ui.sel.r, ringMeta.key) ?? false);
            return { on: true, label: words.m.actionStripLabel({ verb: undefined, name: actionHead(ui.sel.r, ringMeta.key).name }), chips: [{ key: "v", label: text, on: false, flat: true, title: text }], meta: "", keys: takes ? words.m.actionStripKeys() : "" };
        },
    };
    // The cells look again as what they read moves: the rows and their drafts, the overlay, the frame's width.
    useLayoutEffect(() => {
        if (hasActions) actionStore.bump();
    }, [hasActions, actionStore, rows, draftVersion, actionOverlay, canEdit, editingState.available, framePx]);
    // An overlay whose row went — a narrowing, a new revision — closes; one whose rows moved goes with them.
    useEffect(() => {
        if (heldOverlay !== undefined && (actionOverlay === undefined || actionApi.current?.offer(actionOverlay.r, actionOverlay.key) === undefined)) setHeldOverlay(undefined);
    }, [heldOverlay, actionOverlay, rows, actionApi]);
    const onActionTake = useCallback((c: ActionCase, value: unknown) => {
        const at = actionOverlayRef.current;
        if (at !== undefined) actionApi.current?.takeOn(at.rs, at.key, c, value);
    }, [actionApi]);
    const actionOverlayRef = useRef(actionOverlay);
    actionOverlayRef.current = actionOverlay;
    const onActionForm = useCallback((c: ActionCase) => {
        const at = actionOverlayRef.current;
        if (at === undefined) return;
        // A form run from the Menu opens in its place, hung from the control that opened the Menu (M8).
        actionApiOpenForm.current(at.r, at.key, c, at.anchor, at.part, at.rs);
    }, []);
    const actionApiOpenForm = useRef(openForm);
    actionApiOpenForm.current = openForm;
    const onActionClose = useCallback(() => actionApi.current?.close(), [actionApi]);
    // A Menu item the pointer rests on is previewed as a control is (P9).
    const onMenuPreview = useCallback((c: ActionCase | undefined) => {
        const at = actionOverlayRef.current;
        if (at !== undefined) actionApi.current?.preview(at.r, at.key, c);
    }, [actionApi]);
    const actionConsequence = useCallback((c: ActionCase, value: unknown) => actionApi.current?.consequence(c, value) ?? "", [actionApi]);
    // A form is its row's while it is open — what is typed in it stays as the rows move.
    const actionOverlayNode = actionOverlay === undefined || heldOverlay === undefined ? null
        : actionOverlay.kind === "menu"
            ? <ActionMenu state={actionOverlay} registers={registers} onTake={onActionTake} onForm={onActionForm} onClose={onActionClose} onPreview={onMenuPreview} />
            : <ActionForm key={`${heldOverlay.id}:${actionOverlay.key}:${actionOverlay.case.name}`} state={actionOverlay} registers={registers}
                consequence={actionConsequence} onTake={onActionTake} onClose={onActionClose} />;
    const rowActions = hasActions ? actionHost : undefined;
    // A phone's action bar (#1479; `Mobile Sheet Spec.md` SH9, R3): the ring's Action cell's actions in the docked strip's
    // place, opened by a tap on that cell — never on a row's other cells — and ⌄ closed until the ring moves.
    const ringColumn = columns.list[ui.sel.c];
    const barClosed = barClosedAt !== undefined && barClosedAt.r === ui.sel.r && barClosedAt.c === ui.sel.c;
    const barKey = phoneFrame && !ui.ringless && ui.selEnd === null && ringColumn?.kind === "action" && !barClosed ? ringColumn.key : undefined;
    const barRow = barKey !== undefined ? actionAt(ui.sel.r, barKey) : undefined;
    // The bar's head names the step's group too — `WO-1042 · step 20` — as nothing else on a phone's screen may (X5; F17 of the hand test).
    const barHeadOf = (r: number, key: string) => {
        const head = actionHead(r, key);
        const lg = actionAt(r, key)?.lg;
        return lg === undefined || head.name === undefined ? head : { ...head, name: `${lg.row.id} · ${head.name}` };
    };
    const barHead = barKey !== undefined && barRow !== undefined ? barHeadOf(ui.sel.r, barKey) : undefined;
    // The inspector's action field (#1478): the same host and the same command as the grid's.
    const panelApi = useMemo<ActionPanelApi>(() => ({
        take: (r, key, c, value) => actionApi.current?.take(r, key, c, value) ?? false,
        consequence: (r, key, c, value) => actionApi.current?.consequenceAt(r, key, c, value) ?? "",
        initial: (r, key, c) => actionApi.current?.initial(r, key, c),
    }), [actionApi]);
    const drawAction = useCallback((r: number, key: string): ReactNode => {
        const it = rowAt(r);
        const meta = allColumns.byKey.get(key);
        const column = actionColumnOf(meta);
        if (it === undefined || it.kind !== "real" || column === undefined) return null;
        const summary = it.row.cells.get(column.summary);
        return <ActionPanel host={actionHost} api={panelApi} r={r} columnKey={key} column={column} cell={it.row.cells.get(key)}
            summary={summary?.type === "String" ? summary.value : ""} registers={registers} writable={meta !== undefined && cellWritable(meta, it.row.cells)} />;
    }, [rowAt, allColumns, actionHost, panelApi, registers]);
    const actionBar = barKey === undefined || barRow === undefined || barHead === undefined ? undefined
        : <ActionBar key={barRow.lg !== undefined ? lineId(barRow.lg.row.id, barRow.lg.key) : barRow.it.row.id} host={actionHost} api={panelApi} r={ui.sel.r} columnKey={barKey}
            name={barHead.name} title={barHead.title} registers={registers} writable={actionWritable(ui.sel.r, barKey)}
            summary={ruleText(barRow.it.row, barRow.column.summary) ?? ""} onClose={() => setBarClosedAt({ r: ui.sel.r, c: ui.sel.c })} />;
    // A phone's cell editor (`Mobile Sheet Spec.md` SH10, R9): the ring's cell of every other kind edits in the same
    // bottom container — the inspector's form at touch size, its field alone, the frame's — opened by a press on the cell
    // and ⌄ closed as the bar is. A cell that takes no edit opens nothing (SH10.2), a locked one too (#1560); a sheet read only opens nothing; nor,
    // on a host's grid, does a cell that steps in place or opens where the host edits it (#1536): the press takes it there.
    const hostEditor = host.cellEditor;
    // Its eyebrow names the row as the action bar's does — its action column's name and title — where it has one.
    const rowActionName = (r: number): string | undefined => {
        const key = allColumns.list.find((col) => col.kind === "action")?.key;
        if (key === undefined || actionAt(r, key) === undefined) return undefined;
        const head = actionHead(r, key);
        const named = [head.name, head.title].filter((t): t is string => t !== undefined && t !== "");
        return named.length === 0 ? undefined : named.join(" · ");
    };
    const ringMeta = metaAt(ui.sel.r, ui.sel.c);
    const ringRow = rowAt(ui.sel.r);
    const ringR = ui.sel.r;
    const ringC = ui.sel.c;
    const cellEditor = !phoneFrame || hostEditor === undefined || ui.ringless || ui.selEnd !== null || barClosed || readOnly || ringMeta === undefined
        || !writableAt(ringR, ringC) || ringMeta.kind === "action" || ringMeta.kind === "stamped" || (hostGrid !== undefined && (stepsInPlace(ringMeta) || editsOutOfPlace(ringMeta, hostGrid)))
        || (ringRow?.kind !== "real" && ringRow?.kind !== "group") ? undefined
        : hostEditor({ r: ringR, columnKey: ringMeta.key, band: ringRow.kind === "group", name: rowActionName(ringR), onClose: () => setBarClosedAt({ r: ringR, c: ringC }) });
    return { actionBar, actionOverlayNode, cellEditor, drawAction, rowActions };
}

/** What {@link useSheetActions} gives the parts after it. */
export type SheetActions = ReturnType<typeof useSheetActions>;
