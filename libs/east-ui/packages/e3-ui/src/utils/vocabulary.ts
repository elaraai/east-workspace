/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder's `vocabulary` prop is made of (#1516): the app's own words for what the builder draws of its own, each
 * keeping its default where left out. A noun is its singular, its plural that and `s` unless given; a word is one string.
 *
 * @packageDocumentation
 */

import { StringType, StructType } from "@elaraai/east";

/** One noun, resolved: as a heading writes it, and its plural. */
export const VocabularyNounType = StructType({ one: StringType, other: StringType });

/** One noun, as the app gives it: its singular, its plural that and `s` — or both, where it isn't regular. */
export type VocabularyNoun = string | { one: string; other?: string };

/**
 * One noun, resolved.
 *
 * @param builder - The builder's name, for what a refusal says
 * @param name - The entry's name
 * @param given - The entry
 * @param one - Its default singular
 * @param other - Its default plural, where it isn't regular
 * @returns The noun
 * @throws {Error} Naming an entry given empty
 */
export function vocabularyNoun(builder: string, name: string, given: VocabularyNoun | undefined, one: string, other?: string): { one: string; other: string } {
    if (given === undefined) return { one, other: other ?? `${one}s` };
    const noun = typeof given === "string" ? { one: given } : given;
    vocabularyWord(builder, name, noun.one, one);
    return { one: noun.one, other: noun.other ?? `${noun.one}s` };
}

/**
 * One word, resolved.
 *
 * @param builder - The builder's name, for what a refusal says
 * @param name - The entry's name
 * @param given - The entry
 * @param word - Its default
 * @returns The word
 * @throws {Error} Naming an entry given empty
 */
export function vocabularyWord(builder: string, name: string, given: string | undefined, word: string): string {
    if (given !== undefined && given.trim() === "") throw new Error(`${builder}: \`vocabulary.${name}\` must not be empty — leave it out to keep "${word}"`);
    return given ?? word;
}
