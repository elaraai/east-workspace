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
 *
 * Grouped rows (#740): the source rows are GROUPS; the body draws each
 * group's band over its lines (pseudo rows tagged with their group), one
 * blank line per open group and the `+ plan` ghost band. A write on a line
 * rewrites its group (`lineCommit` / `lineInsert` / `lineRemove` carry the
 * whole group after the edit, a line's address as its position or key); a
 * band cell commits the group; the ghost band's title inserts a group.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type MouseEvent, type KeyboardEvent, type ClipboardEvent, type ReactNode } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { ArrayType, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { boundSliceConfig } from "../../platform/slice/index.js";
import { parseCssSize } from "../../style/parse-size.js";
import { DensityProvider } from "../../contracts/density.js";
import { useCoarsePointer } from "../../contracts/adaptive.js";
import { useDensityHeights } from "../shared/helpers.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity.js";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { VirtualRows } from "../virtual-rows.js";
import {
    BAND_MIN_PX, BOTTOM_PAD_PX, DEFAULT_BLANKS, DEFAULT_GUTTER_PX, GHOST_BAND_ID, NEW_LINE_KEY, NULL_CELL, TITLE_KEY,
    blankIdOf, bodyIndexOfId, buildBody, cellIsBlank, cellText, densityOf, driverKeyOf, groupBandPx, indexColumns, indexGroup, indexRegisters, isRowSpace,
    bodyOffsets, latencyOf, lineAddress, lineId, lineIndexOfPosition, linePosition, lineRowsOf, parseWidth, rowIsBlank, stickyBandIndex, withLine, withProposals, withoutLines,
    type LineGroup, type SheetBodyItem, type SheetColumnMeta,
} from "./model.js";
import { useSheetPaging, type SheetViewport } from "./paging.js";
import { useSheetSeek } from "./use-seek.js";
import { lensCount, lensGaps, lensHits, lensVisible, narrowingActive, nextReach, type LensGap } from "./lens.js";
import { candidateAt, candidateList, ghostFor, resolveFor, type CandidateContext } from "./candidates.js";
import { editText, parseCell, type ParseContext } from "./parse/index.js";
import { parseDate } from "./parse/date.js";
import { usedKeys, resolveMember as resolveVocabMember } from "./link/grammar.js";
import { linkEntryCandidates, grammarLine, membersUnder, type LinkCandidate } from "./link/predict.js";
import { namedCount, arityMeta, type Counted } from "./link/arity.js";
import { useSheetLinks } from "./use-links.js";
import { todayUtc } from "./parse/date.js";
import { exportMatrix, layoutPaste, parseMatrix } from "./clipboard.js";
import {
    initialSheetStore, sheetStoreReducer, selectionRect, wholeRows, provisionalCell, nextTargetOf, fillOrder, isBlankRowId,
    type EditSource, type LensContext, type SheetEffect, type SheetEvent, type SheetMachineCtx, type SliceStateValue, type Suggestions,
} from "./sheet-state.js";
import { runSuggest, SuggestMemo, LATENCY_MS, type FillColumn } from "./suggest.js";
import { InFlight, trackWork } from "./suggest-async.js";
import { SheetHeader } from "./Header.js";
import { SheetRow, SheetBandRow, SheetGapRow, SheetProposalRow, SheetGroupRow, SheetGhostBandRow } from "./Rows.js";
import { SheetTabs, type SheetTabView } from "./Tabs.js";
import { SheetEditor, type EditorFocusRequest, type LinkEditorView } from "./Editor.js";
import { SheetStrip, buildStrip, type StripAction, type StripLinkInput, type StripSuggestInput } from "./Strip.js";
import { SheetFooter, type SheetTransport } from "./Footer.js";
import { SheetToolbar } from "./Toolbar.js";
import type { SheetCellValue, SheetContextValue, SheetEditValue, SheetLinkValue, SheetMemberValue, SheetProposerValue, SheetRootValue, SheetRowValue, SheetSelectionValue, SheetViewValue } from "./values.js";

export type { SheetRootValue, SheetRowValue, SheetCellValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The gutter's floor on a coarse pointer: the number, then two 26 px buttons (a proposal's ✓ ×) with room to tap. */
const COARSE_GUTTER_PX = 96;

const sheetRootEqual = equalFor(Sheet.Types.Root);
const cellEqual = equalFor(Sheet.Types.Cell);
const sliceStateEqual = equalFor(Slice.Types.State) as (a: SliceStateValue, b: SliceStateValue) => boolean;
const viewsEqual = equalFor(ArrayType(Sheet.Types.View)) as (a: readonly SheetViewValue[], b: readonly SheetViewValue[]) => boolean;

/** The narrowing with nothing active — what the whole-sheet tab writes; the presentation fields (cohort registry, breakdown, visibility, resolution) stay. */
function clearNarrowing(state: SliceStateValue): SliceStateValue {
    return { ...state, range: none, filters: [], activeCohorts: new Set<string>(), search: none } as SliceStateValue;
}

/** A view's hover title (B§8) — its query and context, and the gestures it takes. */
function viewTitle(view: SheetViewValue): string {
    const q = view.narrowing.search.type === "some" ? view.narrowing.search.value.trim() : "";
    const ctx = Number(view.context);
    const what = q !== "" ? `"${q}"${ctx > 0 ? ` · ±${ctx}` : ""}` : view.narrowing.filters.length > 0 || view.narrowing.activeCohorts.size > 0 ? "a filter" : "no filter — the whole sheet";
    return `${what} · live · double-click renames · middle-click closes`;
}

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

/** A fresh row — every declared cell blank; no lines and no band (a flat row, or a line as a pseudo row). */
function blankRow(id: string, columns: readonly SheetColumnMeta[]): SheetRowValue {
    return { id, owned: false, cells: new Map(columns.map((c) => [c.key, NULL_CELL])), lines: [], band: none };
}

let mintCounter = 0;
/** A renderer-minted row id — unique per session, never a source id. */
function mintId(taken: (id: string) => boolean): string {
    for (;;) {
        const id = `sheet-${Date.now().toString(36)}-${(mintCounter++).toString(36)}`;
        if (!taken(id)) return id;
    }
}

/** A renderer-minted line key (#740) — never a source index, unique within the group. */
function mintLineKey(group: SheetRowValue): string {
    for (;;) {
        const key = `${NEW_LINE_KEY}${(mintCounter++).toString(36)}`;
        if (!group.lines.some((l) => l.key === key)) return key;
    }
}

/** The body index of an anchor — a real row (or a group's band) by id, a blank row or blank line by its synthetic id, the ghost band by its own. */
function anchorBodyIndex(body: readonly SheetBodyItem[], anchorId: string): number {
    if (anchorId === GHOST_BAND_ID) return body.findIndex((it) => it.kind === "groupBlank");
    if (!isBlankRowId(anchorId)) return bodyIndexOfId(body, anchorId);
    return body.findIndex((it) => it.kind === "blank" && blankIdOf(it) === anchorId);
}

/** One cell write the component turns into a wire event; `extra` names the k-th NEW line a write past a group's blank line lands on (a paste, #740 G9). */
interface CellWrite {
    r: number;
    c: number;
    cell: SheetCellValue;
    extra?: number | undefined;
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
    // Grouped rows (#740): the band's cells and the title span.
    const group = useMemo(() => {
        const g = getSomeorUndefined(value.group);
        return g !== undefined ? indexGroup(g, columns) : undefined;
    }, [value.group, columns]);
    const titleMeta = group?.cells.get(TITLE_KEY);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const size = densityOf(value);
    const rowPx = useDensityHeights(size).row;
    const bandPx = groupBandPx(size);
    const readOnly = getSomeorUndefined(value.readOnly) ?? false;
    // A grouped sheet pads each open group with ONE blank line and ends with the ghost band; neither on a read-only sheet.
    const blanks = group !== undefined ? (readOnly ? 0 : 1) : Number(getSomeorUndefined(value.blanks) ?? BigInt(DEFAULT_BLANKS));
    // On a coarse pointer the gutter's buttons grow to 26 px (the recipe's
    // `_coarse` rungs), so the gutter keeps a floor wide enough for two.
    const coarse = useCoarsePointer();
    const gutterPx = Math.max(parseWidth(style !== undefined ? getSomeorUndefined(style.gutterWidth) : undefined) ?? DEFAULT_GUTTER_PX, coarse ? COARSE_GUTTER_PX : 0);
    // The LAST column absorbs the frame's slack (the Table's #323 stretch rule): a
    // sheet narrower than its frame fills it instead of leaving a dead strip.
    const gridTemplate = useMemo(() => `${gutterPx}px ${columns.list.map((c, i) => (i === columns.list.length - 1 ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(" ")}`, [gutterPx, columns]);
    const minWidth = gutterPx + columns.totalWidth;
    const today = useMemo(() => todayUtc(), []);

    // Callbacks — taken from the latest value on every render (the equalFor rule).
    const onEditFn = useMemo(() => getSomeorUndefined(value.onEdit), [value.onEdit]);
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onViewsChangeFn = useMemo(() => getSomeorUndefined(value.onViewsChange), [value.onViewsChange]);
    const newRowIdFn = useMemo(() => getSomeorUndefined(value.newRowId), [value.newRowId]);
    const newLineKeyFn = useMemo(() => getSomeorUndefined(value.newLineKey), [value.newLineKey]);
    const selection = useMemo(() => getSomeorUndefined(value.selection), [value.selection]);
    const activeView = useMemo(() => getSomeorUndefined(value.activeView), [value.activeView]);

    // ── Slice chrome — the lens reads the bound slice's narrowing (§3.8) ──
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const slice = chrome !== undefined ? (chrome.slice as SliceBindValue) : undefined;
    const sliceVersion = useSliceReactivity(slice?.key);
    // The narrowing and the config, live from the store: a slice write moves
    // the version, and nothing else here does (#611).
    const sliceState = useMemo<SliceStateValue | undefined>(() => (slice !== undefined ? (slice.read() as SliceStateValue) : undefined),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of `slice.read()`: the store moves, no prop does (#611)
        [slice, sliceVersion]);
    const sliceConfig = useMemo(() => (slice !== undefined ? boundSliceConfig(slice.key) : undefined),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the config is refreshed on every bind, which the version tracks
        [slice, sliceVersion]);
    const affordances = useMemo(() => {
        if (chrome === undefined || slice === undefined || sliceState === undefined) return [] as string[];
        const configured = chrome.affordances.map((a: { type: string }) => a.type);
        return railAffordanceKinds(configured, sliceState as never).filter((k) => k !== "brush" && k !== "legend" && k !== "breakdown");
    }, [chrome, slice, sliceState]);
    const lensOn = slice !== undefined && sliceConfig !== undefined && narrowingActive(sliceState);

    // ── The views — the local layer over `views` until the host writes back ──
    // The layer sits over the host's views by VALUE, not identity: every host
    // re-render decodes a fresh array, and a tab the host has not written back
    // yet must survive a row write-back.
    const [viewsState, setViewsState] = useState<{ over: readonly SheetViewValue[]; views: readonly SheetViewValue[] }>({ over: value.views, views: value.views });
    const views = viewsState.over === value.views || viewsEqual(viewsState.over, value.views) ? viewsState.views : value.views;
    const viewsRef = useRef(views);
    viewsRef.current = views;

    // The copilot's declaration: the columns' fill providers and the proposers, as wire functions (§4.8).
    const suggestDecl = useMemo(() => getSomeorUndefined(value.suggest), [value.suggest]);
    const fillColumns = useMemo<FillColumn[]>(() => columns.list.map((m) => ({
        key: m.key, kind: m.kind, editable: m.editable && m.kind !== "stamped", providers: m.raw.fill,
    })), [columns]);
    const proposers = useMemo<SheetProposerValue[]>(() => suggestDecl?.propose ?? [], [suggestDecl]);
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
    const paging = useSheetPaging(pagedSource, rowPx, bandPx);
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
        // column) — the prototype's "type an activity on the empty row"; a
        // grouped sheet: the first group's blank line.
        const c = Math.max(0, driverColumn !== undefined ? columns.list.findIndex((col) => col.key === driverColumn) : 0);
        const first = decodedRows?.[0];
        const firstFolded = first !== undefined && getSomeorUndefined(first.band)?.folded === true;
        const r = group !== undefined ? (first !== undefined && !firstFolded ? 1 + first.lines.length : 0) : decodedRows?.length ?? 0;
        return initialSheetStore({ r, c }, activeView ?? null);
    });
    const ui = store.ui;

    // ── The lens (B§8) — hits from the slice engine over the resident rows ──
    // A grouped sheet's hits are LINES: one slice per resident group, its
    // gaps inside the group, a group with no hits folding to its band (G10).
    const lens = useMemo(() => {
        if (!lensOn || sliceState === undefined || sliceConfig === undefined) return undefined;
        if (group !== undefined) {
            const groups = rows.map((g, i) => {
                const lineRows = lineRowsOf(g);
                const position = rowsOffset + i;
                const hits = lensHits(sliceState, sliceConfig, lineRows, columns.list);
                const positions = lineRows.map((_r, j) => linePosition(position, j));
                const visible = lensVisible(hits, positions, ui.lens.context, ui.lens.reveals);
                return { hits, visible, gaps: lensGaps(hits, visible, positions) };
            });
            return { hits: groups.flatMap((s) => s.hits), visible: groups.flatMap((s) => s.visible), gaps: [], groups };
        }
        const positions = rows.map((_r, i) => rowsOffset + i);
        const hits = lensHits(sliceState, sliceConfig, rows, columns.list);
        const visible = lensVisible(hits, positions, ui.lens.context, ui.lens.reveals);
        return { hits, visible, gaps: lensGaps(hits, visible, positions), groups: undefined };
    }, [lensOn, sliceState, sliceConfig, rows, rowsOffset, columns, group, ui.lens.context, ui.lens.reveals]);

    // ── The body ──────────────────────────────────────────────────────────
    const folds = ui.lens.folds;
    const foldedOf = useCallback((row: SheetRowValue): boolean => folds.get(row.id) ?? getSomeorUndefined(row.band)?.folded ?? false, [folds]);
    const bodyBase = useMemo<SheetBodyItem[]>(() => buildBody({
        rows, rowsOffset, blanks: group !== undefined ? blanks : blanks + ui.appended, exhausted,
        total: paging.total, head: paging.head, tail: paging.tail,
        lens: lens === undefined ? undefined : lens.groups !== undefined ? { groups: lens.groups } : { hits: lens.hits, visible: lens.visible, gaps: lens.gaps },
        // The `+ plan` ghost band shows only where a new plan can land — a bound edit channel (G6).
        grouped: group !== undefined ? { foldedOf, ghost: onEditFn !== undefined && !readOnly } : undefined,
    }), [rows, rowsOffset, blanks, ui.appended, exhausted, paging.total, paging.head, paging.tail, lens, group, foldedOf, onEditFn, readOnly]);
    // The copilot's proposed rows sit under their anchor, outside the row space.
    const body = useMemo<SheetBodyItem[]>(() => {
        const sugg = ui.sugg;
        if (sugg === null || sugg.rows.length === 0) return bodyBase;
        return withProposals(bodyBase, anchorBodyIndex(bodyBase, sugg.anchorId), sugg.rows);
    }, [bodyBase, ui.sugg]);
    // Row space — the body without its bands, gaps and proposals.
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
        if (it.kind === "groupBlank") return c < group.titleSpan ? titleMeta : undefined;
        return col;
    }, [columns, group, titleMeta, rowAt]);
    const cellAt = useCallback((r: number, c: number): SheetCellValue | undefined => {
        const it = rowAt(r);
        const meta = metaAt(r, c);
        if (it === undefined || meta === undefined) return undefined;
        if (it.kind === "real" || it.kind === "group") return it.row.cells.get(meta.key);
        return undefined;
    }, [rowAt, metaAt]);
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
            case "groupBlank": return GHOST_BAND_ID;
            default: return undefined;
        }
    }, [rowAt]);
    /** The row-space index of a group's blank line (#740). */
    const blankLineRowOf = useCallback((groupId: string): number | undefined => {
        const r = rowSpace.bodyIndexOf.findIndex((bi) => { const it = body[bi]; return it !== undefined && it.kind === "blank" && it.group?.row.id === groupId; });
        return r < 0 ? undefined : r;
    }, [rowSpace, body]);

    // ── What a transition may ask ─────────────────────────────────────────
    // A line's candidates rank against ITS GROUP's lines (the row above is the line above).
    const candidateCtxFor = useCallback((r: number): CandidateContext => {
        const it = rowAt(r);
        const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
        if (lg !== undefined) return { registers, rows: lineRowsOf(lg.row), rowIndex: lg.index, driverColumn };
        return { registers, rows, rowIndex: it !== undefined && it.kind === "real" ? it.residentIndex : -1, driverColumn };
    }, [rowAt, registers, rows, driverColumn]);
    /** The wire context over a row — the copilot's, a check's, a custom parse's (§4.4); a line's names its group and its key (#740). */
    const wireContextOf = useCallback((row: SheetRowValue | undefined, residentIndex: number, position: number, rowsNow: SheetRowValue[], lg?: LineGroup): SheetContextValue => {
        const driverKey = driverKeyOf(row, driverColumn);
        return {
            rowIndex: BigInt(lg !== undefined ? lg.index : residentIndex),
            rowId: lg !== undefined ? lg.row.id : row?.id ?? "",
            offset: BigInt(position),
            line: lg !== undefined ? some(lg.key === "" ? NEW_LINE_KEY : lg.key) : none,
            row: row?.cells ?? new Map(columns.list.map((c) => [c.key, NULL_CELL])),
            rows: rowsNow,
            rowsOffset: BigInt(rowsOffset),
            partial: !exhausted,
            driver: driverKey !== undefined ? some(driverKey) : none,
            today,
        };
    }, [driverColumn, columns, rowsOffset, exhausted, today]);
    const wireContextFor = useCallback((r: number): SheetContextValue => {
        const it = rowAt(r);
        const row = it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row : undefined;
        const position = it !== undefined && it.kind !== "band" && it.kind !== "gap" ? it.position : rowsOffset + rows.length;
        const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
        return wireContextOf(row, it !== undefined && (it.kind === "real" || it.kind === "group") ? it.residentIndex : rows.length, position, rows, lg);
    }, [rowAt, rows, rowsOffset, wireContextOf]);
    // The link editor predicts from the column's pending fill (B§4.5).
    const predictedLink = useCallback((r: number, key: string): SheetLinkValue | undefined => {
        const sugg = ui.sugg;
        if (sugg === null || sugg.anchorId !== idAt(r)) return undefined;
        const f = sugg.fill.get(key);
        return f !== undefined && f.cell.type === "Link" ? f.cell.value : undefined;
    }, [ui.sugg, idAt]);
    const links = useSheetLinks({ columns, registers, driver, driverColumn, body, rowAt, predictedLink });
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
            today,
            baseDate,
            wireContext: meta.kind === "custom" ? wireContextFor(r) : undefined,
            linkVocab: meta.kind === "link" || meta.kind === "set" ? linkVocabularies.get(meta.key) : undefined,
        };
    }, [rowAt, candidateCtxFor, today, wireContextFor, linkVocabularies]);

    // The whole-sheet narrowing, and whether the active tab has drifted from its view (B§8).
    const emptyNarrowing = useMemo(() => (sliceState !== undefined ? clearNarrowing(sliceState) : undefined), [sliceState]);
    const activeViewValue = useMemo(() => (ui.tabs.active === null ? undefined : views.find((v) => v.id === ui.tabs.active)), [views, ui.tabs.active]);
    const dirty = activeViewValue !== undefined && sliceState !== undefined && !sliceStateEqual(activeViewValue.narrowing, sliceState);

    const ctx = useMemo<SheetMachineCtx>(() => ({
        rowCount,
        colCount,
        lensActive: lensOn,
        // A grouped sheet never appends past its ghost band — each group has its own blank line.
        canAppend: exhausted && !readOnly && group === undefined,
        editableAt: (r, c) => {
            if (readOnly) return false;
            const it = rowAt(r);
            if (it === undefined || !isRowSpace(it)) return false;
            const meta = metaAt(r, c);
            if (meta === undefined) return false;
            if (it.kind === "groupBlank") return group !== undefined && c < group.titleSpan;
            if (!meta.editable || meta.kind === "stamped") return false;
            return true;
        },
        kindAt: (r, c) => metaAt(r, c)?.kind ?? "text",
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
            return meta === undefined ? "" : editText(cellAt(r, c), meta);
        },
        // A band's cells are never link cells, whatever column they sit under.
        linkAt: (r, c) => { const k = rowAt(r)?.kind; return k === "group" || k === "groupBlank" ? undefined : linkCtxFor(r, c); },
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
        rowNameAt: (r) => {
            const it = rowAt(r);
            const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
            if (lg === undefined) return `row ${it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.position + 1 : r + 1}`;
            const title = lg.row.cells.get(TITLE_KEY);
            return `line ${lg.number} of ${title !== undefined && title.type === "String" && title.value !== "" ? title.value : "the plan"}`;
        },
        views,
        narrowing: sliceState,
        emptyNarrowing,
        dirty,
        rowKindAt: (r) => {
            const it = rowAt(r);
            if (it === undefined) return undefined;
            switch (it.kind) {
                case "real": return "row";
                case "blank": return "blank";
                case "group": return "group";
                case "groupBlank": return "groupBlank";
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
            if (k === "groupBlank") return { c0: 0, c1: Math.max(0, colCount - 1) };
            return k === "group" && c < group.titleSpan ? { c0: 0, c1: group.titleSpan - 1 } : undefined;
        },
    }), [rowCount, colCount, lensOn, exhausted, readOnly, group, columns, rowAt, metaAt, parseCtxFor, candidateCtxFor, cellAt, linkCtxFor, rowOf, idAt, driverColumn, views, sliceState, emptyNarrowing, dirty]);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const uiRef = useRef(ui);
    uiRef.current = ui;
    const dispatch = useCallback((e: SheetEvent) => dispatchStore({ t: "event", e, ctx: ctxRef.current }), []);

    // The rows changed underneath: clamp the ring, drop an editor whose row went, a suggestion whose anchor went.
    useEffect(() => { dispatch({ t: "rows.changed" }); }, [rows, rowCount, colCount, dispatch]);

    // The slice's narrowing changed underneath the lens (a keystroke in the
    // search, a filter): reveals reset and the ring returns to the top — unless
    // the sheet wrote that narrowing itself (a tab switch, a revert), which
    // carries its own lens.
    const expectedNarrowing = useRef<SliceStateValue | undefined>(undefined);
    const seenNarrowing = useRef<SliceStateValue | undefined>(sliceState);
    useEffect(() => {
        const prev = seenNarrowing.current;
        seenNarrowing.current = sliceState;
        if (sliceState === undefined || prev === undefined) return;
        if (sliceStateEqual(prev, sliceState)) return;
        const expected = expectedNarrowing.current;
        expectedNarrowing.current = undefined;
        if (expected !== undefined && sliceStateEqual(expected, sliceState)) return;
        dispatch({ t: "lens.narrowed" });
    }, [sliceState, dispatch]);

    // The initial view opens on mount; a host that moves `activeView` later is followed.
    const openedView = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (activeView === undefined || activeView === openedView.current) return;
        openedView.current = activeView;
        if (viewsRef.current.some((v) => v.id === activeView)) dispatch({ t: "tab.open", id: activeView });
    }, [activeView, dispatch]);

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
    const writeCells = useCallback((writes: readonly CellWrite[], source: EditSource): { firstInserted: number | undefined; ids: string[] } => {
        // Writes group by row, and by the extra new line they land on past a group's blank line.
        const byRow = new Map<string, { r: number; extra: number; list: { c: number; cell: SheetCellValue }[] }>();
        for (const w of writes) {
            const extra = w.extra ?? 0;
            const k = `${w.r}#${extra}`;
            const entry = byRow.get(k) ?? { r: w.r, extra, list: [] };
            entry.list.push({ c: w.c, cell: w.cell });
            byRow.set(k, entry);
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
        const src = variant(source, null);
        const taken = (id: string) => rowsNow.some((x) => x.id === id) || appended.some((x) => x.id === id);
        // A group's latest row through the layer (#740), and how a rewritten group lands back in it.
        const currentGroup = (g: SheetRowValue): SheetRowValue => edits.get(g.id) ?? appended.find((x) => x.id === g.id) ?? g;
        const setGroup = (g: SheetRowValue) => {
            const at = appended.findIndex((x) => x.id === g.id);
            if (at >= 0) appended[at] = g;
            else edits.set(g.id, g);
        };
        const entries = [...byRow.values()].sort((a, b) => a.r - b.r || a.extra - b.extra);
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
                        const meta = columns.list[w.c];
                        if (meta === undefined) continue;
                        if (cellEqual(cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                        cells.set(meta.key, w.cell);
                        changed = true;
                        g = withLine(g, lg.key, new Map(cells));
                        events.push(variant("lineCommit", { rowId: g.id, offset: BigInt(it.position), line: lineAddress(group.keyed, lg.key, lg.index), key: meta.key, row: g, source: src }));
                    }
                    if (changed) setGroup(g);
                    ids.push(it.row.id);
                    continue;
                }
                // A group's blank line (or the k-th line past it): one line inserted at the end of the group.
                if (it.kind === "blank" && it.group !== undefined) {
                    const g0 = currentGroup(it.group.row);
                    const cells = new Map<string, SheetCellValue>(columns.list.map((c) => [c.key, NULL_CELL]));
                    for (const w of list) {
                        const meta = columns.list[w.c];
                        if (meta !== undefined) cells.set(meta.key, w.cell);
                    }
                    if (columns.list.every((c) => cellIsBlank(cells.get(c.key)))) continue;
                    const key = group.keyed && newLineKeyFn !== undefined ? newLineKeyFn() : mintLineKey(g0);
                    const index = g0.lines.length;
                    const last = g0.lines[index - 1];
                    const g: SheetRowValue = { ...g0, lines: [...g0.lines, { key, cells }] };
                    events.push(variant("lineInsert", {
                        rowId: g.id, offset: BigInt(it.position),
                        after: last !== undefined ? some(lineAddress(group.keyed, last.key, index - 1)) : none,
                        line: lineAddress(group.keyed, key, index), row: g, source: src,
                    }));
                    setGroup(g);
                    ids.push(lineId(g.id, key));
                    if (firstInserted === undefined) firstInserted = r + extra;
                    continue;
                }
                // A band cell: the group's own field commits.
                if (it.kind === "group") {
                    const g0 = currentGroup(it.row);
                    let g = g0;
                    for (const w of list) {
                        const meta = metaAt(r, w.c);
                        if (meta === undefined || !meta.editable) continue;
                        if (cellEqual(g.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                        const cells = new Map(g.cells);
                        cells.set(meta.key, w.cell);
                        g = { ...g, cells };
                        events.push(variant("commit", { rowId: g.id, offset: BigInt(it.position), key: meta.key, row: g, source: src }));
                    }
                    if (g !== g0) setGroup(g);
                    ids.push(g.id);
                    continue;
                }
                // The ghost band: a new group after the last one; the ring lands on its blank line.
                if (it.kind === "groupBlank") {
                    const cells = new Map<string, SheetCellValue>([...group.cells.keys()].map((k) => [k, NULL_CELL]));
                    for (const w of list) {
                        const meta = metaAt(r, w.c);
                        if (meta !== undefined) cells.set(meta.key, w.cell);
                    }
                    if ([...cells.values()].every(cellIsBlank)) continue;
                    const g: SheetRowValue = { id: newRowIdFn !== undefined ? newRowIdFn() : mintId(taken), owned: false, cells, lines: [], band: some({ sub: "", folded: false }) };
                    appended.push(g);
                    events.push(variant("insert", { afterRowId: lastId !== undefined ? some(lastId) : none, row: g, source: src }));
                    lastId = g.id;
                    ids.push(g.id);
                    if (firstInserted === undefined) firstInserted = r + 1;
                    inserted += 1;
                    continue;
                }
            }
            if (it !== undefined && it.kind === "real") {
                let row = edits.get(it.row.id) ?? it.row;
                for (const w of list) {
                    const meta = columns.list[w.c];
                    if (meta === undefined) continue;
                    if (cellEqual(row.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                    row = withCell(row, meta.key, w.cell);
                    events.push(variant("commit", { rowId: row.id, offset: BigInt(it.position), key: meta.key, row, source: src }));
                }
                if (row !== it.row) edits.set(row.id, row);
                ids.push(row.id);
                continue;
            }
            if (it !== undefined && !isRowSpace(it)) continue;
            if (group !== undefined) continue;
            // A blank row (or a row past the padding): one inserted row.
            let row = blankRow(newRowIdFn !== undefined ? newRowIdFn() : mintId(taken), columns.list);
            for (const w of list) {
                const meta = columns.list[w.c];
                if (meta !== undefined) row = withCell(row, meta.key, w.cell);
            }
            if (columns.list.every((c) => cellIsBlank(row.cells.get(c.key)))) continue;
            appended.push(row);
            events.push(variant("insert", { afterRowId: lastId !== undefined ? some(lastId) : none, row, source: src }));
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
    }, [sourceRows, rowAt, columns, group, metaAt, newRowIdFn, newLineKeyFn, setLayer, emitEdit]);
    /**
     * Delete whole rows. On a grouped sheet (#740, G7) lines in the range
     * leave their groups (`lineRemove`); with no line in the range, the
     * empty groups whose bands are in it leave the sheet (`remove`) — the
     * two-step ladder: the lines, then the plan.
     */
    const deleteRows = useCallback((r0: number, r1: number): { n: number; what: "rows" | "lines" | "plans"; emptiedBandR: number | undefined } => {
        const base = layerRef.current;
        if (group !== undefined) {
            const currentGroup = (g: SheetRowValue): SheetRowValue => base.edits.get(g.id) ?? base.appended.find((x) => x.id === g.id) ?? g;
            const byGroup = new Map<string, { row: SheetRowValue; position: number; keys: string[]; addresses: string[] }>();
            const bands: { row: SheetRowValue }[] = [];
            for (let r = r0; r <= r1; r++) {
                const it = rowAt(r);
                if (it === undefined) continue;
                if (it.kind === "real" && it.group !== undefined) {
                    const entry = byGroup.get(it.group.row.id) ?? { row: it.group.row, position: it.position, keys: [], addresses: [] };
                    entry.keys.push(it.group.key);
                    entry.addresses.push(lineAddress(group.keyed, it.group.key, it.group.index));
                    byGroup.set(it.group.row.id, entry);
                } else if (it.kind === "group") {
                    bands.push({ row: it.row });
                }
            }
            if (byGroup.size > 0) {
                const edits = new Map(base.edits);
                const appended = [...base.appended];
                let n = 0;
                // The first plan left empty: the ring selects its band, so ⌫ again removes the plan (G7). Bands sit above their lines, so its row index survives the removal.
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
                        if (bandR !== undefined && bandR >= 0) emptiedBandR = bandR;
                    }
                }
                const next: LocalLayer = { edits, appended, removed: base.removed };
                layerRef.current = next;
                setLayer(() => next);
                return { n, what: "lines", emptiedBandR };
            }
            const ids = bands.filter((b) => currentGroup(b.row).lines.length === 0).map((b) => b.row.id);
            if (ids.length === 0) return { n: 0, what: "plans", emptiedBandR: undefined };
            const next: LocalLayer = { ...base, removed: new Set([...base.removed, ...ids]) };
            layerRef.current = next;
            setLayer(() => next);
            emitEdit(variant("remove", { rowIds: ids }));
            return { n: ids.length, what: "plans", emptiedBandR: undefined };
        }
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
    }, [group, rowAt, body, rowSpace, setLayer, emitEdit]);
    /** Insert one proposed row after a row: into the blank slot below it (B§5.2), else appended; on a grouped sheet into the anchor's group (#740, G11). */
    const insertProposal = useCallback((afterR: number, cells: ReadonlyMap<string, SheetCellValue>, extra = 0): { id: string; r: number } | undefined => {
        const writes: { c: number; cell: SheetCellValue }[] = [];
        columns.list.forEach((meta, c) => {
            if (!meta.editable || meta.kind === "stamped") return;
            const cell = cells.get(meta.key);
            if (cell !== undefined && !cellIsBlank(cell)) writes.push({ c, cell });
        });
        if (writes.length === 0) return undefined;
        if (group !== undefined) {
            const anchor = rowAt(afterR);
            const gid = anchor !== undefined && (anchor.kind === "real" || anchor.kind === "blank") ? anchor.group?.row.id : undefined;
            const blankR = gid !== undefined ? blankLineRowOf(gid) : undefined;
            if (blankR === undefined) return undefined;
            const res = writeCells(writes.map((w) => ({ r: blankR, c: w.c, cell: w.cell, extra })), "pattern");
            const id = res.ids[0];
            return id === undefined ? undefined : { id, r: blankR + extra };
        }
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
    }, [columns, group, rowAt, blankLineRowOf, rowSpace, body, rowCount, writeCells]);

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
        // A line runs against its group (#740): the bridge puts the line in place by its key, so the resident groups pass as they are.
        const lg = item.group;
        const residentIndex = item.kind === "real" ? item.residentIndex : rows.length;
        const rowsNow = lg !== undefined ? rows : item.kind === "real" ? rows.map((x, i) => (i === residentIndex ? row : x)) : [...rows, row];
        const below = rowAt(r + 1);
        const nextBusy = below !== undefined && below.kind === "real" && !rowIsBlank(below.row, columns);
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
    }, []);

    // ── Effects ───────────────────────────────────────────────────────────
    const cardRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
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
                    const meta = metaAt(eff.r, eff.c);
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
                    for (const [i, p] of eff.rows.entries()) {
                        const landed = insertProposal(afterR, p.cells, group !== undefined ? i : 0);
                        if (landed === undefined) break;
                        lastId = landed.id;
                        if (group === undefined) afterR = landed.r;
                    }
                    if (lastId === undefined) break;
                    // Re-anchor on the row just taken: the rest are already waiting, else look forward again.
                    if (eff.rest.length > 0) requestReady(lastId, { anchorId: lastId, fill: new Map(), rows: eff.rest, pending: [] });
                    else if (copilotOn) requestRun(lastId, 0);
                    break;
                }
                case "clear": {
                    const writes: CellWrite[] = [];
                    for (let r = eff.r0; r <= eff.r1; r++) {
                        if (rowAt(r)?.kind === "groupBlank") continue;
                        for (let c = eff.c0; c <= eff.c1; c++) {
                            const meta = metaAt(r, c);
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
                    const out = deleteRows(eff.r0, eff.r1);
                    if (out.n === 0) break;
                    const noun = out.what === "plans" ? "plan" : out.what === "lines" ? "line" : "row";
                    const msg = `Deleted ${out.n} ${noun}${out.n === 1 ? "" : "s"}`;
                    if (out.emptiedBandR !== undefined) {
                        dispatchStore({ t: "patch", patch: {
                            sel: { r: out.emptiedBandR, c: 0 }, selEnd: { r: out.emptiedBandR, c: Math.max(0, colCount - 1) },
                            msg: `${msg} — ⌫ again removes the plan`,
                        } });
                    } else {
                        dispatchStore({ t: "patch", patch: { msg } });
                    }
                    break;
                }
                case "copy": {
                    // A band never copies (G9): a whole-plan selection copies its lines.
                    const text = exportMatrix(cellAt, columns.list, eff, (r) => { const k = rowAt(r)?.kind; return k === "group" || k === "groupBlank"; });
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
                    const writes: CellWrite[] = [];
                    let skipped = 0;
                    // On a grouped sheet a paste lands on the anchor's plan — its lines from the ring, its blank line, then new lines past it — never across a band (G9).
                    const anchor = rowAt(eff.r);
                    const gid = group !== undefined && anchor !== undefined && (anchor.kind === "real" || anchor.kind === "blank") ? anchor.group?.row.id : undefined;
                    if (group !== undefined && gid === undefined) break;
                    const blankR = gid !== undefined ? blankLineRowOf(gid) : undefined;
                    for (const p of laid.cells) {
                        const meta = columns.list[p.c];
                        if (meta === undefined) continue;
                        const r = eff.r + p.dr;
                        const outcome = parseCell(meta, p.text, parseCtxFor(Math.min(r, blankR ?? r), meta));
                        if (outcome.kind === "unrecognised") { skipped += 1; continue; }
                        const cell = outcome.kind === "cell" ? outcome.cell : NULL_CELL;
                        if (gid !== undefined) {
                            const target = rowAt(r);
                            const inPlan = target !== undefined && (target.kind === "real" || target.kind === "blank") && target.group?.row.id === gid;
                            if (inPlan && (blankR === undefined || r <= blankR)) writes.push({ r, c: p.c, cell });
                            else if (blankR !== undefined && r > blankR) writes.push({ r: blankR, c: p.c, cell, extra: r - blankR });
                            else skipped += 1;
                            continue;
                        }
                        writes.push({ r, c: p.c, cell });
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
                    const kind = metaAt(edit.r, edit.c)?.kind ?? "text";
                    requestRun(id, eff.latency === "instant" || latencyOf(kind) === "instant" ? LATENCY_MS.instant : LATENCY_MS.idle);
                    break;
                }
                case "emit.views": {
                    // The views land locally at once (the interactive-state pattern) and reach the host in a microtask.
                    const next = eff.views;
                    setViewsState({ over: value.views, views: next });
                    viewsRef.current = next;
                    if (onViewsChangeFn !== undefined) queueMicrotask(() => onViewsChangeFn(next as SheetViewValue[]));
                    break;
                }
                case "slice.write": {
                    if (slice === undefined) break;
                    // The sheet's own write carries its lens: the change detector must not reset it.
                    expectedNarrowing.current = eff.state;
                    slice.write(eff.state as never);
                    break;
                }
                case "focus.search": {
                    const input = rootRef.current?.querySelector<HTMLInputElement>('[data-slot="toolbar"] input');
                    input?.focus();
                    input?.select();
                    break;
                }
            }
        }
    }, [writeCells, deleteRows, insertProposal, columns, group, metaAt, blankLineRowOf, readOnly, cellAt, colCount, parseCtxFor, onSelectFn, rowAt, rowSpace, store.ui.sel, store.ui.edit, idAt, copilotOn, triggers, requestRun, requestReady, dispatch, value.views, onViewsChangeFn, slice]);
    const drainedFx = useRef(0);
    useLayoutEffect(() => {
        if (store.fxSeq === drainedFx.current) return;
        drainedFx.current = store.fxSeq;
        runEffects(store.fx);
    }, [store.fxSeq, store.fx, runEffects]);

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
        const toSearch = meta && (e.key === "/" || e.key === "f");
        if (!handled.includes(e.key) && !printable && !toSearch) return;
        e.preventDefault();
        dispatch({ t: "key", key: e.key, shift: e.shiftKey, meta, alt: e.altKey });
    }, [dispatch, store.ui.edit]);
    // A band never copies (G9): a whole-plan selection copies its lines.
    const isBandRow = useCallback((r: number) => { const k = rowAt(r)?.kind; return k === "group" || k === "groupBlank"; }, [rowAt]);
    const onCopy = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        e.preventDefault();
        const rect = selectionRect(store.ui);
        e.clipboardData.setData("text/plain", exportMatrix(cellAt, columns.list, rect, isBandRow));
        let copied = 0;
        for (let r = rect.r0; r <= rect.r1; r++) if (!isBandRow(r)) copied += 1;
        dispatchStore({ t: "patch", patch: { msg: `Copied ${copied}×${rect.c1 - rect.c0 + 1} to clipboard` } });
    }, [store.ui, cellAt, columns, isBandRow]);
    const onPaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        const text = e.clipboardData.getData("text/plain");
        if (text === "") return;
        e.preventDefault();
        dispatch({ t: "clipboard.paste", text });
    }, [dispatch, store.ui.edit]);

    // ── Recipe + layout ───────────────────────────────────────────────────
    const recipe = useSlotRecipe({ key: "sheet" });
    const styles = useMemo(() => recipe({ size } as Record<string, unknown>) as unknown as Styles, [recipe, size]);
    const height = parseCssSize(style !== undefined ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style !== undefined ? getSomeorUndefined(style.maxHeight) : undefined);
    const frameFills = height !== undefined || maxHeight !== undefined;

    // ── The editor and the strip ──────────────────────────────────────────
    const edit = ui.edit;
    const editMeta = edit !== null ? metaAt(edit.r, edit.c) : undefined;
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
    // A date column's buffer is its edit form; the date field shows the date it names.
    const editDate = useMemo(() => {
        if (edit === null || editMeta === undefined || editMeta.kind !== "date") return undefined;
        return parseDate(edit.val, { today, base: parseCtxFor(edit.r, editMeta).baseDate }) ?? undefined;
    }, [edit, editMeta, today, parseCtxFor]);
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

    const transport = useMemo<SheetTransport | undefined>(() => (pagedSource === undefined ? undefined : {
        loaded: paging.rows.length,
        total: paging.total,
        loading: paging.loading,
    }), [pagedSource, paging.rows.length, paging.total, paging.loading]);

    // ── The key search over a keyed paged source (§3.13) ──────────────────
    const seek = useSheetSeek(pagedSource, paging.rows, paging.rowsOffset, paging.jumpToElement, paging.clearJump);
    useEffect(() => {
        // The sought row landed: the ring goes to it (no echo — the host hears the move through onSelect).
        if (seek.target === undefined) return;
        // A sought element is a row, or on a grouped sheet a plan — the ring lands on its band.
        const bi = body.findIndex((it) => {
            if (group !== undefined) return it.kind === "group" && it.position === seek.target;
            return it.kind === "real" && it.position === seek.target;
        });
        if (bi < 0) return;
        const r = rowSpace.rowOf[bi];
        if (r === undefined || r < 0) return;
        dispatch({ t: "select.set", r, c: uiRef.current.sel.c });
        seek.clearTarget();
    }, [seek, body, rowSpace, group, dispatch]);

    // ── The view tabs and the lens's chrome (B§8) ─────────────────────────
    // A grouped sheet counts LINES (#740).
    const countedRows = useMemo(() => (group !== undefined ? rows.flatMap((g) => lineRowsOf(g)) : rows), [group, rows]);
    const wholeCount = useMemo(() => countedRows.filter((row) => !rowIsBlank(row, columns)).length, [countedRows, columns]);
    const tabViews = useMemo<SheetTabView[]>(() => {
        if (slice === undefined) return [];
        return views.map((v) => {
            const hits = sliceConfig !== undefined ? lensHits(v.narrowing, sliceConfig, countedRows, columns.list) : [];
            const count = countedRows.filter((row, i) => hits[i] === true && !rowIsBlank(row, columns)).length;
            return { id: v.id, name: v.name, count, title: viewTitle(v) };
        });
    }, [slice, views, sliceConfig, countedRows, columns]);
    const summary = useMemo(() => {
        if (group === undefined) return undefined;
        const lines = countedRows.length;
        return `${rows.length} plan${rows.length === 1 ? "" : "s"} · ${lines} line${lines === 1 ? "" : "s"}`;
    }, [group, rows.length, countedRows.length]);
    const onTabSwitch = useCallback((id: string | null) => dispatch({ t: "tab.switch", id }), [dispatch]);
    const onTabCreate = useCallback(() => dispatch({ t: "tab.create" }), [dispatch]);
    const onTabClose = useCallback((id: string) => dispatch({ t: "tab.close", id }), [dispatch]);
    const onTabRenameStart = useCallback((id: string) => dispatch({ t: "tab.rename.start", id }), [dispatch]);
    const onTabRenameChange = useCallback((val: string) => dispatch({ t: "tab.rename.change", val }), [dispatch]);
    const onTabRenameCommit = useCallback(() => dispatch({ t: "tab.rename.commit" }), [dispatch]);
    const onTabRenameCancel = useCallback(() => dispatch({ t: "tab.rename.cancel" }), [dispatch]);
    const onTabReorder = useCallback((id: string, to: number) => dispatch({ t: "tab.reorder", id, to }), [dispatch]);
    const onContext = useCallback((context: LensContext) => dispatch({ t: "lens.context", context }), [dispatch]);
    const onSearchKey = useCallback((key: string) => { dispatch({ t: "search.key", key }); return true; }, [dispatch]);
    const onReveal = useCallback((gap: LensGap, where: "top" | "bottom" | "both" | "all") => dispatch({ t: "band.reveal", key: gap.key, from: gap.from, to: gap.to, where }), [dispatch]);
    const onFold = useCallback((r: number) => dispatch({ t: "fold.toggle", r }), [dispatch]);
    const lineNumberOf = useCallback((position: number) => lineIndexOfPosition(position) + 1, []);
    const hasQuery = sliceState !== undefined && sliceState.search.type === "some" && sliceState.search.value.trim() !== "";
    const tabsNode = slice !== undefined
        ? (
            <SheetTabs
                styles={styles}
                views={tabViews}
                wholeCount={wholeCount}
                active={ui.tabs.active}
                dirty={dirty}
                hasQuery={hasQuery}
                renaming={ui.tabs.renaming}
                renameVal={ui.tabs.renameVal}
                onSwitch={onTabSwitch}
                onCreate={onTabCreate}
                onClose={onTabClose}
                onRenameStart={onTabRenameStart}
                onRenameChange={onTabRenameChange}
                onRenameCommit={onTabRenameCommit}
                onRenameCancel={onTabRenameCancel}
                onReorder={onTabReorder}
            />
        )
        : undefined;
    const count = lens !== undefined ? lensCount(lens.hits, lens.visible) : "";

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
            if (lc?.arity !== undefined && vocab !== undefined && (lc.arity.half.type === "from" ? 0 : 1) === linkEdit.side) {
                let implied: Counted | undefined;
                try {
                    const out = lc.arity.implied(wireContextFor(edit.r));
                    if (out.type === "some") implied = { n: Number(out.value.n), key: out.value.key };
                } catch (err) {
                    console.error(`[Sheet] arity rule failed on column "${editMeta.key}":`, err);
                }
                arity = arityMeta(implied, namedCount(linkEdit.groups[linkEdit.side], vocab));
            }
            const predicted = linkEditCtx.predicted(linkEdit.side, linkEdit.groups, edit.val);
            // A counted member is the plan-level answer; naming the members is the
            // schedule-level one — offered as the alternative, never assumed (B§4.5).
            let enumerate: LinkCandidate | undefined;
            const counted = predicted.find((m): m is Extract<SheetMemberValue, { type: "counted" }> => m.type === "counted");
            if (counted !== undefined && vocab !== undefined) {
                const n = Number(counted.value.n);
                const parent = resolveVocabMember(counted.value.key, vocab);
                const free = parent !== undefined ? membersUnder(parent, vocab, used).slice(0, n) : [];
                if (free.length === n && free.length > 0) {
                    enumerate = {
                        label: free.map((m) => m.key).join(", "),
                        meta: "name them now instead of leaving them to the scheduler",
                        members: free.map((m) => variant("identified", { key: m.key })),
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
    const ringKind = ctx.rowKindAt?.(ui.sel.r);
    const hint = ui.gsel !== null
        ? "⏎ adds the selected row · ⌫ rejects it · esc deselects"
        : ringKind === "group" && wr === null
            ? "⏎ renames the plan · Space folds it · click its number to select its lines"
        : ringKind === "groupBlank"
            ? "⏎ or click adds a plan"
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
        else if (item.kind === "gap") at = { kind: "row", offset: item.gap.from };
        else at = { kind: "row", offset: item.position };
        reportViewport(at, isScrolling);
    }, [body, reportViewport]);

    // ── Rows ──────────────────────────────────────────────────────────────
    const rect = selectionRect(ui);
    const editorNode = useMemo<ReactNode>(() => edit !== null && editMeta !== undefined
        ? (
            <SheetEditor
                styles={styles}
                kind={editMeta.kind}
                value={edit.val}
                date={editDate}
                seed={edit.seeded && edit.val.length === 1 ? edit.val : undefined}
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
        : null, [edit, editMeta, editDate, styles, editGhost, editResolve, editBadge, editorFocus, onEditorChange, onEditorKey, onEditorBlur, linkView, linkGhostText, onHalfDown]);
    // ── The sticky band (#740, G1) — which band sits under the header at the scroll offset ──
    const sizeOf = useCallback((i: number): number => {
        const item = body[i];
        if (item === undefined) return rowPx;
        if (item.kind === "gap") return BAND_MIN_PX;
        if (item.kind === "group" || item.kind === "groupBlank") return bandPx;
        return item.kind === "band" ? Math.max(BAND_MIN_PX, item.band.px) : rowPx;
    }, [body, rowPx, bandPx]);
    const offsets = useMemo(() => (group !== undefined ? bodyOffsets(body, sizeOf) : undefined), [group, body, sizeOf]);
    const scrollElRef = useRef<HTMLDivElement | null>(null);
    const [stickyAt, setStickyAt] = useState<number | undefined>(undefined);
    useEffect(() => {
        const el = scrollElRef.current;
        if (el === null || offsets === undefined) {
            setStickyAt(undefined);
            return;
        }
        let frame = 0;
        const update = () => { frame = 0; setStickyAt(stickyBandIndex(body, offsets, el.scrollTop)); };
        const onScroll = () => { if (frame === 0) frame = requestAnimationFrame(update); };
        update();
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            if (frame !== 0) cancelAnimationFrame(frame);
        };
    }, [body, offsets]);

    const renderRow = useCallback((i: number): ReactNode => {
        const item = body[i];
        if (item === undefined) return null;
        if (item.kind === "band") return <SheetBandRow styles={styles} band={item.band} loading={paging.loading} />;
        if (item.kind === "gap") {
            const g = item.gap;
            const steps = ui.lens.steps;
            return (
                <SheetGapRow
                    styles={styles}
                    gap={g}
                    reach={{ top: nextReach(steps, g.key, "top", g.hidden), bottom: nextReach(steps, g.key, "bottom", g.hidden), both: nextReach(steps, g.key, "both", g.hidden) }}
                    onReveal={onReveal}
                    numberOf={group !== undefined ? lineNumberOf : undefined}
                />
            );
        }
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
                    number={item.number}
                    grouped={item.grouped}
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
        if (item.kind === "group") {
            if (group === undefined) return null;
            return (
                <SheetGroupRow
                    styles={styles}
                    columns={columns}
                    registers={registers}
                    gridTemplate={gridTemplate}
                    bandPx={bandPx}
                    r={r}
                    row={item.row}
                    group={group}
                    folded={item.folded}
                    count={item.count}
                    hits={item.hits}
                    first={i === 0}
                    selC={ui.sel.r === r ? ui.sel.c : undefined}
                    range={inRangeRow ? { c0: rect.c0, c1: rect.c1 } : undefined}
                    picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                    editor={edit !== null && edit.r === r ? { c: edit.c, node: editorNode } : undefined}
                    onCellDown={onCellDown}
                    onCellDouble={onCellDouble}
                    onCellEnter={onCellEnter}
                    onRowPick={onRowPick}
                    onFold={onFold}
                />
            );
        }
        if (item.kind === "groupBlank") {
            return (
                <SheetGhostBandRow
                    styles={styles}
                    gridTemplate={gridTemplate}
                    bandPx={bandPx}
                    r={r}
                    colCount={colCount}
                    selected={ui.sel.r === r}
                    editor={edit !== null && edit.r === r ? editorNode : undefined}
                    onCellDown={onCellDown}
                />
            );
        }
        const lg = item.group;
        return (
            <SheetRow
                styles={styles}
                columns={columns}
                registers={registers}
                driverColumn={driverColumn}
                gridTemplate={gridTemplate}
                rowPx={rowPx}
                r={r}
                number={lg !== undefined ? lg.number : item.position + 1}
                first={i === 0}
                row={item.kind === "real" ? item.row : undefined}
                group={lg}
                linkCtx={linkCellCtx}
                selC={ui.sel.r === r ? ui.sel.c : undefined}
                range={inRangeRow ? { c0: rect.c0, c1: rect.c1 } : undefined}
                picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                hit={item.kind === "real" && item.hit}
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
    }, [body, styles, paging.loading, rowSpace, ui.selEnd, ui.sel, ui.sugg, ui.gsel, ui.hover, ui.lens.steps, rect, columns, registers, driverColumn, gridTemplate, rowPx, bandPx, group, colCount, wr, edit, editorNode, anchorR, nextTarget, onCellDown, onCellDouble, onCellEnter, onRowPick, onTake, onFillRow, onProposalPick, onProposalAccept, onProposalReject, onReveal, onFold, lineNumberOf, linkCellCtx]);

    if (paging.error !== undefined) {
        return (
            <Box css={styles.diagnostic} data-sheet-error>
                {`NO ROWS — the paged source could not be read. ${paging.error}`}
            </Box>
        );
    }

    const stickyItem = stickyAt !== undefined ? body[stickyAt] : undefined;
    const header = (
        <Box position="relative">
            <SheetHeader styles={styles} columns={columns.list} gridTemplate={gridTemplate} />
            {stickyItem !== undefined && stickyItem.kind === "group" && group !== undefined && stickyAt !== undefined && (
                // The band of the group whose lines scroll under the header (G1) — laid over the rows, so the list never moves.
                <Box position="absolute" top="100%" left="0" right="0">
                    <SheetGroupRow
                        styles={styles}
                        columns={columns}
                        registers={registers}
                        gridTemplate={gridTemplate}
                        bandPx={bandPx}
                        r={rowSpace.rowOf[stickyAt] ?? -1}
                        row={stickyItem.row}
                        group={group}
                        folded={stickyItem.folded}
                        count={stickyItem.count}
                        hits={stickyItem.hits}
                        sticky
                        selC={undefined}
                        range={undefined}
                        picked={false}
                        editor={undefined}
                        onCellDown={onCellDown}
                        onCellDouble={onCellDouble}
                        onCellEnter={onCellEnter}
                        onRowPick={onRowPick}
                        onFold={onFold}
                    />
                </Box>
            )}
        </Box>
    );
    const content = (
        <Box ref={rootRef} css={styles.root} data-sheet data-sheet-partial={transport !== undefined && !exhausted ? "" : undefined} data-copilot={copilotOn ? "" : undefined}
            data-lens={lensOn ? "" : undefined} data-view={ui.tabs.active ?? undefined}
            {...(frameFills ? { style: { height, maxHeight } } : {})}>
            {(chrome !== undefined || transport !== undefined) && (
                <SheetToolbar
                    styles={styles}
                    slice={slice}
                    affordances={affordances}
                    count={count}
                    partial={transport !== undefined && !exhausted}
                    tabs={tabsNode}
                    context={lensOn ? { value: ui.lens.context, onChange: onContext } : undefined}
                    search={seek.search}
                    onSearchKey={onSearchKey}
                />
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
                    estimateSize={sizeOf}
                    scrollElRef={scrollElRef}
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
            <SheetFooter styles={styles} items={value.footer} summary={summary} hint={hint} message={ui.msg} transport={transport} />
        </Box>
    );

    const densityTag = getSomeorUndefined(value.density)?.type;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{content}</DensityProvider>
        : content;
}, (prev, next) => sheetRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
