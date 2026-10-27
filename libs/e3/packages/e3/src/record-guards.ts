/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The guards a record's declarations share. A mutation, an index and a
 * migration each run an author's function where the data is, again and again,
 * and each must give the same result every time it runs.
 *
 * @packageDocumentation
 */

import type { EastType } from '@elaraai/east';
import { AsyncEastIR, EastTypeType, Expr, FunctionExpr, FunctionType, equalFor, printType, toEastTypeValue, walkIR } from '@elaraai/east';
import type { RecordDef } from './types.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

// Structural East-type equality, the same primitive the redeploy type-change
// guard uses (e3-core workspaces.ts): compare the encoded EastTypeValues.
const typeValueEqual = equalFor(EastTypeType);

/**
 * Whether two East types are the same type.
 *
 * @param a - One type
 * @param b - The other
 * @returns Whether their type values are equal
 */
export function sameEastType(a: EastType, b: EastType): boolean {
  return typeValueEqual(toEastTypeValue(a), toEastTypeValue(b));
}

/**
 * Refuses an author's function that is async or reaches a platform function.
 *
 * @remarks
 * An async function implies platform IO. A synchronous platform call is an
 * ordinary function IR, so the whole body is walked for one: `walkIR` descends
 * into nested closures, loop bodies and collection-op lambdas.
 *
 * @param subject - The function as the error names it, such as
 *   `e3.mutation.reduce 'place' body`
 * @param fn - The function
 * @param why - Why the declaration refuses each, which ends its error
 * @throws {Error} When the function is async, or calls a platform function.
 */
export function checkPure(subject: string, fn: { toIR(): unknown }, why: { async: string; platform: string }): void {
  const ir = fn.toIR();
  if (ir instanceof AsyncEastIR) {
    throw new Error(`${subject} must be a synchronous East function — ${why.async}`);
  }
  walkIR((ir as { ir: never }).ir, (node) => {
    if (node.type === 'Platform') {
      throw new Error(`${subject} must not call platform functions (found '${node.value.name}') — ${why.platform}`);
    }
  });
}

// ── An index's declaration ────────────────────────────────────────────────────

/** The index name reserved for the record's own collection wherever an index
 *  is selected — a page, a key search, an arm of the mutation delta. */
export const RESERVED_INDEX_NAME = 'primary';

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

/** The constructor a refusal names. */
export type IndexConstructor = 'e3.recordIndex' | 'e3.recordIndex.interval' | 'e3.recordIndex.area' | 'e3.recordIndex.series' | 'e3.recordIndex.summary';

/**
 * The signature of a function an index declares, as the guards see it.
 *
 * @param fn - The function
 * @returns Its parameter types and its output type
 * @throws {Error} When it is not an East function
 */
export function signatureOf(fn: IndexFunction): { inputs: readonly EastType[]; output: EastType } {
  const type = fn instanceof Expr ? Expr.type(fn) : undefined;
  if (type?.type !== 'Function') throw new Error('an index function is an East function');
  return { inputs: type.inputs, output: type.output };
}

/**
 * An index's function as an East function of the signature its caller reads it
 * at — a definition keeps it as an expression ({@link IndexFunction}) —
 * checked to be exactly that.
 *
 * @param fn - The function
 * @param inputs - Its parameter types
 * @param output - Its output type
 * @returns It, at that signature
 * @throws {Error} When it is not an East function, or not of that signature
 */
export function indexFunctionAt<I extends EastType[], O extends EastType>(fn: IndexFunction, inputs: [...I], output: O): FunctionExpr<I, O> {
  if (!(fn instanceof FunctionExpr)) throw new Error('an index function is an East function');
  const declared = FunctionType(inputs, output);
  if (!sameEastType(Expr.type(fn), declared)) {
    throw new Error(`an index function of type ${printType(Expr.type(fn))} is read as ${printType(declared)}`);
  }
  // Checked above: it was built at the signature asked for.
  return fn as FunctionExpr<I, O>;
}

/** Why an index function may be neither async nor reach a platform function:
 *  either makes the index non-deterministic, and an index that does not equal
 *  its rebuild is worse than no index, since the view it serves is quietly
 *  wrong. */
export const INDEX_PURITY = {
  async: 'an async function implies platform IO, and an index is rebuilt from the record whenever it is dropped or its declaration changes.',
  platform: 'the index is maintained on every commit and rebuilt on demand, so a platform call makes the two disagree.',
};

/** Refuses an index function whose parameters are not the record's entry. */
export function checkEntryParams(name: string, role: string, keyType: EastType, valueType: EastType, inputs: readonly EastType[]): void {
  if (inputs.length !== 2 || !sameEastType(keyType, inputs[0]!) || !sameEastType(valueType, inputs[1]!)) {
    const got = inputs.length === 0 ? 'no parameters' : inputs.map((t) => printType(t)).join(', ');
    throw new Error(
      `e3.recordIndex '${name}' ${role} must take the record's entry ` +
      `(${printType(keyType)}, ${printType(valueType)}), but got ${got}.`,
    );
  }
}

/**
 * A record's entry types, once an index's name and its record pass: a name that
 * is an identifier, never `primary`, declared once on the record, over a Dict
 * record.
 *
 * Every guard here is a definition-time error rather than a deploy failure.
 *
 * @param constructor - The constructor, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @returns The record's key and row types
 * @throws {Error} Naming what to change
 */
export function indexedEntry(constructor: IndexConstructor, name: string, rec: RecordDef): { keyType: EastType; valueType: EastType } {
  if (!name) {
    throw new Error(`${constructor} requires a non-empty name`);
  }
  if (name === RESERVED_INDEX_NAME) {
    throw new Error(
      `${constructor} cannot be named '${RESERVED_INDEX_NAME}' — that name is the ` +
      `record's own collection wherever an index is selected.`,
    );
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `${constructor} '${name}' must be an identifier — it names a query ` +
      `selector in URLs and on the command line.`,
    );
  }
  // An assembled record — a package's `records.plans` — carries its indexes
  // already; a bare one is checked when `e3.package` folds indexes onto it.
  if (rec.indexes[name] !== undefined) {
    throw new Error(`${constructor} '${name}' is already declared on record '${rec.name}'`);
  }
  const recordType: EastType = rec.type;
  if (recordType.type !== 'Dict') {
    throw new Error(
      `${constructor} '${name}' indexes a Dict record — '${rec.name}' holds ` +
      `${printType(rec.type)}, which has no (key, value) entry to index. A Set or ` +
      `Array record is read in its own order only.`,
    );
  }
  return { keyType: recordType.key, valueType: recordType.value };
}

/** Refuses an option a constructor does not take, naming those it does. */
export function onlyOptions(constructor: IndexConstructor, name: string, spec: object, options: readonly string[], instead?: string): void {
  const extra = Object.keys(spec).filter((option) => !options.includes(option));
  if (extra.length === 0) return;
  throw new Error(
    `${constructor} '${name}' takes ${options.join(', ')}, not ${extra.join(', ')}` + (instead === undefined ? '' : ` — ${instead}`),
  );
}

/**
 * An index's runner: the one it declares, or the default, checked now so a bad
 * runner fails at definition time, not at export.
 *
 * @param config - The declaration's runner selection
 * @returns The runner
 */
export function indexRunner(config: { runner?: FunctionRunner } | undefined): FunctionRunner {
  const runner = config?.runner ?? DEFAULT_RUNNER;
  runnerToVariant(runner);
  return runner;
}

/**
 * An index's key and projection functions, checked as every constructor checks
 * them: pure, over the record's entry, a `keys` function returning a Set.
 *
 * @returns The runner, and the index key and projection types the functions declare
 */
export function indexFunctions(
  name: string, keyType: EastType, valueType: EastType,
  keyFn: IndexFunction, multi: boolean, valueFn: IndexFunction | undefined, config: { runner?: FunctionRunner } | undefined,
): { runner: FunctionRunner; indexKeyType: EastType; projectionType: EastType | undefined } {
  const runner = indexRunner(config);
  checkPure(`e3.recordIndex '${name}' ${multi ? "'keys' function" : "'key' function"}`, keyFn, INDEX_PURITY);
  const keySig = signatureOf(keyFn);
  checkEntryParams(name, multi ? "'keys' function" : "'key' function", keyType, valueType, keySig.inputs);

  let indexKeyType = keySig.output;
  if (multi) {
    const returned = keySig.output;
    if (returned.type !== 'Set') {
      throw new Error(
        `e3.recordIndex '${name}' declared with 'keys' must return a Set of index ` +
        `keys — one entry per element — but returns ${printType(keySig.output)}. ` +
        `For one entry per row use 'key'.`,
      );
    }
    indexKeyType = returned.key;
  }

  let projectionType: EastType | undefined;
  if (valueFn !== undefined) {
    checkPure(`e3.recordIndex '${name}' 'value' projection`, valueFn, INDEX_PURITY);
    const valueSig = signatureOf(valueFn);
    checkEntryParams(name, "'value' projection", keyType, valueType, valueSig.inputs);
    projectionType = valueSig.output;
  }
  return { runner, indexKeyType, projectionType };
}

