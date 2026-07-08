/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Box, Popover, Portal, Text, useToken } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical } from "@fortawesome/free-solid-svg-icons";
import { useDrag } from "@use-gesture/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Gantt } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { alignToCss } from "../shared/helpers";
import { ganttStateKey, GANTT_STATE_COLOR, GANTT_STATUS_TINT, GANTT_STATE_DASH, GANTT_STATE_OPACITY, GANTT_STATE_STRIKE } from "./palette";

export type GanttTaskValue = ValueTypeOf<typeof Gantt.Types.Task>;

/** Time step configuration for snapping */
export interface TimeStep {
    type: "minutes" | "hours" | "days" | "weeks" | "months";
    value: number;
}

export interface GanttTaskProps {
    x: number;
    y: number;
    width: number;
    height: number;
    value: GanttTaskValue;
    /** Storage key used by the per-task popover UIComp slot. */
    storageKey?: string | undefined;
    onClick?: (() => void) | undefined;
    onDoubleClick?: (() => void) | undefined;
    /** Callback when task is dragged to a new position */
    onDrag?: ((previousStart: Date, previousEnd: Date, newStart: Date, newEnd: Date) => void) | undefined;
    /** Callback when task duration is changed (dragging the end) */
    onDurationChange?: ((previousEnd: Date, newEnd: Date) => void) | undefined;
    /** Callback when task progress is changed (dragging the progress handle) */
    onProgressChange?: ((previousProgress: number, newProgress: number) => void) | undefined;
    /** Start date of the timeline (for position-to-date conversion) */
    timelineStartDate?: Date | undefined;
    /** End date of the timeline (for position-to-date conversion) */
    timelineEndDate?: Date | undefined;
    /** Width of the timeline in pixels (for position-to-date conversion) */
    timelineWidth?: number | undefined;
    /** Optional step size for drag snapping */
    dragStep?: TimeStep | undefined;
    /** Optional step size for duration change snapping */
    durationStep?: TimeStep | undefined;
}

/** Convert a time step to milliseconds */
const timeStepToMs = (step: TimeStep): number => {
    switch (step.type) {
        case "minutes": return step.value * 60 * 1000;
        case "hours": return step.value * 60 * 60 * 1000;
        case "days": return step.value * 24 * 60 * 60 * 1000;
        case "weeks": return step.value * 7 * 24 * 60 * 60 * 1000;
        case "months": return step.value * 30 * 24 * 60 * 60 * 1000;
    }
};

/** Snap a date to the nearest step */
const snapToStep = (date: Date, step: TimeStep | undefined): Date => {
    if (!step) return date;
    const ms = timeStepToMs(step);
    const snapped = Math.round(date.getTime() / ms) * ms;
    return new Date(snapped);
};

export const GanttTask = ({
    x,
    y,
    width,
    height,
    value,
    storageKey = "task",
    onClick,
    onDoubleClick,
    onDrag,
    onDurationChange,
    onProgressChange,
    timelineStartDate,
    timelineEndDate,
    timelineWidth,
    dragStep,
    durationStep,
}: GanttTaskProps) => {
    const [isHovered, setIsHovered] = useState(false);
    // In-progress drag offsets (px). null when not dragging that axis.
    const [dragOffset, setDragOffset] = useState<number | null>(null);
    const [durationOffset, setDurationOffset] = useState<number | null>(null);
    const [progressDelta, setProgressDelta] = useState<number | null>(null);
    // Local position/width state - reset from props, updated on drag end
    const [position, setPosition] = useState({ x, width });
    const [popoverOpen, setPopoverOpen] = useState(false);
    const taskRectRef = useRef<SVGRectElement>(null);

    // Per-task label config (now a LabelInput value with align/typography fields)
    const li = getSomeorUndefined(value.label);
    const labelProps = li ? {
        value: li.value,
        align: getSomeorUndefined(li.align)?.type ?? "start",
        verticalAlign: getSomeorUndefined(li.verticalAlign)?.type ?? "center",
        color: getSomeorUndefined(li.color),
        fontWeight: getSomeorUndefined(li.fontWeight)?.type,
        fontStyle: getSomeorUndefined(li.fontStyle)?.type,
        fontSize: getSomeorUndefined(li.fontSize)?.type,
    } : null;

    // Two-axis grammar (#262): the shared lifecycle `state` picks the bar
    // TREATMENT (solid / dashed / ghost / strike) + base colour; the optional
    // risk `status` tints the colour only (the old at-risk red).
    const stateTag = ganttStateKey(value.state);
    const riskTag = getSomeorUndefined(value.status)?.type;
    const propsProgress = getSomeorUndefined(value.progress);

    // Per-task popover slot (click-triggered).
    const popoverContent = getSomeorUndefined(value.popover);
    const hasPopover = popoverContent !== undefined;

    // Local progress state - reset from props, updated on drag end
    const [localProgress, setLocalProgress] = useState(propsProgress ?? 0);

    // Reset position when x or width changes externally (e.g., from store update after callback)
    useEffect(() => {
        setPosition({ x, width });
    }, [x, width]);

    // Reset local progress when props change externally
    useEffect(() => {
        setLocalProgress(propsProgress ?? 0);
    }, [propsProgress]);

    // Spec bar = a paper-2 track + 1px status border + a status-coloured
    // progress fill. Resolve the status colour + track from semantic tokens.
    // statusColor: bar border + progress fill. trackBg: paper-2 track.
    // resizeLineColor: the resize line (border.strong reads on the light track;
    // the spec's white would vanish). The drag grip is a FontAwesome icon whose
    // colour comes from the wrapper's `color` token (fg.subtle = ink-4).
    const [statusColor, trackBg, resizeLineColor] = useToken("colors", [
        (riskTag !== undefined ? GANTT_STATUS_TINT[riskTag] : undefined) ?? GANTT_STATE_COLOR[stateTag] ?? "fg.success",
        "bg.canvas", "border.strong",
    ]);
    const stateDash = GANTT_STATE_DASH[stateTag];
    const stateOpacity = GANTT_STATE_OPACITY[stateTag];
    const stateStrike = GANTT_STATE_STRIKE[stateTag];

    // Calculate current position from local state + drag offset
    const currentX = position.x + (dragOffset ?? 0);
    const currentWidth = Math.max(position.width + (durationOffset ?? 0), 4);
    const taskWidth = Math.max(currentWidth, 4);

    // Bar label = spec mono 11px / 600; per-task `label.fontSize` still wins.
    const fontSize = labelProps?.fontSize ?? "11px";
    // Spec task bar corner radius.
    const radius = 2;

    const currentProgress = progressDelta ?? localProgress;
    const progressWidth = taskWidth * (currentProgress / 100);

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => {
        if (dragOffset === null && durationOffset === null && progressDelta === null) setIsHovered(false);
    }, [dragOffset, durationOffset, progressDelta]);

    // Convert pixel offset to duration offset in milliseconds
    const offsetToDuration = useCallback((pixelOffset: number): number => {
        if (!timelineStartDate || !timelineEndDate || !timelineWidth) return 0;
        const totalDuration = timelineEndDate.getTime() - timelineStartDate.getTime();
        return (pixelOffset / timelineWidth) * totalDuration;
    }, [timelineStartDate, timelineEndDate, timelineWidth]);

    const durationToOffset = useCallback((durationMs: number): number => {
        if (!timelineStartDate || !timelineEndDate || !timelineWidth) return 0;
        const totalDuration = timelineEndDate.getTime() - timelineStartDate.getTime();
        return (durationMs / totalDuration) * timelineWidth;
    }, [timelineStartDate, timelineEndDate, timelineWidth]);

    // Committed history and rejected records are read-only / resize-locked
    // per spec — only proposed bars (added / model / removed drafts) are
    // editable, regardless of wired callbacks.
    const isEditable = stateTag === "proposedAdded" || stateTag === "proposedModel" || stateTag === "proposedRemoved";
    const isDraggable = isEditable && onDrag && timelineStartDate && timelineEndDate && timelineWidth;
    const isDurationDraggable = isEditable && onDurationChange && timelineStartDate && timelineEndDate && timelineWidth;
    const isProgressDraggable = isEditable && onProgressChange && propsProgress !== undefined;

    // Snap a raw pixel offset to the nearest tick of `step`. Returns the
    // snapped pixel offset.
    const snapPxToStep = useCallback((rawPx: number, anchor: Date, step: TimeStep | undefined): number => {
        if (!step || !timelineWidth || !timelineStartDate || !timelineEndDate) return rawPx;
        const durMs = offsetToDuration(rawPx);
        const snapped = snapToStep(new Date(anchor.getTime() + durMs), step);
        return durationToOffset(snapped.getTime() - anchor.getTime());
    }, [timelineWidth, timelineStartDate, timelineEndDate, offsetToDuration, durationToOffset]);

    // Main drag — moves the whole task bar. Click distinguishes via
    // `tap`; commit on `last` fires `onDrag` with snapped boundaries.
    const bindDrag = useDrag(({ active, movement: [mx], tap, last, first }) => {
        if (first) setIsHovered(true);
        if (tap) {
            if (onClick) onClick();
            if (hasPopover) setPopoverOpen(prev => !prev);
            setDragOffset(null);
            setIsHovered(false);
            return;
        }
        if (last) {
            if (isDraggable && timelineWidth) {
                const snappedPx = snapPxToStep(mx, value.start, dragStep);
                const newStart = snapToStep(new Date(value.start.getTime() + offsetToDuration(snappedPx)), dragStep);
                const newEnd = snapToStep(new Date(value.end.getTime() + offsetToDuration(snappedPx)), dragStep);
                setPosition(prev => ({ ...prev, x: prev.x + snappedPx }));
                if (onDrag) onDrag(value.start, value.end, newStart, newEnd);
            }
            setDragOffset(null);
            setIsHovered(false);
            return;
        }
        if (active && isDraggable) {
            setDragOffset(snapPxToStep(mx, value.start, dragStep));
        }
    }, { filterTaps: true, preventDefault: true });

    // Duration drag — right-edge resize handle. No tap path because the
    // handle has no click semantics.
    const bindDuration = useDrag(({ active, movement: [mx], last }) => {
        if (last) {
            if (isDurationDraggable && timelineWidth) {
                const snappedPx = snapPxToStep(mx, value.end, durationStep);
                const newEnd = snapToStep(new Date(value.end.getTime() + offsetToDuration(snappedPx)), durationStep);
                setPosition(prev => ({ ...prev, width: prev.width + snappedPx }));
                if (onDurationChange) onDurationChange(value.end, newEnd);
            }
            setDurationOffset(null);
            setIsHovered(false);
            return;
        }
        if (active && isDurationDraggable) {
            setDurationOffset(snapPxToStep(mx, value.end, durationStep));
        }
    }, { preventDefault: true });

    // Progress drag — horizontal handle that adjusts a 0..100 percentage.
    const bindProgress = useDrag(({ active, movement: [mx], last }) => {
        if (last) {
            if (isProgressDraggable) {
                const pct = (mx / taskWidth) * 100;
                const newProgress = Math.max(0, Math.min(100, localProgress + pct));
                setLocalProgress(newProgress);
                if (onProgressChange) onProgressChange(localProgress, newProgress);
            }
            setProgressDelta(null);
            setIsHovered(false);
            return;
        }
        if (active && isProgressDraggable) {
            const pct = (mx / taskWidth) * 100;
            setProgressDelta(Math.max(0, Math.min(100, localProgress + pct)));
        }
    }, { preventDefault: true });

    const handleDoubleClick = useCallback(() => {
        if (onDoubleClick && dragOffset === null && durationOffset === null) {
            onDoubleClick();
        }
    }, [onDoubleClick, dragOffset, durationOffset]);

    const cursor = dragOffset !== null
        ? "grabbing"
        : isDraggable
            ? "grab"
            : (onClick || onDoubleClick || hasPopover ? "pointer" : "default");
    const isActive = isHovered || dragOffset !== null || durationOffset !== null || progressDelta !== null;

    const getAnchorRect = useCallback(() => {
        if (taskRectRef.current) {
            return taskRectRef.current.getBoundingClientRect();
        }
        return { x: 0, y: 0, width: 0, height: 0 };
    }, []);

    return (
        <g>
            <rect
                ref={taskRectRef}
                x={currentX}
                y={y}
                width={taskWidth}
                height={height}
                fill={stateTag === "proposedModel" ? "transparent" : trackBg}
                stroke={statusColor}
                strokeWidth={1}
                strokeDasharray={stateDash}
                opacity={(isActive ? 1 : 0.9) * stateOpacity}
                rx={radius}
                ry={radius}
                onDoubleClick={handleDoubleClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                {...bindDrag()}
                style={{ cursor, touchAction: "none" }}
            />

            {/* Progress indicator */}
            {propsProgress !== undefined && (
                <rect
                    x={currentX}
                    y={y}
                    width={progressWidth}
                    height={height}
                    fill={statusColor}
                    opacity={stateOpacity}
                    rx={radius}
                    ry={radius}
                    style={{ pointerEvents: "none" }}
                />
            )}

            {/* Strike line — proposed deletions + rejected records read as
                struck-through (the shared removed/rejected treatment). */}
            {stateStrike && (
                <line
                    x1={currentX + 2}
                    x2={currentX + taskWidth - 2}
                    y1={y + height / 2}
                    y2={y + height / 2}
                    stroke={statusColor}
                    strokeWidth={1.5}
                    opacity={0.9}
                    style={{ pointerEvents: "none" }}
                />
            )}

            {/* Drag grip — FontAwesome grip at the bar's left, before the
                label (the spec's ⠿). Hover-revealed (opacity tied to isActive).
                Colour adapts like the label: white when it sits on the status
                progress fill, gray.500 (ink-4) when on the empty light track —
                so it never blends into the fill. Decorative only: the whole-bar
                bindDrag() owns the drag. */}
            {isDraggable && (
                <foreignObject
                    x={currentX + 4}
                    y={y + height / 2 - 6}
                    width={12}
                    height={12}
                    style={{ pointerEvents: "none", overflow: "visible" }}
                >
                    <Box
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        height="100%"
                        color={progressWidth >= 14 ? "white" : "gray.500"}
                        opacity={isActive ? 1 : 0}
                        transition="opacity 0.2s"
                    >
                        <FontAwesomeIcon icon={faGripVertical} style={{ width: 9, height: 9 }} />
                    </Box>
                </foreignObject>
            )}

            {/* Per-task label — mono 11/600 in a status-derived colour by
                default; the LabelInput (`value` / `align` / `verticalAlign` /
                typography) overrides per task. */}
            {labelProps && (
                <foreignObject
                    x={currentX + (isDraggable ? 22 : 8)}
                    y={y}
                    width={Math.max(taskWidth - (isDraggable ? 30 : 16), 0)}
                    height={height}
                    style={{ pointerEvents: "none" }}
                >
                    <Box
                        display="flex"
                        alignItems={alignToCss(labelProps.verticalAlign)}
                        justifyContent={alignToCss(labelProps.align)}
                        height="100%"
                        opacity={isActive ? 1 : 0.9}
                    >
                        <Text
                            fontFamily="mono"
                            fontSize={typeof fontSize === "number" ? `${fontSize}px` : fontSize}
                            // White reads on the status fill; once the fill no
                            // longer covers the label, switch to ink so it stays
                            // legible on the paper-2 track.
                            color={labelProps.color ?? (currentProgress >= 50 ? "white" : "fg.default")}
                            fontWeight={labelProps.fontWeight ?? 600}
                            fontStyle={labelProps.fontStyle ?? (stateTag === "proposedModel" ? "italic" : undefined)}
                            whiteSpace="nowrap"
                            cursor={cursor}
                            userSelect="none"
                            lineHeight="1"
                            overflow="hidden"
                            textOverflow="ellipsis"
                            m={0}
                            p={0}
                        >
                            {labelProps.value}
                        </Text>
                    </Box>
                </foreignObject>
            )}

            {/* Duration resize handle (right edge) — spec `.resize-handle`:
                a 6px ew-resize hit-zone straddling the edge + a 1px line over
                the middle 40%, hover-revealed (border.strong; the spec's white
                would vanish on the light paper-2 track). */}
            {isDurationDraggable && (
                <>
                    <line
                        x1={currentX + taskWidth}
                        x2={currentX + taskWidth}
                        y1={y + height * 0.3}
                        y2={y + height * 0.7}
                        stroke={resizeLineColor}
                        strokeWidth={1}
                        opacity={isActive ? 1 : 0}
                        style={{ transition: "opacity 0.2s", pointerEvents: "none" }}
                    />
                    <rect
                        x={currentX + taskWidth - 3}
                        y={y}
                        width={6}
                        height={height}
                        fill="transparent"
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                        {...bindDuration()}
                        style={{ cursor: "ew-resize", touchAction: "none" }}
                    />
                </>
            )}

            {/* Progress drag handle */}
            {isProgressDraggable && progressWidth > 8 && (
                <rect
                    x={currentX + progressWidth - 6}
                    y={y}
                    width={12}
                    height={height}
                    fill="transparent"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    {...bindProgress()}
                    style={{ cursor: "ew-resize", touchAction: "none" }}
                />
            )}

            {/* Per-task popover — content chrome matches the general east-ui
                Popover renderer (padding / min-max width / font-size). */}
            {hasPopover && (
                <Popover.Root
                    open={popoverOpen}
                    onOpenChange={(e) => setPopoverOpen(e.open)}
                    positioning={{ placement: "top", getAnchorRect }}
                >
                    <Portal>
                        <Popover.Positioner>
                            <Popover.Content padding="14px 16px" minW="240px" maxW="360px" fontSize="13px">
                                <Popover.Body>
                                    <EastChakraComponent
                                        value={popoverContent!}
                                        storageKey={`${storageKey}.popover`}
                                    />
                                </Popover.Body>
                            </Popover.Content>
                        </Popover.Positioner>
                    </Portal>
                </Popover.Root>
            )}
        </g>
    );
};
