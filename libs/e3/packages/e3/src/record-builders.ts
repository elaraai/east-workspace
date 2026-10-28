/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builders a record declared whole hands its declaration.
 *
 * `e3.record(name, type, { indexes, mutations, migrations })` calls each of
 * these with a builder typed by the record's state — `index`, `mutation` and
 * `migration` — and builds what they return under its name, as the record is
 * declared: its indexes and mutations by their keys, its migrations in order.
 * Each part is checked there, every refusal naming the record and the part, and
 * TypeScript reads each part's name and types off the one call.
 */

import type { CallableFunctionExpr, DictType, EastType, FunctionExpr, NullType, PatchTypeOf, StructType } from '@elaraai/east';
import type { RecordSummaryTotalsType } from '@elaraai/e3-types';
import type { MigrationDef, MutationDef, RecordDef, RecordIndexDef } from './types.js';
import { plainDefinition } from './record-index.js';
import type {
  AreaIndexOf, AreaIndexSpec, IndexKeyOf, IndexOn, IntervalIndexSpec, NestedKeyOf, NestedSeriesIndexSpec, NestedValueOf,
  ProjectionOf, SeriesIndexSpec, SummaryIndexSpec, SummaryKeyOf, TimeTileOf,
} from './record-index.js';
import { intervalDefinition } from './record-interval.js';
import { areaDefinition } from './record-area.js';
import { seriesDefinition, summaryDefinition } from './record-series.js';
import { nestedDefinition } from './record-nested-programs.js';
import { items, recursive, rows, values, type NestedOf } from './record-nested.js';
import { editDefinition, patchDefinition, reduceDefinition } from './mutation.js';
import { stepDefinition } from './migration.js';
import type { IndexFunction } from './record-guards.js';
import type { FunctionRunner } from './runner.js';

/** A Dict record's row type. */
type RowOf<T> = T extends DictType<unknown, infer V extends EastType> ? V : EastType;
/** A Dict record's row fields, by name. */
type RowFields<T> = T extends DictType<unknown, StructType<infer F>> ? F : Record<never, never>;
/** The name of one of a Dict record's row fields. */
type Field<T> = keyof RowFields<T> & string;

/** The key of a part a builder makes: what `e3.record` builds the part by. */
export const RECORD_PART = Symbol('e3.recordPart');

/** A part's runner selection (known runtimes only, as `e3.function`'s). */
export interface PartRunner {
  /** The runner its functions run on. */
  readonly runner?: FunctionRunner;
}

/** A plain index's options: the projection its entries carry, and its runner. */
export interface PlainIndexOptions extends PartRunner {
  /** `(K, V) -> P`: what a view renders from the index alone, so it never reads the record's segments. */
  readonly value?: IndexFunction;
}

/**
 * An index the `index` builder makes, which `e3.record` builds under its key.
 *
 * @typeParam IK - The index key an entry sorts under
 * @typeParam P - What each entry carries
 * @typeParam On - The row fields leading it, as written
 * @typeParam Extra - Its kind's own part of the definition
 */
export interface IndexDraft<
  IK extends EastType = EastType,
  P extends EastType = EastType,
  On extends readonly string[] | undefined = readonly string[] | undefined,
  Extra = unknown,
> {
  /** How the record builds it under its name. */
  readonly [RECORD_PART]: { readonly part: 'index'; readonly build: (record: RecordDef, name: string) => RecordIndexDef };
  /** Its types, for TypeScript alone: never set. */
  readonly types?: { readonly key: IK; readonly value: P; readonly on: On; readonly extra: Extra };
}

/**
 * A mutation the `mutation` builder makes, which `e3.record` builds under its key.
 *
 * @typeParam Args - The arguments it takes after the state
 */
export interface MutationDraft<Args extends readonly EastType[] = readonly EastType[]> {
  /** How the record builds it under its name. */
  readonly [RECORD_PART]: { readonly part: 'mutation'; readonly build: (record: RecordDef, name: string) => MutationDef };
  /** Its types, for TypeScript alone: never set. */
  readonly types?: { readonly args: Args };
}

/** A migration step the `migration` builder makes, which `e3.record` builds in its place in the list. */
export interface MigrationDraft {
  /** How the record builds it, after the step before it. */
  readonly [RECORD_PART]: { readonly part: 'migration'; readonly build: (record: RecordDef, after: MigrationDef | undefined) => MigrationDef };
}

/**
 * The nested series index's builder, `index.nested`, and the builders of the
 * collections it files.
 *
 * @typeParam T - The record's state type
 */
export interface NestedBuilder<T extends EastType> {
  /**
   * A nested series index: every collection the record's rows nest, filed in
   * time — see `e3.recordIndex.series` for what it files and keeps. A record has
   * one; its other indexes then carry its rows without the collections.
   *
   * @param spec - `collections`, each declared with {@link items}, {@link values}, {@link rows} or {@link recursive};
   *   `tile`, the finest level an item is filed at; `summary`, the tile each node's totals are kept by
   * @param options - Its runner
   */
  <const S extends NestedSeriesIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<NestedKeyOf<T>, NestedValueOf<T, S>, readonly [], { readonly nested: NestedOf<S> }>;
  /** A collection of items, each placed by its times. */
  readonly items: typeof items;
  /** A collection of values, one per instant. */
  readonly values: typeof values;
  /** A collection of child rows, which nest collections of their own. */
  readonly rows: typeof rows;
  /** A field holding more rows like the one listing it. */
  readonly recursive: typeof recursive;
}

/**
 * The `index` builder a record declared whole hands its `indexes`: one
 * method a kind, each typed by the record's rows, so a field it names is one of
 * the row's.
 *
 * @typeParam T - The record's state type, a Dict of Struct rows
 */
export interface IndexBuilder<T extends EastType> {
  /**
   * An index led by row fields: the rows in the order of their values. A Set
   * field fans out, a row under each of its elements.
   *
   * @param fields - The row fields, in key order: one or more
   * @param options - `value`, what each entry carries; its runner
   */
  on<const F extends readonly Field<T>[], const O extends PlainIndexOptions = Record<never, never>>(fields: F, options?: O):
    IndexDraft<IndexKeyOf<{ on: F }, T>, ProjectionOf<O>, F>;
  /**
   * An index by a key each row computes: `(K, V) -> IK`.
   *
   * @param fn - The key function
   * @param options - `value`, what each entry carries; its runner
   */
  key<const F extends IndexFunction, const O extends PlainIndexOptions = Record<never, never>>(fn: F, options?: O):
    IndexDraft<IndexKeyOf<{ key: F }, T>, ProjectionOf<O>, undefined>;
  /**
   * An index by many keys a row computes, `(K, V) -> Set<IK>`: a row under each
   * key, none under an empty set — how a partial index is written.
   *
   * @param fn - The keys function
   * @param options - `value`, what each entry carries; its runner
   */
  keys<const F extends IndexFunction, const O extends PlainIndexOptions = Record<never, never>>(fn: F, options?: O):
    IndexDraft<IndexKeyOf<{ keys: F }, T>, ProjectionOf<O>, undefined>;
  /**
   * An interval index: the events overlapping a time window.
   *
   * @param spec - `from` and `to`, and the optional leading `on`
   * @param options - Its runner
   */
  interval<const S extends IntervalIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<IndexKeyOf<S, T>, NullType, IndexOn<S>, { readonly interval: { readonly from: S['from']; readonly to: S['to'] } }>;
  /**
   * An area index: the rows whose boxes meet a window.
   *
   * @param spec - `x`, `y`, `width`, `height`, `at`, `cell`, and the optional leading `on`
   * @param options - Its runner
   */
  area<const S extends AreaIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<IndexKeyOf<S, T>, RowOf<T>, IndexOn<S>, { readonly area: AreaIndexOf<S> }>;
  /**
   * A series index: the record's events by a key and time tiles, each filed
   * once at the level its length fits.
   *
   * @param spec - `key`, `from`, `to`, `tile`, and the optional leading `on`
   * @param options - Its runner
   */
  series<const S extends SeriesIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<IndexKeyOf<S, T>, RowOf<T>, IndexOn<S>, { readonly series: TimeTileOf<S> }>;
  /** The nested series index, and the builders of the collections it files. */
  readonly nested: NestedBuilder<T>;
  /**
   * A summary index: under each key and tile, how many rows touch it and the
   * milliseconds of it they cover.
   *
   * @param spec - `key`, `from`, `to`, `tile`, and the optional leading `on`
   * @param options - Its runner
   */
  summary<const S extends SummaryIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<SummaryKeyOf<S, T>, typeof RecordSummaryTotalsType, IndexOn<S>, { readonly summary: TimeTileOf<S> }>;
}

/**
 * The `mutation` builder a record declared whole hands its `mutations`: its
 * write forms, each typed by the record's state.
 *
 * @typeParam T - The record's state type
 */
export interface MutationBuilder<T extends EastType> {
  /**
   * A reducer of the whole state, `(state, ...args) => state`: pure,
   * synchronous East, re-run by the compare-and-swap loop against fresher state.
   *
   * @param fn - The reducer
   * @param options - Its runner
   */
  reduce<Args extends EastType[]>(fn: FunctionExpr<[T, ...Args], T> | CallableFunctionExpr<[T, ...Args], T>, options?: PartRunner): MutationDraft<Args>;
  /**
   * A body writing through an `edit` capability, `(state, ...args, edit) => null`,
   * its last parameter `e3.mutation.editType(type)`: the lazy write, for a Dict
   * or Set record.
   *
   * @param fn - The body
   * @param options - Its runner
   */
  edit<Args extends EastType[], E extends EastType>(
    fn: FunctionExpr<[T, ...Args, E], NullType> | CallableFunctionExpr<[T, ...Args, E], NullType>, options?: PartRunner,
  ): MutationDraft<Args>;
  /**
   * The door for a patch a client computed, for a Dict or Set record: what
   * `Record.bind` writes an interactive edit through.
   *
   * @param options - Its runner
   */
  patch(options?: PartRunner): MutationDraft<[PatchTypeOf<T>]>;
}

/**
 * The `migration` builder a record declared whole hands its `migrations`: the
 * step forms, each named, the list's order its chain.
 */
export interface MigrationBuilder {
  /**
   * A step over the whole state, `(Old) => New`.
   *
   * @param name - The step: an identifier, by which a workspace records it has applied it
   * @param fn - The step's function
   * @param options - Its runner
   */
  value<From extends EastType, To extends EastType>(name: string, fn: FunctionExpr<[From], To> | CallableFunctionExpr<[From], To>, options?: PartRunner): MigrationDraft;
  /**
   * A step over an Array's elements, `(T1) => T2`, a piece at a time.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   */
  rows<E1 extends EastType, E2 extends EastType>(name: string, fn: FunctionExpr<[E1], E2> | CallableFunctionExpr<[E1], E2>, options?: PartRunner): MigrationDraft;
  /**
   * A step over a Dict's rows, `(K, V1) => V2`, its keys unchanged, a piece at a time.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   */
  rows<K extends EastType, V1 extends EastType, V2 extends EastType>(
    name: string, fn: FunctionExpr<[K, V1], V2> | CallableFunctionExpr<[K, V1], V2>, options?: PartRunner,
  ): MigrationDraft;
  /**
   * A step re-keying a Set's elements, `(T1) => T2`.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   */
  rekey<E1 extends EastType, E2 extends EastType>(name: string, fn: FunctionExpr<[E1], E2> | CallableFunctionExpr<[E1], E2>, options?: PartRunner): MigrationDraft;
  /**
   * A step re-keying a Dict's entries, `(K1, V1) => { key: K2, value: V2 }`.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   */
  rekey<K1 extends EastType, V1 extends EastType, K2 extends EastType, V2 extends EastType>(
    name: string,
    fn: FunctionExpr<[K1, V1], StructType<{ key: K2; value: V2 }>> | CallableFunctionExpr<[K1, V1], StructType<{ key: K2; value: V2 }>>,
    options?: PartRunner,
  ): MigrationDraft;
}

/**
 * A record's indexes as declared, by name: each the index its builder made,
 * named by its key.
 *
 * @typeParam I - What `indexes` returned
 * @typeParam T - The record's state type
 */
export type IndexesOf<I, T extends EastType> = {
  readonly [K in keyof I & string]: I[K] extends IndexDraft<infer IK, infer P, infer On, infer Extra> ? RecordIndexDef<K, T, IK, P, On> & Extra : never
};

/**
 * A record's mutations as declared, by name: each the mutation its builder
 * made, named by its key.
 *
 * @typeParam M - What `mutations` returned
 * @typeParam T - The record's state type
 */
export type MutationsOf<M, T extends EastType> = {
  readonly [K in keyof M & string]: M[K] extends MutationDraft<infer A extends EastType[]> ? MutationDef<K, T, A> : never
};

/** The `index` builder: each method a draft `e3.record` builds under its key. */
export const INDEX_BUILDER = {
  on: plainForm('on'),
  key: plainForm('key'),
  keys: plainForm('keys'),
  interval: (spec: unknown, options?: unknown) => indexDraft('index.interval', options, (where, record, name) =>
    intervalDefinition(where, name, record, spec as Parameters<typeof intervalDefinition>[3], runnerOf(options))),
  area: (spec: unknown, options?: unknown) => indexDraft('index.area', options, (where, record, name) =>
    areaDefinition(where, name, record, spec as Parameters<typeof areaDefinition>[3], runnerOf(options))),
  series: (spec: unknown, options?: unknown) => indexDraft('index.series', options, (where, record, name) => {
    if (typeof spec === 'object' && spec !== null && 'collections' in spec) {
      throw new Error(`${where} '${name}' takes key, from, to and tile — collections are a nested series index's: index.nested({ collections, tile, summary? })`);
    }
    return seriesDefinition(where, name, record, spec as Parameters<typeof seriesDefinition>[3], runnerOf(options));
  }),
  nested: Object.assign(
    (spec: unknown, options?: unknown) => indexDraft('index.nested', options, (where, record, name) =>
      nestedDefinition(where, name, record, spec as object, runnerOf(options))),
    { items, values, rows, recursive },
  ),
  summary: (spec: unknown, options?: unknown) => indexDraft('index.summary', options, (where, record, name) =>
    summaryDefinition(where, name, record, spec as Parameters<typeof summaryDefinition>[3], runnerOf(options))),
};

/** The `mutation` builder: each method a draft `e3.record` builds under its key. */
export const MUTATION_BUILDER = {
  reduce: (fn: IndexFunction, options?: unknown) => mutationDraft('mutation.reduce', options, (where, record, name) =>
    reduceDefinition(where, name, record, fn, runnerOf(options))),
  edit: (fn: IndexFunction, options?: unknown) => mutationDraft('mutation.edit', options, (where, record, name) =>
    editDefinition(where, name, record, fn, runnerOf(options))),
  patch: (options?: unknown) => mutationDraft('mutation.patch', options, (where, record, name) =>
    patchDefinition(where, name, record, runnerOf(options))),
};

/** The `migration` builder: each method a step `e3.record` builds in its place. */
export const MIGRATION_BUILDER = {
  value: stepForm('value'),
  rows: stepForm('rows'),
  rekey: stepForm('rekey'),
};

/** A refusal's subject: the builder, on its record. */
function wordsOf(record: RecordDef, builder: string): string {
  return `e3.record '${record.name}': ${builder}`;
}

/** Refuses options a builder does not take, naming those it does. */
function checkOptions(where: string, name: string, options: unknown, allowed: readonly string[]): void {
  if (options === undefined) return;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error(`${where} '${name}' takes its options as an object, { ${allowed.join(', ')} }`);
  }
  const extra = Object.keys(options).filter((option) => !allowed.includes(option));
  if (extra.length > 0) throw new Error(`${where} '${name}' takes ${allowed.join(' and ')}, not ${extra.join(', ')}`);
}

/** A part's runner selection, from the options its builder was given. */
function runnerOf(options: unknown): { runner?: FunctionRunner } | undefined {
  const runner = (options as PartRunner | undefined)?.runner;
  return runner === undefined ? undefined : { runner };
}

/** An index draft, its options checked as it is built. */
function indexDraft(
  builder: string, options: unknown, build: (where: string, record: RecordDef, name: string) => RecordIndexDef,
): IndexDraft {
  return {
    [RECORD_PART]: {
      part: 'index',
      build: (record, name) => {
        const where = wordsOf(record, builder);
        checkOptions(where, name, options, builder === 'index.on' || builder === 'index.key' || builder === 'index.keys' ? ['value', 'runner'] : ['runner']);
        return build(where, record, name);
      },
    },
  };
}

/** A plain index's builder: by row fields, a key function, or a keys function. */
function plainForm(form: 'on' | 'key' | 'keys') {
  return (by: unknown, options?: unknown): IndexDraft => indexDraft(`index.${form}`, options, (where, record, name) => {
    if (form === 'on' && !Array.isArray(by)) {
      throw new Error(`${where} '${name}' takes the row fields leading it as a list, as index.on(['site'])`);
    }
    const value = (options as PlainIndexOptions | undefined)?.value;
    return plainDefinition(where, name, record, { [form]: by, ...(value !== undefined && { value }) }, runnerOf(options));
  });
}

/** A mutation draft, its options checked as it is built. */
function mutationDraft(
  builder: string, options: unknown, build: (where: string, record: RecordDef, name: string) => MutationDef,
): MutationDraft {
  return {
    [RECORD_PART]: {
      part: 'mutation',
      build: (record, name) => {
        const where = wordsOf(record, builder);
        checkOptions(where, name, options, ['runner']);
        return build(where, record, name);
      },
    },
  };
}

/** A migration step's builder in a form: the step named, its place in the list its chain. */
function stepForm(form: 'value' | 'rows' | 'rekey') {
  return (name: string, fn: IndexFunction, options?: unknown): MigrationDraft => ({
    [RECORD_PART]: {
      part: 'migration',
      build: (record, after) => {
        const where = wordsOf(record, `migration.${form}`);
        checkOptions(where, name, options, ['runner']);
        return stepDefinition(where, form, name, record, fn, { ...runnerOf(options), ...(after !== undefined && { after }) });
      },
    },
  });
}
