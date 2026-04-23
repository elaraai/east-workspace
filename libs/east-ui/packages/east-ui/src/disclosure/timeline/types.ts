/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
} from "@elaraai/east";

import { SizeType, OrientationType } from "../../style.js";
import type { SizeLiteral, OrientationLiteral } from "../../style.js";

// ============================================================================
// Timeline Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Timeline. Content (`items`) lives on the
 * main `Timeline` variant (inline in `component.ts`) per the Type-shape
 * convention (§0.10). Reuses `StepStatusType` with `Steps` for per-item
 * status.
 *
 * @property orientation - Layout direction (horizontal / vertical)
 * @property size - Size token (sm / md / lg)
 * @property connectorColor - Connector line colour between items
 * @property indicatorColor - Default indicator colour
 * @property pendingColor - Colour for pending items
 * @property activeColor - Colour for active items
 * @property completedColor - Colour for completed items
 * @property errorColor - Colour for error items
 * @property skippedColor - Colour for skipped items
 */
export const TimelineStyleType = StructType({
    orientation: OptionType(OrientationType),
    size: OptionType(SizeType),
    connectorColor: OptionType(StringType),
    indicatorColor: OptionType(StringType),
    pendingColor: OptionType(StringType),
    activeColor: OptionType(StringType),
    completedColor: OptionType(StringType),
    errorColor: OptionType(StringType),
    skippedColor: OptionType(StringType),
});

export type TimelineStyleType = typeof TimelineStyleType;

/**
 * TypeScript options bag for Timeline's `style` sub-struct — visual props only.
 */
export interface TimelineStyle {
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    connectorColor?: SubtypeExprOrValue<StringType>;
    indicatorColor?: SubtypeExprOrValue<StringType>;
    pendingColor?: SubtypeExprOrValue<StringType>;
    activeColor?: SubtypeExprOrValue<StringType>;
    completedColor?: SubtypeExprOrValue<StringType>;
    errorColor?: SubtypeExprOrValue<StringType>;
    skippedColor?: SubtypeExprOrValue<StringType>;
}
