/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One folding Toolbar: the rail, Calendar navigation, overlaps, Search Records and shared history. On the timeline the
 * navigator, the count and the overlaps chip follow the days it shows (#1398, CL9): each reads them itself, so a scroll
 * draws nothing else of the toolbar, and a figure over them is said once what the timeline draws covers them. The count
 * counts the events drawn, and names the kinds past the cap it counts none of (#1424): `13 events, print jobs not
 * counted`, never a count that leaves them out unsaid.
 */
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import type { ReactNode } from "react";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import {
    ChipMenu, historyToolbarItem, useKeySearchToolbarItem, type EditingWords, type HistoryAction, type KeySearchSource, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { HOST_RANK, RecordSliceFieldEditor, coarseHitArea, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { TimeNavigator } from "../shared/time/navigation.js";
import { SEARCH_BOX_RANK } from "../shared/schedule/search-rank.js";
import { eventsNotCounted } from "../shared/schedule/words.js";
import { Seg } from "../shared/schedule/segments.js";
import { scheduleOverlapsIn, type ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import type { CalendarCommands } from "./actions.js";
import type { CalendarEventPart } from "./window.js";
import { coversShown, useShownOverlaps, useVisibleDays, type VisibleDaysStore } from "./visible.js";
import {
    dayStart, inWindow, navigate, type CalendarItem, type CalendarRange, type CalendarRef, type CalendarStyles, type CalendarUncounted, type CalendarView,
} from "./model.js";

const LAYOUTS = [{ key: "calendar", label: "Calendar" }, { key: "resources", label: "Resources" }, { key: "timeline", label: "Timeline" }] as const;
const PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }] as const;
interface ToolbarArgs {
    view: CalendarView; setView: (view: CalendarView) => void; range: CalendarRange; now: Date;
    /** The window's events; `undefined` while its period is read: "…", never a count of another period's (#1398, CL13). */
    count: number | undefined;
    /** The kinds past the cap (#1424): the count counts none of their events, and says so. */
    uncounted: CalendarUncounted;
    styles: CalendarStyles; commands: CalendarCommands | undefined;
    words: EditingWords; overlaps: ScheduleOverlaps<CalendarItem>; select: (refs: CalendarRef[]) => void;
    /** Whether an overlap shows: among what is drawn — on the timeline, in the days it shows (`useOverlapsShown`). */
    overlapsShown: boolean;
    onAction: (action: HistoryAction) => void; paged: boolean;
    /** The rail; `undefined` with no slice. */
    chrome: ValueTypeOf<RecordSlicesChromeType> | undefined;
    /** The rail's affordances. */
    affordances: readonly string[];
    /** What the rail counts each source in, and heads it with folded, where the source has no label of its own. */
    nouns: Readonly<Record<string, string>>;
    /** The event sources that hold the window: their ranges are the navigation's, never chips of the rail's. */
    windowParts: readonly CalendarEventPart[];
    sunday: boolean; navigationDate: number; rangeLabel: string | undefined; onNavigate: (date: number) => void;
    /**
     * The days the timeline shows (#1398, CL9): while it shows, the navigator's date and label and the count are read
     * from it by the items that say them, so its scroll draws nothing else of the toolbar.
     */
    visible?: VisibleDaysStore | undefined;
    /**
     * The events the timeline draws and the span they were read over (#1398): what the count counts over the days it
     * shows, once that span covers them; `covered` undefined while none are drawn.
     */
    events?: { readonly items: readonly CalendarItem[]; readonly covered: CalendarRange | undefined } | undefined;
    /** Told when the date picker's Today is pressed: the time grid brings the now line into view (#1398). */
    onToday?: (() => void) | undefined;
    /** Search Records over the event kinds' keys (#1398); `undefined` with no kind to seek. */
    search?: KeySearchSource | undefined;
    /** The Elara eye (#1409): the run's toolbar item, listed immediately before the history item; `undefined` with no optimiser. */
    optimise?: ToolbarItem | undefined;
    /** Whether a run of the optimiser is out (#1409, R2): the history item's actions locked. */
    locked?: boolean | undefined;
}

/** The navigator over the days the timeline shows: its date the day under the view's centre, its label the days shown. */
function VisibleNavigator({ visible, fallback, words, navigator }: {
    visible: VisibleDaysStore; fallback: { date: number; label: string | undefined }; words: EditingWords;
    navigator: (date: number, label: string | undefined) => ReactNode;
}) {
    const shown = useVisibleDays(visible);
    return <>{shown === undefined ? navigator(fallback.date, fallback.label) : navigator(shown.center, words.range(shown.from, new Date(shown.to.getTime() - 1)))}</>;
}

/**
 * What the count says (#1424): the events counted, and the kinds past the cap it counts none of — `13 events, print jobs
 * not counted`, or with every kind past it `print jobs not counted`, no number; "…" while the period is read (CL13).
 *
 * @param count - The events drawn; `undefined` while the period is read
 * @param uncounted - The kinds past the cap
 * @param words - The app's formatters
 * @returns The count's words
 */
function countWords(count: number | undefined, uncounted: CalendarUncounted, words: Pick<EditingWords, "number">): string {
    if (count === undefined) return "… events";
    if (uncounted.names.length === 0) return `${words.number(count)} events`;
    return eventsNotCounted({ n: count, count: uncounted.all ? undefined : words.number(count), kinds: uncounted.names });
}

/**
 * The timeline's count: its window's events over the days it shows, read as they move; "…" while those days are read —
 * a period not read yet, or a re-centre's days the held read does not cover (CL13).
 */
function VisibleCount({ visible, events, styles, words, range, uncounted }: {
    visible: VisibleDaysStore; events: { readonly items: readonly CalendarItem[]; readonly covered: CalendarRange | undefined }; styles: CalendarStyles; words: EditingWords; range: CalendarRange;
    uncounted: CalendarUncounted;
}) {
    const shown = useVisibleDays(visible);
    const from = shown?.from ?? range.from, to = shown?.to ?? range.to;
    const count = coversShown(events.covered, range, shown) ? events.items.filter(item => inWindow(item, from, to)).length : undefined;
    return <Box css={styles.toolbarText} data-calendar-count="">{countWords(count, uncounted, words)}</Box>;
}

/**
 * How many overlaps show, as the overlaps chip and the View's words count them: every one among what is drawn, or on the
 * timeline those in the days it shows, read as they move (#1398) — never the window's, which jumps as it re-centres.
 */
function OverlapsCount({ overlaps, visible, children }: {
    overlaps: ScheduleOverlaps<CalendarItem>; visible: VisibleDaysStore | undefined; children: (count: number) => ReactNode;
}) {
    return <>{children(useShownOverlaps(overlaps, visible).pairs.length)}</>;
}
/** The control row uses shared folding ranks, popovers and coarse-pointer targets. */
export function useCalendarToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { view, setView, now, count, styles, words, commands, onAction, overlaps, overlapsShown, select, paged, chrome, windowParts } = args;
    // One date window (#1343): each event source's range is the window the navigation writes, so it leaves the rail,
    // and the leading source's range editor is the navigator's Range panel, as the Plan's is.
    const rail = useRecordSlicesToolbarItems(chrome?.slice, {
        nouns: args.nouns, affordances: args.affordances,
        excludeFields: windowParts.flatMap(({ kind, part }) => part.config.range.type === "some" ? [`${kind.key}.${part.config.range.value}`] : []),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    const lead = windowParts[0];
    const leadField = lead === undefined || lead.part.config.range.type === "none" ? undefined
        : lead.part.config.fields.find(field => lead.part.config.range.type === "some" && field.fieldId === lead.part.config.range.value);
    const rangeEditor = lead !== undefined && leadField !== undefined ? <RecordSliceFieldEditor slice={lead.part} field={leadField} source={lead.kind.key} /> : undefined;
    const chip = useRecipe({ key: "chip" });
    // Search Records (#1398): primary-key navigation over every event kind's record, at the row's end. Its box is the first
    // thing the row folds, to its icon, before the rail and the period's steps (ruled 25 Oct 2026); at the row's last step
    // it goes into the View, beside the date and the view controls.
    const seek = useKeySearchToolbarItem(args.search, { side: "end", rank: SEARCH_BOX_RANK });
    const period = view.layout === "resources" ? "day" : view.period;
    // A step from where the view is: the timeline's, the day under its centre as it is when the step is asked.
    const move = (step: number) => args.onNavigate(navigate({ ...view, date: args.visible?.get()?.center ?? args.navigationDate }, step).date);
    // The overlaps shown: on the timeline, those in the days it shows (#1398), read by what counts them.
    const visible = args.visible;
    const showOverlaps = () => {
        const shownDays = visible?.get();
        const firstPair = (shownDays === undefined ? overlaps : scheduleOverlapsIn(overlaps, shownDays.from, shownDays.to)).pairs[0];
        if (firstPair === undefined) return;
        select([firstPair.first, firstPair.second].map(item => ({ kind: item.kind, key: item.key })));
        if (firstPair.first.start.type === "some") setView({ ...view, layout: "resources", date: dayStart(firstPair.first.start.value).getTime() });
    };
    const warning = (short: boolean) => <OverlapsCount overlaps={overlaps} visible={visible}>{n =>
        <chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]}
            aria-label={`${n} overlaps`} data-calendar-overlaps="" onClick={showOverlaps}><span data-chip-icon=""><FontAwesomeIcon icon={faTriangleExclamation} /></span><span data-chip-label="">{n}{!short && " overlaps"}</span></chakra.button>}
    </OverlapsCount>;
    const overlapsWords = <OverlapsCount overlaps={overlaps} visible={visible}>{n => `${n} overlaps`}</OverlapsCount>;
    const viewMenu = <ChipMenu label="View" icon={faCalendarWeek} data="data-calendar-view-menu" onSelect={key => {
        const layout = LAYOUTS.find(layout => layout.key === key); const picked = PERIODS.find(period => period.key === key);
        if (layout !== undefined) setView({ ...view, layout: layout.key });
        else if (picked !== undefined && view.layout !== "resources") setView({ ...view, period: picked.key });
        else if (key === "overlaps") showOverlaps();
        else if (key === "previous" || key === "next") move(key === "previous" ? -1 : 1);
    }}>
        {LAYOUTS.map(layout => <ChakraMenu.Item value={layout.key} key={layout.key}>{layout.label}</ChakraMenu.Item>)}
        {view.layout !== "resources" && <><ChakraMenu.Separator />{PERIODS.map(p => <ChakraMenu.Item value={p.key} key={p.key}>{p.label}</ChakraMenu.Item>)}</>}
        <ChakraMenu.Separator />
        <ChakraMenu.Item value="previous">Previous {period}</ChakraMenu.Item><ChakraMenu.Item value="next">Next {period}</ChakraMenu.Item>
        {overlapsShown && <ChakraMenu.Item value="overlaps">{overlapsWords}</ChakraMenu.Item>}
    </ChipMenu>;
    const controls = <>
        {seek?.forms[0]}
        <Seg label="Layout" scope="calendar" name="compact-layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />
        {view.layout !== "resources" && <Seg label="Period" scope="calendar" name="compact-period" items={PERIODS} active={period} onPick={period => setView({ ...view, period })} />}
        {overlapsShown && <Button size="xs" variant="ghost" onClick={showOverlaps}>{overlapsWords}</Button>}
    </>;
    const navigator = (compact: boolean, combined: boolean) => (date: number, label: string | undefined) => <TimeNavigator scope="calendar" date={date} period={period}
        sunday={args.sunday} now={now} onChange={args.onNavigate} compact={compact} rangeLabel={label}
        label={combined ? "View" : "Choose date"} controls={combined ? controls : undefined} rangeEditor={rangeEditor} onToday={args.onToday} />;
    const navigation = (compact = false, combined = false) => visible === undefined ? navigator(compact, combined)(args.navigationDate, args.rangeLabel)
        : <VisibleNavigator visible={visible} words={words} fallback={{ date: args.navigationDate, label: args.rangeLabel }} navigator={navigator(compact, combined)} />;
    return [
        ...rail,
        { key: "calendar.layout", side: "start", rank: HOST_RANK + 1, bundle: "calendar.view", forms: [<Seg label="Layout" scope="calendar" name="layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />, null] },
        view.layout !== "resources" && { key: "calendar.period", side: "start", rank: HOST_RANK + 1, bundle: "calendar.view", forms: [<Seg label="Period" scope="calendar" name="period" items={PERIODS} active={period} onPick={period => setView({ ...view, period })} />, null] },
        { key: "calendar.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["calendar.view", "calendar.controls"], forms: [null, viewMenu, null] },
        { key: "calendar.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "calendar.controls"], forms: [navigation(), navigation(true), navigation(true, true)] },
        // With no slice, the window's own count; a slice's summary counts each source instead.
        chrome === undefined && { key: "calendar.count", side: "start", rank: HOST_RANK, forms: [visible !== undefined && args.events !== undefined
            ? <VisibleCount visible={visible} events={args.events} styles={styles} words={words} range={args.range} uncounted={args.uncounted} />
            : <Box css={styles.toolbarText} data-calendar-count="">{countWords(count, args.uncounted, words)}</Box>, null] },
        paged && chrome === undefined && { key: "calendar.scope", side: "start", forms: [<Box css={styles.toolbarText}>Loaded window</Box>, null], rank: HOST_RANK + 4 },
        overlapsShown && { key: "calendar.overlaps", side: "end", rank: [HOST_RANK, HOST_RANK + 6], forms: [warning(false), warning(true), null] },
        seek !== undefined && { ...seek, forms: [...seek.forms, null], rank: [SEARCH_BOX_RANK, HOST_RANK + 6], bundle: [undefined, "calendar.controls"] },
        // The eye, immediately before the history item (#1409, D4).
        args.optimise,
        commands !== undefined && historyToolbarItem({ session: commands.editing.history, words, editing: false, showError: false, onAction, locked: args.locked === true,
            onIssue: issue => { const kind = commands.editing.sessions.find(held => held.key === commands.editing.history.sourceOf(issue))?.kind; if (kind !== undefined) select([{ kind, key: issue.entry }]); } }),
    ];
}
