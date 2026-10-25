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
 * Its Search Records seeks each event kind's record by key (`find.ts`): a pick
 * steps to its event's period, selects it and brings it into view. Each
 * layout's view keeps its place across a step and a remount — the time grid's
 * hour, the timeline's line — and Today brings the time grid to the now line.
 *
 * The timeline continues what it shows (#1398): its view nearing an end of its
 * window, the window moves on along a fixed grid (`timeline.ts`), and every
 * route that moves its dates — Prev/Next, Today, a date picked, a pick of
 * Search Records, a period — moves it as its scroll does (ruled 25 Oct 2026).
 * The next window the way it went is read ahead once the one shown lands, so it
 * is normally read already; until a window lands the held read stands in: its
 * events at their real dates where they cover the view, in the lanes the period
 * they were drawn at gave them, so every row keeps its height, and its booked
 * hours, overlaps and Backlog, stale and retained, only the days it does not
 * cover washed. A grid keeps its own rule: a step of a time or month grid, or
 * of the agenda, to a period not read yet — or a layout changed — draws none
 * of the old period's events, whose columns are another period's days.
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
 * `SCHEDULE_EVENT_CAP` over the window, none is read or drawn but its drafts. A
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
 * by key through its own paged read, and an event names its resource by the
 * windows held, else by the resource's key.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { SortedMap, StringType, compareFor, equalFor, none, some } from "@elaraai/east";
import { CalendarComponent } from "@elaraai/e3-ui/internal";
import type { RecordTile } from "@elaraai/east-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, optimiseMessages, typedInto, useContainerBelow, useFormatters, usePersistedState,
    useLanding, useLandingStyles, useTrackedEvaluation, type Formatters,
} from "@elaraai/east-ui-components";
import { LoadingReveal, PAGED_LIBRARY_PAGE } from "@elaraai/east-ui-components/internal";
import { useOptimise } from "../shared/func/use-optimise.js";
import { useOptimiseParts } from "../shared/func/optimise-parts.js";
import { pagedLoadingLine, pagedLoadingMessages, periodLoading, periodLoadingLine, periodRead, retryPeriod } from "../shared/loading.js";
import type { ScheduleCellNotice, ScheduleCellResources } from "../shared/schedule/cells.js";
import { useScheduleEditing, type ScheduleEditing, type ScheduleEventDraftsValue, type ScheduleHeldRows, type ScheduleRowRead } from "../shared/schedule/editing.js";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import { scheduleOverlaps } from "../shared/schedule/overlaps.js";
import { useNow } from "../shared/time/now-line.js";
import { calendarCommands } from "./actions.js";
import { CalendarBacklogPages, type BacklogPageCount } from "./backlog-pages.js";
import type { CalendarBucket } from "./cells.js";
import { CalendarDataReader, initialCalendarData, resourceRows, windowedBacklogKinds, type CalendarDataState } from "./data.js";
import { CalendarChooserContext, type CalendarChooser } from "./chooser.js";
import { useCalendarDrag } from "./drag.js";
import { useCalendarFind, type FoundEvent } from "./find.js";
import { CalendarFooter } from "./footer.js";
import { CalendarPagesReader, createPagedDemand, type CalendarPages } from "./pages.js";
import { CalendarSelectionReader, NO_SELECTION, useCalendarInspector, type CalendarSelection } from "./inspector.js";
import { calendarLibraryId, templatesTab, useCalendarLibrary } from "./library.js";
import {
    calendarOptimiseRequest, calendarOptimiseTypes, landCalendarOptimise, lockCalendarCommands,
    type CalendarOptimiseRequest, type CalendarOptimiseResult, type CalendarOptimised,
} from "./optimise.js";
import { useBacklogNarrowing } from "../shared/schedule/backlog.js";
import { calendarNouns, calendarSaid, followedSources } from "./sources.js";
import { useCalendarToolbar } from "./toolbar.js";
import { useCalendarWindow, type CalendarWindow } from "./window.js";
import { createTravel, createVisibleDays, useOverlapsShown } from "./visible.js";
import { CalendarViews, calendarHour, type CalendarAnchor } from "./views.js";
import {
    NOTHING_UNCOUNTED, calendarRange, dayStart, eventKey, inWindow, NARROW_WIDTH, periodWords,
    type CalendarItem, type CalendarRange, type CalendarRef, type CalendarRow, type CalendarStyles, type CalendarUncounted, type CalendarValue,
    type CalendarView,
} from "./model.js";

export type { CalendarValue } from "./model.js";
/** Props of the Calendar extension renderer. */
export interface EastChakraCalendarProps { value: CalendarValue; storageKey: string }
interface HostProps extends EastChakraCalendarProps {
    /** The date window and the slice's event sources (`useCalendarWindow`). */
    dates: CalendarWindow; now: Date;
    /** The sources the Calendar follows beside its event kinds': what each shows. */
    followed: FollowedSources;
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
/** The row an event with no resource sits on. */
const UNASSIGNED: CalendarRow = { key: "", label: "Unassigned", meta: "", group: "", resource: none };
/** No resource kind laid out: a view with no resource axis shades no resource (#1424). */
const NO_CELL_RESOURCES: readonly ScheduleCellResources[] = [];
/** A summary's tile the timeline shades a resource's row at, as the toolbar names the period (#1424). */
const PERIOD_NAMES: Partial<Record<RecordTile, string>> = { day: "Day", week: "Week", month: "Month" };
/** No resource of a paged kind held. */
const NO_ROWS: readonly CalendarRow[] = [];

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

/** The sole editable wrapper: read-only Calendar never creates a record session. */
function EditableCalendar(props: Omit<HostProps, "editing" | "onHeld" | "onBacklog">) {
    const { value } = props;
    // Each event kind's Save notice counts what leaves its own source's narrowing.
    const recordSlices = useMemo(() => props.dates.eventParts.map(({ part }) => part), [props.dates.eventParts]);
    // The rows a kind read by its cells holds (#1424): where a gesture finds one of its events, as the frame's reader hands them on.
    const [held, setHeld] = useState<ScheduleHeldRows | undefined>(undefined);
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
    const editing = useScheduleEditing({ kinds: value.events, storageKey: props.storageKey, joined: NO_JOINED, applyMode: "batch", range: props.dates.range,
        recordSlices, held, reads });
    return <CalendarFrame {...props} editing={editing} onHeld={setHeld} onBacklog={onBacklog} />;
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
    const { value, storageKey, editing, now, followed, dates, onHeld, onBacklog } = props;
    const { view, range } = dates;
    // What the timeline shows: exactly, for a change of layout or period to keep its centre; and in whole days, in a store
    // of its own, read only by what says them — so its scroll draws nothing of the frame (#1398, CL9).
    const visible = useRef<ReturnType<typeof calendarRange> | undefined>(undefined);
    const [visibleDays] = useState(createVisibleDays);
    // Which way the timeline's view travels along time (#1398): set as it scrolls, and as a step moves its dates the way
    // the step goes — Prev/Next, Today, a date picked, a pick of Search Records — read by the window's read alone, which
    // once the window shown has landed reads ahead the next window of its grid that way (CL7, ruled 25 Oct 2026). A
    // layout or a period places the view, which has travelled nowhere since.
    const [travel] = useState(createTravel);
    const [navigationRevision, setNavigationRevision] = useState(0);
    const onNavigate = (date: number) => {
        const from = visibleDays.get()?.center ?? view.date;
        travel.set(date > from ? 1 : date < from ? -1 : 0);
        dates.setView({ ...view, date }); setNavigationRevision(before => before + 1);
    };
    const setView = (next: CalendarView) => {
        travel.set(0);
        const middle = visible.current;
        dates.setView(view.layout === "timeline" && middle !== undefined && next.date === view.date && (next.layout !== view.layout || next.period !== view.period)
            ? { ...next, date: dayStart((middle.from.getTime() + middle.to.getTime()) / 2).getTime() } : next);
    };
    const showRange = useCallback((next: ReturnType<typeof calendarRange>) => {
        visible.current = next;
        visibleDays.show(next);
    }, [visibleDays]);
    const recipe = useSlotRecipe({ key: "calendar" });
    const styles = useMemo(() => recipe({}) as unknown as CalendarStyles, [recipe]);
    const format = useFormatters(); const words = useMemo(() => ({ ...format, m: editingMessages }), [format]);
    const root = useRef<HTMLDivElement>(null);
    const main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    // The timeline's days, date and count are read from its store by what says them; every other layout's are its window's.
    const timeline = !narrow && view.layout === "timeline";
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
    // window lands, it reads ahead what a step goes to (#1398, CL7): the periods either side, or on the timeline the next
    // window of its grid the way its view last moved — its scroll's way, or a step's.
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
    // The period shown has landed when the held read is of the window read now (#1398): a grid's step to a period not read
    // yet holds none of the old period's events, which never show under its labels (CL5); a newer read of the same period
    // keeps them meanwhile, as the timeline's continuations do.
    const current = data.ready && sameRange(data.range, range);
    // What the held read was drawn on (#1398): the timeline at a period, or a grid. On the timeline every route that moves
    // the dates continues it, as its scroll does (ruled 25 Oct 2026) — a re-centre, Prev/Next, Today, a date picked, a
    // pick of Search Records, a period: its events stay drawn, stale, at their real dates where they cover the view, its
    // rows laid out at the period it was drawn at, and only the days it does not cover washed, until the window lands. A
    // grid's columns are another period's days: a grid, or a layout changed, draws none of it.
    const drawnOn = useRef<{ readonly timeline: boolean; readonly period: CalendarView["period"] } | undefined>(undefined);
    const lastDrawn = drawnOn.current;
    if (current && (lastDrawn === undefined || lastDrawn.timeline !== timeline || lastDrawn.period !== view.period)) drawnOn.current = { timeline, period: view.period };
    const heldOn = drawnOn.current;
    const continuing = timeline && !current && data.ready && heldOn?.timeline === true;
    const drawn = current || continuing;
    // The period the drawn events' lanes are laid out at: the held read's while it continues, so every row keeps its height.
    const lanesPeriod = continuing && heldOn !== undefined ? heldOn.period : view.period;
    // A re-centre continues what the timeline shows, as every step of it does.
    const onRecentre = (next: CalendarView) => { dates.setView(next); };
    // An event shown as asked: brought into view, the inspector opened on it. One drawn already is shown at once; one the
    // timeline has not drawn — a row out of its view, a time out of its span — tells the frame once it brings it in.
    const revealed = useCallback((element: HTMLElement) => {
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        element.closest("[data-builder-frame]")?.querySelector<HTMLButtonElement>('button[aria-label="Expand Inspector"]')?.click();
        setReveal(undefined);
    }, []);
    useEffect(() => {
        if (reveal === undefined || main.current === null) return;
        const key = CSS.escape(eventKey(reveal));
        const element = main.current.querySelector<HTMLElement>(`[data-calendar-event="${key}"], [data-calendar-card="${key}"]`);
        if (element !== null) revealed(element);
    }, [reveal, data.items, view, narrow, revealed]);
    // Today pressed (#1398): the time grid brings the now line into view.
    const [nowAsked, setNowAsked] = useState(0);
    const onToday = useCallback(() => setNowAsked(n => n + 1), []);
    // Where each layout's view rests (#1398): saved under the Calendar's key, so a layout comes back to it as it mounts.
    const { state: anchor, setState: setAnchor } = usePersistedState<CalendarAnchor>(`${storageKey}.anchor`, NO_ANCHOR);
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
    const items = drawn ? data.items : NO_ITEMS;
    // What the drawn events were read over (#1398): the window once read; the held read's, while a continuation's window is read.
    const covered = current ? range : continuing ? data.range : undefined;
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
    const backlogPages = useMemo(() => backlogParts.length === 0 || !data.apart.ready ? undefined
        : new CalendarBacklogPages(calendarLibraryId(storageKey, "backlog"), backlog, backlogParts, drafts, original),
    [backlogParts, data.apart.ready, storageKey, backlog, drafts, original]);
    // Where a gesture placing one of its events finds the original it rewrites.
    useLayoutEffect(() => { onBacklog?.(backlogPages); }, [backlogPages, onBacklog]);
    // What the paged Backlog counts, read in a component of its own: "…" until it is first read (CL13), the last count
    // standing while a narrowing's is read.
    const [backlogCount, setBacklogCount] = useState<BacklogPageCount | undefined>(undefined);
    const backlogRead = data.apart.ready;
    // What it shows stands in for a read in flight: retained (CL8), aria-disabled in a busy pane, until it lands.
    const backlogRetained = data.apart.loading;
    const reading = data.loading || data.apart.loading;
    const commands = useMemo(() => editing === undefined ? undefined : calendarCommands(value, editing, select, items, shown), [value, editing, select, items, shown]);
    // A paged kind's last view standing in for a new narrowing's is retained (CL8): no gesture until its windows land.
    const available = current && !reading && data.error === undefined && data.apart.error === undefined && !resourcesBusy && pages?.stale !== true;
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
        run, landing, period: periodName, readOnly: value.settings.readOnly || editing === undefined, busy: !available,
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
    // Every resource names an event's place — a paged kind's, those of its windows held; the ones the rail shows lay out
    // the columns and rows, a paged kind's a window at a time beside them (`pages`).
    const pagedWindows = pages?.windows;
    const rows = useMemo(() => [...resourceRows(value.resources), ...heldRows(pagedWindows), UNASSIGNED], [value.resources, pagedWindows]);
    // The paged kind's Choosers search it by key (#1424, `chooser.tsx`), each resource named by a window held, else by its key.
    const chooser = useMemo((): CalendarChooser | undefined => {
        if (pagedValue === undefined || pagedKind === undefined) return undefined;
        const names = new Map(heldRows(pagedWindows).flatMap(row => row.resource.type === "some" ? [[row.resource.value.key, row.label] as const] : []));
        return { paged: pagedValue, noun: pagedKind.name.toLocaleLowerCase(format.locale), nameOf: key => names.get(key) ?? key };
    }, [pagedValue, pagedKind, pagedWindows, format.locale]);
    const shownRows = useMemo(() => [...resourceRows(shown), UNASSIGNED], [shown]);
    // As the window read, the selection's read reports from a component of its own (#1343).
    const [selection, setSelection] = useState<CalendarSelection>(NO_SELECTION);
    const selectedItems = useMemo(() => selection.ok ? selection.value.map(event => event.item) : NO_ITEMS, [selection]);
    const overlaps = useMemo(() => scheduleOverlaps([items.filter(item => value.events.find(kind => kind.key === item.kind)?.overlaps.type === "warn")]), [items, value.events]);
    // Whether the overlaps chip shows (#1398): an overlap among what is drawn — on the timeline, one in the days it shows,
    // which the frame hears only as it turns, never as a day is crossed.
    const overlapsShown = useOverlapsShown(overlaps, timeline ? visibleDays : undefined, covered, range);
    // The templates the rail shows: the Templates tab's cards, and what a drop or a drawn event is made from.
    const templates = useMemo(() => templatesTab(value, followed, format), [value, followed, format]);
    const [pickedTemplate, setTemplate] = useState<string>();
    const activeTemplate = pickedTemplate !== undefined && templates.shown.has(pickedTemplate) ? pickedTemplate : templates.shown.keys().next().value;
    const start = useCalendarLibrary({ value, backlog, backlogRead, backlogRetained, backlogPages, backlogCount, selection: selectedItems, key: storageKey, narrow, now,
        day: dayStart(view.date), styles, commands: gestures, activeTemplate, onTemplate: setTemplate, templates, backlogNarrowing, followed, shown,
        backlogFlash: optimised?.backlogChanged === true && landing.lit, locked });
    const end = useCalendarInspector({ value, refs, range, commands: gestures, styles, storageKey, overlaps, visible: timeline ? visibleDays : undefined, select, selection, shown });
    const { acted } = parts;
    const onAction = useCallback((action: Parameters<ScheduleEditing["history"]["act"]>[0]) => {
        const active = document.activeElement; if (active instanceof HTMLElement) active.blur();
        // A run's highlight ends with Undo, Apply and Discard; a Redo of its step replays its landing (R9, R16).
        acted(action, editing?.history.redoOrigin);
        editing?.history.act(action);
    }, [editing, acted]);
    const displayRange = narrow ? (dates.windowParts.length > 0 ? range : calendarRange(view, value.settings)) : range;
    const standardRange = calendarRange(view, value.settings);
    const rangeLabel = timeline || displayRange.from.getTime() !== standardRange.from.getTime() || displayRange.to.getTime() !== standardRange.to.getTime()
        ? format.range(displayRange.from, new Date(displayRange.to.getTime() - 1)) : undefined;
    const navigationDate = view.date;
    const nouns = useMemo(() => calendarNouns(value, format.locale), [value, format.locale]);
    // Search Records (#1398): an event found by its key steps the view to its period, is selected and is brought into view.
    const found = (event: FoundEvent) => {
        const ref = { kind: event.item.kind, key: event.item.key };
        select([ref]);
        if (event.item.start.type !== "some") return;
        onNavigate(dayStart(event.item.start.value).getTime());
        setReveal(ref);
    };
    const search = useCalendarFind({ kinds: value.events, parts: dates.eventParts, editing, range, format, onPick: found, held: cellRows });
    // The window's own count: "…" while the period is read, never a count of another period's (#1398, CL13).
    const toolbar = useCalendarToolbar({ view, setView, onNavigate, navigationDate, rangeLabel, sunday: value.settings.weekStart.type === "sunday", range: displayRange, now,
        count: current ? items.filter(item => inWindow(item, displayRange.from, displayRange.to)).length : undefined, uncounted,
        chrome: dates.chrome, affordances: dates.affordances, nouns, windowParts: dates.windowParts,
        ...(timeline ? { visible: visibleDays, events: { items, covered } } : {}), onToday, search, optimise: parts.toolbarItem, locked,
        styles, words, commands, onAction, overlaps, overlapsShown, select: refs => { select(refs); setReveal(refs[0]); }, paged: value.events.some(kind => kind.entries.type === "some") });
    // No drag source or target while a run is out (R2).
    const drag = useCalendarDrag({ value, key: storageKey, commands: locked ? undefined : gestures, narrow, items, backlog, served: backlogPages, selection: selectedItems, templates: templates.shown,
        activeTemplate, onError: setError });
    const clear = useCallback(() => setRefs([]), []);
    const pick = useCallback((item: CalendarItem, additive = false) => {
        const ref = { kind: item.kind, key: item.key }; const id = eventKey(ref);
        select(additive ? selected.has(id) ? refs.filter(ref => eventKey(ref) !== id) : [...refs, ref] : [ref]);
    }, [select, selected, refs]);
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
    // The period's reads first; else a paged kind's windows the view shows, in its own noun (`Loading presses 401–600`).
    const pagedNoun = pagedKind?.name.toLocaleLowerCase(format.locale);
    const pagedLine = pages?.line;
    const pagedRetry = pages?.retry;
    const line = useMemo(() => periodLoadingLine(periodLoading({ loading: reading, error: failure, retry: retryWindow },
        [...followed.values()].map(source => ({ noun: source.name, ready: source.shown.ready, loading: source.shown.busy && source.error === undefined,
            error: source.error, retry: source.retry }))), periodName)
        ?? (pagedNoun === undefined || pagedRetry === undefined ? undefined : pagedLoadingLine(pagedLine, pagedNoun, pagedLoadingMessages, format.number, pagedRetry)),
    [reading, failure, retryWindow, followed, periodName, pagedNoun, pagedLine, pagedRetry, format.number]);
    // What the views draw of the period (#1398): the period as read — or a continuation's window, the held read standing in;
    // one not read yet, its grid at once and its placeholders, unseen until the frame's one reveal clock says so (CL4:
    // `LoadingReveal` below, which the footer's line and each placeholder read where they show, so its flip renders them
    // and never this frame); or one whose read failed, its grid and the failure said once (CL11) — never "Calendar
    // unavailable" over the grid. A continuation's window whose read failed says so as a period's does, the held read's
    // events kept drawn.
    const read = useMemo(() => periodRead({ current: current || (continuing && data.error === undefined), error: data.error, name: periodName, retry: retryWindow }),
        [current, continuing, data.error, periodName, retryWindow]);
    // A newer read of what is shown — a narrowing, a revision, a continuation's window, a paged kind's new narrowing — keeps
    // its events, stale (#1398, CL5): their words in the third ink, the grid's rules dashed, and nothing dragged or dropped
    // until it lands.
    const stale = drawn && (reading || [...followed.values()].some(source => source.shown.busy) || pages?.stale === true);
    // The cold load's cover at the board's own pitch: an hour of its time grid (CL1).
    const pitch = view.layout === "timeline" || (view.layout === "calendar" && view.period === "month") ? undefined : calendarHour(value.settings.density);
    return <Box ref={root} css={[styles.root, landingStyles.main]} data-calendar-frame="" data-calendar-readonly={value.settings.readOnly ? "" : undefined} {...landing.attributes}>
        {pagedValue !== undefined && pagedKind !== undefined
            && <CalendarPagesReader paged={pagedValue} name={pagedKind.name} icon={pagedKind.icon} demand={demand} onPages={setPages} />}
        {backlogPages !== undefined && <CalendarBacklogCountReader pages={backlogPages} onCount={setBacklogCount} />}
        <CalendarDataReader value={value} range={range} editing={editing} view={view} travel={timeline ? travel : undefined}
            resources={cellResources} bucket={bucket} pages={pages} demand={pagedValue === undefined ? undefined : demand} onData={setData} />
        {/* The selection is read where its events are drawn: the held read, while a continuation's window is read. */}
        <CalendarSelectionReader value={value} refs={refs} range={continuing ? data.range : range} commands={commands} held={cellRows} onSelection={setSelection} />
        <LoadingReveal waiting={line?.kind === "loading"}>
        <CalendarChooserContext.Provider value={chooser}>
        <BuilderFrame storageKey={`${storageKey}.frame`} label="Calendar" loading={(!data.ready && data.loading && data.error === undefined) || cold} loadingPitch={pitch}
            busy={reading || resourcesBusy || pages?.reading === true} liveFooter toolbar={toolbar} start={start} end={end}
            onKeyDown={event => {
                if (event.defaultPrevented || typedInto(event.target)) return;
                const action = historyShortcut(event);
                if (action !== undefined && commands !== undefined && !locked) { event.preventDefault(); onAction(action); }
                else if (event.key === "Escape") { setRefs([]); setError(undefined); }
                else if ((event.key === "Delete" || event.key === "Backspace") && gestures !== undefined && selectedItems.length > 0) { event.preventDefault(); gestures.remove(selectedItems); }
            }} banners={<>
                {parts.banner}
                {editing?.sessions.map(held => <SessionBanners key={held.key} session={held.session} words={words} name={value.events.find(kind => kind.key === held.kind)?.name}
                    onAction={action => editing.history.actOn(held.key, action)} />)}
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
                it is read, what it shows is retained (CL8): readable, focusable and selectable, aria-disabled, every editing
                gesture off (`gestures`). A failed period's main is not: its Retry is in it. */}
            <Box ref={main} css={styles.main} data-calendar-main="" aria-disabled={!available && read.state !== "failed" ? true : undefined} data-calendar-stale={stale ? "" : undefined}
                data-calendar-narrow={narrow ? "" : undefined}>
                <CalendarViews navigationRevision={navigationRevision} format={format} value={value} view={view} setView={setView} range={narrow ? displayRange : range} visible={visibleDays} onVisible={showRange} items={items}
                    rows={rows} shownRows={shownRows} shown={shown} now={now} narrow={narrow} styles={styles} read={read} covered={covered} lanesPeriod={lanesPeriod} onRecentre={onRecentre} travel={travel}
                    uncounted={uncounted} shading={data.cells?.shading} bucket={bucket} pages={pages} demand={demand} drawnRows={data.cells?.drawn}
                    selected={selected} select={pick} clear={clear} overlaps={overlaps} commands={gestures} drag={drag}
                    nowRevision={nowAsked} anchor={anchor} onAnchor={onAnchor} reveal={reveal === undefined ? undefined : eventKey(reveal)} onRevealed={revealed}
                    optimised={optimised} lit={landing.lit} />
            </Box>
        </BuilderFrame>
        </CalendarChooserContext.Provider>
        </LoadingReveal>
    </Box>;
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
    return <FollowSources chrome={dates.chrome} narrowed={value.narrowed} sources={sources} nouns={nouns} said={calendarSaid}>
        {followed => value.settings.readOnly ? <CalendarFrame value={value} storageKey={key} dates={dates} now={now} followed={followed} />
            : <EditableCalendar value={value} storageKey={key} dates={dates} now={now} followed={followed} />}
    </FollowSources>;
}
implementUIComponent(CalendarComponent, EastChakraCalendar);
