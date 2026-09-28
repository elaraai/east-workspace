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
    some,
    none,
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

    const orientationValue = options?.orientation
        ? (typeof options.orientation === "string"
            ? East.value(variant(options.orientation, null), ScrollAreaOrientationType)
            : options.orientation)
        : undefined;

    const scrollbarStyleValue = options?.scrollbarStyle
        ? (typeof options.scrollbarStyle === "string"
            ? East.value(variant(options.scrollbarStyle, null), ScrollbarStyleType)
            : options.scrollbarStyle)
        : undefined;

    const hasStyle = !!options && (
        orientationValue !== undefined ||
        options.thumbColor !== undefined ||
        options.trackColor !== undefined ||
        options.background !== undefined
    );

    return East.value(variant("ScrollArea", {
        content: content_expr,
        scrollbarStyle: scrollbarStyleValue ? some(scrollbarStyleValue) : none,
        style: hasStyle
            ? some(East.value({
                orientation: orientationValue ? some(orientationValue) : none,
                thumbColor: options!.thumbColor ? some(options!.thumbColor) : none,
                trackColor: options!.trackColor ? some(options!.trackColor) : none,
                background: options!.background ? some(options!.background) : none,
            }, ScrollAreaStyleType))
            : none,
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
