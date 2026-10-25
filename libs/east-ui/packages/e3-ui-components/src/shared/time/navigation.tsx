/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Button, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faCaretDown, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { SliceEditPopover, useFormatters } from "@elaraai/east-ui-components";
import { Seg } from "../schedule/segments.js";
import { DAY, dayStart, weekStart } from "../schedule/window.js";
import { isoWeekUTC, shiftCalendar, type TimeResolution } from "./scale.js";
import { useNow } from "./now-line.js";

type Period = TimeResolution;
type Panel = "day" | "week" | "month" | "year" | "range";
const NO_DATES: readonly Date[] = [];
const DAY_WEEK = [{ key: "day", label: "Days" }, { key: "week", label: "Weeks" }] as const;
const DAY_WEEK_RANGE = [...DAY_WEEK, { key: "range", label: "Range" }] as const;
const firstPanel = (period: Period, initial?: "day" | "week"): Panel => period === "year" ? "year" : period === "month" || period === "quarter" ? "month" : initial ?? (period === "week" ? "week" : "day");
const monthStart = (date: number) => { const d = new Date(date); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

/** Internal controlled time navigation. The host retains its Slice, records and view unit. */
export interface TimeNavigatorProps {
    date: number;
    period: Period;
    sunday: boolean;
    onChange: (date: number) => void;
    now?: Date;
    compact?: boolean;
    /** A truthful visible/custom range may replace the anchor's label. */
    rangeLabel?: string | undefined;
    label?: string;
    scope: string;
    /** Weekly records open on their weeks, even while the main shows one day. */
    initialPanel?: "day" | "week";
    /** Read just the open month's week statuses. Closing/unmounting releases them. */
    onWeeks?: (dates: readonly Date[]) => void;
    weekMarker?: (date: Date) => ReactNode;
    /** A mark in each day of the day panel — a day record's status (Published · Draft · Not started), read for the open month through `onWeeks`. */
    dayMarker?: (date: Date) => ReactNode;
    legend?: ReactNode;
    /** Final toolbar fold: view controls share the same reachable popover. */
    controls?: ReactNode;
    /** The host's existing Slice editor; no second range state lives here. */
    rangeEditor?: ReactNode;
    /** Told when Today is pressed, after its date is chosen: a host that shows the time of day brings the now line into view (#1398). */
    onToday?: (() => void) | undefined;
}

/** One date/range trigger between arrows, with the same Today action in every popup. */
export function TimeNavigator({ date, period, sunday, onChange, now: givenNow, compact = false, rangeLabel, label = "Choose date", scope, initialPanel, onWeeks, weekMarker, dayMarker, legend, controls, rangeEditor, onToday }: TimeNavigatorProps) {
    const format = useFormatters();
    const now = useNow(givenNow);
    const recipe = useSlotRecipe({ key: "timeNavigator" });
    const styles = recipe({});
    const [open, setOpen] = useState(false);
    const [month, setMonth] = useState(() => monthStart(date));
    const [panel, setPanel] = useState<Panel>(firstPanel(period, initialPanel));
    const [dayPanel, setDayPanel] = useState<"day" | "week">(initialPanel ?? (period === "week" ? "week" : "day"));
    const current = dayStart(date);
    const start = weekStart(current, sunday);
    const today = dayStart(now).getTime();
    const year = new Date(month).getUTCFullYear();
    const yearBase = Math.floor(year / 12) * 12;
    const weeks = useMemo(() => {
        const first = weekStart(new Date(month), sunday).getTime();
        const end = shiftCalendar(new Date(month), "month", 1).getTime();
        return Array.from({ length: Math.ceil((end - first) / (7 * DAY)) }, (_, i) => new Date(first + i * 7 * DAY));
    }, [month, sunday]);
    useEffect(() => {
        if (!open || (panel !== "day" && panel !== "week") || onWeeks === undefined) return;
        onWeeks(weeks);
        return () => onWeeks(NO_DATES);
    }, [open, panel, weeks, onWeeks]);
    const changeOpen = (next: boolean) => {
        setOpen(next);
        if (next) {
            setMonth(monthStart(date));
            const initial = initialPanel ?? (period === "week" ? "week" : "day");
            setDayPanel(initial); setPanel(firstPanel(period, initial));
        }
    };
    const commit = (next: number) => { onChange(next); setOpen(false); };
    const choose = (next: number) => commit(dayStart(next).getTime() + date - current.getTime());
    const move = (step: number) => commit(shiftCalendar(new Date(date), period, step).getTime());
    const arrows = <>
        <Button size="xs" variant="ghost" aria-label={`Previous ${period}`} onClick={() => move(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Button>
        <Button size="xs" variant="ghost" aria-label={`Next ${period}`} onClick={() => move(1)}><FontAwesomeIcon icon={faChevronRight} /></Button>
    </>;
    const weekLabel = (d: Date) => `W${format.number(isoWeekUTC(new Date(d.getTime() + 3 * DAY)))} · ${format.range(d, new Date(d.getTime() + 6 * DAY))}`;
    const fullLabel = rangeLabel ?? (period === "hour" ? format.dateTime(new Date(date)) : period === "day" ? format.weekdayDate(current) : period === "week" ? weekLabel(start) : period === "year" ? format.year(current) : format.monthYear(current));
    const shortLabel = period === "hour" || period === "day" ? format.monthDay(current) : period === "week" ? `W${format.number(isoWeekUTC(new Date(start.getTime() + 3 * DAY)))}` : period === "year" ? format.year(current) : `${format.month(current)} ${format.year(current)}`;
    const browse = (step: number) => setMonth(shiftCalendar(new Date(month), panel === "year" || panel === "month" ? "year" : "month", step * (panel === "year" ? 12 : 1)).getTime());
    const heading = panel === "year" ? `${format.year(new Date(Date.UTC(yearBase, 0, 1)))}–${format.year(new Date(Date.UTC(yearBase + 11, 0, 1)))}` : panel === "month" ? format.year(new Date(month)) : format.monthYear(new Date(month));
    // In the toolbar's row, the trigger and the arrows beside it stand as tall as every control there (`sm`, 28px, ruled
    // 23 Oct 2026); the popover's own buttons keep its density.
    const picker = <SliceEditPopover open={open} onOpenChange={changeOpen} label={label}
        trigger={<Button size="sm" variant="ghost" css={styles.trigger} aria-label={label} title={fullLabel} data-time-trigger="">
            {compact && controls !== undefined ? <FontAwesomeIcon icon={faCalendarWeek} /> : <><Box as="span" css={styles.label} data-time-label="">{compact ? shortLabel : fullLabel}</Box><FontAwesomeIcon icon={faCaretDown} /></>}
        </Button>}
        footLeft={<Box css={styles.footer}>{arrows}</Box>}
        footActions={<Button size="xs" variant="solid" onClick={() => { choose(today); onToday?.(); }}>Today</Button>}>
        <Box css={styles.body} data-time-picker={scope} data-time-panel={panel}>
            {panel !== "range" && <Box css={styles.header}>
                <Button size="xs" variant="ghost" aria-label={`Previous ${panel === "year" ? "12 years" : panel === "month" ? "year" : "month"}`} onClick={() => browse(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Button>
                <Button size="xs" variant="ghost" css={styles.heading} aria-label={panel === "year" ? "Choose month" : panel === "month" ? "Choose year" : "Choose month"} onClick={() => setPanel(panel === "month" ? "year" : "month")}>{heading}<FontAwesomeIcon icon={faCaretDown} /></Button>
                <Button size="xs" variant="ghost" aria-label={`Next ${panel === "year" ? "12 years" : panel === "month" ? "year" : "month"}`} onClick={() => browse(1)}><FontAwesomeIcon icon={faChevronRight} /></Button>
            </Box>}
            {(panel === "day" || panel === "week" || rangeEditor !== undefined) && <Seg label="Choose by" name="picker-unit" scope={scope} fullWidth items={rangeEditor === undefined ? DAY_WEEK : DAY_WEEK_RANGE} active={panel} onPick={next => { if (next !== "range") setDayPanel(next); setPanel(next); }} />}
            {panel === "range" && rangeEditor}
            {panel === "week" && <Box css={styles.weeks}>{weeks.map(week => <chakra.button key={week.getTime()} type="button" css={styles.week}
                {...{ [`data-${scope}-picker-week`]: week.toISOString().slice(0, 10) }} data-time-week={week.getTime()}
                data-selected={week.getTime() === start.getTime() ? "" : undefined} aria-pressed={week.getTime() === start.getTime()}
                aria-current={week.getTime() === weekStart(now, sunday).getTime() ? "date" : undefined}
                onClick={() => choose(week.getTime() + current.getTime() - start.getTime())}>
                {weekMarker?.(week)}{weekLabel(week)}
            </chakra.button>)}</Box>}
            {panel === "day" && <Box css={styles.days}>
                {Array.from({ length: 7 }, (_, i) => <Box key={i} css={styles.weekday}>{format.weekday(new Date(weeks[0]!.getTime() + i * DAY))}</Box>)}
                {weeks.flatMap(week => Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY))).map(day => <chakra.button key={day.getTime()} type="button" css={styles.day}
                    aria-label={format.weekdayDate(day)} aria-pressed={day.getTime() === current.getTime()} aria-current={day.getTime() === today ? "date" : undefined}
                    data-time-day={day.getTime()} data-selected={day.getTime() === current.getTime() ? "" : undefined} data-outside={day.getUTCMonth() !== new Date(month).getUTCMonth() ? "" : undefined}
                    onClick={() => choose(day.getTime())}>{format.number(day.getUTCDate())}
                    {dayMarker !== undefined && <Box as="span" css={styles.dayMark} data-time-daymark="">{dayMarker(day)}</Box>}</chakra.button>)}
            </Box>}
            {panel === "month" && <Box css={styles.choices}>{Array.from({ length: 12 }, (_, i) => <chakra.button key={i} type="button" css={styles.choice}
                aria-label={format.monthYear(new Date(Date.UTC(year, i, 1)))} data-time-month={i}
                data-selected={current.getUTCFullYear() === year && current.getUTCMonth() === i ? "" : undefined}
                onClick={() => {
                    if (period === "month" || period === "quarter") choose(shiftCalendar(current, "month", (year - current.getUTCFullYear()) * 12 + i - current.getUTCMonth()).getTime());
                    else { setMonth(Date.UTC(year, i, 1)); setPanel(dayPanel); }
                }}>{format.month(new Date(Date.UTC(year, i, 1)))}</chakra.button>)}</Box>}
            {panel === "year" && <Box css={styles.choices}>{Array.from({ length: 12 }, (_, i) => yearBase + i).map(y => <chakra.button key={y} type="button" css={styles.choice}
                data-selected={current.getUTCFullYear() === y ? "" : undefined} onClick={() => { if (period === "year") choose(shiftCalendar(current, "year", y - current.getUTCFullYear()).getTime()); else { setMonth(Date.UTC(y, new Date(month).getUTCMonth(), 1)); setPanel("month"); } }}>{format.year(new Date(Date.UTC(y, 0, 1)))}</chakra.button>)}</Box>}
            {(panel === "week" || (panel === "day" && dayMarker !== undefined)) && legend !== undefined && <Box css={styles.legend}>{legend}</Box>}
            {controls !== undefined && <Box css={styles.controls}>{controls}</Box>}
        </Box>
    </SliceEditPopover>;
    return <Box css={styles.root} data-time-navigation={scope} data-time-period={period} data-time-anchor={date}>
        {!compact && <Button size="sm" variant="ghost" aria-label={`Previous ${period}`} onClick={() => move(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Button>}
        {picker}
        {!compact && <Button size="sm" variant="ghost" aria-label={`Next ${period}`} onClick={() => move(1)}><FontAwesomeIcon icon={faChevronRight} /></Button>}
    </Box>;
}
