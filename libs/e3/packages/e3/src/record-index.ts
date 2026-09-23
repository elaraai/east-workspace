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

import type { EastType, FunctionExpr, SetType } from '@elaraai/east';
import {
  AsyncEastIR, EastTypeType, Expr, NullType, equalFor, printType, toEastTypeValue, walkIR,
} from '@elaraai/east';
import type { RecordDef, RecordIndexDef } from './types.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

// Structural East-type equality, the same primitive the redeploy type-change
// guard uses (e3-core workspaces.ts): compare the encoded EastTypeValues.
const typeValueEqual = equalFor(EastTypeType);
const sameEastType = (a: EastType, b: EastType): boolean =>
  typeValueEqual(toEastTypeValue(a), toEastTypeValue(b));

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

/** What an index keys on: exactly one of `key` (one entry per row) or `keys`
 *  (one per element of a returned Set), and an optional covering projection. */
export type RecordIndexSpec = {
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
 * The index key a spec declares: `key`'s return, or the element of the Set
 * `keys` returns.
 *
 * @remarks
 * Read off the spec the caller actually wrote, so the factory's parameter
 * keeps the weak {@link IndexFunction} shape the inline callbacks need while
 * its result carries the precise key type — which is what types a window read
 * through the index, and so every component that renders one.
 */
export type IndexKeyOf<S> =
  S extends { key: infer F } ? OutputOf<F>
  : S extends { keys: infer F } ? (OutputOf<F> extends SetType<infer IK> ? IK : EastType)
  : EastType;

/** The covering projection a spec declares: `value`'s return, Null when the
 *  spec has no `value`, and any type when it only might. */
export type ProjectionOf<S> =
  S extends { value: infer F } ? OutputOf<F>
  : 'value' extends keyof S ? EastType
  : NullType;

/** The signature of a function an index declares, as the guards see it. */
function signatureOf(fn: IndexFunction): { inputs: EastType[]; output: EastType } {
  return Expr.type(fn as unknown as Expr<any>) as { inputs: EastType[]; output: EastType };
}

/** Refuses an index function that is async or reaches a platform function.
 *  Both make the index non-deterministic, and an index that does not equal its
 *  rebuild is worse than no index: the view it serves is quietly wrong. */
function checkPure(name: string, role: string, fn: IndexFunction): void {
  const ir = fn.toIR();
  if (ir instanceof AsyncEastIR) {
    throw new Error(
      `e3.recordIndex '${name}' ${role} must be a synchronous East function — ` +
      `an async function implies platform IO, and an index is rebuilt from the ` +
      `record whenever it is dropped or its declaration changes.`,
    );
  }
  walkIR((ir as { ir: never }).ir, (node) => {
    if (node.type === 'Platform') {
      throw new Error(
        `e3.recordIndex '${name}' ${role} must not call platform functions ` +
        `(found '${node.value.name}') — the index is maintained on every commit ` +
        `and rebuilt on demand, so a platform call makes the two disagree.`,
      );
    }
  });
}

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
 * @param name - Index name (unique on the record, and never `primary`)
 * @param rec - The record to index
 * @param spec - Exactly one of `key` / `keys`, and an optional `value`
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
 * // Many keys per row: a Set return.
 * const byResource = e3.recordIndex('by_resource', plans, {
 *   keys: East.function([PlanKeyType, PlanRowType], SetType(ResourceRefType),
 *           ($, k, v) => v.resources),
 * });
 *
 * const pkg = e3.package('planning', '1.0.0', plans, byStatus, byResource);
 * ```
 */
export function recordIndex<Name extends string, T extends EastType, S extends RecordIndexSpec>(
  name: Name,
  rec: RecordDef<T>,
  spec: S,
  config?: { runner?: FunctionRunner },
): RecordIndexDef<Name, T, IndexKeyOf<S>, ProjectionOf<S>> {
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

  if ((spec.key === undefined) === (spec.keys === undefined)) {
    throw new Error(
      `e3.recordIndex '${name}' takes exactly one of 'key' (one entry per row) ` +
      `or 'keys' (one per element of a returned Set)`,
    );
  }
  const multi = spec.keys !== undefined;
  const keyFn = (spec.key ?? spec.keys)!;

  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);

  checkPure(name, multi ? "'keys' function" : "'key' function", keyFn);
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
    checkPure(name, "'value' projection", spec.value);
    const valueSig = signatureOf(spec.value);
    checkEntryParams(name, "'value' projection", keyType, valueType, valueSig.inputs);
    projectionType = valueSig.output;
  }

  return {
    kind: 'recordIndex',
    name,
    record: rec,
    keyFn,
    ...(spec.value !== undefined && { valueFn: spec.value }),
    multi,
    // The signature read above IS the type the spec's functions declare; the
    // casts only restate it at the TypeScript level.
    keyType: indexKeyType as IndexKeyOf<S>,
    valueType: projectionType as ProjectionOf<S>,
    runner,
  };
}
