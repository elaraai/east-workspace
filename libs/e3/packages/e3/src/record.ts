/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Record dataset definitions for e3 packages.
 *
 * `e3.record` declares a root dataset written only through the typed, pure
 * East mutations its declaration names, never by blind replace: durable,
 * audited, compare-and-swap state that participates in reactive dataflow as a
 * root input. The current state reads exactly like a value dataset; only the
 * write protocol differs.
 */

import type { DictType, EastType, FunctionType, NullType, PatchTypeOf, SetType, StructType, ValueTypeOf } from '@elaraai/east';
import { isValueOf, printType, variant } from '@elaraai/east';
import { editTypeOf } from '@elaraai/e3-types';
import type { DataTreeDef, MigrationDef, MutationDef, RecordDef, RecordIndexDef } from './types.js';
import {
  INDEX_BUILDER, MIGRATION_BUILDER, MUTATION_BUILDER, RECORD_PART,
  type IndexBuilder, type IndexDraft, type IndexesOf, type MigrationBuilder, type MigrationDraft, type MutationBuilder, type MutationDraft, type MutationsOf,
} from './record-builders.js';
import { sameEastType } from './record-guards.js';

/**
 * The capability an `edit` body writes a Dict record through, as an East type:
 * `set`, `delete` and `update` over the keys it may write.
 *
 * @typeParam K - The key type it writes
 * @typeParam V - The record's row type
 */
export type EditCapability<K extends EastType, V extends EastType> = StructType<{
  set: FunctionType<[K, V], NullType>;
  delete: FunctionType<[K], NullType>;
  update: FunctionType<[K, PatchTypeOf<V>], NullType>;
}>;

/** A Dict record's key type, or a Set record's element type; none for any other record. */
export type RecordKeyOf<T> = T extends DictType<infer K, EastType> ? K : T extends SetType<infer K> ? K : undefined;

/** The capability a Dict record's `edit` bodies write through, over its every key; none for any other record. */
export type RecordEditOf<T> = T extends DictType<infer K extends EastType, infer V extends EastType> ? EditCapability<K, V> : undefined;

/**
 * A record's types, as its declaration is handed them: the second argument of
 * `indexes`, `mutations` and `migrations`, beside each one's builder, so a
 * part's function is typed by the record without naming its type again.
 *
 * @typeParam T - The record's state type
 * @typeParam E - The type of the capability its `edit` bodies write through
 *
 * @example
 * ```ts
 * const plans = e3.record('plans', DictType(StringType, PlanType), {
 *   initial: new Map(),
 *   mutations: (mutation, { state, edit }) => ({
 *     // The body's state and its capability are the record's, by its own types
 *     retitle: mutation.edit(East.function([state, StringType, StringType, edit], NullType, ($, plans, id, title, edit) => {
 *       const plan = $.let(plans.get(id));
 *       $(edit.set(id, { title, owner: plan.owner }));
 *     })),
 *   }),
 * });
 * ```
 */
export interface RecordTypes<T extends EastType, E = RecordEditOf<T>> {
  /** The record's state type. */
  readonly state: T;
  /** A Dict record's key type, or a Set record's element type; undefined for
   *  any other record. */
  readonly key: RecordKeyOf<T>;
  /** The capability an `edit` body writes through, its last parameter: what
   *  `e3.mutation.editType(state)` gives. Undefined for a record that is not
   *  a Dict, which an `edit` does not write. */
  readonly edit: E;
}

/**
 * What `e3.record` takes beside its name and type: its initial state, and its
 * parts through the builders it hands each.
 *
 * @typeParam T - The record's state type
 * @typeParam I - Its indexes, as `indexes` returns them
 * @typeParam M - Its mutations, as `mutations` returns them
 */
export interface RecordConfig<T extends EastType, I extends object, M extends object> {
  /**
   * The initial state, the genesis commit, or a function that makes it — once,
   * when it is first read, as its package is exported: a large one is never
   * made where the declaration is only read, as a page binding the record
   * reads it. Omitted for a record whose first state is committed from outside.
   */
  readonly initial?: NoInfer<ValueTypeOf<T>> | (() => NoInfer<ValueTypeOf<T>>);
  /** Its indexes by name, from the `index` builder, which is handed the record's types beside it. */
  readonly indexes?: (index: IndexBuilder<T>, types: RecordTypes<T>) => I;
  /** Its mutations by name, from the `mutation` builder, which is handed the record's types beside it. */
  readonly mutations?: (mutation: MutationBuilder<T>, types: RecordTypes<T>) => M;
  /** Its migrations in order, each named, from the `migration` builder, which is handed the record's types beside it. */
  readonly migrations?: (migration: MigrationBuilder, types: RecordTypes<T>) => readonly MigrationDraft[];
}

/**
 * A record's types as its declaration is handed them ({@link RecordTypes}),
 * read off its state type.
 *
 * @param type - The record's state type
 * @returns Its types: the state, a Dict's key or a Set's element type, and a Dict's edit capability
 */
function typesOf(type: EastType): RecordTypes<EastType, EastType | undefined> {
  return {
    state: type,
    key: type.type === 'Dict' || type.type === 'Set' ? type.key : undefined,
    edit: type.type === 'Dict' ? editTypeOf(type) : undefined,
  };
}

/**
 * Singleton datatree definition for `.records`.
 *
 * All record datasets are children of this datatree.
 */
export const recordsTree: DataTreeDef = {
  kind: 'datatree',
  name: 'records',
  path: [variant('field', 'records')],
  deps: new Set(),
};

/**
 * Tells a record from any other dataset: one `e3.record` declared, written
 * only through its mutations.
 *
 * @param value - A package's item, or whatever a declaration was given
 * @returns Whether it is a record
 * @internal
 */
export function isRecord(value: unknown): value is RecordDef {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { readonly kind?: unknown; readonly recordKind?: unknown };
  return item.kind === 'dataset' && item.recordKind === 'record';
}

/**
 * Defines a record — a root dataset written only through mutations — declared
 * whole: its type, its initial value, its indexes, its mutations and its
 * migrations, in one call, never changed after.
 *
 * Creates a dataset at `.records.${name}` with `writable: false` (so raw
 * `e3 set` / `Data.write` is rejected). With an initial value, deploy writes
 * it as the genesis commit (`$init`). Without one the record is **unassigned**
 * until its first state is committed from outside — a host's file intake, or
 * `e3 seed` — which is then its `$init`: the deploy writes no commit for it,
 * its dependents wait as they wait on an unset input — a run leaves them
 * waiting, and goes on without them — and a mutation on it is refused until
 * it holds a state. So a record whose first state is data that arrives after
 * the deploy never runs its dependents on an empty value first.
 *
 * Its parts are declared through the builders it hands each: `indexes` gets
 * `index` and returns them by name, `mutations` gets `mutation` and returns
 * them by name, and `migrations` gets `migration` and returns its steps in
 * order, each named. Each is handed the record's types as a second argument,
 * `{ state, key, edit }` ({@link RecordTypes}), so a part's function is typed
 * by the record without naming its type again:
 * `mutations: (mutation, { state, edit }) => …`. Each is built and checked here, every refusal naming the
 * record and the part, and the record's type carries each by its name — so a
 * binding names them, and TypeScript holds each name to the record. The parts
 * are frozen: nothing adds to a record once declared.
 *
 * @typeParam Name - Record name (literal type)
 * @typeParam T - The East type of the record state
 * @typeParam I - Its indexes, as `indexes` returns them
 * @typeParam M - Its mutations, as `mutations` returns them
 * @param name - Record name (used as path segment in the tree)
 * @param type - East type of the record state
 * @param config - `initial`, the genesis state, omitted for a record whose first
 *   state is committed from outside; `indexes`, `mutations` and `migrations`
 * @returns A RecordDef, usable anywhere a dataset is, its parts by name
 * @throws {Error} For a declaration that is not an object of `initial`,
 *   `indexes`, `mutations` and `migrations` — an initial value passed in its
 *   place is refused, naming `{ initial: value }` — and naming the record and
 *   the part: a part's name that is not an identifier, or `primary` for an
 *   index; a second nested series index; an entries index beside a nested
 *   series index, or two over one field; an index named as the span or the
 *   lean rows another keeps beside it; a part not made by its builder; two
 *   migrations of one name, or a migration that does not take the record as the
 *   step before it leaves it, or a last step that leaves it as other than its
 *   type; or anything a part's builder refuses
 *
 * @example
 * ```ts
 * import { DictType, StringType } from '@elaraai/east';
 *
 * const orders = e3.record('orders', DictType(StringType, OrderType), {
 *   initial: new Map(),
 *   indexes: (index) => ({
 *     orders_by_status: index.on(['status']),
 *   }),
 *   mutations: (mutation) => ({
 *     place_order: mutation.reduce(placeOrder),
 *     patch: mutation.patch(),
 *   }),
 * });
 * // Unassigned until its first state is committed: `e3 seed` from a beast2
 * // file, or a host's file intake
 * const customers = e3.record('customers', DictType(StringType, CustomerType));
 * ```
 */
export function record<
  Name extends string,
  T extends EastType,
  I extends Readonly<Record<string, IndexDraft>> = Record<never, never>,
  M extends Readonly<Record<string, MutationDraft>> = Record<never, never>,
>(
  name: Name,
  type: T,
  config?: RecordConfig<T, I, M>,
): RecordDef<T, [variant<'field', 'records'>, variant<'field', Name>], IndexesOf<I, T>, MutationsOf<M, T>>;
export function record(name: string, type: EastType, declared?: unknown): RecordDef {
  const where = `e3.record '${name}'`;
  const config = declared === undefined ? undefined : declarationOf(where, type, declared);
  const initial = config?.initial;
  // A function makes the state; a record whose state is a function holds it as given.
  const made = typeof initial === 'function' && type.type !== 'Function' && type.type !== 'AsyncFunction';
  const rec = {
    kind: 'dataset' as const,
    recordKind: 'record' as const,
    name,
    path: [variant('field', 'records'), variant('field', name)],
    type,
    ...(initial !== undefined && !made && { default: initial }),
    writable: false,
    mutations: {} as Record<string, MutationDef>,
    indexes: {} as Record<string, RecordIndexDef>,
    migrations: [] as MigrationDef[],
    deps: new Set([...recordsTree.deps, recordsTree]),
  };
  if (made) {
    let state: { readonly value: unknown } | undefined;
    Object.defineProperty(rec, 'default', { enumerable: true, get: () => (state ??= { value: (initial as () => unknown)() }).value });
  }
  // Each part is built in the order declared, over the record itself: an index or a mutation under its key, a
  // migration after the step before it. Each part's function is handed the record's types beside its builder.
  const types = typesOf(type) as RecordTypes<EastType>;
  for (const [key, draft] of partsOf(where, 'indexes', config?.indexes?.(INDEX_BUILDER as unknown as IndexBuilder<EastType>, types))) {
    rec.indexes[key] = builderOf(where, 'index', key, draft).build(rec, key);
  }
  checkEntries(where, Object.values(rec.indexes));
  // A nested series index's span, and an entries index's lean rows, are built beside it, each under a name of its own (#1438, #1521).
  for (const index of Object.values(rec.indexes)) {
    const companion = index.nested?.span ?? index.entries?.rows;
    if (companion === undefined) continue;
    if (rec.indexes[companion.name] !== undefined) {
      const kept = index.nested !== undefined ? `the span the nested series index '${index.name}'` : `the lean rows the entries index '${index.name}'`;
      throw new Error(`${where}: an index named '${companion.name}' — the name is ${kept} keeps beside it; name the index otherwise`);
    }
    rec.indexes[companion.name] = companion;
  }
  for (const [key, draft] of partsOf(where, 'mutations', config?.mutations?.(MUTATION_BUILDER as unknown as MutationBuilder<EastType>, types))) {
    rec.mutations[key] = builderOf(where, 'mutation', key, draft).build(rec, key);
  }
  const steps: unknown = config?.migrations?.(MIGRATION_BUILDER as unknown as MigrationBuilder, types);
  if (steps !== undefined) {
    if (!Array.isArray(steps)) {
      throw new Error(`${where}: migrations returns the steps in order, as a list — [migration.rows('add_site', fn), …]`);
    }
    for (const step of steps as readonly unknown[]) {
      const def = builderOf(where, 'migration', `#${rec.migrations.length + 1}`, step).build(rec, rec.migrations.at(-1));
      if (rec.migrations.some((taken) => taken.name === def.name)) {
        throw new Error(`${where} has two migrations named '${def.name}' — a workspace records the steps it has applied by their names`);
      }
      rec.migrations.push(def);
    }
    const last = rec.migrations.at(-1);
    if (last !== undefined && !sameEastType(last.to, type)) {
      throw new Error(`${where} is declared as ${printType(type)}, but its last migration, '${last.name}', leaves it as ${printType(last.to)}`);
    }
  }
  Object.freeze(rec.indexes);
  Object.freeze(rec.mutations);
  Object.freeze(rec.migrations);
  return rec;
}

/**
 * Refuses a record's entries indexes where they do not fit together (#1521),
 * whatever order they are declared in: one beside a nested series index — one
 * kind of index files a record's nested fields — or two over one field.
 *
 * @param where - The record, as a refusal names it
 * @param indexes - Its indexes, as built
 * @throws {Error} Naming the indexes
 */
function checkEntries(where: string, indexes: readonly RecordIndexDef[]): void {
  const entries = indexes.filter((index) => index.entries !== undefined);
  const nested = indexes.find((index) => index.nested !== undefined);
  if (nested !== undefined && entries.length > 0) {
    throw new Error(`${where}: the entries index '${entries[0]!.name}' beside the nested series index '${nested.name}' — ` +
      'one kind of index files a record\'s nested fields: declare the one or the other');
  }
  for (const [at, index] of entries.entries()) {
    const field = index.entries!.field;
    const twin = entries.slice(0, at).find((other) => other.entries!.field === field);
    if (twin !== undefined) {
      throw new Error(`${where}: the entries indexes '${twin.name}' and '${index.name}' both file '${field}' — one entries index files a field`);
    }
  }
}

/** What `e3.record` takes beside its name and type: its initial value, and its parts through its builders. */
const CONFIG_KEYS: readonly string[] = ['initial', 'indexes', 'mutations', 'migrations'];

/**
 * `e3.record`'s declaration, checked: a plain object of its initial value and
 * its parts' builders' functions, and nothing else.
 *
 * @param where - The record, as a refusal names it
 * @param type - Its state type
 * @param declared - What was given
 * @returns The declaration
 * @throws {Error} For anything else, naming `{ initial: value }` where it is a value of the record's type
 */
function declarationOf(where: string, type: EastType, declared: unknown): RecordConfig<EastType, object, object> {
  const value = isValueOf(declared, type) ? ' — its initial value is declared as { initial: value }' : '';
  if (typeof declared !== 'object' || declared === null || Object.getPrototypeOf(declared) !== Object.prototype) {
    throw new Error(`${where} takes its declaration as { initial?, indexes?, mutations?, migrations? }${value}`);
  }
  const extra = Object.keys(declared).filter((key) => !CONFIG_KEYS.includes(key));
  if (extra.length > 0) {
    throw new Error(`${where} takes initial, indexes, mutations and migrations, not ${extra.map((key) => `'${key}'`).join(', ')}${value}`);
  }
  for (const part of ['indexes', 'mutations', 'migrations'] as const) {
    const builds = (declared as Record<string, unknown>)[part];
    if (builds !== undefined && typeof builds !== 'function') {
      throw new Error(`${where}: ${part} is a function of its builder — ${part}: (${part === 'indexes' ? 'index' : part.slice(0, -1)}) => …`);
    }
  }
  return declared as RecordConfig<EastType, object, object>;
}

/** The parts a builder's function returned, by name: an object of them, or none. */
function partsOf(where: string, what: string, returned: unknown): [string, unknown][] {
  if (returned === undefined) return [];
  if (typeof returned !== 'object' || returned === null || Array.isArray(returned)) {
    throw new Error(`${where}: ${what} returns its parts by name, as an object — { orders_by_status: index.on(['status']) }`);
  }
  return Object.entries(returned);
}

/** How each kind of part is built: an index or a mutation under its name, a migration after the step before it. */
interface PartBuilds {
  readonly index: (record: RecordDef, name: string) => RecordIndexDef;
  readonly mutation: (record: RecordDef, name: string) => MutationDef;
  readonly migration: (record: RecordDef, previous: MigrationDef | undefined) => MigrationDef;
}

/** A part's builder, as its draft carries it; refused, naming the part, for anything its builder did not make. */
function builderOf<P extends keyof PartBuilds>(where: string, part: P, name: string, draft: unknown): { readonly build: PartBuilds[P] } {
  const made = typeof draft === 'object' && draft !== null
    ? (draft as { readonly [RECORD_PART]?: { readonly part: string; readonly build: PartBuilds[P] } })[RECORD_PART]
    : undefined;
  if (made === undefined || made.part !== part) {
    throw new Error(`${where}: ${part} '${name}' is not one the ${part} builder made — declare it as ${part}.${part === 'index' ? 'on([…])' : part === 'mutation' ? 'reduce(fn)' : "rows('name', fn)"} and the like`);
  }
  return made;
}
