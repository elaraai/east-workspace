/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { CloseButton, Popover as ChakraPopover, Portal, Text } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { CoachMark } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const coachMarkEqual = equalFor(CoachMark.Types.CoachMark);

/** East CoachMark value type */
export type CoachMarkValue = ValueTypeOf<typeof CoachMark.Types.CoachMark>;

export interface EastChakraCoachMarkProps {
    value: CoachMarkValue;
    storageKey: string;
}

/** Read the once-key from local storage so the hint stays dismissed across reloads. */
function readDismissed(key: string | undefined): boolean {
    if (!key || typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(`east.coach.${key}`) === "1";
    } catch {
        return false;
    }
}

function writeDismissed(key: string | undefined): void {
    if (!key || typeof window === "undefined") return;
    try {
        window.localStorage.setItem(`east.coach.${key}`, "1");
    } catch {
        /* storage disabled — hint will reappear, acceptable */
    }
}

/**
 * Renders a CoachMark — wraps the target child and anchors a popover
 * to it. Auto-opens on mount unless `showOnce` is set and already
 * dismissed. Same composition shape as Tooltip / Popover / HoverCard:
 * the target IS the wrapped child.
 */
export const EastChakraCoachMark = memo(function EastChakraCoachMark({ value, storageKey }: EastChakraCoachMarkProps) {
    const showOnce = getSomeorUndefined(value.showOnce);
    const dismissible = getSomeorUndefined(value.dismissible) ?? true;
    const onDismissFn = useMemo(() => getSomeorUndefined(value.onDismiss), [value.onDismiss]);

    const style = getSomeorUndefined(value.style);
    const placementTag = style ? getSomeorUndefined(style.placement)?.type : undefined;
    const placement = (placementTag ?? "top") as "top" | "right" | "bottom" | "left";
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const arrowColor = style ? getSomeorUndefined(style.arrowColor) : undefined;

    const initiallyDismissed = readDismissed(showOnce);
    const [open, setOpen] = useState<boolean>(!initiallyDismissed);
    const [dismissed, setDismissed] = useState<boolean>(initiallyDismissed);

    const handleDismiss = useCallback(() => {
        setOpen(false);
        setDismissed(true);
        if (showOnce) writeDismissed(showOnce);
        if (onDismissFn) queueMicrotask(() => onDismissFn());
    }, [showOnce, onDismissFn]);

    const targetChild = <EastChakraComponent value={value.target} storageKey={`${storageKey}.target`} />;

    if (dismissed) {
        return targetChild;
    }

    return (
        <ChakraPopover.Root
            open={open}
            positioning={{ placement }}
            onOpenChange={(d) => { if (!d.open) handleDismiss(); }}
        >
            <ChakraPopover.Trigger asChild>
                <span style={{ display: "inline-block" }}>{targetChild}</span>
            </ChakraPopover.Trigger>
            <Portal>
                <ChakraPopover.Positioner>
                    <ChakraPopover.Content bg={background} borderColor={borderColor}>
                        <ChakraPopover.Arrow {...(arrowColor ? { bg: arrowColor } : {})} />
                        <ChakraPopover.Header>
                            <Text fontWeight="semibold" fontSize="sm">{value.title}</Text>
                        </ChakraPopover.Header>
                        <ChakraPopover.Body>
                            <Text fontSize="sm">{value.body}</Text>
                        </ChakraPopover.Body>
                        {dismissible && (
                            <ChakraPopover.CloseTrigger asChild>
                                <CloseButton
                                    size="xs"
                                    position="absolute"
                                    top="1"
                                    right="1"
                                    onClick={handleDismiss}
                                    aria-label="Dismiss coach mark"
                                />
                            </ChakraPopover.CloseTrigger>
                        )}
                    </ChakraPopover.Content>
                </ChakraPopover.Positioner>
            </Portal>
        </ChakraPopover.Root>
    );
}, (prev, next) => coachMarkEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
