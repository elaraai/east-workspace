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
 * Only its cold load is covered, at its time grid's hour (CL1, CL5): a step to
 * a period not read yet draws that period's grid at once — never the old
 * period's events under its labels — its regions washed and its counts
 * placeholders; one whose read failed keeps its grid and says so once (CL11).
 * Its Search Records seeks each event kind's record by key (`find.ts`): a pick
 * steps to its event's period, selects it and brings it into view. Each
 * layout's view keeps its place across a step and a remount — the time grid's
 * hour, the timeline's line — and Today brings the time grid to the now line.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { none } from "@elaraai/east";
import { CalendarComponent } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useContainerBelow, useFormatters, usePersistedState,
} from "@elaraai/east-ui-components";
import { LoadingReveal } from "@elaraai/east-ui-components/internal";
import { periodLoading, periodLoadingLine, periodRead, retryPeriod } from "../shared/loading.js";
import { useScheduleEditing, type ScheduleEditing } from "../shared/schedule/editing.js";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import { scheduleOverlaps } from "../shared/schedule/overlaps.js";
import { useNow } from "../shared/time/now-line.js";
import { calendarCommands } from "./actions.js";
import { CalendarDataReader, initialCalendarData, resourceRows, type CalendarDataState } from "./data.js";
import { useCalendarDrag } from "./drag.js";
import { useCalendarFind, type FoundEvent } from "./find.js";
import { CalendarFooter } from "./footer.js";
import { CalendarSelectionReader, NO_SELECTION, useCalendarInspector, type CalendarSelection } from "./inspector.js";
import { templatesTab, useCalendarLibrary } from "./library.js";
import { useBacklogNarrowing } from "../shared/schedule/backlog.js";
import { calendarNouns, calendarSaid, followedSources } from "./sources.js";
import { useCalendarToolbar } from "./toolbar.js";
import { useCalendarWindow, type CalendarWindow } from "./window.js";
import { createVisibleDays } from "./visible.js";
import { CalendarViews, calendarHour, type CalendarAnchor } from "./views.js";
import { calendarAhead, calendarRange, dayStart, eventKey, inWindow, NARROW_WIDTH, periodWords, type CalendarItem, type CalendarRef, type CalendarRow, type CalendarStyles, type CalendarValue, type CalendarView } from "./model.js";

export type { CalendarValue } from "./model.js";
/** Props of the Calendar extension renderer. */
export interface EastChakraCalendarProps { value: CalendarValue; storageKey: string }
interface HostProps extends EastChakraCalendarProps {
    /** The date window and the slice's event sources (`useCalendarWindow`). */
    dates: CalendarWindow; now: Date;
    /** The sources the Calendar follows beside its event kinds': what each shows. */
    followed: FollowedSources;
    editing?: ScheduleEditing;
}
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];
const NO_ITEMS: CalendarItem[] = [];
/** No layout's view has rested anywhere yet. */
const NO_ANCHOR: CalendarAnchor = {};
/** The row an event with no resource sits on. */
const UNASSIGNED: CalendarRow = { key: "", label: "Unassigned", meta: "", group: "", resource: none };

/** The sole editable wrapper: read-only Calendar never creates a record session. */
function EditableCalendar(props: Omit<HostProps, "editing">) {
    // Each event kind's Save notice counts what leaves its own source's narrowing.
    const recordSlices = useMemo(() => props.dates.eventParts.map(({ part }) => part), [props.dates.eventParts]);
    const editing = useScheduleEditing({ kinds: props.value.events, storageKey: props.storageKey, joined: NO_JOINED, applyMode: "batch", range: props.dates.range, recordSlices });
    return <CalendarFrame {...props} editing={editing} />;
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
    const { value, storageKey, editing, now, followed, dates } = props;
    const { view, range } = dates;
    // What the timeline shows: exactly, for a change of layout or period to keep its centre; and in whole days, in a store
    // of its own, read only by what says them — so its scroll draws nothing of the frame (#1398, CL9).
    const visible = useRef<ReturnType<typeof calendarRange> | undefined>(undefined);
    const [visibleDays] = useState(createVisibleDays);
    const [navigationRevision, setNavigationRevision] = useState(0);
    const onNavigate = (date: number) => { dates.setView({ ...view, date }); setNavigationRevision(before => before + 1); };
    const setView = (next: CalendarView) => {
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
    const main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const [refs, setRefs] = useState<CalendarRef[]>([]);
    const [error, setError] = useState<string>();
    const [reveal, setReveal] = useState<CalendarRef>();
    const select = useCallback((next: CalendarRef[]) => {
        setRefs(next); if (value.onSelect.type === "some") for (const ref of next) value.onSelect.value(ref);
    }, [value.onSelect]);
    const selected = useMemo(() => new Set(refs.map(ref => eventKey(ref))), [refs]);
    // The window read reports from a component of its own, so a search landing re-renders it alone (#1343); once the
    // window lands, it reads the periods either side ahead (#1398, CL7).
    const [data, setData] = useState<CalendarDataState>(() => initialCalendarData(range));
    const ahead = useMemo(() => calendarAhead(view, value.settings), [view, value.settings]);
    // The period shown has landed when the held read is of the window read now (#1398): a step to a period not read yet
    // holds none of the old period's events, which never show under its labels (CL5); a newer read of the same period
    // keeps them meanwhile.
    const current = data.ready && data.range.from.getTime() === range.from.getTime() && data.range.to.getTime() === range.to.getTime();
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
    const items = current ? data.items : NO_ITEMS;
    const backlog = current ? data.backlog : NO_ITEMS;
    const commands = useMemo(() => editing === undefined ? undefined : calendarCommands(value, editing, select, items, shown), [value, editing, select, items, shown]);
    const available = current && !data.loading && data.error === undefined && !resourcesBusy;
    const gestures = available ? commands : undefined;
    // Every resource names an event's place; the ones the rail shows lay out the columns and rows.
    const rows = useMemo(() => [...resourceRows(value.resources), UNASSIGNED], [value.resources]);
    const shownRows = useMemo(() => [...resourceRows(shown), UNASSIGNED], [shown]);
    // As the window read, the selection's read reports from a component of its own (#1343).
    const [selection, setSelection] = useState<CalendarSelection>(NO_SELECTION);
    const selectedItems = useMemo(() => selection.ok ? selection.value.map(event => event.item) : NO_ITEMS, [selection]);
    const overlaps = useMemo(() => scheduleOverlaps([items.filter(item => value.events.find(kind => kind.key === item.kind)?.overlaps.type === "warn")]), [items, value.events]);
    // The templates the rail shows: the Templates tab's cards, and what a drop or a drawn event is made from.
    const templates = useMemo(() => templatesTab(value, followed, format), [value, followed, format]);
    const [pickedTemplate, setTemplate] = useState<string>();
    const activeTemplate = pickedTemplate !== undefined && templates.shown.has(pickedTemplate) ? pickedTemplate : templates.shown.keys().next().value;
    const backlogNarrowing = useBacklogNarrowing(dates.eventParts);
    const start = useCalendarLibrary({ value, backlog, backlogRead: current, selection: selectedItems, key: storageKey, narrow, now, day: dayStart(view.date), styles, commands: gestures,
        activeTemplate, onTemplate: setTemplate, templates, backlogNarrowing, followed, shown });
    const end = useCalendarInspector({ value, refs, range, commands: gestures, styles, storageKey, overlaps, select, selection, shown });
    const onAction = useCallback((action: Parameters<ScheduleEditing["history"]["act"]>[0]) => {
        const active = document.activeElement; if (active instanceof HTMLElement) active.blur();
        editing?.history.act(action);
    }, [editing]);
    // The timeline's days, date and count are read from its store by what says them; every other layout's are its window's.
    const timeline = !narrow && view.layout === "timeline";
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
    const search = useCalendarFind({ kinds: value.events, parts: dates.eventParts, editing, range, format, onPick: found });
    // The window's own count: "…" while the period is read, never a count of another period's (#1398, CL13).
    const toolbar = useCalendarToolbar({ view, setView, onNavigate, navigationDate, rangeLabel, sunday: value.settings.weekStart.type === "sunday", range: displayRange, now,
        count: current ? items.filter(item => inWindow(item, displayRange.from, displayRange.to)).length : undefined, chrome: dates.chrome, affordances: dates.affordances, nouns, windowParts: dates.windowParts,
        ...(timeline ? { visible: visibleDays, events: { items, ready: current } } : {}), onToday, search,
        styles, words, commands, onAction, overlaps, select: refs => { select(refs); setReveal(refs[0]); }, paged: value.events.some(kind => kind.entries.type === "some") });
    const drag = useCalendarDrag({ value, key: storageKey, commands: gestures, narrow, items, backlog, selection: selectedItems, templates: templates.shown, activeTemplate, onError: setError });
    const clear = useCallback(() => setRefs([]), []);
    const pick = useCallback((item: CalendarItem, additive = false) => {
        const ref = { kind: item.kind, key: item.key }; const id = eventKey(ref);
        select(additive ? selected.has(id) ? refs.filter(ref => eventKey(ref) !== id) : [...refs, ref] : [ref]);
    }, [select, selected, refs]);
    // A followed source not yet resolved holds the frame's cold load, as an event kind's window does.
    const cold = [...followed.values()].some(source => !source.shown.ready && source.error === undefined);
    // What the footer's loading line says (#1398, CL3): the period being read, a followed source's new narrowing, or
    // why one could not be read, with Retry — the period's asking again each event kind's record, whether or not a
    // source of the slice narrows it.
    const retryWindow = useCallback(() => retryPeriod(value.events.map(kind => ({
        entries: kind.entries, part: dates.eventParts.find(event => event.kind.key === kind.key)?.part,
    }))), [value.events, dates.eventParts]);
    const periodName = periodWords(view, range, value.settings, format);
    const line = useMemo(() => periodLoadingLine(periodLoading({ loading: data.loading, error: data.error, retry: retryWindow },
        [...followed.values()].map(source => ({ noun: source.name, ready: source.shown.ready, loading: source.shown.busy && source.error === undefined,
            error: source.error, retry: source.retry }))), periodName), [data.loading, data.error, retryWindow, followed, periodName]);
    // What the views draw of the period (#1398): the period as read; one not read yet, its grid at once and its
    // placeholders, unseen until the frame's one reveal clock says so (CL4: `LoadingReveal` below, which the footer's line
    // and each placeholder read where they show, so its flip renders them and never this frame); or one whose read failed,
    // its grid and the failure said once (CL11) — never "Calendar unavailable" over the grid.
    const read = useMemo(() => periodRead({ current, error: data.error, name: periodName, retry: retryWindow }),
        [current, data.error, periodName, retryWindow]);
    // A newer read of the period shown — a narrowing, a revision — keeps its events, stale (#1398, CL5): their words in the
    // third ink, the grid's rules dashed, and nothing dragged or dropped until it lands.
    const stale = current && (data.loading || [...followed.values()].some(source => source.shown.busy));
    // The cold load's cover at the board's own pitch: an hour of its time grid (CL1).
    const pitch = view.layout === "timeline" || (view.layout === "calendar" && view.period === "month") ? undefined : calendarHour(value.settings.density);
    return <Box css={styles.root} data-calendar-frame="" data-calendar-readonly={value.settings.readOnly ? "" : undefined}>
        <CalendarDataReader value={value} range={range} editing={editing} ahead={ahead} onData={setData} />
        <CalendarSelectionReader value={value} refs={refs} range={range} commands={commands} onSelection={setSelection} />
        <LoadingReveal waiting={line?.kind === "loading"}>
        <BuilderFrame storageKey={`${storageKey}.frame`} label="Calendar" loading={(!data.ready && data.loading && data.error === undefined) || cold} loadingPitch={pitch}
            busy={data.loading || resourcesBusy} liveFooter toolbar={toolbar} start={start} end={end}
            onKeyDown={event => {
                if (event.defaultPrevented || typedInto(event.target)) return;
                const action = historyShortcut(event);
                if (action !== undefined && commands !== undefined) { event.preventDefault(); onAction(action); }
                else if (event.key === "Escape") { setRefs([]); setError(undefined); }
                else if ((event.key === "Delete" || event.key === "Backspace") && gestures !== undefined && selectedItems.length > 0) { event.preventDefault(); gestures.remove(selectedItems); }
            }} banners={<>
                {editing?.sessions.map(held => <SessionBanners key={held.key} session={held.session} words={words} name={value.events.find(kind => kind.key === held.kind)?.name}
                    onAction={action => editing.history.actOn(held.key, action)} />)}
                {[...followed].flatMap(([source, followedSource]) => followedSource.error === undefined ? [] : [
                    <BannerView key={source} status="error" title={`${followedSource.name.charAt(0).toLocaleUpperCase(format.locale)}${followedSource.name.slice(1)} unavailable`} description={followedSource.error}
                        actions={<Button size="xs" variant="outline" onClick={followedSource.retry}>Retry</Button>} />])}
                {dates.error !== undefined && <BannerView status="error" title="Dates unavailable" description={dates.error} />}
                {/* A gesture's error; a read's is said once, in the grid and on the footer's line (#1398, CL11). */}
                {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
            </>}
            footer={<CalendarFooter styles={styles} kinds={value.events} parts={dates.eventParts} locale={format.locale} line={line} />}>
            {/* The period read now's grid, whatever the read: what it holds of the period is `items` and `read` (#1398, CL5). While
                it is read, what it shows is retained (CL8): readable, focusable and selectable, aria-disabled, every editing
                gesture off (`gestures`). A failed period's main is not: its Retry is in it. */}
            <Box ref={main} css={styles.main} data-calendar-main="" aria-disabled={!available && read.state !== "failed" ? true : undefined} data-calendar-stale={stale ? "" : undefined}
                data-calendar-narrow={narrow ? "" : undefined}>
                <CalendarViews navigationRevision={navigationRevision} format={format} value={value} view={view} setView={setView} range={narrow ? displayRange : range} visible={visibleDays} onVisible={showRange} items={items}
                    rows={rows} shownRows={shownRows} shown={shown} now={now} narrow={narrow} styles={styles} read={read}
                    selected={selected} select={pick} clear={clear} overlaps={overlaps} commands={gestures} drag={drag}
                    nowRevision={nowAsked} anchor={anchor} onAnchor={onAnchor} reveal={reveal === undefined ? undefined : eventKey(reveal)} onRevealed={revealed} />
            </Box>
        </BuilderFrame>
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
