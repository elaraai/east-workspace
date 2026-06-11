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
} from "@elaraai/east";

// ============================================================================
// ButtonGroup Style Type
// ============================================================================

/**
 * Visual-only style struct for ButtonGroup. Content (`buttons`) lives on the
 * main `ButtonGroup` variant — defined inline in `component.ts` because
 * 
 *
 * @remarks
 * **Chakra v3's `<Group>` does NOT propagate `size`/`variant`/`colorPalette`
 * to descendants** — those must be set on each child Button explicitly.
 * This struct therefore only carries the group-level visuals that Group
 * *does* accept: `attached` (shared-border layout), `gap` (spacing between
 * non-attached children), and a group-level `borderColor` override.
 *
 * @property attached - When true, children render as a joined row with shared borders
 * @property gap - Spacing between children when not attached (Chakra spacing token)
 * @property borderColor - Shared border colour for attached groups
 */
export const ButtonGroupStyleType = StructType({
    attached: OptionType(BooleanType),
    gap: OptionType(StringType),
    borderColor: OptionType(StringType),
});

/**
 * Type representing the ButtonGroup visual-style structure.
 */
export type ButtonGroupStyleType = typeof ButtonGroupStyleType;

/**
 * TypeScript options bag for ButtonGroup's `style` sub-struct — visual props only.
 *
 * @remarks
 * Set `variant` / `size` / `colorPalette` on each child Button — Chakra's
 * `<Group>` does not propagate those to descendants.
 */
export interface ButtonGroupStyle {
    /** Join children into an attached row with shared borders */
    attached?: SubtypeExprOrValue<BooleanType>;
    /** Spacing between children when not attached */
    gap?: SubtypeExprOrValue<StringType>;
    /** Shared border colour for attached groups */
    borderColor?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `ButtonGroup.Root` — a single flat bag of visual
 * fields (alias of {@link ButtonGroupStyle}; ButtonGroup has no behaviour/state).
 */
export type ButtonGroupOptions = ButtonGroupStyle;
