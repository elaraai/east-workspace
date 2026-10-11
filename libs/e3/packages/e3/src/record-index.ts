/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Secondary index definitions for e3 records.
 *
 * A record is paged and searched in its primary key order and nothing else.
 * The views over a planning record have more than one order — by status, by
 * the resources a plan consumes, by time across every plan — and only the ones
 * contiguous in primary order are addressable without scanning it. An index
 * closes that gap without a new storage structure: it is a second canonical
 * collection whose sort order IS the query order, stored as a segment manifest
 * exactly like the primary, maintained inside the same commit, and read with
 * the same paging machinery.
 *
 * The functions are pure for the reason a reducer is: they run again on every
 * commit and in every bulk build, and a maintained index must equal a rebuilt
 * one to the byte.
 */

import type { DateTimeType, DictType, EastType, FunctionExpr, IntegerType, OptionType } from '@elaraai/east';
import { East, Expr, NullType, SetType, StructType, printType } from '@elaraai/east';
import type { RecordDef, RecordIndexDef } from './types.js';
import { intervalKey } from './record-interval.js';
import { checkPure, sameEastType } from './record-guards.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

/** The index name reserved for the record's own collection wherever an index
 *  is selected — a page, a key search, an arm of the mutation delta. */
const RESERVED_INDEX_NAME = 'primary';

/**
 * What an index declaration needs of a function: a way to reach its IR, and
 * through that its signature.
 *
 * @remarks
 * Deliberately the weakest shape that works, because a stronger one silently
 * breaks the authored surface. An index reads
 * `key: East.function([K, V], IK, ($, k, v) => …)` written INLINE in the spec,
 * and `East.function` infers its callback's parameters from its own first
 * argument — but only if nothing is imposed on it from outside. Both a
 * callable contextual type (`FunctionExpr<any, any>`) and a generic return
 * type here (`toIR(): EastIR<any, any>`) make TypeScript infer against the
 * expected type instead, and the body's `k` and `v` come out as the union of
 * every expression class. `unknown` imposes nothing; the guards below read the
 * signature at run time regardless.
 */
export interface IndexFunction {
  /** The function's IR bundle, as `EastIR` or `AsyncEastIR`. */
  toIR(): unknown;
}

/** The own fields of a Dict record's struct row. */
type RowFields<T> = T extends DictType<any, StructType<infer F>> ? F : Record<never, never>;
/** A Set field indexes its elements; every other field indexes its value. */
type FieldKey<T> = T extends SetType<infer K extends EastType> ? K : T extends EastType ? T : never;
/** The field names carried by a field-index declaration. */
type IndexOn<S> = S extends { interval: { from: infer F extends string } }
  ? S extends { on: infer On extends readonly string[] } ? readonly [...On, F] : readonly [F]
  : S extends { on: infer On extends readonly string[] } ? On : undefined;
type IndexInterval<S> = S extends { interval: infer I } ? I : undefined;
type IntervalField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends DateTimeType | OptionType<DateTimeType> ? F : never }[keyof RowFields<T>] & string;
type IntervalPrefix<S, T> = S extends { on: infer On extends readonly (keyof RowFields<T> & string)[] }
  ? { [F in On[number]]: FieldKey<RowFields<T>[F]> } : Record<never, never>;

/** What an index keys on: `on` (row fields), `interval` with optional leading
 *  `on` fields, `key` (one computed entry per row), or `keys` (one per Set
 *  element), and an optional covering projection.
 *  @typeParam T - The owning record's state type
 */
export type RecordIndexSpec<T extends EastType = EastType> = {
  /** Row fields in index order. One field uses its value as the key; several
   *  use a struct in this order. Set fields fan out over their elements. */
  on?: readonly (keyof RowFields<T> & string)[];
  /** Preserve intervals intersecting a half-open time window, including
   *  carry-in events, without day fan-out or duration lookbacks. `on`, when
   *  present, names exact leading fields before this interval. Missing starts
   *  remain selectable as Unset; missing or non-positive ends are instants. */
  interval?: { from: IntervalField<T>; to: IntervalField<T> };
  /** `(K, V) -> IK` — one index entry per row. */
  key?: IndexFunction;
  /** `(K, V) -> Set<IK>` — one index entry per element, so a row that names
   *  five resources appears under five keys. An empty set is a row the index
   *  does not carry, which is how a partial index is written. */
  keys?: IndexFunction;
  /** `(K, V) -> P` — the fields a view renders from the index alone, so it
   *  never touches the primary's segments. */
  value?: IndexFunction;
};

/** The type an East function returns, read off the expression itself. */
type OutputOf<F> = F extends FunctionExpr<any, infer O> ? (O extends EastType ? O : EastType) : EastType;

/**
 * The index key a spec declares: its row fields, `key`'s return, or the
 * element of the Set `keys` returns.
 *
 * @typeParam S - The index spec as written
 * @typeParam T - The owning record's state type, for field indexes
 *
 * @remarks
 * Read off the spec the caller actually wrote, so the factory's parameter
 * keeps the weak {@link IndexFunction} shape the inline callbacks need while
 * its result carries the precise key type — which is what types a window read
 * through the index, and so every component that renders one.
 */
export type IndexKeyOf<S, T extends EastType = EastType> =
  S extends { interval: { from: infer F extends keyof RowFields<T> & string } }
    ? StructType<IntervalPrefix<S, T> & { __interval: IntegerType } & { [K in F]: RowFields<T>[K] }>
  : S extends { on: readonly [infer F extends keyof RowFields<T>] } ? FieldKey<RowFields<T>[F]>
  : S extends { on: infer On extends readonly (keyof RowFields<T> & string)[] }
    ? number extends On['length'] ? EastType : StructType<{ [K in On[number]]: FieldKey<RowFields<T>[K]> }>
  : S extends { key: infer F } ? OutputOf<F>
  : S extends { keys: infer F } ? (OutputOf<F> extends SetType<infer IK> ? IK : EastType)
  : EastType;

/** The covering projection a spec declares: `value`'s return, Null when the
 *  spec has no `value`, and any type when it only might. */
export type ProjectionOf<S> =
  S extends { value: infer F } ? OutputOf<F>
  : 'value' extends keyof S ? EastType
  : NullType;

/** Generate a pure key function from a field declaration. The normal index
 *  build and mutation programs call it exactly as they call an authored key. */
function fieldKey(name: string, keyType: EastType, valueType: EastType, on: readonly string[]): { fn: IndexFunction; multi: boolean } {
  const rowType = valueType as StructType<Record<string, EastType>>;
  if (rowType.type !== 'Struct') throw new Error(`e3.recordIndex '${name}' on requires a record with Struct rows`);
  if (on.length === 0) throw new Error(`e3.recordIndex '${name}' on requires at least one field`);
  if (new Set(on).size !== on.length) throw new Error(`e3.recordIndex '${name}' on must not repeat a field`);
  const fields = on.map((field) => {
    if (!Object.hasOwn(rowType.fields, field)) throw new Error(`e3.recordIndex '${name}' on names unknown row field '${field}'`);
    const type = rowType.fields[field]!;
    const set = (type as SetType).type === 'Set';
    return { field, type: set ? (type as SetType).key : type, set };
  });
  const indexType = fields.length === 1 ? fields[0]!.type : StructType(Object.fromEntries(fields.map((f) => [f.field, f.type])));
  const multi = fields.some((f) => f.set);
  const output = multi ? SetType(indexType) : indexType;
  // Types are checked above; the row's dynamic field names are erased only
  // inside this generated East body, as in record-programs.ts.
  const fn = East.function([keyType as never, rowType], output as never, ($: any, _key: any, row: any) => {
    if (fields.length === 1) return row[fields[0]!.field];
    if (!multi) return Object.fromEntries(fields.map((f) => [f.field, row[f.field]]));
    const keys = $.let(new Set(), SetType(indexType));
    const append = ($: any, at: number, values: Record<string, unknown>): void => {
      const field = fields[at];
      if (field === undefined) { $(keys.insert(values)); return; }
      if (field.set) {
        $.for(row[field.field], ($: any, element: any) => append($, at + 1, { ...values, [field.field]: element }));
      } else append($, at + 1, { ...values, [field.field]: row[field.field] });
    };
    append($, 0, {});
    return keys;
  });
  return { fn, multi };
}

/** The signature of a function an index declares, as the guards see it. */
function signatureOf(fn: IndexFunction): { inputs: EastType[]; output: EastType } {
  return Expr.type(fn as unknown as Expr<any>) as { inputs: EastType[]; output: EastType };
}

/** Why an index function may be neither async nor reach a platform function:
 *  either makes the index non-deterministic, and an index that does not equal
 *  its rebuild is worse than no index, since the view it serves is quietly
 *  wrong. */
const INDEX_PURITY = {
  async: 'an async function implies platform IO, and an index is rebuilt from the record whenever it is dropped or its declaration changes.',
  platform: 'the index is maintained on every commit and rebuilt on demand, so a platform call makes the two disagree.',
};

/** Refuses an index function whose parameters are not the record's entry. */
function checkEntryParams(name: string, role: string, keyType: EastType, valueType: EastType, inputs: EastType[]): void {
  if (inputs.length !== 2 || !sameEastType(keyType, inputs[0]!) || !sameEastType(valueType, inputs[1]!)) {
    const got = inputs.length === 0 ? 'no parameters' : inputs.map((t) => printType(t)).join(', ');
    throw new Error(
      `e3.recordIndex '${name}' ${role} must take the record's entry ` +
      `(${printType(keyType)}, ${printType(valueType)}), but got ${got}.`,
    );
  }
}

/**
 * Defines a secondary index over a record.
 *
 * The index is a collection `Dict<{ik, k}, P>` — the index key first, the
 * primary key second — so every entry sharing an index key is one contiguous
 * run ordered by primary key inside it, and a RANGE of index keys is one
 * contiguous run too. Pages and key searches take the index by name; a view
 * that renders from the index alone declares its fields as `value` and never
 * reads the primary at all.
 *
 * Every guard here is a definition-time error rather than a deploy failure.
 *
 * @typeParam Name - Index name (literal type)
 * @typeParam T - The owning record's state type (a Dict)
 * @typeParam S - The spec as written, from which the index key and covering
 *   projection types are read
 * @param name - Index name: never `primary`, and one declaration per name on
 *   the record, which `e3.package` enforces when it folds indexes onto it
 * @param rec - The record to index
 * @param spec - `on`, `key`, `keys`, or `interval` with optional leading `on`; optional covering `value`
 * @param config - Optional runner selection (known runtimes only)
 * @returns A RecordIndexDef to pass to `e3.package`
 *
 * @example
 * ```ts
 * const plans = e3.record('plans', DictType(PlanKeyType, PlanRowType), new Map());
 *
 * // One key per row, with a covering projection: a queue renders from the
 * // index alone.
 * const byStatus = e3.recordIndex('by_status', plans, {
 *   key:   East.function([PlanKeyType, PlanRowType], StatusKeyType,
 *            ($, k, v) => ({ status: v.status, due: v.due })),
 *   value: East.function([PlanKeyType, PlanRowType], QueueCardType,
 *            ($, k, v) => ({ title: v.title, owner: v.owner })),
 * });
 *
 * // A row field supplies its own key type.
 * const byDue = e3.recordIndex('by_due', plans, { on: ['due'] });
 *
 * // Many keys per row: a Set return.
 * const byResource = e3.recordIndex('by_resource', plans, {
 *   keys: East.function([PlanKeyType, PlanRowType], SetType(ResourceRefType),
 *           ($, k, v) => v.resources),
 * });
 *
 * const pkg = e3.package('planning', '1.0.0', plans, byStatus, byDue, byResource);
 * ```
 */
export function recordIndex<Name extends string, T extends EastType, const S extends RecordIndexSpec<T>>(
  name: Name,
  rec: RecordDef<T>,
  spec: S,
  config?: { runner?: FunctionRunner },
): RecordIndexDef<Name, T, IndexKeyOf<S, T>, ProjectionOf<S>, IndexOn<S>> & { interval: IndexInterval<S> } {
  if (!name) {
    throw new Error('e3.recordIndex requires a non-empty name');
  }
  if (name === RESERVED_INDEX_NAME) {
    throw new Error(
      `e3.recordIndex cannot be named '${RESERVED_INDEX_NAME}' — that name is the ` +
      `record's own collection wherever an index is selected.`,
    );
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `e3.recordIndex '${name}' must be an identifier — it names a query ` +
      `selector in URLs and on the command line.`,
    );
  }
  // An assembled record — a package's `records.plans` — carries its indexes
  // already; a bare one is checked when `e3.package` folds indexes onto it.
  if (rec.indexes[name] !== undefined) {
    throw new Error(`e3.recordIndex '${name}' is already declared on record '${rec.name}'`);
  }

  const recordType = rec.type as unknown as { type: string; key: EastType; value: EastType };
  if (recordType.type !== 'Dict') {
    throw new Error(
      `e3.recordIndex '${name}' indexes a Dict record — '${rec.name}' holds ` +
      `${printType(rec.type)}, which has no (key, value) entry to index. A Set or ` +
      `Array record is read in its own order only.`,
    );
  }
  const keyType = recordType.key;
  const valueType = recordType.value;

  if ([spec.interval ?? spec.on, spec.key, spec.keys].filter((part) => part !== undefined).length !== 1) {
    throw new Error(
      `e3.recordIndex '${name}' takes exactly one of 'key' (one entry per row) ` +
      `or 'keys' (one per element of a returned Set), 'on' (row fields), or 'interval' (with optional leading 'on' fields)`,
    );
  }
  const prefix = spec.on === undefined ? undefined : fieldKey(name, keyType, valueType, spec.on);
  const generated = spec.interval === undefined ? prefix
    : intervalKey(name, keyType, valueType, spec.on ?? [], spec.interval, prefix);
  const multi = generated?.multi ?? (spec.keys !== undefined);
  const keyFn = generated?.fn ?? (spec.key ?? spec.keys)!;

  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);

  checkPure(`e3.recordIndex '${name}' ${multi ? "'keys' function" : "'key' function"}`, keyFn, INDEX_PURITY);
  const keySig = signatureOf(keyFn);
  checkEntryParams(name, multi ? "'keys' function" : "'key' function", keyType, valueType, keySig.inputs);

  let indexKeyType = keySig.output;
  if (multi) {
    const returned = keySig.output as unknown as { type: string; key: EastType };
    if (returned.type !== 'Set') {
      throw new Error(
        `e3.recordIndex '${name}' declared with 'keys' must return a Set of index ` +
        `keys — one entry per element — but returns ${printType(keySig.output)}. ` +
        `For one entry per row use 'key'.`,
      );
    }
    indexKeyType = returned.key;
  }

  let projectionType: EastType = NullType;
  if (spec.value !== undefined) {
    checkPure(`e3.recordIndex '${name}' 'value' projection`, spec.value, INDEX_PURITY);
    const valueSig = signatureOf(spec.value);
    checkEntryParams(name, "'value' projection", keyType, valueType, valueSig.inputs);
    projectionType = valueSig.output;
  }

  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: (spec.interval !== undefined ? Object.freeze([...(spec.on ?? []), spec.interval.from])
      : spec.on === undefined ? undefined : Object.freeze([...spec.on])) as IndexOn<S>,
    interval: (spec.interval === undefined ? undefined : Object.freeze({ ...spec.interval })) as ({ readonly from: string; readonly to: string } | undefined) & IndexInterval<S>,
    keyFn,
    ...(spec.value !== undefined && { valueFn: spec.value }),
    multi,
    // The signature read above IS the type the spec's functions declare; the
    // casts only restate it at the TypeScript level.
    keyType: indexKeyType as IndexKeyOf<S, T>,
    valueType: projectionType as ProjectionOf<S>,
    runner,
  };
}
