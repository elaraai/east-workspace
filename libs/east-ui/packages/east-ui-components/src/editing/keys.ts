/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a collection's new entries are keyed — the one place a new entry's key
 * is made (#1583; ruled 12 Nov 2026: in the editing session, never in the
 * collections). A session is bound to a policy ({@link EntryKeys},
 * `EditSessionBinding.keys`) and makes every new entry's key by it
 * (`EditSession.mint`): the key is the session's own until its entry is
 * saved, kept through a reload with the drafts, and made again by the same
 * policy where the source comes to hold it as another's — two sessions that
 * each add an entry are given the same key wherever keys follow a rule, and
 * the two are two new entries, never one changed both ways.
 *
 * A key is handled as its id — its text: a String key itself, any other key
 * as East prints it — so a policy keys a source of any key type, and none
 * reads a key's value but the one whose rule is a number's.
 *
 * The policies here are the rules every collection shares: a key made up at
 * random ({@link randomKeys}); one made from another entry's or a template's
 * — the next in a row where the session holds the source whole
 * ({@link madeFromKeys}), drawn at random where it does not
 * ({@link drawnFromKeys}); the next Integer ({@link nextIntegerKeys}); a
 * placeholder no key prints as, for an entry whose key a person types
 * ({@link placeholderKeys}); any of them past the keys its host shows rows
 * under ({@link pastKeys}); and any of them made once only, for entries other
 * drafts name by key ({@link onceKeys}). A collection whose app gives its own rule — a
 * function of the keys taken — binds that as its policy. A key an app builds
 * from the entry itself is the entry's identity by the app's own word: it is
 * never made here, and two entries that build the same one are a conflict.
 *
 * What a session knows taken is its own drafts' keys, those its Saves landed,
 * those it has learned are another write's, and every key of a source it
 * holds whole. Over a source read a window at a time that is not every key
 * the source holds: a key made there may be one the source holds out of
 * view, which the source refuses at Save, the session making the entry
 * another. So a rule over such a source makes keys that do not turn on the
 * keys taken — drawn at random, or past a largest key its host reads — and is
 * bound past the keys its host shows ({@link pastKeys}), so a new entry is
 * never drawn over a row on the page.
 *
 * @packageDocumentation
 */
import { IntegerType, compareFor, parseFor, printFor } from "@elaraai/east";

const compareInteger = compareFor(IntegerType);
const parseInteger = parseFor(IntegerType);
const printInteger = printFor(IntegerType);

/** The keys a new one must not be, as far as its session knows them: each by its id. */
export interface KnownKeys {
    /**
     * Whether a key is taken.
     *
     * @param id - The key's id
     */
    has(id: string): boolean;
    /**
     * Every key known taken: what a rule that reads them all reads — the largest of them, the set an app's own function
     * is given.
     *
     * @returns Their ids, in no order; one may be given twice
     */
    ids(): Iterable<string>;
}

/** How a collection's new entries are keyed: its session's policy (`EditSessionBinding.keys`). */
export interface EntryKeys {
    /**
     * A key for a new entry.
     *
     * @param known - The keys it must not be
     * @param from - The id the entry is made from — a template's, a copied entry's — where it is made from one
     * @param taken - The key being replaced, where another is made for a new entry whose own the source came to hold
     *   as another's: known taken, whatever else of the source is still being read
     * @returns The key's id; `undefined` where none can be made now — a read the rule waits for, a key type it does not make
     * @throws Whatever a collection's own rule throws to refuse the gesture: a carry-over that makes another key takes
     *   it as no key made, and leaves the two entries a conflict
     */
    make(known: KnownKeys, from: string | undefined, taken: string | undefined): string | undefined;
}

/**
 * A version 4 UUID drawn from `crypto.getRandomValues`, which every page has:
 * its version and variant bits set, printed 8-4-4-4-12.
 *
 * @returns The UUID
 */
function drawnUuid(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A UUID: `crypto.randomUUID()`'s, else — a page served over plain HTTP has
 * none — one drawn from the page's random bytes ({@link drawnUuid}).
 *
 * @returns The UUID
 */
function uuid(): string {
    return "randomUUID" in crypto ? crypto.randomUUID() : drawnUuid();
}

/**
 * Keys made up at random: a UUID, drawn again while it is taken — a text
 * key's rule where nothing else is said. Two sessions never make the same
 * one.
 *
 * @returns The policy
 */
export function randomKeys(): EntryKeys {
    return {
        make: (known) => {
            for (;;) {
                const id = uuid();
                if (!known.has(id)) return id;
            }
        },
    };
}

/**
 * Keys made from another's: an entry made from one — a template's, a copied
 * entry's — is keyed `<from>-2`, then `<from>-3`, the first not taken; one
 * made from none takes `otherwise`'s. A text key's rule. Two sessions make the
 * same key from the same one: where another Save takes it first, the session
 * makes the entry the next.
 *
 * @param otherwise - The policy of an entry made from no other
 * @returns The policy
 */
export function madeFromKeys(otherwise: EntryKeys): EntryKeys {
    return {
        make: (known, from, taken) => {
            if (from === undefined) return otherwise.make(known, from, taken);
            for (let n = 2; ; n++) {
                const id = `${from}-${n}`;
                if (!known.has(id)) return id;
            }
        },
    };
}

/**
 * Keys made from another's, each with a suffix drawn at random: an entry made
 * from one — a template's, a copied entry's — is keyed `<from>-` and eight
 * hex digits, drawn again while it is taken; one made from none takes
 * `otherwise`'s. A text key's rule over a source its session does not hold
 * whole — a record read a window at a time — where the first `<from>-n` not
 * known taken is, as often as not, one the source holds out of view: its
 * every earlier copy's. Two sessions never make the same one.
 *
 * @param otherwise - The policy of an entry made from no other
 * @returns The policy
 */
export function drawnFromKeys(otherwise: EntryKeys): EntryKeys {
    return {
        make: (known, from, taken) => {
            if (from === undefined) return otherwise.make(known, from, taken);
            for (;;) {
                const id = `${from}-${uuid().replaceAll("-", "").slice(0, 8)}`;
                if (!known.has(id)) return id;
            }
        },
    };
}

/**
 * Integer keys: one past the largest key taken. `largest` adds what the host
 * has read of a source the session does not hold whole — the record's largest
 * key, read by its key order: while that read is on its way a first key waits
 * for it, and another for a key known taken is made past what is known alone,
 * since a carry-over waits for no read.
 *
 * @param largest - The source's largest key as its host has read it: `{ key }`, its key `undefined` for a source
 *   holding none; `undefined` while it is still being read. Left out for a source the session holds whole
 * @returns The policy
 */
export function nextIntegerKeys(largest?: () => { readonly key: bigint | undefined } | undefined): EntryKeys {
    return {
        make: (known, _from, taken) => {
            let most = 0n;
            const consider = (key: bigint): void => { if (compareInteger(key, most) > 0) most = key; };
            if (largest !== undefined) {
                const read = largest();
                if (read === undefined) {
                    if (taken === undefined) return undefined;
                } else if (read.key !== undefined) {
                    consider(read.key);
                }
            }
            for (const id of known.ids()) {
                const key = parseInteger(id);
                if (key.success) consider(key.value);
            }
            // Past what is known taken by its key alone, too: a key its host shows a row under ({@link pastKeys}), which
            // a largest key read before that row was saved does not reach.
            for (;;) {
                const id = printInteger(most + 1n);
                if (!known.has(id)) return id;
                most += 1n;
            }
        },
    };
}

/**
 * A rule's keys, past those its host shows rows under: what the host has read
 * of a source its session does not hold whole. A key made there may be one
 * the source holds — refused at Save, the entry made another — but never one
 * the page shows a row under: drawn over that row, the new entry would hide
 * it until then.
 *
 * @param keys - The rule its keys are made by
 * @param shows - Whether the host shows a row under a key, by its id
 * @returns The policy
 */
export function pastKeys(keys: EntryKeys, shows: (id: string) => boolean): EntryKeys {
    return { make: (known, from, taken) => keys.make({ has: (id) => known.has(id) || shows(id), ids: () => known.ids() }, from, taken) };
}

/**
 * A rule that makes each key once, and no other for an entry whose key the
 * source came to hold as another's: the two entries stay a conflict to choose
 * between. For a collection whose other drafts name the entry by its key — a
 * transition its states, a link its ends: under another key such a name would
 * be left on the other write's entry, so the entry keeps the key it was given
 * until its collection moves those names with it.
 *
 * @param keys - The rule its keys are made by
 * @returns The policy
 */
export function onceKeys(keys: EntryKeys): EntryKeys {
    return { make: (known, from, taken) => (taken === undefined ? keys.make(known, from, taken) : undefined) };
}

/**
 * Placeholders: a text made up that no key of the source's type prints as,
 * for a new entry whose key a person types — a key of any type its form
 * edits. A placeholder names no entry the source holds, so it is never taken
 * by another's.
 *
 * @param isKey - Whether a text is a key of the source's type, as East prints one
 * @returns The policy
 */
export function placeholderKeys(isKey: (id: string) => boolean): EntryKeys {
    return {
        make: (known) => {
            for (;;) {
                const id = uuid();
                if (!isKey(id) && !known.has(id)) return id;
            }
        },
    };
}
