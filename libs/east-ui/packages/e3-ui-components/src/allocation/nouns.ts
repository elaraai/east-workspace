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
import { lowerWord } from "../shared/schedule/words.js";
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
    return lowerWord(word);
}

/** The singular in running text: `kiln`. */
export const one = (noun: Noun): string => lower(noun.one);
/** The plural in running text: `kilns`. */
export const other = (noun: Noun): string => lower(noun.other);
/** The singular after its article: `a kiln`, `an arrival`. */
export const a = (noun: Noun): string => `${noun.article} ${lower(noun.one)}`;

/** A count in a noun: `1 bin`, `3 bins`. */
export const counted = (n: number, noun: Noun): string => `${n} ${n === 1 ? one(noun) : other(noun)}`;

/** The nouns with no labels given, as the tag resolves them. */
export const DEFAULT_NOUNS: Nouns = {
    lane: { one: "Lane", other: "Lanes", article: "a" }, arrival: { one: "Arrival", other: "Arrivals", article: "an" },
    resource: { one: "Resource", other: "Resources", article: "a" }, quantity: "QTY",
    bin: { one: "Bin", other: "Bins", article: "a" }, reservation: { one: "Reservation", other: "Reservations", article: "a" }, reserved: "Reserved",
    priorJob: "Prior job", nextJob: "Next job", hold: "Hold",
    groups: { overdue: "Overdue", ready: "Ready around now", removed: "Removed from plan", allocated: "Allocated", free: "Free today", loading: "Loading today", busy: "Busy today" },
};

/** The board's nouns, for its parts. */
export const NounsContext = createContext<Nouns>(DEFAULT_NOUNS);

/** The board's nouns. */
export const useNouns = (): Nouns => useContext(NounsContext);
