/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo, useState, useCallback } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Planner } from "@elaraai/east-ui";
import { PlannerEvent } from "./PlannerEvent";
import { PlannerSlotCell } from "./PlannerSlotCell";

export type PlannerEventValue = ValueTypeOf<typeof Planner.Types.Event>;
export type PlannerRowValue = ValueTypeOf<typeof Planner.Types.Row>;

// Re-export PlannerEventValue for external consumers
export type { PlannerEventValue as PlannerEventValueExport } from "./PlannerEvent";

export interface PlannerEventRowProps {
    events: PlannerEventValue[];
    storageKey: string;
    rowIndex: number;
    y: number;
    width: number;
    height: number;
    slotWidth: number;
    slotRangeStart: number;
    slotMode: "single" | "span";
    slotCount: number;
    minSlot?: number;
    maxSlot?: number;
    stepSize?: number;
    /** Visual-token defaults from Planner `style` (per-event overrides win). */
    eventBorderRadius?: string | undefined;
    labelColor?: string | undefined;
    labelFontSize?: string | undefined;
    labelFontWeight?: string | undefined;
    onEventClick?: ((event: PlannerEventValue, rowIndex: number, eventIndex: number) => void) | undefined;
    onEventDoubleClick?: ((event: PlannerEventValue, rowIndex: number, eventIndex: number) => void) | undefined;
    onEventDrag?: ((rowIndex: number, eventIndex: number, previousStart: number, previousEnd: number, newStart: number, newEnd: number) => void) | undefined;
    onEventResize?: ((rowIndex: number, eventIndex: number, previousStart: number, previousEnd: number, newStart: number, newEnd: number, edge: "start" | "end") => void) | undefined;
    onEventEdit?: ((event: PlannerEventValue, rowIndex: number, eventIndex: number) => void) | undefined;
    onEventDelete?: ((event: PlannerEventValue, rowIndex: number, eventIndex: number) => void) | undefined;
    onSlotClick?: ((slot: number) => void) | undefined;
}

export const PlannerEventRow = ({
    events,
    storageKey,
    rowIndex,
    y,
    height,
    slotWidth,
    slotRangeStart,
    slotMode,
    slotCount,
    minSlot,
    maxSlot,
    stepSize,
    eventBorderRadius,
    labelColor,
    labelFontSize,
    labelFontWeight,
    onEventClick,
    onEventDoubleClick,
    onEventDrag,
    onEventResize,
    onEventEdit,
    onEventDelete,
    onSlotClick,
}: PlannerEventRowProps) => {
    // Track which event is being hovered to dim others
    const [hoveredEventIndex, setHoveredEventIndex] = useState<number | null>(null);

    const handleEventHoverStart = useCallback((eventIndex: number) => {
        setHoveredEventIndex(eventIndex);
    }, []);

    const handleEventHoverEnd = useCallback(() => {
        setHoveredEventIndex(null);
    }, []);

    // Render slot cells only for unoccupied slots (sub-divided by stepSize)
    const renderedSlotCells = useMemo(() => {
        const cells = [];
        const effectiveStepSize = stepSize ?? 1;
        const subSlotWidth = slotWidth * effectiveStepSize;
        const subSlotCount = Math.ceil(slotCount / effectiveStepSize);

        for (let i = 0; i < subSlotCount; i++) {
            const slot = slotRangeStart + (i * effectiveStepSize);
            // Skip slots that have events (check the whole slot this sub-slot belongs to)

            const x = i * subSlotWidth;
            cells.push(
                <PlannerSlotCell
                    key={`slot-${slot}`}
                    x={x}
                    y={y}
                    width={subSlotWidth}
                    height={height}
                    slot={slot}
                    onClick={onSlotClick}
                />
            );
        }
        return cells;
    }, [onSlotClick, slotCount, slotRangeStart, slotWidth, stepSize, y, height]);

    const renderedEvents = useMemo(() => {
        const eventHeight = height - 12;
        const eventY = y + 6;
        const slotRangeEnd = slotRangeStart + slotCount;

        return events.map((event, eventIndex) => {
            // Check if event is visible in the current slot range
            const eventStart = event.start;
            if (eventStart < slotRangeStart || eventStart >= slotRangeEnd) return null;

            // Dim this event if another event in the row is hovered
            const isDimmed = hoveredEventIndex !== null && hoveredEventIndex !== eventIndex;

            return (
                <PlannerEvent
                    key={`${rowIndex}-${eventIndex}`}
                    value={event}
                    storageKey={`${storageKey}.${rowIndex}.${eventIndex}`}
                    rowIndex={rowIndex}
                    eventIndex={eventIndex}
                    y={eventY}
                    height={eventHeight}
                    slotWidth={slotWidth}
                    slotRangeStart={slotRangeStart}
                    slotMode={slotMode}
                    minSlot={minSlot}
                    maxSlot={maxSlot}
                    stepSize={stepSize}
                    eventBorderRadius={eventBorderRadius}
                    labelColor={labelColor}
                    labelFontSize={labelFontSize}
                    labelFontWeight={labelFontWeight}
                    isDimmed={isDimmed}
                    onClick={onEventClick ? () => onEventClick(event, rowIndex, eventIndex) : undefined}
                    onDoubleClick={onEventDoubleClick ? () => onEventDoubleClick(event, rowIndex, eventIndex) : undefined}
                    onDrag={onEventDrag ? (prevStart, prevEnd, newStart, newEnd) => onEventDrag(rowIndex, eventIndex, prevStart, prevEnd, newStart, newEnd) : undefined}
                    onResize={onEventResize ? (prevStart, prevEnd, newStart, newEnd, edge) => onEventResize(rowIndex, eventIndex, prevStart, prevEnd, newStart, newEnd, edge) : undefined}
                    onEdit={onEventEdit ? () => onEventEdit(event, rowIndex, eventIndex) : undefined}
                    onDelete={onEventDelete ? () => onEventDelete(event, rowIndex, eventIndex) : undefined}
                    onHoverStart={() => handleEventHoverStart(eventIndex)}
                    onHoverEnd={handleEventHoverEnd}
                />
            );
        }).filter(Boolean);
    }, [
        events, storageKey, rowIndex, y, height, slotWidth, slotRangeStart, slotMode,
        slotCount, minSlot, maxSlot, stepSize,
        eventBorderRadius, labelColor, labelFontSize, labelFontWeight,
        hoveredEventIndex, handleEventHoverStart, handleEventHoverEnd,
        onEventClick, onEventDoubleClick, onEventDrag, onEventResize, onEventEdit, onEventDelete,
    ]);
    return (
        <g>
            {renderedSlotCells}
            {renderedEvents}
        </g>
    );
};
