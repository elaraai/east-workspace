/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Popover as ChakraPopover, Portal, Tooltip as ChakraTooltip, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Tooltip } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { useHoverCapable } from "../../contracts/index.js";

// Pre-define equality function at module level
const tooltipEqual = equalFor(Tooltip.Types.Tooltip);

/** Long-press delay before a touch shows the tooltip (#347). */
const LONG_PRESS_MS = 500;

/** East Tooltip value type */
export type TooltipValue = ValueTypeOf<typeof Tooltip.Types.Tooltip>;

export interface EastChakraTooltipProps {
    value: TooltipValue;
    storageKey: string;
}

/**
 * Renders an East UI Tooltip value using Chakra UI Tooltip component.
 *
 * Hover parity (#347): touch devices have no hover, and Zag's tooltip
 * machine is hover/focus-driven — so on hover-incapable devices the
 * tooltip renders through the ToggleTip chassis instead (a controlled
 * Popover carrying the tooltip recipe's chrome), opened by a 500ms
 * long-press and closed on release.
 */
export const EastChakraTooltip = memo(function EastChakraTooltip({ value, storageKey }: EastChakraTooltipProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const placement = useMemo(
        () => (style ? getSomeorUndefined(style.placement)?.type : undefined),
        [style],
    );
    const hasArrow = useMemo(
        () => (style ? getSomeorUndefined(style.hasArrow) : undefined),
        [style],
    );

    const hoverCapable = useHoverCapable();
    const [pressOpen, setPressOpen] = useState(false);
    const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(pressTimer.current), []);

    const handlePressStart = useCallback((e: ReactPointerEvent) => {
        if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
        clearTimeout(pressTimer.current);
        pressTimer.current = setTimeout(() => setPressOpen(true), LONG_PRESS_MS);
    }, []);
    const handlePressEnd = useCallback(() => {
        clearTimeout(pressTimer.current);
        setPressOpen(false);
    }, []);
    const handleContextMenu = useCallback((e: { preventDefault(): void }) => {
        // Android fires contextmenu on long-press — the tooltip is the
        // intended response, not the browser menu.
        e.preventDefault();
    }, []);

    // Long-press path reuses the tooltip recipe's dark-chip content (the
    // ToggleTip pattern) on a controlled Popover.
    const tipStyles = useSlotRecipe({ key: "tooltip" })();

    if (!hoverCapable) {
        return (
            <ChakraPopover.Root
                open={pressOpen}
                positioning={placement ? { placement } : undefined}
            >
                <ChakraPopover.Trigger asChild>
                    <span
                        style={{ display: "inline-flex" }}
                        onPointerDown={handlePressStart}
                        onPointerUp={handlePressEnd}
                        onPointerLeave={handlePressEnd}
                        onPointerCancel={handlePressEnd}
                        onContextMenu={handleContextMenu}
                    >
                        <EastChakraComponent value={value.trigger} storageKey={`${storageKey}.trigger`} />
                    </span>
                </ChakraPopover.Trigger>
                <Portal>
                    <ChakraPopover.Positioner>
                        <ChakraPopover.Content css={tipStyles.content} width="auto">
                            {hasArrow && <ChakraPopover.Arrow css={tipStyles.arrow} />}
                            {value.content}
                        </ChakraPopover.Content>
                    </ChakraPopover.Positioner>
                </Portal>
            </ChakraPopover.Root>
        );
    }

    return (
        <ChakraTooltip.Root positioning={placement ? { placement } : undefined}>
            <ChakraTooltip.Trigger asChild>
                <span style={{ display: "inline-flex" }}>
                    <EastChakraComponent value={value.trigger} storageKey={`${storageKey}.trigger`} />
                </span>
            </ChakraTooltip.Trigger>
            <ChakraTooltip.Positioner>
                <ChakraTooltip.Content>
                    {hasArrow && (
                        <ChakraTooltip.Arrow>
                            <ChakraTooltip.ArrowTip />
                        </ChakraTooltip.Arrow>
                    )}
                    {value.content}
                </ChakraTooltip.Content>
            </ChakraTooltip.Positioner>
        </ChakraTooltip.Root>
    );
}, (prev, next) => tooltipEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
