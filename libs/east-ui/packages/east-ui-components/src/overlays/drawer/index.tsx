/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, type ReactNode } from "react";
import { Box as ChakraBox, Drawer as ChakraDrawer, Portal, IconButton, type DrawerRootProps, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExpand, faCompress } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Drawer } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

// Pre-define equality function at module level
const drawerEqual = equalFor(Drawer.Types.Drawer);

/** East Drawer value type */
export type DrawerValue = ValueTypeOf<typeof Drawer.Types.Drawer>;

/** East Drawer open input value type */
export type DrawerOpenInputValue = ValueTypeOf<typeof Drawer.Types.OpenInput>;

export interface EastChakraDrawerProps {
    value: DrawerValue;
    storageKey: string;
}

// ============================================================================
// toChakraDrawer - Pure function to convert East value to Chakra props
// ============================================================================
/**
 * Converts an East UI Drawer open input value to Chakra UI Drawer props.
 * Pure function - easy to test independently.
 *
 * @param value - The East DrawerOpenInputValue
 * @returns Chakra Drawer props
 */
export function toChakraDrawer(value: DrawerOpenInputValue): Partial<DrawerRootProps> {
    const style = getSomeorUndefined(value.style);

    return {
        size: style ? getSomeorUndefined(style.size)?.type : undefined,
        placement: style ? getSomeorUndefined(style.placement)?.type : undefined,
        contained: style ? getSomeorUndefined(style.contained) : undefined,

    };
}

// ============================================================================
// Shared Drawer Content Component
// ============================================================================

export interface DrawerContentProps {
    /** Drawer open input value containing body, title, description, style */
    value: DrawerOpenInputValue;
    /** Storage key prefix for persisting component state */
    storageKey: string;
    /** Optional trigger element (for trigger-based drawers) */
    trigger?: ReactNode;
    /** Whether drawer is controlled open (for programmatic drawers) */
    open?: boolean;
    /** Additional onClose handler (for programmatic drawers) */
    onClose?: () => void;
    /** Fires once Ark UI's close transition is fully complete (programmatic drawers use it to unmount only after body-lock cleanup runs) */
    onExitComplete?: () => void;
    /** Extra content rendered inside this drawer's Portal + Positioner (#328) — the
     *  stacked-ancestor rails ride here so they inherit this drawer's exact Chakra
     *  overlay layer (above its backdrop, below any popover/tooltip opened from it)
     *  without a hardcoded z-index. */
    railsSlot?: ReactNode;
}

/**
 * Shared drawer content component used by both trigger-based and programmatic drawers.
 */
export function DrawerContent({ value, storageKey, trigger, open, onClose, onExitComplete: onExitCompleteCallback, railsSlot }: DrawerContentProps) {
    const props = useMemo(() => toChakraDrawer(value), [value]);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Extract header fields from value
    const eyebrow = useMemo(() => getSomeorUndefined(value.eyebrow), [value.eyebrow]);
    const title = useMemo(() => getSomeorUndefined(value.title), [value.title]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    // The theme recipe adds an `eyebrow` slot beyond Chakra's Drawer
    // anatomy, so widen the inferred slot map.
    const drawerStyles = useSlotRecipe({ key: "drawer" })() as Record<string, SystemStyleObject>;

    // Extract callback functions from style
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const onOpenChangeFn = useMemo(() => style ? getSomeorUndefined(style.onOpenChange) : undefined, [style]);
    const onExitCompleteFn = useMemo(() => style ? getSomeorUndefined(style.onExitComplete) : undefined, [style]);
    // #145 — body padding / fill-height affordance (applied inline on ChakraDrawer.Body).
    const bodyPadding = useMemo(() => style ? getSomeorUndefined(style.bodyPadding) : undefined, [style]);
    const flush = useMemo(() => (style ? getSomeorUndefined(style.flush) : undefined) === true, [style]);
    const fillBody = useMemo(() => (style ? getSomeorUndefined(style.fillBody) : undefined) === true, [style]);

    const handleOpenChange = useCallback((details: { open: boolean }) => {
        if (!details.open && onClose) {
            onClose();
        }
        if (onOpenChangeFn) {
            queueMicrotask(() => onOpenChangeFn(details.open));
        }
    }, [onOpenChangeFn, onClose]);

    const handleExitComplete = useCallback(() => {
        if (onExitCompleteFn) {
            queueMicrotask(() => onExitCompleteFn());
        }
        if (onExitCompleteCallback) {
            onExitCompleteCallback();
        }
    }, [onExitCompleteFn, onExitCompleteCallback]);

    const toggleFullscreen = useCallback(() => {
        setIsFullscreen(prev => !prev);
    }, []);

    // Use full size when fullscreen, otherwise use props size
    const effectiveSize = isFullscreen ? "full" : props.size;

    return (
        <ChakraDrawer.Root
            open={open}
            size={effectiveSize}
            placement={props.placement}
            contained={props.contained}
            onOpenChange={handleOpenChange}
            onExitComplete={onExitCompleteFn || onExitCompleteCallback ? handleExitComplete : undefined}
        >
            {trigger && (
                <ChakraDrawer.Trigger asChild>
                    <span>{trigger}</span>
                </ChakraDrawer.Trigger>
            )}
            <Portal>
                <ChakraDrawer.Backdrop />
                <ChakraDrawer.Positioner>
                    {/* #328 — stacked-ancestor rails ride inside this drawer's
                      * Positioner so they inherit its exact overlay layer (above
                      * this backdrop, below any popover/tooltip opened from the
                      * drawer). They are position:fixed, so they don't disturb the
                      * panel's edge layout. */}
                    {railsSlot}
                    <ChakraDrawer.Content>
                        <ChakraDrawer.Header>
                            <ChakraBox flex="1" minWidth="0">
                                {eyebrow && <ChakraBox css={drawerStyles.eyebrow}>{eyebrow}</ChakraBox>}
                                {title && <ChakraDrawer.Title>{title}</ChakraDrawer.Title>}
                                {description && (
                                    <ChakraDrawer.Description>{description}</ChakraDrawer.Description>
                                )}
                            </ChakraBox>
                            <IconButton
                                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                                onClick={toggleFullscreen}
                                variant="ghost"
                                size="sm"
                            >
                                <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
                            </IconButton>
                        </ChakraDrawer.Header>
                        <ChakraDrawer.Body
                            padding={flush ? "0" : (bodyPadding ?? "16px 20px")}
                            {...(fillBody ? { display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" } : {})}
                        >
                            {value.body.map((child, index) => (
                                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
                            ))}
                        </ChakraDrawer.Body>
                    </ChakraDrawer.Content>
                </ChakraDrawer.Positioner>
            </Portal>
        </ChakraDrawer.Root>
    );
}

// ============================================================================
// East Chakra Drawer Component (trigger-based)
// ============================================================================

/**
 * Renders an East UI Drawer value using Chakra UI Drawer component.
 */
export const EastChakraDrawer = memo(function EastChakraDrawer({ value, storageKey }: EastChakraDrawerProps) {
    // Convert DrawerValue to DrawerOpenInputValue format (without trigger)
    const openInputValue = useMemo((): DrawerOpenInputValue => ({
        body: value.body,
        eyebrow: value.eyebrow,
        title: value.title,
        description: value.description,
        style: value.style,
    }), [value.body, value.eyebrow, value.title, value.description, value.style]);

    return (
        <DrawerContent
            value={openInputValue}
            storageKey={storageKey}
            trigger={<EastChakraComponent value={value.trigger} storageKey={`${storageKey}.trigger`} />}
        />
    );
}, (prev, next) => drawerEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
