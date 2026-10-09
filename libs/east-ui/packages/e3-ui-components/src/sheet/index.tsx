/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's shared state and its parts — the planning spreadsheet (`Sheet
 * Spec.md` §6): decode, the row source (both arms), the local data layer
 * (edits over the decoded rows until the source writes back), THE state
 * machine, the effect runner, the copilot runner (§6.2), and what they draw —
 * the toolbar's items · the sticky two-line header · virtualised rows · the
 * docked strip · the footer.
 *
 * The Sheet itself — `<Sheet>`, the `Sheet` extension `@elaraai/e3-ui`
 * declares (#1216) — is `EastChakraSheet` (`frame/index.tsx`): one
 * `BuilderFrame` whose regions hold these parts.
 *
 * Three parts over one shared state (SB4, #1181). `SheetProvider` builds the
 * store, the editing session, the lens and the selection, every hook in the
 * order it always ran, and the frame places what it builds: the toolbar's
 * items (`useSheetToolbarItems()`) in its one toolbar, `SheetGrid` — the
 * header, the rows and the strip, inside `SheetRoot` — in main, which it
 * fills, scrolling its own rows, and the footer (`useSheetFooter()`'s props)
 * in its footer, driving one grid (SB5). Its banners read the session
 * through `useSheetHistory()` (#1184), so the history item shows no error of
 * its own. What the frame hands the parts besides is {@link SheetHost}: the
 * columns the viewer hides, and the drops the sheet takes.
 *
 * A source-bound transaction session retains draft gestures and history —
 * the editing session every editable collection shares (`src/editing/`,
 * #879), with its history bar in the toolbar, in the sheet's words.
 * onPatch observes each completed gesture; onApply submits a checked batch.
 * Overlays retire only after the source acknowledges the committed result.
 * Function values come from the latest render; submitted callbacks remain
 * captured until their request resolves.
 *
 * The Sheet's memo compares with `equivalentFor` (#809), so a value whose
 * only change is a closure — a swapped provider, an `onPatch` over new data —
 * still re-renders, and every function is taken from the latest value
 * (§6.2). The derivations that own local state (the decoded rows, the
 * controlled selection) key on the value's DATA identity instead, and the
 * transaction session on its source and schema, so such a change never
 * resets them; the copilot's memo is keyed on the value's identity.
 *
 * Grouped rows (#740): the source rows are GROUPS; the body draws each
 * group's band over its lines (pseudo rows tagged with their group), one
 * blank line per open group during the insertion migration. A write on a line
 * rewrites its group (`lineCommit` / `lineInsert` / `lineRemove` carry the
 * whole group after the edit, a line's address as its position); a
 * summary field commits the group. Explicit insertion controls create groups.
 *
 * A line may carry SUB ROWS (#844): read-only rows under the line that
 * share none of its columns, outside the row space, opened by the line's
 * chevron or Space, or by the lens when a search hits one of them. A gesture
 * that folds or opens moves rows with a short slide, and the rows it brings
 * into view drop in; nothing moves on a scroll, a lens change or a view
 * switch, and nothing at all under reduced motion.
 *
 * The frame's drops (`SheetHost.drop`, #1187) make each row a drop target on
 * the sheet's surface and each row's gutter a grip: its library's templates
 * insert at a seam, its author's cards set their cells on a row or a band,
 * and a row, a line or a group moves to another seam —
 * each drop one transaction, planned by `drop.ts` from the rows as they
 * stand, and the ghost saying where it lands, or why it can't.
 *
 * On a coarse pointer, a frame too narrow for the touch gutter beside the
 * first column FOLDS the gutter (#1215, `gutter.ts`): each row's actions go
 * into one 44 px row-actions button — its grip, and a tap's menu of its
 * decisions and the inserts at it — and the seams offer no chips.
 */

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type MouseEvent, type KeyboardEvent, type ClipboardEvent, type ReactNode, type RefObject } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { ArrayType, StringType, equalFor, fromEastTypeValue, none, printFor, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetBatchReadinessType, SheetDraftFieldType } from "@elaraai/e3-ui/internal";
import { Slice } from "@elaraai/east-ui/internal";
import {
    focusKeySearch, getSomeorUndefined, useCoarsePointer, useSliceReactivity, useDataStable, usePersistedState, useDragLayerOptional, useDragTarget,
    type CellCoord, type DragEventValue, type DragPayload, type DragTargetConfig, type EditIssue, type HistoryAction, historyToolbarItem, historyShortcut, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { DensityProvider, useDensityHeights, railAffordanceKinds, VirtualRows, kindOfIssue, type RowsViewport, windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { boundSliceConfig } from "@elaraai/east-ui-components/platform";
import {
    BOTTOM_PAD_PX, DEFAULT_BLANKS, DEFAULT_GUTTER_PX, NEW_LINE_KEY, NULL_CELL, TITLE_KEY,
    blankIdOf, bodyIndexOfId, buildBody, cellIsBlank, cellText, countNoun, densityOf, drawnPx, driverKeyOf, groupBandPx, indexColumns, indexGroup, indexRegisters, isLooseRow, isRowSpace, itemPx,
    latencyOf, layoutRun, lineAddress, lineId, linePosition, lineRowsOf, parseWidth, resolveMember as resolveRegisterMember, rowIsBlank, segmentOf, stickyRows, withLine, withProposals, withoutLines,
    type LineGroup, type SheetBodyItem, type SheetColumnMeta, type SheetGeometry,
} from "./model.js";
import { SHEET_PAGE_SIZE, useSheetPaging, type SheetViewport } from "./paging.js";
import { placeInOrder } from "./placement.js";
import { keyOrderOf } from "./key-order.js";
import { NOT_PERSISTED, persistedOf, sameAnchor, sameFolds, type SheetAnchor, type SheetPersisted } from "./persisted.js";
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
    initialSheetStore, sheetReducer, sheetStoreReducer, selectionRect, wholeRows, provisionalCell, nextTargetOf, fillOrder, isBlankRowId,
    type EditSource, type LensContext, type SheetEffect, type SheetEvent, type SheetMachineCtx, type SliceStateValue, type Suggestions,
} from "./sheet-state.js";
import type { SheetNotice } from "./sheet-types.js";
import type { EntryVersion, Origin, Placement, SheetTransactions } from "./transactions.js";
import {
    cardSource, dropCaption, dropName, dropRefusal, dropRowOf, locateDrop, payloadSource, planBelow, planDrop, printDropRow, readDropRow, slotAt,
    type SheetDropContext, type SheetDropHost, type SheetDropMark, type SheetDropPlan, type SheetDropRow, type SheetDropSource, type SheetRowDrop,
} from "./drop.js";
import { normalizeDraft } from "./draft-values.js";
import { noticeText, useSheetWords, type SheetWords } from "./words.js";
import { runSuggest, SuggestMemo, LATENCY_MS, type FillColumn } from "./suggest.js";
import { InFlight, trackWork } from "./suggest-async.js";
import { SheetInsertLayer, SheetInsertStrip, type InsertionActions, type InsertSeam } from "./Insertion.js";
import { anchorAt, insertionGesture, insertsLoose, groupInsertionSide, type InsertRequest, type InsertionAnchor } from "./insertion-gesture.js";
import { membershipAt } from "./membership.js";
import { SheetHeader } from "./Header.js";
import { SheetRow, SheetBandRow, SheetFailedBandRow, SheetGapRow, SheetProposalRow, SheetGroupRow, SheetRowBoundary, SheetSubRow, SheetRetry, type SheetRowAction } from "./Rows.js";
import { COARSE_GUTTER_PX, FOLDED_GUTTER_PX, GUTTER_PX, gutterFolds } from "./gutter.js";
import { SheetCellContent } from "./cells/Cell.js";
import { SheetTabs, type SheetTabsFold, type SheetTabView } from "./Tabs.js";
import { SheetEditor, type EditorFocusRequest, type EditorOption, type LinkEditorView } from "./Editor.js";
import { SheetStrip, buildStrip, type StripAction, type StripLinkInput, type StripSuggestInput } from "./Strip.js";
import type { SheetFooterProps, SheetTransport } from "./Footer.js";
import { useSheetEditing, type DraftEdit, type LocalLayer, type SheetSeeds } from "./use-editing.js";
import { draftPresentation, discardDraft, type DraftPresentation } from "./draft-state.js";
import { useSheetToolbarItemsFor, type SheetToolbarTabs } from "./Toolbar.js";
import type { SheetCellValue, SheetContextValue, SheetEditValue, SheetLineValue, SheetLinkValue, SheetMemberValue, SheetNounValue, SheetProposerValue, SheetRootValue, SheetRowValue, SheetSelectionValue, SheetSubRowValue, SheetViewValue } from "./values.js";

export type { SheetRootValue, SheetRowValue, SheetCellValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;
type SheetTransactionsIssue = SheetTransactions["issues"][number];
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

const sheetRootDataEqual = equalFor(Sheet.Types.Root);
const stringEqual = equalFor(StringType);
const cellEqual = equalFor(Sheet.Types.Cell);
const sliceStateEqual = equalFor(Slice.Types.State) as (a: SliceStateValue, b: SliceStateValue) => boolean;
const viewsEqual = equalFor(ArrayType(Sheet.Types.View)) as (a: readonly SheetViewValue[], b: readonly SheetViewValue[]) => boolean;
const readinessEqual = equalFor(SheetBatchReadinessType);
const printString = printFor(StringType);

/** The narrowing with nothing active — what the whole-sheet tab writes; the presentation fields (cohort registry, breakdown, visibility, resolution) stay. */
function clearNarrowing(state: SliceStateValue): SliceStateValue {
    return { ...state, range: none, filters: [], activeCohorts: new Set<string>(), search: none } as SliceStateValue;
}

/** A view's hover title (B§8) — its query and context, and the gestures it takes — in the sheet's words (#861). */
function viewTitle(view: SheetViewValue, words: SheetWords): string {
    const q = view.narrowing.search.type === "some" ? view.narrowing.search.value.trim() : "";
    const ctx = Number(view.context);
    const scope = q !== "" ? "query" : view.narrowing.range.type === "some" ? "range" : view.narrowing.filters.length > 0 || view.narrowing.activeCohorts.size > 0 ? "filter" : "none";
    return words.m.viewTitle({ scope, query: q, context: ctx > 0 ? words.number(ctx) : undefined });
}

/** The decoded rows with the local layer applied — its placements in one linear pass (#859), and a keyed source's rows in key order (#1182). */
function applyLayer(source: readonly SheetRowValue[], layer: LocalLayer, keyOrder?: (a: string, b: string) => number): SheetRowValue[] {
    if (layer.edits.size === 0 && layer.appended.length === 0 && layer.removed.size === 0 && layer.placements.size === 0) return source as SheetRowValue[];
    const out: SheetRowValue[] = [];
    for (const r of source) {
        if (layer.removed.has(r.id)) continue;
        out.push(layer.edits.get(r.id) ?? r);
    }
    for (const r of layer.appended) if (!layer.removed.has(r.id)) out.push(layer.edits.get(r.id) ?? r);
    const placed = placeInOrder(out, (row) => row.id, layer.placements);
    if (keyOrder !== undefined) placed.sort((a, b) => keyOrder(a.id, b.id));
    return placed;
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
        case "failed": return `failed:${it.failure.w}`;
        case "gap": return `gap:${it.gap.key}`;
        case "proposal": return `proposal:${it.anchorR}#${it.index}`;
    }
    return `#${i}`;
}

/** The source element a body item belongs to (#857) — a row, or a line's or a sub row's group; `null` where no element stands behind it (a paged band, a gap, a blank). */
function elementOf(it: SheetBodyItem): number | null {
    switch (it.kind) {
        case "real": case "group": case "subRow": return it.position;
        case "failed": return it.failure.from;
        default: return null;
    }
}

/**
 * The source element under a resting view's top (#857): its item's — or,
 * over an unloaded band, the element the band draws at that depth. A band is
 * a place in one run, never an item: a remount's bands cover other elements,
 * so what persists for one is the element. Its rows are drawn at the ledger's
 * rate, so the depth maps to an element proportionally.
 */
function elementUnder(it: SheetBodyItem, offset: number): number | null {
    if (it.kind !== "band") return elementOf(it);
    const { from, to, px } = it.band;
    const n = to - from + 1;
    return px > 0 ? from + Math.min(n - 1, Math.max(0, Math.floor((offset / px) * n))) : from;
}

/**
 * Where a persisted anchor whose item is gone lands (#857). On a paged sheet,
 * its element is the place: the first item at or past it — the band of a
 * failed window that holds it — because an index names a place only in the
 * run it was taken from. Otherwise its index, clamped to the body.
 */
function placeOf(body: readonly SheetBodyItem[], index: number, element: number | undefined): number {
    if (element !== undefined) {
        const at = body.findIndex((it) => (it.kind === "failed" ? it.failure.to : elementOf(it) ?? -1) >= element);
        if (at >= 0) return at;
    }
    return Math.min(index, body.length - 1);
}

/**
 * A row-space place's identity (#854): a row's or a group's id, a group's
 * blank line's (it names its group) — or, for a padding row, its place among
 * the padding: padding rows are alike, and their ids name positions that a
 * row inserted above moves (#877).
 */
type RowSlot = { id: string } | { blank: number };

/** The identity of a row-space item. */
function slotOf(it: SheetBodyItem): RowSlot | undefined {
    if (it.kind === "real" || it.kind === "group") return { id: it.row.id };
    if (it.kind === "blank") return it.group !== undefined ? { id: blankIdOf(it) } : { blank: it.blankIndex };
    return undefined;
}

/** Where each row-space place of `before` sits in `after` (#854) — `null` for a row that left (#877), `undefined` where `before` held nothing. */
function followRows(before: readonly (RowSlot | undefined)[], after: readonly (RowSlot | undefined)[]): (r: number) => number | null | undefined {
    const byId = new Map<string, number>();
    const byBlank = new Map<number, number>();
    after.forEach((slot, r) => {
        if (slot === undefined) return;
        if ("id" in slot) { if (!byId.has(slot.id)) byId.set(slot.id, r); }
        else if (!byBlank.has(slot.blank)) byBlank.set(slot.blank, r);
    });
    return (r) => {
        const slot = before[r];
        if (slot === undefined) return undefined;
        return ("id" in slot ? byId.get(slot.id) : byBlank.get(slot.blank)) ?? null;
    };
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

/** The source position a row-space item stands at — a row's, a group's band, a blank's the place it would take; `undefined` off the row space. */
function rowPositionOf(it: SheetBodyItem): number | undefined {
    return it.kind === "real" || it.kind === "group" || it.kind === "blank" ? it.position : undefined;
}

/**
 * A body item's place among the grid's rows (#860), counting the header as
 * the first: on a flat sheet a row's source position (a band, a gap or a
 * failed window where its first element would be; a proposal has no place of
 * its own), so the count and every index describe the whole source; on a
 * grouped sheet, the body's order — an unloaded run is one row, the Plan's
 * rule (#819).
 */
function ariaRowIndexOf(it: SheetBodyItem, i: number, grouped: boolean): number | undefined {
    if (grouped) return i + 2;
    switch (it.kind) {
        case "real": case "blank": return it.position + 2;
        case "band": return it.band.from + 2;
        case "gap": return it.gap.from + 2;
        case "failed": return it.failure.from + 2;
        default: return undefined;
    }
}

/** The body index of an anchor — a real row (or a group's band) by id, a blank row or blank line by its synthetic id. */
function anchorBodyIndex(body: readonly SheetBodyItem[], anchorId: string): number {
    if (!isBlankRowId(anchorId)) return bodyIndexOfId(body, anchorId);
    return body.findIndex((it) => it.kind === "blank" && blankIdOf(it) === anchorId);
}

/**
 * One cell write the component turns into a wire event; `extra` names the k-th
 * NEW row a write lands on past a group's blank line (a paste, #740 G9), or
 * past a loose row (#846 — a paste, a proposal). `key` names the write's
 * column in place of `c`, the grid's: a proposed row's cell under a column
 * the grid hides lands too (#1186).
 */
interface CellWrite {
    r: number;
    c: number;
    key?: string | undefined;
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

/** What the element the grid is laid in carries: the attributes the rows' styles and the tests key on. */
interface SheetRootFacts {
    /** A paged source with rows still to load. */
    partial: boolean;
    /** The copilot runs. */
    copilot: boolean;
    /** A narrowing is active. */
    lens: boolean;
    /** The open view tab, if any. */
    view: string | undefined;
    /** Rows slide after a gesture that folds or opens. */
    moving: boolean;
}

/**
 * What the sheet's parts place (SB4): everything the root builds before it
 * lays out, from one shared state — the store, the editing session, the
 * lens and the selection.
 */
export interface SheetParts {
    /** The sheet recipe's slot styles. */
    styles: Styles;
    /** What {@link SheetRoot} carries. */
    root: SheetRootFacts;
    /** The toolbar: its items, and the element the frame places them in. */
    toolbar: {
        items: ReadonlyArray<ToolbarItem | false | undefined>;
        ref: RefObject<HTMLDivElement | null>;
    };
    /** The header, the rows and the strip: what {@link SheetGrid} places. */
    grid: ReactNode;
    /** The footer's props: today's footer, fed from the shared state. */
    footer: SheetFooterProps;
    /** The editing session and its history actions: what the frame's banners report, and what their Retry and Discard run. */
    history: SheetHistory;
    /** What shows in place of the whole sheet when its source failed before any row landed (#853). */
    failure: ReactNode | undefined;
    /** What the inspector pane reads of the sheet, and the gestures it makes (#1188). */
    inspect: SheetInspect;
    /** A library card's ⏎ (#1187, SB45): the card, by its library and its key, taken as a drop below the ring's row. Stable. */
    enter: (library: string, key: string) => void;
}

/** The editing session as the frame reads it ({@link useSheetHistory}). */
export interface SheetHistory {
    /** The session: its status, its issues, its error and whether the source moved under its drafts. */
    session: SheetTransactions;
    /** Runs a history action as the history item does — an open editor commits first. */
    onAction: (action: HistoryAction) => void;
}

/**
 * What the frame hands the parts beside the payload (#1184): the viewer's
 * hidden columns, and the drops the sheet takes.
 */
export interface SheetHost {
    /**
     * The columns the grid leaves out, by key, and the band cells under them
     * (#1186) — a viewer's choice, never the sheet's: the lens still matches
     * them, and a new row still has every declared cell. Hiding every column
     * hides none.
     */
    hidden?: ReadonlySet<string> | undefined;
    /**
     * What the sheet takes dropped (#1187): the surface its rows register
     * on, a library's templates and an author's cards — and its rows' grips
     * move them. Absent, the sheet takes no drop and its rows have no grip.
     */
    drop?: SheetDropHost | undefined;
}

/** Where a gesture's new entry comes from when it is not the sheet's own: a dropped template's seeds, and its origin (#1187). */
interface SheetInsertFrom {
    seeds: SheetSeeds;
    origin: Origin;
}

/**
 * The sheet's drops as they stand (#1187): what the rows' shared
 * {@link SheetRowDrop} and the sheet's drop target call — made afresh each
 * render, read through a ref, so neither changes for it.
 */
interface SheetDropApi {
    /** Whether the drop a candidate event makes lands. */
    canDrop: (event: DragEventValue) => boolean;
    /** What the ghost says where a drag rests. */
    caption: (coord: CellCoord, payload: DragPayload) => string | undefined;
    /** Where it rests, as the announcements name it. */
    name: (coord: CellCoord, payload: DragPayload) => string;
    /** A drag rests over a row that takes it: the seam, or the row, lights. */
    hover: (el: HTMLElement, coord: CellCoord, payload: DragPayload) => void;
    /** A completed drag: run as one transaction — `false` when nothing changed. */
    drop: (event: DragEventValue) => boolean;
}

/** A row-space item's drop row, printed — what its drop cell's `CellRef` carries. */
function dropText(item: SheetBodyItem): string | undefined {
    const row = dropRowOf(item);
    return row === undefined ? undefined : printDropRow(row);
}

/**
 * Builds the sheet's shared state and the parts it lays out: the root's
 * whole body, its hooks in the order they always ran.
 */
function useSheet(value: SheetRootValue, storageKey: string, host: SheetHost): SheetParts {
    // Changes identity on a DATA change only — what owns local state keys on
    // it; callbacks come from `value` (#809).
    const data = useDataStable(value, sheetRootDataEqual);
    // The sheet's words (#861) — the message table in effect, and the
    // counts the chrome prints (the summary, the hints, the messages, the
    // lens line) in the app's locale (#850).
    const words = useSheetWords();
    // The grid's id: its cells' ids hang off it, and the view tabs name it as what they switch (#860).
    const gridId = useId();
    // ── Decode ────────────────────────────────────────────────────────────
    // Every declared column — what the lens matches and a new row is made
    // of — and the columns the grid draws: all but those the viewer hides
    // (#1186), and every one when it would hide them all.
    const allColumns = useMemo(() => indexColumns(value.columns), [value.columns]);
    const hidden = host.hidden;
    const columns = useMemo(() => {
        if (hidden === undefined || hidden.size === 0) return allColumns;
        const shown = value.columns.filter((c) => !hidden.has(c.key));
        return shown.length === 0 || shown.length === value.columns.length ? allColumns : indexColumns(shown);
    }, [allColumns, value.columns, hidden]);
    const registers = useMemo(() => indexRegisters(value.registers), [value.registers]);
    const driver = useMemo(() => getSomeorUndefined(value.driver), [value.driver]);
    const driverColumn = driver?.column;
    // Grouped rows (#740): the band's cells and the title span.
    const titleColumn = words.m.titleColumn();
    const group = useMemo(() => {
        const g = getSomeorUndefined(value.group);
        return g !== undefined ? indexGroup(g, columns, titleColumn) : undefined;
    }, [value.group, columns, titleColumn]);
    const titleMeta = group?.cells.get(TITLE_KEY);
    // Rows of the line type may stand between the groups (#846): a LOOSE row.
    const loose = group?.loose === true;
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const size = densityOf(value);
    const coarse = useCoarsePointer();
    const rowPx = Math.max(useDensityHeights(size).row, coarse ? 45 : 0);
    const bandPx = Math.max(groupBandPx(size), coarse ? 46 : 42);
    // A sub row's least height; a wrapping detail grows it, and the rows are measured.
    const subRowPx = 30;
    // The word for a group: the host's (#844), else the sheet's words (#861).
    // The machine's messages carry only the host's, and word a missing one
    // when they show — so a new table re-words them.
    const declaredNoun = group?.noun;
    const noun = useMemo<SheetNounValue>(() => declaredNoun ?? { singular: words.m.groupNoun(), plural: words.m.groupNouns() }, [declaredNoun, words.m]);
    const readOnly = (getSomeorUndefined(value.readOnly) ?? false) || value.editing.onApply.type === "none";
    const capabilities = value.editing.edits;
    // A keyed source — paged (#880), or a record read whole (#1182): its rows
    // sort by key, at the key's own type, so nothing is placed by position.
    const keyed = value.editing.keyType.type === "some";
    const keyOrder = useMemo(() => (value.editing.keyType.type === "some" ? keyOrderOf(value.editing.keyType.value) : undefined), [value.editing.keyType]);
    const canInsertRows = !readOnly && capabilities.insertRows;
    const canInsertGroups = !readOnly && capabilities.insertGroups && group !== undefined;
    // The grouped blank-tail path remains until all insertions use explicit destinations.
    const blanks = !capabilities.insertRows ? 0 : group !== undefined ? (readOnly ? 0 : 1) : Number(getSomeorUndefined(value.blanks) ?? BigInt(DEFAULT_BLANKS));
    // What moves the rows, as the frame reports it (#856): the element they
    // scroll in, both ways.
    const [viewport, setViewport] = useState<RowsViewport | null>(null);
    // The frame's width: inside it (`clientWidth`), the view a sub row's well
    // keeps its content to; its box (`offsetWidth`, which no scrollbar of its
    // own changes), what decides whether the gutter folds (#1215).
    const [viewPx, setViewPx] = useState<number | undefined>(undefined);
    const [framePx, setFramePx] = useState<number | undefined>(undefined);
    // Touch targets fit in separate lanes; row heights include their seam borders.
    const fullGutterPx = Math.max(parseWidth(style !== undefined ? getSomeorUndefined(style.gutterWidth) : undefined) ?? DEFAULT_GUTTER_PX, GUTTER_PX, coarse ? COARSE_GUTTER_PX : 0);
    // A frame too narrow for the touch gutter beside the first column folds it: one row-actions button holds each row's actions (#1215).
    const folded = gutterFolds(framePx, coarse, fullGutterPx, columns.list[0]?.width);
    const gutterPx = folded ? FOLDED_GUTTER_PX : fullGutterPx;
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
    const views = useMemo(() => Object.is(viewsState.over, value.views) || viewsEqual(viewsState.over, value.views) ? viewsState.views : value.views, [viewsState, value.views]);
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
    // Either windowed arm: `paged`, or `pinned` naming its snapshot — the one
    // the driver follows through changes, and the session edits.
    const pagedSource = windowedSourceOf(value.rows);
    const decodedRows = useMemo<readonly SheetRowValue[] | undefined>(
        () => (data.rows.type === "inline" ? (data.rows.value as readonly SheetRowValue[]) : undefined),
        [data.rows],
    );
    // ── What survives a remount (#857) ────────────────────────────────────
    // Under the sheet's `storageKey`: the folds the viewer left, with the tab
    // they left them on, and where the frame's scroll rests — the Plan's
    // rule (#813). Read once, at mount; written when either changes, and only
    // when it differs from what storage holds.
    const { state: stored, setState: setStored } = usePersistedState<SheetPersisted>(storageKey, NOT_PERSISTED);
    const [restored] = useState(() => persistedOf(stored));
    const persistedRef = useRef(restored);
    const persist = useCallback((next: SheetPersisted) => {
        persistedRef.current = next;
        setStored(next);
    }, [setStored]);

    // ── The state machine ─────────────────────────────────────────────────
    const [store, dispatchStore] = useReducer(sheetStoreReducer, undefined, () => {
        // The folds the last session left, when the sheet opens on the tab
        // they were left on (#857).
        const opening = activeView ?? null;
        const restoredFolds = restored.view === opening && restored.folds.length > 0 ? new Map(restored.folds) : undefined;
        // The ring opens on the first blank row's driver column (else its first
        // column) — the prototype's "type an activity on the empty row"; a
        // grouped sheet: the first group's blank line — or a first loose row
        // itself (#846).
        const c = Math.max(0, driverColumn !== undefined ? columns.list.findIndex((col) => col.key === driverColumn) : 0);
        const first = decodedRows?.[0];
        const firstFolded = first !== undefined && (restoredFolds?.get(first.id) ?? getSomeorUndefined(first.band)?.folded === true);
        const r = group !== undefined ? (first !== undefined && !isLooseRow(first) && !firstFolded ? 1 + first.lines.length : 0) : decodedRows?.length ?? 0;
        return initialSheetStore({ r, c }, opening, restoredFolds);
    });
    const ui = store.ui;
    const folds = ui.lens.folds;
    const foldedOf = useCallback((row: SheetRowValue): boolean => folds.get(row.id) ?? getSomeorUndefined(row.band)?.folded ?? false, [folds]);
    // A line's sub rows fold under its id like a group under its own: `false` open, `true` closed, absent untouched.
    const subRowsOpenOf = useCallback((lineKey: string): boolean | undefined => { const f = folds.get(lineKey); return f === undefined ? undefined : !f; }, [folds]);
    // What the body draws of one source row (#855): the paged driver measures a
    // window by it, so an unloaded band is as tall as its rows will be.
    const geometry = useMemo<SheetGeometry>(() => ({ rowPx, bandPx, subRowPx }), [rowPx, bandPx, subRowPx]);
    const heightOf = useCallback(
        (row: SheetRowValue) => drawnPx(row, geometry, group !== undefined ? { foldedOf, subRowsOpen: subRowsOpenOf } : undefined, blanks),
        [geometry, group, foldedOf, subRowsOpenOf, blanks],
    );
    const paging = useSheetPaging(pagedSource, heightOf);
    const sourceRows: readonly SheetRowValue[] = decodedRows ?? paging.rows;
    const rowsOffset = decodedRows !== undefined ? 0 : paging.rowsOffset;
    // Each source row's position — its index inline; paged, its place in the
    // source, which a failed window before it does not move (#853).
    const inlinePositions = useMemo(() => decodedRows?.map((_r, i) => i), [decodedRows]);
    const sourcePositions: readonly number[] = inlinePositions ?? paging.positions;
    const exhausted = decodedRows !== undefined || paging.exhausted;
    // A new line beside loose rows (#846) takes a minted id: the field a loose row is identified by.
    const mintLineId = useCallback(() => newRowIdFn?.() ?? mintId((id) => sourceRows.some((row) => row.id === id)), [newRowIdFn, sourceRows]);
    const editingState = useSheetEditing(value.editing, pagedSource, sourceRows, sourcePositions, storageKey, loose ? mintLineId : undefined);
    const session = editingState.session;
    // The session's readiness, held by value: what keys on it — the rows'
    // draft presentations — moves only when it does (#858).
    const readiness = useDataStable(session.readiness, readinessEqual);
    const draftType = useMemo(() => fromEastTypeValue(value.editing.draftType), [value.editing.draftType]);
    const childField = getSomeorUndefined(value.editing.children);
    const draftVersion = editingState.version;
    const recordGesture = editingState.record;
    const drafts = editingState.drafts;
    const layer = editingState.layer;
    // A row's draft presentation, derived once per session change (#858): the
    // gutter's decisions and the row read the same one, and between changes a
    // row keeps it by identity, so its memo holds.
    const draftOf = useMemo(() => {
        const byEntry = new Map<string, Map<string | undefined, DraftPresentation>>();
        return (id: string, child?: string): DraftPresentation => {
            let byChild = byEntry.get(id);
            if (byChild === undefined) { byChild = new Map(); byEntry.set(id, byChild); }
            let found = byChild.get(child);
            if (found === undefined) { found = draftPresentation(session, draftType, childField, id, child, readiness, words); byChild.set(child, found); }
            return found;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, draftType, childField, readiness, draftVersion, words]);
    // Temporary writes within one reducer effect batch; the transaction session
    // publishes the completed gesture and owns the rendered layer thereafter.
    const layerRef = useRef(layer);
    layerRef.current = layer;
    const setLayer = useCallback((fn: (prev: LocalLayer) => LocalLayer) => { layerRef.current = fn(layerRef.current); }, []);
    const rows = useMemo(() => applyLayer(sourceRows, layer, keyOrder), [sourceRows, layer, keyOrder]);
    // Each row's position on screen, where each failed window sits among the
    // rows, and the contiguous runs between them (#853).
    const runLayout = useMemo(() => {
        const at = new Map(sourceRows.map((row, i) => [row.id, sourcePositions[i]!] as const));
        return layoutRun(rows, rowsOffset, decodedRows !== undefined ? [] : paging.failures, (id) => at.get(id));
    }, [rows, rowsOffset, sourceRows, sourcePositions, decodedRows, paging.failures]);

    // ── The lens (B§8) — hits from the slice engine over the resident rows ──
    // A grouped sheet (#740): a group shows when its title or any line
    // matches (or it is revealed); INSIDE a shown group the lens works on the
    // lines — hits keep their numbers, the context switch and the reveals
    // apply to lines, and the hidden runs collapse into gaps. A group whose
    // title matches shows every line. It matches every declared column, the
    // hidden ones too (#1186).
    const lens = useMemo(() => {
        if (!lensOn || sliceState === undefined || sliceConfig === undefined) return undefined;
        const positions = runLayout.positions;
        const hits = lensHits(sliceState, sliceConfig, rows, allColumns.list);
        if (group === undefined) {
            const visible = lensVisible(hits, positions, ui.lens.context, ui.lens.reveals);
            return { hits, visible, gaps: lensGaps(hits, visible, positions) };
        }
        const visible = lensVisible(hits, positions, 0, ui.lens.reveals);
        const lineHits = rows.map((g) => lensLineHits(sliceState, sliceConfig, g, allColumns.list));
        const linePositions = rows.map((g, i) => g.lines.map((_l, j) => linePosition(positions[i]!, j)));
        const lineVisible = rows.map((g, i) => (lensTitleHit(sliceState, sliceConfig, g, allColumns.list)
            ? g.lines.map(() => true)
            : lensVisible(lineHits[i]!, linePositions[i]!, ui.lens.context, ui.lens.reveals)));
        const lineGaps = rows.map((_g, i) => lensGaps(lineHits[i]!, lineVisible[i]!, linePositions[i]!));
        // Which sub rows a search answers through: a line hit only there shows them.
        const lineSubRowHits = rows.map((g, i) => lensSubRowHits(sliceState, g, lineHits[i]!));
        return { hits, visible, gaps: lensGaps(hits, visible, positions), lineHits, lineVisible, lineGaps, lineSubRowHits };
    }, [lensOn, sliceState, sliceConfig, rows, runLayout, allColumns, ui.lens.context, ui.lens.reveals, group]);

    // ── The body ──────────────────────────────────────────────────────────
    const bodyBase = useMemo<SheetBodyItem[]>(() => buildBody({
        rows, rowsOffset, positions: runLayout.positions, failures: runLayout.failures,
        blanks: group !== undefined ? blanks : blanks + ui.appended, exhausted,
        total: paging.total, head: paging.head, tail: paging.tail,
        lens,
        grouped: group !== undefined ? { foldedOf, subRowsOpen: subRowsOpenOf } : undefined,
    }), [rows, rowsOffset, runLayout, blanks, ui.appended, exhausted, paging.total, paging.head, paging.tail, lens, group, foldedOf, subRowsOpenOf]);
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
    // Each body item's place in its group's rail, once per body (#858): a
    // row is handed its own entry, which holds still until the body moves.
    const memberships = useMemo(() => body.map((_it, i) => membershipAt(body, i)), [body]);
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
    // The loose rows between the groups (#846), in order: what a loose row's candidates rank against.
    const looseRows = useMemo(() => (loose ? rows.filter(isLooseRow) : []), [loose, rows]);
    // A line's candidates rank against ITS GROUP's lines (the row above is the line above); a loose row's, against the loose rows.
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
        if (it !== undefined && it.kind === "real" && it.loose !== undefined) return { registers, rows: looseRows, rowIndex: it.loose, driverColumn, allowed };
        return { registers, rows, rowIndex: it !== undefined && it.kind === "real" ? it.residentIndex : -1, driverColumn, allowed };
    }, [rowAt, registers, rows, looseRows, driverColumn]);
    /** The wire context over a row — the copilot's, a check's, a custom parse's (§4.4); a line's names its group and its key (#740). */
    const wireContextOf = useCallback((row: SheetRowValue | undefined, residentIndex: number, position: number, rowsNow: SheetRowValue[], lg?: LineGroup): SheetContextValue => {
        const driverKey = driverKeyOf(row, driverColumn);
        // The rows an author sees are the contiguous run around this one: a
        // failed window is never inside them, so `rowsOffset + index` stays
        // each one's position — the bridge reads their entries by it (#853).
        const segments = runLayout.segments;
        const seg = segmentOf(segments, residentIndex);
        const last = seg === segments[segments.length - 1];
        return {
            drafts,
            rowIndex: BigInt(lg !== undefined ? lg.index : residentIndex - seg.start),
            rowId: lg !== undefined ? lg.row.id : row?.id ?? "",
            offset: BigInt(position),
            line: lg !== undefined ? some(lg.key === "" ? NEW_LINE_KEY : lg.key) : none,
            row: row?.cells ?? new Map(allColumns.list.map((c) => [c.key, NULL_CELL])),
            rows: rowsNow.slice(seg.start, last ? undefined : seg.end),
            rowsOffset: BigInt(seg.position),
            partial: !exhausted,
            driver: driverKey !== undefined ? some(driverKey) : none,
            today,
        };
    }, [driverColumn, allColumns, runLayout, exhausted, today, drafts]);
    // The position after the last row — where a blank row or an append lands.
    const lastSegment = runLayout.segments[runLayout.segments.length - 1]!;
    const endPosition = lastSegment.position + (lastSegment.end - lastSegment.start);
    const wireContextFor = useCallback((r: number): SheetContextValue => {
        const it = rowAt(r);
        const row = it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row : undefined;
        const position = it !== undefined && (it.kind === "real" || it.kind === "blank" || it.kind === "group") ? it.position : endPosition;
        const lg = it !== undefined && (it.kind === "real" || it.kind === "blank") ? it.group : undefined;
        return wireContextOf(row, it !== undefined && (it.kind === "real" || it.kind === "group") ? it.residentIndex : rows.length, position, rows, lg);
    }, [rowAt, rows, endPosition, wireContextOf]);
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
    const links = useSheetLinks({ drafts, columns, registers, driver, driverColumn, body, rowAt, predictedLink, allowedFor, words });
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

    // What moves a page (#860): the rows the frame shows — less one, so a
    // page keeps a row of context. Unmeasured (a frame not laid out), the
    // machine's default. The frame is the one the rows report (`viewport`,
    // below), read when the key comes.
    const viewportRef = useRef<RowsViewport | null>(null);
    const pageRows = useCallback((): number => {
        const frame = viewportRef.current;
        const px = frame === null ? 0 : frame.frame.clientHeight;
        return px > 0 ? Math.max(1, Math.floor(px / rowPx) - 1) : 10;
    }, [rowPx]);
    const pagedHead = paging.head;
    const pagedTail = paging.tail;
    const jumpToElement = paging.jumpToElement;
    const ctx = useMemo<SheetMachineCtx>(() => ({
        rowCount,
        colCount,
        lensActive: lensOn,
        grouped: group !== undefined,
        // Group insertion uses explicit controls; keyboard padding is flat-only.
        canAppend: exhausted && canInsertRows && editingState.available && group === undefined,
        // A paged sheet's ends (#860): an unloaded run past the row space is a band.
        edges: pagedSource === undefined ? undefined : { atStart: pagedHead === undefined, atEnd: pagedTail === undefined },
        pageRows,
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
        // Every group, the ones a lens hides included: what fold-all folds — never a loose row (#846).
        groupIds: group !== undefined ? rows.filter((row) => !isLooseRow(row)).map((row) => row.id) : undefined,
        looseAt: (r) => { const it = rowAt(r); return it !== undefined && it.kind === "real" && it.loose !== undefined; },
        // The host's word only: a message words a missing one when it shows (#861).
        groupNoun: declaredNoun,
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
    }), [rowCount, colCount, lensOn, exhausted, readOnly, canInsertRows, editingState.available, group, declaredNoun, columns, rows, rowAt, metaAt, parseCtxFor, candidateCtxFor, cellAt, levelAt, words, linkCtxFor, rowOf, idAt, driverColumn, views, sliceState, emptyNarrowing, dirty, rowSpace, body, pagedSource, pagedHead, pagedTail, pageRows]);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const uiRef = useRef(ui);
    uiRef.current = ui;
    const dispatch = useCallback((e: SheetEvent) => dispatchStore({ t: "event", e, ctx: ctxRef.current }), []);

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
    }, [activeView, dispatch, restored]);
    // The folds persist with the tab they are on (#857).
    useEffect(() => {
        const p = persistedRef.current;
        if (sameFolds(p, ui.tabs.active, ui.lens.folds)) return;
        persist({ ...p, view: ui.tabs.active, folds: [...ui.lens.folds] });
    }, [ui.lens.folds, ui.tabs.active, persist]);

    // ── Writes — the local layer, then the host ───────────────────────────
    const gestureEvents = useRef<SheetEditValue[]>([]);
    const emitEdit = useCallback((edit: SheetEditValue) => { gestureEvents.current.push(edit); }, []);
    /**
     * Write cells: a real row's commits land in the layer's edits (one
     * `commit` event per changed cell, each carrying the row AFTER it); a
     * blank row's cells become one inserted row (one `insert` event), and so
     * do the k-th rows past a loose row (#846), each placed after the one
     * before. Returns the row-space index the FIRST inserted row landed on, so
     * the ring can follow a blank row that just became real, and the ids of
     * the rows written, in order.
     */
    const writeCells = useCallback((writes: readonly CellWrite[], source: EditSource): { firstInserted: number | undefined; ids: string[] } => {
        if (readOnly || !editingState.available) return { firstInserted: undefined, ids: [] };
        // Writes group by row, and by the extra new line they land on past a group's blank line.
        const byRow = new Map<string, { r: number; extra: number; list: CellWrite[] }>();
        for (const w of writes) {
            const extra = w.extra ?? 0;
            const k = `${w.r}#${extra}`;
            const entry = byRow.get(k) ?? { r: w.r, extra, list: [] };
            entry.list.push(w);
            byRow.set(k, entry);
        }
        // A write's column: the one it names, hidden or not, else the grid's at its index.
        const metaOf = (w: CellWrite): SheetColumnMeta | undefined => (w.key !== undefined ? allColumns.byKey.get(w.key) : columns.list[w.c]);
        const base = layerRef.current;
        const rowsNow = applyLayer(sourceRows, base, keyOrder);
        const edits = new Map(base.edits);
        const appended = [...base.appended];
        const events: SheetEditValue[] = [];
        const ids: string[] = [];
        let lastId = rowsNow.length > 0 ? rowsNow[rowsNow.length - 1]!.id : undefined;
        let firstInserted: number | undefined;
        let inserted = 0;
        const src = variant(source, null);
        // The ids a minted one must avoid — one set per write, grown as rows
        // append, never a scan of the rows per new row (#859).
        const takenIds = new Set<string>();
        for (const x of rowsNow) takenIds.add(x.id);
        for (const x of appended) takenIds.add(x.id);
        const taken = (id: string) => takenIds.has(id);
        // The last new loose row placed after each loose row (#846): the next lands after it.
        const chained = new Map<string, string>();
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
                        const meta = metaOf(w);
                        if (meta === undefined) continue;
                        if (cellEqual(cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                        cells.set(meta.key, w.cell);
                        changed = true;
                        g = withLine(g, lg.key, new Map(cells));
                        events.push(variant("lineCommit", { rowId: g.id, offset: BigInt(it.position), line: lineAddress(lg.index), key: meta.key, row: g, source: src }));
                    }
                    if (changed) setGroup(g);
                    ids.push(it.row.id);
                    continue;
                }
                // A group's blank line (or the k-th line past it): one line inserted at the end of the group.
                if (it.kind === "blank" && it.group !== undefined) {
                    if (!canInsertRows) continue;
                    const g0 = currentGroup(it.group.row);
                    const cells = new Map<string, SheetCellValue>(allColumns.list.map((c) => [c.key, NULL_CELL]));
                    for (const w of list) {
                        const meta = metaOf(w);
                        if (meta !== undefined) cells.set(meta.key, w.cell);
                    }
                    if (allColumns.list.every((c) => cellIsBlank(cells.get(c.key)))) continue;
                    const key = mintLineKey(g0);
                    const index = g0.lines.length;
                    const last = g0.lines[index - 1];
                    const g: SheetRowValue = { ...g0, lines: [...g0.lines, { key, cells, subRows: [] }] };
                    events.push(variant("lineInsert", {
                        rowId: g.id, offset: BigInt(it.position),
                        after: last !== undefined ? some(lineAddress(index - 1)) : none,
                        line: lineAddress(index), row: g, source: src,
                    }));
                    setGroup(g);
                    ids.push(lineId(g.id, key));
                    if (firstInserted === undefined) firstInserted = r + extra;
                    continue;
                }
                // Past a loose row (#846) — a paste's rows beyond the run, a
                // proposal under it: the k-th new loose row, after the one before.
                if (it.kind === "real" && it.loose !== undefined && extra > 0) {
                    if (!canInsertRows) continue;
                    let row = blankRow(newRowIdFn !== undefined ? newRowIdFn() : mintId(taken), allColumns.list);
                    for (const w of list) {
                        const meta = metaOf(w);
                        if (meta !== undefined) row = withCell(row, meta.key, w.cell);
                    }
                    if (allColumns.list.every((c) => cellIsBlank(row.cells.get(c.key)))) continue;
                    const after = chained.get(it.row.id) ?? it.row.id;
                    appended.push(row);
                    takenIds.add(row.id);
                    events.push(variant("insert", { afterRowId: some(after), row, source: src }));
                    chained.set(it.row.id, row.id);
                    ids.push(row.id);
                    if (firstInserted === undefined) firstInserted = r + extra;
                    continue;
                }
                // A band cell: the group's own field commits.
                if (it.kind === "group") {
                    const g0 = currentGroup(it.row);
                    let g = g0;
                    for (const w of list) {
                        const meta = w.key !== undefined ? group.cells.get(w.key) : metaAt(r, w.c);
                        if (meta === undefined || !meta.editable) continue;
                        if (cellEqual(g.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                        const cells = new Map(g.cells);
                        cells.set(meta.key, w.cell);
                        g = { ...g, cells };
                        events.push(variant("commit", { rowId: g.id, offset: BigInt(it.position), key: meta.key, row: g, source: src }));
                    }
                    if (!Object.is(g, g0)) setGroup(g);
                    ids.push(g.id);
                    continue;
                }
            }
            if (it !== undefined && it.kind === "real") {
                let row = edits.get(it.row.id) ?? it.row;
                for (const w of list) {
                    const meta = metaOf(w);
                    if (meta === undefined) continue;
                    if (cellEqual(row.cells.get(meta.key) ?? NULL_CELL, w.cell)) continue;
                    row = withCell(row, meta.key, w.cell);
                    events.push(variant("commit", { rowId: row.id, offset: BigInt(it.position), key: meta.key, row, source: src }));
                }
                if (!Object.is(row, it.row)) edits.set(row.id, row);
                ids.push(row.id);
                continue;
            }
            if (it !== undefined && !isRowSpace(it)) continue;
            if (group !== undefined || !canInsertRows) continue;
            // A blank row (or a row past the padding): one inserted row.
            let row = blankRow(newRowIdFn !== undefined ? newRowIdFn() : mintId(taken), allColumns.list);
            for (const w of list) {
                const meta = metaOf(w);
                if (meta !== undefined) row = withCell(row, meta.key, w.cell);
            }
            if (allColumns.list.every((c) => cellIsBlank(row.cells.get(c.key)))) continue;
            appended.push(row);
            takenIds.add(row.id);
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
    }, [sourceRows, rowAt, columns, allColumns, group, metaAt, newRowIdFn, setLayer, emitEdit, readOnly, canInsertRows, keyOrder, editingState.available]);
    /**
     * Delete whole rows. On a grouped sheet (#740, G7) lines in the range
     * leave their groups (`lineRemove`) and loose rows in it leave the sheet
     * (#846, `remove`); with neither in the range, the empty groups whose
     * bands are in it leave the sheet (`remove`) — the two-step ladder: the
     * rows, then the group.
     */
    const deleteRows = useCallback((r0: number, r1: number): { n: number; what: "rows" | "lines" | "groups"; emptiedBandR: number | undefined } => {
        if (readOnly || !editingState.available) return { n: 0, what: "rows", emptiedBandR: undefined };
        const base = layerRef.current;
        if (group !== undefined) {
            const currentGroup = (g: SheetRowValue): SheetRowValue => base.edits.get(g.id) ?? base.appended.find((x) => x.id === g.id) ?? g;
            const byGroup = new Map<string, { row: SheetRowValue; position: number; keys: string[]; addresses: string[] }>();
            const bands: { row: SheetRowValue }[] = [];
            const looseIds: string[] = [];
            // The row-space rows this step removes, to find where an emptied band lands once they have gone.
            const removedRs: number[] = [];
            for (let r = r0; r <= r1; r++) {
                const it = rowAt(r);
                if (it === undefined) continue;
                if (it.kind === "real" && it.group !== undefined) {
                    const entry = byGroup.get(it.group.row.id) ?? { row: it.group.row, position: it.position, keys: [], addresses: [] };
                    entry.keys.push(it.group.key);
                    entry.addresses.push(lineAddress(it.group.index));
                    byGroup.set(it.group.row.id, entry);
                    removedRs.push(r);
                } else if (it.kind === "real" && it.loose !== undefined) {
                    looseIds.push(it.row.id);
                    removedRs.push(r);
                } else if (it.kind === "group") {
                    bands.push({ row: it.row });
                }
            }
            if (byGroup.size > 0 || looseIds.length > 0) {
                const what = looseIds.length === 0 ? "lines" : "rows";
                if (!capabilities.removeRows) return { n: 0, what, emptiedBandR: undefined };
                const edits = new Map(base.edits);
                const appended = [...base.appended];
                let n = 0;
                // The first group left empty: the ring selects its band, so ⌫ again removes the group (G7) —
                // where the band lands once the rows above it in the range have gone.
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
                        if (bandR !== undefined && bandR >= 0) emptiedBandR = bandR - removedRs.filter((r) => r < bandR).length;
                    }
                }
                // Loose rows leave the sheet as entries of their own (#846).
                if (looseIds.length > 0) emitEdit(variant("remove", { rowIds: looseIds }));
                n += looseIds.length;
                const removed = looseIds.length > 0 ? new Set([...base.removed, ...looseIds]) : base.removed;
                const next: LocalLayer = { edits, appended, removed, placements: base.placements };
                layerRef.current = next;
                setLayer(() => next);
                return { n, what, emptiedBandR };
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
    /** What a proposed row writes: its set cells under the editable columns — every declared one, the grid's hidden ones too (#1186). */
    const proposalWrites = useCallback((cells: ReadonlyMap<string, SheetCellValue>): { key: string; cell: SheetCellValue }[] => {
        const writes: { key: string; cell: SheetCellValue }[] = [];
        for (const meta of allColumns.list) {
            if (!meta.editable || meta.kind === "stamped") continue;
            const cell = cells.get(meta.key);
            if (cell !== undefined && !cellIsBlank(cell)) writes.push({ key: meta.key, cell });
        }
        return writes;
    }, [allColumns]);
    /** Insert one proposed row after a row: into the blank slot below it (B§5.2), else appended; on a grouped sheet into the anchor's group (#740, G11). */
    const insertProposal = useCallback((afterR: number, cells: ReadonlyMap<string, SheetCellValue>, extra = 0): { id: string; r: number } | undefined => {
        if (!canInsertRows) return undefined;
        const writes = proposalWrites(cells);
        if (writes.length === 0) return undefined;
        if (group !== undefined) {
            const anchor = rowAt(afterR);
            const gid = anchor !== undefined && (anchor.kind === "real" || anchor.kind === "blank") ? anchor.group?.row.id : undefined;
            const blankR = gid !== undefined ? blankLineRowOf(gid) : undefined;
            if (blankR === undefined) return undefined;
            const res = writeCells(writes.map((w) => ({ r: blankR, c: -1, key: w.key, cell: w.cell, extra })), "pattern");
            const id = res.ids[0];
            return id === undefined ? undefined : { id, r: blankR + extra };
        }
        const next = rowAt(afterR + 1);
        let target: number;
        if (next !== undefined && next.kind === "blank") target = afterR + 1;
        else if (next !== undefined && next.kind === "real" && rowIsBlank(next.row, allColumns)) target = afterR + 1;
        else {
            const firstBlank = rowSpace.bodyIndexOf.findIndex((bi) => body[bi]!.kind === "blank");
            target = firstBlank < 0 ? rowCount : firstBlank;
        }
        const res = writeCells(writes.map((w) => ({ r: target, c: -1, key: w.key, cell: w.cell })), "pattern");
        const id = res.ids[0];
        if (id === undefined) return undefined;
        return { id, r: res.firstInserted ?? target };
    }, [proposalWrites, allColumns, group, rowAt, blankLineRowOf, rowSpace, body, rowCount, writeCells, canInsertRows]);
    /** Insert proposed rows under a loose row (#846): new loose rows after it, in order — one write, so each lands after the one before. Returns their ids. */
    const insertLooseProposals = useCallback((afterR: number, proposals: readonly { cells: ReadonlyMap<string, SheetCellValue> }[]): string[] => {
        if (!canInsertRows) return [];
        const writes = proposals.flatMap((p, i) => proposalWrites(p.cells).map((w) => ({ r: afterR, c: -1, key: w.key, cell: w.cell, extra: i + 1 })));
        return writes.length === 0 ? [] : writeCells(writes, "pattern").ids;
    }, [canInsertRows, proposalWrites, writeCells]);

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
    }, []);

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
     * unloaded run, the key search, or a remount's restore of its scroll. The
     * driver holds one jump — a key's move gives way to one it did not ask
     * for, and the search drops only its own.
     */
    const jumpBy = useRef<"key" | "search" | "anchor" | undefined>(undefined);
    // A keyboard move's reveal (#860): bumped with every `scroll.to`, and read once the frame has asked for its row.
    const [revealSeq, setRevealSeq] = useState(0);
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
                    if (readOnly) break;
                    const matrix = parseMatrix(eff.text);
                    if (matrix.length === 0) break;
                    const laid = layoutPaste(matrix, columns.list, eff.c);
                    const writes: CellWrite[] = [];
                    let skipped = 0;
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
                        const r = eff.r + p.dr;
                        const outcome = parseCell(meta, p.text, parseCtxFor(Math.min(r, blankR ?? r), meta));
                        const cell = outcome.kind === "unrecognised" ? variant("Invalid", p.text) : outcome.kind === "cell" ? outcome.cell : NULL_CELL;
                        if (looseEnd !== undefined) {
                            writes.push(r <= looseEnd ? { r, c: p.c, cell } : { r: looseEnd, c: p.c, cell, extra: r - looseEnd });
                            continue;
                        }
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
                        msg: { id: "pasted", rows: matrix.length, cols: matrix[0]?.length ?? 0, skipped },
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
                    setRevealSeq((n) => n + 1);
                    break;
                }
                case "seek.step":
                case "seek.edge": {
                    // Across an unloaded run (#860): the window beyond is fetched the
                    // way a key search jumps, and the ring lands once it is in (below).
                    const step = eff.t === "seek.step";
                    const element = step
                        ? (eff.dir > 0 ? paging.tail?.from : paging.head?.to)
                        : eff.edge === "first" ? 0 : paging.total !== undefined && paging.total > 0 ? paging.total - 1 : undefined;
                    if (element === undefined) break;
                    const land = step ? (eff.dir > 0 ? "first" : "last") : eff.edge === "first" ? "first" : "end";
                    seekIntent.current = { element, window: Math.floor(element / SHEET_PAGE_SIZE), land, c: eff.c, moves: ringMoves.current };
                    jumpBy.current = "key";
                    jumpToElement(element);
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
                    // The key search, in either form — its box, or folded to its icon its popover (#1221); else the first box in the row.
                    if (focusKeySearch(toolbarRef.current)) break;
                    const input = toolbarRef.current?.querySelector<HTMLInputElement>("input");
                    input?.focus();
                    input?.select();
                    break;
                }
            }
        }
        try { recordGesture(gestureEvents.current); }
        catch (error) { console.error("Sheet transaction failure", error); dispatchStore({ t: "patch", patch: { msg: { id: "text", text: error instanceof Error ? error.message : String(error) } } }); }
        finally { gestureEvents.current = []; }
    }, [recordGesture, writeCells, deleteRows, insertProposal, insertLooseProposals, columns, group, declaredNoun, words, metaAt, blankLineRowOf, readOnly, cellAt, colCount, parseCtxFor, onSelectFn, rowAt, rowOf, rowSpace, store.ui.sel, store.ui.edit, idAt, copilotOn, triggers, requestRun, requestReady, dispatch, value.views, onViewsChangeFn, slice, paging.head, paging.tail, paging.total, jumpToElement]);
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
        if (discardDraft(session, draftType, childField, id, child)) {
            dispatchStore({ t: "patch", patch: { sugg: null, msg: { id: "discarded" } } });
            cardRef.current?.focus({ preventScroll: true });
        }
    }, [session, draftType, childField]);
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
    const pendingInsertion = useRef<{ request: InsertRequest; from?: SheetInsertFrom | undefined } | undefined>(undefined);
    /**
     * The row a gesture made, set or moved, once the body holds it: its
     * editor opens on an insert of the sheet's own; after a drop (#1187) it
     * is selected — on the column a card set first, when the grid shows it.
     */
    const pendingInsertFocus = useRef<{ id: string; child?: string; edit: boolean; key?: string | undefined } | undefined>(undefined);
    const anchorFor = useCallback((r: number, side: "before" | "after"): InsertionAnchor => anchorAt(rowAt(r), side), [rowAt]);
    /**
     * Inserts a row or a group where a request says, as one transaction —
     * seeded and labelled as a drop says, when it is one (#1187).
     *
     * @returns Whether the session recorded it
     */
    const executeInsertion = useCallback((request: InsertRequest, from?: SheetInsertFrom): boolean => {
        if (!editingState.available || (request.kind === "row" ? !canInsertRows : !canInsertGroups)) return false;
        const gesture = insertionGesture(request, rows, (i) => runLayout.positions[i] ?? endPosition, group !== undefined, keyed,
            () => newRowIdFn?.() ?? mintId(id => rows.some(row => row.id === id)), mintLineKey, loose);
        if (gesture === undefined) return false;
        const recorded = recordGesture([gesture.event], gesture.placement === undefined ? undefined : new Map([[gesture.id, gesture.placement]]), from?.origin ?? "insert", undefined, from?.seeds);
        if (!recorded) return false;
        pendingInsertFocus.current = { id: gesture.id, ...(gesture.child === undefined ? {} : { child: gesture.child }), edit: from === undefined };
        // A drop is announced by the drag layer: the footer says nothing more.
        dispatchStore({ t: "patch", patch: { sugg: null, selEnd: null, ...(from !== undefined ? {} : { msg: request.kind === "group" ? { id: "newGroup", noun: declaredNoun?.singular } : { id: "newRow" } }) } });
        return true;
    }, [editingState.available, canInsertRows, canInsertGroups, rows, runLayout, endPosition, group, loose, declaredNoun, keyed, newRowIdFn, recordGesture]);
    /** An insertion — once an open editor has committed. */
    const insertWhenClosed = useCallback((request: InsertRequest, from?: SheetInsertFrom): boolean => {
        if (uiRef.current.edit === null) return executeInsertion(request, from);
        pendingInsertion.current = { request, from };
        dispatch({ t: "editor.blur" });
        return true;
    }, [dispatch, executeInsertion]);
    const onInsert = useCallback((kind: "row" | "group", r: number, side: "before" | "after") => {
        insertWhenClosed({ kind, anchor: anchorFor(r, side) });
    }, [anchorFor, insertWhenClosed]);
    useLayoutEffect(() => {
        if (ui.edit !== null || pendingInsertion.current === undefined) return;
        const { request, from } = pendingInsertion.current;
        pendingInsertion.current = undefined;
        executeInsertion(request, from);
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
        if (!target.edit) {
            // A drop's row, selected: on the column a card set first, else where the ring was.
            const keyC = target.key === undefined ? -1 : columns.list.findIndex(col => col.key === target.key);
            dispatch({ t: "select.move", r, c: item?.kind === "group" ? 0 : keyC >= 0 ? keyC : uiRef.current.sel.c });
            return;
        }
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
        ringMoves.current += 1;
        dispatch({ t: "cell.down", r, c, shift: e.shiftKey });
    }, [dispatch]);
    const onCellDouble = useCallback((r: number, c: number) => { ringMoves.current += 1; dispatch({ t: "cell.dbl", r, c }); }, [dispatch]);
    const onCellEnter = useCallback((r: number, c: number) => dispatch({ t: "cell.enter", r, c, dragging: dragging.current }), [dispatch]);
    const onRowPick = useCallback((r: number, e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        ringMoves.current += 1;
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
            e.preventDefault(); ringMoves.current += 1; onInsert("row", store.ui.sel.r, e.shiftKey ? "before" : "after"); return;
        }
        const meta = e.metaKey || e.ctrlKey;
        // The history keys every collection shares (#988).
        const historyKey = historyShortcut(e);
        if (historyKey !== undefined) {
            e.preventDefault();
            ringMoves.current += 1;
            onHistoryAction(historyKey);
            return;
        }
        // The browser's own clipboard keys become copy / paste events.
        if (meta && (e.key === "c" || e.key === "v" || e.key === "x" || e.key === "a")) return;
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
        e.preventDefault();
        ringMoves.current += 1;
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
        dispatchStore({ t: "patch", patch: { msg: { id: "copied", rows: copied, cols: rect.c1 - rect.c0 + 1 } } });
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
        return n > 1 ? words.m.editorBadge({ index: words.number(Math.min(Math.max(edit.hi, 0), n - 1) + 1), total: words.number(n) }) : "";
    }, [edit, editMeta, candidateCtxFor, words]);
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
        // A source that could not count itself says so here, beside the rows it did serve (#853).
        error: paging.sourceError,
    }), [pagedSource, paging.rows.length, paging.total, paging.loading, paging.sourceError]);

    // ── The key search over a keyed paged source (§3.13) ──────────────────
    // Its jumps are its own (#860): cleared — by the viewer, or by a new
    // snapshot — it drops only a jump it asked for, never a key's move.
    const pagingClearJump = paging.clearJump;
    const searchJump = useCallback((element: number) => { jumpBy.current = "search"; jumpToElement(element); }, [jumpToElement]);
    const searchClearJump = useCallback(() => { if (jumpBy.current === "search") pagingClearJump(); }, [pagingClearJump]);
    const seek = useSheetSeek(pagedSource, paging.rows, paging.positions, searchJump, searchClearJump);
    // A jump's target is shown once its window settles (#854): the ring goes
    // to the sought row (no echo — the host hears the move through onSelect),
    // or the view to the band of the window that could not be read (#853).
    // The jump hands the viewport back only after the scroll to it is asked
    // for — the reports taken before, from the old place, would undo it.
    const [scrollNonce, setScrollNonce] = useState(0);
    const handBack = useRef(false);
    const jumpInFlight = paging.jump !== undefined && !paging.jump.settled;
    const clearJump = paging.clearJump;
    useEffect(() => {
        const target = seek.target;
        if (target === undefined || jumpInFlight) return;
        seek.clearTarget();
        // A sought element is a row, or on a grouped sheet a group — the ring lands on its band — or a loose row (#846).
        const bi = body.findIndex((it) => {
            if (group !== undefined) return (it.kind === "group" || (it.kind === "real" && it.loose !== undefined)) && it.position === target;
            return it.kind === "real" && it.position === target;
        });
        const r = bi >= 0 ? rowSpace.rowOf[bi] : undefined;
        if (r !== undefined && r >= 0) dispatch({ t: "select.set", r, c: uiRef.current.sel.c });
        const shown = bi >= 0 ? bi : body.findIndex((it) => it.kind === "failed" && it.failure.from <= target && target <= it.failure.to);
        // Nothing to show (a lens hides the row): the viewport is the user's again.
        if (shown < 0) { clearJump(); return; }
        setScrollTarget(shown);
        setScrollNonce((n) => n + 1);
        handBack.current = true;
    }, [seek, jumpInFlight, body, rowSpace, group, dispatch, clearJump]);
    // The frame's own effects run first, so by now it has asked for the scroll.
    useEffect(() => {
        if (!handBack.current) return;
        handBack.current = false;
        clearJump();
    }, [scrollNonce, clearJump]);
    // A key's move across an unloaded run (#860) lands once its window is in
    // the run: the ring goes to the first row at or past the element it was
    // headed for (↓, ⌘Home), the last at or before it (↑), or the last there
    // that is not blank padding (⌘End) — and where the window could not be
    // read, the view goes to its band. A gesture since the key, or an open
    // editor, abandons it; a jump the move did not ask for — the key
    // search's — takes its place. Either way the viewport is handed back once
    // the scroll is asked for, as a search's is.
    const keyJump = paging.jump;
    useEffect(() => {
        const intent = seekIntent.current;
        if (intent === undefined) return;
        if (jumpBy.current !== "key") { seekIntent.current = undefined; return; }
        // The render that pins its window is still to come.
        if (keyJump === undefined || keyJump.window !== intent.window) return;
        if (ringMoves.current !== intent.moves || uiRef.current.edit !== null) {
            seekIntent.current = undefined;
            clearJump();
            return;
        }
        if (!keyJump.settled) return;
        seekIntent.current = undefined;
        const positionOf = (it: SheetBodyItem): number | undefined => (intent.land === "end" ? elementOf(it) ?? undefined : rowPositionOf(it));
        let bi = -1;
        if (intent.land === "first") bi = body.findIndex((it) => { const p = positionOf(it); return p !== undefined && p >= intent.element; });
        else for (let i = body.length - 1; i >= 0 && bi < 0; i--) { const p = positionOf(body[i]!); if (p !== undefined && p <= intent.element && isRowSpace(body[i]!)) bi = i; }
        const r = bi >= 0 ? rowSpace.rowOf[bi] : undefined;
        if (r !== undefined && r >= 0) dispatch({ t: "select.move", r, c: intent.c });
        const shown = r !== undefined && r >= 0 ? bi : body.findIndex((it) => it.kind === "failed" && it.failure.from <= intent.element && intent.element <= it.failure.to);
        // Nothing to show (a lens hides every row there): the viewport is the viewer's again.
        if (shown < 0) { clearJump(); return; }
        setScrollTarget(shown);
        setScrollNonce((n) => n + 1);
        handBack.current = true;
    }, [keyJump, body, rowSpace, dispatch, clearJump]);

    // ── Where the scroll rests (#857) ─────────────────────────────────────
    // The anchor the last session left is restored once its item is in the
    // body; a paged sheet first fetches the window its element is in, the way
    // a key search jumps, and hands the viewport back once the frame has
    // scrolled there. The element is clamped to the source's count first: a
    // jump past the end pins a window no demand makes resident, so it would
    // never settle — and a pending jump owns the viewport. An anchor whose
    // item is gone lands in its place (`placeOf`). Where the frame mounts is never reported
    // (`VirtualRows` reports settles, not its first rest), so the top the
    // sheet opens at never overwrites the anchor it restores.
    const [anchorPhase, setAnchorPhase] = useState<"pending" | "seeking" | "settled">(() => (restored.anchor === null ? "settled" : "pending"));
    const [restoreAnchor, setRestoreAnchor] = useState<{ index: number; offset: number } | undefined>(undefined);
    const anchorHandBack = useRef(false);
    const anchorJump = paging.jump;
    const pagedTotal = paging.total;
    useEffect(() => {
        if (anchorPhase === "settled") return;
        const saved = restored.anchor;
        if (saved === null) { setAnchorPhase("settled"); return; }
        if (body.length === 0) return;
        // A band is a place in one run, never the item (see elementUnder): its element decides.
        const at = body.findIndex((it, i) => it.kind !== "band" && keyOfItem(it, i) === saved.key);
        // Where its element is now: a source that shrank past it keeps its last one.
        const element = pagedSource !== undefined && saved.element !== null && pagedTotal !== undefined && pagedTotal > 0
            ? Math.min(saved.element, pagedTotal - 1) : undefined;
        if (at < 0 && element !== undefined) {
            if (anchorPhase === "pending") {
                setAnchorPhase("seeking");
                jumpBy.current = "anchor";
                jumpToElement(element);
                return;
            }
            // Until its window is in the run — landed, or failed — the item may yet come.
            if (anchorJump === undefined || !anchorJump.settled) return;
        }
        anchorHandBack.current = anchorPhase === "seeking";
        setRestoreAnchor(at >= 0 ? { index: at, offset: saved.offset } : { index: placeOf(body, saved.index, element), offset: 0 });
        setAnchorPhase("settled");
    }, [anchorPhase, restored, body, pagedSource, pagedTotal, jumpToElement, anchorJump]);
    useEffect(() => {
        if (!anchorHandBack.current) return;
        anchorHandBack.current = false;
        clearJump();
    }, [restoreAnchor, clearJump]);
    const onAnchorChange = useCallback((at: { index: number; offset: number }) => {
        const item = body[at.index];
        if (item === undefined) return;
        const next: SheetAnchor = { key: keyOfItem(item, at.index), offset: at.offset, index: at.index, element: pagedSource !== undefined ? elementUnder(item, at.offset) : null };
        const p = persistedRef.current;
        if (sameAnchor(p.anchor, next)) return;
        persist({ ...p, anchor: next });
    }, [body, pagedSource, persist]);

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
        dispatchStore({ t: "patch", patch: { msg: { id: "issue", where: field ?? issue.entry, message: issue.message } } });
        cardRef.current?.focus({ preventScroll: true });
        setPendingIssue(undefined);
    }, [pendingIssue, body, rowSpace, columns, dispatch]);

    // ── The view tabs and the lens's chrome (B§8) ─────────────────────────
    // A grouped sheet counts LINES (#740) — and its loose rows, each a row of its own (#846). A row is
    // counted, and matched, by every declared column, the hidden ones too (#1186).
    const countedRows = useMemo(() => (group !== undefined ? rows.flatMap((g) => (isLooseRow(g) ? [g] : lineRowsOf(g))) : rows), [group, rows]);
    const wholeCount = useMemo(() => countedRows.filter((row) => !rowIsBlank(row, allColumns)).length, [countedRows, allColumns]);
    const tabViews = useMemo<SheetTabView[]>(() => {
        if (slice === undefined) return [];
        return views.map((v) => {
            // A grouped sheet counts a view's LINES the way the lens matches them: with their group's facts and their
            // sub rows — and its loose rows, each by its own cells (#846).
            if (group !== undefined && sliceConfig !== undefined) {
                const count = rows.reduce((n, g) => {
                    if (isLooseRow(g)) return n + (lensHits(v.narrowing, sliceConfig, [g], allColumns.list)[0] === true && !rowIsBlank(g, allColumns) ? 1 : 0);
                    const hits = lensLineHits(v.narrowing, sliceConfig, g, allColumns.list);
                    return n + lineRowsOf(g).filter((row, j) => hits[j] === true && !rowIsBlank(row, allColumns)).length;
                }, 0);
                return { id: v.id, name: v.name, count, title: viewTitle(v, words) };
            }
            const hits = sliceConfig !== undefined ? lensHits(v.narrowing, sliceConfig, countedRows, allColumns.list) : [];
            const count = countedRows.filter((row, i) => hits[i] === true && !rowIsBlank(row, allColumns)).length;
            return { id: v.id, name: v.name, count, title: viewTitle(v, words) };
        });
    }, [slice, views, sliceConfig, countedRows, allColumns, group, rows, words]);
    const summary = useMemo(() => {
        if (group === undefined) return undefined;
        // The groups, their lines and the sub rows under them — and the loose rows between the groups (#846).
        const groups = rows.filter((g) => !isLooseRow(g));
        const lines = groups.reduce((n, g) => n + g.lines.length, 0);
        const looseCount = rows.length - groups.length;
        const subRows = groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.subRows.length, 0), 0);
        return words.m.summary({
            groups: countNoun(groups.length, noun, words), n: lines, lines: words.number(lines),
            nLoose: looseCount, loose: words.number(looseCount), nSub: subRows, subRows: words.number(subRows),
        });
    }, [group, noun, rows, words]);
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
        // Loose rows have nothing to fold (#846): fold-all passes them by.
        const groups = rows.filter((row) => !isLooseRow(row));
        return { folded: groups.length > 0 && groups.every((row) => foldedOf(row)), count: groups.length, noun, onFoldAll };
    }, [group, noun, rows, foldedOf, onFoldAll]);
    const hasQuery = sliceState !== undefined && sliceState.search.type === "some" && sliceState.search.value.trim() !== "";
    // The view tabs, as the toolbar folds them (#952): the strip in each of
    // its forms, how far it can fold, and what it shows — so a change of it
    // has the strip measured again.
    const tabsVersion = `${tabViews.map((v) => `${v.id}:${v.name}:${v.count}`).join("|")}|${wholeCount}|${ui.tabs.active ?? ""}|${dirty}|${hasQuery}`;
    const tabs: SheetToolbarTabs | undefined = slice !== undefined
        ? {
            maxFold: tabViews.length - (tabViews.some((v) => v.id === ui.tabs.active) ? 1 : 0),
            version: tabsVersion,
            held: ui.tabs.renaming !== null,
            render: (fold: SheetTabsFold) => (
                <SheetTabs
                    styles={styles}
                    views={tabViews}
                    wholeCount={wholeCount}
                    active={ui.tabs.active}
                    dirty={dirty}
                    hasQuery={hasQuery}
                    renaming={ui.tabs.renaming}
                    renameVal={ui.tabs.renameVal}
                    fold={fold}
                    onSwitch={onTabSwitch}
                    onCreate={onTabCreate}
                    onClose={onTabClose}
                    onRenameStart={onTabRenameStart}
                    onRenameChange={onTabRenameChange}
                    onRenameCommit={onTabRenameCommit}
                    onRenameCancel={onTabRenameCancel}
                    onReorder={onTabReorder}
                    panelId={gridId}
                />
            ),
        }
        : undefined;
    // A grouped sheet counts LINES: the matches, and the context shown around them in the groups that show — and
    // each loose row (#846) as a row of its own.
    const count = lens === undefined ? ""
        : lens.lineHits !== undefined && lens.lineVisible !== undefined
            ? lensCount(
                rows.flatMap((g, i) => (isLooseRow(g) ? [lens.hits[i] === true] : lens.lineHits![i] ?? [])),
                rows.flatMap((g, i) => (isLooseRow(g) ? [lens.visible[i] === true] : (lens.lineVisible![i] ?? []).map((v) => lens.visible[i] === true && v))),
                words)
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
        const pending = sugg.pending.map((key) => ({ key, header: key === "rows" ? words.m.stripRowsHeader() : columns.byKey.get(key)?.header ?? key }));
        return { fills, rows: sugg.rows.length, rowsMeta: sugg.rows[0]?.meta ?? "", pending };
    }, [edit, ui.sugg, ctx, columns, nextTarget, words]);

    // The resting ring's cell detail (#844): the wanted date behind one that has happened, a column's detail text (with an enum member's own meta beside it).
    const detail = useMemo(() => {
        if (edit !== null || ui.selEnd !== null) return undefined;
        const meta = metaAt(ui.sel.r, ui.sel.c);
        const it = rowAt(ui.sel.r);
        if (meta === undefined || it === undefined || it.kind !== "real") return undefined;
        const d = cellDetail(meta, it.row.cells, words);
        if (d === undefined) return undefined;
        const cell = it.row.cells.get(meta.key);
        const member = meta.kind === "enum" && cell !== undefined && cell.type === "String" ? resolveRegisterMember(registers, meta.register, cell.value) : undefined;
        const memberMeta = member !== undefined ? getSomeorUndefined(member.meta) ?? "" : "";
        return { label: meta.header.toUpperCase(), chips: d.chips, meta: d.meta !== "" ? d.meta : memberMeta, keys: words.m.stripKeysDetail({ date: meta.kind === "date" }) };
    }, [edit, ui.selEnd, ui.sel, metaAt, rowAt, registers, words]);
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
                arity = arityMeta(implied, namedCount(linkEdit.groups[linkEdit.side], vocab), words);
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
                        meta: words.m.enumerateInstead(),
                        members: free.map((m) => variant("identified", { key: m.key })),
                    };
                }
            }
            const fill = ui.sugg !== null && ui.sugg.anchorId === idAt(edit.r) ? ui.sugg.fill.get(editMeta.key) : undefined;
            link = {
                side: linkEdit.side,
                candidates: linkEditCtx.candidates(edit.val, linkEdit.groups),
                armed: linkArmed,
                entry: offer !== undefined ? linkEntryCandidates(offer, used, words) : [],
                predicted,
                enumerate,
                predictedMeta: fill?.meta ?? "",
                arity,
                grammar: offer !== undefined ? grammarLine(offer, words) : "",
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
    // What the grid tells assistive tech (#860): its rows, counted the way
    // their indices run — on a flat sheet by source position, so the whole
    // source's (-1 until a paged source has counted itself) and the blank
    // padding; on a grouped sheet in body order — the header first; and the
    // ring's cell, which a band's title stands for across its span and under
    // the columns it has no cell in.
    const blankRows = useMemo(() => body.reduce((n, it) => (it.kind === "blank" && it.group === undefined ? n + 1 : n), 0), [body]);
    const ariaRowCount = group !== undefined ? body.length + 1
        : pagedSource !== undefined && paging.total === undefined ? -1
            : Math.max(paging.total ?? 0, endPosition) + blankRows + 1;
    const ringItem = rowAt(ui.sel.r);
    const ringCol = ringItem?.kind === "group" && group !== undefined && (ui.sel.c < group.titleSpan || !group.cells.has(columns.list[ui.sel.c]?.key ?? "")) ? 0 : ui.sel.c;
    const activeCell = ringItem !== undefined && colCount > 0 ? `${gridId}-${ui.sel.r}-${ringCol}` : undefined;
    // What a keyboard move's reveal reads (below): the ring's cell, and the column it sits under.
    const ringCellRef = useRef<{ id: string | undefined; col: number }>({ id: undefined, col: 0 });
    ringCellRef.current = { id: activeCell, col: ringCol };
    const hasFills = ui.sugg !== null && ui.sugg.fill.size > 0;
    const hasRows = ui.sugg !== null && ui.sugg.rows.length > 0;
    const ringKind = ctx.rowKindAt?.(ui.sel.r);
    const ringSubRows = ringKind === "row" ? ctx.lineSubRowsAt?.(ui.sel.r) : undefined;
    const picked = wr !== null ? wr.r1 - wr.r0 + 1 : 0;
    const hint = ui.gsel !== null
        ? words.m.hintProposal()
        : ringKind === "group" && wr === null
            ? words.m.hintBand({ noun: noun.singular })
        // A line with sub rows under it.
        : ringSubRows !== undefined && wr === null && ui.sugg === null
            ? words.m.hintSubRows({ open: ringSubRows.open, n: ringSubRows.count, count: words.number(ringSubRows.count), noun: noun.singular })
        : wr !== null
            ? words.m.hintRows({ n: picked, count: words.number(picked) })
            : hasFills
                ? words.m.hintFills()
                : hasRows
                    ? words.m.hintSuggestedRows()
                    : words.m.hintDefault();

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
        else if (item.kind === "failed") at = { kind: "row", offset: item.failure.from };
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
    // What a row in the range and the edited row are handed, held still while
    // they are the same — a hover elsewhere renders neither (#858).
    const rangeCols = useMemo(() => ({ c0: rect.c0, c1: rect.c1 }), [rect.c0, rect.c1]);
    const editC = edit !== null ? edit.c : undefined;
    const editorAt = useMemo(() => (editC !== undefined ? { c: editC, node: editorNode } : undefined), [editC, editorNode]);
    // ── The sticky band (#740, G1) — which band sits under the header at the scroll offset ──
    // The same heights the paged driver measures windows by (#855).
    const sizeOf = useCallback((i: number): number => {
        const item = body[i];
        return item === undefined ? rowPx : itemPx(item, geometry);
    }, [body, rowPx, geometry]);
    // A row keeps its place on screen when a window lands above it at a height
    // its estimate missed (#878) — the frame anchors the scroll on it. An
    // unloaded band never anchors: rows landing below it move its top.
    const anchorable = useCallback((i: number): boolean => body[i]?.kind !== "band", [body]);
    viewportRef.current = viewport;
    // The header pins in the frame, which scrolls its own rows: the band and
    // the line that stick under it are read off it.
    const pinnedFrame = viewport?.frame ?? null;
    // The frame's widths (above), measured before the first paint: a sheet
    // that folds its gutter never paints the gutter it folds.
    const viewFrame = viewport?.frame;
    useLayoutEffect(() => {
        if (viewFrame === undefined || typeof ResizeObserver === "undefined") return;
        const measure = () => { setViewPx(viewFrame.clientWidth); setFramePx(viewFrame.offsetWidth); };
        const observer = new ResizeObserver(measure);
        observer.observe(viewFrame);
        measure();
        return () => observer.disconnect();
    }, [viewFrame]);
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
        const el = pinnedFrame;
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
    }, [pinnedFrame, body, group, bandPx, rowPx]);
    // A line that has just begun to stick: its copy takes the top the scroll found for it before it paints.
    useLayoutEffect(() => {
        if (stickyLineRef.current !== null) stickyLineRef.current.style.top = `${stickyLineTop.current}px`;
    }, [stickyLineAt]);
    // The ring's cell in view after a keyboard move (#860). The frame brings
    // the ring's ROW in; what it cannot is the column — the rows scroll
    // sideways inside the card. The column's header cell says where the column
    // is: it is always mounted, and it shares the column's box. The gutter is
    // sticky, so the columns show right of it.
    useEffect(() => {
        if (revealSeq === 0) return;
        const view = viewportRef.current;
        if (view === null) return;
        const { col } = ringCellRef.current;
        const frame = view.frame;
        const head = headerRef.current?.querySelectorAll<HTMLElement>('[data-slot="headerCell"]')[col];
        if (head !== undefined) {
            const box = frame.getBoundingClientRect();
            const left = box.left + frame.clientLeft + gutterPx;
            const right = box.left + frame.clientLeft + frame.clientWidth;
            const cell = head.getBoundingClientRect();
            if (cell.left < left) frame.scrollLeft -= left - cell.left;
            else if (cell.right > right) frame.scrollLeft += Math.min(cell.right - right, cell.left - left);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a keyboard move is the trigger; the ring and the frame are read as they are then
    }, [revealSeq]);
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
        const el = pinnedFrame;
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
    }, [pinnedFrame, body, sizeOf]);

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

    // ── Drag and drop: what the rows hold (#1187) ─────────────────────────
    // With the frame's drops, every row is a drop target on the sheet's
    // surface, and a row, a line or a band its grip moves: one object every
    // row shares, held still while the frame's drops are, its functions reading the
    // plans the sheet makes below (`dropApi`), so no row renders again for a
    // drag. A sheet that takes no gesture now — read only, or between an
    // Apply's request and its answer — takes no drop either.
    const dropHost = host.drop;
    const dragActive = useDragLayerOptional()?.active === true;
    const dropOn = dropHost !== undefined && !readOnly && editingState.available;
    const dropApi = useRef<SheetDropApi | undefined>(undefined);
    const rowDrop = useMemo<SheetRowDrop | undefined>(() => (dropHost === undefined ? undefined : {
        surface: dropHost.surface,
        canDrop: (event) => dropApi.current?.canDrop(event) ?? false,
        slotAt: (payload, rect, clientY) => slotAt(dropHost, payload, rect, clientY),
        options: {
            caption: (coord, payload) => dropApi.current?.caption(coord, payload),
            name: (coord, payload) => dropApi.current?.name(coord, payload) ?? "",
        },
        hover: (el, coord, payload) => dropApi.current?.hover(el, coord, payload),
    }), [dropHost]);
    // What a grip moves (SB44): flat and loose rows where they keep no key order, lines, and groups.
    const moveRowsOn = dropOn && capabilities.moveRows.type !== "none";
    const movesRows = moveRowsOn && !keyed;
    const movesLines = moveRowsOn;
    const movesGroups = dropOn && capabilities.moveGroups;
    const [insertPreview, setInsertPreview] = useState<{ r: number; kind: "row" | "group"; side: "gutter" | "body" } | undefined>(undefined);
    const canInsert = editingState.available && (canInsertRows || canInsertGroups);
    // A drag in flight owns the gutter: no seam offers its chips under it — nor
    // does a folded gutter, whose rows' menus hold the inserts (#1215).
    const seamsOn = canInsert && !dragActive && !folded;
    /** What the seam above row `r` offers, and what each chip previews. */
    const insertActions = useCallback((r: number, side: "gutter" | "body"): InsertionActions => {
        const anchor = anchorFor(r, "before");
        const ordered = anchor.child !== undefined || anchor.tail === true || !keyed;
        // Above a band, or beside a loose row, the row chip inserts a loose row (#846) — a row, not a line.
        const looseRow = loose && insertsLoose(anchor, rows);
        return {
            ordered, groupOrdered: !keyed,
            line: group !== undefined && !looseRow, noun: noun.singular,
            row: canInsertRows && (group === undefined || anchor.entry !== undefined || looseRow) ? () => onInsert("row", r, "before") : undefined,
            group: canInsertGroups ? () => onInsert("group", r, "before") : undefined,
            preview: kind => {
                if (kind === undefined || (kind === "row" ? !ordered : keyed)) { setInsertPreview(undefined); return; }
                if (kind === "row") { setInsertPreview({ r, kind, side }); return; }
                const parent = rows.find(row => row.id === anchor.entry);
                if (parent === undefined) { setInsertPreview(undefined); return; }
                const gside = groupInsertionSide(parent, anchor);
                const next = rows[rows.indexOf(parent) + 1];
                const target = gside === "before" ? rowOf(parent.id) : next === undefined ? blankLineRowOf(parent.id) : rowOf(next.id);
                setInsertPreview(target === undefined ? undefined : { r: target, kind, side });
            },
        };
    }, [canInsertRows, canInsertGroups, anchorFor, keyed, group, loose, noun, onInsert, rows, rowOf, blankLineRowOf]);
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
    // The scroll is the frame's, either way. A drag starting takes them too (#1187).
    useEffect(() => { setSeam(undefined); setInsertPreview(undefined); }, [body, dragActive]);
    useEffect(() => {
        if (viewport === null) return;
        const hide = () => { setSeam(undefined); setInsertPreview(undefined); };
        const frame = viewport.frame;
        frame.addEventListener("scroll", hide, { passive: true });
        return () => { frame.removeEventListener("scroll", hide); };
    }, [viewport]);
    // A row draws its own seam from primitives and this one stable handler,
    // so hovering a seam, or a gesture anywhere, never hands every row a new
    // element (#858).
    const seamEnterRef = useRef(onSeamEnter);
    seamEnterRef.current = onSeamEnter;
    const onRowSeamEnter = useCallback((r: number, side: "gutter" | "body", hit: HTMLElement) => seamEnterRef.current(r, side, hit), []);
    // Whether a body item shows an action button in the gutter's actions column: a proposal's ✓ ×, an anchor's → fill, a draft's × discard.
    const hasDecisions = useCallback((i: number): boolean => {
        const it = body[i];
        if (it === undefined) return false;
        if (it.kind === "proposal") return true;
        const r = rowSpace.rowOf[i] ?? -1;
        // The copilot's → sits on its anchor — a real row, or the blank line being typed on.
        if ((it.kind === "real" || it.kind === "blank") && anchorR === r && ui.sugg !== null && ui.sugg.fill.size > 0) return true;
        if (it.kind === "real") return draftOf(it.group?.row.id ?? it.row.id, it.group?.key).discardable;
        if (it.kind === "group") return draftOf(it.row.id).discardable;
        return false;
    }, [body, rowSpace, anchorR, ui.sugg, draftOf]);
    /** The seam above body item `i` takes the gutter unless an action sits in the actions column on either side of it. */
    const seamSide = useCallback((i: number): "gutter" | "body" => (hasDecisions(i) || hasDecisions(i - 1) ? "body" : "gutter"), [hasDecisions]);
    /**
     * A folded gutter's inserts at a row (#1215): what the insertion strip
     * offers with the row selected, in its words — above and below it (in
     * key order, one to add), and a new group where the sheet takes one.
     */
    const insertsAt = (r: number): SheetRowAction[] => {
        if (!editingState.available) return [];
        const ordered = !keyed || anchorFor(r, "before").child !== undefined;
        const out: SheetRowAction[] = [];
        if (canInsertRows && ordered) out.push({ value: "insertAbove", label: words.m.insertAbove(), run: () => onInsert("row", r, "before") });
        if (canInsertRows && (group === undefined || loose || rows.length > 0)) out.push({ value: "insertBelow", label: words.m.insertBelow({ ordered }), run: () => onInsert("row", r, "after") });
        if (canInsertGroups) out.push({ value: "insertGroup", label: words.m.insertNewGroup({ noun: noun.singular }), run: () => onInsert("group", r, "after") });
        return out;
    };
    // Read as a row's menu opens, so no row renders again for it (#858).
    const insertsRef = useRef(insertsAt);
    insertsRef.current = insertsAt;
    const rowInserts = useCallback((r: number) => insertsRef.current(r), []);
    const foldedInserts = folded && canInsert ? rowInserts : undefined;

    // A group's band is "mixed" while some, not all, of its lines are picked (the band's checkbox goes indeterminate).
    const bandMixed = useCallback((r: number, picked: boolean): boolean => {
        if (wr === null || picked) return false;
        const g = ctx.groupAt?.(r);
        return g?.lines !== undefined && !(g.lines.r1 < wr.r0 || g.lines.r0 > wr.r1);
    }, [wr, ctx]);
    const renderRow = useCallback((i: number): ReactNode => {
        const item = body[i];
        if (item === undefined) return null;
        // Its place among the grid's rows (#860).
        const ariaRowIndex = ariaRowIndexOf(item, i, group !== undefined);
        if (item.kind === "band") return <SheetBandRow styles={styles} band={item.band} loading={paging.loading} ariaRowIndex={ariaRowIndex} colCount={colCount} />;
        if (item.kind === "failed") return <SheetFailedBandRow styles={styles} failure={item.failure} onRetry={paging.retry} ariaRowIndex={ariaRowIndex} colCount={colCount} />;
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
                    membership={memberships[i]}
                    entering={arriving.has(`line:${item.lineId}`) ? Math.min(item.index, 8) : undefined}
                    ariaRowIndex={ariaRowIndex}
                    colCount={colCount}
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
                    ariaRowIndex={ariaRowIndex}
                    colCount={colCount}
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
                    ariaRowIndex={ariaRowIndex}
                    foldedGutter={folded}
                />
            );
        }
        const r = rowSpace.rowOf[i] ?? -1;
        const inRangeRow = ui.selEnd !== null && r >= rect.r0 && r <= rect.r1;
        if (item.kind === "group") {
            if (group === undefined) return null;
            return (
                <SheetRowBoundary styles={styles} rowPx={bandPx} number={item.position + 1} resetKey={item.row}>
                <SheetGroupRow
                    styles={styles}
                    columns={columns}
                    registers={registers}
                    gridTemplate={gridTemplate}
                    bandPx={bandPx}
                    seam={seamsOn ? seamSide(i) : undefined}
                    onSeamEnter={onRowSeamEnter}
                    onSeamLeave={onSeamLeave}
                    insertPreview={insertPreview?.r === r ? insertPreview.kind : undefined}
                    insertSide={insertPreview?.r === r ? insertPreview.side : undefined}
                    r={r}
                    row={item.row}
                    number={item.position + 1}
                    idPrefix={gridId}
                    ariaRowIndex={ariaRowIndex}
                    membership={memberships[i]}
                    draft={draftOf(item.row.id)}
                    onDiscard={onRowDiscard}
                    group={group}
                    folded={item.folded}
                    count={item.count}
                    first={i === 0}
                    selC={ui.sel.r === r ? ui.sel.c : undefined}
                    range={inRangeRow ? rangeCols : undefined}
                    picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                    mixed={bandMixed(r, wr !== null && r >= wr.r0 && r <= wr.r1)}
                    editor={edit !== null && edit.r === r ? editorAt : undefined}
                    onCellDown={onCellDown}
                    onCellDouble={onCellDouble}
                    onCellEnter={onCellEnter}
                    onRowPick={onRowPick}
                    onFold={onFold}
                    drop={dropOn ? rowDrop : undefined}
                    dropRow={dropOn ? dropText(item) : undefined}
                    movable={movesGroups}
                    foldedGutter={folded}
                    inserts={foldedInserts}
                />
                </SheetRowBoundary>
            );
        }
        const lg = item.group;
        // A line with sub rows: how many, and whether they hang under it now.
        const subRowCount = item.kind === "real" && lg !== undefined ? lg.row.lines[lg.index]?.subRows.length ?? 0 : 0;
        const nextItem = body[i + 1];
        const subRowsOpen = subRowCount > 0 && nextItem !== undefined && nextItem.kind === "subRow" && item.kind === "real" && nextItem.lineId === item.row.id;
        return (
            <SheetRowBoundary styles={styles} rowPx={rowPx} number={lg !== undefined ? lg.number : item.position + 1} resetKey={item.kind === "real" ? item.row : undefined}>
            <SheetRow
                styles={styles}
                columns={columns}
                registers={registers}
                driverColumn={driverColumn}
                gridTemplate={gridTemplate}
                rowPx={rowPx}
                seam={seamsOn ? seamSide(i) : undefined}
                onSeamEnter={onRowSeamEnter}
                onSeamLeave={onSeamLeave}
                insertPreview={insertPreview?.r === r ? insertPreview.kind : undefined}
                insertSide={insertPreview?.r === r ? insertPreview.side : undefined}
                r={r}
                number={lg !== undefined ? lg.number : item.position + 1}
                idPrefix={gridId}
                ariaRowIndex={ariaRowIndex}
                first={i === 0}
                row={item.kind === "real" ? item.row : undefined}
                group={lg}
                membership={memberships[i]}
                draft={item.kind === "real" ? draftOf(lg?.row.id ?? item.row.id, lg?.key) : undefined}
                onDiscard={item.kind === "real" ? onRowDiscard : undefined}
                linkCtx={linkCellCtx}
                selC={ui.sel.r === r ? ui.sel.c : undefined}
                range={inRangeRow ? rangeCols : undefined}
                picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                hit={item.kind === "real" && item.hit}
                editor={edit !== null && edit.r === r ? editorAt : undefined}
                fills={anchorR === r && ui.sugg !== null ? ui.sugg.fill : undefined}
                nextTargetC={nextTarget !== null && nextTarget.r === r ? nextTarget.c : undefined}
                hoverC={ui.hover !== null && ui.hover.r === r ? ui.hover.c : undefined}
                onCellDown={onCellDown}
                onCellDouble={onCellDouble}
                onCellEnter={onCellEnter}
                onRowPick={onRowPick}
                onTake={onTake}
                onFillRow={onFillRow}
                subRowCount={subRowCount > 0 ? subRowCount : undefined}
                subRowsOpen={subRowsOpen}
                onSubRows={onSubRows}
                noun={noun}
                entering={lg !== undefined && arriving.has(`group:${lg.row.id}`) ? Math.min(lg.index, 8) : undefined}
                drop={dropOn ? rowDrop : undefined}
                dropRow={dropOn ? dropText(item) : undefined}
                movable={item.kind === "real" && (lg !== undefined ? movesLines : movesRows)}
                foldedGutter={folded}
                inserts={foldedInserts}
            />
            </SheetRowBoundary>
        );
    }, [folded, foldedInserts, draftOf, memberships, seamsOn, seamSide, onRowSeamEnter, onSeamLeave, insertPreview, onRowDiscard, body, styles, paging.loading, paging.retry, rowSpace, ui.selEnd, ui.sel, ui.sugg, ui.gsel, ui.hover, ui.lens.steps, rect, rangeCols, columns, registers, driverColumn, gridTemplate, rowPx, bandPx, subRowPx, gutterPx, viewPx, group, noun, wr, bandMixed, edit, editorAt, anchorR, nextTarget, onCellDown, onCellDouble, onCellEnter, onRowPick, onTake, onFillRow, onProposalPick, onProposalAccept, onProposalReject, onReveal, onFold, onSubRows, linkCellCtx, arriving, gridId, colCount, dropOn, rowDrop, movesGroups, movesLines, movesRows]);

    // ── The inspector's reads and gestures (#1188) ────────────────────────
    // Nothing here reads the source until the inspector pane asks for a
    // target: a sheet with no inspector pane reads nothing for it.
    const originalOf = editingState.original;
    // What the source holds for an entry no gesture has touched, lifted into
    // its draft — read once while the resident rows stand, so a paged source's
    // page is read again only when its windows move or its revision does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the resident rows are the cache's key: rows that move empty it.
    const lifted = useMemo(() => new Map<string, EntryVersion | undefined>(), [sourceRows]);
    // An entry's version as it stands: the session's, else the source's — or none while its page is not in.
    const versionOf = useCallback((id: string): EntryVersion | undefined => {
        const held = session.entries.get(id);
        if (held !== undefined) return held;
        if (lifted.has(id)) return lifted.get(id);
        let read: EntryVersion | undefined;
        try { read = originalOf(id); } catch { read = undefined; }
        lifted.set(id, read);
        return read;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, originalOf, lifted, draftVersion]);
    // The draft struct a target is: a row's (an entry's arm, beside loose rows), a band's group's, a line's child by its key.
    const structOf = useCallback((version: EntryVersion | undefined, child: string | undefined): { draft: Record<string, unknown>; type: EastType } | undefined => {
        if (version?.draft === undefined) return undefined;
        const looseDraft = draftType.type === "Variant";
        const draft = (looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).value : version.draft) as Record<string, unknown>;
        const armType: EastType = looseDraft ? (draftType.cases as Record<string, EastType>)[(version.draft as ValueTypeOf<typeof draftType>).type as string]! : draftType;
        if (child === undefined) return { draft, type: armType };
        if (childField === undefined || armType.type !== "Struct") return undefined;
        const index = version.wire?.lines.findIndex((line) => stringEqual(line.key, child)) ?? -1;
        const children = draft[childField] as unknown[] | undefined;
        const childType = (armType.fields as Record<string, EastType>)[childField];
        if (index < 0 || children === undefined || childType?.type !== "Array") return undefined;
        return { draft: children[index] as Record<string, unknown>, type: childType.value as EastType };
    }, [draftType, childField]);
    // Where a row, a line or a band stands, read off the body: no read of the source.
    const placeAt = useCallback((r: number): SheetInspectPlace | undefined => {
        const it = rowAt(r);
        if (it === undefined || (it.kind !== "real" && it.kind !== "group")) return undefined;
        const lg = it.kind === "real" ? it.group : undefined;
        const groupRow = lg !== undefined ? lg.row : it.kind === "group" ? it.row : undefined;
        const title = groupRow?.cells.get(TITLE_KEY);
        return {
            r,
            kind: it.kind === "group" ? "band" : lg !== undefined ? "line" : "row",
            entry: lg !== undefined ? lg.row.id : it.row.id,
            child: lg?.key,
            index: lg?.index,
            row: it.row,
            number: lg !== undefined ? lg.number : it.position + 1,
            group: groupRow !== undefined ? { title: title !== undefined && title.type === "String" && title.value !== "" ? title.value : undefined, lines: groupRow.lines.length } : undefined,
            owned: (groupRow ?? it.row).owned,
            subRows: lg !== undefined ? lg.row.lines[lg.index]?.subRows ?? [] : it.row.subRows,
        };
    }, [rowAt]);
    const targetAt = useCallback((r: number): SheetInspectTarget | undefined => {
        const place = placeAt(r);
        if (place === undefined) return undefined;
        const { entry, child, kind } = place;
        const current = structOf(versionOf(entry), child);
        // What the record holds: the version the first gesture began from — or, never touched, the draft itself.
        const began = session.originals.get(entry);
        const base = began === undefined ? current : structOf(began, child);
        const children = kind === "line" ? undefined : childField;
        return {
            ...place,
            value: current === undefined ? undefined : draftValues(current.draft, children),
            baseline: base === undefined ? undefined : draftValues(base.draft, children),
            complete: current === undefined || kind === "band" ? undefined : normalizeDraft(current.type, current.draft, entry).domain,
            presentation: draftOf(entry, child),
        };
    }, [placeAt, structOf, versionOf, session, childField, draftOf]);
    // What the ring and the range hold: a hover, a key, an editor elsewhere leave it as it is.
    const selSel = ui.sel;
    const selEnd = ui.selEnd;
    const selected = useMemo((): SheetSelected => {
        const rect = selectionRect({ sel: selSel, selEnd });
        if (rect.r0 === rect.r1) {
            const place = placeAt(rect.r0);
            return place === undefined ? { kind: "none" } : { kind: "one", place };
        }
        // Several rows: the rows and lines in the range — a band stands for its lines.
        const rs: number[] = [];
        for (let r = rect.r0; r <= rect.r1; r++) {
            const it = rowAt(r);
            if (it !== undefined && it.kind === "real") rs.push(r);
        }
        if (rs.length === 0) return { kind: "none" };
        if (rs.length === 1) {
            const place = placeAt(rs[0]!);
            return place === undefined ? { kind: "none" } : { kind: "one", place };
        }
        return { kind: "several", rs, r0: rect.r0, r1: rect.r1 };
    }, [selSel, selEnd, rowAt, placeAt]);
    const inspectWrite = useCallback((writes: readonly SheetInspectWrite[]) => {
        if (readOnly || !editingState.available) return;
        gestureEvents.current = [];
        const cellWrites: CellWrite[] = [];
        const draftEdits = new Map<string, DraftEdit>();
        const touched: { r: number; keys: string[] }[] = [];
        for (const w of writes) {
            const it = rowAt(w.r);
            if (it === undefined || (it.kind !== "real" && it.kind !== "group")) continue;
            const keys: string[] = [];
            for (const [key, cell] of w.cells ?? []) { cellWrites.push({ r: w.r, c: -1, key, cell }); keys.push(key); }
            for (const [key, text] of w.texts ?? []) {
                // As typing in the cell reads it: blank is the blank cell, unreadable text kept as typed.
                const meta = it.kind === "group" ? group?.cells.get(key) : allColumns.byKey.get(key);
                if (meta === undefined) continue;
                const outcome = parseCell(meta, text, parseCtxFor(w.r, meta));
                cellWrites.push({ r: w.r, c: -1, key, cell: outcome.kind === "cell" ? outcome.cell : outcome.kind === "unrecognised" ? variant("Invalid", text) : NULL_CELL });
                keys.push(key);
            }
            touched.push({ r: w.r, keys });
            const fields = w.fields;
            if (fields === undefined || fields.size === 0) continue;
            const lg = it.kind === "real" ? it.group : undefined;
            const entry = lg !== undefined ? lg.row.id : it.row.id;
            const child = lg?.key;
            const prior = draftEdits.get(entry);
            draftEdits.set(entry, (version) => {
                const before = prior === undefined ? version : prior(version);
                const at = structOf(before, child);
                if (at === undefined) return before;
                const set = withFields(at.draft, fields);
                const looseDraft = draftType.type === "Variant";
                const arm = looseDraft ? (before.draft as ValueTypeOf<typeof draftType>).type as string : undefined;
                if (child === undefined) return { ...before, draft: looseDraft ? variant(arm!, set) : set };
                const outer = (looseDraft ? (before.draft as ValueTypeOf<typeof draftType>).value : before.draft) as Record<string, unknown>;
                const index = before.wire?.lines.findIndex((line) => stringEqual(line.key, child)) ?? -1;
                const kids = [...(outer[childField!] as unknown[])];
                kids[index] = set;
                const next = { ...outer, [childField!]: kids };
                return { ...before, draft: looseDraft ? variant(arm!, next) : next };
            });
        }
        if (cellWrites.length > 0) writeCells(cellWrites, "typed");
        try { recordGesture(gestureEvents.current, undefined, "typed", draftEdits); }
        catch (error) { console.error("Sheet transaction failure", error); dispatchStore({ t: "patch", patch: { msg: { id: "text", text: error instanceof Error ? error.message : String(error) } } }); }
        finally { gestureEvents.current = []; }
        // The copilot asks again for a row whose trigger column changed, as typing in it does.
        if (copilotOn) {
            for (const { r, keys } of touched) {
                if (!keys.some((key) => triggers.size === 0 || triggers.has(key))) continue;
                const id = idAt(r);
                if (id !== undefined) requestRun(id, 0);
            }
        }
    }, [readOnly, editingState.available, rowAt, group, allColumns, parseCtxFor, structOf, draftType, childField, writeCells, recordGesture, copilotOn, triggers, idAt, requestRun]);
    const editInSheet = useCallback((r: number, key: string): boolean => {
        const c = columns.list.findIndex((col) => stringEqual(col.key, key));
        if (c < 0 || rowAt(r) === undefined) return false;
        dispatch({ t: "select.set", r, c });
        cardRef.current?.focus({ preventScroll: true });
        return true;
    }, [columns, rowAt, dispatch]);
    const removeRows = useCallback((r0: number, r1: number) => { runEffects([{ t: "delete.rows", r0, r1 }]); }, [runEffects]);
    const duplicate = useCallback((rs: readonly number[]) => {
        if (readOnly || !editingState.available) return;
        const idField = getSomeorUndefined(value.editing.idField);
        const events: SheetEditValue[] = [];
        const draftEdits = new Map<string, DraftEdit>();
        const typed = variant("typed", null);
        const taken = new Set(rows.map((row) => row.id));
        const mintEntry = () => { const id = newRowIdFn?.() ?? mintId((x) => taken.has(x)); taken.add(id); return id; };
        // A copy's draft: the source's, with its own identity where the struct carries one.
        const withIdentity = (draft: Record<string, unknown>, id: string): Record<string, unknown> =>
            (idField !== undefined && idField in draft ? { ...draft, [idField]: variant("value", id) } : draft);
        // A group as the layer has it now: lines inserted earlier in this gesture included.
        const groupsNow = new Map<string, SheetRowValue>();
        const groupOf = (g: SheetRowValue) => groupsNow.get(g.id) ?? layerRef.current.edits.get(g.id) ?? layerRef.current.appended.find((x) => x.id === g.id) ?? g;
        for (const r of rs) {
            const it = rowAt(r);
            if (it === undefined || (it.kind !== "real" && it.kind !== "group")) continue;
            const lg = it.kind === "real" ? it.group : undefined;
            if (lg !== undefined) {
                // A line: its copy just after it in its group.
                if (!canInsertRows) continue;
                const g0 = groupOf(lg.row);
                const index = g0.lines.findIndex((line) => stringEqual(line.key, lg.key));
                const source = structOf(versionOf(lg.row.id), lg.key);
                if (index < 0 || source === undefined) continue;
                const key = mintLineKey(g0);
                const line = g0.lines[index]!;
                const g: SheetRowValue = { ...g0, lines: [...g0.lines.slice(0, index + 1), { ...line, key }, ...g0.lines.slice(index + 1)] };
                groupsNow.set(g.id, g);
                events.push(variant("lineInsert", { rowId: g.id, offset: BigInt(it.position), after: some(lineAddress(index)), line: lineAddress(index + 1), row: g, source: typed }));
                const prior = draftEdits.get(g.id);
                const copy = loose ? withIdentity(source.draft, mintLineId()) : source.draft;
                draftEdits.set(g.id, (version) => {
                    const before = prior === undefined ? version : prior(version);
                    const looseDraft = draftType.type === "Variant";
                    const outer = (looseDraft ? (before.draft as ValueTypeOf<typeof draftType>).value : before.draft) as Record<string, unknown>;
                    const at = before.wire?.lines.findIndex((l) => stringEqual(l.key, key)) ?? -1;
                    if (at < 0) return before;
                    const kids = [...(outer[childField!] as unknown[])];
                    kids[at] = copy;
                    const next = { ...outer, [childField!]: kids };
                    return { ...before, draft: looseDraft ? variant("group", next) : next };
                });
                continue;
            }
            // A row, or a band's group with its lines: a new entry just after it, its draft the source's.
            if (it.kind === "group" ? !canInsertGroups : !canInsertRows) continue;
            const version = versionOf(it.row.id);
            if (version?.draft === undefined) continue;
            const id = mintEntry();
            let copy: SheetRowValue = { ...it.row, id, owned: false, lines: [] };
            for (const line of it.row.lines) copy = { ...copy, lines: [...copy.lines, { ...line, key: mintLineKey(copy) }] };
            events.push(variant("insert", { afterRowId: some(it.row.id), row: copy, source: typed }));
            const looseDraft = draftType.type === "Variant";
            const arm = looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).type as string : undefined;
            const inner = (looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).value : version.draft) as Record<string, unknown>;
            let draft = withIdentity(inner, id);
            if (childField !== undefined && it.kind === "group" && loose) {
                draft = { ...draft, [childField]: (draft[childField] as Record<string, unknown>[]).map((c) => withIdentity(c, mintLineId())) };
            }
            const final = looseDraft ? variant(arm!, draft) : draft;
            draftEdits.set(id, (v) => ({ ...v, draft: final, wire: copy }));
        }
        if (events.length === 0) return;
        try { recordGesture(events, undefined, "insert", draftEdits); }
        catch (error) { console.error("Sheet transaction failure", error); dispatchStore({ t: "patch", patch: { msg: { id: "text", text: error instanceof Error ? error.message : String(error) } } }); }
    }, [readOnly, editingState.available, value.editing.idField, rows, newRowIdFn, rowAt, canInsertRows, canInsertGroups, structOf, versionOf, loose, mintLineId, draftType, childField, recordGesture]);
    const addLine = useCallback((bandR: number) => {
        const it = rowAt(bandR);
        if (it === undefined || it.kind !== "group") return;
        insertWhenClosed({ kind: "row", anchor: { entry: it.row.id, tail: true, side: "before" } });
    }, [rowAt, insertWhenClosed]);
    const removeGroup = useCallback((bandR: number) => {
        const it = rowAt(bandR);
        if (it === undefined || it.kind !== "group" || readOnly || !editingState.available || !capabilities.removeGroups) return;
        gestureEvents.current = [];
        const base = layerRef.current;
        const next: LocalLayer = { ...base, removed: new Set([...base.removed, it.row.id]) };
        layerRef.current = next;
        setLayer(() => next);
        emitEdit(variant("remove", { rowIds: [it.row.id] }));
        try { recordGesture(gestureEvents.current); }
        catch (error) { console.error("Sheet transaction failure", error); dispatchStore({ t: "patch", patch: { msg: { id: "text", text: error instanceof Error ? error.message : String(error) } } }); }
        finally { gestureEvents.current = []; }
        dispatchStore({ t: "patch", patch: { selEnd: null, msg: { id: "deleted", n: 1, what: "groups", noun: declaredNoun?.singular, nouns: declaredNoun?.plural, again: false } } });
    }, [rowAt, readOnly, editingState.available, capabilities, setLayer, emitEdit, recordGesture, declaredNoun]);
    // A column, or a band's cell, by its key at a row.
    const columnAt = useCallback((r: number, key: string): SheetColumnMeta | undefined => {
        const it = rowAt(r);
        return it?.kind === "group" ? group?.cells.get(key) : allColumns.byKey.get(key);
    }, [rowAt, group, allColumns]);
    const inspectCellAt = useCallback((r: number, key: string): SheetCellValue | undefined => {
        const it = rowAt(r);
        return it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row.cells.get(key) : undefined;
    }, [rowAt]);
    const unitAt = useCallback((r: number, key: string): string | undefined => {
        const meta = columnAt(r, key);
        const it = rowAt(r);
        const driverKey = driverKeyOf(it !== undefined && it.kind === "real" ? it.row : undefined, driverColumn);
        return meta?.kind === "quantity" && driverKey !== undefined ? meta.uom?.get(driverKey) : undefined;
    }, [columnAt, rowAt, driverColumn]);
    const inspectLevelAt = useCallback((r: number, key: string) => {
        const meta = columnAt(r, key);
        return meta === undefined ? undefined : levelAt(r, meta);
    }, [columnAt, levelAt]);
    const allowedAt = useCallback((r: number, key: string): ReadonlySet<string> | undefined => {
        const meta = columnAt(r, key);
        return meta === undefined ? undefined : allowedFor(r, meta);
    }, [columnAt, allowedFor]);
    const drawCell = useCallback((r: number, key: string): ReactNode => {
        const it = rowAt(r);
        const meta = columnAt(r, key);
        if (it === undefined || meta === undefined || (it.kind !== "real" && it.kind !== "group")) return null;
        const cell = it.row.cells.get(meta.key);
        const member = meta.kind === "enum" && cell !== undefined && cell.type === "String" ? resolveRegisterMember(registers, meta.register, cell.value) : undefined;
        return (
            <SheetCellContent styles={styles} meta={meta} cell={cell} rowBlank={false} unit={unitAt(r, key)} member={member} ghost={undefined}
                link={meta.kind === "link" && it.kind === "real" ? linkCellCtx(it.row, meta) : undefined} />
        );
    }, [rowAt, columnAt, registers, styles, unitAt, linkCellCtx]);
    const seekSearch = seek.search;
    const sourceKeyType = value.editing.keyType;
    const goToIssue = useCallback((issue: EditIssue) => {
        onIssue(issue);
        // On a paged sheet the issue's row may not be in yet: its key is sought, and the row lands where the key search's would.
        const resident = body.some((it) => (it.kind === "group" ? stringEqual(it.row.id, issue.entry)
            : it.kind === "real" ? stringEqual(it.group?.row.id ?? it.row.id, issue.entry) : false));
        if (resident || seekSearch === undefined) return;
        // A seek takes the key's `.east` text: a String key's is quoted, any other key's is its id.
        const literal = sourceKeyType.type === "some" && fromEastTypeValue(sourceKeyType.value).type !== "String" ? issue.entry : printString(issue.entry);
        void seekSearch.find({ key: literal }).then((range) => { if (range.found) seekSearch.jump(range.row); }).catch(() => { /* superseded or cleared */ });
    }, [onIssue, body, seekSearch, sourceKeyType]);
    const issueList = useMemo((): readonly EditIssue[] => {
        const ready = session.readiness;
        return [...(ready.type === "ready" ? [] : ready.value), ...session.issues];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, readiness, draftVersion]);
    const kindOf = useCallback((issue: EditIssue): "incomplete" | "invalid" => {
        const ready = session.readiness;
        // The very issue the readiness raised (identity, not equality): an Apply's look alike and are not its.
        return ready.type !== "ready" && ready.value.some((raised) => Object.is(raised, issue)) ? kindOfIssue(issue, ready) : "invalid";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, readiness, draftVersion]);
    const inspect = useMemo((): SheetInspect => ({
        selected, targetAt,
        writable: !readOnly && editingState.available,
        can: {
            insertRows: canInsertRows && editingState.available,
            insertGroups: canInsertGroups && editingState.available,
            removeRows: !readOnly && capabilities.removeRows && editingState.available,
            removeGroups: !readOnly && capabilities.removeGroups && editingState.available,
        },
        counts: { rows: wholeCount, pending: session.pending, issues: issueList.length },
        issues: issueList,
        kindOf,
        write: inspectWrite, editInSheet, remove: removeRows, duplicate, addLine, removeGroup, goToIssue,
        columnAt, cellAt: inspectCellAt, unitAt, levelAt: inspectLevelAt, allowedAt, drawCell,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks the session's pending count.
    }), [selected, targetAt, readOnly, editingState.available, canInsertRows, canInsertGroups, capabilities, wholeCount, session, issueList, kindOf, inspectWrite, editInSheet, removeRows, duplicate, addLine, removeGroup, goToIssue, columnAt, inspectCellAt, unitAt, inspectLevelAt, allowedAt, drawCell, draftVersion]);

    // ── Drag and drop: the plans (#1187) ──────────────────────────────────
    // Every drop is planned (`drop.ts`) from the rows as they stand — the
    // veto, the ghost's caption, its name and the drop itself read the same
    // plan — and runs as one transaction: a template's insertion, a card's
    // cells, a move. A move is the entry's placement, or its groups' lines
    // rewritten, the wire and the draft side by side.
    const tailRow = useMemo(() => {
        const r = rowSpace.bodyIndexOf.findIndex((bi) => { const it = body[bi]; return it !== undefined && it.kind === "blank" && it.group === undefined; });
        return r < 0 ? undefined : r;
    }, [rowSpace, body]);
    const dropCtx = useMemo((): SheetDropContext => ({
        rows, rowAt, rowOf, blankLineRowOf, tailRow, rowCount,
        grouped: group !== undefined, loose, keyed,
        writable: !readOnly && editingState.available,
        can: { insertRows: canInsertRows, insertGroups: canInsertGroups, moveRows: capabilities.moveRows.type, moveGroups: capabilities.moveGroups },
        columnAt: (band, key) => (band ? group?.cells.get(key) : allColumns.byKey.get(key)),
        anchorFor,
    }), [rows, rowAt, rowOf, blankLineRowOf, tailRow, rowCount, group, loose, keyed, readOnly, editingState.available, canInsertRows, canInsertGroups, capabilities, allColumns, anchorFor]);
    // A drop row's text, read once: the rows print their own, so the same few come back.
    const dropRows = useRef(new Map<string, SheetDropRow | undefined>()).current;
    const readRow = useCallback((text: string): SheetDropRow | undefined => {
        if (!dropRows.has(text)) {
            if (dropRows.size > 4096) dropRows.clear();
            dropRows.set(text, readDropRow(text));
        }
        return dropRows.get(text);
    }, [dropRows]);
    /** A drop's plan, at a coordinate the rows made. */
    const planAt = (source: SheetDropSource, at: { row: string; slot: string }): SheetDropPlan => {
        const row = readRow(at.row);
        return row === undefined ? { kind: "refused", why: { why: "gone" } } : planDrop(source, row, at.slot, dropCtx);
    };
    /** What a completed drag, or a candidate, carries, and where it lands — `undefined` for one the sheet did not make. */
    const readEvent = (event: DragEventValue): { source: SheetDropSource; at: { row: string; slot: string } } | undefined => {
        if (dropHost === undefined) return undefined;
        if (event.type === "add") {
            const source = cardSource(dropHost, event.value.from.library, event.value.from.key);
            return source === undefined ? undefined : { source, at: event.value.into };
        }
        if (event.type === "move") {
            const row = readRow(event.value.from.row);
            return row === undefined ? undefined : { source: { kind: "move", row }, at: event.value.to };
        }
        return undefined;
    };
    // The row the seam line runs along, and its edge: written, never rendered, as a drag rests (the Plan's landing band's way).
    const markedSeam = useRef<HTMLElement | null>(null);
    const markSeam = (mark: SheetDropMark | undefined) => {
        const el = mark === undefined ? null
            : cardRef.current?.querySelector<HTMLElement>(`[data-row="${mark.r}"]:not([data-slot=stickyBand]):not([data-slot=stickyLine])`) ?? null;
        if (markedSeam.current !== null && markedSeam.current !== el) markedSeam.current.removeAttribute("data-drop-seam");
        markedSeam.current = el;
        if (el !== null && mark !== undefined) el.setAttribute("data-drop-seam", mark.edge);
    };
    // A drag over: no row keeps a mark.
    useEffect(() => {
        if (dragActive) return;
        markedSeam.current?.removeAttribute("data-drop-seam");
        markedSeam.current = null;
        for (const el of cardRef.current?.querySelectorAll("[data-drop-at]") ?? []) el.removeAttribute("data-drop-at");
    }, [dragActive]);
    /** A group entry's version with its lines rewritten: the wire lines and the draft's children, side by side. */
    const withLines = useCallback((version: EntryVersion, edit: (lines: SheetLineValue[], kids: unknown[]) => void): EntryVersion => {
        const wire = version.wire;
        if (wire === undefined || version.draft === undefined || childField === undefined) return version;
        const looseDraft = draftType.type === "Variant";
        const outer = (looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).value : version.draft) as Record<string, unknown>;
        const lines = [...wire.lines];
        const kids = [...(outer[childField] as unknown[])];
        edit(lines, kids);
        const next = { ...outer, [childField]: kids };
        return { ...version, wire: { ...wire, lines }, draft: looseDraft ? variant("group", next) : next };
    }, [childField, draftType]);
    /** A gesture of draft edits alone — a move — recorded as one transaction. */
    const recordEdits = useCallback((origin: Origin, edits: ReadonlyMap<string, DraftEdit>): boolean => {
        try { return recordGesture([], undefined, origin, edits); }
        catch (error) {
            console.error("Sheet transaction failure", error);
            dispatchStore({ t: "patch", patch: { msg: { id: "text", text: error instanceof Error ? error.message : String(error) } } });
            return false;
        }
    }, [recordGesture]);
    /**
     * Runs a drop's plan as one transaction (SB39, SB40, SB44, SB61), the row
     * it made, set or moved selected once the body holds it.
     *
     * @returns Whether it changed anything
     */
    const runDrop = useCallback((plan: SheetDropPlan): boolean => {
        switch (plan.kind) {
            case "refused":
            case "stay":
                return false;
            case "insert":
                return insertWhenClosed(plan.request, { seeds: plan.template.seeds, origin: "drop" });
            case "set": {
                const item = rowAt(plan.r);
                if (item === undefined || (item.kind !== "real" && item.kind !== "group") || plan.card.sets.size === 0) return false;
                gestureEvents.current = [];
                let recorded = false;
                try {
                    writeCells([...plan.card.sets].map(([key, cell]) => ({ r: plan.r, c: -1, key, cell })), "typed");
                    recorded = recordGesture(gestureEvents.current, undefined, "drop");
                } catch (error) {
                    console.error("Sheet transaction failure", error);
                    dispatchStore({ t: "patch", patch: { msg: { id: "text", text: error instanceof Error ? error.message : String(error) } } });
                } finally {
                    gestureEvents.current = [];
                }
                if (!recorded) return false;
                const keys = [...plan.card.sets.keys()];
                // The copilot asks again for a row whose trigger column the card set, as typing in it does.
                if (copilotOn && keys.some((key) => triggers.size === 0 || triggers.has(key))) {
                    const id = idAt(plan.r);
                    if (id !== undefined) requestRun(id, 0);
                }
                const lg = item.kind === "real" ? item.group : undefined;
                pendingInsertFocus.current = { id: lg !== undefined ? lg.row.id : item.row.id, ...(lg !== undefined ? { child: lg.key } : {}), edit: false, key: keys[0] };
                return true;
            }
            case "moveEntry": {
                const placement: Placement = some(variant("ordered", plan.to === "end" ? variant("end", null) : variant(plan.to.side, plan.to.anchor)));
                const recorded = recordEdits("move", new Map([[plan.id, (version: EntryVersion): EntryVersion => ({ ...version, place: placement })]]));
                if (recorded) pendingInsertFocus.current = { id: plan.id, edit: false };
                return recorded;
            }
            case "moveLine": {
                const { from, to } = plan;
                const source = versionOf(from.group);
                const at = source?.wire?.lines.findIndex((line) => line.key === from.key) ?? -1;
                if (source === undefined || source.wire === undefined || at < 0) return false;
                const edits = new Map<string, DraftEdit>();
                let key = from.key;
                if (to.group === from.group) {
                    // Within its group: out of its slot, into the one it was dropped at.
                    edits.set(from.group, (version) => withLines(version, (lines, kids) => {
                        const i = lines.findIndex((line) => line.key === from.key);
                        if (i < 0) return;
                        const [line] = lines.splice(i, 1);
                        const [kid] = kids.splice(i, 1);
                        const slot = to.index > i ? to.index - 1 : to.index;
                        lines.splice(slot, 0, line!);
                        kids.splice(slot, 0, kid);
                    }));
                } else {
                    // Into another group: out of its own, into the other under a key of the other's — its draft with it.
                    const target = versionOf(to.group)?.wire;
                    const outer = (draftType.type === "Variant" ? (source.draft as ValueTypeOf<typeof draftType> | undefined)?.value : source.draft) as Record<string, unknown> | undefined;
                    const kid = childField === undefined ? undefined : (outer?.[childField] as unknown[] | undefined)?.[at];
                    if (target === undefined || kid === undefined) return false;
                    key = mintLineKey(target);
                    const moved: SheetLineValue = { ...source.wire.lines[at]!, key };
                    edits.set(from.group, (version) => withLines(version, (lines, kids) => {
                        const i = lines.findIndex((line) => line.key === from.key);
                        if (i < 0) return;
                        lines.splice(i, 1);
                        kids.splice(i, 1);
                    }));
                    edits.set(to.group, (version) => withLines(version, (lines, kids) => {
                        lines.splice(Math.min(to.index, lines.length), 0, moved);
                        kids.splice(Math.min(to.index, kids.length), 0, kid);
                    }));
                }
                const recorded = recordEdits("move", edits);
                if (recorded) pendingInsertFocus.current = { id: to.group, child: key, edit: false };
                return recorded;
            }
        }
    }, [insertWhenClosed, rowAt, writeCells, recordGesture, copilotOn, triggers, idAt, requestRun, recordEdits, versionOf, withLines, draftType, childField]);
    dropApi.current = dropHost === undefined ? undefined : {
        canDrop: (event) => {
            const read = readEvent(event);
            return read !== undefined && planAt(read.source, read.at).kind !== "refused";
        },
        caption: (coord, payload) => {
            const source = payloadSource(dropHost, payload);
            return source === undefined ? undefined : dropCaption(planAt(source, coord), dropCtx, words, noun);
        },
        name: (coord, payload) => {
            const source = payloadSource(dropHost, payload);
            const row = readRow(coord.row);
            if (source === undefined || row === undefined) return "";
            return dropName(planAt(source, coord), locateDrop(row, dropCtx)?.r, dropCtx, words, noun);
        },
        hover: (el, coord, payload) => {
            const source = payloadSource(dropHost, payload);
            if (source === undefined) return;
            const plan = planAt(source, coord);
            el.setAttribute("data-drop-at", plan.kind === "set" ? "row" : "seam");
            markSeam(plan.kind === "set" || plan.kind === "refused" ? undefined : plan.mark);
        },
        drop: (event) => {
            const read = readEvent(event);
            return read !== undefined && runDrop(planAt(read.source, read.at));
        },
    };
    // The surface the rows register on, taking the library's templates and every author's tab that drops.
    const dropTarget = useMemo((): DragTargetConfig | null => (dropHost === undefined || !dropOn ? null : {
        id: dropHost.surface,
        sources: [...(dropHost.templates !== undefined ? [dropHost.templates.library] : []), ...dropHost.tabs.keys()],
        kinds: { add: true, move: true },
        onDrag: (event) => dropApi.current?.drop(event) ?? false,
    }), [dropHost, dropOn]);
    useDragTarget(dropTarget);
    // A library card's ⏎ (SB45): the drop below the ring's row — or, where it is refused, why, in the footer.
    const enterCard = (library: string, key: string) => {
        if (dropHost === undefined) return;
        const source = cardSource(dropHost, library, key);
        const item = rowAt(uiRef.current.sel.r);
        const row = item === undefined ? undefined : dropRowOf(item);
        if (source === undefined || row === undefined) return;
        const plan = planBelow(source, row, dropCtx);
        if (plan.kind !== "refused") {
            runDrop(plan);
            return;
        }
        const word = dropRefusal(plan, dropCtx, words, noun);
        if (word !== undefined) dispatchStore({ t: "patch", patch: { msg: { id: "dropRefused", word } } });
    };
    const enterRef = useRef(enterCard);
    enterRef.current = enterCard;
    const enter = useCallback((library: string, key: string) => enterRef.current(library, key), []);

    // ── The parts' facts: the toolbar's items (§7), the root, the footer ──
    const toolbarItems = useSheetToolbarItemsFor({
        styles,
        slice,
        affordances,
        count,
        partial: transport !== undefined && !exhausted,
        tabs,
        context: lensOn ? { value: ui.lens.context, onChange: onContext } : undefined,
        search: seek.search,
        onSearchKey,
        // The session's error is the frame's banner (#1184), never a line under the item.
        history: !readOnly ? historyToolbarItem({ session, words, editing: ui.edit !== null, onAction: onHistoryAction, onIssue, showError: false }) : undefined,
    });
    const toolbar = { items: toolbarItems, ref: toolbarRef };
    const root: SheetRootFacts = {
        partial: transport !== undefined && !exhausted,
        copilot: copilotOn,
        lens: lensOn,
        view: ui.tabs.active ?? undefined,
        moving,
    };
    const footer: SheetFooterProps = {
        styles, items: value.footer, summary, hint, message: ui.msg === null ? "" : noticeText(ui.msg, words), transport, onRetry: paging.retry,
    };
    const history: SheetHistory = { session, onAction: onHistoryAction };

    // A source that failed before anything landed: nothing else to show (#853).
    if (paging.error !== undefined) {
        const failure = (
            <Box css={styles.diagnostic} data-sheet-error role="alert">
                {words.m.noSource({ reason: paging.error })}
                <SheetRetry styles={styles} onRetry={() => paging.retry()} />
            </Box>
        );
        return { styles, root, toolbar, grid: null, footer, history, failure, inspect, enter };
    }

    const stickyItem = stickyAt !== undefined ? body[stickyAt] : undefined;
    // The open line whose sub rows scroll under the band.
    const stuck = stickyLineAt !== undefined ? body[stickyLineAt] : undefined;
    const stuckLine = stickyLineAt !== undefined && stuck !== undefined && stuck.kind === "real" && stuck.group !== undefined
        ? { at: stickyLineAt, r: rowSpace.rowOf[stickyLineAt] ?? -1, row: stuck.row, lg: stuck.group, hit: stuck.hit, dropRow: dropText(stuck) }
        : undefined;
    const header = (
        <Box ref={headerRef} position="relative">
            <SheetHeader styles={styles} columns={columns.list} gridTemplate={gridTemplate} picked={wr !== null} foldAll={foldAll} />
            {stickyItem !== undefined && stickyItem.kind === "group" && group !== undefined && stickyAt !== undefined && (
                // The band of the group whose lines scroll under the header (G1) — laid over the rows, so the list never moves.
                // A copy: the band itself is the grid's row (#860).
                <Box position="absolute" top="100%" left="0" right="0" aria-hidden="true">
                    <SheetGroupRow
                        styles={styles}
                        columns={columns}
                        registers={registers}
                        gridTemplate={gridTemplate}
                        bandPx={bandPx}
                        r={rowSpace.rowOf[stickyAt] ?? -1}
                        row={stickyItem.row}
                        number={stickyItem.position + 1}
                        membership={memberships[stickyAt]}
                        draft={draftOf(stickyItem.row.id)}
                        onDiscard={onRowDiscard}
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
                        // A drop over the copy lands on its band: the band itself lies under the header (#1187).
                        drop={dropOn ? rowDrop : undefined}
                        dropRow={dropOn ? dropText(stickyItem) : undefined}
                        foldedGutter={folded}
                        inserts={foldedInserts}
                    />
                </Box>
            )}
            {stuckLine !== undefined && (
                // The line whose sub rows scroll under the band: laid over the rows just under the band, and
                // BENEATH the band and the header (z −1 inside the pinned header), so it slides away under them as its last
                // sub row leaves. A press on it first brings the line itself back under the band (`revealLine`). A copy,
                // like the band's (#860).
                <Box ref={stickyLineRef} position="absolute" left="0" right="0" zIndex="-1" aria-hidden="true">
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
                        membership={memberships[stuckLine.at]}
                        draft={draftOf(stuckLine.lg.row.id, stuckLine.lg.key)}
                        onDiscard={onRowDiscard}
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
                        subRowCount={stuckLine.lg.row.lines[stuckLine.lg.index]?.subRows.length ?? 0}
                        subRowsOpen
                        onSubRows={(r, all) => { revealLine(stuckLine.at, all); onSubRows(r, all); }}
                        noun={noun}
                        sticky
                        drop={dropOn ? rowDrop : undefined}
                        dropRow={dropOn ? stuckLine.dropRow : undefined}
                        foldedGutter={folded}
                        inserts={foldedInserts}
                    />
                </Box>
            )}
        </Box>
    );
    // The grid with its strip (SB4): the card — the header, the rows and the
    // insertion layer — the insertion strip, and the strip docked under them.
    const grid = (
        <>
            <Box
                ref={cardRef}
                id={gridId}
                css={styles.card}
                tabIndex={0}
                data-sheet-card
                // Where the gutter ends — what the seam lines start from — and whether it folded (#1215).
                data-gutter={folded ? "folded" : undefined}
                style={{ "--sheet-gutter": `${gutterPx}px` } as CSSProperties}
                role="grid"
                aria-rowcount={ariaRowCount}
                aria-colcount={colCount + 1}
                aria-multiselectable
                aria-activedescendant={activeCell}
                onKeyDown={onKeyDown}
                onCopy={onCopy}
                onPaste={onPaste}
            >
                <VirtualRows
                    height={undefined}
                    maxHeight={undefined}
                    fillParent
                    header={header}
                    footer={<Box height={`${BOTTOM_PAD_PX}px`} />}
                    count={body.length}
                    estimateSize={sizeOf}
                    getItemKey={itemKey}
                    anchorable={anchorable}
                    onViewport={setViewport}
                    renderRow={renderRow}
                    minWidth={`${minWidth}px`}
                    headerZIndex={6}
                    scrollToIndex={scrollTarget}
                    scrollNonce={scrollNonce}
                    scrollAlign="auto"
                    onRangeChange={pagedSource !== undefined ? reportRange : undefined}
                    sizeVersion={paging.sizeVersion}
                    // Where the scroll rests, persisted and restored as an item (#857).
                    onAnchorChange={onAnchorChange}
                    restoreAnchor={restoreAnchor}
                    rootCss={{ overflowX: "auto" }}
                />
                {seam !== undefined && seamsOn && (
                    <SheetInsertLayer ref={insertLayerRef} styles={styles} seam={seam} actions={insertActions(seam.r, seam.side)} onLeave={onSeamLeave} />
                )}
            </Box>
            {(wr !== null && edit === null || rows.length === 0) && editingState.available && <SheetInsertStrip styles={styles}
                ordered={!keyed || anchorFor(ui.sel.r, "before").child !== undefined}
                above={canInsertRows ? () => onInsert("row", wr?.r0 ?? ui.sel.r, "before") : undefined}
                below={canInsertRows && (group === undefined || loose || rows.length > 0) ? () => onInsert("row", wr?.r1 ?? ui.sel.r, "after") : undefined}
                group={canInsertGroups ? () => onInsert("group", wr?.r1 ?? ui.sel.r, "after") : undefined}
                noun={noun.singular} />}
            <SheetStrip styles={styles} model={strip} onAction={onStripAction} />
        </>
    );
    return { styles, root, toolbar, grid, footer, history, failure: undefined, inspect, enter };
}

const SheetContext = createContext<SheetParts | undefined>(undefined);

/**
 * Where a row, a line or a band the inspector pane shows stands (#1188):
 * its place, its number, its group and its sub rows — all read off the
 * body, never from the source.
 */
export interface SheetInspectPlace {
    /** Its row-space index. */
    r: number;
    /** A flat or loose row, a group's line, or a group's band. */
    kind: "row" | "line" | "band";
    /** The entry it is — a line's, its group's. */
    entry: string;
    /** A line's key in its group. */
    child: string | undefined;
    /** A line's place among its group's lines — what an issue addresses it by. */
    index: number | undefined;
    /** Its wire row: a row's or a band's group row, or a line's cells as a row. */
    row: SheetRowValue;
    /** Its number: a row's in the sheet, a line's in its group, a band's group's. */
    number: number;
    /** A line's group, or a band's own: its title and its line count. */
    group: { title: string | undefined; lines: number } | undefined;
    /** Owned upstream: its stamped cells are read only. */
    owned: boolean;
    /** The read-only rows under it (#844). */
    subRows: readonly SheetSubRowValue[];
}

/**
 * A row, a line or a band the inspector pane shows (#1188): its place,
 * its draft as its struct's values, what the record holds, and how its draft
 * presents — the source's entry read once while the resident rows stand.
 */
export interface SheetInspectTarget extends SheetInspectPlace {
    /** Its draft as its struct's values, by field: a field's value, `undefined` while it is missing or unreadable; `undefined` while its entry is not read yet. */
    value: Readonly<Record<string, unknown>> | undefined;
    /** What the record holds for it, as `value` holds the draft — `undefined` for a row never applied. */
    baseline: Readonly<Record<string, unknown>> | undefined;
    /** Its complete value — every field given and read — or `undefined` until it is: what an author's inspector is given (SB58). */
    complete: unknown;
    /** How its draft presents: pending, never applied, and its issues by field. */
    presentation: DraftPresentation;
}

/** What the ring and the range select, as the inspector shows it (SB47–SB51): one place — its target read by {@link SheetInspect.targetAt} — or several rows, or nothing. */
export type SheetSelected =
    | { kind: "none" }
    | { kind: "one"; place: SheetInspectPlace }
    | { kind: "several"; rs: readonly number[]; r0: number; r1: number };

/** One row's write from the inspector — beside the others, one transaction (SB52). */
export interface SheetInspectWrite {
    /** The row-space row it lands on: a row, a line, or a band. */
    r: number;
    /** Cells by column key (a band's: by band cell key), as the grid writes them. */
    cells?: ReadonlyMap<string, SheetCellValue> | undefined;
    /** Text by column key, read as typing in the cell reads it — a custom column's. */
    texts?: ReadonlyMap<string, string> | undefined;
    /** Fields no column shows, by name: their new values, set on the draft. */
    fields?: ReadonlyMap<string, unknown> | undefined;
}

/** What the inspector pane reads of the sheet, and the gestures it makes (#1188). */
export interface SheetInspect {
    /** What the ring and the range select. */
    selected: SheetSelected;
    /** The target at a row-space index, if one stands there: its draft, what the record holds, and how it presents — the one call that reads the source. */
    targetAt: (r: number) => SheetInspectTarget | undefined;
    /** A gesture may be made now: the sheet is writable and its session takes one. */
    writable: boolean;
    /** Whether rows (a grouped sheet's lines), groups may be inserted, and rows removed. */
    can: { insertRows: boolean; insertGroups: boolean; removeRows: boolean; removeGroups: boolean };
    /** The sheet's rows (not blank padding), the entries its drafts change, and the batch's issues. */
    counts: { rows: number; pending: number; issues: number };
    /** Every issue of the batch: the drafts' and the author's checks', then an Apply's conflicts and refusals. */
    issues: readonly EditIssue[];
    /** What an issue refuses its entry for: a field still missing, or one refused — an Apply's conflicts and refusals among them. */
    kindOf: (issue: EditIssue) => "incomplete" | "invalid";
    /** Write rows: every cell, text and field as one transaction, the copilot asked again for a row whose trigger column changed. */
    write: (writes: readonly SheetInspectWrite[]) => void;
    /** Put the ring on a row's cell under a column the grid shows, and focus the grid; `false` when the grid does not show it. */
    editInSheet: (r: number, key: string) => boolean;
    /** Delete the rows (or lines) from `r0` to `r1`, as ⌫ on them does. */
    remove: (r0: number, r1: number) => void;
    /** Duplicate rows, lines or bands — a band with its lines — each just after its source, as one transaction. */
    duplicate: (rs: readonly number[]) => void;
    /** Add a line at the end of the band's group. */
    addLine: (bandR: number) => void;
    /** Delete a band's group with its lines, as one transaction. */
    removeGroup: (bandR: number) => void;
    /** The column — on a band, the band cell — a key names at a row. */
    columnAt: (r: number, key: string) => SheetColumnMeta | undefined;
    /** The cell under a column at a row. */
    cellAt: (r: number, key: string) => SheetCellValue | undefined;
    /** A quantity's unit at a row: its driver member's. */
    unitAt: (r: number, key: string) => string | undefined;
    /** A date column's level at a row (#844). */
    levelAt: (r: number, key: string) => "week" | "day" | "range" | "time" | undefined;
    /** The register members a column's options rule offers a row; `undefined` offers every one. */
    allowedAt: (r: number, key: string) => ReadonlySet<string> | undefined;
    /** A cell drawn as the grid draws it — a link's halves and their chips. */
    drawCell: (r: number, key: string) => ReactNode;
    /** Go to an issue's cell — seeking its row on a paged sheet. */
    goToIssue: (issue: EditIssue) => void;
}

/** One field of a draft, decoded: missing, a value, or the text that could not be read. */
type DraftFieldValue = ValueTypeOf<ReturnType<typeof SheetDraftFieldType<EastType>>>;

/** A draft struct's fields as their values: a field's value, `undefined` while it is missing or unreadable. */
function draftValues(draft: Record<string, unknown>, children: string | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [field, state] of Object.entries(draft)) {
        if (field === children) continue;
        const s = state as DraftFieldValue;
        out[field] = s.type === "value" ? s.value : undefined;
    }
    return out;
}

/** A draft struct with fields set: a value, or missing for `undefined`. */
function withFields(draft: Record<string, unknown>, fields: ReadonlyMap<string, unknown>): Record<string, unknown> {
    const next = { ...draft };
    for (const [field, value] of fields) next[field] = value === undefined ? variant("missing", null) : variant("value", value);
    return next;
}

/** The shared state the parts read; a part outside a {@link SheetProvider} is a mistake of the frame's, and throws. */
function useSheetParts(): SheetParts {
    const parts = useContext(SheetContext);
    if (parts === undefined) throw new Error("A Sheet part is placed outside a SheetProvider");
    return parts;
}

export interface SheetProviderProps {
    /** The Sheet root value. */
    value: SheetRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
    /** What the frame hands the parts: the columns hidden, and the drops taken; nothing by default. */
    host?: SheetHost | undefined;
    /** Where the frame places the parts. */
    children: ReactNode;
}

const NO_HOST: SheetHost = {};

/**
 * Provides the sheet's one shared state (SB4): the store, the editing
 * session, the lens and the selection, for the parts below it, wherever the
 * frame places them (SB5). The declared density reaches every one of them.
 */
export function SheetProvider({ value, storageKey, host = NO_HOST, children }: SheetProviderProps) {
    const parts = useSheet(value, storageKey, host);
    const provided = <SheetContext.Provider value={parts}>{children}</SheetContext.Provider>;
    const densityTag = getSomeorUndefined(value.density)?.type;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{provided}</DensityProvider>
        : provided;
}

/**
 * Reads the toolbar's items (§7) in the row's order and on its fold ladder:
 * the view tabs, the context switch, the count, the key search, the slice's
 * rail, the scope badge and the history item. The frame lays them out with
 * the shared `Toolbar`, and puts {@link useSheetToolbarRef}'s ref on the
 * element that holds them.
 *
 * @returns The items, a falsy entry for each the sheet has no use for.
 */
export function useSheetToolbarItems(): ReadonlyArray<ToolbarItem | false | undefined> {
    return useSheetParts().toolbar.items;
}

/**
 * Reads the ref for the element that holds the toolbar's items: ⌘F and ⌘/
 * in the grid put the focus on the key search in it — its box, or, folded to
 * its icon, the box in its popover (#1221) — else on the first search box.
 *
 * @returns The ref, for the element the frame lays the items out in.
 */
export function useSheetToolbarRef(): RefObject<HTMLDivElement | null> {
    return useSheetParts().toolbar.ref;
}

/**
 * Reads the footer's props: the counts, the key hint, the paged transport
 * line and the live message, for the footer the frame places.
 *
 * @returns The props of the sheet's footer.
 */
export function useSheetFooter(): SheetFooterProps {
    return useSheetParts().footer;
}

/**
 * Reads the editing session and its history actions, for the frame's
 * banners (`SessionBanners`), which show the session's state, their Retry
 * and Discard run as the history item's do.
 *
 * @returns The session, and the actions' runner
 */
export function useSheetHistory(): SheetHistory {
    return useSheetParts().history;
}

/**
 * Reads what the inspector pane shows of the sheet and the gestures it
 * makes (#1188): what is selected — one row, line or band, several rows, or
 * nothing — each target's draft against what the record holds, the batch's
 * issues, and the writes, each one transaction as typing in the grid is.
 *
 * @returns The sheet's inspector facts and gestures
 */
export function useSheetInspect(): SheetInspect {
    return useSheetParts().inspect;
}

/**
 * Reads what the library pane calls on a card's ⏎ (#1187, SB45): the card,
 * by its library and its key, taken as a drop below the ring's row — a
 * template inserted after it, an author's card's cells set on it — or, where
 * that is refused, why, in the footer.
 *
 * @returns The ⏎ — stable
 */
export function useSheetDropEnter(): (library: string, key: string) => void {
    return useSheetParts().enter;
}

/**
 * Renders the element the grid is laid in: the sheet's root, its recipe's
 * root styles, and the attributes its rows' styles key on (`data-sheet`,
 * `data-lens`, `data-view`, `data-moving`, …). It fills the frame's main
 * region, and the grid in it scrolls its own rows.
 */
export function SheetRoot({ children }: { children: ReactNode }) {
    const { styles, root } = useSheetParts();
    return (
        <Box css={styles.root} data-sheet data-sheet-partial={root.partial ? "" : undefined} data-copilot={root.copilot ? "" : undefined}
            data-lens={root.lens ? "" : undefined} data-view={root.view} data-moving={root.moving ? "" : undefined}>
            {children}
        </Box>
    );
}

/**
 * Renders the grid with its strip: the header, the rows, the insertion
 * controls, and the strip docked under them — or, when the source failed
 * before any row landed, why, with its Retry (#853).
 */
export function SheetGrid() {
    const parts = useSheetParts();
    return parts.failure ?? parts.grid;
}
