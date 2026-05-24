/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    VariantType,
    NullType,
} from "@elaraai/east";

import {
    OrientationType,
} from "../../style.js";
import type {
    OrientationLiteral,
} from "../../style.js";
import type { UIComponentType } from "../../component.js";

/**
 * Separator variant type — the bsys `.rule` hairline set.
 *
 * @remarks
 * Create instances using East's variant function.
 *
 * @property subtle - 1px solid `rule` hairline (default)
 * @property strong - 1px solid `rule-strong` hairline
 * @property dashed - 1px dashed `rule-strong` hairline
 * @property brand - 1px solid `brand` hairline
 */
export const SeparatorVariantType = VariantType({
    subtle: NullType,
    strong: NullType,
    dashed: NullType,
    brand: NullType,
});

/**
 * Type representing separator variant values.
 */
export type SeparatorVariantType = typeof SeparatorVariantType;

/**
 * String literal type for separator variant values.
 */
export type SeparatorVariantLiteral = "subtle" | "strong" | "dashed" | "brand";

/**
 * Separator label alignment.
 *
 * @remarks
 * When `label` is set, `align` biases the label position. `start` places the
 * label at the leading edge with the trailing hairline filling the rest;
 * `end` mirrors; `center` (default) centers the label between two hairlines.
 *
 * @property start - Label biased toward the leading edge
 * @property center - Label centered (default)
 * @property end - Label biased toward the trailing edge
 */
export const SeparatorAlignType = VariantType({
    start: NullType,
    center: NullType,
    end: NullType,
});

/**
 * Type representing separator alignment values.
 */
export type SeparatorAlignType = typeof SeparatorAlignType;

/**
 * String literal type for separator alignment values.
 */
export type SeparatorAlignLiteral = "start" | "center" | "end";

/**
 * Visual-only style struct for Separator.
 *
 * @remarks
 * The visual fields (orientation, variant, size, colour,
 * align) live in `style`. The `label` is content and stays on the main
 * struct.
 *
 * @property orientation - Orientation (horizontal or vertical)
 * @property variant - Hairline variant (subtle, strong, dashed, brand)
 * @property align - Label alignment (start | center | end)
 */
export const SeparatorStyleType = StructType({
    orientation: OptionType(OrientationType),
    variant: OptionType(SeparatorVariantType),
    align: OptionType(SeparatorAlignType),
});

/** Type alias for the Separator style struct. */
export type SeparatorStyleType = typeof SeparatorStyleType;

/**
 * Style configuration for Separator components.
 *
 * @remarks
 * Separator is a visual divider between content sections. `label` may be a
 * plain string (coerced at the factory to `Text.Root(s, { textStyle:
 * "caption", color: "fg.muted", textTransform: "uppercase" })`) or an
 * explicit `UIComponentType` expression for full control.
 *
 * @property orientation - Orientation (horizontal or vertical)
 * @property variant - Hairline variant (subtle, strong, dashed, brand)
 * @property label - Optional label inside the separator line. `string` is
 *     coerced to `Text.Root`; pass a UIComponent expression for control.
 * @property align - Label alignment (start | center | end); defaults to center.
 */
export type SeparatorStyle = {
    /** Orientation (horizontal or vertical) */
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    /** Hairline variant (subtle, strong, dashed, brand) */
    variant?: SubtypeExprOrValue<SeparatorVariantType> | SeparatorVariantLiteral;
    /**
     * Optional label. A plain string is coerced at the factory to a muted
     * uppercase caption `Text`. For dynamic strings (`East.str\`...\``) or
     * any other rich content, wrap with an explicit `Text.Root(...)` or
     * another UIComponent before passing.
     */
    label?: string | ExprType<UIComponentType>;
    /** Label alignment (start | center | end); defaults to center. */
    align?: SubtypeExprOrValue<SeparatorAlignType> | SeparatorAlignLiteral;
};
