/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's reference record (#1551): a record of the app's its check reads
 * beside the builder's own rows — the Roster's rota, the Allocation's
 * delivery schedule — through the slice's source named `reference`. The
 * builder writes its period's window into that source as into its own kind's
 * (`useSourceWindow`), and the payload reads its rows over a window through
 * the source's interval index (`ScheduleReferenceType`'s `rows`), as bytes —
 * each week of a month its own; the builder's data reader
 * reads the period's windows with its other reads, decodes each row once
 * (`referenceDecoder`, `keptReference`) and hands the check its period's rows
 * by key. Nothing draws them and the rail leaves the source out (`useRailSources`):
 * it narrows nothing, so it offers no field and counts no row.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { BlobType, EastTypeType, SortedMap, StringType, compareFor, decodeBeast2For, equalFor, fromEastTypeValue, type EastType, type EastTypeValue, type ValueTypeOf } from "@elaraai/east";
import type { RecordSlicesBindType } from "@elaraai/east-ui/internal";
import { SCHEDULE_REFERENCE } from "@elaraai/e3-ui/internal";

const sameName = equalFor(StringType);
const sameType = equalFor(EastTypeType);
const sameBytes = equalFor(BlobType);
const byKey = compareFor(StringType);

/** A Slice over several records, as the payload's chrome carries it. */
type Product = ValueTypeOf<RecordSlicesBindType>;

/**
 * The slice the rail draws: the payload's, its `reference` source left out —
 * a record only the check reads, which narrows nothing, so the rail offers
 * none of its fields and counts none of its rows. The same object while the
 * payload's is, and the payload's itself where it has no such source.
 *
 * @param slices - The payload's slice; `undefined` with none
 * @returns What the rail is drawn from
 */
export function useRailSources(slices: Product | undefined): Product | undefined {
    return useMemo(() => slices === undefined || !slices.parts.some(part => sameName(part.source, SCHEDULE_REFERENCE)) ? slices
        : { ...slices, parts: slices.parts.filter(part => !sameName(part.source, SCHEDULE_REFERENCE)) }, [slices]);
}

/** A reference record's rows read over a window, each decoded once: what the check is given. */
export interface ReferenceRows {
    /** Each row's bytes, by key: what a read again keeps a row by. */
    readonly bytes: SortedMap<string, Uint8Array>;
    /** Each row, decoded, by key in key order: the check's `reference`. */
    readonly rows: SortedMap<string, unknown>;
}

/** No rows: a window the record holds none of. */
export const NO_REFERENCE_ROWS: ReferenceRows = { bytes: new SortedMap([], byKey), rows: new SortedMap([], byKey) };

const decoders: { type: EastTypeValue; decode: (bytes: Uint8Array) => unknown }[] = [];

/**
 * The decoder of a reference record's rows, made the first time its row type
 * is seen, then shared — East decides which types are the same.
 *
 * @param rowType - The record's row type, as the payload carries it
 * @returns Its rows' decoder
 */
export function referenceDecoder(rowType: EastTypeValue): (bytes: Uint8Array) => unknown {
    const known = decoders.find(d => sameType(d.type, rowType));
    if (known !== undefined) return known.decode;
    const decode = decodeBeast2For(fromEastTypeValue(rowType) as EastType) as (bytes: Uint8Array) => unknown;
    decoders.push({ type: rowType, decode });
    return decode;
}

/**
 * A window's rows read again, each kept as it was where its bytes are: its
 * row not decoded again, and the rows held the same object while every row
 * reads as it did.
 *
 * @param read - The window's rows, by key, as their bytes
 * @param held - What the window held last; `undefined` the first time
 * @param decode - The rows' decoder ({@link referenceDecoder})
 * @returns The window's rows
 */
export function keptReference(read: ReadonlyMap<string, Uint8Array>, held: ReferenceRows | undefined, decode: (bytes: Uint8Array) => unknown): ReferenceRows {
    if (read.size === 0) return held !== undefined && held.bytes.size === 0 ? held : NO_REFERENCE_ROWS;
    const bytes = new SortedMap<string, Uint8Array>([], byKey), rows = new SortedMap<string, unknown>([], byKey);
    let same = held !== undefined && held.bytes.size === read.size;
    for (const [key, entry] of read) {
        const was = held?.bytes.get(key);
        if (held !== undefined && was !== undefined && sameBytes(was, entry)) { bytes.set(key, was); rows.set(key, held.rows.get(key)); continue; }
        same = false;
        bytes.set(key, entry);
        rows.set(key, decode(entry));
    }
    return same && held !== undefined ? held : { bytes, rows };
}
