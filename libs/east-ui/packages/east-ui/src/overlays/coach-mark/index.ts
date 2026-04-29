/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    BooleanType,
    NullType,
    OptionType,
    StructType,
    FunctionType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { PlacementType } from "../tooltip/types.js";
import {
    CoachMarkStyleType,
    type CoachMarkStyle,
} from "./types.js";

export {
    CoachMarkStyleType,
    type CoachMarkStyle,
} from "./types.js";

// ============================================================================
// CoachMarkType — standalone mirror of the inline `CoachMark` variant in
// component.ts. Renderers use this for `equalFor` memoisation; consumers
// reach it via `CoachMark.Types.CoachMark`.
// ============================================================================

/**
 * East StructType for `CoachMark` — mirror of the inline variant in
 * `component.ts`.
 *
 * @property target - Wrapped UIComponent the popover anchors to
 * @property title - Title text shown in the popover header
 * @property body - Body text shown in the popover body
 * @property showOnce - Optional `State.bind` key for permanent dismissal
 * @property dismissible - Whether the user can dismiss (default `true`)
 * @property onDismiss - Callback fired when dismissed
 * @property style - Optional visual style sub-struct
 */
export const CoachMarkType: StructType<{
    target: UIComponentType,
    title: StringType,
    body: StringType,
    showOnce: OptionType<StringType>,
    dismissible: OptionType<BooleanType>,
    onDismiss: OptionType<FunctionType<[], NullType>>,
    style: OptionType<CoachMarkStyleType>,
}> = StructType({
    target: UIComponentType,
    title: StringType,
    body: StringType,
    showOnce: OptionType(StringType),
    dismissible: OptionType(BooleanType),
    onDismiss: OptionType(FunctionType([], NullType)),
    style: OptionType(CoachMarkStyleType),
});

/** Type alias for `typeof CoachMarkType`. */
export type CoachMarkType = typeof CoachMarkType;

/**
 * Creates a `CoachMark` — single one-shot inline hint that wraps a
 * target child and anchors a popover to it.
 *
 * @param target - The UIComponent the hint points at (rendered as the wrapped child)
 * @param title - Title text shown in the popover header
 * @param body - Body text shown in the popover body
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the CoachMark
 *
 * @remarks
 * Auto-opens on mount unless `showOnce` is set and already dismissed.
 * On dismiss, the renderer persists the `showOnce` flag in
 * localStorage so the hint never re-appears across reloads.
 *
 * Same composition shape as Tooltip / Popover / HoverCard — the
 * target IS the wrapped child.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Button, CoachMark, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return CoachMark.Root(
 *         Button.Root("Bulk edit", { variant: "outline" }),
 *         "Bulk edit",
 *         "Right-click rows to edit them in bulk.",
 *         { showOnce: "coach.bulkEdit", placement: "right" },
 *     );
 * });
 * ```
 */
function createCoachMark(
    target: SubtypeExprOrValue<UIComponentType>,
    title: SubtypeExprOrValue<StringType>,
    body: SubtypeExprOrValue<StringType>,
    style?: CoachMarkStyle,
): ExprType<UIComponentType> {
    const placementValue = style?.placement
        ? (typeof style.placement === "string"
            ? East.value(variant(style.placement, null), PlacementType)
            : style.placement)
        : undefined;

    const hasStyle = !!style && (
        placementValue !== undefined ||
        style.background !== undefined ||
        style.borderColor !== undefined ||
        style.arrowColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        placement: placementValue ? some(placementValue) : none,
        background: style!.background !== undefined ? some(style!.background) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
        arrowColor: style!.arrowColor !== undefined ? some(style!.arrowColor) : none,
    }, CoachMarkStyleType) : undefined;

    return East.value(variant("CoachMark", {
        target,
        title,
        body,
        showOnce: style?.showOnce !== undefined ? some(style.showOnce) : none,
        dismissible: style?.dismissible !== undefined ? some(style.dismissible) : none,
        onDismiss: style?.onDismiss ? some(style.onDismiss) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface CoachMarkNamespace {
    Root: typeof createCoachMark;
    Types: {
        CoachMark: typeof CoachMarkType;
        Style: typeof CoachMarkStyleType;
    };
}

/**
 * `CoachMark` namespace — single one-shot inline hint primitive that
 * wraps a target child and anchors a popover to it.
 *
 * @remarks
 * Use `CoachMark.Root(target, title, body, options?)`. Same shape as
 * Tooltip / Popover / HoverCard.
 */
export const CoachMark: CoachMarkNamespace = {
    /**
     * Creates a `CoachMark`. See {@link createCoachMark}.
     */
    Root: createCoachMark,
    Types: {
        /**
         * East StructType for the `CoachMark` value.
         *
         * @property target - Wrapped UIComponent the popover anchors to
         * @property title - Title text shown in the popover header
         * @property body - Body text shown in the popover body
         * @property showOnce - Optional `State.bind` key for permanent dismissal
         * @property dismissible - Whether the user can dismiss (default `true`)
         * @property onDismiss - Callback fired when dismissed
         * @property style - Optional visual style sub-struct
         */
        CoachMark: CoachMarkType,
        /**
         * East StructType holding visual fields for `CoachMark`.
         *
         * @property placement - Anchor placement around the target
         * @property background - Explicit background colour
         * @property borderColor - Explicit border colour
         * @property arrowColor - Explicit arrow colour
         */
        Style: CoachMarkStyleType,
    },
};
