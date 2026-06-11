/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East, OptionType,
    StringType,
    StructType,
    ArrayType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    HoverCardSizeType,
    HoverCardStyleType,
    type HoverCardStyle, PlacementType
} from "./types.js";

// Re-export types
export {
    HoverCardSizeType,
    HoverCardStyleType,
    type HoverCardStyle,
    PlacementType,
} from "./types.js";
export type { HoverCardSizeLiteral, PlacementLiteral } from "./types.js";

// ============================================================================
// HoverCard Type
// ============================================================================

/**
 * East StructType for HoverCard component.
 *
 * @remarks
 * HoverCard displays rich content when hovering over a trigger element —
 * the same visual as Popover, opened on hover/focus instead of click.
 *
 * @property trigger - The UI component that shows the hover card on hover
 * @property body - Array of UI components for hover card content
 * @property title - Optional hover card title (mono uppercase eyebrow)
 * @property description - Optional hover card description
 * @property style - Optional style configuration
 */
export const HoverCardType: StructType<{
    trigger: UIComponentType,
    body: ArrayType<UIComponentType>,
    title: OptionType<StringType>,
    description: OptionType<StringType>,
    style: OptionType<HoverCardStyleType>,
}> = StructType({
    trigger: UIComponentType,
    body: ArrayType(UIComponentType),
    title: OptionType(StringType),
    description: OptionType(StringType),
    style: OptionType(HoverCardStyleType),
});

/**
 * Type alias for HoverCardType.
 */
export type HoverCardType = typeof HoverCardType;

// ============================================================================
// HoverCard Function
// ============================================================================

/**
 * Creates a HoverCard component with a trigger and body content.
 *
 * @param body - Array of UI components for hover card content
 * @param options - Required `trigger` + optional visual style fields
 * @returns An East expression representing the hover card component
 *
 * @remarks
 * HoverCard displays rich preview content when hovering over an element.
 * Ideal for user profile previews, link previews, or contextual information.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { HoverCard, Text, Avatar, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return HoverCard.Root([
 *         Avatar.Root({ name: "John Doe" }),
 *         Text.Root("Software Engineer"),
 *     ], { trigger: Text.Root("@username"), openDelay: 200n });
 * });
 * ```
 */
export interface HoverCardOptions extends HoverCardStyle {
    /** The UI component that shows the hover card on hover — required. */
    trigger: SubtypeExprOrValue<UIComponentType>;
    /** Optional title — rendered as the mono uppercase eyebrow, same as Popover. */
    title?: SubtypeExprOrValue<StringType>;
    /** Optional description shown under the title. */
    description?: SubtypeExprOrValue<StringType>;
}

function createHoverCard(
    body: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options: HoverCardOptions,
): ExprType<UIComponentType> {
    const { trigger, title, description, ...style } = options;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), HoverCardSizeType)
            : style.size)
        : undefined;

    const placementValue = style.placement
        ? (typeof style.placement === "string"
            ? East.value(variant(style.placement, null), PlacementType)
            : style.placement)
        : undefined;

    const hasStyle = sizeValue || placementValue || style.hasArrow !== undefined ||
        style.openDelay !== undefined || style.closeDelay !== undefined || style.onOpenChange !== undefined;

    return East.value(variant("HoverCard", {
        trigger: trigger,
        body: body,
        title: title !== undefined ? some(title) : none,
        description: description !== undefined ? some(description) : none,
        style: hasStyle
            ? some(East.value({
                size: sizeValue ? some(sizeValue) : none,
                placement: placementValue ? some(placementValue) : none,
                hasArrow: style.hasArrow !== undefined ? some(style.hasArrow) : none,
                openDelay: style.openDelay !== undefined ? some(style.openDelay) : none,
                closeDelay: style.closeDelay !== undefined ? some(style.closeDelay) : none,
                onOpenChange: style.onOpenChange !== undefined ? some(style.onOpenChange) : none,
            }, HoverCardStyleType))
            : none,
    }), UIComponentType);
}

/**
 * HoverCard component for rich hover previews.
 *
 * @remarks
 * Use `HoverCard.Root(body, { trigger, ... })` to create a hover card, or access `HoverCard.Types` for East types.
 */
export const HoverCard = {
    /**
     * Creates a HoverCard component with a trigger and body content.
     *
     * @param body - Array of UI components for hover card content
     * @param options - Required `trigger` + optional visual style fields
     * @returns An East expression representing the hover card component
     *
     * @remarks
     * HoverCard displays rich preview content when hovering over an element.
     * Ideal for user profile previews, link previews, or contextual information.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { HoverCard, Text, Avatar, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return HoverCard.Root([
     *         Avatar.Root({ name: "John Doe" }),
     *         Text.Root("Software Engineer"),
     *     ], { trigger: Text.Root("@username"), openDelay: 200n });
     * });
     * ```
     */
    Root: createHoverCard,
    Types: {
        /**
         * East StructType for HoverCard component.
         *
         * @remarks
         * HoverCard displays rich content when hovering over a trigger element —
         * the same visual as Popover, opened on hover/focus instead of click.
         *
         * @property trigger - The UI component that shows the hover card on hover
         * @property body - Array of UI components for hover card content
         * @property title - Optional hover card title (mono uppercase eyebrow)
         * @property description - Optional hover card description
         * @property style - Optional style configuration
         */
        HoverCard: HoverCardType,
        /**
         * Style type for HoverCard component.
         *
         * @property size - HoverCard size variant
         * @property placement - Position relative to trigger
         * @property hasArrow - Show arrow pointing to trigger
         * @property openDelay - Delay before opening (ms)
         * @property closeDelay - Delay before closing (ms)
         */
        Style: HoverCardStyleType,
        /**
         * Size variant type for HoverCard component.
         *
         * @property xs - Extra small padding
         * @property sm - Small padding
         * @property md - Medium padding (default)
         * @property lg - Large padding
         */
        Size: HoverCardSizeType,
        /**
         * Placement options for Tooltip positioning.
         *
         * @remarks
         * Controls where the tooltip appears relative to its trigger element.
         * Supports all cardinal directions with start/end variations.
         *
         * @property top - Centered above the trigger
         * @property top-start - Above, aligned to start
         * @property top-end - Above, aligned to end
         * @property bottom - Centered below the trigger
         * @property bottom-start - Below, aligned to start
         * @property bottom-end - Below, aligned to end
         * @property left - Centered to the left
         * @property left-start - Left, aligned to start
         * @property left-end - Left, aligned to end
         * @property right - Centered to the right
         * @property right-start - Right, aligned to start
         * @property right-end - Right, aligned to end
         */
        Placement: PlacementType,
    },
} as const;
