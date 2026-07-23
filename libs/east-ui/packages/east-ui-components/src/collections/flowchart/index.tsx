/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart renderer — the state-transition flowchart per the `Flowchart`
 * design spec. The dimensional contract (node 116×40 r6, 7px handle
 * rings, fixed 6.5px arrowheads butting the rings, dim ladder
 * 1.0 / 0.45 / 0.15, eyebrow 44px, footer 38px, hover 400ms) lives in
 * `layout.ts` + the `flowchart` slot recipe. Colours resolve through the
 * recipe's `--fc-*` variables (theme-aware, dark-mode overrides), whose
 * values mirror the spec's literal DS tokens.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faArrowDown } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Flowchart, Slice as SliceInternal, type UIComponentType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { SliceRailCluster } from "../../slice/rail";
import { SliceDensityContext } from "../../slice/density";
import { parseCssSize } from "../../style/parse-size.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import {
    buildModel, type FlowchartModel, type FlowchartValue, type ModelLink,
} from "./model.js";
import {
    computeLayout, type FlowchartLayout, type LinkRoute,
    BADGE_H, RING_R,
} from "./layout.js";
import { dropTargetAt, existingLink, nearestHandle } from "./connect.js";

const flowchartEqual = equalFor(Flowchart.Types.Flowchart);

export type { FlowchartValue };

type SelectFn = ((key: string) => unknown) | undefined;
type HoverContentFn = (key: string) => ValueTypeOf<UIComponentType>;

export interface EastChakraFlowchartProps {
    value: FlowchartValue;
    storageKey: string;
}

/** All East callbacks route through one funnel: microtask + try/catch. */
function dispatchEast(name: string, run: () => unknown): void {
    queueMicrotask(() => {
        try {
            const out = run();
            if (out instanceof Promise) out.catch(err => console.error(`[Flowchart] ${name} callback failed:`, err));
        } catch (err) {
            console.error(`[Flowchart] ${name} callback failed:`, err);
        }
    });
}

// ── Palette — recipe-defined vars mirroring the spec's DS tokens ──────────
const INK = "var(--fc-ink)";            // planned stroke + badge numerals (--ink-2)
const INK_3 = "var(--fc-ink3)";         // secondary text (--ink-3)
const INK_4 = "var(--fc-ink4)";         // lane headers, legend title (--ink-4)
const PAPER = "var(--fc-paper)";        // card / badge fill (--paper)
const LANE_TINT = "var(--fc-lane)";     // alternating band fill (--paper-2)
const RULE_STRONG = "var(--fc-rule-strong)";
const INFO = "var(--fc-info)";          // observed (--info)
const BRAND = "var(--fc-brand)";        // selection halo (--brand)
const BRAND_D = "var(--fc-brand-d)";    // selection stroke, diamonds (--brand-d)
const BRAND_DD = "var(--fc-brand-dd)";  // selected badge numerals (--brand-dd)
const NEG = "var(--fc-neg)";            // unresolved (--neg)

const CLASS_STROKE = { planned: INK, observed: INFO, unresolved: NEG } as const;
const CLASS_DASH = { planned: undefined, observed: "5 4", unresolved: "4 4" } as const;
const CLASS_MARKER = { planned: "ink", observed: "info", unresolved: "neg" } as const;

const MONO = "var(--chakra-fonts-mono)";

type Hover = { kind: "state" | "link" | "trigger"; key: string } | null;
type Selection = { kind: "state" | "link" | "trigger"; key: string } | null;

const HOVER_OPEN_MS = 400;   // spec: 400ms delay
const HOVER_CLOSE_GRACE_MS = 250;

/** Dim ladder per the spec — three steps only, opacity only. */
const FOCUS = 1.0, CONTEXT = 0.45, FADED = 0.15;

interface DimSets {
    active: boolean;
    restLevel: number;
    nodes: ReadonlySet<string>;
    links: ReadonlySet<string>;
}

const NO_DIM: DimSets = { active: false, restLevel: CONTEXT, nodes: new Set(), links: new Set() };

function computeDim(model: FlowchartModel, hover: Hover): DimSets {
    if (hover === null) return NO_DIM;
    const nodes = new Set<string>();
    const links = new Set<string>();
    if (hover.kind === "state") {
        nodes.add(hover.key);
        for (const l of model.links) {
            if (l.from === hover.key || l.to === hover.key) {
                links.add(l.key);
                nodes.add(l.from);
                nodes.add(l.to);
            }
        }
        return { active: true, restLevel: CONTEXT, nodes, links };
    }
    if (hover.kind === "link") {
        const l = model.links.find(x => x.key === hover.key);
        if (l) { links.add(l.key); nodes.add(l.from); nodes.add(l.to); }
        return { active: true, restLevel: CONTEXT, nodes, links };
    }
    const t = model.triggers.get(hover.key);
    if (t) {
        for (const key of t.governs) {
            links.add(key);
            const l = model.links.find(x => x.key === key);
            if (l) { nodes.add(l.from); nodes.add(l.to); }
        }
        for (const q of t.queue) nodes.add(q);
    }
    return { active: true, restLevel: FADED, nodes, links };
}

/** Ring colour per the spec connector anatomy: brand if any attached link
 * is selected, info if only observed links attach, otherwise ink. */
function portColor(attached: ModelLink[], selectedLink: string | null): string {
    if (attached.some(l => l.key === selectedLink)) return BRAND_D;
    if (attached.length > 0 && attached.every(l => l.cls === "observed")) return INFO;
    if (attached.length > 0 && attached.every(l => l.cls === "unresolved")) return NEG;
    return INK;
}

/** Badge chrome inherits the link class (spec markup: observed = dashed
 * info; selected = solid brand-d border, brand-dd numerals). */
function badgeStyle(cls: ModelLink["cls"], selected: boolean): { stroke: string; dash: string | undefined; text: string } {
    if (selected) return { stroke: BRAND_D, dash: undefined, text: BRAND_DD };
    if (cls === "observed") return { stroke: INFO, dash: "4 3", text: INFO };
    if (cls === "unresolved") return { stroke: NEG, dash: "4 3", text: NEG };
    return { stroke: RULE_STRONG, dash: undefined, text: INK };
}

export const EastChakraFlowchart = memo(function EastChakraFlowchart({ value, storageKey }: EastChakraFlowchartProps) {
    const styles = useSlotRecipe({ key: "flowchart" })();

    // ── decode ────────────────────────────────────────────────────────────
    const model = useMemo(() => buildModel(value), [value]);
    const orientationDefault = (getSomeorUndefined(value.orientation)?.type ?? "LR") as "LR" | "TD";
    const freshness = getSomeorUndefined(value.freshness);
    const legendOn = getSomeorUndefined(value.legend) ?? true;
    const minimapOpt = getSomeorUndefined(value.minimap);
    const density = getSomeorUndefined(value.density)?.type;
    const fixedHeight = parseCssSize(getSomeorUndefined(value.height));
    const maxHeightCss = parseCssSize(getSomeorUndefined(value.maxHeight));
    const linkMode = getSomeorUndefined(value.linkMode)?.type;
    // Runtime edit gate — true suppresses every authoring affordance without
    // unwiring callbacks (permissions / published mode); inspect stays live.
    const readOnly = getSomeorUndefined(value.readOnly) ?? false;

    const onSelectStateFn = useMemo(() => getSomeorUndefined(value.onSelectState) as SelectFn, [value.onSelectState]);
    const onSelectLinkFn = useMemo(() => getSomeorUndefined(value.onSelectLink) as SelectFn, [value.onSelectLink]);
    const onSelectTriggerFn = useMemo(() => getSomeorUndefined(value.onSelectTrigger) as SelectFn, [value.onSelectTrigger]);
    const onTracePathFn = useMemo(() => getSomeorUndefined(value.onTracePath) as SelectFn, [value.onTracePath]);
    const onAddLaneFn = useMemo(() => getSomeorUndefined(value.onAddLane) as (() => unknown) | undefined, [value.onAddLane]);
    const onCreateLinkFn = useMemo(
        () => getSomeorUndefined(value.onCreateLink) as ((e: { from: string; to: string }) => unknown) | undefined,
        [value.onCreateLink]);
    const onDeleteLinkFn = useMemo(() => getSomeorUndefined(value.onDeleteLink) as SelectFn, [value.onDeleteLink]);
    const canConnectFn = useMemo(
        () => getSomeorUndefined(value.canConnect) as ((from: string, to: string) => boolean) | undefined,
        [value.canConnect]);
    const stateHoverFn = useMemo(() => getSomeorUndefined(value.stateHover) as HoverContentFn | undefined, [value.stateHover]);
    const linkHoverFn = useMemo(() => getSomeorUndefined(value.linkHover) as HoverContentFn | undefined, [value.linkHover]);
    const triggerHoverFn = useMemo(() => getSomeorUndefined(value.triggerHover) as HoverContentFn | undefined, [value.triggerHover]);

    // ── slice chrome (compact density — the spec eyebrow, no wide input) ──
    const sliceChrome = getSomeorUndefined(value.slice) as
        | { slice: ValueTypeOf<typeof SliceInternal.Types.Bind>; affordances: ReadonlyArray<{ type: string }> }
        | undefined;
    const sliceHandle = sliceChrome?.slice;
    const sliceVersion = useSliceReactivity(sliceHandle?.key);
    const affordanceKinds = useMemo(() => sliceChrome?.affordances.map(a => a.type) ?? [], [sliceChrome]);
    const sliceRail = useMemo(
        () => (sliceHandle !== undefined
            ? (
                <SliceDensityContext.Provider value="compact">
                    <SliceRailCluster slice={sliceHandle} affordanceKinds={affordanceKinds} />
                </SliceDensityContext.Provider>
            )
            : null),
        // sliceVersion is the reactive trigger for the O(rows) chrome render
        [sliceHandle, affordanceKinds, sliceVersion],
    );
    const sliceTotal = sliceHandle !== undefined ? Number(sliceHandle.totalCount()) : undefined;
    const sliceResult = sliceHandle !== undefined ? Number(sliceHandle.resultCount() ?? sliceHandle.totalCount()) : undefined;

    // ── view state ────────────────────────────────────────────────────────
    const [orientation, setOrientation] = useState<"LR" | "TD">(orientationDefault);
    useEffect(() => { setOrientation(orientationDefault); }, [orientationDefault]);

    const [selection, setSelection] = useState<Selection>(null);
    const selectionRef = useRef<Selection>(null);
    selectionRef.current = selection;
    const readOnlyRef = useRef(false);
    readOnlyRef.current = readOnly;
    const [hover, setHover] = useState<Hover>(null);

    // Hover card — dev-defined content (Schematic contract), 400ms open,
    // 250ms grace close, anchored in body coords.
    const [hoverCard, setHoverCard] = useState<{ kind: "state" | "link" | "trigger"; key: string; ax: number; ay: number } | null>(null);
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelTimers = useCallback(() => {
        if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    }, []);
    useEffect(() => cancelTimers, [cancelTimers]);
    const hoverFnFor = useCallback((kind: "state" | "link" | "trigger") =>
        kind === "state" ? stateHoverFn : kind === "link" ? linkHoverFn : triggerHoverFn,
        [stateHoverFn, linkHoverFn, triggerHoverFn]);
    const scheduleHoverCard = useCallback((kind: "state" | "link" | "trigger", key: string, ax: number, ay: number) => {
        if (hoverFnFor(kind) === undefined) return;
        cancelTimers();
        openTimer.current = setTimeout(() => {
            openTimer.current = null;
            setHoverCard({ kind, key, ax, ay });
        }, HOVER_OPEN_MS);
    }, [cancelTimers, hoverFnFor]);
    const scheduleHoverClose = useCallback(() => {
        if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current !== null) return;
        closeTimer.current = setTimeout(() => {
            closeTimer.current = null;
            setHoverCard(null);
        }, HOVER_CLOSE_GRACE_MS);
    }, []);
    const cancelHoverClose = useCallback(() => {
        if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    }, []);
    // Evaluate the builder ONCE per open card; a throwing builder logs and
    // renders nothing rather than unmounting the flowchart.
    const hoverContent = useMemo(() => {
        if (hoverCard === null) return null;
        const fn = hoverFnFor(hoverCard.kind);
        if (fn === undefined) return null;
        try {
            return fn(hoverCard.key);
        } catch (err) {
            console.error("[Flowchart] hover content builder failed:", err);
            return null;
        }
    }, [hoverCard, hoverFnFor]);

    // Connect-drag draft (one object; pure helpers live in connect.ts).
    const [draft, setDraft] = useState<{
        from: string; side: "left" | "right" | "top" | "bottom";
        x: number; y: number; over: string | null; allowed: boolean; dup: string | undefined;
    } | null>(null);
    const draftRef = useRef<typeof draft>(null);
    draftRef.current = draft;
    // One pulse mechanism for both outcomes: a drop that would duplicate an
    // existing link pulses IT; a successful create pulses the new link once
    // its row arrives. Matched by endpoints, auto-cleared.
    const [pulse, setPulse] = useState<{ from: string; to: string; seq: number } | null>(null);
    useEffect(() => {
        if (pulse === null) return;
        const t = setTimeout(() => setPulse(null), 1100);
        return () => clearTimeout(t);
    }, [pulse]);

    // ── measure ───────────────────────────────────────────────────────────
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    useLayoutEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const layout: FlowchartLayout | null = useMemo(
        () => (size === null ? null : computeLayout(model, {
            width: size.w,
            orientation,
            legendPad: legendOn ? 122 : 0,
            minHeight: fixedHeight !== undefined && size.h > 0 ? size.h : undefined,
        })),
        [model, size, orientation, legendOn, fixedHeight],
    );

    // ── dim ladder ────────────────────────────────────────────────────────
    const dim = useMemo(() => computeDim(model, hover), [model, hover]);
    const nodeOpacity = (key: string): number => (!dim.active ? FOCUS : dim.nodes.has(key) ? FOCUS : dim.restLevel);
    const linkOpacity = (key: string): number => (!dim.active ? FOCUS : dim.links.has(key) ? FOCUS : dim.restLevel);
    const selectedLink = selection?.kind === "link" ? selection.key : null;
    const fade = (on: boolean): string | undefined => (on ? "opacity 150ms ease" : undefined);

    // ── interactions ──────────────────────────────────────────────────────
    const select = useCallback((sel: Selection) => {
        setSelection(sel);
        if (sel === null) return;
        if (sel.kind === "state" && onSelectStateFn) dispatchEast("onSelectState", () => onSelectStateFn(sel.key));
        if (sel.kind === "link" && onSelectLinkFn) dispatchEast("onSelectLink", () => onSelectLinkFn(sel.key));
        if (sel.kind === "trigger" && onSelectTriggerFn) dispatchEast("onSelectTrigger", () => onSelectTriggerFn(sel.key));
    }, [onSelectStateFn, onSelectLinkFn, onSelectTriggerFn]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") {
                // Spec: esc restores everything instantly.
                setSelection(null);
                setHover(null);
                setHoverCard(null);
                setDraft(null);
            } else if ((e.key === "Delete" || e.key === "Backspace") && selectionRef.current?.kind === "link" && onDeleteLinkFn && !readOnlyRef.current) {
                const key = selectionRef.current.key;
                dispatchEast("onDeleteLink", () => onDeleteLinkFn(key));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onDeleteLinkFn]);

    const canConnect = useCallback((from: string, to: string): boolean => {
        if (from === to) return false;         // self-loops never use handles
        if (!canConnectFn) return true;
        try {
            return canConnectFn(from, to) !== false;
        } catch (err) {
            console.error("[Flowchart] canConnect failed (allowing):", err);
            return true;                        // fail-open per spec
        }
    }, [canConnectFn]);

    const svgPoint = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
        const el = bodyRef.current?.querySelector("[data-flowchart-canvas]");
        const r = el?.getBoundingClientRect();
        return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
    }, []);

    const beginDraft = useCallback((from: string, side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => {
        if (linkMode === undefined || readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        const p = svgPoint(e);
        setDraft({ from, side, x: p.x, y: p.y, over: null, allowed: false, dup: undefined });
        const move = (ev: PointerEvent): void => {
            const q = svgPoint(ev);
            const fromKey = draftRef.current?.from ?? from;
            // The WHOLE node (plus DROP_PAD) is the target — nobody has to
            // land a 7px ring.
            const over = layout ? dropTargetAt(layout, q, fromKey) : null;
            const dup = over !== null ? existingLink(model, fromKey, over) : undefined;
            const allowed = over !== null && dup === undefined && canConnect(fromKey, over);
            setDraft(d => (d === null ? d : { ...d, x: q.x, y: q.y, over, allowed, dup }));
        };
        const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            const d = draftRef.current;
            setDraft(null);
            if (!d || d.over === null) return;
            if (d.dup !== undefined) {
                // Already connected — absorb the drop and pulse the existing link.
                setPulse(p => ({ from: d.from, to: d.over!, seq: (p?.seq ?? 0) + 1 }));
                return;
            }
            if (d.allowed && onCreateLinkFn) {
                const payload = { from: d.from, to: d.over };
                dispatchEast("onCreateLink", () => onCreateLinkFn(payload));
                setPulse(p => ({ from: d.from, to: d.over!, seq: (p?.seq ?? 0) + 1 }));
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [linkMode, readOnly, svgPoint, layout, model, canConnect, onCreateLinkFn]);

    // ── render helpers ────────────────────────────────────────────────────
    const linksByKey = useMemo(() => new Map(model.links.map(l => [l.key, l])), [model]);
    const showMinimap = minimapOpt ?? model.nodes.length >= 25;

    // dashed renders over solid; selected on top.
    const orderedRoutes = useMemo(() => {
        if (!layout) return [];
        const solid: LinkRoute[] = [], dashed: LinkRoute[] = [], selected: LinkRoute[] = [];
        for (const r of layout.routes) {
            const l = linksByKey.get(r.key);
            if (!l) continue;
            if (r.key === selectedLink) selected.push(r);
            else if (l.cls === "planned") solid.push(r);
            else dashed.push(r);
        }
        return [...solid, ...dashed, ...selected];
    }, [layout, linksByKey, selectedLink]);

    if (model.nodes.length === 0 && model.links.length === 0) {
        return <Box css={styles.root} data-flowchart-root style={{ height: fixedHeight, maxHeight: maxHeightCss }} />;
    }

    const eyebrow = (
        <Box css={styles.eyebrow} data-flowchart-eyebrow>
            <Box css={styles.eyebrowLeft}>{sliceRail}</Box>
            <Box css={styles.eyebrowRight}>
                <Box css={styles.orientationSegment} role="group" aria-label="Orientation">
                    <button
                        type="button"
                        data-active={orientation === "LR" || undefined}
                        onClick={() => setOrientation("LR")}
                    ><FontAwesomeIcon icon={faArrowRight} style={{ fontSize: "9px" }} /> LR</button>
                    <button
                        type="button"
                        data-active={orientation === "TD" || undefined}
                        onClick={() => setOrientation("TD")}
                    ><FontAwesomeIcon icon={faArrowDown} style={{ fontSize: "9px" }} /> TD</button>
                </Box>
                {freshness !== undefined && (
                    <Box css={styles.freshnessChip}>
                        <Box as="span" css={styles.freshnessDot} />
                        <Box as="span">{freshness.label}</Box>
                        {getSomeorUndefined(freshness.date) !== undefined && (
                            <Box as="span" css={styles.freshnessDate}>
                                {getSomeorUndefined(freshness.date)!.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" })}
                            </Box>
                        )}
                    </Box>
                )}
            </Box>
        </Box>
    );

    // Footer counts narrowed ROWS (the slice feed), not rendered arrows —
    // self-loop folding and ghost derivation are rendering, not narrowing.
    const rowCount = value.links.length;
    const narrowed = sliceTotal !== undefined && sliceResult !== undefined && sliceResult < sliceTotal;
    const pct = narrowed ? Math.round((1 - sliceResult / sliceTotal) * 100) : undefined;
    const footer = (
        <Box css={styles.footer} data-flowchart-footer>
            <Box as="span" css={styles.footerStrong}>{rowCount}</Box>
            <Box as="span">{rowCount === 1 ? "link" : "links"}</Box>
            {narrowed && (
                <>
                    <Box as="span">· narrowed from {sliceTotal.toLocaleString()} ·</Box>
                    <Box as="span" css={styles.footerNeg}>−{pct}%</Box>
                </>
            )}
            <Box css={styles.footerSplit}>
                {model.counts.planned} planned · {model.counts.observed} observed
                {model.counts.unresolved > 0 ? ` · ${model.counts.unresolved} unresolved` : ""}
            </Box>
        </Box>
    );

    const bodyAutoHeight = fixedHeight === undefined && layout !== null ? layout.height : undefined;
    const body = (
        <Box
            ref={bodyRef}
            css={styles.body}
            data-flowchart-body
            style={bodyAutoHeight !== undefined ? { height: bodyAutoHeight, flex: "0 0 auto" } : undefined}
        >
            {layout !== null && (
                <Box css={styles.scroll}>
                    <Box css={styles.canvasWrap} style={{ width: layout.width, height: layout.height }}>
                        <svg
                            data-flowchart-canvas
                            width={layout.width}
                            height={layout.height}
                            viewBox={`0 0 ${layout.width} ${layout.height}`}
                            style={{ position: "absolute", inset: 0, display: "block" }}
                        >
                            <defs>
                                {/* Fixed 12px filled arrowheads — the spec sheet's visual
                                    size — userSpaceOnUse so they never scale with stroke;
                                    refX 10 puts the TIP exactly at the path end, which is
                                    trimmed to the ring edge. */}
                                {([["ink", INK], ["info", INFO], ["neg", NEG], ["brand", BRAND_D]] as const).map(([id, color]) => (
                                    <marker key={id} id={`fc-mk-${id}-${storageKey}`} viewBox="0 0 10 10" refX={10} refY={5}
                                        markerWidth={12} markerHeight={12} markerUnits="userSpaceOnUse" orient="auto">
                                        <path d="M0 0L10 5L0 10z" fill={color} />
                                    </marker>
                                ))}
                            </defs>

                            {/* lane bands — alternating paper-2 tint */}
                            {layout.lanes.map(lane => lane.tinted && (
                                <rect key={lane.key} x={lane.x} y={lane.y} width={lane.w} height={lane.h} fill={LANE_TINT} />
                            ))}
                            {/* lane headers — mono 10/600 ls 2.2 ink-4 (inline styles:
                                presentation attributes lose to the app CSS reset) */}
                            {layout.lanes.map(lane => (
                                layout.orientation === "TD"
                                    ? (
                                        <text key={lane.key} x={12} y={lane.y + 24} textAnchor="start"
                                            style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "2.2px", fill: INK_4 }}>
                                            {lane.label.toUpperCase()}
                                        </text>
                                    )
                                    : (
                                        <text key={lane.key} x={lane.cx} y={26} textAnchor="middle"
                                            style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "2.2px", fill: INK_4 }}>
                                            {lane.label.toUpperCase()}
                                        </text>
                                    )
                            ))}
                            {/* + LANE tail affordance — only when the host can add lanes */}
                            {onAddLaneFn !== undefined && !readOnly && (
                                <g
                                    data-flowchart-addlane
                                    style={{ cursor: "pointer" }}
                                    onClick={() => dispatchEast("onAddLane", () => onAddLaneFn())}
                                >
                                    {/* transparent (not none) fill — the whole affordance is clickable */}
                                    <rect x={layout.laneTail.x} y={layout.laneTail.y} width={layout.laneTail.w} height={layout.laneTail.h}
                                        rx={6} fill="transparent" stroke={RULE_STRONG} strokeDasharray="4 4" />
                                    <text x={layout.laneTail.x + layout.laneTail.w / 2} y={layout.laneTail.y + 30} textAnchor="middle"
                                        style={{ fontSize: 14, fill: INK_4 }}>+</text>
                                    <text x={layout.laneTail.x + layout.laneTail.w / 2} y={layout.laneTail.y + 52} textAnchor="middle"
                                        style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "2px", fill: INK_4 }}>LANE</text>
                                </g>
                            )}

                            {/* links — solid, then dashed (dashed renders over solid), selected last */}
                            <g data-flowchart-links>
                                {orderedRoutes.map(r => {
                                    const l = linksByKey.get(r.key)!;
                                    const isSel = r.key === selectedLink;
                                    const op = linkOpacity(r.key);
                                    return (
                                        <g key={r.key} style={{ opacity: op, transition: fade(dim.active) }}>
                                            {isSel && (
                                                <path d={r.d} fill="none" stroke={BRAND} strokeWidth={9} opacity={0.16} strokeLinecap="round" />
                                            )}
                                            <path
                                                d={r.d}
                                                fill="none"
                                                stroke={isSel ? BRAND_D : CLASS_STROKE[l.cls]}
                                                strokeWidth={isSel ? 3 : l.weight}
                                                strokeDasharray={CLASS_DASH[l.cls]}
                                                markerEnd={`url(#fc-mk-${isSel ? "brand" : CLASS_MARKER[l.cls]}-${storageKey})`}
                                            />
                                            <path
                                                d={r.d}
                                                data-flowchart-link={r.key}
                                                fill="none"
                                                stroke="transparent"
                                                strokeWidth={12}
                                                style={{ cursor: "pointer" }}
                                                onPointerEnter={e => {
                                                    setHover({ kind: "link", key: r.key });
                                                    const p = svgPoint(e);
                                                    scheduleHoverCard("link", r.key, p.x, p.y);
                                                }}
                                                onPointerLeave={() => { setHover(null); scheduleHoverClose(); }}
                                                onClick={e => {
                                                    if (e.altKey && onTracePathFn) {
                                                        dispatchEast("onTracePath", () => onTracePathFn(r.key));
                                                        return;
                                                    }
                                                    select({ kind: "link", key: r.key });
                                                }}
                                            />
                                        </g>
                                    );
                                })}
                            </g>

                            {/* decision diamonds at longest-run midpoints */}
                            {orderedRoutes.map(r => {
                                const l = linksByKey.get(r.key)!;
                                const trigger = l.trigger !== undefined ? model.triggers.get(l.trigger) : undefined;
                                if (trigger === undefined) return null;
                                return (
                                    <g key={`dia-${r.key}`} style={{ opacity: linkOpacity(r.key), transition: fade(dim.active) }}>
                                        <g
                                            data-flowchart-trigger={trigger.key}
                                            transform={`translate(${r.mid.x},${r.mid.y}) rotate(45)`}
                                            style={{ cursor: "pointer" }}
                                            onPointerEnter={e => {
                                                setHover({ kind: "trigger", key: trigger.key });
                                                const p = svgPoint(e);
                                                scheduleHoverCard("trigger", trigger.key, p.x, p.y);
                                            }}
                                            onPointerLeave={() => { setHover(null); scheduleHoverClose(); }}
                                            onClick={() => select({ kind: "trigger", key: trigger.key })}
                                        >
                                            <rect x={-8} y={-8} width={16} height={16} rx={3} fill={PAPER} stroke={BRAND_D} strokeWidth={1.4} />
                                            <text transform="rotate(-45)" y={3.5} textAnchor="middle"
                                                style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, fill: BRAND_D }}>
                                                {trigger.letter}
                                            </text>
                                        </g>
                                    </g>
                                );
                            })}

                            {/* evidence badges — collision-resolved in layout; chrome
                                inherits the link class; numerals mono tabular ink */}
                            {orderedRoutes.map(r => {
                                const l = linksByKey.get(r.key)!;
                                if (l.badgeText === undefined || r.badge === undefined) return null;
                                const w = l.badgeText.length * 5.8 + 14;
                                const bs = badgeStyle(l.cls, r.key === selectedLink);
                                return (
                                    // Ornament, not a control — pointer-transparent so the
                                    // link's hit path beneath stays hoverable.
                                    <g key={`bdg-${r.key}`}
                                        style={{ opacity: linkOpacity(r.key), transition: fade(dim.active), pointerEvents: "none" }}
                                        transform={`translate(${r.badge.x},${r.badge.y})`}>
                                        <rect x={-w / 2} y={-BADGE_H / 2} width={w} height={BADGE_H} rx={4}
                                            fill={PAPER} stroke={bs.stroke} strokeWidth={1} strokeDasharray={bs.dash} />
                                        <text y={3.5} textAnchor="middle"
                                            style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, fill: bs.text, fontVariantNumeric: "tabular-nums" }}>
                                            {l.badgeText}
                                        </text>
                                    </g>
                                );
                            })}

                        </svg>

                        {/* node cards — HTML above the SVG */}
                        {[...layout.nodes.values()].map(rect => {
                            const nm = model.nodesByKey.get(rect.key);
                            if (!nm) return null;
                            const isSel = selection?.kind === "state" && selection.key === rect.key;
                            return (
                                <Box
                                    key={rect.key}
                                    data-flowchart-node={rect.key}
                                    css={nm.ghost ? styles.ghostNode : styles.node}
                                    data-selected={isSel || undefined}
                                    style={{
                                        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                                        opacity: nodeOpacity(rect.key),
                                        transition: fade(dim.active),
                                    }}
                                    onPointerEnter={e => {
                                        setHover({ kind: "state", key: rect.key });
                                        const p = svgPoint(e);
                                        scheduleHoverCard("state", rect.key, p.x, p.y);
                                    }}
                                    onPointerLeave={() => { setHover(null); scheduleHoverClose(); }}
                                    onClick={() => select({ kind: "state", key: rect.key })}
                                >
                                    <Box css={styles.nodeCode}>
                                        {rect.key}
                                        {nm.members !== undefined && <Box as="span" css={styles.nodeBadge}>×{String(nm.members)}</Box>}
                                        {nm.inPlace > 0 && <Box as="span" css={styles.nodeBadge}>↻ {nm.inPlace}</Box>}
                                    </Box>
                                    {nm.label !== undefined && <Box css={styles.nodeLabel}>{nm.label}</Box>}
                                </Box>
                            );
                        })}

                        {/* connector overlay — ABOVE the node borders per the spec's
                            z-order (below hover cards); rings on occupied handles, all
                            four revealed on hover/selection, 16×16 hit targets on the
                            out-handles when authoring is enabled */}
                        <svg
                            width={layout.width}
                            height={layout.height}
                            viewBox={`0 0 ${layout.width} ${layout.height}`}
                            style={{ position: "absolute", inset: 0, display: "block", pointerEvents: "none" }}
                        >
                            {[...layout.nodes.values()].map(rect => {
                                const nodeActive = (hover?.kind === "state" && hover.key === rect.key)
                                    || (selection?.kind === "state" && selection.key === rect.key)
                                    || draft !== null;
                                const occupied = layout.handles.get(rect.key) ?? [];
                                const occupiedSides = new Set(occupied.map(h => h.side));
                                const extra = nodeActive
                                    ? (["left", "right", "top", "bottom"] as const).filter(s => !occupiedSides.has(s))
                                    : [];

                                return (
                                    <g key={`ports-${rect.key}`} style={{ opacity: nodeOpacity(rect.key), transition: fade(dim.active) }}>
                                        {/* invisible 16×16 hit targets — ANY handle is the
                                            drag-to-connect affordance */}
                                        {linkMode !== undefined && !readOnly && (["left", "right", "top", "bottom"] as const).map(side => (
                                            <circle
                                                key={`hit-${side}`}
                                                cx={rect[side].x} cy={rect[side].y} r={8}
                                                fill="transparent"
                                                style={{ pointerEvents: "all", cursor: "crosshair" }}
                                                onPointerEnter={() => setHover({ kind: "state", key: rect.key })}
                                                onPointerDown={(e) => beginDraft(rect.key, side, e)}
                                            />
                                        ))}
                                        {occupied.map(h => {
                                            const attached = h.links.map(k => linksByKey.get(k)).filter((x): x is ModelLink => x !== undefined);
                                            const r = nodeActive ? 4.5 : RING_R;
                                            return (
                                                <circle
                                                    key={h.side}
                                                    cx={h.pt.x} cy={h.pt.y} r={r}
                                                    fill={PAPER}
                                                    stroke={portColor(attached, selectedLink)}
                                                    strokeWidth={1.4}
                                                />
                                            );
                                        })}
                                        {extra.map(side => (
                                            <circle
                                                key={side}
                                                cx={rect[side].x} cy={rect[side].y} r={4.5}
                                                fill={PAPER}
                                                stroke={INK}
                                                strokeWidth={1.4}
                                            />
                                        ))}
                                    </g>
                                );
                            })}

                            {/* connect draft */}
                            {draft !== null && (() => {
                                const from = layout.nodes.get(draft.from);
                                if (!from) return null;
                                const start = from[draft.side];
                                const target = draft.over !== null ? layout.nodes.get(draft.over) : undefined;
                                const landable = draft.allowed || draft.dup !== undefined;
                                const end = target !== undefined && landable
                                    ? nearestHandle(target, { x: draft.x, y: draft.y })
                                    : { x: draft.x, y: draft.y };
                                return (
                                    <g>
                                        <path
                                            d={`M${start.x} ${start.y} L${end.x} ${end.y}`}
                                            fill="none"
                                            stroke={draft.over !== null && !landable ? NEG : BRAND_D}
                                            strokeWidth={1.6}
                                            strokeDasharray="5 4"
                                        />
                                        {draft.over !== null && !landable && (
                                            <text x={draft.x + 10} y={draft.y - 6} style={{ fontSize: 12, fill: NEG }}>⊘</text>
                                        )}
                                    </g>
                                );
                            })()}

                            {/* one-shot connection pulse — the existing link on a
                                duplicate drop, or the new link once its row arrives;
                                SMIL restarts per seq via the element key */}
                            {pulse !== null && orderedRoutes.map(r => {
                                const l = linksByKey.get(r.key);
                                if (!l || l.from !== pulse.from || l.to !== pulse.to) return null;
                                return (
                                    // CSS keyframe (not SMIL — whose begin is relative to
                                    // the SVG document timeline, so late-inserted animates
                                    // never play): starts on mount, restarts per seq key.
                                    <path
                                        key={`pulse-${pulse.seq}-${r.key}`}
                                        d={r.d}
                                        fill="none"
                                        stroke={BRAND}
                                        strokeWidth={11}
                                        strokeLinecap="round"
                                        opacity={0}
                                        style={{ pointerEvents: "none", animation: "fc-connect-pulse 0.9s ease-out forwards" }}
                                    />
                                );
                            })}
                        </svg>

                        {/* legend — planned / observed / trigger / in-place */}
                        {legendOn && (
                            <Box css={styles.legend} data-flowchart-legend>
                                <Box css={styles.legendTitle}>Legend</Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={INK} strokeWidth={2} /></svg>
                                    <span>Planned</span>
                                </Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={INFO} strokeWidth={1.6} strokeDasharray="5 4" /></svg>
                                    <span>Observed</span>
                                </Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={12}>
                                        <rect x={9} y={1} width={10} height={10} rx={2} transform="rotate(45 14 6)" fill={PAPER} stroke={BRAND_D} strokeWidth={1.2} />
                                    </svg>
                                    <span>Decision trigger</span>
                                </Box>
                                <Box css={styles.legendRow}>
                                    <Box as="span" css={styles.nodeBadge}>↻ n</Box>
                                    <span>In-place transition</span>
                                </Box>
                            </Box>
                        )}

                        {/* minimap */}
                        {showMinimap && (
                            <Box css={styles.minimap} data-flowchart-minimap>
                                <svg width={96} height={64} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet">
                                    {[...layout.nodes.values()].map(r => (
                                        <rect key={r.key} x={r.x} y={r.y} width={r.w} height={r.h} rx={8}
                                            fill="none" stroke={INK_3} strokeWidth={6} />
                                    ))}
                                </svg>
                            </Box>
                        )}
                    </Box>
                </Box>
            )}

            {/* hover card — dev-defined content in the standard shell */}
            {hoverCard !== null && hoverContent !== null && layout !== null && (
                <Box
                    css={styles.hoverCard}
                    data-flowchart-hovercard
                    style={{ left: Math.min(hoverCard.ax + 14, Math.max(0, (size?.w ?? 320) - 300)), top: hoverCard.ay + 14 }}
                    onPointerEnter={cancelHoverClose}
                    onPointerLeave={scheduleHoverClose}
                >
                    <EastChakraComponent value={hoverContent} storageKey={`${storageKey}.hover.${hoverCard.kind}`} />
                </Box>
            )}
        </Box>
    );

    return (
        <Box
            css={styles.root}
            data-flowchart-root
            data-density={density}
            style={{ height: fixedHeight, maxHeight: maxHeightCss ?? fixedHeight }}
        >
            {eyebrow}
            {body}
            {footer}
        </Box>
    );
}, (prev, next) => flowchartEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
