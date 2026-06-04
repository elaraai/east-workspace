/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    PlacementType,
    Placement,
    TooltipStyleType,
    type TooltipStyle,
} from "./types.js";

// Re-export types
export {
    PlacementType,
    Placement,
    TooltipStyleType,
    type TooltipStyle,
    type PlacementLiteral,
} from "./types.js";

// ============================================================================
// Tooltip Type
// ============================================================================

/**
 * East StructType for Tooltip component.
 *
 * @remarks
 * Tooltip wraps a trigger element and displays content on hover.
 * The trigger can be any UI component. Visual fields (placement,
 * hasArrow) live in `style`.
 *
 * @property trigger - The UI component that triggers the tooltip on hover
 * @property content - The tooltip text content
 * @property style - Optional visual-only style sub-struct
 */
export const TooltipType: StructType<{
    trigger: UIComponentType,
    content: StringType,
    style: OptionType<TooltipStyleType>,
}> = StructType({
    trigger: UIComponentType,
    content: StringType,
    style: OptionType(TooltipStyleType),
});

/**
 * Type alias for TooltipType.
 */
export type TooltipType = typeof TooltipType;

// ============================================================================
// Tooltip Function
// ============================================================================

/**
 * TypeScript options bag for `Tooltip.Root`.
 *
 * @property trigger - The UI component that triggers the tooltip on hover
 * @property placement - Where the tooltip appears relative to the trigger
 * @property hasArrow - Show an arrow pointing to the trigger
 */
export interface TooltipOptions extends TooltipStyle {
    /** The UI component that triggers the tooltip on hover — required. */
    trigger: SubtypeExprOrValue<UIComponentType>;
}

/**
 * Creates a Tooltip component with a trigger element and content.
 *
 * @param content - The tooltip text content
 * @param options - Required `trigger` + optional visual style fields
 * @returns An East expression representing the tooltip component
 *
 * @remarks
 * Tooltip displays additional information when hovering over an element.
 * The trigger can be any UI component (button, text, icon, etc.).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Tooltip, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Tooltip.Root("This is a helpful tip", { trigger: Button.Root("Hover me") });
 * });
 * ```
 */
function createTooltip(
    content: SubtypeExprOrValue<StringType>,
    options: TooltipOptions,
): ExprType<UIComponentType> {
    const { trigger, ...visual } = options;

    const placementValue = visual.placement
        ? (typeof visual.placement === "string"
            ? East.value(variant(visual.placement, null), PlacementType)
            : visual.placement)
        : undefined;

    const hasVisualStyle = placementValue !== undefined || visual.hasArrow !== undefined;

    const styleValue = hasVisualStyle
        ? East.value({
            placement: placementValue ? some(placementValue) : none,
            hasArrow: visual.hasArrow !== undefined ? some(visual.hasArrow) : none,
        }, TooltipStyleType)
        : undefined;

    return East.value(variant("Tooltip", {
        trigger: trigger,
        content: content,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Tooltip component for displaying additional information on hover.
 *
 * @remarks
 * Use `Tooltip.Root(content, { trigger, ... })` to create a tooltip, or access `Tooltip.Types` for East types.
 */
export const Tooltip = {
    /**
     * Creates a Tooltip component with a trigger and content text.
     *
     * @param content - The tooltip text content
     * @param options - Required `trigger` + optional visual style fields
     * @returns An East expression representing the tooltip component
     *
     * @remarks
     * Tooltip displays additional information when hovering over an element.
     * The trigger can be any UI component (button, text, icon, etc.).
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Tooltip, Button, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Tooltip.Root("This is a helpful tooltip", {
     *         trigger: Button.Root("Hover me"),
     *         placement: "top",
     *     });
     * });
     * ```
     */
    Root: createTooltip,
    /**
     * Helper function to create tooltip placement values.
     *
     * @param v - The placement string
     * @returns An East expression representing the placement variant
     *
     * @remarks
     * Use this helper to create placement values programmatically. In most cases,
     * you can pass string literals directly to the style property.
     */
    Placement: Placement,
    Types: {
        /**
         * The concrete East type for Tooltip component data.
         *
         * @remarks
         * This struct type represents the serializable data structure for a Tooltip
         * component. Tooltip displays text content when hovering over a trigger element.
         * Visual fields (placement, hasArrow) live in `style`.
         *
         * @property trigger - The UI component that triggers the tooltip on hover (UIComponentType)
         * @property content - The tooltip text content (StringType)
         * @property style - Optional visual-only style sub-struct (see `Style`)
         */
        Tooltip: TooltipType,
        /**
         * The concrete East type for Tooltip style configuration.
         *
         * @remarks
         * This struct type defines the styling configuration for a Tooltip component.
         * Contains optional placement and arrow settings.
         *
         * @property placement - Where the tooltip appears relative to trigger (OptionType<PlacementType>)
         * @property hasArrow - Show arrow pointing to trigger (OptionType<BooleanType>)
         */
        Style: TooltipStyleType,
        /**
         * Placement variant type for Tooltip positioning.
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
