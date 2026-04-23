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
    FunctionType,
    NullType,
} from "@elaraai/east";

// ============================================================================
// Collapsible Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Collapsible. Content (`trigger` / `content`),
 * state (`defaultOpen`), and behaviour (`onOpenChange`) live on the main
 * `Collapsible` variant (inline in `component.ts`) per the Type-shape
 * convention (§0.10).
 *
 * @property background - Container background colour
 * @property borderColor - Container border colour
 * @property triggerColor - Trigger text colour
 * @property contentColor - Content text colour
 */
export const CollapsibleStyleType = StructType({
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    triggerColor: OptionType(StringType),
    contentColor: OptionType(StringType),
});

/**
 * Type representing the Collapsible visual-style structure.
 */
export type CollapsibleStyleType = typeof CollapsibleStyleType;

/**
 * TypeScript options bag for Collapsible's `style` sub-struct — visual props only.
 */
export interface CollapsibleStyle {
    /** Container background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Container border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Trigger text colour */
    triggerColor?: SubtypeExprOrValue<StringType>;
    /** Content text colour */
    contentColor?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `Collapsible.Root`.
 *
 * @property defaultOpen - Whether the collapsible starts expanded
 * @property onOpenChange - Callback invoked with the new open state
 * @property style - Visual-presentation sub-struct
 */
export interface CollapsibleOptions {
    /** Whether the collapsible starts expanded */
    defaultOpen?: SubtypeExprOrValue<BooleanType>;
    /** Callback invoked with the new open state */
    onOpenChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
    /** Visual-presentation sub-struct */
    style?: CollapsibleStyle;
}
