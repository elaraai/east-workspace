/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phrase's first letter in capitals — a field's label at the start of a
 * sentence or a name: the one rule the query builder's and the Studio's words
 * start a sentence by.
 *
 * @packageDocumentation
 */

/**
 * A phrase with its first letter made a capital: `region is SA` → `Region is SA`.
 *
 * @param phrase - The phrase, as running text writes it
 * @returns It, its first letter a capital; an empty phrase as it is
 */
export function capitalised(phrase: string): string {
    return phrase.length === 0 ? phrase : phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
