/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kind's rows as its `rowsOf` makes them (#1393): each one's roles beside
 * its bytes, kept at the revision they were read at — those not yet made
 * made in one call — what the paged Backlog and the Index read of a kind read
 * by area outside its window.
 *
 * @packageDocumentation
 */

import { ArrayType, StringType, StructType, encodeBeast2For, equalFor, fromEastTypeValue, type StructType as StructTypeOf } from "@elaraai/east";
import type { RecordSliceEntry } from "@elaraai/east-ui/internal";
import type { SchematicValue } from "./data.js";

/** An item kind, decoded: what makes its rows' roles. */
type ItemKind = SchematicValue["items"][number];

/** A row as its kind's `rowsOf` makes it: its roles beside its bytes. */
export interface KindRow<R> {
    /** Its roles. */
    readonly roles: R;
    /** Its bytes: the row as the record holds it, beast2 of the kind's row type. */
    readonly row: Uint8Array;
}

/** Each kind's encoder of the rows it reads, as its `rowsOf` takes them: an Array of `{ key, row }`. */
type RowsEncoder = (rows: { key: string; row: unknown }[]) => Uint8Array;

const stringEqual = equalFor(StringType);

/** The most rows a kind keeps at a revision, past which they are made again as they are read again. */
const MAX_KEPT = 8_192;

/**
 * An entry's row: its joined row, or the whole row its index carries (D29).
 *
 * @param entry - The entry
 * @returns Its row; `undefined` for an entry that carries none
 */
export function entryRow(entry: RecordSliceEntry): unknown {
    if (entry.row?.type === "some") return entry.row.value;
    if (entry.value?.type === "some") return entry.value.value;
    return undefined;
}

/** Some kinds' rows as their `rowsOf` makes them (see the module docs). */
export class KindRows<R> {
    /** Each kind's rows, by key, at the revision they were read at. */
    private readonly kept = new Map<string, { readonly revision: string; readonly rows: Map<string, KindRow<R>> }>();
    /** Each kind's encoder, made once. */
    private readonly encoders = new WeakMap<object, RowsEncoder>();

    /**
     * Some rows of a kind, made: those not yet made at the revision made in one call of its `rowsOf`.
     *
     * @param kind - The kind
     * @param revision - The record's revision the rows were read at
     * @param rows - The rows, each its key and its row
     * @returns Each row's roles and bytes, by key — every row made at the revision, these among them
     */
    rowsOf(kind: ItemKind, revision: string, rows: readonly { readonly key: string; readonly row: unknown }[]): ReadonlyMap<string, KindRow<R>> {
        let kept = this.kept.get(kind.key);
        if (kept === undefined || !stringEqual(kept.revision, revision) || kept.rows.size > MAX_KEPT) {
            kept = { revision, rows: new Map() };
            this.kept.set(kind.key, kept);
        }
        const missing = rows.filter(({ key }) => !kept!.rows.has(key));
        if (missing.length > 0) {
            const made = (kind.rowsOf as (bytes: Uint8Array) => ReadonlyMap<string, KindRow<R>>)(this.encoderOf(kind)(missing.map(({ key, row }) => ({ key, row }))));
            for (const [key, row] of made) kept.rows.set(key, row);
        }
        return kept.rows;
    }

    /**
     * A row of a kind made at the revision it was read at.
     *
     * @param slot - The kind's slot
     * @param key - The row's key
     * @returns Its bytes and the revision they were read at; `undefined` for a row not made
     */
    rowOf(slot: string, key: string): { readonly revision: string; readonly row: Uint8Array } | undefined {
        const kept = this.kept.get(slot);
        const row = kept?.rows.get(key);
        return kept === undefined || row === undefined ? undefined : { revision: kept.revision, row: row.row };
    }

    /** A kind's encoder of the rows it reads, made once per kind. */
    private encoderOf(kind: ItemKind): RowsEncoder {
        let encode = this.encoders.get(kind);
        if (encode === undefined) {
            const row = fromEastTypeValue(kind.rowType) as StructTypeOf;
            encode = encodeBeast2For(ArrayType(StructType({ key: StringType, row }))) as RowsEncoder;
            this.encoders.set(kind, encode);
        }
        return encode;
    }
}
