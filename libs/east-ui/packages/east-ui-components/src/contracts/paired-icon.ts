/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Paired-icon map — the single source of truth for `StatusTokenType →
 * IconDefinition`.
 *
 * Colour is never the only signal for status surfaces (§0.3 contract). Every
 * renderer that displays a `StatusToken` (Alert, Banner, Status, Badge with
 * semantic palette, DeltaPill, Stat.indicator, FreshnessChip) calls
 * {@link resolvePairedIcon} to get the paired Font Awesome icon. Authors may
 * explicitly opt out by passing `showIcon: false`.
 *
 * Enforcement:
 *   - Token set:     IR (`east-ui/src/style/interaction.ts`)
 *   - Map:           this file
 *   - Per-renderer:  paired at render time in each component renderer
 */

import {
    faCircleCheck,
    faTriangleExclamation,
    faCircleXmark,
    faCircleInfo,
    faCircle,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

export type StatusToken = "success" | "warning" | "danger" | "info" | "neutral";

/**
 * Immutable map from semantic-status token to Font Awesome icon definition.
 */
export const STATUS_ICON: Readonly<Record<StatusToken, IconDefinition>> = {
    success: faCircleCheck,
    warning: faTriangleExclamation,
    danger: faCircleXmark,
    info: faCircleInfo,
    neutral: faCircle,
};

/**
 * Resolve the paired FA icon for a `StatusToken`.
 *
 * @param status - The semantic-status token
 * @param showIcon - If `false`, returns `null` (author opt-out). Any other
 *     value (including `undefined`) returns the paired icon.
 * @returns The paired `IconDefinition`, or `null` when the caller opted out.
 */
export function resolvePairedIcon(
    status: StatusToken,
    showIcon?: boolean,
): IconDefinition | null {
    if (showIcon === false) return null;
    return STATUS_ICON[status];
}
