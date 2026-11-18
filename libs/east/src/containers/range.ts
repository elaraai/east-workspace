/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run of a sorted tree between two bounds, found by a search and never by a
 * walk (#1616, D3).
 *
 * A bound of a key range is no key: it gives a key's first fields and stops,
 * so the tree cannot be asked for it as it is asked for a key. A bound is
 * given here as a **test** of a key that is false, then true, over the keys in
 * order — "is this key at or past the bound?" — and the run is the keys the
 * `from` test holds for and the `to` test does not.
 *
 * The tree finds each end as it finds a key: down from the root, a binary
 * search in each node. It is handed a probe in a key's place and, for the
 * search alone, a comparison that asks the test how a key stands to the probe.
 * The tree is never written: the search runs on an object that inherits the
 * tree and overrides its comparison, so a frozen tree, or one being read
 * elsewhere, is left as it is.
 *
 * The run is copied into a new tree as an ascending insert builds one. Each
 * key arrives past every key the new tree holds, so the comparison the new
 * tree is filled with answers for the arriving key by what it is, and compares
 * nothing.
 *
 * Both comparisons are the tree's own order wherever they are asked about two
 * keys, so the result is right however the tree chooses to compare. That it
 * compares no two keys — which is what makes a range cost what it holds — is
 * what the tests count.
 *
 * One copy, which {@link SortedMap} and {@link SortedSet} both use.
 *
 * @packageDocumentation
 */

import type sorted_btree from "sorted-btree";

type BTree<K, T> = sorted_btree.default<K, T>;

/**
 * A test of a key that is false, then true, over the keys in order: whether a
 * key is at or past a bound.
 *
 * A test of a bound that is a whole key, asked "at or past", may also say
 * which key the bound is (`isBound`): the first key the test can hold for. A
 * reader of keys it has not decoded — a pager, by its segments' first keys —
 * places the bound at such a key without reading the keys before it. A tree
 * held in memory never asks.
 *
 * @typeParam K - The type of the keys
 */
export type KeyTest<K> = ((key: K) => boolean) & {
    /** Whether `key` is the bound itself: the least key the test holds for. */
    readonly isBound?: (key: K) => boolean;
};

/** The probe that stands just before the first key the `from` test holds for. */
const FROM: object = Object.freeze({ bound: "from" });
/** The probe that stands just before the first key the `to` test holds for. */
const TO: object = Object.freeze({ bound: "to" });

/**
 * Copies the entries of `source` between two bounds into `into`, in key order.
 *
 * @typeParam K - The type of the keys
 * @typeParam T - The type of the values
 * @param source - The tree to read, which is not written
 * @param into - A new, empty tree with the same comparison as `source`
 * @param from - The test the run's first key is the first to pass; `undefined` for the first key
 * @param to - The test the run stops before the first key to pass; `undefined` for the end
 *
 * @remarks
 * Costs two searches down `source` and, for each node of the run, two binary
 * searches inside it: fewer calls of the tests than the run has entries, and
 * none for the entries outside it. `into` is built as an ascending insert
 * builds it, node for node.
 *
 * A test that is not false, then true, over the keys in order gives a run that
 * is not defined; a test that throws leaves `into` to be thrown away.
 *
 * @internal
 */
export function copyRange<K, T>(source: BTree<K, T>, into: BTree<K, T>, from: KeyTest<K> | undefined, to: KeyTest<K> | undefined): void {
    const compare = into._compare;
    // How a key stands to a probe: past it once the probe's test holds. A bound left out
    // stands before every key (`from`) or after every key (`to`).
    const stands = (key: K, probe: unknown): number => (probe === FROM
        ? (from === undefined || from(key) ? 1 : -1)
        : (to !== undefined && to(key) ? 1 : -1));
    // The search's comparison: a key with a probe, either way round, by the probe's test.
    const probing = (a: K, b: K): number => {
        if (b === FROM || b === TO) return stands(a, b);
        if (a === FROM || a === TO) return -stands(b, a);
        return compare(a, b);
    };
    const search = Object.create(source, { _compare: { value: probing } }) as BTree<K, T>;
    // The fill's comparison: the key arriving is past every key held. `Object.is` tells it from
    // the keys held, which differ from it in the tree's order: it tells the two zeros apart, as
    // East's order does, and a NaN from every number.
    let arriving: K | undefined;
    const filling = (a: K, b: K): number => {
        if (Object.is(b, arriving)) return Object.is(a, arriving) ? 0 : -1;
        if (Object.is(a, arriving)) return 1;
        return compare(a, b);
    };
    into._compare = filling;
    try {
        search.forRange(FROM as K, TO as K, false, (key, value) => {
            arriving = key;
            into.set(key, value);
        });
    } finally {
        into._compare = compare;
    }
}
