/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The order a row of filter chips draws its chips in, by their groups (#1673).
 * A Studio page's filters are each on one of the page's datasets, and its rail
 * draws each dataset's chips together after the dataset's name: the groups in
 * the order the host names them — a page's datasets as its surface lists them,
 * which no filter added or taken out reorders — then any it does not name in
 * the order their first chip comes; a group's chips in the order the host
 * gives them. Chips with no group are one group of their own, never named:
 * Slice's own filters draw as the host gives them.
 *
 * The host's order is left as it is — a chip is still told by its place in
 * it — so a row held as it stood while an editor is open (`chips.tsx`) draws
 * the same chips in the same order whatever the host appends meanwhile.
 *
 * `+N more` holds the chips the row folds — those after the ones it shows, in
 * the same order — and none it shows, each named group named again before the
 * first of its chips it holds: a group split between the row and `+N more` is
 * named in each.
 *
 * @packageDocumentation
 */

/**
 * A row's chips in the order it draws them.
 *
 * @property order - Each chip's place in the host's order, in the order the row draws it
 * @property starts - Whether the chip drawn at each place is the first of a named group: the row names the group before it
 */
export interface ChipOrder {
    /** Each chip's place in the host's order, in the order the row draws it. */
    readonly order: readonly number[];
    /** Whether the chip drawn at each place is the first of a named group: the row names the group before it. */
    readonly starts: readonly boolean[];
}

/**
 * The order a row draws its chips in — see the module docs.
 *
 * @param groups - Each chip's group's key, in the host's order; `undefined` for a chip in none
 * @param named - The groups' keys in the order the row draws them; a group not among them comes after, in the order its first chip comes
 * @returns The order, and where each named group starts
 */
export function chipOrder(groups: readonly (string | undefined)[], named: readonly string[] = []): ChipOrder {
    // The groups in the order the host names them, then in the order their first chip comes.
    const buckets = new Map<string | undefined, number[]>(named.map((key) => [key, []]));
    groups.forEach((group, place) => {
        const bucket = buckets.get(group);
        if (bucket === undefined) buckets.set(group, [place]);
        else bucket.push(place);
    });
    const order: number[] = [];
    const starts: boolean[] = [];
    for (const [group, places] of buckets) {
        places.forEach((place, at) => {
            order.push(place);
            starts.push(group !== undefined && at === 0);
        });
    }
    return { order, starts };
}

/**
 * The chips a row folds into `+N more`, in the order it draws them — see the
 * module docs.
 *
 * @param drawn - The order the row draws its chips in ({@link chipOrder})
 * @param groups - Each chip's group's key, in the host's order; `undefined` for a chip in none
 * @param shown - How many chips the row shows: the first of `drawn`'s order
 * @returns The chips it folds, each its place in the host's order, and where each named group starts among them
 */
export function foldedOrder(drawn: ChipOrder, groups: readonly (string | undefined)[], shown: number): ChipOrder {
    const order = drawn.order.slice(Math.max(0, shown));
    const starts = order.map((place, at) => groups[place] !== undefined && (at === 0 || groups[order[at - 1]!] !== groups[place]));
    return { order, starts };
}
