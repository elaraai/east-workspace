/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's canvas — the temporally-aligned composite canvas (`Plan Spec.md`
 * §6): decode, the one shared scale, the one controller, and the canvas's
 * composition (horizon brush / ruler / pinned rows / rows).
 *
 * It is the canvas of the `Plan` extension `@elaraai/e3-ui` declares (#1177,
 * #1191), and the main of the frame the Plan renders in (#1193,
 * `frame/index.tsx`): `<Plan>` returns its payload through that carrier, and
 * the Plan's renderer lays it out in its `BuilderFrame`. The canvas is a hook,
 * {@link usePlanCanvas}: it hands the frame main, and the facts the frame's
 * toolbar, banners and footer are drawn from (`root/chrome.ts`), so the canvas
 * draws no toolbar and no foot of its own. The event kinds' rows lead the
 * canvas's own, read over the range it draws (#1192, `root/events.ts`), with
 * every kind's drafts in place: each kind is a session over its record, under
 * one history with `data`'s session (#1194, `edit/events.ts`), which the
 * frame's history item and banners follow. The event kinds' cards and elements
 * drag onto their rows, and an element back to the Backlog tab (#1196,
 * `edit/event-drag.ts`); an element its drafts changed wears the drafted look.
 *
 * Everything the canvas remembers between renders lives in ONE framework-free
 * controller (#815, `controller/`): the UI state machine, the paged source's
 * residency, the key search, the open element overlay, the scroll anchor. It
 * is created once per mount, the latest value reaches it through `setValue`
 * in a layout effect, and every part of the canvas subscribes to the slice of
 * its state it reads. Interactions are the controller's actions, and an action
 * runs its own effects — slice writes, the author's callbacks, page requests —
 * before it returns. What is left here is composition.
 *
 * Slice integration is the Table adopter pattern, chrome-only: the rows are
 * whatever the host fed (`Slice.rows` upstream) — the Plan never narrows its
 * own data. The listed affordances are the frame's toolbar items
 * (`useSliceToolbarItems`); `brush` mounts as the 32px horizon band, in main,
 * `resolution` as the WEEK/DAY segment, `summary` as the toolbar count line. Beyond Table
 * (the §3 contract), the slice's `range` / `resolution` STATE is the window /
 * resolution source of truth — the axis seeds the unbound case — and the
 * brush / segment write back through the slice.
 *
 * The axis is one of three kinds (#631) — `time`, `number`, `ordinal` — and
 * every window read / write speaks the slice arm that kind maps to
 * (`axis.ts`): `datetime`, `float` / `integer`, or none (an ordinal list is
 * its own window). Every row's instants must ride the axis's arm; a row that
 * does not is a diagnostic ROW, never a misplacement.
 *
 * A failure stays where it happened (#811): a row that cannot be placed
 * renders in place as its diagnostic, a window whose read failed renders as
 * an error band with a Retry, and a part that throws while rendering (a row's
 * plot, an overlay body, the expand render, the links layer) shows its own
 * one-line fallback. The frame's toolbar counts what it can — skipped rows, a
 * source or search failure, a truncated axis. Nothing a row or a source does
 * replaces the canvas.
 *
 * All eight row kinds render (`rows/*`); the drag-target role, element
 * clicks and the keyboard rungs are wired — the reducer's events and the
 * component's dispatches are a closed loop (#569). Every
 * element's popover, hover card and tooltip come from ONE overlay layer the
 * body delegates to (#816, `root/overlays.tsx`).
 *
 * The body is a TREEGRID (#819): every row, group band, gap band and window
 * band is a `row` at its `aria-rowindex` (`root/grid.ts`), with ONE tab stop
 * roving between them, a keyboard map over rows and their elements
 * (`root/keyboard.ts`), a polite live region (`root/announce.tsx`), and words
 * for everything the canvas says only by shape or colour (`a11y.ts`).
 *
 * Every word the canvas says itself comes from ONE message table, and every
 * number and date it prints is in the locale (#820, `messages.ts` /
 * `words.ts`): react-aria's `I18nProvider` above the app sets the locale, and
 * `PlanMessagesProvider` overrides the words for a subtree.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Box, VisuallyHidden, useSlotRecipe } from "@chakra-ui/react";
import { StringType, equalFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Plan, ScheduleEventRefType, planKeys, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import {
    getSomeorUndefined, useContainerBelow, useDataStable, usePersistedState, historyShortcut,
    type EditHistory, type EditHistoryJoined, type EditIssue, type DragEventValue, type DragMeta, type HistoryAction,
} from "@elaraai/east-ui-components";
import {
    parseCssSize, DensityProvider, VirtualRows, VIRTUALIZE_UNBOUNDED_AT, getStore,
} from "@elaraai/east-ui-components/internal";
import {
    PlanScaleContext, PlanDispatchContext, PlanCursorContext, PlanResolversContext, PlanGeometryContext,
    type PlanResolvers,
} from "./context.js";
import { planGeometry, planGeometryStyle } from "./geometry.js";
import { WindowBand, WindowFailureBand } from "./rows/WindowBand.js";
import { PlanPartBoundary } from "./rows/PartBoundary.js";
import { axisNow, axisResolutions, ordinalIndexOf } from "./axis.js";
import type { PlanEvent } from "./plan-state.js";
import type { PlanPart } from "./messages.js";
import {
    bodyItemKey, canvasRowsOf, derivePlan, indexRows, linkedRowKeys, pinnedRows, pxOf, rowHeight, rowItemKey, rowKeyOf,
    rowKeyWords, visibleRows,
    type PlanRootValue, type PlanRowIndex, type PlanRowValue, type VisibleRow,
} from "./model.js";
import type { RowKey } from "./plan-state.js";
import { entryOf, usePlanEditing, type PlanEntryRef } from "./use-plan-editing.js";
import { usePlanEventEditing } from "./edit/events.js";
import { drawnKinds, usePlanEventDrag, type PlanEventCanDropFn } from "./edit/event-drag.js";
import { PlanNarrow, PLAN_NARROW_BELOW } from "./narrow/index.js";
import type { PlanNarrowPaging } from "./narrow/demand.js";
import { LinksOverlay } from "./shell/LinksOverlay.js";
import { linkedElement, ribbonBody, type LinkedElement, type RibbonBeyond } from "./shell/ribbon-layout.js";
import type { PlanDiagnostics } from "./shell/Diagnostics.js";
import type { PlanTransport } from "./shell/transport.js";
import {
    createPlanController, declaredCollapsedOf, declaredGrainOf, denseOf, elementRowsOf,
    type PlanReconcileModel, type PlanSnapshot,
} from "./controller/index.js";
import { PlanControllerContext, useControllerSelector } from "./controller/react.js";
import { NOT_PERSISTED, persistedOf, type PlanPersisted } from "./persisted.js";
import { sameUiView, uiViewOf, useStableDerived, useStableVisible } from "./root/view.js";
import { usePlanWindow } from "./root/window.js";
import { usePlanEventBlocks, usePlanEventRoot, type PlanEventRows } from "./root/events.js";
import { hidesRow, type PlanRowsHidden } from "./frame/hidden.js";
import type { PlanCanvasParts, PlanSessionBanner } from "./root/chrome.js";
import { useHostBound } from "./root/host-bound.js";
import { usePlanExpand, usePlanFocus } from "./root/focus.js";
import { groupEndsOf, usePlanBody, usePlanRangeReport, usePlanScrollTarget } from "./root/body.js";
import { PlanGapBand, PlanStickyParent, renderPlanRow, type PlanRowContext } from "./root/rows.js";
import { PlanHeader } from "./root/Header.js";
import { usePlanCursorController } from "./root/cursor.js";
import { usePlanDropTarget } from "./root/drop.js";
import { PLAN_ELEMENT_SELECTOR, PlanOverlays, createOverlayAnchors, refOfElement, usePlanOverlayHandlers } from "./root/overlays.js";
import { PlanGridContext, createRowPositions, type PlanGridContextValue } from "./root/grid.js";
import {
    gridItemOf, planNavItems, planNavKey, plotElements, resolveNavIntent, rowWidgets,
    type PlanNavEdges, type PlanNavIntent, type PlanNavMove,
} from "./root/keyboard.js";
import { PlanAnnouncer } from "./root/announce.js";
import { PlanWordsContext, useResolvedPlanWords } from "./words.js";
import type { PlanSearch } from "./use-seek.js";
import { DROPPABLE_KINDS } from "./rows/BodyRow.js";
import { PlanEditContext, PlanEditStore, type PlanEditContextValue } from "./edit/store.js";
import { originOf, unmoved, usePlanCarry, type PlanMoveRequest } from "./edit/use-carry.js";
import { PlanCarryAnnouncer } from "./edit/announce.js";
import { PlanSelectableContext, elementKeyOf, holdsElement, selectableOf } from "./rows/element-select.js";
import { PlanDraftedContext } from "./rows/element-draft.js";
import { rowValueAt, type PlanCanvasInspect } from "./root/inspect.js";

type Styles = Record<string, Record<string, unknown>>;

export { type PlanRootValue, type PlanRowValue } from "./model.js";
export type { PlanCanvasParts, PlanChrome } from "./root/chrome.js";

// The Plan's memo compares CLOSURES too (#809, `frame/index.tsx`), while the
// pure-data derivations key on the value's DATA identity, so the root a
// closure-only change lets through swaps the callbacks without rebuilding the
// row model, the scale or the link graph.
const planRootDataEqual = equalFor(Plan.Types.Root);
const stringEqual = equalFor(StringType);
/** An event's element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const printEventRef = printFor(ScheduleEventRefType);

/** One event kind, as the Plan's payload carries it (#1190). */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** One resource kind, as the Plan's payload carries it (#1190). */
type PlanResourceKindValue = ValueTypeOf<typeof PlanPayloadType>["resources"][number];

/** One of the library's tabs, as the Plan's payload carries it (#1195). */
type PlanLibraryTabValue = ValueTypeOf<typeof PlanPayloadType>["library"][number];

/** No event kinds: a Plan of `data` and `rows` alone. */
const NO_KINDS: readonly PlanEventKindValue[] = [];
/** No session joins the history beside the event kinds': a Plan whose `data` does not edit. */
const NO_JOINED: readonly EditHistoryJoined<PlanEntryRef>[] = [];
/** No resource kinds: a Plan of `data` and `rows` alone. */
const NO_RESOURCES: readonly PlanResourceKindValue[] = [];
/** No library tabs. */
const NO_TABS: readonly PlanLibraryTabValue[] = [];
/** No event kind has an event on the canvas. */
const NO_KINDS_DRAWN: ReadonlySet<string> = new Set();

/** Default gutter width (px, desktop — the §8 sheet). */
const GUTTER_W = 168;

/** The canvas-wide keys (§11) — esc runs the one-rung ladder, `n` / `[` / `]`
 *  move the window, `g` cycles the grain. They work from anywhere in the
 *  canvas; the grid's own keys (`root/keyboard.ts`) come first. */
const KEYS: Readonly<Record<string, PlanEvent>> = {
    Escape: { t: "key", key: "esc" },
    n: { t: "key", key: "n" },
    "[": { t: "key", key: "[" },
    "]": { t: "key", key: "]" },
    g: { t: "key", key: "g" },
};

/** The links layer, as its render-failure line names it (#811). */
const LINKS_LAYER: PlanPart = { kind: "linksLayer" };

const selectPaging = (s: PlanSnapshot) => s.paging;
const selectSeek = (s: PlanSnapshot) => s.seek;
const selectAnchor = (s: PlanSnapshot) => s.anchor;
const selectScroll = (s: PlanSnapshot) => s.scroll;

/**
 * Test-only render probe — lets "the canvas root did not render" be asserted
 * deterministically (#815): a selection renders the rows it moved and never
 * the root. `undefined` outside tests.
 */
let planRootRenderProbe: (() => void) | undefined;
/** Install (or clear) the test root render probe. Test use only. */
export function setPlanRootRenderProbe(fn: (() => void) | undefined): void {
    planRootRenderProbe = fn;
}

/** What {@link usePlanCanvas} reads. */
export interface PlanCanvasArgs {
    /** The Plan root value. */
    value: PlanRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
    /** The event kinds' rows (#1192), drawn ahead of the root's own — a Plan of event kinds' payload carries them. */
    events?: PlanEventRows | undefined;
    /** The ids the viewer hides in the library's Series tab (#1195): the event kinds' rows leave out what they name. */
    hidden?: readonly string[] | undefined;
    /** What those ids hide of the Plan's own `rows`, which the canvas leaves out; `undefined` when they hide none. */
    rowsHidden?: PlanRowsHidden | undefined;
    /** The event kinds' slots (#1197): an element of theirs selects its event, as the Calendar's do (B15). */
    eventKinds?: readonly string[] | undefined;
    /** The library ids of the Plan's own panel tabs whose cards land on its rows (#1259) — its author's tabs'. */
    panel?: readonly string[] | undefined;
    /** The event kinds themselves (#1194): each edited in a session over its record, under one history with `data`'s. */
    kinds?: readonly PlanEventKindValue[] | undefined;
    /** When the event kinds' drafts go (#1194): on Save (`batch`, the default), or as each gesture lands (`auto`). */
    applyMode?: "batch" | "auto" | undefined;
    /** The resource kinds (#1196): what the event kinds' rows stand for, by name. */
    resources?: readonly PlanResourceKindValue[] | undefined;
    /** The library's tabs (#1196): the author's tabs' cards, which land on an event of their patch's kind. */
    tabs?: readonly PlanLibraryTabValue[] | undefined;
    /** The Plan's drop veto over an event kind's drop (#1196): `Schedule.Types.Candidate` to its refusal's message. */
    canDrop?: PlanEventCanDropFn | undefined;
}

/** No panel tab whose cards land on the rows. */
const NO_PANEL: readonly string[] = [];

/**
 * The Plan's canvas, for the frame it renders in (#1193): everything the
 * canvas keeps and derives, composed into main, and the facts the frame's
 * toolbar, banners and footer are drawn from — see the module docs. The
 * frame calls it once per render and places what it hands back.
 *
 * @param args - The root, its storage key, the event kinds' rows, what the viewer hides, the panel's tabs whose cards land, the event kinds with when their drafts go, the resource kinds, the library's tabs, and the event kinds' drop veto
 * @returns The canvas's parts: its contexts, main, its declared bound, and its chrome's facts
 */
export function usePlanCanvas({
    value: hostValue, storageKey, events, hidden, rowsHidden, eventKinds, panel, kinds = NO_KINDS, applyMode = "batch",
    resources = NO_RESOURCES, tabs = NO_TABS, canDrop,
}: PlanCanvasArgs): PlanCanvasParts {
    planRootRenderProbe?.();
    // Changes identity on a DATA change only — read data fields through it,
    // callbacks through `value` (#809).
    const hostData = useDataStable(hostValue, planRootDataEqual);
    // The canvas's words (#820) — its locale and message table, resolved once
    // per change and handed to every part beneath it.
    const words = useResolvedPlanWords();

    // ── What survives a remount (#813) ────────────────────────────────────
    // Under the canvas's `storageKey`: the user's collapse toggles, the charts
    // they expanded, and where a bounded frame's scroll rests. Never the
    // selection — a transient act, and restoring it would re-fire `onSelect`.
    // Nor the resolution: only a bound slice can change it (the segment has
    // nowhere to write without one — #615), and the slice keeps its own. The
    // controller restores from it once and writes through the latest setter.
    const { state: stored, setState: setStored } = usePersistedState<PlanPersisted>(storageKey, NOT_PERSISTED);
    const persistTo = useRef(setStored);
    useLayoutEffect(() => { persistTo.current = setStored; });

    // ── The controller — once per mount (#815) ────────────────────────────
    const [controller] = useState(() => createPlanController({
        grain: declaredGrainOf(hostValue),
        collapsed: hostValue.rows.type === "inline" ? declaredCollapsedOf(canvasRowsOf(hostValue.rows.value)) : [],
        restored: persistedOf(stored),
        persist: (next) => persistTo.current(next),
        // A bound interaction state (#824) — the host's from the first frame,
        // and written from outside through the state store.
        ui: getSomeorUndefined(hostValue.ui),
        subscribeUi: (listener) => getStore().subscribe(listener),
    }));
    // What the live region speaks in (#820) — handed over before anything can
    // be said.
    useLayoutEffect(() => { controller.setWords(words); }, [controller, words]);
    const paging = useControllerSelector(controller, selectPaging);

    // ── The slice and the scale ───────────────────────────────────────────
    // The slice and the scale every row positions against — read from the
    // host's root, which the drafted and composed roots below share them
    // with.
    const { slice, affordances, scale } = usePlanWindow(hostValue, hostData, words);

    // ── The editing session (#880) ────────────────────────────────────────
    // Every dropped card, move and resize is a DRAFT of the entry its row
    // came from, and the canvas draws the ROOT WITH THE DRAFTS IN PLACE —
    // derived again, so a draft looks exactly as Save will leave it.
    // Everything below reads that root: `value` and `data` are the drafted
    // pair.
    // A row's name, for a transaction's label — read off the canvas below.
    const indexRef = useRef<PlanRowIndex | undefined>(undefined);
    const labelOf = useCallback(
        (key: RowKey) => indexRef.current?.byKey.get(key)?.gutter.label ?? rowKeyWords(key), []);
    // The session's entries are `data`'s. Inline, the root's own rows: the
    // event kinds' lead them on the canvas alone, below. Paged, the rows the
    // source's elements placed — never a fixed block's, as the event kinds'
    // rows, which lead every window, are (#1192).
    const sourceRows = useMemo(
        () => (hostData.rows.type === "inline" ? canvasRowsOf(hostData.rows.value) : elementRowsOf(paging)),
        [hostData.rows, paging]);
    // Its gestures are steps of the Plan's one history once it holds the
    // session beside the event kinds' (#1194): the history is this render's,
    // read when a gesture lands.
    const historyRef = useRef<EditHistory<PlanEntryRef> | undefined>(undefined);
    const editing = usePlanEditing({
        value: hostValue, data: hostData, rows: sourceRows, origin: paging.origin, storageKey, labelOf, history: historyRef,
    });

    // ── The event kinds' editing (#1194) ──────────────────────────────────
    // A session per event kind over its record, under one history with
    // `data`'s session: Undo and Redo in gesture order whatever the source,
    // Discard of every one, Save per source.
    const joined = useMemo(
        () => (editing.enabled ? [{ key: editing.historyKey, session: editing.session }] : NO_JOINED),
        [editing.enabled, editing.historyKey, editing.session]);
    const eventEditing = usePlanEventEditing({ kinds, applyMode, storageKey, joined });
    const history = eventEditing.history;
    historyRef.current = history;

    // ── The event kinds' rows (#1192) ─────────────────────────────────────
    // Read over the range the scale draws, what the viewer hides left out
    // (#1195), every kind's drafts in place (#1194): they lead every other row
    // as fixed blocks.
    const lead = usePlanEventBlocks(events, scale, hidden, eventEditing.drafts);
    // The event kinds' rows ahead of the drafted root's own, and its links'
    // event ends named where the events draw — over a paged resource kind's
    // windows when a kind pages (#1199).
    const shown = usePlanEventRoot(editing.value, editing.data, events !== undefined ? lead : undefined, events?.paged, hidden);
    const value = shown.value;
    const data = shown.data;
    // Props sync. A new DATA identity reconciles the UI state (#610); the
    // render below already drew the reconciled view, so this commits what is
    // on screen and renders nothing more.
    useLayoutEffect(() => { controller.setValue(value, data); }, [controller, value, data]);
    // A paged canvas's drafts moved under the same source: its windows are
    // read again, the rows it has standing in until they land (#821).
    const draftsVersion = editing.draftsVersion;
    useLayoutEffect(() => { if (draftsVersion > 0) controller.refreshSource(); }, [controller, draftsVersion]);
    // So did its event kinds' rows, which lead every window.
    const leadVersion = lead.version;
    useLayoutEffect(() => { if (leadVersion > 0) controller.refreshSource(); }, [controller, leadVersion]);
    // So did a paged resource kind's windows (#1199): the events placed on its
    // resources, or the root's own rows each window serves after them.
    const pagedVersion = shown.version;
    useLayoutEffect(() => { if (pagedVersion > 0) controller.refreshSource(); }, [controller, pagedVersion]);
    // The source's channels are listened to while the canvas is mounted.
    useEffect(() => controller.connect(), [controller]);

    // ── The rows: inline, or the paged source's resident ones (§3.8) ──────
    // Either windowed arm — `paged`, or `pinned` naming its snapshot.
    const paged = data.rows.type !== "inline";
    // The inline arm is the canvas's BLOCKS (#823), one after another — the
    // stream's order is the render order (#822) — keyed for the canvas once
    // per decoded array. The Plan's own `rows` the viewer hides in the Series
    // tab are left out, each with the rows under it (#1195): they ride fixed
    // blocks, whole in every window, so inline or paged they leave alike.
    const rows = useMemo(() => {
        const all = data.rows.type === "inline" ? canvasRowsOf(data.rows.value) : paging.rows;
        return rowsHidden === undefined ? all : all.filter((row) => !hidesRow(rowsHidden, row.id));
    }, [data.rows, paging.rows, rowsHidden]);
    const index = useMemo(() => indexRows(rows), [rows]);
    indexRef.current = index;

    // ── The UI state the body lays out from ───────────────────────────────
    // Reconciled against the rows rendered NOW: a new value's first render
    // already has its vanished rows' focus / collapse gone and its fresh
    // declared collapse applied — no flash frame — and `setValue` commits the
    // same transition (#815). A paged source's resident rows are not all its
    // rows, so its key set says nothing is gone (#813). Selection is not in
    // the view: each row reads its own, so a click renders two rows and never
    // this.
    const reconcileModel = useMemo<PlanReconcileModel>(() => ({
        alive: new Set(index.byKey.keys()),
        complete: !paged,
        declaredCollapsed: index.initiallyCollapsed,
        declaredGrain: declaredGrainOf(data),
    }), [index, paged, data]);
    const selectView = useCallback((s: PlanSnapshot) => uiViewOf(s, reconcileModel), [reconcileModel]);
    const view = useControllerSelector(controller, selectView, sameUiView);
    const seek = useControllerSelector(controller, selectSeek);
    const anchor = useControllerSelector(controller, selectAnchor);
    const scroll = useControllerSelector(controller, selectScroll);

    // ── The model ─────────────────────────────────────────────────────────
    const dense = denseOf(data);
    // The axis KIND (#631) — every window read speaks its slice arm, and a
    // row whose instants ride another arm is a diagnostic row (#811).
    const axisKind = data.axis.type;
    // An ordinal axis orders its instants by the declared list.
    const ordinalIndex = useMemo(() => ordinalIndexOf(data.axis), [data.axis]);
    // The scale's period is what the derivations fold to.
    const period = scale?.period;
    // Renderer-side derivations (§4.2 — the Table idiom): the IR declares
    // rollups / aggregates / summaries / folds; the numbers are computed here,
    // each row's entries kept by identity while they hold (#815). Every row's
    // values fold to the scale's period first (#824) — a resolution change
    // re-derives, a pan does not. A row whose instants ride another arm
    // renders in place as a DIAGNOSTIC row and derives nothing (#811). A
    // derived number prints in the locale (#820).
    const fresh = useMemo(
        () => derivePlan(index, ordinalIndex, axisKind, words, period),
        [index, ordinalIndex, axisKind, words, period]);
    const derived = useStableDerived(fresh);
    // The R1 link graph — rows an edge touches grow the `links` control.
    const linkedKeys = useMemo(() => linkedRowKeys(data.links), [data.links]);
    // The element a link's end names, by (row, element) — where its ribbon
    // meets the row, as the element draws (#1258), and the ribbons'
    // off-window resolution: a run, or an event's element however it draws
    // (#1192).
    const linkedElementOf = useCallback((rowKey: string, runKey: string): LinkedElement | undefined => {
        const row = index.byKey.get(rowKey);
        return row !== undefined && scale !== undefined ? linkedElement(row, runKey, scale) : undefined;
    }, [index, scale]);

    // ── Chrome: transport, search ─────────────────────────────────────────
    // The series library (#590) is the library pane's Series tab (#1195): the
    // Plan feeds ITSELF the picked series, and the frame has no Series button.
    // What the chrome tells the truth with (#567 D9). Counted in ELEMENTS —
    // the number `total()` reports — never canvas rows, since a series can
    // emit any number of rows per element; the count is the block the
    // viewport is in (#823: each block pages on its own). `partial` says some
    // block does not hold every element: counts across the canvas cover the
    // loaded windows, and so does a top-level section's member count and
    // strip. Every other parent derives from one entry's subtree, which a
    // window holds whole, so its numbers are exact (`spansWindows`, #822).
    const transport = useMemo<PlanTransport | undefined>(() => {
        if (!paged) return undefined;
        return {
            loaded: paging.resident?.elements ?? 0,
            from: paging.resident?.from ?? 0,
            to: paging.resident?.to ?? 0,
            total: paging.total,
            loading: paging.loading,
            partial: !paging.complete,
        };
    }, [paged, paging.resident, paging.total, paging.loading, paging.complete]);
    // Key search is a capability of the SOURCE (`search` becomes seek — #567
    // D9): a jump rebases residency on the matched ELEMENT, and the canvas
    // positions on the first row that element placed, since a row's id starts
    // with its element's key (#822). The control is keyed on the search's
    // epoch: a new source revision drops the matches it holds, which index the
    // previous snapshot (#821).
    const seekable = data.rows.type !== "inline" && data.rows.value.seek.type === "some";
    const search = useMemo<PlanSearch | undefined>(
        () => (seekable ? { ...controller.search, resetKey: String(seek.epoch) } : undefined),
        [seekable, controller, seek.epoch]);

    // ── Row focus and the visible rows ────────────────────────────────────
    const { linkFamily, focusVisibleKeys, focusCtx } = usePlanFocus(view.focus, data.links);
    // Keyed on the view FIELDS the walk reads (`grain`, `collapsed`), and each
    // row object kept while it holds, so a row's memo survives both a store
    // change that did not move it and a window landing (#616, #815).
    const { grain, collapsed, chartsExpanded } = view;
    const walked = useMemo(
        () => visibleRows(index, { grain, collapsed }, focusVisibleKeys),
        [index, grain, collapsed, focusVisibleKeys]);
    const visible = useStableVisible(walked);
    const pinned = useMemo(
        () => pinnedRows(index).map((row): VisibleRow => ({ row, depth: 0, collapsed: false })),
        [index]);
    // The grain folds ROOT groups to their strips (`visibleRows`), so the
    // toolbar's GROUP · RESOURCE segment mounts only where it folds one (#632).
    const hasRootGroup = useMemo(() => index.roots.some((r) => r.kind.type === "group"), [index]);

    // ── The frame ─────────────────────────────────────────────────────────
    // The canvas body: the ribbons' positioning parent, the keyboard surface,
    // and what the narrow layout measures (§10, #570 — below the adaptive
    // contract's compact width the Plan is a review tool, cards and tabs; the
    // signal is the CONTAINER the body renders in, never the viewport).
    const focusBodyRef = useRef<HTMLDivElement | null>(null);
    const narrow = useContainerBelow(focusBodyRef, PLAN_NARROW_BELOW);
    // The virtualizer's scroll viewport and the sticky chrome inside it —
    // what the R2 clamp measures, watched rather than measured once (#812).
    const scrollElRef = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const { canExpand, expandBody, expandGutterBody, heightCtx } = usePlanExpand(
        value, view.focus, focusCtx, { index, visible, derived }, dense, chartsExpanded,
        { scrollElRef, headerRef }, !narrow);
    // Entering a row focus can swap the body tree (R2 unmounts the clicked
    // control), dropping browser focus to <body> and killing the esc rung —
    // re-anchor keyboard focus on the focused ROW (#819: it holds the tab
    // stop from then on), or on the canvas surface in the narrow layout,
    // which has no grid. Focus that stayed in the canvas is left where it is.
    useEffect(() => {
        if (view.focus === null) return;
        const bodyEl = focusBodyRef.current;
        const at = document.activeElement;
        if (bodyEl === null || (at !== null && at !== document.body && bodyEl.contains(at))) return;
        if (narrow) bodyEl.focus();
        else controller.focusItem(rowItemKey(view.focus.key));
    }, [view.focus, narrow, controller]);
    // The hover cursor: direct DOM writes, zero renders (#609).
    const cursorChipRef = useRef<HTMLDivElement | null>(null);
    const cursor = usePlanCursorController(focusBodyRef, cursorChipRef, scale);
    // The overlay layer (#816): the body listens for every element, and one
    // popover / hover card / tooltip opens where it is asked.
    const [anchors] = useState(createOverlayAnchors);
    const hasPopover = data.popover.type === "some";
    const hasHover = data.hover.type === "some";
    const overlayHandlers = usePlanOverlayHandlers(focusBodyRef, controller, anchors,
        useMemo(() => ({ popover: hasPopover, hover: hasHover }), [hasPopover, hasHover]));

    // ── Recipe + layout ───────────────────────────────────────────────────
    // Density is GEOMETRY, not a recipe variant (#817): one table of every
    // row and slot height, written below as the CSS variables the recipe
    // reads — the same numbers `rowHeight` lays the body out from.
    const recipe = useSlotRecipe({ key: "plan" });
    const styles = useMemo(() => recipe() as unknown as Styles, [recipe]);
    const geometry = planGeometry(dense);
    const geometryStyle = useMemo(() => planGeometryStyle(geometry), [geometry]);
    const style = useMemo(() => getSomeorUndefined(data.style), [data.style]);
    // gutterWidth is a CSS px size string. `pxOf`, not `parseFloat`: a
    // percentage must fall back to the default, never silently become that
    // many pixels (#615).
    const gutterW = (style !== undefined && style.gutterWidth.type === "some" ? pxOf(style.gutterWidth.value) : undefined) ?? GUTTER_W;
    const gridTemplate = `${gutterW}px 1fr`;
    const height = parseCssSize(style !== undefined ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style !== undefined ? getSomeorUndefined(style.maxHeight) : undefined);
    // A declared bound is the whole Plan's: it goes on the WRAPPER around its
    // frame (#1193), and the canvas fills main (`fillParent`) — the Board /
    // Roster / Planner / ValueTree discipline. Passing it inward leaves a
    // percentage (`"fill"` → `"100%"`) resolving against the auto-height
    // wrapper, which computes to `auto`: the frame reports bounded, renders
    // the spacer, and never scrolls. With none, a host that gives the frame a
    // height bounds the canvas the same way (`root/host-bound.ts`); one that
    // gives none lets it grow with its rows, and main with it.
    const declaredBound = height !== undefined || maxHeight !== undefined;
    const hostBound = useHostBound(focusBodyRef, declaredBound);
    const frameFills = declaredBound || hostBound;

    // ── The drag-target role ──────────────────────────────────────────────
    // A drop is a draft of the editing session (#880): the canvas is a target
    // only while the session can take one. A card lands — from the Plan's own
    // library panel (#1259), or a Library its `sources` lists; the canvas's own
    // runs, chips, tiles and marks move and resize (#825) — where one lands is
    // what its rows proposed at the drop point, from the press it began with
    // (`edit/store.ts`). The drag layer is told whether the gesture was
    // drafted: a drop the row's write refused, or a move back to where it
    // began, is announced as not dropped.
    //
    // Beside event kinds (#1196) the canvas takes their drags too, each one
    // step of the Plan's one history through their recorder: a card on an
    // event kind's row — a template, a backlog event, an author's card on an
    // event — an event's element moved or resized, and an element returned to
    // the Backlog tab (`edit/event-drag.ts`).
    const [editStore] = useState(() => new PlanEditStore());
    const { drop: draftDrop, move: draftMove } = editing;
    const keys = useMemo(() => planKeys(getSomeorUndefined(hostData.id)), [hostData.id]);
    const eventDrag = usePlanEventDrag({
        kinds, resources, tabs, keys, editing: eventEditing, canDrop, scale, words, store: editStore,
        rowOf: (key) => indexRef.current?.byKey.get(key),
        selected: () => controller.getSnapshot().store.ui.elements,
        select: (selected, row) => controller.selectEvents(selected, row ?? null),
    });
    const onDrag = useCallback((event: DragEventValue, meta?: DragMeta): boolean => {
        if (event.type === "add") {
            // A card on an event kind's row is the event kinds'; on `data`'s, its session's.
            const row = indexRef.current?.byKey.get(event.value.into.row);
            if (eventDrag !== undefined && row !== undefined && eventDrag.target(row) !== undefined) return eventDrag.dropCard(event);
            return draftDrop(event);
        }
        // An element returned to the Backlog tab: unscheduled (#1196).
        if (event.type === "remove") return eventDrag !== undefined && meta?.library !== undefined && eventDrag.returnElement(event, meta.library);
        if (event.type !== "move" && event.type !== "resize") return false;
        const { grab, proposal } = editStore;
        editStore.disarm();
        const row = event.type === "move" ? event.value.to.row : event.value.event.row;
        if (grab === null || proposal === null || proposal.rowKey !== row || unmoved(grab.movable, proposal)) return false;
        const request: PlanMoveRequest = {
            key: grab.movable.key, from: grab.movable.rowKey, to: proposal.rowKey, span: proposal.span,
            origin: event.type === "resize" ? "resize" : originOf(grab.movable, proposal).kind,
            label: grab.movable.label, element: grab.movable, units: proposal.units, fine: proposal.fine,
        };
        return eventDrag !== undefined && eventDrag.isEvent(grab.movable) ? eventDrag.moveElement(request) : draftMove(request);
    }, [draftDrop, draftMove, editStore, eventDrag]);
    const rowDrop = usePlanDropTarget(value, data.sources, panel ?? NO_PANEL, onDrag, editing.available, eventDrag);

    // ── The body ──────────────────────────────────────────────────────────
    const body = usePlanBody(visible, index, derived, paging, focusCtx, heightCtx, dense, chartsExpanded);
    const target = usePlanScrollTarget(body.items, index, derived, scroll);
    // ── The links layer (R1, #818) ────────────────────────────────────────
    // Its ribbons are laid out from THIS body — the heights the frame lays the
    // rows out at — and drawn in the rows' own coordinates, so they follow a
    // collapse or a landing window in the same render as the rows do.
    const linksFocus = view.focus?.kind === "links";
    const ribbonRows = useMemo(
        () => (linksFocus ? ribbonBody(body.items, body.heights, index, geometry) : undefined),
        [linksFocus, body.items, body.heights, index, geometry]);
    // A pinned row renders in the header, above every body row; a row of an
    // evicted paged window sits where its window does in its block's band
    // (#823) — a row never seen has no place, and its edges are not drawn.
    const pinnedKeys = useMemo(() => new Set(pinned.map((v) => v.row.key)), [pinned]);
    // (A band moves only with the body, so the ribbons' body is what renews it.)
    const beyond = useCallback((key: string): RibbonBeyond | undefined => {
        if (pinnedKeys.has(key)) return { off: "above" };
        const place = paged ? controller.placeOf(key) : undefined;
        const top = place !== undefined ? ribbonRows?.bands.get(`${place.block}:${place.at}`) : undefined;
        return place !== undefined && top !== undefined ? { y: top + place.px } : undefined;
    }, [pinnedKeys, paged, controller, ribbonRows]);
    // What a bounded frame's view is read from — its scroll element and the
    // sticky chrome above its rows.
    const frameRefs = useMemo(() => ({ scrollElRef, headerRef }), [scrollElRef, headerRef]);
    const reportRange = usePlanRangeReport(body.items, controller);
    // Scroll anchoring (#878): the row at the top of the view keeps its place
    // when rows above it change height or count — a window landing above at a
    // height its estimate missed. An unloaded band never anchors: rows landing
    // below it move its top, and after a rebase the same band stands for other
    // elements.
    const anchorable = useCallback((i: number) => body.items[i]?.kind !== "band", [body.items]);
    // The sticky parent (#823): while the row at the top of the view nests
    // under a parent whose own row has scrolled off, that parent — and, on a
    // deep tree, the path to it — is pinned under the header. The same inline
    // and paged: a paged window holds its entries whole, and a section's
    // header is a fixed block, so a row's parent is always on the canvas.
    const itemIndex = useMemo(() => {
        const m = new Map<string, number>();
        body.items.forEach((it, i) => m.set(bodyItemKey(it), i));
        return m;
    }, [body.items]);
    const stickyParent = useCallback((top: number): ReactNode => {
        const item = body.items[top];
        if (item?.kind !== "row" || item.row.row.parent.type !== "some") return null;
        const parent = index.byKey.get(item.row.row.parent.value);
        // Its own row still in view (or below): nothing to pin.
        const at = parent !== undefined ? itemIndex.get(rowItemKey(parent.key)) : undefined;
        if (parent === undefined || (at !== undefined && at >= top)) return null;
        const path: PlanRowValue[] = [];
        for (let up = parent.parent; up.type === "some";) {
            const row = index.byKey.get(up.value);
            if (row === undefined) break;
            path.unshift(row);
            up = row.parent;
        }
        return (
            <PlanStickyParent parent={parent} path={path} styles={styles} gridTemplate={gridTemplate}
                onGo={() => controller.focusItem(rowItemKey(parent.key), "start")} />
        );
    }, [body.items, index, itemIndex, styles, gridTemplate, controller]);
    // After EVERY commit: what the canvas now shows. A jump keeps the viewport
    // until its landed target has been on screen for a commit — the one in
    // which the frame scrolled to it — so the reports that commit's render made
    // from the OLD position cannot rebase the run back (#812).
    useEffect(() => { controller.committed(paging); });
    // The scroll anchor (#813): placed against the body once it can be — a
    // paged canvas may first jump to the window its row came from.
    useEffect(() => {
        if (anchor.phase !== "settled") controller.placeAnchor(body.items, frameFills && !narrow);
    }, [controller, anchor.phase, body.items, frameFills, narrow]);
    const onAnchorChange = useCallback(
        (at: { index: number; offset: number }) => controller.anchorChanged(at, body.items),
        [controller, body.items]);
    // The narrow list's side of the paging loop (#812): it has no virtualizer,
    // so it reports the last row card on screen, and its load-more asks every
    // block with more for the window past its resident run (#823) — the list
    // ends with the last block's unloaded run.
    const narrowPaging = useMemo<PlanNarrowPaging | undefined>(() => {
        if (!paged) return undefined;
        const more = paging.blocks.filter((b) => b.tail !== undefined);
        return {
            tail: more[more.length - 1]?.tail,
            onViewport: (key: string) => controller.reportViewport({ kind: "row", key }, false),
            onLoadMore: () => {
                for (const b of more) controller.reportViewport({ kind: "band", block: b.index, at: "tail" }, false);
            },
        };
    }, [paged, paging.blocks, controller]);
    // What the toolbar reports (#811) — everything the canvas carried on past,
    // the event kinds' rows that could not be read among it (#1192). The
    // narrow list has no scroll target, so there the rows chip states the
    // count without offering to seek.
    const sourceError = paging.sourceError ?? lead.error;
    const diagnostics = useMemo<PlanDiagnostics>(() => ({
        skipped: derived.diagnostics.size,
        onSeekSkipped: target.firstSkipped !== undefined && !narrow ? controller.seekSkipped : undefined,
        sourceError,
        searchError: seek.searchError,
        truncatedAt: scale?.truncated?.shown,
    }), [derived.diagnostics, target.firstSkipped, narrow, controller, sourceError, seek.searchError, scale]);

    // The element-click funnel, when the root declares `onElementClick` (#824)
    // — the controller reports a click to the LATEST root's.
    const clickable = data.onElementClick.type === "some";
    const resolvers = useMemo<PlanResolvers>(
        () => ({ onElementClick: clickable ? controller.elementClick : undefined }),
        [clickable, controller]);
    // What the elements select by (#1197): an event kind's element, its event.
    const selectable = useMemo(() => selectableOf(eventKinds), [eventKinds]);
    // What the inspector reads of the rows (#1197): a row, and what it draws at a bucket — as the canvas draws it.
    const inspect = useMemo<PlanCanvasInspect>(() => ({
        row: (key) => index.byKey.get(key),
        valueAt: (key, at) => {
            const row = index.byKey.get(key);
            return row === undefined || scale === undefined ? undefined : rowValueAt(row, derived, scale, words, at);
        },
    }), [index, derived, scale, words]);
    // Events selected from the frame (#1198) — the overlaps chip's pair, the
    // inspector's banner, a duplicate the inspector made (#1194): on the row
    // given, else the row that draws the first, which the controller brings
    // into view; none when no row on the canvas draws it.
    const selectEvents = useCallback((keys: readonly string[], row?: RowKey) => {
        const first = keys[0];
        if (first === undefined) return;
        controller.selectEvents(keys, row ?? index.rows.find((r) => holdsElement(r, first))?.key ?? null);
    }, [index, controller]);
    // What every row of this render shares (#616: per-row facts are computed
    // from it, and each row's memo skips unless ITS facts moved).
    const marks = editing.marks;
    // Where each open group ends (#949) — its last visible member's rule.
    const groupEnds = useMemo(() => groupEndsOf(body.items), [body.items]);
    const rowCtx = useMemo<PlanRowContext>(() => ({
        styles, gridTemplate, dense, storageKey, index, derived,
        dispatch: controller.dispatch, chartsExpanded, focusCtx, heightCtx, linkFamily, linkedKeys,
        canExpand, expandBody, expandGutterBody, partial: transport?.partial, rowDrop, marks, groupEnds,
    }), [styles, gridTemplate, dense, storageKey, index, derived, controller, chartsExpanded,
        focusCtx, heightCtx, linkFamily, linkedKeys, canExpand, expandBody, expandGutterBody, transport, rowDrop, marks,
        groupEnds]);

    // The resolution segment is a TIME-axis affordance; the now instant rides
    // whichever arm the axis declares.
    const resolutions = useMemo(() => axisResolutions(data.axis), [data.axis]);
    const now = useMemo(() => axisNow(data.axis), [data.axis]);
    // The history (#880, #1194): the frame's history item (#988) over the
    // Plan's one history — `data`'s session and each event kind's — and each
    // session's banners. An issue of `data`'s takes the reader to its entry's
    // first row on the canvas — one its entry placed — and a banner names it
    // by that row; an event kind's selects its event, and its banner names it
    // by its title.
    const rowOfIssue = useCallback(
        (issue: EditIssue) => sourceRows.find((r) => entryOf(r.id) === issue.entry), [sourceRows]);
    const where = useCallback((issue: EditIssue) => rowOfIssue(issue)?.gutter.label ?? issue.entry, [rowOfIssue]);
    const kindSessions = eventEditing.sessions;
    const onIssue = useCallback((issue: EditIssue) => {
        const source = history.sourceOf(issue);
        const kind = source === undefined ? undefined : kindSessions.find((s) => stringEqual(s.key, source));
        if (kind !== undefined) {
            if (issue.entry !== "") selectEvents([printEventRef({ kind: kind.kind, key: issue.entry })]);
            return;
        }
        const row = rowOfIssue(issue);
        if (row !== undefined) controller.focusItem(rowItemKey(row.key), "auto");
    }, [history, kindSessions, selectEvents, rowOfIssue, controller]);
    const onHistory = useCallback((action: HistoryAction) => history.act(action), [history]);
    const edits = editing.enabled || kinds.length > 0;
    const historyProps = edits ? { session: history, words, editing: false, onAction: onHistory, onIssue } : undefined;
    // Each session's banners: `data`'s naming no source, each kind's naming its kind, its issues by its events' titles.
    const draftsOf = eventEditing.draftsOf;
    const sessions = useMemo((): readonly PlanSessionBanner[] => {
        const actOn = (key: string) => (action: HistoryAction) => history.actOn(key, action);
        const out: PlanSessionBanner[] = editing.enabled
            ? [{ key: editing.historyKey, session: editing.session, name: undefined, where, onAction: actOn(editing.historyKey) }]
            : [];
        for (const held of kindSessions) {
            const kind = kinds.find((k) => stringEqual(k.key, held.kind));
            // Two kinds over one record share its session, and its banners.
            if (kind === undefined || out.some((s) => stringEqual(s.key, held.key))) continue;
            out.push({
                key: held.key, session: held.session, name: kind.name, onAction: actOn(held.key),
                where: (issue) => {
                    if (issue.entry === "") return "";
                    try {
                        const read = kind.planEvent(issue.entry, draftsOf(kind.key));
                        return read.type === "some" ? read.value.item.title : issue.entry;
                    } catch {
                        return issue.entry;
                    }
                },
            });
        }
        return out;
    }, [editing.enabled, editing.historyKey, editing.session, where, kindSessions, kinds, draftsOf, history]);

    // ── The treegrid (#819) ───────────────────────────────────────────────
    // Every item's place in the grid — the pinned rows first — published to
    // the rows, which write it onto themselves: a collapse or a landing at
    // the head renumbers every row below it without rendering one
    // (`root/grid.ts`).
    const gridRef = useRef<HTMLElement | null>(null);
    const [positions] = useState(createRowPositions);
    const gridCtx = useMemo<PlanGridContextValue>(() => ({ positions, gridRef }), [positions]);
    const positionMap = useMemo(() => {
        const m = new Map<string, number>();
        pinned.forEach((v, i) => m.set(rowItemKey(v.row.key), i + 1));
        body.items.forEach((it, i) => m.set(bodyItemKey(it), pinned.length + i + 1));
        return m;
    }, [pinned, body.items]);
    useLayoutEffect(() => { positions.set(positionMap); }, [positions, positionMap]);
    const uid = useId();
    const pinnedId = `${uid}-pinned`;
    // The grid's items as the keyboard walks them.
    const pinnedHeights = useMemo(
        () => pinned.map((v) => rowHeight(v, dense, chartsExpanded, heightCtx, derived)),
        [pinned, dense, chartsExpanded, heightCtx, derived]);
    const navItems = useMemo(() => planNavItems({
        pinned, pinnedHeights, items: body.items, heights: body.heights, index, chartsExpanded, focusCtx,
    }), [pinned, pinnedHeights, body.items, body.heights, index, chartsExpanded, focusCtx]);
    // What the grid knows of its source's ends — a pending band move waits
    // while a window is in flight, and Home / End until the first block's
    // first element / the last block's last element is resident (#823).
    const navEdges = useMemo<PlanNavEdges>(() => {
        const pagedBlocks = paging.blocks.filter((b) => !b.fixed);
        const first = pagedBlocks[0];
        const last = pagedBlocks[pagedBlocks.length - 1];
        return {
            loading: paging.loading,
            atStart: !paged || first === undefined || (first.head === undefined && first.resident?.from === 0),
            atEnd: !paged || last === undefined || (last.tail === undefined && last.resident !== undefined
                && paging.total !== undefined && last.resident.to >= paging.total),
        };
    }, [paged, paging.loading, paging.blocks, paging.total]);
    // A keyboard move onto a band waits — on the band, which stands for its
    // windows while they load (#876), or on the item it set out from when the
    // demand took the band away — for the rows, then goes on to the row it was
    // headed for (`resolveNavIntent`).
    const navIntent = useRef<{ holder: string; intent: PlanNavIntent } | null>(null);
    useEffect(() => {
        const pending = navIntent.current;
        if (pending !== null) {
            // Moved on meanwhile: the move is theirs now.
            if (controller.getSnapshot().nav.active !== pending.holder) {
                navIntent.current = null;
            } else {
                const r = resolveNavIntent(navItems, pending.intent, navEdges);
                if (r.t !== "pending") {
                    navIntent.current = null;
                    if (r.t === "resolved") controller.focusItem(r.key, "auto");
                    return;
                }
            }
        }
        const snap = controller.getSnapshot();
        // A keyboard move whose item the grid no longer holds — a grain change
        // folded the row away — is dropped (left standing, it would take
        // focus if the item ever came back), and the grid takes focus
        // instead, handing it on to a row. A host data change that takes a
        // row away asks for no move, and moves nothing.
        const req = snap.nav.request;
        if (req !== null && !navItems.some((it) => it.key === req.key)) {
            controller.focusDone(req.seq);
            if (!narrow) gridRef.current?.focus();
        }
    }, [navItems, navEdges, controller, narrow]);

    // ── Moves (#825) ──────────────────────────────────────────────────────
    // What the rows and elements move with: the store, the drag surface — none
    // in the narrow layout, a review tool — and the words a keyboard reader is
    // told how to move one with.
    const helpId = `${uid}-move-help`;
    const moveSurface = !narrow ? rowDrop?.surface : undefined;
    // Whether a card from the library panel's own tabs has a row to land on
    // (#1259): the canvas takes cards, and a row on it makes an item of one,
    // as `BodyRow` registers its cell. The panel's cards drag only then — never
    // in the narrow layout, which draws no row to drop on.
    const takesCards = useMemo(
        () => !narrow && rowDrop?.cards === true && index.rows.some((row) => row.edits.drop
            && DROPPABLE_KINDS.has(row.kind.type) && !derived.diagnostics.has(row.key)),
        [narrow, rowDrop, index, derived]);
    // Whether the event kinds' cards have a row to land on (#1196): an event
    // kind's row the canvas draws, outside the narrow layout. The Events and
    // Backlog tabs' cards drag only then.
    const takesEvents = useMemo(
        () => !narrow && rowDrop?.events !== undefined && index.rows.some((row) => DROPPABLE_KINDS.has(row.kind.type)
            && !derived.diagnostics.has(row.key) && rowDrop.events!.target(row) !== undefined),
        [narrow, rowDrop, index, derived]);
    // The event kinds with an event drawn on the canvas (#1196): an author's
    // card whose patch lands on one of them drags while one is there.
    const patchKinds = useMemo(
        () => (narrow || rowDrop?.events === undefined ? NO_KINDS_DRAWN : drawnKinds(index.rows, rowDrop.events)),
        [narrow, rowDrop, index]);
    const editCtx = useMemo<PlanEditContextValue | null>(() => (scale !== undefined
        ? {
            store: editStore, surface: moveSurface, helpId, styles, words, scale,
            dataMoves: rowDrop?.data === true, eventMove: rowDrop?.events?.rowMove,
        }
        : null), [editStore, moveSurface, helpId, styles, words, scale, rowDrop]);
    /** Focus an element where it is now — else its row. */
    const focusElement = useCallback((rowKey: string, key: string) => {
        const bodyEl = focusBodyRef.current;
        if (bodyEl === null) return;
        const rowEl = Array.from(bodyEl.querySelectorAll<HTMLElement>("[data-plan-row]"))
            .find((el) => el.getAttribute("data-plan-row") === rowKey);
        const el = rowEl === undefined ? undefined : Array.from(rowEl.querySelectorAll<HTMLElement>(PLAN_ELEMENT_SELECTOR))
            .find((e) => e.hasAttribute("tabindex")
                && ["data-run", "data-chip", "data-event", "data-mark"].some((a) => e.getAttribute(a) === key));
        if (el !== undefined) el.focus({ preventScroll: true });
        else controller.focusItem(rowItemKey(rowKey), "auto");
    }, [controller]);
    // The keyboard's move: Space on an element picks it up (`edit/use-carry.ts`).
    // An event kind's element is carried onto the rows of the resource kinds
    // its kind is placed on, and judged by the event kinds (#1196).
    const carry = usePlanCarry({
        store: editStore, scale, words, surface: moveSurface, veto: rowDrop?.canDrop, rows: visible,
        takes: (row, movable) => DROPPABLE_KINDS.has(row.kind.type) && !derived.diagnostics.has(row.key) && (eventDrag?.isEvent(movable) === true
            ? eventDrag.drawsKind(row, movable)
            : row.edits.move.type === "some" && row.edits.move.value.items === movable.items),
        judge: (movable, to) => {
            if (eventDrag === undefined || !eventDrag.isEvent(movable)) return undefined;
            const row = index.byKey.get(to.rowKey);
            const verdict = row !== undefined ? eventDrag.element(row, movable, to) : undefined;
            return { allowed: verdict?.allowed === true, reason: verdict?.allowed === false ? verdict.caption : undefined };
        },
        // An event kind's row by the resource it stands for: a way of drawing after its first is labelled with its kinds.
        labelOf: (key) => {
            const row = index.byKey.get(key);
            return (row !== undefined ? eventDrag?.where(row) : undefined) ?? labelOf(key);
        },
        move: (request) => (eventDrag !== undefined && request.element !== undefined && eventDrag.isEvent(request.element)
            ? eventDrag.moveElement(request)
            : draftMove(request)),
        reveal: (key) => controller.focusItem(rowItemKey(key), "auto"),
        focus: focusElement,
    });
    // A keyboard drop is drawn with its draft — focus the element there.
    useLayoutEffect(() => {
        const at = editStore.takeFocus();
        if (at !== null) focusElement(at.rowKey, at.key);
    });

    // ── What the frame's parts read ──────────────────────────────────────
    // The events a kind's drafts changed (#1196), by their elements' keys: each
    // element of one wears the drafted look. The same set while the drafts hold.
    const eventDrafts = eventEditing.drafts;
    const drafted = useMemo(() => {
        const out = new Set<string>();
        for (const [kind, byId] of eventDrafts) for (const id of byId.keys()) out.add(printEventRef({ kind, key: id }));
        return out;
    }, [eventDrafts]);
    // The canvas's contexts and its declared density wrap everything the
    // frame draws — main, and the toolbar's items, the banners and the
    // footer — so each speaks as the canvas does.
    const densityTag = style !== undefined ? getSomeorUndefined(style.density)?.type : undefined;
    const provide = (children: ReactNode): ReactNode => {
        const provided = (
            <PlanWordsContext.Provider value={words}>
            <PlanControllerContext.Provider value={controller}>
            <PlanGeometryContext.Provider value={geometry}>
            <PlanScaleContext.Provider value={scale ?? null}>
            <PlanDispatchContext.Provider value={controller.dispatch}>
            <PlanCursorContext.Provider value={cursor}>
            <PlanResolversContext.Provider value={resolvers}>
            <PlanSelectableContext.Provider value={selectable}>
            <PlanDraftedContext.Provider value={drafted}>
            <PlanGridContext.Provider value={gridCtx}>
            <PlanEditContext.Provider value={editCtx}>
                {children}
            </PlanEditContext.Provider>
            </PlanGridContext.Provider>
            </PlanDraftedContext.Provider>
            </PlanSelectableContext.Provider>
            </PlanResolversContext.Provider>
            </PlanCursorContext.Provider>
            </PlanDispatchContext.Provider>
            </PlanScaleContext.Provider>
            </PlanGeometryContext.Provider>
            </PlanControllerContext.Provider>
            </PlanWordsContext.Provider>
        );
        return densityTag !== undefined ? <DensityProvider value={densityTag}>{provided}</DensityProvider> : provided;
    };
    const bound = declaredBound ? { height, maxHeight } : undefined;

    // A source that cannot be READ no longer replaces the canvas (#811): its
    // windows fail one by one, each as its own band with the reason and a
    // Retry. A missing WINDOW is the one thing no row can be placed without —
    // and it is never the rows' to supply (#822), inline or paged. Without
    // one, main says so, alone in the frame.
    if (scale === undefined) {
        return {
            provide,
            vars: geometryStyle,
            bound,
            main: (
                <Box css={styles.diagnostic} data-plan-empty>
                    {axisKind === "ordinal" ? words.m.noWindowOrdinal() : words.m.noWindow()}
                </Box>
            ),
            chrome: undefined,
        };
    }

    const header = (
        <PlanHeader styles={styles} gridTemplate={gridTemplate} headerRef={headerRef}
            slice={slice} affordances={affordances} now={now}
            // The ruler's gutter caption is the active grain's name (the §1 mock).
            rulerCaption={words.m.grainName({ grain })} cursorChipRef={cursorChipRef}
            pinned={pinned.map((v) => (
                <Box key={v.row.key} background="bg.surface">{renderPlanRow(v, rowCtx)}</Box>
            ))}
            pinnedId={pinned.length > 0 ? pinnedId : undefined}
            focus={view.focus}
            // The focused row by name — its label, or its key's words while a
            // paged row is not resident (#822: a key is an id's text).
            focusLabel={view.focus !== null
                ? index.byKey.get(view.focus.key)?.gutter.label ?? rowKeyWords(view.focus.key)
                : undefined}
            linkCounts={linkFamily !== undefined
                ? { upstream: linkFamily.upstream.size, downstream: linkFamily.downstream.size }
                : undefined} />
    );

    // ── The grid's keys (#819, `root/keyboard.ts`) ────────────────────────
    // How far a page moves: the frame's viewport less its pinned header, or
    // the window's on an unbounded canvas.
    const pageHeight = (): number => {
        const el = scrollElRef.current;
        if (frameFills && el !== null) return Math.max(0, el.clientHeight - (headerRef.current?.offsetHeight ?? 0));
        return typeof window !== "undefined" ? window.innerHeight : 0;
    };
    const runMove = (move: PlanNavMove, from: string) => {
        switch (move.t) {
            case "focus":
                controller.focusItem(move.key, move.align);
                break;
            case "band": {
                // The window beside the run, asked for now — whatever the
                // scroll reports after. While its windows load the band stands
                // for them (#876); a demand whose windows landed at once may
                // have filled it, and focus then stays where it is until the
                // intent finds the row it was headed for.
                controller.reportViewport(move.demand, false);
                const p = controller.getSnapshot().paging;
                const demand = move.demand;
                const block = demand.kind === "band" ? p.blocks.find((b) => b.index === demand.block) : undefined;
                const stays = demand.kind === "band" && (demand.at === "head" ? block?.head : block?.tail) !== undefined;
                navIntent.current = { holder: stays ? move.key : from, intent: move.intent };
                if (stays) controller.focusItem(move.key, move.align);
                break;
            }
            case "event":
                controller.dispatch(move.event);
                // Focus stays on (or lands on) its item: the event may have
                // re-rendered it as another element — a rail becoming a row.
                controller.focusItem(move.focus);
                break;
            case "none":
                break;
        }
    };
    // An element's activation from the keyboard does what its click does:
    // the popover, the selection, the author's element callback.
    const activateElement = (el: HTMLElement, additive: boolean) => {
        const ref = refOfElement(el);
        if (ref === undefined) return;
        overlayHandlers.openAt(el);
        // A link belongs to no one row — it selects none. An event's element
        // selects its event, Shift adding it (#1197); any other, its row.
        if (ref.type !== "link") {
            const key = elementKeyOf(ref);
            const row = rowKeyOf(ref.value.row);
            controller.dispatch(key !== undefined && selectable(key)
                ? { t: "element.select", key, row, additive }
                : { t: "row.select", key: row });
        }
        controller.elementClick(ref);
    };
    /** A key in the grid — `true` when it was the grid's. */
    const gridKeys = (e: KeyboardEvent<HTMLDivElement>, bodyEl: HTMLElement): boolean => {
        const item = gridItemOf(e.target, bodyEl);
        if (item === null || e.altKey || e.ctrlKey || e.metaKey) return false;
        const itemKey = item.getAttribute("data-plan-item") ?? "";
        if (e.target === item) {
            // The row itself: Tab walks into its widgets; the rest is the map.
            if (e.key === "Tab") {
                if (e.shiftKey) return false;
                const ring = rowWidgets(item, bodyEl);
                if (ring.length === 0) return false;
                e.preventDefault();
                ring[0]!.focus();
                return true;
            }
            const move = planNavKey(navItems, itemKey, e.key, pageHeight());
            if (move === undefined) return false;
            e.preventDefault();
            runMove(move, itemKey);
            return true;
        }
        // A widget of the row: an element or a control.
        const widget = e.target as HTMLElement;
        const isElement = widget.matches(PLAN_ELEMENT_SELECTOR);
        switch (e.key) {
            case "Escape":
                // Back to the row — one rung; the next Escape is the ladder's.
                e.preventDefault();
                item.focus({ preventScroll: true });
                return true;
            case "Tab": {
                const ring = rowWidgets(item, bodyEl);
                const i = ring.indexOf(widget);
                if (e.shiftKey) {
                    e.preventDefault();
                    (i > 0 ? ring[i - 1]! : item).focus();
                    return true;
                }
                // Past the last widget, Tab leaves the canvas as it would.
                if (i < 0 || i >= ring.length - 1) return false;
                e.preventDefault();
                ring[i + 1]!.focus();
                return true;
            }
            case "ArrowLeft": case "ArrowRight": case "Home": case "End": {
                if (!isElement) return false;
                const els = plotElements(item, bodyEl);
                const i = els.indexOf(widget);
                if (i < 0) return false;
                const j = e.key === "Home" ? 0 : e.key === "End" ? els.length - 1
                    : Math.max(0, Math.min(els.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
                e.preventDefault();
                els[j]!.focus();
                return true;
            }
            case "ArrowUp": case "ArrowDown": {
                // Up and down leave the row's widgets for the next row.
                const move = planNavKey(navItems, itemKey, e.key, pageHeight());
                if (move === undefined) return false;
                e.preventDefault();
                runMove(move, itemKey);
                return true;
            }
            case "Enter": case " ":
                // A button's own key activates it; an element is the canvas's to.
                if (!isElement) return false;
                e.preventDefault();
                // Space picks up an element that moves (#825); Enter keeps
                // doing what its click does — Shift adding an event to the selection.
                if (e.key === " " && carry.start(widget)) return true;
                activateElement(widget, e.shiftKey);
                return true;
            default:
                return false;
        }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const bodyEl = focusBodyRef.current;
        const t = e.target as HTMLElement;
        // Keys typed in portalled content — an open popover's body, a toolbar
        // menu — bubble here through the React tree; they are not the canvas's.
        if (bodyEl === null || !(t instanceof Node) || !bodyEl.contains(t)) return;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
        // Nor is a key something nearer already handled — an open overlay's
        // Escape (its layer listens on the document, ahead of the canvas), a
        // widget in an expand render, a nested canvas's own ladder.
        if (e.defaultPrevented) return;
        // An element carried by the keyboard takes the keys while it lasts (#825).
        if (editStore.carry !== null && carry.keys(e)) return;
        // The history keys every collection shares (#988): the Plan's one history's (#1194).
        const historyKey = edits ? historyShortcut(e) : undefined;
        if (historyKey !== undefined) {
            e.preventDefault();
            history.act(historyKey);
            return;
        }
        // An open popover is the ladder's top rung.
        if (e.key === "Escape" && overlayHandlers.onKeyDown(e)) return;
        if (gridKeys(e, bodyEl)) return;
        // Enter on an element outside the grid — a narrow card's.
        if (overlayHandlers.onKeyDown(e)) return;
        const ev = KEYS[e.key];
        if (ev === undefined) return;
        e.preventDefault();
        controller.dispatch(ev);
        // A key pressed on a row keeps focus on it: the ladder may re-render
        // it as another element (a rail returning to a row).
        const item = gridItemOf(t, bodyEl);
        if (item !== null && item === t) controller.focusItem(item.getAttribute("data-plan-item") ?? "");
    };

    // Focus landing on the grid itself (it is the tab stop while no mounted
    // row holds it) goes on to a row: the one that held it, else the
    // selection, else the first — scrolled into view first if it must be.
    const onGridFocus = (e: FocusEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        const snap = controller.getSnapshot();
        const keys = new Set(navItems.map((it) => it.key));
        const selected = snap.store.ui.selected !== null ? rowItemKey(snap.store.ui.selected) : undefined;
        const target = snap.nav.active !== null && keys.has(snap.nav.active) ? snap.nav.active
            : selected !== undefined && keys.has(selected) ? selected
                : navItems[0]?.key;
        if (target !== undefined) controller.focusItem(target, "auto");
    };

    // A carry whose reader left the canvas ends where it began (#825).
    const onBodyBlur = (e: FocusEvent<HTMLDivElement>) => {
        if (editStore.carry === null) return;
        const next = e.relatedTarget;
        if (next instanceof Node && e.currentTarget.contains(next)) return;
        carry.cancel();
    };

    const main = (
        <Box
            ref={focusBodyRef}
            // The keyboard surface and the focus anchor, but not a tab
            // stop: the grid's one stop is its active row (#819).
            tabIndex={-1}
            outline="none"
            position="relative"
            width="100%"
            minWidth={0}
            data-plan-body
            onBlur={onBodyBlur}
            // The bound lives HERE, not on the frame — the attribute is
            // the contract (jsdom resolves no Chakra classes).
            data-plan-bounded={frameFills ? "" : undefined}
            // The narrow layout is in charge (its recipe rules key on it).
            data-plan-narrow={narrow ? "" : undefined}
            // The source is not exhausted: the counts across this body
            // cover the loaded windows (`PlanTransport.partial`).
            data-plan-partial={transport?.partial === true ? "" : undefined}
            // Bounded, the canvas fills the frame's main and scrolls its
            // own rows. Grown with its rows, it keeps its own height —
            // never shrunk to main's — so a host that bounds the frame is
            // seen to cut it off (`useHostBound`).
            {...(frameFills
                ? { display: "flex", flexDirection: "column", flex: "1", minHeight: 0 }
                : { flex: "none" })}
            onKeyDown={onKeyDown}
            onClickCapture={overlayHandlers.onClickCapture}
            onPointerOver={overlayHandlers.onPointerOver}
            onPointerOut={overlayHandlers.onPointerOut}
        >
            {narrow ? (
                <PlanNarrow
                    styles={styles} index={index} derived={derived} view={view}
                    dense={dense} storageKey={storageKey}
                    expandBody={expandBody} expandGutterBody={expandGutterBody}
                    canExpand={canExpand} partial={transport?.partial} fill={frameFills}
                    failures={paging.failures} onRetry={controller.retry}
                    paging={narrowPaging} marks={marks}
                />
            ) : (
                <VirtualRows
                    height={frameFills ? undefined : height}
                    maxHeight={frameFills ? undefined : maxHeight}
                    fillParent={frameFills}
                    // Every body item pins the exact height it gives the
                    // frame in `sizes` — `RowShell` sets `height: {h}px`
                    // from the same `rowHeight()`, the rail / gap bands
                    // read the same geometry table's variables in the
                    // recipe (#817), and the R2 render pins its clamped
                    // `px`. Measuring fixed-height rows drifts under
                    // fractional zoom and paints hairline seams (#533).
                    measureRows={false}
                    scrollToIndex={target.toIndex}
                    scrollNonce={target.nonce}
                    scrollAlign={target.align}
                    // The rows' container IS the treegrid (#819): every
                    // body item is a row of it, the pinned rows join by
                    // `aria-owns`, and its count is exact — an unloaded
                    // run is one row, the band that stands for it.
                    rowsRef={gridRef}
                    rowsProps={{
                        role: "treegrid",
                        "aria-label": words.m.gridLabel(),
                        "aria-rowcount": pinned.length + body.items.length,
                        ...(pinned.length > 0 ? { "aria-owns": pinnedId } : {}),
                        // The tab stop while no mounted row holds it.
                        tabIndex: 0,
                        onFocus: onGridFocus,
                    }}
                    onRangeChange={paged ? reportRange : undefined}
                    // Unbounded, a large canvas mounts only what its
                    // scrolling ancestor shows (#812) — the same threshold
                    // whatever the source. A smaller paged canvas mounts
                    // every row and still reports which are on screen.
                    virtualizeUnboundedAt={VIRTUALIZE_UNBOUNDED_AT}
                    scrollElRef={scrollElRef}
                    header={header}
                    sticky={stickyParent}
                    // R1 ribbons — the K8 vocabulary over the gathered
                    // family (ribbons need width — never on the narrow
                    // layout). They are their own part (#811): a throw
                    // while laying them out loses the ribbons, not the
                    // canvas. `null` without a links focus, never
                    // omitted: the rows' box stays put, so no row
                    // remounts as the ribbons come and go.
                    overlay={ribbonRows !== undefined && focusVisibleKeys !== undefined ? (
                        <PlanPartBoundary part={LINKS_LAYER} resetKey={focusVisibleKeys} styles={styles}>
                            <LinksOverlay styles={styles} links={data.links} visibleKeys={focusVisibleKeys}
                                body={ribbonRows} beyond={beyond} scale={scale} element={linkedElementOf}
                                gutterPx={gutterW}
                                frame={frameFills ? frameRefs : undefined} />
                        </PlanPartBoundary>
                    ) : null}
                    count={body.items.length}
                    // Heights move at a constant count — a chart toggle, a
                    // focus stripping every other row, a band landing as
                    // rows — and the frame re-measures from these alone.
                    sizes={body.heights}
                    getItemKey={body.itemKey}
                    anchorable={anchorable}
                    // Where the scroll rests, persisted and restored as a
                    // row (#813).
                    onAnchorChange={onAnchorChange}
                    restoreAnchor={anchor.restore}
                    renderRow={(i) => {
                        const item = body.items[i];
                        switch (item?.kind) {
                            case undefined: return null;
                            case "gap":
                                return <PlanGapBand gap={item.gap} h={body.heights[i] ?? 0} styles={styles}
                                    gridTemplate={gridTemplate} dispatch={controller.dispatch} />;
                            case "band":
                                return <WindowBand band={item.band} styles={styles} />;
                            case "failed":
                                return <WindowFailureBand failure={item.failure} styles={styles} onRetry={controller.retry} />;
                            case "row":
                                return renderPlanRow(item.row, rowCtx);
                        }
                    }}
                    headerZIndex={5}
                    rootCss={styles.root}
                />
            )}
            <PlanOverlays anchors={anchors} styles={styles} storageKey={storageKey} />
            <PlanAnnouncer />
            {/* The keyboard's move (#825): what a carry does, said as it
                happens, and how to begin one — every element that moves
                is described by it. */}
            <PlanCarryAnnouncer store={editStore} />
            {moveSurface !== undefined && <VisuallyHidden id={helpId}>{words.m.moveHelp()}</VisuallyHidden>}
        </Box>
    );

    return {
        provide,
        // The geometry as CSS variables — every height the recipe draws that
        // the model also computes reads one of these, from the frame's
        // wrapper down.
        vars: geometryStyle,
        bound,
        main,
        chrome: {
            words, styles, storageKey, scale, slice, affordances, resolutions,
            // The grain folds the canvas's root groups (#632); below 480px the
            // narrow layout's Groups · Rows tabs own them, so nothing is left
            // for the segment to do there.
            grain: hasRootGroup && !narrow ? grain : undefined,
            transport, search, diagnostics,
            history: historyProps, sessions, where,
            events: kinds.length > 0 ? eventEditing : undefined,
            footer: data.footer,
            id: getSomeorUndefined(data.id),
            narrow,
            inspect,
            selectEvents,
            takesCards,
            takesEvents,
            patchKinds,
        },
    };
}
