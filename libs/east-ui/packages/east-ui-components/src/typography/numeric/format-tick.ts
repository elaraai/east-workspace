/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `Format.*` formatter — a numeric value plus an (unwrapped)
 * `TickFormatType` variant as display text. It is the shared format module's
 * one interpreter (`formatters(locale).value`, #850), kept under this name for
 * the renderers and sibling packages that call it.
 *
 * @packageDocumentation
 */

import { formatters, type TickFormatOpt } from "../../format/index.js";

export type { TickFormatOpt } from "../../format/index.js";

/**
 * Formats `n` through the given tick format — the shared module's
 * {@link formatters}, `value` arm, in `locale`. `n` is the raw numeric value
 * (for date tags, an epoch-millisecond timestamp).
 *
 * @param n - The value
 * @param formatOpt - The unwrapped tick format, or `undefined` for the plain default
 * @param showSign - Always print the sign (unless the format pins its own)
 * @param locale - The BCP 47 locale; the runtime's default when omitted (a
 *   component passes its app locale — `useFormatters().value` is the same call)
 * @returns The display text
 */
export function formatTick(n: number, formatOpt: TickFormatOpt, showSign = false, locale?: string): string {
    return formatters(locale).value(n, formatOpt, showSign);
}
