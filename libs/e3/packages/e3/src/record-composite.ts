/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Composite records: one record over several sources of record.
 *
 * A solution's records mostly hold two kinds of entries side by side: entries
 * kept for another system (its orders, as it states them) and the solution's
 * own (its plans and decisions). `e3.recordComposite` declares one record over
 * both: each **source** is the authority for its own entries — an external
 * one written only by its load, the solution's written by the record's
 * mutations — and an entry's key names its source, so no write of one source
 * can touch another's.
 */

import { DictType, SortedMap, VariantType, compareFor, isValueOf, printType, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { editTypeOf } from '@elaraai/e3-types';
import type { CompositeRecordDef, RecordDef, RecordSourceDef } from './types.js';
import { builderOf, declareRecord, declaredObject, partsOf, type EditCapability, type RecordConfig, type RecordTypes } from './record.js';
import {
  SOURCE_BUILDER,
  type IndexBuilder, type IndexDraft, type IndexesOf, type MigrationBuilder, type MigrationDraft, type MutationBuilder, type MutationDraft, type MutationsOf,
  type SourceBuilder, type SourceDraft,
} from './record-builders.js';
import { solutionKeyType } from './record-sources.js';

/** A composite record's key cases: each source's key type, by the source's name. */
export type SourceKeysOf<S> = { [N in keyof S & string]: S[N] extends SourceDraft<infer K, boolean> ? K : never };

/** The key cases of the sources a composite record's mutations write: the solution's own. */
export type SolutionKeysOf<S> = {
  [N in keyof S & string as S[N] extends SourceDraft<EastType, false> ? N : never]: S[N] extends SourceDraft<infer K, boolean> ? K : never
};

/** A composite record's state type: `Dict<Variant{ <source>: <key>… }, Row>`. */
export type CompositeStateOf<S, Row extends EastType> = DictType<VariantType<SourceKeysOf<S>>, Row>;

/** The capability a composite record's `edit` bodies write through: over its solution sources' keys alone; none where it has none. */
export type CompositeEditOf<S, Row extends EastType> = [keyof SolutionKeysOf<S>] extends [never]
  ? undefined
  : EditCapability<VariantType<SolutionKeysOf<S>>, Row>;

/** A composite record's sources as declared, by name. */
export type SourcesOf<S> = {
  readonly [N in keyof S & string]: S[N] extends SourceDraft<infer K, infer External> ? RecordSourceDef<N, K, External> : never
};

/** The types a composite record's parts are handed: its built state and key, and the capability over its own sources' keys. */
export type CompositeTypes<S, Row extends EastType> = RecordTypes<CompositeStateOf<S, Row>, CompositeEditOf<S, Row>>;

/**
 * What `e3.recordComposite` takes beside its name and its row type.
 *
 * @typeParam Row - The record's row type
 * @typeParam S - Its sources, as `sources` returns them
 * @typeParam I - Its indexes, as `indexes` returns them
 * @typeParam M - Its mutations, as `mutations` returns them
 */
export interface CompositeRecordConfig<Row extends EastType, S extends object, I extends object, M extends object> {
  /** Its sources by name, from the `source` builder. Declared first: the parts
   *  after it are handed the types it makes. */
  readonly sources: (source: SourceBuilder<Row>) => S;
  /**
   * The initial entries of each source of the solution's own, by the source's
   * own key — e3 puts the source's case on — each a value, or a function that
   * makes it once, as the package is exported. A source it does not name
   * starts with none. An external source has no initial entries: they come
   * from its load.
   */
  readonly initial?: {
    readonly [N in keyof SolutionKeysOf<S>]?:
      NoInfer<ValueTypeOf<DictType<SolutionKeysOf<S>[N], Row>>> | (() => NoInfer<ValueTypeOf<DictType<SolutionKeysOf<S>[N], Row>>>)
  };
  /** Its indexes by name, over every source's entries, from the `index` builder. */
  readonly indexes?: (index: IndexBuilder<CompositeStateOf<S, Row>>, types: CompositeTypes<S, Row>) => I;
  /** Its mutations by name, from the `mutation` builder: they write the entries of its own sources. */
  readonly mutations?: (mutation: MutationBuilder<CompositeStateOf<S, Row>>, types: CompositeTypes<S, Row>) => M;
  /** Its migrations in order, each named, from the `migration` builder. */
  readonly migrations?: (migration: MigrationBuilder, types: CompositeTypes<S, Row>) => readonly MigrationDraft[];
}

/**
 * Defines a composite record: one record over several sources, each the
 * authority for its own entries.
 *
 * It is a record, declared whole as `e3.record` declares one: one dataset at
 * `.records.${name}` with one history, its indexes over every source's entries,
 * read, paged, indexed and bound as any record is. e3 builds its type from its
 * sources, `Dict<Variant{ <source>: <key>… }, Row>`: an entry's key names its
 * source, and since a variant orders by its case before its value, each
 * source's entries are one run of the record.
 *
 * A source is **external** (`source.load`), written only by its load, or the
 * **solution's own** (`source.mutations`), written by the record's mutations.
 * No mutation, patch or view's save writes an external source's entry: such a
 * write is refused as `invalid`, naming the key and the source, and an `edit`
 * body handed the record's `edit` capability cannot name one at all.
 *
 * `sources` is declared first, and the parts after it are handed the types it
 * makes as a second argument, `{ state, key, edit }`: the built state type,
 * the record's key, and the capability an `edit` body writes its own sources'
 * entries through. A composite always holds a state: declared with no
 * `initial`, it starts with no entries of its own.
 *
 * @typeParam Name - Record name (literal type)
 * @typeParam Row - The East type of a row, whatever its source
 * @typeParam S - Its sources, as `sources` returns them
 * @typeParam I - Its indexes, as `indexes` returns them
 * @typeParam M - Its mutations, as `mutations` returns them
 * @param name - Record name (used as path segment in the tree)
 * @param row - East type of a row
 * @param config - `sources`, then `initial`, `indexes`, `mutations` and `migrations`
 * @returns A CompositeRecordDef, usable anywhere a record is, its sources and its parts by name
 * @throws {Error} Naming the record and the source or the part: a declaration that is not an object of `sources`,
 *   `initial`, `indexes`, `mutations` and `migrations`; no source, or one whose name is not an identifier or that the
 *   `source` builder did not make; a source keyed by a type no Dict is keyed by; a load whose delivery is not a
 *   type, or whose function is async, calls a platform function or is not `(delivery, Dict<key, Row>) ->
 *   Patch(Dict<key, Row>)`; an `initial` that names an external source, or no source of the record, or entries that
 *   are not the source's; mutations declared with no source of the solution's own to write; or anything
 *   `e3.record` refuses of a part
 *
 * @example
 * ```ts
 * import { DictType, East, IntegerType, NullType, PatchType, StringType, StructType, variant } from '@elaraai/east';
 * import e3 from '@elaraai/e3';
 *
 * const Order = StructType({ customer: StringType, status: StringType, qty: IntegerType });
 * const ErpDelivery = DictType(StringType, StructType({ cust: StringType, state: StringType, qty: IntegerType }));
 * const loadErp = East.function(
 *   [ErpDelivery, DictType(StringType, Order)], PatchType(DictType(StringType, Order)),
 *   ($, delivery, current) => East.diff(current, delivery.map(($, o) => ({ customer: o.cust, status: o.state, qty: o.qty }))),
 * );
 *
 * export const orders = e3.recordComposite('orders', Order, {
 *   sources: (source) => ({
 *     erp: source.load(StringType, ErpDelivery, loadErp),
 *     own: source.mutations(StringType),
 *   }),
 *   initial: { own: new Map() },
 *   indexes: (index) => ({ by_customer: index.on(['customer']) }),
 *   mutations: (mutation, { state, edit }) => ({
 *     // `edit` writes the solution's own entries: variant('erp', id) does not compile here
 *     plan_order: mutation.edit(East.function([state, StringType, Order, edit], NullType, ($, _current, id, order, edit) => {
 *       $(edit.set(variant('own', id), order));
 *     })),
 *     patch: mutation.patch(),
 *   }),
 * });
 * // orders.type: Dict<Variant{ erp: String, own: String }, Order>
 * ```
 */
export function recordComposite<
  Name extends string,
  Row extends EastType,
  S extends Readonly<Record<string, SourceDraft>>,
  I extends Readonly<Record<string, IndexDraft>> = Record<never, never>,
  M extends Readonly<Record<string, MutationDraft>> = Record<never, never>,
>(
  name: Name,
  row: Row,
  config: CompositeRecordConfig<Row, S, I, M>,
): CompositeRecordDef<
  CompositeStateOf<S, Row>,
  [variant<'field', 'records'>, variant<'field', Name>],
  SourcesOf<S>,
  IndexesOf<I, CompositeStateOf<S, Row>>,
  MutationsOf<M, CompositeStateOf<S, Row>>
>;
export function recordComposite(name: string, row: EastType, declared: unknown): RecordDef {
  const where = `e3.recordComposite '${name}'`;
  const config = declarationOf(where, declared);
  const sources = sourcesOf(where, row, config.sources(SOURCE_BUILDER));
  const keyType = VariantType(Object.fromEntries(Object.values(sources).map((source): [string, EastType] => [source.name, source.key])));
  const ownKey = solutionKeyType(sources);
  if (config.mutations !== undefined && ownKey === undefined) {
    throw new Error(
      `${where} declares mutations, and has no source of its own for them to write: every source is a load's — ` +
      'declare one as source.mutations(key)');
  }
  const parts: RecordConfig<EastType, object, object> = {
    // A composite always holds a state: its own sources' entries, or none.
    initial: initialOf(where, sources, keyType, row, config.initial),
    ...(config.indexes !== undefined && { indexes: config.indexes }),
    ...(config.mutations !== undefined && { mutations: config.mutations }),
    ...(config.migrations !== undefined && { migrations: config.migrations }),
  };
  return declareRecord(where, name, DictType(keyType, row), parts, {
    sources,
    edit: ownKey === undefined ? undefined : editTypeOf(DictType(ownKey, row)),
  });
}

/** What `e3.recordComposite` takes beside its name and its row type. */
const CONFIG_KEYS: readonly string[] = ['sources', 'initial', 'indexes', 'mutations', 'migrations'];

/** A source's name is an identifier: it is a case of the record's key, and it
 *  names its load's commits, `$load:<source>`. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A composite's declaration as its parts' functions are called: each with its builder and the record's types. */
interface Declared {
  readonly sources: (source: typeof SOURCE_BUILDER) => unknown;
  readonly initial?: unknown;
  readonly indexes?: RecordConfig<EastType, object, object>['indexes'];
  readonly mutations?: RecordConfig<EastType, object, object>['mutations'];
  readonly migrations?: RecordConfig<EastType, object, object>['migrations'];
}

/**
 * `e3.recordComposite`'s declaration, checked: a plain object of its sources'
 * function, its initial entries and its parts' functions, and nothing else.
 *
 * @param where - The record, as a refusal names it
 * @param declared - What was given
 * @returns The declaration
 * @throws {Error} For anything else
 */
function declarationOf(where: string, declared: unknown): Declared {
  const given = declaredObject(where, declared, CONFIG_KEYS, ['sources']);
  if (typeof given.sources !== 'function') {
    throw new Error(`${where} declares its sources first, as a function of its builder — sources: (source) => ({ own: source.mutations(key) })`);
  }
  return declared as Declared;
}

/**
 * A composite's sources as built, by name, in the order declared.
 *
 * @param where - The record, as a refusal names it
 * @param row - Its row type
 * @param returned - What `sources` returned
 * @returns The sources, frozen
 * @throws {Error} Naming the record and the source
 */
function sourcesOf(where: string, row: EastType, returned: unknown): Readonly<Record<string, RecordSourceDef>> {
  const sources: Record<string, RecordSourceDef> = {};
  for (const [name, draft] of partsOf(where, 'sources', returned, '{ erp: source.load(key, delivery, fn), own: source.mutations(key) }')) {
    if (!IDENTIFIER.test(name)) {
      throw new Error(`${where}: source '${name}' must be named by an identifier — it is a case of the record's key, and names its load's commits`);
    }
    sources[name] = builderOf(where, 'source', name, draft).build(where, name, row);
  }
  if (Object.keys(sources).length === 0) {
    throw new Error(`${where} declares no source — a composite record holds its sources' entries: declare each as source.load(key, delivery, fn) or source.mutations(key)`);
  }
  return Object.freeze(sources);
}

/**
 * A composite's initial state: each of its own sources' declared entries
 * under the source's case, in the record's key order; no entries where none
 * is declared. A function where any source's entries are made by one, so a
 * large initial state is made as the package is exported.
 *
 * @param where - The record, as a refusal names it
 * @param sources - Its sources
 * @param keyType - Its key type
 * @param row - Its row type
 * @param declared - What `initial` was given
 * @returns The state, or the function that makes it
 * @throws {Error} When `initial` is not an object of its own sources' entries
 */
function initialOf(
  where: string, sources: Readonly<Record<string, RecordSourceDef>>, keyType: EastType, row: EastType, declared: unknown,
): SortedMap<unknown, unknown> | (() => SortedMap<unknown, unknown>) {
  if (declared !== undefined && (typeof declared !== 'object' || declared === null || Object.getPrototypeOf(declared) !== Object.prototype)) {
    throw new Error(`${where}: initial names the entries of each source of its own, by the source's own key — initial: { own: new Map() }`);
  }
  const given = (declared ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(given)) {
    const source = sources[name];
    if (source === undefined) {
      throw new Error(`${where}: initial names '${name}', which is no source of the record — its sources are ${Object.keys(sources).map((each) => `'${each}'`).join(', ')}`);
    }
    if (source.external) {
      throw new Error(`${where}: initial names '${name}', an external source — its entries come from its load, and it holds none until its first delivery`);
    }
  }
  const make = (): SortedMap<unknown, unknown> => {
    const entries: [unknown, unknown][] = [];
    for (const [name, of] of Object.entries(given)) {
      const made: unknown = typeof of === 'function' ? (of as () => unknown)() : of;
      const type = DictType(sources[name]!.key, row);
      if (!isValueOf(made, type)) {
        throw new Error(`${where}: initial.${name} holds the source's entries by its own key, a ${printType(type)}`);
      }
      // Checked above to be the Dict's value: a Map of the source's entries.
      for (const [key, value] of made as ValueTypeOf<typeof type>) entries.push([variant(name, key), value]);
    }
    return new SortedMap(entries, compareFor(keyType));
  };
  return Object.values(given).some((of) => typeof of === 'function') ? make : make();
}
