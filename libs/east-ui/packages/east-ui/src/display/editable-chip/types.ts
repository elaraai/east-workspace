/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BooleanType,
    FunctionType,
    NullType,
    OptionType,
    StructType,
    StringType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";

// ============================================================================
// EditableChip Style
// ============================================================================

/**
 * East StructType for the EditableChip style sub-struct.
 *
 * @remarks
 * Visual-only. Content (`label` / `trigger`), state
 * (`disabled`), and behaviour (`onClick`) live on the main
 * `EditableChip` inline variant in `component.ts`.
 *
 * @property size - Size preset (sm / md / lg)
 * @property color - Explicit text colour override
 * @property background - Explicit background override
 * @property borderColor - Explicit border colour override
 * @property triggerIconColor - Explicit colour for the trailing trigger icon
 */
export const EditableChipStyleType = StructType({
    size: OptionType(SizeType),
    borderRadius: OptionType(StringType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    triggerIconColor: OptionType(StringType),
});

/** Type alias for the EditableChip style struct. */
export type EditableChipStyleType = typeof EditableChipStyleType;

// ============================================================================
// EditableChip TS options bag
// ============================================================================

/**
 * TypeScript options bag for `EditableChip.Root`.
 *
 * @remarks
 * Combines main-struct behaviour fields (`disabled`, `onClick`,
 * optional `trigger` icon) with visual style fields. The factory splits
 * them into the nested IR shape internally.
 *
 * @property trigger - Optional trailing icon (defaults to `faChevronDown`)
 * @property disabled - Whether the chip is disabled (main state)
 * @property onClick - Callback fired when the chip is activated (main behaviour)
 * @property size - Size preset
 * @property color - Explicit text colour override
 * @property background - Explicit background override
 * @property borderColor - Explicit border colour override
 * @property triggerIconColor - Explicit colour for the trailing trigger icon
 */
export interface EditableChipOptions {
    /** Optional trailing icon (defaults to `faChevronDown` in the renderer). */
    trigger?: unknown;
    /** Whether the chip is disabled (main-struct state). */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired when the chip is activated (main-struct behaviour). */
    onClick?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Size preset (sm / md / lg). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Corner radius (Chakra token or explicit px). Default `"md"`. */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Explicit text colour override. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background override. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour override. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the trailing trigger icon. */
    triggerIconColor?: SubtypeExprOrValue<StringType>;
}
