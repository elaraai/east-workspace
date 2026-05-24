/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    NullType,
    VariantType,
    variant,
} from "@elaraai/east";

/**
 * Status types for Banner — drives paired icon, status colour, and bsys
 * `banner.*` layer-style mapping.
 *
 * @property info - Informational callout
 * @property success - Confirmation of a successful action
 * @property warning - Non-blocking caution
 * @property error - Error / failure
 * @property neutral - Default / idle / partial
 * @property change - "Scenario saved / commit landed" — brand-tinted, replaces toast success
 * @property guard - Guardrail violation — warm warning, distinct from generic warning
 * @property stale - Stale / partial data — paper-2 dashed grey
 */
export const BannerStatusType = VariantType({
    info: NullType,
    warning: NullType,
    success: NullType,
    error: NullType,
    neutral: NullType,
    change: NullType,
    guard: NullType,
    stale: NullType,
});

export type BannerStatusType = typeof BannerStatusType;

/** String literal type for banner status values. */
export type BannerStatusLiteral =
    | "info"
    | "warning"
    | "success"
    | "error"
    | "neutral"
    | "change"
    | "guard"
    | "stale";

/**
 * Helper function to create banner status values.
 *
 * @param status - The status string
 * @returns An East expression representing the banner status
 */
export function BannerStatus(status: BannerStatusLiteral): ExprType<BannerStatusType> {
    return East.value(variant(status, null), BannerStatusType);
}
