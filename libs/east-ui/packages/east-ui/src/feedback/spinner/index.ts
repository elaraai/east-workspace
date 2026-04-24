/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    OptionType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType, ColorSchemeType } from "../../style.js";
import {
    SpinnerType,
    SpinnerStyleType,
    type SpinnerStyle,
} from "./types.js";

// Re-export types
export {
    SpinnerType,
    SpinnerStyleType,
    type SpinnerStyle,
} from "./types.js";

// ============================================================================
// Spinner Root Factory
// ============================================================================

/**
 * TypeScript options bag for `Spinner.Root`.
 *
 * @property style - Optional visual-only style
 */
export interface SpinnerOptions {
    /** Optional visual-only style */
    style?: SpinnerStyle;
}

/**
 * Creates a Spinner — a purely visual loading affordance.
 *
 * @param options - Optional `style`
 * @returns An East expression representing the Spinner component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Spinner, UIComponentType } from "@elaraai/east-ui";
 *
 * const loading = East.function([], UIComponentType, _$ =>
 *     Spinner.Root({ style: { size: "md", colorPalette: "blue" } }),
 * );
 * ```
 */
function createSpinnerRoot(options?: SpinnerOptions): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildSpinnerStyle(options.style) : undefined;
    return East.value(variant("Spinner", {
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildSpinnerStyle(style: SpinnerStyle): ExprType<SpinnerStyleType> {
    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;
    const colorPaletteValue = style.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        thickness: style.thickness !== undefined ? some(style.thickness) : none,
        speed: style.speed !== undefined ? some(style.speed) : none,
        color: style.color !== undefined ? some(style.color) : none,
        trackColor: style.trackColor !== undefined ? some(style.trackColor) : none,
    }, SpinnerStyleType);
}

// Unused import guard
void OptionType;

/**
 * Spinner primitive — visual loading affordance.
 *
 * @remarks
 * Use as a leaf loading indicator; prefer `Skeleton` for content-shape
 * placeholders and `Progress` / `ProgressCircle` when you have an ETA.
 */
export const Spinner = {
    /**
     * Creates a Spinner.
     *
     * @param options - Optional `style`
     *
     * @example
     * ```ts
     * Spinner.Root({ style: { size: "lg" } });
     * ```
     */
    Root: createSpinnerRoot,
    Types: {
        /**
         * East StructType for a Spinner value — the serialisable IR shape.
         *
         * @remarks
         * Mirror of `SpinnerType` from `./types.js`. Spinner has no content
         * or state fields — the main struct is effectively just the
         * `style` wrapper. Exposed on the namespace so consumers can
         * reference the IR type via `Spinner.Types.Spinner` without
         * reaching into module internals.
         *
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Spinner: SpinnerType,
        /**
         * East StructType holding every visual field for a Spinner.
         *
         * @remarks
         * Mirror of `SpinnerStyleType` from `./types.js`. Covers the size
         * preset, palette, stroke configuration, rotation period, and the
         * two colour slots (active + track).
         *
         * @property size - Size preset (sm / md / lg)
         * @property colorPalette - Chakra colour palette token
         * @property thickness - Stroke width
         * @property speed - Rotation period (e.g. `"0.65s"`)
         * @property color - Active stroke colour
         * @property trackColor - Faint background ring colour
         */
        Style: SpinnerStyleType,
    },
} as const;
