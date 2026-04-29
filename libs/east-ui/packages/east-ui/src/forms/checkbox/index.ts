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
import { CheckboxType, CheckboxStyleType, type CheckboxStyle } from "./types.js";

// Re-export types
export { CheckboxType, CheckboxStyleType, type CheckboxStyle } from "./types.js";

// ============================================================================
// Checkbox Factory
// ============================================================================

/**
 * Builds the inner `CheckboxType` struct value (without the
 * UIComponent variant wrapper). Shared between the public `Root`
 * factory and the Field-control wrapper which embeds the struct
 * directly into `ControlRootType`'s `Checkbox` variant.
 *
 * @internal
 */
export function createCheckbox_(
    checked: SubtypeExprOrValue<BooleanType>,
    style?: CheckboxStyle,
): ExprType<CheckboxType> {
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
        style.fillColor !== undefined ||
        style.checkColor !== undefined ||
        style.borderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        fillColor: style!.fillColor !== undefined ? some(style!.fillColor) : none,
        checkColor: style!.checkColor !== undefined ? some(style!.checkColor) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
    }, CheckboxStyleType) : undefined;

    return East.value({
        checked,
        label: style?.label !== undefined ? some(style.label) : none,
        indeterminate: style?.indeterminate !== undefined ? some(style.indeterminate) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }, CheckboxType);
}

/**
 * Creates a Checkbox component with checked state and optional styling.
 *
 * @param checked - Whether the checkbox is checked
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the checkbox component
 *
 * @remarks
 * The factory accepts a flat options bag for ergonomics; visual props
 * (`colorPalette` / `size` / colour overrides) are routed into the
 * IR's `style` sub-struct.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Checkbox, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Checkbox.Root(true, {
 *         label: "Enable notifications",
 *         colorPalette: "blue",
 *         size: "md",
 *     });
 * });
 * ```
 */
function createCheckbox(
    checked: SubtypeExprOrValue<BooleanType>,
    style?: CheckboxStyle,
): ExprType<UIComponentType> {
    return East.value(variant("Checkbox", createCheckbox_(checked, style)), UIComponentType);
}

interface CheckboxNamespace {
    Root: typeof createCheckbox;
    Types: {
        Checkbox: typeof CheckboxType;
        Style: typeof CheckboxStyleType;
    };
}

/**
 * `Checkbox` namespace — boolean form control with optional label.
 *
 * @remarks
 * Use `Checkbox.Root(checked, options?)` to construct. Access IR types
 * via `Checkbox.Types.Checkbox` and `Checkbox.Types.Style`.
 */
export const Checkbox: CheckboxNamespace = {
    /**
     * Creates a Checkbox component with checked state and optional
     * styling. See {@link createCheckbox} for the factory signature.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Checkbox, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Checkbox.Root(true, {
     *         label: "Enable notifications",
     *         colorPalette: "blue",
     *         size: "md",
     *     });
     * });
     * ```
     */
    Root: createCheckbox,
    Types: {
        /**
         * East StructType for the `Checkbox` value.
         *
         * @property checked - Whether the checkbox is checked
         * @property label - Optional label text displayed next to the checkbox
         * @property indeterminate - Whether to show indeterminate state
         * @property disabled - Whether the checkbox is disabled
         * @property onChange - Callback fired with the new checked value
         * @property style - Optional visual style sub-struct
         */
        Checkbox: CheckboxType,
        /**
         * East StructType holding visual fields for `Checkbox`.
         *
         * @property colorPalette - Chakra colour palette for the checked-state fill
         * @property size - Checkbox size (`xs` / `sm` / `md` / `lg`)
         * @property fillColor - Explicit fill colour for the checked-state box
         * @property checkColor - Explicit colour of the tick glyph
         * @property borderColor - Explicit border colour for the unchecked box
         */
        Style: CheckboxStyleType,
    },
};
