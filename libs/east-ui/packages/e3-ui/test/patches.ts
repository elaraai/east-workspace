/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An optimiser's answer laid over rows, key by key, as a builder lands it
 * (east-workspace#1622, rule 7): what a spec reads an answer as — the rows a
 * Save of it would leave — to hold the rows to what the answer says of them.
 * Its changes are e3-ui's `optimiseChangesFor`, so a patch of the whole Dict
 * lands as its rows removed and added, never as the record replaced; an insert
 * onto a key the rows hold already fails, as it is a conflict to choose.
 *
 * @packageDocumentation
 */

import { East, PatchType, type DictType, type EastType, type ExprType, type ValueTypeOf, type VariantType } from "@elaraai/east";
import { optimiseChangesFor } from "@elaraai/e3-ui/internal";

/**
 * The rows an answer leaves, laid over rows of a record's type, key by key.
 *
 * @typeParam T - The record's type
 * @param type - The record's type, `Dict<K, R>`
 * @returns The rows and a patch of them in, the rows it leaves out
 */
export function patchedFor<T extends DictType<EastType, EastType>>(type: T): (rows: unknown, patch: unknown) => ValueTypeOf<T> {
    const rowsType: DictType<EastType, EastType> = type;
    const apply = East.compile(East.function([rowsType, PatchType(rowsType)], rowsType, ($, rows, patch) => {
        const changesOf = $.const(optimiseChangesFor(rowsType));
        const after = $.let(rows.copy());
        $.for(changesOf(patch as never), ($2, change, key) => {
            const op = change as unknown as ExprType<VariantType<{ insert: EastType; delete: EastType; update: EastType }>>;
            $2.match(op, {
                insert: ($3, row) => { $3(after.insert(key as never, row as never)); },
                delete: ($3) => { $3(after.delete(key as never)); },
                update: ($3, rowPatch) => { $3(after.update(key as never, East.applyPatch(after.get(key as never) as never, rowPatch as never) as never)); },
            });
        });
        return after;
    }), []);
    return (rows, patch) => apply(rows as never, patch as never) as ValueTypeOf<T>;
}
