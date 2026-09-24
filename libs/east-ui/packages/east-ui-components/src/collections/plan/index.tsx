/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraPlan` — the temporally-aligned composite canvas (`Plan Spec.md`
 * §6): decode, the one shared scale, the one controller, and the shell
 * composition (toolbar / horizon brush / ruler / rows / footer).
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
 * own data. The listed affordances mount through the shared
 * `SliceRailCluster`; `brush` mounts as the 32px horizon band, `resolution`
 * as the WEEK/DAY segment, `summary` as the toolbar count line. Beyond Table
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
 * one-line fallback. The toolbar counts what it can — skipped rows, a source
 * or search failure, a truncated axis. Nothing a row or a source does
 * replaces the canvas.
 *
 * All eight row kinds render (`rows/*`); review chrome, the drag-target
 * role, element clicks and the keyboard rungs are wired — the reducer's
 * events and the component's dispatches are a closed loop (#569). Every
 * element's popover, hover card and tooltip come from ONE overlay layer the
 * body delegates to (#816, `root/overlays.tsx`).
 *
 * The body is a TREEGRID (#819): every row, group band, gap band and window
 * band is a `row` at its `aria-rowindex` (`root/grid.ts`), with ONE tab stop
 * roving between them, a keyboard map over rows and their elements
 * (`root/keyboard.ts`), a polite live region (`root/announce.tsx`), and words
 * for everything the canvas says only by shape or colour (`a11y.ts`).
 */

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, equivalentFor } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { parseCssSize } from "../../style/parse-size.js";
import { DensityProvider } from "../../contracts/density.js";
import { useContainerBelow } from "../../contracts/adaptive.js";
import { useDataStable } from "../../hooks/useDataStable.js";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { VirtualRows } from "../virtual-rows.js";
import { ReviewFoot } from "../shared/review.js";
import {
    PlanScaleContext, PlanDispatchContext, PlanCursorContext, PlanResolversContext, PlanGeometryContext,
    type PlanResolvers,
} from "./context.js";
import { planGeometry, planGeometryStyle } from "./geometry.js";
import { WindowBand, WindowFailureBand } from "./rows/WindowBand.js";
import { PlanPartBoundary } from "./rows/PartBoundary.js";
import { axisNow, axisResolutions, ordinalIndexOf } from "./axis.js";
import type { PlanInstantValue } from "./instant.js";
import type { PlanEvent } from "./plan-state.js";
import {
    bodyItemKey, derivePlan, indexRows, linkedRowKeys, pinnedRows, pxOf, rowHeight, rowItemKey, visibleRows,
    type PlanRootValue, type VisibleRow,
} from "./model.js";
import { PlanNarrow, PLAN_NARROW_BELOW } from "./narrow/index.js";
import type { PlanNarrowPaging } from "./narrow/demand.js";
import { LinksOverlay } from "./shell/LinksOverlay.js";
import { ribbonBody } from "./shell/ribbon-layout.js";
import type { RibbonOff } from "./shell/ribbon-geometry.js";
import { PlanFooter } from "./shell/Footer.js";
import type { PlanDiagnostics } from "./shell/Diagnostics.js";
import { planReviewModel, DECISION_WIDTH } from "./shell/Review.js";
import type { PlanTransport } from "./shell/transport.js";
import {
    createPlanController, declaredCollapsedOf, declaredGrainOf, denseOf,
    type PlanReconcileModel, type PlanSnapshot,
} from "./controller/index.js";
import { PlanControllerContext, useControllerSelector } from "./controller/react.js";
import { NOT_PERSISTED, persistedOf, type PlanPersisted } from "./persisted.js";
import { sameUiView, uiViewOf, useStableDerived, useStableVisible } from "./root/view.js";
import { usePlanWindow } from "./root/window.js";
import { usePlanExpand, usePlanFocus } from "./root/focus.js";
import { usePlanBody, usePlanRangeReport, usePlanScrollTarget } from "./root/body.js";
import { PlanGapBand, renderPlanRow, type PlanRowContext } from "./root/rows.js";
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

type Styles = Record<string, Record<string, unknown>>;

export { type PlanRootValue, type PlanRowValue } from "./model.js";

// The memo compares CLOSURES too (#809). A Plan root is function-heavy — the
// resolvers, the element callbacks, a paged source's `page` wrapping its
// series — and `equalFor` calls every pair of functions equal, so a root that
// differed only inside one (a resolver over new data, a series `match` over a
// new threshold) was dropped and the canvas rendered the old closures.
const planRootEqual = equivalentFor(Plan.Types.Root);
// ...while the pure-data derivations key on the value's DATA identity, so the
// root a closure-only change lets through swaps the callbacks without
// rebuilding the row model, the scale or the link graph.
const planRootDataEqual = equalFor(Plan.Types.Root);

/** Default gutter width (px, desktop — the §8 sheet). */
const GUTTER_W = 168;
/** An UNBOUNDED canvas with at least this many body items mounts only what
 *  its scrolling ancestor shows (#812). Below it every row renders, so
 *  content-sized examples and captures keep their full render. */
const VIRTUALIZE_UNBOUNDED_AT = 400;

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

export interface EastChakraPlanProps {
    /** The Plan root value. */
    value: PlanRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
}

/** Renders an East Plan value — the composite temporal canvas. */
export const EastChakraPlan = memo(function EastChakraPlan({ value, storageKey }: EastChakraPlanProps) {
    planRootRenderProbe?.();
    // Changes identity on a DATA change only — read data fields through it,
    // callbacks through `value` (#809).
    const data = useDataStable(value, planRootDataEqual);

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
        grain: declaredGrainOf(value),
        collapsed: value.rows.type === "inline" ? declaredCollapsedOf([...value.rows.value.values()]) : [],
        restored: persistedOf(stored),
        persist: (next) => persistTo.current(next),
    }));
    // Props sync. A new DATA identity reconciles the UI state (#610); the
    // render below already drew the reconciled view, so this commits what is
    // on screen and renders nothing more.
    useLayoutEffect(() => { controller.setValue(value, data); }, [controller, value, data]);
    // The source's channels are listened to while the canvas is mounted.
    useEffect(() => controller.connect(), [controller]);

    // ── The rows: inline, or the paged source's resident ones (§3.8) ──────
    const paging = useControllerSelector(controller, selectPaging);
    const paged = data.rows.type === "paged";
    // The inline arm is the canvas's KEYED collection (#568) — decoded as a
    // SortedMap, so its values are already in canonical key order.
    const rows = useMemo(
        () => (data.rows.type === "inline" ? [...data.rows.value.values()] : paging.rows),
        [data.rows, paging.rows],
    );
    const index = useMemo(() => indexRows(rows), [rows]);

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
    // Renderer-side derivations (§4.2 — the Table idiom): the IR declares
    // rollups / aggregates / summaries; the numbers are computed here, each
    // row's entries kept by identity while they hold (#815). A row whose
    // instants ride another arm renders in place as a DIAGNOSTIC row and
    // derives nothing (#811).
    const fresh = useMemo(() => derivePlan(index, ordinalIndex, axisKind), [index, ordinalIndex, axisKind]);
    const derived = useStableDerived(fresh);
    // The R1 link graph — rows an edge touches grow the `links` control.
    const linkedKeys = useMemo(() => linkedRowKeys(data.links), [data.links]);
    // A run's instants by (row, run) — the ribbons' off-window resolution.
    const runDates = useCallback((rowKey: string, runKey: string): { start: PlanInstantValue; end: PlanInstantValue } | undefined => {
        const row = index.byKey.get(rowKey);
        if (row === undefined || row.kind.type !== "span") return undefined;
        const r = row.kind.value.runs.find((x) => x.key === runKey);
        return r !== undefined ? { start: r.start, end: r.end } : undefined;
    }, [index]);

    // ── Chrome: slice, scale, series library, review, transport, search ──
    const { chrome, slice, affordances, scale } = usePlanWindow(value, data, rows);
    // The series library (#590) — chrome, like the slice rail: the Plan feeds
    // ITSELF the picked series, so all that is left here is the panel.
    const pick = useMemo(() => getSomeorUndefined(value.pick), [value.pick]);
    // Review chrome (#569) — ACTIONS only. The verdict is not held here: it
    // lives wherever the author's callback wrote it and arrives back as each
    // row's `approval`, so the buttons and the canvas cannot disagree. The
    // verbs are the controller's, which fire the LATEST root's callbacks.
    const review = useMemo(
        () => planReviewModel(getSomeorUndefined(data.review), controller),
        [data.review, controller]);
    // What the chrome tells the truth with (#567 D9). Counted in ELEMENTS —
    // the number `total()` reports — never canvas rows, since a series can
    // emit any number of rows per element. `partial` qualifies every derived
    // number (rollup bands, group counts, strip summaries): they cover the
    // loaded prefix until the source is exhausted.
    const transport = useMemo<PlanTransport | undefined>(() => {
        if (!paged) return undefined;
        const loaded = paging.resident?.elements ?? 0;
        return {
            loaded,
            from: paging.resident?.from ?? 0,
            to: paging.resident?.to ?? 0,
            total: paging.total,
            loading: paging.loading,
            partial: paging.total === undefined || loaded < paging.total,
        };
    }, [paged, paging.resident, paging.total, paging.loading]);
    // Key search is a capability of the SOURCE (`search` becomes seek — #567
    // D9): a jump rebases residency on the matched ELEMENT, and the canvas
    // positions by key, since a leaf row's key IS its data key.
    const search = data.rows.type === "paged" && data.rows.value.seek.type === "some" ? controller.search : undefined;

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
    const gridTemplate = `${gutterW}px 1fr${review !== undefined ? ` ${DECISION_WIDTH}` : ""}`;
    const height = parseCssSize(style !== undefined ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style !== undefined ? getSomeorUndefined(style.maxHeight) : undefined);
    // A declared bound goes on the WRAPPER and the frame fills the remainder
    // (`fillParent`) — the Board / Roster / Planner / ValueTree discipline.
    // Passing it inward leaves a percentage (`"fill"` → `"100%"`) resolving
    // against the auto-height wrapper, which computes to `auto`: the frame
    // reports bounded, renders the spacer, and never scrolls.
    const frameFills = height !== undefined || maxHeight !== undefined;

    // ── The drag-target role ──────────────────────────────────────────────
    const rowDrop = usePlanDropTarget(value, data.sources, controller);

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
    // A pinned row renders in the header, above every body row.
    const pinnedKeys = useMemo(() => new Set(pinned.map((v) => v.row.key)), [pinned]);
    const beyond = useCallback(
        (key: string): RibbonOff | undefined => (pinnedKeys.has(key) ? "above" : undefined),
        [pinnedKeys]);
    // What a bounded frame's view is read from — its scroll element and the
    // sticky chrome above its rows.
    const frameRefs = useMemo(() => ({ scrollElRef, headerRef }), [scrollElRef, headerRef]);
    const reportRange = usePlanRangeReport(body.items, controller);
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
    // so it reports the last row card on screen, and its load-more asks for
    // the window past the resident run.
    const narrowPaging = useMemo<PlanNarrowPaging | undefined>(() => (!paged ? undefined : {
        tail: paging.tail,
        loading: paging.loading,
        onViewport: (key: string) => controller.reportViewport({ kind: "row", key }, false),
        onLoadMore: () => controller.reportViewport({ kind: "band", at: "tail" }, false),
    }), [paged, paging.tail, paging.loading, controller]);
    // What the toolbar reports (#811) — everything the canvas carried on past.
    const diagnostics = useMemo<PlanDiagnostics>(() => ({
        skipped: derived.diagnostics.size,
        onSeekSkipped: target.firstSkipped !== undefined ? controller.seekSkipped : undefined,
        sourceError: paging.sourceError,
        searchError: seek.searchError,
        truncatedAt: scale?.truncated?.shown,
    }), [derived.diagnostics, target.firstSkipped, controller, paging.sourceError, seek.searchError, scale]);

    // The element-click funnel, when the root declares any of the five
    // callbacks — the controller routes a click to the LATEST root's.
    const anyClick = data.onRunClick.type === "some" || data.onEventClick.type === "some"
        || data.onMarkClick.type === "some" || data.onChipClick.type === "some" || data.onCellClick.type === "some";
    const resolvers = useMemo<PlanResolvers>(
        () => ({ onElementClick: anyClick ? controller.elementClick : undefined }),
        [anyClick, controller]);
    // What every row of this render shares (#616: per-row facts are computed
    // from it, and each row's memo skips unless ITS facts moved).
    const rowCtx = useMemo<PlanRowContext>(() => ({
        styles, gridTemplate, dense, storageKey, index, derived,
        dispatch: controller.dispatch, chartsExpanded, focusCtx, heightCtx, linkFamily, linkedKeys,
        canExpand, expandBody, expandGutterBody, partial: transport?.partial, review, rowDrop,
    }), [styles, gridTemplate, dense, storageKey, index, derived, controller, chartsExpanded,
        focusCtx, heightCtx, linkFamily, linkedKeys, canExpand, expandBody, expandGutterBody, transport, review, rowDrop]);

    // The resolution segment is a TIME-axis affordance; the now instant rides
    // whichever arm the axis declares.
    const resolutions = useMemo(() => axisResolutions(data.axis), [data.axis]);
    const now = useMemo(() => axisNow(data.axis), [data.axis]);

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
    // while a window is in flight, and Home / End until the source's own
    // first / last element is resident.
    const navEdges = useMemo<PlanNavEdges>(() => ({
        loading: paging.loading,
        atStart: !paged || (paging.head === undefined && paging.resident?.from === 0),
        atEnd: !paged || (paging.tail === undefined && paging.resident !== undefined
            && paging.total !== undefined && paging.resident.to >= paging.total),
    }), [paged, paging.loading, paging.head, paging.tail, paging.resident, paging.total]);
    // A keyboard move onto a band waits — on the band, or on the item it set
    // out from when the demand took the band away — for the rows, then goes
    // on to the row it was headed for (`resolveNavIntent`).
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

    // A source that cannot be READ no longer replaces the canvas (#811): its
    // windows fail one by one, each as its own band with the reason and a
    // Retry. A missing WINDOW is the one thing no row can be placed without.
    if (scale === undefined) {
        return (
            <Box css={styles.diagnostic} data-plan-empty>
                {paged
                    ? "NO WINDOW — a paged plan must declare an axis window or bind a slice range"
                    : axisKind === "number"
                        ? "NO WINDOW — give the plan an axis window, a bound slice range, or numbered rows"
                        : axisKind === "ordinal"
                            ? "NO WINDOW — an ordinal axis needs at least one declared value"
                            : "NO WINDOW — give the plan an axis window, a bound slice range, or dated rows"}
            </Box>
        );
    }

    const header = (
        <PlanHeader styles={styles} gridTemplate={gridTemplate} headerRef={headerRef} chrome={chrome}
            slice={slice} affordances={affordances} resolution={scale.resolution ?? ""} resolutions={resolutions}
            grain={hasRootGroup ? grain : undefined}
            transport={transport} search={search} pick={pick} diagnostics={diagnostics} now={now}
            // The ruler's gutter caption is the active grain's name (the §1 mock).
            rulerCaption={grain.toUpperCase()} cursorChipRef={cursorChipRef}
            reviewLabel={review?.columnLabel}
            pinned={pinned.map((v) => (
                <Box key={v.row.key} background="bg.surface">{renderPlanRow(v, rowCtx)}</Box>
            ))}
            pinnedId={pinned.length > 0 ? pinnedId : undefined}
            focus={view.focus}
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
                // scroll reports after. The demand may take the band away (its
                // windows in flight now, with no band standing for them):
                // focus then stays where it is until the rows land.
                controller.reportViewport(move.demand, false);
                const p = controller.getSnapshot().paging;
                const stays = (move.demand.kind === "band" && move.demand.at === "head" ? p.head : p.tail) !== undefined;
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
    // the popover, the row's selection, the author's element callback.
    const activateElement = (el: HTMLElement) => {
        const ref = refOfElement(el);
        if (ref === undefined) return;
        overlayHandlers.openAt(el);
        controller.dispatch({ t: "row.select", key: ref.value.row });
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
        // A widget of the row: an element, a control, a review button.
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
                activateElement(widget);
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

    const canvas = (
        <PlanControllerContext.Provider value={controller}>
        <PlanGeometryContext.Provider value={geometry}>
        <PlanScaleContext.Provider value={scale}>
        <PlanDispatchContext.Provider value={controller.dispatch}>
        <PlanCursorContext.Provider value={cursor}>
        <PlanResolversContext.Provider value={resolvers}>
        <PlanGridContext.Provider value={gridCtx}>
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
                // The bound lives HERE, not on the frame — the attribute is
                // the contract (jsdom resolves no Chakra classes).
                data-plan-bounded={frameFills ? "" : undefined}
                // The narrow layout is in charge (the footer wraps, etc.).
                data-plan-narrow={narrow ? "" : undefined}
                // Every derived number in this body is over a prefix.
                data-plan-partial={transport?.partial === true ? "" : undefined}
                // The geometry as CSS variables — every height the recipe
                // draws that the model also computes reads one of these.
                style={geometryStyle}
                {...(frameFills && { display: "flex", flexDirection: "column", minHeight: 0, height, maxHeight })}
                onKeyDown={onKeyDown}
                onClickCapture={overlayHandlers.onClickCapture}
                onPointerOver={overlayHandlers.onPointerOver}
                onPointerOut={overlayHandlers.onPointerOut}
            >
                {narrow ? (
                    <PlanNarrow
                        styles={styles} index={index} derived={derived} view={view}
                        dense={dense} storageKey={storageKey}
                        slice={slice} affordances={affordances}
                        resolution={scale.resolution ?? ""} resolutions={resolutions}
                        transport={transport} footer={data.footer} review={review}
                        expandBody={expandBody} expandGutterBody={expandGutterBody}
                        canExpand={canExpand} partial={transport?.partial} fill={frameFills}
                        diagnostics={diagnostics} failures={paging.failures} onRetry={controller.retry}
                        paging={narrowPaging}
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
                            "aria-label": "Plan",
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
                        footer={<PlanFooter styles={styles} items={data.footer} transport={transport} />}
                        // R1 ribbons — the K8 vocabulary over the gathered
                        // family (ribbons need width — never on the narrow
                        // layout). They are their own part (#811): a throw
                        // while laying them out loses the ribbons, not the
                        // canvas. `null` without a links focus, never
                        // omitted: the rows' box stays put, so no row
                        // remounts as the ribbons come and go.
                        overlay={ribbonRows !== undefined && focusVisibleKeys !== undefined ? (
                            <PlanPartBoundary part="links layer" resetKey={focusVisibleKeys} styles={styles}>
                                <LinksOverlay styles={styles} links={data.links} visibleKeys={focusVisibleKeys}
                                    body={ribbonRows} beyond={beyond} scale={scale} runDates={runDates}
                                    gutterPx={gutterW}
                                    trailingPx={review !== undefined ? pxOf(DECISION_WIDTH) ?? 0 : 0}
                                    frame={frameFills ? frameRefs : undefined} />
                            </PlanPartBoundary>
                        ) : null}
                        count={body.items.length}
                        // Heights move at a constant count — a chart toggle, a
                        // focus stripping every other row, a band landing as
                        // rows — and the frame re-measures from these alone.
                        sizes={body.heights}
                        getItemKey={body.itemKey}
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
                                    return <WindowBand band={item.band} styles={styles} loading={paging.loading} />;
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
                {/* The batch foot sits OUTSIDE the scrolling grid so it stays
                    full-width under the canvas (the shared convention). */}
                {review !== undefined && <ReviewFoot controller={review} storageKey={storageKey} />}
                <PlanOverlays anchors={anchors} styles={styles} storageKey={storageKey} />
                <PlanAnnouncer />
            </Box>
        </PlanGridContext.Provider>
        </PlanResolversContext.Provider>
        </PlanCursorContext.Provider>
        </PlanDispatchContext.Provider>
        </PlanScaleContext.Provider>
        </PlanGeometryContext.Provider>
        </PlanControllerContext.Provider>
    );

    const densityTag = style !== undefined ? getSomeorUndefined(style.density)?.type : undefined;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{canvas}</DensityProvider>
        : canvas;
}, (prev, next) => planRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
