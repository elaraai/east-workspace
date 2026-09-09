/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraSheet` — the planning spreadsheet (`Sheet Spec.md` §6): decode,
 * the row source (both arms), the local data layer (edits over the decoded
 * rows until the host writes back), THE state machine, the effect runner,
 * the copilot runner (§6.2) and the shell — toolbar · sticky two-line header
 * · virtualised rows · the docked strip · the footer.
 *
 * The interactive-state pattern, at sheet scale: every edit lands in local
 * state immediately (the sheet is never inert without a bound callback) and
 * reaches the host through `onEdit` in a microtask; a new decoded value
 * resets the local layer, so a host that writes back through `onUpdate` sees
 * its own rows come around with the edit applied.
 *
 * `equalFor` treats every function value as equal, so the memo guard cannot
 * see a swapped provider or `onEdit`; every function is taken from the
 * latest value on each render (the Table / Plan rule, §6.2), and the
 * copilot's memo is keyed on the value's identity.
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
    bodyIndexOfId, buildBody, cellIsBlank, cellText, densityOf, driverKeyOf, indexColumns, indexRegisters, latencyOf, parseWidth, rowIsBlank, withProposals,
    type SheetBodyItem, type SheetColumnMeta,
} from "./model.js";
import { useSheetPaging, type SheetViewport } from "./paging.js";
import { candidateAt, candidateList, ghostFor, resolveFor, type CandidateContext } from "./candidates.js";
import { editText, parseCell, type ParseContext } from "./parse/index.js";
import { usedKeys, resolveMember as resolveVocabMember } from "./link/grammar.js";
import { linkEntryCandidates, grammarLine, membersUnder, type LinkCandidate } from "./link/predict.js";
import { namedCount, arityMeta, type Counted } from "./link/arity.js";
import { useSheetLinks } from "./use-links.js";
import { todayUtc } from "./parse/date.js";
import { exportMatrix, layoutPaste, parseMatrix } from "./clipboard.js";
import {
    initialSheetStore, sheetStoreReducer, selectionRect, wholeRows, provisionalCell, nextTargetOf, fillOrder, blankRowId, isBlankRowId,
    type EditSource, type SheetEffect, type SheetEvent, type SheetMachineCtx, type Suggestions,
} from "./sheet-state.js";
import { runSuggest, SuggestMemo, LATENCY_MS, type FillColumn, type WireProvider } from "./suggest.js";
import { InFlight, trackWork } from "./suggest-async.js";
import { SheetHeader } from "./Header.js";
import { SheetRow, SheetBandRow, SheetProposalRow } from "./Rows.js";
import { SheetEditor, type EditorFocusRequest, type LinkEditorView } from "./Editor.js";
import { SheetStrip, buildStrip, type StripAction, type StripLinkInput, type StripSuggestInput } from "./Strip.js";
import { SheetFooter, type SheetTransport } from "./Footer.js";
import { SheetToolbar } from "./Toolbar.js";
import type { SheetCellValue, SheetContextValue, SheetEditValue, SheetLinkValue, SheetMemberValue, SheetRootValue, SheetRowValue, SheetSelectionValue } from "./values.js";

export type { SheetRootValue, SheetRowValue, SheetCellValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

const sheetRootEqual = equalFor(Sheet.Types.Root);
const cellEqual = equalFor(Sheet.Types.Cell);

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

/** The body index of an anchor — a real row by id, a blank padding row by its synthetic id. */
function anchorBodyIndex(body: readonly SheetBodyItem[], anchorId: string): number {
    if (!isBlankRowId(anchorId)) return bodyIndexOfId(body, anchorId);
    const position = Number(anchorId.slice(anchorId.indexOf(":") + 1));
    return body.findIndex((it) => it.kind === "blank" && it.position === position);
}

/** One copilot request — a run after a delay, or a result to deliver once the rows have rendered. */
interface SuggestRequest {
    seq: number;
    rowId: string;
    ms: number;
    ready?: Suggestions;
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

    // The copilot's declaration: the columns' fill providers and the proposers, as wire functions (§4.8).
    const suggestDecl = useMemo(() => getSomeorUndefined(value.suggest), [value.suggest]);
    const fillColumns = useMemo<FillColumn[]>(() => columns.list.map((m) => ({
        key: m.key, kind: m.kind, editable: m.editable && m.kind !== "stamped", providers: m.raw.fill as unknown as WireProvider[],
    })), [columns]);
    const proposers = useMemo<WireProvider[]>(() => (suggestDecl?.propose ?? []) as unknown as WireProvider[], [suggestDecl]);
    const ahead = Number(suggestDecl?.ahead ?? 2n);
    const triggers = useMemo(() => new Set(suggestDecl?.triggers ?? []), [suggestDecl]);
    const copilotOn = !readOnly && (proposers.length > 0 || fillColumns.some((c) => c.providers.length > 0));
    // The memo empties on a new value: it may carry new provider functions equalFor cannot see.
    const suggestMemo = useRef(new SuggestMemo());
    useEffect(() => { suggestMemo.current.clear(); }, [value]);
    const inflight = useRef(new InFlight());

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
    // The layer as of the last write — several writes in one effect batch build on each other.
    const layerRef = useRef(layer);
    layerRef.current = layer;
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
    const bodyBase = useMemo<SheetBodyItem[]>(() => buildBody({
        rows, rowsOffset, blanks: blanks + ui.appended, exhausted,
        total: paging.total, head: paging.head, tail: paging.tail,
    }), [rows, rowsOffset, blanks, ui.appended, exhausted, paging.total, paging.head, paging.tail]);
    // The copilot's proposed rows sit under their anchor, outside the row space.
    const body = useMemo<SheetBodyItem[]>(() => {
        const sugg = ui.sugg;
        if (sugg === null || sugg.rows.length === 0) return bodyBase;
        return withProposals(bodyBase, anchorBodyIndex(bodyBase, sugg.anchorId), sugg.rows);
    }, [bodyBase, ui.sugg]);
    // Row space — the body without its bands and proposals.
    const rowSpace = useMemo(() => {
        const bodyIndexOf: number[] = [];
        const rowOf: number[] = new Array<number>(body.length).fill(-1);
        body.forEach((it, i) => {
            if (it.kind === "band" || it.kind === "proposal") return;
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
    const rowOf = useCallback((id: string): number | undefined => {
        const bi = anchorBodyIndex(body, id);
        if (bi < 0) return undefined;
        const r = rowSpace.rowOf[bi];
        return r === undefined || r < 0 ? undefined : r;
    }, [body, rowSpace]);
    const idAt = useCallback((r: number): string | undefined => {
        const it = rowAt(r);
        if (it === undefined) return undefined;
        return it.kind === "real" ? it.row.id : it.kind === "blank" ? blankRowId(it.position) : undefined;
    }, [rowAt]);

    // ── What a transition may ask ─────────────────────────────────────────
    const candidateCtxFor = useCallback((r: number): CandidateContext => {
        const it = rowAt(r);
        return { registers, rows, rowIndex: it !== undefined && it.kind === "real" ? it.residentIndex : -1, driverColumn };
    }, [rowAt, registers, rows, driverColumn]);
    /** The wire context over a row — the copilot's, a check's, a custom parse's (§4.4). */
    const wireContextOf = useCallback((row: SheetRowValue | undefined, residentIndex: number, position: number, rowsNow: readonly SheetRowValue[]): SheetContextValue => {
        const driverKey = driverKeyOf(row, driverColumn);
        return {
            rowIndex: BigInt(residentIndex),
            rowId: row?.id ?? "",
            offset: BigInt(position),
            row: row?.cells ?? new Map(columns.list.map((c) => [c.key, NULL_CELL])),
            rows: rowsNow as SheetRowValue[],
            rowsOffset: BigInt(rowsOffset),
            partial: !exhausted,
            driver: driverKey !== undefined ? some(driverKey) : none,
            today,
        } as SheetContextValue;
    }, [driverColumn, columns, rowsOffset, exhausted, today]);
    const wireContextFor = useCallback((r: number): SheetContextValue => {
        const it = rowAt(r);
        const row = it !== undefined && it.kind === "real" ? it.row : undefined;
        const position = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.position : rowsOffset + rows.length;
        return wireContextOf(row, it !== undefined && it.kind === "real" ? it.residentIndex : rows.length, position, rows);
    }, [rowAt, rows, rowsOffset, wireContextOf]);
    // The link editor predicts from the column's pending fill (B§4.5).
    const predictedLink = useCallback((r: number, key: string): SheetLinkValue | undefined => {
        const sugg = ui.sugg;
        if (sugg === null || sugg.anchorId !== idAt(r)) return undefined;
        const f = sugg.fill.get(key);
        return f !== undefined && f.cell.type === "Link" ? (f.cell.value as SheetLinkValue) : undefined;
    }, [ui.sugg, idAt]);
    const links = useSheetLinks({ columns, registers, driver, driverColumn, body, rowAt, predictedLink });
    const { linkVocabularies, linkColumns, linkCellCtx, linkCtxFor } = links;
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
            linkVocab: meta.kind === "link" || meta.kind === "set" ? linkVocabularies.get(meta.key) : undefined,
        };
    }, [rowAt, candidateCtxFor, today, wireContextFor, linkVocabularies]);

    const ctx = useMemo<SheetMachineCtx>(() => ({
        rowCount,
        colCount,
        lensActive: false,
        canAppend: exhausted && !readOnly,
        editableAt: (r, c) => {
            if (readOnly) return false;
            const meta = columns.list[c];
            const it = rowAt(r);
            if (meta === undefined || it === undefined || it.kind === "band" || it.kind === "proposal") return false;
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
        linkAt: linkCtxFor,
        rowOf,
        idAt,
        columnOf: (key) => { const c = columns.list.findIndex((m) => m.key === key); return c < 0 ? undefined : c; },
        driverKeyAt: (r) => { const it = rowAt(r); return driverKeyOf(it !== undefined && it.kind === "real" ? it.row : undefined, driverColumn); },
        driverColumn,
        numberAt: (r) => { const it = rowAt(r); return it !== undefined && it.kind !== "band" ? it.position + 1 : r + 1; },
    }), [rowCount, colCount, exhausted, readOnly, columns, rowAt, parseCtxFor, candidateCtxFor, cellAt, linkCtxFor, rowOf, idAt, driverColumn]);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const uiRef = useRef(ui);
    uiRef.current = ui;
    const dispatch = useCallback((e: SheetEvent) => dispatchStore({ t: "event", e, ctx: ctxRef.current }), []);

    // The rows changed underneath: clamp the ring, drop an editor whose row went, a suggestion whose anchor went.
    useEffect(() => { dispatch({ t: "rows.changed" }); }, [rows, rowCount, colCount, dispatch]);

    // ── Writes — the local layer, then the host ───────────────────────────
    const emitEdit = useCallback((edit: SheetEditValue) => {
        if (onEditFn !== undefined) queueMicrotask(() => onEditFn(edit));
    }, [onEditFn]);
    /**
     * Write cells: a real row's commits land in the layer's edits (one
     * `commit` event per changed cell, each carrying the row AFTER it); a
     * blank row's cells become one inserted row (one `insert` event). Returns
     * the row-space index the FIRST inserted row landed on, so the ring can
     * follow a blank row that just became real, and the ids of the rows
     * written, in order.
     */
    const writeCells = useCallback((writes: readonly { r: number; c: number; cell: SheetCellValue }[], source: EditSource): { firstInserted: number | undefined; ids: string[] } => {
        const byRow = new Map<number, { c: number; cell: SheetCellValue }[]>();
        for (const w of writes) {
            const list = byRow.get(w.r) ?? [];
            list.push({ c: w.c, cell: w.cell });
            byRow.set(w.r, list);
        }
        const base = layerRef.current;
        const rowsNow = applyLayer(sourceRows, base);
        const edits = new Map(base.edits);
        const appended = [...base.appended];
        const events: SheetEditValue[] = [];
        const ids: string[] = [];
        let lastId = rowsNow.length > 0 ? rowsNow[rowsNow.length - 1]!.id : undefined;
        let firstInserted: number | undefined;
        let inserted = 0;
        const src = variant(source, null) as SheetEditValue extends { value: { source: infer S } } ? S : never;
        const taken = (id: string) => rowsNow.some((x) => x.id === id) || appended.some((x) => x.id === id);
        for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
            const it = rowAt(r);
            if (it !== undefined && it.kind === "real") {
                let row = edits.get(it.row.id) ?? it.row;
                for (const w of byRow.get(r)!) {
                    const meta = columns.list[w.c];
                    if (meta === undefined) continue;
                    if (cellEqual(row.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                    row = withCell(row, meta.key, w.cell);
                    events.push(variant("commit", { rowId: row.id, offset: BigInt(it.position), key: meta.key, row, source: src }) as SheetEditValue);
                }
                if (row !== it.row) edits.set(row.id, row);
                ids.push(row.id);
                continue;
            }
            if (it !== undefined && (it.kind === "band" || it.kind === "proposal")) continue;
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
            ids.push(row.id);
            if (firstInserted === undefined) firstInserted = rowsNow.length + inserted;
            inserted += 1;
        }
        if (events.length === 0) return { firstInserted: undefined, ids };
        const next: LocalLayer = { edits, appended, removed: base.removed };
        layerRef.current = next;
        setLayer(() => next);
        for (const e of events) emitEdit(e);
        return { firstInserted, ids };
    }, [sourceRows, rowAt, columns, newRowIdFn, setLayer, emitEdit]);
    const deleteRows = useCallback((r0: number, r1: number) => {
        const ids: string[] = [];
        for (let r = r0; r <= r1; r++) {
            const it = rowAt(r);
            if (it !== undefined && it.kind === "real") ids.push(it.row.id);
        }
        if (ids.length === 0) return 0;
        const next: LocalLayer = { ...layerRef.current, removed: new Set([...layerRef.current.removed, ...ids]) };
        layerRef.current = next;
        setLayer(() => next);
        emitEdit(variant("remove", { rowIds: ids }) as SheetEditValue);
        return ids.length;
    }, [rowAt, setLayer, emitEdit]);
    /** Insert one proposed row after a row: into the blank slot below it (B§5.2), else appended. */
    const insertProposal = useCallback((afterR: number, cells: ReadonlyMap<string, SheetCellValue>): { id: string; r: number } | undefined => {
        const writes: { c: number; cell: SheetCellValue }[] = [];
        columns.list.forEach((meta, c) => {
            if (!meta.editable || meta.kind === "stamped") return;
            const cell = cells.get(meta.key);
            if (cell !== undefined && !cellIsBlank(cell)) writes.push({ c, cell });
        });
        if (writes.length === 0) return undefined;
        const next = rowAt(afterR + 1);
        let target: number;
        if (next !== undefined && next.kind === "blank") target = afterR + 1;
        else if (next !== undefined && next.kind === "real" && rowIsBlank(next.row, columns)) target = afterR + 1;
        else {
            const firstBlank = rowSpace.bodyIndexOf.findIndex((bi) => body[bi]!.kind === "blank");
            target = firstBlank < 0 ? rowCount : firstBlank;
        }
        const res = writeCells(writes.map((w) => ({ r: target, c: w.c, cell: w.cell })), "pattern");
        const id = res.ids[0];
        if (id === undefined) return undefined;
        return { id, r: res.firstInserted ?? target };
    }, [columns, rowAt, rowSpace, body, rowCount, writeCells]);

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
        let row: SheetRowValue = item.kind === "real" ? item.row : blankRow("", columns.list);
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
        if (rowIsBlank(row, columns)) {
            dispatch({ t: "suggest.ready", anchorId: rowId, sugg: null });
            return;
        }
        const residentIndex = item.kind === "real" ? item.residentIndex : rows.length;
        const rowsNow = item.kind === "real" ? rows.map((x, i) => (i === residentIndex ? row : x)) : [...rows, row];
        const below = rowAt(r + 1);
        const nextBusy = below !== undefined && below.kind === "real" && !rowIsBlank(below.row, columns);
        const outcome = runSuggest({
            anchorId: rowId, row, skipKey, columns: fillColumns, proposers, ahead, nextBusy,
            driverKey: driverKeyOf(row, driverColumn), driverColumn, rejected: current.rejected,
            contextOf: (rw) => wireContextOf(rw, residentIndex, item.position, rowsNow),
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
    }, []);

    // ── Effects ───────────────────────────────────────────────────────────
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [editorFocus, setEditorFocus] = useState<EditorFocusRequest>({ seq: 0, selectAll: true });
    const [scrollTarget, setScrollTarget] = useState<number | undefined>(undefined);
    const runEffects = useCallback((effects: readonly SheetEffect[]) => {
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
        for (const eff of effects) {
            switch (eff.t) {
                case "write": {
                    const meta = columns.list[eff.c];
                    const res = writeCells([{ r: eff.r, c: eff.c, cell: eff.cell ?? NULL_CELL }], "typed");
                    afterWrite(eff.r, res, meta !== undefined && (triggers.size === 0 || triggers.has(meta.key)));
                    break;
                }
                case "write.many": {
                    const res = writeCells(eff.writes.map((w) => ({ r: eff.r, c: w.c, cell: w.cell })), eff.source);
                    afterWrite(eff.r, res, true);
                    break;
                }
                case "insert.rows": {
                    let afterR = eff.anchorR;
                    let lastId: string | undefined;
                    for (const p of eff.rows) {
                        const landed = insertProposal(afterR, p.cells);
                        if (landed === undefined) break;
                        lastId = landed.id;
                        afterR = landed.r;
                    }
                    if (lastId === undefined) break;
                    // Re-anchor on the row just taken: the rest are already waiting, else look forward again.
                    if (eff.rest.length > 0) requestReady(lastId, { anchorId: lastId, fill: new Map(), rows: eff.rest, pending: [] });
                    else if (copilotOn) requestRun(lastId, 0);
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
                case "schedule.suggest": {
                    // The copilot runs against the row as it would be, after the kind's latency (B§3).
                    if (!copilotOn) break;
                    const edit = store.ui.edit;
                    if (edit === null) break;
                    const id = idAt(edit.r);
                    if (id === undefined) break;
                    const kind = columns.list[edit.c]?.kind ?? "text";
                    requestRun(id, eff.latency === "instant" || latencyOf(kind) === "instant" ? LATENCY_MS.instant : LATENCY_MS.idle);
                    break;
                }
            }
        }
    }, [writeCells, deleteRows, insertProposal, columns, readOnly, cellAt, colCount, parseCtxFor, onSelectFn, rowAt, rowSpace, store.ui.sel, store.ui.edit, idAt, copilotOn, triggers, requestRun, requestReady, dispatch]);
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
    // A range drag is a press followed by pointer MOVEMENT; a mouseenter with
    // no movement (the sheet moved under a stationary pointer — a paged
    // window landing, a fill changing a row) never extends the range.
    const pressed = useRef(false);
    const dragging = useRef(false);
    useEffect(() => {
        const up = () => { pressed.current = false; dragging.current = false; };
        const move = (e: globalThis.MouseEvent) => { if (pressed.current && (e.buttons & 1) !== 0) dragging.current = true; };
        window.addEventListener("mouseup", up);
        window.addEventListener("mousemove", move);
        return () => { window.removeEventListener("mouseup", up); window.removeEventListener("mousemove", move); };
    }, []);
    const onCellDown = useCallback((r: number, c: number, e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        pressed.current = !e.shiftKey;
        dragging.current = false;
        dispatch({ t: "cell.down", r, c, shift: e.shiftKey });
    }, [dispatch]);
    const onCellDouble = useCallback((r: number, c: number) => dispatch({ t: "cell.dbl", r, c }), [dispatch]);
    const onCellEnter = useCallback((r: number, c: number) => dispatch({ t: "cell.enter", r, c, dragging: dragging.current }), [dispatch]);
    const onRowPick = useCallback((r: number, e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dispatch({ t: "row.pick", r, shift: e.shiftKey });
    }, [dispatch]);
    const onTake = useCallback((key: string) => dispatch({ t: "fill.take", key }), [dispatch]);
    const onFillRow = useCallback(() => dispatch({ t: "fill.row" }), [dispatch]);
    const onProposalPick = useCallback((i: number) => dispatch({ t: "proposal.pick", i }), [dispatch]);
    const onProposalAccept = useCallback((i: number) => dispatch({ t: "proposal.take", i }), [dispatch]);
    const onProposalReject = useCallback((i: number) => dispatch({ t: "proposal.reject", i }), [dispatch]);
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
        if (edit === null || editMeta === undefined || edit.link !== undefined) return undefined;
        return candidateAt(editMeta, edit.val, edit.hi, candidateCtxFor(edit.r));
    }, [edit, editMeta, candidateCtxFor]);
    const editGhost = edit !== null ? ghostFor(edit.val, editCand) : "";
    const editResolve = edit !== null ? resolveFor(edit.val, editCand) : "";
    const editBadge = useMemo(() => {
        if (edit === null || editMeta === undefined || edit.val.trim() === "" || edit.link !== undefined) return "";
        const n = candidateList(editMeta, edit.val, candidateCtxFor(edit.r)).length;
        return n > 1 ? `${Math.min(Math.max(edit.hi, 0), n - 1) + 1}/${n}` : "";
    }, [edit, editMeta, candidateCtxFor]);
    const onEditorChange = useCallback((val: string) => dispatch({ t: "editor.change", val }), [dispatch]);
    const linkEdit = edit?.link;
    const linkEditCtx = useMemo(() => (edit !== null && linkEdit !== undefined ? linkCtxFor(edit.r, edit.c) : undefined), [edit, linkEdit, linkCtxFor]);
    const linkArmed = useMemo(() => (edit !== null && linkEdit !== undefined && linkEditCtx !== undefined ? linkEditCtx.candidateAt(edit.val, edit.hi, linkEdit.groups) : undefined), [edit, linkEdit, linkEditCtx]);
    const linkGhostText = edit !== null && linkArmed !== undefined && linkArmed.label.toLowerCase().startsWith(edit.val.trim().toLowerCase()) && edit.val.trim() !== ""
        ? linkArmed.label.slice(edit.val.trim().length) : "";
    const onEditorKey = useCallback((k: { key: string; shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }): boolean => {
        const current = uiRef.current.edit;
        dispatch({ t: "editor.key", ...k });
        if (["Escape", "Enter", "Tab"].includes(k.key)) return true;
        if (k.alt && (k.key === "]" || k.key === "[")) return true;
        if (current !== null && current.link !== undefined) {
            const link = current.link;
            const chips = link.groups[0].length + link.groups[1].length;
            if (k.shift && (k.key === "ArrowLeft" || k.key === "ArrowRight") && chips > 0 && (link.chipSel !== null || current.val === "")) return true;
            if ((k.key === "Backspace" || k.key === "Delete") && (link.chipSel !== null || current.val === "")) return true;
            if (k.key === "ArrowRight" && k.atEnd && (linkGhostText !== "" || (current.val === "" && link.side === 0))) return true;
            if (k.key === "ArrowLeft" && current.val === "" && link.side === 1) return true;
            return false;
        }
        if (k.key === "ArrowDown" || k.key === "ArrowUp") return true;
        if (k.key === "ArrowRight" && k.atEnd && editGhost !== "") return true;
        return false;
    }, [dispatch, editGhost, linkGhostText]);
    const onEditorBlur = useCallback(() => dispatch({ t: "editor.blur" }), [dispatch]);
    const onStripAction = useCallback((a: StripAction) => {
        switch (a.kind) {
            case "candidate": dispatch({ t: "strip.pick", label: a.label, i: a.i }); break;
            case "members": dispatch({ t: "strip.pick", label: a.label, i: -1, members: a.members }); break;
            case "fill": dispatch({ t: "fill.take", key: a.key }); break;
            case "rows": dispatch({ t: "proposal.take", i: (uiRef.current.sugg?.rows.length ?? 1) - 1 }); break;
        }
    }, [dispatch]);
    const onHalfDown = useCallback((side: 0 | 1) => dispatch({ t: "half.down", side }), [dispatch]);
    const linkView = useMemo<LinkEditorView | undefined>(() => {
        if (edit === null || linkEdit === undefined || linkEditCtx === undefined || editMeta === undefined) return undefined;
        const lo = linkEdit.chipSel === null ? -1 : Math.min(linkEdit.chipSel.anchor, linkEdit.chipSel.focus);
        const hi = linkEdit.chipSel === null ? -2 : Math.max(linkEdit.chipSel.anchor, linkEdit.chipSel.focus);
        return {
            side: linkEdit.side,
            halves: linkEditCtx.halves,
            groups: linkEdit.groups,
            chipSel: linkEdit.chipSel === null ? null : { lo, hi },
            predicted: [linkEditCtx.predicted(0, linkEdit.groups, linkEdit.side === 0 ? edit.val : ""), linkEditCtx.predicted(1, linkEdit.groups, linkEdit.side === 1 ? edit.val : "")],
            vocab: linkVocabularies.get(editMeta.key),
            hop: linkEdit.hop,
            single: editMeta.kind === "set",
        };
    }, [edit, linkEdit, linkEditCtx, editMeta, linkVocabularies]);

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

    // ── The copilot's surfaces: the anchor's fills, the next target, the proposal rows ──
    const anchorR = useMemo(() => (ui.sugg !== null ? rowOf(ui.sugg.anchorId) : undefined), [ui.sugg, rowOf]);
    const nextTarget = useMemo(() => nextTargetOf(ui, ctx), [ui, ctx]);
    const suggested = useMemo<StripSuggestInput | undefined>(() => {
        if (edit !== null || ui.sugg === null) return undefined;
        const sugg = ui.sugg;
        const fills = fillOrder(sugg, ctx).map(({ key }) => {
            const f = sugg.fill.get(key)!;
            const meta = columns.byKey.get(key);
            return { key, header: meta?.header ?? key, text: meta !== undefined ? cellText(f.cell, meta) : "", meta: f.meta, armed: nextTarget?.key === key };
        });
        const pending = sugg.pending.map((key) => ({ key, header: key === "rows" ? "rows" : columns.byKey.get(key)?.header ?? key }));
        return { fills, rows: sugg.rows.length, rowsMeta: sugg.rows[0]?.meta ?? "", pending };
    }, [edit, ui.sugg, ctx, columns, nextTarget]);

    const strip = useMemo(() => {
        if (edit === null || editMeta === undefined) return buildStrip({ edit: null, meta: undefined, candidates: undefined, today, baseDate: undefined, unit: undefined, customPreview: undefined, suggested });
        const pctx = parseCtxFor(edit.r, editMeta);
        const it = rowAt(edit.r);
        const driverKey = driverKeyOf(it !== undefined && it.kind === "real" ? it.row : undefined, driverColumn);
        let customPreview: SheetCellValue | null | undefined;
        if (editMeta.kind === "custom" && edit.val.trim() !== "") {
            const out = parseCell(editMeta, edit.val, pctx);
            customPreview = out.kind === "cell" ? out.cell : null;
        }
        let link: StripLinkInput | undefined;
        if (linkEdit !== undefined && linkEditCtx !== undefined) {
            const lc = linkColumns.get(editMeta.key);
            const vocab = lc?.vocab;
            const used = vocab !== undefined ? usedKeys([...linkEdit.groups[0], ...linkEdit.groups[1]], vocab) : new Set<string>();
            let arity = "";
            if (lc?.arity !== undefined && vocab !== undefined && (lc.arity.half === "from" ? 0 : 1) === linkEdit.side) {
                let implied: Counted | undefined;
                try {
                    const out = lc.arity.implied(wireContextFor(edit.r));
                    if (out.type === "some") {
                        const v = out.value as { n: bigint; key: string };
                        implied = { n: Number(v.n), key: v.key };
                    }
                } catch (err) {
                    console.error(`[Sheet] arity rule failed on column "${editMeta.key}":`, err);
                }
                arity = arityMeta(implied, namedCount(linkEdit.groups[linkEdit.side], vocab));
            }
            const predicted = linkEditCtx.predicted(linkEdit.side, linkEdit.groups, edit.val);
            // A counted member is the plan-level answer; naming the members is the
            // schedule-level one — offered as the alternative, never assumed (B§4.5).
            let enumerate: LinkCandidate | undefined;
            const counted = predicted.find((m) => m.type === "counted");
            if (counted !== undefined && vocab !== undefined) {
                const cnt = counted.value as { n: bigint; key: string };
                const parent = resolveVocabMember(cnt.key, vocab);
                const free = parent !== undefined ? membersUnder(parent, vocab, used).slice(0, Number(cnt.n)) : [];
                if (free.length === Number(cnt.n) && free.length > 0) {
                    enumerate = {
                        label: free.map((m) => m.key).join(", "),
                        meta: "name them now instead of leaving them to the scheduler",
                        members: free.map((m) => ({ type: "identified", value: { key: m.key } }) as SheetMemberValue),
                    };
                }
            }
            const fill = ui.sugg !== null && ui.sugg.anchorId === idAt(edit.r) ? ui.sugg.fill.get(editMeta.key) : undefined;
            link = {
                side: linkEdit.side,
                candidates: linkEditCtx.candidates(edit.val, linkEdit.groups),
                armed: linkArmed,
                entry: vocab !== undefined ? linkEntryCandidates(vocab, used) : [],
                predicted,
                enumerate,
                predictedMeta: fill?.meta ?? "",
                arity,
                grammar: vocab !== undefined ? grammarLine(vocab) : "",
            };
        }
        return buildStrip({
            edit, meta: editMeta, candidates: pctx, today,
            baseDate: pctx.baseDate,
            unit: driverKey !== undefined ? editMeta.uom?.get(driverKey) : undefined,
            customPreview,
            link,
        });
    }, [edit, editMeta, today, parseCtxFor, rowAt, driverColumn, linkEdit, linkEditCtx, linkArmed, linkColumns, wireContextFor, suggested, ui.sugg, idAt]);

    const wr = wholeRows(ui, colCount);
    const hasFills = ui.sugg !== null && ui.sugg.fill.size > 0;
    const hasRows = ui.sugg !== null && ui.sugg.rows.length > 0;
    const hint = ui.gsel !== null
        ? "⏎ adds the selected row · ⌫ rejects it · esc deselects"
        : wr !== null
            ? `${wr.r1 - wr.r0 + 1} row${wr.r1 - wr.r0 === 0 ? "" : "s"} selected · ⌫ deletes them · ⌘C copies`
            : hasFills
                ? "⇥ walks the fills · ⌘⏎ fills the row · ⌘⇧⏎ takes everything · esc dismisses"
                : hasRows
                    ? "⏎ adds the next suggested row · click a row to select it · esc dismisses"
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
                ghost={linkView !== undefined ? linkGhostText : editGhost}
                resolve={editResolve}
                badge={editBadge}
                error={edit.err}
                focus={editorFocus}
                ariaLabel={editMeta.header}
                link={linkView}
                onChange={onEditorChange}
                onKey={onEditorKey}
                onBlur={onEditorBlur}
                onHalfDown={onHalfDown}
            />
        )
        : null, [edit, editMeta, styles, editGhost, editResolve, editBadge, editorFocus, onEditorChange, onEditorKey, onEditorBlur, linkView, linkGhostText, onHalfDown]);
    const renderRow = useCallback((i: number): ReactNode => {
        const item = body[i];
        if (item === undefined) return null;
        if (item.kind === "band") return <SheetBandRow styles={styles} band={item.band} loading={paging.loading} />;
        if (item.kind === "proposal") {
            return (
                <SheetProposalRow
                    styles={styles}
                    columns={columns}
                    registers={registers}
                    driverColumn={driverColumn}
                    gridTemplate={gridTemplate}
                    rowPx={rowPx}
                    index={item.index}
                    number={item.position + 1}
                    cells={item.cells}
                    meta={item.meta}
                    picked={ui.gsel === item.index}
                    linkCtx={linkCellCtx}
                    onPick={onProposalPick}
                    onAccept={onProposalAccept}
                    onReject={onProposalReject}
                />
            );
        }
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
                first={i === 0}
                row={item.kind === "real" ? item.row : undefined}
                linkCtx={linkCellCtx}
                selC={ui.sel.r === r ? ui.sel.c : undefined}
                range={inRangeRow ? { c0: rect.c0, c1: rect.c1 } : undefined}
                picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                hit={false}
                editor={edit !== null && edit.r === r ? { c: edit.c, node: editorNode } : undefined}
                fills={anchorR === r && ui.sugg !== null ? ui.sugg.fill : undefined}
                nextTargetC={nextTarget !== null && nextTarget.r === r ? nextTarget.c : undefined}
                hoverC={ui.hover !== null && ui.hover.r === r ? ui.hover.c : undefined}
                onCellDown={onCellDown}
                onCellDouble={onCellDouble}
                onCellEnter={onCellEnter}
                onRowPick={onRowPick}
                onTake={onTake}
                onFillRow={onFillRow}
            />
        );
    }, [body, styles, paging.loading, rowSpace, ui.selEnd, ui.sel, ui.sugg, ui.gsel, ui.hover, rect, columns, registers, driverColumn, gridTemplate, rowPx, wr, edit, editorNode, anchorR, nextTarget, onCellDown, onCellDouble, onCellEnter, onRowPick, onTake, onFillRow, onProposalPick, onProposalAccept, onProposalReject, linkCellCtx]);

    if (paging.error !== undefined) {
        return (
            <Box css={styles.diagnostic} data-sheet-error>
                {`NO ROWS — the paged source could not be read. ${paging.error}`}
            </Box>
        );
    }

    const header = <SheetHeader styles={styles} columns={columns.list} gridTemplate={gridTemplate} />;
    const content = (
        <Box css={styles.root} data-sheet data-sheet-partial={transport !== undefined && !exhausted ? "" : undefined} data-copilot={copilotOn ? "" : undefined}
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
                    scrollAlign="auto"
                    onRangeChange={pagedSource !== undefined ? reportRange : undefined}
                    sizeVersion={paging.sizeVersion}
                    rootCss={{ overflowX: "auto" }}
                />
            </Box>
            <SheetStrip styles={styles} model={strip} onAction={onStripAction} />
            <SheetFooter styles={styles} items={value.footer} hint={hint} message={ui.msg} transport={transport} />
        </Box>
    );

    const densityTag = getSomeorUndefined(value.density)?.type;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{content}</DensityProvider>
        : content;
}, (prev, next) => sheetRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
