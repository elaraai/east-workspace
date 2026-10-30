/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Migration definitions for e3 records: the steps a deploy runs over a
 * workspace's state when a package changes a record's type, or its values.
 *
 * A record's migrations are one chain: the steps its declaration lists, in the
 * order they run, each checked against the step before it. A deploy runs the
 * steps a workspace has not applied and records each by its name, so a step
 * keeps its identity when its code moves or its package is re-exported.
 *
 * The three forms differ in what the author's function sees, and so in what a
 * step costs: `migration.value` the whole state, `migration.rows` one row at a
 * time, and `migration.rekey` one row at a time under a new key. Each function
 * is pure East for the reason a mutation's is: a step runs again in every
 * workspace that has not applied it, a piece at a time, and must migrate every
 * one the same way.
 */

import type { EastType } from '@elaraai/east';
import { ArrayType, DictType, SetType, printType } from '@elaraai/east';
import type { MigrationForm } from '@elaraai/e3-types';
import type { MigrationDef, RecordDef } from './types.js';
import { bundleOf, checkPure, sameEastType, signatureOf, type IndexFunction } from './record-guards.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

/** A migration's name is an identifier, as an index's is: a workspace records
 *  the steps it has applied by their names. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Checks a step and declares it, with the record's types before and after it
 * as its function's signature gives them.
 *
 * @throws {Error} When the name is not an identifier, the runner is not a known
 *   runtime, the function is async or calls a platform function, its signature
 *   is not the form's, or the step before it leaves the record as another type
 *   than this step takes.
 */
function declare(
  surface: string,
  form: MigrationForm,
  name: string,
  rec: RecordDef,
  fn: { toIR(): unknown },
  config: { runner?: FunctionRunner } | undefined,
  previous: MigrationDef | undefined,
  recordTypes: (inputs: readonly EastType[], output: EastType) => { from: EastType; to: EastType },
): MigrationDef {
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

  const { inputs, output } = signatureOf(fn);
  let types: { from: EastType; to: EastType };
  try {
    types = recordTypes(inputs, output);
  } catch (err) {
    throw new Error(`${subject}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (previous !== undefined && !sameEastType(previous.to, types.from)) {
    throw new Error(
      `${subject} takes the record as ${printType(types.from)}, but '${previous.name}', the step ` +
      `before it, leaves it as ${printType(previous.to)}.`,
    );
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
    body: bundleOf(fn),
    fn,
    runner,
  };
}

/** Each form's record types before and after a step, read off its function's signature. */
const STEP_TYPES: Readonly<Record<MigrationForm, (inputs: readonly EastType[], output: EastType) => { from: EastType; to: EastType }>> = {
  value: (inputs, output) => {
    if (inputs.length !== 1) {
      throw new Error(`a value step's function takes the record's state alone, but takes ${inputs.length} parameters.`);
    }
    return { from: inputs[0]!, to: output };
  },
  rows: (inputs, output) => {
    if (inputs.length === 1) return { from: ArrayType(inputs[0]!), to: ArrayType(output) };
    if (inputs.length === 2) return { from: DictType(inputs[0]!, inputs[1]!), to: DictType(inputs[0]!, output) };
    throw new Error(
      `a rows step's function takes a Dict's row, (key, value), or an Array's element, but takes ` +
      `${inputs.length} parameters.`,
    );
  },
  rekey: (inputs, output) => {
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
  },
};

/**
 * Builds a migration step's definition in a form, each guard of the form's
 * applied: its name, its purity, its signature, and its place after the step
 * before it.
 *
 * @param surface - The declaration, as a refusal names it
 * @param form - The step's form
 * @param name - The step
 * @param rec - The record it changes
 * @param fn - Its function
 * @param config - Its runner
 * @param previous - The step before it in the record's list; none for the first
 * @returns The definition
 * @throws {Error} When the name is not an identifier, the runner is not a known
 *   runtime, the function is async, calls a platform function or does not fit
 *   the form, or the step before it leaves the record as another type than it takes
 */
export function stepDefinition(
  surface: string, form: MigrationForm, name: string, rec: RecordDef, fn: IndexFunction,
  config: { runner?: FunctionRunner } | undefined, previous: MigrationDef | undefined,
): MigrationDef {
  return declare(surface, form, name, rec, fn, config, previous, STEP_TYPES[form]);
}
