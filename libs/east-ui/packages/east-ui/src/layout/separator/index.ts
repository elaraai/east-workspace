/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    OptionType,
    StructType,
    variant,
} from "@elaraai/east";

import {
    SeparatorVariantType,
    SeparatorAlignType,
    SeparatorStyleType,
    type SeparatorStyle,
} from "./types.js";
import { UIComponentType } from "../../component.js";
import { OrientationType } from "../../style.js";
import { Text } from "../../typography/text/index.js";

// Re-export types
export {
    SeparatorVariantType,
    SeparatorAlignType,
    SeparatorStyleType,
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
    label: OptionType(UIComponentType),
    style: OptionType(SeparatorStyleType),
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
 *         variant: "subtle",
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
    // Coerced labels render as a small uppercase muted caption (12px) so the
    // divider label reads as an eyebrow, not body copy.
    const labelValue = style?.label !== undefined
        ? (isPlainString
            ? Text.Root(style.label as string, {
                textStyle: "caption",
                color: "fg.muted",
                textTransform: "uppercase",
            })
            : (style.label as ExprType<UIComponentType>))
        : undefined;

    const hasVisualStyle = orientationValue !== undefined ||
        variantValue !== undefined ||
        alignValue !== undefined;

    const styleValue = hasVisualStyle
        ? East.value({
            orientation: orientationValue ? variant("some", orientationValue) : variant("none", null),
            variant: variantValue ? variant("some", variantValue) : variant("none", null),
            align: alignValue ? variant("some", alignValue) : variant("none", null),
        }, SeparatorStyleType)
        : undefined;

    return East.value(variant("Separator", {
        label: labelValue ? variant("some", labelValue) : variant("none", null),
        style: styleValue ? variant("some", styleValue) : variant("none", null),
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
         *
         * @remarks
         * Visual fields (orientation, variant, align) live in `style`. The
         * `label` is content and stays on main.
         *
         * @property label - Optional rich label inside the separator
         * @property style - Optional visual-only style sub-struct (see `Style`)
         */
        Separator: SeparatorType,
        /**
         * Visual-only style struct for Separator.
         *
         * @remarks
         * Mirror of `SeparatorStyleType` from `./types.js`.
         *
         * @property orientation - Orientation (horizontal or vertical)
         * @property variant - Hairline variant (subtle, strong, dashed, brand)
         * @property align - Label alignment (start | center | end)
         */
        Style: SeparatorStyleType,
        /**
         * The `SeparatorVariantType` reusable variant (subtle | strong | dashed | brand).
         */
        Variant: SeparatorVariantType,
        /**
         * The `SeparatorAlignType` reusable variant (start | center | end).
         */
        Align: SeparatorAlignType,
    },
} as const;
