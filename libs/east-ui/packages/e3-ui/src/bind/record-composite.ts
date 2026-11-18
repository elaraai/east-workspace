/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a record's binding knows of a composite record (east-workspace#1465):
 * its sources.
 *
 * A composite record (`e3.recordComposite`) is one record over several
 * sources, each a case of the record's key and the authority for the entries
 * under it. An external source's entries are written by its load alone; the
 * record's mutations write the rest. `Record.bind` names the sources on the
 * handle's `binding`, so whatever must tell a loaded entry from one of the
 * solution's own can.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    StringType,
    StructType,
    compareFor,
    type EastType,
    type ValueTypeOf,
} from '@elaraai/east';
import type { RecordDef } from '@elaraai/e3';

/**
 * One source of a composite record, as a record's binding names it.
 *
 * @property name - The source's name: its case of the record's key
 * @property external - Whether its load alone writes its entries; false for a
 *   source of the solution's own, which the record's mutations write
 */
export const RecordBindingSourceType = StructType({
    name:     StringType,
    external: BooleanType,
});

/** Type representing the {@link RecordBindingSourceType} structure. */
export type RecordBindingSourceType = typeof RecordBindingSourceType;

/**
 * The sources a record's binding names: a composite record's, in the order of
 * its key's cases; none for a plain record.
 */
export const RecordBindingSourcesType = ArrayType(RecordBindingSourceType);

/** Type representing the {@link RecordBindingSourcesType} structure. */
export type RecordBindingSourcesType = typeof RecordBindingSourcesType;

const compareNames = compareFor(StringType);

/**
 * Lists the sources a record's binding names, from the record's declaration.
 *
 * @param record - The record, as `e3.record` or `e3.recordComposite` declared
 *   it: what is read of it is its `sources`
 * @returns Each source's name and whether it is external, in the order of the
 *   record's key's cases — East's order of their names; none for a plain record
 */
export function bindingSources(record: Pick<RecordDef<EastType>, "sources">): ValueTypeOf<RecordBindingSourcesType> {
    const declared = record.sources;
    if (declared === undefined) return [];
    return Object.values(declared)
        .map((source) => ({ name: source.name, external: source.external }))
        .sort((a, b) => compareNames(a.name, b.name));
}
