/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

/**
 * ScrollArea orientation.
 *
 * @property vertical - Only vertical scrollbar
 * @property horizontal - Only horizontal scrollbar
 * @property both - Both scrollbars visible when needed
 */
export const ScrollAreaOrientationType = VariantType({
    vertical: NullType,
    horizontal: NullType,
    both: NullType,
});
export type ScrollAreaOrientationType = typeof ScrollAreaOrientationType;
export type ScrollAreaOrientationLiteral = "vertical" | "horizontal" | "both";

/**
 * Scrollbar visual style.
 *
 * @remarks
 * `overlay` scrollbars float over content and only appear while scrolling
 * (Radix's default). `reserved` always occupies gutter space so content
 * doesn't reflow when the scrollbar appears.
 *
 * @property overlay - Scrollbars float over content (default)
 * @property reserved - Scrollbars reserve gutter space (layout never shifts)
 */
export const ScrollbarStyleType = VariantType({
    overlay: NullType,
    reserved: NullType,
});
export type ScrollbarStyleType = typeof ScrollbarStyleType;
export type ScrollbarStyleLiteral = "overlay" | "reserved";

/**
 * Style configuration for ScrollArea.
 *
 * @property thumbColor - Colour of the draggable scroll thumb
 * @property trackColor - Colour of the scrollbar track
 * @property background - Background colour of the scrollable viewport
 */
export const ScrollAreaStyleType = StructType({
    thumbColor: OptionType(StringType),
    trackColor: OptionType(StringType),
    background: OptionType(StringType),
});
export type ScrollAreaStyleType = typeof ScrollAreaStyleType;

export interface ScrollAreaStyle {
    /** Colour of the draggable scroll thumb. */
    thumbColor?: SubtypeExprOrValue<StringType>;
    /** Colour of the scrollbar track. */
    trackColor?: SubtypeExprOrValue<StringType>;
    /** Background colour of the scrollable viewport. */
    background?: SubtypeExprOrValue<StringType>;
}

export interface ScrollAreaOptions {
    /** Scrollbar orientation; default `vertical`. */
    orientation?: SubtypeExprOrValue<ScrollAreaOrientationType> | ScrollAreaOrientationLiteral;
    /** Scrollbar visual style; default `overlay`. */
    scrollbarStyle?: SubtypeExprOrValue<ScrollbarStyleType> | ScrollbarStyleLiteral;
    /** Style escape hatches. */
    style?: ScrollAreaStyle;
}
