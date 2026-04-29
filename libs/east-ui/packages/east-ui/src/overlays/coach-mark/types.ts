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

import { PlacementType, type PlacementLiteral } from "../tooltip/types.js";

// ============================================================================
// CoachMark Style
// ============================================================================

/**
 * East StructType holding visual fields for `CoachMark`.
 *
 * @remarks
 * Visual-only sub-struct attached to the `CoachMark` main type via
 * `style: OptionType(CoachMarkStyleType)`. The `placement` field
 * controls which side of the wrapped target the popover anchors
 * against; the colour fields override Chakra Popover defaults for
 * branded surfaces.
 *
 * @property placement - Anchor placement around the target (`top` / `right` / `bottom` / `left` plus `-start`/`-end` variants)
 * @property background - Explicit popover background colour
 * @property borderColor - Explicit popover border colour
 * @property arrowColor - Explicit arrow fill colour
 */
export const CoachMarkStyleType = StructType({
    placement: OptionType(PlacementType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    arrowColor: OptionType(StringType),
});

/**
 * Type alias for the CoachMark style struct.
 */
export type CoachMarkStyleType = typeof CoachMarkStyleType;

/**
 * TypeScript interface for `CoachMark` style options accepted by the
 * factory.
 *
 * @remarks
 * `placement` accepts a string literal (`"top"`, `"right-start"`,
 * etc.) or an East variant expression; the colour fields accept any
 * Chakra theme token, semantic token, or raw CSS string.
 *
 * @property placement - Anchor placement around the target
 * @property background - Explicit popover background colour
 * @property borderColor - Explicit popover border colour
 * @property arrowColor - Explicit arrow fill colour
 */
export interface CoachMarkStyle {
    /** Optional storage key — when set, the mark dismisses permanently after first acknowledgement. */
    showOnce?: SubtypeExprOrValue<StringType>;
    /** Whether the dismiss button is shown (defaults to true). */
    dismissible?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired when the mark is dismissed. */
    onDismiss?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Anchor placement around the target. */
    placement?: SubtypeExprOrValue<PlacementType> | PlacementLiteral;
    /** Explicit popover background colour. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit popover border colour. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit arrow fill colour. */
    arrowColor?: SubtypeExprOrValue<StringType>;
}
