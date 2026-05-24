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
    DisplayType,
    FlexDirectionType,
    JustifyContentType,
    AlignItemsType,
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
    DisplayLiteral,
    FlexDirectionLiteral,
    JustifyContentLiteral,
    AlignItemsLiteral,
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
// Box Style
// ============================================================================

/**
 * Style configuration for Box components.
 *
 * @remarks
 * All style properties are optional and accept either static values or East expressions
 * for dynamic styling. Size and spacing properties accept Chakra UI tokens or CSS values.
 *
 * @property display - CSS display property
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
 * @property flexDirection - Flex direction for flex containers
 * @property justifyContent - Justify content for flex/grid containers
 * @property alignItems - Align items for flex/grid containers
 * @property gap - Gap between children (Chakra UI spacing token or CSS value)
 * @property position - CSS `position` (from PositionType: static | relative | absolute | fixed | sticky)
 * @property top - Offset from top (CSS length)
 * @property right - Offset from right (CSS length)
 * @property bottom - Offset from bottom (CSS length)
 * @property left - Offset from left (CSS length)
 * @property zIndex - Named stacking layer (ZIndexTokenType — prefer ElevationType when intent is an overlay / modal / popover)
 * @property boxShadow - Named shadow token (prefer ElevationType for card / overlay / modal surfaces)
 * @property transform - Raw CSS transform value (e.g. `translateY(-2px)`)
 * @property transition - Named transition preset (TransitionType)
 * @property cursor - Named cursor token (CursorType) — pair `help` / `not-allowed` with appropriate ARIA
 * @property opacity - Opacity in `[0, 1]`
 * @property fontFamily - Named font family (FontFamilyType) — inherits to children
 * @property fontVariantNumeric - Named numeric variant (FontVariantNumericType); `tabular-nums` aligns digit columns
 * @property animation - Named animation preset (AnimationPresetType); renderer degrades to `none` under `prefers-reduced-motion`
 */
export type BoxStyle = {
    /** CSS display property */
    display?: SubtypeExprOrValue<DisplayType> | DisplayLiteral;
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
    /** Flex direction for flex containers */
    flexDirection?: SubtypeExprOrValue<FlexDirectionType> | FlexDirectionLiteral;
    /** Justify content for flex/grid containers */
    justifyContent?: SubtypeExprOrValue<JustifyContentType> | JustifyContentLiteral;
    /** Align items for flex/grid containers */
    alignItems?: SubtypeExprOrValue<AlignItemsType> | AlignItemsLiteral;
    /** Gap between children (Chakra UI spacing token or CSS value) */
    gap?: SubtypeExprOrValue<StringType>;
    /** CSS `position` (from PositionType: static | relative | absolute | fixed | sticky) */
    position?: SubtypeExprOrValue<PositionType> | PositionLiteral;
    /** Offset from top (CSS length) */
    top?: SubtypeExprOrValue<StringType>;
    /** Offset from right (CSS length) */
    right?: SubtypeExprOrValue<StringType>;
    /** Offset from bottom (CSS length) */
    bottom?: SubtypeExprOrValue<StringType>;
    /** Offset from left (CSS length) */
    left?: SubtypeExprOrValue<StringType>;
    /**
     * Named stacking layer.
     *
     * Prefer `ElevationType` (Card.elevation) when the intent is an overlay /
     * modal / popover rather than "this is at z-index 1400".
     */
    zIndex?: SubtypeExprOrValue<ZIndexTokenType> | ZIndexTokenLiteral;
    /**
     * Named shadow token.
     *
     * Prefer `ElevationType` for card / overlay / modal surfaces; use
     * `BoxShadowType` directly only when pixel-level control is needed.
     */
    boxShadow?: SubtypeExprOrValue<BoxShadowType> | BoxShadowLiteral;
    /** Raw CSS `transform` value (e.g. `"translateY(-2px)"`). */
    transform?: SubtypeExprOrValue<StringType>;
    /** Named CSS transition preset (paired with theme-owned duration + easing). */
    transition?: SubtypeExprOrValue<TransitionType> | TransitionLiteral;
    /** Named cursor. Pair `help` / `not-allowed` with appropriate ARIA. */
    cursor?: SubtypeExprOrValue<CursorType> | CursorLiteral;
    /** Opacity in `[0, 1]`. */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Named font family. Inherits to children. */
    fontFamily?: SubtypeExprOrValue<FontFamilyType> | FontFamilyLiteral;
    /**
     * Named numeric-glyph variant. `tabular-nums` aligns digit columns across
     * rows — essential for KPI tiles and financial tables.
     */
    fontVariantNumeric?: SubtypeExprOrValue<FontVariantNumericType> | FontVariantNumericLiteral;
    /**
     * Named animation preset (pulse / spin / bounce / fade-in / shimmer).
     *
     * The renderer consults `prefers-reduced-motion` and degrades to `none`
     * when the user has requested reduced motion (contract).
     */
    animation?: SubtypeExprOrValue<AnimationPresetType> | AnimationPresetLiteral;
};

/**
 * The concrete East type for Box component style data.
 *
 * @remarks
 * All properties are optional and wrapped in {@link OptionType}.
 *
 * @property display - CSS display property
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
 * @property flexDirection - Flex direction for flex containers
 * @property justifyContent - Justify content for flex/grid containers
 * @property alignItems - Align items for flex/grid containers
 * @property gap - Gap between children (Chakra UI spacing token or CSS value)
 * @property position - CSS `position` token
 * @property top - Offset from top (CSS length)
 * @property right - Offset from right (CSS length)
 * @property bottom - Offset from bottom (CSS length)
 * @property left - Offset from left (CSS length)
 * @property zIndex - Named stacking layer token
 * @property boxShadow - Named shadow token
 * @property transform - Raw CSS transform value
 * @property transition - Named transition preset
 * @property cursor - Named cursor token
 * @property opacity - Opacity in `[0, 1]`
 * @property fontFamily - Named font family token (inherits to children)
 * @property fontVariantNumeric - Named numeric-glyph variant token
 * @property animation - Named animation preset (renderer degrades under `prefers-reduced-motion`)
 */
export const BoxStyleType = StructType({
    display: OptionType(DisplayType),
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
    flexDirection: OptionType(FlexDirectionType),
    justifyContent: OptionType(JustifyContentType),
    alignItems: OptionType(AlignItemsType),
    gap: OptionType(StringType),
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
 * Type representing Box style structure.
 */
export type BoxStyleType = typeof BoxStyleType;
