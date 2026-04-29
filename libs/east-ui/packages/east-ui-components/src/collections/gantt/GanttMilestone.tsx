/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Box, Popover, Portal, Text, Tooltip, useToken } from "@chakra-ui/react";
import { useDrag } from "@use-gesture/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Gantt } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { alignToCss } from "../shared/helpers";

export type GanttMilestoneValue = ValueTypeOf<typeof Gantt.Types.Milestone>;

export interface GanttMilestoneProps {
    x: number;
    y: number;
    height: number;
    value: GanttMilestoneValue;
    /** Storage key used by per-milestone UIComp slots (tooltip / popover / overlays). */
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
    /** Visual-token defaults from `style` (per-milestone `label.color` etc. override). */
    labelColor?: string | undefined;
    labelFontSize?: string | undefined;
    labelFontWeight?: string | undefined;
}

const makeDiamondPoints = (x: number, y: number, size: number): string => {
    const centerX = x;
    const centerY = y + size / 2;
    return `${centerX},${y} ${centerX + size / 2},${centerY} ${centerX},${y + size} ${centerX - size / 2},${centerY}`;
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
    labelColor,
    labelFontSize,
    labelFontWeight,
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

    const colorPalette = getSomeorUndefined(value.colorPalette)?.type ?? "blue";
    const customFill = getSomeorUndefined(value.fill);
    const customStroke = getSomeorUndefined(value.stroke);

    // Per-milestone tooltip / popover / overlays slots
    const tooltipContent = getSomeorUndefined(value.tooltip);
    const popoverContent = getSomeorUndefined(value.popover);
    const hasTooltip = tooltipContent !== undefined;
    const hasPopover = popoverContent !== undefined;
    const overlays = value.overlays ?? [];

    // Get Chakra color tokens based on color palette
    const [paletteFill, paletteStroke] = useToken("colors", [
        `${colorPalette}.500`,
        `${colorPalette}.600`,
    ]);
    const fillColor = customFill ?? paletteFill;
    const strokeColor = customStroke ?? paletteStroke;

    // Calculate current position from local state + drag offset
    const currentX = position.x + (dragOffset ?? 0);

    const defaultFontSize = Math.min(height * 0.7, 14);
    const fontSize = labelProps?.fontSize ?? labelFontSize ?? `${defaultFontSize}px`;
    const diamondSize = height;
    const textX = currentX + diamondSize / 2 + 4;
    const diamondPoints = makeDiamondPoints(currentX, y, diamondSize);

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
                strokeWidth={isHovered || dragOffset !== null ? 3 : 2}
                opacity={isHovered || dragOffset !== null ? 1 : 0.9}
                onDoubleClick={handleDoubleClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                {...bind()}
                style={{ cursor, touchAction: "none" }}
            />

            {/* Per-milestone label — LabelInput shape: `value`, `align`,
                `verticalAlign`, plus typography overrides cascade on top of
                style-level label* defaults. */}
            {labelProps && (
                <foreignObject
                    x={textX}
                    y={y}
                    width={200}
                    height={height}
                    style={{ pointerEvents: "none" }}
                >
                    <Box
                        display="flex"
                        alignItems={alignToCss(labelProps.verticalAlign)}
                        justifyContent={alignToCss(labelProps.align)}
                        height="100%"
                        opacity={isHovered || dragOffset !== null ? 1 : 0.9}
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
                            m={0}
                            p={0}
                        >
                            {labelProps.value}
                        </Text>
                    </Box>
                </foreignObject>
            )}

            {/* Per-milestone overlays — axis-aligned UIComponents painted on
                top of the diamond. The overlay layer extends slightly beyond
                the diamond's bounding box so corner content (top-right
                badges, etc.) reads naturally. */}
            {overlays.map((o, i) => (
                <foreignObject
                    key={`ov-${i}`}
                    x={currentX - diamondSize / 2}
                    y={y}
                    width={diamondSize}
                    height={diamondSize}
                    style={{ pointerEvents: "none" }}
                >
                    <div
                        style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            justifyContent: alignToCss(o.align?.type),
                            alignItems: alignToCss(o.verticalAlign?.type),
                        }}
                    >
                        <EastChakraComponent
                            value={o.content}
                            storageKey={`${storageKey}.overlay.${i}`}
                        />
                    </div>
                </foreignObject>
            ))}

            {/* Per-milestone tooltip */}
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

            {/* Per-milestone popover */}
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
