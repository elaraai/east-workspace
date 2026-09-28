/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Migration definitions for e3 records: the steps a deploy runs over a
 * workspace's state when a package changes a record's type, or its values.
 *
 * A record's migrations are one chain. Each step names the one before it with
 * `after`, and `e3.package` folds the chain onto its record in order. A deploy
 * runs the steps a workspace has not applied and records each by its name, so
 * a step keeps its identity when its code moves or its package is re-exported.
 *
 * The three forms differ in what the author's function sees, and so in what a
 * step costs: `e3.migration.value` the whole state, `e3.migration.rows` one
 * row at a time, and `e3.migration.rekey` one row at a time under a new key.
 * Each function is pure East for the reason a mutation's is: a step runs again
 * in every workspace that has not applied it, a piece at a time, and must
 * migrate every one the same way.
 */

import type {
  AsyncFunctionExpr, CallableFunctionExpr, EastIR, EastType, FunctionExpr, StructType,
} from '@elaraai/east';
import { ArrayType, DictType, Expr, SetType, printType } from '@elaraai/east';
import type { MigrationForm } from '@elaraai/e3-types';
import type { MigrationDef, RecordDef } from './types.js';
import { checkPure, sameEastType } from './record-guards.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

/**
 * What a migration's declaration may add to its function.
 */
export type MigrationConfig = {
  /** The step before this one, a migration of the same record. The chain's
   *  first step has none. */
  readonly after?: MigrationDef;
  /** Runner selection (known runtimes only, like e3.function). */
  readonly runner?: FunctionRunner;
};

/** A migration's name is an identifier, as an index's is: a workspace records
 *  the steps it has applied by their names. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Checks a step and declares it, with the record's types before and after it
 * as its function's signature gives them.
 *
 * @throws {Error} When the name is not an identifier, the runner is not a known
 *   runtime, the function is async or calls a platform function, its signature
 *   is not the form's, or `after` is another record's step or leaves the record
 *   as another type than this step takes.
 */
function declare(
  form: MigrationForm,
  name: string,
  rec: RecordDef,
  fn: { toIR(): unknown },
  config: MigrationConfig | undefined,
  recordTypes: (inputs: EastType[], output: EastType) => { from: EastType; to: EastType },
): MigrationDef {
  const surface = `e3.migration.${form}`;
  if (!IDENTIFIER.test(name)) {
    throw new Error(
      `${surface} requires a name that is an identifier, got '${name}' — a workspace records ` +
      `the steps it has applied by their names.`,
    );
  }
  const subject = `${surface} '${name}'`;
  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);
  checkPure(`${subject} function`, fn, {
    async: 'an async function implies platform IO, and a migration runs again in every workspace that has not applied it.',
    platform: 'a migration runs again in every workspace that has not applied it, a piece at a time, so a platform call makes the migrated record depend on where and when it ran.',
  });

  const { inputs, output } = Expr.type(fn as unknown as Expr<any>) as { inputs: EastType[]; output: EastType };
  let types: { from: EastType; to: EastType };
  try {
    types = recordTypes(inputs, output);
  } catch (err) {
    throw new Error(`${subject}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const after = config?.after;
  if (after !== undefined) {
    if (after.record.name !== rec.name) {
      throw new Error(
        `${subject} follows '${after.name}', a migration of record '${after.record.name}' — a step ` +
        `follows a migration of its own record, '${rec.name}'.`,
      );
    }
    if (!sameEastType(after.to, types.from)) {
      throw new Error(
        `${subject} takes the record as ${printType(types.from)}, but '${after.name}', the step ` +
        `before it, leaves it as ${printType(after.to)}.`,
      );
    }
  }

  return {
    kind: 'migration',
    name,
    record: rec,
    form,
    from: types.from,
    to: types.to,
    // Keep the full EastIR bundle (IR + source map) so export.ts can encode
    // with encodeEastIR and preserve source locations.
    body: fn.toIR() as EastIR<any, any>,
    fn,
    ...(after !== undefined && { after }),
    runner,
  };
}

/**
 * Defines a migration of a record's whole state, from its old type to its new.
 *
 * The function is `(Old) => New`, for a record of any type. It runs as one
 * unit whose runner opens the state lazily, so a step that reads little of a
 * large record costs little, and one that rebuilds it costs the record.
 * {@link rows} and {@link rekey} migrate a collection a piece at a time.
 *
 * The function must be pure, synchronous East, as a mutation's reducer is: a
 * step runs again in every workspace that has not applied it. Its types are
 * read off its signature, and its chain is checked where it is declared: the
 * step it names as `after` must be a migration of the same record that leaves
 * the record as this step's `Old`. `e3.package` checks that the record's last
 * step leaves it as its declared type.
 *
 * @typeParam Name - Migration name (literal type)
 * @typeParam T - The record's declared state type
 * @typeParam From - The record's type before the step
 * @typeParam To - The record's type after it
 * @param name - Migration name: an identifier, unique on the record, by which
 *   a workspace records that it has applied the step
 * @param rec - The record this migration changes
 * @param fn - `(Old) => New`
 * @param config - The step before this one, and the runner
 * @returns A MigrationDef to pass to `e3.package`
 * @throws {Error} When the name is not an identifier, the function is async,
 *   calls a platform function or takes other than the one state, or `after`
 *   is another record's step or leaves the record as another type than `Old`.
 *
 * @example
 * ```ts
 * const RosterV1Type = DictType(StringType, StructType({ name: StringType }));
 * const RosterV2Type = DictType(StringType, StructType({ name: StringType, shift: StringType }));
 * const roster = e3.record('roster', RosterV2Type, new Map());
 *
 * // Every row gains a shift, from the whole state.
 * const addShift = e3.migration.value('add_shift', roster,
 *   East.function([RosterV1Type], RosterV2Type, ($, old) =>
 *     old.map(($, row) => ({ name: row.name, shift: 'day' }))));
 *
 * const pkg = e3.package('planning', '2.0.0', roster, addShift);
 * ```
 */
function value<Name extends string, T extends EastType, From extends EastType, To extends EastType>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[From], To> | CallableFunctionExpr<[From], To>,
  config?: MigrationConfig,
): MigrationDef<Name, T, From, To>;
function value(
  name: string,
  rec: RecordDef,
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: MigrationConfig,
): MigrationDef {
  return declare('value', name, rec, fn, config, (inputs, output) => {
    if (inputs.length !== 1) {
      throw new Error(`a value step's function takes the record's state alone, but takes ${inputs.length} parameters.`);
    }
    return { from: inputs[0]!, to: output };
  });
}

/**
 * Defines a migration of a collection record's rows, one at a time: a Dict's
 * rows with its keys unchanged, or an Array's elements in order.
 *
 * The function is `(K, V1) => V2` for a Dict, whose key it may read, or
 * `(T1) => T2` for an Array; its parameters say which. The step runs as a task
 * split over the stored state, so a record of any size migrates a piece at a
 * time, in parallel, each piece cached, and none holds more than its piece.
 *
 * The purity rules and chain checks of {@link value} apply unchanged.
 *
 * @typeParam Name - Migration name (literal type)
 * @typeParam T - The record's declared state type
 * @param name - Migration name: an identifier, unique on the record
 * @param rec - The record this migration changes
 * @param fn - `(T1) => T2` over an Array's elements, or `(K, V1) => V2` over a
 *   Dict's rows
 * @param config - The step before this one, and the runner
 * @returns A MigrationDef to pass to `e3.package`
 * @throws {Error} When the name is not an identifier, the function is async,
 *   calls a platform function or takes other than one or two parameters, or
 *   `after` is another record's step or leaves the record as another type.
 *
 * @example
 * ```ts
 * const RowV1Type = StructType({ title: StringType });
 * const RowV2Type = StructType({ title: StringType, owner: StringType });
 * const plans = e3.record('plans', DictType(StringType, RowV2Type), new Map());
 *
 * // Each row gains an owner; the keys are unchanged.
 * const addOwner = e3.migration.rows('add_owner', plans,
 *   East.function([StringType, RowV1Type], RowV2Type,
 *     ($, id, row) => ({ title: row.title, owner: 'unassigned' })));
 * ```
 */
function rows<Name extends string, T extends EastType, E1 extends EastType, E2 extends EastType>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[E1], E2> | CallableFunctionExpr<[E1], E2>,
  config?: MigrationConfig,
): MigrationDef<Name, T, ArrayType<E1>, ArrayType<E2>>;
function rows<Name extends string, T extends EastType, K extends EastType, V1 extends EastType, V2 extends EastType>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[K, V1], V2> | CallableFunctionExpr<[K, V1], V2>,
  config?: MigrationConfig,
): MigrationDef<Name, T, DictType<K, V1>, DictType<K, V2>>;
function rows(
  name: string,
  rec: RecordDef,
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: MigrationConfig,
): MigrationDef {
  return declare('rows', name, rec, fn, config, (inputs, output) => {
    if (inputs.length === 1) return { from: ArrayType(inputs[0]!), to: ArrayType(output) };
    if (inputs.length === 2) return { from: DictType(inputs[0]!, inputs[1]!), to: DictType(inputs[0]!, output) };
    throw new Error(
      `a rows step's function takes a Dict's row, (key, value), or an Array's element, but takes ` +
      `${inputs.length} parameters.`,
    );
  });
}

/**
 * Defines a migration that re-keys a collection record: a Dict's entries under
 * new keys, or a Set's elements.
 *
 * The function is `(K1, V1) => { key: K2, value: V2 }` for a Dict, or
 * `(T1) => T2` for a Set; its parameters say which. It is the task {@link rows}
 * runs, over each piece of the stored state, and the pieces' outputs are merged
 * by key. Two rows of a Dict landing on one key fail the deploy, naming it,
 * since their values may differ and neither can be chosen; two elements of a
 * Set landing on one are one element, as in any Set, and nothing is lost.
 *
 * The purity rules and chain checks of {@link value} apply unchanged.
 *
 * @typeParam Name - Migration name (literal type)
 * @typeParam T - The record's declared state type
 * @param name - Migration name: an identifier, unique on the record
 * @param rec - The record this migration changes
 * @param fn - `(T1) => T2` over a Set's elements, or
 *   `(K1, V1) => { key: K2, value: V2 }` over a Dict's entries
 * @param config - The step before this one, and the runner
 * @returns A MigrationDef to pass to `e3.package`
 * @throws {Error} When the name is not an identifier, the function is async,
 *   calls a platform function, takes other than one or two parameters, or over
 *   a Dict returns other than `{ key, value }`, when the new key is not a type
 *   a key may be, or when `after` is another record's step or leaves the record
 *   as another type.
 *
 * @example
 * ```ts
 * const PlanType = StructType({ site: StringType, title: StringType });
 * const plans = e3.record('plans', DictType(StringType, PlanType), new Map());
 *
 * // Plans were keyed by a number; they are keyed by site and title.
 * const bySite = e3.migration.rekey('by_site', plans,
 *   East.function([IntegerType, PlanType], StructType({ key: StringType, value: PlanType }),
 *     ($, id, plan) => ({ key: East.str`${plan.site}/${plan.title}`, value: plan })));
 * ```
 */
function rekey<Name extends string, T extends EastType, E1 extends EastType, E2 extends EastType>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[E1], E2> | CallableFunctionExpr<[E1], E2>,
  config?: MigrationConfig,
): MigrationDef<Name, T, SetType<E1>, SetType<E2>>;
function rekey<
  Name extends string, T extends EastType,
  K1 extends EastType, V1 extends EastType, K2 extends EastType, V2 extends EastType,
>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[K1, V1], StructType<{ key: K2; value: V2 }>>
    | CallableFunctionExpr<[K1, V1], StructType<{ key: K2; value: V2 }>>,
  config?: MigrationConfig,
): MigrationDef<Name, T, DictType<K1, V1>, DictType<K2, V2>>;
function rekey(
  name: string,
  rec: RecordDef,
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: MigrationConfig,
): MigrationDef {
  return declare('rekey', name, rec, fn, config, (inputs, output) => {
    if (inputs.length === 1) return { from: SetType(inputs[0]!), to: SetType(output) };
    if (inputs.length === 2) {
      const entry = output as unknown as { type: string; fields: Record<string, EastType> };
      const fields = entry.type === 'Struct' ? Object.keys(entry.fields) : [];
      if (fields.length !== 2 || !fields.includes('key') || !fields.includes('value')) {
        throw new Error(
          `a rekey step's function returns a Dict's entry under its new key, { key, value }, but ` +
          `returns ${printType(output)}.`,
        );
      }
      return { from: DictType(inputs[0]!, inputs[1]!), to: DictType(entry.fields.key!, entry.fields.value!) };
    }
    throw new Error(
      `a rekey step's function takes a Dict's entry, (key, value), or a Set's element, but takes ` +
      `${inputs.length} parameters.`,
    );
  });
}

/**
 * The migration forms of a record: {@link value}, {@link rows} and
 * {@link rekey}.
 */
export const migration = { value, rows, rekey };
