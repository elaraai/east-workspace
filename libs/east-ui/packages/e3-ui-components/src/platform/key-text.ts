/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's key from its text (#1540): what a builder's wire carries a key
 * as — a String key as it is, any other key as East prints it (e3-ui's
 * `keyText`) — read back at the key's type. The one reader every renderer
 * reads a key's text by: a session's ids, a Save's read back by key, a field
 * a drop writes a key into, and a nested index's row.
 *
 * @packageDocumentation
 */

import { parseFor, type EastType } from "@elaraai/east";

/** Each key type's reader, made the first time a key of it is read: a pass over the rows reads key after key. */
const readers = new WeakMap<EastType, (text: string) => unknown>();

/**
 * A key's reader from its text: the text itself for a String key, and for any
 * other the key East printed it from, read back. Made once a key type.
 *
 * @param keyType - The key's type
 * @returns `(text)` → the key, or `undefined` where the text is no key of the type
 */
export function keyReaderOf(keyType: EastType): (text: string) => unknown {
    let reader = readers.get(keyType);
    if (reader === undefined) {
        if (keyType.type === "String") {
            reader = (text) => text;
        } else {
            const parse = parseFor(keyType);
            reader = (text) => {
                const read = parse(text);
                return read.success ? read.value : undefined;
            };
        }
        readers.set(keyType, reader);
    }
    return reader;
}
