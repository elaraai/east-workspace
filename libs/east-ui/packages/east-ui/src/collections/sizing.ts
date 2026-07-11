/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared factory encoding for the uniform data-component sizing contract (#320).
 *
 * Every data component ({@link Table}, {@link Chart}, {@link Planner},
 * {@link Gantt}, {@link Matrix}, {@link Library}, {@link Board}, {@link Roster},
 * {@link Calendar}, {@link Schematic}) accepts the same authoring surface:
 *
 * - `height`: a pixel `number`, the string `"fill"` (occupy the parent box —
 *   the parent must have a definite height), or a raw CSS length / East
 *   expression.
 * - `maxHeight`: a pixel `number` or a raw CSS length / East expression.
 *
 * Both are stored uniformly as `OptionType(StringType)`: a number becomes
 * `"<n>px"`, `"fill"` is carried through as the renderer's fill sentinel, and a
 * string / expression passes through unchanged. This keeps one authoring
 * surface across components whose IR height field was historically a bare CSS
 * string.
 */

import { type SubtypeExprOrValue, StringType, variant } from "@elaraai/east";

/** The authoring type for a component `height`: px number, `"fill"`, or CSS/expr. */
export type SizeHeightInput = number | "fill" | SubtypeExprOrValue<StringType>;
/** The authoring type for a component `maxHeight`: px number or CSS/expr. */
export type SizeMaxHeightInput = number | SubtypeExprOrValue<StringType>;

/**
 * Encodes a `height` authoring value into the `OptionType(StringType)` arm the
 * component struct stores: a number → `"<n>px"`, `"fill"` and CSS strings /
 * expressions pass through, `undefined` → the `none` arm.
 *
 * @param height - the authored height (number, `"fill"`, CSS length, or expression)
 * @returns the `some` / `none` variant value for the struct field
 */
export function encodeHeightOption(height: SizeHeightInput | undefined) {
    if (height === undefined) return variant("none", null);
    return variant("some", typeof height === "number" ? `${height}px` : height);
}

/**
 * Encodes a `maxHeight` authoring value into the `OptionType(StringType)` arm:
 * a number → `"<n>px"`, CSS strings / expressions pass through, `undefined` →
 * the `none` arm.
 *
 * @param maxHeight - the authored max-height (number, CSS length, or expression)
 * @returns the `some` / `none` variant value for the struct field
 */
export function encodeMaxHeightOption(maxHeight: SizeMaxHeightInput | undefined) {
    if (maxHeight === undefined) return variant("none", null);
    return variant("some", typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight);
}
