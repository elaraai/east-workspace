/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BooleanType,
    FloatType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import {
    DensityType,
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
    DensityLiteral,
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

/**
 * Style configuration for Stack components.
 *
 * @remarks
 * Stack is a layout component that arranges children in a single direction
 * (row or column) with configurable spacing and alignment.
 *
 * @property direction - Stack direction (row or column)
 * @property gap - Gap between children (Chakra UI spacing token or CSS value)
 * @property align - Cross-axis alignment
 * @property justify - Main-axis alignment
 * @property wrap - Flex wrap behavior
 * @property padding - Padding configuration
 * @property margin - Margin configuration
 * @property background - Background color (Chakra UI color token or CSS color)
 * @property width - Width (Chakra UI size token or CSS value)
 * @property height - Height (Chakra UI size token or CSS value)
 * @property minHeight - Min height (Chakra UI size token or CSS value)
 * @property minWidth - Min width (Chakra UI size token or CSS value)
 * @property maxHeight - Max height (Chakra UI size token or CSS value)
 * @property maxWidth - Max width (Chakra UI size token or CSS value)
 * @property overflow - Overflow behavior for both axes (visible, hidden, scroll, auto)
 * @property overflowX - Horizontal overflow behavior (visible, hidden, scroll, auto)
 * @property overflowY - Vertical overflow behavior (visible, hidden, scroll, auto)
 */
export type StackStyle = {
    /**
     * Density the stack provides to its children via the density cascade.
     * Display components inside (Tag, Badge, Meter, Trace, …) inherit it
     * unless they carry their own density; the stack itself is visually
     * unchanged. When omitted, the stack is transparent to the cascade and an
     * enclosing surface's density flows through.
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Stack direction (row or column) */
    direction?: SubtypeExprOrValue<FlexDirectionType> | FlexDirectionLiteral;
    /** Gap between children (Chakra UI spacing token or CSS value) */
    gap?: SubtypeExprOrValue<StringType>;
    /** Cross-axis alignment */
    align?: SubtypeExprOrValue<AlignItemsType> | AlignItemsLiteral;
    /** Main-axis alignment */
    justify?: SubtypeExprOrValue<JustifyContentType> | JustifyContentLiteral;
    /** Flex wrap behavior */
    wrap?: SubtypeExprOrValue<FlexWrapType> | FlexWrapLiteral;
    /** Padding configuration - use Padding() helper */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin configuration - use Margin() helper */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** Background color (Chakra UI color token or CSS color) */
    background?: SubtypeExprOrValue<StringType>;
    /** Border radius (Chakra UI radius token or CSS value) */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Border shorthand (CSS value, e.g., "1px solid gray.200") */
    border?: SubtypeExprOrValue<StringType>;
    /** Border color (Chakra UI color token or CSS color) */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Border width (CSS value, e.g., "1px", "2px") */
    borderWidth?: SubtypeExprOrValue<StringType>;
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
    /** `fill` shorthand — occupy the remaining main-axis space (`flex: 1 1 0%` + min-size 0), so the stack bounds and scrolls inside a flex parent without the `flex:1 + min-height:0` incantation (#320). */
    fill?: SubtypeExprOrValue<BooleanType>;
    /** `scroll` shorthand — scroll on both axes (`overflow: auto` + min-size 0). Composes with `fill`. */
    scroll?: SubtypeExprOrValue<BooleanType>;
    /** `scrollX` shorthand — scroll horizontally (`overflow-x: auto` + min-width 0). */
    scrollX?: SubtypeExprOrValue<BooleanType>;
    /** `scrollY` shorthand — scroll vertically (`overflow-y: auto` + min-height 0). */
    scrollY?: SubtypeExprOrValue<BooleanType>;
    /** Flex shorthand (CSS value, e.g., "1", "1 1 auto", "none"). */
    flex?: SubtypeExprOrValue<StringType>;
    /** Flex grow factor (CSS value, e.g., "0", "1"). */
    flexGrow?: SubtypeExprOrValue<StringType>;
    /** Flex shrink factor; defaults to "0" when a definite `height`/`width` is set. */
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
    /** Named cursor token; pair `help` / `not-allowed` with appropriate ARIA. */
    cursor?: SubtypeExprOrValue<CursorType> | CursorLiteral;
    /** Opacity in `[0, 1]`. */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Named font family (inherits to children). */
    fontFamily?: SubtypeExprOrValue<FontFamilyType> | FontFamilyLiteral;
    /** Named numeric-glyph variant (`tabular-nums` aligns digit columns). */
    fontVariantNumeric?: SubtypeExprOrValue<FontVariantNumericType> | FontVariantNumericLiteral;
    /** Named animation preset; renderer degrades under `prefers-reduced-motion`. */
    animation?: SubtypeExprOrValue<AnimationPresetType> | AnimationPresetLiteral;
};

/**
 * The concrete East type for Stack component style data.
 *
 * @remarks
 * All properties are optional and wrapped in {@link OptionType}.
 *
 * @property direction - Stack direction (row or column)
 * @property gap - Gap between children (Chakra UI spacing token or CSS value)
 * @property align - Cross-axis alignment
 * @property justify - Main-axis alignment
 * @property wrap - Flex wrap behavior
 * @property padding - Padding configuration
 * @property margin - Margin configuration
 * @property background - Background color (Chakra UI color token or CSS color)
 * @property width - Width (Chakra UI size token or CSS value)
 * @property height - Height (Chakra UI size token or CSS value)
 * @property minHeight - Min height (Chakra UI size token or CSS value)
 * @property minWidth - Min width (Chakra UI size token or CSS value)
 * @property maxHeight - Max height (Chakra UI size token or CSS value)
 * @property maxWidth - Max width (Chakra UI size token or CSS value)
 * @property overflow - Overflow behavior for both axes (visible, hidden, scroll, auto)
 * @property overflowX - Horizontal overflow behavior (visible, hidden, scroll, auto)
 * @property overflowY - Vertical overflow behavior (visible, hidden, scroll, auto)
 */
export const StackStyleType = StructType({
    direction: OptionType(FlexDirectionType),
    gap: OptionType(StringType),
    align: OptionType(AlignItemsType),
    justify: OptionType(JustifyContentType),
    wrap: OptionType(FlexWrapType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    background: OptionType(StringType),
    borderRadius: OptionType(StringType),
    border: OptionType(StringType),
    borderColor: OptionType(StringType),
    borderWidth: OptionType(StringType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minHeight: OptionType(StringType),
    minWidth: OptionType(StringType),
    maxHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    overflow: OptionType(OverflowType),
    overflowX: OptionType(OverflowType),
    overflowY: OptionType(OverflowType),
    fill: OptionType(BooleanType),
    scroll: OptionType(BooleanType),
    scrollX: OptionType(BooleanType),
    scrollY: OptionType(BooleanType),
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
 * Type representing Stack style structure.
 */
export type StackStyleType = typeof StackStyleType;
