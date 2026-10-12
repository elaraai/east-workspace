/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's toolbar items (#1193, `Plan Builder Spec.md` §7.1) — every
 * control the Plan draws outside its canvas, as items of its frame's one
 * toolbar (`BuilderFrame`'s), in this order: the slice's narrowing (cohort ·
 * filter · search), the scope badge, the key search, Expand/Collapse all,
 * the shared date navigator or numeric Slice range, the resolution, the diagnostics; then, at the
 * row's end, the summary, the overlaps chip and the history item. The fold toggle acts on every parent, including nested rows,
 * and keeps the same per-row state as the disclosure buttons. There is no Series button: the library's
 * Series tab holds the series (#1195). The overlaps chip (#1198, PB52) counts the pairs of events
 * that overlap in the window; a click selects the first pair, earliest first,
 * and brings it into view.
 *
 * They fold on one ladder (#952): the slice rail's two clusters first — the
 * narrowing affordances and the range, merged in the rail's order — then the
 * Plan's own items (the user's decision, 2026-09-27): the summary shortens to
 * its count and the overlaps chip to its glyph and its count — words give way
 * before a control does — then the resolution segment folds into a one-chip
 * menu, then the fold toggle keeps only its icon, and the summary hides. On a row narrower
 * still the key search folds into its icon, which opens the box in a popover
 * (#1193): with that, a phone's row holds every item. The history item folds
 * last, to its buttons. Before that last step, a time-axis Plan folds its
 * group and resolution controls into the shared date navigator, as Calendar
 * and Roster do. Nothing wraps or goes to a second row.
 */

import { useMemo } from "react";
import { Box, Button, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAnglesDown, faAnglesUp, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import {
    HOST_RANK, coarseHitArea, useSliceToolbarItems, useRecordSliceToolbarItems, railAffordanceKinds,
} from "@elaraai/east-ui-components/internal";
import {
    useSliceReactivity, type ToolbarItem, historyToolbarItem, useKeySearchToolbarItem,
} from "@elaraai/east-ui-components";
import { usePlanDispatch } from "../context.js";
import { usePlanController, usePlanSelector } from "../controller/react.js";
import { transportLabel } from "./transport.js";
import { usePlanWords } from "../words.js";
import { PlanDiagnosticChips, hasDiagnostics } from "./Diagnostics.js";
import type { PlanChrome } from "../root/chrome.js";
import type { PlanOverlaps } from "../frame/counts.js";
import { Seg, SegMenu } from "../../shared/schedule/segments.js";
export { Seg, SegMenu } from "../../shared/schedule/segments.js";
import { PlanTimeNavigator } from "./TimeNavigator.js";
import { scheduleEventKey } from "../../shared/schedule/overlaps.js";

/** Narrowing affordances whose meaning CHANGES on a paged canvas: they narrow
 *  whatever the host fed, which is the prefix that happened to land. `search`
 *  is here only for a source that cannot seek — where it can, `search` is
 *  replaced outright by the key search rather than badged. */
const NARROWING_KINDS = new Set(["filter", "cohort", "presets", "breakdown", "search"]);

/** The Plan's own fold ranks, after every step of the slice rail's (#952):
 *  the summary shortens and the overlaps chip keeps its glyph and its count
 *  (one rank: the summary first, in the row's order), the resolution then the
 *  fold toggle shorten, the summary hides, and the key search
 *  folds into its icon. The history item's step (`DEFAULT_RANK`) comes after
 *  all of them. */
const PLAN_RANK = {
    summaryShort: HOST_RANK,
    overlapsShort: HOST_RANK,
    resolution: HOST_RANK + 1,
    grain: HOST_RANK + 2,
    summaryHide: HOST_RANK + 3,
    seek: HOST_RANK + 4,
    time: HOST_RANK,
    controls: HOST_RANK + 6,
} as const;


/** Props of {@link OverlapsChip}. */
interface OverlapsChipProps {
    /** How many pairs overlap. */
    readonly n: number;
    /** Only its glyph and its count: the form a row short of room keeps. */
    readonly short: boolean;
    /** Selects the first pair and brings it into view. */
    readonly onSelect: () => void;
}

/**
 * The overlaps chip (#1198, PB52): the warn chip with its glyph and the pairs
 * it counts — `3 overlaps`, or `3` on a row short of room — whose click
 * selects the first pair. A 44px target on a coarse pointer, by its halo (#346).
 */
function OverlapsChip({ n, short, onSelect }: OverlapsChipProps) {
    const chip = useRecipe({ key: "chip" });
    const words = usePlanWords();
    const count = words.number(n);
    return (
        <chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]}
            data-plan-overlaps={short ? "short" : ""} aria-label={words.m.overlapsLabel({ n, count })} onClick={onSelect}>
            <Box as="span" data-chip-icon="" aria-hidden="true"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>
            {short ? words.m.overlapsShort({ n, count }) : words.m.overlaps({ n, count })}
        </chakra.button>
    );
}

/**
 * The Plan's toolbar items, in §7.1's order and on its fold ladder (see the
 * module docs) — for its frame's one toolbar. Read inside the canvas's
 * contexts (`PlanCanvasParts.provide`): the segments dispatch to the canvas's
 * controller.
 *
 * @param chrome - What the canvas's chrome is drawn from; `undefined` with no window
 * @param overlaps - The overlaps among the window's events (#1198): the chip shows while there is a pair; `undefined` for a Plan without event kinds
 * @returns The items, a falsy entry for each the Plan has no use for — none with no window
 */
export function usePlanToolbarItems(chrome: PlanChrome | undefined, overlaps?: PlanOverlaps | undefined): ReadonlyArray<ToolbarItem | false | undefined> {
    const dispatch = usePlanDispatch();
    const controller = usePlanController();
    const folded = usePlanSelector(snapshot => {
        const keys = controller.groupKeys();
        return keys.length === 0 ? undefined : snapshot.store.ui.grain === "group" || keys.some(key => snapshot.store.ui.collapsed.has(key));
    });
    const words = usePlanWords();
    const slice = chrome?.slice;
    const recordChrome = chrome?.recordChrome;
    const affordances = chrome?.affordances;
    const search = chrome?.search;
    const transport = chrome?.transport;
    const resolutions = chrome?.resolutions;
    // The configured resolutions, in the app's words.
    const resolutionItems = useMemo(
        () => (resolutions ?? []).map((r) => ({ key: r, label: words.m.resolutionName({ resolution: r }) })),
        [resolutions, words]);
    // Self-subscribe on the slice key (#611): a store write does not change
    // any prop identity here, so a memo over STORE READS must key on the
    // store's own version — a re-render alone never busts a memo whose deps
    // did not move. This is what keeps the cohort chip, the summary counts
    // and the scope badge honest on a chrome-only bound slice, where a state
    // change re-derives no rows.
    const sliceVersion = useSliceReactivity(slice?.key);
    // Rail affordances: route the listed kinds through `railAffordanceKinds`
    // (auto-appended cohort etc.), then drop the kinds that mount as Plan
    // chrome rather than rail chips — `brush` (the horizon strip, in main),
    // `legend`, and the Plan's own arms (`resolution` segment, `summary`
    // count line). `range` is a cluster of its own, between the segments, so
    // §7.1's order holds.
    // A seek-capable paged source replaces `search` entirely: filtering the
    // loaded prefix and seeking the whole source are different operations, and
    // mounting both would offer the same word for both meanings.
    const railKinds = useMemo(
        () => (slice === undefined || affordances === undefined ? [] : railAffordanceKinds(affordances, slice.read())
            .filter((k) => k !== "brush" && k !== "legend" && k !== "resolution" && k !== "summary")
            .filter((k) => !(k === "search" && search !== undefined))),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of `slice.read()`: the auto-injected cohort chip appears when the STORE moves, not when a prop does (#611)
        [affordances, slice, search, sliceVersion],
    );
    const clusterKinds = useMemo(() => railKinds.filter((k) => k !== "range"), [railKinds]);
    const recordRange = recordChrome?.slice.config.range;
    const timeNavigation = chrome?.scale.kind === "time" && (railKinds.includes("range")
        || (recordRange?.type === "some" && (affordances?.includes("range") || affordances?.includes("fields"))));
    const rangeKinds = useMemo(() => railKinds.filter((k) => k === "range" && !timeNavigation), [railKinds, timeNavigation]);
    const rail = useSliceToolbarItems(slice, [
        { key: "cluster", kinds: clusterKinds },
        { key: "range", kinds: rangeKinds },
    ]);
    const recordRail = useRecordSliceToolbarItems(recordChrome?.slice, {
        ...(timeNavigation && recordRange?.type === "some" ? { excludeFields: [recordRange.value] } : {}),
        ...(affordances === undefined ? {} : { affordances: affordances.filter(kind => kind !== "resolution") }),
        ...(recordChrome?.persist.type === "some" ? { persist: recordChrome.persist.value.type } : {}),
    });
    // The key search over a seekable source: its box, or its icon on a row short of room.
    const seek = useKeySearchToolbarItem(search, { rank: PLAN_RANK.seek, label: words.m.keySearch() });
    // A narrowing affordance on a paged canvas reports over the LOADED prefix
    // while looking like it reports over the whole source — so say so, rather
    // than removing a capability the user can still use on what has landed.
    const scoped = transport !== undefined && clusterKinds.some((k) => NARROWING_KINDS.has(k));
    const showSummary = slice !== undefined && affordances !== undefined && affordances.includes("summary");
    // The summary line, and what a row short of room keeps of it.
    const summary = useMemo(() => {
        if (!showSummary || slice === undefined) return undefined;
        // `N of M matching` counts what the slice narrowed. On a paged canvas
        // that M is the prefix, not the source, so the honest count is the
        // transport's — in ELEMENTS (#567 D9), already a count.
        if (transport !== undefined) return { full: transportLabel(transport, words), short: undefined };
        const total = Number(slice.totalCount());
        const result = Number(slice.resultCount());
        const active = Number(slice.activeCount());
        return {
            full: words.m.summary({ result: words.number(result), total: words.number(total), n: active, active: words.number(active) }),
            short: words.m.summaryShort({ result: words.number(result), total: words.number(total) }),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of the count reads: they move with the STORE, not with any prop (#611)
    }, [showSummary, slice, transport, sliceVersion, words]);

    if (chrome === undefined) return [];
    const { styles, diagnostics, history, selectEvents } = chrome;
    const resolution = chrome.scale.resolution ?? "";
    const summaryLine = (text: string) => <Box css={styles.footerItem} data-slot="toolbarSummary">{text}</Box>;
    // The first pair, earliest first — what the chip's click selects (PB52).
    const first = overlaps?.pairs[0];
    const selectFirst = () => {
        if (first !== undefined) selectEvents([scheduleEventKey(first.first), scheduleEventKey(first.second)]);
    };
    const foldToggle = (compact = false) => <Button size="xs" variant="ghost" data-plan-fold-all=""
        aria-label={folded ? words.m.expandAll() : words.m.collapseAll()} title={folded ? words.m.expandAll() : words.m.collapseAll()}
        onClick={() => controller.setGroupsCollapsed(!folded)}>
        <FontAwesomeIcon icon={folded ? faAnglesDown : faAnglesUp} />
        {!compact && (folded ? words.m.expandAll() : words.m.collapseAll())}
    </Button>;
    const showResolution = (slice !== undefined || recordChrome !== undefined) && resolutionItems.length > 0;
    const pickResolution = (r: string) => dispatch({ t: "resolution.set", resolution: r });
    const compactControls = <>
        {folded !== undefined && foldToggle()}
        {showResolution && <Seg label={words.m.resolutionLabel()} name="compact-resolution" items={resolutionItems}
            active={resolution} onPick={pickResolution} fullWidth />}
    </>;
    return [
        ...recordRail,
        rail.find((it) => it.key === "cluster"),
        scoped && { key: "scope", forms: [<Box css={styles.footerItem} data-slot="scopeBadge">{words.m.scopeBadge()}</Box>] },
        seek,
        folded !== undefined && {
            key: "groups", rank: [PLAN_RANK.grain, PLAN_RANK.controls],
            bundle: [undefined, "plan.controls"],
            forms: [foldToggle(), foldToggle(true), ...(timeNavigation ? [null] : [])],
        },
        timeNavigation ? {
            key: "time-navigation", rank: [PLAN_RANK.time, PLAN_RANK.controls],
            bundle: [undefined, "plan.controls"],
            forms: [<PlanTimeNavigator chrome={chrome} />, <PlanTimeNavigator chrome={chrome} compact />,
                <PlanTimeNavigator chrome={chrome} compact controls={compactControls} />],
        } : rail.find((it) => it.key === "range"),
        // The segment is a SLICE write (`slice.setResolution`) — without a
        // bound slice the effect runner drops it, so mounting it would offer
        // a control that does nothing. The unbound-canvas fallback story is
        // #572's (resolution persist fallback); until then, no slice ⇒ no
        // segment.
        showResolution && {
            key: "resolution",
            rank: [PLAN_RANK.resolution, PLAN_RANK.controls],
            bundle: [undefined, "plan.controls"],
            forms: [
                <Seg label={words.m.resolutionLabel()} name="resolution" items={resolutionItems} active={resolution}
                    onPick={pickResolution} />,
                <SegMenu label={words.m.resolutionLabel()} name="resolution" items={resolutionItems} active={resolution}
                    onPick={pickResolution} />,
                ...(timeNavigation ? [null] : []),
            ],
        },
        hasDiagnostics(diagnostics) && { key: "diagnostics", forms: [<PlanDiagnosticChips diagnostics={diagnostics} styles={styles} />] },
        // The row's end: the summary line, the overlaps, the history.
        summary !== undefined && {
            key: "summary",
            side: "end",
            ...(summary.short !== undefined
                ? { rank: [PLAN_RANK.summaryShort, PLAN_RANK.summaryHide], forms: [summaryLine(summary.full), summaryLine(summary.short), null] }
                : { rank: PLAN_RANK.summaryHide, forms: [summaryLine(summary.full), null] }),
        },
        // The pairs of events that overlap in the window (#1198, PB52): shown
        // while there is one.
        overlaps !== undefined && overlaps.pairs.length > 0 && {
            key: "overlaps",
            side: "end",
            rank: PLAN_RANK.overlapsShort,
            forms: [
                <OverlapsChip n={overlaps.pairs.length} short={false} onSelect={selectFirst} />,
                <OverlapsChip n={overlaps.pairs.length} short onSelect={selectFirst} />,
            ],
        },
        // The banners say the session's error, so the toolbar keeps one row.
        history !== undefined && historyToolbarItem({ ...history, showError: false }),
    ];
}
