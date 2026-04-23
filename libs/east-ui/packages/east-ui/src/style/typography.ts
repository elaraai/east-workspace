/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Font Styling
// ============================================================================

/**
 * Font weight variant type for text styling.
 *
 * @remarks
 * This variant type provides type-safe font weight options compatible with
 * CSS and Chakra UI. Create instances using the {@link FontWeight} function.
 *
 * @property normal - Normal font weight (typically 400 in CSS)
 * @property bold - Bold font weight (typically 700 in CSS)
 * @property semibold - Semi-bold font weight (typically 600 in CSS)
 * @property medium - Medium font weight (typically 500 in CSS)
 * @property light - Light font weight (typically 300 in CSS)
 */
export const FontWeightType = VariantType({
    normal: NullType,
    bold: NullType,
    semibold: NullType,
    medium: NullType,
    light: NullType,
});

/**
 * Type representing font weight variant values.
 *
 * @remarks
 * Create instances using {@link FontWeight} function.
 */
export type FontWeightType = typeof FontWeightType;

/**
 * String literal type for font weight values.
 */
export type FontWeightLiteral = "normal" | "bold" | "semibold" | "medium" | "light";

/**
 * Creates a font weight variant expression.
 *
 * @param weight - The font weight value
 * @returns An East expression representing the font weight
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * // Static weight
 * const boldWeight = Style.FontWeight("bold");
 *
 * // Conditional weight
 * const weight = isImportant.ifElse(
 *   Style.FontWeight("bold"),
 *   Style.FontWeight("normal")
 * );
 * ```
 */
export function FontWeight(weight: "normal" | "bold" | "semibold" | "medium" | "light"): ExprType<FontWeightType> {
    return East.value(variant(weight, null), FontWeightType);
}



/**
 * Font style variant type for text styling.
 *
 * @remarks
 * Create instances using the {@link FontStyle} function.
 *
 * @property normal - Normal (upright) text style
 * @property italic - Italic (slanted) text style
 */
export const FontStyleType = VariantType({
    normal: NullType,
    italic: NullType,
});

/**
 * Type representing font style variant values.
 */
export type FontStyleType = typeof FontStyleType;

/**
 * String literal type for font style values.
 */
export type FontStyleLiteral = "normal" | "italic";

/**
 * Creates a font style variant expression.
 *
 * @param style - The font style value
 * @returns An East expression representing the font style
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.FontStyle("italic");
 * ```
 */
export function FontStyle(style: "normal" | "italic"): ExprType<FontStyleType> {
    return East.value(variant(style, null), FontStyleType);
}

// ============================================================================
// Text Alignment
// ============================================================================

/**
 * Text alignment variant type for horizontal alignment.
 *
 * @remarks
 * Create instances using the {@link TextAlign} function.
 *
 * @property left - Align text to the left
 * @property center - Center text horizontally
 * @property right - Align text to the right
 * @property justify - Justify text to fill the full width
 */
export const TextAlignType = VariantType({
    left: NullType,
    center: NullType,
    right: NullType,
    justify: NullType,
});

/**
 * Type representing text alignment variant values.
 */
export type TextAlignType = typeof TextAlignType;

/**
 * String literal type for text alignment values.
 */
export type TextAlignLiteral = "left" | "center" | "right" | "justify";

/**
 * Creates a text alignment variant expression.
 *
 * @param align - The horizontal alignment value
 * @returns An East expression representing the text alignment
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.TextAlign("center");
 * ```
 */
export function TextAlign(align: "left" | "center" | "right" | "justify"): ExprType<TextAlignType> {
    return East.value(variant(align, null), TextAlignType);
}

// ============================================================================
// Text Transform
// ============================================================================

/**
 * Text transform variant type for controlling text case transformation.
 *
 * @remarks
 * Create instances using the {@link TextTransform} function.
 *
 * @property uppercase - Transform text to UPPERCASE
 * @property lowercase - Transform text to lowercase
 * @property capitalize - Capitalize First Letter Of Each Word
 * @property none - No text transformation
 */
export const TextTransformType = VariantType({
    uppercase: NullType,
    lowercase: NullType,
    capitalize: NullType,
    none: NullType,
});

/**
 * Type representing text transform variant values.
 */
export type TextTransformType = typeof TextTransformType;

/**
 * String literal type for text transform values.
 */
export type TextTransformLiteral = "uppercase" | "lowercase" | "capitalize" | "none";

/**
 * Creates a text transform variant expression.
 *
 * @param transform - The text transformation mode
 * @returns An East expression representing the text transform
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.TextTransform("uppercase");
 * ```
 */
export function TextTransform(transform: "uppercase" | "lowercase" | "capitalize" | "none"): ExprType<TextTransformType> {
    return East.value(variant(transform, null), TextTransformType);
}

// ============================================================================
// Vertical Align
// ============================================================================

/**
 * Vertical align variant type for text vertical alignment.
 *
 * @remarks
 * Create instances using the {@link VerticalAlign} function.
 *
 * @property top - Align to the top
 * @property middle - Align to the middle
 * @property bottom - Align to the bottom
 * @property baseline - Align to text baseline
 */
export const VerticalAlignType = VariantType({
    top: NullType,
    middle: NullType,
    bottom: NullType,
    baseline: NullType,
});

/**
 * Type representing vertical align variant values.
 */
export type VerticalAlignType = typeof VerticalAlignType;

/**
 * String literal type for vertical align values.
 */
export type VerticalAlignLiteral = "top" | "middle" | "bottom" | "baseline";

/**
 * Creates a vertical align variant expression.
 *
 * @param align - The vertical alignment value
 * @returns An East expression representing the vertical alignment
 */
export function VerticalAlign(align: "top" | "middle" | "bottom" | "baseline"): ExprType<VerticalAlignType> {
    return East.value(variant(align, null), VerticalAlignType);
}

// ============================================================================
// Text Overflow
// ============================================================================

/**
 * Text overflow variant type for controlling text overflow behavior.
 *
 * @remarks
 * Create instances using the {@link TextOverflow} function.
 *
 * @property clip - Clip overflowing text
 * @property ellipsis - Show ellipsis (...) for overflowing text
 */
export const TextOverflowType = VariantType({
    clip: NullType,
    ellipsis: NullType,
});

/**
 * Type representing text overflow variant values.
 */
export type TextOverflowType = typeof TextOverflowType;

/**
 * String literal type for text overflow values.
 */
export type TextOverflowLiteral = "clip" | "ellipsis";

/**
 * Creates a text overflow variant expression.
 *
 * @param overflow - The text overflow value
 * @returns An East expression representing the text overflow
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.TextOverflow("ellipsis");
 * ```
 */
export function TextOverflow(overflow: "clip" | "ellipsis"): ExprType<TextOverflowType> {
    return East.value(variant(overflow, null), TextOverflowType);
}

// ============================================================================
// White Space
// ============================================================================

/**
 * White space variant type for controlling whitespace handling.
 *
 * @remarks
 * Create instances using the {@link WhiteSpace} function.
 *
 * @property normal - Normal whitespace handling (wraps text)
 * @property nowrap - Prevent text wrapping
 * @property pre - Preserve whitespace and newlines
 * @property pre-wrap - Preserve whitespace but allow wrapping
 * @property pre-line - Collapse whitespace but preserve newlines
 */
export const WhiteSpaceType = VariantType({
    normal: NullType,
    nowrap: NullType,
    pre: NullType,
    "pre-wrap": NullType,
    "pre-line": NullType,
});

/**
 * Type representing white space variant values.
 */
export type WhiteSpaceType = typeof WhiteSpaceType;

/**
 * String literal type for white space values.
 */
export type WhiteSpaceLiteral = "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line";

/**
 * Creates a white space variant expression.
 *
 * @param whiteSpace - The white space value
 * @returns An East expression representing the white space handling
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.WhiteSpace("nowrap");
 * ```
 */
export function WhiteSpace(whiteSpace: "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line"): ExprType<WhiteSpaceType> {
    return East.value(variant(whiteSpace, null), WhiteSpaceType);
}

// ============================================================================
// Text Decoration
// ============================================================================

/**
 * Text decoration variant type for controlling text decoration.
 *
 * @remarks
 * Create instances using the {@link TextDecoration} function.
 *
 * @property none - No decoration
 * @property underline - Underline text
 * @property line-through - Strikethrough text
 * @property overline - Line above text
 */
export const TextDecorationType = VariantType({
    none: NullType,
    underline: NullType,
    "line-through": NullType,
    overline: NullType,
});

/**
 * Type representing text decoration variant values.
 */
export type TextDecorationType = typeof TextDecorationType;

/**
 * String literal type for text decoration values.
 */
export type TextDecorationLiteral = "none" | "underline" | "line-through" | "overline";

/**
 * Creates a text decoration variant expression.
 *
 * @param textDecoration - The text decoration value
 * @returns An East expression representing the text decoration
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.TextDecoration("underline");
 * ```
 */
export function TextDecoration(textDecoration: "none" | "underline" | "line-through" | "overline"): ExprType<TextDecorationType> {
    return East.value(variant(textDecoration, null), TextDecorationType);
}

// ============================================================================
// Font Family
// ============================================================================

/**
 * Font family variant type for typographic family selection.
 *
 * @remarks
 * Create instances using the {@link FontFamily} function. Resolves to theme
 * tokens so the consuming app owns the concrete font stacks. `mono` is the
 * right choice for numbers, codes, and timestamps (pairs with
 * `FontVariantNumericType: tabular-nums`).
 *
 * @property sans - Sans-serif — body text
 * @property serif - Serif — display headings, long-form prose
 * @property mono - Monospace — numbers, codes, timestamps
 */
export const FontFamilyType = VariantType({
    sans: NullType,
    serif: NullType,
    mono: NullType,
});

/**
 * Type representing font family variant values.
 */
export type FontFamilyType = typeof FontFamilyType;

/**
 * String literal type for font family values.
 */
export type FontFamilyLiteral = "sans" | "serif" | "mono";

/**
 * Creates a font family variant expression.
 *
 * @param family - The font family token
 * @returns An East expression representing the font family
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.FontFamily("mono");
 * ```
 */
export function FontFamily(family: FontFamilyLiteral): ExprType<FontFamilyType> {
    return East.value(variant(family, null), FontFamilyType);
}

// ============================================================================
// Font Variant Numeric
// ============================================================================

/**
 * Font variant numeric type for CSS `font-variant-numeric`.
 *
 * @remarks
 * Create instances using the {@link FontVariantNumeric} function.
 * `tabular-nums` aligns digit columns in tables, KPI tiles, and any financial
 * or data-dense surface. `slashed-zero` distinguishes `0` from `O` in codes.
 *
 * @property normal - Default typographic numerals
 * @property tabular-nums - Fixed-width numeric glyphs
 * @property oldstyle-nums - Old-style numerals with descenders
 * @property slashed-zero - Zero rendered with a diagonal slash
 */
export const FontVariantNumericType = VariantType({
    normal: NullType,
    "tabular-nums": NullType,
    "oldstyle-nums": NullType,
    "slashed-zero": NullType,
});

/**
 * Type representing font variant numeric values.
 */
export type FontVariantNumericType = typeof FontVariantNumericType;

/**
 * String literal type for font variant numeric values.
 */
export type FontVariantNumericLiteral = "normal" | "tabular-nums" | "oldstyle-nums" | "slashed-zero";

/**
 * Creates a font variant numeric expression.
 *
 * @param variant_ - The font variant numeric value
 * @returns An East expression representing the font variant numeric
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.FontVariantNumeric("tabular-nums");
 * ```
 */
export function FontVariantNumeric(variant_: FontVariantNumericLiteral): ExprType<FontVariantNumericType> {
    return East.value(variant(variant_, null), FontVariantNumericType);
}

// ============================================================================
// Text Style (semantic)
// ============================================================================

/**
 * Text style variant type — the primary typography API.
 *
 * @remarks
 * Create instances using the {@link TextStyle} function. Binds a Chakra v3
 * `textStyles` recipe. Each token resolves to a `(fontFamily, fontSize,
 * fontWeight, lineHeight, letterSpacing, fontVariantNumeric?)` bundle in the
 * consumer's theme. `mono-kpi` additionally pre-sets mono + tabular-nums for
 * aligned KPI digits.
 *
 * Text and Heading require a `textStyle`; raw `fontSize` stays on Box only
 * as an escape hatch.
 *
 * @property display-lg - Large display heading
 * @property display-md - Medium display heading
 * @property display-sm - Small display heading
 * @property heading-lg - Large section heading
 * @property heading-md - Medium section heading
 * @property heading-sm - Small section heading
 * @property heading-xs - Extra-small heading
 * @property body-lg - Large body text
 * @property body-md - Medium body text (default)
 * @property body-sm - Small body text
 * @property label-md - Medium form label / metric label
 * @property label-sm - Small form label / metric label
 * @property caption - Caption / footnote
 * @property overline - Overline / eyebrow
 * @property code-sm - Small code / token
 * @property code-md - Medium code / token
 * @property mono-kpi - KPI numeric — mono + tabular-nums + display sizing
 */
export const TextStyleType = VariantType({
    "display-lg": NullType,
    "display-md": NullType,
    "display-sm": NullType,
    "heading-lg": NullType,
    "heading-md": NullType,
    "heading-sm": NullType,
    "heading-xs": NullType,
    "body-lg": NullType,
    "body-md": NullType,
    "body-sm": NullType,
    "label-md": NullType,
    "label-sm": NullType,
    caption: NullType,
    overline: NullType,
    "code-sm": NullType,
    "code-md": NullType,
    "mono-kpi": NullType,
});

/**
 * Type representing text style variant values.
 */
export type TextStyleType = typeof TextStyleType;

/**
 * String literal type for text style values.
 */
export type TextStyleLiteral =
    | "display-lg" | "display-md" | "display-sm"
    | "heading-lg" | "heading-md" | "heading-sm" | "heading-xs"
    | "body-lg" | "body-md" | "body-sm"
    | "label-md" | "label-sm"
    | "caption" | "overline"
    | "code-sm" | "code-md"
    | "mono-kpi";

/**
 * Creates a text style variant expression.
 *
 * @param style - The text style token
 * @returns An East expression representing the text style
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.TextStyle("mono-kpi");
 * ```
 */
export function TextStyle(style: TextStyleLiteral): ExprType<TextStyleType> {
    return East.value(variant(style, null), TextStyleType);
}
