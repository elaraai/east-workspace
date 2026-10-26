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
 * now-line. The input model does: tap selects, a second
 * tap on a row that declares `expand` drills it in place (~148pt; its
 * neighbours keep their size — a vertical list needs no strip compression),
 * horizontal pan is two-finger so page scroll stays vertical. The horizon
 * brush does not mount: the window rides the slice's range in the frame's
 * toolbar and the pan, the resolution the toolbar's segment. A paged source
 * shows its resident prefix, and the frame's footer says so.
 *
 * The layout is the frame's main below 480px of it (#1193): its controls are
 * the frame's toolbar's — the slice's chips, the resolution, the diagnostics
 * and the history item, folded to the room a phone leaves — and its counts
 * the frame's footer's, so the list draws no chip row or footer of its own.
 *
 * Failures stay local here too (#811): a card whose row cannot be placed
 * shows its diagnostic, a card whose plot throws shows its own fallback, and
 * a window whose read failed is a card with the reason and a Retry at the top
 * of the list; the frame's toolbar carries the diagnostics chips.
 *
 * A paged source pages around the LIST (#812). There is no virtualizer here
 * to report a mounted range, so the cards report themselves: an
 * `IntersectionObserver` watches every row card, and the last one on screen
 * is the viewport the driver pages around — prefetching past it, keeping what
 * is on screen resident. Once a list shows every resident row, its load-more
 * becomes the canvas's tail band in list form: scrolling it into view, or
 * tapping it, loads the next window.
 *
 * The cards (`cards.tsx`), the ruler (`chrome.tsx`), the list demand
 * (`demand.ts`) and the row walks (`lists.ts`) live beside this shell (#815).
 *
 * The tabs are Chakra's `Tabs` (Zag, #819): a tablist with a roving tab stop,
 * the arrow keys between tabs, and a tabpanel per tab — the list is the
 * selected tab's panel.
 *
 * Events selected from outside the canvas — the overlaps chip's pair, a peer
 * the inspector's banner names (#1198) — ask for their row: the list opens
 * the row's group on the Rows tab, pages to it, and scrolls its card into
 * view, as the desktop canvas scrolls to the row.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type PointerEvent, type ReactNode } from "react";
import { Box, Tabs } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { type EastChakraComponent } from "@elaraai/east-ui-components";
import { NowLine } from "../../shared/time/now-line.js";
import { usePlanDispatch, usePlanGeometry, usePlanScale } from "../context.js";
import { usePlanSelector } from "../controller/react.js";
import type { PlanSnapshot } from "../controller/index.js";
import { GridSeparators } from "../rows/RowShell.js";
import { HeatCells } from "../rows/HeatRow.js";
import { PlanPartBoundary } from "../rows/PartBoundary.js";
import { RowDiagnostic } from "../rows/RowDiagnostic.js";
import { LoadingFailedLine, PlaceholderCard, PlaceholderShape, loadingLineText } from "@elaraai/east-ui-components/internal";
import { bandElements } from "../use-plan-paging.js";
import {
    rowHeight, spansWindows,
    type PlanBand, type PlanDerived, type PlanRowIndex, type PlanRowValue, type PlanWindowFailure,
} from "../model.js";
import { appendAll } from "../reductions.js";
import { statusText } from "../a11y.js";
import { usePlanWords } from "../words.js";
import type { RowKey } from "../plan-state.js";
import type { PlanUiView } from "../root/view.js";
import type { PlanDraftMark } from "../use-plan-editing.js";
import { feedTwoFingerPan, newTwoFingerPan } from "./pan.js";
import { NarrowRowCard } from "./cards.js";
import { NarrowRuler } from "./chrome.js";
import { useListDemand, type PlanNarrowPaging } from "./demand.js";
import { allDataRows, dataRowsUnder, peakOf, summaryArm } from "./lists.js";

type Styles = Record<string, Record<string, unknown>>;
type UIValue = ComponentProps<typeof EastChakraComponent>["value"];

export type { PlanNarrowPaging } from "./demand.js";

/** The narrow breakpoint — the adaptive contract's compact class (#346). */
export const PLAN_NARROW_BELOW = 480;
/** Cards shown before the `N more …` load-more, per list. */
const PAGE_GROUPS = 6;
const PAGE_ROWS = 8;
/** A row card's height, px: what a paged source's tail draws its placeholder cards at (#1398) — a head line over a span plot. */
const PENDING_CARD_PX = 72;
/** A card body's inset from the list edge: 12px list padding + 1px card
 *  border + 12px body margin — the recipe's `narrowRuler` margin matches. */
const BODY_INSET_PX = 25;
/** The Rows-tab scope for root data rows that belong to no group. */
const OTHER_SCOPE = " other";

type NarrowTab = "groups" | "rows" | "measures";

/** One run of row cards on the Rows tab — under a group header when the
 *  list is unscoped, bare when it is one group's rows. */
interface RowSection {
    key: string;
    header?: { scope: RowKey; label: string; meta: ReactNode | undefined; value: string | undefined; tone: string | undefined };
    rows: PlanRowValue[];
}

export interface PlanNarrowProps {
    styles: Styles;
    index: PlanRowIndex;
    derived: PlanDerived;
    /** The UI facts the cards read — the selection each list reads itself. */
    view: PlanUiView;
    dense: boolean;
    storageKey: string;
    /** The focused row's developer render / gutter body (the root resolvers
     *  called with the focus), or `null`. */
    expandBody: UIValue | null;
    expandGutterBody: UIValue | null;
    /** Whether the root declares `expandRender` at all. */
    canExpand: boolean;
    /** Whether the source is not yet exhausted (`PlanTransport.partial`) — the
     *  tab counts, and a top-level section's member count, then cover only the
     *  loaded windows (`spansWindows`, #822). */
    partial: boolean | undefined;
    /**
     * A paged source's own count, once a completed read says it (#1398, CL13):
     * what the Rows tab counts, as the rail counts the source — never the rows
     * read so far. `undefined` on an inline canvas, and while the count is not
     * known — or is a new narrowing's, the last narrowing's rows standing in.
     */
    pagedCount?: number | undefined;
    /** A bounded frame — the list scrolls inside it. */
    fill: boolean;
    /** Windows whose read failed (#811) — a card each, with a Retry. */
    failures?: readonly PlanWindowFailure[] | undefined;
    /** Ask a failed window again. */
    onRetry?: ((w: number) => void) | undefined;
    /** A paged source's demand (#812) — absent on an inline canvas, which
     *  has nothing to demand. */
    paging?: PlanNarrowPaging | undefined;
    /** What the rail counts the rows in — `work orders`: what a failed window's line names them by (#1398). */
    noun: string;
    /** Each drafted row's mark, by row key (#880) — a card wears its row's. */
    marks: ReadonlyMap<RowKey, PlanDraftMark>;
}

const selectSelected = (s: PlanSnapshot) => s.store.ui.selected;
const selectScroll = (s: PlanSnapshot) => s.scroll;

/**
 * A paged source's tail in list form (#812, #1398): placeholder cards at a row
 * card's height, saying nothing. The list's observer demands the next window
 * as they come into view; with no observer to say so, their showing does — the
 * reader has revealed every row there is.
 */
function PendingTail({ tail, watch, onLoadMore, styles }: {
    tail: PlanBand;
    watch: ((el: HTMLElement | null) => (() => void) | undefined) | undefined;
    onLoadMore: () => void;
    styles: Styles;
}) {
    useEffect(() => {
        if (watch === undefined) onLoadMore();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- shown once at each place the run ends (its key)
    }, []);
    return (
        <Box ref={watch} css={styles.narrowPending} data-plan-more="source" data-plan-elements={bandElements(tail)}
            aria-busy={tail.loading !== undefined ? "true" : undefined}>
            <PlaceholderCard height={PENDING_CARD_PX} index={tail.from} />
            <PlaceholderCard height={PENDING_CARD_PX} index={tail.from + 1} />
        </Box>
    );
}

/** The narrow shell: tabs · ruler · card list. */
export function PlanNarrow({
    styles, index, derived, view, dense, storageKey,
    expandBody, expandGutterBody, canExpand, partial, pagedCount, fill,
    failures, onRetry, paging, marks, noun,
}: PlanNarrowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const geometry = usePlanGeometry();
    const words = usePlanWords();
    // A member count as a group's meta (#820) — a short bar while it covers only the loaded windows: never a count
    // the read has not finished (#1398, CL13).
    const membersText = (count: number): string => words.m.groupMeta({ n: count, count: words.number(count) });
    const membersMeta = (count: number, over: boolean): ReactNode =>
        (over ? <PlaceholderShape kind="aggregate" index={count} /> : membersText(count));
    // Whether a group's derived count covers only the loaded windows: a
    // top-level section's, on a source not yet exhausted — every other
    // group's members ride in its own entry (#822).
    const countPartial = (row: PlanRowValue) => partial === true && spansWindows(row);
    // The selection is read HERE, not passed down: a tap re-renders the list,
    // and each card's memo lets through only the two whose selection moved.
    const selected = usePlanSelector(selectSelected);
    // Paged demand (#812): row cards and the load-more card enrol here.
    const watch = useListDemand(paging);

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
                        : (members !== undefined && members > 0 ? membersMeta(members, countPartial(root)) : undefined),
                    value: root.gutter.value.type === "some" ? root.gutter.value.value : undefined,
                    tone: root.status.type === "some" ? root.status.value.type : undefined,
                },
                rows: dataRowsUnder(index, root.key),
            });
        }
        if (other.length > 0) {
            out.push({
                key: "other",
                header: { scope: OTHER_SCOPE, label: words.m.otherRows(), meta: membersMeta(other.length, false), value: undefined, tone: undefined },
                rows: other,
            });
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `membersMeta` reads only `words`, which is a dependency
    }, [scope, index, ungrouped, hasGroups, derived, partial, words]);

    // Keep the last revealed row by key. Prefetch may prepend an earlier
    // window: a fixed count would then remove the card the reader jumped to,
    // defeating native scroll anchoring and paging back towards the start.
    const sectionRows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
    const pageEnd = useRef<{ scope: RowKey | null; key: RowKey | undefined; requested: number } | undefined>(undefined);
    const previous = pageEnd.current;
    const end = previous?.scope === scope ? sectionRows.findIndex((row) => row.key === previous.key) : -1;
    const rowLimit = Math.max(reveal.rows, end >= 0 ? end + 1 + Math.max(0, reveal.rows - previous!.requested) : 0);
    useLayoutEffect(() => {
        if (activeTab === "rows") pageEnd.current = {
            scope, key: sectionRows[Math.min(rowLimit, sectionRows.length) - 1]?.key, requested: reveal.rows,
        };
    }, [activeTab, scope, sectionRows, rowLimit, reveal.rows]);

    // ── A row asked for from outside the canvas (#1198) ───────────────────
    // Its group opened on the Rows tab, the list paged to it, and its card
    // scrolled into view once drawn. A request made before the list mounted
    // is the desktop canvas's, already served.
    const scroll = usePlanSelector(selectScroll);
    const requested = scroll.owner === "search" ? scroll.targetKey : scroll.owner === "nav" ? scroll.nav?.row : undefined;
    const request = requested === undefined ? undefined
        : `${scroll.owner}:${scroll.owner === "search" ? scroll.searchSeq : scroll.nav?.seq}`;
    const served = useRef(request);
    const [revealing, setRevealing] = useState<RowKey | undefined>(undefined);
    // Reveal before the parent releases the paging jump after commit. Otherwise
    // the old cards report their viewport and pull residency back to that window.
    useLayoutEffect(() => {
        if (request === undefined || request === served.current || requested === undefined) return;
        const row = index.byKey.get(requested);
        if (row === undefined) return;
        served.current = request;
        let root = row;
        for (let up = row.parent; up.type === "some";) {
            const parent = index.byKey.get(up.value);
            if (parent === undefined) break;
            root = parent;
            up = parent.parent;
        }
        const scoped = row.kind.type === "group" ? row.key
            : root.key !== row.key && root.kind.type === "group" ? root.key : hasGroups ? OTHER_SCOPE : null;
        const list = scoped === null ? allDataRows(index)
            : scoped === OTHER_SCOPE ? ungrouped.flatMap((r) => [r, ...dataRowsUnder(index, r.key)])
                : dataRowsUnder(index, scoped);
        const at = row.kind.type === "group" ? 0 : list.findIndex((r) => r.key === row.key);
        if (at < 0) return;
        setTab("rows");
        setScope(scoped);
        setReveal((r) => ({ ...r, rows: Math.max(r.rows, (Math.floor(at / PAGE_ROWS) + 1) * PAGE_ROWS) }));
        setRevealing(row.key);
    }, [request, requested, index, ungrouped, hasGroups]);

    // ── Two-finger pan (§10) — one whole period per period width crossed ──
    const listRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        if (revealing === undefined) return;
        const card = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-plan-card], [data-plan-scope]") ?? [])]
            .find((el) => (el.getAttribute("data-plan-card") ?? el.getAttribute("data-plan-scope")) === revealing);
        card?.scrollIntoView({ block: "nearest" });
        setRevealing(undefined);
    }, [revealing]);
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

    const nowLine = scale.nowFrac !== undefined ? <NowLine styles={styles} at={scale.nowFrac} data-plan-axisline /> : null;

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
                styles={styles} derived={derived} storageKey={storageKey}
                watch={watch} draft={marks.get(row.key)} />
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
    // (#812): the canvas's tail band in list form — placeholder cards at a
    // row card's height, their title and meta bars, saying nothing (#1398,
    // CL2, CL3). Scrolling them into view (the list's observer) demands the
    // next window; once it lands, the list's own next page offers its rows.
    // Keyed by where the unloaded run starts, so a landing that leaves them on
    // screen re-arms the observer instead of stranding the list.
    const loadMore = () => {
        const tail = paging?.tail;
        if (paging === undefined || tail === undefined) return null;
        return <PendingTail key={`source-${tail.from}`} tail={tail} watch={watch} onLoadMore={paging.onLoadMore} styles={styles} />;
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
                        : (members !== undefined && members > 0 ? membersMeta(members, countPartial(row)) : undefined);
                    const value = row.gutter.value.type === "some" ? row.gutter.value.value : undefined;
                    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
                    return (
                        <Box key={row.key} css={styles.narrowCard} data-plan-groupcard={row.key}
                            onClick={() => openGroup(row.key)}>
                            <Box css={styles.narrowCardHead}>
                                <Box css={styles.narrowCardTitle} data-group="">{row.gutter.label}</Box>
                                {meta !== undefined && <Box as="span" css={styles.gutterMeta}>{meta}</Box>}
                                <Box display="flex" alignItems="center" gap="6px" marginLeft="auto" flexShrink={0}>
                                    {statusTone !== undefined && <Box as="span" css={styles.statusDot} data-tone={statusTone}
                                        role="img" aria-label={statusText(statusTone, words)} />}
                                    {value !== undefined && <Box as="span" css={styles.gutterValue}>{value}</Box>}
                                </Box>
                            </Box>
                            {arm !== undefined && (
                                <Box css={styles.narrowCardBody} height={`${geometry.narrowStrip}px`} data-plan-cardbody="group">
                                    <GridSeparators styles={styles} />
                                    {derived.diagnostics.has(row.key) ? (
                                        <RowDiagnostic diagnostic={derived.diagnostics.get(row.key)!} styles={styles} />
                                    ) : (
                                        <PlanPartBoundary part={{ kind: "group", label: row.gutter.label }} resetKey={arm} styles={styles}>
                                            <HeatCells rowKey={row.key} cells={arm} styles={styles} onCellClick={() => openGroup(row.key)} />
                                        </PlanPartBoundary>
                                    )}
                                    {nowLine}
                                </Box>
                            )}
                        </Box>
                    );
                })}
                {hidden.length > 0 ? more("groups", words.m.moreGroups({
                    n: hidden.length,
                    count: words.number(hidden.length),
                    members: hiddenRs > 0 ? membersText(hiddenRs) : undefined,
                })) : loadMore()}
                {ungrouped.length > 0 && (
                    <Box css={styles.narrowCard} data-plan-groupcard="other" onClick={() => openGroup(OTHER_SCOPE)}>
                        <Box css={styles.narrowCardHead}>
                            <Box css={styles.narrowCardTitle} data-group="">{words.m.otherRows()}</Box>
                            <Box as="span" css={styles.gutterMeta}>{membersMeta(ungrouped.length, false)}</Box>
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
        let budget = rowLimit;
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
                            {h.tone !== undefined && <Box as="span" css={styles.statusDot} data-tone={h.tone}
                                role="img" aria-label={statusText(h.tone, words)} />}
                            {h.value !== undefined && <Box as="span" css={styles.gutterValue}>{h.value}</Box>}
                            <Box as="span" css={styles.narrowSectionGo} aria-hidden><FontAwesomeIcon icon={faChevronRight} /></Box>
                        </Box>
                    </Box>,
                );
            }
            for (const row of shown) body.push(renderRowCard(row, false));
        }
        const rest = total - (rowLimit - Math.max(0, budget));
        list = (
            <>
                {(scopeGroup !== undefined || scope === OTHER_SCOPE) && (
                    <Box css={styles.narrowScope} data-slot="narrowScope" data-plan-scope={scopeGroup?.key}>
                        {hasGroups && (
                            <Box as="button" css={styles.narrowBack} data-plan-back=""
                                onClick={() => { setScope(null); setTab(groupsIndex ? "groups" : "rows"); }}>
                                {groupsIndex ? words.m.backToGroups() : words.m.backToAllRows()}
                            </Box>
                        )}
                        <Box css={styles.narrowScopeTitle}>{scopeGroup !== undefined ? scopeGroup.gutter.label : words.m.otherRows()}</Box>
                        <Box css={styles.narrowScopeMeta}>
                            {[members !== undefined && members > 0 ? membersText(members) : undefined, scopeValue].filter(Boolean).join(" · ")}
                        </Box>
                    </Box>
                )}
                {/* "No rows" only once a completed read says so (#1398, CL13): never while the source holds more. */}
                {total === 0 && paging?.tail === undefined && <Box css={styles.narrowEmpty}>{words.m.noRows()}</Box>}
                {body}
                {rest > 0 ? more("rows", words.m.moreRows({ n: rest, count: words.number(rest) })) : loadMore()}
            </>
        );
    } else {
        const shown = chartRows.slice(0, reveal.measures);
        const rest = chartRows.length - shown.length;
        list = (
            <>
                {shown.map((row) => renderRowCard(row, true))}
                {rest > 0 ? more("measures", words.m.moreMeasures({ n: rest, count: words.number(rest) })) : loadMore()}
            </>
        );
    }

    // The tab strip is `<Tabs>` itself, in its line variant — underline only,
    // no fill, the mono eyebrow grammar, the hairline baseline the active
    // underline overlaps — so the strip cannot drift from the spec by
    // re-declaring it, and brings Zag's keyboard and tabpanels (#819).
    // Counts ride each label as plain numerals (never a tinted pill). Over a paged source the Rows tab counts what the
    // source does, once its count is read — the rail's count, never the rows read so far — and a count that covers only
    // what has landed is `…` (#1398, CL13).
    const rowCount = allDataRows(index).length;
    const tabs: Array<{ key: NarrowTab; label: string; count: number; known: boolean }> = [
        ...(hasGroups ? [{ key: "groups" as const, label: words.m.tabGroups(), count: rootGroups.length, known: true }] : []),
        pagedCount !== undefined ? { key: "rows" as const, label: words.m.tabRows(), count: pagedCount, known: true }
            : { key: "rows" as const, label: words.m.tabRows(), count: rowCount, known: partial !== true },
        ...(hasMeasures ? [{ key: "measures" as const, label: words.m.tabMeasures(), count: chartRows.length, known: partial !== true }] : []),
    ];

    return (
        <Tabs.Root asChild value={activeTab} onValueChange={(d) => setTab(d.value as NarrowTab)}
            variant="line" size="md">
            <Box css={styles.narrowRoot} data-plan-narrow data-plan-fill={fill ? "" : undefined}>
                <Tabs.List data-slot="narrowTabs" flexShrink={0}>
                    {tabs.map((t) => (
                        <Tabs.Trigger key={t.key} value={t.key} data-plan-tab={t.key}>
                            {t.label}
                            {/* "…" while it counts only what has landed: never a count the read has not finished (#1398, CL13). */}
                            <Box as="span" css={styles.narrowTabCount} data-plan-tabcount={t.count}>
                                {t.known ? words.m.tabCount({ n: t.count, count: words.number(t.count) }) : "…"}
                            </Box>
                        </Tabs.Trigger>
                    ))}
                </Tabs.List>
                {/* One tabpanel per tab; the selected one IS the list. Only it
                    wears the list's styles: a recipe `display` outranks the
                    `hidden` Zag puts on the others. */}
                {tabs.map((t) => (t.key !== activeTab ? <Tabs.Content key={t.key} value={t.key} /> : (
                    <Tabs.Content key={t.key} value={t.key} ref={listRef} css={styles.narrowList} data-slot="narrowList"
                        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                        onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
                        <NarrowRuler styles={styles} />
                        {/* A window whose read failed (#811) — said once, as the canvas's run says it (#1398, CL11):
                            the reason and Retry, above whatever did land. */}
                        {(failures ?? []).map((f) => {
                            const range = { from: words.number(f.from + 1), to: words.number(f.to + 1) };
                            return (
                                <Box key={`failed-${f.w}`} css={styles.narrowCard} data-plan-failed={f.w}>
                                    <Box css={styles.narrowCardHead}>
                                        <LoadingFailedLine message={loadingLineText(words.m.lineFailed({ noun, ...range }))}
                                            retry={{ onRetry: () => onRetry?.(f.w), label: words.m.retry(), name: words.m.retryRange({ noun, ...range }) }} />
                                    </Box>
                                </Box>
                            );
                        })}
                        {list}
                    </Tabs.Content>
                )))}
            </Box>
        </Tabs.Root>
    );
}
