/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An index of a record as an input of a task, a stream task or a function.
 *
 * A record's index is an ordinary collection — `Dict<{ ik, k }, P>`, stored as
 * a manifest of segments as the record's own rows are, and maintained in the
 * same commit — whose order is the order of a read the app declared it for.
 * `e3.index` hands that collection to a body, which then reads the index's
 * runs with `range` and `prefix`, where a body handed the record reads every
 * row.
 */

import { NullType, type DictType, type EastType, type Expr, type StructType } from '@elaraai/east';
import { indexCollectionType } from '@elaraai/e3-types';
import { readersOn } from './index-read.js';
import { isRecord } from './record.js';
import { RECORD_PART } from './record-builders.js';
import { builtIndex, summed } from './record-programs.js';
import type { DatasetDef, IndexInputDef, InputDef, PartitionDef, RecordDef, RecordIndexDef } from './types.js';

/** A Dict record's key type. */
type RecordKeyOf<T> = T extends DictType<infer K extends EastType, unknown> ? K : EastType;

/**
 * The type of an index's entries, read off the index as its record carries it:
 * `Dict<{ ik, k }, P>` — `ik` the index's key, `k` the record's, and `P` what
 * the index carries. A summary index's entry stands for every row of its key,
 * so its `k` is Null.
 *
 * @typeParam D - The index, as `record.indexes.<name>` types it
 *
 * @remarks
 * What an index carries is what its record builds it to carry
 * (`RecordIndexDef`'s `Carried`). Beside a nested series index or an entries
 * index of its record, an index declared with no `value` — or one that carries
 * the row, as an area or a series index does — carries the lean row: the row,
 * with the fields those file emptied. The record's type says so for each of
 * its indexes, so a body's parameter and {@link index}'s `type` agree.
 */
export type IndexEntriesOf<D> = D extends RecordIndexDef<string, infer T, infer IK, EastType, readonly string[] | undefined, infer C>
  ? DictType<StructType<{ ik: IK; k: D extends { readonly summary: object } | { readonly span: object } ? NullType : RecordKeyOf<T> }>, C>
  : never;

/** The words for what `e3.index` was given, when it is no index a record carries: what it is, by its kind. */
function given(value: unknown): string {
  if (isRecord(value)) {
    const names = Object.keys(value.indexes);
    const has = names.length === 0 ? 'it declares no index' : `its indexes are ${names.map((name) => `'${name}'`).join(', ')}`;
    return `the record '${value.name}' itself — pass one of its indexes, as ${value.name}.indexes.<name>; ${has}`;
  }
  if (typeof value !== 'object' || value === null) return value === null ? 'null' : `a ${typeof value}`;
  const item = value as { readonly kind?: unknown; readonly name?: unknown; readonly dataset?: { readonly name?: unknown } };
  const named = typeof item.name === 'string' ? ` '${item.name}'` : '';
  switch (item.kind) {
    case 'dataset': return `the dataset${named}, which is no record: only an e3.record has indexes`;
    case 'partition': return `e3.partition of '${String(item.dataset?.name)}': a partition marks a dataset, and an index is read whole`;
    case 'index': return 'an e3.index already: pass the record\'s index, as record.indexes.<name>';
    case 'task': return `the task${named}: a task has no index`;
    case 'recordIndex':
      return `an index named '${String(item.name)}' that no record carries by that name — pass it as the record holds it, record.indexes.${String(item.name)}`;
    case 'mutation': return `the mutation${named}: a mutation writes its record, and has no index — pass one of the record's indexes, as record.indexes.<name>`;
    case 'migration': return `the migration${named}: a migration changes its record's type, and has no index`;
    case 'function': return `the function${named}: a function has no index`;
    case 'package': return `the package${named}: a package has no index`;
    case 'datatree': return `the data tree${named}: only an e3.record has indexes`;
    case 'array': case 'set': case 'dict': case 'fold': return `e3.output.${item.kind}, an output kind: it has no index`;
  }
  // What a record's builders make, before a record builds it
  const part = (value as { readonly [RECORD_PART]?: { readonly part?: unknown } })[RECORD_PART]?.part;
  if (part === 'index') return 'an index the `index` builder made, before its record built it — declare it in e3.record\'s `indexes`, and pass record.indexes.<name>';
  if (part === 'mutation' || part === 'migration') return `a ${part} the \`${part}\` builder made, which has no index`;
  return 'a value that is no definition of e3\'s';
}

/**
 * Takes an index of a record as an input of a task, a stream task or a
 * function: `e3.index(record.indexes.<name>)` in its `inputs`.
 *
 * The body's parameter is the index's entries, a `Dict<{ ik, k }, P>` opened
 * lazily and frozen, as any input is: `ik` the index's key, `k` the record's
 * key, and `P` what the index carries — the row, a `value` of its own, or
 * nothing; beside a nested series index or an entries index of the record,
 * the lean row where it would carry nothing or the row, which the parameter's
 * type says. Entries with one index key are one contiguous run, in the record's
 * key order, and a range of index keys is one run too, so a body reads them
 * with `prefix` and `range`, by key, by size and by a loop, each at the cost
 * of the entries it reaches and never of the index. A body that reads it any
 * other way decodes it whole, as it would any input.
 *
 * It takes an index as its record carries it by name
 * (`jobs.indexes.jobs_by_press`), and the indexes e3 keeps beside one: a nested
 * series index's span (`jobs.indexes.<name>.nested.span`) and an entries
 * index's lean rows (`jobs.indexes.<name>.entries.rows`). To read more of a row
 * than the index carries, take the record as an input beside it and read the
 * row by the entry's `k`.
 *
 * The inputs of one record — the record, and any of its indexes — are read at
 * one state of it, so a body never meets an index entry for a row it reads
 * otherwise. A task that takes an index is decided again when its record
 * changes, and runs again when the index it reads did; a function reads it as
 * the record is stored when the call starts, and its result names the record,
 * the index and the hash the record was pinned at. A record with no state yet
 * makes a task wait and a call `invalid`, as it does for the record as an
 * input. `e3.package` collects the index's record.
 *
 * Its kind's readers give a body the rows a read's words say — a series
 * index's `events`, an interval index's `overlapping`, a plain index's `of`
 * (`IndexRead`). An `e3.function` with a spec and an `e3.streamTask` give the
 * body its parameter with the readers on it; over any other expression of the
 * index's type, a task's own function's parameter among them,
 * `e3.index(def).read(entries)` gives that expression with the same readers.
 *
 * @typeParam D - The index, as `record.indexes.<name>` types it
 * @param def - The index, as its record carries it by name
 * @returns The input: pass it in `inputs`; its `type` is the body's parameter, and its `read` the index's readers
 * @throws {Error} When given anything but an index its record carries by name
 *   — a record, a dataset, a mutation, a function, an index the builder made
 *   before its record built it — naming what it was given and what to pass
 *
 * @example
 * ```ts
 * const jobs = e3.record('jobs', DictType(StringType, JobType), {
 *   initial: new Map(),
 *   indexes: (index) => ({ jobs_by_press: index.on(['press']) }),
 *   mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 *
 * // How many jobs a press holds, read from the index alone: the run of one
 * // press costs its two ends and what lies between them.
 * const jobsOnPress = e3.function('jobs_on_press', {
 *   inputs: [e3.index(jobs.indexes.jobs_by_press)],
 *   args: [StringType],
 *   output: IntegerType,
 * }, ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size());
 * ```
 *
 * @example
 * ```ts
 * // A task takes it the same way: its body's parameter is the index's type.
 * const byPress = e3.index(jobs.indexes.jobs_by_press);
 * const busiest = e3.task('busiest_press', [byPress, presses],
 *   East.function([byPress.type, PressesType], StringType, ($, jobsByPress, presses) => {
 *     const best = $.let("");
 *     const most = $.let(0n);
 *     $.for(presses, ($, _press, code) => {
 *       const count = $.const(jobsByPress.prefix({ ik: code }).size());
 *       $.if(East.less(most, count), ($) => { $.assign(most, count); $.assign(best, code); });
 *     });
 *     return best;
 *   }));
 * ```
 */
export function index<const D extends RecordIndexDef>(def: D): IndexInputDef<IndexEntriesOf<D>, D> {
  const declared = def as unknown as { readonly kind?: unknown; readonly name?: unknown; readonly record?: unknown } | null | undefined;
  const record = typeof declared === 'object' && declared !== null && declared.kind === 'recordIndex' && isRecord(declared.record)
    ? declared.record : undefined;
  // The record carries it by its name: its own indexes, and those e3 keeps
  // beside one — a nested series index's span, an entries index's lean rows.
  if (record === undefined || typeof def.name !== 'string' || !Object.hasOwn(record.indexes, def.name) || record.indexes[def.name] !== def) {
    throw new Error(`e3.index takes an index of a record, as the record carries it by name — e3.index(record.indexes.<name>) — and was given ${given(def)}`);
  }
  const input: IndexInputDef = {
    kind: 'index', index: def, record, type: indexEntriesType(record, def),
    read: (entries) => readersOn(input, entries) as never,
  };
  return input as IndexInputDef<IndexEntriesOf<D>, D>;
}

/**
 * A body's parameters with each index input's readers on its own: the
 * parameter is still the index's entries, and its kind's readers read them.
 *
 * @param inputs - The inputs, in the body's parameter order
 * @param params - The body's parameters: the inputs', then any others
 * @returns The parameters
 * @internal
 */
export function withIndexReaders<P extends readonly Expr[]>(inputs: readonly (InputDef | PartitionDef)[], params: P): P {
  inputs.forEach((input, at) => {
    if (input.kind === 'index') readersOn(input, params[at]);
  });
  return params;
}

/**
 * The type a record's state holds an index's entries as: the index as it is
 * built (`builtIndex`), in the collection the store keeps it in
 * (`indexCollectionType`), a summed index's `k` Null.
 *
 * @param record - The record
 * @param def - One of its indexes
 * @returns `Dict<{ ik, k }, P>`
 */
function indexEntriesType(record: RecordDef, def: RecordIndexDef): EastType {
  const built = builtIndex(record, def);
  // An index is declared over a Dict record alone, whose key is its rows'.
  const rowKey = (record.type as EastType & { readonly key: EastType }).key;
  return indexCollectionType(summed(built) ? NullType : rowKey, built.keyType, built.valueType);
}

/**
 * The dataset an input is read through: the dataset itself, a partitioned
 * input's dataset, or an index's record. What a definition's dependencies are
 * collected from.
 *
 * @param input - The input
 * @returns The dataset
 * @internal
 */
export function inputDataset(input: InputDef | PartitionDef): DatasetDef {
  return input.kind === 'partition' ? input.dataset : input.kind === 'index' ? input.record : input;
}

/**
 * The type of the parameter a body is given for an input: the dataset's, a
 * partitioned input's dataset's — a piece is typed as the whole — or an
 * index's entries'.
 *
 * @param input - The input
 * @returns The type
 * @internal
 */
export function inputType(input: InputDef | PartitionDef): EastType {
  return input.kind === 'partition' ? input.dataset.type : input.type;
}

/**
 * The name an input is refused by: a dataset's, or an index's as
 * `record.index`.
 *
 * @param input - The input
 * @returns The name
 * @internal
 */
export function inputName(input: InputDef | PartitionDef): string {
  return input.kind === 'partition' ? input.dataset.name : input.kind === 'index' ? `${input.record.name}.${input.index.name}` : input.name;
}
