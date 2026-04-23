/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East UI style tokens — raw CSS-level variants plus the semantic layer.
 *
 * @remarks
 * Tokens live under `src/style/` by category and are re-exported from this
 * barrel so downstream component types can keep using `from "../../style.js"`
 * imports:
 *
 * - `src/style/scheme.ts` — per-component scheme triple: `Size`,
 *   `ColorScheme` (hue + semantic), `StyleVariant`.
 * - `src/style/typography.ts` — `FontWeight`, `FontStyle`, `TextAlign`,
 *   `TextTransform`, `VerticalAlign`, `TextOverflow`, `WhiteSpace`,
 *   `TextDecoration`, `FontFamily`, `FontVariantNumeric`, and the semantic
 *   `TextStyleType`.
 * - `src/style/layout.ts` — `Orientation`, `FlexDirection`, `JustifyContent`,
 *   `AlignItems`, `FlexWrap`, `Display`, `Overflow`, `Position`, `Cursor`.
 * - `src/style/visual.ts` — `BorderWidth`, `BorderStyle`, `Radius`,
 *   `BoxShadow`, `ZIndexToken`, and the semantic `ElevationType`.
 * - `src/style/motion.ts` — `AnimationPreset`, `MotionDuration`,
 *   `MotionEasing`, `Transition`.
 * - `src/style/interaction.ts` — `Density`, `Verbosity`, `FocusStyle`,
 *   `HoverIntent`, `StatusToken`.
 *
 * The {@link Style} namespace groups the creator helpers + `Style.Types` for
 * discoverability.
 *
 * @packageDocumentation
 */

export * from "./style/scheme.js";
export * from "./style/typography.js";
export * from "./style/layout.js";
export * from "./style/visual.js";
export * from "./style/motion.js";
export * from "./style/interaction.js";
export { Style } from "./style/namespace.js";
