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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusDisplay } from "../components/StatusDisplay.js";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { none } from "@elaraai/east";
import { CalendarComponent } from "@elaraai/e3-ui/internal";
import { BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useContainerBelow, useFormatters } from "@elaraai/east-ui-components";
import { periodLoading, periodLoadingLine, retryPeriod } from "../shared/loading.js";
import { useScheduleEditing, type ScheduleEditing } from "../shared/schedule/editing.js";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import { scheduleOverlaps } from "../shared/schedule/overlaps.js";
import { useNow } from "../shared/time/now-line.js";
import { calendarCommands } from "./actions.js";
import { CalendarDataReader, initialCalendarData, resourceRows, type CalendarDataState } from "./data.js";
import { useCalendarDrag } from "./drag.js";
import { CalendarFooter } from "./footer.js";
import { CalendarSelectionReader, NO_SELECTION, useCalendarInspector, type CalendarSelection } from "./inspector.js";
import { templatesTab, useCalendarLibrary } from "./library.js";
import { useBacklogNarrowing } from "../shared/schedule/backlog.js";
import { calendarNouns, calendarSaid, followedSources } from "./sources.js";
import { useCalendarToolbar } from "./toolbar.js";
import { useCalendarWindow, type CalendarWindow } from "./window.js";
import { CalendarViews } from "./views.js";
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
    const visible = useRef<ReturnType<typeof calendarRange> | undefined>(undefined);
    const [shownRange, setShownRange] = useState<ReturnType<typeof calendarRange> | undefined>();
    const [navigationRevision, setNavigationRevision] = useState(0);
    const onNavigate = (date: number) => { dates.setView({ ...view, date }); setNavigationRevision(before => before + 1); };
    const setView = (next: CalendarView) => {
        const middle = visible.current;
        dates.setView(view.layout === "timeline" && middle !== undefined && next.date === view.date && (next.layout !== view.layout || next.period !== view.period)
            ? { ...next, date: dayStart((middle.from.getTime() + middle.to.getTime()) / 2).getTime() } : next);
    };
    const showRange = useCallback((next: ReturnType<typeof calendarRange>) => {
        visible.current = next;
        setShownRange(before => before?.from.getTime() === next.from.getTime() && before.to.getTime() === next.to.getTime() ? before : next);
    }, []);
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
    useEffect(() => {
        if (reveal === undefined || main.current === null) return;
        const key = CSS.escape(eventKey(reveal));
        const element = main.current.querySelector<HTMLElement>(`[data-calendar-event="${key}"], [data-calendar-card="${key}"]`);
        if (element === null) return;
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        main.current.closest("[data-builder-frame]")?.querySelector<HTMLButtonElement>('button[aria-label="Expand Inspector"]')?.click();
        setReveal(undefined);
    }, [reveal, data.items, view, narrow]);
    // Each resource kind's rows its source shows: the columns, the timeline's rows and the Choosers (#1343).
    const shown = useMemo(() => value.resources.map(kind => {
        const keys = followed.get(kind.key)?.shown.keys;
        return keys === undefined || keys.type === "none" ? kind : { ...kind, rows: kind.rows.filter(row => keys.value.has(row.key)) };
    }), [value.resources, followed]);
    const resourcesBusy = value.resources.some(kind => followed.get(kind.key)?.shown.busy === true);
    const commands = useMemo(() => editing === undefined ? undefined : calendarCommands(value, editing, select, data.items, shown), [value, editing, select, data.items, shown]);
    const available = !data.loading && data.error === undefined && !resourcesBusy;
    const gestures = available ? commands : undefined;
    const items = data.items;
    // Every resource names an event's place; the ones the rail shows lay out the columns and rows.
    const rows = useMemo(() => [...resourceRows(value.resources), UNASSIGNED], [value.resources]);
    const shownRows = useMemo(() => [...resourceRows(shown), UNASSIGNED], [shown]);
    // As the window read, the selection's read reports from a component of its own (#1343).
    const [selection, setSelection] = useState<CalendarSelection>(NO_SELECTION);
    const selectedItems = selection.ok ? selection.value.map(event => event.item) : [];
    const overlaps = useMemo(() => scheduleOverlaps([items.filter(item => value.events.find(kind => kind.key === item.kind)?.overlaps.type === "warn")]), [items, value.events]);
    // The templates the rail shows: the Templates tab's cards, and what a drop or a drawn event is made from.
    const templates = useMemo(() => templatesTab(value, followed, format), [value, followed, format]);
    const [pickedTemplate, setTemplate] = useState<string>();
    const activeTemplate = pickedTemplate !== undefined && templates.shown.has(pickedTemplate) ? pickedTemplate : templates.shown.keys().next().value;
    const backlogNarrowing = useBacklogNarrowing(dates.eventParts);
    const start = useCalendarLibrary({ value, backlog: data.backlog, selection: selectedItems, key: storageKey, narrow, now, day: dayStart(view.date), styles, commands: gestures,
        activeTemplate, onTemplate: setTemplate, templates, backlogNarrowing, followed, shown });
    const end = useCalendarInspector({ value, refs, range, commands: gestures, styles, storageKey, overlaps, select, selection, shown });
    const onAction = useCallback((action: Parameters<ScheduleEditing["history"]["act"]>[0]) => {
        const active = document.activeElement; if (active instanceof HTMLElement) active.blur();
        editing?.history.act(action);
    }, [editing]);
    const displayRange = narrow ? (dates.windowParts.length > 0 ? range : calendarRange(view, value.settings)) : view.layout === "timeline" ? shownRange ?? range : range;
    const standardRange = calendarRange(view, value.settings);
    const rangeLabel = view.layout === "timeline" || displayRange.from.getTime() !== standardRange.from.getTime() || displayRange.to.getTime() !== standardRange.to.getTime()
        ? format.range(displayRange.from, new Date(displayRange.to.getTime() - 1)) : undefined;
    const navigationDate = !narrow && view.layout === "timeline" && shownRange !== undefined ? dayStart((shownRange.from.getTime() + shownRange.to.getTime()) / 2).getTime() : view.date;
    const nouns = useMemo(() => calendarNouns(value, format.locale), [value, format.locale]);
    const toolbar = useCalendarToolbar({ view, setView, onNavigate, navigationDate, rangeLabel, sunday: value.settings.weekStart.type === "sunday", range: displayRange, now,
        count: items.filter(item => inWindow(item, displayRange.from, displayRange.to)).length, chrome: dates.chrome, affordances: dates.affordances, nouns, windowParts: dates.windowParts,
        styles, words, commands, onAction, overlaps, select: refs => { select(refs); setReveal(refs[0]); }, paged: value.events.some(kind => kind.entries.type === "some") });
    const drag = useCalendarDrag({ value, key: storageKey, commands: gestures, narrow, items: data.items, backlog: data.backlog, selection: selectedItems, templates: templates.shown, activeTemplate, onError: setError });
    const pick = useCallback((item: CalendarItem, additive = false) => {
        const ref = { kind: item.kind, key: item.key }; const id = eventKey(ref);
        select(additive ? selected.has(id) ? refs.filter(ref => eventKey(ref) !== id) : [...refs, ref] : [ref]);
    }, [select, selected, refs]);
    // A followed source not yet resolved holds the frame's cold load, as an event kind's window does.
    const cold = [...followed.values()].some(source => !source.shown.ready && source.error === undefined);
    // What the footer's loading line says (#1398, CL3): the period being read, a followed source's new narrowing, or
    // why one could not be read, with Retry — the period's asking again each event kind's record.
    const retryWindow = useCallback(() => retryPeriod(dates.eventParts.map(({ kind, part }) => ({ entries: kind.entries, part }))), [dates.eventParts]);
    const periodName = periodWords(view, range, value.settings, format);
    const line = useMemo(() => periodLoadingLine(periodLoading({ loading: data.loading, error: data.error, retry: retryWindow },
        [...followed.values()].map(source => ({ noun: source.name, ready: source.shown.ready, loading: source.shown.busy && source.error === undefined,
            error: source.error, retry: source.retry }))), periodName), [data.loading, data.error, retryWindow, followed, periodName]);
    return <Box css={styles.root} data-calendar-frame="" data-calendar-readonly={value.settings.readOnly ? "" : undefined}>
        <CalendarDataReader value={value} range={range} editing={editing} ahead={ahead} onData={setData} />
        <CalendarSelectionReader value={value} refs={refs} range={range} commands={commands} onSelection={setSelection} />
        <BuilderFrame storageKey={`${storageKey}.frame`} label="Calendar" loading={(!data.ready && data.loading && data.error === undefined) || cold}
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
                {(error ?? data.error) !== undefined && <Box role="alert" css={styles.error}>{error ?? data.error}</Box>}
            </>}
            footer={<CalendarFooter styles={styles} kinds={value.events} parts={dates.eventParts} locale={format.locale} line={line} />}>
            <Box ref={main} css={styles.main} data-calendar-main="" inert={!available ? true : undefined} data-calendar-narrow={narrow ? "" : undefined}>
                {!data.ready && data.error !== undefined ? <StatusDisplay variant="error" title="Calendar unavailable" message={data.error} /> : <CalendarViews navigationRevision={navigationRevision} format={format} value={value} view={view} setView={setView} range={available ? narrow ? displayRange : range : data.range} visibleRange={available ? displayRange : data.range} onVisible={showRange} items={items}
                    rows={rows} shownRows={shownRows} shown={shown} now={now} narrow={narrow} styles={styles}
                    selected={selected} select={pick} clear={() => setRefs([])} overlaps={overlaps} commands={gestures} drag={drag} />}
            </Box>
        </BuilderFrame>
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
