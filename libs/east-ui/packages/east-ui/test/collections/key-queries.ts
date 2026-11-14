/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The key queries a search box makes of some keys' values, for the specs that
 * hold a search to {@link findKeyInline} over every form: the key-search
 * grammar's ranges, and the record Slice's search of a scoped page (#1621).
 */

import { printFor, toEastTypeValue, type EastType, type EastTypeValue } from "@elaraai/east";
import { flattenKeyLeaves, type DatasetKeyQuery } from "@elaraai/east-ui/internal";

/** The value at a flattened field path. */
function leafAt(key: unknown, path: readonly string[]): unknown {
    let value = key;
    for (const segment of path) value = (value as Record<string, unknown>)[segment];
    return value;
}

/** A String's prefixes by code point, the empty one and itself among them. */
function prefixesOf(text: string): string[] {
    const points = [...text];
    return [...points.map((_, i) => points.slice(0, i).join("")), text];
}

/**
 * Every query a search box makes of some keys' values: each whole key; each
 * String's prefixes; each run of a Struct's leading fields, alone and with each
 * prefix of the next String field; and ranges over leading leaves, from, to,
 * and between one key and the next.
 *
 * @param type - The keys' type
 * @param probes - The values, each a key of the type
 * @returns The queries, in the order they are made
 */
export function queriesOf(type: EastType, probes: readonly unknown[]): DatasetKeyQuery[] {
    const typeValue = toEastTypeValue(type);
    const leaves = flattenKeyLeaves(typeValue);
    const leafLiterals = (key: unknown): string[] => leaves.map((leaf) => printFor(leaf.type)(leafAt(key, leaf.path) as never));
    const queries: DatasetKeyQuery[] = [];
    for (const [n, key] of probes.entries()) {
        queries.push({ key: printFor(typeValue)(key as never) });
        if (typeValue.type === "String") for (const prefix of prefixesOf(key as string)) queries.push({ prefix });
        if (typeValue.type === "Struct") {
            const fields = typeValue.value as { name: string; type: EastTypeValue }[];
            for (let j = 0; j <= fields.length; j++) {
                const exact = fields.slice(0, j).map((field) => printFor(field.type)((key as Record<string, unknown>)[field.name] as never));
                queries.push({ fields: exact });
                const next = fields[j];
                if (next?.type.type !== "String") continue;
                for (const prefix of prefixesOf((key as Record<string, string>)[next.name]!)) {
                    queries.push({ fields: exact, prefix });
                    if (j === 0) queries.push({ prefix });
                }
            }
        }
        const own = leafLiterals(key);
        const other = leafLiterals(probes[(n + 1) % probes.length]);
        for (let i = 1; i <= own.length; i++) {
            queries.push(
                { from: own.slice(0, i) },
                { to: own.slice(0, i) },
                { from: own.slice(0, i), to: other.slice(0, i) },
                { from: other.slice(0, i), to: own.slice(0, i) },
            );
        }
    }
    return queries;
}
