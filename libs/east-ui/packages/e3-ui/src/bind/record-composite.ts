/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a record's binding knows of a composite record (east-workspace#1465):
 * its sources, and the one check of whose an entry is.
 *
 * A composite record (`e3.recordComposite`) is one record over several
 * sources, each a case of the record's key and the authority for the entries
 * under it. An external source's entries are written by its load alone; the
 * record's mutations write the rest. `Record.bind` names the sources on the
 * handle's `binding`, and everything that must tell a loaded entry from one
 * of the solution's own asks {@link externalSourceOf}: a Save
 * (`Record.onApply`), a form over one entry, and each builder's lock.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    BooleanType,
    Expr,
    OptionType,
    StringType,
    StructType,
    compareFor,
    isTypeEqual,
    none,
    some,
    type EastType,
    type ExprType,
    type FunctionType,
    type ValueTypeOf,
    type VariantType,
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

/**
 * Words the refusal of a record's binding that names no sources: one a UI
 * exported by an e3-ui from before composite records makes, whose
 * `record_bind` takes the record's name alone.
 *
 * @remarks
 * What reads a UI's IR before it deploys (`deriveUiAccess`) and what binds
 * the record as the UI runs (`RecordRuntime`) refuse it in these words: a UI
 * is exported again, and no reader binds the form it had before.
 *
 * @param record - The record's name
 * @returns The refusal, which says to export the UI's package again
 */
export function bindingNamesNoSources(record: string): string {
    return `record_bind names no sources for record "${record}": an e3-ui from before composite records exported this UI — export its package again`;
}

/** {@link externalSourceOf}'s function, over a record's key type. */
export type ExternalSourceOf<K extends EastType = EastType> =
    ExprType<FunctionType<[K, RecordBindingSourcesType], OptionType<StringType>>>;

/**
 * Builds the one check of whose an entry is: an East function from an entry's
 * key and the binding's sources to the external source the key's case is.
 *
 * @remarks
 * An entry is its load's when its key's case names an external source among
 * the binding's. Every refusal of a write to such an entry asks this — the
 * Save's, a form's over one entry, and a builder's lock — so none works it
 * out alone, and the words each says name the source it answers.
 *
 * @typeParam K - The record's key type
 * @param keyType - The record's key type: a composite record's is a variant, a case a source
 * @returns The check: `some` with the source's name for a key of an external
 *   source's case, `none` for one of the solution's own — and always `none`
 *   over a key that is no variant, a plain record's
 *
 * @example
 * ```ts
 * import { East, OptionType, StringType, VariantType, variant } from "@elaraai/east";
 *
 * const OrderKeyType = VariantType({ erp: StringType, own: StringType });
 * const whose = externalSourceOf(OrderKeyType);
 * // Over a binding's sources [{ name: "erp", external: true }, { name: "own", external: false }]:
 * // whose(variant("erp", "SO-1001"), sources) is some("erp"); whose(variant("own", "N-1"), sources) is none
 * ```
 */
export function externalSourceOf<K extends EastType>(keyType: K): ExternalSourceOf<K> {
    const answer = OptionType(StringType);
    if (keyType.type !== "Variant") {
        return East.function([keyType, RecordBindingSourcesType], answer, (_$) => East.value(none, answer)) as unknown as ExternalSourceOf<K>;
    }
    const check = East.function([keyType as VariantType<Record<string, EastType>>, RecordBindingSourcesType], answer, ($, key, sources) => {
        const source = $.const(key.getTag());
        return sources.firstMap((_$, named) => named.external.and((_$) => East.equal(named.name, source)).ifElse(
            (_$) => East.value(some(named.name), answer),
            (_$) => East.value(none, answer),
        ));
    });
    return check as unknown as ExternalSourceOf<K>;
}

/**
 * Reads the sources a bound record's handle names, where an entry of the
 * record can be its load's.
 *
 * @param handle - A record's handle: `Record.bind`'s, or one typed by hand
 * @returns The handle's `binding.sources` and the record's key type;
 *   `undefined` where no entry can be a load's — a record that is no Dict or
 *   whose key is no variant, and a handle typed by hand whose binding names
 *   no sources
 */
export function sourcesOfHandle(handle: unknown): { readonly sources: ExprType<RecordBindingSourcesType>; readonly keyType: EastType } | undefined {
    const type = Expr.type(handle as Expr) as EastType;
    if (type.type !== "Struct") return undefined;
    const fields = type.fields as Record<string, EastType>;
    const read = fields["read"];
    const binding = fields["binding"];
    if (read?.type !== "Function" || binding?.type !== "Struct") return undefined;
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict" || (recordType.key as EastType).type !== "Variant") return undefined;
    const named = (binding.fields as Record<string, EastType>)["sources"];
    if (named === undefined || !isTypeEqual(named, RecordBindingSourcesType)) return undefined;
    const bound = handle as { binding: { sources: ExprType<RecordBindingSourcesType> } };
    return { sources: bound.binding.sources, keyType: recordType.key as EastType };
}
