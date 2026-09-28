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
import { UIComponentType } from "../../component.js";
import { StackStyleType, type StackStyle } from "./types.js";
import { Padding, PaddingType, Margin, MarginType } from "../style.js";

// Re-export style types
export { StackStyleType, type StackStyle } from "./types.js";

/**
 * The concrete East type for Stack component data.
 *
 * @remarks
 * This struct type represents the serializable data structure for a Stack component.
 * Stack is a container component that arranges children in a single direction.
 *
 * @property children - Array of child UI components
 * @property density - Optional density the stack provides to its children via the density cascade
 * @property style - Optional styling configuration wrapped in OptionType
 */
export const StackType: StructType<{
    children: ArrayType<UIComponentType>,
    density: OptionType<DensityType>,
    style: OptionType<StackStyleType>,
}> = StructType({
    children: ArrayType(UIComponentType),
    density: OptionType(DensityType),
    style: OptionType(StackStyleType),
});

/**
 * Type representing the Stack component structure.
 */
export type StackType = typeof StackType;

/**
 * Creates a Stack container component with children and optional styling.
 *
 * @param children - Array of child UI components
 * @param style - Optional styling configuration for the stack
 * @returns An East expression representing the styled stack component
 *
 * @remarks
 * Stack arranges children in a single direction (row or column) with consistent
 * spacing. Use HStack for horizontal layout and VStack for vertical layout.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Stack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Stack.Root([
 *         Text.Root("Item 1"),
 *         Text.Root("Item 2"),
 *     ], {
 *         gap: "4",
 *         direction: "column",
 *     });
 * });
 * ```
 */
function createStack(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    style?: StackStyle
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

    const alignValue = style?.align
        ? (typeof style.align === "string"
            ? East.value(variant(style.align, null), AlignItemsType)
            : style.align)
        : undefined;

    const justifyValue = style?.justify
        ? (typeof style.justify === "string"
            ? East.value(variant(style.justify, null), JustifyContentType)
            : style.justify)
        : undefined;

    const wrapValue = style?.wrap
        ? (typeof style.wrap === "string"
            ? East.value(variant(style.wrap, null), FlexWrapType)
            : style.wrap)
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

    return East.value(variant("Stack", {
        children: children,
        density: densityValue ? some(densityValue) : none,
        style: style ? some(East.value({
            direction: directionValue ? some(directionValue) : none,
            gap: style.gap ? some(style.gap) : none,
            align: alignValue ? some(alignValue) : none,
            justify: justifyValue ? some(justifyValue) : none,
            wrap: wrapValue ? some(wrapValue) : none,
            padding: paddingValue ? some(paddingValue) : none,
            margin: marginValue ? some(marginValue) : none,
            background: style.background ? some(style.background) : none,
            borderRadius: style.borderRadius ? some(style.borderRadius) : none,
            border: style.border ? some(style.border) : none,
            borderColor: style.borderColor ? some(style.borderColor) : none,
            borderWidth: style.borderWidth ? some(style.borderWidth) : none,
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
        }, StackStyleType)) : none,
    }), UIComponentType);
}

/**
 * Creates a horizontal Stack (row direction).
 *
 * @param children - Array of child UI components
 * @param style - Optional styling configuration (direction is overridden to row)
 * @returns An East expression representing the horizontal stack component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Stack, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Stack.HStack([
 *         Button.Root("Cancel"),
 *         Button.Root("Submit", { colorPalette: "blue" }),
 *     ], {
 *         gap: "2",
 *     });
 * });
 * ```
 */
function createHStack(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    style?: Omit<StackStyle, "direction">
): ExprType<UIComponentType> {
    return createStack(children, {
        ...style,
        direction: East.value(variant("row", null), FlexDirectionType),
    });
}

/**
 * Creates a vertical Stack (column direction).
 *
 * @param children - Array of child UI components
 * @param style - Optional styling configuration (direction is overridden to column)
 * @returns An East expression representing the vertical stack component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Stack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Stack.VStack([
 *         Text.Root("Title"),
 *         Text.Root("Subtitle"),
 *     ], {
 *         gap: "1",
 *         align: "flex-start",
 *     });
 * });
 * ```
 */
function createVStack(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    style?: Omit<StackStyle, "direction">
): ExprType<UIComponentType> {
    return createStack(children, {
        ...style,
        direction: East.value(variant("column", null), FlexDirectionType),
    });
}

/**
 * Stack container component for flex-based layouts.
 *
 * @remarks
 * Use `Stack.Root(children, style)` for general stack, `Stack.HStack()` for horizontal, `Stack.VStack()` for vertical.
 */
export const Stack = {
    /**
     * Creates a Stack container with flex layout.
     *
     * @param children - Array of child UI components
     * @param style - Optional styling configuration
     * @returns An East expression representing the stack component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Stack, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Stack.Root([
     *         Text.Root("Item 1"),
     *         Text.Root("Item 2"),
     *     ], {
     *         gap: "4",
     *         direction: "column",
     *     });
     * });
     * ```
     */
    Root: createStack,
    /**
     * Creates a horizontal Stack (row direction).
     *
     * @param children - Array of child UI components
     * @param style - Optional styling configuration
     * @returns An East expression representing the horizontal stack
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Stack, Button, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Stack.HStack([
     *         Button.Root("Cancel"),
     *         Button.Root("Submit", { colorPalette: "blue" }),
     *     ], {
     *         gap: "2",
     *     });
     * });
     * ```
     */
    HStack: createHStack,
    /**
     * Creates a vertical Stack (column direction).
     *
     * @param children - Array of child UI components
     * @param style - Optional styling configuration
     * @returns An East expression representing the vertical stack
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Stack, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Stack.VStack([
     *         Text.Root("Title"),
     *         Text.Root("Subtitle"),
     *     ], {
     *         gap: "1",
     *         align: "flex-start",
     *     });
     * });
     * ```
     */
    VStack: createVStack,
    /**
     * Creates padding configuration for layout components.
     *
     * @param top - Top padding (Chakra UI spacing token or CSS value)
     * @param right - Right padding
     * @param bottom - Bottom padding
     * @param left - Left padding
     * @returns An East expression representing the padding configuration
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Stack, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Stack.Root([
     *         Text.Root("Content"),
     *     ], {
     *         padding: Stack.Padding("4", "2", "4", "2"),
     *     });
     * });
     * ```
     */
    Padding,
    /**
     * Creates margin configuration for layout components.
     *
     * @param top - Top margin (Chakra UI spacing token or CSS value)
     * @param right - Right margin
     * @param bottom - Bottom margin
     * @param left - Left margin
     * @returns An East expression representing the margin configuration
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Stack, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Stack.Root([
     *         Text.Root("Content"),
     *     ], {
     *         margin: Stack.Margin("4", "auto", "4", "auto"),
     *     });
     * });
     * ```
     */
    Margin,
    Types: {
        /**
         * The concrete East type for Stack component data.
         *
         * @remarks
         * This struct type represents the serializable data structure for a Stack component.
         * Stack arranges children in a flex container with configurable direction and spacing.
         *
         * @property children - Array of child UI components
         * @property style - Optional styling configuration wrapped in OptionType
         */
        Stack: StackType,
        /**
         * Style type for Stack component configuration.
         *
         * @remarks
         * This struct type defines the styling configuration for a Stack component.
         *
         * @property direction - Flex direction (row, column, row-reverse, column-reverse)
         * @property gap - Spacing between children (Chakra UI spacing token)
         * @property align - Cross-axis alignment (flex-start, center, flex-end, stretch)
         * @property justify - Main-axis alignment (flex-start, center, flex-end, space-between)
         * @property wrap - Whether items should wrap (nowrap, wrap, wrap-reverse)
         */
        Style: StackStyleType,
        /**
         * Type for padding configuration.
         *
         * @remarks
         * Allows specifying individual padding values for each side.
         *
         * @property top - Top padding value
         * @property right - Right padding value
         * @property bottom - Bottom padding value
         * @property left - Left padding value
         */
        Padding: PaddingType,
        /**
         * Type for margin configuration.
         *
         * @remarks
         * Allows specifying individual margin values for each side.
         *
         * @property top - Top margin value
         * @property right - Right margin value
         * @property bottom - Bottom margin value
         * @property left - Left margin value
         */
        Margin: MarginType,
    },
} as const;
