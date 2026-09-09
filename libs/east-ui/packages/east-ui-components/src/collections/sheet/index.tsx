/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraSheet` — the planning spreadsheet (`Sheet Spec.md` §6): decode,
 * the row source (both arms), the local data layer (edits over the decoded
 * rows until the host writes back), THE state machine, the effect runner,
 * and the shell — toolbar · sticky two-line header · virtualised rows ·
 * the docked strip · the footer.
 *
 * The interactive-state pattern, at sheet scale: every edit lands in local
 * state immediately (the sheet is never inert without a bound callback) and
 * reaches the host through `onEdit` in a microtask; a new decoded value
 * resets the local layer, so a host that writes back through `onUpdate` sees
 * its own rows come around with the edit applied.
 *
 * `equalFor` treats every function value as equal, so the memo guard cannot
 * see a swapped provider or `onEdit`; every function is taken from the
 * latest value on each render (the Table / Plan rule, §6.2).
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type MouseEvent, type KeyboardEvent, type ClipboardEvent, type ReactNode } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, type Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { parseCssSize } from "../../style/parse-size.js";
import { DensityProvider } from "../../contracts/density.js";
import { useDensityHeights } from "../shared/helpers.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity.js";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { VirtualRows } from "../virtual-rows.js";
import {
    BAND_MIN_PX, BOTTOM_PAD_PX, DEFAULT_BLANKS, DEFAULT_GUTTER_PX, NULL_CELL,
    buildBody, cellIsBlank, densityOf, driverKeyOf, indexColumns, indexRegisters, parseWidth,
    type SheetBodyItem, type SheetColumnMeta,
} from "./model.js";
import { useSheetPaging, type SheetViewport } from "./paging.js";
import { candidateAt, candidateList, ghostFor, resolveFor, type CandidateContext } from "./candidates.js";
import { editText, parseCell, type ParseContext } from "./parse/index.js";
import { todayUtc } from "./parse/date.js";
import { exportMatrix, layoutPaste, parseMatrix } from "./clipboard.js";
import {
    initialSheetStore, sheetStoreReducer, selectionRect, wholeRows,
    type SheetEffect, type SheetEvent, type SheetMachineCtx,
} from "./sheet-state.js";
import { SheetHeader } from "./Header.js";
import { SheetRow, SheetBandRow } from "./Rows.js";
import { SheetEditor, type EditorFocusRequest } from "./Editor.js";
import { SheetStrip, buildStrip } from "./Strip.js";
import { SheetFooter, type SheetTransport } from "./Footer.js";
import { SheetToolbar } from "./Toolbar.js";
import type { SheetCellValue, SheetContextValue, SheetEditValue, SheetRootValue, SheetRowValue, SheetSelectionValue } from "./values.js";

export type { SheetRootValue, SheetRowValue, SheetCellValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

const sheetRootEqual = equalFor(Sheet.Types.Root);
const cellEqual = equalFor(Sheet.Types.Cell);

/** Where an edit came from (the wire `SheetSourceType` tags). */
type EditSource = "typed" | "pasted" | "fill" | "row" | "pattern";

/** The local data layer — edits over the decoded rows until the host writes back. */
interface LocalLayer {
    /** Rows edited in place, by id. */
    edits: ReadonlyMap<string, SheetRowValue>;
    /** Rows inserted after the source's last one. */
    appended: readonly SheetRowValue[];
    /** Rows removed, by id. */
    removed: ReadonlySet<string>;
}

const EMPTY_LAYER: LocalLayer = { edits: new Map(), appended: [], removed: new Set() };

/** The decoded rows with the local layer applied. */
function applyLayer(source: readonly SheetRowValue[], layer: LocalLayer): SheetRowValue[] {
    if (layer.edits.size === 0 && layer.appended.length === 0 && layer.removed.size === 0) return source as SheetRowValue[];
    const out: SheetRowValue[] = [];
    for (const r of source) {
        if (layer.removed.has(r.id)) continue;
        out.push(layer.edits.get(r.id) ?? r);
    }
    for (const r of layer.appended) if (!layer.removed.has(r.id)) out.push(layer.edits.get(r.id) ?? r);
    return out;
}

/** A row with one cell replaced. */
function withCell(row: SheetRowValue, key: string, cell: SheetCellValue): SheetRowValue {
    const cells = new Map(row.cells);
    cells.set(key, cell);
    return { ...row, cells };
}

/** A fresh row — every declared cell blank. */
function blankRow(id: string, columns: readonly SheetColumnMeta[]): SheetRowValue {
    return { id, owned: false, cells: new Map(columns.map((c) => [c.key, NULL_CELL])) };
}

let mintCounter = 0;
/** A renderer-minted row id — unique per session, never a source id. */
function mintId(taken: (id: string) => boolean): string {
    for (;;) {
        const id = `sheet-${Date.now().toString(36)}-${(mintCounter++).toString(36)}`;
        if (!taken(id)) return id;
    }
}

export interface EastChakraSheetProps {
    /** The Sheet root value. */
    value: SheetRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
}

/** Renders an East Sheet value — the planning spreadsheet. */
export const EastChakraSheet = memo(function EastChakraSheet({ value }: EastChakraSheetProps) {
    // ── Decode ────────────────────────────────────────────────────────────
    const columns = useMemo(() => indexColumns(value.columns), [value.columns]);
    const registers = useMemo(() => indexRegisters(value.registers), [value.registers]);
    const driver = useMemo(() => getSomeorUndefined(value.driver), [value.driver]);
    const driverColumn = driver?.column;
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const size = densityOf(value);
    const rowPx = useDensityHeights(size).row;
    const readOnly = getSomeorUndefined(value.readOnly) ?? false;
    const blanks = Number(getSomeorUndefined(value.blanks) ?? BigInt(DEFAULT_BLANKS));
    const gutterPx = parseWidth(style !== undefined ? getSomeorUndefined(style.gutterWidth) : undefined) ?? DEFAULT_GUTTER_PX;
    // The LAST column absorbs the frame's slack (the Table's #323 stretch rule): a
    // sheet narrower than its frame fills it instead of leaving a dead strip.
    const gridTemplate = useMemo(() => `${gutterPx}px ${columns.list.map((c, i) => (i === columns.list.length - 1 ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(" ")}`, [gutterPx, columns]);
    const minWidth = gutterPx + columns.totalWidth;
    const today = useMemo(() => todayUtc(), []);

    // Callbacks — taken from the latest value on every render (the equalFor rule).
    const onEditFn = useMemo(() => getSomeorUndefined(value.onEdit), [value.onEdit]);
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const newRowIdFn = useMemo(() => getSomeorUndefined(value.newRowId), [value.newRowId]);
    const selection = useMemo(() => getSomeorUndefined(value.selection), [value.selection]);

    // ── The row source: inline rows, or the paged driver ──────────────────
    const pagedSource = value.rows.type === "paged" ? value.rows.value : undefined;
    const decodedRows = useMemo<readonly SheetRowValue[] | undefined>(
        () => (value.rows.type === "inline" ? (value.rows.value as readonly SheetRowValue[]) : undefined),
        [value.rows],
    );
    const paging = useSheetPaging(pagedSource, rowPx);
    const sourceRows: readonly SheetRowValue[] = decodedRows ?? paging.rows;
    const rowsOffset = decodedRows !== undefined ? 0 : paging.rowsOffset;
    const exhausted = decodedRows !== undefined || paging.exhausted;
    // The identity of the source the local layer sits over: a new decoded
    // value, or a new paged source, resets the layer.
    const sourceIdentity = decodedRows ?? pagedSource?.id ?? "";
    const [layerState, setLayerState] = useState<{ over: unknown; layer: LocalLayer }>({ over: sourceIdentity, layer: EMPTY_LAYER });
    const layer = layerState.over === sourceIdentity ? layerState.layer : EMPTY_LAYER;
    const setLayer = useCallback((fn: (prev: LocalLayer) => LocalLayer) => {
        setLayerState((prev) => ({ over: sourceIdentity, layer: fn(prev.over === sourceIdentity ? prev.layer : EMPTY_LAYER) }));
    }, [sourceIdentity]);
    const rows = useMemo(() => applyLayer(sourceRows, layer), [sourceRows, layer]);

    // ── The state machine ─────────────────────────────────────────────────
    const [store, dispatchStore] = useReducer(sheetStoreReducer, undefined, () => {
        // The ring opens on the first blank row's driver column (else its first
        // column) — the prototype's "type an activity on the empty row".
        const c = Math.max(0, driverColumn !== undefined ? columns.list.findIndex((col) => col.key === driverColumn) : 0);
        return initialSheetStore({ r: decodedRows?.length ?? 0, c });
    });
    const ui = store.ui;

    // ── The body ──────────────────────────────────────────────────────────
    const body = useMemo<SheetBodyItem[]>(() => buildBody({
        rows, rowsOffset, blanks: blanks + ui.appended, exhausted,
        total: paging.total, head: paging.head, tail: paging.tail,
    }), [rows, rowsOffset, blanks, ui.appended, exhausted, paging.total, paging.head, paging.tail]);
    // Row space — the body without its bands.
    const rowSpace = useMemo(() => {
        const bodyIndexOf: number[] = [];
        const rowOf: number[] = new Array<number>(body.length).fill(-1);
        body.forEach((it, i) => {
            if (it.kind === "band") return;
            rowOf[i] = bodyIndexOf.length;
            bodyIndexOf.push(i);
        });
        return { bodyIndexOf, rowOf };
    }, [body]);
    const rowCount = rowSpace.bodyIndexOf.length;
    const colCount = columns.list.length;
    const rowAt = useCallback((r: number): SheetBodyItem | undefined => {
        const bi = rowSpace.bodyIndexOf[r];
        return bi === undefined ? undefined : body[bi];
    }, [rowSpace, body]);
    const cellAt = useCallback((r: number, c: number): SheetCellValue | undefined => {
        const it = rowAt(r);
        const meta = columns.list[c];
        if (it === undefined || it.kind !== "real" || meta === undefined) return undefined;
        return it.row.cells.get(meta.key);
    }, [rowAt, columns]);
    const realCount = rows.length;

    // ── What a transition may ask ─────────────────────────────────────────
    const candidateCtxFor = useCallback((r: number): CandidateContext => {
        const it = rowAt(r);
        return { registers, rows, rowIndex: it !== undefined && it.kind === "real" ? it.residentIndex : -1, driverColumn };
    }, [rowAt, registers, rows, driverColumn]);
    const wireContextFor = useCallback((r: number): SheetContextValue => {
        const it = rowAt(r);
        const row = it !== undefined && it.kind === "real" ? it.row : undefined;
        const driverKey = driverKeyOf(row, driverColumn);
        return {
            rowIndex: BigInt(it !== undefined && it.kind === "real" ? it.residentIndex : rows.length),
            rowId: row?.id ?? "",
            offset: BigInt(it !== undefined && it.kind !== "band" ? it.position : rowsOffset + rows.length),
            row: row?.cells ?? new Map(columns.list.map((c) => [c.key, NULL_CELL])),
            rows: rows as SheetRowValue[],
            rowsOffset: BigInt(rowsOffset),
            partial: !exhausted,
            driver: driverKey !== undefined ? some(driverKey) : none,
            today,
        } as SheetContextValue;
    }, [rowAt, driverColumn, rows, rowsOffset, columns, exhausted, today]);
    const parseCtxFor = useCallback((r: number, meta: SheetColumnMeta): ParseContext => {
        let baseDate: Date | undefined;
        if (meta.kind === "date" && meta.base !== undefined) {
            const it = rowAt(r);
            const b = it !== undefined && it.kind === "real" ? it.row.cells.get(meta.base) : undefined;
            if (b !== undefined && b.type === "DateTime") baseDate = b.value as Date;
        }
        return {
            ...candidateCtxFor(r),
            today,
            baseDate,
            wireContext: meta.kind === "custom" ? wireContextFor(r) : undefined,
        };
    }, [rowAt, candidateCtxFor, today, wireContextFor]);
    const ctx = useMemo<SheetMachineCtx>(() => ({
        rowCount,
        colCount,
        lensActive: false,
        canAppend: exhausted && !readOnly,
        editableAt: (r, c) => {
            if (readOnly) return false;
            const meta = columns.list[c];
            const it = rowAt(r);
            if (meta === undefined || it === undefined || it.kind === "band") return false;
            if (!meta.editable || meta.kind === "stamped") return false;
            return true;
        },
        kindAt: (c) => columns.list[c]?.kind ?? "text",
        parse: (r, c, text) => {
            const meta = columns.list[c];
            if (meta === undefined) return { kind: "unrecognised" };
            return parseCell(meta, text, parseCtxFor(r, meta));
        },
        candidates: (r, c, text) => {
            const meta = columns.list[c];
            return meta === undefined ? [] : candidateList(meta, text, candidateCtxFor(r));
        },
        candidateAt: (r, c, text, hi) => {
            const meta = columns.list[c];
            return meta === undefined ? undefined : candidateAt(meta, text, hi, candidateCtxFor(r));
        },
        editTextAt: (r, c) => {
            const meta = columns.list[c];
            return meta === undefined ? "" : editText(cellAt(r, c), meta);
        },
    }), [rowCount, colCount, exhausted, readOnly, columns, rowAt, parseCtxFor, candidateCtxFor, cellAt]);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const uiRef = useRef(ui);
    uiRef.current = ui;
    const dispatch = useCallback((e: SheetEvent) => dispatchStore({ t: "event", e, ctx: ctxRef.current }), []);

    // The rows changed underneath: clamp the ring, drop an editor whose row went.
    useEffect(() => { dispatch({ t: "rows.changed" }); }, [rowCount, colCount, dispatch]);

    // ── Writes — the local layer, then the host ───────────────────────────
    const emitEdit = useCallback((edit: SheetEditValue) => {
        if (onEditFn !== undefined) queueMicrotask(() => onEditFn(edit));
    }, [onEditFn]);
    /**
     * Write cells: a real row's commits land in the layer's edits (one
     * `commit` event per changed cell, each carrying the row AFTER it); a
     * blank row's cells become one inserted row (one `insert` event). Returns
     * the row-space index the FIRST inserted row landed on, so the ring can
     * follow a blank row that just became real.
     */
    const writeCells = useCallback((writes: readonly { r: number; c: number; cell: SheetCellValue }[], source: EditSource): number | undefined => {
        const byRow = new Map<number, { c: number; cell: SheetCellValue }[]>();
        for (const w of writes) {
            const list = byRow.get(w.r) ?? [];
            list.push({ c: w.c, cell: w.cell });
            byRow.set(w.r, list);
        }
        const edits = new Map(layer.edits);
        const appended = [...layer.appended];
        const events: SheetEditValue[] = [];
        let lastId = rows.length > 0 ? rows[rows.length - 1]!.id : undefined;
        let firstInserted: number | undefined;
        let inserted = 0;
        const src = variant(source, null) as SheetEditValue extends { value: { source: infer S } } ? S : never;
        const taken = (id: string) => rows.some((x) => x.id === id) || appended.some((x) => x.id === id);
        for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
            const it = rowAt(r);
            if (it !== undefined && it.kind === "real") {
                let row = it.row;
                for (const w of byRow.get(r)!) {
                    const meta = columns.list[w.c];
                    if (meta === undefined) continue;
                    if (cellEqual(row.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                    row = withCell(row, meta.key, w.cell);
                    events.push(variant("commit", { rowId: row.id, offset: BigInt(it.position), key: meta.key, row, source: src }) as SheetEditValue);
                }
                if (row !== it.row) edits.set(row.id, row);
                continue;
            }
            if (it !== undefined && it.kind === "band") continue;
            // A blank row (or a row past the padding): one inserted row.
            let row = blankRow(newRowIdFn !== undefined ? newRowIdFn() : mintId(taken), columns.list);
            for (const w of byRow.get(r)!) {
                const meta = columns.list[w.c];
                if (meta !== undefined) row = withCell(row, meta.key, w.cell);
            }
            if (columns.list.every((c) => cellIsBlank(row.cells.get(c.key)))) continue;
            appended.push(row);
            events.push(variant("insert", { afterRowId: lastId !== undefined ? some(lastId) : none, row, source: src }) as SheetEditValue);
            lastId = row.id;
            if (firstInserted === undefined) firstInserted = realCount + inserted;
            inserted += 1;
        }
        if (events.length === 0) return undefined;
        setLayer((prev) => ({ edits: new Map([...prev.edits, ...edits]), appended: [...prev.appended, ...appended.slice(layer.appended.length)], removed: prev.removed }));
        for (const e of events) emitEdit(e);
        return firstInserted;
    }, [layer, rows, rowAt, columns, newRowIdFn, realCount, setLayer, emitEdit]);
    const deleteRows = useCallback((r0: number, r1: number) => {
        const ids: string[] = [];
        for (let r = r0; r <= r1; r++) {
            const it = rowAt(r);
            if (it !== undefined && it.kind === "real") ids.push(it.row.id);
        }
        if (ids.length === 0) return 0;
        setLayer((prev) => ({ ...prev, removed: new Set([...prev.removed, ...ids]) }));
        emitEdit(variant("remove", { rowIds: ids }) as SheetEditValue);
        return ids.length;
    }, [rowAt, setLayer, emitEdit]);

    // ── Effects ───────────────────────────────────────────────────────────
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [editorFocus, setEditorFocus] = useState<EditorFocusRequest>({ seq: 0, selectAll: true });
    const [scrollTarget, setScrollTarget] = useState<number | undefined>(undefined);
    const runEffects = useCallback((effects: readonly SheetEffect[]) => {
        for (const eff of effects) {
            switch (eff.t) {
                case "write": {
                    const inserted = writeCells([{ r: eff.r, c: eff.c, cell: eff.cell ?? NULL_CELL }], "typed");
                    if (inserted !== undefined) {
                        // The blank row became real at the end of the sheet: the ring
                        // follows it, keeping whatever move the commit made.
                        const delta = store.ui.sel.r - eff.r;
                        dispatchStore({ t: "patch", patch: { sel: { r: inserted + delta, c: store.ui.sel.c }, selEnd: null } });
                    }
                    break;
                }
                case "clear": {
                    const writes: { r: number; c: number; cell: SheetCellValue }[] = [];
                    for (let r = eff.r0; r <= eff.r1; r++) {
                        for (let c = eff.c0; c <= eff.c1; c++) {
                            const meta = columns.list[c];
                            if (meta === undefined || meta.kind === "stamped" || !meta.editable || readOnly) continue;
                            if (cellIsBlank(cellAt(r, c))) continue;
                            writes.push({ r, c, cell: NULL_CELL });
                        }
                    }
                    if (writes.length > 0) writeCells(writes, "typed");
                    break;
                }
                case "delete.rows": {
                    if (readOnly) break;
                    const n = deleteRows(eff.r0, eff.r1);
                    if (n > 0) dispatchStore({ t: "patch", patch: { msg: `Deleted ${n} row${n === 1 ? "" : "s"}` } });
                    break;
                }
                case "copy": {
                    const text = exportMatrix(cellAt, columns.list, eff);
                    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
                        void navigator.clipboard.writeText(text).catch(() => {});
                    }
                    break;
                }
                case "paste": {
                    if (readOnly) break;
                    const matrix = parseMatrix(eff.text);
                    if (matrix.length === 0) break;
                    const laid = layoutPaste(matrix, columns.list, eff.c);
                    const writes: { r: number; c: number; cell: SheetCellValue }[] = [];
                    let skipped = 0;
                    for (const p of laid.cells) {
                        const meta = columns.list[p.c];
                        if (meta === undefined) continue;
                        const r = eff.r + p.dr;
                        const outcome = parseCell(meta, p.text, parseCtxFor(r, meta));
                        if (outcome.kind === "unrecognised") { skipped += 1; continue; }
                        writes.push({ r, c: p.c, cell: outcome.kind === "cell" ? outcome.cell : NULL_CELL });
                    }
                    if (writes.length > 0) writeCells(writes, "pasted");
                    const wide = Math.max(1, laid.width);
                    dispatchStore({ t: "patch", patch: {
                        selEnd: { r: eff.r + matrix.length - 1, c: Math.min(colCount - 1, eff.c + wide - 1) },
                        msg: `Pasted ${matrix.length}×${matrix[0]?.length ?? 0} from clipboard${skipped > 0 ? ` · ${skipped} unrecognised` : ""}`,
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
                    const meta = columns.list[eff.c];
                    const sel: SheetSelectionValue = {
                        rowId: it !== undefined && it.kind === "real" ? some(it.row.id) : none,
                        key: meta !== undefined ? some(meta.key) : none,
                    } as SheetSelectionValue;
                    queueMicrotask(() => onSelectFn(sel));
                    break;
                }
                case "scroll.to": {
                    const bi = rowSpace.bodyIndexOf[eff.r];
                    if (bi !== undefined) setScrollTarget(bi);
                    break;
                }
                case "schedule.suggest":
                    // The copilot runner (P4).
                    break;
            }
        }
    }, [writeCells, deleteRows, columns, readOnly, cellAt, colCount, parseCtxFor, onSelectFn, rowAt, rowSpace, store.ui.sel]);
    const drainedFx = useRef(0);
    useLayoutEffect(() => {
        if (store.fxSeq === drainedFx.current) return;
        drainedFx.current = store.fxSeq;
        runEffects(store.fx);
    }, [store.fxSeq, store.fx, runEffects]);

    // ── Controlled selection (§3.14) ──────────────────────────────────────
    const controlledRowId = selection !== undefined ? getSomeorUndefined(selection.rowId) : undefined;
    const controlledKey = selection !== undefined ? getSomeorUndefined(selection.key) : undefined;
    const controlledR = useMemo(() => {
        if (controlledRowId === undefined) return undefined;
        const bi = body.findIndex((it) => it.kind === "real" && it.row.id === controlledRowId);
        return bi >= 0 ? rowSpace.rowOf[bi] : undefined;
    }, [controlledRowId, body, rowSpace]);
    const controlledC = useMemo(
        () => (controlledKey === undefined ? undefined : columns.list.findIndex((c) => c.key === controlledKey)),
        [controlledKey, columns],
    );
    useEffect(() => {
        if (selection === undefined) return;
        if (controlledR === undefined && (controlledC === undefined || controlledC < 0)) return;
        const current = uiRef.current.sel;
        dispatch({ t: "select.set", r: controlledR ?? current.r, c: controlledC !== undefined && controlledC >= 0 ? controlledC : current.c });
    }, [selection, controlledR, controlledC, dispatch]);

    // ── Input ─────────────────────────────────────────────────────────────
    const dragging = useRef(false);
    useEffect(() => {
        const up = () => { dragging.current = false; };
        window.addEventListener("mouseup", up);
        return () => window.removeEventListener("mouseup", up);
    }, []);
    const onCellDown = useCallback((r: number, c: number, e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragging.current = !e.shiftKey;
        dispatch({ t: "cell.down", r, c, shift: e.shiftKey });
    }, [dispatch]);
    const onCellDouble = useCallback((r: number, c: number) => dispatch({ t: "cell.dbl", r, c }), [dispatch]);
    const onCellEnter = useCallback((r: number, c: number) => {
        if (dragging.current) dispatch({ t: "cell.enter", r, c, dragging: true });
    }, [dispatch]);
    const onRowPick = useCallback((r: number, e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dispatch({ t: "row.pick", r, shift: e.shiftKey });
    }, [dispatch]);
    const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        const meta = e.metaKey || e.ctrlKey;
        // The browser's own clipboard keys become copy / paste events.
        if (meta && (e.key === "c" || e.key === "v" || e.key === "x" || e.key === "a")) return;
        const handled = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Tab", "Enter", "F2", "Escape", "Backspace", "Delete"];
        const printable = e.key.length === 1 && !meta && !e.altKey;
        if (!handled.includes(e.key) && !printable) return;
        e.preventDefault();
        dispatch({ t: "key", key: e.key, shift: e.shiftKey, meta, alt: e.altKey });
    }, [dispatch, store.ui.edit]);
    const onCopy = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        e.preventDefault();
        const rect = selectionRect(store.ui);
        e.clipboardData.setData("text/plain", exportMatrix(cellAt, columns.list, rect));
        dispatchStore({ t: "patch", patch: { msg: `Copied ${rect.r1 - rect.r0 + 1}×${rect.c1 - rect.c0 + 1} to clipboard` } });
    }, [store.ui, cellAt, columns]);
    const onPaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        const text = e.clipboardData.getData("text/plain");
        if (text === "") return;
        e.preventDefault();
        dispatch({ t: "clipboard.paste", text });
    }, [dispatch, store.ui.edit]);

    // ── The editor and the strip ──────────────────────────────────────────
    const edit = ui.edit;
    const editMeta = edit !== null ? columns.list[edit.c] : undefined;
    const editCand = useMemo(() => {
        if (edit === null || editMeta === undefined) return undefined;
        return candidateAt(editMeta, edit.val, edit.hi, candidateCtxFor(edit.r));
    }, [edit, editMeta, candidateCtxFor]);
    const editGhost = edit !== null ? ghostFor(edit.val, editCand) : "";
    const editResolve = edit !== null ? resolveFor(edit.val, editCand) : "";
    const editBadge = useMemo(() => {
        if (edit === null || editMeta === undefined || edit.val.trim() === "") return "";
        const n = candidateList(editMeta, edit.val, candidateCtxFor(edit.r)).length;
        return n > 1 ? `${Math.min(Math.max(edit.hi, 0), n - 1) + 1}/${n}` : "";
    }, [edit, editMeta, candidateCtxFor]);
    const onEditorChange = useCallback((val: string) => dispatch({ t: "editor.change", val }), [dispatch]);
    const onEditorKey = useCallback((k: { key: string; shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }): boolean => {
        const handled = ["Escape", "Enter", "Tab", "ArrowDown", "ArrowUp"];
        dispatch({ t: "editor.key", ...k });
        if (handled.includes(k.key)) return true;
        if (k.alt && (k.key === "]" || k.key === "[")) return true;
        if (k.key === "ArrowRight" && k.atEnd && editGhost !== "") return true;
        return false;
    }, [dispatch, editGhost]);
    const onEditorBlur = useCallback(() => dispatch({ t: "editor.blur" }), [dispatch]);
    const onStripPick = useCallback((label: string, i: number) => dispatch({ t: "strip.pick", label, i }), [dispatch]);

    // ── Recipe + layout ───────────────────────────────────────────────────
    const recipe = useSlotRecipe({ key: "sheet" });
    const styles = useMemo(() => recipe({ size } as Record<string, unknown>) as unknown as Styles, [recipe, size]);
    const height = parseCssSize(style !== undefined ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style !== undefined ? getSomeorUndefined(style.maxHeight) : undefined);
    const frameFills = height !== undefined || maxHeight !== undefined;

    // ── Slice chrome ──────────────────────────────────────────────────────
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const slice = chrome !== undefined ? (chrome.slice as SliceBindValue) : undefined;
    useSliceReactivity(slice?.key);
    const affordances = useMemo(() => {
        if (chrome === undefined || slice === undefined) return [] as string[];
        const configured = chrome.affordances.map((a: { type: string }) => a.type);
        return railAffordanceKinds(configured, slice.read()).filter((k) => k !== "brush" && k !== "legend" && k !== "breakdown");
    }, [chrome, slice]);

    const transport = useMemo<SheetTransport | undefined>(() => (pagedSource === undefined ? undefined : {
        loaded: paging.rows.length,
        total: paging.total,
        loading: paging.loading,
    }), [pagedSource, paging.rows.length, paging.total, paging.loading]);

    const strip = useMemo(() => {
        if (edit === null || editMeta === undefined) return buildStrip({ edit: null, meta: undefined, candidates: undefined, today, baseDate: undefined, unit: undefined, customPreview: undefined });
        const pctx = parseCtxFor(edit.r, editMeta);
        const it = rowAt(edit.r);
        const driverKey = driverKeyOf(it !== undefined && it.kind === "real" ? it.row : undefined, driverColumn);
        let customPreview: SheetCellValue | null | undefined;
        if (editMeta.kind === "custom" && edit.val.trim() !== "") {
            const out = parseCell(editMeta, edit.val, pctx);
            customPreview = out.kind === "cell" ? out.cell : null;
        }
        return buildStrip({
            edit, meta: editMeta, candidates: pctx, today,
            baseDate: pctx.baseDate,
            unit: driverKey !== undefined ? editMeta.uom?.get(driverKey) : undefined,
            customPreview,
        });
    }, [edit, editMeta, today, parseCtxFor, rowAt, driverColumn]);

    const wr = wholeRows(ui, colCount);
    const hint = wr !== null
        ? `${wr.r1 - wr.r0 + 1} row${wr.r1 - wr.r0 === 0 ? "" : "s"} selected · ⌫ deletes them · ⌘C copies`
        : "⏎ edit · esc cancel · click a row number to select it · ⌘C / ⌘V round-trips with Excel";

    // ── Viewport → the driver (paged) ─────────────────────────────────────
    const reportViewport = paging.reportViewport;
    const reportRange = useCallback((
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
    ) => {
        const mid = Math.floor((range.startIndex + range.endIndex) / 2);
        const item = body[center?.index ?? mid] ?? body[range.startIndex];
        if (item === undefined) return;
        let at: SheetViewport;
        if (item.kind === "band") at = { kind: "band", at: item.band.at, px: center?.withinPx };
        else at = { kind: "row", offset: item.position };
        reportViewport(at, isScrolling);
    }, [body, reportViewport]);

    // ── Rows ──────────────────────────────────────────────────────────────
    const rect = selectionRect(ui);
    const editorNode = useMemo<ReactNode>(() => edit !== null && editMeta !== undefined
        ? (
            <SheetEditor
                styles={styles}
                value={edit.val}
                ghost={editGhost}
                resolve={editResolve}
                badge={editBadge}
                error={edit.err}
                focus={editorFocus}
                ariaLabel={editMeta.header}
                onChange={onEditorChange}
                onKey={onEditorKey}
                onBlur={onEditorBlur}
            />
        )
        : null, [edit, editMeta, styles, editGhost, editResolve, editBadge, editorFocus, onEditorChange, onEditorKey, onEditorBlur]);
    const renderRow = useCallback((i: number): ReactNode => {
        const item = body[i];
        if (item === undefined) return null;
        if (item.kind === "band") return <SheetBandRow styles={styles} band={item.band} loading={paging.loading} />;
        const r = rowSpace.rowOf[i] ?? -1;
        const inRangeRow = ui.selEnd !== null && r >= rect.r0 && r <= rect.r1;
        return (
            <SheetRow
                styles={styles}
                columns={columns}
                registers={registers}
                driverColumn={driverColumn}
                gridTemplate={gridTemplate}
                rowPx={rowPx}
                r={r}
                number={item.position + 1}
                row={item.kind === "real" ? item.row : undefined}
                linkIn={false}
                selC={ui.sel.r === r ? ui.sel.c : undefined}
                range={inRangeRow ? { c0: rect.c0, c1: rect.c1 } : undefined}
                picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                hit={false}
                editor={edit !== null && edit.r === r ? { c: edit.c, node: editorNode } : undefined}
                onCellDown={onCellDown}
                onCellDouble={onCellDouble}
                onCellEnter={onCellEnter}
                onRowPick={onRowPick}
            />
        );
    }, [body, styles, paging.loading, rowSpace, ui.selEnd, ui.sel, rect, columns, registers, driverColumn, gridTemplate, rowPx, wr, edit, editorNode, onCellDown, onCellDouble, onCellEnter, onRowPick]);

    if (paging.error !== undefined) {
        return (
            <Box css={styles.diagnostic} data-sheet-error>
                {`NO ROWS — the paged source could not be read. ${paging.error}`}
            </Box>
        );
    }

    const header = <SheetHeader styles={styles} columns={columns.list} gridTemplate={gridTemplate} />;
    const content = (
        <Box css={styles.root} data-sheet data-sheet-partial={transport !== undefined && !exhausted ? "" : undefined}
            {...(frameFills ? { style: { height, maxHeight } } : {})}>
            {(chrome !== undefined || transport !== undefined) && (
                <SheetToolbar styles={styles} slice={slice} affordances={affordances} count="" partial={transport !== undefined && !exhausted} />
            )}
            <Box
                ref={cardRef}
                css={styles.card}
                tabIndex={0}
                data-sheet-card
                role="grid"
                aria-rowcount={rowCount}
                aria-colcount={colCount}
                onKeyDown={onKeyDown}
                onCopy={onCopy}
                onPaste={onPaste}
                {...(frameFills ? { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } : {})}
            >
                <VirtualRows
                    height={undefined}
                    maxHeight={undefined}
                    fillParent={frameFills}
                    header={header}
                    footer={<Box height={`${BOTTOM_PAD_PX}px`} />}
                    count={body.length}
                    estimateSize={(i) => {
                        const item = body[i];
                        if (item === undefined) return rowPx;
                        return item.kind === "band" ? Math.max(BAND_MIN_PX, item.band.px) : rowPx;
                    }}
                    renderRow={renderRow}
                    minWidth={`${minWidth}px`}
                    headerZIndex={6}
                    scrollToIndex={scrollTarget}
                    onRangeChange={pagedSource !== undefined ? reportRange : undefined}
                    sizeVersion={paging.sizeVersion}
                    rootCss={{ overflowX: "auto" }}
                />
            </Box>
            <SheetStrip styles={styles} model={strip} onPick={onStripPick} />
            <SheetFooter styles={styles} items={value.footer} hint={hint} message={ui.msg} transport={transport} />
        </Box>
    );

    const densityTag = getSomeorUndefined(value.density)?.type;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{content}</DensityProvider>
        : content;
}, (prev, next) => sheetRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
