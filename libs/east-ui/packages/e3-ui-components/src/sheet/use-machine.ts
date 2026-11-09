/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the state machine may ask of the sheet as it stands (`SheetMachineCtx`), its dispatch, and what it hears of the
 * sheet moving under it: the rows changing, the narrowing changing, the view the sheet opens on, and the folds it keeps.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { fromEastTypeValue } from "@elaraai/east";
import type { RowsViewport } from "@elaraai/east-ui-components/internal";
import { TITLE_KEY, driverKeyOf, isLooseRow, isRowSpace, lineId } from "./model.js";
import { clearNarrowing, narrowingEqual } from "./view-state.js";
import { sameFolds } from "./persisted.js";
import { candidateAt, candidateList } from "./candidates.js";
import { editText, parseCell } from "./parse/index.js";
import type { SheetEvent, SheetMachineCtx } from "./sheet-state.js";
import { editsOutOfPlace, keyedCell, stepCell, stepsInPlace } from "./steps.js";
import type { SheetSavedView, SheetNarrowing, SheetRootValue, SheetRowValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import { followRows, type RowSlot, slotOf } from "./items.js";

/**
 * The machine's East values, by their types' names: a value's inferred type carries East's variant brand, which the
 * declaration build cannot name (TS4058).
 */
interface SheetMachineValues {
    readonly emptyNarrowing: SheetNarrowing | undefined;
    readonly expectedNarrowing: RefObject<SheetNarrowing | undefined>;
    readonly seenRows: RefObject<{ source: readonly SheetRowValue[]; slots: (RowSlot | undefined)[] }>;
}

/**
 * Builds the machine's view of the sheet and follows the sheet as it moves (see the module docs).
 *
 * @param value - The Sheet root value
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @returns The machine's context, its dispatch and the refs it is read through
 */
export function useSheetMachine(value: SheetRootValue, sheetDecode: SheetDecode, sheetSession: SheetSession,
    sheetBody: SheetBody) {
    const {
        activeView, canInsertRows, columns, declaredNoun, driverColumn, group, hostGrid, narrowing, pagedSource,
        registers, rowPx, views, viewsRef, words,
    } = sheetDecode;
    const {
        canEdit, dispatchStore, editingState, exhausted, lens, lensDrawn, paging, persist, persistedRef, restored, rows,
        sourceRows, ui,
    } = sheetSession;
    const {
        body, candidateCtxFor, cellAt, colCount, idAt, lensEnds, levelAt, linkCtxFor, memberAt, metaAt, parseCtxFor,
        rowAt, rowCount, rowOf, rowSpace, writableAt,
    } = sheetBody;
    // The whole-sheet narrowing, and whether the active tab has drifted from its view (B§8).
    const emptyNarrowing = useMemo(() => (narrowing !== undefined ? clearNarrowing(narrowing) : undefined), [narrowing]);
    const activeViewValue = useMemo(() => (ui.tabs.active === null ? undefined : views.find((v) => v.id === ui.tabs.active)), [views, ui.tabs.active]);
    const dirty = activeViewValue !== undefined && narrowing !== undefined && !narrowingEqual(activeViewValue.narrowing, narrowing);

    // What moves a page (#860): the rows the frame shows — less one, so a
    // page keeps a row of context. Unmeasured (a frame not laid out), the
    // machine's default. The frame is the one the rows report (`viewport`,
    // kept in `use-scroll.tsx`), read when the key comes.
    const viewportRef = useRef<RowsViewport | null>(null);
    const pageRows = useCallback((): number => {
        const frame = viewportRef.current;
        const px = frame === null ? 0 : frame.frame.clientHeight;
        return px > 0 ? Math.max(1, Math.floor(px / rowPx) - 1) : 10;
    }, [rowPx]);
    const pagedHead = paging.head;
    const pagedTail = paging.tail;
    const jumpToElement = paging.jumpToElement;
    // The jump in charge of the rows drawn: the lens's under the lens (#1349), else the pages'.
    const lensJumpTo = lens.jumpToElement;
    const lensClearJump = lens.clearJump;
    const jumpTo = lensDrawn ? lensJumpTo : jumpToElement;
    const clearJump = lensDrawn ? lensClearJump : paging.clearJump;
    const ctx = useMemo<SheetMachineCtx>(() => ({
        rowCount,
        colCount,
        lensActive: lensDrawn,
        grouped: group !== undefined,
        // Group insertion uses explicit controls; keyboard padding is flat-only. A host's grid draws no padding and adds
        // rows its own way (the Record's Add): ↓ on its last row stays there.
        canAppend: exhausted && canInsertRows && editingState.available && group === undefined && hostGrid === undefined,
        // A paged sheet's ends (#860): an unloaded run past the row space is a band — under the lens, a stretch it has not
        // read past the rows it draws (#1349).
        edges: pagedSource === undefined ? undefined
            : lensEnds !== undefined ? { atStart: lensEnds.before === undefined, atEnd: lensEnds.after === undefined }
                : { atStart: pagedHead === undefined, atEnd: pagedTail === undefined },
        pageRows,
        editableAt: (r, c) => {
            if (!canEdit || !editingState.available) return false;
            const it = rowAt(r);
            if (it === undefined || !isRowSpace(it)) return false;
            const meta = metaAt(r, c);
            if (meta === undefined) return false;
            if (it.kind === "blank" && !canInsertRows) return false;
            // An action column is written by its actions alone (T7): typed into, pasted over and cleared never. A locked
            // cell takes no gesture at all (#1560).
            if (!writableAt(r, c) || meta.kind === "stamped" || meta.kind === "action") return false;
            // A cell that steps in place is a control, as an action cell is (#1531): an owned row's takes no step (T9).
            if (hostGrid !== undefined && stepsInPlace(meta) && (it.kind === "real" || it.kind === "group") && it.row.owned) return false;
            return true;
        },
        kindAt: (r, c) => metaAt(r, c)?.kind ?? "text",
        // A host's grid (#1531): its cycles, toggles and booleans step in place, its titles open where the host edits
        // them — in their cells, for a host that opens them nowhere — and its strip shows the cell under the pointer.
        stepAt: hostGrid === undefined ? undefined : (r, c, step) => stepCell(metaAt(r, c), cellAt(r, c), registers, step),
        stepsAt: hostGrid === undefined ? undefined : (r, c) => stepsInPlace(metaAt(r, c)),
        keyAt: hostGrid === undefined ? undefined : (r, c, key) => keyedCell(metaAt(r, c), key, registers),
        opensAt: hostGrid === undefined ? undefined : (r, c) => editsOutOfPlace(metaAt(r, c), hostGrid),
        previewsHover: hostGrid !== undefined,
        parse: (r, c, text) => {
            const meta = metaAt(r, c);
            if (meta === undefined) return { kind: "unrecognised" };
            return parseCell(meta, text, parseCtxFor(r, meta));
        },
        candidates: (r, c, text) => {
            const meta = metaAt(r, c);
            return meta === undefined ? [] : candidateList(meta, text, candidateCtxFor(r));
        },
        candidateAt: (r, c, text, hi) => {
            const meta = metaAt(r, c);
            return meta === undefined ? undefined : candidateAt(meta, text, hi, candidateCtxFor(r));
        },
        editTextAt: (r, c) => {
            const meta = metaAt(r, c);
            return meta === undefined ? "" : editText(cellAt(r, c), meta, words, levelAt(r, meta), memberAt(r, c));
        },
        memberAt: (r, c) => memberAt(r, c)?.key,
        // A band's cells are never link cells, whatever column they sit under.
        linkAt: (r, c) => { const k = rowAt(r)?.kind; return k === "group" ? undefined : linkCtxFor(r, c); },
        rowOf,
        idAt,
        columnOf: (key) => { const c = columns.list.findIndex((m) => m.key === key); return c < 0 ? undefined : c; },
        driverKeyAt: (r) => { const it = rowAt(r); return driverKeyOf(it !== undefined && it.kind === "real" ? it.row : undefined, driverColumn); },
        driverColumn,
        numberAt: (r) => {
            const it = rowAt(r);
            if (it === undefined || !isRowSpace(it)) return r + 1;
            if ((it.kind === "real" || it.kind === "blank") && it.group !== undefined) return it.group.number;
            return it.kind === "real" || it.kind === "blank" ? it.position + 1 : r + 1;
        },
        // A row as the messages name it — worded when they show (#861).
        rowRefAt: (r) => {
            const it = rowAt(r);
            const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
            if (lg === undefined) return { line: false, number: it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.position + 1 : r + 1 };
            const title = lg.row.cells.get(TITLE_KEY);
            return { line: true, number: lg.number, title: title !== undefined && title.type === "String" && title.value !== "" ? title.value : undefined, noun: declaredNoun?.singular };
        },
        viewName: (seq) => words.m.viewName({ seq: String(seq) }),
        views,
        narrowing,
        emptyNarrowing,
        dirty,
        rowKindAt: (r) => {
            const it = rowAt(r);
            if (it === undefined) return undefined;
            switch (it.kind) {
                case "real": return "row";
                case "blank": return "blank";
                case "group": return "group";
                default: return undefined;
            }
        },
        groupAt: (r) => {
            const it = rowAt(r);
            if (it === undefined || it.kind !== "group") return undefined;
            let r0: number | undefined;
            let r1: number | undefined;
            for (let k = r + 1; k < rowCount; k++) {
                const x = rowAt(k);
                if (x === undefined || x.kind !== "real" || x.group?.row.id !== it.row.id) break;
                r0 ??= k;
                r1 = k;
            }
            return { id: it.row.id, folded: it.folded, lines: r0 !== undefined && r1 !== undefined ? { r0, r1 } : undefined };
        },
        spanAt: (r, c) => {
            if (group === undefined) return undefined;
            const k = rowAt(r)?.kind;
            return k === "group" && c < group.titleSpan ? { c0: 0, c1: group.titleSpan - 1 } : undefined;
        },
        // Every group the sheet holds — under the lens, those it draws (#1349): what fold-all folds — never a loose row (#846).
        groupIds: group !== undefined ? rows.filter((row) => !isLooseRow(row)).map((row) => row.id) : undefined,
        looseAt: (r) => { const it = rowAt(r); return it !== undefined && it.kind === "real" && it.loose !== undefined; },
        // The host's word only: a message words a missing one when it shows (#861).
        groupNoun: declaredNoun,
        // A line's sub rows: whether they show is read off the body.
        lineSubRowsAt: (r) => {
            const bi = rowSpace.bodyIndexOf[r];
            const it = bi !== undefined ? body[bi] : undefined;
            if (it === undefined || it.kind !== "real" || it.group === undefined) return undefined;
            const g = it.group.row;
            const count = g.lines[it.group.index]?.subRows.length ?? 0;
            if (count === 0) return undefined;
            const next = body[bi! + 1];
            return {
                id: it.row.id, count,
                open: next !== undefined && next.kind === "subRow" && next.lineId === it.row.id,
                group: g.lines.filter((l) => l.subRows.length > 0).map((l) => lineId(g.id, l.key)),
            };
        },
    }), [rowCount, colCount, lensDrawn, exhausted, canEdit, canInsertRows, editingState.available, group, declaredNoun, columns, rows, rowAt, metaAt, parseCtxFor, candidateCtxFor, cellAt, levelAt, memberAt, words, linkCtxFor, rowOf, idAt, driverColumn, views, narrowing, emptyNarrowing, dirty, rowSpace, body, pagedSource, pagedHead, pagedTail, lensEnds, pageRows, hostGrid, registers, writableAt]);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const uiRef = useRef(ui);
    uiRef.current = ui;
    const dispatch = useCallback((e: SheetEvent) => dispatchStore({ t: "event", e, ctx: ctxRef.current }), [dispatchStore]);

    // The rows changed underneath: clamp the ring, drop a suggestion whose
    // anchor went. Source rows that moved under them — a window landing above
    // the ring, a failed one landing after a Retry, a new revision, the
    // host's write-back — shift the rows after: the ring, a range and an open
    // editor follow their ROWS, not the indices they had (#854), and an
    // editor whose row left closes (#877). Only a move of the SOURCE's rows
    // is followed: the sheet's own writes put the ring where the new rows
    // have it.
    const rowSpaceSlots = useMemo(() => rowSpace.bodyIndexOf.map((bi) => slotOf(body[bi]!)), [rowSpace, body]);
    const seenRows = useRef({ source: sourceRows, slots: rowSpaceSlots });
    useEffect(() => {
        const seen = seenRows.current;
        seenRows.current = { source: sourceRows, slots: rowSpaceSlots };
        const moved = seen.source !== sourceRows ? followRows(seen.slots, rowSpaceSlots) : undefined;
        dispatch({ t: "rows.changed", moved });
    }, [rows, rowCount, colCount, sourceRows, rowSpaceSlots, dispatch]);

    // The slice's narrowing changed underneath the sheet (a keystroke in the
    // search, a filter): the ring returns to the top — unless the sheet wrote
    // that narrowing itself (a tab switch, a revert), which places the ring
    // itself.
    const expectedNarrowing = useRef<SheetSavedView["narrowing"] | undefined>(undefined);
    const seenNarrowing = useRef(narrowing);
    useEffect(() => {
        const prev = seenNarrowing.current;
        seenNarrowing.current = narrowing;
        if (narrowing === undefined || prev === undefined) return;
        if (narrowingEqual(prev, narrowing)) return;
        const expected = expectedNarrowing.current;
        expectedNarrowing.current = undefined;
        if (expected !== undefined && narrowingEqual(expected, narrowing)) return;
        dispatch({ t: "narrowing.changed" });
    }, [narrowing, dispatch]);

    // A row's id is its key's `.east` text, but a String key's id is the String itself, which a seek takes quoted.
    const keyIsText = useMemo(() => value.editing.keyType.type !== "some" || fromEastTypeValue(value.editing.keyType.value).type === "String", [value.editing.keyType]);

    // The initial view opens on mount — with the folds the last session left
    // on it, when it left them there (#857); a host that moves `activeView`
    // later is followed.
    const openedView = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (activeView === undefined || activeView === openedView.current) return;
        const first = openedView.current === undefined;
        openedView.current = activeView;
        if (!viewsRef.current.some((v) => v.id === activeView)) return;
        const left = first && restored.view === activeView ? { folds: new Map(restored.folds) } : {};
        dispatch({ t: "tab.open", id: activeView, ...left });
    }, [activeView, dispatch, restored, viewsRef]);
    // The folds persist with the tab they are on (#857).
    useEffect(() => {
        const p = persistedRef.current;
        if (sameFolds(p, ui.tabs.active, ui.folds)) return;
        persist({ ...p, view: ui.tabs.active, folds: [...ui.folds] });
    }, [ui.folds, ui.tabs.active, persist, persistedRef]);
    const named: SheetMachineValues = { emptyNarrowing, expectedNarrowing, seenRows };
    return {
        clearJump, ctx, ctxRef, dirty, dispatch, jumpTo, jumpToElement, keyIsText, lensJumpTo, rowSpaceSlots, uiRef,
        viewportRef, ...named,
    };
}

/** What {@link useSheetMachine} gives the parts after it. */
export type SheetMachine = ReturnType<typeof useSheetMachine>;
