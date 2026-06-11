/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    ArrayType,
    IntegerType,
    OptionType,
    StructType,
    StringType,
} from "@elaraai/east";

import { DensityType, SizeType } from "../../style.js";
import type { DensityLiteral, SizeLiteral } from "../../style.js";
import { AvatarType } from "../avatar/types.js";

// ============================================================================
// AvatarGroup Style
// ============================================================================

/**
 * East StructType for the AvatarGroup style sub-struct.
 *
 * @remarks
 * Visual-only. Content (`avatars`) and config (`max`) live on
 * the main `AvatarGroupType` struct.
 *
 * @property size - Shared avatar size preset applied to every avatar in the group
 * @property borderColor - Explicit colour for the overlap ring between avatars
 */
export const AvatarGroupStyleType = StructType({
    size: OptionType(SizeType),
    borderColor: OptionType(StringType),
});

/** Type alias for the AvatarGroup style struct. */
export type AvatarGroupStyleType = typeof AvatarGroupStyleType;

// ============================================================================
// AvatarGroup Type
// ============================================================================

/**
 * East StructType for an AvatarGroup component value.
 *
 * @remarks
 * Main struct carries the array of avatar values, an optional `max`
 * overflow threshold, and a visual style sub-struct. When `max` is set
 * and `avatars.size() > max`, the renderer emits a `+N` overflow button
 * after the first `max` avatars.
 *
 * @property avatars - Array of AvatarType values
 * @property max - Optional overflow threshold (renderer shows `+N` after `max`)
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property style - Optional visual style sub-struct
 */
export const AvatarGroupType = StructType({
    avatars: ArrayType(AvatarType),
    max: OptionType(IntegerType),
    density: OptionType(DensityType),
    style: OptionType(AvatarGroupStyleType),
});

/** Type alias for the AvatarGroup struct. */
export type AvatarGroupType = typeof AvatarGroupType;

// ============================================================================
// AvatarGroup TS options bag
// ============================================================================

/**
 * TypeScript options bag for `AvatarGroup.Root`.
 *
 * @remarks
 * Combines config (`max`) with visual style fields.
 *
 * @property max - Optional overflow threshold
 * @property density - Density override shared with the rail / trace cascade
 * @property size - Shared avatar size preset
 * @property borderColor - Overlap ring colour override
 */
export interface AvatarGroupOptions {
    /** Optional overflow threshold — renderer shows `+N` after this many avatars. */
    max?: SubtypeExprOrValue<IntegerType>;
    /**
     * Density override (main-struct). Inherited from the enclosing surface
     * (Table, ChipRail, …) when omitted; an explicit value wins over both the
     * cascade and `size`, sizing every member avatar to match rails and
     * traces at the same density.
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Shared avatar size preset applied to every avatar in the group. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit overlap ring colour override. */
    borderColor?: SubtypeExprOrValue<StringType>;
}
