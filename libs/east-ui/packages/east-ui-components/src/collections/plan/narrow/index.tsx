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
 *
 * Failures stay local here too (#811): a card whose row cannot be placed
 * shows its diagnostic, a card whose plot throws shows its own fallback, a
 * window whose read failed is a card with the reason and a Retry at the top
 * of the list, and the chip row carries the diagnostics chips.
 *
 * A paged source pages around the LIST (#812). There is no virtualizer here
 * to report a mounted range, so the cards report themselves: an
 * `IntersectionObserver` watches every row card, and the last one on screen
 * is the viewport the driver pages around — prefetching past it, keeping what
 * is on screen resident. Once a list shows every resident row, its load-more
 * becomes the canvas's tail band in list form: scrolling it into view, or
 * tapping it, loads the next window.
 *
 * The cards (`cards.tsx`), the ruler and resolution chip (`chrome.tsx`), the
 * list demand (`demand.ts`) and the row walks (`lists.ts`) live beside this
 * shell (#815).
 */

import { useMemo, useRef, useState, type ComponentProps, type PointerEvent, type ReactNode } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan, Slice } from "@elaraai/east-ui/internal";
import type { EastChakraComponent } from "../../../component.js";
import { SliceRailCluster } from "../../../slice/rail/index.js";
import { railAffordanceKinds } from "../../../slice/rail-kinds.js";
import { useSliceReactivity } from "../../../slice/use-slice-reactivity.js";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { usePlanSelector } from "../controller/react.js";
import type { PlanSnapshot } from "../controller/index.js";
import { GridSeparators } from "../rows/RowShell.js";
import { HeatCells } from "../rows/HeatRow.js";
import { PlanPartBoundary } from "../rows/PartBoundary.js";
import { RowDiagnostic } from "../rows/RowDiagnostic.js";
import { bandCaption, failureCaption } from "../rows/WindowBand.js";
import { bandElements } from "../use-plan-paging.js";
import { PlanFooter } from "../shell/Footer.js";
import { PlanDiagnosticChips, hasDiagnostics, type PlanDiagnostics } from "../shell/Diagnostics.js";
import type { PlanReview } from "../shell/Review.js";
import type { PlanTransport } from "../shell/transport.js";
import {
    rowHeight,
    type PlanDerived, type PlanRowIndex, type PlanRowValue, type PlanWindowFailure,
} from "../model.js";
import { formatDerived, membersMeta } from "../format.js";
import { appendAll } from "../reductions.js";
import type { RowKey } from "../plan-state.js";
import type { PlanUiView } from "../root/view.js";
import { feedTwoFingerPan, newTwoFingerPan } from "./pan.js";
import { NarrowRowCard } from "./cards.js";
import { NarrowRuler, ResolutionChip } from "./chrome.js";
import { useListDemand, type PlanNarrowPaging } from "./demand.js";
import { allDataRows, dataRowsUnder, peakOf, summaryArm } from "./lists.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;
type FooterItemValue = ValueTypeOf<typeof Plan.Types.FooterItem>;
type UIValue = ComponentProps<typeof EastChakraComponent>["value"];

export type { PlanNarrowPaging } from "./demand.js";

/** The narrow breakpoint — the adaptive contract's compact class (#346). */
export const PLAN_NARROW_BELOW = 480;
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
    /** The UI facts the cards read — the selection each list reads itself. */
    view: PlanUiView;
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
     *  called with the focus), or `null`. */
    expandBody: UIValue | null;
    expandGutterBody: UIValue | null;
    /** Whether the root declares `expandRender` at all. */
    canExpand: boolean;
    partial: boolean | undefined;
    /** A bounded frame — the list scrolls inside it. */
    fill: boolean;
    /** What the canvas carried on past (#811) — the chip row states it. The
     *  rows chip does not seek here: the narrow list has no scroll target. */
    diagnostics?: PlanDiagnostics | undefined;
    /** Windows whose read failed (#811) — a card each, with a Retry. */
    failures?: readonly PlanWindowFailure[] | undefined;
    /** Ask a failed window again. */
    onRetry?: ((w: number) => void) | undefined;
    /** A paged source's demand (#812) — absent on an inline canvas, which
     *  has nothing to demand. */
    paging?: PlanNarrowPaging | undefined;
}

const selectSelected = (s: PlanSnapshot) => s.store.ui.selected;

/** The narrow shell: chips · tabs · ruler · card list · footer. */
export function PlanNarrow({
    styles, index, derived, view, dense, barHeight, storageKey,
    slice, affordances, resolution, resolutions, transport, footer, review,
    expandBody, expandGutterBody, canExpand, partial, fill,
    diagnostics, failures, onRetry, paging,
}: PlanNarrowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    // The selection is read HERE, not passed down: a tap re-renders the list,
    // and each card's memo lets through only the two whose selection moved.
    const selected = usePlanSelector(selectSelected);
    // Paged demand (#812): row cards and the load-more card enrol here.
    const watch = useListDemand(paging);
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
            if (root.kind.type !== "group") {
                other.push(root);
                appendAll(other, dataRowsUnder(index, root.key));
                continue;
            }
            const members = derived.groupMembers.get(root.key);
            out.push({
                key: root.key,
                header: {
                    scope: root.key,
                    label: root.gutter.label,
                    meta: root.gutter.meta.type === "some" ? root.gutter.meta.value
                        : (members !== undefined && members > 0 ? membersMeta(members, partial) : undefined),
                    value: root.gutter.value.type === "some" ? root.gutter.value.value : undefined,
                    tone: root.status.type === "some" ? root.status.value.type : undefined,
                },
                rows: dataRowsUnder(index, root.key),
            });
        }
        if (other.length > 0) {
            out.push({ key: "other", header: { scope: OTHER_SCOPE, label: "Other rows", meta: membersMeta(other.length, undefined), value: undefined, tone: undefined }, rows: other });
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

    // One data row as a card — its facts computed here, its render memoized
    // (`NarrowRowCard`), so a list that grows re-renders only what it adds.
    const renderRowCard = (row: PlanRowValue, measures: boolean) => {
        const isChart = row.kind.type === "chart";
        // Measures stack at EXPANDED density (§10): force the chart's expanded
        // branch (it still honours a declared fixed / expandedHeight).
        const h = rowHeight({ row, depth: 0, collapsed: false }, dense,
            measures && isChart ? new Set([row.key]) : view.chartsExpanded, undefined, derived);
        const chartExpanded = row.kind.type === "chart" && (measures
            || row.kind.value.height.type === "expanded" || view.chartsExpanded.has(row.key));
        const drilled = view.focus !== null && view.focus.kind === "expand" && view.focus.key === row.key;
        return (
            <NarrowRowCard key={row.key} row={row} h={h} chartExpanded={chartExpanded}
                selected={selected === row.key}
                canDrill={canExpand && row.expand.type === "some"}
                drill={drilled && expandBody !== null ? { body: expandBody, gutter: expandGutterBody } : undefined}
                hasChildren={(index.children.get(row.key)?.length ?? 0) > 0}
                styles={styles} derived={derived} storageKey={storageKey} barHeight={barHeight}
                partial={partial} review={review} watch={watch} />
        );
    };

    const revealMore = (key: NarrowTab) =>
        setReveal((r) => ({ ...r, [key]: r[key] + (key === "groups" ? PAGE_GROUPS : PAGE_ROWS) }));
    const more = (key: NarrowTab, label: string) => (
        <Box as="button" css={styles.narrowMore} data-plan-more={key} onClick={() => revealMore(key)}>
            {label}
        </Box>
    );
    // A list that shows every resident row while the source holds more
    // (#812): the canvas's tail band in list form. Scrolling it into view (the
    // list's observer) or tapping it demands the next window; the tap also
    // opens the next page, so the landed rows show without a second tap. Keyed
    // by where the unloaded run starts, so a landing that leaves it on screen
    // re-arms the observer instead of stranding the list.
    const loadMore = (key: NarrowTab) => {
        const tail = paging?.tail;
        if (paging === undefined || tail === undefined) return null;
        return (
            <Box key={`source-${tail.from}`} ref={watch} as="button" css={styles.narrowMore}
                data-plan-more="source" data-plan-elements={bandElements(tail)}
                aria-busy={paging.loading ? "true" : undefined}
                onClick={() => { revealMore(key); paging.onLoadMore(); }}>
                {bandCaption(tail, paging.loading)}
            </Box>
        );
    };

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
                        : (members !== undefined && members > 0 ? membersMeta(members, partial) : undefined);
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
                                    {derived.diagnostics.has(row.key) ? (
                                        <RowDiagnostic diagnostic={derived.diagnostics.get(row.key)!} styles={styles} />
                                    ) : (
                                        <PlanPartBoundary part={`group ${row.gutter.label}`} resetKey={arm} styles={styles}>
                                            <HeatCells rowKey={row.key} cells={arm} styles={styles} onCellClick={() => openGroup(row.key)} />
                                        </PlanPartBoundary>
                                    )}
                                    {nowLine}
                                </Box>
                            )}
                        </Box>
                    );
                })}
                {hidden.length > 0 ? more("groups",
                    `${formatDerived(hidden.length)} more group${hidden.length > 1 ? "s" : ""}${hiddenRs > 0 ? ` · ${membersMeta(hiddenRs, undefined)}` : ""}`)
                    : loadMore("groups")}
                {ungrouped.length > 0 && (
                    <Box css={styles.narrowCard} data-plan-groupcard="other" onClick={() => openGroup(OTHER_SCOPE)}>
                        <Box css={styles.narrowCardHead}>
                            <Box css={styles.narrowCardTitle} data-group="">Other rows</Box>
                            <Box as="span" css={styles.gutterMeta}>{membersMeta(ungrouped.length, undefined)}</Box>
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
            for (const row of shown) body.push(renderRowCard(row, false));
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
                            {[members !== undefined && members > 0 ? membersMeta(members, undefined) : undefined, scopeValue].filter(Boolean).join(" · ")}
                        </Box>
                    </Box>
                )}
                {total === 0 && <Box css={styles.narrowEmpty}>No rows</Box>}
                {body}
                {rest > 0 ? more("rows", `${formatDerived(rest)} more row${rest > 1 ? "s" : ""}`) : loadMore("rows")}
            </>
        );
    } else {
        const shown = chartRows.slice(0, reveal.measures);
        const rest = chartRows.length - shown.length;
        list = (
            <>
                {shown.map((row) => renderRowCard(row, true))}
                {rest > 0 ? more("measures", `${formatDerived(rest)} more measure${rest > 1 ? "s" : ""}`) : loadMore("measures")}
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

    // The narrow list has no virtualizer to scroll, so the rows chip states
    // the count without offering to seek (#811).
    const narrowDiagnostics = diagnostics !== undefined ? { ...diagnostics, onSeekSkipped: undefined } : undefined;
    const sliceChips = slice !== undefined && (railKinds.length > 0 || resolutions.length > 0);

    return (
        <Box css={styles.narrowRoot} data-plan-narrow data-plan-fill={fill ? "" : undefined}>
            {(sliceChips || hasDiagnostics(narrowDiagnostics)) && (
                <Box css={styles.narrowChips} data-slot="narrowChips">
                    {slice !== undefined && railKinds.length > 0 && <SliceRailCluster slice={slice} affordanceKinds={railKinds} />}
                    {slice !== undefined && resolutions.length > 0 && (
                        <ResolutionChip resolution={resolution} resolutions={resolutions}
                            onPick={(r) => dispatch({ t: "resolution.set", resolution: r })} />
                    )}
                    {hasDiagnostics(narrowDiagnostics) && <PlanDiagnosticChips diagnostics={narrowDiagnostics} styles={styles} />}
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
                            {`${partial === true && t.key !== "groups" ? "~" : ""}${formatDerived(t.count)}`}
                        </Box>
                    </Box>
                ))}
            </Box>
            <Box ref={listRef} css={styles.narrowList} data-slot="narrowList"
                onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
                <NarrowRuler styles={styles} />
                {/* A window whose read failed (#811) — its reason and a Retry,
                    above whatever did land. */}
                {(failures ?? []).map((f) => (
                    <Box key={`failed-${f.w}`} css={styles.narrowCard} data-plan-failed={f.w} role="alert">
                        <Box css={styles.narrowCardHead}>
                            <Box css={styles.partError}>{failureCaption(f)}</Box>
                            <Box as="button" css={styles.windowRetry} data-plan-retry={f.w}
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRetry?.(f.w); }}>
                                Retry
                            </Box>
                        </Box>
                    </Box>
                ))}
                {list}
            </Box>
            <PlanFooter styles={styles} items={footer} transport={transport} />
        </Box>
    );
}
