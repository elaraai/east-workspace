/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The mock's desktop views and the non-draggable narrow agenda. A period not
 * read yet draws its own grid at once — never the period before's events under
 * its labels — each region whose events have no known place yet washed, each
 * count a placeholder (#1398, CL2, CL5, CL13); a period whose read failed keeps
 * its grid, its cells blank, and says so once: the time and month grids in a
 * box at their top-left in view, the timeline and the agenda in a line in their
 * first row (CL11).
 *
 * The timeline continues what it shows (#1398): its view nearing an end of its
 * window moves on to the next window of its grid (`timeline.ts`), and every
 * step of its dates moves it as that does (ruled 25 Oct 2026). While the window
 * is read the held read's events stay drawn at their real dates — in the lanes
 * the period they were drawn at gave them (`lanesPeriod`), so every row keeps
 * its height and the view its place, and their booked hours — only the days the
 * held read does not cover washed, its counts over the days shown placeholders
 * only where the view has passed beyond it (`covered`).
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Box, Button, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { none } from "@elaraai/east";
import { useDragEventChip, useDragEventEdge, useDropCell, type CellCoord, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import { LoadingFailedBox, LoadingFailedLine, LoadingWash, PlaceholderShape, VirtualRows, devicePixels, useRowsTop } from "@elaraai/east-ui-components/internal";
import type { PeriodRead } from "../shared/loading.js";
import { NowChip, NowLine } from "../shared/time/now-line.js";
import { drawSpan } from "../shared/time/drag.js";
import { timeScale, timeWords } from "../shared/time/scale.js";
import { TimeRulerRow, timeRulerUnits } from "../shared/time/ruler.js";
import { packLanes } from "../shared/time/lanes.js";
import { shadeBands } from "../shared/time/shading.js";
import type { ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import { TIMELINE_GUTTER, recentredView, shiftedScroll, timelinePixels, timelineRange, timelineVisible } from "./timeline.js";
import { coversShown, useVisibleDays, type TravelStore, type VisibleDaysStore } from "./visible.js";
import { GroupHeading, useGroupCollapse } from "../shared/schedule/group-heading.js";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { useRowAnchor, type RowAnchor } from "../shared/schedule/row-anchor.js";
import { EventActions, type CalendarShownResources } from "./controls.js";
import { calendarCoord, type CalendarDrag } from "./drag.js";
import type { CalendarCommands, CalendarPlacement } from "./actions.js";
import { DAY, QUARTER, chronological, dateText, dayStart, eventKey, inWindow, onResource, resourceKey,
    type CalendarItem, type CalendarRange, type CalendarRow, type CalendarStyles, type CalendarValue, type CalendarView } from "./model.js";

/**
 * The views share selection, commands, drafts and overlap state. `rows` are every resource, what an event's label
 * names; `shownRows` are the ones the rail shows (#1343), each layout's columns and rows, and `shown` each kind's.
 */
export interface CalendarViewsProps {
    navigationRevision?: number;
    value: CalendarValue; view: CalendarView; setView: (view: CalendarView) => void; range: CalendarRange; format: Formatters;
    /** Hears what the timeline shows as it scrolls, exactly. */
    onVisible: (range: CalendarRange) => void;
    /** The days the timeline shows, read by what says them (#1398, CL9): its rows' booked hours. */
    visible?: VisibleDaysStore | undefined;
    items: readonly CalendarItem[]; rows: readonly CalendarRow[]; shownRows: readonly CalendarRow[]; shown: CalendarShownResources;
    now: Date; narrow: boolean; styles: CalendarStyles;
    selected: ReadonlySet<string>; select: (item: CalendarItem, additive?: boolean) => void; clear: () => void;
    overlaps: ScheduleOverlaps<CalendarItem>; commands: CalendarCommands | undefined; drag: CalendarDrag;
    /**
     * What the views draw of the period's read (#1398): the period as read; a period not read yet — `items` none, its
     * regions washed and its counts placeholders, unseen until the frame's reveal says so; or one whose read failed — the
     * failure said once, its cells blank.
     */
    read: PeriodRead;
    /**
     * The span `items` were read over (#1398): the window itself once read; while a continuation's window is read — a
     * re-centre's, or a step's on the timeline — the held read's: the timeline washes what of its window that leaves
     * out, and says a figure over the days shown only where it covers them; `undefined` while nothing is drawn.
     */
    covered?: CalendarRange | undefined;
    /**
     * The period the timeline lays `items` out at (#1398): the view's own, or while a continuation's window is read the
     * period the held read was drawn at, so every row keeps the height its lanes gave it until the new lanes land.
     */
    lanesPeriod?: CalendarView["period"] | undefined;
    /** Told where the timeline re-centres (#1398): a continuation of the window, as every step of it is. */
    onRecentre?: ((next: CalendarView) => void) | undefined;
    /** Which way the timeline's view travels along time, set as it scrolls: what the window's read reads ahead. */
    travel?: TravelStore | undefined;
    /** Moves each time Today is pressed: the time grid brings the now line into view (#1398). */
    nowRevision?: number | undefined;
    /** Where each layout's view last rested (#1398): what it comes back to as it mounts. */
    anchor?: CalendarAnchor | undefined;
    /** Told where a layout's view rests as it settles. */
    onAnchor?: ((next: Partial<CalendarAnchor>) => void) | undefined;
    /** The event a pick asks to be shown (#1398), by its printed key: the timeline brings its row and its time into view. */
    reveal?: string | undefined;
    /** Told once the event to show is drawn, with its element. */
    onRevealed?: ((element: HTMLElement) => void) | undefined;
}

/**
 * Where each layout's view rests (#1398): the time grid's hour at its top, and the timeline's top line, by its key, with
 * the px scrolled into it — never a pixel offset of the whole, which the rows above it would move.
 */
export interface CalendarAnchor {
    readonly gridHour?: number | undefined;
    readonly timeline?: RowAnchor | undefined;
}
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** The hour the time grid opens at, the first time: half past five, the working day just above the fold. */
const OPENING_HOUR = 5.5;
/** How long a scroll of the time grid rests before where it rests is saved. */
const ANCHOR_REST_MS = 150;

/**
 * An hour's height in the time grid, by the Calendar's density: the pitch its cold load's cover stands at too (#1398, CL1).
 *
 * @param density - The Calendar's density
 * @returns The hour's height, in px
 */
export function calendarHour(density: CalendarValue["settings"]["density"]): number {
    return density.type === "compact" ? 36 : density.type === "spacious" ? 64 : 48;
}

/**
 * Whether placeholders go where the period's content goes: a period not read yet. Each is unseen at its footprint until
 * the frame's one reveal clock says so (CL4), reading it itself.
 */
function pendingOf(read: PeriodRead): boolean {
    return read.state === "pending";
}

/** A count or a figure the period's read gives: the words once read, its placeholder while it is read, nothing where it failed. */
function Counted({ props, index, children }: { props: CalendarViewsProps; index: number; children: ReactNode }) {
    if (props.read.state === "held") return <>{children}</>;
    return pendingOf(props.read) ? <PlaceholderShape kind="aggregate" index={index} /> : null;
}

/**
 * Where a grid says its failure, read off its laid-out grid (#1398, CL11): just inside the corner its sticky head and
 * its sticky hour column leave of the scroll's view — in the scroll's own box, so it stays in view however the grid
 * scrolls — or, in a month, under the first week's dates.
 *
 * @param scroll - The grid's scroll box
 * @param failed - Whether the period's read failed
 * @returns Where the box sits, from the scroll box's top-left; `undefined` while nothing failed or before layout
 */
function useFailureCorner(scroll: RefObject<HTMLElement | null>, failed: boolean): { top: number; left: number } | undefined {
    const [at, setAt] = useState<{ top: number; left: number }>();
    useLayoutEffect(() => {
        const el = scroll.current;
        if (!failed || el === null) { setAt(undefined); return; }
        const box = el.getBoundingClientRect();
        const below = el.querySelector("[data-calendar-day-number]") ?? el.querySelector("[data-calendar-header]");
        const beside = el.querySelector("[data-calendar-gutter]");
        const next = {
            top: Math.round((below === null ? 0 : below.getBoundingClientRect().bottom - box.top) + 8),
            left: Math.round((beside === null ? 0 : beside.getBoundingClientRect().right - box.left) + 8),
        };
        setAt(before => before?.top === next.top && before.left === next.left ? before : next);
    }, [failed, scroll]);
    return at;
}

/** A failed period's box at its grid's top-left in view (#1398, CL11): its words and its Retry. */
function FailureBox({ props, at }: { props: CalendarViewsProps; at: { top: number; left: number } | undefined }) {
    if (props.read.state !== "failed" || at === undefined) return null;
    return <LoadingFailedBox message={props.read.message} retry={{ onRetry: props.read.retry }} at={at} />;
}
function resourceLabel(item: CalendarItem, rows: readonly CalendarRow[]): string { return rows.find(row => onResource(item, row))?.label ?? "Unassigned"; }

/** Booked time is measured within the labelled view, including overnight events only once. */
function booked(items: readonly CalendarItem[], row: CalendarRow, from: Date, to: Date): number {
    return items.reduce((hours, item) => item.start.type === "some" && item.end.type === "some" && onResource(item, row)
        ? hours + Math.max(0, Math.min(item.end.value.getTime(), to.getTime()) - Math.max(item.start.value.getTime(), from.getTime())) / 3_600_000 : hours, 0);
}

/**
 * What an event and a cell read of the views' props: the same object, in the timeline, while what they draw holds (#1398,
 * CL9) — so a scroll, or a day crossed, draws none of them again.
 */
type EventView = Pick<CalendarViewsProps, "styles" | "drag" | "selected" | "overlaps" | "commands" | "range" | "view" | "value" | "format" | "rows" | "select" | "clear"
    | "reveal" | "onRevealed">;
/** The same full event facts, in a card, a block, a month chip or a timeline bar. */
function EventBlock({ item, props, geometry, along = "y", chip = false, window }: { item: CalendarItem; props: EventView; geometry?: CSSProperties; along?: "x" | "y"; chip?: boolean; window?: { from: Date; to: Date } }) {
    const { styles, drag, selected, overlaps, commands } = props;
    const id = eventKey(item);
    const start = item.start.type === "some" ? item.start.value : props.range.from;
    const coord = { ...calendarCoord(drag.surface, start, props.view.layout === "calendar" ? none : item.resource), event: id } as Required<CellCoord>;
    const enabled = drag.enabled && commands?.editing.available(item.kind) === true;
    const handle = useDragEventChip(enabled ? coord : null, <MoveGhost styles={styles} label={item.title} />, !enabled, item.title);
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
    // The event a pick asks to be shown (#1398): drawn — as a timeline brings it into its view — it tells the frame.
    const revealing = props.reveal !== undefined && props.reveal === id;
    const { onRevealed } = props;
    useLayoutEffect(() => { if (revealing && block.current !== null) onRevealed?.(block.current); }, [revealing, onRevealed]);
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
    const handle = useDragEventEdge(coord, edge, <MoveGhost styles={styles} label={label} />, false, `${edge === "start" ? "Start" : "End"} of ${label}`);
    return <chakra.button {...handle} type="button" css={styles.resize} data-edge={edge} data-along={along} aria-label={`Resize ${edge} of ${label}`}
        onClick={event => event.stopPropagation()} onPointerDown={event => { event.stopPropagation(); handle?.onPointerDown?.(event); }} />;
}

/** A continuous cell uses the shared drop grammar and the Calendar's quarter-hour snap. */
function DropLane({ props, from, to, resource, along = "y", wholeDay = false, children, css, style, draw = true, elementRef, outside = false, unassigned = false }: {
    props: EventView; from: Date; to: Date; resource: CalendarItem["resource"]; along?: "x" | "y";
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
    const hour = calendarHour(props.value.settings.density);
    const height = hour * 24;
    const scroll = useRef<HTMLDivElement>(null);
    // Where the grid's view rests (#1398): the hour at its top — half past five the first time, then wherever it was left,
    // across a step, a layout or a remount, never back to half past five — saved as a scroll rests. Today brings the now
    // line into view, a third of the way down.
    const { onAnchor } = props;
    const topHour = useRef(props.anchor?.gridHour ?? OPENING_HOUR);
    const resting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const save = useRef(onAnchor);
    save.current = onAnchor;
    useLayoutEffect(() => { if (scroll.current !== null) scroll.current.scrollTop = topHour.current * hour; }, [hour]);
    // A scroll still resting as the grid goes — a layout switched, the Calendar unmounted — is saved then.
    useEffect(() => () => {
        if (resting.current === undefined) return;
        clearTimeout(resting.current);
        save.current?.({ gridHour: topHour.current });
    }, []);
    const keep = useCallback((el: HTMLElement) => {
        topHour.current = el.scrollTop / hour;
        if (resting.current !== undefined) clearTimeout(resting.current);
        resting.current = setTimeout(() => { resting.current = undefined; save.current?.({ gridHour: topHour.current }); }, ANCHOR_REST_MS);
    }, [hour]);
    const seenNow = useRef(props.nowRevision);
    useLayoutEffect(() => {
        const el = scroll.current;
        if (props.nowRevision === seenNow.current || el === null) return;
        seenNow.current = props.nowRevision;
        el.scrollTop = Math.max(0, (props.now.getUTCHours() + props.now.getUTCMinutes() / 60) * hour - el.clientHeight / 3);
        keep(el);
        // Today pressed is the trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.nowRevision]);
    const resources = props.view.layout === "resources";
    const columns = resources ? props.shownRows.map(row => ({ row, day: dayStart(props.view.date), label: row.label }))
        : props.range.days.map(day => ({ day, label: props.format.weekdayDate(day), row: undefined }));
    const failure = useFailureCorner(scroll, props.read.state === "failed");
    return <><Box ref={scroll} css={props.styles.scroll} data-calendar-time-grid="" data-calendar-unread={props.read.state === "held" ? undefined : props.read.state}
        onScroll={event => keep(event.currentTarget)}>
        <Box css={props.styles.timeGridContent} data-resources={resources ? "" : undefined} data-single={!resources && columns.length === 1 ? "" : undefined} style={{ "--calendar-columns": columns.length } as CSSProperties}>
            <Box css={props.styles.head} data-calendar-header="" data-resources={resources ? "" : undefined}><Box css={props.styles.timeGutter} />{columns.map((column, i) => <chakra.button type="button" key={i} css={props.styles.columnHead}
                data-today={dateText(column.day) === dateText(props.now) ? "" : undefined} onClick={() => !resources && props.setView({ ...props.view, period: "day", date: column.day.getTime() })}>
                {column.row === undefined ? <>
                    <Box css={props.styles.dayHeading} data-calendar-day-heading=""><Box as="span" css={props.styles.weekday}>{props.format.weekday(column.day)}</Box><Box as="span" css={props.styles.dayDate}>{column.day.getUTCDate()}</Box></Box>
                    <Box css={props.styles.columnMeta} data-calendar-day-count="">
                        <Counted props={props} index={i}>{props.items.filter(item => inWindow(item, column.day, new Date(column.day.getTime() + DAY))).length} events</Counted>
                    </Box>
                </> : <>
                    <Box css={props.styles.resourceHeading} data-calendar-resource-title="">{column.row.icon !== undefined && <FontAwesomeIcon icon={["fas", column.row.icon as IconName]} />} {column.label}</Box>
                    <Box css={props.styles.columnMeta} data-calendar-booked="">{props.read.state === "held"
                        ? `${column.row.meta} · ${props.format.number(booked(props.items, column.row, column.day, new Date(column.day.getTime() + DAY)))} h booked`
                        : <Box as="span" css={props.styles.unreadMeta}>{column.row.meta}<Counted props={props} index={i}>{null}</Counted></Box>}</Box>
                </>}
            </chakra.button>)}</Box>
            <Box css={props.styles.columns} style={{ height }}>
                <Box css={props.styles.timeGutter} data-calendar-gutter="">{columns.some(column => dateText(column.day) === dateText(props.now)) && <NowChip styles={props.styles} at={(props.now.getUTCHours() + props.now.getUTCMinutes() / 60) / 24} along="y">{props.format.time(props.now)}</NowChip>}{HOURS.slice(1).map(h => <Box key={h} css={props.styles.timeLabel} style={{ top: h * hour }}>{String(h).padStart(2, "0")}:00</Box>)}</Box>
                {columns.map((column, i) => {
                    const from = column.day; const to = new Date(from.getTime() + DAY);
                    const items = props.items.filter(item => inWindow(item, from, to) && (column.row === undefined || onResource(item, column.row)));
                    const spans = items.map(item => ({ start: Math.max(from.getTime(), item.start.type === "some" ? item.start.value.getTime() : 0), end: Math.min(to.getTime(), item.end.type === "some" ? item.end.value.getTime() : 0) }));
                    const lanes = packLanes(spans);
                    return <DropLane key={column.row?.key ?? i} props={props} from={from} to={to} resource={column.row?.resource ?? none} unassigned={column.row?.resource.type === "none"} css={props.styles.column} style={{ height }}>
                        {/* A period not read yet: the column washed, under its hour rules, shading and now line (#1398). */}
                        {pendingOf(props.read) && <LoadingWash />}
                        {shadeBands({ min: from, max: to }, { hours: { from: Number(props.value.settings.hours.from), to: Number(props.value.settings.hours.to) } }).map((band, i) => <Box key={i} css={props.styles.shade} data-along="y" style={{ top: `${band.start * 100}%`, height: `${band.width * 100}%` }} />)}
                        {HOURS.map(h => <Fragment key={h}><Box css={props.styles.hour} style={{ top: h * hour }} />{hour >= 48 && <Box css={props.styles.hour} data-half="" style={{ top: (h + 0.5) * hour }} />}</Fragment>)}
                        {items.map((item, i) => <EventBlock key={eventKey(item)} item={item} props={props} window={{ from, to }} geometry={{ top: (spans[i]!.start - from.getTime()) / DAY * height, height: (spans[i]!.end - spans[i]!.start) / DAY * height,
                            left: `calc(${lanes[i]!.lane / lanes[i]!.lanes * 100}% + 2px)`, width: `calc(${lanes[i]!.span / lanes[i]!.lanes * 100}% - 4px)` }} />)}
                        {dateText(from) === dateText(props.now) && <NowLine styles={props.styles} at={(props.now.getTime() - from.getTime()) / DAY} along="y" dot data-calendar-now="" />}
                    </DropLane>;
                })}
            </Box>
        </Box>
    </Box><FailureBox props={props} at={failure} /></>;
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
        <chakra.button type="button" css={props.styles.dayNumber} data-calendar-day-number="" data-today={dateText(day) === dateText(props.now) ? "" : undefined} onClick={() => props.setView({ ...props.view, period: "day", date: day.getTime() })}>{day.getUTCDate() === 1 ? props.format.monthDay(day) : day.getUTCDate()}{dateText(day) === dateText(props.now) && " · TODAY"}</chakra.button>
        {/* A period not read yet: the cell washed below its date, and no "+N more" (#1398). */}
        {pendingOf(props.read) && <Box css={props.styles.monthWash}><LoadingWash /></Box>}
        {items.slice(0, limit).map(item => <EventBlock key={eventKey(item)} item={item} props={props} chip />)}
        {items.length > limit && <chakra.button type="button" css={props.styles.more} onClick={() => props.setView({ ...props.view, period: "day", date: day.getTime() })}>+{items.length - limit} more</chakra.button>}
    </DropLane>;
}
function MonthGrid(props: CalendarViewsProps) {
    const columns = props.value.settings.weekends ? 7 : 5;
    const scroll = useRef<HTMLDivElement>(null);
    const failure = useFailureCorner(scroll, props.read.state === "failed");
    return <><Box ref={scroll} css={props.styles.scroll} data-calendar-month-grid="" data-calendar-unread={props.read.state === "held" ? undefined : props.read.state}
        style={{ "--calendar-month-columns": columns, "--calendar-month-rows": props.range.days.length / columns } as CSSProperties}>
        <Box css={props.styles.head} data-calendar-header="" data-month="">{props.range.days.slice(0, columns).map(day => <Box key={day.getTime()} css={props.styles.columnHead}><Box css={props.styles.weekday}>{props.format.weekday(day)}</Box></Box>)}</Box>
        <Box css={props.styles.month}>
            {props.range.days.map(day => <MonthDay key={day.getTime()} props={props} day={day} />)}
        </Box>
    </Box><FailureBox props={props} at={failure} /></>;
}

/** A line of the timeline: a group's band, or a resource's row. */
type TimelineLine = { kind: "group"; key: string; group: string; count: number } | { kind: "row"; key: string; row: CalendarRow; r: number };
/** A resource row's events laid out once a read (#1398, CL9): the events, their spans, their lanes and the plot's height. */
interface TimelineLayout {
    readonly items: readonly CalendarItem[];
    readonly spans: readonly { readonly start: number; readonly end: number }[];
    readonly lanes: ReturnType<typeof packLanes>;
    readonly height: number;
}
/** What a timeline row reads, the same object while what the rows draw holds (CL9). */
interface TimelineContext {
    readonly view: EventView;
    readonly read: PeriodRead;
    /** The span the events drawn were read over: the window, or while a continuation's is read, the held read's. */
    readonly covered: CalendarRange | undefined;
    /** What of the window the events drawn leave out while it is read: a continuation's days the held read does not cover. */
    readonly unread: readonly { readonly left: string; readonly width: string }[];
    readonly visible: VisibleDaysStore | undefined;
    readonly laneHeight: number;
    readonly duration: number;
    readonly now: Date;
    readonly shades: ReturnType<typeof shadeBands>;
    readonly lines: readonly TimelineLine[];
}
/**
 * What of a window the events drawn leave out (#1398): while a continuation's window is read — a re-centre's, a step's
 * — the held read stands in, and the days of the window it was not read over — at one end, both, or all of them for a
 * step far from it — are washed, each a share of the plot.
 *
 * @param range - The window shown
 * @param covered - The span the events drawn were read over
 * @returns Each such span, as its left and its width in the plot
 */
function unreadSpans(range: CalendarRange, covered: CalendarRange | undefined): { left: string; width: string }[] {
    if (covered === undefined) return [];
    const from = range.from.getTime(), to = range.to.getTime(), duration = to - from;
    const held = { from: Math.min(to, Math.max(from, covered.from.getTime())), to: Math.max(from, Math.min(to, covered.to.getTime())) };
    const spans = held.from >= held.to ? [{ from, to }] : [{ from, to: held.from }, { from: held.to, to }];
    return spans.filter(span => span.to > span.from)
        .map(span => ({ left: `${(span.from - from) / duration * 100}%`, width: `${(span.to - span.from) / duration * 100}%` }));
}
/** The elements of the timeline mounted either side of what it shows, in views: a scroll of up to half a view mounts nothing. */
const TIMELINE_AHEAD = 1;
/** A resource row's key among the events: the resource's, or none's — the unassigned row. */
function rowResource(row: CalendarRow): string { return row.resource.type === "some" ? resourceKey(row.resource.value) : ""; }
/**
 * The resource row a failed period says so in (#1398, CL11): the first at or below the line at the top of the view,
 * else the last above it.
 *
 * @param lines - The timeline's lines
 * @param top - The line at the top of the view; `undefined` before they are placed
 * @returns The line's index; `undefined` with no resource row
 */
function firstRowInView(lines: readonly TimelineLine[], top: number | undefined): number | undefined {
    const from = Math.max(0, top ?? 0);
    for (let i = from; i < lines.length; i++) if (lines[i]!.kind === "row") return i;
    for (let i = Math.min(from, lines.length) - 1; i >= 0; i--) if (lines[i]!.kind === "row") return i;
    return undefined;
}
/**
 * A resource's booked hours over the days the timeline shows, read as they move (CL9); while the days shown are read —
 * a period not read yet, or a continuation's days the held read does not cover — its meta and a placeholder.
 */
function TimelineRowMeta({ ctx, row, layout, r }: { ctx: TimelineContext; row: CalendarRow; layout: TimelineLayout; r: number }) {
    const shown = useVisibleDays(ctx.visible);
    const { styles, format, range } = ctx.view;
    if (ctx.read.state !== "held" || !coversShown(ctx.covered, range, shown)) {
        return <Box css={styles.columnMeta} data-calendar-booked=""><Box as="span" css={styles.unreadMeta}>{row.meta}{ctx.read.state !== "failed" && <PlaceholderShape kind="aggregate" index={r} />}</Box></Box>;
    }
    const from = shown?.from ?? range.from, to = shown?.to ?? range.to;
    return <Box css={styles.columnMeta} data-calendar-booked="">{`${row.meta} · ${format.number(booked(layout.items, row, from, to))} h booked`}</Box>;
}
/**
 * A resource row's plot: its events in the timeline's mounted span — every one while the timeline has not laid out — its
 * wash while the period is read, or over the days a continuation's held read does not cover, its shading and its now line;
 * and, the first row in view of a failed period, the failure, which it reads itself (#1398, CL9, CL11). Drawn again only
 * as its events or that span move.
 */
const TimelinePlot = memo(function TimelinePlot({ ctx, row, layout, span, index }: {
    ctx: TimelineContext; row: CalendarRow; layout: TimelineLayout; span: { readonly from: number; readonly to: number } | undefined; index: number;
}) {
    const { view, read, unread, laneHeight, duration, now, shades, lines } = ctx;
    const { styles, range } = view;
    const says = useRowsTop(top => read.state === "failed" && index === firstRowInView(lines, top));
    return <DropLane props={view} from={range.from} to={range.to} resource={row.resource} unassigned={row.resource.type === "none"} along="x" css={styles.rowPlot} style={{ height: layout.height }} draw={view.view.period !== "month"}>
        {/* A period not read yet: the row's plot washed, under its shading and its now line (#1398); a continuation's window
            read, the days its held read does not cover. */}
        {read.state === "pending" && <LoadingWash />}
        {read.state === "held" && unread.map((at, i) => <LoadingWash key={i} geometry={at} />)}
        {read.state === "failed" && says && <Box css={styles.readLine} data-calendar-read-line="">
            <LoadingFailedLine message={read.message} retry={{ onRetry: read.retry }} /></Box>}
        {shades.map((band, i) => <Box key={i} css={styles.shade} data-along="x" style={{ left: `${band.start * 100}%`, width: `${band.width * 100}%` }} />)}
        {layout.items.map((item, i) => {
            const at = layout.spans[i]!;
            // Out of the mounted span, or — a continuation's held read — out of the window shown, by the window's own rule.
            if (span !== undefined && (at.end <= span.from || at.start >= span.to)) return null;
            if (!(at.start < range.to.getTime() && (at.end > range.from.getTime() || at.start >= range.from.getTime()))) return null;
            return <EventBlock key={eventKey(item)} item={item} props={view} window={range} along="x" geometry={{ top: 4 + layout.lanes[i]!.lane * laneHeight, height: laneHeight - 4,
                left: `${Math.max(0, at.start - range.from.getTime()) / duration * 100}%`, width: `${(Math.min(range.to.getTime(), at.end) - Math.max(range.from.getTime(), at.start)) / duration * 100}%` }} />;
        })}
        {now >= range.from && now < range.to && <NowLine styles={styles} at={(now.getTime() - range.from.getTime()) / duration} data-calendar-now="" />}
    </DropLane>;
});
/** A resource's row: its head, its booked hours and its plot — drawn again only as what it shows moves (CL9). */
const TimelineRow = memo(function TimelineRow({ ctx, row, layout, span, index, r, measure }: {
    ctx: TimelineContext; row: CalendarRow; layout: TimelineLayout; span: { readonly from: number; readonly to: number } | undefined; index: number; r: number;
    measure: (el: HTMLElement | null) => void;
}) {
    const { styles } = ctx.view;
    return <Box ref={measure} css={styles.timelineRow} data-calendar-resource-row={row.key} data-calendar-row-group={row.group}>
        <Box css={styles.rowHead}><Box css={styles.rowTitle} data-calendar-resource-title="">{row.label}</Box><TimelineRowMeta ctx={ctx} row={row} layout={layout} r={r} /></Box>
        <TimelinePlot ctx={ctx} row={row} layout={layout} span={span} index={index} />
    </Box>;
});
/** The estimate of a group's band before one has mounted: the shared band's height. */
const BAND_FLOOR = 38;
/** Every timeline line may anchor the view: none is a placeholder whose edge moves as rows land beside it. */
const ANCHOR_EVERY_LINE = () => true;
/** No span of the window left out: all of it read, or none of it drawn. */
const NO_SPANS: readonly { readonly left: string; readonly width: string }[] = [];

/**
 * The timeline (#1398, CL9): its resources' rows virtualised in their groups — only those in view mounted, each drawn
 * again only as what it shows moves — and their events by what the view shows of the period, one view either side; a
 * scroll publishes only the days it shows, to what says them, and which way it travels, to what reads ahead. Nearing an
 * end of its window it re-centres on the next window of its grid (`timeline.ts`), every instant where it was on screen.
 */
function Timeline(props: CalendarViewsProps) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const { styles, range, view } = props;
    const laneHeight = props.value.settings.density.type === "compact" ? 26 : props.value.settings.density.type === "spacious" ? 40 : 32;
    const pixelsPerDay = timelinePixels(view.period);
    const duration = range.to.getTime() - range.from.getTime();
    const width = duration / DAY * pixelsPerDay;
    const scroll = useRef<HTMLDivElement | null>(null);
    const shifted = useRef<number | undefined>(undefined);
    // Each resource's events, the read's events indexed by resource once — never a search of every event a row.
    const byResource = useMemo(() => {
        const by = new Map<string, CalendarItem[]>();
        for (const item of props.items) {
            const key = item.resource.type === "some" ? resourceKey(item.resource.value) : "";
            const theirs = by.get(key);
            if (theirs === undefined) by.set(key, [item]);
            else theirs.push(item);
        }
        return by;
    }, [props.items]);
    // Each row's events laid out once a read: their spans, their lanes and the plot's height — however its events fall —
    // at the period they were drawn at: a continuation's held read keeps its lanes, and every row its height (#1398).
    const lanesPeriod = props.lanesPeriod ?? view.period;
    const layouts = useMemo(() => new Map(props.shownRows.map(row => {
        const items = byResource.get(rowResource(row)) ?? [];
        const spans = items.map(item => {
            const start = item.start.type === "some" ? item.start.value.getTime() : 0;
            const end = item.end.type === "some" ? item.end.value.getTime() : 0;
            return lanesPeriod === "month" ? { start: Math.floor(start / DAY) * DAY, end: Math.ceil(end / DAY) * DAY } : { start, end };
        });
        // A period not read yet: one lane a row, which grows below the row in view as its events land.
        const lanes = packLanes(spans);
        return [row.key, { items, spans, lanes, height: lanes.reduce((n, lane) => Math.max(n, lane.lanes), 1) * laneHeight + 9 }] as const;
    })), [props.shownRows, byResource, lanesPeriod, laneHeight]);
    // The lines: each group's band, and its rows unless it is folded.
    const lines = useMemo((): TimelineLine[] => {
        const groups = [...new Set(props.shownRows.map(row => row.group))];
        let r = 0;
        return groups.flatMap(group => {
            const rows = props.shownRows.filter(row => row.group === group);
            return [{ kind: "group" as const, key: `group:${group}`, group, count: rows.length },
                ...(collapsed.includes(group) ? [] : rows.map(row => ({ kind: "row" as const, key: `row:${row.key}`, row, r: r++ })))];
        });
    }, [props.shownRows, collapsed]);
    const shades = useMemo(() => shadeBands({ min: range.from, max: range.to }, { hours: view.period === "day" ? { from: Number(props.value.settings.hours.from), to: Number(props.value.settings.hours.to) } : undefined }),
        [range.from, range.to, view.period, props.value.settings.hours]);
    // What an event and a cell read, held while it holds.
    const { drag, selected, overlaps, commands, value, format, rows, select, clear, reveal, onRevealed } = props;
    const eventView = useMemo((): EventView => ({ styles, drag, selected, overlaps, commands, range, view, value, format, rows, select, clear, reveal, onRevealed }),
        [styles, drag, selected, overlaps, commands, range, view, value, format, rows, select, clear, reveal, onRevealed]);
    // A continuation's window, read while the held read stands in: the days of it that read leaves out (#1398).
    const unread = useMemo(() => props.covered === undefined || (props.covered.from.getTime() === range.from.getTime() && props.covered.to.getTime() === range.to.getTime())
        ? NO_SPANS : unreadSpans(range, props.covered), [props.covered, range]);
    const ctx = useMemo((): TimelineContext => ({ view: eventView, read: props.read, covered: props.covered, unread, visible: props.visible, laneHeight, duration, now: props.now, shades, lines }),
        [eventView, props.read, props.covered, unread, props.visible, laneHeight, duration, props.now, shades, lines]);
    // The span of the period whose events are mounted (CL9): what the view shows, one view either side, moved as the view
    // nears its edge; every event while the timeline has not laid out.
    const [span, setSpan] = useState<{ from: number; to: number } | undefined>(undefined);
    const spanRef = useRef(span);
    spanRef.current = span;
    // Where the view's middle was, exactly, as it was last published: which way a scroll moves it is the way it travels.
    const middle = useRef<number | undefined>(undefined);
    const publish = (scrolled: boolean) => {
        const element = scroll.current;
        if (element === null || element.clientWidth <= 0) return;
        const visible = timelineVisible(range, element.scrollLeft, element.clientWidth, view.period);
        const at = (visible.from.getTime() + visible.to.getTime()) / 2;
        // A scroll of a pixel or more travels; a step, a re-centre or a resize places the view, and moves the mark alone.
        if (scrolled && middle.current !== undefined && Math.abs(at - middle.current) >= DAY / pixelsPerDay) props.travel?.set(at > middle.current ? 1 : -1);
        middle.current = at;
        props.onVisible(visible);
        const shows = visible.to.getTime() - visible.from.getTime();
        const held = spanRef.current;
        if (held !== undefined && visible.from.getTime() - held.from >= shows / 2 && held.to - visible.to.getTime() >= shows / 2) return;
        const next = { from: visible.from.getTime() - shows * TIMELINE_AHEAD, to: visible.to.getTime() + shows * TIMELINE_AHEAD };
        spanRef.current = next;
        setSpan(next);
    };
    useLayoutEffect(() => {
        const element = scroll.current; if (element === null) return;
        // A re-centre keeps every instant where it was; a step, a period or a mount places the view on its date. Which
        // way it went is the frame's to say, as it asks: a step's way, which the next window read ahead follows, or none.
        element.scrollLeft = shifted.current ?? Math.max(0, (view.date + DAY / 2 - range.from.getTime()) / DAY * pixelsPerDay - Math.max(0, element.clientWidth - TIMELINE_GUTTER) / 2);
        shifted.current = undefined; publish(false);
        // View changes and edge replacement are the only recentering operations.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from.getTime(), view.period, view.date, props.navigationRevision]);
    useLayoutEffect(() => {
        const element = scroll.current; if (element === null) return;
        const observer = new ResizeObserver(() => publish(false)); observer.observe(element); return () => observer.disconnect();
        // Rebind to the current window when it moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from.getTime(), view.period]);
    // Gone — a narrow frame, another layout — the view travels no more: mounted again, it is placed on its date.
    const { travel } = props;
    useEffect(() => () => travel?.set(0), [travel]);
    // Nearing an end of its window, the timeline re-centres on the next window of its grid that way: its scroll moved by
    // what the window moved, so every instant stays where it was — a continuation of what it shows, never a step.
    const onScroll = () => {
        const element = scroll.current; if (element === null || element.clientWidth <= 0) return;
        publish(true);
        const next = recentredView(view, range, element.scrollLeft, element.clientWidth, element.scrollWidth);
        if (next === undefined) return;
        shifted.current = shiftedScroll(element.scrollLeft, range, timelineRange(next), view.period);
        (props.onRecentre ?? props.setView)(next);
    };
    // Each kind of line's estimate, from the first of it to mount: a band's own height, a row's its plot's or its head's.
    const [rowFloor, setRowFloor] = useState(0);
    const [bandFloor, setBandFloor] = useState(BAND_FLOOR);
    const measured = useRef({ band: false, row: false });
    const measureBand = useCallback((el: HTMLElement | null) => {
        if (el === null || measured.current.band) return;
        const px = devicePixels(el.getBoundingClientRect().height);
        if (px <= 0) return;
        measured.current.band = true;
        setBandFloor(px);
    }, []);
    const measureRow = useCallback((el: HTMLElement | null) => {
        if (el === null || measured.current.row) return;
        const head = el.firstElementChild;
        const px = head === null ? 0 : devicePixels(head.getBoundingClientRect().height);
        if (px <= 0) return;
        measured.current.row = true;
        setRowFloor(px);
    }, []);
    const getItemKey = useCallback((i: number) => lines[i]!.key, [lines, rowFloor, bandFloor]); // eslint-disable-line react-hooks/exhaustive-deps -- a new floor re-keys the places
    const estimateSize = useCallback((i: number) => {
        const line = lines[i]!;
        // A row as tall as its plot or its head, whichever is taller, and its rule.
        return line.kind === "group" ? bandFloor : Math.max(layouts.get(line.row.key)?.height ?? laneHeight + 9, rowFloor) + 1;
    }, [lines, layouts, laneHeight, rowFloor, bandFloor]);
    const renderRow = useCallback((i: number) => {
        const line = lines[i]!;
        if (line.kind === "group") return <GroupHeading scope="calendar" group={{ key: line.group, label: line.group || "Unassigned" }} styles={styles} collapsed={collapsed.includes(line.group)} toggle={toggle} measure={measureBand}>
            <Box as="span" css={styles.groupMeta}>{line.count} resources</Box>
        </GroupHeading>;
        return <TimelineRow ctx={ctx} row={line.row} layout={layouts.get(line.row.key)!} span={span} index={i} r={line.r} measure={measureRow} />;
    }, [lines, styles, collapsed, toggle, measureBand, ctx, layouts, span, measureRow]);
    // Where the timeline's view rests (#1398): its top line by key and the px into it, saved as a scroll settles, and
    // brought back once its lines are laid out — the line it left, wherever the lines above it moved.
    const { onAnchor } = props;
    const save = useCallback((at: RowAnchor) => onAnchor?.({ timeline: at }), [onAnchor]);
    const { restore, onAnchorChange } = useRowAnchor(lines, props.anchor?.timeline, save);
    // An event a pick asks to be shown (#1398): its row brought into the view's middle — its group opened, if folded —
    // and its time to the view's centre, which mounts the events there; drawn, the event tells the frame.
    const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number }>();
    useLayoutEffect(() => {
        if (reveal === undefined) return;
        const item = props.items.find(event => eventKey(event) === reveal);
        if (item === undefined || item.start.type !== "some") return;
        const at = lines.findIndex(line => line.kind === "row" && onResource(item, line.row));
        if (at < 0) {
            const row = props.shownRows.find(shown => onResource(item, shown));
            if (row !== undefined && collapsed.includes(row.group)) toggle(row.group);
            return;
        }
        const element = scroll.current;
        if (element !== null && element.clientWidth > 0) {
            const x = (item.start.value.getTime() - range.from.getTime()) / DAY * pixelsPerDay;
            element.scrollLeft = Math.max(0, x - Math.max(0, element.clientWidth - TIMELINE_GUTTER) / 2);
            publish(false);
        }
        setScrollTo(was => ({ index: at, nonce: (was?.nonce ?? 0) + 1 }));
        // A reveal asked, or the events and the lines it is found among landing, is the trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reveal, props.items, lines]);
    const words = useMemo(() => timeWords(format.locale), [format.locale]);
    const ticks = useMemo(() => timeScale({ window: { min: range.from, max: range.to }, resolution: view.period === "day" ? "hour" : "day", words })!, [range.from, range.to, view.period, words]);
    const units = useMemo(() => timeRulerUnits(ticks, words, view.period === "day" ? "day" : view.period === "week" ? "week" : "month")!, [ticks, words, view.period]);
    const header = <Box css={styles.head} data-calendar-header="" data-timeline=""><Box css={styles.headerCaption} data-calendar-header-caption="">Resources</Box><Box css={styles.ruler}>
        <TimeRulerRow scale={units} styles={styles} band="units" owner="calendar" sticky />
        <TimeRulerRow scale={ticks} styles={styles} band="ticks" owner="calendar" sticky />
    </Box></Box>;
    return <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.scroll} scrollElRef={scroll} onScroll={onScroll}
        rootProps={{ "data-calendar-timeline": "", "data-calendar-unread": props.read.state === "held" ? undefined : props.read.state } as Record<string, string | undefined>}
        minWidth={`${width + TIMELINE_GUTTER}px`} headerZIndex={5} header={header} count={lines.length} getItemKey={getItemKey} estimateSize={estimateSize}
        anchorable={ANCHOR_EVERY_LINE} renderRow={renderRow} onAnchorChange={onAnchorChange} restoreAnchor={restore}
        scrollToIndex={scrollTo?.index} scrollNonce={scrollTo?.nonce} scrollAlign="center" />;
}

/**
 * The narrow layout mounts no drag sources, edges, cells or pointer gestures. A period not read yet: each day's group,
 * real, and one placeholder card in it; a period whose read failed says so once, in the first day's card (#1398).
 */
function Agenda(props: CalendarViewsProps) {
    const { read } = props;
    return <Box css={props.styles.scroll} data-calendar-agenda="" data-calendar-unread={read.state === "held" ? undefined : read.state}><Box css={props.styles.agenda}>
        {props.range.days.map((day, d) => {
            const next = new Date(day.getTime() + DAY);
            const items = chronological(props.items.filter(item => inWindow(item, day, next)));
            if (read.state !== "held") return <Box key={day.getTime()} css={props.styles.agendaGroup} data-calendar-day={dateText(day)}>
                <Box css={props.styles.agendaHead} data-calendar-agenda-heading="">{props.format.weekdayDate(day)}</Box>
                <Box css={props.styles.card} data-calendar-unread-card="" data-blank={read.state === "failed" ? "" : undefined} aria-hidden={read.state === "failed" && d === 0 ? undefined : true}>
                    {read.state === "failed" && d === 0 ? <LoadingFailedLine message={read.message} retry={{ onRetry: read.retry }} /> : <Box css={props.styles.cardHead}>
                        <Box css={props.styles.cardTitle}><PlaceholderShape kind="label" index={d} /></Box>
                        <Box css={props.styles.detail}><PlaceholderShape kind="text" index={d + 1} /></Box>
                    </Box>}
                </Box>
            </Box>;
            return <Box key={day.getTime()} css={props.styles.agendaGroup} data-calendar-day={dateText(day)}>
                <Box css={props.styles.agendaHead} data-calendar-agenda-heading="">{props.format.weekdayDate(day)}</Box>
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
                        {props.commands !== undefined && <EventActions item={item} value={props.value} shown={props.shown} commands={props.commands} day={day} styles={props.styles} />}
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
