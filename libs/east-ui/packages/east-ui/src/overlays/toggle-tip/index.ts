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
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    ToggleTipStyleType,
    type ToggleTipStyle,
    PlacementType
} from "./types.js";

// Re-export types
export {
    ToggleTipStyleType,
    type ToggleTipStyle,
    PlacementType,
} from "./types.js";
export type { PlacementLiteral } from "./types.js";

// ============================================================================
// ToggleTip Type
// ============================================================================

/**
 * East StructType for ToggleTip component.
 *
 * @remarks
 * ToggleTip is a click-activated tooltip for accessibility.
 * Unlike Tooltip (hover), ToggleTip is toggled by clicking.
 *
 * @property trigger - The UI component that toggles the tip
 * @property content - The text content of the tip
 * @property style - Optional style configuration
 */
export const ToggleTipType: StructType<{
    trigger: UIComponentType,
    content: StringType,
    style: OptionType<ToggleTipStyleType>,
}> = StructType({
    trigger: UIComponentType,
    content: StringType,
    style: OptionType(ToggleTipStyleType),
});

/**
 * Type alias for ToggleTipType.
 */
export type ToggleTipType = typeof ToggleTipType;

// ============================================================================
// ToggleTip Function
// ============================================================================

/**
 * Creates a ToggleTip component with a trigger and content.
 *
 * @param content - The text content of the tip
 * @param options - Required `trigger` + optional visual style fields
 * @returns An East expression representing the toggle tip component
 *
 * @remarks
 * ToggleTip provides an accessible alternative to hover-based tooltips.
 * It's activated by clicking, making it accessible to keyboard and touch users.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { ToggleTip, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return ToggleTip.Root("Click to learn more about this feature", {
 *         trigger: Button.Root("?", { variant: "ghost", size: "sm" }),
 *     });
 * });
 * ```
 */
export interface ToggleTipOptions extends ToggleTipStyle {
    /** The UI component that toggles the tip — required. */
    trigger: SubtypeExprOrValue<UIComponentType>;
}

function createToggleTip(
    content: SubtypeExprOrValue<StringType>,
    options: ToggleTipOptions,
): ExprType<UIComponentType> {
    const { trigger, ...visual } = options;

    const placementValue = visual.placement
        ? (typeof visual.placement === "string"
            ? East.value(variant(visual.placement, null), PlacementType)
            : visual.placement)
        : undefined;

    const hasStyle = placementValue || visual.hasArrow !== undefined || visual.onOpenChange !== undefined;

    return East.value(variant("ToggleTip", {
        trigger: trigger,
        content: content,
        style: hasStyle
            ? some(East.value({
                placement: placementValue ? some(placementValue) : none,
                hasArrow: visual.hasArrow !== undefined ? some(visual.hasArrow) : none,
                onOpenChange: visual.onOpenChange !== undefined ? some(visual.onOpenChange) : none,
            }, ToggleTipStyleType))
            : none,
    }), UIComponentType);
}

/**
 * ToggleTip component for click-activated tips.
 *
 * @remarks
 * Use `ToggleTip.Root(content, { trigger, ... })` to create a toggle tip, or access `ToggleTip.Types` for East types.
 */
export const ToggleTip = {
    /**
     * Creates a ToggleTip component with a trigger and content.
     *
     * @param content - The text content of the tip
     * @param options - Required `trigger` + optional visual style fields
     * @returns An East expression representing the toggle tip component
     *
     * @remarks
     * ToggleTip provides an accessible alternative to hover-based tooltips.
     * It's activated by clicking, making it accessible to keyboard and touch users.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { ToggleTip, IconButton, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return ToggleTip.Root("Click for more information about this feature", {
     *         trigger: IconButton.Root({ prefix: "fas", name: "circle-info", label: "Info" }),
     *     });
     * });
     * ```
     */
    Root: createToggleTip,
    Types: {
        /**
         * The concrete East type for ToggleTip component data.
         *
         * @remarks
         * This struct type represents the serializable data structure for a ToggleTip
         * component. ToggleTip is a click-activated tooltip for better accessibility,
         * unlike hover-based Tooltip.
         *
         * @property trigger - The UI component that toggles the tip (UIComponentType)
         * @property content - The text content of the tip (StringType)
         * @property style - Optional style configuration (OptionType<ToggleTipStyleType>)
         */
        ToggleTip: ToggleTipType,
        /**
         * The concrete East type for ToggleTip style configuration.
         *
         * @remarks
         * This struct type defines the styling configuration for a ToggleTip component.
         * Controls the placement and arrow visibility.
         *
         * @property placement - Position relative to trigger (OptionType<PlacementType>)
         * @property hasArrow - Show arrow pointing to trigger (OptionType<BooleanType>)
         */
        Style: ToggleTipStyleType,
        /**
         * Placement variant type for ToggleTip positioning.
         *
         * @remarks
         * Controls where the toggle tip appears relative to its trigger element.
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
