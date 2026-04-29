/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Text, useToken, Menu, Portal, Popover, Tooltip, Box } from "@chakra-ui/react";
import { useDrag } from "@use-gesture/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen, faTrash } from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import type { ValueTypeOf } from "@elaraai/east";
import type { Planner } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { alignToCss } from "../shared/helpers";

export type PlannerEventValue = ValueTypeOf<typeof Planner.Types.Event>;

export interface PlannerEventProps {
    value: PlannerEventValue;
    storageKey: string;
    rowIndex: number;
    eventIndex: number;
    y: number;
    height: number;
    slotWidth: number;
    slotRangeStart: number;
    slotMode: "single" | "span";
    minSlot?: number | undefined;
    maxSlot?: number | undefined;
    stepSize?: number | undefined;
    /** Visual-token defaults from `style` (per-event label.color etc. override). */
    eventBorderRadius?: string | undefined;
    labelColor?: string | undefined;
    labelFontSize?: string | undefined;
    labelFontWeight?: string | undefined;
    /** Whether this event should be dimmed (another event in the row is hovered) */
    isDimmed?: boolean | undefined;
    onClick?: (() => void) | undefined;
    onDoubleClick?: (() => void) | undefined;
    onDrag?: ((previousStart: number, previousEnd: number, newStart: number, newEnd: number) => void) | undefined;
    onResize?: ((previousStart: number, previousEnd: number, newStart: number, newEnd: number, edge: "start" | "end") => void) | undefined;
    onEdit?: (() => void) | undefined;
    onDelete?: (() => void) | undefined;
    /** Called when mouse enters this event */
    onHoverStart?: (() => void) | undefined;
    /** Called when mouse leaves this event */
    onHoverEnd?: (() => void) | undefined;
}

/** Consolidated overlay state (context menu or popover) */
interface OverlayState {
    active: "none" | "contextMenu" | "popover";
    contextMenuPosition: { x: number; y: number };
}

export const PlannerEvent = ({
    value,
    storageKey,
    rowIndex: _rowIndex,
    eventIndex: _eventIndex,
    y,
    height,
    slotWidth,
    slotRangeStart,
    slotMode,
    minSlot,
    maxSlot,
    stepSize = 1,
    eventBorderRadius,
    labelColor,
    labelFontSize,
    labelFontWeight,
    isDimmed = false,
    onClick,
    onDoubleClick,
    onDrag,
    onResize,
    onEdit,
    onDelete,
    onHoverStart,
    onHoverEnd,
}: PlannerEventProps) => {
    // Props-derived slot values
    const propsStart = value.start;
    const propsEnd = getSomeorUndefined(value.end) ?? value.start;

    // Local slot values - initialized from props, updated on interaction
    const [localSlots, setLocalSlots] = useState({ start: propsStart, end: propsEnd });

    // Sync local state when props change (parent updated the data)
    useEffect(() => {
        setLocalSlots({ start: propsStart, end: propsEnd });
    }, [propsStart, propsEnd]);

    // In-progress interaction offsets (px). Only one is non-null at a time.
    const [dragPx, setDragPx] = useState<number | null>(null);
    const [resizeStartPx, setResizeStartPx] = useState<number | null>(null);
    const [resizeEndPx, setResizeEndPx] = useState<number | null>(null);
    const [isHovered, setIsHovered] = useState(false);

    // Consolidated overlay state (context menu or popover)
    const [overlay, setOverlay] = useState<OverlayState>({
        active: "none",
        contextMenuPosition: { x: 0, y: 0 },
    });
    const eventRectRef = useRef<SVGRectElement>(null);

    // Show context menu if either callback is defined
    const hasContextMenu = onEdit != null || onDelete != null;

    // Per-event tooltip / popover slots (UIComponent values from the IR).
    const tooltipContent = getSomeorUndefined(value.tooltip);
    const popoverContent = getSomeorUndefined(value.popover);
    const hasTooltip = tooltipContent !== undefined;
    const hasPopover = popoverContent !== undefined;
    const overlays = value.overlays ?? [];

    // Derived from props
    const colorPalette = getSomeorUndefined(value.colorPalette)?.type ?? "blue";

    // Extract label config (nested object with value, align, verticalAlign, color, etc.)
    const labelConfig = getSomeorUndefined(value.label);
    const labelProps = labelConfig ? {
        value: labelConfig.value,
        align: getSomeorUndefined(labelConfig.align)?.type ?? "start",
        verticalAlign: getSomeorUndefined(labelConfig.verticalAlign)?.type ?? "center",
        color: getSomeorUndefined(labelConfig.color),
        fontWeight: getSomeorUndefined(labelConfig.fontWeight)?.type,
        fontStyle: getSomeorUndefined(labelConfig.fontStyle)?.type,
        fontSize: getSomeorUndefined(labelConfig.fontSize)?.type,
    } : null;

    // Extract icon config (prefix, name, align, size, color, colorPalette)
    const iconConfig = getSomeorUndefined(value.icon);
    const iconProps = iconConfig ? {
        prefix: iconConfig.prefix,
        name: iconConfig.name,
        align: getSomeorUndefined(iconConfig.align)?.type ?? "start",
        size: getSomeorUndefined(iconConfig.size)?.type ?? "sm",
        color: getSomeorUndefined(iconConfig.color),
        colorPalette: getSomeorUndefined(iconConfig.colorPalette)?.type,
    } : null;

    // Event-level styling
    const backgroundColor = getSomeorUndefined(value.background);
    const customStrokeColor = getSomeorUndefined(value.stroke);
    const eventOpacity = getSomeorUndefined(value.opacity);

    const [fillColor, paletteStrokeColor] = useToken("colors", [`${colorPalette}.500`, `${colorPalette}.600`]);

    // Use custom colors if provided, otherwise use colorPalette
    const actualFillColor = backgroundColor ?? fillColor;
    const actualStrokeColor = customStrokeColor ?? paletteStrokeColor;

    // Calculate base x and width from local slots
    const { baseX, baseWidth } = useMemo(() => {
        const { start, end } = localSlots;
        const slotIndex = start - slotRangeStart;
        const x = slotIndex * slotWidth + 6; // 6px padding
        const w = slotMode === "span"
            ? (end - start + 1) * slotWidth - 12 // 12px total padding
            : slotWidth - 12;
        return { baseX: x, baseWidth: w };
    }, [localSlots, slotRangeStart, slotWidth, slotMode]);

    const minWidth = useMemo(() => Math.max(slotWidth * stepSize - 12, 20), [slotWidth, stepSize]);

    // Apply interaction offset to get current visual position
    const interactionActive = dragPx !== null || resizeStartPx !== null || resizeEndPx !== null;
    let currentX = baseX;
    let currentWidth = baseWidth;
    if (dragPx !== null) {
        currentX = baseX + dragPx;
    } else if (resizeStartPx !== null) {
        currentX = baseX + resizeStartPx;
        currentWidth = Math.max(baseWidth - resizeStartPx, minWidth);
    } else if (resizeEndPx !== null) {
        currentWidth = Math.max(baseWidth + resizeEndPx, minWidth);
    }

    const eventWidth = Math.max(currentWidth, 4);
    const defaultFontSize = Math.min(height * 0.7, 14);
    // Per-event label.fontSize wins; otherwise fall back to the style-level
    // `labelFontSize` token; otherwise the dynamic height-driven default.
    const fontSize = labelProps?.fontSize ?? labelFontSize ?? defaultFontSize;
    const isActive = isHovered || interactionActive;

    // Compute actual opacity - dim when another event in the row is hovered
    const baseOpacity = isDimmed ? 0.1 : (eventOpacity ?? (isActive ? 1 : 0.9));

    // Conversions with stepSize snapping
    const pixelsToSlots = useCallback((px: number): number => {
        const rawSlots = px / slotWidth;
        // Snap to stepSize
        return Math.round(rawSlots / stepSize) * stepSize;
    }, [slotWidth, stepSize]);
    const slotsToPixels = useCallback((slots: number): number => slots * slotWidth, [slotWidth]);

    // Clamp delta to bounds (minimum event size is stepSize)
    const clampDelta = useCallback((delta: number, type: "drag" | "resize", edge: "start" | "end" | null): number => {
        let clamped = delta;
        const { start, end } = localSlots;
        const minEventSize = stepSize; // Minimum event size is one step

        if (type === "drag") {
            if (minSlot !== undefined) {
                const min = minSlot - start;
                if (clamped < min) clamped = min;
            }
            if (maxSlot !== undefined) {
                const max = maxSlot - end;
                if (clamped > max) clamped = max;
            }
        } else if (edge === "end") {
            // For end resize, minimum is when end = start + minEventSize
            const min = (start + minEventSize) - end;
            if (clamped < min) clamped = min;
            if (maxSlot !== undefined) {
                const max = maxSlot - end;
                if (clamped > max) clamped = max;
            }
        } else {
            // For start resize, maximum is when start = end - minEventSize
            const max = (end - minEventSize) - start;
            if (clamped > max) clamped = max;
            if (minSlot !== undefined) {
                const min = minSlot - start;
                if (clamped < min) clamped = min;
            }
        }
        return clamped;
    }, [localSlots, minSlot, maxSlot, stepSize]);

    // Main drag — moves the whole event bar. `tap` distinguishes click;
    // commit on `last` fires `onDrag` with snapped slot boundaries.
    const bindDrag = useDrag(({ active, movement: [mx], tap, last, first }) => {
        if (first) setIsHovered(true);
        if (tap) {
            if (onClick) onClick();
            if (hasPopover) {
                setOverlay(prev => ({ ...prev, active: prev.active === "popover" ? "none" : "popover" }));
            }
            setDragPx(null);
            return;
        }
        if (last) {
            const slotDelta = clampDelta(pixelsToSlots(mx), "drag", null);
            if (slotDelta !== 0) {
                const prevStart = localSlots.start;
                const prevEnd = localSlots.end;
                const newStart = prevStart + slotDelta;
                const newEnd = prevEnd + slotDelta;
                setLocalSlots({ start: newStart, end: newEnd });
                if (onDrag) onDrag(prevStart, prevEnd, newStart, newEnd);
            }
            setDragPx(null);
            setIsHovered(false);
            return;
        }
        if (active) {
            // Always show movement during drag — gating on `onDrag` was
            // wrong: a draggable-but-readonly bar still benefits from
            // showing where the user is pulling. Commit only fires
            // onDrag if defined (in the `last` branch above).
            setDragPx(mx);
        }
    }, { filterTaps: true, preventDefault: true });

    // Resize handle (start edge) — left grip resizes the bar's start slot.
    const bindResizeStart = useDrag(({ active, movement: [mx], last, first }) => {
        if (!onResize) return;
        if (first) setIsHovered(true);
        if (last) {
            const slotDelta = clampDelta(pixelsToSlots(mx), "resize", "start");
            if (slotDelta !== 0) {
                const prevStart = localSlots.start;
                const prevEnd = localSlots.end;
                const minEventSize = stepSize;
                let newStart = prevStart + slotDelta;
                if (newStart > prevEnd - minEventSize) newStart = prevEnd - minEventSize;
                setLocalSlots({ start: newStart, end: prevEnd });
                onResize(prevStart, prevEnd, newStart, prevEnd, "start");
            }
            setResizeStartPx(null);
            setIsHovered(false);
            return;
        }
        if (active) {
            const slotDelta = clampDelta(pixelsToSlots(mx), "resize", "start");
            setResizeStartPx(slotsToPixels(slotDelta));
        }
    }, { preventDefault: true });

    // Resize handle (end edge) — right grip resizes the bar's end slot.
    const bindResizeEnd = useDrag(({ active, movement: [mx], last, first }) => {
        if (!onResize) return;
        if (first) setIsHovered(true);
        if (last) {
            const slotDelta = clampDelta(pixelsToSlots(mx), "resize", "end");
            if (slotDelta !== 0) {
                const prevStart = localSlots.start;
                const prevEnd = localSlots.end;
                const minEventSize = stepSize;
                let newEnd = prevEnd + slotDelta;
                if (newEnd < prevStart + minEventSize) newEnd = prevStart + minEventSize;
                setLocalSlots({ start: prevStart, end: newEnd });
                onResize(prevStart, prevEnd, prevStart, newEnd, "end");
            }
            setResizeEndPx(null);
            setIsHovered(false);
            return;
        }
        if (active) {
            const slotDelta = clampDelta(pixelsToSlots(mx), "resize", "end");
            setResizeEndPx(slotsToPixels(slotDelta));
        }
    }, { preventDefault: true });

    const handleDoubleClick = useCallback(() => {
        if (onDoubleClick && !interactionActive) onDoubleClick();
    }, [onDoubleClick, interactionActive]);

    const handleMouseEnter = useCallback(() => {
        setIsHovered(true);
        if (onHoverStart) onHoverStart();
    }, [onHoverStart]);
    const handleMouseLeave = useCallback(() => {
        if (!interactionActive) setIsHovered(false);
        if (onHoverEnd) onHoverEnd();
    }, [interactionActive, onHoverEnd]);

    // Context menu handler
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if (!hasContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        setOverlay({ active: "contextMenu", contextMenuPosition: { x: e.clientX, y: e.clientY } });
    }, [hasContextMenu]);

    const handleEditClick = useCallback(() => {
        setOverlay(prev => ({ ...prev, active: "none" }));
        if (onEdit) onEdit();
    }, [onEdit]);

    const handleDeleteClick = useCallback(() => {
        setOverlay(prev => ({ ...prev, active: "none" }));
        if (onDelete) onDelete();
    }, [onDelete]);

    const cursor = dragPx !== null
        ? "grabbing"
        : onDrag
            ? "grab"
            : (onClick || onDoubleClick || hasPopover ? "pointer" : "default");

    // Get anchor rect for tooltip / popover positioning. Both Chakra primitives
    // accept a `getAnchorRect` callback that returns the screen-space rect of
    // the SVG `<rect>`; this lets us anchor HTML overlays to SVG content
    // without bouncing through a foreignObject.
    const getAnchorRect = useCallback(() => {
        if (eventRectRef.current) {
            return eventRectRef.current.getBoundingClientRect();
        }
        return { x: 0, y: 0, width: 0, height: 0 };
    }, []);

    // Border-radius — accept "8px", "0.5rem", or unsuffixed "4". `parseInt`
    // strips the unit if present and falls back to a numeric string.
    const radiusN = eventBorderRadius ? parseInt(eventBorderRadius, 10) : NaN;
    const radius = Number.isFinite(radiusN) ? radiusN : 4;

    return (
        <g>
            <rect
                ref={eventRectRef}
                x={currentX}
                y={y}
                width={eventWidth}
                height={height}
                fill={actualFillColor}
                stroke={actualStrokeColor}
                strokeWidth={isActive ? 3 : 2}
                opacity={baseOpacity}
                rx={radius}
                ry={radius}
                onDoubleClick={handleDoubleClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                {...bindDrag()}
                onContextMenu={handleContextMenu}
                style={{ cursor, touchAction: "none", transition: "opacity 150ms ease-in-out" }}
            />

            {/* Render label if present */}
            {labelProps && (
                <foreignObject x={currentX + 8} y={y} width={Math.max(eventWidth - 16, 0)} height={height} style={{ pointerEvents: "none" }}>
                    <Box
                        display="flex"
                        alignItems={alignToCss(labelProps.verticalAlign)}
                        justifyContent={alignToCss(labelProps.align)}
                        height="100%"
                        opacity={baseOpacity}
                        transition="opacity 150ms ease-in-out"
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

            {/* Render icon if present */}
            {iconProps && (
                <foreignObject x={currentX + 8} y={y} width={Math.max(eventWidth - 16, 0)} height={height} style={{ pointerEvents: "none" }}>
                    <Box
                        display="flex"
                        alignItems="center"
                        justifyContent={iconProps.align === "center" ? "center" : iconProps.align === "end" ? "flex-end" : "flex-start"}
                        height="100%"
                        opacity={baseOpacity}
                        transition="opacity 150ms ease-in-out"
                    >
                        <FontAwesomeIcon
                            icon={[iconProps.prefix as IconPrefix, iconProps.name as IconName]}
                            size={iconProps.size as any}
                            color={iconProps.color ?? (iconProps.colorPalette ? `var(--chakra-colors-${iconProps.colorPalette}-500)` : "currentColor")}
                        />
                    </Box>
                </foreignObject>
            )}

            {/* Per-event overlays — axis-aligned UIComponents inside the bar.
                Each overlay fills the bar as a flex container; align /
                verticalAlign place the content within. `pointer-events: none`
                so drag / resize / click still hit the rect. */}
            {overlays.map((o, i) => (
                <foreignObject
                    key={`ov-${i}`}
                    x={currentX}
                    y={y}
                    width={eventWidth}
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

            {onResize && (
                <>
                    <rect
                        x={currentX - 6}
                        y={y}
                        width={12}
                        height={height}
                        fill="transparent"
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                        {...bindResizeStart()}
                        style={{ cursor: "ew-resize", touchAction: "none" }}
                    />
                    <rect
                        x={currentX + eventWidth - 6}
                        y={y}
                        width={12}
                        height={height}
                        fill="transparent"
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                        {...bindResizeEnd()}
                        style={{ cursor: "ew-resize", touchAction: "none" }}
                    />
                </>
            )}

            {/* Per-event tooltip — hover-triggered Chakra Tooltip wraps the
                event bar via getAnchorRect (works with SVG without
                foreignObject reflow). */}
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

            {/* Context menu for Edit/Delete */}
            {hasContextMenu && (
                <Menu.Root
                    open={overlay.active === "contextMenu"}
                    onOpenChange={(e) => setOverlay(prev => ({ ...prev, active: e.open ? "contextMenu" : "none" }))}
                    positioning={{
                        placement: "bottom-start",
                        getAnchorRect: () => ({
                            x: overlay.contextMenuPosition.x,
                            y: overlay.contextMenuPosition.y,
                            width: 0,
                            height: 0,
                        }),
                    }}
                >
                    <Portal>
                        <Menu.Positioner>
                            <Menu.Content>
                                {onEdit && (
                                    <Menu.Item value="edit" onClick={handleEditClick}>
                                        <FontAwesomeIcon icon={faPen} style={{ marginRight: 8 }} />
                                        Edit
                                    </Menu.Item>
                                )}
                                {onDelete && (
                                    <Menu.Item value="delete" onClick={handleDeleteClick} color="red.500">
                                        <FontAwesomeIcon icon={faTrash} style={{ marginRight: 8 }} />
                                        Delete
                                    </Menu.Item>
                                )}
                            </Menu.Content>
                        </Menu.Positioner>
                    </Portal>
                </Menu.Root>
            )}

            {/* Per-event popover — click-triggered Chakra Popover. Coexists
                with `onClick`: a non-drag pointerUp fires both the callback
                and toggles the popover. */}
            {hasPopover && (
                <Popover.Root
                    open={overlay.active === "popover"}
                    onOpenChange={(e) => setOverlay(prev => ({ ...prev, active: e.open ? "popover" : "none" }))}
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
