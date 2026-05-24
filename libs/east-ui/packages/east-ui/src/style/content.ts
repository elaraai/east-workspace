/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    East,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";

import { FontWeightType, FontStyleType, type FontWeightLiteral, type FontStyleLiteral } from "./typography.js";
import { SizeType, type SizeLiteral } from "./scheme.js";

// ============================================================================
// AlignType — content-positioning enum shared across collections
// ============================================================================

/**
 * Single-axis alignment for content positioned inside a container.
 *
 * @remarks
 * Used by Matrix segment labels and overlays, Planner event labels and
 * overlays, and Gantt task / milestone labels and overlays — every
 * collection that positions text or rich content inside an event /
 * cell / segment box uses this single shared enum.
 *
 * Distinct from CSS `align-items` ({@link AlignItemsType}) which has
 * five values and applies to flex children. `AlignType` is a UX-level
 * enum: start / center / end, mapped to flex `flex-start` /
 * `center` / `flex-end` by the renderer.
 *
 * @property start - Start-aligned (left for horizontal, top for vertical)
 * @property center - Centred (default)
 * @property end - End-aligned (right for horizontal, bottom for vertical)
 */
export const AlignType = VariantType({
    start: NullType,
    center: NullType,
    end: NullType,
});

export type AlignType = typeof AlignType;

export type AlignLiteral = "start" | "center" | "end";

/**
 * Creates an align variant expression.
 *
 * @param align - The alignment value
 * @returns An East expression representing the alignment
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Align("center");
 * ```
 */
export function Align(align: AlignLiteral): ExprType<AlignType> {
    return East.value(variant(align, null), AlignType);
}

// ============================================================================
// LabelInputType — shared rich-text label config
// ============================================================================

/**
 * Inline label input — text plus optional positioning + typography.
 *
 * @remarks
 * Used by Matrix segments, Planner events, and Gantt tasks /
 * milestones for the per-event label inside the bar / cell / segment.
 * The renderer applies `align` / `verticalAlign` via flex, and
 * `color` / `fontWeight` / `fontStyle` / `fontSize` via direct CSS
 * tokens.
 *
 * Cascading defaults: per-component style fields (`labelColor`,
 * `labelFontSize`, `labelFontWeight`, etc.) act as defaults; values
 * specified in `LabelInput` override them per-instance.
 *
 * @property value - The label text (required)
 * @property align - Horizontal alignment (default `"center"`)
 * @property verticalAlign - Vertical alignment (default `"center"`)
 * @property color - Text colour (CSS colour or Chakra token)
 * @property fontWeight - Font weight
 * @property fontStyle - Font style (normal / italic)
 * @property fontSize - Font size token
 */
export const LabelInputType = StructType({
    value: StringType,
    align: OptionType(AlignType),
    verticalAlign: OptionType(AlignType),
    color: OptionType(StringType),
    fontWeight: OptionType(FontWeightType),
    fontStyle: OptionType(FontStyleType),
    fontSize: OptionType(SizeType),
});

export type LabelInputType = typeof LabelInputType;

/**
 * TypeScript options interface mirroring {@link LabelInputType}.
 *
 * @remarks
 * Accepts plain JS values or East expressions for every field via
 * {@link SubtypeExprOrValue}. Variant fields also accept their
 * string-literal forms.
 */
export interface LabelInput {
    /** The label text (required) */
    value: SubtypeExprOrValue<StringType>;
    /** Horizontal alignment (default `"center"`) */
    align?: SubtypeExprOrValue<AlignType> | AlignLiteral;
    /** Vertical alignment (default `"center"`) */
    verticalAlign?: SubtypeExprOrValue<AlignType> | AlignLiteral;
    /** Text colour (CSS colour or Chakra token) */
    color?: SubtypeExprOrValue<StringType>;
    /** Font weight */
    fontWeight?: SubtypeExprOrValue<FontWeightType> | FontWeightLiteral;
    /** Font style (normal / italic) */
    fontStyle?: SubtypeExprOrValue<FontStyleType> | FontStyleLiteral;
    /** Font size token */
    fontSize?: SubtypeExprOrValue<SizeType> | SizeLiteral;
}
