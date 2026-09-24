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
 * A source-bound transaction session retains draft gestures and history.
 * onPatch observes each completed gesture; onApply submits a checked batch.
 * Overlays retire only after the source acknowledges the committed result.
 * Function values come from the latest render; submitted callbacks remain
 * captured until their request resolves.
 *
 * The memo compares with `equivalentFor` (#809), so a value whose only change
 * is a closure — a swapped provider, an `onPatch` over new data — still
 * re-renders, and every function is taken from the latest value (§6.2). The
 * derivations that own local state (the decoded rows, the controlled
 * selection) key on the value's DATA identity instead, and the transaction
 * session on its source and schema, so such a change never resets them; the
 * copilot's memo is keyed on the value's identity.
 *
 * Grouped rows (#740): the source rows are GROUPS; the body draws each
 * group's band over its lines (pseudo rows tagged with their group), one
 * blank line per open group during the insertion migration. A write on a line
 * rewrites its group (`lineCommit` / `lineInsert` / `lineRemove` carry the
 * whole group after the edit, a line's address as its position or key); a
 * summary field commits the group. Explicit insertion controls create groups.
 *
 * A line may carry SUB ROWS (#844): read-only rows under the line that
 * share none of its columns, outside the row space, opened by the line's
 * chevron or Space, or by the lens when a search hits one of them. A gesture
 * that folds or opens moves rows with a short slide, and the rows it brings
 * into view drop in; nothing moves on a scroll, a lens change or a view
 * switch, and nothing at all under reduced motion.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type MouseEvent, type KeyboardEvent, type ClipboardEvent, type ReactNode } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { ArrayType, StringType, compareFor, equalFor, equivalentFor, fromEastTypeValue, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { boundSliceConfig } from "../../platform/slice/index.js";
import { parseCssSize } from "../../style/parse-size.js";
import { DensityProvider } from "../../contracts/density.js";
import { useCoarsePointer } from "../../contracts/adaptive.js";
import { useDensityHeights } from "../shared/helpers.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity.js";
import { useDataStable } from "../../hooks/useDataStable.js";
import { useFormatters } from "../../format/index.js";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { VirtualRows } from "../virtual-rows.js";
import {
    BAND_MIN_PX, BOTTOM_PAD_PX, DEFAULT_BLANKS, DEFAULT_GUTTER_PX, NEW_LINE_KEY, NULL_CELL, TITLE_KEY,
    blankIdOf, bodyIndexOfId, buildBody, cellIsBlank, cellText, countNoun, densityOf, driverKeyOf, groupBandPx, indexColumns, indexGroup, indexRegisters, isRowSpace,
    latencyOf, lineAddress, lineId, linePosition, lineRowsOf, parseWidth, resolveMember as resolveRegisterMember, rowIsBlank, stickyRows, withLine, withProposals, withoutLines,
    type LineGroup, type SheetBodyItem, type SheetColumnMeta,
} from "./model.js";
import { useSheetPaging, type SheetViewport } from "./paging.js";
import { useSheetSeek } from "./use-seek.js";
import { lensCount, lensGaps, lensHits, lensLineHits, lensSubRowHits, lensTitleHit, lensVisible, narrowingActive, nextReach, type LensGap } from "./lens.js";
import { cellDetail } from "./detail.js";
import { candidateAt, candidateList, ghostFor, resolveFor, type CandidateContext } from "./candidates.js";
import { editText, parseCell, type ParseContext } from "./parse/index.js";
import { parseDate } from "./parse/date.js";
import { usedKeys, narrowVocabulary, resolveMember as resolveVocabMember } from "./link/grammar.js";
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
import { SheetInsertLayer, SheetInsertPoint, SheetInsertStrip, type InsertionActions, type InsertSeam } from "./Insertion.js";
import { insertionGesture, groupInsertionSide, type InsertRequest, type InsertionAnchor } from "./insertion-gesture.js";
import { membershipAt } from "./membership.js";
import { SheetHeader } from "./Header.js";
import { SheetRow, SheetBandRow, SheetGapRow, SheetProposalRow, SheetGroupRow, SheetSubRow } from "./Rows.js";
import { SheetTabs, type SheetTabView } from "./Tabs.js";
import { SheetEditor, type EditorFocusRequest, type EditorOption, type LinkEditorView } from "./Editor.js";
import { SheetStrip, buildStrip, type StripAction, type StripLinkInput, type StripSuggestInput } from "./Strip.js";
import { SheetFooter, type SheetTransport } from "./Footer.js";
import { useSheetEditing, type LocalLayer } from "./use-editing.js";
import { SheetHistory, type HistoryAction } from "./History.js";
import { draftPresentation, discardDraft } from "./draft-state.js";
import { SheetToolbar } from "./Toolbar.js";
import type { SheetCellValue, SheetContextValue, SheetEditValue, SheetLinkValue, SheetMemberValue, SheetNounValue, SheetProposerValue, SheetRootValue, SheetRowValue, SheetSelectionValue, SheetViewValue } from "./values.js";

export type { SheetRootValue, SheetRowValue, SheetCellValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;
type SheetTransactionsIssue = import("./transactions.js").SheetTransactions["issues"][number];
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The gutter's least width: rail 28 · number 36 · actions 64. */
const GUTTER_PX = 128;

/** Keeps the marker, number and two 44 px actions in separate touch targets. */
const COARSE_GUTTER_PX = 254;

/** The word for a group when the sheet declares none. */
const GROUP_NOUN: SheetNounValue = { singular: "group", plural: "groups" };

const sheetRootEqual = equivalentFor(Sheet.Types.Root);
const sheetRootDataEqual = equalFor(Sheet.Types.Root);
const stringEqual = equalFor(StringType);
const stringCompare = compareFor(StringType);
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
    const what = q !== "" ? `"${q}"${ctx > 0 ? ` · ±${ctx}` : ""}` : view.narrowing.range.type === "some" ? "a date window" : view.narrowing.filters.length > 0 || view.narrowing.activeCohorts.size > 0 ? "a filter" : "no filter — the whole sheet";
    return `${what} · live · double-click renames · middle-click closes`;
}

/** The decoded rows with the local layer applied. */
function applyLayer(source: readonly SheetRowValue[], layer: LocalLayer, keyed = false): SheetRowValue[] {
    if (layer.edits.size === 0 && layer.appended.length === 0 && layer.removed.size === 0 && layer.placements.size === 0) return source as SheetRowValue[];
    const out: SheetRowValue[] = [];
    for (const r of source) {
        if (layer.removed.has(r.id)) continue;
        out.push(layer.edits.get(r.id) ?? r);
    }
    for (const r of layer.appended) if (!layer.removed.has(r.id)) out.push(layer.edits.get(r.id) ?? r);
    for (const [id, placement] of layer.placements) {
        if (placement.type !== "some" || placement.value.type !== "ordered") continue;
        const at = out.findIndex(row => stringEqual(row.id, id));
        if (at < 0) continue;
        const position = placement.value.value;
        const anchor = position.type === "before" || position.type === "after" ? out.findIndex(row => stringEqual(row.id, position.value)) : -1;
        if ((position.type === "before" || position.type === "after") && anchor < 0) continue;
        const [row] = out.splice(at, 1);
        const target = position.type === "start" ? 0 : position.type === "end" ? out.length : out.findIndex(row => stringEqual(row.id, position.value)) + (position.type === "after" ? 1 : 0);
        out.splice(target, 0, row!);
    }
    if (keyed) out.sort((a, b) => stringCompare(a.id, b.id));
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
    return { id, owned: false, cells: new Map(columns.map((c) => [c.key, NULL_CELL])), lines: [], band: none, subRows: [] };
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

/** The boxes of the rows the virtualizer has mounted, by body index (its row wrappers carry `data-index`). */
function mountedBoxes(scrollEl: HTMLElement): Map<number, DOMRect> {
    const out = new Map<number, DOMRect>();
    for (const w of scrollEl.querySelectorAll<HTMLElement>(":scope > div > [data-index]")) out.set(Number(w.dataset.index), w.getBoundingClientRect());
    return out;
}

/** A body item's identity for the virtual rows: it stays with the item when rows open, fold or move around it. */
function keyOfItem(it: SheetBodyItem | undefined, i: number): string {
    if (it === undefined) return `#${i}`;
    switch (it.kind) {
        case "real": return `row:${it.row.id}`;
        case "group": return `group:${it.row.id}`;
        case "subRow": return `sub:${it.lineId}#${it.index}`;
        case "blank": return `blank:${blankIdOf(it)}`;
        case "band": return `band:${it.band.at}`;
        case "gap": return `gap:${it.gap.key}`;
        case "proposal": return `proposal:${it.anchorR}#${it.index}`;
    }
    return `#${i}`;
}

/** What is open in a body: each group unfolded, each line whose sub rows show. */
function openKeysOf(body: readonly SheetBodyItem[]): Set<string> {
    const out = new Set<string>();
    for (const it of body) {
        if (it.kind === "group" && !it.folded) out.add(`group:${it.row.id}`);
        else if (it.kind === "subRow") out.add(`line:${it.lineId}`);
    }
    return out;
}

const NOTHING: ReadonlySet<string> = new Set();
/** How long rows slide after a gesture that folds or opens (ms) — a little past the slide itself. */
const MOVE_MS = 320;

/** The body index of an anchor — a real row (or a group's band) by id, a blank row or blank line by its synthetic id. */
function anchorBodyIndex(body: readonly SheetBodyItem[], anchorId: string): number {
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
export const EastChakraSheet = memo(function EastChakraSheet({ value, storageKey }: EastChakraSheetProps) {
    // Changes identity on a DATA change only — what owns local state keys on
    // it; callbacks come from `value` (#809).
    const data = useDataStable(value, sheetRootDataEqual);
    // The counts the chrome prints — the summary, the hints, the messages,
    // the lens line — in the app's locale (#850).
    const words = useFormatters();
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
    const coarse = useCoarsePointer();
    const rowPx = Math.max(useDensityHeights(size).row, coarse ? 45 : 0);
    const bandPx = Math.max(groupBandPx(size), coarse ? 46 : 42);
    // A sub row's least height; a wrapping detail grows it, and the rows are measured.
    const subRowPx = 30;
    const noun = group?.noun ?? GROUP_NOUN;
    const readOnly = (getSomeorUndefined(value.readOnly) ?? false) || value.editing.onApply.type === "none";
    const capabilities = value.editing.edits;
    const canInsertRows = !readOnly && capabilities.insertRows;
    const canInsertGroups = !readOnly && capabilities.insertGroups && group !== undefined;
    // The grouped blank-tail path remains until all insertions use explicit destinations.
    const blanks = !capabilities.insertRows ? 0 : group !== undefined ? (readOnly ? 0 : 1) : Number(getSomeorUndefined(value.blanks) ?? BigInt(DEFAULT_BLANKS));
    // Touch targets fit in separate lanes; row heights include their seam borders.
    const gutterPx = Math.max(parseWidth(style !== undefined ? getSomeorUndefined(style.gutterWidth) : undefined) ?? DEFAULT_GUTTER_PX, GUTTER_PX, coarse ? COARSE_GUTTER_PX : 0);
    // The frame's slack goes to the TEXT columns, each capped at 2.5× its
    // width, and a trailing filler track takes the rest: a link or date
    // column keeps its declared width on a wide screen instead of stretching
    // to the frame.
    const gridTemplate = useMemo(() => {
        const tracks = columns.list.map((c) => (c.kind === "text" ? `minmax(${c.width}px, ${Math.round(c.width * 2.5)}px)` : `${c.width}px`));
        return `${gutterPx}px ${tracks.join(" ")} minmax(0, 1fr)`;
    }, [gutterPx, columns]);
    const minWidth = gutterPx + columns.totalWidth;
    const today = useMemo(() => todayUtc(), []);

    // Callbacks — taken from the latest value on every render.
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onViewsChangeFn = useMemo(() => getSomeorUndefined(value.onViewsChange), [value.onViewsChange]);
    const newRowIdFn = useMemo(() => getSomeorUndefined(value.newRowId), [value.newRowId]);
    const newLineKeyFn = useMemo(() => getSomeorUndefined(value.newLineKey), [value.newLineKey]);
    // The controlled selection follows the host's DATA: a closure-only change
    // must not snap the ring back to it.
    const selection = useMemo(() => getSomeorUndefined(data.selection), [data.selection]);
    // The slice, the lens and the views run on a grouped sheet too.
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
    const views = useMemo(() => viewsState.over === value.views || viewsEqual(viewsState.over, value.views) ? viewsState.views : value.views, [viewsState, value.views]);
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
    // The memo empties on every new value — new data, or a provider closure
    // the root memo saw change (#809).
    const suggestMemo = useRef(new SuggestMemo());
    useEffect(() => { suggestMemo.current.clear(); }, [value]);
    const inflight = useRef(new InFlight());

    // ── The row source: inline rows, or the paged driver ──────────────────
    const pagedSource = value.rows.type === "paged" ? value.rows.value : undefined;
    const decodedRows = useMemo<readonly SheetRowValue[] | undefined>(
        () => (data.rows.type === "inline" ? (data.rows.value as readonly SheetRowValue[]) : undefined),
        [data.rows],
    );
    const paging = useSheetPaging(pagedSource, rowPx, bandPx);
    const sourceRows: readonly SheetRowValue[] = decodedRows ?? paging.rows;
    const rowsOffset = decodedRows !== undefined ? 0 : paging.rowsOffset;
    const exhausted = decodedRows !== undefined || paging.exhausted;
    const editingState = useSheetEditing(value.editing, pagedSource, sourceRows, rowsOffset, storageKey);
    const session = editingState.session;
    const readiness = session.readiness;
    const draftType = useMemo(() => fromEastTypeValue(value.editing.draftType), [value.editing.draftType]);
    const childField = getSomeorUndefined(value.editing.children);
    const draftVersion = editingState.version;
    const recordGesture = editingState.record;
    const drafts = editingState.drafts;
    const layer = editingState.layer;
    // Temporary writes within one reducer effect batch; the transaction session
    // publishes the completed gesture and owns the rendered layer thereafter.
    const layerRef = useRef(layer);
    layerRef.current = layer;
    const setLayer = useCallback((fn: (prev: LocalLayer) => LocalLayer) => { layerRef.current = fn(layerRef.current); }, []);
    const rows = useMemo(() => applyLayer(sourceRows, layer, value.editing.keyed), [sourceRows, layer, value.editing.keyed]);

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
    // A grouped sheet (#740): a group shows when its title or any line
    // matches (or it is revealed); INSIDE a shown group the lens works on the
    // lines — hits keep their numbers, the context switch and the reveals
    // apply to lines, and the hidden runs collapse into gaps. A group whose
    // title matches shows every line.
    const lens = useMemo(() => {
        if (!lensOn || sliceState === undefined || sliceConfig === undefined) return undefined;
        const positions = rows.map((_r, i) => rowsOffset + i);
        const hits = lensHits(sliceState, sliceConfig, rows, columns.list);
        if (group === undefined) {
            const visible = lensVisible(hits, positions, ui.lens.context, ui.lens.reveals);
            return { hits, visible, gaps: lensGaps(hits, visible, positions) };
        }
        const visible = lensVisible(hits, positions, 0, ui.lens.reveals);
        const lineHits = rows.map((g) => lensLineHits(sliceState, sliceConfig, g, columns.list));
        const linePositions = rows.map((g, i) => g.lines.map((_l, j) => linePosition(positions[i]!, j)));
        const lineVisible = rows.map((g, i) => (lensTitleHit(sliceState, sliceConfig, g, columns.list)
            ? g.lines.map(() => true)
            : lensVisible(lineHits[i]!, linePositions[i]!, ui.lens.context, ui.lens.reveals)));
        const lineGaps = rows.map((_g, i) => lensGaps(lineHits[i]!, lineVisible[i]!, linePositions[i]!));
        // Which sub rows a search answers through: a line hit only there shows them.
        const lineSubRowHits = rows.map((g, i) => lensSubRowHits(sliceState, g, lineHits[i]!));
        return { hits, visible, gaps: lensGaps(hits, visible, positions), lineHits, lineVisible, lineGaps, lineSubRowHits };
    }, [lensOn, sliceState, sliceConfig, rows, rowsOffset, columns, ui.lens.context, ui.lens.reveals, group]);

    // ── The body ──────────────────────────────────────────────────────────
    const folds = ui.lens.folds;
    const foldedOf = useCallback((row: SheetRowValue): boolean => folds.get(row.id) ?? getSomeorUndefined(row.band)?.folded ?? false, [folds]);
    // A line's sub rows fold under its id like a group under its own: `false` open, `true` closed, absent untouched.
    const subRowsOpenOf = useCallback((lineKey: string): boolean | undefined => { const f = folds.get(lineKey); return f === undefined ? undefined : !f; }, [folds]);
    const bodyBase = useMemo<SheetBodyItem[]>(() => buildBody({
        rows, rowsOffset, blanks: group !== undefined ? blanks : blanks + ui.appended, exhausted,
        total: paging.total, head: paging.head, tail: paging.tail,
        lens,
        grouped: group !== undefined ? { foldedOf, subRowsOpen: subRowsOpenOf } : undefined,
    }), [rows, rowsOffset, blanks, ui.appended, exhausted, paging.total, paging.head, paging.tail, lens, group, foldedOf, subRowsOpenOf]);
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
    // A line's candidates rank against ITS GROUP's lines (the row above is the line above).
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
        return { registers, rows, rowIndex: it !== undefined && it.kind === "real" ? it.residentIndex : -1, driverColumn, allowed };
    }, [rowAt, registers, rows, driverColumn]);
    /** The wire context over a row — the copilot's, a check's, a custom parse's (§4.4); a line's names its group and its key (#740). */
    const wireContextOf = useCallback((row: SheetRowValue | undefined, residentIndex: number, position: number, rowsNow: SheetRowValue[], lg?: LineGroup): SheetContextValue => {
        const driverKey = driverKeyOf(row, driverColumn);
        return {
            drafts,
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
    }, [driverColumn, columns, rowsOffset, exhausted, today, drafts]);
    const wireContextFor = useCallback((r: number): SheetContextValue => {
        const it = rowAt(r);
        const row = it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row : undefined;
        const position = it !== undefined && it.kind !== "band" && it.kind !== "gap" ? it.position : rowsOffset + rows.length;
        const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
        return wireContextOf(row, it !== undefined && (it.kind === "real" || it.kind === "group") ? it.residentIndex : rows.length, position, rows, lg);
    }, [rowAt, rows, rowsOffset, wireContextOf]);
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
    const links = useSheetLinks({ drafts, columns, registers, driver, driverColumn, body, rowAt, predictedLink, allowedFor });
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

    // The whole-sheet narrowing, and whether the active tab has drifted from its view (B§8).
    const emptyNarrowing = useMemo(() => (sliceState !== undefined ? clearNarrowing(sliceState) : undefined), [sliceState]);
    const activeViewValue = useMemo(() => (ui.tabs.active === null ? undefined : views.find((v) => v.id === ui.tabs.active)), [views, ui.tabs.active]);
    const dirty = activeViewValue !== undefined && sliceState !== undefined && !sliceStateEqual(activeViewValue.narrowing, sliceState);

    const ctx = useMemo<SheetMachineCtx>(() => ({
        rowCount,
        colCount,
        lensActive: lensOn,
        grouped: group !== undefined,
        // Group insertion uses explicit controls; keyboard padding is flat-only.
        canAppend: exhausted && canInsertRows && editingState.available && group === undefined,
        editableAt: (r, c) => {
            if (readOnly || !editingState.available) return false;
            const it = rowAt(r);
            if (it === undefined || !isRowSpace(it)) return false;
            const meta = metaAt(r, c);
            if (meta === undefined) return false;
            if (it.kind === "blank" && !canInsertRows) return false;
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
            return meta === undefined ? "" : editText(cellAt(r, c), meta, words, levelAt(r, meta));
        },
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
        rowNameAt: (r) => {
            const it = rowAt(r);
            const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
            if (lg === undefined) return `row ${it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.position + 1 : r + 1}`;
            const title = lg.row.cells.get(TITLE_KEY);
            return `line ${lg.number} of ${title !== undefined && title.type === "String" && title.value !== "" ? title.value : `the ${noun.singular}`}`;
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
        // Every group, the ones a lens hides included: what fold-all folds.
        groupIds: group !== undefined ? rows.map((row) => row.id) : undefined,
        groupNoun: noun,
        // A line's sub rows: whether they show is read off the body (the lens may have opened them).
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
    }), [rowCount, colCount, lensOn, exhausted, readOnly, canInsertRows, editingState.available, group, noun, columns, rows, rowAt, metaAt, parseCtxFor, candidateCtxFor, cellAt, levelAt, words, linkCtxFor, rowOf, idAt, driverColumn, views, sliceState, emptyNarrowing, dirty, rowSpace, body]);
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
    const gestureEvents = useRef<SheetEditValue[]>([]);
    const emitEdit = useCallback((edit: SheetEditValue) => { gestureEvents.current.push(edit); }, []);
    /**
     * Write cells: a real row's commits land in the layer's edits (one
     * `commit` event per changed cell, each carrying the row AFTER it); a
     * blank row's cells become one inserted row (one `insert` event). Returns
     * the row-space index the FIRST inserted row landed on, so the ring can
     * follow a blank row that just became real, and the ids of the rows
     * written, in order.
     */
    const writeCells = useCallback((writes: readonly CellWrite[], source: EditSource): { firstInserted: number | undefined; ids: string[] } => {
        if (readOnly || !editingState.available) return { firstInserted: undefined, ids: [] };
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
        const rowsNow = applyLayer(sourceRows, base, value.editing.keyed);
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
                    if (!canInsertRows) continue;
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
                    const g: SheetRowValue = { ...g0, lines: [...g0.lines, { key, cells, subRows: [] }] };
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
            if (group !== undefined || !canInsertRows) continue;
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
        const next: LocalLayer = { edits, appended, removed: base.removed, placements: base.placements };
        layerRef.current = next;
        setLayer(() => next);
        for (const e of events) emitEdit(e);
        return { firstInserted, ids };
    }, [sourceRows, rowAt, columns, group, metaAt, newRowIdFn, newLineKeyFn, setLayer, emitEdit, readOnly, canInsertRows, value.editing.keyed, editingState.available]);
    /**
     * Delete whole rows. On a grouped sheet (#740, G7) lines in the range
     * leave their groups (`lineRemove`); with no line in the range, the
     * empty groups whose bands are in it leave the sheet (`remove`) — the
     * two-step ladder: the lines, then the group.
     */
    const deleteRows = useCallback((r0: number, r1: number): { n: number; what: "rows" | "lines" | "groups"; emptiedBandR: number | undefined } => {
        if (readOnly || !editingState.available) return { n: 0, what: "rows", emptiedBandR: undefined };
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
                if (!capabilities.removeRows) return { n: 0, what: "lines", emptiedBandR: undefined };
                const edits = new Map(base.edits);
                const appended = [...base.appended];
                let n = 0;
                // The first group left empty: the ring selects its band, so ⌫ again removes the group (G7). Bands sit above their lines, so its row index survives the removal.
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
                const next: LocalLayer = { edits, appended, removed: base.removed, placements: base.placements };
                layerRef.current = next;
                setLayer(() => next);
                return { n, what: "lines", emptiedBandR };
            }
            if (!capabilities.removeGroups) return { n: 0, what: "groups", emptiedBandR: undefined };
            const ids = bands.filter((b) => currentGroup(b.row).lines.length === 0).map((b) => b.row.id);
            if (ids.length === 0) return { n: 0, what: "groups", emptiedBandR: undefined };
            const next: LocalLayer = { ...base, removed: new Set([...base.removed, ...ids]) };
            layerRef.current = next;
            setLayer(() => next);
            emitEdit(variant("remove", { rowIds: ids }));
            return { n: ids.length, what: "groups", emptiedBandR: undefined };
        }
        if (!capabilities.removeRows) return { n: 0, what: "rows", emptiedBandR: undefined };
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
    }, [group, rowAt, body, rowSpace, setLayer, emitEdit, readOnly, capabilities, editingState.available]);
    /** Insert one proposed row after a row: into the blank slot below it (B§5.2), else appended; on a grouped sheet into the anchor's group (#740, G11). */
    const insertProposal = useCallback((afterR: number, cells: ReadonlyMap<string, SheetCellValue>, extra = 0): { id: string; r: number } | undefined => {
        if (!canInsertRows) return undefined;
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
    }, [columns, group, rowAt, blankLineRowOf, rowSpace, body, rowCount, writeCells, canInsertRows]);

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
        gestureEvents.current = [];
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
                    const what = out.what === "groups" ? countNoun(out.n, noun, words) : `${words.number(out.n)} ${out.what === "lines" ? "line" : "row"}${out.n === 1 ? "" : "s"}`;
                    const msg = `Deleted ${what}`;
                    if (out.emptiedBandR !== undefined) {
                        dispatchStore({ t: "patch", patch: {
                            sel: { r: out.emptiedBandR, c: 0 }, selEnd: { r: out.emptiedBandR, c: Math.max(0, colCount - 1) },
                            msg: `${msg} — ⌫ again removes the ${noun.singular}`,
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
                    if (readOnly) break;
                    const matrix = parseMatrix(eff.text);
                    if (matrix.length === 0) break;
                    const laid = layoutPaste(matrix, columns.list, eff.c);
                    const writes: CellWrite[] = [];
                    let skipped = 0;
                    // On a grouped sheet a paste lands on the anchor's group — its lines from the ring, its blank line, then new lines past it — never across a band (G9).
                    const anchor = rowAt(eff.r);
                    const gid = group !== undefined && anchor !== undefined && (anchor.kind === "real" || anchor.kind === "blank") ? anchor.group?.row.id : undefined;
                    if (group !== undefined && gid === undefined) break;
                    const blankR = gid !== undefined ? blankLineRowOf(gid) : undefined;
                    for (const p of laid.cells) {
                        const meta = columns.list[p.c];
                        if (meta === undefined) continue;
                        const r = eff.r + p.dr;
                        const outcome = parseCell(meta, p.text, parseCtxFor(Math.min(r, blankR ?? r), meta));
                        const cell = outcome.kind === "unrecognised" ? variant("Invalid", p.text) : outcome.kind === "cell" ? outcome.cell : NULL_CELL;
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
                        msg: `Pasted ${words.number(matrix.length)}×${words.number(matrix[0]?.length ?? 0)} from clipboard${skipped > 0 ? ` · ${words.number(skipped)} unrecognised` : ""}`,
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
        try { recordGesture(gestureEvents.current); }
        catch (error) { console.error("Sheet transaction failure", error); dispatchStore({ t: "patch", patch: { msg: error instanceof Error ? error.message : String(error) } }); }
        finally { gestureEvents.current = []; }
    }, [recordGesture, writeCells, deleteRows, insertProposal, columns, group, noun, words, metaAt, blankLineRowOf, readOnly, cellAt, colCount, parseCtxFor, onSelectFn, rowAt, rowOf, rowSpace, store.ui.sel, store.ui.edit, idAt, copilotOn, triggers, requestRun, requestReady, dispatch, value.views, onViewsChangeFn, slice]);
    const drainedFx = useRef(0);
    useLayoutEffect(() => {
        if (store.fxSeq === drainedFx.current) return;
        drainedFx.current = store.fxSeq;
        runEffects(store.fx);
    }, [store.fxSeq, store.fx, runEffects]);

    const pendingHistoryAction = useRef<HistoryAction | undefined>(undefined);
    const executeHistory = useCallback((action: HistoryAction) => {
        if (action === "apply") void session.apply();
        else if (action === "refresh") session.refresh();
        else session[action]();
    }, [session]);
    const onHistoryAction = useCallback((action: HistoryAction) => {
        if (uiRef.current.edit !== null && action !== "refresh") {
            pendingHistoryAction.current = action;
            dispatch({ t: "editor.blur" });
        } else executeHistory(action);
    }, [dispatch, executeHistory]);
    useLayoutEffect(() => {
        const action = pendingHistoryAction.current;
        if (action === undefined) return;
        pendingHistoryAction.current = undefined;
        if (ui.edit === null) executeHistory(action);
    }, [ui.edit, store.fxSeq, executeHistory]);

    const pendingDiscard = useRef<{ id: string; child: string | undefined } | undefined>(undefined);
    const executeDiscard = useCallback((id: string, child?: string) => {
        if (discardDraft(session, childField, id, child)) {
            dispatchStore({ t: "patch", patch: { sugg: null, msg: "Discarded new row" } });
            cardRef.current?.focus({ preventScroll: true });
        }
    }, [session, childField]);
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
    }, [rowAt, dispatch, executeDiscard]);
    useLayoutEffect(() => {
        const target = pendingDiscard.current;
        if (target === undefined || ui.edit !== null) return;
        pendingDiscard.current = undefined;
        executeDiscard(target.id, target.child);
    }, [ui.edit, store.fxSeq, executeDiscard]);

    // Insertion retains identities while an open editor commits, then resolves
    // the destination against the latest local collection.
    const pendingInsertion = useRef<InsertRequest | undefined>(undefined);
    const pendingInsertFocus = useRef<{ id: string; child?: string } | undefined>(undefined);
    const anchorFor = useCallback((r: number, side: "before" | "after"): InsertionAnchor => {
        const item = rowAt(r);
        if (item?.kind === "real" && item.group !== undefined) return { entry: item.group.row.id, child: item.group.key, side };
        if (item?.kind === "blank" && item.group !== undefined) return { entry: item.group.row.id, tail: true, side };
        return { entry: item?.kind === "real" || item?.kind === "group" ? item.row.id : undefined, side };
    }, [rowAt]);
    const executeInsertion = useCallback((request: InsertRequest) => {
        if (!editingState.available || (request.kind === "row" ? !canInsertRows : !canInsertGroups)) return;
        const gesture = insertionGesture(request, rows, rowsOffset, group !== undefined, value.editing.keyed,
            () => newRowIdFn?.() ?? mintId(id => rows.some(row => row.id === id)), mintLineKey);
        if (gesture === undefined) return;
        recordGesture([gesture.event], gesture.placement === undefined ? undefined : new Map([[gesture.id, gesture.placement]]), "insert");
        pendingInsertFocus.current = { id: gesture.id, ...(gesture.child === undefined ? {} : { child: gesture.child }) };
        dispatchStore({ t: "patch", patch: { sugg: null, selEnd: null, msg: request.kind === "group" ? `New ${noun.singular}` : "New row" } });
    }, [editingState.available, canInsertRows, canInsertGroups, rows, rowsOffset, group, noun, value.editing.keyed, newRowIdFn, recordGesture]);
    const onInsert = useCallback((kind: "row" | "group", r: number, side: "before" | "after") => {
        const request: InsertRequest = { kind, anchor: anchorFor(r, side) };
        if (uiRef.current.edit !== null) { pendingInsertion.current = request; dispatch({ t: "editor.blur" }); }
        else executeInsertion(request);
    }, [anchorFor, dispatch, executeInsertion]);
    useLayoutEffect(() => {
        if (ui.edit !== null || pendingInsertion.current === undefined) return;
        const request = pendingInsertion.current;
        pendingInsertion.current = undefined;
        executeInsertion(request);
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
        if (item?.kind === "group" && item.folded) dispatch({ t: "fold.toggle", r });
        const driverC = columns.list.findIndex(col => col.editable && col.key === driverColumn);
        const c = item?.kind === "group" ? 0 : driverC >= 0 ? driverC : Math.max(0, columns.list.findIndex(col => col.editable));
        dispatch({ t: "cell.dbl", r, c });
    }, [rows, rowOf, rowAt, columns, driverColumn, dispatch]);

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
        if (e.altKey && e.key === "Insert") {
            e.preventDefault(); onInsert("row", store.ui.sel.r, e.shiftKey ? "before" : "after"); return;
        }
        const meta = e.metaKey || e.ctrlKey;
        if (meta && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
            e.preventDefault();
            onHistoryAction(e.shiftKey || e.key.toLowerCase() === "y" ? "redo" : "undo");
            return;
        }
        // The browser's own clipboard keys become copy / paste events.
        if (meta && (e.key === "c" || e.key === "v" || e.key === "x" || e.key === "a")) return;
        const handled = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Tab", "Enter", "F2", "Escape", "Backspace", "Delete"];
        const printable = e.key.length === 1 && !meta && !e.altKey;
        const toSearch = meta && (e.key === "/" || e.key === "f");
        if (!handled.includes(e.key) && !printable && !toSearch) return;
        e.preventDefault();
        dispatch({ t: "key", key: e.key, shift: e.shiftKey, meta, alt: e.altKey });
    }, [dispatch, store.ui.edit, store.ui.sel.r, onHistoryAction, onInsert]);
    // A band never copies (G9): a whole-group selection copies its lines.
    const isBandRow = useCallback((r: number) => { const k = rowAt(r)?.kind; return k === "group"; }, [rowAt]);
    const onCopy = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
        if (store.ui.edit !== null) return;
        e.preventDefault();
        const rect = selectionRect(store.ui);
        e.clipboardData.setData("text/plain", exportMatrix(cellAt, columns.list, rect, words, isBandRow));
        let copied = 0;
        for (let r = rect.r0; r <= rect.r1; r++) if (!isBandRow(r)) copied += 1;
        dispatchStore({ t: "patch", patch: { msg: `Copied ${words.number(copied)}×${words.number(rect.c1 - rect.c0 + 1)} to clipboard` } });
    }, [store.ui, cellAt, columns, isBandRow, words]);
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
    // An enum column's combobox. Two modes over the machine's
    // buffer: BROWSING — the buffer is empty or a whole option (the cell's own
    // value on open) — lists every option the row may take with that one
    // highlighted, and ↑ ↓ step the buffer through them; TYPING — a partial
    // buffer — lists the machine's candidates with its armed one highlighted,
    // exactly what the strip shows. ⏎ commits the buffer either way; a click
    // writes the option and moves on like ⏎.
    const editCombobox = useMemo<{ options: EditorOption[]; highlighted: number; browse: boolean } | undefined>(() => {
        if (edit === null || editMeta === undefined || editMeta.kind !== "enum") return undefined;
        const cctx = candidateCtxFor(edit.r);
        const allowed = cctx.allowed?.(editMeta);
        const all = (registers.byName.get(editMeta.register ?? "") ?? []).map((m) => m.key).filter((k) => allowed === undefined || allowed.has(k));
        const typed = edit.val.trim();
        const exact = all.findIndex((k) => k.toLowerCase() === typed.toLowerCase());
        const browse = typed === "" || exact >= 0;
        const labels = browse ? all : candidateList(editMeta, edit.val, cctx);
        const options = labels.map((label) => {
            const m = resolveRegisterMember(registers, editMeta.register, label);
            return { key: label, label, meta: m !== undefined ? getSomeorUndefined(m.meta) : undefined, tone: m !== undefined ? getSomeorUndefined(m.tone)?.type : undefined };
        });
        return { options, browse, highlighted: browse ? exact : edit.hi >= 0 ? Math.min(edit.hi, options.length - 1) : options.length > 0 ? 0 : -1 };
    }, [edit, editMeta, candidateCtxFor, registers]);
    const onEditorPick = useCallback((label: string) => {
        dispatch({ t: "editor.change", val: label });
        dispatch({ t: "editor.key", key: "Enter", shift: false, meta: false, alt: false, atEnd: true });
    }, [dispatch]);
    // A date column's buffer is its edit form; the date field shows the date it names.
    const editDate = useMemo(() => {
        if (edit === null || editMeta === undefined || editMeta.kind !== "date") return undefined;
        return parseDate(edit.val, { today, base: parseCtxFor(edit.r, editMeta).baseDate }) ?? undefined;
    }, [edit, editMeta, today, parseCtxFor]);
    const editWhenLevel = edit !== null && editMeta !== undefined ? levelAt(edit.r, editMeta) : undefined;
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
        // A sought element is a row, or on a grouped sheet a group — the ring lands on its band.
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

    const [pendingIssue, setPendingIssue] = useState<SheetTransactionsIssue | undefined>(undefined);
    const onIssue = useCallback((issue: SheetTransactionsIssue) => {
        dispatch({ t: "editor.blur" });
        setPendingIssue(issue);
    }, [dispatch]);
    useEffect(() => {
        const issue = pendingIssue;
        if (issue === undefined) return;
        const groupIndex = body.findIndex(item => item.kind === "group" && stringEqual(item.row.id, issue.entry));
        const groupItem = body[groupIndex];
        if (issue.row.type === "some" && groupItem?.kind === "group" && groupItem.folded) {
            dispatch({ t: "fold.toggle", r: rowSpace.rowOf[groupIndex]! });
            return;
        }
        const index = issue.row.type === "none" ? body.findIndex(item => (item.kind === "real" || item.kind === "group") && stringEqual(item.row.id, issue.entry))
            : body.findIndex(item => item.kind === "real" && item.group !== undefined && stringEqual(item.group.row.id, issue.entry) && item.group.index === Number(issue.row.value));
        if (index < 0) return;
        const r = rowSpace.rowOf[index]!;
        const field = issue.field.type === "some" ? issue.field.value : undefined;
        const column = field === undefined ? -1 : columns.list.findIndex(col => stringEqual(col.key, field));
        dispatch({ t: "select.set", r, c: Math.max(0, column) });
        setScrollTarget(index);
        dispatchStore({ t: "patch", patch: { msg: `${field ?? issue.entry}: ${issue.message}` } });
        cardRef.current?.focus({ preventScroll: true });
        setPendingIssue(undefined);
    }, [pendingIssue, body, rowSpace, columns, dispatch]);

    // ── The view tabs and the lens's chrome (B§8) ─────────────────────────
    // A grouped sheet counts LINES (#740).
    const countedRows = useMemo(() => (group !== undefined ? rows.flatMap((g) => lineRowsOf(g)) : rows), [group, rows]);
    const wholeCount = useMemo(() => countedRows.filter((row) => !rowIsBlank(row, columns)).length, [countedRows, columns]);
    const tabViews = useMemo<SheetTabView[]>(() => {
        if (slice === undefined) return [];
        return views.map((v) => {
            // A grouped sheet counts a view's LINES the way the lens matches them: with their group's facts and their sub rows.
            if (group !== undefined && sliceConfig !== undefined) {
                const count = rows.reduce((n, g) => {
                    const hits = lensLineHits(v.narrowing, sliceConfig, g, columns.list);
                    return n + lineRowsOf(g).filter((row, j) => hits[j] === true && !rowIsBlank(row, columns)).length;
                }, 0);
                return { id: v.id, name: v.name, count, title: viewTitle(v) };
            }
            const hits = sliceConfig !== undefined ? lensHits(v.narrowing, sliceConfig, countedRows, columns.list) : [];
            const count = countedRows.filter((row, i) => hits[i] === true && !rowIsBlank(row, columns)).length;
            return { id: v.id, name: v.name, count, title: viewTitle(v) };
        });
    }, [slice, views, sliceConfig, countedRows, columns, group, rows]);
    const summary = useMemo(() => {
        if (group === undefined) return undefined;
        // The sub rows under the lines count too.
        const lines = countedRows.length;
        const subRows = rows.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.subRows.length, 0), 0);
        return `${countNoun(rows.length, noun, words)} · ${words.number(lines)} line${lines === 1 ? "" : "s"}${subRows > 0 ? ` · ${words.number(subRows)} sub row${subRows === 1 ? "" : "s"}` : ""}`;
    }, [group, noun, rows, countedRows.length, words]);
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
    const onFold = useCallback((r: number, all?: boolean) => dispatch({ t: "fold.toggle", r, ...(all === true ? { all: true } : {}) }), [dispatch]);
    // A line's chevron: its sub rows show or hide; ⌥ takes the group's every line.
    const onSubRows = useCallback((r: number, all: boolean) => dispatch({ t: "subRows.toggle", r, ...(all ? { all: true } : {}) }), [dispatch]);
    // The header corner's fold-all: whether every group is folded decides which way it goes.
    const onFoldAll = useCallback((folded: boolean) => dispatch({ t: "fold.all", folded }), [dispatch]);
    const foldAll = useMemo(() => {
        if (group === undefined) return undefined;
        return { folded: rows.length > 0 && rows.every((row) => foldedOf(row)), count: rows.length, noun, onFoldAll };
    }, [group, noun, rows, foldedOf, onFoldAll]);
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
    // A grouped sheet counts LINES: the matches, and the context shown around them in the groups that show.
    const count = lens === undefined ? ""
        : lens.lineHits !== undefined && lens.lineVisible !== undefined
            ? lensCount(lens.lineHits.flat(), lens.lineVisible.map((v, i) => (lens.visible[i] ? v : v.map(() => false))).flat(), words)
            : lensCount(lens.hits, lens.visible, words);

    // ── The copilot's surfaces: the anchor's fills, the next target, the proposal rows ──
    const anchorR = useMemo(() => (ui.sugg !== null ? rowOf(ui.sugg.anchorId) : undefined), [ui.sugg, rowOf]);
    const nextTarget = useMemo(() => nextTargetOf(ui, ctx), [ui, ctx]);
    const suggested = useMemo<StripSuggestInput | undefined>(() => {
        if (edit !== null || ui.sugg === null) return undefined;
        const sugg = ui.sugg;
        const fills = fillOrder(sugg, ctx).map(({ key }) => {
            const f = sugg.fill.get(key)!;
            const meta = columns.byKey.get(key);
            return { key, header: meta?.header ?? key, text: meta !== undefined ? cellText(f.cell, meta, words) : "", meta: f.meta, armed: nextTarget?.key === key };
        });
        const pending = sugg.pending.map((key) => ({ key, header: key === "rows" ? "rows" : columns.byKey.get(key)?.header ?? key }));
        return { fills, rows: sugg.rows.length, rowsMeta: sugg.rows[0]?.meta ?? "", pending };
    }, [edit, ui.sugg, ctx, columns, nextTarget, words]);

    // The resting ring's cell detail (#844): the wanted date behind one that has happened, a column's detail text (with an enum member's own meta beside it).
    const detail = useMemo(() => {
        if (edit !== null || ui.selEnd !== null) return undefined;
        const meta = metaAt(ui.sel.r, ui.sel.c);
        const it = rowAt(ui.sel.r);
        if (meta === undefined || it === undefined || it.kind !== "real") return undefined;
        const d = cellDetail(meta, it.row.cells);
        if (d === undefined) return undefined;
        const cell = it.row.cells.get(meta.key);
        const member = meta.kind === "enum" && cell !== undefined && cell.type === "String" ? resolveRegisterMember(registers, meta.register, cell.value) : undefined;
        const memberMeta = member !== undefined ? getSomeorUndefined(member.meta) ?? "" : "";
        return { label: meta.header.toUpperCase(), chips: d.chips, meta: d.meta !== "" ? d.meta : memberMeta, keys: meta.kind === "date" ? "⏎ edits the wanted date" : "⏎ edit" };
    }, [edit, ui.selEnd, ui.sel, metaAt, rowAt, registers]);
    const strip = useMemo(() => {
        if (edit === null || editMeta === undefined) return buildStrip({ edit: null, meta: undefined, candidates: undefined, words, today, baseDate: undefined, unit: undefined, customPreview: undefined, suggested, detail });
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
            // The entry menu and the grammar line offer what the row may take (its options rule).
            const allowedKeys = allowedFor(edit.r, editMeta);
            const offer = vocab !== undefined && allowedKeys !== undefined ? narrowVocabulary(vocab, allowedKeys) : vocab;
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
                entry: offer !== undefined ? linkEntryCandidates(offer, used) : [],
                predicted,
                enumerate,
                predictedMeta: fill?.meta ?? "",
                arity,
                grammar: offer !== undefined ? grammarLine(offer) : "",
            };
        }
        return buildStrip({
            edit, meta: editMeta, candidates: pctx, words, today,
            baseDate: pctx.baseDate,
            unit: driverKey !== undefined ? editMeta.uom?.get(driverKey) : undefined,
            customPreview,
            link,
            whenLevel: editWhenLevel,
        });
    }, [edit, editMeta, words, today, parseCtxFor, rowAt, driverColumn, linkEdit, linkEditCtx, linkArmed, linkColumns, wireContextFor, suggested, ui.sugg, idAt, editWhenLevel, allowedFor, detail]);

    const wr = wholeRows(ui, colCount);
    const hasFills = ui.sugg !== null && ui.sugg.fill.size > 0;
    const hasRows = ui.sugg !== null && ui.sugg.rows.length > 0;
    const ringKind = ctx.rowKindAt?.(ui.sel.r);
    const ringSubRows = ringKind === "row" ? ctx.lineSubRowsAt?.(ui.sel.r) : undefined;
    const hint = ui.gsel !== null
        ? "⏎ adds the selected row · ⌫ rejects it · esc deselects"
        : ringKind === "group" && wr === null
            ? `⏎ renames the ${noun.singular} · Space folds it · ⇧Space folds all · click its number to select its lines`
        // A line with sub rows under it.
        : ringSubRows !== undefined && wr === null && ui.sugg === null
            ? `Space ${ringSubRows.open ? "hides" : "shows"} its ${words.number(ringSubRows.count)} sub row${ringSubRows.count === 1 ? "" : "s"} · ⇧Space every line's in the ${noun.singular} · ⏎ edit`
        : wr !== null
            ? `${words.number(wr.r1 - wr.r0 + 1)} row${wr.r1 - wr.r0 === 0 ? "" : "s"} selected · ⌫ deletes them · ⌘C copies`
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
                options={editCombobox?.options}
                highlighted={editCombobox?.highlighted}
                browse={editCombobox?.browse}
                onPick={onEditorPick}
                whenLevel={editWhenLevel}
                onChange={onEditorChange}
                onKey={onEditorKey}
                onBlur={onEditorBlur}
                onHalfDown={onHalfDown}
            />
        )
        : null, [edit, editMeta, editDate, styles, editGhost, editResolve, editBadge, editorFocus, onEditorChange, onEditorKey, onEditorBlur, linkView, linkGhostText, onHalfDown, editCombobox, onEditorPick, editWhenLevel]);
    // ── The sticky band (#740, G1) — which band sits under the header at the scroll offset ──
    const sizeOf = useCallback((i: number): number => {
        const item = body[i];
        if (item === undefined) return rowPx;
        if (item.kind === "gap") return BAND_MIN_PX;
        if (item.kind === "group") return bandPx;
        if (item.kind === "subRow") return subRowPx;
        return item.kind === "band" ? Math.max(BAND_MIN_PX, item.band.px) : rowPx;
    }, [body, rowPx, bandPx, subRowPx]);
    const scrollElRef = useRef<HTMLDivElement | null>(null);
    // The view's width: a sub row's well keeps its content inside it while the columns scroll sideways.
    const [viewPx, setViewPx] = useState<number | undefined>(undefined);
    useEffect(() => {
        const el = scrollElRef.current;
        if (el === null || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => setViewPx(el.clientWidth));
        observer.observe(el);
        setViewPx(el.clientWidth);
        return () => observer.disconnect();
    }, []);
    // What sticks under the header is read off the MOUNTED rows
    // (`stickyRows`): the band of the group whose lines scroll under it, and
    // under the band the open line whose sub rows scroll under that. The
    // line's copy follows the scroll through its own style, so a frame never
    // re-renders the sheet for it — only a change of line does.
    const headerRef = useRef<HTMLDivElement | null>(null);
    const stickyLineRef = useRef<HTMLDivElement | null>(null);
    const stickyLineTop = useRef(0);
    const [stickyAt, setStickyAt] = useState<number | undefined>(undefined);
    const [stickyLineAt, setStickyLineAt] = useState<number | undefined>(undefined);
    useEffect(() => {
        const el = scrollElRef.current;
        if (el === null || group === undefined) {
            setStickyAt(undefined);
            setStickyLineAt(undefined);
            return;
        }
        let frame = 0;
        const update = () => {
            frame = 0;
            const head = headerRef.current;
            if (head === null) return;
            const frameBox = head.getBoundingClientRect();
            const bandCopy = head.querySelector<HTMLElement>("[data-slot=stickyBand]");
            const found = stickyRows(body, mountedBoxes(el), frameBox.bottom, bandCopy !== null ? bandCopy.getBoundingClientRect().height : bandPx, rowPx);
            setStickyAt(found.band);
            setStickyLineAt(found.line?.index);
            if (found.line === undefined) return;
            stickyLineTop.current = found.line.top - frameBox.top;
            if (stickyLineRef.current !== null) stickyLineRef.current.style.top = `${stickyLineTop.current}px`;
        };
        const onScroll = () => { if (frame === 0) frame = requestAnimationFrame(update); };
        update();
        el.addEventListener("scroll", onScroll, { passive: true });
        // Rows that slid after a fold or an opening have landed: read them again.
        el.addEventListener("transitionend", onScroll);
        return () => {
            el.removeEventListener("scroll", onScroll);
            el.removeEventListener("transitionend", onScroll);
            if (frame !== 0) cancelAnimationFrame(frame);
        };
    }, [body, group, bandPx, rowPx]);
    // A line that has just begun to stick: its copy takes the top the scroll found for it before it paints.
    useLayoutEffect(() => {
        if (stickyLineRef.current !== null) stickyLineRef.current.style.top = `${stickyLineTop.current}px`;
    }, [stickyLineAt]);
    /**
     * Bring a sticking line out from under its copy: the rows
     * scroll until the line's own row sits just under the band, where the
     * copy was, so a press on the copy lands on the line in view (the ring,
     * the editor) and closing its sub rows leaves it where it stood. With
     * `closing`, the press closes the group's every line (⌥): the open sub
     * rows above this line are about to leave too, so the scroll takes them
     * off ahead of time.
     */
    const revealLine = useCallback((at: number, closing: boolean) => {
        const el = scrollElRef.current;
        const head = headerRef.current;
        if (el === null || head === null) return;
        const boxes = mountedBoxes(el);
        // The line's top: its own row's, else worked back from the first row mounted after it.
        let top = boxes.get(at)?.top;
        if (top === undefined) {
            let k = at + 1;
            while (k < body.length && !boxes.has(k)) k++;
            const next = boxes.get(k);
            if (next === undefined) return;
            top = next.top;
            for (let j = at; j < k; j++) top -= sizeOf(j);
        }
        let leaving = 0;
        if (closing) for (let j = at - 1; j >= 0 && body[j]!.kind !== "group"; j--) if (body[j]!.kind === "subRow") leaving += boxes.get(j)?.height ?? sizeOf(j);
        const bandCopy = head.querySelector<HTMLElement>("[data-slot=stickyBand]");
        el.scrollTop += top - (head.getBoundingClientRect().bottom + (bandCopy !== null ? bandCopy.getBoundingClientRect().height : 0)) - leaving;
    }, [body, sizeOf]);

    // A gesture that folds or opens (a chevron, Space, ⇧Space,
    // ⌥, fold-all) moves rows. The virtual rows are keyed by identity, so a row
    // that moves keeps its element: for a moment after such a gesture the rows
    // slide to their new places (`data-moving` on the root) and the rows it
    // brings into view — a line's sub rows, an unfolded group's lines — drop in
    // one after another. A gesture is a change of the folds on the same view:
    // the lens, a view switch and a scroll move nothing.
    const itemKey = useCallback((i: number): string => keyOfItem(body[i], i), [body]);
    const openKeys = useMemo(() => openKeysOf(body), [body]);
    /** What the last committed render had open, under which folds and view. */
    const seenRef = useRef<{ folds: ReadonlyMap<string, boolean>; tab: string | null; open: ReadonlySet<string> } | undefined>(undefined);
    const seen = seenRef.current;
    const gesture = seen !== undefined && seen.folds !== folds && seen.tab === ui.tabs.active;
    /** What the gesture opened: the rows under these keys arrive. */
    const arriving = useMemo(() => (gesture && seen !== undefined ? new Set([...openKeys].filter((k) => !seen.open.has(k))) : NOTHING), [gesture, seen, openKeys]);
    const [movingSince, setMovingSince] = useState(0);
    useLayoutEffect(() => {
        const was = seenRef.current;
        seenRef.current = { folds, tab: ui.tabs.active, open: openKeys };
        if (was !== undefined && was.folds !== folds && was.tab === ui.tabs.active) setMovingSince(performance.now());
    }, [folds, ui.tabs.active, openKeys]);
    useEffect(() => {
        if (movingSince === 0) return;
        const t = setTimeout(() => setMovingSince(0), MOVE_MS);
        return () => clearTimeout(t);
    }, [movingSince]);
    const moving = gesture || movingSince !== 0;

    const [insertPreview, setInsertPreview] = useState<{ r: number; kind: "row" | "group"; side: "gutter" | "body" } | undefined>(undefined);
    const canInsert = editingState.available && (canInsertRows || canInsertGroups);
    /** What the seam above row `r` offers, and what each chip previews. */
    const insertActions = useCallback((r: number, side: "gutter" | "body"): InsertionActions => {
        const anchor = anchorFor(r, "before");
        const ordered = anchor.child !== undefined || anchor.tail === true || !value.editing.keyed;
        return {
            ordered, groupOrdered: !value.editing.keyed,
            rowWord: group !== undefined ? "line" : "row", groupWord: noun.singular,
            row: canInsertRows && (group === undefined || anchor.entry !== undefined) ? () => onInsert("row", r, "before") : undefined,
            group: canInsertGroups ? () => onInsert("group", r, "before") : undefined,
            preview: kind => {
                if (kind === undefined || (kind === "row" ? !ordered : value.editing.keyed)) { setInsertPreview(undefined); return; }
                if (kind === "row") { setInsertPreview({ r, kind, side }); return; }
                const parent = rows.find(row => row.id === anchor.entry);
                if (parent === undefined) { setInsertPreview(undefined); return; }
                const gside = groupInsertionSide(parent, anchor);
                const next = rows[rows.indexOf(parent) + 1];
                const target = gside === "before" ? rowOf(parent.id) : next === undefined ? blankLineRowOf(parent.id) : rowOf(next.id);
                setInsertPreview(target === undefined ? undefined : { r: target, kind, side });
            },
        };
    }, [canInsertRows, canInsertGroups, anchorFor, value.editing.keyed, group, noun, onInsert, rows, rowOf, blankLineRowOf]);
    // The hovered seam. Its chips are drawn once, in the card's insertion
    // layer, placed from the seam's and the gutter's boxes on the screen: the
    // layer sits over every row and under the pinned header, so nothing a row
    // holds (its editor, its ring, the row above) ever covers them.
    const [seam, setSeam] = useState<InsertSeam | undefined>(undefined);
    const seamHitRef = useRef<HTMLElement | null>(null);
    const insertLayerRef = useRef<HTMLDivElement | null>(null);
    const onSeamEnter = useCallback((r: number, side: "gutter" | "body", hit: HTMLElement) => {
        const card = cardRef.current;
        const gutter = hit.closest<HTMLElement>("[data-slot=gutter]");
        if (card === null || gutter === null) return;
        const cardBox = card.getBoundingClientRect();
        const hitBox = hit.getBoundingClientRect();
        const gutterBox = gutter.getBoundingClientRect();
        seamHitRef.current = hit;
        // The chips sit wholly below the column header: the seam above the first row lies on its edge.
        const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? -Infinity;
        const top = Math.max(hitBox.top + hitBox.height / 2, headerBottom + 12) - cardBox.top;
        // The chips: in the gutter's actions column (x 72), else from the gutter edge.
        setSeam({ r, side, top, left: (side === "gutter" ? gutterBox.left + 72 : gutterBox.right) - cardBox.left });
        insertActions(r, side).preview?.(canInsertRows ? "row" : "group");
    }, [insertActions, canInsertRows]);
    /** The pointer left the seam or its chips: they stay while it moves between the two. */
    const onSeamLeave = useCallback((to: EventTarget | null) => {
        if (to instanceof Node && (insertLayerRef.current?.contains(to) === true || seamHitRef.current?.contains(to) === true)) return;
        seamHitRef.current = null;
        setSeam(undefined);
        setInsertPreview(undefined);
    }, []);
    // A scroll moves the rows from under the chips, and a change of rows moves the seam: either way the chips go until the pointer finds a seam again.
    useEffect(() => { setSeam(undefined); setInsertPreview(undefined); }, [body]);
    useEffect(() => {
        const el = scrollElRef.current;
        if (el === null) return;
        const hide = () => { setSeam(undefined); setInsertPreview(undefined); };
        el.addEventListener("scroll", hide, { passive: true });
        return () => el.removeEventListener("scroll", hide);
    }, []);
    const insertionFor = useCallback((r: number, side: "gutter" | "body"): ReactNode => {
        if (!canInsert) return undefined;
        return <SheetInsertPoint styles={styles} side={side} onEnter={hit => onSeamEnter(r, side, hit)} onLeave={onSeamLeave} />;
    }, [canInsert, styles, onSeamEnter, onSeamLeave]);
    // Whether a body item shows an action button in the gutter's actions column: a proposal's ✓ ×, an anchor's → fill, a draft's × discard.
    const hasDecisions = useCallback((i: number): boolean => {
        const it = body[i];
        if (it === undefined) return false;
        if (it.kind === "proposal") return true;
        const r = rowSpace.rowOf[i] ?? -1;
        // The copilot's → sits on its anchor — a real row, or the blank line being typed on.
        if ((it.kind === "real" || it.kind === "blank") && anchorR === r && ui.sugg !== null && ui.sugg.fill.size > 0) return true;
        if (it.kind === "real") {
            return draftPresentation(session, draftType, childField, it.group?.row.id ?? it.row.id, it.group?.key, readiness).discardable;
        }
        if (it.kind === "group") return draftPresentation(session, draftType, childField, it.row.id, undefined, readiness).discardable;
        return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [body, rowSpace, anchorR, ui.sugg, session, draftType, childField, readiness, draftVersion]);
    /** The seam above body item `i` takes the gutter unless an action sits in the actions column on either side of it. */
    const seamSide = useCallback((i: number): "gutter" | "body" => (hasDecisions(i) || hasDecisions(i - 1) ? "body" : "gutter"), [hasDecisions]);

    // A group's band is "mixed" while some, not all, of its lines are picked (the band's checkbox goes indeterminate).
    const bandMixed = useCallback((r: number, picked: boolean): boolean => {
        if (wr === null || picked) return false;
        const g = ctx.groupAt?.(r);
        return g?.lines !== undefined && !(g.lines.r1 < wr.r0 || g.lines.r0 > wr.r1);
    }, [wr, ctx]);
    const renderRow = useCallback((i: number): ReactNode => {
        const item = body[i];
        if (item === undefined) return null;
        if (item.kind === "band") return <SheetBandRow styles={styles} band={item.band} loading={paging.loading} />;
        if (item.kind === "subRow") {
            return (
                <SheetSubRow
                    styles={styles}
                    subRowPx={subRowPx}
                    subRow={item.subRow}
                    parent={item.group.number}
                    index={item.index}
                    count={item.count}
                    hit={item.hit}
                    gutterPx={gutterPx}
                    viewPx={viewPx}
                    membership={membershipAt(body, i)}
                    entering={arriving.has(`line:${item.lineId}`) ? Math.min(item.index, 8) : undefined}
                />
            );
        }
        if (item.kind === "gap") {
            const g = item.gap;
            const steps = ui.lens.steps;
            return (
                <SheetGapRow
                    styles={styles}
                    gap={g}
                    reach={{ top: nextReach(steps, g.key, "top", g.hidden), bottom: nextReach(steps, g.key, "bottom", g.hidden), both: nextReach(steps, g.key, "both", g.hidden) }}
                    onReveal={onReveal}
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
                    insertion={insertionFor(r, seamSide(i))}
                    insertPreview={insertPreview?.r === r ? insertPreview.kind : undefined}
                    insertSide={insertPreview?.r === r ? insertPreview.side : undefined}
                    r={r}
                    row={item.row}
                    number={item.position + 1}
                    membership={membershipAt(body, i)}
                    draft={draftPresentation(session, draftType, childField, item.row.id, undefined, readiness)}
                    onDiscard={() => onDiscardDraft(item.row.id)}
                    group={group}
                    folded={item.folded}
                    count={item.count}
                    first={i === 0}
                    selC={ui.sel.r === r ? ui.sel.c : undefined}
                    range={inRangeRow ? { c0: rect.c0, c1: rect.c1 } : undefined}
                    picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                    mixed={bandMixed(r, wr !== null && r >= wr.r0 && r <= wr.r1)}
                    editor={edit !== null && edit.r === r ? { c: edit.c, node: editorNode } : undefined}
                    onCellDown={onCellDown}
                    onCellDouble={onCellDouble}
                    onCellEnter={onCellEnter}
                    onRowPick={onRowPick}
                    onFold={onFold}
                />
            );
        }
        const lg = item.group;
        // A line with sub rows: how many, and whether they hang under it now.
        const subRowCount = item.kind === "real" && lg !== undefined ? lg.row.lines[lg.index]?.subRows.length ?? 0 : 0;
        const nextItem = body[i + 1];
        const subRows = subRowCount > 0 ? { count: subRowCount, open: nextItem !== undefined && nextItem.kind === "subRow" && item.kind === "real" && nextItem.lineId === item.row.id } : undefined;
        return (
            <SheetRow
                styles={styles}
                columns={columns}
                registers={registers}
                driverColumn={driverColumn}
                gridTemplate={gridTemplate}
                rowPx={rowPx}
                insertion={insertionFor(r, seamSide(i))}
                insertPreview={insertPreview?.r === r ? insertPreview.kind : undefined}
                insertSide={insertPreview?.r === r ? insertPreview.side : undefined}
                r={r}
                number={lg !== undefined ? lg.number : item.position + 1}
                first={i === 0}
                row={item.kind === "real" ? item.row : undefined}
                group={lg}
                membership={membershipAt(body, i)}
                draft={item.kind === "real" ? draftPresentation(session, draftType, childField, lg?.row.id ?? item.row.id, lg?.key, readiness) : undefined}
                onDiscard={item.kind === "real" ? () => onDiscardDraft(lg?.row.id ?? item.row.id, lg?.key) : undefined}
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
                subRows={subRows}
                onSubRows={onSubRows}
                noun={noun}
                entering={lg !== undefined && arriving.has(`group:${lg.row.id}`) ? Math.min(lg.index, 8) : undefined}
            />
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, draftType, childField, draftVersion, readiness, insertionFor, seamSide, insertPreview, onDiscardDraft, body, styles, paging.loading, rowSpace, ui.selEnd, ui.sel, ui.sugg, ui.gsel, ui.hover, ui.lens.steps, rect, columns, registers, driverColumn, gridTemplate, rowPx, bandPx, subRowPx, gutterPx, viewPx, group, noun, colCount, wr, bandMixed, edit, editorNode, anchorR, nextTarget, onCellDown, onCellDouble, onCellEnter, onRowPick, onTake, onFillRow, onProposalPick, onProposalAccept, onProposalReject, onReveal, onFold, onSubRows, linkCellCtx, arriving]);

    if (paging.error !== undefined) {
        return (
            <Box css={styles.diagnostic} data-sheet-error>
                {`NO ROWS — the paged source could not be read. ${paging.error}`}
            </Box>
        );
    }

    const stickyItem = stickyAt !== undefined ? body[stickyAt] : undefined;
    // The open line whose sub rows scroll under the band.
    const stuck = stickyLineAt !== undefined ? body[stickyLineAt] : undefined;
    const stuckLine = stickyLineAt !== undefined && stuck !== undefined && stuck.kind === "real" && stuck.group !== undefined
        ? { at: stickyLineAt, r: rowSpace.rowOf[stickyLineAt] ?? -1, row: stuck.row, lg: stuck.group, hit: stuck.hit }
        : undefined;
    const header = (
        <Box ref={headerRef} position="relative">
            <SheetHeader styles={styles} columns={columns.list} gridTemplate={gridTemplate} picked={wr !== null} foldAll={foldAll} />
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
                        number={stickyItem.position + 1}
                        membership={membershipAt(body, stickyAt)}
                        draft={draftPresentation(session, draftType, childField, stickyItem.row.id, undefined, readiness)}
                        onDiscard={() => onDiscardDraft(stickyItem.row.id)}
                        group={group}
                        folded={stickyItem.folded}
                        count={stickyItem.count}
                        sticky
                        selC={undefined}
                        range={undefined}
                        picked={false}
                        mixed={bandMixed(rowSpace.rowOf[stickyAt] ?? -1, false)}
                        editor={undefined}
                        onCellDown={onCellDown}
                        onCellDouble={onCellDouble}
                        onCellEnter={onCellEnter}
                        onRowPick={onRowPick}
                        onFold={onFold}
                    />
                </Box>
            )}
            {stuckLine !== undefined && (
                // The line whose sub rows scroll under the band: laid over the rows just under the band, and
                // BENEATH the band and the header (z −1 inside the pinned header), so it slides away under them as its last
                // sub row leaves. A press on it first brings the line itself back under the band (`revealLine`).
                <Box ref={stickyLineRef} position="absolute" left="0" right="0" zIndex="-1">
                    <SheetRow
                        styles={styles}
                        columns={columns}
                        registers={registers}
                        driverColumn={driverColumn}
                        gridTemplate={gridTemplate}
                        rowPx={rowPx}
                        r={stuckLine.r}
                        number={stuckLine.lg.number}
                        row={stuckLine.row}
                        group={stuckLine.lg}
                        membership={membershipAt(body, stuckLine.at)}
                        draft={draftPresentation(session, draftType, childField, stuckLine.lg.row.id, stuckLine.lg.key, readiness)}
                        onDiscard={() => onDiscardDraft(stuckLine.lg.row.id, stuckLine.lg.key)}
                        linkCtx={linkCellCtx}
                        selC={undefined}
                        range={undefined}
                        picked={false}
                        hit={stuckLine.hit}
                        editor={undefined}
                        fills={undefined}
                        nextTargetC={undefined}
                        hoverC={undefined}
                        onCellDown={(r, c, e) => { if (e.button === 0) revealLine(stuckLine.at, false); onCellDown(r, c, e); }}
                        onCellDouble={onCellDouble}
                        onCellEnter={onCellEnter}
                        onRowPick={(r, e) => { if (e.button === 0) revealLine(stuckLine.at, false); onRowPick(r, e); }}
                        onTake={onTake}
                        onFillRow={onFillRow}
                        subRows={{ count: stuckLine.lg.row.lines[stuckLine.lg.index]?.subRows.length ?? 0, open: true }}
                        onSubRows={(r, all) => { revealLine(stuckLine.at, all); onSubRows(r, all); }}
                        noun={noun}
                        sticky
                    />
                </Box>
            )}
        </Box>
    );
    const content = (
        <Box ref={rootRef} css={styles.root} data-sheet data-sheet-partial={transport !== undefined && !exhausted ? "" : undefined} data-copilot={copilotOn ? "" : undefined}
            data-lens={lensOn ? "" : undefined} data-view={ui.tabs.active ?? undefined} data-moving={moving ? "" : undefined}
            {...(frameFills ? { style: { height, maxHeight } } : {})}>
            {/* One bar: the tabs, the search rail and, right of it, the history controls. */}
            {(chrome !== undefined || transport !== undefined || !readOnly) && (
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
                    trailing={!readOnly ? <SheetHistory session={session} styles={styles} editing={ui.edit !== null} onAction={onHistoryAction} onIssue={onIssue} /> : undefined}
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
                    getItemKey={itemKey}
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
                {seam !== undefined && canInsert && (
                    <SheetInsertLayer ref={insertLayerRef} styles={styles} seam={seam} actions={insertActions(seam.r, seam.side)} onLeave={onSeamLeave} />
                )}
            </Box>
            {(wr !== null && edit === null || rows.length === 0) && editingState.available && <SheetInsertStrip styles={styles}
                ordered={!value.editing.keyed || anchorFor(ui.sel.r, "before").child !== undefined}
                above={canInsertRows ? () => onInsert("row", wr?.r0 ?? ui.sel.r, "before") : undefined}
                below={canInsertRows && (group === undefined || rows.length > 0) ? () => onInsert("row", wr?.r1 ?? ui.sel.r, "after") : undefined}
                group={canInsertGroups ? () => onInsert("group", wr?.r1 ?? ui.sel.r, "after") : undefined}
                groupWord={noun.singular} />}
            <SheetStrip styles={styles} model={strip} onAction={onStripAction} />
            <SheetFooter styles={styles} items={value.footer} summary={summary} hint={hint} message={ui.msg} transport={transport} />
        </Box>
    );

    const densityTag = getSomeorUndefined(value.density)?.type;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{content}</DensityProvider>
        : content;
}, (prev, next) => sheetRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
