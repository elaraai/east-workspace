/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { Popover as ChakraPopover, Portal } from "@chakra-ui/react";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Popover } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

// Pre-define equality function at module level
const popoverEqual = equivalentFor(Popover.Types.Popover);

/** East Popover value type */
export type PopoverValue = ValueTypeOf<typeof Popover.Types.Popover>;

export interface EastChakraPopoverProps {
    value: PopoverValue;
    storageKey: string;
}

/**
 * Renders an East UI Popover value using Chakra UI Popover component.
 */
export const EastChakraPopover = memo(function EastChakraPopover({ value, storageKey }: EastChakraPopoverProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const placement = useMemo(() => style ? getSomeorUndefined(style.placement)?.type : undefined, [style]);
    const size = useMemo(() => style ? getSomeorUndefined(style.size)?.type : undefined, [style]);
    const hasArrow = useMemo(() => style ? getSomeorUndefined(style.hasArrow) : undefined, [style]);
    const title = useMemo(() => getSomeorUndefined(value.title), [value.title]);
    const description = useMemo(() => getSomeorUndefined(value.description), [value.description]);
    const positioning = useMemo(() => {
        const gutter = style ? getSomeorUndefined(style.gutter) : undefined;
        if (placement === undefined && gutter === undefined) return undefined;
        return { ...(placement !== undefined ? { placement } : {}), ...(gutter !== undefined ? { gutter: Number(gutter) } : {}) };
    }, [style, placement]);
    // How it opens and closes: `open` controls it, so a callback anywhere
    // opens it at its own trigger through the State it reads.
    const behaviour = useMemo(() => ({
        open: style ? getSomeorUndefined(style.open) : undefined,
        defaultOpen: style ? getSomeorUndefined(style.defaultOpen) : undefined,
        closeOnInteractOutside: style ? getSomeorUndefined(style.closeOnInteractOutside) : undefined,
        closeOnEscape: style ? getSomeorUndefined(style.closeOnEscape) : undefined,
        autoFocus: style ? getSomeorUndefined(style.autoFocus) : undefined,
        lazyMount: style ? getSomeorUndefined(style.lazyMount) : undefined,
        unmountOnExit: style ? getSomeorUndefined(style.unmountOnExit) : undefined,
    }), [style]);

    // Extract callbacks from style
    const onOpenChangeFn = useMemo(() => style ? getSomeorUndefined(style.onOpenChange) : undefined, [style]);

    const handleOpenChange = useCallback((details: { open: boolean }) => {
        if (onOpenChangeFn) {
            queueMicrotask(() => onOpenChangeFn(details.open));
        }
    }, [onOpenChangeFn]);

    return (
        <ChakraPopover.Root
            positioning={positioning}
            size={size}
            {...behaviour}
            onOpenChange={onOpenChangeFn ? handleOpenChange : undefined}
        >
            <ChakraPopover.Trigger asChild>
                <span style={{ display: "inline-flex" }}>
                    <EastChakraComponent value={value.trigger} storageKey={`${storageKey}.trigger`} />
                </span>
            </ChakraPopover.Trigger>
            <Portal>
                <ChakraPopover.Positioner>
                    <ChakraPopover.Content>
                        {/* The 12px arrow is part of the spec chrome — on unless
                            explicitly disabled. */}
                        {hasArrow !== false && (
                            <ChakraPopover.Arrow>
                                <ChakraPopover.ArrowTip />
                            </ChakraPopover.Arrow>
                        )}
                        <ChakraPopover.Body>
                            {title && <ChakraPopover.Title>{title}</ChakraPopover.Title>}
                            {description && <ChakraPopover.Description>{description}</ChakraPopover.Description>}
                            {value.body.map((child, index) => (
                                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
                            ))}
                        </ChakraPopover.Body>
                    </ChakraPopover.Content>
                </ChakraPopover.Positioner>
            </Portal>
        </ChakraPopover.Root>
    );
}, (prev, next) => popoverEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
