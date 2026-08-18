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
 * P2 renders group / span / chart / heat rows; buckets / table / cards /
 * events arrive in P3 (their rows render as quiet placeholder bands so a
 * full canvas stays intact).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Plan, Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { parseCssSize } from "../../style/parse-size.js";
import { DensityProvider } from "../../contracts/density.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity.js";
import { VirtualRows } from "../virtual-rows.js";
import { PlanScaleContext, PlanDispatchContext, PlanResolversContext, type PlanResolvers } from "./context.js";
import { usePlanPaging } from "./use-plan-paging.js";
import { usePlanSeek } from "./use-seek.js";
import { useElementHeight } from "./use-element-height.js";
import { WindowBand } from "./rows/WindowBand.js";
import { effectiveResolution, planScale, resolutionInterval, type PlanResolution, type PlanScale, type PlanWindow } from "./scale.js";
import {
    initialPlanState, planReducer,
    type PlanCtx, type PlanEffect, type PlanEvent, type PlanUiState,
} from "./plan-state.js";
import {
    GAP_H, derivePlan, deriveLinkFamily, elideForFocus, indexRows, linkedRowKeys, pinnedRows, rowHeight, visibleRows,
    type FocusGap, type PlanBodyItem, type PlanFocusCtx, type PlanRootValue, type PlanRowValue, type VisibleRow,
} from "./model.js";
import { EastChakraComponent } from "../../component.js";
import { useDragTarget, type DragEventValue } from "../../dnd/drag-layer";
import { type CanDropFn } from "../../dnd/ir-can-drop";
import { RowShell, type PlanRowDrop } from "./rows/RowShell.js";
import { SpanRow } from "./rows/SpanRow.js";
import { GroupRow } from "./rows/GroupRow.js";
import { ChartRowPlot, ChartLeftTicks } from "./rows/ChartRow.js";
import { HeatCells } from "./rows/HeatRow.js";
import { BucketsRow } from "./rows/BucketsRow.js";
import { CardsRow } from "./rows/CardsRow.js";
import { EventsRow } from "./rows/EventsRow.js";
import { TableRowCells } from "./rows/TableRow.js";
import { PlanToolbar } from "./shell/Toolbar.js";
import { HorizonBrush } from "./shell/HorizonBrush.js";
import { FocusBar } from "./shell/FocusBar.js";
import { LinksOverlay } from "./shell/LinksOverlay.js";
import { PlanRuler } from "./shell/Ruler.js";
import { PlanFooter } from "./shell/Footer.js";
import {
    usePlanReview, PlanDecisionCell, PlanDecisionHeader, tagOf, DECISION_WIDTH,
} from "./shell/Review.js";
import { ReviewFoot } from "../shared/review.js";
import { type PlanTransport } from "./shell/transport.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

export { type PlanRootValue, type PlanRowValue } from "./model.js";

const planRootEqual = equalFor(Plan.Types.Root);

/** Default gutter width (px, desktop — the §8 sheet). */
const GUTTER_W = 168;
/** Default height of the R2 developer-render region when a row declares none. */
const EXPAND_DEFAULT_PX = 240;
/** The render never clamps below this — a region too short to hold anything
 *  is worse than one that scrolls. */
const EXPAND_FLOOR_PX = 88;

/**
 * The row kinds that accept a drop.
 *
 * @remarks
 * A Plan's rows are heterogeneous, so "can you drop here" is a per-KIND
 * question before it is a per-row one — and the line is not arbitrary. These
 * four render a **collection of discrete scheduled objects** (runs, bucket
 * events, marks, chips): things a library card can BECOME, at an instant the
 * pointer names.
 *
 * The rest are excluded on the same principle:
 *
 * - `chart` / `heat` / `table` render DERIVED values — a plotted series, an
 *   intensity field, computed cells. There is nothing for a card to become,
 *   and a number is not a destination.
 * - `group` is wayfinding chrome; its MEMBERS are the droppable things, and
 *   accepting on the strip would make a collapsed group swallow drops meant
 *   for a row inside it.
 *
 * A canvas narrows further with `canDrop` — this set is what is structurally
 * possible, the predicate is what this particular canvas permits.
 */
const DROPPABLE_KINDS: ReadonlySet<string> = new Set(["span", "buckets", "events", "cards"]);

export interface EastChakraPlanProps {
    /** The Plan root value. */
    value: PlanRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
}

/** Every instant a row set touches — the fit-to-data window fallback. */
function dataExtent(rows: ReadonlyArray<PlanRowValue>): { min: Date; max: Date } | undefined {
    let min = Infinity;
    let max = -Infinity;
    const see = (d: Date) => {
        const t = d.getTime();
        if (t < min) min = t;
        if (t > max) max = t;
    };
    for (const row of rows) {
        const kind = row.kind;
        switch (kind.type) {
            case "span":
                for (const r of kind.value.runs) { see(r.start); see(r.end); }
                for (const d of kind.value.decisions) see(d.at);
                for (const p of kind.value.ports) see(p.at);
                break;
            case "buckets":
                for (const e of kind.value.events) see(e.at);
                for (const m of kind.value.markers) see(m.at);
                break;
            case "chart":
                for (const layer of kind.value.layers) {
                    switch (layer.type) {
                        case "line": case "area": case "column": case "scatter":
                            for (const p of layer.value.points) see(p.t);
                            break;
                        case "band":
                            for (const p of layer.value.points) see(p.t);
                            break;
                        case "refBand": see(layer.value.from); see(layer.value.to); break;
                        case "refDot": see(layer.value.t); break;
                        case "refLine": break;
                    }
                }
                break;
            case "heat": {
                const cells = kind.value.cells;
                if (cells.type === "heat") for (const c of cells.value.cells) see(c.at);
                else for (const c of cells.value) see(c.at);
                break;
            }
            case "table":
                for (const s of kind.value.series) for (const c of s.cells) see(c.at);
                break;
            case "cards":
                for (const c of kind.value.chips) { see(c.from); see(c.to); }
                break;
            case "events":
                for (const m of kind.value.marks) see(m.at);
                break;
            case "group":
                break;
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return undefined;
    return { min: new Date(min), max: new Date(max) };
}

/**
 * The bound slice's applied window as raw millisecond instants, or `undefined`
 * when no literal datetime range is applied.
 *
 * @remarks
 * Returns PRIMITIVES so a caller can key a memo on them. The decoded state is a
 * fresh object every read, so its `range` can never be a stable dependency.
 *
 * @param state - The decoded slice state, when a slice is bound
 * @returns `[fromMs, toMs]` for a non-empty datetime range, else `undefined`
 */
function sliceRangeInstants(state: { range: unknown } | undefined): readonly [number, number] | undefined {
    if (state === undefined) return undefined;
    const r = getSomeorUndefined(state.range as never) as { type: string; value: unknown } | undefined;
    if (r === undefined || r.type !== "datetime") return undefined;
    const win = r.value as { from: Date; to: Date };
    const from = win.from.getTime();
    const to = win.to.getTime();
    return to > from ? [from, to] as const : undefined;
}

/** Renders an East Plan value — the composite temporal canvas. */
export const EastChakraPlan = memo(function EastChakraPlan({ value, storageKey }: EastChakraPlanProps) {
    // ── The rows channel: inline rows, or the derived paged source (§3.8)
    //    streamed in as a contiguous prefix by the loader hook. ──────────────
    const pagedSource = value.rows.type === "paged" ? value.rows.value : undefined;
    // The ledger needs a window's pixel height, which is `rowHeight()` over its
    // rows — and that needs density / chart state defined further down. A ref
    // breaks the ordering: the driver only calls this when a window LANDS (in an
    // effect), by which point the current render has assigned it.
    const heightOfRef = useRef<(rows: readonly PlanRowValue[]) => number>(() => 0);
    const heightOf = useCallback((rows: readonly PlanRowValue[]) => heightOfRef.current(rows), []);
    const paging = usePlanPaging(pagedSource, { heightOf });
    // The inline arm is the canvas's KEYED collection (#568) — decoded as a
    // SortedMap, so its values are already in canonical key order.
    const rows = useMemo(
        () => (value.rows.type === "inline" ? [...value.rows.value.values()] : paging.rows),
        [value.rows, paging.rows],
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
    const { search, targetKey } = usePlanSeek(pagedSource, rows, paging.jumpToElement);

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
    const axisWindow = useMemo(() => {
        const w = getSomeorUndefined(value.axis.window);
        return w !== undefined ? { min: w.min, max: w.max } : undefined;
    }, [value.axis.window]);
    // Keyed on the INSTANTS, never on the range object. `slice.read()` decodes
    // fresh state on every render, so `sliceState.range` has a new identity each
    // time even when the window has not moved. Keying the memo on that identity
    // rebuilt `sliceRange`, which rebuilt `scale` (up to MAX_PLAN_BUCKETS
    // buckets, each with a formatted label), which published a new PlanScale to
    // every row — busting `edges`, `resolveCoord`, `dropVeto` and so the drop
    // cell's own ref callback, so React detached and re-attached every
    // registered cell on every render of a slice-bound canvas.
    const sliceFromMs = sliceRangeInstants(sliceState)?.[0];
    const sliceToMs = sliceRangeInstants(sliceState)?.[1];
    const sliceRange = useMemo(
        () => (sliceFromMs === undefined || sliceToMs === undefined
            ? undefined
            : { min: new Date(sliceFromMs), max: new Date(sliceToMs) }),
        [sliceFromMs, sliceToMs],
    );
    const sliceResolution = sliceState !== undefined
        ? getSomeorUndefined(sliceState.resolution)?.type
        : undefined;
    const declaredResolution = sliceResolution ?? value.axis.resolution.type;

    const scale: PlanScale | undefined = useMemo(() => {
        let window: PlanWindow | undefined = sliceRange ?? axisWindow;
        let res: PlanResolution;
        if (window === undefined) {
            // A PAGED canvas must DECLARE its window. Fitting to the data means
            // fitting to whatever prefix has landed, so the axis widens and
            // every bar re-flows as each window arrives (#567 D8) — the canvas
            // says so instead, and the author declares `axis.window` or binds a
            // slice range.
            if (pagedSource !== undefined) return undefined;
            const extent = dataExtent(rows);
            if (extent === undefined) return undefined;
            res = effectiveResolution(declaredResolution, extent);
            // Extend the fitted extent to whole periods, half-open.
            const interval = resolutionInterval(res);
            window = { min: interval.floor(extent.min), max: interval.offset(interval.floor(extent.max), 1) };
        } else {
            res = effectiveResolution(declaredResolution, window);
        }
        const now = getSomeorUndefined(value.axis.now);
        const format = getSomeorUndefined(value.axis.format);
        return planScale(window, res, now, format);
    }, [sliceRange, axisWindow, declaredResolution, rows, pagedSource, value.axis.now, value.axis.format]);

    // ── The one state machine ─────────────────────────────────────────────
    const index = useMemo(() => indexRows(rows), [rows]);
    // Renderer-side derivations (§4.2 — the Table idiom): the IR declares
    // rollups / aggregates / summaries; the numbers are computed here.
    const derived = useMemo(() => derivePlan(index), [index]);
    // The R1 link graph — rows an edge touches grow the `links` control.
    const linkedKeys = useMemo(() => linkedRowKeys(value.links), [value.links]);
    // A run's instants by (row, run) — the overlay's off-window resolution.
    const runDates = useCallback((rowKey: string, runKey: string): { start: Date; end: Date } | undefined => {
        const row = index.byKey.get(rowKey);
        if (row === undefined || row.kind.type !== "span") return undefined;
        const r = row.kind.value.runs.find((x) => x.key === runKey);
        return r !== undefined ? { start: r.start, end: r.end } : undefined;
    }, [index]);
    const initGrain = getSomeorUndefined(value.grain)?.type ?? "resource";
    const [ui, setUi] = useState<PlanUiState>(() => initialPlanState(initGrain, index.initiallyCollapsed));
    const uiRef = useRef(ui);
    uiRef.current = ui;
    // Data change re-seeds the ephemeral UI state (the interactive-state rule).
    const seededCollapse = useRef<Set<string>>(new Set(index.initiallyCollapsed));
    useEffect(() => {
        const next = initialPlanState(initGrain, index.initiallyCollapsed);
        setUi(next);
        uiRef.current = next;
        seededCollapse.current = new Set(index.initiallyCollapsed);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reset tracks the VALUE identity
    }, [value]);

    // Rows that arrive LATE carry their own declared collapse. A paged canvas
    // streams its windows in against an unchanging `value`, so the reset above
    // — which keys on value identity — never sees them, and an IR-declared
    // collapsed strip would render open. Seed each declared key ONCE, the
    // first time its row appears; never re-seed, so a group the user has since
    // opened stays open when the next window lands.
    useEffect(() => {
        const fresh: string[] = [];
        for (const key of index.initiallyCollapsed) {
            if (!seededCollapse.current.has(key)) {
                seededCollapse.current.add(key);
                fresh.push(key);
            }
        }
        if (fresh.length === 0) return;
        // Compute `next` OUTSIDE the updater, then assign the ref and set the
        // state as two statements — the mandatory interactive-state shape (a
        // StrictMode double-invoked updater must stay pure).
        const collapsed = new Set(uiRef.current.collapsed);
        for (const key of fresh) collapsed.add(key);
        const next = { ...uiRef.current, collapsed };
        uiRef.current = next;
        setUi(next);
    }, [index]);

    // Row focus (R1 links / R2 expand) — family closure + height context.
    const linkFamily = useMemo(
        () => (ui.focus?.kind === "links" ? deriveLinkFamily(value.links, ui.focus.key) : undefined),
        [ui.focus, value.links],
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
    // Entering / leaving / moving a row focus rewrites EVERY row's height
    // while the row COUNT holds — precisely the case TanStack's measurement
    // memo does not watch (see `VirtualRows.sizeVersion`). Bump on each
    // distinct focus so the offsets are recomputed instead of the strips
    // painting at their old full heights.
    const [focusVersion, setFocusVersion] = useState(0);
    useEffect(() => { setFocusVersion((n) => n + 1); }, [ui.focus]);
    // The generalized element resolvers (popover / hover) — threaded to the
    // row renderers; elements invoke them lazily at interaction time.
    const resolvers = useMemo<PlanResolvers>(() => ({
        popover: getSomeorUndefined(value.popover),
        hover: getSomeorUndefined(value.hover),
    }), [value.popover, value.hover]);

    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    const ctxRef = useRef<PlanCtx>({ bucketAtFrac: () => -1 });
    ctxRef.current = {
        bucketAtFrac: (f) => {
            const sc = scaleRef.current;
            if (sc === undefined) return -1;
            const i = sc.buckets.findIndex((b) => f >= b.x0 && f < b.x1);
            return i;
        },
    };

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
        sources: [...value.sources],
        // `add` only. `move` / `resize` need a drag to START on the canvas —
        // a draggable run bar or chip — and nothing here begins one, so
        // declaring them would advertise a capability with no gesture behind it.
        kinds: { add: true },
        onDrag: handleDrop,
    } : null), [dropEligible, value.id, value.sources, handleDrop]);
    useDragTarget(targetConfig);
    // One config shared by every droppable row — the per-row part of the
    // coordinate is the row itself, which `RowShell` already knows.
    const rowDrop = useMemo<PlanRowDrop | undefined>(
        () => (dropEligible ? { surface: value.id, canDrop: canDropFn } : undefined),
        [dropEligible, value.id, canDropFn],
    );

    const runEffects = useCallback((effects: PlanEffect[]) => {
        for (const eff of effects) {
            switch (eff.t) {
                case "slice.setRange":
                    if (slice !== undefined) slice.setRange(some(variant("datetime", { from: eff.min, to: eff.max })));
                    break;
                case "slice.clearRange":
                    if (slice !== undefined) slice.setRange(none);
                    break;
                case "slice.setResolution":
                    if (slice !== undefined) {
                        slice.setResolution(some(variant(eff.resolution, null) as never));
                        // Zoom to the new resolution: preserve the CURRENT
                        // column count (12 weeks showing → DAY shows 12 days),
                        // anchored at the window start on the new period edges
                        // — a same-width window would cram unusable columns.
                        const sc = scaleRef.current;
                        if (sc !== undefined) {
                            const interval = resolutionInterval(eff.resolution as PlanResolution);
                            const min = interval.floor(sc.window.min);
                            const max = interval.offset(min, sc.n);
                            slice.setRange(some(variant("datetime", { from: min, to: max })));
                        }
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
                case "scroll.toNow":
                case "pan":
                    // P3 — virtualizer handle wiring.
                    break;
            }
        }
    }, [slice, onSelect, onGroupToggle, onGrainChange]);

    const dispatch = useCallback((e: PlanEvent) => {
        const { state, effects } = planReducer(uiRef.current, e, ctxRef.current);
        if (state !== uiRef.current) {
            uiRef.current = state;
            setUi(state);
        }
        if (effects.length > 0) runEffects(effects);
    }, [runEffects]);

    // The focus overlay's positioning parent (the canvas body wrapper).
    const focusBodyRef = useRef<HTMLDivElement | null>(null);
    // The virtualizer's scroll viewport — the only element that knows how much
    // canvas there actually is, which the R2 clamp measures.
    const scrollElRef = useRef<HTMLDivElement | null>(null);
    // The sticky chrome's measured height (toolbar / brush / ruler / pinned
    // rows / focus bar). It sits INSIDE the scroll viewport, so the clamp has
    // to take it off the top. Measured rather than summed from constants: the
    // chrome is conditional in five places and a hand-kept total would drift.
    const headerPxRef = useRef(0);
    const headerElRef = useCallback((el: HTMLDivElement | null) => {
        headerPxRef.current = el?.offsetHeight ?? 0;
    }, []);
    // Entering a row focus can swap the body tree (R2 unmounts the clicked
    // control), dropping browser focus to <body> and killing the esc rung —
    // re-anchor keyboard focus on the canvas surface.
    useEffect(() => {
        if (ui.focus !== null) focusBodyRef.current?.focus();
    }, [ui.focus]);

    // ── Recipe + layout ───────────────────────────────────────────────────
    const recipe = useSlotRecipe({ key: "plan" });
    const dense = getSomeorUndefined(getSomeorUndefined(value.style)?.density)?.type === "compact";
    const styles = useMemo(
        () => recipe({ density: dense ? "dense" : "default" } as Record<string, unknown>) as unknown as Styles,
        [recipe, dense],
    );
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    // gutterWidth is a CSS px size string (the shared component-height type).
    const gutterWDeclared = style !== undefined && style.gutterWidth.type === "some" ? parseFloat(style.gutterWidth.value) : NaN;
    const gutterW = Number.isFinite(gutterWDeclared) ? gutterWDeclared : GUTTER_W;
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

    // The ledger's window height, now that density and chart state exist. Exact
    // rather than measured: the canvas is fixed-height by kind and mounts with
    // `measureRows={false}`, so `rowHeight()` IS the layout.
    heightOfRef.current = (windowRows: readonly PlanRowValue[]): number =>
        windowRows.reduce((sum, row) =>
            sum + rowHeight({ row, depth: 0, collapsed: false }, dense, ui.chartsExpanded, heightCtx, derived), 0);

    // ── Rows ──────────────────────────────────────────────────────────────
    const visible = useMemo(() => visibleRows(index, ui, focusVisibleKeys), [index, ui, focusVisibleKeys]);
    const pinned = useMemo(() => pinnedRows(index), [index]);
    // R2 — the focused row's own declaration. The row keeps its NORMAL
    // anatomy and height; what grows is the render region BELOW it, which is
    // its own body item (see `bodyItems`) so the whole gesture stays inside
    // the virtualizer and the strips above and below keep their order.
    const expandDecl = focusCtx?.kind === "expand"
        ? getSomeorUndefined(index.byKey.get(focusCtx.key)?.expand)
        : undefined;
    // The v2 clamp — `min(renderHeight, canvas − strips − ruler)`. The canvas
    // is MEASURED, not parsed: `height: "fill"` is `"100%"`, which has no
    // pixel value until layout runs. Unbounded frames have no scroll element
    // and grow to content, so there is nothing to clamp against and the
    // declared height stands.
    const viewportPx = useElementHeight(scrollElRef, ui.focus?.kind === "expand");
    // The clamp feeds `focusCtx.renderPx`, which `rowHeight` adds to the focal
    // row — so it must be computed WITHOUT `focusCtx` (which would be
    // circular). Strip heights are constant per row, so summing them needs no
    // focus context: every row but the focus is `STRIP_H`, groups aside.
    const expandRenderPx = useMemo(() => {
        if (expandDecl === undefined) return 0;
        const declared = expandDecl.height.type === "some" ? parseFloat(expandDecl.height.value) : NaN;
        const want = Number.isFinite(declared) ? declared : EXPAND_DEFAULT_PX;
        if (viewportPx === undefined) return want;
        // Everything the render must NOT push out: the strips, the focal row's
        // own band, and the chrome pinned above them.
        const bare = { kind: "expand" as const, key: ui.focus?.key ?? "" };
        const rowsPx = visible.reduce(
            (sum, v) => sum + rowHeight(v, dense, ui.chartsExpanded, bare, derived), 0);
        return Math.max(EXPAND_FLOOR_PX, Math.min(want, viewportPx - rowsPx - headerPxRef.current));
    }, [expandDecl, viewportPx, visible, dense, ui.chartsExpanded, ui.focus, derived]);
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
    const bodyItems = useMemo<PlanBodyItem[]>(() => {
        const core: PlanBodyItem[] = focusCtx?.kind === "links"
            ? elideForFocus(visible, index, focusCtx)
            : visible.map((row) => ({ kind: "row", row }));
        // The unloaded remainder of a paged source, above and below (#577). Each
        // band is sized by the ledger, so the rows that replace it occupy the
        // same space and nothing below moves.
        if (paging.head === undefined && paging.tail === undefined) return core;
        const out: PlanBodyItem[] = [];
        if (paging.head !== undefined) out.push({ kind: "band", band: paging.head });
        out.push(...core);
        if (paging.tail !== undefined) out.push({ kind: "band", band: paging.tail });
        return out;
    }, [focusCtx, visible, index, paging.head, paging.tail]);

    // The viewport, in the driver's terms — which ROW (or which band) the middle
    // of the mounted range sits on. The driver maps that back to a window; no
    // body-layout knowledge crosses that boundary.
    const reportRange = useCallback((range: { startIndex: number; endIndex: number }, isScrolling: boolean) => {
        const mid = Math.floor((range.startIndex + range.endIndex) / 2);
        const item = bodyItems[mid] ?? bodyItems[range.startIndex];
        if (item === undefined) return;
        if (item.kind === "band") paging.reportViewport({ kind: "band", at: item.band.at }, isScrolling);
        else if (item.kind === "row") paging.reportViewport({ kind: "row", key: item.row.row.key }, isScrolling);
        // A links-focus gap band names no window — leave the demand where it is.
    }, [bodyItems, paging]);
    // Where a key search has positioned the canvas. Resolved against the
    // VISIBLE body (a match inside a collapsed group has no row to scroll to),
    // and only once that row has actually loaded.
    const scrollToIndex = useMemo(() => {
        if (targetKey === undefined) return undefined;
        // `it.row` is the VisibleRow envelope; the row value is `it.row.row`.
        const i = bodyItems.findIndex((it) => it.kind === "row" && it.row.row.key === targetKey);
        return i >= 0 ? i : undefined;
    }, [bodyItems, targetKey]);

    const renderVisible = useCallback((v: VisibleRow): React.ReactNode => {
        if (scale === undefined) return null;
        const kind = v.row.kind;
        const h = rowHeight(v, dense, ui.chartsExpanded, heightCtx, derived);
        const cursorFrac = ui.cursor?.frac;
        // R1 rails — unrelated rows collapse to 11px, never removed: order,
        // scroll and the status dot survive, and the rail itself returns.
        if (focusCtx?.kind === "links" && kind.type !== "group"
            && v.row.key !== focusCtx.key && !(focusCtx.family?.has(v.row.key) ?? false)) {
            const railTone = v.row.status.type === "some" ? v.row.status.value.type : undefined;
            return (
                <Box css={styles.rail} gridTemplateColumns={gridTemplate} data-plan-rail={v.row.key}
                    onClick={() => dispatch({ t: "focus.clear" })}>
                    <Box position="relative">
                        {railTone !== undefined && (
                            <Box as="span" css={styles.statusDot} data-tone={railTone}
                                position="absolute" right="12px" top="2px" />
                        )}
                    </Box>
                </Box>
            );
        }
        // ── R2 context strip (#591) ──
        // Under an expand focus every DATA row but the focused one compresses
        // to 16px. Group bands are exempt: they are wayfinding, and a wall of
        // strips with no structure between them is unreadable.
        const isCtx = focusCtx?.kind === "expand" && v.row.key !== focusCtx.key
            && kind.type !== "group";
        // The FOCUSED row carries the render inside itself, which is what makes
        // it (and its gutter) tall — see `PlanFocusCtx.renderPx`.
        const isFocal = focusCtx?.kind === "expand" && v.row.key === focusCtx.key
            && kind.type !== "group" && expandBody !== null;
        // The row-scoped focus controls + family tags.
        const rowControls: ReadonlyArray<{ kind: "links" | "expand"; active: boolean; onClick: () => void }> = [
            ...(linkedKeys.has(v.row.key) ? [{
                kind: "links" as const,
                active: ui.focus?.kind === "links" && ui.focus.key === v.row.key,
                onClick: () => dispatch({ t: "focus.links", key: v.row.key }),
            }] : []),
            ...(v.row.expand.type === "some" && expandRenderFn !== undefined ? [{
                kind: "expand" as const,
                active: ui.focus?.kind === "expand" && ui.focus.key === v.row.key,
                onClick: () => dispatch({ t: "focus.expand", key: v.row.key }),
            }] : []),
        ];
        const up = linkFamily?.upstream.has(v.row.key) ?? false;
        const down = linkFamily?.downstream.has(v.row.key) ?? false;
        const focusTag = up && down ? "LINKED" as const : up ? "UPSTREAM" as const : down ? "DOWNSTREAM" as const : undefined;
        // R2 — the focused row keeps its NORMAL anatomy; `axis` washes /
        // suppresses the shared lines inside its plot. The developer render
        // mounts BELOW the row (the body's expand branch), never inside it.
        const isExpandFocused = focusCtx?.kind === "expand" && focusCtx.key === v.row.key;
        const rowExpand = v.row.expand.type === "some" ? v.row.expand.value : undefined;
        const axisTag = isExpandFocused && rowExpand !== undefined && rowExpand.axis.type !== "keep"
            ? rowExpand.axis.type
            : undefined;
        if (kind.type === "group") {
            return (
                <GroupRow row={v.row} kind={kind.value} styles={styles} gridTemplate={gridTemplate}
                    height={h} depth={v.depth} collapsed={v.collapsed}
                    summaryCells={derived.groupSummary.get(v.row.key)}
                    memberCount={derived.groupMembers.get(v.row.key)}
                    partial={transport?.partial} />
            );
        }
        const hasChildren = (index.children.get(v.row.key)?.length ?? 0) > 0;
        const shellBase = {
            row: v.row, styles, gridTemplate, depth: v.depth,
            selected: ui.selected === v.row.key, cursorFrac: isCtx ? undefined : cursorFrac,
            controls: isCtx ? undefined : rowControls, focusTag, axisMode: axisTag, ctx: isCtx,
            ...(isFocal ? {
                expandBody: <EastChakraComponent value={expandBody}
                    storageKey={`${storageKey}.${v.row.key}.expand`} />,
                bandHeight: rowHeight(v, dense, ui.chartsExpanded, undefined, derived),
                ...(expandGutterBody !== null ? {
                    expandGutter: <EastChakraComponent value={expandGutterBody}
                        storageKey={`${storageKey}.${v.row.key}.expandgutter`} />,
                } : {}),
            } : {}),
            decision: review !== undefined && review.hasRowVerbs
                ? <PlanDecisionCell rowKey={v.row.key} tag={tagOf(v.row)} review={review} />
                : undefined,
            // Only the kinds that hold droppable objects register a cell —
            // a chart / heat / table row is inert to a drag by construction,
            // not by predicate (see `DROPPABLE_KINDS`).
            drop: DROPPABLE_KINDS.has(kind.type) ? rowDrop : undefined,
        } as const;
        switch (kind.type) {
            case "span": {
                return (
                    <RowShell {...shellBase} height={h}
                        caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                        onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                        <SpanRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                            bands={derived.bands.get(v.row.key) ?? []}
                            barHeight={v.collapsed && hasChildren ? 12 : barHeight}
                            storageKey={`${storageKey}.${v.row.key}`}
                            partial={transport?.partial} />
                    </RowShell>
                );
            }
            case "chart": {
                const declaredExpanded = kind.value.height.type === "expanded";
                const expandable = kind.value.expandable.type === "some" && kind.value.expandable.value;
                const expanded = declaredExpanded || ui.chartsExpanded.has(v.row.key);
                return (
                    <RowShell {...shellBase} height={h} noGrid={false}
                        caret={expandable ? { collapsed: !expanded } : undefined}
                        onCaretClick={expandable ? () => dispatch({ t: "chart.toggle", key: v.row.key }) : undefined}
                        gutterOverlay={<ChartLeftTicks kind={kind.value} styles={styles} height={h} />}>
                        <ChartRowPlot kind={kind.value} styles={styles} height={h}
                            expanded={expanded} rowKey={v.row.key} ctx={isCtx} />
                    </RowShell>
                );
            }
            case "heat": {
                // A declared-aggregate parent renders its derived cells inside
                // the empty scale-bearing heat arm.
                const derivedCells = derived.heatCells.get(v.row.key);
                const cells = derivedCells !== undefined && kind.value.cells.type === "heat"
                    ? { type: "heat" as const, value: { ...kind.value.cells.value, cells: derivedCells } } as typeof kind.value.cells
                    : kind.value.cells;
                return (
                    <RowShell {...shellBase} height={h}
                        caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                        onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                        <HeatCells rowKey={v.row.key} cells={cells} styles={styles} ctx={isCtx} />
                    </RowShell>
                );
            }
            case "buckets":
                return (
                    <RowShell {...shellBase} height={h}
                        caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                        onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                        <BucketsRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                            storageKey={`${storageKey}.${v.row.key}`} />
                    </RowShell>
                );
            case "table": {
                // A declared-aggregate parent renders its derived subtotal
                // cells as ONE plain series; leaf rows render their declared
                // series (per-position style, raw cells).
                const derivedSeries = derived.tableSeries.get(v.row.key);
                const emphasis = kind.value.emphasis.type === "body" ? undefined : kind.value.emphasis.type;
                return (
                    <RowShell {...shellBase} height={h} emphasis={emphasis}
                        caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                        onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                        <TableRowCells rowKey={v.row.key}
                            series={derivedSeries ?? kind.value.series}
                            split={kind.value.split.type} ctx={isCtx}
                            format={getSomeorUndefined(kind.value.format)} styles={styles} />
                    </RowShell>
                );
            }
            case "cards":
                return (
                    <RowShell {...shellBase} height={h}>
                        <CardsRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                            storageKey={`${storageKey}.${v.row.key}`} />
                    </RowShell>
                );
            case "events":
                return (
                    <RowShell {...shellBase} height={h}>
                        <EventsRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                            storageKey={`${storageKey}.${v.row.key}`} />
                    </RowShell>
                );
        }
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
    const resolutions = useMemo(() => value.axis.resolutions.map((r) => r.type), [value.axis.resolutions]);
    const now = useMemo(() => getSomeorUndefined(value.axis.now), [value.axis.now]);

    // A paged source that could not be READ outranks every other diagnostic:
    // there is no offline stand-in for `Data.bindPaged` (paging is a server
    // capability), so this is what a bound canvas shows outside a workspace —
    // the reason, not a blank axis that reads as an empty dataset (#567 D10).
    if (paging.error !== undefined) {
        return (
            <Box css={styles.diagnostic} data-plan-empty data-plan-error>
                {`NO ROWS — the paged source could not be read. ${paging.error}`}
            </Box>
        );
    }

    if (scale === undefined) {
        return (
            <Box css={styles.diagnostic} data-plan-empty>
                {pagedSource !== undefined
                    ? "NO WINDOW — a paged plan must declare an axis window or bind a slice range"
                    : "NO WINDOW — give the plan an axis window, a bound slice range, or dated rows"}
            </Box>
        );
    }

    // The ruler's gutter caption is the active grain's name (the §1 mock).
    const rulerCaption = ui.grain.toUpperCase();
    const cursorBucket = ui.cursor !== undefined && ui.cursor !== null && ui.cursor.bucket >= 0
        ? scale.buckets[ui.cursor.bucket]
        : undefined;

    const header = (
        <Box background="bg.surface" ref={headerElRef}>
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
                ever bound. */}
            {(chrome !== undefined || search !== undefined || pick !== undefined) && (
                <PlanToolbar styles={styles} slice={slice} affordances={affordances}
                    resolution={scale.resolution} resolutions={resolutions}
                    transport={transport} search={search} pick={pick} />
            )}
            {slice !== undefined && affordances.includes("brush") && (
                <HorizonBrush styles={styles} gridTemplate={gridTemplate} slice={slice}
                    window={scale.window} now={now} resolution={scale.resolution} />
            )}
            <PlanRuler styles={styles} gridTemplate={gridTemplate} caption={rulerCaption}
                cursor={ui.cursor !== null && cursorBucket !== undefined
                    ? { frac: ui.cursor.frac, label: cursorBucket.label }
                    : undefined}
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
                        };
                        const ev = map[e.key];
                        if (ev !== undefined) {
                            e.preventDefault();
                            dispatch(ev);
                        }
                    }}
                >
                    <VirtualRows
                        height={frameFills ? undefined : height}
                        maxHeight={frameFills ? undefined : maxHeight}
                        fillParent={frameFills}
                        // Every body item pins an exact height matching
                        // `estimateSize` — `RowShell` sets `height: {h}px`
                        // from the same `rowHeight()`, the rail / gap bands
                        // pin 11px / 22px in the recipe, and the R2 render
                        // pins its clamped `px`. Measuring fixed-height rows
                        // drifts under fractional zoom and paints hairline
                        // seams (#533).
                        measureRows={false}
                        scrollToIndex={scrollToIndex}
                        onRangeChange={pagedSource !== undefined ? reportRange : undefined}
                        // A band becoming rows changes heights without
                        // changing the count, which TanStack's measurement
                        // memo does not watch (see `sizeVersion`). A row focus
                        // does exactly the same thing — every unfocused row
                        // drops to a strip while the count holds — so the
                        // focus identity rides the same bust.
                        sizeVersion={paging.sizeVersion + focusVersion}
                        scrollElRef={scrollElRef}
                        header={header}
                        footer={<PlanFooter styles={styles} items={value.footer} transport={transport} />}
                        count={bodyItems.length}
                        estimateSize={(i) => {
                            const item = bodyItems[i];
                            if (item === undefined) return 32;
                            if (item.kind === "gap") return GAP_H;
                            if (item.kind === "band") return Math.max(1, item.band.px);
                            return rowHeight(item.row, dense, ui.chartsExpanded, heightCtx, derived);
                        }}
                        renderRow={(i) => {
                            const item = bodyItems[i];
                            if (item === undefined) return null;
                            if (item.kind === "gap") return renderGap(item.gap);
                            if (item.kind === "band") {
                                return <WindowBand band={item.band} styles={styles} loading={paging.loading} />;
                            }
                            return renderVisible(item.row);
                        }}
                        headerZIndex={5}
                        rootCss={styles.root}
                    />
                    {/* The batch foot sits OUTSIDE the scrolling grid so it stays
                        full-width under the canvas (the shared convention). */}
                    {review !== undefined && (
                        <ReviewFoot controller={review} storageKey={storageKey} />
                    )}
                    {/* R1 ribbons — the K8 vocabulary at the current row set. */}
                    {ui.focus?.kind === "links" && focusVisibleKeys !== undefined && (
                        <LinksOverlay container={focusBodyRef.current}
                            links={value.links} visibleKeys={focusVisibleKeys}
                            scale={scale} runDates={runDates} />
                    )}
                </Box>
            </PlanResolversContext.Provider>
            </PlanDispatchContext.Provider>
        </PlanScaleContext.Provider>
    );

    const densityTag = style !== undefined ? getSomeorUndefined(style.density)?.type : undefined;
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{body}</DensityProvider>
        : body;
}, (prev, next) => planRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
