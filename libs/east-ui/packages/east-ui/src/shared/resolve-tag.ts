/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The string shorthand of a null-payload variant — `"week"` for
 * `variant("week", null)` — resolved against its East type, for the factories
 * whose options take either (the Sheet's here, e3-ui's Plan through
 * `@elaraai/east-ui/internal`).
 *
 * @packageDocumentation
 */

import { East, variant, type EastType, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";

/**
 * Resolve a null-payload variant's string shorthand against its East type.
 *
 * @typeParam T - The variant type
 * @param v - A value or expression of `type`, or the name of one of its null-payload cases
 * @param type - The variant type
 * @returns The value as an expression of `type`
 */
export function resolveTag<T extends EastType>(v: SubtypeExprOrValue<NoInfer<T>> | string, type: T): ExprType<T> {
    const value = typeof v === "string" ? (variant(v, null) as unknown) : (v as unknown);
    return East.value(value as SubtypeExprOrValue<T>, type) as ExprType<T>;
}
