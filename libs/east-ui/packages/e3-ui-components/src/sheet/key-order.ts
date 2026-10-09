/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a keyed source's rows sort (#880, #1182): by key, at the key's own
 * type. A row's id is its key's text — a String key itself, any other key its
 * `.east` printing — so a key that is not a String is read back from its id
 * and compared as what it is: a record keyed by number puts 9 before 10.
 *
 * @packageDocumentation
 */
import { compareFor, parseFor, StringType, type EastTypeValue } from "@elaraai/east";

const compareText = compareFor(StringType);

/**
 * The order of a keyed source's row ids, at the key's own type.
 *
 * @param keyType - The source's key type, as the editing wire carries it
 * @returns A comparator over row ids: by key, with an id that names no key of the type after every key, by its text
 */
export function keyOrderOf(keyType: EastTypeValue): (a: string, b: string) => number {
    if (keyType.type === "String") return compareText;
    const parse = parseFor(keyType);
    const compare = compareFor(keyType);
    // Each id's key, read once.
    const keys = new Map<string, { key: unknown } | null>();
    const keyOf = (id: string): { key: unknown } | null => {
        let found = keys.get(id);
        if (found === undefined) {
            const parsed = parse(id);
            found = parsed.success ? { key: parsed.value } : null;
            keys.set(id, found);
        }
        return found;
    };
    return (a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (ka !== null && kb !== null) return compare(ka.key, kb.key);
        if (ka !== null) return -1;
        if (kb !== null) return 1;
        return compareText(a, b);
    };
}
