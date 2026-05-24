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
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// Checkbox Style
// ============================================================================

/**
 * East StructType holding visual fields for `Checkbox`.
 *
 * @remarks
 * `colorPalette` / `size` are visual presets; `fillColor` /
 * `checkColor` / `borderColor` are explicit colour overrides for
 * branded surfaces (override the palette-derived defaults).
 *
 * @property colorPalette - Chakra colour palette for the checked-state fill
 * @property size - Checkbox size (`xs` / `sm` / `md` / `lg`)
 * @property fillColor - Explicit fill colour for the checked-state box
 * @property checkColor - Explicit colour of the tick glyph
 * @property borderColor - Explicit border colour for the unchecked box
 */
export const CheckboxStyleType = StructType({
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    fillColor: OptionType(StringType),
    checkColor: OptionType(StringType),
    borderColor: OptionType(StringType),
});

/**
 * Type alias for the `Checkbox` style struct.
 */
export type CheckboxStyleType = typeof CheckboxStyleType;

/**
 * TypeScript interface for `Checkbox` style options accepted by the
 * factory.
 *
 * @remarks
 * Visual presets accept either East variant expressions or string
 * literals (`"blue"`, `"md"`); colour escape hatches accept any
 * theme-token / hex / rgba string. Content + state + behaviour fields
 * sit alongside the visual fields here so the factory call site stays
 * flat.
 *
 * @property label - Optional label text displayed next to the checkbox
 * @property indeterminate - Whether to show indeterminate state (partial selection)
 * @property disabled - Whether the checkbox is disabled
 * @property onChange - Callback fired with the new checked value
 * @property colorPalette - Chakra colour palette for the checked-state fill
 * @property size - Checkbox size
 * @property fillColor - Explicit fill colour for the checked-state box
 * @property checkColor - Explicit colour of the tick glyph
 * @property borderColor - Explicit border colour
 */
export interface CheckboxStyle {
    /** Optional label text displayed next to the checkbox. */
    label?: SubtypeExprOrValue<StringType>;
    /** Whether to show indeterminate state (partial selection). */
    indeterminate?: SubtypeExprOrValue<BooleanType>;
    /** Whether the checkbox is disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired with the new checked value. */
    onChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
    /** Chakra colour palette for the checked-state fill. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Checkbox size (`xs` / `sm` / `md` / `lg`). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit fill colour for the checked-state box. */
    fillColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour of the tick glyph. */
    checkColor?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour for the unchecked box. */
    borderColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// Checkbox Type
// ============================================================================

/**
 * East StructType for `Checkbox` — boolean form control with optional
 * label and indeterminate mode.
 *
 * @remarks
 * Content (`label`) + state (`checked` / `indeterminate` / `disabled`)
 * + behaviour (`onChange`) live on the main struct; all visual fields
 * live inside `style: OptionType(CheckboxStyleType)`.
 *
 * @property checked - Whether the checkbox is checked
 * @property label - Optional label text displayed next to the checkbox
 * @property indeterminate - Whether to show indeterminate state (partial selection)
 * @property disabled - Whether the checkbox is disabled
 * @property onChange - Callback fired with the new checked value
 * @property style - Optional visual style sub-struct
 */
export const CheckboxType = StructType({
    checked: BooleanType,
    label: OptionType(StringType),
    indeterminate: OptionType(BooleanType),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([BooleanType], NullType)),
    style: OptionType(CheckboxStyleType),
});

/**
 * Type alias for the Checkbox struct.
 */
export type CheckboxType = typeof CheckboxType;
