/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    FunctionType,
    NullType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";
import { ButtonVariantType, type ButtonVariantLiteral } from "../button/types.js";

// Re-export the shared ButtonVariantType for convenience.
export { ButtonVariantType, type ButtonVariantLiteral } from "../button/types.js";

// ============================================================================
// Toggle Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Toggle. Content (label, icon), state
 * (`pressed`, `disabled`), and behaviour (`onChange`) live on the main
 * `Toggle` variant — defined inline in `component.ts` because `label: UIComp`
 * is recursive — per the Type-shape convention (§0.10).
 *
 * @remarks
 * Holds the variant + size presets plus colour escape hatches, including
 * `pressedBackground` / `pressedColor` for the active (pressed) state.
 *
 * @property variant - Appearance variant (solid / subtle / outline / ghost / plain)
 * @property size - Size token (xs / sm / md / lg)
 * @property color - Label + icon tint for the unpressed state
 * @property background - Background for the unpressed state
 * @property borderColor - Border tint for the unpressed state
 * @property pressedBackground - Background applied when `pressed` is true
 * @property pressedColor - Label + icon tint applied when `pressed` is true
 */
export const ToggleStyleType = StructType({
    variant: OptionType(ButtonVariantType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    pressedBackground: OptionType(StringType),
    pressedColor: OptionType(StringType),
});

/**
 * Type representing the Toggle visual-style structure.
 */
export type ToggleStyleType = typeof ToggleStyleType;

/**
 * TypeScript options bag for Toggle's `style` sub-struct — visual props only.
 *
 * @remarks
 * Content (`icon`), state (`pressed`, `disabled`), and behaviour (`onChange`)
 * live on the main options object passed to `Toggle.Root`, not here.
 */
export interface ToggleStyle {
    /** Appearance variant */
    variant?: SubtypeExprOrValue<ButtonVariantType> | ButtonVariantLiteral;
    /** Size of the toggle */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Label + icon tint for the unpressed state */
    color?: SubtypeExprOrValue<StringType>;
    /** Background for the unpressed state */
    background?: SubtypeExprOrValue<StringType>;
    /** Border tint for the unpressed state */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Background applied when `pressed` is true */
    pressedBackground?: SubtypeExprOrValue<StringType>;
    /** Label + icon tint applied when `pressed` is true */
    pressedColor?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `Toggle.Root`.
 *
 * @property icon - Optional leading icon
 * @property disabled - Disabled state
 * @property onChange - Callback invoked with the new pressed state (opposite of current)
 * @property style - Visual-presentation sub-struct
 */
export interface ToggleOptions {
    /** Optional leading icon */
    icon?: { prefix: string; name: string };
    /** Disabled state — renderer blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /**
     * Callback invoked with the new `pressed` value when the toggle is clicked.
     * If omitted, the toggle is purely presentational.
     */
    onChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
    /** Visual-presentation sub-struct */
    style?: ToggleStyle;
}
