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
    StringType,
    FunctionType,
    variant,
} from "@elaraai/east";

import {
    ColorSchemeType,
    OrientationType,
    type ColorSchemeLiteral,
    type OrientationLiteral,
} from "../../style.js";

// ============================================================================
// Tabs Variant Type
// ============================================================================

/**
 * Variant types for Tabs visual style.
 *
 * @property line - Tabs with an underline indicator
 * @property subtle - Light background on selected tab
 * @property enclosed - Tabs with bordered container
 * @property outline - Outlined tabs
 * @property plain - No visible styling
 */
export const TabsVariantType = VariantType({
    line: NullType,
    subtle: NullType,
    enclosed: NullType,
    outline: NullType,
    plain: NullType,
});

/**
 * Type representing the TabsVariant structure.
 */
export type TabsVariantType = typeof TabsVariantType;

/**
 * String literal type for tabs variant values.
 */
export type TabsVariantLiteral = "line" | "subtle" | "enclosed" | "outline" | "plain";

/**
 * Helper function to create tabs variant values.
 *
 * @param v - The variant string
 * @returns An East expression representing the tabs variant
 */
export function TabsVariant(v: TabsVariantLiteral): ExprType<TabsVariantType> {
    return East.value(variant(v, null), TabsVariantType);
}

// ============================================================================
// Tabs Justify Type
// ============================================================================

/**
 * Justify options for tab list alignment.
 *
 * @property start - Align tabs to the start
 * @property center - Center the tabs
 * @property end - Align tabs to the end
 */
export const TabsJustifyType = VariantType({
    start: NullType,
    center: NullType,
    end: NullType,
});

/**
 * Type representing the TabsJustify structure.
 */
export type TabsJustifyType = typeof TabsJustifyType;

/**
 * String literal type for tabs justify values.
 */
export type TabsJustifyLiteral = "start" | "center" | "end";

// ============================================================================
// Tabs Activation Mode Type
// ============================================================================

/**
 * Activation mode for keyboard navigation.
 *
 * @property automatic - Tab activates on focus
 * @property manual - Tab requires explicit activation
 */
export const TabsActivationModeType = VariantType({
    automatic: NullType,
    manual: NullType,
});

/**
 * Type representing the TabsActivationMode structure.
 */
export type TabsActivationModeType = typeof TabsActivationModeType;

/**
 * String literal type for tabs activation mode values.
 */
export type TabsActivationModeLiteral = "automatic" | "manual";

// ============================================================================
// Tabs Size Type
// ============================================================================

/**
 * Size options for Tabs component.
 *
 * @remarks
 * Chakra UI Tabs only supports sm, md, lg sizes (not xs).
 *
 * @property sm - Small tabs
 * @property md - Medium tabs (default)
 * @property lg - Large tabs
 */
export const TabsSizeType = VariantType({
    sm: NullType,
    md: NullType,
    lg: NullType,
});

/**
 * Type representing the TabsSize structure.
 */
export type TabsSizeType = typeof TabsSizeType;

/**
 * String literal type for tabs size values.
 */
export type TabsSizeLiteral = "sm" | "md" | "lg";

// ============================================================================
// Tabs Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Tabs. Content (`items`), state (`value`,
 * `defaultValue`), and behaviour (`onValueChange`) live on the main `Tabs`
 * variant (inline in `component.ts` because of the item `trigger: node`
 * field) per the Type-shape convention (§0.10).
 *
 * @remarks
 * Holds visual + geometric presets plus per-slot colour escape hatches for
 * the tab list background, active-tab indicator, active / inactive trigger
 * colour, and content background.
 *
 * @property variant - Visual variant (line / subtle / enclosed / outline / plain)
 * @property size - Size token (sm / md / lg)
 * @property orientation - Layout direction (horizontal / vertical)
 * @property activationMode - Keyboard activation behaviour (automatic / manual)
 * @property fitted - Whether triggers expand to equal width
 * @property justify - Tab list alignment (start / center / end)
 * @property lazyMount - Mount content only when selected
 * @property unmountOnExit - Unmount content when deselected
 * @property colorPalette - Colour scheme for theming
 * @property listBackground - Tab list background colour
 * @property indicatorColor - Active-tab indicator colour
 * @property activeTriggerColor - Active trigger text colour
 * @property inactiveTriggerColor - Inactive trigger text colour
 * @property contentBackground - Selected-panel content background
 */
export const TabsStyleType = StructType({
    variant: OptionType(TabsVariantType),
    size: OptionType(TabsSizeType),
    orientation: OptionType(OrientationType),
    activationMode: OptionType(TabsActivationModeType),
    fitted: OptionType(BooleanType),
    justify: OptionType(TabsJustifyType),
    lazyMount: OptionType(BooleanType),
    unmountOnExit: OptionType(BooleanType),
    colorPalette: OptionType(ColorSchemeType),
    listBackground: OptionType(StringType),
    indicatorColor: OptionType(StringType),
    activeTriggerColor: OptionType(StringType),
    inactiveTriggerColor: OptionType(StringType),
    contentBackground: OptionType(StringType),
});

/**
 * Type representing the Tabs visual-style structure.
 */
export type TabsStyleType = typeof TabsStyleType;

// ============================================================================
// Style Interfaces
// ============================================================================

/**
 * TypeScript options bag for Tabs's `style` sub-struct — visual props only.
 *
 * @remarks
 * State (`value` / `defaultValue`) and behaviour (`onValueChange`) live on
 * the main options object passed to `Tabs.Root`, not here.
 */
export interface TabsStyle {
    /** Visual variant (line / subtle / enclosed / outline / plain) */
    variant?: SubtypeExprOrValue<TabsVariantType> | TabsVariantLiteral;
    /** Size of the tabs (sm / md / lg) */
    size?: SubtypeExprOrValue<TabsSizeType> | TabsSizeLiteral;
    /** Layout direction */
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    /** Keyboard activation behaviour */
    activationMode?: SubtypeExprOrValue<TabsActivationModeType> | TabsActivationModeLiteral;
    /** Whether triggers expand to equal width */
    fitted?: SubtypeExprOrValue<BooleanType>;
    /** Tab list alignment */
    justify?: SubtypeExprOrValue<TabsJustifyType> | TabsJustifyLiteral;
    /** Mount content only when selected */
    lazyMount?: SubtypeExprOrValue<BooleanType>;
    /** Unmount content when deselected */
    unmountOnExit?: SubtypeExprOrValue<BooleanType>;
    /** Colour scheme for theming */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Tab list background */
    listBackground?: SubtypeExprOrValue<StringType>;
    /** Active-tab indicator colour */
    indicatorColor?: SubtypeExprOrValue<StringType>;
    /** Active trigger text colour */
    activeTriggerColor?: SubtypeExprOrValue<StringType>;
    /** Inactive trigger text colour */
    inactiveTriggerColor?: SubtypeExprOrValue<StringType>;
    /** Selected-panel content background */
    contentBackground?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `Tabs.Item`.
 *
 * @property disabled - Whether this tab is disabled
 */
export interface TabsItemOptions {
    /** Whether this tab is disabled — renderer blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
}

/**
 * TypeScript options bag for `Tabs.Root`.
 *
 * @remarks
 * State (`value` / `defaultValue`) and behaviour (`onValueChange`) live at
 * the top level. Visual presentation lives inside the nested `style` object.
 *
 * @property value - Controlled selected tab value
 * @property defaultValue - Initial selected tab value (uncontrolled)
 * @property onValueChange - Callback invoked with the new selected tab value
 * @property style - Visual-presentation sub-struct
 */
export interface TabsOptions {
    /** Controlled selected tab value */
    value?: SubtypeExprOrValue<StringType>;
    /** Initial selected tab value (uncontrolled) */
    defaultValue?: SubtypeExprOrValue<StringType>;
    /** Callback invoked with the new selected tab value */
    onValueChange?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Visual-presentation sub-struct */
    style?: TabsStyle;
}
