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

import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";

import { UIComponentType } from "../../component.js";
import { SizeType, ColorSchemeType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import type { IconPayload } from "../button/types.js";
import {
    IconButtonStyleType,
    IconButtonType,
    ButtonVariantType,
    type IconButtonStyle,
    type IconButtonOptions,
    type ButtonVariantLiteral,
} from "./types.js";

// Re-export types
export {
    IconButtonStyleType,
    IconButtonType,
    type IconButtonStyle,
    type IconButtonOptions,
} from "./types.js";

// ============================================================================
// IconButton Factory
// ============================================================================

/**
 * Creates an IconButton component.
 *
 * @param prefix - Font Awesome prefix (e.g. `fas`, `far`, `fab`)
 * @param name - Font Awesome icon name (e.g. `xmark`, `bars`, `save`)
 * @param label - REQUIRED aria-label for the button (used verbatim by the renderer)
 * @param options - Main-level fields plus optional `style` sub-struct
 * @returns An East expression representing the IconButton component
 *
 * @remarks
 * IconButton renders an icon-only button — useful for toolbar actions, close
 * buttons, and other icon-only interactive elements. The `label` positional
 * argument is REQUIRED so that screen readers always have an accessible name;
 * omitting it is a TypeScript compile error.
 *
 * Per the Type-shape convention: content + state + behaviour are top-level
 * options; visual-presentation lives inside `options.style`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { IconButton, UIComponentType } from "@elaraai/east-ui";
 *
 * // Simple close affordance
 * const close = East.function([], UIComponentType, _$ =>
 *     IconButton.Root("fas", "xmark", "Close", { style: { variant: "ghost" } }),
 * );
 *
 * // Loading IconButton with a custom spinner
 * const refresh = East.function([], UIComponentType, _$ =>
 *     IconButton.Root("fas", "rotate", "Refresh", {
 *         loading: true,
 *         loadingIcon: { prefix: "fas", name: "spinner" },
 *         style: { variant: "subtle", colorPalette: "blue" },
 *     }),
 * );
 * ```
 */
function createIconButton(
    prefix: IconPrefix,
    name: IconName,
    label: string,
    options?: IconButtonOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildIconButtonStyle(options.style) : undefined;

    return East.value(variant("IconButton", {
        prefix: prefix as string,
        name: name as string,
        label,
        loadingIcon: options?.loadingIcon ? some(toIconValue(options.loadingIcon)) : none,
        loading: options?.loading !== undefined ? some(options.loading) : none,
        disabled: options?.disabled !== undefined ? some(options.disabled) : none,
        onClick: options?.onClick ? some(options.onClick) : none,
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
 * Use `IconButton.Root(prefix, name, label, options)` to create an icon
 * button, or access `IconButton.Types.IconButton` for the East type. The
 * positional `label` enforces an accessible name at compile time.
 */
export const IconButton = {
    /**
     * Creates an IconButton component.
     *
     * @param prefix - Font Awesome prefix (e.g. `fas`, `far`, `fab`)
     * @param name - Font Awesome icon name (e.g. `xmark`, `bars`, `save`)
     * @param label - REQUIRED aria-label for screen readers
     * @param options - Main-level fields plus optional `style` sub-struct
     * @returns An East expression representing the IconButton component
     *
     * @remarks
     * The renderer emits `label` as the button's `aria-label`. Omitting it is
     * a TypeScript compile error (positional argument). Per the Type-shape
     * convention: content + state + behaviour are top-level options; visual
     * presentation lives inside `options.style`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { IconButton, UIComponentType } from "@elaraai/east-ui";
     *
     * // Close affordance
     * const close = East.function([], UIComponentType, _$ =>
     *     IconButton.Root("fas", "xmark", "Close", { style: { variant: "ghost" } }),
     * );
     *
     * // Loading button with custom spinner icon
     * const refresh = East.function([], UIComponentType, _$ =>
     *     IconButton.Root("fas", "rotate", "Refresh", {
     *         loading: true,
     *         loadingIcon: { prefix: "fas", name: "spinner" },
     *         style: { variant: "subtle", colorPalette: "blue" },
     *     }),
     * );
     *
     * // With a click handler (reactive)
     * // (see IconButton.examples.ts -> iconButtonOnClickReactive)
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
    },
} as const;
