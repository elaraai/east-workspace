/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kind's keys as the Flowchart and the Schematic speak them (#1549): a
 * kind's record may be keyed by any type a Dict takes, and every key travels
 * as its text — a String key as itself, any other as East prints it — which a
 * reference, a row's id, the drawing and a kind's `rowsOf` name a row by. A
 * text is read back at the record's key type where the record is read by key,
 * asked of its narrowing or sought; and where a builder orders keys, it orders
 * them by their type, each text parsed once — never inside a comparison — and
 * never by their text.
 *
 * @packageDocumentation
 */

import { StringType, compareFor, fromEastTypeValue, parseFor, printFor, toEastTypeValue, type EastTypeValue } from "@elaraai/east";

const compareString = compareFor(StringType);

/** A key's text, beside the key it reads back as: `undefined` for a text no key prints as. */
export interface KeyText {
    /** The text. */
    readonly text: string;
    /** The key, at the record's key type; `undefined` for a text no key prints as. */
    readonly key: unknown;
}

/** A kind's keys (see the module docs). */
export interface KindKeys {
    /** The record's key type. */
    readonly keyType: EastTypeValue;
    /** Whether the record is keyed by String: a key's text is the key itself. */
    readonly text: boolean;
    /** A key's text: a String key as itself, any other as East prints it. */
    readonly textOf: (key: unknown) => string;
    /** A text read back at the record's key type; `undefined` for a text no key prints as. */
    readonly keyOf: (text: string) => unknown;
    /**
     * Some keys' texts in their keys' order at the record's key type, each beside its key: each read back once, and a
     * text no key prints as after every key, in its text's order.
     */
    readonly order: (texts: Iterable<string>) => KeyText[];
    /** Each of some keys' texts' place in their keys' order ({@link KindKeys.order}): what a sort by something and then by key compares. */
    readonly ranks: (texts: Iterable<string>) => ReadonlyMap<string, number>;
}

/** Each text's place in an order. */
function ranksOf(order: KindKeys["order"]): KindKeys["ranks"] {
    return (texts) => new Map(order(texts).map(({ text }, i) => [text, i]));
}

/** Each key type's keys, made once a key type. */
const keysOf = new WeakMap<EastTypeValue, KindKeys>();

/**
 * A kind's keys (see the module docs), made once for its key type.
 *
 * @param keyType - The kind's record's key type, as its wire carries it: its details' too, which are keyed as it is
 * @returns Its keys' text, a text read back, and their order
 */
export function kindKeys(keyType: EastTypeValue): KindKeys {
    let keys = keysOf.get(keyType);
    if (keys !== undefined) return keys;
    if (keyType.type === "String") {
        const order: KindKeys["order"] = (texts) => [...texts].sort(compareString).map((text) => ({ text, key: text }));
        keys = { keyType, text: true, textOf: (key) => key as string, keyOf: (text) => text, order, ranks: ranksOf(order) };
    } else {
        const print = printFor(keyType);
        const parse = parseFor(keyType);
        const compare = compareFor(fromEastTypeValue(keyType)) as (a: unknown, b: unknown) => number;
        const keyOf = (text: string): unknown => {
            const read = parse(text);
            return read.success ? read.value : undefined;
        };
        const order: KindKeys["order"] = (texts) => [...texts].map((text) => ({ text, key: keyOf(text) })).sort((a, b) => {
            if (a.key !== undefined && b.key !== undefined) return compare(a.key, b.key);
            // A text no key prints as — a placeholder — after every key, in its text's order.
            if (a.key !== undefined) return -1;
            if (b.key !== undefined) return 1;
            return compareString(a.text, b.text);
        });
        keys = { keyType, text: false, textOf: (key) => print(key), keyOf, order, ranks: ranksOf(order) };
    }
    keysOf.set(keyType, keys);
    return keys;
}

/** A record keyed by String's keys: every builder's but the Flowchart's and the Schematic's. */
export const STRING_KEYS: KindKeys = kindKeys(toEastTypeValue(StringType));
