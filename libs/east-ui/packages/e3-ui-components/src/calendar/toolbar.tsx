/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One folding Toolbar: the rail, Calendar navigation, overlaps, Search Records and shared history. The count counts the
 * events drawn, and names the kinds past the cap it counts none of (#1424): `13 events, print jobs not counted`, never a
 * count that leaves them out unsaid.
 */
import { some, type ValueTypeOf, type option } from "@elaraai/east";
import type { RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import {
    ChipMenu, historyToolbarItem, useKeySearchToolbarItem, type EditIssue, type EditingWords, type HistoryAction, type KeySearchSource, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { HOST_RANK, RecordSliceFieldEditor, coarseHitArea, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { TimeNavigator } from "../shared/time/navigation.js";
import { SEARCH_BOX_RANK } from "../shared/schedule/search-rank.js";
import { eventsNotCounted } from "../shared/schedule/words.js";
import { Seg } from "../shared/schedule/segments.js";
import type { ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import { scheduleIssueName } from "../shared/schedule/editing.js";
import type { CalendarCommands } from "./actions.js";
import type { CalendarWords } from "./messages.js";
import type { CalendarEventPart } from "./window.js";
import { dayStart, navigate, type CalendarItem, type CalendarRef, type CalendarStyles, type CalendarUncounted, type CalendarView } from "./model.js";

const LAYOUTS: readonly { readonly key: CalendarView["layout"]; readonly label: string }[] = [{ key: "calendar", label: "Calendar" }, { key: "resources", label: "Resources" }, { key: "timeline", label: "Timeline" }];
const PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }] as const;
/** The kind of an issue's event: the kind whose session the history holds the issue in. */
function kindOfIssue(commands: CalendarCommands, issue: EditIssue): string | undefined {
    return commands.editing.sessions.find(held => held.key === commands.editing.history.sourceOf(issue))?.kind;
}

/** The instant an issue's event starts, as a gesture reads it; `undefined` for one unplaced, or not read. */
function startOfIssue(commands: CalendarCommands, kind: string, entry: string): Date | undefined {
    try {
        const start = commands.editing.read(kind, entry)?.item.start;
        return start?.type === "some" ? start.value : undefined;
    } catch {
        return undefined;
    }
}

interface ToolbarArgs {
    view: CalendarView; setView: (view: CalendarView) => void; now: Date;
    /** What this Calendar calls its Resources layout (#1516). */
    resourcesWord: string;
    /** The layouts this Calendar offers, in the switch's order: the `views` prop's. */
    layouts: readonly CalendarView["layout"][];
    /** The periods this Calendar offers, in the switch's order: the `viewPeriods` prop's. */
    periods: readonly CalendarView["period"][];
    /** The window's events; `undefined` while its period is read: "…", never a count of another period's (#1398, CL13). */
    count: number | undefined;
    /** The kinds past the cap (#1424): the count counts none of their events, and says so. */
    uncounted: CalendarUncounted;
    styles: CalendarStyles; commands: CalendarCommands | undefined;
    /** The Calendar's words: its message table — the history's, and what Search Records searches — and the app's formatters. */
    words: CalendarWords; overlaps: ScheduleOverlaps<CalendarItem>; select: (refs: CalendarRef[]) => void;
    /** Whether an overlap shows among what is drawn. */
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
    /** Told when the date picker's Today is pressed: the time grid and the timeline bring the now line into view (#1398). */
    onToday?: (() => void) | undefined;
    /** Search Records over the event kinds' keys (#1398); `undefined` with no kind to seek. */
    search?: KeySearchSource | undefined;
    /** The Elara eye (#1409): the run's toolbar item, listed immediately before the history item; `undefined` with no optimiser. */
    optimise?: ToolbarItem | undefined;
    /** Whether a run of the optimiser is out (#1409, R2): the history item's actions locked. */
    locked?: boolean | undefined;
    /**
     * The events drawn whose stored rows break their kind's bounds (#1585): each a warning beside the history's issues,
     * holding no Save — its event, the field, by its form's key, and its words, `Mounting plates · Hours: at least 1`.
     */
    warnings?: readonly { readonly kind: string; readonly key: string; readonly field: string; readonly text: string }[] | undefined;
    /**
     * Asks an event's form for the field an issue or a warning gone to names, which takes the keyboard as the form draws
     * it (`../shared/schedule/field-ask.tsx`); one naming no field asks for none.
     */
    askField?: ((kind: string, entry: string, field: option<string>) => void) | undefined;
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
    // Search Records (#1398): primary-key navigation over every event kind's record, at the row's end, saying what it
    // searches — `Search events by key` — as the views name an event by its title. Its box is the first thing the row
    // folds, to its icon, before the rail and the period's steps (ruled 25 Oct 2026); at the row's last step it goes into
    // the View, beside the date and the view controls.
    const seek = useKeySearchToolbarItem(args.search, { side: "end", rank: SEARCH_BOX_RANK, label: words.m.keySearch() });
    const period = view.layout === "resources" ? "day" : view.period;
    // The layouts this Calendar offers: its switch, in every form, only where there is a choice to make.
    const layouts = LAYOUTS.filter(layout => args.layouts.includes(layout.key)).map(layout => layout.key === "resources" ? { ...layout, label: args.resourcesWord } : layout);
    const switches = layouts.length > 1;
    // And the periods it offers, Resources being always a day.
    const periods = PERIODS.filter(item => args.periods.includes(item.key));
    const picksPeriod = view.layout !== "resources" && periods.length > 1;
    // A step from the view's date, a period exactly.
    const move = (step: number) => args.onNavigate(navigate({ ...view, date: args.navigationDate }, step).date);
    // The overlaps shown: every one among what is drawn.
    const overlapCount = overlaps.pairs.length;
    const showOverlaps = () => {
        const firstPair = overlaps.pairs[0];
        if (firstPair === undefined) return;
        select([firstPair.first, firstPair.second].map(item => ({ kind: item.kind, key: item.key })));
        if (firstPair.first.start.type === "some") setView({ ...view, layout: args.layouts.includes("resources") ? "resources" : view.layout, date: dayStart(firstPair.first.start.value).getTime() });
    };
    const overlapNoun = (n: number) => n === 1 ? "overlap" : "overlaps";
    const warning = (short: boolean) => <chakra.button type="button" css={[chip({ tone: "warn" }), coarseHitArea({ position: true })]}
        aria-label={`${overlapCount} ${overlapNoun(overlapCount)}`} data-calendar-overlaps="" onClick={showOverlaps}><span data-chip-icon=""><FontAwesomeIcon icon={faTriangleExclamation} /></span><span data-chip-label="">{overlapCount}{!short && ` ${overlapNoun(overlapCount)}`}</span></chakra.button>;
    const overlapsWords = `${overlapCount} ${overlapNoun(overlapCount)}`;
    const viewMenu = <ChipMenu label="View" icon={faCalendarWeek} data="data-calendar-view-menu" onSelect={key => {
        const layout = LAYOUTS.find(layout => layout.key === key); const picked = PERIODS.find(period => period.key === key);
        if (layout !== undefined) setView({ ...view, layout: layout.key });
        else if (picked !== undefined && view.layout !== "resources") setView({ ...view, period: picked.key });
        else if (key === "overlaps") showOverlaps();
        else if (key === "previous" || key === "next") move(key === "previous" ? -1 : 1);
    }}>
        {switches && <>{layouts.map(layout => <ChakraMenu.Item value={layout.key} key={layout.key}>{layout.label}</ChakraMenu.Item>)}<ChakraMenu.Separator /></>}
        {picksPeriod && <>{periods.map(p => <ChakraMenu.Item value={p.key} key={p.key}>{p.label}</ChakraMenu.Item>)}<ChakraMenu.Separator /></>}
        <ChakraMenu.Item value="previous">Previous {period}</ChakraMenu.Item><ChakraMenu.Item value="next">Next {period}</ChakraMenu.Item>
        {overlapsShown && <ChakraMenu.Item value="overlaps">{overlapsWords}</ChakraMenu.Item>}
    </ChipMenu>;
    const controls = <>
        {seek?.forms[0]}
        {switches && <Seg label="Layout" scope="calendar" name="compact-layout" items={layouts} active={view.layout} onPick={layout => setView({ ...view, layout })} />}
        {picksPeriod && <Seg label="Period" scope="calendar" name="compact-period" items={periods} active={period} onPick={period => setView({ ...view, period })} />}
        {overlapsShown && <Button size="xs" variant="ghost" onClick={showOverlaps}>{overlapsWords}</Button>}
    </>;
    const navigator = (compact: boolean, combined: boolean) => (date: number, label: string | undefined) => <TimeNavigator scope="calendar" date={date} period={period}
        sunday={args.sunday} now={now} onChange={args.onNavigate} compact={compact} rangeLabel={label}
        label={combined ? "View" : "Choose date"} controls={combined ? controls : undefined} rangeEditor={rangeEditor} onToday={args.onToday} />;
    const navigation = (compact = false, combined = false) => navigator(compact, combined)(args.navigationDate, args.rangeLabel);
    // An event's Go to — an issue's, a warning's — selects it and shows its day, as a pick of Search Records does, wherever
    // the view stood, and asks its form for the field it names, which takes the keyboard: never the page's body, where the
    // history's buttons, which keep no focus, leave it.
    const goTo = (kind: string, key: string, field: option<string>) => {
        args.askField?.(kind, key, field);
        select([{ kind, key }]);
        const start = commands === undefined ? undefined : startOfIssue(commands, kind, key);
        if (start !== undefined) args.onNavigate(dayStart(start).getTime());
    };
    return [
        ...rail,
        switches && { key: "calendar.layout", side: "start", rank: HOST_RANK + 1, bundle: "calendar.view", forms: [<Seg label="Layout" scope="calendar" name="layout" items={layouts} active={view.layout} onPick={layout => setView({ ...view, layout })} />, null] },
        picksPeriod && { key: "calendar.period", side: "start", rank: HOST_RANK + 1, bundle: "calendar.view", forms: [<Seg label="Period" scope="calendar" name="period" items={periods} active={period} onPick={period => setView({ ...view, period })} />, null] },
        // What the row folds into the View: with neither the switch nor the periods, nothing, so no View to fold to.
        (switches || picksPeriod) && { key: "calendar.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["calendar.view", "calendar.controls"], forms: [null, viewMenu, null] },
        { key: "calendar.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "calendar.controls"], forms: [navigation(), navigation(true), navigation(true, true)] },
        // With no slice, the window's own count; a slice's summary counts each source instead.
        chrome === undefined && { key: "calendar.count", side: "start", rank: HOST_RANK,
            forms: [<Box css={styles.toolbarText} data-calendar-count="">{countWords(count, args.uncounted, words)}</Box>, null] },
        paged && chrome === undefined && { key: "calendar.scope", side: "start", forms: [<Box css={styles.toolbarText}>Loaded window</Box>, null], rank: HOST_RANK + 4 },
        overlapsShown && { key: "calendar.overlaps", side: "end", rank: [HOST_RANK, HOST_RANK + 6], forms: [warning(false), warning(true), null] },
        seek !== undefined && { ...seek, forms: [...seek.forms, null], rank: [SEARCH_BOX_RANK, HOST_RANK + 6], bundle: [undefined, "calendar.controls"] },
        // The eye, immediately before the history item (#1409, D4).
        args.optimise,
        commands !== undefined && historyToolbarItem({ session: commands.editing.history, words, editing: false, showError: false, onAction, locked: args.locked === true,
            // A conflict's event, named as its kind's banners name it.
            where: issue => { const kind = kindOfIssue(commands, issue); return kind === undefined ? issue.entry : scheduleIssueName(commands.editing, kind, issue.entry); },
            onIssue: issue => { const kind = kindOfIssue(commands, issue); if (kind !== undefined) goTo(kind, issue.entry, issue.field); },
            // A stored event's breach (#1585): a warning beside the issues, holding no Save, gone to as an issue is.
            warnings: args.warnings?.map(warning => ({ text: warning.text, go: () => goTo(warning.kind, warning.key, some(warning.field)) })) }),
    ];
}
