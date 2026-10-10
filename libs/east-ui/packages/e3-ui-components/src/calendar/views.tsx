/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The mock's desktop views and the non-draggable narrow agenda. */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Box, Button, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { none } from "@elaraai/east";
import { useDragEventChip, useDragEventEdge, useDropCell, type CellCoord, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import { NowChip, NowLine } from "../shared/time/now-line.js";
import { drawSpan } from "../shared/time/drag.js";
import { timeScale } from "../shared/time/scale.js";
import { packLanes } from "../shared/time/lanes.js";
import { shadeBands } from "../shared/time/shading.js";
import type { ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import { shiftedScroll, timelinePixels, timelineRange, timelineVisible } from "./timeline.js";
import { EventActions } from "./controls.js";
import { calendarCoord, type CalendarDrag } from "./drag.js";
import type { CalendarCommands, CalendarPlacement } from "./actions.js";
import { DAY, QUARTER, chronological, dateText, dayStart, eventKey, inWindow, onResource,
    type CalendarItem, type CalendarRange, type CalendarRow, type CalendarStyles, type CalendarValue, type CalendarView } from "./model.js";

/** The views share selection, commands, drafts and overlap state. */
export interface CalendarViewsProps {
    value: CalendarValue; view: CalendarView; setView: (view: CalendarView) => void; range: CalendarRange; visibleRange: CalendarRange; format: Formatters;
    onVisible: (range: CalendarRange) => void; items: readonly CalendarItem[]; rows: readonly CalendarRow[]; now: Date; narrow: boolean; styles: CalendarStyles;
    selected: ReadonlySet<string>; select: (item: CalendarItem, additive?: boolean) => void; clear: () => void;
    overlaps: ScheduleOverlaps<CalendarItem>; commands: CalendarCommands | undefined; drag: CalendarDrag;
}
const HOURS = Array.from({ length: 24 }, (_, i) => i);
function resourceLabel(item: CalendarItem, rows: readonly CalendarRow[]): string { return rows.find(row => onResource(item, row))?.label ?? "Unassigned"; }

/** Booked time is measured within the labelled view, including overnight events only once. */
function booked(items: readonly CalendarItem[], row: CalendarRow, from: Date, to: Date): number {
    return items.reduce((hours, item) => item.start.type === "some" && item.end.type === "some" && onResource(item, row)
        ? hours + Math.max(0, Math.min(item.end.value.getTime(), to.getTime()) - Math.max(item.start.value.getTime(), from.getTime())) / 3_600_000 : hours, 0);
}

/** The same full event facts, in a card, a block, a month chip or a timeline bar. */
function EventBlock({ item, props, geometry, along = "y", chip = false, window }: { item: CalendarItem; props: CalendarViewsProps; geometry?: CSSProperties; along?: "x" | "y"; chip?: boolean; window?: { from: Date; to: Date } }) {
    const { styles, drag, selected, overlaps, commands } = props;
    const id = eventKey(item);
    const start = item.start.type === "some" ? item.start.value : props.range.from;
    const coord = { ...calendarCoord(drag.surface, start, props.view.layout === "calendar" ? none : item.resource), event: id } as Required<CellCoord>;
    const enabled = drag.enabled && commands?.editing.available(item.kind) === true;
    const handle = useDragEventChip(enabled ? coord : null, item.title, !enabled, item.title);
    const block = useRef<HTMLDivElement>(null);
    const dragRef = handle?.ref;
    const attachEvent = useCallback((element: HTMLDivElement | null) => { block.current = element; dragRef?.(element); }, [dragRef]);
    const title = useRef<HTMLDivElement>(null);
    const time = useRef<HTMLDivElement>(null);
    const resource = useRef<HTMLDivElement>(null);
    const [fits, setFits] = useState({ title: true, time: false, resource: false, icon: true, wrap: false, compact: chip || along === "x" });
    const kind = props.value.events.find(kind => kind.key === item.kind);
    const continued = window !== undefined && item.start.type === "some" && item.start.value < window.from;
    // Measure whole secondary lines. Hidden measurement spans never change the event's geometry.
    useLayoutEffect(() => {
        const element = block.current; if (element === null) return;
        const measure = () => {
            const width = element.clientWidth - 12;
            const height = element.clientHeight;
            const inline = chip || along === "x" || height < 36;
            const next = { title: width >= (inline ? 26 : 46) && height >= (chip ? 18 : 22),
                icon: width >= (inline ? 46 : 16) && height >= 16, wrap: !inline && width >= 110 && height >= 84, compact: inline,
                time: height >= (inline ? 18 : 38) && (time.current?.scrollWidth ?? Infinity) + (inline ? (title.current?.scrollWidth ?? 0) + 38 : 0) <= width - (inline ? 0 : 28),
                resource: !inline && height >= 64 && width >= 80 && (resource.current?.scrollWidth ?? Infinity) <= width };
            setFits(before => before.title === next.title && before.time === next.time && before.resource === next.resource && before.icon === next.icon && before.wrap === next.wrap && before.compact === next.compact ? before : next);
        };
        measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
    }, [item.title, item.start, item.end, props.rows, along, chip]);
    const timeText = `${continued ? "↳ " : ""}${props.format.time(start)}${item.end.type === "some" ? `–${props.format.time(item.end.value)}` : ""}`;
    const resourceText = props.view.layout === "resources" ? kind?.name ?? item.kind : resourceLabel(item, props.rows);
    const label = `${item.title}, ${props.format.weekdayDate(start)} ${timeText}, ${resourceLabel(item, props.rows)}${item.status.type === "some" ? `, ${item.status.value.label}` : ""}`;
    const choose = (event: MouseEvent) => { event.stopPropagation(); props.select(item, event.shiftKey || event.metaKey || event.ctrlKey); };
    return <Box {...handle} ref={attachEvent} css={styles.event} style={geometry} data-along={along} data-chip={chip ? "" : undefined} data-compact={fits.compact ? "" : undefined}
        tabIndex={0} role="button" aria-label={label} title={label} aria-pressed={selected.has(id)}
        data-calendar-event={id} data-selected={selected.has(id) ? "" : undefined} data-overlap={overlaps.peers.has(id) ? "" : undefined}
        data-draft={commands?.editing.draftsOf(item.kind).has(item.key) ? "" : undefined} data-drafted={commands?.editing.draftsOf(item.kind).has(item.key) ? "" : undefined} data-draggable={enabled ? "" : undefined}
        onPointerDown={event => {
            const cell = event.currentTarget.closest<HTMLElement>("[data-calendar-cell]");
            if (cell !== null) {
                const rect = cell.getBoundingClientRect();
                const from = Number(cell.dataset.calendarFrom); const to = Number(cell.dataset.calendarTo);
                const fraction = along === "x" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
                const snap = Number(cell.dataset.calendarSnap) || QUARTER;
                const instant = chip ? start : new Date(from + Math.floor(fraction * (to - from) / snap) * snap);
                drag.grab(item, instant);
            }
            handle?.onPointerDown?.(event);
        }} onClick={choose} onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); props.select(item, event.shiftKey); }
            else {
                if (event.key === " ") {
                    const cell = event.currentTarget.closest<HTMLElement>("[data-calendar-cell]");
                    const rect = cell?.getBoundingClientRect(); const mark = event.currentTarget.getBoundingClientRect();
                    const from = Number(cell?.dataset.calendarFrom); const to = Number(cell?.dataset.calendarTo); const snap = Number(cell?.dataset.calendarSnap) || QUARTER;
                    const fraction = rect === undefined ? 0 : along === "x" ? (mark.left + mark.width / 2 - rect.left) / rect.width : (mark.top + mark.height / 2 - rect.top) / rect.height;
                    drag.grab(item, chip || rect === undefined ? start : new Date(from + Math.floor(fraction * (to - from) / snap) * snap));
                }
                handle?.onKeyDown?.(event);
            }
        }}>
        <Box css={styles.eventTop}>
            {fits.icon && kind !== undefined && <Box as="span" css={styles.eventIcon} data-calendar-event-icon=""><FontAwesomeIcon icon={["fas", kind.icon as IconName]} /></Box>}
            <Box ref={time} css={styles.eventDetail} data-calendar-event-detail="" data-calendar-event-time="" data-measure={!fits.time ? "" : undefined}>{timeText}</Box>
            {fits.icon && overlaps.peers.has(id) && <Box css={styles.eventWarning}><FontAwesomeIcon icon={faTriangleExclamation} /></Box>}
        </Box>
        <Box ref={title} css={styles.eventTitle} data-calendar-event-title="" data-wrap={fits.wrap ? "" : undefined} data-measure={!fits.title ? "" : undefined}>{item.title}</Box>
        <Box ref={resource} css={styles.eventResource} data-calendar-event-detail="" data-calendar-event-resource="" data-measure={!fits.resource ? "" : undefined}>{resourceText}</Box>
        {enabled && !chip && !(along === "x" && props.view.period === "month") && <>
            {(window === undefined || start >= window.from) && <EventEdge coord={coord} edge="start" label={item.title} styles={styles} along={along} />}
            {(window === undefined || item.end.type === "some" && item.end.value <= window.to) && <EventEdge coord={coord} edge="end" label={item.title} styles={styles} along={along} />}
        </>}
    </Box>;
}
function EventEdge({ coord, edge, label, styles, along }: { coord: Required<CellCoord>; edge: "start" | "end"; label: string; styles: CalendarStyles; along: "x" | "y" }) {
    const handle = useDragEventEdge(coord, edge, label, false, `${edge === "start" ? "Start" : "End"} of ${label}`);
    return <chakra.button {...handle} type="button" css={styles.resize} data-edge={edge} data-along={along} aria-label={`Resize ${edge} of ${label}`}
        onClick={event => event.stopPropagation()} onPointerDown={event => { event.stopPropagation(); handle?.onPointerDown?.(event); }} />;
}

/** A continuous cell uses the shared drop grammar and the Calendar's quarter-hour snap. */
function DropLane({ props, from, to, resource, along = "y", wholeDay = false, children, css, style, draw = true, elementRef, outside = false, unassigned = false }: {
    props: CalendarViewsProps; from: Date; to: Date; resource: CalendarItem["resource"]; along?: "x" | "y";
    wholeDay?: boolean; children: ReactNode; css: CalendarStyles[string] | undefined; style?: CSSProperties; draw?: boolean; elementRef?: RefObject<HTMLDivElement | null>; outside?: boolean; unassigned?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const resolution = along === "y" || props.view.period === "day" ? "hour" : props.view.period === "week" ? "day" : "month";
    const scale = useMemo(() => timeScale({ window: { min: from, max: to }, resolution })!, [from, to, resolution]);
    const snap = scale.fineUnit ?? QUARTER;
    const [drawing, setDrawing] = useState<{ start: Date; end: Date }>();
    const [landing, setLanding] = useState<CalendarPlacement>();
    const down = useRef<{ start: Date; x: number; y: number } | undefined>(undefined);
    const coordinate = (x: number, y: number, payload?: DragPayload) => {
        const rect = ref.current?.getBoundingClientRect();
        const fraction = rect === undefined ? 0 : along === "x" ? (x - rect.left) / rect.width : (y - rect.top) / rect.height;
        const time = wholeDay ? props.drag.wholeDay(from, payload) : new Date(Math.max(from.getTime(), Math.min(to.getTime(), from.getTime() + Math.floor(fraction * (to.getTime() - from.getTime()) / snap) * snap)));
        const element = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y)?.closest("[data-calendar-event]") : undefined;
        const coord = calendarCoord(props.drag.surface, wholeDay ? time : props.drag.adjust(time, payload), resource, element?.getAttribute("data-calendar-event") ?? undefined);
        return unassigned ? { ...coord, row: "unassigned" } : coord;
    };
    const drop = useDropCell(props.drag.enabled ? calendarCoord(props.drag.surface, from, resource) : null, !props.drag.enabled,
        event => props.drag.run(event, true) === undefined, (x, y, payload) => coordinate(x, y, payload), {
            caption: props.drag.caption,
            onHover: (x, y, payload) => {
                const next = props.drag.preview(coordinate(x, y, payload), payload);
                setLanding(before => before?.start.getTime() === next?.start.getTime() && before?.end.getTime() === next?.end.getTime() ? before : next);
            },
            stopAxis: along,
            stops: () => {
                const rect = ref.current?.getBoundingClientRect();
                const count = Math.ceil((to.getTime() - from.getTime()) / snap);
                return rect === undefined ? [] : Array.from({ length: count }, (_, i) => (along === "x" ? rect.left : rect.top) + (i + 0.01) * (along === "x" ? rect.width : rect.height) / count);
            },
        });
    const attach = useCallback((element: HTMLDivElement | null) => { ref.current = element; if (elementRef !== undefined) elementRef.current = element; drop(element); }, [drop, elementRef]);
    const timeAt = (event: PointerEvent) => {
        const coord = coordinate(event.clientX, event.clientY);
        const offset = coord.slot;
        // The slot is produced here from an instant; the shared reader uses the same codec.
        const parsed = props.drag.readTime(offset); return parsed ?? from;
    };
    return <Box ref={attach} css={css} style={style} data-calendar-cell="" data-outside={outside ? "" : undefined} data-calendar-from={from.getTime()} data-calendar-to={to.getTime()} data-calendar-snap={snap}
        onClick={event => { if (!(event.target as Element).closest("[data-calendar-event], button")) props.clear(); }}
        onKeyDown={event => { if (event.key === "Escape") { down.current = undefined; setDrawing(undefined); } }}
        onPointerDown={props.drag.enabled && draw && !wholeDay ? event => {
            if (event.button !== 0 || (event.target as Element).closest("[data-calendar-event]")) return;
            down.current = { start: timeAt(event), x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId);
        } : undefined}
        onPointerMove={props.drag.enabled && draw ? event => {
            const pressed = down.current; if (pressed === undefined || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 4) return;
            const time = timeAt(event); setDrawing(drawSpan(scale, scale.fracOf(pressed.start), scale.fracOf(time), true));
        } : undefined}
        onPointerUp={props.drag.enabled && draw ? () => {
            if (drawing !== undefined) props.drag.create(drawing.start, drawing.end, resource); else if (down.current !== undefined) props.clear();
            down.current = undefined; setDrawing(undefined);
        } : undefined} onPointerCancel={() => { down.current = undefined; setDrawing(undefined); }}>
        {children}
        {[{ span: drawing, ghost: false }, { span: landing, ghost: true }].map(({ span, ghost }, i) => {
            if (span === undefined) return null;
            const first = Math.max(from.getTime(), span.start.getTime());
            const last = Math.min(to.getTime(), span.end.getTime());
            return <Box key={i} css={props.styles.ghost} data-calendar-landing={ghost ? "" : undefined} data-calendar-draw={!ghost ? "" : undefined} data-along={along} data-whole-day={wholeDay ? "" : undefined}
                style={wholeDay ? undefined : along === "x"
                    ? { left: `${(first - from.getTime()) / (to.getTime() - from.getTime()) * 100}%`, width: `${(last - first) / (to.getTime() - from.getTime()) * 100}%` }
                    : { top: `${(first - from.getTime()) / (to.getTime() - from.getTime()) * 100}%`, height: `${(last - first) / (to.getTime() - from.getTime()) * 100}%` }}>
                {props.format.time(span.start)}–{props.format.time(span.end)}
            </Box>;
        })}
    </Box>;
}

function TimeGrid(props: CalendarViewsProps) {
    const hour = props.value.settings.density.type === "compact" ? 36 : props.value.settings.density.type === "spacious" ? 64 : 48;
    const height = hour * 24;
    const scroll = useRef<HTMLDivElement>(null);
    useEffect(() => { if (scroll.current !== null) scroll.current.scrollTop = hour * 5.5; }, [hour, props.view.layout, props.view.period, props.view.date]);
    const resources = props.view.layout === "resources";
    const columns = resources ? props.rows.map(row => ({ row, day: dayStart(props.view.date), label: row.label }))
        : props.range.days.map(day => ({ day, label: props.format.weekdayDate(day), row: undefined }));
    const minWidth = 56 + columns.length * (resources ? 104 : columns.length === 1 ? 240 : 112);
    return <Box ref={scroll} css={props.styles.scroll} data-calendar-time-grid="">
        <Box style={{ minWidth }}>
            <Box css={props.styles.head}><Box css={props.styles.timeGutter} />{columns.map((column, i) => <chakra.button type="button" key={i} css={props.styles.columnHead}
                data-today={dateText(column.day) === dateText(props.now) ? "" : undefined} onClick={() => !resources && props.setView({ ...props.view, period: "day", date: column.day.getTime() })}>
                {column.row === undefined ? <>
                    <Box css={props.styles.dayHeading} data-calendar-day-heading=""><Box as="span" css={props.styles.weekday}>{props.format.weekday(column.day)}</Box><Box as="span" css={props.styles.dayDate}>{column.day.getUTCDate()}</Box></Box>
                    <Box css={props.styles.columnMeta}>{props.items.filter(item => inWindow(item, column.day, new Date(column.day.getTime() + DAY))).length} events</Box>
                </> : <>
                    <Box css={props.styles.title} data-calendar-resource-title="">{column.row.icon !== undefined && <FontAwesomeIcon icon={["fas", column.row.icon as IconName]} />} {column.label}</Box>
                    <Box css={props.styles.columnMeta}>{column.row.meta} · {props.format.number(booked(props.items, column.row, column.day, new Date(column.day.getTime() + DAY)))} h booked</Box>
                </>}
            </chakra.button>)}</Box>
            <Box css={props.styles.columns} style={{ height }}>
                <Box css={props.styles.timeGutter}>{columns.some(column => dateText(column.day) === dateText(props.now)) && <NowChip styles={props.styles} at={(props.now.getUTCHours() + props.now.getUTCMinutes() / 60) / 24} along="y">{props.format.time(props.now)}</NowChip>}{HOURS.slice(1).map(h => <Box key={h} css={props.styles.timeLabel} style={{ top: h * hour }}>{String(h).padStart(2, "0")}:00</Box>)}</Box>
                {columns.map((column, i) => {
                    const from = column.day; const to = new Date(from.getTime() + DAY);
                    const items = props.items.filter(item => inWindow(item, from, to) && (column.row === undefined || onResource(item, column.row)));
                    const spans = items.map(item => ({ start: Math.max(from.getTime(), item.start.type === "some" ? item.start.value.getTime() : 0), end: Math.min(to.getTime(), item.end.type === "some" ? item.end.value.getTime() : 0) }));
                    const lanes = packLanes(spans);
                    return <DropLane key={column.row?.key ?? i} props={props} from={from} to={to} resource={column.row?.resource ?? none} unassigned={column.row?.resource.type === "none"} css={props.styles.column} style={{ height }}>
                        {shadeBands({ min: from, max: to }, { hours: { from: Number(props.value.settings.hours.from), to: Number(props.value.settings.hours.to) } }).map((band, i) => <Box key={i} css={props.styles.shade} data-along="y" style={{ top: `${band.start * 100}%`, height: `${band.width * 100}%` }} />)}
                        {HOURS.map(h => <Fragment key={h}><Box css={props.styles.hour} style={{ top: h * hour }} />{hour >= 48 && <Box css={props.styles.hour} data-half="" style={{ top: (h + 0.5) * hour }} />}</Fragment>)}
                        {items.map((item, i) => <EventBlock key={eventKey(item)} item={item} props={props} window={{ from, to }} geometry={{ top: (spans[i]!.start - from.getTime()) / DAY * height, height: (spans[i]!.end - spans[i]!.start) / DAY * height,
                            left: `calc(${lanes[i]!.lane / lanes[i]!.lanes * 100}% + 2px)`, width: `calc(${lanes[i]!.span / lanes[i]!.lanes * 100}% - 4px)` }} />)}
                        {dateText(from) === dateText(props.now) && <NowLine styles={props.styles} at={(props.now.getTime() - from.getTime()) / DAY} along="y" dot data-calendar-now="" />}
                    </DropLane>;
                })}
            </Box>
        </Box>
    </Box>;
}

function MonthDay({ props, day }: { props: CalendarViewsProps; day: Date }) {
    const ref = useRef<HTMLDivElement>(null);
    const [limit, setLimit] = useState(3);
    const next = new Date(day.getTime() + DAY);
    const items = chronological(props.items.filter(item => item.start.type === "some" && item.start.value.getTime() >= day.getTime() && item.start.value.getTime() < next.getTime()));
    useLayoutEffect(() => {
        const element = ref.current; if (element === null) return;
        const measure = () => {
            const available = element.clientHeight - 12 - 28;
            const all = Math.max(0, Math.floor(available / 25));
            setLimit(items.length <= all ? all : Math.max(0, Math.floor((available - 28) / 25)));
        };
        measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
    }, [items.length]);
    return <DropLane props={props} from={day} to={next} resource={none} wholeDay css={props.styles.monthDay} elementRef={ref} outside={day.getUTCMonth() !== new Date(props.view.date).getUTCMonth()}>
        <chakra.button type="button" css={props.styles.dayNumber} data-today={dateText(day) === dateText(props.now) ? "" : undefined} onClick={() => props.setView({ ...props.view, period: "day", date: day.getTime() })}>{day.getUTCDate() === 1 ? props.format.monthDay(day) : day.getUTCDate()}{dateText(day) === dateText(props.now) && " · TODAY"}</chakra.button>
        {items.slice(0, limit).map(item => <EventBlock key={eventKey(item)} item={item} props={props} chip />)}
        {items.length > limit && <chakra.button type="button" css={props.styles.more} onClick={() => props.setView({ ...props.view, period: "day", date: day.getTime() })}>+{items.length - limit} more</chakra.button>}
    </DropLane>;
}
function MonthGrid(props: CalendarViewsProps) {
    const columns = props.value.settings.weekends ? 7 : 5;
    return <Box css={props.styles.scroll} data-calendar-month-grid="">
        <Box css={props.styles.head} data-month="">{props.range.days.slice(0, columns).map(day => <Box key={day.getTime()} css={props.styles.columnHead}><Box css={props.styles.weekday}>{props.format.weekday(day)}</Box></Box>)}</Box>
        <Box css={props.styles.month} style={{ gridTemplateColumns: `repeat(${columns}, minmax(104px, 1fr))`, gridTemplateRows: `repeat(${props.range.days.length / columns}, minmax(128px, 1fr))` }}>
            {props.range.days.map(day => <MonthDay key={day.getTime()} props={props} day={day} />)}
        </Box>
    </Box>;
}

function Timeline(props: CalendarViewsProps) {
    const laneHeight = props.value.settings.density.type === "compact" ? 26 : props.value.settings.density.type === "spacious" ? 40 : 32;
    const pixelsPerDay = timelinePixels(props.view.period);
    const scroll = useRef<HTMLDivElement>(null);
    const shifted = useRef<number | undefined>(undefined);
    const publish = () => {
        const element = scroll.current;
        if (element !== null && element.clientWidth > 0) props.onVisible(timelineVisible(props.range, element.scrollLeft, element.clientWidth, props.view.period));
    };
    useLayoutEffect(() => {
        const element = scroll.current; if (element === null) return;
        element.scrollLeft = shifted.current ?? Math.max(0, (props.view.date + DAY / 2 - props.range.from.getTime()) / DAY * pixelsPerDay - Math.max(0, element.clientWidth - 184) / 2);
        shifted.current = undefined; publish();
        // View changes and edge replacement are the only recentering operations.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.range.from.getTime(), props.view.period, props.view.date]);
    useLayoutEffect(() => {
        const element = scroll.current; if (element === null) return;
        const observer = new ResizeObserver(publish); observer.observe(element); return () => observer.disconnect();
        // Rebind to the current window when it moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.range.from.getTime(), props.view.period]);
    const onScroll = () => {
        const element = scroll.current; if (element === null || element.clientWidth <= 0) return;
        publish();
        if (element.scrollLeft > 240 && element.scrollWidth - element.clientWidth - element.scrollLeft > 240) return;
        const visible = timelineVisible(props.range, element.scrollLeft, element.clientWidth, props.view.period);
        const next = { ...props.view, date: dayStart((visible.from.getTime() + visible.to.getTime()) / 2).getTime() };
        const nextRange = timelineRange(next);
        if (nextRange.from.getTime() === props.range.from.getTime()) return;
        shifted.current = shiftedScroll(element.scrollLeft, props.range, nextRange, props.view.period);
        props.setView(next);
    };
    const duration = props.range.to.getTime() - props.range.from.getTime();
    const width = duration / DAY * pixelsPerDay;
    const ticks = timeScale({ window: { min: props.range.from, max: props.range.to }, resolution: props.view.period === "day" ? "hour" : "day" })!;
    const units = timeScale({ window: { min: props.range.from, max: props.range.to }, resolution: props.view.period === "day" ? "day" : props.view.period === "week" ? "week" : "month" })!;
    return <Box ref={scroll} onScroll={onScroll} css={props.styles.scroll} data-calendar-timeline=""><Box css={props.styles.timeline} style={{ minWidth: width + 184 }}>
        <Box css={props.styles.head}><Box css={props.styles.rowHead}>Resources</Box><Box css={props.styles.ruler}>
            {[units, ticks].map((scale, i) => <Box key={i} css={props.styles.rulerRow} data-calendar-ruler={i === 0 ? "units" : "ticks"}>
                {scale.buckets.map(bucket => <Box key={bucket.index} css={props.styles.rulerTick} style={{
                    left: `${Math.max(0, bucket.start.getTime() - props.range.from.getTime()) / duration * 100}%`,
                    width: `${(Math.min(props.range.to.getTime(), bucket.end.getTime()) - Math.max(props.range.from.getTime(), bucket.start.getTime())) / duration * 100}%`,
                }}>{bucket.label}</Box>)}
            </Box>)}
        </Box></Box>
        {props.rows.map(row => {
            const items = props.items.filter(item => onResource(item, row));
            const spans = items.map(item => {
                const start = item.start.type === "some" ? item.start.value.getTime() : 0;
                const end = item.end.type === "some" ? item.end.value.getTime() : 0;
                return props.view.period === "month" ? { start: Math.floor(start / DAY) * DAY, end: Math.ceil(end / DAY) * DAY } : { start, end };
            });
            const lanes = packLanes(spans); const height = lanes.reduce((n, lane) => Math.max(n, lane.lanes), 1) * laneHeight + 9;
            const first = props.rows.findIndex(other => other.group === row.group) === props.rows.indexOf(row);
            return <Fragment key={row.key}>
                {first && <Box css={props.styles.group}><Box>{row.icon !== undefined && <FontAwesomeIcon icon={["fas", row.icon as IconName]} />} {row.group || "Unassigned"} · {props.rows.filter(other => other.group === row.group).length}</Box></Box>}
                <Box css={props.styles.timelineRow}>
                <Box css={props.styles.rowHead}><Box css={props.styles.title} data-calendar-resource-title="">{row.label}</Box><Box css={props.styles.columnMeta}>{row.meta} · {props.format.number(booked(items, row, props.visibleRange.from, props.visibleRange.to))} h booked</Box></Box>
                <DropLane props={props} from={props.range.from} to={props.range.to} resource={row.resource} unassigned={row.resource.type === "none"} along="x" css={props.styles.rowPlot} style={{ height }} draw={props.view.period !== "month"}>
                    {shadeBands({ min: props.range.from, max: props.range.to }, { hours: props.view.period === "day" ? { from: Number(props.value.settings.hours.from), to: Number(props.value.settings.hours.to) } : undefined }).map((band, i) => <Box key={i} css={props.styles.shade} data-along="x" style={{ left: `${band.start * 100}%`, width: `${band.width * 100}%` }} />)}
                    {items.map((item, i) => <EventBlock key={eventKey(item)} item={item} props={props} window={props.range} along="x" geometry={{ top: 4 + lanes[i]!.lane * laneHeight, height: laneHeight - 4,
                        left: `${Math.max(0, spans[i]!.start - props.range.from.getTime()) / duration * 100}%`, width: `${(Math.min(props.range.to.getTime(), spans[i]!.end) - Math.max(props.range.from.getTime(), spans[i]!.start)) / duration * 100}%` }} />)}
                    {props.now >= props.range.from && props.now < props.range.to && <NowLine styles={props.styles} at={(props.now.getTime() - props.range.from.getTime()) / duration} data-calendar-now="" />}
                </DropLane>
            </Box></Fragment>;
        })}
    </Box></Box>;
}

/** The narrow layout mounts no drag sources, edges, cells or pointer gestures. */
function Agenda(props: CalendarViewsProps) {
    return <Box css={props.styles.scroll} data-calendar-agenda=""><Box css={props.styles.agenda}>
        {props.range.days.map(day => {
            const next = new Date(day.getTime() + DAY);
            const items = chronological(props.items.filter(item => inWindow(item, day, next)));
            return <Box key={day.getTime()} css={props.styles.agendaDay} data-calendar-day={dateText(day)}>
                <Box css={props.styles.agendaHead}>{props.format.weekdayDate(day)}</Box>
                {items.length === 0 && <Box css={props.styles.empty}>Nothing scheduled</Box>}
                {items.map(item => {
                    const id = eventKey(item);
                    return <Box key={id} css={props.styles.card} data-calendar-card={id} data-selected={props.selected.has(id) ? "" : undefined}
                        data-draft={props.commands?.editing.draftsOf(item.kind).has(item.key) ? "" : undefined} data-drafted={props.commands?.editing.draftsOf(item.kind).has(item.key) ? "" : undefined} data-overlap={props.overlaps.peers.has(id) ? "" : undefined}>
                        <chakra.button type="button" css={props.styles.cardHead} onClick={event => props.select(item, event.shiftKey || event.metaKey || event.ctrlKey)} aria-pressed={props.selected.has(id)}>
                            <Box css={props.styles.cardTitle}>{item.title}</Box>
                            <Box css={props.styles.detail}>{item.start.type === "some" && props.format.time(item.start.value)}–{item.end.type === "some" && props.format.time(item.end.value)} · {resourceLabel(item, props.rows)}</Box>
                            <Box css={props.styles.detail}>{props.value.events.find(kind => kind.key === item.kind)?.name}{item.status.type === "some" && ` · ${item.status.value.label}`}{props.overlaps.peers.has(id) && " · Overlap"}</Box>
                        </chakra.button>
                        <Button size="xs" variant="ghost" aria-pressed={props.selected.has(id)} onClick={() => props.select(item, true)}>{props.selected.has(id) ? "Remove from selection" : "Add to selection"}</Button>
                        {props.commands !== undefined && <EventActions item={item} value={props.value} commands={props.commands} day={day} styles={props.styles} />}
                    </Box>;
                })}
            </Box>;
        })}
    </Box></Box>;
}
/** Calendar's main view; the narrow branch contains no drag hooks. */
export function CalendarViews(props: CalendarViewsProps) {
    if (props.narrow) return <Agenda {...props} />;
    if (props.view.layout === "timeline") return <Timeline {...props} />;
    if (props.view.layout === "calendar" && props.view.period === "month") return <MonthGrid {...props} />;
    return <TimeGrid {...props} />;
}
