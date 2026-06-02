/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Gantt } from "@elaraai/east-ui";
import { GanttTask, type TimeStep } from "./GanttTask";
import { GanttMilestone } from "./GanttMilestone";

export type GanttTaskValue = ValueTypeOf<typeof Gantt.Types.Task>;
export type GanttMilestoneValue = ValueTypeOf<typeof Gantt.Types.Milestone>;
export type GanttRowValue = ValueTypeOf<typeof Gantt.Types.Row>;

export interface GanttEventRowProps {
    tasks: GanttTaskValue[];
    milestones: GanttMilestoneValue[];
    rowIndex: number;
    y: number;
    width: number;
    height: number;
    startDate: Date;
    endDate: Date;
    onTaskClick?: ((task: GanttTaskValue, rowIndex: number, taskIndex: number) => void) | undefined;
    onTaskDoubleClick?: ((task: GanttTaskValue, rowIndex: number, taskIndex: number) => void) | undefined;
    onMilestoneClick?: ((milestone: GanttMilestoneValue, rowIndex: number, milestoneIndex: number) => void) | undefined;
    onMilestoneDoubleClick?: ((milestone: GanttMilestoneValue, rowIndex: number, milestoneIndex: number) => void) | undefined;
    /** Callback when a task is dragged */
    onTaskDrag?: ((rowIndex: number, taskIndex: number, previousStart: Date, previousEnd: Date, newStart: Date, newEnd: Date) => void) | undefined;
    /** Callback when a task duration is changed (dragging the end) */
    onTaskDurationChange?: ((rowIndex: number, taskIndex: number, previousEnd: Date, newEnd: Date) => void) | undefined;
    /** Callback when task progress is changed (dragging the progress handle) */
    onTaskProgressChange?: ((rowIndex: number, taskIndex: number, previousProgress: number, newProgress: number) => void) | undefined;
    /** Callback when a milestone is dragged */
    onMilestoneDrag?: ((rowIndex: number, milestoneIndex: number, previousDate: Date, newDate: Date) => void) | undefined;
    /** Optional step size for drag snapping */
    dragStep?: TimeStep | undefined;
    /** Optional step size for duration change snapping */
    durationStep?: TimeStep | undefined;
    /** Storage key prefix for per-task / per-milestone UIComp slots. */
    storageKey?: string | undefined;
}

interface TaskPosition {
    x: number;
    width: number;
}

interface MilestonePosition {
    x: number;
}

const getTaskPosition = (
    task: GanttTaskValue,
    startDate: Date,
    endDate: Date,
    width: number,
): TaskPosition => {
    const totalTimespan = endDate.getTime() - startDate.getTime();
    const eventStart = task.start;
    const eventEnd = task.end;

    const clampedStart = Math.max(eventStart.getTime(), startDate.getTime());
    const clampedEnd = Math.min(eventEnd.getTime(), endDate.getTime());

    const startOffset = (clampedStart - startDate.getTime()) / totalTimespan;
    const duration = (clampedEnd - clampedStart) / totalTimespan;

    return {
        x: startOffset * width,
        width: Math.max(duration * width, 2),
    };
};

const getMilestonePosition = (
    milestone: GanttMilestoneValue,
    startDate: Date,
    endDate: Date,
    width: number,
): MilestonePosition | null => {
    const totalTimespan = endDate.getTime() - startDate.getTime();
    const eventDate = milestone.date;
    const eventTime = eventDate.getTime();

    if (eventTime < startDate.getTime() || eventTime > endDate.getTime()) {
        return null;
    }

    const position = (eventTime - startDate.getTime()) / totalTimespan;
    return { x: position * width };
};

export const GanttEventRow = ({
    tasks,
    milestones,
    rowIndex,
    y,
    width,
    height,
    startDate,
    endDate,
    onTaskClick,
    onTaskDoubleClick,
    onMilestoneClick,
    onMilestoneDoubleClick,
    onTaskDrag,
    onTaskDurationChange,
    onTaskProgressChange,
    onMilestoneDrag,
    dragStep,
    durationStep,
    storageKey = "gantt",
}: GanttEventRowProps) => {
    const renderedEvents = useMemo(() => {
        // Bar band centred in the row, derived from the row height (≈ row − 12px
        // for ~6px breathing room top/bottom) so it scales with density instead
        // of packing a fixed 26px into a short row. Clamped 16–26px for legibility.
        const eventHeight = Math.min(26, Math.max(16, height - 12));
        const eventY = y + (height - eventHeight) / 2;

        const renderedTasks = tasks.map((task, taskIndex) => {
            const position = getTaskPosition(task, startDate, endDate, width);
            if (position.x < 0 || position.x > width) return null;

            return (
                <GanttTask
                    key={`task-${rowIndex}-${taskIndex}`}
                    x={position.x}
                    y={eventY}
                    width={position.width}
                    height={eventHeight}
                    value={task}
                    storageKey={`${storageKey}.${rowIndex}.task.${taskIndex}`}
                    onClick={onTaskClick ? () => onTaskClick(task, rowIndex, taskIndex) : undefined}
                    onDoubleClick={onTaskDoubleClick ? () => onTaskDoubleClick(task, rowIndex, taskIndex) : undefined}
                    onDrag={onTaskDrag ? (prevStart, prevEnd, newStart, newEnd) => onTaskDrag(rowIndex, taskIndex, prevStart, prevEnd, newStart, newEnd) : undefined}
                    onDurationChange={onTaskDurationChange ? (prevEnd, newEnd) => onTaskDurationChange(rowIndex, taskIndex, prevEnd, newEnd) : undefined}
                    onProgressChange={onTaskProgressChange ? (prevProgress, newProgress) => onTaskProgressChange(rowIndex, taskIndex, prevProgress, newProgress) : undefined}
                    timelineStartDate={startDate}
                    timelineEndDate={endDate}
                    timelineWidth={width}
                    dragStep={dragStep}
                    durationStep={durationStep}
                />
            );
        });

        const renderedMilestones = milestones.map((milestone, milestoneIndex) => {
            const position = getMilestonePosition(milestone, startDate, endDate, width);
            if (position === null) return null;

            return (
                <GanttMilestone
                    key={`milestone-${rowIndex}-${milestoneIndex}`}
                    x={position.x}
                    y={eventY}
                    height={eventHeight}
                    value={milestone}
                    storageKey={`${storageKey}.${rowIndex}.milestone.${milestoneIndex}`}
                    onClick={onMilestoneClick ? () => onMilestoneClick(milestone, rowIndex, milestoneIndex) : undefined}
                    onDoubleClick={onMilestoneDoubleClick ? () => onMilestoneDoubleClick(milestone, rowIndex, milestoneIndex) : undefined}
                    onDrag={onMilestoneDrag ? (prevDate, newDate) => onMilestoneDrag(rowIndex, milestoneIndex, prevDate, newDate) : undefined}
                    timelineStartDate={startDate}
                    timelineEndDate={endDate}
                    timelineWidth={width}
                />
            );
        });

        return [...renderedTasks, ...renderedMilestones].filter(Boolean);
    }, [tasks, milestones, rowIndex, y, width, height, startDate, endDate, onTaskClick, onTaskDoubleClick, onMilestoneClick, onMilestoneDoubleClick, onTaskDrag, onTaskDurationChange, onTaskProgressChange, onMilestoneDrag, dragStep, durationStep, storageKey]);

    return <g>{renderedEvents}</g>;
};
