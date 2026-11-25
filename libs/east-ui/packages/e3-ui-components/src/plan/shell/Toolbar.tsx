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
 * stays a chip, and the others follow it. The canvas's rows' sources hold no
 * window (#1344): a date field there stays a chip of the rail, and a slice
 * with no source holding the window keeps the navigator, which steps the
 * canvas's own.
 *
 * They fold on one ladder (#952): the rail first, its summary folding after
 * every step of it — then the Plan's own items (the user's decision,
 * 2026-09-27): the date navigator's label shortens and the overlaps chip keeps
 * its glyph and its count — words give way before a control does — then the
 * resolution segment folds into a one-chip menu, then the fold toggle keeps
 * only its icon. On a row narrower still the key search folds into its icon,
 * which opens the box in a popover (#1193): with that, a phone's row holds
 * every item. The date navigator's arrows go only then (#1740, agreed 24 Nov
 * 2026): they step the window a screenful, the control a viewer reaches for
 * most, so they are the last of the Plan's own the row gives up. The history
 * item folds last, to its buttons. Before that last step, a time-axis Plan
 * folds its group and resolution controls into the shared date navigator's
 * View, and its overlaps chip with them, one move, as Calendar and Roster fold
 * theirs (#1344: a phone's row has room for the rail's icon, the View and the
 * history item, and no more). Nothing wraps or goes to a second row.
 */

import { useCallback, useMemo } from "react";
import { Box, Button, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { StringType, equalFor } from "@elaraai/east";
import { faAnglesDown, faAnglesUp, faArrowPointer, faLink, faTriangleExclamation, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
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
import { SEARCH_BOX_RANK } from "../../shared/schedule/search-rank.js";
import { isPlanRowsFind } from "../find.js";
import { PLAN_TOOLS, type PlanTool } from "../links/connect.js";

/** The Plan's own fold ranks, after every step of the rail's (#952): the date
 *  navigator's label shortens and the overlaps chip keeps its glyph and its
 *  count, the resolution then the fold toggle shorten, the key search folds
 *  into its icon, and only then do the date navigator's arrows go (#1740). The
 *  history item's step (`DEFAULT_RANK`) comes after all of them. */
const PLAN_RANK = {
    overlapsShort: HOST_RANK,
    resolution: HOST_RANK + 1,
    grain: HOST_RANK + 2,
    tools: HOST_RANK + 3,
    seek: HOST_RANK + 4,
    time: HOST_RANK,
    arrows: HOST_RANK + 5,
    controls: HOST_RANK + 6,
} as const;

const stringEqual = equalFor(StringType);

/** Each tool's icon, Font Awesome's solid: the Schematic's for the same tools. */
const TOOL_ICONS: { readonly [T in PlanTool]: IconDefinition } = { select: faArrowPointer, connect: faLink };

/** No items: a Plan with no window draws none. */
const NO_ITEMS: ReadonlyArray<ToolbarItem | false | undefined> = [];


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
        <chakra.button type="button" css={[chip({ tone: "warn" }), coarseHitArea({ position: true })]}
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
 * controller. Each item is made again only as what it shows moves, and the
 * list with them (#1398, CL9): the frame is drawn again as each window lands,
 * and a toolbar handed the same items draws and measures nothing again.
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
    // stays a chip, and the others follow it. With no source holding the window, the navigator steps the canvas's own.
    const timeNavigation = chrome?.scale.kind === "time"
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
    // Over the record of the source the canvas pages (#1513) it is the first thing the row folds, as a period builder's is:
    // the box came to a row its rail, its dates and its zoom already fill, and they stay live.
    const findsRows = isPlanRowsFind(search);
    const seekRank = findsRows ? SEARCH_BOX_RANK : PLAN_RANK.seek;
    const seek = useKeySearchToolbarItem(search, { rank: seekRank, label: words.m.keySearch() });

    // What the Plan's own items are drawn from: the chrome's facts each reads, never the chrome, which is new each render.
    const drawn = chrome !== undefined;
    const scale = chrome?.scale;
    const lead = chrome?.lead;
    const moveWindow = chrome?.moveWindow;
    const styles = chrome?.styles;
    const diagnostics = chrome?.diagnostics;
    const history = chrome?.history;
    const selectEvents = chrome?.selectEvents;
    const tools = chrome?.tools;
    const optimiseItem = chrome?.optimise?.toolbarItem;
    const resolution = scale?.resolution ?? "";
    // A period pressed moves the window, and a canvas with no slice has none to move: its segment would do nothing.
    const showResolution = slices !== undefined && resolutionItems.length > 0;
    const pickResolution = useCallback((r: string) => dispatch({ t: "resolution.set", resolution: r }), [dispatch]);
    // The overlapping pairs, which the toolbar's chip counts (#1198), and the first, earliest first — what its click
    // selects (PB52), by its events' keys.
    const pairs = overlaps?.pairs.length ?? 0;
    const first = overlaps?.pairs[0];
    const firstKey = first === undefined ? undefined : scheduleEventKey(first.first);
    const secondKey = first === undefined ? undefined : scheduleEventKey(first.second);
    const selectFirst = useCallback(() => {
        if (firstKey !== undefined && secondKey !== undefined) selectEvents?.([firstKey, secondKey]);
    }, [firstKey, secondKey, selectEvents]);
    const foldToggle = useCallback((compact = false) => <Button size="xs" variant="ghost" data-plan-fold-all=""
        aria-label={folded ? words.m.expandAll() : words.m.collapseAll()} title={folded ? words.m.expandAll() : words.m.collapseAll()}
        onClick={() => controller.setGroupsCollapsed(!folded)}>
        <FontAwesomeIcon icon={folded ? faAnglesDown : faAnglesUp} />
        {!compact && (folded ? words.m.expandAll() : words.m.collapseAll())}
    </Button>, [folded, words, controller]);
    // The tools (#1541, U10), while a link kind is editable: Select and Connect, one strip, as the Schematic's are — its
    // words first, then its icons alone — and Connect's menu of the kind it draws while several are editable. Picking a
    // kind holds Connect.
    const toolStrip = useCallback((iconsOnly: boolean, fullWidth = false) => {
        if (tools === undefined) return null;
        const held = tools.held.link;
        const kind = (held === undefined ? undefined : tools.links.find((link) => stringEqual(link.key, held)))?.name ?? "";
        const items = PLAN_TOOLS.map((tool) => ({ key: tool, label: words.m.toolName({ tool }), hint: words.m.toolHint({ tool, kind }), icon: TOOL_ICONS[tool] }));
        return <Seg label={words.m.toolsLabel()} name="tools" items={items} active={tools.held.tool} iconsOnly={iconsOnly} fullWidth={fullWidth}
            onPick={(tool) => tools.pick({ tool, link: tools.held.link })} />;
    }, [tools, words]);
    const linkMenu = useCallback((fullWidth = false) => {
        if (tools === undefined || tools.links.length < 2) return null;
        const items = tools.links.map((link) => ({ key: link.key, label: link.name }));
        const pick = (link: string) => tools.pick({ tool: "connect", link });
        return fullWidth
            ? <Seg label={words.m.connectDraws()} name="link" items={items} active={tools.held.link ?? ""} fullWidth onPick={pick} />
            : <SegMenu label={words.m.connectDraws()} name="link" items={items} active={tools.held.link ?? ""} onPick={pick} />;
    }, [tools, words]);
    const groupsItem = useMemo((): ToolbarItem | undefined => (drawn && folded !== undefined ? {
        key: "groups", rank: [PLAN_RANK.grain, PLAN_RANK.controls],
        bundle: [undefined, "plan.controls"],
        forms: [foldToggle(), foldToggle(true), ...(timeNavigation ? [null] : [])],
    } : undefined), [drawn, folded, foldToggle, timeNavigation]);
    const timeItem = useMemo((): ToolbarItem | undefined => {
        if (!timeNavigation || scale === undefined || windowParts === undefined || moveWindow === undefined) return undefined;
        const window = { scale, windowParts, lead, moveWindow };
        const compactControls = <>
            {folded !== undefined && foldToggle()}
            {showResolution && <Seg label={words.m.resolutionLabel()} name="compact-resolution" items={resolutionItems}
                active={resolution} onPick={pickResolution} fullWidth />}
            {toolStrip(true, true)}
            {linkMenu(true)}
            {pairs > 0 && <OverlapsChip n={pairs} short={false} onSelect={selectFirst} />}
        </>;
        // Its label shortens first and its arrows stay: they go after every other control of the Plan's has folded, the
        // step before all of them fold into its View.
        return {
            key: "time-navigation", rank: [PLAN_RANK.time, PLAN_RANK.arrows, PLAN_RANK.controls],
            bundle: [undefined, undefined, "plan.controls"],
            forms: [<PlanTimeNavigator {...window} />, <PlanTimeNavigator {...window} shortLabel />, <PlanTimeNavigator {...window} compact />,
                <PlanTimeNavigator {...window} compact controls={compactControls} />],
        };
    }, [timeNavigation, scale, windowParts, lead, moveWindow, folded, foldToggle, showResolution, words, resolutionItems, resolution,
        pickResolution, pairs, selectFirst, toolStrip, linkMenu]);
    // A period pressed sets the window's range (`window.preset`, #1740), and the columns' period follows it. A canvas
    // with no slice keeps the axis's stated window, where the effect runner drops a preset: no slice, no segment.
    const resolutionItem = useMemo((): ToolbarItem | undefined => (drawn && showResolution ? {
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
    } : undefined), [drawn, showResolution, words, resolutionItems, resolution, pickResolution, timeNavigation]);
    // What the tools' forms show moves with the tool held and the kinds offered: their widths are measured again.
    const toolsVersion = tools === undefined ? "" : `${tools.held.tool}|${tools.held.link ?? ""}|${tools.links.map((link) => link.key).join(",")}`;
    const toolsItem = useMemo((): ToolbarItem | undefined => (drawn && tools !== undefined ? {
        key: "tools",
        rank: [PLAN_RANK.tools, PLAN_RANK.controls],
        bundle: [undefined, "plan.controls"],
        version: toolsVersion,
        forms: [toolStrip(false), toolStrip(true), ...(timeNavigation ? [null] : [])],
    } : undefined), [drawn, tools, toolsVersion, toolStrip, timeNavigation]);
    const linkMenuItem = useMemo((): ToolbarItem | undefined => (drawn && tools !== undefined && tools.links.length > 1 ? {
        key: "tools-link",
        rank: PLAN_RANK.controls,
        bundle: "plan.controls",
        version: toolsVersion,
        forms: [linkMenu(), ...(timeNavigation ? [null] : [])],
    } : undefined), [drawn, tools, toolsVersion, linkMenu, timeNavigation]);
    const diagnosticsItem = useMemo((): ToolbarItem | undefined => (diagnostics !== undefined && styles !== undefined && hasDiagnostics(diagnostics)
        ? { key: "diagnostics", forms: [<PlanDiagnosticChips diagnostics={diagnostics} styles={styles} />] }
        : undefined), [diagnostics, styles]);
    // The row's end — the rail's summary rides with the rail, above — the overlaps, the history. The pairs of events
    // that overlap in the window (#1198, PB52): shown while there is one — short of room, its glyph and its count; on a
    // time axis with nothing left to fold, in the date navigator's View with the fold toggle and the resolution, one
    // move (#1344).
    const overlapsItem = useMemo((): ToolbarItem | undefined => (drawn && pairs > 0 ? {
        key: "overlaps",
        side: "end",
        rank: timeNavigation ? [PLAN_RANK.overlapsShort, PLAN_RANK.controls] : PLAN_RANK.overlapsShort,
        ...(timeNavigation ? { bundle: [undefined, "plan.controls"] } : {}),
        forms: [
            <OverlapsChip n={pairs} short={false} onSelect={selectFirst} />,
            <OverlapsChip n={pairs} short onSelect={selectFirst} />,
            ...(timeNavigation ? [null] : []),
        ],
    } : undefined), [drawn, pairs, selectFirst, timeNavigation]);
    // The history item: what the session has to say beyond its buttons is its banners', under the toolbar.
    const historyItem = useMemo(() => (history === undefined ? undefined : historyToolbarItem(history)), [history]);
    return useMemo(() => (drawn ? [
        ...rail,
        seek,
        groupsItem,
        timeItem,
        resolutionItem,
        toolsItem,
        linkMenuItem,
        diagnosticsItem,
        overlapsItem,
        // The Elara eye (#1409): the app's optimiser's item, immediately before the history item.
        optimiseItem,
        historyItem,
    ] : NO_ITEMS), [drawn, rail, seek, groupsItem, timeItem, resolutionItem, toolsItem, linkMenuItem, diagnosticsItem, overlapsItem, optimiseItem, historyItem]);
}
