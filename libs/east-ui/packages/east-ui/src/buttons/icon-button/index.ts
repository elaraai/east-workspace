/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";


import { UIComponentType } from "../../component.js";
import { SizeType, ColorSchemeType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import type { IconPayload } from "../button/types.js";
import {
    IconButtonStyleType,
    IconButtonType,
    IconButtonAttentionType,
    ButtonVariantType,
    type IconButtonStyle,
    type IconButtonOptions,
    type ButtonVariantLiteral,
} from "./types.js";

// Re-export types
export {
    IconButtonStyleType,
    IconButtonType,
    IconButtonAttentionType,
    type IconButtonStyle,
    type IconButtonOptions,
    type IconButtonAttentionLiteral,
} from "./types.js";

// ============================================================================
// IconButton Factory
// ============================================================================

/**
 * Creates an IconButton component.
 *
 * @param options - A single flat options bag. `prefix` / `name` (icon identity)
 *   and `label` (a11y) are required; state / behaviour / visual fields sit flat.
 * @returns An East expression representing the IconButton component
 *
 * @remarks
 * IconButton renders an icon-only button — useful for toolbar actions, close
 * buttons, and other icon-only interactive elements. `label` is REQUIRED so
 * screen readers always have an accessible name; omitting it is a compile error.
 * Every option sits flat on the bag; the factory composes the visual fields into
 * the nested IR `style` struct internally.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { IconButton, UIComponentType } from "@elaraai/east-ui";
 *
 * // Simple close affordance
 * const close = East.function([], UIComponentType, _$ =>
 *     IconButton.Root({ prefix: "fas", name: "xmark", label: "Close", variant: "ghost" }),
 * );
 *
 * // Loading IconButton with a custom spinner
 * const refresh = East.function([], UIComponentType, _$ =>
 *     IconButton.Root({
 *         prefix: "fas", name: "rotate", label: "Refresh",
 *         loading: true,
 *         loadingIcon: { prefix: "fas", name: "spinner" },
 *         variant: "subtle", colorPalette: "blue",
 *     }),
 * );
 * ```
 */
function createIconButton(
    options: IconButtonOptions,
): ExprType<UIComponentType> {
    const { prefix, name, label, loadingIcon, loading, disabled, onClick, badge, badgeColorPalette, attention, ...visual } = options;
    const styleValue = Object.values(visual).some(field => field !== undefined)
        ? buildIconButtonStyle(visual)
        : undefined;

    const badgeColorPaletteValue = badgeColorPalette !== undefined
        ? (typeof badgeColorPalette === "string"
            ? East.value(variant(badgeColorPalette, null), ColorSchemeType)
            : badgeColorPalette)
        : undefined;

    const attentionValue = attention !== undefined
        ? (typeof attention === "string"
            ? East.value(variant(attention, null), IconButtonAttentionType)
            : attention)
        : undefined;

    return East.value(variant("IconButton", {
        prefix: prefix as string,
        name: name as string,
        label,
        loadingIcon: loadingIcon ? some(toIconValue(loadingIcon)) : none,
        loading: loading !== undefined ? some(loading) : none,
        disabled: disabled !== undefined ? some(disabled) : none,
        onClick: onClick ? some(onClick) : none,
        badge: badge !== undefined ? some(badge) : none,
        badgeColorPalette: badgeColorPaletteValue ? some(badgeColorPaletteValue) : none,
        attention: attentionValue ? some(attentionValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildIconButtonStyle(style: IconButtonStyle): ExprType<IconButtonStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as ButtonVariantLiteral, null), ButtonVariantType)
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
    }, IconButtonStyleType);
}

function toIconValue(
    input: IconPayload | unknown,
): ExprType<IconType> {
    if (isIconPayload(input)) {
        return East.value({
            name: input.name,
            prefix: input.prefix,
            label: none,
            style: none,
        }, IconType) as ExprType<IconType>;
    }
    return input as ExprType<IconType>;
}

function isIconPayload(x: unknown): x is IconPayload {
    return typeof x === "object"
        && x !== null
        && typeof (x as { prefix?: unknown }).prefix === "string"
        && typeof (x as { name?: unknown }).name === "string"
        && !("toIR" in (x as Record<string, unknown>));
}

/**
 * IconButton primitive — icon-only pressable affordance with required aria-label.
 *
 * @remarks
 * Use `IconButton.Root(options)` to create an icon button, or access
 * `IconButton.Types.IconButton` for the East type. The required `label` field
 * enforces an accessible name at compile time.
 */
export const IconButton = {
    /**
     * Creates an IconButton component.
     *
     * @param options - A single flat options bag; `prefix` / `name` / `label`
     *   are required, plus optional state / behaviour / visual fields.
     * @returns An East expression representing the IconButton component
     *
     * @remarks
     * The renderer emits `label` as the button's `aria-label`. Omitting it is a
     * TypeScript compile error (required field). Every option sits flat; the
     * factory composes the visual fields into the nested IR `style` struct.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { IconButton, UIComponentType } from "@elaraai/east-ui";
     *
     * // Close affordance
     * const close = East.function([], UIComponentType, _$ =>
     *     IconButton.Root({ prefix: "fas", name: "xmark", label: "Close", variant: "ghost" }),
     * );
     *
     * // Loading button with custom spinner icon
     * const refresh = East.function([], UIComponentType, _$ =>
     *     IconButton.Root({
     *         prefix: "fas", name: "rotate", label: "Refresh",
     *         loading: true,
     *         loadingIcon: { prefix: "fas", name: "spinner" },
     *         variant: "subtle", colorPalette: "blue",
     *     }),
     * );
     *
     * // With a click handler (reactive)
     * // (see icon-button.examples.tsx -> iconButtonVariants, BUTTON ON CLICK REACTIVE row)
     * ```
     */
    Root: createIconButton,
    Types: {
        /**
         * The concrete East type for IconButton component data.
         *
         * @remarks
         * `label` is REQUIRED — the renderer emits it verbatim as the button's
         * `aria-label`. See {@link IconButtonType} for the full field reference.
         *
         * @property prefix - Font Awesome prefix
         * @property name - Font Awesome icon name
         * @property label - Required aria-label
         * @property loadingIcon - Icon swapped in when `loading` is true
         * @property loading - Loading state
         * @property disabled - Disabled state
         * @property onClick - Click handler
         * @property style - Visual-presentation sub-struct
         */
        IconButton: IconButtonType,
        /**
         * Visual-only style struct for IconButton. See {@link IconButtonStyleType}.
         *
         * @remarks
         * Holds the Chakra preset triplet (`variant` / `colorPalette` / `size`)
         * plus colour escape hatches. Nothing behavioural or stateful lives
         * here — those fields are on the main struct.
         */
        Style: IconButtonStyleType,
        /**
         * Variant enum for IconButton visual presets (shared with Button).
         *
         * @property solid - Solid filled button
         * @property subtle - Subtle/light background button
         * @property outline - Outlined button with border
         * @property ghost - Transparent button, visible on hover
         * @property plain - Unadorned pressable icon
         */
        Variant: ButtonVariantType,
        /**
         * Attention-animation variant (`none` / `pulse` / `ring`). See
         * {@link IconButtonAttentionType}.
         */
        Attention: IconButtonAttentionType,
    },
} as const;
