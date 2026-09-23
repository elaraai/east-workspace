/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraPlan` — the temporally-aligned composite canvas (`Plan Spec.md`
 * §6): decode, the one shared scale, the one pure state machine, shell
 * composition (toolbar / horizon brush / ruler / rows / footer) and the
 * effect runner.
 *
 * Slice integration is the Table adopter pattern, chrome-only: the rows are
 * whatever the host fed (`Slice.rows` upstream) — the Plan never narrows its
 * own data. The listed affordances mount through the shared
 * `SliceRailCluster`; `brush` mounts as the 32px horizon band, `resolution`
 * as the WEEK/DAY segment, `summary` as the toolbar count line. Beyond Table
 * (the §3 contract), the slice's `range` / `resolution` STATE is the window /
 * resolution source of truth — the axis seeds the unbound case — and the
 * brush / segment write back through `setRange` / `setResolution`.
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
 * events and the component's dispatches are a closed loop (#569).
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { equalFor, equivalentFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Plan, Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { parseCssSize } from "../../style/parse-size.js";
import { DensityProvider } from "../../contracts/density.js";
import { useContainerBelow } from "../../contracts/adaptive.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity.js";
import { useDataStable } from "../../hooks/useDataStable.js";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { boundRangeDomain } from "../../platform/slice/index.js";
import { VirtualRows } from "../virtual-rows.js";
import { PlanScaleContext, PlanDispatchContext, PlanCursorContext, PlanResolversContext, type PlanCursor, type PlanResolvers, type PlanElementRefValue } from "./context.js";
import { PLAN_PAGE_SIZE, usePlanPaging } from "./use-plan-paging.js";
import { usePlanSeek } from "./use-seek.js";
import { useElementHeight } from "./use-element-height.js";
import { WindowBand, WindowFailureBand } from "./rows/WindowBand.js";
import { PlanPartBoundary } from "./rows/PartBoundary.js";
import { resolutionInterval, type PlanResolution, type PlanScale } from "./scale.js";
import { axisNow, axisResolutions, ordinalIndexOf, rangeArmOf, rangeOf, resolveScale, scaleReadsRows, sliceWindowOf } from "./axis.js";
import type { PlanInstantValue } from "./instant.js";
import {
    initialPlanStore, planStoreReducer,
    type PlanEffect, type PlanEvent,
} from "./plan-state.js";
import {
    GAP_H, bodyItemKey, derivePlan, deriveLinkFamily, elideForFocus, firstDiagnosticItem, indexRows, linkedRowKeys,
    pinnedRows, placeFailures, pxOf, rowHeight, visibleRows, windowRestHeight,
    type FocusGap, type PlanBodyItem, type PlanFocusCtx, type PlanRootValue, type PlanRowValue, type VisibleRow,
} from "./model.js";
import { appendAll } from "./reductions.js";
import { EastChakraComponent } from "../../component.js";
import { useDragTarget, type DragEventValue } from "../../dnd/drag-layer";
import { type CanDropFn } from "../../dnd/ir-can-drop";
import { type PlanRowDrop } from "./rows/RowShell.js";
import { PlanBodyRow } from "./rows/BodyRow.js";
import { PlanNarrow, PLAN_NARROW_BELOW, type PlanNarrowPaging } from "./narrow/index.js";
import { PlanToolbar } from "./shell/Toolbar.js";
import { HorizonBrush } from "./shell/HorizonBrush.js";
import { FocusBar } from "./shell/FocusBar.js";
import { LinksOverlay } from "./shell/LinksOverlay.js";
import { PlanRuler, chipAnchor } from "./shell/Ruler.js";
import { PlanFooter } from "./shell/Footer.js";
import { hasDiagnostics, type PlanDiagnostics } from "./shell/Diagnostics.js";
import {
    usePlanReview, PlanDecisionHeader, DECISION_WIDTH,
} from "./shell/Review.js";
import { ReviewFoot } from "../shared/review.js";
import { type PlanTransport } from "./shell/transport.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

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
/** Default height of the R2 developer-render region when a row declares none. */
const EXPAND_DEFAULT_PX = 240;
/** The render never clamps below this — a region too short to hold anything
 *  is worse than one that scrolls. */
const EXPAND_FLOOR_PX = 88;
/** An UNBOUNDED canvas with at least this many body items mounts only what
 *  its scrolling ancestor shows (#812). Below it every row renders, so
 *  content-sized examples and captures keep their full render. */
const VIRTUALIZE_UNBOUNDED_AT = 400;
/** The rows a scale with a stated window is resolved over — none (#812). */
const NO_ROWS: readonly PlanRowValue[] = [];

/** Where a bounded canvas's scroll rests (#813) — a row, never pixels. */
interface PlanAnchor {
    /** The first body item showing under the header (its `bodyItemKey`). */
    key: string;
    /** How many px of it are scrolled past. */
    offset: number;
    /** Its body index — the clamped fallback when the key is gone. */
    index: number;
    /** The source window its row came from, on a paged canvas — where a
     *  remount that has not loaded the row yet looks for it. */
    window: number | null;
}

/** What the canvas persists under its `storageKey` (#813) — the user's own
 *  toggles and place, never the selection. */
interface PlanPersisted {
    /** The collapse of each row the user toggled (`true` = collapsed). */
    collapse: Array<[string, boolean]>;
    /** The chart rows the user expanded. */
    charts: string[];
    /** Where the scroll rests, once the user has scrolled a bounded frame. */
    anchor: PlanAnchor | null;
}

const NOT_PERSISTED: PlanPersisted = { collapse: [], charts: [], anchor: null };

/**
 * The persisted state, read defensively: storage outlives versions and anyone
 * can write it, so each part is taken only in the shape this version writes
 * and dropped otherwise — never trusted into the store.
 */
function persistedOf(stored: unknown): PlanPersisted {
    if (typeof stored !== "object" || stored === null) return NOT_PERSISTED;
    const { collapse, charts, anchor } = stored as Partial<Record<keyof PlanPersisted, unknown>>;
    const okCollapse = Array.isArray(collapse) && collapse.every((e) =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && typeof e[1] === "boolean");
    const okCharts = Array.isArray(charts) && charts.every((k) => typeof k === "string");
    const a = anchor as Partial<PlanAnchor> | null | undefined;
    const okAnchor = typeof a === "object" && a !== null && typeof a.key === "string"
        && Number.isFinite(a.offset) && Number.isInteger(a.index)
        && (a.window === null || Number.isInteger(a.window));
    return {
        collapse: okCollapse ? collapse as Array<[string, boolean]> : [],
        charts: okCharts ? charts as string[] : [],
        anchor: okAnchor ? a as PlanAnchor : null,
    };
}

/** Whether two lists hold the same entries in the same order. */
function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
    return a.length === b.length && a.every((x, i) => same(x, b[i]!));
}
const sameToggle = (x: readonly [string, boolean], y: readonly [string, boolean]) => x[0] === y[0] && x[1] === y[1];
const sameKey = (x: string, y: string) => x === y;
const sameAnchor = (x: PlanAnchor | null, y: PlanAnchor) => x !== null
    && x.key === y.key && x.offset === y.offset && x.index === y.index && x.window === y.window;

export interface EastChakraPlanProps {
    /** The Plan root value. */
    value: PlanRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
}

/** Renders an East Plan value — the composite temporal canvas. */
export const EastChakraPlan = memo(function EastChakraPlan({ value, storageKey }: EastChakraPlanProps) {
    // Changes identity on a DATA change only — read data fields through it,
    // callbacks through `value` (#809).
    const data = useDataStable(value, planRootDataEqual);
    // ── The rows channel: inline rows, or the derived paged source (§3.8)
    //    streamed in as a contiguous prefix by the loader hook. ──────────────
    const pagedSource = value.rows.type === "paged" ? value.rows.value : undefined;
    // Declared style facts, hoisted above the paging hook because the window
    // measure consumes them (the recipe section below reads them too). Both
    // are value-derived and UI-state-independent — which is exactly what makes
    // the measure canonical.
    const dense = getSomeorUndefined(getSomeorUndefined(value.style)?.density)?.type === "compact";
    const initGrain = getSomeorUndefined(value.grain)?.type ?? "resource";
    // The axis KIND (#631) — every window read below speaks its slice arm,
    // and a row whose instants ride another arm is a diagnostic row (#811).
    const axisKind = data.axis.type;
    // The ledger's window height (#613): the height the window renders AT
    // REST — declared collapse applied, chart expansion at its declared
    // state, no focus context, pinned rows excluded, diagnostic rows at their
    // own height. The ledger freezes a window's first measurement and seeds
    // its frozen slot rate from the very first one, so the recorded number
    // must not depend on transient UI state — a window landing during an
    // expand focus must not record strip-compressed rows.
    const heightOf = useCallback(
        (rows: readonly PlanRowValue[]) => windowRestHeight(rows, initGrain, dense, axisKind),
        [initGrain, dense, axisKind]);
    const paging = usePlanPaging(pagedSource, { heightOf });
    // The inline arm is the canvas's KEYED collection (#568) — decoded as a
    // SortedMap, so its values are already in canonical key order.
    const rows = useMemo(
        () => (data.rows.type === "inline" ? [...data.rows.value.values()] : paging.rows),
        [data.rows, paging.rows],
    );
    // What the chrome tells the truth with (#567 D9). Counted in ELEMENTS —
    // the number `total()` reports — never canvas rows, since a series can emit
    // any number of rows per element. `partial` is what every derived number
    // (rollup bands, group counts, strip summaries) is qualified by: they are
    // computed over the loaded prefix until the source is exhausted.
    const transport = useMemo<PlanTransport | undefined>(() => {
        if (pagedSource === undefined) return undefined;
        const from = paging.resident?.from ?? 0;
        const to = paging.resident?.to ?? 0;
        return {
            loaded: paging.resident?.elements ?? 0,
            from,
            to,
            total: paging.total,
            loading: paging.loading,
            partial: paging.total === undefined || (paging.resident?.elements ?? 0) < paging.total,
        };
    }, [pagedSource, paging.resident, paging.total, paging.loading]);
    // Key search over the source (`search` becomes seek — #567 D9's affordance
    // table). A jump asks the driver to rebase on the matched ELEMENT; the
    // canvas then positions by key, since a leaf row's key IS its data key.
    const { search, targetKey, searchError } = usePlanSeek(pagedSource, rows, paging.jumpToElement, paging.clearJump);

    // ── Review chrome (#569) — ACTIONS only. The verdict is not held here:
    //    it lives wherever the author's callback wrote it and arrives back as
    //    each row's `approval`, so the buttons and the canvas cannot disagree.
    const review = usePlanReview(useMemo(() => getSomeorUndefined(value.review), [value.review]));

    // ── Slice chrome (the Table adopter pattern; chrome-only) ─────────────
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const slice = chrome !== undefined ? (chrome.slice as SliceBindValue) : undefined;
    useSliceReactivity(slice?.key);
    const affordances = useMemo(
        () => (chrome !== undefined ? chrome.affordances.map((a: { type: string }) => a.type) : []),
        [chrome],
    );
    const sliceState = slice !== undefined ? slice.read() : undefined;

    // ── The series library (#590) — chrome, like the slice rail. The Plan
    //    feeds ITSELF the picked series (the factory swapped `series` for
    //    `Pick.active`), so all that is left here is mounting the panel. The
    //    noun is not configurable: a Plan's pickable things are series.
    const pick = useMemo(() => getSomeorUndefined(value.pick), [value.pick]);

    // ── Window + resolution: slice state ▸ axis ▸ fit-to-data (§3/§8) ─────
    // Keyed on the DOMAIN NUMBERS, never on the range object. `slice.read()`
    // decodes fresh state on every render, so `sliceState.range` has a new
    // identity each time even when the window has not moved. Keying the memo
    // on that identity rebuilt the scale (up to MAX_PLAN_BUCKETS buckets, each
    // with a formatted label), which published a new PlanScale to every row —
    // busting `edges`, `resolveCoord`, `dropVeto` and so the drop cell's own
    // ref callback, so React detached and re-attached every registered cell
    // on every render of a slice-bound canvas.
    const sliceWin = sliceWindowOf(sliceState, axisKind);
    const sliceFromN = sliceWin?.[0];
    const sliceToN = sliceWin?.[1];
    const sliceResolution = sliceState !== undefined
        ? getSomeorUndefined(sliceState.resolution)?.type
        : undefined;
    // `resolveScale` owns the ladder: the slice's range ▸ the declared window
    // ▸ fit-to-data (a PAGED canvas must declare — #567 D8), per axis kind.
    // The rows are an input only when the window is fitted to them: a stated
    // window keeps one scale while windows land, rather than handing every
    // mounted row a new one (#812).
    const fitRows = scaleReadsRows(data.axis, sliceWin, pagedSource !== undefined) ? rows : NO_ROWS;
    const scale: PlanScale | undefined = useMemo(() => resolveScale({
        axis: data.axis,
        sliceWindow: sliceFromN === undefined || sliceToN === undefined ? undefined : [sliceFromN, sliceToN],
        sliceResolution,
        rows: fitRows,
        paged: pagedSource !== undefined,
    }), [data.axis, sliceFromN, sliceToN, sliceResolution, fitRows, pagedSource]);

    // ── The one state machine ─────────────────────────────────────────────
    const index = useMemo(() => indexRows(rows), [rows]);
    // An ordinal axis orders its instants by the declared list — the
    // derivations sort cells by it (nothing else needs it).
    const ordinalIndex = useMemo(() => ordinalIndexOf(data.axis), [data.axis]);
    // Renderer-side derivations (§4.2 — the Table idiom): the IR declares
    // rollups / aggregates / summaries; the numbers are computed here. The
    // Planner's single-axis-kind rule (#631) rides along: a row whose
    // instants ride another arm is a DIAGNOSTIC row (#811) — it renders in
    // place with the arm it carries, derives nothing, and the rest of the
    // canvas draws. (One such row used to replace the whole canvas.)
    const derived = useMemo(() => derivePlan(index, ordinalIndex, axisKind), [index, ordinalIndex, axisKind]);
    // The R1 link graph — rows an edge touches grow the `links` control.
    const linkedKeys = useMemo(() => linkedRowKeys(data.links), [data.links]);
    // A run's instants by (row, run) — the overlay's off-window resolution.
    const runDates = useCallback((rowKey: string, runKey: string): { start: PlanInstantValue; end: PlanInstantValue } | undefined => {
        const row = index.byKey.get(rowKey);
        if (row === undefined || row.kind.type !== "span") return undefined;
        const r = row.kind.value.runs.find((x) => x.key === runKey);
        return r !== undefined ? { start: r.start, end: r.end } : undefined;
    }, [index]);
    // ── What survives a remount (#813) ────────────────────────────────────
    // Under the canvas's `storageKey`: the user's collapse toggles, the charts
    // they expanded, and where a bounded frame's scroll rests. Never the
    // selection — a transient act, and restoring it would re-fire `onSelect`.
    // Nor the resolution: only a bound slice can change it (the segment has
    // nowhere to write without one — #615), and the slice keeps its own.
    const { state: stored, setState: setStored } = usePersistedState<PlanPersisted>(storageKey, NOT_PERSISTED);
    // THE state machine — one `useReducer(planStoreReducer)` (#610). The
    // reducer needs no scale context: the hover cursor — its one former
    // consumer — is DOM chrome now (#609), so the machine is scale-free. It
    // starts from the user's persisted toggles; the declaration seeds only
    // the rows they never touched.
    const [store, dispatchStore] = useReducer(
        planStoreReducer, undefined,
        () => initialPlanStore(initGrain, index.initiallyCollapsed, persistedOf(stored)));
    const ui = store.ui;
    // A host data commit RECONCILES the ephemeral UI state instead of
    // resetting it (#610): entries whose rows vanished drop, never-seen
    // declared collapse seeds once, and everything the user set survives —
    // an Approve click changes the verdict presentation and nothing else. A
    // paged source's resident rows are not all its rows, so its key set says
    // nothing is gone (#813) — a toggle on an unlanded row waits for it.
    useEffect(() => {
        dispatchStore({
            t: "reconcile",
            alive: new Set(index.byKey.keys()),
            complete: pagedSource === undefined,
            declaredCollapsed: index.initiallyCollapsed,
            declaredGrain: initGrain,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reconcile fires on the value's DATA identity; the index it prunes against is read fresh
    }, [data]);
    // The user's toggles, persisted as they change — reconcile's pruning
    // included, so a row that is gone stops being carried (#813).
    useEffect(() => {
        const collapse = [...store.overrides];
        const charts = [...store.ui.chartsExpanded];
        setStored((prev) => {
            const p = persistedOf(prev);
            return sameList(p.collapse, collapse, sameToggle) && sameList(p.charts, charts, sameKey)
                ? prev
                : { ...p, collapse, charts };
        });
    }, [store.overrides, store.ui.chartsExpanded, setStored]);

    // Rows that arrive WITHOUT a data change — a paged canvas streams its
    // windows in against an unchanging `value` — carry their own declared
    // collapse. Seed each declared key ONCE, the first time its row appears,
    // and drop nothing: eviction must not erase state the user still owns,
    // and a group the user has since opened stays open when the next window
    // lands.
    useEffect(() => {
        dispatchStore({ t: "seed", declaredCollapsed: index.initiallyCollapsed });
    }, [index]);

    // Row focus (R1 links / R2 expand) — family closure + height context.
    const linkFamily = useMemo(
        () => (ui.focus?.kind === "links" ? deriveLinkFamily(data.links, ui.focus.key) : undefined),
        [ui.focus, data.links],
    );
    const focusVisibleKeys = useMemo(
        () => (ui.focus !== null && linkFamily !== undefined
            ? new Set([...linkFamily.all, ui.focus.key])
            : undefined),
        [ui.focus, linkFamily],
    );
    const focusCtx = useMemo<PlanFocusCtx | undefined>(() => {
        if (ui.focus === null) return undefined;
        return ui.focus.kind === "links"
            ? { kind: "links", key: ui.focus.key, family: linkFamily?.all }
            : { kind: "expand", key: ui.focus.key };
    }, [ui.focus, linkFamily]);
    // The focused expand row's developer render — the ROOT's `expandRender`
    // resolver called with the row ref (rows only DECLARE `{ height, axis }`),
    // evaluated once per focus.
    const expandRenderFn = useMemo(() => getSomeorUndefined(value.expandRender), [value.expandRender]);
    const expandGutterFn = useMemo(() => getSomeorUndefined(value.expandGutter), [value.expandGutter]);
    const expandBody = useMemo(() => {
        if (ui.focus?.kind !== "expand" || expandRenderFn === undefined) return null;
        try {
            return expandRenderFn({ key: ui.focus.key });
        } catch (err) {
            console.error("[Plan] expandRender resolver failed:", err);
            return null;
        }
    }, [ui.focus, expandRenderFn]);
    const expandGutterBody = useMemo(() => {
        if (ui.focus?.kind !== "expand" || expandGutterFn === undefined) return null;
        try {
            return expandGutterFn({ key: ui.focus.key });
        } catch (err) {
            console.error("[Plan] expandGutter resolver failed:", err);
            return null;
        }
    }, [ui.focus, expandGutterFn]);
    // The element-click callbacks (#569) — one funnel, routed by the clicked
    // ref's own tag. The click payloads ARE the element-ref arms (types.ts),
    // so nothing is re-encoded; `queueMicrotask` per the mandatory pattern.
    const onRunClickFn = useMemo(() => getSomeorUndefined(value.onRunClick), [value.onRunClick]);
    const onEventClickFn = useMemo(() => getSomeorUndefined(value.onEventClick), [value.onEventClick]);
    const onMarkClickFn = useMemo(() => getSomeorUndefined(value.onMarkClick), [value.onMarkClick]);
    const onChipClickFn = useMemo(() => getSomeorUndefined(value.onChipClick), [value.onChipClick]);
    const onCellClickFn = useMemo(() => getSomeorUndefined(value.onCellClick), [value.onCellClick]);
    const onElementClick = useMemo(() => {
        if (onRunClickFn === undefined && onEventClickFn === undefined && onMarkClickFn === undefined
            && onChipClickFn === undefined && onCellClickFn === undefined) return undefined;
        return (ref: PlanElementRefValue) => {
            switch (ref.type) {
                case "run": if (onRunClickFn) queueMicrotask(() => onRunClickFn(ref.value)); break;
                case "event": if (onEventClickFn) queueMicrotask(() => onEventClickFn(ref.value)); break;
                case "mark": if (onMarkClickFn) queueMicrotask(() => onMarkClickFn(ref.value)); break;
                case "chip": if (onChipClickFn) queueMicrotask(() => onChipClickFn(ref.value)); break;
                case "cell": if (onCellClickFn) queueMicrotask(() => onCellClickFn(ref.value)); break;
            }
        };
    }, [onRunClickFn, onEventClickFn, onMarkClickFn, onChipClickFn, onCellClickFn]);
    // The generalized element resolvers (popover / hover) + the click funnel —
    // threaded to the row renderers; elements invoke them lazily at
    // interaction time.
    const resolvers = useMemo<PlanResolvers>(() => ({
        popover: getSomeorUndefined(value.popover),
        hover: getSomeorUndefined(value.hover),
        onElementClick,
    }), [value.popover, value.hover, onElementClick]);

    // Host callbacks (behavior props — queueMicrotask per the mandatory pattern).
    const onSelect = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onGroupToggle = useMemo(() => getSomeorUndefined(value.onGroupToggle), [value.onGroupToggle]);
    const onGrainChange = useMemo(() => getSomeorUndefined(value.onGrainChange), [value.onGrainChange]);

    // ── DnD target role ───────────────────────────────────────────────────
    // The canvas is a drag TARGET: library cards land on a row at an instant.
    // Rows register their own cells (`RowShell`); this registers the surface
    // those cells name and funnels every completed drag to the host.
    //
    // A target needs BOTH an `id` (cells are addressed `surface × row × slot`,
    // and an unnamed surface cannot be addressed) and an `onDrag` (a drop with
    // nowhere to report is a gesture that silently loses work). Missing either
    // ⇒ no registration at all, so no row lights up and no drag can complete
    // against a canvas that cannot act on it.
    const onDragFn = useMemo(() => getSomeorUndefined(value.onDrag), [value.onDrag]);
    const canDropFn = useMemo(
        () => getSomeorUndefined(value.canDrop) as CanDropFn | undefined,
        [value.canDrop],
    );
    const dropEligible = onDragFn !== undefined && value.id !== "";
    const handleDrop = useCallback((event: DragEventValue) => {
        // No optimistic row is synthesized. The Gantt can invent a proposed
        // bar because its rows ARE its tasks; a Plan's rows are derived from
        // `data` through the series pipeline, so the honest flow is the one
        // the grammar documents — the host commits, the data changes, the
        // rows re-derive. Painting a speculative run here would put a row on
        // screen that no series produced.
        if (onDragFn !== undefined) queueMicrotask(() => onDragFn(event));
    }, [onDragFn]);
    const targetConfig = useMemo(() => (dropEligible ? {
        id: value.id,
        sources: [...data.sources],
        // `add` only. `move` / `resize` need a drag to START on the canvas —
        // a draggable run bar or chip — and nothing here begins one, so
        // declaring them would advertise a capability with no gesture behind it.
        kinds: { add: true },
        onDrag: handleDrop,
    } : null), [dropEligible, value.id, data.sources, handleDrop]);
    useDragTarget(targetConfig);
    // One config shared by every droppable row — the per-row part of the
    // coordinate is the row itself, which `RowShell` already knows.
    const rowDrop = useMemo<PlanRowDrop | undefined>(
        () => (dropEligible ? { surface: value.id, canDrop: canDropFn } : undefined),
        [dropEligible, value.id, canDropFn],
    );

    // Every window WRITE goes through here (#631): the instants land on the
    // slice as the arm the axis speaks — `datetime` on a time axis, the
    // field's `float` / `integer` on a number axis, and nothing at all on an
    // ordinal one, whose list is its window (the keys and the pan idle there
    // exactly as they idle on an unbound canvas).
    const writeWindow = useCallback((min: PlanInstantValue, max: PlanInstantValue) => {
        if (slice === undefined || scale === undefined) return;
        const arm = rangeArmOf(scale.kind, slice.read(), boundRangeDomain(slice.key)?.kind);
        if (arm === undefined) return;
        slice.setRange(some(rangeOf(arm, min, max)));
    }, [slice, scale]);
    const runEffects = useCallback((effects: readonly PlanEffect[]) => {
        for (const eff of effects) {
            switch (eff.t) {
                case "slice.setRange":
                    writeWindow(eff.min, eff.max);
                    break;
                case "slice.clearRange":
                    if (slice !== undefined) slice.setRange(none);
                    break;
                case "slice.setResolution":
                    // A resolution is a TIME-axis fact — the segment only mounts
                    // there (a number axis has `step`; an ordinal list no unit).
                    if (slice !== undefined && scale !== undefined && scale.kind === "time"
                        && scale.window.min.type === "time") {
                        slice.setResolution(some(variant(eff.resolution, null) as never));
                        // Zoom to the new resolution: preserve the CURRENT
                        // column count (12 weeks showing → DAY shows 12 days),
                        // anchored at the window start on the new period edges
                        // — a same-width window would cram unusable columns.
                        const interval = resolutionInterval(eff.resolution as PlanResolution);
                        const min = interval.floor(scale.window.min.value);
                        const max = interval.offset(min, scale.n);
                        slice.setRange(some(variant("datetime", { from: min, to: max })));
                    }
                    break;
                case "emit.select":
                    if (onSelect) queueMicrotask(() => onSelect({ key: eff.key }));
                    break;
                case "emit.groupToggle":
                    if (onGroupToggle) queueMicrotask(() => onGroupToggle({ row: eff.key, expanded: eff.expanded }));
                    break;
                case "emit.grainChange":
                    if (onGrainChange) queueMicrotask(() => onGrainChange(variant(eff.grain, null)));
                    break;
                case "scroll.toNow": {
                    // The now instant is an AXIS fact, so reaching it means
                    // moving the WINDOW — which is slice state (the #567
                    // sweep's call: these are `slice.setRange` writes, not
                    // virtualizer calls). An unbound canvas has no writable
                    // window, so the rung idles there, exactly like the
                    // resolution segment (#615).
                    if (slice === undefined || scale === undefined) break;
                    const nowInstant = axisNow(data.axis);
                    if (nowInstant === undefined) break;
                    // Re-derive the window on period edges with the SAME
                    // column count, now a third of the way in (ahead is where
                    // the plan lives) — the resolution-zoom precedent above:
                    // snap + `n` periods on the scale's own domain, never ms
                    // arithmetic.
                    const from = scale.offset(scale.floor(nowInstant), -Math.floor(scale.n / 3));
                    writeWindow(from, scale.offset(from, scale.n));
                    break;
                }
                case "pan": {
                    if (slice === undefined || scale === undefined) break;
                    writeWindow(scale.offset(scale.window.min, eff.buckets), scale.offset(scale.window.max, eff.buckets));
                    break;
                }
            }
        }
    }, [slice, scale, data.axis, writeWindow, onSelect, onGroupToggle, onGrainChange]);

    const dispatch = useCallback((e: PlanEvent) => dispatchStore({ t: "event", e }), []);
    // The store's effect batch, drained EXACTLY ONCE per bump — post-commit
    // but before paint, so a slice write lands in the same visual frame its
    // event did. (Brush PREVIEWS no longer ride this: they change no machine
    // state, so the HorizonBrush writes them directly, frame-coalesced —
    // #609.) The seq gate is a ref so a re-created `runEffects` (new slice /
    // scale identity) cannot re-fire an already-drained batch.
    const drainedFx = useRef(0);
    useLayoutEffect(() => {
        if (store.fxSeq === drainedFx.current) return;
        drainedFx.current = store.fxSeq;
        runEffects(store.fx);
    }, [store.fxSeq, store.fx, runEffects]);

    // The focus overlay's positioning parent (the canvas body wrapper).
    const focusBodyRef = useRef<HTMLDivElement | null>(null);
    // The narrow layout (§10, #570): below the adaptive contract's compact
    // width the Plan is a review tool — cards and tabs, not a canvas. The
    // signal is the CONTAINER the body renders in (a splitter pane, a task
    // preview, a phone all qualify), never the viewport.
    const narrow = useContainerBelow(focusBodyRef, PLAN_NARROW_BELOW);
    // The virtualizer's scroll viewport — the only element that knows how much
    // canvas there actually is, which the R2 clamp measures.
    const scrollElRef = useRef<HTMLDivElement | null>(null);
    // The sticky chrome (toolbar / brush / ruler / pinned rows / focus bar).
    // It sits INSIDE the scroll viewport, so the clamp has to take it off the
    // top. Measured rather than summed from constants — the chrome is
    // conditional in five places and a hand-kept total would drift — and
    // WATCHED rather than measured once (#812): the focus bar mounts with the
    // very focus that asks for the clamp, and the toolbar can wrap at any
    // width, so a height read when the header mounted is wrong by the time
    // the clamp uses it.
    const headerRef = useRef<HTMLDivElement | null>(null);
    // Entering a row focus can swap the body tree (R2 unmounts the clicked
    // control), dropping browser focus to <body> and killing the esc rung —
    // re-anchor keyboard focus on the canvas surface.
    useEffect(() => {
        if (ui.focus !== null) focusBodyRef.current?.focus();
    }, [ui.focus]);

    // ── The hover cursor: DIRECT DOM writes, zero renders (#609) ──────────
    // The hairline + ruler chip are display-only chrome, driven the way the
    // landing band is driven: `move` sets ONE CSS variable on the body — every
    // row's hairline positions from `--plan-cursor-x` and shows only under
    // `[data-plan-cursor]` — and writes the chip's label/position directly.
    // Routing this through the reducer committed the ENTIRE canvas once per
    // pointermove, O(mounted rows), unthrottled; now a pointermove renders
    // nothing at all.
    const cursorChipRef = useRef<HTMLDivElement | null>(null);
    const cursor = useMemo<PlanCursor>(() => ({
        move: (frac: number) => {
            const body = focusBodyRef.current;
            if (body === null || scale === undefined) return;
            body.style.setProperty("--plan-cursor-x", String(frac));
            body.setAttribute("data-plan-cursor", "");
            const chip = cursorChipRef.current;
            if (chip !== null) {
                const bi = scale.bucketAtFrac(frac);
                if (bi >= 0) {
                    chip.textContent = scale.buckets[bi]!.label;
                    chip.style.left = `${frac * 100}%`;
                    chip.style.transform = `translate(${chipAnchor(frac)}, -50%)`;
                    chip.style.display = "";
                } else {
                    // A truncated axis's uncovered remainder has no bucket to
                    // name — the hairline still tracks, the readout hides.
                    chip.style.display = "none";
                }
            }
        },
        leave: () => {
            focusBodyRef.current?.removeAttribute("data-plan-cursor");
            const chip = cursorChipRef.current;
            if (chip !== null) chip.style.display = "none";
        },
    }), [scale]);

    // ── Recipe + layout ───────────────────────────────────────────────────
    const recipe = useSlotRecipe({ key: "plan" });
    const styles = useMemo(
        () => recipe({ density: dense ? "dense" : "default" } as Record<string, unknown>) as unknown as Styles,
        [recipe, dense],
    );
    const style = useMemo(() => getSomeorUndefined(data.style), [data.style]);
    // gutterWidth is a CSS px size string (the shared component-height type).
    // `pxOf`, not `parseFloat`: a percentage must fall back to the default,
    // never silently become that many pixels (#615).
    const gutterWDeclared = style !== undefined && style.gutterWidth.type === "some" ? pxOf(style.gutterWidth.value) : undefined;
    const gutterW = gutterWDeclared ?? GUTTER_W;
    const gridTemplate = `${gutterW}px 1fr${review !== undefined ? ` ${DECISION_WIDTH}` : ""}`;
    const height = parseCssSize(style !== undefined ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style !== undefined ? getSomeorUndefined(style.maxHeight) : undefined);
    // A declared bound goes on the WRAPPER and the frame fills the remainder
    // (`fillParent`) — the Board / Roster / Planner / ValueTree discipline.
    // Passing it inward instead leaves a percentage (`"fill"` → `"100%"`)
    // resolving against the auto-height wrapper, which computes to `auto`: the
    // frame reports bounded, renders the spacer, and never scrolls.
    const frameFills = height !== undefined || maxHeight !== undefined;
    const barHeight = dense ? 16 : 20;

    // ── Rows ──────────────────────────────────────────────────────────────
    // Keyed on the ui FIELDS the derivation reads (`grain`, `collapsed`) —
    // never the whole `ui` — so the `VisibleRow` identities hold across
    // selection / chart-toggle / focus-control store changes, which is what
    // lets `PlanBodyRow`'s memo skip unmoved rows (#616).
    const visible = useMemo(
        () => visibleRows(index, ui, focusVisibleKeys),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleRows reads ui.grain + ui.collapsed only; keying on the whole ui would bust every row identity per store change
        [index, ui.grain, ui.collapsed, focusVisibleKeys],
    );
    const pinned = useMemo(() => pinnedRows(index), [index]);
    // R2 — the focused row's own declaration. The row keeps its NORMAL
    // anatomy and height; what grows is the render region BELOW it, which is
    // its own body item (see `bodyItems`) so the whole gesture stays inside
    // the virtualizer and the strips above and below keep their order.
    const expandDecl = focusCtx?.kind === "expand"
        ? getSomeorUndefined(index.byKey.get(focusCtx.key)?.expand)
        : undefined;
    // The v2 clamp — `min(renderHeight, canvas − strips − chrome)`. The canvas
    // is MEASURED, not parsed: `height: "fill"` is `"100%"`, which has no
    // pixel value until layout runs. Unbounded frames have no scroll element
    // and grow to content, so there is nothing to clamp against and the
    // declared height stands. Both readings are live while an expand focus is
    // open on the canvas layout (the narrow cards size their own render).
    const expandActive = ui.focus?.kind === "expand" && !narrow;
    const viewportPx = useElementHeight(scrollElRef, expandActive);
    const headerPx = useElementHeight(headerRef, expandActive);
    // The clamp feeds `focusCtx.renderPx`, which `rowHeight` adds to the focal
    // row — so it must be computed WITHOUT `focusCtx` (which would be
    // circular). Strip heights are constant per row, so summing them needs no
    // focus context: every row but the focus is `STRIP_H`, groups aside.
    const expandRenderPx = useMemo(() => {
        if (expandDecl === undefined) return 0;
        // `pxOf`, not `parseFloat` — a percentage must fall back to the
        // default, never silently become that many pixels (the #615 rule).
        const declared = expandDecl.height.type === "some" ? pxOf(expandDecl.height.value) : undefined;
        const want = declared ?? EXPAND_DEFAULT_PX;
        if (viewportPx === undefined) return want;
        // Everything the render must NOT push out: the strips, the focal row's
        // own band, and the chrome pinned above them.
        const bare = { kind: "expand" as const, key: ui.focus?.key ?? "" };
        const rowsPx = visible.reduce(
            (sum, v) => sum + rowHeight(v, dense, ui.chartsExpanded, bare, derived), 0);
        return Math.max(EXPAND_FLOOR_PX, Math.min(want, viewportPx - rowsPx - (headerPx ?? 0)));
    }, [expandDecl, viewportPx, headerPx, visible, dense, ui.chartsExpanded, ui.focus, derived]);
    // The height context every `rowHeight` call uses. `focusCtx` says WHICH
    // row is focused (that is all `renderVisible` needs); this adds how tall
    // its render is, which only the measurements need — keeping them separate
    // is what lets the clamp be computed after `focusCtx` without the two
    // depending on each other.
    const heightCtx = useMemo<PlanFocusCtx | undefined>(
        () => (focusCtx?.kind === "expand" ? { ...focusCtx, renderPx: expandRenderPx } : focusCtx),
        [focusCtx, expandRenderPx]);
    // R1 at scale — the links-focus body elides runs of unrelated rows into
    // gap bands (a lone straggler keeps its rail; see `elideForFocus`).
    const bodyItems = useMemo<readonly PlanBodyItem[]>(() => {
        const rowItems: PlanBodyItem[] = focusCtx?.kind === "links"
            ? elideForFocus(visible, index, focusCtx)
            : visible.map((row) => ({ kind: "row", row }));
        // A window whose read failed is ONE band where its rows would be
        // (#811) — every other window keeps landing around it.
        const core = placeFailures(rowItems, paging.failures, paging.origin);
        // The unloaded remainder of a paged source, above and below (#577). Each
        // band is sized by the ledger, so the rows that replace it occupy the
        // same space and nothing below moves.
        if (paging.head === undefined && paging.tail === undefined) return core;
        const out: PlanBodyItem[] = [];
        if (paging.head !== undefined) out.push({ kind: "band", band: paging.head });
        appendAll(out, core);
        if (paging.tail !== undefined) out.push({ kind: "band", band: paging.tail });
        return out;
    }, [focusCtx, visible, index, paging.failures, paging.origin, paging.head, paging.tail]);
    // The exact height of every body item — the virtualizer's sizes AND what
    // each item renders at (`RowShell` pins the same `rowHeight`, the bands
    // their own px). The list is the height SIGNATURE (#812): a row's kind,
    // the density, a chart's toggle, a focus and the expand clamp all reach
    // it, so any of them changing a height re-measures the frame — and a
    // selection, which reaches none of its inputs, re-measures nothing.
    const heights = useMemo(() => bodyItems.map((item) => {
        if (item.kind === "gap") return GAP_H;
        if (item.kind === "band") return Math.max(1, item.band.px);
        if (item.kind === "failed") return item.failure.px;
        return rowHeight(item.row, dense, ui.chartsExpanded, heightCtx, derived);
    }), [bodyItems, dense, ui.chartsExpanded, heightCtx, derived]);
    // Each item's identity (#812), so a row keeps its component instance when
    // a collapse, a focus or a landing window moves it.
    const itemKey = useCallback((i: number): string => {
        const item = bodyItems[i];
        return item !== undefined ? bodyItemKey(item) : `i:${i}`;
    }, [bodyItems]);

    // ── The scroll anchor (#813) ──────────────────────────────────────────
    // Persisted as the first item showing under the header — its KEY and how
    // far into it — never as pixels: restored by key it survives the rows
    // above it changing, and a key that is gone falls back to its clamped
    // index. Only a bounded frame scrolls itself; an unbounded canvas's place
    // is its page's, and the narrow list keeps none.
    const [savedAnchor] = useState(() => persistedOf(stored).anchor);
    const [restoreAnchor, setRestoreAnchor] = useState<{ index: number; offset: number } | undefined>(undefined);
    const anchorPhase = useRef<"pending" | "seeking" | "settled">("pending");
    const jumpToElement = paging.jumpToElement;
    useEffect(() => {
        if (anchorPhase.current === "settled") return;
        if (savedAnchor === null || !frameFills || narrow) {
            anchorPhase.current = "settled";
            return;
        }
        if (bodyItems.length === 0) return;
        const at = bodyItems.findIndex((it) => bodyItemKey(it) === savedAnchor.key);
        if (at < 0 && pagedSource !== undefined && savedAnchor.window !== null) {
            // A paged canvas may simply not have loaded the row yet: look in
            // the window it came from before calling it gone.
            const w = savedAnchor.window;
            if (anchorPhase.current === "pending") {
                anchorPhase.current = "seeking";
                jumpToElement(w * PLAN_PAGE_SIZE);
                return;
            }
            const settled = paging.failures.some((f) => f.w === w) || [...paging.origin.values()].includes(w);
            if (!settled) return;
        }
        anchorPhase.current = "settled";
        setRestoreAnchor(at >= 0
            ? { index: at, offset: savedAnchor.offset }
            : { index: Math.min(savedAnchor.index, bodyItems.length - 1), offset: 0 });
    }, [bodyItems, savedAnchor, frameFills, narrow, pagedSource, jumpToElement, paging.failures, paging.origin]);
    const onAnchorChange = useCallback((a: { index: number; offset: number }) => {
        // Nothing is persisted until the saved anchor is restored: the
        // restore's own scroll must not overwrite what it is restoring.
        if (anchorPhase.current !== "settled") return;
        const item = bodyItems[a.index];
        if (item === undefined) return;
        const next: PlanAnchor = {
            key: bodyItemKey(item),
            offset: a.offset,
            index: a.index,
            window: item.kind === "row" ? paging.origin.get(item.row.row.key) ?? null : null,
        };
        setStored((prev) => {
            const p = persistedOf(prev);
            return sameAnchor(p.anchor, next) ? prev : { ...p, anchor: next };
        });
    }, [bodyItems, paging.origin, setStored]);

    // The viewport, in the driver's terms — which ROW (or which band) it sits
    // on. The item under the viewport CENTER when the frame can resolve one
    // (the live scroll offset; inside one huge band item the mounted range
    // cannot say where the thumb is — the center pixel can, #612), else the
    // middle of the mounted range. The driver maps it back to a window; no
    // body-layout knowledge crosses that boundary.
    // Depends on the STABLE `reportViewport` callback, never the whole
    // `paging` object — the hook returns a fresh literal every render, so
    // keying on it re-fired the virtualizer's range effect after every
    // commit rather than on real range changes (#609).
    const reportViewport = paging.reportViewport;
    const reportRange = useCallback((
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
    ) => {
        const mid = Math.floor((range.startIndex + range.endIndex) / 2);
        const item = bodyItems[center?.index ?? mid] ?? bodyItems[range.startIndex];
        if (item === undefined) return;
        if (item.kind === "band") {
            // `withinPx` is measured from the band's own top — the one origin
            // the ledger can place exactly, whatever the resident rows above
            // it rendered at.
            reportViewport(
                { kind: "band", at: item.band.at, px: center?.withinPx },
                isScrolling);
        }
        else if (item.kind === "row") reportViewport({ kind: "row", key: item.row.row.key }, isScrolling);
        // A failed window's band names its own window (#811).
        else if (item.kind === "failed") reportViewport({ kind: "window", w: item.failure.w }, isScrolling);
        // A links-focus gap band names no window — leave the demand where it is.
    }, [bodyItems, reportViewport]);
    // The narrow list's side of the same loop (#812): it has no virtualizer,
    // so it reports the last row card on screen, and its load-more asks for
    // the window past the resident run.
    const narrowPaging = useMemo<PlanNarrowPaging | undefined>(() => (pagedSource === undefined ? undefined : {
        tail: paging.tail,
        loading: paging.loading,
        onViewport: (key: string) => reportViewport({ kind: "row", key }, false),
        onLoadMore: () => reportViewport({ kind: "band", at: "tail" }, false),
    }), [pagedSource, paging.tail, paging.loading, reportViewport]);
    // Where a key search has positioned the canvas. Resolved against the
    // VISIBLE body (a match inside a collapsed group has no row to scroll to),
    // and only once that row has actually loaded.
    const searchIndex = useMemo(() => {
        if (targetKey === undefined) return undefined;
        // `it.row` is the VisibleRow envelope; the row value is `it.row.row`.
        const i = bodyItems.findIndex((it) => it.kind === "row" && it.row.row.key === targetKey);
        return i >= 0 ? i : undefined;
    }, [bodyItems, targetKey]);
    // ...or where the diagnostics chip asked to go (#811): the first skipped
    // row, or the collapsed group hiding it. The latest request wins — a
    // search that lands takes the viewport back — and the nonce lets the
    // chip scroll there again after the user has moved away.
    const firstSkipped = useMemo(
        () => firstDiagnosticItem(bodyItems, index, derived.diagnostics),
        [bodyItems, index, derived.diagnostics]);
    const [scrollOwner, setScrollOwner] = useState<"search" | "skipped">("search");
    const [skippedSeq, setSkippedSeq] = useState(0);
    useEffect(() => { if (targetKey !== undefined) setScrollOwner("search"); }, [targetKey]);
    const seekSkipped = useCallback(() => {
        setScrollOwner("skipped");
        setSkippedSeq((n) => n + 1);
    }, []);
    const scrollToIndex = scrollOwner === "skipped" ? firstSkipped : searchIndex;
    // What the toolbar reports (#811) — everything the canvas carried on past.
    const diagnostics = useMemo<PlanDiagnostics>(() => ({
        skipped: derived.diagnostics.size,
        onSeekSkipped: firstSkipped !== undefined ? seekSkipped : undefined,
        sourceError: paging.sourceError,
        searchError,
        truncatedAt: scale?.truncated?.shown,
    }), [derived.diagnostics, firstSkipped, seekSkipped, paging.sourceError, searchError, scale]);

    // The thin per-row adapter: compute this row's PRIMITIVE facts and hand
    // them to the memoized `PlanBodyRow` (#616). The canvas still renders on
    // every store change — cheaply — and each row's memo skips its subtree
    // unless ITS facts moved, so a selection click re-renders two rows and a
    // chart toggle one. (`visible` keys on `grain`/`collapsed`, not the whole
    // `ui`, which is what keeps the `v` identities stable across those
    // changes.) Scale changes still repaint every row: the row content
    // consumes `PlanScaleContext`, and context pierces the memo by design.
    const renderVisible = useCallback((v: VisibleRow): React.ReactNode => {
        if (scale === undefined) return null;
        const kind = v.row.kind;
        const h = rowHeight(v, dense, ui.chartsExpanded, heightCtx, derived);
        // R1 rails — unrelated data rows under a links focus collapse to 11px.
        const isRail = focusCtx?.kind === "links" && kind.type !== "group"
            && v.row.key !== focusCtx.key && !(focusCtx.family?.has(v.row.key) ?? false);
        // ── R2 context strip (#591) ── Under an expand focus every DATA row
        // but the focused one compresses to 16px. Group bands are exempt:
        // they are wayfinding, and a wall of strips with no structure between
        // them is unreadable.
        const isCtx = focusCtx?.kind === "expand" && v.row.key !== focusCtx.key
            && kind.type !== "group";
        // The FOCUSED row carries the render inside itself, which is what
        // makes it (and its gutter) tall — see `PlanFocusCtx.renderPx`.
        const isFocal = focusCtx?.kind === "expand" && v.row.key === focusCtx.key
            && kind.type !== "group" && expandBody !== null;
        const up = linkFamily?.upstream.has(v.row.key) ?? false;
        const down = linkFamily?.downstream.has(v.row.key) ?? false;
        const focusTag = up && down ? "LINKED" as const : up ? "UPSTREAM" as const : down ? "DOWNSTREAM" as const : undefined;
        // R2 — the focused row keeps its NORMAL anatomy; `axis` washes /
        // suppresses the shared lines inside its plot.
        const rowExpand = v.row.expand.type === "some" ? v.row.expand.value : undefined;
        const axisMode = isFocal && rowExpand !== undefined && rowExpand.axis.type !== "keep"
            ? rowExpand.axis.type
            : undefined;
        const activeControl = ui.focus !== null && ui.focus.key === v.row.key ? ui.focus.kind : undefined;
        return (
            <PlanBodyRow
                v={v}
                h={h}
                styles={styles}
                gridTemplate={gridTemplate}
                barHeight={barHeight}
                storageKey={storageKey}
                index={index}
                derived={derived}
                dispatch={dispatch}
                selected={ui.selected === v.row.key}
                chartExpanded={ui.chartsExpanded.has(v.row.key)}
                focusRole={isRail ? "rail" : isFocal ? "focal" : isCtx ? "ctx" : "none"}
                focusTag={focusTag}
                axisMode={axisMode}
                showLinksControl={linkedKeys.has(v.row.key)}
                showExpandControl={v.row.expand.type === "some" && expandRenderFn !== undefined}
                activeControl={activeControl}
                partial={transport?.partial}
                review={review}
                rowDrop={rowDrop}
                {...(isFocal ? {
                    // The author's render is its own part (#811): a throw
                    // while rendering it stays inside the focused row.
                    expandBody: (
                        <PlanPartBoundary part="expand render" resetKey={expandBody} styles={styles}>
                            <EastChakraComponent value={expandBody}
                                storageKey={`${storageKey}.${v.row.key}.expand`} />
                        </PlanPartBoundary>
                    ),
                    bandHeight: rowHeight(v, dense, ui.chartsExpanded, undefined, derived),
                    ...(expandGutterBody !== null ? {
                        expandGutter: (
                            <PlanPartBoundary part="expand gutter" resetKey={expandGutterBody} styles={styles}>
                                <EastChakraComponent value={expandGutterBody}
                                    storageKey={`${storageKey}.${v.row.key}.expandgutter`} />
                            </PlanPartBoundary>
                        ),
                    } : {}),
                } : {})}
            />
        );
    }, [scale, styles, gridTemplate, dense, ui, index, derived, dispatch, barHeight, storageKey,
        focusCtx, heightCtx, linkedKeys, linkFamily, expandRenderFn, expandBody, expandGutterBody,
        transport, review, rowDrop]);

    // R1 gap band — ONE double-height ⋯ band replacing a run of unrelated
    // rows (their count rides beside the icon, worst hidden tone at right);
    // click returns to all rows, like a rail.
    const renderGap = useCallback((gap: FocusGap): React.ReactNode => (
        <Box css={styles.focusGap} gridTemplateColumns={gridTemplate}
            data-plan-gap={gap.rows + gap.groups}
            onClick={() => dispatch({ t: "focus.clear" })}>
            <Box css={styles.focusGapInner}>
                <FontAwesomeIcon icon={faEllipsis} />
                <Box as="span">{gap.rows > 0 ? gap.rows : gap.groups}</Box>
            </Box>
            <Box position="relative">
                {gap.tone !== undefined && (
                    <Box as="span" css={styles.statusDot} data-tone={gap.tone}
                        position="absolute" right="12px" top="50%" transform="translateY(-50%)" />
                )}
            </Box>
        </Box>
    ), [styles, gridTemplate, dispatch]);

    // ── Shell composition ─────────────────────────────────────────────────
    // The resolution segment is a TIME-axis affordance; the now instant rides
    // whichever arm the axis declares.
    const resolutions = useMemo(() => axisResolutions(data.axis), [data.axis]);
    const now = useMemo(() => axisNow(data.axis), [data.axis]);

    // A source that cannot be READ no longer replaces the canvas (#811): its
    // windows fail one by one, each as its own band with the reason and a
    // Retry, and a failing `total()` is a toolbar chip. Outside a workspace
    // (#567 D10 — there is no offline stand-in for `Data.bindPaged`) that is
    // window 0's band saying why, not a blank axis reading as an empty
    // dataset. Likewise a row on another arm is its own diagnostic row.
    if (scale === undefined) {
        return (
            <Box css={styles.diagnostic} data-plan-empty>
                {pagedSource !== undefined
                    ? "NO WINDOW — a paged plan must declare an axis window or bind a slice range"
                    : axisKind === "number"
                        ? "NO WINDOW — give the plan an axis window, a bound slice range, or numbered rows"
                        : axisKind === "ordinal"
                            ? "NO WINDOW — an ordinal axis needs at least one declared value"
                            : "NO WINDOW — give the plan an axis window, a bound slice range, or dated rows"}
            </Box>
        );
    }

    // The ruler's gutter caption is the active grain's name (the §1 mock).
    const rulerCaption = ui.grain.toUpperCase();

    const header = (
        <Box background="bg.surface" ref={headerRef} data-plan-header>
            {/* The toolbar is SLICE chrome (§2) — the grain / resolution
                segments ride the slice rail; an unbound canvas has no rail.
                It ALSO carries the key search, and that is a capability of the
                SOURCE, not of the slice: a keyed paged source declares `seek`
                whether or not a slice was ever bound. Gating the whole bar on
                the slice left such a canvas with a working seek and no way to
                reach it — no search box, so no jump, so no random access at
                all. So the bar mounts for either reason; `PlanToolbar` is
                already slice-safe (every cluster is guarded, `railKinds` is
                empty without one), and no slice is fabricated to get it.

                The series library (#590) is the same argument a third time: a
                pickable canvas needs its trigger whether or not a slice was
                ever bound — and the diagnostics (#811) a fourth: a canvas that
                carried on past a failure must say so, slice or no slice. */}
            {(chrome !== undefined || search !== undefined || pick !== undefined || hasDiagnostics(diagnostics)) && (
                <PlanToolbar styles={styles} slice={slice} affordances={affordances}
                    resolution={scale.resolution ?? ""} resolutions={resolutions}
                    transport={transport} search={search} pick={pick} diagnostics={diagnostics} />
            )}
            {/* The brush mounts only where the slice's range domain speaks
                the axis's arm — the band decides that itself (#631). */}
            {slice !== undefined && affordances.includes("brush") && (
                <HorizonBrush styles={styles} gridTemplate={gridTemplate} slice={slice} now={now} />
            )}
            <PlanRuler styles={styles} gridTemplate={gridTemplate} caption={rulerCaption}
                cursorChipRef={cursorChipRef}
                trailing={review !== undefined
                    ? <PlanDecisionHeader label={review.columnLabel} />
                    : undefined} />
            {/* Pinned rows collapse like every other row under a focus —
                they are not exempt from "collapse, never remove", and
                dropping them would lose exactly the context they are pinned
                for. `renderVisible` reads `focusCtx`, so they strip. */}
            {pinned.map((row) => (
                <Box key={row.key} background="bg.surface">
                    {renderVisible({ row, depth: 0, collapsed: false })}
                </Box>
            ))}
            {/* The R1/R2 focus band — a SECTION row between the header and
                the body (`← ALL ROWS` + caption); the ruler never moves. */}
            {ui.focus !== null && (
                <FocusBar styles={styles} focus={ui.focus}
                    counts={linkFamily !== undefined
                        ? { upstream: linkFamily.upstream.size, downstream: linkFamily.downstream.size }
                        : undefined} />
            )}
        </Box>
    );

    const body = (
        <PlanScaleContext.Provider value={scale}>
            <PlanDispatchContext.Provider value={dispatch}>
            <PlanCursorContext.Provider value={cursor}>
            <PlanResolversContext.Provider value={resolvers}>
                <Box
                    ref={focusBodyRef}
                    tabIndex={0}
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
                    {...(frameFills && {
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                        height,
                        maxHeight,
                    })}
                    onKeyDown={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
                        const map: Record<string, PlanEvent> = {
                            Escape: { t: "key", key: "esc" },
                            n: { t: "key", key: "n" },
                            "[": { t: "key", key: "[" },
                            "]": { t: "key", key: "]" },
                            g: { t: "key", key: "g" },
                        };
                        const ev = map[e.key];
                        if (ev !== undefined) {
                            e.preventDefault();
                            dispatch(ev);
                        }
                    }}
                >
                    {narrow ? (
                        <PlanNarrow
                            styles={styles} index={index} derived={derived} ui={ui}
                            dense={dense} barHeight={barHeight} storageKey={storageKey}
                            slice={slice} affordances={affordances}
                            resolution={scale.resolution ?? ""} resolutions={resolutions}
                            transport={transport} footer={data.footer} review={review}
                            expandBody={expandBody} expandGutterBody={expandGutterBody}
                            canExpand={expandRenderFn !== undefined}
                            partial={transport?.partial} fill={frameFills}
                            diagnostics={diagnostics} failures={paging.failures} onRetry={paging.retry}
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
                            // pin 11px / 22px in the recipe, and the R2 render
                            // pins its clamped `px`. Measuring fixed-height rows
                            // drifts under fractional zoom and paints hairline
                            // seams (#533).
                            measureRows={false}
                            scrollToIndex={scrollToIndex}
                            scrollNonce={scrollOwner === "skipped" ? skippedSeq : undefined}
                            onRangeChange={pagedSource !== undefined ? reportRange : undefined}
                            // Unbounded, a large canvas mounts only what its
                            // scrolling ancestor shows (#812) — the same threshold
                            // whatever the source. A smaller paged canvas mounts
                            // every row and still reports which are on screen:
                            // `onRangeChange` makes the frame watch the ancestor.
                            virtualizeUnboundedAt={VIRTUALIZE_UNBOUNDED_AT}
                            scrollElRef={scrollElRef}
                            header={header}
                            footer={<PlanFooter styles={styles} items={data.footer} transport={transport} />}
                            count={bodyItems.length}
                            // Heights move at a constant count — a chart toggle, a
                            // focus stripping every other row, a band landing as
                            // rows — and the frame re-measures from these alone.
                            sizes={heights}
                            getItemKey={itemKey}
                            // Where the scroll rests, persisted and restored
                            // as a row (#813).
                            onAnchorChange={onAnchorChange}
                            restoreAnchor={restoreAnchor}
                            renderRow={(i) => {
                                const item = bodyItems[i];
                                if (item === undefined) return null;
                                if (item.kind === "gap") return renderGap(item.gap);
                                if (item.kind === "band") {
                                    return <WindowBand band={item.band} styles={styles} loading={paging.loading} />;
                                }
                                if (item.kind === "failed") {
                                    return <WindowFailureBand failure={item.failure} styles={styles} onRetry={paging.retry} />;
                                }
                                return renderVisible(item.row);
                            }}
                            headerZIndex={5}
                            rootCss={styles.root}
                        />
                    )}
                    {/* The batch foot sits OUTSIDE the scrolling grid so it stays
                        full-width under the canvas (the shared convention). */}
                    {review !== undefined && (
                        <ReviewFoot controller={review} storageKey={storageKey} />
                    )}
                    {/* R1 ribbons — the K8 vocabulary at the current row set
                        (ribbons need width — never on the narrow layout). */}
                    {!narrow && ui.focus?.kind === "links" && focusVisibleKeys !== undefined && (
                        // The ribbons are their own part (#811): a throw while
                        // routing them loses the ribbons, not the canvas.
                        <PlanPartBoundary part="links layer" resetKey={focusVisibleKeys} styles={styles}>
                            <LinksOverlay container={focusBodyRef.current}
                                links={data.links} visibleKeys={focusVisibleKeys}
                                scale={scale} runDates={runDates} />
                        </PlanPartBoundary>
                    )}
                </Box>
            </PlanResolversContext.Provider>
            </PlanCursorContext.Provider>
            </PlanDispatchContext.Provider>
        </PlanScaleContext.Provider>
    );

    const densityTag = style !== undefined ? getSomeorUndefined(style.density)?.type : undefined;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{body}</DensityProvider>
        : body;
}, (prev, next) => planRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
