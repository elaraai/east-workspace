/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart renderer — the state-transition flowchart per the `Flowchart`
 * design spec. Spec compliance notes are inline; the dimensional contract
 * (node 116×40 r6, handles 7px r3.5, arrowheads 6.5px, dim ladder
 * 1.0 / 0.45 / 0.15, eyebrow 44px, footer 38px, hover 400ms) lives in
 * `layout.ts` + the `flowchart` slot recipe.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Flowchart, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { SliceRailCluster } from "../../slice/rail";
import { parseCssSize } from "../../style/parse-size.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import {
    buildModel, type FlowchartModel, type FlowchartValue, type ModelLink,
} from "./model.js";
import {
    computeLayout, type FlowchartLayout, type LinkRoute,
} from "./layout.js";

const flowchartEqual = equalFor(Flowchart.Types.Flowchart);

export type { FlowchartValue };

/** Decoded East function props. */
type SelectFn = ((key: string) => unknown) | undefined;

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

// ── Spec palette (CSS vars — SVG consumes them directly, theme-reactive) ──
const INK = "var(--chakra-colors-fg)";                    // planned stroke (spec --ink-2)
const INK_MUTED = "var(--chakra-colors-fg-muted)";
const INK_SUBTLE = "var(--chakra-colors-fg-subtle)";      // lane headers (spec --ink-4)
const PAPER = "var(--chakra-colors-bg-surface)";
const PAPER_2 = "var(--chakra-colors-bg-panel)";          // lane tint (spec --paper-2)
const RULE_STRONG = "var(--chakra-colors-border-strong)";
const BRAND = "var(--chakra-colors-brand-500)";
const BRAND_D = "var(--chakra-colors-brand-600)";         // observed / info + selection
const NEG = "var(--chakra-colors-status-neg)";            // unresolved
const WARN = "var(--chakra-colors-status-warn)";

/** Spec line classes → stroke + dash. Observed = dashed 5/4 info;
 * unresolved = dashed 4/4 neg; selected = brand + halo (drawn extra). */
const CLASS_STROKE = { planned: INK, observed: BRAND_D, unresolved: NEG } as const;
const CLASS_DASH = { planned: undefined, observed: "5 4", unresolved: "4 4" } as const;
const CLASS_MARKER = { planned: "ink", observed: "info", unresolved: "neg" } as const;

type Hover =
    | { kind: "state" | "link" | "trigger"; key: string }
    | null;
type Selection =
    | { kind: "state" | "link" | "trigger"; key: string }
    | null;

const HOVER_OPEN_MS = 400;   // spec: 400ms delay
const HOVER_CLOSE_GRACE_MS = 250;

/** Dim ladder per the spec — three steps only, opacity only. */
const FOCUS = 1.0, CONTEXT = 0.45, FADED = 0.15;

interface DimSets {
    active: boolean;
    /** faded level when active and not focused: CONTEXT or FADED */
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
        // Node: the node, its links and direct neighbours at focus, rest at context.
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
        // Link: the link + both endpoints at focus, rest at context.
        const l = model.links.find(x => x.key === hover.key);
        if (l) { links.add(l.key); nodes.add(l.from); nodes.add(l.to); }
        return { active: true, restLevel: CONTEXT, nodes, links };
    }
    // Trigger diamond: every link it governs (plus queue and outcome nodes)
    // at focus, rest FADED.
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
    if (attached.length > 0 && attached.every(l => l.cls === "observed")) return BRAND_D;
    if (attached.some(l => l.cls === "unresolved") && attached.every(l => l.cls === "unresolved")) return NEG;
    return INK;
}

function fmtVolume(v: number): string {
    return v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtCount(n: bigint): string {
    return Number(n).toLocaleString();
}

function fmtDate(d: Date): string {
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" });
}

export const EastChakraFlowchart = memo(function EastChakraFlowchart({ value, storageKey }: EastChakraFlowchartProps) {
    const styles = useSlotRecipe({ key: "flowchart" })();

    // ── decode ────────────────────────────────────────────────────────────
    const model = useMemo(() => buildModel(value), [value]);
    const orientationDefault = (getSomeorUndefined(value.orientation)?.type ?? "LR") as "LR" | "TD";
    const freshness = getSomeorUndefined(value.freshness);
    const inspectorMode = getSomeorUndefined(value.inspector)?.type ?? "float";
    const legendOn = getSomeorUndefined(value.legend) ?? true;
    const minimapOpt = getSomeorUndefined(value.minimap);
    const density = getSomeorUndefined(value.density)?.type;
    const fixedHeight = parseCssSize(getSomeorUndefined(value.height));
    const maxHeightCss = parseCssSize(getSomeorUndefined(value.maxHeight));
    const linkMode = getSomeorUndefined(value.linkMode)?.type;

    const onSelectStateFn = useMemo(() => getSomeorUndefined(value.onSelectState) as SelectFn, [value.onSelectState]);
    const onSelectLinkFn = useMemo(() => getSomeorUndefined(value.onSelectLink) as SelectFn, [value.onSelectLink]);
    const onSelectTriggerFn = useMemo(() => getSomeorUndefined(value.onSelectTrigger) as SelectFn, [value.onSelectTrigger]);
    const onTracePathFn = useMemo(() => getSomeorUndefined(value.onTracePath) as SelectFn, [value.onTracePath]);
    const onCreateLinkFn = useMemo(
        () => getSomeorUndefined(value.onCreateLink) as ((e: { from: string; to: string }) => unknown) | undefined,
        [value.onCreateLink]);
    const onDeleteLinkFn = useMemo(() => getSomeorUndefined(value.onDeleteLink) as SelectFn, [value.onDeleteLink]);
    const canConnectFn = useMemo(
        () => getSomeorUndefined(value.canConnect) as ((from: string, to: string) => boolean) | undefined,
        [value.canConnect]);

    // ── slice chrome ──────────────────────────────────────────────────────
    const sliceChrome = getSomeorUndefined(value.slice) as
        | { slice: ValueTypeOf<typeof SliceInternal.Types.Bind>; affordances: ReadonlyArray<{ type: string }> }
        | undefined;
    const sliceHandle = sliceChrome?.slice;
    const sliceVersion = useSliceReactivity(sliceHandle?.key);
    const affordanceKinds = useMemo(() => sliceChrome?.affordances.map(a => a.type) ?? [], [sliceChrome]);
    const sliceRail = useMemo(
        () => (sliceHandle !== undefined ? <SliceRailCluster slice={sliceHandle} affordanceKinds={affordanceKinds} /> : null),
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
    const [hover, setHover] = useState<Hover>(null);
    const hoverRef = useRef<Hover>(null);
    hoverRef.current = hover;

    // Hover card (400ms open, 250ms grace close), anchored in body coords.
    const [hoverCard, setHoverCard] = useState<{ kind: "state" | "link" | "trigger"; key: string; ax: number; ay: number } | null>(null);
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelTimers = useCallback(() => {
        if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    }, []);
    useEffect(() => cancelTimers, [cancelTimers]);
    const scheduleHoverCard = useCallback((kind: "state" | "link" | "trigger", key: string, ax: number, ay: number) => {
        cancelTimers();
        openTimer.current = setTimeout(() => {
            openTimer.current = null;
            setHoverCard({ kind, key, ax, ay });
        }, HOVER_OPEN_MS);
    }, [cancelTimers]);
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

    // Connect-drag draft.
    const [draft, setDraft] = useState<{ from: string; x: number; y: number; over: string | null; allowed: boolean } | null>(null);
    const draftRef = useRef<typeof draft>(null);
    draftRef.current = draft;

    // ── measure ───────────────────────────────────────────────────────────
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState<{ w: number } | null>(null);
    useLayoutEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const measure = (): void => setSize({ w: el.clientWidth });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const layout: FlowchartLayout | null = useMemo(
        () => (size === null ? null : computeLayout(model, {
            width: size.w,
            orientation,
            legendPad: (getSomeorUndefined(value.legend) ?? true) ? 122 : 0,
        })),
        [model, size, orientation, value.legend],
    );

    // ── dim ladder ────────────────────────────────────────────────────────
    const dim = useMemo(() => computeDim(model, hover), [model, hover]);
    const nodeOpacity = (key: string): number => (!dim.active ? FOCUS : dim.nodes.has(key) ? FOCUS : dim.restLevel);
    const linkOpacity = (key: string): number => (!dim.active ? FOCUS : dim.links.has(key) ? FOCUS : dim.restLevel);
    const selectedLink = selection?.kind === "link" ? selection.key : null;

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
            } else if ((e.key === "Delete" || e.key === "Backspace") && selectionRef.current?.kind === "link" && onDeleteLinkFn) {
                const key = selectionRef.current.key;
                dispatchEast("onDeleteLink", () => onDeleteLinkFn(key));
            } else if (e.key === "Enter" && hoverRef.current !== null) {
                // ⏎ routes to the inspector.
                const h = hoverRef.current;
                setHoverCard(null);
                setSelection({ kind: h.kind, key: h.key });
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

    const beginDraft = useCallback((from: string, e: React.PointerEvent) => {
        if (linkMode === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        const p = svgPoint(e);
        setDraft({ from, x: p.x, y: p.y, over: null, allowed: false });
        const move = (ev: PointerEvent): void => {
            const q = svgPoint(ev);
            const l = layout;
            let over: string | null = null;
            if (l) {
                for (const [key, r] of l.nodes) {
                    if (q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h) { over = key; break; }
                }
            }
            const fromKey = draftRef.current?.from ?? from;
            const allowed = over !== null && canConnect(fromKey, over);
            setDraft(d => (d === null ? d : { ...d, x: q.x, y: q.y, over, allowed }));
        };
        const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            const d = draftRef.current;
            setDraft(null);
            if (d && d.over !== null && d.allowed && onCreateLinkFn) {
                const payload = { from: d.from, to: d.over };
                dispatchEast("onCreateLink", () => onCreateLinkFn(payload));
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [linkMode, svgPoint, layout, canConnect, onCreateLinkFn]);

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
                    >→ LR</button>
                    <button
                        type="button"
                        data-active={orientation === "TD" || undefined}
                        onClick={() => setOrientation("TD")}
                    >↓ TD</button>
                </Box>
                {freshness !== undefined && (
                    <Box css={styles.freshnessChip}>
                        <Box as="span" css={styles.freshnessDot} />
                        <Box as="span">{freshness.label}</Box>
                        {getSomeorUndefined(freshness.date) !== undefined && (
                            <Box as="span" css={styles.freshnessDate}>{fmtDate(getSomeorUndefined(freshness.date)!)}</Box>
                        )}
                    </Box>
                )}
            </Box>
        </Box>
    );

    // "narrowed from M" reads the SLICE's result-vs-total (self-loop folding
    // and ghost derivation are rendering, not narrowing).
    const narrowed = sliceTotal !== undefined && sliceResult !== undefined && sliceResult < sliceTotal;
    const pct = narrowed ? Math.round((1 - sliceResult / sliceTotal) * 100) : undefined;
    const footer = (
        <Box css={styles.footer} data-flowchart-footer>
            <Box as="span" css={styles.footerStrong}>{model.counts.total}</Box>
            <Box as="span">{model.counts.total === 1 ? "link" : "links"}</Box>
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

    // Content-sized unless the host pins `height`: the body then takes the
    // canvas height in-flow (uniform sizing #320 — maxHeight caps via root).
    // flex-basis must drop to auto or it overrides the inline height in the
    // auto-height flex column.
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
                                {/* 6.5px filled arrowheads; refX 8.5 so the tip rides the handle. */}
                                {([["ink", INK], ["info", BRAND_D], ["neg", NEG], ["warn", WARN], ["brand", BRAND_D]] as const).map(([id, color]) => (
                                    <marker key={id} id={`fc-mk-${id}-${storageKey}`} viewBox="0 0 10 10" refX={8.5} refY={5}
                                        markerWidth={6.5} markerHeight={6.5} orient="auto">
                                        <path d="M0 0L10 5L0 10z" fill={color} />
                                    </marker>
                                ))}
                            </defs>

                            {/* lane bands — alternating paper-2 tint */}
                            {layout.lanes.map(lane => lane.tinted && (
                                <rect key={lane.key} x={lane.x} y={0} width={lane.w} height={layout.height} fill={PAPER_2} />
                            ))}
                            {/* lane headers — mono 10/600 ls 2.2 ink-4; TD anchors the
                                label in the band's top-left gutter */}
                            <g fontFamily="var(--chakra-fonts-mono)" fontSize={10} fontWeight={600} letterSpacing={2.2} fill={INK_SUBTLE}>
                                {layout.lanes.map(lane => (
                                    layout.orientation === "TD"
                                        ? <text key={lane.key} x={12} y={lane.y + 20} textAnchor="start">{lane.label.toUpperCase()}</text>
                                        : <text key={lane.key} x={lane.cx} y={26} textAnchor="middle">{lane.label.toUpperCase()}</text>
                                ))}
                            </g>
                            {/* + LANE tail affordance */}
                            <g opacity={0.9}>
                                <rect x={layout.laneTail.x} y={layout.laneTail.y} width={layout.laneTail.w} height={layout.laneTail.h}
                                    rx={6} fill="none" stroke={RULE_STRONG} strokeDasharray="4 4" />
                                <text x={layout.laneTail.x + layout.laneTail.w / 2} y={layout.laneTail.y + 28} textAnchor="middle"
                                    fontSize={14} fill={INK_SUBTLE}>+</text>
                                <text x={layout.laneTail.x + layout.laneTail.w / 2} y={layout.laneTail.y + 52} textAnchor="middle"
                                    fontFamily="var(--chakra-fonts-mono)" fontSize={9} letterSpacing={2} fill={INK_SUBTLE}>LANE</text>
                            </g>

                            {/* links — solid, then dashed (dashed renders over solid), selected last */}
                            <g className="fc-links" data-dim-active={dim.active || undefined}>
                                {orderedRoutes.map(r => {
                                    const l = linksByKey.get(r.key)!;
                                    const isSel = r.key === selectedLink;
                                    const op = linkOpacity(r.key);
                                    return (
                                        <g key={r.key} style={{ opacity: op, transition: dim.active ? "opacity var(--chakra-durations-fast, 150ms)" : undefined }}>
                                            {isSel && (
                                                // selection halo — brand, w9, opacity .16
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
                                            {/* invisible hit path */}
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

                            {/* evidence badges + decision diamonds at longest-run midpoints */}
                            {orderedRoutes.map((r, routeIndex) => {
                                const l = linksByKey.get(r.key)!;
                                const op = linkOpacity(r.key);
                                const trigger = l.trigger !== undefined ? model.triggers.get(l.trigger) : undefined;
                                const ev = l.evidence;
                                const vol = ev ? getSomeorUndefined(ev.volume) : undefined;
                                const cnt = ev ? getSomeorUndefined(ev.count) : undefined;
                                const unit = ev ? getSomeorUndefined(ev.unit) : undefined;
                                const badge = vol !== undefined
                                    ? `${fmtVolume(vol)}${unit !== undefined ? ` ${unit}` : ""}${cnt !== undefined ? ` · ${fmtCount(cnt)}` : ""}`
                                    : undefined;
                                if (trigger === undefined && badge === undefined) return null;
                                // Badge anchor per the spec sheet: badges sit ON a run,
                                // paper-filled to lift off crossings. Prefer the link's
                                // longest VERTICAL run (the staggered channel keeps
                                // neighbours apart); a single horizontal run carries the
                                // badge above it — or below when the diamond owns the mid.
                                const badgeSeg = (() => {
                                    let bestV: typeof r.segs[number] | undefined;
                                    let bestVLen = -1;
                                    let best: typeof r.segs[number] | undefined;
                                    let bestLen = -1;
                                    for (const s of r.segs) {
                                        const len = Math.abs(s.b.x - s.a.x) + Math.abs(s.b.y - s.a.y);
                                        const vertical = Math.abs(s.b.x - s.a.x) < Math.abs(s.b.y - s.a.y);
                                        if (len > bestLen) { bestLen = len; best = s; }
                                        if (vertical && len > bestVLen) { bestVLen = len; bestV = s; }
                                    }
                                    return bestVLen >= 48 ? bestV : best;
                                })();
                                const badgeVertical = badgeSeg !== undefined && Math.abs(badgeSeg.b.x - badgeSeg.a.x) < Math.abs(badgeSeg.b.y - badgeSeg.a.y);
                                const badgeMid = badgeSeg !== undefined
                                    ? { x: (badgeSeg.a.x + badgeSeg.b.x) / 2, y: (badgeSeg.a.y + badgeSeg.b.y) / 2 }
                                    : r.mid;
                                const diamondOnBadgeSeg = trigger !== undefined
                                    && Math.abs(badgeMid.x - r.mid.x) < 1 && Math.abs(badgeMid.y - r.mid.y) < 1;
                                const badgeW = badge !== undefined ? badge.length * 5.6 + 12 : 0;
                                const badgeSegLen = badgeSeg !== undefined
                                    ? Math.abs(badgeSeg.b.x - badgeSeg.a.x) + Math.abs(badgeSeg.b.y - badgeSeg.a.y)
                                    : 0;
                                let bx = badgeMid.x;
                                let by = badgeMid.y;
                                if (badgeVertical) {
                                    if (diamondOnBadgeSeg) {
                                        // Short runs can't fit diamond + badge in line —
                                        // the badge steps beside AND below the diamond.
                                        if (badgeSegLen < 80) { bx = badgeMid.x + 10 + badgeW / 2; by = badgeMid.y + 24; }
                                        else by = badgeMid.y + 26;
                                    } else {
                                        // Parity stagger keeps same-row neighbours apart.
                                        by = badgeMid.y + (routeIndex % 2 === 0 ? -11 : 11);
                                    }
                                } else {
                                    // Below the node band when the diamond owns the run's
                                    // midpoint (adjacent-column links are card-tight).
                                    by = badgeMid.y + (diamondOnBadgeSeg ? 34 : -14);
                                }
                                return (
                                    <g key={`orn-${r.key}`} style={{ opacity: op, transition: dim.active ? "opacity var(--chakra-durations-fast, 150ms)" : undefined }}>
                                        {trigger !== undefined && (
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
                                                    fontFamily="var(--chakra-fonts-mono)" fontSize={8.5} fontWeight={700} fill={BRAND_D}>
                                                    {trigger.letter}
                                                </text>
                                            </g>
                                        )}
                                        {badge !== undefined && (
                                            <g transform={`translate(${bx},${by})`}>
                                                {/* paper-filled badge lifts off crossings */}
                                                <rect x={-badgeW / 2} y={-9} width={badgeW} height={18} rx={4}
                                                    fill={PAPER} stroke={RULE_STRONG} strokeWidth={1} />
                                                <text y={3.5} textAnchor="middle" fontFamily="var(--chakra-fonts-mono)" fontSize={9.5} fill={INK_MUTED}>
                                                    {badge}
                                                </text>
                                            </g>
                                        )}
                                    </g>
                                );
                            })}

                            {/* connection points — rings where links attach; all four on hover/selection */}
                            {[...layout.nodes.values()].map(rect => {
                                const nm = model.nodesByKey.get(rect.key);
                                if (!nm) return null;
                                const attachedAt = (p: { x: number; y: number }): ModelLink[] =>
                                    layout.routes
                                        .filter(r => (r.ports[0].x === p.x && r.ports[0].y === p.y) || (r.ports[1].x === p.x && r.ports[1].y === p.y))
                                        .map(r => linksByKey.get(r.key)!)
                                        .filter(Boolean);
                                const nodeActive = hover?.kind === "state" && hover.key === rect.key
                                    || selection?.kind === "state" && selection.key === rect.key;
                                const ports = [rect.left, rect.right, rect.top, rect.bottom].map(p => ({ p, attached: attachedAt(p) }));
                                return (
                                    <g key={`ports-${rect.key}`} style={{ opacity: nodeOpacity(rect.key), transition: dim.active ? "opacity var(--chakra-durations-fast, 150ms)" : undefined }}>
                                        {ports.map(({ p, attached }, i) => {
                                            const visible = attached.length > 0 || nodeActive || draft !== null;
                                            if (!visible) return null;
                                            const r = nodeActive ? 4.5 : 3.5;    // 7px ring; 9px when hovered/selected
                                            const isOut = i === 1 || i === 3;    // right / bottom
                                            return (
                                                <circle
                                                    key={i}
                                                    cx={p.x} cy={p.y} r={r}
                                                    fill={PAPER}
                                                    stroke={portColor(attached, selectedLink)}
                                                    strokeWidth={1.4}
                                                    style={linkMode !== undefined && isOut ? { cursor: "crosshair" } : undefined}
                                                    onPointerDown={linkMode !== undefined && isOut ? (e) => beginDraft(rect.key, e) : undefined}
                                                />
                                            );
                                        })}
                                    </g>
                                );
                            })}

                            {/* connect draft */}
                            {draft !== null && (() => {
                                const from = layout.nodes.get(draft.from);
                                if (!from) return null;
                                const start = from.right;
                                return (
                                    <g>
                                        <path
                                            d={`M${start.x} ${start.y} L${draft.x} ${draft.y}`}
                                            fill="none"
                                            stroke={draft.over !== null && !draft.allowed ? NEG : BRAND_D}
                                            strokeWidth={1.6}
                                            strokeDasharray="5 4"
                                        />
                                        {draft.over !== null && !draft.allowed && (
                                            <text x={draft.x + 10} y={draft.y - 6} fontSize={12} fill={NEG}>⊘</text>
                                        )}
                                    </g>
                                );
                            })()}
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
                                        transition: dim.active ? "opacity var(--chakra-durations-fast, 150ms)" : undefined,
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

                        {/* legend — planned / observed / trigger / in-place */}
                        {legendOn && (
                            <Box css={styles.legend} data-flowchart-legend>
                                <Box css={styles.legendTitle}>Legend</Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={INK} strokeWidth={2} /></svg>
                                    <span>Planned</span>
                                </Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={BRAND_D} strokeWidth={1.6} strokeDasharray="5 4" /></svg>
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
                                            fill="none" stroke={INK_MUTED} strokeWidth={6} />
                                    ))}
                                </svg>
                            </Box>
                        )}
                    </Box>
                </Box>
            )}

            {/* hover card — read-only glance; ⏎ opens the inspector */}
            {hoverCard !== null && layout !== null && (() => {
                const card = buildHoverCard(hoverCard, model);
                if (card === null) return null;
                return (
                    <Box
                        css={styles.hoverCard}
                        data-flowchart-hovercard
                        style={{ left: Math.min(hoverCard.ax + 14, Math.max(0, (size?.w ?? 320) - 280)), top: hoverCard.ay + 14 }}
                        onPointerEnter={cancelHoverClose}
                        onPointerLeave={scheduleHoverClose}
                    >
                        <Box css={styles.hoverHead}>
                            <Box as="span" css={styles.hoverCode}>{card.title}</Box>
                            <Box as="span" css={styles.hoverKind}>{card.kind}</Box>
                        </Box>
                        {card.rows.slice(0, 5).map(([k, v]) => (
                            <Box key={k} css={styles.hoverRow}>
                                <Box as="span" css={styles.hoverRowKey}>{k}</Box>
                                <Box as="span" css={styles.hoverRowVal}>{v}</Box>
                            </Box>
                        ))}
                        <Box css={styles.hoverFoot}>⏎ open inspector · click = select</Box>
                    </Box>
                );
            })()}

            {/* floating inspector — the only mutation surface (read-only v1) */}
            {inspectorMode === "float" && selection !== null && (() => {
                const panel = buildInspector(selection, model, value);
                if (panel === null) return null;
                return (
                    <Box css={styles.inspector} data-flowchart-inspector>
                        <Box css={styles.inspectorHead}>
                            <Box as="span" css={styles.inspectorEyebrow}>{panel.eyebrow}</Box>
                            <button type="button" aria-label="Close" onClick={() => setSelection(null)}>×</button>
                        </Box>
                        <Box css={styles.inspectorTitle}>{panel.title}</Box>
                        {panel.subtitle !== undefined && <Box css={styles.inspectorSubtitle}>{panel.subtitle}</Box>}
                        {panel.evidence !== undefined && (
                            <Box css={styles.inspectorEvidence}>
                                <Box css={styles.inspectorEvidenceLabel}>Evidence · imported</Box>
                                <Box css={styles.inspectorEvidenceValue}>
                                    {panel.evidence.value}
                                    {panel.evidence.unit !== undefined && <Box as="span" css={styles.inspectorEvidenceUnit}>{panel.evidence.unit}</Box>}
                                </Box>
                                {panel.evidence.meta !== undefined && <Box css={styles.inspectorMeta}>{panel.evidence.meta}</Box>}
                            </Box>
                        )}
                        {panel.fields.length > 0 && (
                            <Box css={styles.inspectorFields}>
                                <Box css={styles.inspectorFieldsLabel}>Declared fields</Box>
                                {panel.fields.map(f => (
                                    <Box key={f.label} css={styles.inspectorFieldRow}>
                                        <Box css={styles.inspectorFieldKey}>{f.label}</Box>
                                        {f.chips
                                            ? <Box css={styles.inspectorChips}>{f.values.map(v => <Box as="span" key={v} css={styles.inspectorChip}>{v}</Box>)}</Box>
                                            : <Box css={styles.inspectorFieldVal}>{f.values.join(" · ")}</Box>}
                                    </Box>
                                ))}
                            </Box>
                        )}
                        {panel.notes !== undefined && (
                            <Box css={styles.inspectorNotes}>
                                <Box css={styles.inspectorFieldsLabel}>Notes</Box>
                                <Box>{panel.notes}</Box>
                            </Box>
                        )}
                    </Box>
                );
            })()}
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

// ── derived surfaces (pure) ────────────────────────────────────────────────

interface HoverCardModel {
    title: string;
    kind: string;
    rows: [string, string][];
}

function buildHoverCard(
    hc: { kind: "state" | "link" | "trigger"; key: string },
    model: FlowchartModel,
): HoverCardModel | null {
    if (hc.kind === "state") {
        const n = model.nodesByKey.get(hc.key);
        if (!n) return null;
        const inN = model.links.filter(l => l.to === n.key).length;
        const outN = model.links.filter(l => l.from === n.key).length;
        const rows: [string, string][] = [
            ["state", n.label ?? n.key],
            ["links", `${inN} in · ${outN} out${n.inPlace > 0 ? ` · ↻ ${n.inPlace} in-place` : ""}`],
        ];
        for (const f of n.fields) rows.push([f.id, f.values.join(", ")]);
        if (n.notes !== undefined) rows.push(["notes", n.notes]);
        return { title: n.key, kind: n.ghost ? "no state row" : "state", rows };
    }
    if (hc.kind === "link") {
        const l = model.links.find(x => x.key === hc.key);
        if (!l) return null;
        const rows: [string, string][] = [];
        if (l.trigger !== undefined) {
            const t = model.triggers.get(l.trigger);
            rows.push(["decision", t !== undefined ? `${t.label}${t.owner !== undefined ? ` · ${t.owner}` : ""}` : l.trigger]);
        }
        if (l.evidence) {
            const vol = getSomeorUndefined(l.evidence.volume);
            const cnt = getSomeorUndefined(l.evidence.count);
            const unit = getSomeorUndefined(l.evidence.unit);
            const at = getSomeorUndefined(l.evidence.measuredAt);
            if (vol !== undefined || cnt !== undefined) {
                rows.push(["evidence", [
                    vol !== undefined ? `${fmtVolume(vol)}${unit !== undefined ? ` ${unit}` : ""}` : undefined,
                    cnt !== undefined ? `${fmtCount(cnt)} tr` : undefined,
                    at !== undefined ? fmtDate(at) : undefined,
                ].filter(Boolean).join(" · ")]);
            }
        }
        for (const f of l.fields) rows.push([f.id, f.values.join(", ")]);
        return { title: `${l.from} → ${l.to}`, kind: `link · ${l.cls}`, rows };
    }
    const t = model.triggers.get(hc.key);
    if (!t) return null;
    const governed = t.governs.length;
    const rows: [string, string][] = [];
    if (t.owner !== undefined) rows.push(["owner", t.owner]);
    if (t.queue.length > 0) rows.push(["queue", t.queue.join(" ")]);
    if (t.outcomes !== undefined) rows.push(["outcomes", t.outcomes]);
    rows.push(["governs", `${governed} ${governed === 1 ? "link" : "links"}`]);
    return { title: t.label, kind: "decision", rows };
}

interface InspectorModel {
    eyebrow: string;
    title: string;
    subtitle: string | undefined;
    evidence: { value: string; unit: string | undefined; meta: string | undefined } | undefined;
    fields: { label: string; values: readonly string[]; chips: boolean }[];
    notes: string | undefined;
}

function declaredFields(
    fields: ReadonlyArray<{ id: string; values: readonly string[] }>,
    defs: ReadonlyArray<{ id: string; label: string; kind: { type: string } }>,
): InspectorModel["fields"] {
    return fields.map(f => {
        const def = defs.find(d => d.id === f.id);
        return {
            label: def?.label ?? f.id,
            values: f.values,
            chips: def?.kind.type === "chips",
        };
    });
}

function buildInspector(sel: { kind: "state" | "link" | "trigger"; key: string }, model: FlowchartModel, value: FlowchartValue): InspectorModel | null {
    if (sel.kind === "link") {
        const l = model.links.find(x => x.key === sel.key);
        if (!l) return null;
        const from = model.nodesByKey.get(l.from), to = model.nodesByKey.get(l.to);
        const ev = l.evidence;
        const vol = ev ? getSomeorUndefined(ev.volume) : undefined;
        const cnt = ev ? getSomeorUndefined(ev.count) : undefined;
        const unit = ev ? getSomeorUndefined(ev.unit) : undefined;
        const at = ev ? getSomeorUndefined(ev.measuredAt) : undefined;
        const trigger = l.trigger !== undefined ? model.triggers.get(l.trigger) : undefined;
        return {
            eyebrow: `Transition · ${l.cls}`,
            title: `${l.from} → ${l.to}`,
            subtitle: [from?.label, to?.label].filter(Boolean).join(" → ") || undefined,
            evidence: vol !== undefined
                ? {
                    value: fmtVolume(vol),
                    unit,
                    meta: [
                        cnt !== undefined ? `${fmtCount(cnt)} transfers` : undefined,
                        at !== undefined ? `measured ${fmtDate(at)}` : undefined,
                    ].filter(Boolean).join(" · ") || undefined,
                }
                : undefined,
            fields: [
                ...(trigger !== undefined
                    ? [{ label: "Decision", values: [trigger.owner !== undefined ? `${trigger.label} · ${trigger.owner}` : trigger.label], chips: false }]
                    : []),
                ...declaredFields(l.fields, value.linkFieldDefs),
            ],
            notes: undefined,
        };
    }
    if (sel.kind === "state") {
        const n = model.nodesByKey.get(sel.key);
        if (!n) return null;
        const inN = model.links.filter(l => l.to === n.key).length;
        const outN = model.links.filter(l => l.from === n.key).length;
        return {
            eyebrow: n.ghost ? "State · unresolved" : "State",
            title: n.key,
            subtitle: n.label,
            evidence: undefined,
            fields: [
                { label: "Links", values: [`${inN} in · ${outN} out${n.inPlace > 0 ? ` · ↻ ${n.inPlace}` : ""}`], chips: false },
                ...(n.members !== undefined ? [{ label: "Class", values: [`×${String(n.members)} members`], chips: false }] : []),
                ...declaredFields(n.fields, value.stateFieldDefs),
            ],
            notes: n.notes,
        };
    }
    const t = model.triggers.get(sel.key);
    if (!t) return null;
    return {
        eyebrow: "Decision trigger",
        title: t.label,
        subtitle: t.owner,
        evidence: undefined,
        fields: [
            ...(t.queue.length > 0 ? [{ label: "Queue", values: t.queue, chips: true }] : []),
            ...(t.outcomes !== undefined ? [{ label: "Outcomes", values: [t.outcomes], chips: false }] : []),
            { label: "Governs", values: [`${t.governs.length} links`], chips: false },
        ],
        notes: undefined,
    };
}
