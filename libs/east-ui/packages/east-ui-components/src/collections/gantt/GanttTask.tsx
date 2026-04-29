/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Box, Popover, Portal, Text, Tooltip, useToken } from "@chakra-ui/react";
import { useDrag } from "@use-gesture/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Gantt } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { alignToCss } from "../shared/helpers";

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
    /** Storage key used by per-task UIComp slots (tooltip / popover / overlays). */
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
    /** Visual-token defaults from `style` (per-task `label.color` etc. override). */
    taskBorderRadius?: string | undefined;
    labelColor?: string | undefined;
    labelFontSize?: string | undefined;
    labelFontWeight?: string | undefined;
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
    taskBorderRadius,
    labelColor,
    labelFontSize,
    labelFontWeight,
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

    // Per-task colour escape hatches
    const colorPalette = getSomeorUndefined(value.colorPalette)?.type ?? "blue";
    const propsProgress = getSomeorUndefined(value.progress);
    const customBackground = getSomeorUndefined(value.background);
    const customStroke = getSomeorUndefined(value.stroke);
    const customProgressFill = getSomeorUndefined(value.progressFill);

    // Per-task tooltip / popover / overlays slots
    const tooltipContent = getSomeorUndefined(value.tooltip);
    const popoverContent = getSomeorUndefined(value.popover);
    const hasTooltip = tooltipContent !== undefined;
    const hasPopover = popoverContent !== undefined;
    const overlays = value.overlays ?? [];

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

    // Get Chakra color tokens based on color palette
    const [paletteFill, paletteStroke] = useToken("colors", [
        `${colorPalette}.500`,
        `${colorPalette}.600`,
    ]);

    const fillColor = customBackground ?? paletteFill;
    const strokeColor = customStroke ?? paletteStroke;

    // Calculate current position from local state + drag offset
    const currentX = position.x + (dragOffset ?? 0);
    const currentWidth = Math.max(position.width + (durationOffset ?? 0), 4);
    const taskWidth = Math.max(currentWidth, 4);

    const defaultFontSize = Math.min(height * 0.7, 14);
    const fontSize = labelProps?.fontSize ?? labelFontSize ?? `${defaultFontSize}px`;

    // Border-radius parser (accepts "8px", "0.5rem", or "4")
    const radiusN = taskBorderRadius ? parseInt(taskBorderRadius, 10) : NaN;
    const radius = Number.isFinite(radiusN) ? radiusN : 4;

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

    const isDraggable = onDrag && timelineStartDate && timelineEndDate && timelineWidth;
    const isDurationDraggable = onDurationChange && timelineStartDate && timelineEndDate && timelineWidth;
    const isProgressDraggable = onProgressChange && propsProgress !== undefined;

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
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={isActive ? 3 : 2}
                opacity={isActive ? 1 : 0.9}
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
                    fill={customProgressFill ?? "rgba(255,255,255,0.3)"}
                    rx={radius}
                    ry={radius}
                    style={{ pointerEvents: "none" }}
                />
            )}

            {/* Per-task label — LabelInput shape: `value`, `align`,
                `verticalAlign`, plus typography overrides. Style-level
                `labelColor` / `labelFontSize` / `labelFontWeight` act as
                cascading defaults; per-task `label.color` etc. win. */}
            {labelProps && (
                <foreignObject
                    x={currentX + 8}
                    y={y}
                    width={Math.max(taskWidth - 16, 0)}
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
                            fontSize={typeof fontSize === "number" ? `${fontSize}px` : fontSize}
                            color={labelProps.color ?? labelColor ?? "fg.default"}
                            fontWeight={labelProps.fontWeight ?? labelFontWeight}
                            fontStyle={labelProps.fontStyle}
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

            {/* Per-task overlays — axis-aligned UIComponents painted inside
                the bar. `pointer-events: none` so drag / click still hit the
                rect underneath. */}
            {overlays.map((o, i) => (
                <foreignObject
                    key={`ov-${i}`}
                    x={currentX}
                    y={y}
                    width={taskWidth}
                    height={height}
                    style={{ pointerEvents: "none" }}
                >
                    <div
                        style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            justifyContent: alignToCss(o.align?.type),
                            alignItems: alignToCss(o.verticalAlign?.type),
                            padding: "4px",
                        }}
                    >
                        <EastChakraComponent
                            value={o.content}
                            storageKey={`${storageKey}.overlay.${i}`}
                        />
                    </div>
                </foreignObject>
            ))}

            {/* Duration resize handle (right edge) */}
            {isDurationDraggable && (
                <rect
                    x={currentX + taskWidth - 6}
                    y={y}
                    width={12}
                    height={height}
                    fill="transparent"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    {...bindDuration()}
                    style={{ cursor: "ew-resize", touchAction: "none" }}
                />
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

            {/* Per-task tooltip */}
            {hasTooltip && (
                <Tooltip.Root
                    open={isHovered}
                    openDelay={200}
                    positioning={{ placement: "top", getAnchorRect }}
                >
                    <Portal>
                        <Tooltip.Positioner>
                            <Tooltip.Content>
                                <EastChakraComponent
                                    value={tooltipContent!}
                                    storageKey={`${storageKey}.tooltip`}
                                />
                            </Tooltip.Content>
                        </Tooltip.Positioner>
                    </Portal>
                </Tooltip.Root>
            )}

            {/* Per-task popover */}
            {hasPopover && (
                <Popover.Root
                    open={popoverOpen}
                    onOpenChange={(e) => setPopoverOpen(e.open)}
                    positioning={{ placement: "top", getAnchorRect }}
                >
                    <Portal>
                        <Popover.Positioner>
                            <Popover.Content>
                                <Popover.Body p="3">
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
