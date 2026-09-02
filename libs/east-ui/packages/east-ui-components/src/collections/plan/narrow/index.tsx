/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout (`Plan Spec v2.html` §10, #570) — below 480px of
 * CONTAINER width the Plan is a review tool, not a canvas. Two jobs survive
 * the trip: *where is it hot* (the GROUP grain as a strip list) and *what is
 * this thing doing* (one group's rows). Three tabs over ONE slice — Groups ·
 * Rows · Measures — share the cohort chips, window and resolution; filter
 * once, every tab narrows.
 *
 * The gutter decision, written into the spec: there is no gutter column to
 * negotiate on a phone. A row's gutter identity (label / id / sub / value /
 * status dot / meta) becomes the CARD HEAD and its plot — the same kind
 * renderer, unchanged (`KindPlot`) — the CARD BODY on the shared window. The
 * list has no gutter, so every card body and the slim shared ruler share one
 * inset and the bucket columns line up down the page.
 *
 * What does not change: the bar vocabulary, the slice semantics, the
 * now-line, the review verbs. The input model does: tap selects, a second
 * tap on a row that declares `expand` drills it in place (~148pt; its
 * neighbours keep their size — a vertical list needs no strip compression),
 * horizontal pan is two-finger so page scroll stays vertical. The horizon
 * brush does not mount: the window rides the slice range chip and the pan,
 * the resolution a Week chip. A paged source shows its resident prefix and
 * says so in the footer.
 */

import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type PointerEvent, type ReactNode } from "react";
import { Box, Menu as ChakraMenu, Portal, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan, Slice } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../../component.js";
import { SliceRailCluster } from "../../../slice/rail/index.js";
import { railAffordanceKinds } from "../../../slice/rail-kinds.js";
import { useSliceReactivity } from "../../../slice/use-slice-reactivity.js";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { GridSeparators } from "../rows/RowShell.js";
import { KindPlot } from "../rows/KindPlot.js";
import { ChartLeftTicks } from "../rows/ChartRow.js";
import { HeatCells } from "../rows/HeatRow.js";
import { derivedSummaryArm } from "../rows/GroupRow.js";
import { PlanFooter } from "../shell/Footer.js";
import { PlanDecisionCell, tagOf, type PlanReview } from "../shell/Review.js";
import type { PlanTransport } from "../shell/transport.js";
import { pxOf, rowHeight, type PlanDerived, type PlanRowIndex, type PlanRowValue } from "../model.js";
import type { PlanUiState, RowKey } from "../plan-state.js";
import { feedTwoFingerPan, newTwoFingerPan } from "./pan.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;
type FooterItemValue = ValueTypeOf<typeof Plan.Types.FooterItem>;
type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;
type UIValue = ComponentProps<typeof EastChakraComponent>["value"];

/** The narrow breakpoint — the adaptive contract's compact class (#346). */
export const PLAN_NARROW_BELOW = 480;
/** §10: a drilled row expands to ~148pt in place, unless it declares a height. */
const NARROW_RENDER_PX = 148;
/** Cards shown before the `N more …` load-more, per list. */
const PAGE_GROUPS = 6;
const PAGE_ROWS = 8;
/** A card body's inset from the list edge: 12px list padding + 1px card
 *  border + 12px body margin — the recipe's `narrowRuler` margin matches. */
const BODY_INSET_PX = 25;
/** The group card's summary strip height (18px cells + the 3px insets). */
const GROUP_STRIP_H = 24;
/** The Rows-tab scope for root data rows that belong to no group. */
const OTHER_SCOPE = " other";

type NarrowTab = "groups" | "rows" | "measures";

/** One run of row cards on the Rows tab — under a group header when the
 *  list is unscoped, bare when it is one group's rows. */
interface RowSection {
    key: string;
    header?: { scope: RowKey; label: string; meta: string | undefined; value: string | undefined; tone: string | undefined };
    rows: PlanRowValue[];
}

export interface PlanNarrowProps {
    styles: Styles;
    index: PlanRowIndex;
    derived: PlanDerived;
    ui: PlanUiState;
    dense: boolean;
    barHeight: number;
    storageKey: string;
    /** The bound slice handle, when the canvas carries slice chrome. */
    slice: SliceBindValue | undefined;
    /** The declared affordance kinds (decoded `SliceChromeType`). */
    affordances: ReadonlyArray<string>;
    /** The active resolution + the declared segment options (`[]` ⇒ no chip). */
    resolution: string;
    resolutions: ReadonlyArray<string>;
    transport: PlanTransport | undefined;
    footer: ReadonlyArray<FooterItemValue>;
    review: PlanReview | undefined;
    /** The focused row's developer render / gutter body (the root resolvers
     *  called with `ui.focus`), or `null`. */
    expandBody: UIValue | null;
    expandGutterBody: UIValue | null;
    /** Whether the root declares `expandRender` at all. */
    canExpand: boolean;
    partial: boolean | undefined;
    /** A bounded frame — the list scrolls inside it. */
    fill: boolean;
}

/** The DATA rows beneath a key, tree order, any depth (group bands skipped). */
function dataRowsUnder(index: PlanRowIndex, key: RowKey): PlanRowValue[] {
    const out: PlanRowValue[] = [];
    const walk = (k: RowKey) => {
        for (const child of index.children.get(k) ?? []) {
            if (child.kind.type !== "group") out.push(child);
            walk(child.key);
        }
    };
    walk(key);
    return out;
}

/** Every data row of the canvas, tree order. */
function allDataRows(index: PlanRowIndex): PlanRowValue[] {
    const out: PlanRowValue[] = [];
    for (const root of index.roots) {
        if (root.kind.type !== "group") out.push(root);
        out.push(...dataRowsUnder(index, root.key));
    }
    return out;
}

/** A group's strip cells as a heat arm — its explicit `summary`, else the
 *  derived `summaryAggregate` cells on the scale they inherit (the desktop
 *  band's own builder, so both strips read the same way). */
function summaryArm(row: PlanRowValue, derived: PlanDerived): HeatCellsValue | undefined {
    if (row.kind.type !== "group") return undefined;
    if (row.kind.value.summary.type === "some") return row.kind.value.summary.value;
    const cells = derived.groupSummary.get(row.key);
    if (cells === undefined || cells.length === 0) return undefined;
    return derivedSummaryArm(cells, derived.groupSummaryScale.get(row.key));
}

/** The hottest value on a strip — what "hottest first" sorts by. */
function peakOf(arm: HeatCellsValue | undefined): number {
    if (arm === undefined) return -Infinity;
    let peak = -Infinity;
    if (arm.type === "heat") {
        for (const c of arm.value.cells) if (c.value.type === "some" && c.value.value > peak) peak = c.value.value;
    } else if (arm.type === "weight") {
        for (const c of arm.value) if (c.fraction > peak) peak = c.fraction;
    }
    return peak;
}

/** Mono 9px: the width one label character takes, plus the gap two labels
 *  keep between them — what decides how many labels a track can carry. */
const TICK_CHAR_PX = 5.6;
const TICK_GAP_PX = 8;
/** Labels printed when the track has not been measured yet (jsdom, the
 *  first frame): one per bucket up to twelve — the desktop ruler's density. */
const TICK_FALLBACK_LABELS = 12;

/**
 * The shared ruler — the LIST's sticky first row, not a row of the header.
 * It wears the desktop ruler's vocabulary (the panel surface, a separator
 * per bucket so its rhythm IS the card grids', a strong bottom rule) and
 * sits 10px under the tab baseline on the page, so it reads as the axis
 * over the cards rather than as a strip welded under the tab underline
 * (which is what a filled band directly beneath the tabs looked like). The
 * tick TRACK is inset to the card bodies' inset (25px) so the columns line
 * up down the page; labels are thinned to what the measured track can carry
 * (at day resolution a bucket is ~3px — a label per bucket clipped to
 * confetti), each centred over its bucket. The now bucket's label wears the
 * brand: a 28px band has no lane for the chip, and a chip laid over the
 * labels hid the two it straddled.
 */
function NarrowRuler({ styles }: { styles: Styles }) {
    const scale = usePlanScale();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [trackPx, setTrackPx] = useState(0);
    useLayoutEffect(() => {
        const el = trackRef.current;
        if (el === null) return undefined;
        const measure = () => setTrackPx(el.clientWidth);
        measure();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const nowIndex = scale.nowFrac === undefined ? undefined
        : scale.buckets.find((b) => scale.nowFrac! >= b.x0 && scale.nowFrac! < b.x1)?.index;
    // How many labels FIT: the widest label's width plus a gap, into the track.
    const widest = scale.buckets.reduce((w, b) => Math.max(w, b.label.length), 1);
    const maxLabels = trackPx > 0
        ? Math.max(2, Math.floor(trackPx / (widest * TICK_CHAR_PX + TICK_GAP_PX)))
        : TICK_FALLBACK_LABELS;
    const every = Math.max(1, Math.ceil(scale.n / maxLabels));
    // The cadence, plus the now bucket — which displaces a cadence label it
    // would otherwise sit on top of. Every bucket keeps its separator.
    const labelled = (i: number) => i === nowIndex
        || (i % every === 0 && (nowIndex === undefined || Math.abs(i - nowIndex) >= every));
    const columns = scale.buckets.map((b) => `${((b.x1 - b.x0) * 100).toFixed(4)}%`).join(" ");
    return (
        <Box css={styles.narrowRuler} data-slot="narrowRuler">
            <Box ref={trackRef} css={styles.narrowRulerTrack} gridTemplateColumns={columns}>
                {scale.buckets.map((b) => (
                    <Box key={b.index} css={styles.narrowRulerTick} data-slot="narrowRulerTick"
                        data-now={b.index === nowIndex ? "" : undefined}>
                        {labelled(b.index) ? b.label : ""}
                    </Box>
                ))}
                {scale.nowFrac !== undefined && <Box css={styles.nowLine} left={`${scale.nowFrac * 100}%`} />}
            </Box>
        </Box>
    );
}

/** The `Week` chip — the resolution segment's narrow form (a slice write). */
function ResolutionChip({ resolution, resolutions, onPick }: {
    resolution: string;
    resolutions: ReadonlyArray<string>;
    onPick: (r: string) => void;
}) {
    const chip = useRecipe({ key: "chip" });
    return (
        <ChakraMenu.Root onSelect={(d) => onPick(d.value)}>
            <ChakraMenu.Trigger asChild>
                <Box as="button" css={chip({ tone: "neutral", numeric: true })} data-slot="narrowResolution" aria-label="Resolution">
                    {resolution.toUpperCase()}
                    <Box as="span" opacity={0.6} fontSize="9px">{"▾"}</Box>
                </Box>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {resolutions.map((r) => (
                            <ChakraMenu.Item key={r} value={r}>{r.toUpperCase()}</ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/** The narrow shell: chips · tabs · ruler · card list · footer. */
export function PlanNarrow({
    styles, index, derived, ui, dense, barHeight, storageKey,
    slice, affordances, resolution, resolutions, transport, footer, review,
    expandBody, expandGutterBody, canExpand, partial, fill,
}: PlanNarrowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const tabsRecipe = useSlotRecipe({ key: "tabs" });
    // The auto-appended cohort chip appears when the STORE moves (#611).
    const sliceVersion = useSliceReactivity(slice?.key);
    const railKinds = useMemo(
        () => (slice === undefined ? [] : railAffordanceKinds(affordances, slice.read())
            .filter((k) => k !== "brush" && k !== "legend" && k !== "resolution" && k !== "summary")),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of `slice.read()` (#611)
        [affordances, slice, sliceVersion],
    );

    const rootGroups = useMemo(() => index.roots.filter((r) => r.kind.type === "group"), [index]);
    const ungrouped = useMemo(() => index.roots.filter((r) => r.kind.type !== "group"), [index]);
    const chartRows = useMemo(() => allDataRows(index).filter((r) => r.kind.type === "chart"), [index]);
    const hasGroups = rootGroups.length > 0;
    const hasMeasures = chartRows.length > 0;

    // ── Groups: root group strips, hottest first ─────────────────────────
    const groupCards = useMemo(() => {
        const cards = rootGroups.map((row, i) => {
            const arm = summaryArm(row, derived);
            return { row, arm, peak: peakOf(arm), i };
        });
        cards.sort((a, b) => (b.peak - a.peak) || (a.i - b.i));
        return cards;
    }, [rootGroups, derived]);
    // Groups is the LANDING only when it is an index worth landing on — a
    // few strips that say where it is hot, or enough groups that a list of
    // them is the map. One or two strip-less groups are a detour: the reader
    // taps through a card that shows nothing to reach the rows.
    const groupsIndex = rootGroups.length >= 3 || groupCards.some((c) => c.arm !== undefined);

    const [tab, setTab] = useState<NarrowTab>(hasGroups && groupsIndex ? "groups" : "rows");
    const [scope, setScope] = useState<RowKey | null>(null);
    const [reveal, setReveal] = useState({ groups: PAGE_GROUPS, rows: PAGE_ROWS, measures: PAGE_ROWS });
    // A tab whose content vanished (a data change) falls back to Rows.
    const activeTab: NarrowTab = tab === "groups" && !hasGroups ? "rows"
        : tab === "measures" && !hasMeasures ? "rows"
            : tab;
    const openGroup = (key: RowKey) => { setScope(key); setTab("rows"); };

    // ── Rows: one group at a time, or the whole plan SECTIONED by group ──
    const scopeGroup = scope !== null && scope !== OTHER_SCOPE ? index.byKey.get(scope) : undefined;
    const sections = useMemo<RowSection[]>(() => {
        if (scope === OTHER_SCOPE) return [{ key: "other", rows: ungrouped.flatMap((r) => [r, ...dataRowsUnder(index, r.key)]) }];
        if (scope !== null && index.byKey.has(scope)) return [{ key: scope, rows: dataRowsUnder(index, scope) }];
        if (!hasGroups) return [{ key: "all", rows: allDataRows(index) }];
        // Unscoped: every root group is a section under its own header (a tap
        // scopes to it), so the grouping the desktop canvas shows as bands
        // survives the trip instead of flattening into one anonymous list.
        const out: RowSection[] = [];
        const other: PlanRowValue[] = [];
        for (const root of index.roots) {
            if (root.kind.type !== "group") { other.push(root, ...dataRowsUnder(index, root.key)); continue; }
            const members = derived.groupMembers.get(root.key);
            out.push({
                key: root.key,
                header: {
                    scope: root.key,
                    label: root.gutter.label,
                    meta: root.gutter.meta.type === "some" ? root.gutter.meta.value
                        : (members !== undefined && members > 0 ? `${partial === true ? "~" : ""}${members} rs` : undefined),
                    value: root.gutter.value.type === "some" ? root.gutter.value.value : undefined,
                    tone: root.status.type === "some" ? root.status.value.type : undefined,
                },
                rows: dataRowsUnder(index, root.key),
            });
        }
        if (other.length > 0) {
            out.push({ key: "other", header: { scope: OTHER_SCOPE, label: "Other rows", meta: `${other.length} rs`, value: undefined, tone: undefined }, rows: other });
        }
        return out;
    }, [scope, index, ungrouped, hasGroups, derived, partial]);

    // ── Two-finger pan (§10) — one whole period per period width crossed ──
    const listRef = useRef<HTMLDivElement | null>(null);
    const gesture = useRef(newTwoFingerPan());
    const periodPx = () => {
        const w = listRef.current?.clientWidth ?? 0;
        return w > 0 ? (w - 2 * BODY_INSET_PX) / scale.n : 0;
    };
    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        feedTwoFingerPan(gesture.current, "down", e.pointerId, e.clientX, periodPx());
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const periods = feedTwoFingerPan(gesture.current, "move", e.pointerId, e.clientX, periodPx());
        if (periods !== 0) dispatch({ t: "pan", buckets: periods });
    };
    const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
        feedTwoFingerPan(gesture.current, "up", e.pointerId, e.clientX, 0);
    };

    const nowLine = scale.nowFrac !== undefined
        ? <Box css={styles.nowLine} data-plan-axisline left={`${scale.nowFrac * 100}%`} />
        : null;

    // One data row as a card: head = the gutter identity, body = the plot.
    const renderRowCard = (row: PlanRowValue, measures: boolean) => {
        const v = { row, depth: 0, collapsed: false };
        const isChart = row.kind.type === "chart";
        // Measures stack at EXPANDED density (§10): force the chart's expanded
        // branch (it still honours a declared fixed / expandedHeight).
        const h = rowHeight(v, dense, measures && isChart ? new Set([row.key]) : ui.chartsExpanded, undefined, derived);
        const chartExpanded = row.kind.type === "chart" && (measures
            || row.kind.value.height.type === "expanded" || ui.chartsExpanded.has(row.key));
        const selected = ui.selected === row.key;
        const drilled = ui.focus !== null && ui.focus.kind === "expand" && ui.focus.key === row.key && expandBody !== null;
        const canDrill = canExpand && row.expand.type === "some";
        const declaredPx = row.expand.type === "some" && row.expand.value.height.type === "some"
            ? pxOf(row.expand.value.height.value)
            : undefined;
        const renderPx = declaredPx ?? NARROW_RENDER_PX;
        const gutter = row.gutter;
        const isId = gutter.id.type === "some" && gutter.id.value;
        const sub = gutter.sub.type === "some" ? gutter.sub.value : undefined;
        const value = gutter.value.type === "some" ? gutter.value.value : undefined;
        const meta = gutter.meta.type === "some" ? gutter.meta.value : undefined;
        const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
        return (
            <Box key={row.key} css={styles.narrowCard} data-plan-card={row.key}
                data-selected={selected ? "" : undefined}
                data-expanded={drilled ? "" : undefined}
                // Tap selects; a second tap on a selected row that declares
                // `expand` drills it in place (and again returns) — §10.
                onClick={() => dispatch(selected && canDrill
                    ? { t: "focus.expand", key: row.key }
                    : { t: "row.select", key: row.key })}
            >
                <Box css={styles.narrowCardHead}>
                    <Box css={styles.narrowCardTitle} data-id={isId ? "" : undefined}>{gutter.label}</Box>
                    {meta !== undefined && <Box as="span" css={styles.gutterMeta}>{meta}</Box>}
                    <Box display="flex" alignItems="center" gap="6px" marginLeft="auto" flexShrink={0}>
                        {value !== undefined && <Box as="span" css={styles.gutterValue}>{value}</Box>}
                        {statusTone !== undefined && <Box as="span" css={styles.statusDot} data-tone={statusTone} />}
                    </Box>
                </Box>
                {sub !== undefined && <Box css={styles.narrowCardSub}>{sub}</Box>}
                {drilled && expandGutterBody !== null && (
                    <Box css={styles.expandGutterBody} data-plan-expandgutter marginX="12px" marginBottom="8px">
                        <EastChakraComponent value={expandGutterBody} storageKey={`${storageKey}.${row.key}.expandgutter`} />
                    </Box>
                )}
                <Box css={styles.narrowCardBody} height={`${h}px`} data-plan-cardbody={row.kind.type}>
                    {!isChart && <GridSeparators styles={styles} />}
                    <KindPlot v={v} styles={styles} derived={derived} storageKey={storageKey}
                        barHeight={barHeight} hasChildren={(index.children.get(row.key)?.length ?? 0) > 0}
                        ctx={false} plotHeight={h} chartExpanded={chartExpanded} partial={partial} />
                    {row.kind.type === "chart" && (
                        <Box css={styles.narrowTicks}>
                            <ChartLeftTicks kind={row.kind.value} styles={styles} height={h} />
                        </Box>
                    )}
                    {nowLine}
                </Box>
                {drilled && (
                    <Box css={styles.narrowRender} data-plan-expandrender height={`${renderPx}px`}>
                        <EastChakraComponent value={expandBody} storageKey={`${storageKey}.${row.key}.expand`} />
                    </Box>
                )}
                {review !== undefined && review.hasRowVerbs && (
                    <Box css={styles.narrowCardFoot}>
                        <PlanDecisionCell rowKey={row.key} tag={tagOf(row)} review={review} />
                    </Box>
                )}
            </Box>
        );
    };

    const more = (key: NarrowTab, label: string) => (
        <Box as="button" css={styles.narrowMore} data-plan-more={key}
            onClick={() => setReveal((r) => ({ ...r, [key]: r[key] + (key === "groups" ? PAGE_GROUPS : PAGE_ROWS) }))}>
            {label}
        </Box>
    );

    let list: ReactNode;
    if (activeTab === "groups") {
        const shown = groupCards.slice(0, reveal.groups);
        const hidden = groupCards.slice(reveal.groups);
        const hiddenRs = hidden.reduce((n, c) => n + (derived.groupMembers.get(c.row.key) ?? 0), 0);
        list = (
            <>
                {shown.map(({ row, arm }) => {
                    const members = derived.groupMembers.get(row.key);
                    const meta = row.gutter.meta.type === "some"
                        ? row.gutter.meta.value
                        : (members !== undefined && members > 0 ? `${partial === true ? "~" : ""}${members} rs` : undefined);
                    const value = row.gutter.value.type === "some" ? row.gutter.value.value : undefined;
                    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
                    return (
                        <Box key={row.key} css={styles.narrowCard} data-plan-groupcard={row.key}
                            onClick={() => openGroup(row.key)}>
                            <Box css={styles.narrowCardHead}>
                                <Box css={styles.narrowCardTitle} data-group="">{row.gutter.label}</Box>
                                {meta !== undefined && <Box as="span" css={styles.gutterMeta}>{meta}</Box>}
                                <Box display="flex" alignItems="center" gap="6px" marginLeft="auto" flexShrink={0}>
                                    {statusTone !== undefined && <Box as="span" css={styles.statusDot} data-tone={statusTone} />}
                                    {value !== undefined && <Box as="span" css={styles.gutterValue}>{value}</Box>}
                                </Box>
                            </Box>
                            {arm !== undefined && (
                                <Box css={styles.narrowCardBody} height={`${GROUP_STRIP_H}px`} data-plan-cardbody="group">
                                    <GridSeparators styles={styles} />
                                    <HeatCells rowKey={row.key} cells={arm} styles={styles} onCellClick={() => openGroup(row.key)} />
                                    {nowLine}
                                </Box>
                            )}
                        </Box>
                    );
                })}
                {hidden.length > 0 && more("groups",
                    `${hidden.length} more group${hidden.length > 1 ? "s" : ""}${hiddenRs > 0 ? ` · ${hiddenRs} rs` : ""}`)}
                {ungrouped.length > 0 && (
                    <Box css={styles.narrowCard} data-plan-groupcard="other" onClick={() => openGroup(OTHER_SCOPE)}>
                        <Box css={styles.narrowCardHead}>
                            <Box css={styles.narrowCardTitle} data-group="">Other rows</Box>
                            <Box as="span" css={styles.gutterMeta}>{`${ungrouped.length} rs`}</Box>
                        </Box>
                    </Box>
                )}
            </>
        );
    } else if (activeTab === "rows") {
        const total = sections.reduce((n, s) => n + s.rows.length, 0);
        const members = scopeGroup !== undefined ? derived.groupMembers.get(scopeGroup.key) : undefined;
        const scopeValue = scopeGroup !== undefined && scopeGroup.gutter.value.type === "some" ? scopeGroup.gutter.value.value : undefined;
        // ONE page across every section: a section prints its header once it
        // has a card to show, and the load-more counts what is left overall.
        let budget = reveal.rows;
        const body: ReactNode[] = [];
        for (const s of sections) {
            if (budget <= 0) break;
            const shown = s.rows.slice(0, budget);
            budget -= shown.length;
            if (s.header !== undefined && shown.length > 0) {
                const h = s.header;
                body.push(
                    <Box key={`section-${s.key}`} css={styles.narrowSection} data-plan-section={s.key}
                        onClick={() => openGroup(h.scope)}>
                        <Box css={styles.narrowSectionTitle}>{h.label}</Box>
                        {h.meta !== undefined && <Box as="span" css={styles.gutterMeta}>{h.meta}</Box>}
                        <Box display="flex" alignItems="center" gap="6px" marginLeft="auto" flexShrink={0}>
                            {h.tone !== undefined && <Box as="span" css={styles.statusDot} data-tone={h.tone} />}
                            {h.value !== undefined && <Box as="span" css={styles.gutterValue}>{h.value}</Box>}
                            <Box as="span" css={styles.narrowSectionGo} aria-hidden>{"›"}</Box>
                        </Box>
                    </Box>,
                );
            }
            body.push(...shown.map((row) => renderRowCard(row, false)));
        }
        const rest = total - (reveal.rows - Math.max(0, budget));
        list = (
            <>
                {(scopeGroup !== undefined || scope === OTHER_SCOPE) && (
                    <Box css={styles.narrowScope} data-slot="narrowScope">
                        {hasGroups && (
                            <Box as="button" css={styles.narrowBack} data-plan-back=""
                                onClick={() => { setScope(null); setTab(groupsIndex ? "groups" : "rows"); }}>
                                {groupsIndex ? "← Groups" : "← All rows"}
                            </Box>
                        )}
                        <Box css={styles.narrowScopeTitle}>{scopeGroup !== undefined ? scopeGroup.gutter.label : "Other rows"}</Box>
                        <Box css={styles.narrowScopeMeta}>
                            {[members !== undefined && members > 0 ? `${members} rs` : undefined, scopeValue].filter(Boolean).join(" · ")}
                        </Box>
                    </Box>
                )}
                {total === 0 && <Box css={styles.narrowEmpty}>No rows</Box>}
                {body}
                {rest > 0 && more("rows", `${rest} more row${rest > 1 ? "s" : ""}`)}
            </>
        );
    } else {
        const shown = chartRows.slice(0, reveal.measures);
        const rest = chartRows.length - shown.length;
        list = (
            <>
                {shown.map((row) => renderRowCard(row, true))}
                {rest > 0 && more("measures", `${rest} more measure${rest > 1 ? "s" : ""}`)}
            </>
        );
    }

    // The tab strip is the production `tabs` recipe (`<Tabs>`'s line
    // variant) — underline only, no fill, the mono eyebrow grammar, the
    // hairline baseline the active underline overlaps — so the strip cannot
    // drift from the spec by re-declaring it. Counts ride each label as
    // plain numerals (never a tinted pill); a paged prefix marks them `~`.
    const tabStyles = tabsRecipe({ variant: "line", size: "md" }) as unknown as Styles;
    const rowCount = allDataRows(index).length;
    const tabs: Array<{ key: NarrowTab; label: string; count: number }> = [
        ...(hasGroups ? [{ key: "groups" as const, label: "Groups", count: rootGroups.length }] : []),
        { key: "rows" as const, label: "Rows", count: rowCount },
        ...(hasMeasures ? [{ key: "measures" as const, label: "Measures", count: chartRows.length }] : []),
    ];

    return (
        <Box css={styles.narrowRoot} data-plan-narrow data-plan-fill={fill ? "" : undefined}>
            {slice !== undefined && (railKinds.length > 0 || resolutions.length > 0) && (
                <Box css={styles.narrowChips} data-slot="narrowChips">
                    {railKinds.length > 0 && <SliceRailCluster slice={slice} affordanceKinds={railKinds} />}
                    {resolutions.length > 0 && (
                        <ResolutionChip resolution={resolution} resolutions={resolutions}
                            onPick={(r) => dispatch({ t: "resolution.set", resolution: r })} />
                    )}
                </Box>
            )}
            <Box css={tabStyles.list} role="tablist" data-slot="narrowTabs" data-part="list" flexShrink={0}>
                {tabs.map((t) => (
                    <Box key={t.key} as="button" role="tab" css={tabStyles.trigger} data-part="trigger"
                        data-plan-tab={t.key} data-selected={activeTab === t.key ? "" : undefined}
                        aria-selected={activeTab === t.key}
                        onClick={() => setTab(t.key)}>
                        {t.label}
                        <Box as="span" css={styles.narrowTabCount} data-plan-tabcount={t.count}>
                            {`${partial === true && t.key !== "groups" ? "~" : ""}${t.count}`}
                        </Box>
                    </Box>
                ))}
            </Box>
            <Box ref={listRef} css={styles.narrowList} data-slot="narrowList"
                onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
                <NarrowRuler styles={styles} />
                {list}
            </Box>
            <PlanFooter styles={styles} items={footer} transport={transport} />
        </Box>
    );
}
