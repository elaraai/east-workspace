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
import { usePlanPagedRows } from "./use-paged-rows.js";
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
import { RowShell } from "./rows/RowShell.js";
import { SpanRow } from "./rows/SpanRow.js";
import { GroupRow } from "./rows/GroupRow.js";
import { ChartRowPlot, ChartLeftTicks } from "./rows/ChartRow.js";
import { HeatCells } from "./rows/HeatRow.js";
import { BucketsRow } from "./rows/BucketsRow.js";
import { CardsRow } from "./rows/CardsRow.js";
import { EventsRow } from "./rows/EventsRow.js";
import { TableRowCells, plainSeries } from "./rows/TableRow.js";
import { PlanToolbar } from "./shell/Toolbar.js";
import { HorizonBrush } from "./shell/HorizonBrush.js";
import { FocusBar } from "./shell/FocusBar.js";
import { LinksOverlay } from "./shell/LinksOverlay.js";
import { PlanRuler } from "./shell/Ruler.js";
import { PlanFooter } from "./shell/Footer.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

export { type PlanRootValue, type PlanRowValue } from "./model.js";

const planRootEqual = equalFor(Plan.Types.Root);

/** Default gutter width (px, desktop — the §8 sheet). */
const GUTTER_W = 168;
/** Default minimum height of the R2 developer-render region (CSS px). */
const EXPAND_MIN_H = "240px";

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

/** Renders an East Plan value — the composite temporal canvas. */
export const EastChakraPlan = memo(function EastChakraPlan({ value, storageKey }: EastChakraPlanProps) {
    // ── The rows channel: inline rows, or the derived paged source (§3.8)
    //    streamed in as a contiguous prefix by the loader hook. ──────────────
    const pagedSource = value.rows.type === "paged" ? value.rows.value : undefined;
    const paged = usePlanPagedRows(pagedSource);
    // The inline arm is the canvas's KEYED collection (#568) — decoded as a
    // SortedMap, so its values are already in canonical key order.
    const rows = useMemo(
        () => (value.rows.type === "inline" ? [...value.rows.value.values()] : paged.rows),
        [value.rows, paged.rows],
    );

    // ── Slice chrome (the Table adopter pattern; chrome-only) ─────────────
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const slice = chrome !== undefined ? (chrome.slice as SliceBindValue) : undefined;
    useSliceReactivity(slice?.key);
    const affordances = useMemo(
        () => (chrome !== undefined ? chrome.affordances.map((a: { type: string }) => a.type) : []),
        [chrome],
    );
    const sliceState = slice !== undefined ? slice.read() : undefined;

    // ── Window + resolution: slice state ▸ axis ▸ fit-to-data (§3/§8) ─────
    const axisWindow = useMemo(() => {
        const w = getSomeorUndefined(value.axis.window);
        return w !== undefined ? { min: w.min, max: w.max } : undefined;
    }, [value.axis.window]);
    const sliceRange = useMemo(() => {
        if (sliceState === undefined) return undefined;
        const r = getSomeorUndefined(sliceState.range);
        if (r === undefined || r.type !== "datetime") return undefined;
        const win = r.value as { from: Date; to: Date };
        return win.to.getTime() > win.from.getTime() ? { min: win.from, max: win.to } : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceState is a fresh read each render; useSliceReactivity drives updates
    }, [sliceState?.range]);
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
    const expandBody = useMemo(() => {
        if (ui.focus?.kind !== "expand" || expandRenderFn === undefined) return null;
        try {
            return expandRenderFn({ key: ui.focus.key });
        } catch (err) {
            console.error("[Plan] expandRender resolver failed:", err);
            return null;
        }
    }, [ui.focus, expandRenderFn]);
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
    const onDrill = useMemo(() => getSomeorUndefined(value.onDrill), [value.onDrill]);
    const onGroupToggle = useMemo(() => getSomeorUndefined(value.onGroupToggle), [value.onGroupToggle]);
    const onGrainChange = useMemo(() => getSomeorUndefined(value.onGrainChange), [value.onGrainChange]);

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
                case "emit.drill":
                    if (onDrill) queueMicrotask(() => onDrill({ key: eff.key }));
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
    }, [slice, onSelect, onDrill, onGroupToggle, onGrainChange]);

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
    const gridTemplate = `${gutterW}px 1fr`;
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
    const visible = useMemo(() => visibleRows(index, ui, focusVisibleKeys), [index, ui, focusVisibleKeys]);
    const pinned = useMemo(() => pinnedRows(index), [index]);
    // R2 — the expand branch renders ONLY the focused row; the developer
    // render fills the remaining canvas height (no shrunken context rows).
    const expandRow = focusCtx?.kind === "expand"
        ? visible.find((v) => v.row.key === focusCtx.key)
        : undefined;
    const expandMinH = expandRow !== undefined && expandRow.row.expand.type === "some"
        && expandRow.row.expand.value.height.type === "some"
        ? expandRow.row.expand.value.height.value
        : EXPAND_MIN_H;
    // R1 at scale — the links-focus body elides runs of unrelated rows into
    // gap bands (a lone straggler keeps its rail; see `elideForFocus`).
    const bodyItems = useMemo<PlanBodyItem[]>(
        () => (focusCtx?.kind === "links"
            ? elideForFocus(visible, index, focusCtx)
            : visible.map((row) => ({ kind: "row", row }))),
        [focusCtx, visible, index]);

    const renderVisible = useCallback((v: VisibleRow): React.ReactNode => {
        if (scale === undefined) return null;
        const kind = v.row.kind;
        const h = rowHeight(v, dense, ui.chartsExpanded, focusCtx);
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
                    memberCount={derived.groupMembers.get(v.row.key)} />
            );
        }
        const hasChildren = (index.children.get(v.row.key)?.length ?? 0) > 0;
        const shellBase = {
            row: v.row, styles, gridTemplate, depth: v.depth,
            selected: ui.selected === v.row.key, drilled: v.drilled, cursorFrac,
            controls: rowControls, focusTag, axisMode: axisTag,
        } as const;
        switch (kind.type) {
            case "span": {
                return (
                    <RowShell {...shellBase} height={h}
                        caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                        onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                        <SpanRow rowKey={v.row.key} kind={kind.value} styles={styles}
                            bands={derived.bands.get(v.row.key) ?? []}
                            barHeight={v.collapsed && hasChildren ? 12 : barHeight}
                            storageKey={`${storageKey}.${v.row.key}`} />
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
                            expanded={expanded} rowKey={v.row.key} />
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
                        <HeatCells rowKey={v.row.key} cells={cells} styles={styles} />
                    </RowShell>
                );
            }
            case "buckets":
                return (
                    <RowShell {...shellBase} height={h}
                        caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                        onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                        <BucketsRow rowKey={v.row.key} kind={kind.value} styles={styles}
                            storageKey={`${storageKey}.${v.row.key}`} />
                    </RowShell>
                );
            case "table": {
                // A declared-aggregate parent renders its derived subtotal
                // cells as ONE plain series; leaf rows render their declared
                // series (per-position style, raw cells).
                const derivedCells = derived.tableCells.get(v.row.key);
                const emphasis = kind.value.emphasis.type === "body" ? undefined : kind.value.emphasis.type;
                return (
                    <RowShell {...shellBase} height={h} emphasis={emphasis}
                        caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                        onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                        <TableRowCells rowKey={v.row.key}
                            series={derivedCells !== undefined ? plainSeries(derivedCells) : kind.value.series}
                            split={kind.value.split.type}
                            format={getSomeorUndefined(kind.value.format)} styles={styles} />
                    </RowShell>
                );
            }
            case "cards":
                return (
                    <RowShell {...shellBase} height={h}>
                        <CardsRow rowKey={v.row.key} kind={kind.value} styles={styles}
                            storageKey={`${storageKey}.${v.row.key}`} />
                    </RowShell>
                );
            case "events":
                return (
                    <RowShell {...shellBase} height={h}>
                        <EventsRow rowKey={v.row.key} kind={kind.value} styles={styles}
                            storageKey={`${storageKey}.${v.row.key}`} />
                    </RowShell>
                );
        }
    }, [scale, styles, gridTemplate, dense, ui, index, derived, dispatch, barHeight, storageKey,
        focusCtx, linkedKeys, linkFamily, expandRenderFn]);

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

    if (scale === undefined) {
        return (
            <Box css={styles.root} data-plan-empty padding="20px" fontFamily="mono" fontSize="10px" color="fg.subtle">
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
        <Box background="bg.surface">
            {/* The toolbar is SLICE chrome (§2) — the grain / resolution
                segments ride the slice rail; an unbound canvas has no rail. */}
            {chrome !== undefined && (
                <PlanToolbar styles={styles} slice={slice} affordances={affordances}
                    resolution={scale.resolution} resolutions={resolutions} />
            )}
            {slice !== undefined && affordances.includes("brush") && (
                <HorizonBrush styles={styles} gridTemplate={gridTemplate} slice={slice}
                    window={scale.window} now={now} resolution={scale.resolution} />
            )}
            <PlanRuler styles={styles} gridTemplate={gridTemplate} caption={rulerCaption}
                cursor={ui.cursor !== null && cursorBucket !== undefined
                    ? { frac: ui.cursor.frac, label: cursorBucket.label }
                    : undefined} />
            {focusCtx?.kind !== "expand" && pinned.map((row) => (
                <Box key={row.key} background="bg.surface">
                    {renderVisible({ row, depth: 0, drilled: false, collapsed: false })}
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
                            Enter: { t: "key", key: "enter" },
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
                    {expandRow !== undefined ? (
                        <Box css={styles.root} data-plan-expandfocus
                            {...(frameFills
                                ? { flex: "1 1 auto", minHeight: 0, overflowY: "auto" }
                                : { height, maxHeight })}>
                            {header}
                            {renderVisible(expandRow)}
                            <Box css={styles.expandRender} data-plan-expandrender
                                style={{ minHeight: expandMinH }}>
                                {expandBody !== null && (
                                    <EastChakraComponent value={expandBody}
                                        storageKey={`${storageKey}.${expandRow.row.key}.expand`} />
                                )}
                            </Box>
                            <PlanFooter styles={styles} items={value.footer} />
                        </Box>
                    ) : (
                        <VirtualRows
                            height={frameFills ? undefined : height}
                            maxHeight={frameFills ? undefined : maxHeight}
                            fillParent={frameFills}
                            // Every body item pins an exact height matching
                            // `estimateSize` — `RowShell` sets `height: {h}px`
                            // from the same `rowHeight()`, and the rail / gap
                            // bands pin 11px / 22px in the recipe. Measuring
                            // fixed-height rows drifts under fractional zoom
                            // and paints hairline seams (#533).
                            measureRows={false}
                            header={header}
                            footer={<PlanFooter styles={styles} items={value.footer} />}
                            count={bodyItems.length}
                            estimateSize={(i) => {
                                const item = bodyItems[i];
                                if (item === undefined) return 32;
                                return item.kind === "gap" ? GAP_H : rowHeight(item.row, dense, ui.chartsExpanded, focusCtx);
                            }}
                            renderRow={(i) => {
                                const item = bodyItems[i];
                                if (item === undefined) return null;
                                return item.kind === "gap" ? renderGap(item.gap) : renderVisible(item.row);
                            }}
                            headerZIndex={5}
                            rootCss={styles.root}
                        />
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
