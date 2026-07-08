/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BooleanType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

/**
 * Style configuration for Expandable components.
 *
 * @property zIndex - Stacking level of the expanded surface. Default 900 —
 *   above typical host chrome, below every Chakra floating tier (dropdown
 *   1000 … tooltip 1800) so overlays raised inside the region stack above it
 * @property background - Background of the expanded surface. Default `bg.canvas`
 */
export const ExpandableStyleType = StructType({
    zIndex: OptionType(IntegerType),
    background: OptionType(StringType),
});

export type ExpandableStyleType = typeof ExpandableStyleType;

/**
 * TypeScript style interface for {@link ExpandableStyleType}.
 */
export interface ExpandableStyle {
    /** Stacking level of the expanded surface (default 900 — below Chakra floating tiers). */
    zIndex?: SubtypeExprOrValue<IntegerType>;
    /** Background of the expanded surface (default `bg.canvas`). */
    background?: SubtypeExprOrValue<StringType>;
}

/**
 * Expandable options — passed to `Expandable.Root(content, opts)`.
 */
export interface ExpandableOptions extends ExpandableStyle {
    /**
     * Expanded state. Synced on change (forms convention), so a
     * `State.bind`-driven value controls the region reactively; omit for
     * purely local toggling via the built-in control.
     */
    expanded?: SubtypeExprOrValue<BooleanType>;
    /** Callback invoked with the new expanded state when the user toggles. */
    onExpandedChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
    /** Accessible name for the toggle control ("Expand ‹label›" / "Collapse ‹label›"). */
    label?: SubtypeExprOrValue<StringType>;
}
