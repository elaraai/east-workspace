/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    Size, SizeType,
    ColorScheme, ColorSchemeType,
    StyleVariant, StyleVariantType,
} from "./scheme.js";
import {
    ColorToken, ColorTokenType, ColorShadeType,
} from "./color.js";
import {
    FontWeight, FontWeightType,
    FontStyle, FontStyleType,
    TextAlign, TextAlignType,
    TextTransform, TextTransformType,
    VerticalAlign, VerticalAlignType,
    TextOverflow, TextOverflowType,
    WhiteSpace, WhiteSpaceType,
    TextDecoration, TextDecorationType,
    FontFamily, FontFamilyType,
    FontVariantNumeric, FontVariantNumericType,
    TextStyle, TextStyleType,
} from "./typography.js";
import {
    Orientation, OrientationType,
    FlexDirection, FlexDirectionType,
    JustifyContent, JustifyContentType,
    AlignItems, AlignItemsType,
    FlexWrap, FlexWrapType,
    Display, DisplayType,
    Overflow, OverflowType,
    Position, PositionType,
    Cursor, CursorType,
} from "./layout.js";
import {
    BorderWidth, BorderWidthType,
    BorderStyle, BorderStyleType,
    Radius, RadiusType,
    BoxShadow, BoxShadowType,
    ZIndexToken, ZIndexTokenType,
    Elevation, ElevationType,
} from "./visual.js";
import {
    AnimationPreset, AnimationPresetType,
    MotionDuration, MotionDurationType,
    MotionEasing, MotionEasingType,
    Transition, TransitionType,
} from "./motion.js";
import {
    Density, DensityType,
    Verbosity, VerbosityType,
    FocusStyle, FocusStyleType,
    HoverIntent, HoverIntentType,
    StatusToken, StatusTokenType,
} from "./interaction.js";
import {
    Align, AlignType,
    LabelInputType,
} from "./content.js";

/**
 * Style namespace providing convenient access to all styling functions.
 *
 * @remarks
 * This namespace groups all style variant creation functions for easy access.
 * Each function creates a typed variant expression for use in component styling.
 *
 * Tokens are grouped into seven category files under `src/style/`:
 * - **scheme** — the per-component triple (Size, ColorScheme, StyleVariant).
 * - **color** — the typed colour an app gives for a data fill: `ColorToken`, a theme hue at a shade (#1406).
 * - **typography** — font weight / style / family / variant-numeric / text align / transform / decoration / overflow / white-space / vertical-align, plus the semantic `TextStyleType`.
 * - **layout** — flex / grid / display / overflow / position / cursor.
 * - **visual** — border / radius / shadow / z-index / elevation.
 * - **motion** — animation preset + motion duration / easing / transition.
 * - **interaction** — density / verbosity / focus style / hover intent / status token.
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * // Scheme
 * Style.Size("md");
 * Style.ColorScheme("success");       // semantic palette
 * Style.StyleVariant("solid");
 * Style.ColorToken("teal", "500");    // a theme hue at a shade — a shift's colour, a series'
 *
 * // Typography
 * Style.FontWeight("bold");
 * Style.TextStyle("mono-kpi");
 *
 * // Visual
 * Style.BoxShadow("md");
 * Style.Elevation("overlay");
 *
 * // Motion
 * Style.AnimationPreset("pulse");
 *
 * // Interaction
 * Style.Density("compact");
 * Style.StatusToken("success");
 * ```
 */
export const Style = {
    // Scheme
    Size,
    ColorScheme,
    StyleVariant,
    // Color
    ColorToken,
    // Typography
    FontWeight,
    FontStyle,
    TextAlign,
    TextTransform,
    VerticalAlign,
    TextOverflow,
    WhiteSpace,
    TextDecoration,
    FontFamily,
    FontVariantNumeric,
    TextStyle,
    // Layout
    Orientation,
    FlexDirection,
    JustifyContent,
    AlignItems,
    FlexWrap,
    Display,
    Overflow,
    Position,
    Cursor,
    // Visual
    BorderWidth,
    BorderStyle,
    Radius,
    BoxShadow,
    ZIndexToken,
    Elevation,
    // Motion
    AnimationPreset,
    MotionDuration,
    MotionEasing,
    Transition,
    // Interaction
    Density,
    Verbosity,
    FocusStyle,
    HoverIntent,
    StatusToken,
    // Content
    Align,
    Types: {
        // Scheme
        Size: SizeType,
        ColorScheme: ColorSchemeType,
        StyleVariant: StyleVariantType,
        // Color
        ColorToken: ColorTokenType,
        ColorShade: ColorShadeType,
        // Typography
        FontWeight: FontWeightType,
        FontStyle: FontStyleType,
        TextAlign: TextAlignType,
        TextTransform: TextTransformType,
        VerticalAlign: VerticalAlignType,
        TextOverflow: TextOverflowType,
        WhiteSpace: WhiteSpaceType,
        TextDecoration: TextDecorationType,
        FontFamily: FontFamilyType,
        FontVariantNumeric: FontVariantNumericType,
        TextStyle: TextStyleType,
        // Layout
        Orientation: OrientationType,
        FlexDirection: FlexDirectionType,
        JustifyContent: JustifyContentType,
        AlignItems: AlignItemsType,
        FlexWrap: FlexWrapType,
        Display: DisplayType,
        Overflow: OverflowType,
        Position: PositionType,
        Cursor: CursorType,
        // Visual
        BorderWidth: BorderWidthType,
        BorderStyle: BorderStyleType,
        Radius: RadiusType,
        BoxShadow: BoxShadowType,
        ZIndexToken: ZIndexTokenType,
        Elevation: ElevationType,
        // Motion
        AnimationPreset: AnimationPresetType,
        MotionDuration: MotionDurationType,
        MotionEasing: MotionEasingType,
        Transition: TransitionType,
        // Interaction
        Density: DensityType,
        Verbosity: VerbosityType,
        FocusStyle: FocusStyleType,
        HoverIntent: HoverIntentType,
        StatusToken: StatusTokenType,
        // Content
        Align: AlignType,
        LabelInput: LabelInputType,
    },
} as const;
