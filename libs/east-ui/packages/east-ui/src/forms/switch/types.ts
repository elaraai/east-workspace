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
// Switch Style
// ============================================================================

/**
 * East StructType holding visual fields for `Switch`.
 *
 * @remarks
 * `colorPalette` / `size` are visual presets; `onColor` / `offColor` /
 * `thumbColor` are explicit colour overrides for branded surfaces
 * (override the palette-derived defaults).
 *
 * @property colorPalette - Chakra colour palette for the on-state track
 * @property size - Switch size (`xs` / `sm` / `md` / `lg`)
 * @property onColor - Explicit track colour when on
 * @property offColor - Explicit track colour when off
 * @property thumbColor - Explicit colour of the thumb knob
 */
export const SwitchStyleType = StructType({
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    onColor: OptionType(StringType),
    offColor: OptionType(StringType),
    thumbColor: OptionType(StringType),
});

/**
 * Type alias for the `Switch` style struct.
 */
export type SwitchStyleType = typeof SwitchStyleType;

/**
 * TypeScript interface for `Switch` style options accepted by the
 * factory.
 *
 * @property label - Optional label text displayed next to the switch
 * @property disabled - Whether the switch is disabled
 * @property onChange - Callback fired with the new checked value
 * @property colorPalette - Chakra colour palette for the on-state track
 * @property size - Switch size
 * @property onColor - Explicit track colour when on
 * @property offColor - Explicit track colour when off
 * @property thumbColor - Explicit colour of the thumb knob
 */
export interface SwitchStyle {
    /** Optional label text displayed next to the switch. */
    label?: SubtypeExprOrValue<StringType>;
    /** Whether the switch is disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired with the new checked value. */
    onChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
    /** Chakra colour palette for the on-state track. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Switch size (`xs` / `sm` / `md` / `lg`). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit track colour when on. */
    onColor?: SubtypeExprOrValue<StringType>;
    /** Explicit track colour when off. */
    offColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour of the thumb knob. */
    thumbColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// Switch Type
// ============================================================================

/**
 * East StructType for `Switch` — boolean toggle control with optional
 * label.
 *
 * @remarks
 * Content (`label`) + state (`checked` / `disabled`) + behaviour
 * (`onChange`) live on main; visual presets and colour escape hatches
 * live inside `style: OptionType(SwitchStyleType)`. Distinct from
 * `Checkbox` — `Switch` is for immediate-effect toggles (settings,
 * feature flags) rather than form selections.
 *
 * @property checked - Whether the switch is on
 * @property label - Optional label text displayed next to the switch
 * @property disabled - Whether the switch is disabled
 * @property onChange - Callback fired with the new checked value
 * @property style - Optional visual style sub-struct
 */
export const SwitchType = StructType({
    checked: BooleanType,
    label: OptionType(StringType),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([BooleanType], NullType)),
    style: OptionType(SwitchStyleType),
});

/**
 * Type alias for the Switch struct.
 */
export type SwitchType = typeof SwitchType;
