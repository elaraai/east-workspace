/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState } from "react";
import { Box as ChakraBox, HoverCard as ChakraHoverCard, Portal, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { HoverCard } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { useHoverCapable } from "../../contracts/index.js";

// Pre-define equality function at module level
const hoverCardEqual = equalFor(HoverCard.Types.HoverCard);

/** East HoverCard value type */
export type HoverCardValue = ValueTypeOf<typeof HoverCard.Types.HoverCard>;

export interface EastChakraHoverCardProps {
    value: HoverCardValue;
    storageKey: string;
}

/**
 * Renders an East UI HoverCard value using Chakra UI HoverCard component.
 */
export const EastChakraHoverCard = memo(function EastChakraHoverCard({ value, storageKey }: EastChakraHoverCardProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const title = useMemo(() => getSomeorUndefined(value.title), [value.title]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    // The theme recipe adds `title` / `description` slots beyond Chakra's
    // HoverCard anatomy, so widen the inferred slot map.
    const cardStyles = useSlotRecipe({ key: "hoverCard" })() as Record<string, SystemStyleObject>;
    const placement = useMemo(() => style ? getSomeorUndefined(style.placement)?.type : undefined, [style]);
    const size = useMemo(() => style ? getSomeorUndefined(style.size)?.type : undefined, [style]);
    const hasArrow = useMemo(() => style ? getSomeorUndefined(style.hasArrow) : undefined, [style]);
    const openDelay = useMemo(() => {
        const delay = style ? getSomeorUndefined(style.openDelay) : undefined;
        return delay !== undefined ? Number(delay) : undefined;
    }, [style]);
    const closeDelay = useMemo(() => {
        const delay = style ? getSomeorUndefined(style.closeDelay) : undefined;
        return delay !== undefined ? Number(delay) : undefined;
    }, [style]);

    // Extract callbacks from style
    const onOpenChangeFn = useMemo(() => style ? getSomeorUndefined(style.onOpenChange) : undefined, [style]);

    // Hover parity (#347): hover-incapable devices (touch) get tap-to-toggle —
    // the card opens on trigger tap and closes on outside interaction, driven
    // through a controlled `open`. Hover-capable devices keep Zag's hover
    // machine untouched.
    const hoverCapable = useHoverCapable();
    const [tapOpen, setTapOpen] = useState(false);

    const handleOpenChange = useCallback((details: { open: boolean }) => {
        if (!hoverCapable) setTapOpen(details.open);
        if (onOpenChangeFn) {
            queueMicrotask(() => onOpenChangeFn(details.open));
        }
    }, [hoverCapable, onOpenChangeFn]);

    const handleTriggerTap = useCallback(() => {
        const next = !tapOpen;
        setTapOpen(next);
        if (onOpenChangeFn) queueMicrotask(() => onOpenChangeFn(next));
    }, [tapOpen, onOpenChangeFn]);

    return (
        <ChakraHoverCard.Root
            positioning={placement ? { placement } : undefined}
            size={size}
            openDelay={openDelay}
            closeDelay={closeDelay}
            {...(hoverCapable ? {} : { open: tapOpen })}
            onOpenChange={(!hoverCapable || onOpenChangeFn) ? handleOpenChange : undefined}
        >
            <ChakraHoverCard.Trigger asChild>
                <span
                    style={{ display: "inline-flex" }}
                    {...(hoverCapable ? {} : { onClick: handleTriggerTap })}
                >
                    <EastChakraComponent value={value.trigger} storageKey={`${storageKey}.trigger`} />
                </span>
            </ChakraHoverCard.Trigger>
            <Portal>
                <ChakraHoverCard.Positioner>
                    <ChakraHoverCard.Content>
                        {/* The 12px arrow is part of the spec chrome — on unless
                            explicitly disabled. */}
                        {hasArrow !== false && (
                            <ChakraHoverCard.Arrow>
                                <ChakraHoverCard.ArrowTip />
                            </ChakraHoverCard.Arrow>
                        )}
                        {title && <ChakraBox css={cardStyles.title}>{title}</ChakraBox>}
                        {description && <ChakraBox css={cardStyles.description}>{description}</ChakraBox>}
                        {value.body.map((child, index) => (
                            <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
                        ))}
                    </ChakraHoverCard.Content>
                </ChakraHoverCard.Positioner>
            </Portal>
        </ChakraHoverCard.Root>
    );
}, (prev, next) => hoverCardEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
