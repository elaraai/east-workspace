/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Calendar } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useDensity } from "../../contracts/density";

const calendarEqual = equalFor(Calendar.Types.Calendar);

/** East Calendar value type. */
export type CalendarValue = ValueTypeOf<typeof Calendar.Types.Calendar>;

/** East Calendar cell value type. */
export type CalendarCellValue = ValueTypeOf<typeof Calendar.Types.Cell>;

export interface EastChakraCalendarProps {
    value: CalendarValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Number of intensity steps the recipe styles (data-level 0..6). */
const LEVELS = 7;

function formatDelta(delta: number): string {
    const pct = Math.round(delta * 100);
    return pct >= 0 ? `▲ +${pct}%` : `▼ ${pct}%`;
}

/**
 * Renders an East UI Calendar value — the day-of-week × week intensity
 * grid. Visualisation only: selection is local state surfaced through the
 * footer summary and the `onSelect` / `onAction` callbacks.
 */
export const EastChakraCalendar = memo(function EastChakraCalendar({ value }: EastChakraCalendarProps) {
    // Density: the calendar's own field, else an enclosing DensityProvider,
    // else comfortable (#134).
    const inheritedDensity = useDensity();
    const density = getSomeorUndefined(value.density)?.type ?? inheritedDensity ?? "comfortable";
    const styles = useSlotRecipe({ key: "calendar" })({ density }) as SlotStyles;
    const weekColW = density === "condensed" ? "40px" : density === "compact" ? "48px" : "56px";

    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onActionFn = useMemo(() => getSomeorUndefined(value.onAction), [value.onAction]);
    const actionLabel = getSomeorUndefined(value.actionLabel);
    const domain = getSomeorUndefined(value.domain);

    const [selected, setSelected] = useState<{ week: string; day: string } | null>(null);

    // Weeks in first-appearance order; cells keyed week|day.
    const { weeks, cells, min, max } = useMemo(() => {
        const weeks: string[] = [];
        const cells = new Map<string, CalendarCellValue>();
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const cell of value.cells) {
            if (!weeks.includes(cell.week)) weeks.push(cell.week);
            cells.set(`${cell.week} ${cell.day}`, cell);
            if (cell.value < min) min = cell.value;
            if (cell.value > max) max = cell.value;
        }
        if (domain !== undefined) { min = domain.min; max = domain.max; }
        return { weeks, cells, min, max };
    }, [value.cells, domain]);

    const levelOf = useCallback((v: number): number => {
        if (max <= min) return 0;
        const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
        return Math.min(LEVELS - 1, Math.floor(t * LEVELS));
    }, [min, max]);

    const handleSelect = useCallback((week: string, day: string) => {
        setSelected({ week, day });
        if (onSelectFn) queueMicrotask(() => onSelectFn({ week, day }));
    }, [onSelectFn]);

    const handleAction = useCallback(() => {
        if (selected && onActionFn) queueMicrotask(() => onActionFn(selected));
    }, [selected, onActionFn]);

    const selectedCell = selected ? cells.get(`${selected.week} ${selected.day}`) : undefined;
    const selectedSummary = selectedCell ? getSomeorUndefined(selectedCell.summary) : undefined;
    const selectedDelta = selectedCell ? getSomeorUndefined(selectedCell.delta) : undefined;
    const showFooter = selected !== null || actionLabel !== undefined;

    return (
        <Box css={styles.root}>
            <Box css={styles.header}>
                <Box as="span" css={styles.legend}>{value.legend}</Box>
            </Box>
            <Box css={styles.grid} style={{ gridTemplateColumns: `${weekColW} repeat(${WEEK.length}, 1fr)` }}>
                <Box css={styles.dayHeader} />
                {WEEK.map(day => (
                    <Box key={day} css={styles.dayHeader}>{day}</Box>
                ))}
                {weeks.map(week => [
                    <Box key={`${week}-label`} css={styles.weekLabel}>{week}</Box>,
                    ...WEEK.map(day => {
                        const cell = cells.get(`${week} ${day}`);
                        const isSelected = selected?.week === week && selected.day === day;
                        return (
                            <Box
                                key={`${week}-${day}`}
                                css={styles.cell}
                                data-level={cell !== undefined ? levelOf(cell.value) : undefined}
                                {...(cell === undefined ? { "data-empty": "" } : {})}
                                {...(isSelected ? { "data-selected": "" } : {})}
                                onClick={cell !== undefined ? () => handleSelect(week, day) : undefined}
                            >
                                {cell !== undefined ? cell.text : "−"}
                            </Box>
                        );
                    }),
                ])}
            </Box>
            {showFooter && (
                <Box css={styles.footer}>
                    {selected !== null && (
                        <Box as="span" css={styles.summary}>
                            Selected · {selected.day} {selected.week}
                            {selectedSummary !== undefined && ` · ${selectedSummary}`}
                        </Box>
                    )}
                    {selectedDelta !== undefined && (
                        <Box as="span" css={styles.deltaChip} data-tone={selectedDelta >= 0 ? "pos" : "neg"}>
                            {formatDelta(selectedDelta)}
                        </Box>
                    )}
                    {actionLabel !== undefined && (
                        <Box
                            as="button"
                            css={styles.action}
                            marginLeft="auto"
                            onClick={handleAction}
                            {...(selected === null ? { "data-disabled": "" } : {})}
                        >
                            {actionLabel} →
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}, (prev, next) => calendarEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
