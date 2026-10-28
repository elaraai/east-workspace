/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A paged source's key search, from East's form to e3's wire: what the paged
 * runtime asks e3 with, a search at a time and in batches (#1351).
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "@elaraai/east-ui";
import type { DatasetFindQuery } from "@elaraai/e3-api-client";

/** Which rows a search reads: the dataset's own, or one of a record's indexes. */
interface Selected {
    /** The index's name, or `null` for the dataset itself. */
    readonly index: string | null;
}

/**
 * The decoded East {@link SeekQueryType} value as e3's wire query.
 *
 * The two are deliberately the same shapes, so this is a re-tagging rather
 * than a translation: `.east` literals stay text, and the East option on the
 * `fields` arm, like an open end of a `range`, becomes an absent property
 * (`exactOptionalPropertyTypes`).
 *
 * @param query - The search, a decoded `SeekQueryType` value
 * @param selector - The rows it searches; the dataset's own when absent
 * @returns The wire query, naming the index when the rows are an index's
 * @throws {Error} When a range names neither end
 */
export function toFindQuery(query: unknown, selector: Selected = { index: null }): DatasetFindQuery {
    const q = query as ValueTypeOf<typeof SeekQueryType>;
    const scope = selector.index === null ? {} : { index: selector.index };
    if (q.type === "key") return { key: q.value, ...scope };
    if (q.type === "prefix") return { prefix: q.value, ...scope };
    if (q.type === "range") {
        // A half-open bound on a leading prefix of the FLATTENED key — an
        // empty side is an open end, which the wire says by omitting it. Open
        // at both ends it names no run, and a server refuses it with an error
        // the retry gate would keep re-asking, so it is refused here instead.
        const r = q.value;
        const from = [...r.from];
        const to = [...r.to];
        if (from.length === 0 && to.length === 0) {
            throw new Error("Data.bindPaged: a range seek names no end — give it a `from`, a `to`, or both");
        }
        return from.length === 0 ? { to, ...scope } : to.length === 0 ? { from, ...scope } : { from, to, ...scope };
    }
    const f = q.value;
    const fields = [...f.values];
    return f.prefix.type === "some"
        ? { fields, prefix: f.prefix.value, ...scope }
        : { fields, ...scope };
}
