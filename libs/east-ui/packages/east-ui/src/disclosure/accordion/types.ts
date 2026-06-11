/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    NullType,
    OptionType,
    StructType,
    BooleanType,
    VariantType,
    ArrayType,
    StringType,
    FunctionType,
    variant,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";

// ============================================================================
// Accordion Variant Type
// ============================================================================

/**
 * Variant types for Accordion visual style.
 *
 * @remarks
 * Create instances using string literals like `"enclosed"`, `"plain"`, `"subtle"`.
 *
 * @property enclosed - Bordered accordion with distinct boundaries
 * @property plain - No visible borders or background
 * @property subtle - Light background styling
 */
export const AccordionVariantType = VariantType({
    /** Bordered accordion with distinct boundaries */
    enclosed: NullType,
    /** No visible borders or background */
    plain: NullType,
    /** Light background styling */
    subtle: NullType,
});

/**
 * Type representing the AccordionVariant structure.
 */
export type AccordionVariantType = typeof AccordionVariantType;

/**
 * String literal type for accordion variant values.
 */
export type AccordionVariantLiteral = "enclosed" | "plain" | "subtle";

/**
 * Helper function to create accordion variant values.
 *
 * @param v - The variant string ("enclosed", "plain", or "subtle")
 * @returns An East expression representing the accordion variant
 */
export function AccordionVariant(v: AccordionVariantLiteral): ExprType<AccordionVariantType> {
    return East.value(variant(v, null), AccordionVariantType);
}

// ============================================================================
// Accordion Style Type
// ============================================================================

/**
 * Visual-only style struct for Accordion. Content (`items`), state (`value`,
 * `defaultValue`), config (`multiple`, `collapsible`), and behaviour
 * (`onValueChange`) live on the main `Accordion` variant (inline in
 * `component.ts` because of the recursive item `trigger: node` field) per
 * the Type-shape convention.
 *
 * @remarks
 * Holds the appearance variant + size plus per-slot colour escape hatches
 * for the container background, item border, trigger / trigger-hover,
 * and content panel backgrounds.
 *
 * @property variant - Appearance variant (enclosed / plain / subtle)
 * @property size - Size token (xs / sm / md / lg)
 * @property background - Root container background colour
 * @property borderColor - Item border colour (used in `enclosed` variant)
 * @property triggerBackground - Trigger background colour (unpressed)
 * @property triggerHoverBackground - Trigger background on hover
 * @property contentBackground - Expanded content panel background
 */
export const AccordionStyleType = StructType({
    variant: OptionType(AccordionVariantType),
    size: OptionType(SizeType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    triggerBackground: OptionType(StringType),
    triggerHoverBackground: OptionType(StringType),
    contentBackground: OptionType(StringType),
});

/**
 * Type representing the Accordion visual-style structure.
 */
export type AccordionStyleType = typeof AccordionStyleType;

// ============================================================================
// Style Interfaces
// ============================================================================

/**
 * TypeScript options bag for Accordion's `style` sub-struct — visual props only.
 *
 * @property variant - Appearance variant
 * @property size - Size token
 * @property background - Root container background
 * @property borderColor - Item border (enclosed variant)
 * @property triggerBackground - Trigger background (unpressed)
 * @property triggerHoverBackground - Trigger background on hover
 * @property contentBackground - Expanded panel background
 */
export interface AccordionStyle {
    /** Visual variant (enclosed, plain, subtle) */
    variant?: SubtypeExprOrValue<AccordionVariantType> | AccordionVariantLiteral;
    /** Size token (xs / sm / md / lg) */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Root container background */
    background?: SubtypeExprOrValue<StringType>;
    /** Item border (used by `enclosed`) */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Trigger background (unpressed) */
    triggerBackground?: SubtypeExprOrValue<StringType>;
    /** Trigger background on hover */
    triggerHoverBackground?: SubtypeExprOrValue<StringType>;
    /** Expanded content panel background */
    contentBackground?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `Accordion.Item`.
 *
 * @property meta - Optional trailing meta (field/dirty count), right-aligned in the header
 * @property disabled - Whether this item is disabled
 */
export interface AccordionItemOptions {
    /** Optional trailing meta (field/dirty count) shown right-aligned in the header. */
    meta?: SubtypeExprOrValue<StringType>;
    /** Whether this item is disabled — renderer blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
}

/**
 * TypeScript options bag for `Accordion.Root`.
 *
 * @remarks
 * Config (`multiple`, `collapsible`), state (`value`, `defaultValue`), and
 * behaviour (`onValueChange`) sit alongside the visual style fields in one
 * flat bag; the factory composes the nested IR style sub-struct.
 *
 * @property multiple - Allow multiple items open simultaneously
 * @property collapsible - Allow every item to be closed
 * @property value - Controlled expanded-value list
 * @property defaultValue - Initial expanded-value list (uncontrolled)
 * @property onValueChange - Callback invoked with the new expanded-value list
 * @property variant - Visual variant (enclosed, plain, subtle)
 * @property size - Size token (xs / sm / md / lg)
 * @property background - Root container background
 * @property borderColor - Item border (used by `enclosed`)
 * @property triggerBackground - Trigger background (unpressed)
 * @property triggerHoverBackground - Trigger background on hover
 * @property contentBackground - Expanded content panel background
 */
export interface AccordionOptions extends AccordionStyle {
    /** Allow multiple items open simultaneously */
    multiple?: SubtypeExprOrValue<BooleanType>;
    /** Allow every item to be closed */
    collapsible?: SubtypeExprOrValue<BooleanType>;
    /** Controlled expanded-value list */
    value?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Initial expanded-value list (uncontrolled) */
    defaultValue?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Callback invoked with the new expanded-value list */
    onValueChange?: SubtypeExprOrValue<FunctionType<[ArrayType<StringType>], NullType>>;
}
