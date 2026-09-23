/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How the Plan prints a number IT derived (#810): a rollup band's total and
 * peak, an aggregated heat cell, a group's member count.
 *
 * Every one goes through the shared numeric formatter's default arm — the one
 * a Table's undeclared `TickFormat` cell uses — so a derived total of 1234.5
 * prints "1,234.5" beside the author's own formatted numbers rather than a
 * hand-rolled "1235", and the mean of 0.82, 0.64 and 0.90 prints "0.787"
 * rather than "1". One seam on purpose: a declared per-row format and the
 * locale arrive here, not at each call site.
 *
 * @packageDocumentation
 */

import { formatTick } from "../../typography/numeric/format-tick.js";

/**
 * Format a number the canvas derived.
 *
 * @param n - The derived number
 * @returns Its display text
 */
export function formatDerived(n: number): string {
    return formatTick(n, undefined);
}

/**
 * A member count as a group's gutter meta — `"1,204 rs"`, prefixed `~` while
 * the count covers an incomplete prefix (a paged canvas still loading;
 * #567 D9).
 *
 * @param count - The derived member count
 * @param partial - Whether the count covers an incomplete prefix
 * @returns The meta text
 */
export function membersMeta(count: number, partial: boolean | undefined): string {
    return `${partial === true ? "~" : ""}${formatDerived(count)} rs`;
}
