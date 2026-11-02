/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Mutation definitions for e3 packages — the write half of the record
 * machinery (CQRS; `e3.function` is the read half).
 *
 * There are three write forms and they all commit the same thing: a mutation
 * delta, the primary's and every index's changes addressed by key, which the
 * engine applies segment by segment. They differ in how the author says what
 * changed — a reducer over the whole state, a body writing through an `edit`
 * capability, or a patch sent by whoever made the edit — and so in what a
 * write costs.
 *
 * All three are pure East: purity is what makes retry-on-conflict safe, since
 * the compare-and-swap loop can re-run against fresher state with no
 * observable side effects. A record declares them in its `mutations`, as
 * `mutation.reduce`, `mutation.edit` and `mutation.patch`; `e3.mutation.editType`
 * is the type of the `edit` capability.
 */

import type { EastType } from '@elaraai/east';
import { NullType, PatchType, printType } from '@elaraai/east';
import { editTypeOf } from '@elaraai/e3-types';
import type { MutationDef, RecordDef } from './types.js';
import { hasKeyedDelta } from './record-programs.js';
import { checkPure, sameEastType, signatureOf, type IndexFunction } from './record-guards.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

/** A mutation's name is an identifier, as a migration's and an index's are: it
 *  names the commits the mutation makes, beside e3's own, which begin with `$`,
 *  and `e3 mutate` addresses it as `record.mutation`. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Refuses a mutation name that is not an identifier. */
function checkName(words: string, name: string): void {
  if (!IDENTIFIER.test(name)) {
    throw new Error(
      `${words} requires a name that is an identifier, got '${name}' — it names the record's ` +
      `commits beside e3's own, which begin with '$', and \`e3 mutate\` addresses it as record.mutation.`,
    );
  }
}

/** The shared guards: a synchronous, platform-free body whose leading
 *  parameter is the record's state. Returns the body's signature. */
function checkBody(
  words: string, name: string, rec: RecordDef, fn: { toIR(): unknown },
): { inputs: readonly EastType[]; output: EastType } {
  checkName(words, name);
  checkPure(`${words} '${name}' body`, fn, {
    async: 'an async body implies platform IO, which the compare-and-swap retry loop cannot safely re-run against fresher state.',
    platform: 'the compare-and-swap retry loop re-runs the mutation, so a platform call makes the committed record non-deterministic across retries.',
  });
  const signature = signatureOf(fn);
  if (signature.inputs.length < 1 || !sameEastType(rec.type, signature.inputs[0]!)) {
    const got = signature.inputs.length ? printType(signature.inputs[0]!) : 'no parameters';
    throw new Error(
      `${words} '${name}' body's first parameter must be the record's ` +
      `state type ${printType(rec.type)}, but got ${got}.`,
    );
  }
  return signature;
}

/** Refuses a form whose delta cannot be addressed by key. An Array record's
 *  patch is positional and a scalar's is a whole replace, so neither can be
 *  applied segment by segment — and both are exactly what the `reduce` form
 *  already handles by writing the state whole. */
function checkKeyed(words: string, name: string, rec: RecordDef): void {
  if (!hasKeyedDelta(rec.type)) {
    throw new Error(
      `${words} '${name}' writes a delta addressed by key, so it needs a ` +
      `Dict or Set record — '${rec.name}' holds ${printType(rec.type)}. Use ` +
      `mutation.reduce, whose reducer returns the whole state.`,
    );
  }
}

/**
 * Builds a reducer's definition, `(state, ...args) => state`: a pure,
 * synchronous body whose first parameter and whose return are the record's state.
 *
 * @param words - The declaration, as a refusal names it
 * @param name - The mutation
 * @param rec - The record it writes
 * @param fn - The reducer `(state, ...args) => state`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} When the name is not an identifier, the runner is not a known runtime, the body is async or calls a
 *   platform function, or its first parameter or its return is not the record's state
 */
export function reduceDefinition(
  words: string, name: string, rec: RecordDef, fn: IndexFunction, config: { runner?: FunctionRunner } | undefined,
): MutationDef {
  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);

  const signature = checkBody(words, name, rec, fn);
  // The reducer is (state, ...args) => state: the return must be the record's
  // state type too. The typed overload enforces this at compile time, but a
  // dynamic / cast caller could pass a mismatched function — and because
  // MutationObject omits the output type (it IS the record type), a mismatch
  // would be silently undetectable downstream.
  if (!sameEastType(rec.type, signature.output)) {
    throw new Error(
      `${words} '${name}' reducer must return the record's state type ` +
      `${printType(rec.type)}, but returns ${printType(signature.output)}.`,
    );
  }

  return {
    kind: 'mutation',
    name,
    record: rec,
    form: 'reduce',
    // Keep the full EastIR bundle (IR + source map) so export.ts can encode
    // with encodeEastIR and preserve source locations.
    body: fn.toIR() as MutationDef['body'],
    fn,
    // The extra parameter types are everything after the leading state parameter.
    argTypes: signature.inputs.slice(1),
    runner,
  };
}

/**
 * Builds an edit body's definition, `(state, ...args, edit) => null`: a pure,
 * synchronous body writing a Dict or Set record through its last parameter,
 * the `edit` capability.
 *
 * @param words - The declaration, as a refusal names it
 * @param name - The mutation
 * @param rec - The record it writes
 * @param fn - The body `(state, ...args, edit) => null`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} When the name is not an identifier, the runner is not a known runtime, the record is not a Dict or a
 *   Set, the body is async or calls a platform function, or its parameters or its return are not the form's
 */
export function editDefinition(
  words: string, name: string, rec: RecordDef, fn: IndexFunction, config: { runner?: FunctionRunner } | undefined,
): MutationDef {
  const runner = config?.runner ?? DEFAULT_RUNNER;
  runnerToVariant(runner);
  checkKeyed(words, name, rec);

  const signature = checkBody(words, name, rec, fn);
  const editType = editTypeOf(rec.type);
  const last = signature.inputs[signature.inputs.length - 1];
  if (signature.inputs.length < 2 || last === undefined || !sameEastType(editType, last)) {
    throw new Error(
      `${words} '${name}' body's LAST parameter must be the edit ` +
      `capability ${printType(editType)} — e3.mutation.editType of the record's type — but got ` +
      `${last === undefined ? 'no parameters' : printType(last)}.`,
    );
  }
  if (!sameEastType(NullType, signature.output)) {
    throw new Error(
      `${words} '${name}' body writes through 'edit' and returns Null, ` +
      `but returns ${printType(signature.output)}. Use mutation.reduce for a reducer ` +
      `that returns the whole state.`,
    );
  }

  return {
    kind: 'mutation',
    name,
    record: rec,
    form: 'edit',
    body: fn.toIR() as MutationDef['body'],
    fn,
    // The extra parameters sit between the leading state and the trailing edit.
    argTypes: signature.inputs.slice(1, -1),
    runner,
  };
}

/**
 * Builds the patch door's definition: no body, its argument the change, a
 * `PatchType` of a Dict or Set record's state.
 *
 * @param words - The declaration, as a refusal names it
 * @param name - The mutation
 * @param rec - The record it writes
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} When the name is not an identifier, the runner is not a known runtime, or the record is not a Dict or a Set
 */
export function patchDefinition(words: string, name: string, rec: RecordDef, config: { runner?: FunctionRunner } | undefined): MutationDef {
  checkName(words, name);
  const runner = config?.runner ?? DEFAULT_RUNNER;
  runnerToVariant(runner);
  checkKeyed(words, name, rec);

  return {
    kind: 'mutation',
    name,
    record: rec,
    form: 'patch',
    argTypes: [PatchType(rec.type)],
    runner,
  };
}

/**
 * What a record's mutations need beside their builder: `editType(type)`, the
 * type of the capability an `edit` body writes through, its last parameter.
 */
export const mutation = { editType: editTypeOf };
