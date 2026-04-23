/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    OptionType,
    StringType,
    StructType,
    variant,
} from "@elaraai/east";

import {
    SeparatorVariantType,
    SeparatorAlignType,
    type SeparatorStyle,
} from "./types.js";
import { UIComponentType } from "../../component.js";
import { OrientationType, SizeType } from "../../style.js";
import { Text } from "../../typography/text/index.js";

// Re-export types
export {
    SeparatorVariantType,
    SeparatorAlignType,
    type SeparatorVariantLiteral,
    type SeparatorAlignLiteral,
    type SeparatorStyle,
} from "./types.js";

/**
 * The East struct that mirrors the `Separator` variant's payload registered
 * inline in `src/component.ts`. Exposed for renderer equality + typing
 * (e.g. `equalFor(Separator.Types.Separator)`); the main variant itself
 * lives inline in `UIComponentType` so the `label: UIComponentType` recursive
 * reference resolves.
 */
export const SeparatorType = StructType({
    orientation: OptionType(OrientationType),
    variant: OptionType(SeparatorVariantType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    label: OptionType(UIComponentType),
    align: OptionType(SeparatorAlignType),
});
export type SeparatorType = typeof SeparatorType;

/**
 * Creates a Separator component for visual division between content.
 *
 * @param style - Optional styling configuration for the separator
 * @returns An East expression representing the separator component
 *
 * @remarks
 * Separator is a simple visual divider. By default it's horizontal.
 * Use orientation to create vertical separators in flex row layouts.
 *
 * When `label` is a plain string, it is coerced to `Text.Root(s, { textStyle:
 * "caption", color: "fg.muted", textTransform: "uppercase" })` — the
 * "chain-divider" style. Pass an explicit `UIComponent` expression for full
 * control.
 *
 * `align` biases the label position: `start` leading edge, `end` trailing
 * edge, `center` (default) centered between two hairlines.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Separator, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Separator.Root({
 *         orientation: "horizontal",
 *         variant: "solid",
 *         label: "Cross-phase decisions",   // coerced to uppercase muted caption
 *         align: "center",
 *     });
 * });
 * ```
 */
function createSeparator(
    style?: SeparatorStyle
): ExprType<UIComponentType> {
    const orientationValue = style?.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), OrientationType)
            : style.orientation)
        : undefined;

    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), SeparatorVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const alignValue = style?.align
        ? (typeof style.align === "string"
            ? East.value(variant(style.align, null), SeparatorAlignType)
            : style.align)
        : undefined;

    // String-ish labels (plain string or `ExprType<StringType>` from `East.str`)
    // coerce to a muted uppercase caption; `ExprType<UIComponentType>` values
    // pass through. The renderer recognises a `Text.Root` value and renders
    // it inline with the "chain-divider" styling.
    //
    // Heuristic: treat anything that is NOT a `Text` / `Heading` / `HStack` /
    // VStack variant-tag expression as string-ish and wrap it with Text.Root.
    // In practice we can rely on the caller to pass a real `ExprType<UIComp>`
    // (like `Text.Root(...)`) when they want control — plain strings and
    // `East.str` template expressions both read as "caption-shaped label" at
    // this factory.
    const isPlainString = typeof style?.label === "string";
    // Only `textTransform` + `color` are wired onto `Text.Root` today; the
    // semantic `textStyle: "caption"` lands alongside the §1.3 typography plan.
    const labelValue = style?.label !== undefined
        ? (isPlainString
            ? Text.Root(style.label as string, {
                color: "fg.muted",
                textTransform: "uppercase",
            })
            : (style.label as ExprType<UIComponentType>))
        : undefined;

    return East.value(variant("Separator", {
        orientation: orientationValue ? variant("some", orientationValue) : variant("none", null),
        variant: variantValue ? variant("some", variantValue) : variant("none", null),
        size: sizeValue ? variant("some", sizeValue) : variant("none", null),
        color: style?.color ? variant("some", style.color) : variant("none", null),
        label: labelValue ? variant("some", labelValue) : variant("none", null),
        align: alignValue ? variant("some", alignValue) : variant("none", null),
    }), UIComponentType);
}

/**
 * Separator component for visual division between content.
 *
 * @remarks
 * Use `Separator.Root(style)` to create a separator.
 */
export const Separator = {
    Root: createSeparator,
    Types: {
        /**
         * The East struct for the `Separator` variant payload — consumed by
         * the renderer's memoisation (`equalFor(Separator.Types.Separator)`).
         */
        Separator: SeparatorType,
        /**
         * The `SeparatorVariantType` reusable variant (solid | dashed | dotted).
         */
        Variant: SeparatorVariantType,
        /**
         * The `SeparatorAlignType` reusable variant (start | center | end).
         */
        Align: SeparatorAlignType,
    },
} as const;
