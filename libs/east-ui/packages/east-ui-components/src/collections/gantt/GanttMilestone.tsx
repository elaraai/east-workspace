/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Box, Popover, Portal, Text, useToken } from "@chakra-ui/react";
import { useDrag } from "@use-gesture/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Gantt } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { MILESTONE_KIND } from "./palette";

export type GanttMilestoneValue = ValueTypeOf<typeof Gantt.Types.Milestone>;

export interface GanttMilestoneProps {
    x: number;
    y: number;
    height: number;
    value: GanttMilestoneValue;
    /** Storage key used by the per-milestone popover UIComp slot. */
    storageKey?: string | undefined;
    onClick?: (() => void) | undefined;
    onDoubleClick?: (() => void) | undefined;
    /** Callback when milestone is dragged to a new position */
    onDrag?: ((previousDate: Date, newDate: Date) => void) | undefined;
    /** Start date of the timeline (for position-to-date conversion) */
    timelineStartDate?: Date | undefined;
    /** End date of the timeline (for position-to-date conversion) */
    timelineEndDate?: Date | undefined;
    /** Width of the timeline in pixels (for position-to-date conversion) */
    timelineWidth?: number | undefined;
}

const makeDiamondPoints = (centerX: number, centerY: number, size: number): string => {
    const half = size / 2;
    return `${centerX},${centerY - half} ${centerX + half},${centerY} ${centerX},${centerY + half} ${centerX - half},${centerY}`;
};

export const GanttMilestone = ({
    x,
    y,
    height,
    value,
    storageKey = "milestone",
    onClick,
    onDoubleClick,
    onDrag,
    timelineStartDate,
    timelineEndDate,
    timelineWidth,
}: GanttMilestoneProps) => {
    const [isHovered, setIsHovered] = useState(false);
    // In-progress drag offset (px). null when not dragging.
    const [dragOffset, setDragOffset] = useState<number | null>(null);
    // Local position state - reset from props, updated on drag end
    const [position, setPosition] = useState({ x });
    const [popoverOpen, setPopoverOpen] = useState(false);
    const polygonRef = useRef<SVGPolygonElement>(null);

    // Reset position when x changes externally (e.g., from store update after callback)
    useEffect(() => {
        setPosition({ x });
    }, [x]);

    // Per-milestone label config
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

    // Milestone kind → spec diamond fill (interim = amber, release = brand teal).
    const kindTag = getSomeorUndefined(value.kind)?.type ?? "release";

    // Per-milestone popover slot (click-triggered).
    const popoverContent = getSomeorUndefined(value.popover);
    const hasPopover = popoverContent !== undefined;

    // Diamond fill = kind colour; border = paper white (spec).
    const [fillColor, strokeColor] = useToken("colors", [MILESTONE_KIND[kindTag] ?? "fg.info", "white"]);

    // Calculate current position from local state + drag offset
    const currentX = position.x + (dragOffset ?? 0);

    // Spec milestone label = mono 10px / 600; per-milestone `label.fontSize` wins.
    const fontSize = labelProps?.fontSize ?? "10px";
    // Fixed 14px diamond centred vertically in the row.
    const diamondSize = 14;
    const diamondCenterY = y + height / 2;
    const diamondPoints = makeDiamondPoints(currentX, diamondCenterY, diamondSize);

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => {
        if (dragOffset === null) setIsHovered(false);
    }, [dragOffset]);

    // Convert pixel position to date
    const positionToDate = useCallback((pixelX: number): Date => {
        if (!timelineStartDate || !timelineEndDate || !timelineWidth) return value.date;
        const totalDuration = timelineEndDate.getTime() - timelineStartDate.getTime();
        const ratio = Math.max(0, Math.min(1, pixelX / timelineWidth));
        return new Date(timelineStartDate.getTime() + ratio * totalDuration);
    }, [timelineStartDate, timelineEndDate, timelineWidth, value.date]);

    const isDraggable = onDrag && timelineStartDate && timelineEndDate && timelineWidth;

    // Drag state machine via @use-gesture/react. `filterTaps` makes
    // the library distinguish click (tap) from drag (movement >
    // threshold) so we don't have to track `hasMoved` ourselves.
    // Pointer-capture is automatic.
    const bind = useDrag(({ active, movement: [mx], tap, last, first }) => {
        if (first) {
            setIsHovered(true);
        }
        if (tap) {
            // Click — fire onClick AND toggle popover.
            if (onClick) onClick();
            if (hasPopover) setPopoverOpen(prev => !prev);
            setDragOffset(null);
            setIsHovered(false);
            return;
        }
        if (last) {
            if (isDraggable && timelineWidth) {
                setPosition(prev => ({ x: prev.x + mx }));
                if (onDrag) {
                    const newDate = positionToDate(position.x + mx);
                    onDrag(value.date, newDate);
                }
            }
            setDragOffset(null);
            setIsHovered(false);
            return;
        }
        if (active && isDraggable) {
            setDragOffset(mx);
        }
    }, { filterTaps: true, preventDefault: true });

    const handleDoubleClick = useCallback(() => {
        if (onDoubleClick && dragOffset === null) onDoubleClick();
    }, [onDoubleClick, dragOffset]);

    const cursor = dragOffset !== null
        ? "grabbing"
        : isDraggable
            ? "grab"
            : (onClick || onDoubleClick || hasPopover ? "pointer" : "default");

    const getAnchorRect = useCallback(() => {
        if (polygonRef.current) {
            return polygonRef.current.getBoundingClientRect();
        }
        return { x: 0, y: 0, width: 0, height: 0 };
    }, []);

    return (
        <g>
            {/* Diamond shape */}
            <polygon
                ref={polygonRef}
                points={diamondPoints}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={4}
                paintOrder="stroke"
                strokeLinejoin="miter"
                opacity={isHovered || dragOffset !== null ? 1 : 0.9}
                onDoubleClick={handleDoubleClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                {...bind()}
                style={{ cursor, touchAction: "none" }}
            />

            {/* Per-milestone label — centred below the diamond (spec), mono
                10/600 in the diamond's fill colour; per-label overrides win. */}
            {labelProps && (
                <foreignObject
                    x={currentX - 100}
                    y={diamondCenterY + diamondSize / 2 + 4}
                    width={200}
                    height={14}
                    style={{ pointerEvents: "none", overflow: "visible" }}
                >
                    <Box
                        display="flex"
                        alignItems="flex-start"
                        justifyContent="center"
                        height="100%"
                        opacity={isHovered || dragOffset !== null ? 1 : 0.9}
                    >
                        <Text
                            fontFamily="mono"
                            fontSize={typeof fontSize === "number" ? `${fontSize}px` : fontSize}
                            color={labelProps.color ?? fillColor}
                            fontWeight={labelProps.fontWeight ?? 600}
                            fontStyle={labelProps.fontStyle}
                            whiteSpace="nowrap"
                            cursor={cursor}
                            userSelect="none"
                            lineHeight="1"
                            m={0}
                            p={0}
                        >
                            {labelProps.value}
                        </Text>
                    </Box>
                </foreignObject>
            )}

            {/* Per-milestone popover — content chrome matches the general
                east-ui Popover renderer (padding / min-max width / font-size). */}
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
