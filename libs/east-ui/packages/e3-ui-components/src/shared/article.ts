/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The article English gives a noun, by its first sound rather than its first
 * letter — `a user`, `an hour` — the one rule every builder's words choose
 * `a` or `an` by.
 *
 * @packageDocumentation
 */

/** A vowel letter that starts with a consonant's sound: `a user`, `a unit`, `a euro`, `a one-off`. */
const SOUNDS_CONSONANT = /^(?:u[bcfhjkqrstn][aeiou]|eu|ew|one\b|once\b)/i;
/** A first letter that is silent: `an hour`, `an honest`, `an heir`. */
const SILENT_H = /^(?:hour|honest|hono|heir)/i;

/**
 * The article a noun takes, by its first sound: `a` before `person`, `user` and `one-off`; `an` before `operator`,
 * `umbrella` and `hour`.
 *
 * @param noun - The noun, as running text writes it
 * @returns `a` or `an`
 */
export function articleOf(noun: string): "a" | "an" {
    return (/^[aeiou]/i.test(noun) && !SOUNDS_CONSONANT.test(noun)) || SILENT_H.test(noun) ? "an" : "a";
}

/**
 * A noun with its article, by its first sound: `a person`, `an operator`, `a user`, `an hour`.
 *
 * @param noun - The noun, as running text writes it
 * @returns The noun after its article
 */
export function withArticle(noun: string): string {
    return `${articleOf(noun)} ${noun}`;
}
