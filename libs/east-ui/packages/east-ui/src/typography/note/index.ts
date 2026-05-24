/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    type ExprType,
    East,
    ArrayType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import {
    NoteVariantType,
    NoteEmphasisType,
    NoteVisualStyleType,
    type NoteStyle,
    type NoteVariantLiteral,
    type NoteEmphasisLiteral,
} from "./types.js";
import { Text } from "../text/index.js";

// Re-export types
export {
    NoteVariantType,
    NoteEmphasisType,
    NoteVisualStyleType,
    type NoteStyle,
} from "./types.js";

// ============================================================================
// Note Type — mirrors the inline `Note` variant in component.ts
// ============================================================================

/**
 * Concrete struct type mirroring the inline `Note` variant in `component.ts`.
 * Renderers use this for `equalFor` / `ValueTypeOf`.
 */
export const NoteType: StructType<{
    body: UIComponentType,
    variant: NoteVariantType,
    style: OptionType<NoteVisualStyleType>,
}> = StructType({
    body: UIComponentType,
    variant: NoteVariantType,
    style: OptionType(NoteVisualStyleType),
});

export type NoteType = typeof NoteType;

// ============================================================================
// Note Component
// ============================================================================

type NoteBodyInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * Creates a Note component for narrative / callout / quote prose blocks.
 *
 * @param body - The content. Plain strings coerce to `Text.Root(s)`; any
 *               `UIComponentType` expression is forwarded as-is.
 * @param style - Optional configuration. `variant` lives on main
 *                (semantic classification); every visual field wraps into
 *                `style`.
 * @returns An East expression representing the Note component
 */
function createNote(
    body: NoteBodyInput,
    style?: NoteStyle,
): ExprType<UIComponentType> {
    const bodyExpr: ExprType<UIComponentType> = typeof body === "string"
        ? Text.Root(body)
        : body as ExprType<UIComponentType>;

    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as NoteVariantLiteral, null), NoteVariantType)
            : style.variant)
        : East.value(variant("narrative", null), NoteVariantType);

    const styleValue = style ? buildNoteVisualStyle(style) : undefined;

    return East.value(variant("Note", {
        body: bodyExpr,
        variant: variantValue,
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildNoteVisualStyle(style: NoteStyle): ExprType<NoteVisualStyleType> {
    const emphasisValue = style.emphasis
        ? (typeof style.emphasis === "string"
            ? East.value(variant(style.emphasis as NoteEmphasisLiteral, null), NoteEmphasisType)
            : style.emphasis)
        : undefined;

    const paddingValue = style.padding
        ? (typeof style.padding === "string"
            ? East.value({
                top: some(style.padding),
                right: some(style.padding),
                bottom: some(style.padding),
                left: some(style.padding),
            }, PaddingType)
            : style.padding)
        : undefined;

    const marginValue = style.margin
        ? (typeof style.margin === "string"
            ? East.value({
                top: some(style.margin),
                right: some(style.margin),
                bottom: some(style.margin),
                left: some(style.margin),
            }, MarginType)
            : style.margin)
        : undefined;

    return East.value({
        emphasis: emphasisValue ? some(emphasisValue) : none,
        color: style.color ? some(style.color) : none,
        background: style.background ? some(style.background) : none,
        borderColor: style.borderColor ? some(style.borderColor) : none,
        accentColor: style.accentColor ? some(style.accentColor) : none,
        width: style.width ? some(style.width) : none,
        maxWidth: style.maxWidth ? some(style.maxWidth) : none,
        padding: paddingValue ? some(paddingValue) : none,
        margin: marginValue ? some(marginValue) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
    }, NoteVisualStyleType);
}

// ArrayType is imported to keep the type-system surface in sync with the
// inline variant's expected shape; silence the unused-var warning.
void ArrayType;

/**
 * Note component — narrative / callout / quote prose blocks.
 *
 * @remarks
 * Absorbs the old `SummaryNarrative` pattern. Strings passed at the factory
 * boundary are coerced to `Text.Root(s)`; any `UIComponentType` expression
 * is forwarded. `variant` is semantic content classification — it changes
 * the *meaning* of the block (narration vs alert vs quotation) — so it
 * stays on the main struct. Every visual field lives inside `style` per
 * the `{ content, style }` type-shape convention.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Note, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Note.Root(
 *         "A slow process rate combined with setpoint drift since 02:00 is delaying Stage 1 by ~6 hours.",
 *         { variant: "narrative" }
 *     );
 * });
 * ```
 */
export const Note = {
    Root: createNote,
    Types: {
        Note: NoteType,
        Variant: NoteVariantType,
        Emphasis: NoteEmphasisType,
        Style: NoteVisualStyleType,
    },
} as const;
