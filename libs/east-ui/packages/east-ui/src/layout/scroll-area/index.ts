/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    OptionType,
    StructType,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    ScrollAreaOrientationType,
    ScrollbarStyleType,
    ScrollAreaStyleType,
    type ScrollAreaOptions,
} from "./types.js";

/**
 * The East struct that mirrors the `ScrollArea` variant's payload registered
 * inline in `src/component.ts`. Exposed for renderer equality + typing
 * (e.g. `equalFor(ScrollArea.Types.ScrollArea)`).
 */
export const ScrollAreaType = StructType({
    content: UIComponentType,
    scrollbarStyle: OptionType(ScrollbarStyleType),
    style: OptionType(ScrollAreaStyleType),
});
export type ScrollAreaType = typeof ScrollAreaType;

// Re-export types
export {
    ScrollAreaOrientationType,
    ScrollbarStyleType,
    ScrollAreaStyleType,
    type ScrollAreaOrientationLiteral,
    type ScrollbarStyleLiteral,
    type ScrollAreaStyle,
    type ScrollAreaOptions,
} from "./types.js";

/**
 * ScrollArea container primitive — cross-browser consistent scrollbar styling.
 *
 * @remarks
 * Backed by Radix UI `@radix-ui/react-scroll-area`. Use for tables inside
 * drawers, long driver lists, audit trails, or any content where the stock
 * browser scrollbar renders inconsistently across Chrome / Firefox / Safari.
 *
 * @example
 * ```ts
 * import { ScrollArea, Stack, Text } from "@elaraai/east-ui";
 *
 * ScrollArea.Root(
 *     Stack.VStack(drivers.map(d => Text.Root(d.name))),
 *     { orientation: "vertical", scrollbarStyle: "overlay" },
 * );
 * ```
 */
function createScrollArea(
    content: SubtypeExprOrValue<UIComponentType>,
    options?: ScrollAreaOptions,
): ExprType<UIComponentType> {
    const content_expr = East.value(content, UIComponentType);

    const orientationValue = options?.style?.orientation
        ? (typeof options.style.orientation === "string"
            ? East.value(variant(options.style.orientation, null), ScrollAreaOrientationType)
            : options.style.orientation)
        : undefined;

    const scrollbarStyleValue = options?.scrollbarStyle
        ? (typeof options.scrollbarStyle === "string"
            ? East.value(variant(options.scrollbarStyle, null), ScrollbarStyleType)
            : options.scrollbarStyle)
        : undefined;

    const hasStyle = !!options?.style && (
        orientationValue !== undefined ||
        options.style.thumbColor !== undefined ||
        options.style.trackColor !== undefined ||
        options.style.background !== undefined
    );

    return East.value(variant("ScrollArea", {
        content: content_expr,
        scrollbarStyle: scrollbarStyleValue ? variant("some", scrollbarStyleValue) : variant("none", null),
        style: hasStyle
            ? variant("some", East.value({
                orientation: orientationValue ? variant("some", orientationValue) : variant("none", null),
                thumbColor: options!.style!.thumbColor ? variant("some", options!.style!.thumbColor) : variant("none", null),
                trackColor: options!.style!.trackColor ? variant("some", options!.style!.trackColor) : variant("none", null),
                background: options!.style!.background ? variant("some", options!.style!.background) : variant("none", null),
            }, ScrollAreaStyleType))
            : variant("none", null),
    }), UIComponentType);
}

/**
 * ScrollArea namespace.
 */
export const ScrollArea = {
    Root: createScrollArea,
    Types: {
        /** The East struct for the `ScrollArea` variant payload — used by the renderer's memoisation. */
        ScrollArea: ScrollAreaType,
        Orientation: ScrollAreaOrientationType,
        ScrollbarStyle: ScrollbarStyleType,
        Style: ScrollAreaStyleType,
    },
} as const;
