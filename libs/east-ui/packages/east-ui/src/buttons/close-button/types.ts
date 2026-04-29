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
// CloseButton Style Type
// ============================================================================

/**
 * Visual-only style struct for CloseButton. Content / state / behaviour live
 * on the main `CloseButtonType` struct.
 *
 * @remarks
 * CloseButton reuses `ButtonVariantType` for its appearance variants but
 * drops `colorPalette` in favour of a pure-monochrome-or-tint design — the
 * dismiss affordance rarely belongs to a semantic-colour palette.
 *
 * @property variant - Appearance variant (solid / subtle / outline / ghost / plain)
 * @property size - Size token (xs / sm / md / lg)
 * @property color - Icon tint — overrides theme default
 * @property background - Background — overrides theme default
 * @property borderColor - Border tint — overrides theme default
 * @property hoverBackground - Background applied on hover
 */
export const CloseButtonStyleType = StructType({
    variant: OptionType(ButtonVariantType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    hoverBackground: OptionType(StringType),
});

/**
 * Type representing the CloseButton visual-style structure.
 */
export type CloseButtonStyleType = typeof CloseButtonStyleType;

/**
 * TypeScript options bag for CloseButton's `style` sub-struct — visual props only.
 *
 * @remarks
 * State (`disabled`) and behaviour (`onClick`) live on the main options
 * object passed to `CloseButton.Root`, not here.
 *
 * @property variant - Appearance variant
 * @property size - Size token
 * @property color - Icon tint escape hatch
 * @property background - Background colour escape hatch
 * @property borderColor - Border colour escape hatch
 * @property hoverBackground - Hover-state background colour
 */
export interface CloseButtonStyle {
    /** Appearance variant */
    variant?: SubtypeExprOrValue<ButtonVariantType> | ButtonVariantLiteral;
    /** Size of the button */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Icon tint — overrides theme default */
    color?: SubtypeExprOrValue<StringType>;
    /** Background — overrides theme default */
    background?: SubtypeExprOrValue<StringType>;
    /** Border tint — overrides theme default */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Background applied on hover */
    hoverBackground?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// CloseButton Type — dismiss affordance with optional label
// ============================================================================

/**
 * The concrete East type for CloseButton component data.
 *
 * @remarks
 * `label` is the aria-label; the renderer defaults to `"Close"` when absent.
 * `disabled` and `onClick` live on main.
 *
 * @property label - Optional aria-label (renderer default: "Close")
 * @property disabled - Disabled state — renderer blocks interaction
 * @property onClick - Click-handler callback (zero-arg East function)
 * @property style - Optional visual-presentation sub-struct
 */
export const CloseButtonType = StructType({
    label: OptionType(StringType),
    disabled: OptionType(BooleanType),
    onClick: OptionType(FunctionType([], NullType)),
    style: OptionType(CloseButtonStyleType),
});

/**
 * Type representing the CloseButton component structure.
 */
export type CloseButtonType = typeof CloseButtonType;

/**
 * TypeScript options bag for `CloseButton.Root`.
 *
 * @remarks
 * Content (`label`), state (`disabled`), and behaviour (`onClick`) live at
 * the top level. Visual presentation lives inside the nested `style` object.
 *
 * @property label - Optional aria-label (renderer default: "Close")
 * @property disabled - Disabled state
 * @property onClick - Click-handler callback
 * @property style - Visual-presentation sub-struct
 */
export interface CloseButtonOptions {
    /** Optional aria-label — renderer defaults to "Close" when absent */
    label?: SubtypeExprOrValue<StringType>;
    /** Disabled state — renderer blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Click-handler callback (zero-arg East function) */
    onClick?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Visual-presentation sub-struct */
    style?: CloseButtonStyle;
}
