/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Density (semantic)
// ============================================================================

/**
 * Density variant type for information-density context.
 *
 * @remarks
 * Create instances using the {@link Density} function. Inherited via
 * `DensityProvider` through `Box`/`Flex`/`Stack`/`Grid`; consumed by `Table`,
 * `DataList`, `StatCard`, `MetricRail`, `AssumptionsBar`, `FilterBar`, …
 * Per-component override always wins over the inherited value.
 *
 * @property comfortable - Presentation / landing density (default)
 * @property compact - Data-dense tables / forms
 * @property condensed - Very dense (mission-control / trading)
 */
export const DensityType = VariantType({
    comfortable: NullType,
    compact: NullType,
    condensed: NullType,
});

/**
 * Type representing density variant values.
 */
export type DensityType = typeof DensityType;

/**
 * String literal type for density values.
 */
export type DensityLiteral = "comfortable" | "compact" | "condensed";

/**
 * Creates a density variant expression.
 *
 * @param density - The density token
 * @returns An East expression representing the density
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Density("compact");
 * ```
 */
export function Density(density: DensityLiteral): ExprType<DensityType> {
    return East.value(variant(density, null), DensityType);
}

// ============================================================================
// Verbosity (semantic)
// ============================================================================

/**
 * Verbosity variant type for narrative-vs-data ratio.
 *
 * @remarks
 * Create instances using the {@link Verbosity} function. Inherited alongside
 * `DensityType`. Senior users pick `minimal`; onboarding users pick `detailed`.
 * Patterns consume verbosity to toggle rationale text, help bubbles, and
 * narrative notes. Per-component override always wins.
 *
 * @property minimal - Numbers-only, no narrative
 * @property standard - Default balance
 * @property detailed - Full rationale / help / annotations
 */
export const VerbosityType = VariantType({
    minimal: NullType,
    standard: NullType,
    detailed: NullType,
});

/**
 * Type representing verbosity variant values.
 */
export type VerbosityType = typeof VerbosityType;

/**
 * String literal type for verbosity values.
 */
export type VerbosityLiteral = "minimal" | "standard" | "detailed";

/**
 * Creates a verbosity variant expression.
 *
 * @param verbosity - The verbosity token
 * @returns An East expression representing the verbosity
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Verbosity("detailed");
 * ```
 */
export function Verbosity(verbosity: VerbosityLiteral): ExprType<VerbosityType> {
    return East.value(variant(verbosity, null), VerbosityType);
}

// ============================================================================
// Focus Style (semantic)
// ============================================================================

/**
 * Focus style variant type for the focus-ring policy.
 *
 * @remarks
 * Create instances using the {@link FocusStyle} function. Every focusable
 * primitive references this token; the consumer's theme resolves to a
 * `{ ringWidth, ringOffset, ringColor }` triple. A single focus-ring policy
 * across the catalogue — see contract.
 *
 * @property default - Standard ring
 * @property emphasis - Higher-contrast ring (e.g. for editing cells)
 * @property subtle - Reduced ring (e.g. dense table rows)
 * @property none - No ring — only valid for non-keyboard-reachable surfaces
 */
export const FocusStyleType = VariantType({
    default: NullType,
    emphasis: NullType,
    subtle: NullType,
    none: NullType,
});

/**
 * Type representing focus style values.
 */
export type FocusStyleType = typeof FocusStyleType;

/**
 * String literal type for focus style values.
 */
export type FocusStyleLiteral = "default" | "emphasis" | "subtle" | "none";

/**
 * Creates a focus style variant expression.
 *
 * @param focus - The focus style token
 * @returns An East expression representing the focus style
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.FocusStyle("emphasis");
 * ```
 */
export function FocusStyle(focus: FocusStyleLiteral): ExprType<FocusStyleType> {
    return East.value(variant(focus, null), FocusStyleType);
}

// ============================================================================
// Hover Intent (semantic)
// ============================================================================

/**
 * Hover intent variant type for named hover-open delays.
 *
 * @remarks
 * Create instances using the {@link HoverIntent} function. All hover-to-open
 * primitives (`Tooltip`, `ToggleTip`, `HoverCard`, `Menu`-on-hover) share this
 * single token for consistent timing. The theme resolves each tag to an
 * `(openDelay, closeDelay)` pair — see contract.
 *
 * @property instant - No delay (0/0 ms)
 * @property brief - Short dwell (~100/50 ms)
 * @property standard - Default (~300/100 ms)
 * @property patient - Long dwell — only if content is expensive to render (~700/200 ms)
 */
export const HoverIntentType = VariantType({
    instant: NullType,
    brief: NullType,
    standard: NullType,
    patient: NullType,
});

/**
 * Type representing hover intent values.
 */
export type HoverIntentType = typeof HoverIntentType;

/**
 * String literal type for hover intent values.
 */
export type HoverIntentLiteral = "instant" | "brief" | "standard" | "patient";

/**
 * Creates a hover intent variant expression.
 *
 * @param intent - The hover intent token
 * @returns An East expression representing the hover intent
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.HoverIntent("standard");
 * ```
 */
export function HoverIntent(intent: HoverIntentLiteral): ExprType<HoverIntentType> {
    return East.value(variant(intent, null), HoverIntentType);
}

// ============================================================================
// Status Token (semantic)
// ============================================================================

/**
 * Status token variant type for the semantic-status palette.
 *
 * @remarks
 * Create instances using the {@link StatusToken} function. Used by `Alert`,
 * `Banner`, `Status`, `Badge` with semantic palette, `DeltaPill`, and
 * `Stat.indicator`. Every semantic-status surface auto-injects a paired icon
 * (see contract) so colour is never the only signal.
 *
 * @property success - On-track / passed / ok
 * @property warning - At-risk / needs attention
 * @property danger - Off-spec / failed / blocked
 * @property info - Informational / neutral callout
 * @property neutral - Idle / inactive / unknown
 */
export const StatusTokenType = VariantType({
    success: NullType,
    warning: NullType,
    danger: NullType,
    info: NullType,
    neutral: NullType,
});

/**
 * Type representing status token values.
 */
export type StatusTokenType = typeof StatusTokenType;

/**
 * String literal type for status token values.
 */
export type StatusTokenLiteral = "success" | "warning" | "danger" | "info" | "neutral";

/**
 * Creates a status token variant expression.
 *
 * @param status - The status token
 * @returns An East expression representing the status token
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.StatusToken("success");
 * ```
 */
export function StatusToken(status: StatusTokenLiteral): ExprType<StatusTokenType> {
    return East.value(variant(status, null), StatusTokenType);
}
