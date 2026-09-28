/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    OptionType,
    StructType,
    ArrayType,
    variant,
    type SubtypeExprOrValue,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { FlexStyleType, type FlexStyle } from "./types.js";
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
import { Padding, PaddingType, Margin, MarginType } from "../style.js";

// Re-export style types
export { FlexStyleType, type FlexStyle } from "./types.js";

/**
 * The concrete East type for Flex component data.
 *
 * @remarks
 * This struct type represents the serializable data structure for a Flex component.
 * Flex is a container component with `display: flex` applied by default.
 *
 * @property children - Array of child UI components
 * @property density - Optional density the flex container provides to its children via the density cascade
 * @property style - Optional styling configuration wrapped in OptionType
 */
export const FlexType: StructType<{
    children: ArrayType<UIComponentType>,
    density: OptionType<DensityType>,
    style: OptionType<FlexStyleType>,
}> = StructType({
    children: ArrayType(UIComponentType),
    density: OptionType(DensityType),
    style: OptionType(FlexStyleType),
});

/**
 * Type representing the Flex component structure.
 */
export type FlexType = typeof FlexType;

/**
 * Creates a Flex container component with children and optional styling.
 *
 * @param children - Array of child UI components
 * @param style - Optional styling configuration for the flex container
 * @returns An East expression representing the styled flex component
 *
 * @remarks
 * Flex is a convenience component that renders a Box with `display: flex` applied.
 * It provides easy access to flexbox layout properties like direction, wrap,
 * justifyContent, and alignItems.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Flex, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Flex.Root([
 *         Text.Root("Item 1"),
 *         Text.Root("Item 2"),
 *     ], {
 *         direction: "row",
 *         gap: "4",
 *         justifyContent: "space-between",
 *     });
 * });
 * ```
 */
function createFlex(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    style?: FlexStyle
): ExprType<UIComponentType> {
    const densityValue = style?.density
        ? (typeof style.density === "string"
            ? East.value(variant(style.density, null), DensityType)
            : style.density)
        : undefined;

    const directionValue = style?.direction
        ? (typeof style.direction === "string"
            ? East.value(variant(style.direction, null), FlexDirectionType)
            : style.direction)
        : undefined;

    const wrapValue = style?.wrap
        ? (typeof style.wrap === "string"
            ? East.value(variant(style.wrap, null), FlexWrapType)
            : style.wrap)
        : undefined;

    const justifyContentValue = style?.justifyContent
        ? (typeof style.justifyContent === "string"
            ? East.value(variant(style.justifyContent, null), JustifyContentType)
            : style.justifyContent)
        : undefined;

    const alignItemsValue = style?.alignItems
        ? (typeof style.alignItems === "string"
            ? East.value(variant(style.alignItems, null), AlignItemsType)
            : style.alignItems)
        : undefined;

    const paddingValue = style?.padding
        ? (typeof style.padding === "string"
            ? East.value({
                top: some(style.padding),
                right: some(style.padding),
                bottom: some(style.padding),
                left: some(style.padding)
            }, PaddingType)
            : style.padding)
        : undefined;

    const marginValue = style?.margin
        ? (typeof style.margin === "string"
            ? East.value({
                top: some(style.margin),
                right: some(style.margin),
                bottom: some(style.margin),
                left: some(style.margin)
            }, MarginType)
            : style.margin)
        : undefined;

    const overflowValue = style?.overflow
        ? (typeof style.overflow === "string"
            ? East.value(variant(style.overflow, null), OverflowType)
            : style.overflow)
        : undefined;

    const overflowXValue = style?.overflowX
        ? (typeof style.overflowX === "string"
            ? East.value(variant(style.overflowX, null), OverflowType)
            : style.overflowX)
        : undefined;

    const overflowYValue = style?.overflowY
        ? (typeof style.overflowY === "string"
            ? East.value(variant(style.overflowY, null), OverflowType)
            : style.overflowY)
        : undefined;

    const positionValue = style?.position
        ? (typeof style.position === "string"
            ? East.value(variant(style.position, null), PositionType)
            : style.position)
        : undefined;

    const zIndexValue = style?.zIndex
        ? (typeof style.zIndex === "string"
            ? East.value(variant(style.zIndex, null), ZIndexTokenType)
            : style.zIndex)
        : undefined;

    const boxShadowValue = style?.boxShadow
        ? (typeof style.boxShadow === "string"
            ? East.value(variant(style.boxShadow, null), BoxShadowType)
            : style.boxShadow)
        : undefined;

    const transitionValue = style?.transition
        ? (typeof style.transition === "string"
            ? East.value(variant(style.transition, null), TransitionType)
            : style.transition)
        : undefined;

    const cursorValue = style?.cursor
        ? (typeof style.cursor === "string"
            ? East.value(variant(style.cursor, null), CursorType)
            : style.cursor)
        : undefined;

    const fontFamilyValue = style?.fontFamily
        ? (typeof style.fontFamily === "string"
            ? East.value(variant(style.fontFamily, null), FontFamilyType)
            : style.fontFamily)
        : undefined;

    const fontVariantNumericValue = style?.fontVariantNumeric
        ? (typeof style.fontVariantNumeric === "string"
            ? East.value(variant(style.fontVariantNumeric, null), FontVariantNumericType)
            : style.fontVariantNumeric)
        : undefined;

    const animationValue = style?.animation
        ? (typeof style.animation === "string"
            ? East.value(variant(style.animation, null), AnimationPresetType)
            : style.animation)
        : undefined;

    return East.value(variant("Flex", {
        children: children,
        density: densityValue ? some(densityValue) : none,
        style: style ? some(East.value({
            direction: directionValue ? some(directionValue) : none,
            wrap: wrapValue ? some(wrapValue) : none,
            justifyContent: justifyContentValue ? some(justifyContentValue) : none,
            alignItems: alignItemsValue ? some(alignItemsValue) : none,
            gap: style.gap ? some(style.gap) : none,
            width: style.width ? some(style.width) : none,
            height: style.height ? some(style.height) : none,
            minHeight: style.minHeight ? some(style.minHeight) : none,
            minWidth: style.minWidth ? some(style.minWidth) : none,
            maxHeight: style.maxHeight ? some(style.maxHeight) : none,
            maxWidth: style.maxWidth ? some(style.maxWidth) : none,
            overflow: overflowValue ? some(overflowValue) : none,
            overflowX: overflowXValue ? some(overflowXValue) : none,
            overflowY: overflowYValue ? some(overflowYValue) : none,
            fill: style.fill !== undefined ? some(style.fill) : none,
            scroll: style.scroll !== undefined ? some(style.scroll) : none,
            scrollX: style.scrollX !== undefined ? some(style.scrollX) : none,
            scrollY: style.scrollY !== undefined ? some(style.scrollY) : none,
            padding: paddingValue ? some(paddingValue) : none,
            margin: marginValue ? some(marginValue) : none,
            background: style.background ? some(style.background) : none,
            color: style.color ? some(style.color) : none,
            borderRadius: style.borderRadius ? some(style.borderRadius) : none,
            border: style.border ? some(style.border) : none,
            borderColor: style.borderColor ? some(style.borderColor) : none,
            borderWidth: style.borderWidth ? some(style.borderWidth) : none,
            flex: style.flex ? some(style.flex) : none,
            flexGrow: style.flexGrow ? some(style.flexGrow) : none,
            flexShrink: style.flexShrink ? some(style.flexShrink) : none,
            position: positionValue ? some(positionValue) : none,
            top: style.top ? some(style.top) : none,
            right: style.right ? some(style.right) : none,
            bottom: style.bottom ? some(style.bottom) : none,
            left: style.left ? some(style.left) : none,
            zIndex: zIndexValue ? some(zIndexValue) : none,
            boxShadow: boxShadowValue ? some(boxShadowValue) : none,
            transform: style.transform ? some(style.transform) : none,
            transition: transitionValue ? some(transitionValue) : none,
            cursor: cursorValue ? some(cursorValue) : none,
            opacity: style.opacity !== undefined ? some(style.opacity) : none,
            fontFamily: fontFamilyValue ? some(fontFamilyValue) : none,
            fontVariantNumeric: fontVariantNumericValue ? some(fontVariantNumericValue) : none,
            animation: animationValue ? some(animationValue) : none,
        }, FlexStyleType)) : none,
    }), UIComponentType);
}

/**
 * Flex container component for flexbox layouts.
 *
 * @remarks
 * Use `Flex.Root(children, style)` to create a flex container, or access `Flex.Types.Flex` for the East type.
 * Flex is a convenience component that renders with `display: flex` applied by default.
 */
export const Flex = {
    /**
     * Creates a Flex container component with children and optional styling.
     *
     * @param children - Array of child UI components
     * @param style - Optional styling configuration for the flex container
     * @returns An East expression representing the styled flex component
     *
     * @remarks
     * Flex is a convenience component that renders a Box with `display: flex` applied.
     * It provides easy access to flexbox layout properties.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Flex, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Flex.Root([
     *         Text.Root("Item 1"),
     *         Text.Root("Item 2"),
     *     ], {
     *         direction: "row",
     *         gap: "4",
     *         alignItems: "center",
     *     });
     * });
     * ```
     */
    Root: createFlex,
    /**
     * Creates padding configuration for layout components.
     *
     * @param top - Top padding (Chakra UI spacing token or CSS value)
     * @param right - Right padding (Chakra UI spacing token or CSS value)
     * @param bottom - Bottom padding (Chakra UI spacing token or CSS value)
     * @param left - Left padding (Chakra UI spacing token or CSS value)
     * @returns An East expression representing the padding configuration
     *
     * @remarks
     * Use this helper to create structured padding values for Flex components.
     * You can also pass a plain string to the padding style property for uniform padding.
     *
     * @example
     * ```ts
     * import { Flex, Padding } from "@elaraai/east-ui";
     *
     * // Structured padding
     * Flex.Root([...], {
     *   padding: Padding("4", "2", "4", "2"),
     * });
     *
     * // Uniform padding (shorthand)
     * Flex.Root([...], {
     *   padding: "4",
     * });
     * ```
     */
    Padding,
    /**
     * Creates margin configuration for layout components.
     *
     * @param top - Top margin (Chakra UI spacing token or CSS value)
     * @param right - Right margin (Chakra UI spacing token or CSS value)
     * @param bottom - Bottom margin (Chakra UI spacing token or CSS value)
     * @param left - Left margin (Chakra UI spacing token or CSS value)
     * @returns An East expression representing the margin configuration
     *
     * @remarks
     * Use this helper to create structured margin values for Flex components.
     * You can also pass a plain string to the margin style property for uniform margin.
     *
     * @example
     * ```ts
     * import { Flex, Margin } from "@elaraai/east-ui";
     *
     * // Structured margin
     * Flex.Root([...], {
     *   margin: Margin("4", "auto", "4", "auto"),
     * });
     *
     * // Uniform margin (shorthand)
     * Flex.Root([...], {
     *   margin: "4",
     * });
     * ```
     */
    Margin,
    Types: {
        /**
         * The concrete East type for Flex component data.
         *
         * @remarks
         * This struct type represents the serializable data structure for a Flex component.
         * Flex is a container component with `display: flex` applied by default.
         *
         * @property children - Array of child UI components
         * @property style - Optional styling configuration wrapped in OptionType
         */
        Flex: FlexType,
        /**
         * The concrete East type for Flex component style data.
         *
         * @remarks
         * All properties are optional and wrapped in {@link OptionType}.
         *
         * @property direction - Flex direction (row, column, row-reverse, column-reverse)
         * @property wrap - Flex wrap behavior (nowrap, wrap, wrap-reverse)
         * @property justifyContent - Justify content for main axis alignment
         * @property alignItems - Align items for cross axis alignment
         * @property gap - Gap between children
         * @property width - Width (Chakra UI size token or CSS value)
         * @property height - Height (Chakra UI size token or CSS value)
         * @property padding - Padding configuration
         * @property margin - Margin configuration
         * @property background - Background color (Chakra UI color token or CSS color)
         * @property color - Text color (Chakra UI color token or CSS color)
         * @property borderRadius - Border radius (Chakra UI radius token or CSS value)
         */
        Style: FlexStyleType,
        /**
         * The concrete East type for padding configuration.
         *
         * @remarks
         * This struct type defines padding for all four sides of a flex container.
         * Each side is optional and accepts Chakra UI spacing tokens or CSS values.
         *
         * @property top - Top padding (Chakra UI spacing token or CSS value)
         * @property right - Right padding (Chakra UI spacing token or CSS value)
         * @property bottom - Bottom padding (Chakra UI spacing token or CSS value)
         * @property left - Left padding (Chakra UI spacing token or CSS value)
         */
        Padding: PaddingType,
        /**
         * The concrete East type for margin configuration.
         *
         * @remarks
         * This struct type defines margin for all four sides of a flex container.
         * Each side is optional and accepts Chakra UI spacing tokens or CSS values.
         *
         * @property top - Top margin (Chakra UI spacing token or CSS value)
         * @property right - Right margin (Chakra UI spacing token or CSS value)
         * @property bottom - Bottom margin (Chakra UI spacing token or CSS value)
         * @property left - Left margin (Chakra UI spacing token or CSS value)
         */
        Margin: MarginType,
    },
} as const;
