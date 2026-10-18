/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's toolbar items (#1193, `Plan Builder Spec.md` §7.1) — every
 * control the Plan draws outside its canvas, as items of its frame's one
 * toolbar (`BuilderFrame`'s), in this order: the rail of its one
 * `Slice.bindRecords` (#1344) — each source's field chips, the presets over
 * them — the key search, Expand/Collapse all, the shared date navigator or a
 * number axis's range, the resolution, the diagnostics; then, at the row's
 * end, the rail's summary, counting each source, the overlaps chip and the
 * history item. The fold toggle acts on every parent, including nested rows,
 * and keeps the same per-row state as the disclosure buttons. There is no
 * Series button: the library's Series tab holds the series (#1195). The
 * overlaps chip (#1198, PB52) counts the pairs of events that overlap in the
 * window; a click selects the first pair, earliest first, and brings it into
 * view.
 *
 * The window is the sources' one range: every source holding it is out of the
 * rail on a time axis, its range the date navigator's — the leading source's
 * range editor its Range panel; on a number axis the leading source's range
 * stays a chip, and the others follow it.
 *
 * They fold on one ladder (#952): the rail first, its summary folding after
 * every step of it — then the Plan's own items (the user's decision,
 * 2026-09-27): the overlaps chip to its glyph and its count — words give way
 * before a control does — then the resolution segment folds into a one-chip
 * menu, then the fold toggle keeps only its icon. On a row narrower still the
 * key search folds into its icon, which opens the box in a popover (#1193):
 * with that, a phone's row holds every item. The history item folds last, to
 * its buttons. Before that last step, a time-axis Plan folds its group and
 * resolution controls into the shared date navigator's View, and its overlaps
 * chip with them, one move, as Calendar and Roster fold theirs (#1344: a
 * phone's row has room for the rail's icon, the View and the history item,
 * and no more). Nothing wraps or goes to a second row.
 */

import { useMemo } from "react";
import { Box, Button, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAnglesDown, faAnglesUp, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { HOST_RANK, coarseHitArea, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { type ToolbarItem, historyToolbarItem, useKeySearchToolbarItem } from "@elaraai/east-ui-components";
import { usePlanDispatch } from "../context.js";
import { usePlanController, usePlanSelector } from "../controller/react.js";
import { usePlanWords } from "../words.js";
import { PlanDiagnosticChips, hasDiagnostics } from "./Diagnostics.js";
import type { PlanChrome } from "../root/chrome.js";
import type { PlanOverlaps } from "../frame/counts.js";
import { Seg, SegMenu } from "../../shared/schedule/segments.js";
export { Seg, SegMenu } from "../../shared/schedule/segments.js";
import { PlanTimeNavigator } from "./TimeNavigator.js";
import { scheduleEventKey } from "../../shared/schedule/overlaps.js";

/** The Plan's own fold ranks, after every step of the rail's (#952): the
 *  overlaps chip keeps its glyph and its count, the resolution then the fold
 *  toggle shorten, and the key search folds into its icon. The history item's
 *  step (`DEFAULT_RANK`) comes after all of them. */
const PLAN_RANK = {
    overlapsShort: HOST_RANK,
    resolution: HOST_RANK + 1,
    grain: HOST_RANK + 2,
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
    const slices = chrome?.slices;
    const affordances = chrome?.affordances;
    const search = chrome?.search;
    const resolutions = chrome?.resolutions;
    const windowParts = chrome?.windowParts;
    // The configured resolutions, in the app's words.
    const resolutionItems = useMemo(
        () => (resolutions ?? []).map((r) => ({ key: r, label: words.m.resolutionName({ resolution: r }) })),
        [resolutions, words]);
    // The window is the date navigator's on a time axis (#1344): every source's range leaves the rail, and the
    // leading source's range editor is the navigator's Range panel. On a number axis the leading source's range
    // stays a chip, and the others follow it.
    const timeNavigation = chrome?.scale.kind === "time" && (windowParts?.length ?? 0) > 0
        && (affordances?.includes("range") === true || affordances?.includes("fields") === true);
    const excludeFields = useMemo(() => (windowParts ?? []).flatMap(({ source, part }, i) =>
        (i > 0 || timeNavigation) && part.config.range.type === "some" ? [`${source}.${part.config.range.value}`] : []),
    [windowParts, timeNavigation]);
    const rail = useRecordSlicesToolbarItems(slices?.slice, {
        excludeFields,
        ...(chrome === undefined ? {} : { nouns: chrome.nouns }),
        ...(affordances === undefined ? {} : { affordances: affordances.filter((kind) => kind !== "resolution") }),
        ...(slices?.persist.type === "some" ? { persist: slices.persist.value.type } : {}),
    });
    // The key search over a seekable source: its box, or its icon on a row short of room.
    const seek = useKeySearchToolbarItem(search, { rank: PLAN_RANK.seek, label: words.m.keySearch() });

    if (chrome === undefined) return [];
    const { styles, diagnostics, history, selectEvents } = chrome;
    const resolution = chrome.scale.resolution ?? "";
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
    // The resolution is the slice's: without one the segment would offer a control that does nothing.
    const showResolution = slices !== undefined && resolutionItems.length > 0;
    const pickResolution = (r: string) => dispatch({ t: "resolution.set", resolution: r });
    // The overlapping pairs, which the toolbar's chip counts (#1198).
    const pairs = overlaps?.pairs.length ?? 0;
    const compactControls = <>
        {folded !== undefined && foldToggle()}
        {showResolution && <Seg label={words.m.resolutionLabel()} name="compact-resolution" items={resolutionItems}
            active={resolution} onPick={pickResolution} fullWidth />}
        {pairs > 0 && <OverlapsChip n={pairs} short={false} onSelect={selectFirst} />}
    </>;
    return [
        ...rail,
        seek,
        folded !== undefined && {
            key: "groups", rank: [PLAN_RANK.grain, PLAN_RANK.controls],
            bundle: [undefined, "plan.controls"],
            forms: [foldToggle(), foldToggle(true), ...(timeNavigation ? [null] : [])],
        },
        timeNavigation && {
            key: "time-navigation", rank: [PLAN_RANK.time, PLAN_RANK.controls],
            bundle: [undefined, "plan.controls"],
            forms: [<PlanTimeNavigator chrome={chrome} />, <PlanTimeNavigator chrome={chrome} compact />,
                <PlanTimeNavigator chrome={chrome} compact controls={compactControls} />],
        },
        // The segment writes the slice's resolution (`slice.setResolution`) —
        // without a slice the effect runner drops it, so mounting it would
        // offer a control that does nothing. The unbound-canvas fallback story
        // is #572's (resolution persist fallback); until then, no slice ⇒ no
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
        // The row's end — the rail's summary rides with the rail, above — the overlaps, the history.
        // The pairs of events that overlap in the window (#1198, PB52): shown
        // while there is one — short of room, its glyph and its count; on a
        // time axis with nothing left to fold, in the date navigator's View with
        // the fold toggle and the resolution, one move (#1344).
        pairs > 0 && {
            key: "overlaps",
            side: "end",
            rank: timeNavigation ? [PLAN_RANK.overlapsShort, PLAN_RANK.controls] : PLAN_RANK.overlapsShort,
            ...(timeNavigation ? { bundle: [undefined, "plan.controls"] } : {}),
            forms: [
                <OverlapsChip n={pairs} short={false} onSelect={selectFirst} />,
                <OverlapsChip n={pairs} short onSelect={selectFirst} />,
                ...(timeNavigation ? [null] : []),
            ],
        },
        // The banners say the session's error, so the toolbar keeps one row.
        history !== undefined && historyToolbarItem({ ...history, showError: false }),
    ];
}
