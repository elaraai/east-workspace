/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-ui's Calendar renderer; BuilderFrame stays an internal React detail. Its
 * slice narrows through one `Slice.bindRecords` (#1343): each event kind
 * reads through its own source, the date window written to every one; each
 * resource kind's source narrows its columns, rows and Choosers; each
 * templates list's and each tab's narrows that tab. Overlaps, checks and
 * commands read everything. Its footer explains the event kinds, beside the
 * shared loading line (#1398): the period being read, or why it could not be.
 * Only its cold load is covered, at its time grid's hour (CL1, CL5): a grid's
 * step to a period not read yet draws that period's grid at once — never the
 * old period's events under its labels — its regions washed and its counts
 * placeholders; one whose read failed keeps its grid and says so once (CL11).
 * Its Search Records seeks each event kind's record by key (`find.ts`), and its
 * box says so — `Search events by key`, the Calendar's message table's
 * (`messages.ts`) — as the views name an event by its title: a pick
 * steps to its event's period, selects it and brings it into view, and hands it
 * the keyboard where its ring is drawn once the window it is drawn in has landed
 * (`event-focus.ts`); a step through the matches leaves the keyboard in the box.
 * An event its kind's choices hide is named by them — and, where the view lays
 * resources out, one whose resource its resource kind's source hides by that
 * source's choices too — and a pick of it clears just them first, its window
 * kept (the shared hidden pick, `shared/schedule/hidden-pick.tsx`, each kind's
 * read through its source in `HideSources`).
 * Each layout's view keeps its place across a step and a remount — the time
 * grid's hour, the timeline's line — and the timeline its place along the
 * period across a step; Today brings the time grid and the timeline to the now
 * line. Every key it acts on goes no further than the Calendar: `[` and `]`
 * step its period from anywhere in the frame.
 *
 * The timeline shows the period chosen and scrolls only within it (ruled 9 Nov
 * 2026), as the Roster's grid does: Day a day, Week a week, Month a month
 * (`timeline.ts`). Its period moves only by Previous and Next, Today, a date
 * picked or a pick of Search Records, never by its scroll, and the periods
 * either side are read ahead once the one shown lands, as every layout's are.
 * A step to a period not read yet — or a layout changed — draws none of the
 * old period's events, whose days are another period's.
 *
 * Its Backlog is each kind's, and never blinks (ruled 25 Oct 2026): no step
 * of the dates reads it again. A kind narrowed through its source has its
 * backlog read a page at a time (#1424, `backlog-pages.ts`), through the source
 * with its start Unset — its choices but its window — never every unscheduled
 * event of its narrowing, the tab counting it from the index (`N of M` while a
 * choice narrows it, "…" until first read, CL13), a new narrowing's cards and
 * count swapped in together once they land, the last standing, retained,
 * meanwhile. Every other kind's is read apart from the window, once, and is
 * never emptied or read again by a date change. The Library stays mounted
 * throughout: a resident one's search box keeps its query and its focus.
 *
 * Every kind is counted before one of its events is read (#1424): past
 * `SCHEDULE_EVENT_CAP` over the window, none is read or drawn but its drafts —
 * and the events selected there, read by their keys, so a pick of Search
 * Records goes to its event wherever it is and draws it there (#1398). A
 * resource's row on the timeline, or its column in the Resources view, of a
 * kind such a kind is placed on draws its shading in their place — the share
 * of each of the view's periods its events book, from its source's summary —
 * or is hatched where none shades at that period; the banner says how many
 * events there are and to narrow or to choose another period; and every
 * figure that would count them says they are not counted, never 0.
 *
 * A resource kind may be paged (#1424): its resources come a window at a time
 * (`pages.ts`), read in a component of their own around the places the views
 * show — the timeline's rows, the Resources view's columns — and an event kind
 * placed on it is read a cell at a time there, the events of the resources and
 * the dates on screen alone (`cells.ts`). Its source of the slice narrows its
 * windows themselves, so the frame follows no such source; a choice keeps the
 * last view standing, retained, until its windows land. Its Choosers search it
 * by key through its own paged read, and an event — drawn, or a Backlog card —
 * names its resource by the windows held, else by the resource's key. A new
 * event takes the resource it is dropped on or chosen; with none, it lands on
 * the first resource of the windows held that is free then, as on a kind read
 * whole — free only where that resource's events are read.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { SortedMap, StringType, compareFor, equalFor, fromEastTypeValue, none, some, type EastType } from "@elaraai/east";
import { CalendarComponent } from "@elaraai/e3-ui/internal";
import type { RecordTile } from "@elaraai/east-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, fieldBreachIssue, historyShortcut, implementUIComponent, optimiseMessages, takeKey, typedInto, useContainerBelow,
    useFormatters, usePersistedState, useLanding, useLandingStyles, useTrackedEvaluation, type BuilderFramePanes, type Formatters,
} from "@elaraai/east-ui-components";
import { LoadingReveal, PAGED_LIBRARY_PAGE } from "@elaraai/east-ui-components/internal";
import { isBounded, rowBreaches } from "../shared/bounds.js";
import { useOptimise } from "../shared/func/use-optimise.js";
import { useOptimiseParts } from "../shared/func/optimise-parts.js";
import { pagedLoadingLine, pagedLoadingMessages, periodLoading, periodLoadingLine, periodRead, retryPeriod, type PagedLoading } from "../shared/loading.js";
import type { ScheduleCellNotice, ScheduleCellResources } from "../shared/schedule/cells.js";
import { scheduleIssueName, useScheduleEditing, type ScheduleEditing, type ScheduleEventDraftsValue, type ScheduleHeldRows, type ScheduleRowRead } from "../shared/schedule/editing.js";
import { FieldAskProvider, useFieldAsks } from "../shared/schedule/field-ask.js";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import { HideSources, useHiddenPick, type HiddenPicks, type HiddenSource } from "../shared/schedule/hidden-pick.js";
import { scheduleOverlaps } from "../shared/schedule/overlaps.js";
import { refusalText, scheduleRefusals } from "../shared/schedule/refusals.js";
import { lowerWord } from "../shared/schedule/words.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { useNow } from "../shared/time/now-line.js";
import { calendarCommands } from "./actions.js";
import { BacklogServed, CalendarBacklogPages, type BacklogPageCount } from "./backlog-pages.js";
import { calendarCellKinds, type CalendarBucket } from "./cells.js";
import { CalendarDataReader, initialCalendarData, resourceRows, windowedBacklogKinds, type CalendarDataState } from "./data.js";
import { CalendarChooserContext, type CalendarChooser } from "./chooser.js";
import { useCalendarDrag } from "./drag.js";
import { EventFocusContext, type EventFocus } from "./event-focus.js";
import { useCalendarFind, type FoundEvent } from "./find.js";
import { CalendarFooter } from "./footer.js";
import { CalendarPagesReader, createPagedDemand, type CalendarPages } from "./pages.js";
import { CalendarSelectionReader, NO_SELECTION, useCalendarInspector, type CalendarSelection } from "./inspector.js";
import { calendarLibraryId, templatesTab, useCalendarLibrary } from "./library.js";
import { calendarMessages, type CalendarWords } from "./messages.js";
import {
    calendarOptimiseRequest, calendarOptimiseTypes, landCalendarOptimise, lockCalendarCommands,
    type CalendarOptimiseRequest, type CalendarOptimiseResult, type CalendarOptimised,
} from "./optimise.js";
import { useBacklogNarrowing } from "../shared/schedule/backlog.js";
import { calendarNouns, calendarSaid, followedSources } from "./sources.js";
import { useCalendarToolbar } from "./toolbar.js";
import { useCalendarWindow, type CalendarWindow } from "./window.js";
import { CalendarViews, calendarHour, readCalendarAnchor, type CalendarAnchor } from "./views.js";
import {
    NOTHING_UNCOUNTED, calendarRange, chronological, dayStart, eventKey, inWindow, NARROW_WIDTH, navigate, periodWords,
    type CalendarItem, type CalendarRange, type CalendarRef, type CalendarRow, type CalendarStyles, type CalendarUncounted, type CalendarValue,
} from "./model.js";

export type { CalendarValue } from "./model.js";
/** Props of the Calendar extension renderer. */
export interface EastChakraCalendarProps { value: CalendarValue; storageKey: string }
interface HostProps extends EastChakraCalendarProps {
    /** The date window and the slice's event sources (`useCalendarWindow`). */
    dates: CalendarWindow; now: Date;
    /** The sources the Calendar follows beside its event kinds': what each shows. */
    followed: FollowedSources;
    /**
     * Each event kind's hidden pick and each resource kind's, by its slot (the shared hidden pick): what hides an event
     * Search Records finds that its kind's choices leave out — or, where the view lays resources out, its resource's source.
     */
    picks: HiddenPicks;
    editing?: ScheduleEditing;
    /**
     * Told the rows the cells' reader holds of each kind it reads by its cells (#1424), as they move: where the editing
     * finds one of their events — never by a read over the window.
     */
    onHeld?: ((held: ScheduleHeldRows | undefined) => void) | undefined;
    /**
     * Told the paged Backlog as it is made again (#1424): a backlog event its pages read, at the revision they read it at,
     * is where the editing finds the original a gesture placing it rewrites.
     */
    onBacklog?: ((pages: CalendarBacklogPages | undefined) => void) | undefined;
}
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];
const NO_ITEMS: CalendarItem[] = [];
/** No layout's view has rested anywhere yet. */
const NO_ANCHOR: CalendarAnchor = {};
/** The row an event with no resource sits on, in the Calendar's word for it. */
const unassignedRow = (label: string): CalendarRow => ({ key: "", label, meta: "", group: "", resource: none });
/** No resource kind laid out: a view with no resource axis shades no resource (#1424). */
const NO_CELL_RESOURCES: readonly ScheduleCellResources[] = [];
/** A summary's tile the timeline shades a resource's row at, as the toolbar names the period (#1424). */
const PERIOD_NAMES: Partial<Record<RecordTile, string>> = { day: "Day", week: "Week", month: "Month" };
/** No resource of a paged kind held. */
const NO_ROWS: readonly CalendarRow[] = [];
/**
 * The frame's root takes the focus a click on a part of it holding nothing focusable gives — the Backlog's list clear of
 * its cards, a pane's empty foot (retest C4) — so the keyboard is in the Calendar, never the page's body: not a tab stop.
 */
const CLICK_FOCUS: Readonly<Record<string, string>> = { tabIndex: "-1" };
/** The cells of the paged kind's resources in view, in flight: the line says the events they hold, with no places (retest C7). */
const CELLS_LOADING: PagedLoading = { kind: "loading", from: undefined, to: undefined };

/**
 * The paged kind's resources the frame holds (#1424), every window's in order: what an event names its resource by.
 *
 * @param windows - The windows the frame holds of the paged kind, by window
 * @returns Their rows
 */
function heldRows(windows: CalendarPages["windows"] | undefined): readonly CalendarRow[] {
    if (windows === undefined || windows.size === 0) return NO_ROWS;
    return [...windows.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, rows]) => rows);
}

/**
 * What the banner says of a kind past the cap (#1424): how many of its events the window holds — or, where its count is
 * no number of them (a day index's), that they are not counted — and where they show: the timeline at the period its
 * summary shades at, or a narrower view.
 *
 * @param notice - The kind's notice, as the shared reader gives it
 * @param format - The app's formatters
 * @returns The banner's title and its line
 */
function noticeWords(notice: ScheduleCellNotice, format: Pick<Formatters, "number" | "locale">): { title: string; hint: string } {
    const kind = notice.name.toLocaleLowerCase(format.locale);
    const title = notice.events === undefined ? `${notice.name} events in view: not counted`
        : `${format.number(notice.events)} ${kind} ${notice.events === 1 ? "event" : "events"} in view`;
    const period = notice.resolution === undefined ? undefined : PERIOD_NAMES[notice.resolution];
    const hint = period === undefined ? "Too many to draw here: narrow the filters, or choose a shorter period."
        : `Too many to draw here: narrow the filters, or open the timeline at ${period} to see where they fall.`;
    return { title, hint };
}

/**
 * Brings a picked event out from under a pane the frame lays over main (the hand retest, 27 Oct 2026). The Inspector a
 * pick opens floats over main's edge for lack of room, as a start pane overlaid floats over its other; what main shows
 * between them, as the frame says it (`BuilderFramePanes.mainShown`), clear of the sticky column the view keeps at its
 * left too — the timeline's resources, the time grid's hours — is where the viewer sees the event. The view is scrolled
 * across by as much as the event stands outside that part: its middle to the part's middle, or, wider than the part,
 * its start to the part's start. A view that has no room left across it is left as it is.
 *
 * @param element - The event's element, drawn
 * @param shown - What of main the frame's panes leave in view; `undefined` with no frame drawn
 */
function clearOfPanes(element: HTMLElement, shown: Pick<DOMRectReadOnly, "left" | "right"> | undefined): void {
    const view = element.closest<HTMLElement>("[data-calendar-timeline], [data-calendar-time-grid], [data-calendar-month-grid]");
    if (!element.isConnected || shown === undefined || view === null) return;
    const sticky = view.querySelector("[data-calendar-row-head], [data-calendar-gutter]")?.getBoundingClientRect();
    const left = Math.max(shown.left, sticky !== undefined && sticky.width > 0 ? sticky.right : shown.left);
    const right = shown.right;
    const box = element.getBoundingClientRect();
    if (right <= left || (box.left >= left && box.right <= right)) return;
    view.scrollLeft += box.width >= right - left ? box.left - left : (box.left + box.right - left - right) / 2;
}

/** Whether two ranges are one window: the same bounds. */
function sameRange(a: CalendarRange, b: CalendarRange): boolean {
    return a.from.getTime() === b.from.getTime() && a.to.getTime() === b.to.getTime();
}

/** No drafts: a read-only Calendar's. */
const NO_DRAFTS: ScheduleEventDraftsValue = new SortedMap([], compareFor(StringType));
/** No session began from any row: a read-only Calendar's. */
const NO_ORIGINAL = (): undefined => undefined;
const stringEqual = equalFor(StringType);

/** Whether two counts of the paged Backlog say the same. */
function sameCount(a: BacklogPageCount | undefined, b: BacklogPageCount | undefined): boolean {
    return a === undefined || b === undefined ? a === b : a.shown === b.shown && a.total === b.total && a.narrowing === b.narrowing;
}

/**
 * What the paged Backlog counts (#1424), read in a component of its own — its index counts land as their requests do,
 * and each would otherwise render the whole frame — handed to the frame only as it moves: the last count standing while
 * another narrowing's is read, so the tab says "…" only before its first (CL13). A count is handed on once the list's
 * first page has landed too, as the list swaps to its rows then (`PagedLibrary`): never a count against another
 * narrowing's cards (ruled 25 Oct 2026).
 *
 * @param props - The paged Backlog, and where its count goes
 * @returns Nothing: it reads
 */
function CalendarBacklogCountReader({ pages, onCount }: { pages: CalendarBacklogPages; onCount: (count: BacklogPageCount) => void }): null {
    const read = useCallback(() => {
        const count = pages.count();
        return count === undefined || pages.page(0n, BigInt(PAGED_LIBRARY_PAGE)).type !== "some" ? undefined : count;
    }, [pages]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) console.error("[Calendar] the backlog could not be counted:", result.error);
    const count = result.ok ? result.value : undefined;
    const reported = useRef<BacklogPageCount | undefined>(undefined);
    useLayoutEffect(() => {
        if (count === undefined || sameCount(reported.current, count)) return;
        reported.current = count;
        onCount(count);
    });
    return null;
}

/**
 * An event drawn whose stored row breaks its kind's bounds (#1585): its kind and key, the field, by its form's key — what
 * its Go to asks the event's form for — and its words: its title, then its field's label and the bound.
 */
interface CalendarWarning { readonly kind: string; readonly key: string; readonly field: string; readonly text: string }

/** The events drawn whose rows break their kind's bounds (#1585): those that wear the warn ring, and the stored ones' breaches. */
interface CalendarBreaches { readonly bounded: ReadonlySet<string>; readonly warnings: readonly CalendarWarning[] }

/** No event whose row breaks its kind's bounds. */
const NO_BREACHES: CalendarBreaches = { bounded: new Set(), warnings: [] };

/** Whether two readings of the events' bounds say the same. */
function sameBreaches(a: CalendarBreaches, b: CalendarBreaches): boolean {
    return a.bounded.size === b.bounded.size && [...b.bounded].every(key => a.bounded.has(key)) && a.warnings.length === b.warnings.length
        && a.warnings.every((was, i) => {
            const now = b.warnings[i]!;
            return stringEqual(was.kind, now.kind) && stringEqual(was.key, now.key) && stringEqual(was.field, now.field) && stringEqual(was.text, now.text);
        });
}

/**
 * The events drawn whose rows break their kind's bounds (#1585), read in a component of its own — each event read as the
 * inspector reads it, its drafts in place, each read landing re-running it alone — handed to the frame only as they move:
 * each wears the warn ring, stored or changed, and a stored one's breach is a warning beside the history's issues,
 * holding no Save — a changed one's is the refusal its session's readiness raises, which holds Save. A kind whose form
 * holds no number to bounds is read for nothing.
 *
 * @param props - The event kinds, the events drawn, the editing, and where what it reads goes
 * @returns Nothing: it reads
 */
function CalendarBoundsReader({ kinds, items, editing, onBreaches }: {
    kinds: CalendarValue["events"]; items: readonly CalendarItem[]; editing: ScheduleEditing; onBreaches: (breaches: CalendarBreaches) => void;
}): null {
    const checks = useMemo(() => new Map(kinds.flatMap(kind => kind.fields.some(isBounded)
        ? [[kind.key, { fields: kind.fields, breachesOf: rowBreaches(kind.fields, fromEastTypeValue(kind.editing.entryType) as EastType) }] as const] : [])), [kinds]);
    const version = editing.version;
    const read = useCallback((): CalendarBreaches => {
        const bounded = new Set<string>();
        const warnings: CalendarWarning[] = [];
        const refused = scheduleRefusals(editing.sessions);
        for (const item of items) {
            const check = checks.get(item.kind);
            if (check === undefined) continue;
            const event = editing.read(item.kind, item.key);
            const breaches = event === undefined ? [] : check.breachesOf(event.row);
            if (breaches.length === 0) continue;
            bounded.add(eventKey(item));
            for (const breach of breaches) {
                if (refused.some(({ kind, issue }) => stringEqual(kind, item.kind) && stringEqual(issue.entry, item.key)
                    && issue.field.type === "some" && stringEqual(issue.field.value, breach.key))) continue;
                warnings.push({ kind: item.kind, key: item.key, field: breach.key, text: `${item.title} · ${refusalText(fieldBreachIssue(breach, { entry: item.key }), check.fields)}` });
            }
        }
        return { bounded, warnings };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sessions are mutable: the history's version says they moved
    }, [checks, items, editing, version]);
    const { result } = useTrackedEvaluation(read);
    const now = result.ok ? result.value : undefined;
    const reported = useRef(NO_BREACHES);
    useLayoutEffect(() => {
        if (now === undefined || sameBreaches(reported.current, now)) return;
        reported.current = now;
        onBreaches(now);
    });
    return null;
}

/** The sole editable wrapper: read-only Calendar never creates a record session. */
function EditableCalendar(props: Omit<HostProps, "editing" | "onHeld" | "onBacklog">) {
    const { value } = props;
    // Each event kind's Save notice counts what leaves its own source's narrowing.
    const recordSlices = useMemo(() => props.dates.eventParts.map(({ part }) => part), [props.dates.eventParts]);
    // The rows a kind read by its cells holds (#1424): where a gesture finds one of its events, as the frame's reader hands
    // them on — read as the gesture runs, so their moving draws nothing (#1594).
    const held = useRef<ScheduleHeldRows | undefined>(undefined);
    const onHeld = useCallback((rows: ScheduleHeldRows | undefined) => { held.current = rows; }, []);
    // The paged Backlog as the frame last made it (#1424): a backlog event its pages read, while the record is at the
    // revision they read it at, is the original a gesture placing it rewrites — as the Schematic's Backlog gives its rows
    // (#1393); any other event is read as its kind reads it, its window's rows first.
    const backlogNow = useRef<CalendarBacklogPages | undefined>(undefined);
    const onBacklog = useCallback((pages: CalendarBacklogPages | undefined) => { backlogNow.current = pages; }, []);
    const reads = useMemo((): Record<string, ScheduleRowRead> => {
        const paged = windowedBacklogKinds(value);
        const out: Record<string, ScheduleRowRead> = {};
        for (const kind of value.events) {
            if (!paged.has(kind.key) || kind.entries.type !== "some") continue;
            const entries = kind.entries.value;
            out[kind.key] = (id) => {
                const at = entries.revision();
                if (at.type !== "some") return undefined;
                const page = backlogNow.current?.servedRow(kind.key, id);
                return page === undefined || !stringEqual(page.revision, at.value) ? undefined : some(some(page.row));
            };
        }
        return out;
    }, [value]);
    // The kinds the reader may give cells (#1424, #1599) — every kind read a window at a time: what each Save lands of
    // them draws as the Save left it over cells read before the commit, until they are read again.
    const drawsLanded = useMemo(() => calendarCellKinds(value.events), [value.events]);
    // A new event whose made key another Save took goes on under the next its kind makes (#1583) — two people who each
    // make an event from one template are given the same key. Nothing the Calendar drafts names an event by its key, so
    // every kind's may.
    const rekeys = useMemo(() => new Set(value.events.map(kind => kind.key)), [value.events]);
    const editing = useScheduleEditing({ kinds: value.events, storageKey: props.storageKey, joined: NO_JOINED, range: props.dates.range,
        recordSlices, held, reads, drawsLanded, rekeys, autosave: value.settings.autosave });
    return <CalendarFrame {...props} editing={editing} onHeld={onHeld} onBacklog={onBacklog} />;
}
/**
 * Test-only render probe — lets "a landing key search re-renders the window's reader, never the frame" be asserted
 * deterministically (#1343). `undefined` outside tests.
 */
let calendarFrameRenderProbe: (() => void) | undefined;
/**
 * Install (or clear) the test frame render probe. Test use only.
 *
 * @param fn - Called each time the frame renders; `undefined` clears it
 */
export function setCalendarFrameRenderProbe(fn: (() => void) | undefined): void {
    calendarFrameRenderProbe = fn;
}
function CalendarFrame(props: HostProps) {
    calendarFrameRenderProbe?.();
    const { value, storageKey, editing, now, followed, dates, onHeld, onBacklog, picks } = props;
    const { view, range, setView } = dates;
    const onNavigate = (date: number) => setView({ ...view, date });
    const recipe = useSlotRecipe({ key: "calendar" });
    const styles = useMemo(() => recipe({}) as unknown as CalendarStyles, [recipe]);
    // The Calendar's words: its message table — the editing session's, and what Search Records searches — and the app's formatters.
    const format = useFormatters(); const words = useMemo((): CalendarWords => ({ ...format, m: calendarMessages, backlog: lowerWord(value.vocabulary.backlog) }), [format, value.vocabulary.backlog]);
    const root = useRef<HTMLDivElement>(null);
    const main = useRef<HTMLDivElement>(null);
    // The frame's panes, as the Calendar's own code opens them: the Inspector an event shown as asked reveals, Enter's Details.
    const panes = useRef<BuilderFramePanes>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    // The period, as the footer's line, the eye and the banner name it (#1398, CL3; #1409).
    const periodName = periodWords(view, range, value.settings, format);
    const [refs, setRefs] = useState<CalendarRef[]>([]);
    const [error, setError] = useState<string>();
    const [reveal, setReveal] = useState<CalendarRef>();
    const select = useCallback((next: CalendarRef[]) => {
        setRefs(next); if (value.onSelect.type === "some") for (const ref of next) value.onSelect.value(ref);
    }, [value.onSelect]);
    const selected = useMemo(() => new Set(refs.map(ref => eventKey(ref))), [refs]);
    // The window read reports from a component of its own, so a search landing re-renders it alone (#1343); once the
    // window lands, it reads ahead what a step goes to (#1398, CL7): the periods either side.
    const [data, setData] = useState<CalendarDataState>(() => initialCalendarData(range));
    // The rows a kind read by its cells holds (#1424): the editing, the selection and Search Records find its events there.
    const cellRows = data.cells?.held;
    useLayoutEffect(() => { onHeld?.(cellRows); }, [cellRows, onHeld]);
    // The paged resource kind (#1424): its windows around the places the views show, read in a component of their own;
    // the views report those places to a store only that reader and the window's hear, so a scroll renders no frame.
    const pagedValue = value.paged.type === "some" ? value.paged.value : undefined;
    const pagedKind = pagedValue === undefined ? undefined : value.resources.find(kind => kind.key === pagedValue.kind);
    const [demand] = useState(createPagedDemand);
    const [pages, setPages] = useState<CalendarPages | undefined>(undefined);
    // The period shown has landed when the held read is of the window read now (#1398): a step to a period not read yet
    // holds none of the old period's events, which never show under its labels (CL5); a newer read of the same period
    // keeps them meanwhile.
    const current = data.ready && sameRange(data.range, range);
    // An event shown as asked: brought into view, the inspector opened on it. One drawn already is shown at once; one the
    // timeline has not drawn — a row out of its view, a time out of its span — tells the frame once it brings it in.
    const revealed = useCallback((element: HTMLElement) => {
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        panes.current?.reveal("end");
        setReveal(undefined);
        // The Inspector just opened may float over main, for lack of room: once it is laid out, the event is brought out from
        // under it (the hand retest, 27 Oct 2026), by what of main the frame says it leaves in view.
        requestAnimationFrame(() => clearOfPanes(element, panes.current?.mainShown()));
    }, []);
    // Enter on an event opens its Details, as the Schematic's Enter does (retest C5): the Inspector, folded, opened on it.
    const openDetails = useCallback(() => { panes.current?.open("end"); }, []);
    useEffect(() => {
        if (reveal === undefined || main.current === null) return;
        const key = CSS.escape(eventKey(reveal));
        const element = main.current.querySelector<HTMLElement>(`[data-calendar-event="${key}"], [data-calendar-card="${key}"]`);
        if (element !== null) revealed(element);
    }, [reveal, data.items, view, narrow, revealed]);
    // Today pressed (#1398): the time grid and the timeline bring the now line into view.
    const [nowAsked, setNowAsked] = useState(0);
    const onToday = useCallback(() => setNowAsked(n => n + 1), []);
    // Where each layout's view rests (#1398): saved under the Calendar's key, so a layout comes back to it as it mounts.
    const { state: anchor, setState: setAnchor } = usePersistedState<CalendarAnchor>(`${storageKey}.anchor`, NO_ANCHOR, readCalendarAnchor);
    const onAnchor = useCallback((next: Partial<CalendarAnchor>) => setAnchor(was => ({ ...was, ...next })), [setAnchor]);
    // Each resource kind's rows its source shows: the columns, the timeline's rows and the Choosers (#1343).
    const shown = useMemo(() => value.resources.map(kind => {
        const keys = followed.get(kind.key)?.shown.keys;
        return keys === undefined || keys.type === "none" ? kind : { ...kind, rows: kind.rows.filter(row => keys.value.has(row.key)) };
    }), [value.resources, followed]);
    const resourcesBusy = value.resources.some(kind => followed.get(kind.key)?.shown.busy === true);
    // The periods a resource's shading is cut into (#1424): the timeline's by its period, the Resources view's day — none in
    // a view with no resource axis, a time grid, the month or the agenda, which shades no resource.
    const bucket: CalendarBucket | undefined = narrow ? undefined : view.layout === "timeline" ? view.period : view.layout === "resources" ? "day" : undefined;
    // Whether the view lays resources out — the timeline's rows, the Resources view's columns: there an event whose
    // resource its source of the slice hides is drawn nowhere, and Search Records names that source's choices too.
    const laysResources = bucket !== undefined;
    const cellResources = useMemo((): readonly ScheduleCellResources[] => bucket === undefined ? NO_CELL_RESOURCES
        : shown.map(kind => ({ key: kind.key, keys: kind.rows.map(row => row.key) })), [bucket, shown]);
    // The kinds past the cap (#1424): none of their events is drawn but their drafts, so every figure that would count
    // them — the count, a day's, a resource's booked hours — says they are not counted, never 0.
    const uncounted = useMemo((): CalendarUncounted => {
        const kinds = value.events.filter(kind => data.capped.has(kind.key));
        return kinds.length === 0 ? NOTHING_UNCOUNTED : {
            names: kinds.map(kind => kind.name.toLocaleLowerCase(format.locale)), all: kinds.length === value.events.length,
            resources: new Set(kinds.flatMap(kind => kind.takes)),
        };
    }, [value.events, data.capped, format.locale]);
    // As the window read, the selection's read reports from a component of its own (#1343).
    const [selection, setSelection] = useState<CalendarSelection>(NO_SELECTION);
    const selectedItems = useMemo(() => selection.ok ? selection.value.map(event => event.item) : NO_ITEMS, [selection]);
    // What the drawn events were read over (#1398): the window, once read.
    const covered = current ? range : undefined;
    // The events drawn: the window's read — and, of a kind past the cap, which draws none of its events but its drafts
    // (#1424), the selected ones the window holds, read by their keys as the inspector reads them and drawn as its drafts
    // are: a pick of Search Records among them shows it where it is, selected and given the keyboard there (#1398).
    const items = useMemo(() => {
        if (covered === undefined) return NO_ITEMS;
        const picked = selectedItems.filter(item => data.capped.has(item.kind) && inWindow(item, covered.from, covered.to)
            && !data.items.some(held => stringEqual(eventKey(held), eventKey(item))));
        return picked.length === 0 ? data.items : chronological([...data.items, ...picked]);
    }, [covered, selectedItems, data.capped, data.items]);
    // The events drawn whose rows break their kind's bounds (#1585): each wears the warn ring, stored or changed, and a
    // stored one's breach is a warning beside the history's issues.
    const [breaches, setBreaches] = useState<CalendarBreaches>(NO_BREACHES);
    // The Backlog (#1424): every kind narrowed through its source a page at a time (`backlog-pages.ts`), through the source
    // with its start Unset — its choices but its window, so no step of the dates reads it again, and it never blinks — after
    // the events in hand: every other kind's, read apart once, whatever the dates.
    const windowedBacklog = useMemo(() => windowedBacklogKinds(value), [value]);
    const backlogParts = useMemo(() => dates.eventParts.filter(({ kind }) => windowedBacklog.has(kind.key)), [dates.eventParts, windowedBacklog]);
    const backlogNarrowing = useBacklogNarrowing(dates.eventParts);
    const backlog = data.apart.items;
    // The drafts as the shared reader gives them: those of events a kind's narrowing does not hold left out, so a draft
    // never brings another narrowing's event into the list.
    const drafts = data.cells?.drafts ?? editing?.drafts ?? NO_DRAFTS;
    // A drafted event's row as its session began from it: what tells the list whether a page lists the event.
    const original = editing?.held ?? NO_ORIGINAL;
    // What the list's pages have listed, kept across the lists the drafts make: what a card is — its Schedule, a drag of it,
    // the original a gesture placing it rewrites — never waits on a new list's pages being read.
    const [backlogServed] = useState(() => new BacklogServed());
    const backlogPages = useMemo(() => backlogParts.length === 0 || !data.apart.ready ? undefined
        : new CalendarBacklogPages(calendarLibraryId(storageKey, "backlog"), backlog, backlogParts, drafts, original, backlogServed),
    [backlogParts, data.apart.ready, storageKey, backlog, drafts, original, backlogServed]);
    // Where a gesture placing one of its events finds the original it rewrites.
    useLayoutEffect(() => { onBacklog?.(backlogPages); }, [backlogPages, onBacklog]);
    // What the paged Backlog counts, read in a component of its own: "…" until it is first read (CL13), the last count
    // standing while a narrowing's is read.
    const [backlogCount, setBacklogCount] = useState<BacklogPageCount | undefined>(undefined);
    const backlogRead = data.apart.ready;
    // What it shows stands in for a read in flight: retained (CL8), aria-disabled in a busy pane, until it lands.
    const backlogRetained = data.apart.loading;
    const reading = data.loading || data.apart.loading;
    // Every resource names an event's place — a paged kind's, those of its windows held (#1424), which a creation with no
    // resource may land on too; the ones the rail shows lay out the columns and rows, a paged kind's a window at a time
    // beside them (`pages`).
    const pagedWindows = pages?.windows;
    const pagedRows = useMemo(() => heldRows(pagedWindows), [pagedWindows]);
    // The paged kind's resources whose events are read, which alone a creation can find free: the cells reader's, where
    // it reads them; every one held, where the window's read reads the kind's events.
    const cellsDrawn = data.cells?.drawn;
    const commands = useMemo(() => editing === undefined ? undefined : calendarCommands(value, editing, select, items, shown, { rows: pagedRows, known: cellsDrawn }),
        [value, editing, select, items, shown, pagedRows, cellsDrawn]);
    // Held back only while what it shows is another view's (ruled 11 Nov 2026, `../shared/view-read.ts`): the last
    // choices' events standing in for new ones', a resource kind's narrowing resolving, a paged kind's last view standing
    // in for a new narrowing's (CL8) — no gesture until they land. A read again of the view shown — after a Save, or
    // another session's write — leaves it live: a gesture begins from the row its event was drawn from, and a Save never
    // stops the editing.
    const available = current && !data.filtering && data.error === undefined && data.apart.error === undefined && !resourcesBusy && pages?.stale !== true;
    // The app's optimiser (#1409, #1417): one run over the window in view, its result landed on the events as one
    // edit, and what it left on them until Apply — the landing and the highlight over the whole frame.
    const landing = useLanding(root);
    const landingStyles = useLandingStyles();
    const optimiseTypes = useMemo(() => calendarOptimiseTypes(value), [value]);
    const [optimised, setOptimised] = useState<CalendarOptimised | undefined>(undefined);
    const landAfter = useRef<(run: number) => void>(() => undefined);
    const latest = useRef({ items, backlog, editing, optimised });
    latest.current = { items, backlog, editing, optimised };
    const run = useOptimise<CalendarOptimiseRequest, CalendarOptimiseResult>({
        name: value.optimise.type === "some" ? value.optimise.value.name : null,
        requestType: optimiseTypes.request, resultType: optimiseTypes.result,
        scope: `${range.from.getTime()}:${range.to.getTime()}`, storageKey,
        onLanded: (result, request, n) => {
            const now = latest.current;
            if (now.editing === undefined) return undefined;
            const runText = format.number(n);
            const landed = landCalendarOptimise(value, now.editing, request, result, optimiseMessages.step({ run: runText }), now.items, now.backlog, runText, now.optimised);
            if (landed === undefined) return undefined;
            // A run that changed nothing leaves what earlier runs left (R10).
            if (landed.optimised !== undefined) { setOptimised(landed.optimised); landAfter.current(n); }
            return landed.counts;
        },
    });
    // The eye is listed only where the window can be optimised (ruled 25 Oct 2026): never read only; while its reads
    // are in flight it waits, disabled, in its place.
    const parts = useOptimiseParts<CalendarOptimiseRequest>({
        run, landing, period: periodName, readOnly: value.settings.readOnly || editing === undefined, busy: !available || reading,
        request: n => calendarOptimiseRequest(value, editing!, range, latest.current.items, latest.current.backlog, n), landKey: data.items,
    });
    landAfter.current = parts.landAfter;
    const locked = parts.locked;
    // What a run left on the events goes with the drafts (R17): once nothing is pending — Save, Discard — nothing is
    // marked. An Undo leaves nothing pending too, but its Redo brings the run's step back (R9): what the run left is
    // kept while that step is the next to redo.
    const pending = editing?.history.pending ?? 0;
    useEffect(() => {
        if (pending === 0 && editing?.history.redoOrigin !== "optimise") setOptimised(undefined);
    }, [pending, editing?.version, editing]);
    // While a run is out (R2) every gesture is refused, the session the views read kept.
    const gestures = !available ? undefined : locked && commands !== undefined ? lockCalendarCommands(commands, optimiseMessages.locked({ period: periodName })) : commands;
    const unassigned = useMemo(() => unassignedRow(value.vocabulary.unassigned), [value.vocabulary.unassigned]);
    const rows = useMemo(() => [...resourceRows(value.resources), ...pagedRows, unassigned], [value.resources, pagedRows, unassigned]);
    // The paged kind's Choosers search it by key (#1424, `chooser.tsx`), each resource named by a window held, else by its
    // own row read by its key (retest C6), and leave out what the kind's source of the slice hides, as the other Choosers
    // leave out what the rail hides.
    const chrome = dates.chrome;
    const chooser = useMemo((): CalendarChooser | undefined => {
        if (pagedValue === undefined || pagedKind === undefined) return undefined;
        const names = new Map(pagedRows.flatMap(row => row.resource.type === "some" ? [[row.resource.value.key, row.label] as const] : []));
        return { paged: pagedValue, unassigned: value.vocabulary.unassigned, noun: pagedKind.name.toLocaleLowerCase(format.locale), nameOf: key => names.get(key), part: sourcePart(chrome, pagedValue.kind) };
    }, [pagedValue, pagedKind, pagedRows, format.locale, chrome, value.vocabulary.unassigned]);
    const shownRows = useMemo(() => [...resourceRows(shown), unassigned], [shown, unassigned]);
    const overlaps = useMemo(() => scheduleOverlaps([items.filter(item => value.events.find(kind => kind.key === item.kind)?.overlaps.type === "warn")]), [items, value.events]);
    // Whether the overlaps chip shows (#1398): an overlap among what is drawn.
    const overlapsShown = overlaps.pairs.length > 0;
    // The templates the rail shows: the Templates tab's cards, and what a drop or a drawn event is made from.
    const templates = useMemo(() => templatesTab(value, followed, format), [value, followed, format]);
    const [pickedTemplate, setTemplate] = useState<string>();
    const activeTemplate = pickedTemplate !== undefined && templates.shown.has(pickedTemplate) ? pickedTemplate : templates.shown.keys().next().value;
    const start = useCalendarLibrary({ value, backlog, backlogRead, backlogRetained, backlogPages, backlogCount, selection: selectedItems, key: storageKey, narrow, now,
        day: dayStart(view.date), styles, commands: gestures, activeTemplate, onTemplate: setTemplate, templates, backlogNarrowing, followed, shown, rows,
        backlogFlash: optimised?.backlogChanged === true && landing.lit, locked });
    const end = useCalendarInspector({ value, refs, range, commands: gestures, styles, storageKey, overlaps, select, selection, shown });
    const { acted } = parts;
    // The history's acts: a field typed into lets go first, committing what it holds — the history's buttons take no
    // focus from it. Anything else keeps the focus, the board or an event on it, so the next key — a Redo after an
    // Undo — reaches the frame too, never the page.
    const onAction = useCallback((action: Parameters<ScheduleEditing["history"]["act"]>[0]) => {
        const active = document.activeElement; if (active instanceof HTMLElement && typedInto(active)) active.blur();
        // A run's highlight ends with Undo, Apply and Discard; a Redo of its step replays its landing (R9, R16).
        acted(action, editing?.history.redoOrigin);
        editing?.history.act(action);
    }, [editing, acted]);
    const displayRange = narrow ? (dates.windowParts.length > 0 ? range : calendarRange(view, value.settings)) : range;
    const standardRange = calendarRange(view, value.settings);
    const rangeLabel = displayRange.from.getTime() !== standardRange.from.getTime() || displayRange.to.getTime() !== standardRange.to.getTime()
        ? format.range(displayRange.from, new Date(displayRange.to.getTime() - 1)) : undefined;
    const navigationDate = view.date;
    // A step of the period, as Previous and Next take it (#1398): what `[` and `]` do from anywhere in the frame, as the
    // Roster's and the Allocation's do.
    const step = (by: -1 | 1) => onNavigate(navigate(view, by).date);
    const nouns = useMemo(() => calendarNouns(value, format.locale), [value, format.locale]);
    // Search Records (#1398): an event found by its key steps the view to its period, is selected and is brought into view;
    // a pick gives it the keyboard there, once the box has let it go and the window it is drawn in has landed — after a
    // step of the dates, that window: the element that stands for it where its ring is drawn takes the focus
    // (`event-focus.ts`). An event the views draw nowhere — one of the backlog — leaves the keyboard where it is, as does a
    // step through the matches. One its kind's choices hide, or — where the view lays resources out — whose resource its
    // resource kind's source hides, is shown by clearing just the choices that hide it, its window kept, and given the
    // keyboard once the narrowing they leave draws it (the shared hidden pick).
    // The event a pick gave the keyboard to: the first element of it drawn takes the focus, once. It waits only while the
    // event is the one selected, and until the viewer does something else (the root's captures below).
    const [focusAsk, setFocusAsk] = useState<{ readonly id: string }>();
    const focusTaken = useRef<object | undefined>(undefined);
    const eventFocus = useMemo((): EventFocus => ({
        id: focusAsk?.id,
        take: () => {
            if (focusAsk === undefined || focusTaken.current === focusAsk) return false;
            focusTaken.current = focusAsk;
            setFocusAsk(was => (was === focusAsk ? undefined : was));
            return true;
        },
    }), [focusAsk]);
    useEffect(() => {
        if (focusAsk !== undefined && !refs.some(ref => stringEqual(eventKey(ref), focusAsk.id))) setFocusAsk(undefined);
    }, [refs, focusAsk]);
    const dropFocus = focusAsk === undefined ? undefined : () => setFocusAsk(undefined);
    // The pick lands once the window its event is drawn in has landed, the event among what it draws.
    const hiddenPick = useHiddenPick<string>({
        onError: setError, uncleared: "The filters hiding the event could not be cleared",
        landing: { drawn: (id) => current && items.some(item => stringEqual(eventKey(item), id)), focus: (id) => setFocusAsk({ id }) },
    });
    const found = (event: FoundEvent) => {
        const ref = { kind: event.item.kind, key: event.item.key };
        hiddenPick.pick(event.hidden, eventKey(ref), () => {
            select([ref]);
            if (event.item.start.type !== "some") return false;
            onNavigate(dayStart(event.item.start.value).getTime());
            setReveal(ref);
            return true;
        });
    };
    // What each resource kind's source shows, where the Calendar follows it: the paged kind's, followed by none, is asked of e3.
    const resourcesShown = useMemo(() => new Map(value.resources.flatMap(kind => {
        const keys = followed.get(kind.key)?.shown.keys;
        return keys === undefined ? [] : [[kind.key, keys] as const];
    })), [value.resources, followed]);
    // Each resource kind's name as a line writes it: what an event stands on where the kind's source's page does not hold it.
    const resourceWords = useMemo(() => new Map(value.resources.map(kind => [kind.key, lowerWord(kind.name)] as const)), [value.resources]);
    const finder = useCalendarFind({ kinds: value.events, parts: dates.eventParts, editing, range, format: words, onPick: found, held: cellRows, picks,
        resourcesShown, laysResources, resourceWords });
    const search = useMemo(() => (finder === undefined ? undefined : hiddenPick.search(finder)), [finder, hiddenPick]);
    // The field an issue or a warning gone to names, asked of its event's form: it takes the keyboard as the form draws it,
    // and so comes into view (`../shared/schedule/field-ask.tsx`).
    const { asks: fieldAsks, request: askField } = useFieldAsks();
    // The window's own count: "…" while the period is read, never a count of another period's (#1398, CL13).
    const toolbar = useCalendarToolbar({ view, setView, resourcesWord: value.vocabulary.resources.other, layouts: dates.layouts, periods: dates.periods, onNavigate, navigationDate, rangeLabel, sunday: value.settings.weekStart.type === "sunday", now,
        count: current ? items.filter(item => inWindow(item, displayRange.from, displayRange.to)).length : undefined, uncounted,
        chrome: dates.chrome, affordances: dates.affordances, nouns, windowParts: dates.windowParts,
        onToday, search, optimise: parts.toolbarItem, locked,
        styles, words, commands, onAction, overlaps, overlapsShown, select: refs => { select(refs); setReveal(refs[0]); }, paged: value.events.some(kind => kind.entries.type === "some"),
        warnings: breaches.warnings, askField });
    // No drag source or target while a run is out (R2).
    const drag = useCalendarDrag({ value, key: storageKey, commands: locked ? undefined : gestures, narrow, items, backlog, served: backlogPages, selection: selectedItems, templates: templates.shown,
        activeTemplate, onError: setError });
    const clear = useCallback(() => setRefs([]), []);
    // The keyboard stays on the board as the events it was on go (retest C4): an event Delete takes away holding the focus,
    // the board takes it, never the page's body — where the history's keys, the Undo that brings the event back, go unheard.
    const keepOnBoard = (going: readonly CalendarItem[]) => {
        const board = main.current;
        const active = board?.ownerDocument.activeElement;
        if (board === null || !(active instanceof HTMLElement) || !board.contains(active)) return;
        const held = active.closest("[data-calendar-event], [data-calendar-card]");
        const id = held?.getAttribute("data-calendar-event") ?? held?.getAttribute("data-calendar-card") ?? undefined;
        if (id !== undefined && going.some(item => stringEqual(eventKey(item), id))) board.focus({ preventScroll: true });
    };
    // The selection a pick adds to or takes from, as last drawn: read as the pick runs, so the pick is the same function
    // while the selection moves, and an event, which calls it, draws again only as its own ring does (#1398, CL9).
    const picked = useRef(refs);
    picked.current = refs;
    const pick = useCallback((item: CalendarItem, additive = false) => {
        const ref = { kind: item.kind, key: item.key }; const id = eventKey(ref);
        const now = picked.current;
        select(additive ? now.some(was => eventKey(was) === id) ? now.filter(was => eventKey(was) !== id) : [...now, ref] : [ref]);
    }, [select]);
    // A new event whose made key another Save took goes on under the next its kind makes (#1583): what was selected of it
    // stays selected, under its new key — the inspector open on it still, before the frame is drawn without it.
    const renumbered = editing?.renumbered;
    useLayoutEffect(() => {
        if (renumbered === undefined || renumbered.size === 0) return;
        const now = picked.current;
        const next = now.map((ref): CalendarRef => {
            const to = renumbered.get(ref.kind)?.get(ref.key);
            return to === undefined ? ref : { kind: ref.kind, key: to };
        });
        // One moved is another object: the rest are the very refs held.
        if (next.some((ref, i) => !Object.is(ref, now[i]))) select(next);
    }, [renumbered, select]);
    // A followed source not yet resolved holds the frame's cold load, as an event kind's window does — and a paged kind's
    // first window.
    const cold = [...followed.values()].some(source => !source.shown.ready && source.error === undefined)
        || (pagedValue !== undefined && pages?.ready !== true);
    // What the footer's loading line says (#1398, CL3): the period being read, a followed source's new narrowing, or
    // why one could not be read, with Retry — the period's asking again each event kind's record, whether or not a
    // source of the slice narrows it.
    const retryWindow = useCallback(() => retryPeriod(value.events.map(kind => ({
        entries: kind.entries, part: dates.eventParts.find(event => event.kind.key === kind.key)?.part,
    }))), [value.events, dates.eventParts]);
    const failure = data.error ?? data.apart.error;
    // The cells of the paged kind's resources in view, read for the events placed on it where the view lays its resources
    // out (#1424): the wait that follows their windows, its rows washed until they land (retest C7) — said in the events'
    // noun, as the Plan's line says it (`Loading print job events…`), and main busy meanwhile.
    const cellsReading = data.cells?.reading === true;
    const cellsNoun = useMemo(() => {
        const kind = pagedValue === undefined ? undefined : value.events.find(event => event.takes.includes(pagedValue.kind));
        return kind === undefined ? undefined : `${kind.name.toLocaleLowerCase(format.locale)} events`;
    }, [pagedValue, value.events, format.locale]);
    // The period's reads first; else a paged kind's windows the view shows, in its own noun (`Loading presses 401–600`);
    // else the cells of its resources in view.
    const pagedNoun = pagedKind?.name.toLocaleLowerCase(format.locale);
    const pagedLine = pages?.line;
    const pagedRetry = pages?.retry;
    const line = useMemo(() => periodLoadingLine(periodLoading({ loading: reading, error: failure, retry: retryWindow },
        [...followed.values()].map(source => ({ noun: source.name, ready: source.shown.ready, loading: source.shown.busy && source.error === undefined,
            error: source.error, retry: source.retry }))), periodName)
        ?? (pagedNoun === undefined || pagedRetry === undefined ? undefined : pagedLoadingLine(pagedLine, pagedNoun, pagedLoadingMessages, format.number, pagedRetry))
        ?? (cellsReading && cellsNoun !== undefined ? pagedLoadingLine(CELLS_LOADING, cellsNoun, pagedLoadingMessages, format.number, retryWindow) : undefined),
    [reading, failure, retryWindow, followed, periodName, pagedNoun, pagedLine, pagedRetry, format.number, cellsReading, cellsNoun]);
    // What the views draw of the period (#1398): the period as read; one not read yet, its grid at once and its
    // placeholders, unseen until the frame's one reveal clock says so (CL4: `LoadingReveal` below, which the footer's line
    // and each placeholder read where they show, so its flip renders them and never this frame); or one whose read failed,
    // its grid and the failure said once (CL11) — never "Calendar unavailable" over the grid.
    const read = useMemo(() => periodRead({ current, error: data.error, name: periodName, retry: retryWindow }),
        [current, data.error, periodName, retryWindow]);
    // What stands in for other choices — an event kind's, a followed source's, a paged kind's new narrowing — is stale
    // (#1398, CL5): its words in the third ink, the grid's rules dashed, and nothing dragged or dropped until the new
    // choices' land. A read again of the view shown — a new revision — draws as it did, live.
    const stale = current && (data.filtering || [...followed.values()].some(source => source.shown.busy) || pages?.stale === true);
    // Whether the events carry their drag handles and edges (#1398, CL9): wherever the board takes edits — through a read
    // in flight too, whose retained content refuses the gesture itself (the shared drag sensors, inside the aria-disabled
    // main, CL8) while `gestures` are withheld — so an event draws the same through a read;
    // never while a run of the optimiser is out (R2), nor where the read failed and main takes the pointer for its Retry.
    const grips = editing !== undefined && !locked && read.state !== "failed";
    // The cold load's cover at the board's own pitch: an hour of its time grid (CL1).
    const pitch = view.layout === "timeline" || (view.layout === "calendar" && view.period === "month") ? undefined : calendarHour(value.settings.density);
    return <EventFocusContext.Provider value={eventFocus}><FieldAskProvider value={fieldAsks}>
        <Box ref={root} css={[styles.root, landingStyles.main]} data-calendar-frame="" data-calendar-readonly={value.settings.readOnly ? "" : undefined}
        {...landing.attributes} onPointerDownCapture={dropFocus} onKeyDownCapture={dropFocus}>
        {pagedValue !== undefined && pagedKind !== undefined
            && <CalendarPagesReader paged={pagedValue} name={pagedKind.name} icon={pagedKind.icon} demand={demand} onPages={setPages} />}
        {backlogPages !== undefined && <CalendarBacklogCountReader pages={backlogPages} onCount={setBacklogCount} />}
        {editing !== undefined && <CalendarBoundsReader kinds={value.events} items={items} editing={editing} onBreaches={setBreaches} />}
        <CalendarDataReader value={value} range={range} editing={editing} view={view}
            resources={cellResources} bucket={bucket} pages={pages} demand={pagedValue === undefined ? undefined : demand} onData={setData} />
        <CalendarSelectionReader value={value} refs={refs} range={range} commands={commands} held={cellRows} onSelection={setSelection} />
        <LoadingReveal waiting={line?.kind === "loading"}>
        <CalendarChooserContext.Provider value={chooser}>
        <BuilderFrame storageKey={`${storageKey}.frame`} label="Calendar" loading={(!data.ready && data.loading && data.error === undefined) || cold} loadingPitch={pitch}
            busy={reading || resourcesBusy || pages?.reading === true || cellsReading} liveFooter phonePanel toolbar={toolbar} start={start} end={end} panesRef={panes}
            onKeyDown={event => {
                // The keys, never while typing; each the Calendar acts on goes no further than the Calendar (#1398), so a
                // shortcut of the page around it on the same key — the showcase's `[`, which folds its sidebar — never hears
                // it. An Esc with nothing to let go of goes on as it came.
                if (event.defaultPrevented || typedInto(event.target)) return;
                const action = historyShortcut(event);
                if (action !== undefined && commands !== undefined && !locked) { takeKey(event); onAction(action); }
                else if (event.key === "[" || event.key === "]") { takeKey(event); step(event.key === "[" ? -1 : 1); }
                else if (event.key === "Escape" && (refs.length > 0 || error !== undefined)) { takeKey(event); setRefs([]); setError(undefined); }
                else if ((event.key === "Delete" || event.key === "Backspace") && gestures !== undefined && selectedItems.length > 0) { takeKey(event); keepOnBoard(selectedItems); gestures.remove(selectedItems); }
            }} rootProps={CLICK_FOCUS} banners={<>
                {parts.banner}
                {editing?.sessions.map(held => <SessionBanners key={held.key} session={held.session} words={words} name={value.events.find(kind => kind.key === held.kind)?.name}
                    where={issue => scheduleIssueName(editing, held.kind, issue.entry)} onAction={action => editing.history.actOn(held.key, action)} />)}
                {[...followed].flatMap(([source, followedSource]) => followedSource.error === undefined ? [] : [
                    <BannerView key={source} status="error" title={`${followedSource.name.charAt(0).toLocaleUpperCase(format.locale)}${followedSource.name.slice(1)} unavailable`} description={followedSource.error}
                        actions={<Button size="xs" variant="outline" onClick={followedSource.retry}>Retry</Button>} />])}
                {dates.error !== undefined && <BannerView status="error" title="Dates unavailable" description={dates.error} />}
                {/* A kind past the cap (#1424): how many of its events the window holds, and where they show. */}
                {(data.cells?.notices ?? []).map(notice => {
                    const said = noticeWords(notice, format);
                    return <Box key={`cells:${notice.kind}`} data-calendar-banner="cells" data-calendar-kind={notice.kind}>
                        <BannerView status="info" title={said.title} description={said.hint} />
                    </Box>;
                })}
                {/* A gesture's error; a read's is said once, in the grid and on the footer's line (#1398, CL11). */}
                {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
            </>}
            footer={<CalendarFooter styles={styles} kinds={value.events} parts={dates.eventParts} locale={format.locale} line={parts.line ?? line} elara={parts.legend} />}>
            {/* The period read now's grid, whatever the read: what it holds of the period is `items` and `read` (#1398, CL5). While
                it stands in for another view — other choices of the period, a period not read yet — what it shows is retained
                (CL8): readable, focusable and selectable, aria-disabled, every editing gesture off (`gestures`); read again as it
                stands, it is live. A failed period's main is not retained: its Retry is in it. */}
            {/* The board: the keyboard's surface and its anchor, but not a tab stop (retest C4), as the Plan's body is — a click
                on a part of it that holds nothing focusable puts the keyboard here, in the Calendar, where `[` and `]` step
                its period, and an event Delete takes away leaves it here. */}
            <Box ref={main} css={styles.main} data-calendar-main="" tabIndex={-1} aria-disabled={!available && read.state !== "failed" ? true : undefined} data-calendar-stale={stale ? "" : undefined}
                data-calendar-narrow={narrow ? "" : undefined}>
                <CalendarViews format={format} value={value} view={view} setView={setView} range={narrow ? displayRange : range} items={items}
                    rows={rows} shownRows={shownRows} shown={shown} now={now} narrow={narrow} styles={styles} read={read}
                    uncounted={uncounted} shading={data.cells?.shading} bucket={bucket} pages={pages} demand={demand} drawnRows={data.cells?.drawn}
                    selected={selected} select={pick} clear={clear} overlaps={overlaps} commands={gestures} drag={drag}
                    nowRevision={nowAsked} anchor={anchor} onAnchor={onAnchor} reveal={reveal === undefined ? undefined : eventKey(reveal)} onRevealed={revealed}
                    onOpen={value.inspector ? openDetails : undefined} optimised={optimised} lit={landing.lit} editing={editing} bounded={breaches.bounded} grips={grips} />
            </Box>
        </BuilderFrame>
        </CalendarChooserContext.Provider>
        </LoadingReveal>
    </Box></FieldAskProvider></EventFocusContext.Provider>;
}
/** Calendar in its own shared frame, with the same renderer for read-only views. */
export function EastChakraCalendar({ value, storageKey }: EastChakraCalendarProps) {
    const key = `${storageKey}.${value.id.type === "some" ? value.id.value : "calendar"}`;
    const now = useNow(value.settings.now.type === "some" ? value.settings.now.value : undefined);
    const dates = useCalendarWindow(value, key, now);
    const { locale } = useFormatters();
    // The sources the Calendar follows itself, each read once (one component each, so their hooks keep their order).
    const sources = useMemo(() => followedSources(value), [value]);
    const nouns = useMemo(() => new Map(Object.entries(calendarNouns(value, locale))), [value, locale]);
    // The sources the hidden pick asks of, by the kind's slot: each event kind's — its choices but the range the Calendar's
    // navigation writes, which hides no event — and each resource kind's narrowed through its source of the slice, the paged
    // kind's among them.
    const chrome = dates.chrome;
    const hiddenSources = useMemo((): HiddenSource[] => [
        ...dates.eventParts.map(({ kind, part }) => ({ key: kind.key, part, window: part.config.range.type === "some" ? part.config.range.value : undefined })),
        ...value.resources.flatMap((kind): HiddenSource[] => {
            const part = sourcePart(chrome, kind.key);
            return part === undefined ? [] : [{ key: kind.key, part }];
        }),
    ], [dates.eventParts, value.resources, chrome]);
    // And each one's hidden pick, read through its source (one component each, as the sources are).
    return <FollowSources chrome={chrome} narrowed={value.narrowed} sources={sources} nouns={nouns} said={calendarSaid}>
        {followed => <HideSources name="Calendar" sources={hiddenSources}>
            {picks => value.settings.readOnly ? <CalendarFrame value={value} storageKey={key} dates={dates} now={now} followed={followed} picks={picks} />
                : <EditableCalendar value={value} storageKey={key} dates={dates} now={now} followed={followed} picks={picks} />}
        </HideSources>}
    </FollowSources>;
}
implementUIComponent(CalendarComponent, EastChakraCalendar);
