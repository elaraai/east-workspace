/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import {
    FlexDirectionType,
    JustifyContentType,
    AlignItemsType,
    FlexWrapType,
    OverflowType,
    PositionType,
    CursorType,
    BoxShadowType,
    TransitionType,
    AnimationPresetType,
    ZIndexTokenType,
    FontFamilyType,
    FontVariantNumericType,
} from "../../style.js";
import type {
    FlexDirectionLiteral,
    JustifyContentLiteral,
    AlignItemsLiteral,
    FlexWrapLiteral,
    OverflowLiteral,
    PositionLiteral,
    CursorLiteral,
    BoxShadowLiteral,
    TransitionLiteral,
    AnimationPresetLiteral,
    ZIndexTokenLiteral,
    FontFamilyLiteral,
    FontVariantNumericLiteral,
} from "../../style.js";
import { PaddingType, MarginType } from "../style.js";

// ============================================================================
// Flex Style
// ============================================================================

/**
 * Style configuration for Flex components.
 *
 * @remarks
 * All style properties are optional and accept either static values or East expressions
 * for dynamic styling. Size and spacing properties accept Chakra UI tokens or CSS values.
 * Flex is a Box with `display: flex` applied by default.
 *
 * @property direction - Flex direction (row, column, row-reverse, column-reverse)
 * @property wrap - Flex wrap behavior (nowrap, wrap, wrap-reverse)
 * @property justifyContent - Justify content for main axis alignment
 * @property alignItems - Align items for cross axis alignment
 * @property gap - Gap between children (Chakra UI spacing token or CSS value)
 * @property width - Width (Chakra UI size token or CSS value)
 * @property height - Height (Chakra UI size token or CSS value)
 * @property minHeight - Min height (Chakra UI size token or CSS value)
 * @property minWidth - Min width (Chakra UI size token or CSS value)
 * @property maxHeight - Max height (Chakra UI size token or CSS value)
 * @property maxWidth - Max width (Chakra UI size token or CSS value)
 * @property overflow - Overflow behavior for both axes (visible, hidden, scroll, auto)
 * @property overflowX - Horizontal overflow behavior (visible, hidden, scroll, auto)
 * @property overflowY - Vertical overflow behavior (visible, hidden, scroll, auto)
 * @property padding - Padding (Chakra UI spacing token or CSS value)
 * @property margin - Margin (Chakra UI spacing token or CSS value)
 * @property background - Background color (Chakra UI color token or CSS color)
 * @property color - Text color (Chakra UI color token or CSS color)
 * @property borderRadius - Border radius (Chakra UI radius token or CSS value)
 */
export type FlexStyle = {
    /** Flex direction (row, column, row-reverse, column-reverse) */
    direction?: SubtypeExprOrValue<FlexDirectionType> | FlexDirectionLiteral;
    /** Flex wrap behavior (nowrap, wrap, wrap-reverse) */
    wrap?: SubtypeExprOrValue<FlexWrapType> | FlexWrapLiteral;
    /** Justify content for main axis alignment */
    justifyContent?: SubtypeExprOrValue<JustifyContentType> | JustifyContentLiteral;
    /** Align items for cross axis alignment */
    alignItems?: SubtypeExprOrValue<AlignItemsType> | AlignItemsLiteral;
    /** Gap between children (Chakra UI spacing token or CSS value) */
    gap?: SubtypeExprOrValue<StringType>;
    /** Width (Chakra UI size token or CSS value) */
    width?: SubtypeExprOrValue<StringType>;
    /** Height (Chakra UI size token or CSS value) */
    height?: SubtypeExprOrValue<StringType>;
    /** Min height (Chakra UI size token or CSS value) */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** Min width (Chakra UI size token or CSS value) */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** Max height (Chakra UI size token or CSS value) */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Max width (Chakra UI size token or CSS value) */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** Overflow behavior for both axes (visible, hidden, scroll, auto) */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow behavior (visible, hidden, scroll, auto) */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow behavior (visible, hidden, scroll, auto) */
    overflowY?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Padding configuration - use Padding() helper */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin configuration - use Margin() helper */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** Background color (Chakra UI color token or CSS color) */
    background?: SubtypeExprOrValue<StringType>;
    /** Text color (Chakra UI color token or CSS color) */
    color?: SubtypeExprOrValue<StringType>;
    /** Border radius (Chakra UI radius token or CSS value) */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Border shorthand (CSS value, e.g., "1px solid gray.200") */
    border?: SubtypeExprOrValue<StringType>;
    /** Border color (Chakra UI color token or CSS color) */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Border width (CSS value, e.g., "1px", "2px") */
    borderWidth?: SubtypeExprOrValue<StringType>;
    /** Flex shorthand (CSS value, e.g., "1", "1 1 auto", "none") */
    flex?: SubtypeExprOrValue<StringType>;
    /** Flex grow factor (CSS value, e.g., "0", "1") */
    flexGrow?: SubtypeExprOrValue<StringType>;
    /** Flex shrink factor (CSS value, e.g., "0", "1") */
    flexShrink?: SubtypeExprOrValue<StringType>;
    /** CSS `position` token (PositionType). */
    position?: SubtypeExprOrValue<PositionType> | PositionLiteral;
    /** Offset from top (CSS length). */
    top?: SubtypeExprOrValue<StringType>;
    /** Offset from right (CSS length). */
    right?: SubtypeExprOrValue<StringType>;
    /** Offset from bottom (CSS length). */
    bottom?: SubtypeExprOrValue<StringType>;
    /** Offset from left (CSS length). */
    left?: SubtypeExprOrValue<StringType>;
    /** Named stacking layer (ZIndexTokenType — prefer ElevationType for overlay / modal / popover intent). */
    zIndex?: SubtypeExprOrValue<ZIndexTokenType> | ZIndexTokenLiteral;
    /** Named shadow token (prefer ElevationType for card / overlay / modal surfaces). */
    boxShadow?: SubtypeExprOrValue<BoxShadowType> | BoxShadowLiteral;
    /** Raw CSS `transform` value. */
    transform?: SubtypeExprOrValue<StringType>;
    /** Named CSS transition preset. */
    transition?: SubtypeExprOrValue<TransitionType> | TransitionLiteral;
    /** Named cursor token; pair `help` / `not-allowed` with appropriate ARIA per §0.2. */
    cursor?: SubtypeExprOrValue<CursorType> | CursorLiteral;
    /** Opacity in `[0, 1]`. */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Named font family (inherits to children). */
    fontFamily?: SubtypeExprOrValue<FontFamilyType> | FontFamilyLiteral;
    /** Named numeric-glyph variant (`tabular-nums` aligns digit columns). */
    fontVariantNumeric?: SubtypeExprOrValue<FontVariantNumericType> | FontVariantNumericLiteral;
    /** Named animation preset; renderer degrades under `prefers-reduced-motion` per §0.2. */
    animation?: SubtypeExprOrValue<AnimationPresetType> | AnimationPresetLiteral;
};

/**
 * The concrete East type for Flex component style data.
 *
 * @remarks
 * All properties are optional and wrapped in {@link OptionType}.
 * Flex is a Box with `display: flex` applied by default.
 *
 * @property direction - Flex direction (row, column, row-reverse, column-reverse)
 * @property wrap - Flex wrap behavior (nowrap, wrap, wrap-reverse)
 * @property justifyContent - Justify content for main axis alignment
 * @property alignItems - Align items for cross axis alignment
 * @property gap - Gap between children (Chakra UI spacing token or CSS value)
 * @property width - Width (Chakra UI size token or CSS value)
 * @property height - Height (Chakra UI size token or CSS value)
 * @property minHeight - Min height (Chakra UI size token or CSS value)
 * @property minWidth - Min width (Chakra UI size token or CSS value)
 * @property maxHeight - Max height (Chakra UI size token or CSS value)
 * @property maxWidth - Max width (Chakra UI size token or CSS value)
 * @property overflow - Overflow behavior for both axes (visible, hidden, scroll, auto)
 * @property overflowX - Horizontal overflow behavior (visible, hidden, scroll, auto)
 * @property overflowY - Vertical overflow behavior (visible, hidden, scroll, auto)
 * @property padding - Padding configuration
 * @property margin - Margin configuration
 * @property background - Background color (Chakra UI color token or CSS color)
 * @property color - Text color (Chakra UI color token or CSS color)
 * @property borderRadius - Border radius (Chakra UI radius token or CSS value)
 */
export const FlexStyleType = StructType({
    direction: OptionType(FlexDirectionType),
    wrap: OptionType(FlexWrapType),
    justifyContent: OptionType(JustifyContentType),
    alignItems: OptionType(AlignItemsType),
    gap: OptionType(StringType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minHeight: OptionType(StringType),
    minWidth: OptionType(StringType),
    maxHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    overflow: OptionType(OverflowType),
    overflowX: OptionType(OverflowType),
    overflowY: OptionType(OverflowType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    background: OptionType(StringType),
    color: OptionType(StringType),
    borderRadius: OptionType(StringType),
    border: OptionType(StringType),
    borderColor: OptionType(StringType),
    borderWidth: OptionType(StringType),
    flex: OptionType(StringType),
    flexGrow: OptionType(StringType),
    flexShrink: OptionType(StringType),
    position: OptionType(PositionType),
    top: OptionType(StringType),
    right: OptionType(StringType),
    bottom: OptionType(StringType),
    left: OptionType(StringType),
    zIndex: OptionType(ZIndexTokenType),
    boxShadow: OptionType(BoxShadowType),
    transform: OptionType(StringType),
    transition: OptionType(TransitionType),
    cursor: OptionType(CursorType),
    opacity: OptionType(FloatType),
    fontFamily: OptionType(FontFamilyType),
    fontVariantNumeric: OptionType(FontVariantNumericType),
    animation: OptionType(AnimationPresetType),
});

/**
 * Type representing Flex style structure.
 */
export type FlexStyleType = typeof FlexStyleType;
