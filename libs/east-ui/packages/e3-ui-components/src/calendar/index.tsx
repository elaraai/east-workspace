/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** e3-ui's Calendar renderer; BuilderFrame stays an internal React detail. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { CalendarComponent } from "@elaraai/e3-ui/internal";
import { BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useFormatters, usePersistedState } from "@elaraai/east-ui-components";
import { useScheduleEditing, type ScheduleEditing } from "../shared/schedule/editing.js";
import { scheduleOverlaps } from "../shared/schedule/overlaps.js";
import { useNow } from "../shared/time/now-line.js";
import { calendarCommands } from "./actions.js";
import { useCalendarData, useCalendarSlice } from "./data.js";
import { useCalendarDrag } from "./drag.js";
import { useCalendarInspector, useCalendarSelection } from "./inspector.js";
import { templateSources, useCalendarLibrary } from "./library.js";
import { useCalendarToolbar } from "./toolbar.js";
import { timelineRange } from "./timeline.js";
import { CalendarViews } from "./views.js";
import { calendarRange, dayStart, eventKey, inWindow, NARROW_WIDTH, type CalendarItem, type CalendarRef, type CalendarStyles, type CalendarValue, type CalendarView } from "./model.js";

export type { CalendarValue } from "./model.js";
/** Props of the Calendar extension renderer. */
export interface EastChakraCalendarProps { value: CalendarValue; storageKey: string }
interface HostProps extends EastChakraCalendarProps {
    view: CalendarView; setView: (next: CalendarView) => void; now: Date;
    range: ReturnType<typeof calendarRange>; editing?: ScheduleEditing;
}
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];

/** The sole editable wrapper: read-only Calendar never creates a record session. */
function EditableCalendar(props: Omit<HostProps, "editing">) {
    const editing = useScheduleEditing({ kinds: props.value.events, storageKey: props.storageKey, joined: NO_JOINED, applyMode: "batch", range: props.range });
    return <CalendarFrame {...props} editing={editing} />;
}
function CalendarFrame(props: HostProps) {
    const { value, storageKey, view, range, editing, now } = props;
    const visible = useRef<ReturnType<typeof calendarRange> | undefined>(undefined);
    const [shownRange, setShownRange] = useState<ReturnType<typeof calendarRange> | undefined>();
    const setView = (next: CalendarView) => {
        const middle = visible.current;
        props.setView(view.layout === "timeline" && middle !== undefined && next.date === view.date && (next.layout !== view.layout || next.period !== view.period)
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
    const [narrow, setNarrow] = useState(false);
    useLayoutEffect(() => {
        const element = main.current; if (element === null) return;
        const measure = () => { const width = element.getBoundingClientRect().width; if (width > 0) setNarrow(width < NARROW_WIDTH); };
        measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
    }, []);
    const [refs, setRefs] = useState<CalendarRef[]>([]);
    const [error, setError] = useState<string>();
    const [reveal, setReveal] = useState<CalendarRef>();
    const select = useCallback((next: CalendarRef[]) => {
        setRefs(next); if (value.onSelect.type === "some") for (const ref of next) value.onSelect.value(ref);
    }, [value.onSelect]);
    const selected = useMemo(() => new Set(refs.map(ref => eventKey(ref))), [refs]);
    const data = useCalendarData(value, range, editing);
    useEffect(() => {
        if (reveal === undefined || main.current === null) return;
        const key = CSS.escape(eventKey(reveal));
        const element = main.current.querySelector<HTMLElement>(`[data-calendar-event="${key}"], [data-calendar-card="${key}"]`);
        if (element === null) return;
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        main.current.closest("[data-builder-frame]")?.querySelector<HTMLButtonElement>('button[aria-label="Expand Inspector"]')?.click();
        setReveal(undefined);
    }, [reveal, data.items, view, narrow]);
    const commands = useMemo(() => editing === undefined ? undefined : calendarCommands(value, editing, select, data.items), [value, editing, select, data.items]);
    const { slice, items, resources: rows } = useCalendarSlice(value, data.items, `${storageKey}.slice`, now);
    const selection = useCalendarSelection({ value, refs, range, commands });
    const selectedItems = selection.ok ? selection.value.map(event => event.item) : [];
    const overlaps = useMemo(() => scheduleOverlaps([items.filter(item => value.events.find(kind => kind.key === item.kind)?.overlaps.type === "warn")]), [items, value.events]);
    const [pickedTemplate, setTemplate] = useState<string>();
    const sources = templateSources(value);
    const activeTemplate = pickedTemplate !== undefined && sources.has(pickedTemplate) ? pickedTemplate : sources.keys().next().value;
    const start = useCalendarLibrary({ value, backlog: data.backlog, selection: selectedItems, key: storageKey, narrow, now, day: dayStart(view.date), styles, commands, activeTemplate, onTemplate: setTemplate });
    const end = useCalendarInspector({ value, refs, range, commands, styles, storageKey, overlaps, select, selection });
    const onAction = useCallback((action: Parameters<ScheduleEditing["history"]["act"]>[0]) => {
        const active = document.activeElement; if (active instanceof HTMLElement) active.blur();
        editing?.history.act(action);
    }, [editing]);
    const displayRange = narrow ? calendarRange(view, value.settings) : view.layout === "timeline" ? shownRange ?? range : range;
    const toolbar = useCalendarToolbar({ view, setView, range: displayRange, now, count: items.filter(item => inWindow(item, displayRange.from, displayRange.to)).length, slice, styles, words, commands, onAction, overlaps, select: refs => { select(refs); setReveal(refs[0]); }, paged: value.events.some(kind => kind.entries.type === "some") });
    const drag = useCalendarDrag({ value, key: storageKey, commands, narrow, items: data.items, backlog: data.backlog, selection: selectedItems, activeTemplate, onError: setError });
    const pick = useCallback((item: CalendarItem, additive = false) => {
        const ref = { kind: item.kind, key: item.key }; const id = eventKey(ref);
        select(additive ? selected.has(id) ? refs.filter(ref => eventKey(ref) !== id) : [...refs, ref] : [ref]);
    }, [select, selected, refs]);
    return <Box css={styles.root} data-calendar-frame="" data-calendar-readonly={value.settings.readOnly ? "" : undefined}>
        <BuilderFrame storageKey={`${storageKey}.frame`} label="Calendar" toolbar={toolbar} start={start} end={end}
            onKeyDown={event => {
                if (event.defaultPrevented || typedInto(event.target)) return;
                const action = historyShortcut(event);
                if (action !== undefined && commands !== undefined) { event.preventDefault(); onAction(action); }
                else if (event.key === "Escape") { setRefs([]); setError(undefined); }
                else if ((event.key === "Delete" || event.key === "Backspace") && commands !== undefined && selectedItems.length > 0) { event.preventDefault(); commands.remove(selectedItems); }
            }} banners={<>
                {editing?.sessions.map(held => <SessionBanners key={held.key} session={held.session} words={words} name={value.events.find(kind => kind.key === held.kind)?.name}
                    onAction={action => editing.history.actOn(held.key, action)} />)}
                {(error ?? data.error) !== undefined && <Box role="alert" css={styles.error}>{error ?? data.error}</Box>}
            </>}
            footer={<Box css={styles.footer} data-calendar-footer=""><span>{items.filter(item => inWindow(item, displayRange.from, displayRange.to)).length} events in view{value.events.some(kind => kind.entries.type === "some") ? " · loaded window" : ""}</span>
                <span>{data.backlog.length} in backlog</span>{data.saved !== undefined && <span>Last saved {format.time(data.saved)}</span>}{editing !== undefined && <span>{editing.history.pending} pending</span>}{data.loading && <span>Loading…</span>}</Box>}>
            <Box ref={main} css={styles.main} data-calendar-main="" data-calendar-narrow={narrow ? "" : undefined}>
                <CalendarViews format={format} value={value} view={view} setView={setView} range={narrow ? displayRange : range} visibleRange={displayRange} onVisible={showRange} items={items} rows={rows} now={now} narrow={narrow} styles={styles}
                    selected={selected} select={pick} clear={() => setRefs([])} overlaps={overlaps} commands={commands} drag={drag} />
            </Box>
        </BuilderFrame>
    </Box>;
}
/** Calendar in its own shared frame, with the same renderer for read-only views. */
export function EastChakraCalendar({ value, storageKey }: EastChakraCalendarProps) {
    const key = `${storageKey}.${value.id.type === "some" ? value.id.value : "calendar"}`;
    const now = useNow(value.settings.now.type === "some" ? value.settings.now.value : undefined);
    const { state: view, setState: setView } = usePersistedState<CalendarView>(`${key}.view`, {
        layout: value.settings.layout.type, period: value.settings.period.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : now).getTime(),
    });
    const range = useMemo(() => view.layout === "timeline" ? timelineRange(view) : calendarRange(view, value.settings), [view, value.settings]);
    const props = { value, storageKey: key, view, setView, range, now };
    return value.settings.readOnly ? <CalendarFrame {...props} /> : <EditableCalendar {...props} />;
}
implementUIComponent(CalendarComponent, EastChakraCalendar);
