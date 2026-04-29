/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    BooleanType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { SwitchType, SwitchStyleType, type SwitchStyle } from "./types.js";

// Re-export types
export { SwitchType, SwitchStyleType, type SwitchStyle } from "./types.js";

// ============================================================================
// Switch Factory
// ============================================================================

/**
 * Builds the inner `SwitchType` struct value (without the
 * UIComponent variant wrapper). Shared between the public `Root`
 * factory and the Field-control wrapper.
 *
 * @internal
 */
export function createSwitch_(
    checked: SubtypeExprOrValue<BooleanType>,
    style?: SwitchStyle,
): ExprType<SwitchType> {
    const colorPaletteValue = style?.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const hasStyle = !!style && (
        colorPaletteValue !== undefined ||
        sizeValue !== undefined ||
        style.onColor !== undefined ||
        style.offColor !== undefined ||
        style.thumbColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        onColor: style!.onColor !== undefined ? some(style!.onColor) : none,
        offColor: style!.offColor !== undefined ? some(style!.offColor) : none,
        thumbColor: style!.thumbColor !== undefined ? some(style!.thumbColor) : none,
    }, SwitchStyleType) : undefined;

    return East.value({
        checked,
        label: style?.label !== undefined ? some(style.label) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }, SwitchType);
}

/**
 * Creates a Switch component with checked state and optional styling.
 *
 * @param checked - Whether the switch is on
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the switch component
 *
 * @remarks
 * The factory accepts a flat options bag for ergonomics; visual props
 * (`colorPalette` / `size` / colour overrides) are routed into the
 * IR's `style` sub-struct.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Switch, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Switch.Root(true, {
 *         label: "Dark mode",
 *         colorPalette: "blue",
 *         size: "md",
 *     });
 * });
 * ```
 */
function createSwitch(
    checked: SubtypeExprOrValue<BooleanType>,
    style?: SwitchStyle,
): ExprType<UIComponentType> {
    return East.value(variant("Switch", createSwitch_(checked, style)), UIComponentType);
}

interface SwitchNamespace {
    Root: typeof createSwitch;
    Types: {
        Switch: typeof SwitchType;
        Style: typeof SwitchStyleType;
    };
}

/**
 * `Switch` namespace — boolean toggle control with optional label.
 *
 * @remarks
 * Use `Switch.Root(checked, options?)` to construct. Access IR types
 * via `Switch.Types.Switch` and `Switch.Types.Style`.
 */
export const Switch: SwitchNamespace = {
    /**
     * Creates a Switch component with checked state and optional
     * styling. See {@link createSwitch} for the factory signature.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Switch, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Switch.Root(true, {
     *         label: "Dark mode",
     *         colorPalette: "blue",
     *     });
     * });
     * ```
     */
    Root: createSwitch,
    Types: {
        /**
         * East StructType for the `Switch` value.
         *
         * @property checked - Whether the switch is on
         * @property label - Optional label text displayed next to the switch
         * @property disabled - Whether the switch is disabled
         * @property onChange - Callback fired with the new checked value
         * @property style - Optional visual style sub-struct
         */
        Switch: SwitchType,
        /**
         * East StructType holding visual fields for `Switch`.
         *
         * @property colorPalette - Chakra colour palette for the on-state track
         * @property size - Switch size (`xs` / `sm` / `md` / `lg`)
         * @property onColor - Explicit track colour when on
         * @property offColor - Explicit track colour when off
         * @property thumbColor - Explicit colour of the thumb knob
         */
        Style: SwitchStyleType,
    },
};

