/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType, OptionType,
    StructType,
    ArrayType,
    variant,
    some,
    none,
    NullType
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    DrawerSizeType,
    DrawerPlacementType,
    DrawerStyleType,
    type DrawerStyle
} from "./types.js";

// Re-export types
export {
    DrawerSizeType,
    DrawerPlacementType,
    DrawerStyleType,
    type DrawerStyle,
} from "./types.js";
export type { DrawerSizeLiteral, DrawerPlacementLiteral } from "./types.js";

// ============================================================================
// Drawer Type
// ============================================================================

/**
 * East StructType for Drawer component.
 *
 * @remarks
 * Drawer is a panel that slides in from an edge of the screen.
 * The trigger can be any UI component, and body contains UI children.
 *
 * @property trigger - The UI component that opens the drawer
 * @property body - Array of UI components for drawer content
 * @property title - Optional drawer title
 * @property description - Optional drawer description
 * @property style - Optional style configuration
 */
export const DrawerType: StructType<{
    trigger: UIComponentType,
    body: ArrayType<UIComponentType>,
    title: OptionType<StringType>,
    description: OptionType<StringType>,
    style: OptionType<DrawerStyleType>,
}> = StructType({
    trigger: UIComponentType,
    body: ArrayType(UIComponentType),
    title: OptionType(StringType),
    description: OptionType(StringType),
    style: OptionType(DrawerStyleType),
});

/**
 * Type alias for DrawerType.
 */
export type DrawerType = typeof DrawerType;

// ============================================================================
// Drawer Open Input Type
// ============================================================================

/**
 * East StructType for programmatic drawer opening.
 *
 * @remarks
 * This type is used with {@link drawer_open} to programmatically open a drawer
 * without a trigger element. Unlike {@link DrawerType}, this does not include
 * a trigger property.
 *
 * @property body - Array of UI components for drawer content
 * @property title - Optional drawer title
 * @property description - Optional drawer description
 * @property style - Optional style configuration
 */
export const DrawerOpenInputType: StructType<{
    body: ArrayType<UIComponentType>,
    title: OptionType<StringType>,
    description: OptionType<StringType>,
    style: OptionType<DrawerStyleType>,
}> = StructType({
    body: ArrayType(UIComponentType),
    title: OptionType(StringType),
    description: OptionType(StringType),
    style: OptionType(DrawerStyleType),
});

/**
 * Type alias for DrawerOpenInputType.
 */
export type DrawerOpenInputType = typeof DrawerOpenInputType;

// ============================================================================
// Drawer Function
// ============================================================================

/**
 * Creates a Drawer component with a trigger and body content.
 *
 * @param body - Array of UI components for drawer content
 * @param options - Required `trigger` + optional `title` / `description` / visual style fields
 * @returns An East expression representing the drawer component
 *
 * @remarks
 * Drawer is a panel that slides in from the edge of the viewport.
 * It's typically used for navigation, settings, or detailed content.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Drawer, Button, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Drawer.Root([Text.Root("Menu content")], {
 *         trigger: Button.Root("Open Menu"),
 *         title: "Navigation",
 *         placement: "start",
 *     });
 * });
 * ```
 */
export interface DrawerOptions extends DrawerStyle {
    /** The UI component that opens the drawer — required. */
    trigger: SubtypeExprOrValue<UIComponentType>;
}

function createDrawer(
    body: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options: DrawerOptions,
): ExprType<UIComponentType> {
    const { trigger, ...style } = options;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), DrawerSizeType)
            : style.size)
        : undefined;

    const placementValue = style.placement
        ? (typeof style.placement === "string"
            ? East.value(variant(style.placement, null), DrawerPlacementType)
            : style.placement)
        : undefined;

    const hasStyle = sizeValue || placementValue || style.contained !== undefined ||
        style.onOpenChange !== undefined || style.onExitComplete !== undefined;

    return East.value(variant("Drawer", {
        trigger: trigger,
        body: body,
        title: style.title !== undefined ? some(style.title) : none,
        description: style.description !== undefined ? some(style.description) : none,
        style: hasStyle
            ? some(East.value({
                size: sizeValue ? some(sizeValue) : none,
                placement: placementValue ? some(placementValue) : none,
                contained: style.contained !== undefined ? some(style.contained) : none,
                onOpenChange: style.onOpenChange !== undefined ? some(style.onOpenChange) : none,
                onExitComplete: style.onExitComplete !== undefined ? some(style.onExitComplete) : none,
            }, DrawerStyleType))
            : none,
    }), UIComponentType);
}

// ============================================================================
// Drawer Open Platform Function
// ============================================================================

/**
 * Platform function to programmatically open a drawer.
 *
 * @remarks
 * Opens a drawer without requiring a trigger element. The drawer content,
 * title, description, and style are specified in the {@link DrawerOpenInputType} parameter.
 * Pass `Drawer.Implementation` to `ir.compile()` to enable this functionality.
 *
 * @param input - The drawer configuration including body content and style
 * @returns Null
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { Drawer, Text } from "@elaraai/east-ui";
 *
 * const openSettings = East.function([], NullType, $ => {
 *     $(Drawer.open(East.value({
 *         body: [Text.Root("Settings content")],
 *         title: variant("some", "Settings"),
 *         description: variant("none", null),
 *         style: variant("none", null),
 *     }, Drawer.Types.OpenInput)));
 * });
 * ```
 */
export const drawer_open = East.platform(
    "drawer_open", 
    [DrawerOpenInputType], 
    NullType,
    {
        optional: true
    }
);

/**
 * Drawer component for slide-in panels.
 *
 * @remarks
 * Use `Drawer.Root(body, { trigger, ... })` to create a drawer, or access `Drawer.Types` for East types.
 */
export const Drawer = {
    /**
     * Creates a Drawer component with a trigger and body content.
     *
     * @param body - Array of UI components for drawer content
     * @param options - Required `trigger` + optional `title` / `description` / visual style fields
     * @returns An East expression representing the drawer component
     *
     * @remarks
     * Drawer is a panel that slides in from the edge of the viewport.
     * It's typically used for navigation, settings, or detailed content.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Drawer, Button, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Drawer.Root([Text.Root("Drawer content")], {
     *         trigger: Button.Root("Open Drawer"),
     *         title: "Settings",
     *         placement: "end",
     *     });
     * });
     * ```
     */
    Root: createDrawer,
    /**
     * Platform function to programmatically open a drawer.
     *
     * @remarks
     * Opens a drawer without requiring a trigger element. Pass `Drawer.Implementation`
     * to `ir.compile()` to enable this functionality.
     *
     * @example
     * ```ts
     * import { East, NullType, variant } from "@elaraai/east";
     * import { Drawer, Text } from "@elaraai/east-ui";
     *
     * const openSettings = East.function([], NullType, $ => {
     *     $(Drawer.open(East.value({
     *         body: [Text.Root("Settings content")],
     *         title: variant("some", "Settings"),
     *         description: variant("none", null),
     *         style: variant("none", null),
     *     }, Drawer.Types.OpenInput)));
     * });
     * ```
     */
    open: drawer_open,
    Types: {
        /**
         * East StructType for Drawer component.
         *
         * @remarks
         * Drawer is a panel that slides in from an edge of the screen.
         * The trigger can be any UI component, and body contains UI children.
         *
         * @property trigger - The UI component that opens the drawer
         * @property body - Array of UI components for drawer content
         * @property title - Optional drawer title
         * @property description - Optional drawer description
         * @property style - Optional style configuration
         */
        Drawer: DrawerType,
        /**
         * Style type for Drawer component.
         *
         * @property size - Drawer size variant
         * @property placement - Edge placement
         * @property contained - Render within parent container
         */
        Style: DrawerStyleType,
        /**
         * Size variant type for Drawer component.
         *
         * @property xs - Extra small (20rem max width)
         * @property sm - Small (28rem max width)
         * @property md - Medium (32rem max width)
         * @property lg - Large (42rem max width)
         * @property xl - Extra large (56rem max width)
         * @property full - Full viewport
         */
        Size: DrawerSizeType,
        /**
         * Placement variant type for Drawer component.
         *
         * @property start - Left side (RTL-aware)
         * @property end - Right side (RTL-aware)
         * @property top - Top edge
         * @property bottom - Bottom edge
         */
        Placement: DrawerPlacementType,
        /**
         * East StructType for programmatic drawer opening.
         *
         * @remarks
         * Use this type with {@link Drawer.open} to programmatically open a drawer
         * without a trigger element.
         *
         * @property body - Array of UI components for drawer content
         * @property title - Optional drawer title
         * @property description - Optional drawer description
         * @property style - Optional style configuration
         */
        OpenInput: DrawerOpenInputType,
    },
} as const;
