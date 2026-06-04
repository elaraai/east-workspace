/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    CopyButtonType,
    CopyButtonStyleType,
    CopyButtonVariantType,
    type CopyButtonStyle,
    type CopyButtonOptions,
    type CopyButtonVariantLiteral,
} from "./types.js";

// Re-export types
export {
    CopyButtonType,
    CopyButtonStyleType,
    CopyButtonVariantType,
    type CopyButtonStyle,
    type CopyButtonOptions,
    type CopyButtonVariantLiteral,
} from "./types.js";

// ============================================================================
// CopyButton Factory
// ============================================================================

/**
 * Creates a CopyButton component that copies `value` to the clipboard.
 *
 * @param value - The text value to copy
 * @param options - Main-level fields plus optional `style` sub-struct
 * @returns An East expression representing the CopyButton component
 *
 * @remarks
 * When `label` is supplied the renderer emits a text-plus-icon button; when
 * absent it emits an icon-only affordance (aria-label "Copy to clipboard").
 * `timeout` controls how long the "Copied!" confirmation state persists
 * (milliseconds, stringified). The confirmation glyph can be tinted via
 * `style.successColor`.
 *
 * content + state + config are top-level
 * options; visual presentation lives inside `options.style`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { CopyButton, UIComponentType } from "@elaraai/east-ui";
 *
 * // Icon-only copy affordance
 * const copySecret = East.function([], UIComponentType, _$ =>
 *     CopyButton.Root("super-secret-api-key"),
 * );
 *
 * // With label + branded colour escape hatches + custom success tint
 * const copyLink = East.function([], UIComponentType, _$ =>
 *     CopyButton.Root("https://elara.ai/share/abc123", {
 *         label: "Copy link",
 *         timeout: "1500",
 *         style: {
 *             variant: "outline",
 *             colorPalette: "blue",
 *             successColor: "#2e7d32",
 *         },
 *     }),
 * );
 * ```
 */
function createCopyButton(
    value: SubtypeExprOrValue<StringType>,
    options?: CopyButtonOptions,
): ExprType<UIComponentType> {
    const opts: CopyButtonOptions = options ?? {};
    const { label, timeout, disabled, ...visual } = opts;
    const styleValue = Object.values(visual).some(field => field !== undefined)
        ? buildCopyButtonStyle(opts)
        : undefined;

    return East.value(variant("CopyButton", {
        value,
        label: label !== undefined ? some(label) : none,
        timeout: timeout !== undefined ? some(timeout) : none,
        disabled: disabled !== undefined ? some(disabled) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildCopyButtonStyle(style: CopyButtonStyle): ExprType<CopyButtonStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as CopyButtonVariantLiteral, null), CopyButtonVariantType)
            : style.variant)
        : undefined;

    const colorPaletteValue = style.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        hoverBackground: style.hoverBackground !== undefined ? some(style.hoverBackground) : none,
        successColor: style.successColor !== undefined ? some(style.successColor) : none,
    }, CopyButtonStyleType);
}

/**
 * CopyButton primitive — interactive copy-to-clipboard affordance.
 *
 * @remarks
 * Use `CopyButton.Root(value, options)` to create a copy button, or access
 * `CopyButton.Types.CopyButton` for the East type. content + state + config are top-level options; visual
 * presentation lives inside `options.style`.
 */
export const CopyButton = {
    /**
     * Creates a CopyButton component that copies `value` to the clipboard.
     *
     * @param value - The text to copy
     * @param options - Main-level fields plus optional `style` sub-struct
     * @returns An East expression representing the CopyButton component
     *
     * @remarks
     * When `label` is supplied the renderer emits a text-plus-icon button;
     * when absent it emits an icon-only affordance with aria-label
     * "Copy to clipboard". `timeout` controls the "Copied!" duration (ms,
     * stringified). Success-glyph tint via `style.successColor`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { CopyButton, UIComponentType } from "@elaraai/east-ui";
     *
     * // Icon-only copy
     * const copySecret = East.function([], UIComponentType, _$ =>
     *     CopyButton.Root("super-secret-api-key"),
     * );
     *
     * // Labelled + branded
     * const copyLink = East.function([], UIComponentType, _$ =>
     *     CopyButton.Root("https://elara.ai/share/abc123", {
     *         label: "Copy link",
     *         timeout: "1500",
     *         style: {
     *             variant: "outline",
     *             colorPalette: "blue",
     *             successColor: "#2e7d32",
     *         },
     *     }),
     * );
     * ```
     */
    Root: createCopyButton,
    Types: {
        /**
         * The concrete East type for CopyButton component data.
         *
         * @remarks
         * `value` + `label` are content; `timeout` is config; `disabled` is
         * state. Visual presentation is isolated inside `style`.
         *
         * @property value - Text to copy (required)
         * @property label - Optional label next to the copy icon
         * @property timeout - "Copied!" duration in ms (stringified)
         * @property disabled - Disabled state
         * @property style - Visual-presentation sub-struct
         */
        CopyButton: CopyButtonType,
        /**
         * Visual-only style struct for CopyButton. See {@link CopyButtonStyleType}.
         */
        Style: CopyButtonStyleType,
        /**
         * Variant enum for CopyButton visual presets.
         *
         * @property solid - Solid filled button
         * @property subtle - Subtle/light background button
         * @property outline - Outlined button with border
         * @property ghost - Transparent button, visible on hover
         */
        Variant: CopyButtonVariantType,
    },
} as const;
