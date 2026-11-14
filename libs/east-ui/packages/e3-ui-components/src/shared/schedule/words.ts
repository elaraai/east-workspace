/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Words the schedule builders share (#1424): a kind's name in the plural,
 * a count and what it counts, words joined as English lists them, what a figure says of the kinds it
 * does not count — the Plan's footer and the Calendar's counts alike, a kind
 * past the cap counted none of, never 0 — and the hidden pick's words for a
 * row the rail's narrowing hides (`hidden.ts`): what a builder's message table
 * gives its line ({@link HiddenWords}) and their English — hidden by the
 * choices, or dimmed by them where the narrowing draws the row as context
 * ({@link dimmedWords}) — and what a refusal says of a kind its page's scope
 * holds only some rows of ({@link unheldByScopeText}) — here, with no DOM to
 * load, so a builder's message table that says them loads with none.
 *
 * @packageDocumentation
 */

/**
 * A word in running text: lower case, unless it is written in capitals (`QA` stays `QA`).
 *
 * @param word - The word as a heading writes it
 * @returns The word as a sentence writes it
 */
export function lowerWord(word: string): string {
    return word.length > 1 && word === word.toLocaleUpperCase() && word !== word.toLocaleLowerCase() ? word : word.toLocaleLowerCase();
}

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
 * A count and what it counts, as English says it: `1 issue`, `3 issues` — the
 * word's plural as English makes one ({@link kindPlural}): `1 breach`,
 * `4 breaches`.
 *
 * @param n - How many
 * @param word - What it counts, in the singular
 * @returns The words
 */
export function plural(n: number, word: string): string {
    return `${n} ${n === 1 ? word : kindPlural(word)}`;
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

/**
 * A builder's words for a row a narrowing draws as context where it leaves it
 * out (`narrowed="dim"`), as its message table holds them beside its
 * {@link HiddenWords}.
 */
export interface DimmedWords {
    /** Until e3 has said which choices dim it — `dimmed by the filters`. */
    readonly dimmedByFilters: HiddenWords["hiddenByFilters"];
    /** Once it has: the choices that dim it, and those a pick clears with them — `dimmed by Status: Ready — …`. */
    readonly dimmedBy: HiddenWords["hiddenBy"];
}

/**
 * The words a line names the choices that leave a row out in, where the
 * narrowing draws what it leaves out as context (`narrowed="dim"`): they dim
 * it, never hide it. What a builder that dims gives the hidden pick's line
 * (`hidden.ts`' `hiddenLine`) in place of its hidden words.
 *
 * @param m - The builder's message table
 * @returns Its dimmed words, as the hidden pick's line takes them
 */
export function dimmedWords(m: DimmedWords): HiddenWords {
    return { hiddenByFilters: m.dimmedByFilters, hiddenBy: m.dimmedBy };
}

/**
 * Why a row isn't changed where a kind that may name it is one its page's
 * scope holds only some rows of (#1621), as a builder's refusal says it after
 * the row's name: `this page holds only some transitions, and one it does not
 * may name it — edit it where they are all held`. A scope is no choice of the
 * viewer's, so the words name no Clear: they say where the edit can be made.
 *
 * @param kinds - The kind's name in the plural, as running text writes it
 * @returns The clause
 */
export function unheldByScopeText(kinds: string): string {
    return `this page holds only some ${kinds}, and one it does not may name it — edit it where they are all held`;
}
