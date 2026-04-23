/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    ButtonGroupStyleType,
    type ButtonGroupStyle,
    type ButtonGroupOptions,
} from "./types.js";

// Re-export types
export {
    ButtonGroupStyleType,
    type ButtonGroupStyle,
    type ButtonGroupOptions,
} from "./types.js";

// ============================================================================
// ButtonGroupType — standalone mirror of the inline `ButtonGroup` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `ButtonGroup` variant defined in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`
 * because `buttons: ArrayType(node)` is recursive.
 *
 * @property buttons - Array of child UI components (typically buttons)
 * @property style - Visual-presentation sub-struct
 */
export const ButtonGroupType: StructType<{
    buttons: ArrayType<UIComponentType>,
    style: OptionType<ButtonGroupStyleType>,
}> = StructType({
    buttons: ArrayType(UIComponentType),
    style: OptionType(ButtonGroupStyleType),
});

/**
 * Type representing the ButtonGroup component structure.
 */
export type ButtonGroupType = typeof ButtonGroupType;

// ============================================================================
// ButtonGroup Factory
// ============================================================================

/**
 * Creates a ButtonGroup — a horizontal row of button-like children that
 * share visual presets (size, variant, colorPalette) and optionally share a
 * border when `attached` is set.
 *
 * @param buttons - Array of child UI components (typically Buttons / IconButtons / Toggles)
 * @param options - Visual-presentation options (`style` sub-struct)
 * @returns An East expression representing the ButtonGroup component
 *
 * @remarks
 * The renderer emits Chakra v3's `<Group>`, which propagates `size`,
 * `variant`, and `colorPalette` to its children via React context — so
 * setting those on the ButtonGroup cascades automatically without needing
 * to repeat them on each child. `attached` joins the children into a single
 * visual row with shared borders.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Button, ButtonGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * // Segmented timescale control
 * const timescale = East.function([], UIComponentType, _$ =>
 *     ButtonGroup.Root(
 *         [
 *             Button.Root("1d"),
 *             Button.Root("1w"),
 *             Button.Root("1m"),
 *             Button.Root("3m"),
 *             Button.Root("1y"),
 *         ],
 *         { style: { attached: true, size: "sm", variant: "outline" } },
 *     ),
 * );
 * ```
 */
function createButtonGroup(
    buttons: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: ButtonGroupOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildButtonGroupStyle(options.style) : undefined;

    return East.value(variant("ButtonGroup", {
        buttons,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildButtonGroupStyle(style: ButtonGroupStyle): ExprType<ButtonGroupStyleType> {
    return East.value({
        attached: style.attached !== undefined ? some(style.attached) : none,
        gap: style.gap !== undefined ? some(style.gap) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
    }, ButtonGroupStyleType);
}

/**
 * ButtonGroup primitive — visual grouping of button-like children.
 *
 * @remarks
 * Use `ButtonGroup.Root(buttons, options?)` to create a group, or access
 * `ButtonGroup.Types.ButtonGroup` for the East type.
 */
export const ButtonGroup = {
    /**
     * Creates a ButtonGroup component.
     *
     * @param buttons - Array of child UI components
     * @param options - Visual-presentation options (`style` sub-struct)
     * @returns An East expression representing the ButtonGroup component
     *
     * @remarks
     * Renderer uses Chakra v3's `<Group>` which propagates `size` / `variant`
     * / `colorPalette` to children via React context.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Button, ButtonGroup, UIComponentType } from "@elaraai/east-ui";
     *
     * const prevNext = East.function([], UIComponentType, _$ =>
     *     ButtonGroup.Root(
     *         [
     *             Button.Root("◀ Prev"),
     *             Button.Root("Next ▶"),
     *         ],
     *         { style: { attached: true, size: "md" } },
     *     ),
     * );
     * ```
     */
    Root: createButtonGroup,
    Types: {
        /**
         * The concrete East type for ButtonGroup component data — mirrors the
         * inline `ButtonGroup` variant in `component.ts`.
         *
         * @property buttons - Array of child UI components
         * @property style - Visual-presentation sub-struct
         */
        ButtonGroup: ButtonGroupType,
        /**
         * Visual-only style struct for ButtonGroup. See {@link ButtonGroupStyleType}.
         *
         * @remarks
         * ButtonGroup doesn't expose its own variant enum — set per-child
         * variants on each Button / IconButton / Toggle before passing them
         * as children.
         */
        Style: ButtonGroupStyleType,
    },
} as const;
