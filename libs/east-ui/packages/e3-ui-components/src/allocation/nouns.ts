/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's nouns (#1338, D12): the app's words for a lane, what it books (an
 * arrival), a resource and the quantity, resolved by the tag, and how running text writes them —
 * in lower case, unless written in capitals (`SKU` stays `SKU`).
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";
import type { AllocationValue } from "./model.js";

/** The board's nouns, as the payload carries them. */
export type Nouns = AllocationValue["labels"];
/** One noun: its singular as a heading writes it, its plural and its article. */
export type Noun = Nouns["lane"];

/**
 * A word in running text: lower case, unless it is written in capitals.
 *
 * @param word - The word as a heading writes it
 * @returns The word as a sentence writes it
 */
export function lower(word: string): string {
    return word.length > 1 && word === word.toLocaleUpperCase() && word !== word.toLocaleLowerCase() ? word : word.toLocaleLowerCase();
}

/** The singular in running text: `kiln`. */
export const one = (noun: Noun): string => lower(noun.one);
/** The plural in running text: `kilns`. */
export const other = (noun: Noun): string => lower(noun.other);
/** The singular after its article: `a kiln`, `an arrival`. */
export const a = (noun: Noun): string => `${noun.article} ${lower(noun.one)}`;

/** The nouns with no labels given, as the tag resolves them. */
export const DEFAULT_NOUNS: Nouns = {
    lane: { one: "Lane", other: "Lanes", article: "a" }, arrival: { one: "Arrival", other: "Arrivals", article: "an" },
    resource: { one: "Resource", other: "Resources", article: "a" }, quantity: "QTY",
};

/** The board's nouns, for its parts. */
export const NounsContext = createContext<Nouns>(DEFAULT_NOUNS);

/** The board's nouns. */
export const useNouns = (): Nouns => useContext(NounsContext);
