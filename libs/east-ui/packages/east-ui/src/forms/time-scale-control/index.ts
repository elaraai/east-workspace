/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { ColorSchemeType, SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    TimeScaleControlType,
    TimeScaleControlStyleType,
    TimeScaleControlVariantType,
    TimeScaleType,
    type TimeScaleControlStyle,
    type TimeScaleLiteral,
} from "./types.js";

export {
    TimeScaleControlType,
    TimeScaleControlStyleType,
    TimeScaleControlVariantType,
    TimeScaleType,
    type TimeScaleControlStyle,
    type TimeScaleLiteral,
    type TimeScaleControlVariantLiteral,
} from "./types.js";

/**
 * Creates a `TimeScaleControl` component — segment control to pick a
 * timeline resolution (minute / hour / day / week / month / quarter /
 * year).
 *
 * @param value - Currently selected scale (literal or East variant value)
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the TimeScaleControl
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { TimeScaleControl, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         const scaleBind = $.let(State.bind([TimeScaleControl.Types.Scale], "scale", "day"));
 *         const scale = $.let(scaleBind.read(), TimeScaleControl.Types.Scale);
 *         const onChange = $.const(East.function([TimeScaleControl.Types.Scale], NullType, ($, next) => {
 *             $(scaleBind.write(next));
 *         }));
 *         return TimeScaleControl.Root(scale, {
 *             availableScales: ["day", "week", "month"],
 *             onChange,
 *         });
 *     }));
 * });
 * ```
 */
function createTimeScaleControl(
    value: SubtypeExprOrValue<TimeScaleType> | TimeScaleLiteral,
    style?: TimeScaleControlStyle,
): ExprType<UIComponentType> {
    const valueExpr = typeof value === "string"
        ? East.value(variant(value, null), TimeScaleType)
        : value;

    const availableScalesExpr = style?.availableScales
        ? East.value(
            style.availableScales.map(s => East.value(variant(s, null), TimeScaleType)),
            // East.value over an array of TimeScaleType variants
        )
        : undefined;

    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), TimeScaleControlVariantType)
            : style.variant)
        : undefined;
    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;
    const colorPaletteValue = style?.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const hasStyle = !!style && (
        variantValue !== undefined ||
        sizeValue !== undefined ||
        colorPaletteValue !== undefined ||
        style.color !== undefined ||
        style.activeColor !== undefined ||
        style.activeBackground !== undefined
    );

    const styleValue = hasStyle ? East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        color: style!.color !== undefined ? some(style!.color) : none,
        activeColor: style!.activeColor !== undefined ? some(style!.activeColor) : none,
        activeBackground: style!.activeBackground !== undefined ? some(style!.activeBackground) : none,
    }, TimeScaleControlStyleType) : undefined;

    return East.value(variant("TimeScaleControl", {
        value: valueExpr,
        availableScales: availableScalesExpr ? some(availableScalesExpr) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface TimeScaleControlNamespace {
    Root: typeof createTimeScaleControl;
    Types: {
        Root: typeof TimeScaleControlType;
        Style: typeof TimeScaleControlStyleType;
        Variant: typeof TimeScaleControlVariantType;
        Scale: typeof TimeScaleType;
    };
}

/**
 * `TimeScaleControl` namespace — segment control for selecting a time
 * scale (`minute` / `hour` / `day` / `week` / `month` / `quarter` /
 * `year`). Used by Gantt / Planner / ForecastView.
 */
export const TimeScaleControl: TimeScaleControlNamespace = {
    Root: createTimeScaleControl,
    Types: {
        /**
         * East StructType for the `TimeScaleControl` value.
         *
         * @property value - Current scale ({@link TimeScaleType})
         * @property availableScales - Optional subset of scales to display
         * @property disabled - Optional disabled flag
         * @property onChange - Callback fired with the newly-selected scale
         * @property style - Optional visual style sub-struct
         */
        Root: TimeScaleControlType,
        /**
         * East StructType for visual style on `TimeScaleControl`.
         *
         * @property variant - Segment variant (`solid` / `outline` / `subtle`)
         * @property size - Control size
         * @property colorPalette - Chakra palette for the active segment
         * @property color - Inactive-segment text colour
         * @property activeColor - Active-segment text colour
         * @property activeBackground - Active-segment background
         */
        Style: TimeScaleControlStyleType,
        /**
         * Visual variant for `TimeScaleControl` segments.
         *
         * @property solid - Filled segments
         * @property outline - Outlined segments
         * @property subtle - Low-emphasis segments
         */
        Variant: TimeScaleControlVariantType,
        /**
         * The {@link TimeScaleType} variant — `minute` / `hour` /
         * `day` / `week` / `month` / `quarter` / `year`.
         *
         * @property minute - Minute resolution
         * @property hour - Hour resolution
         * @property day - Day resolution
         * @property week - Week resolution
         * @property month - Month resolution
         * @property quarter - Quarter resolution
         * @property year - Year resolution
         */
        Scale: TimeScaleType,
    },
};
