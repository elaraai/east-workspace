/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";

export interface EventAxisProps {
    startDate: Date;
    endDate: Date;
    width: number;
    height: number;
    /**
     * The `table` slot recipe's `columnHeader` style object — the same one the
     * left table-pane consumes, so the month header reads identically to a
     * Table column header (mono / 10px / 0.16em / uppercase eyebrow).
     */
    columnHeaderStyles: SystemStyleObject;
}

export const generateDateTicks = (startDate: Date, endDate: Date, maxTicks: number = 8): Date[] => {
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const tickInterval = Math.max(1, Math.ceil(totalDays / maxTicks));

    const ticks: Date[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
        ticks.push(new Date(current));
        current.setDate(current.getDate() + tickInterval);
    }

    return ticks;
};

export const getDatePosition = (date: Date, startDate: Date, endDate: Date, width: number): number => {
    const totalTimeDiff = endDate.getTime() - startDate.getTime();
    const currentTimeDiff = date.getTime() - startDate.getTime();
    const ratio = currentTimeDiff / totalTimeDiff;
    return ratio * width;
};

export const EventAxis = ({
    startDate,
    endDate,
    width,
    height,
    columnHeaderStyles,
}: EventAxisProps) => {
    // Month-scale header: one cell per calendar month spanning [start, end],
    // each positioned by its month-boundary x so it aligns with the timeline.
    const months = useMemo(() => {
        const cells: { label: string; x0: number; x1: number }[] = [];
        const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        while (cursor <= endDate) {
            const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            const from = cursor < startDate ? startDate : cursor;
            const to = next > endDate ? endDate : next;
            cells.push({
                label: cursor.toLocaleDateString("en-US", { month: "short" }),
                x0: getDatePosition(from, startDate, endDate, width),
                x1: getDatePosition(to, startDate, endDate, width),
            });
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return cells;
    }, [startDate, endDate, width]);

    return (
        <Box position="relative" width="100%" height={`${height}px`}>
            {months.map((m, index) => (
                <Box
                    key={`month-${index}`}
                    position="absolute"
                    left={`${m.x0}px`}
                    width={`${Math.max(m.x1 - m.x0, 0)}px`}
                    height="100%"
                    color="gray.500"
                    css={columnHeaderStyles}
                >
                    {m.label}
                </Box>
            ))}
        </Box>
    );
};
