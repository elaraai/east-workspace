/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Words the schedule builders share (#1424): a kind's name in the plural,
 * words joined as English lists them, what a figure says of the kinds it
 * does not count — the Plan's footer and the Calendar's counts alike, a kind
 * past the cap counted none of, never 0 — and the hidden pick's words for a
 * row the rail's narrowing hides (`hidden.ts`): what a builder's message table
 * gives its line ({@link HiddenWords}) and their English — hidden by the
 * choices, or dimmed by them where the narrowing draws the row as context —
 * here, with no DOM to load, so a builder's message table that says them loads
 * with none.
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

/**
 * A builder's words for a row the rail's narrowing hides, as its line says
 * it — its message table's, so a translation words them (the hidden pick,
 * `hidden.ts`' `hiddenLine`).
 */
export interface HiddenWords {
    /** Until e3 has said which choices hide it, for each source that does — `hidden by the filters`. */
    readonly hiddenByFilters: () => string;
    /**
     * Once it has: the choices that hide it, each as the rail words it, and those a pick clears with them — `hidden by
     * Status: Ready — picking it clears that filter` ({@link hiddenByText} in English).
     */
    readonly hiddenBy: (p: { readonly filters: readonly string[]; readonly also: readonly string[] }) => string;
}

/**
 * The English of a row the rail's narrowing hides, by the choices that do —
 * joined as the rail's `Replaces …` joins them — and what a pick of it clears:
 * `hidden by Status: Ready — picking it clears that filter`; or, of a row a
 * narrowing draws as context where it leaves it out (the Schematic's
 * `narrowed="dim"`), `dimmed by Status: Ready — …`. A builder's message table
 * says it so in English, and a translation in its own words.
 *
 * @param filters - The choices that hide the row, as the rail words them
 * @param also - The choices a pick clears with them
 * @param verb - What the choices do to the row: `hidden`, the default, or `dimmed`, where the narrowing draws it as context
 * @returns The words
 */
export function hiddenByText(filters: readonly string[], also: readonly string[], verb: "hidden" | "dimmed" = "hidden"): string {
    const one = filters.length === 1;
    const extra = also.length === 0 ? "" : `, and ${also.join("; ")} with ${one ? "it" : "them"}`;
    return `${verb} by ${filters.join("; ")} — picking it clears ${one ? "that filter" : "those filters"}${extra}`;
}
