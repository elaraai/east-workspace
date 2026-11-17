/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One case of a variant field of some rows: what a `case: [field, tag]`
 * names, wherever it is written — a Plan's series (#1541, U2), a kind's
 * templates over one record of every kind's presets (#1544). The rows that
 * hold the case are the ones it lists, and each function of a row is handed
 * the case's value after the row and its key.
 *
 * @packageDocumentation
 */

import type { BooleanType, EastType, ExprType } from "@elaraai/east";

/**
 * The cases of a variant field among a row's fields, by name.
 *
 * @param fields - The row's fields; `undefined` for a row that is no struct
 * @param field - The field
 * @returns Its cases, or `undefined` where the row has no such field or it holds no variant
 */
export function variantCasesIn(fields: Readonly<Record<string, EastType>> | undefined, field: string): Record<string, EastType> | undefined {
    const type = fields?.[field] as { type: string; cases?: Record<string, EastType> } | undefined;
    return type !== undefined && type.type === "Variant" ? type.cases : undefined;
}

/**
 * Whether a row holds a case of its variant field.
 *
 * @param node - The row as an accessor receives it
 * @param field - The variant field
 * @param tag - The case
 * @returns Whether the field holds the case
 */
export function holdsCase(node: ExprType<EastType>, field: string, tag: string): ExprType<BooleanType> {
    return ((node as unknown as Record<string, ExprType<EastType>>)[field] as unknown as { hasTag: (t: string) => ExprType<BooleanType> }).hasTag(tag);
}

/**
 * The value of a case a row's variant field holds: what a function of the row
 * is handed after the row and its key.
 *
 * @param node - The row as an accessor receives it
 * @param field - The variant field
 * @param tag - The case, which the field holds
 * @returns The case's value
 */
export function caseValueOf(node: ExprType<EastType>, field: string, tag: string): ExprType<EastType> {
    return ((node as unknown as Record<string, ExprType<EastType>>)[field] as unknown as { unwrap: (t: string) => ExprType<EastType> }).unwrap(tag);
}
