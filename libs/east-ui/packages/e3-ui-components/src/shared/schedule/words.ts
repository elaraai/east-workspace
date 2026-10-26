/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Words the schedule builders share (#1424): a kind's name in the plural,
 * words joined as English lists them, and what a figure says of the kinds it
 * does not count — the Plan's footer and the Calendar's counts alike, a kind
 * past the cap counted none of, never 0.
 *
 * @packageDocumentation
 */

/**
 * A kind's name in the plural, as English makes one — `Stop` → `Stops`,
 * `Delivery` → `Deliveries`; a name that ends in `s` stays.
 *
 * @param name - The kind's name
 * @returns Its plural
 */
export function kindPlural(name: string): string {
    if (/s$/i.test(name)) return name;
    if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
    if (/(x|z|ch|sh)$/i.test(name)) return `${name}es`;
    return `${name}s`;
}

/**
 * Words joined as English reads a list — `a`, `a or b`, `a, b or c` — `and`
 * in place of `or` when asked.
 *
 * @param words - The words, in order
 * @param last - The word before the last
 * @returns The list
 */
export function joinedWords(words: readonly string[], last: "or" | "and"): string {
    return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

/**
 * What a count of events says when some kinds' events are not counted (#1039,
 * #1424): `13 events, print jobs not counted`; with no count of the others,
 * `print jobs not counted`.
 *
 * @param p - The count, `count` formatted for the locale beside its raw `n`, `undefined` when no kind's are counted; and
 *   the names of the kinds not counted, as running text writes them
 * @returns The words
 */
export function eventsNotCounted(p: { n: number; count: string | undefined; kinds: readonly string[] }): string {
    const notCounted = `${joinedWords(p.kinds.map(kindPlural), "and")} not counted`;
    return p.count === undefined ? notCounted : `${p.count} ${p.n === 1 ? "event" : "events"}, ${notCounted}`;
}
