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
import { SizeType } from "../../style.js";
import {
    CloseButtonType,
    CloseButtonStyleType,
    ButtonVariantType,
    type CloseButtonStyle,
    type CloseButtonOptions,
    type ButtonVariantLiteral,
} from "./types.js";

// Re-export types
export {
    CloseButtonType,
    CloseButtonStyleType,
    type CloseButtonStyle,
    type CloseButtonOptions,
} from "./types.js";

// ============================================================================
// CloseButton Factory
// ============================================================================

/**
 * Creates a CloseButton — a dismiss affordance used by Dialog, Drawer, Alert,
 * Banner, Toast, and Tag's closable mode.
 *
 * @param options - Main-level fields plus optional `style` sub-struct
 * @returns An East expression representing the CloseButton component
 *
 * @remarks
 * The rendered button's `aria-label` defaults to `"Close"` when `label` is
 * absent.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { CloseButton, UIComponentType } from "@elaraai/east-ui";
 *
 * // Default "Close" affordance
 * const basic = East.function([], UIComponentType, _$ => CloseButton.Root());
 *
 * // Localised label + explicit variant
 * const localised = East.function([], UIComponentType, _$ =>
 *     CloseButton.Root({
 *         label: "Fermer",
 *         style: { variant: "subtle", size: "sm" },
 *     }),
 * );
 * ```
 */
function createCloseButton(
    options?: CloseButtonOptions,
): ExprType<UIComponentType> {
    const opts: CloseButtonOptions = options ?? {};
    const { label, disabled, onClick, ...visual } = opts;
    const styleValue = Object.values(visual).some(field => field !== undefined)
        ? buildCloseButtonStyle(opts)
        : undefined;

    return East.value(variant("CloseButton", {
        label: label !== undefined ? some(label) : none,
        disabled: disabled !== undefined ? some(disabled) : none,
        onClick: onClick ? some(onClick) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildCloseButtonStyle(style: CloseButtonStyle): ExprType<CloseButtonStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as ButtonVariantLiteral, null), ButtonVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        hoverBackground: style.hoverBackground !== undefined ? some(style.hoverBackground) : none,
    }, CloseButtonStyleType);
}

/**
 * CloseButton primitive — dismiss affordance used by Dialog / Drawer /
 * Alert / Banner / Toast / Tag (closable).
 *
 * @remarks
 * Use `CloseButton.Root(options?)` to create a close affordance, or access
 * `CloseButton.Types.CloseButton` for the East type.
 */
export const CloseButton = {
    /**
     * Creates a CloseButton component.
     *
     * @param options - Main-level fields plus optional `style` sub-struct
     * @returns An East expression representing the CloseButton component
     *
     * @remarks
     * `label` defaults to `"Close"` in the renderer when absent.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { CloseButton, UIComponentType } from "@elaraai/east-ui";
     *
     * const close = East.function([], UIComponentType, _$ =>
     *     CloseButton.Root({ label: "Dismiss banner" }),
     * );
     * ```
     */
    Root: createCloseButton,
    Types: {
        /**
         * The concrete East type for CloseButton component data.
         *
         * @property label - Optional aria-label (renderer default: "Close")
         * @property disabled - Disabled state
         * @property onClick - Click handler
         * @property style - Visual-presentation sub-struct
         */
        CloseButton: CloseButtonType,
        /**
         * Visual-only style struct for CloseButton. See {@link CloseButtonStyleType}.
         */
        Style: CloseButtonStyleType,
        /**
         * Variant enum shared with Button (`solid` / `subtle` / `outline` / `ghost` / `plain`).
         */
        Variant: ButtonVariantType,
    },
} as const;
