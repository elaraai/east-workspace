/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Cross-browser scrollbar styling: `@radix-ui/react-scroll-area`
 */

import { memo, useMemo } from "react";
import * as RadixScrollArea from "@radix-ui/react-scroll-area";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { ScrollArea } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const scrollAreaEqual = equalFor(ScrollArea.Types.ScrollArea);

/** East ScrollArea value type. */
export type ScrollAreaValue = ValueTypeOf<typeof ScrollArea.Types.ScrollArea>;

export interface EastChakraScrollAreaProps {
    value: ScrollAreaValue;
    storageKey: string;
}

export const EastChakraScrollArea = memo(function EastChakraScrollArea({ value, storageKey }: EastChakraScrollAreaProps) {
    const scrollbarStyleTag = useMemo(() => getSomeorUndefined(value.scrollbarStyle)?.type, [value.scrollbarStyle]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const orientationTag = useMemo(
        () => (style ? getSomeorUndefined(style.orientation)?.type : undefined),
        [style],
    );
    const thumbColor = style ? getSomeorUndefined(style.thumbColor) : undefined;
    const trackColor = style ? getSomeorUndefined(style.trackColor) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;

    const showVertical = orientationTag !== "horizontal";
    const showHorizontal = orientationTag === "horizontal" || orientationTag === "both";
    const scrollbarType = scrollbarStyleTag === "reserved" ? "always" : "hover";

    // Minimal Radix wrapping. The Radix primitives are unstyled by default;
    // we inline the essential sizing via the `style` prop so the rail
    // renders without requiring the consumer to bring their own CSS.
    return (
        <RadixScrollArea.Root
            type={scrollbarType}
            style={{ position: "relative", overflow: "hidden", width: "100%", height: "100%", background }}
        >
            <RadixScrollArea.Viewport style={{ width: "100%", height: "100%" }}>
                <EastChakraComponent value={value.content} storageKey={`${storageKey}.content`} />
            </RadixScrollArea.Viewport>
            {showVertical && (
                <RadixScrollArea.Scrollbar
                    orientation="vertical"
                    style={{ display: "flex", userSelect: "none", touchAction: "none", padding: "2px", background: trackColor, width: "8px" }}
                >
                    <RadixScrollArea.Thumb style={{ flex: 1, background: thumbColor ?? "var(--chakra-colors-overlay-scroll-thumb)", borderRadius: "4px" }} />
                </RadixScrollArea.Scrollbar>
            )}
            {showHorizontal && (
                <RadixScrollArea.Scrollbar
                    orientation="horizontal"
                    style={{ display: "flex", userSelect: "none", touchAction: "none", padding: "2px", background: trackColor, height: "8px", flexDirection: "column" }}
                >
                    <RadixScrollArea.Thumb style={{ flex: 1, background: thumbColor ?? "var(--chakra-colors-overlay-scroll-thumb)", borderRadius: "4px" }} />
                </RadixScrollArea.Scrollbar>
            )}
            <RadixScrollArea.Corner />
        </RadixScrollArea.Root>
    );
}, (prev, next) => scrollAreaEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
