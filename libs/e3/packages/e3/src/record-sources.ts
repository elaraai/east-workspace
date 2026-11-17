/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A composite record's sources: each one's definition, built and checked as
 * the record is declared, and what the sources say of the record's key — the
 * cases the solution's own sources are, and the capability its `edit` bodies
 * write through, which takes a key of those cases alone.
 *
 * @packageDocumentation
 */

import { DictType, PatchType, VariantType, printType, toEastTypeValue, type EastType } from '@elaraai/east';
import { editTypeOf } from '@elaraai/e3-types';
import type { DatasetDef, RecordDef, RecordSourceDef, TaskDef } from './types.js';
import { bundleOf, checkPure, indexRunner, sameEastType, signatureOf, type IndexFunction } from './record-guards.js';
import type { FunctionRunner } from './runner.js';

/**
 * The names of the sources of a record its mutations may write: the solution's
 * own, in the order of their names.
 *
 * @param sources - A composite record's sources, by name
 * @returns The names of those declared with `source.mutations`
 */
export function solutionSourceNames(sources: Readonly<Record<string, RecordSourceDef>>): string[] {
  return Object.values(sources).filter((source) => !source.external).map((source) => source.name).sort();
}

/**
 * The key a composite record's mutations may write under: the variant of its
 * solution sources' cases alone.
 *
 * @param sources - A composite record's sources, by name
 * @returns The variant type, or undefined for a record every source of which is external
 */
export function solutionKeyType(sources: Readonly<Record<string, RecordSourceDef>>): VariantType<Record<string, EastType>> | undefined {
  const names = solutionSourceNames(sources);
  if (names.length === 0) return undefined;
  return VariantType(Object.fromEntries(names.map((name): [string, EastType] => [name, sources[name]!.key])));
}

/**
 * The capability a composite record's `edit` bodies write through: `set`,
 * `delete` and `update` over the keys of its solution sources alone, so a body
 * that names an external source's entry does not type-check where it is
 * written.
 *
 * @param rec - The record
 * @returns The capability's type; undefined for a record with no sources, whose
 *   bodies take `editTypeOf` of its type, and for one every source of which is
 *   external, which declares no mutation
 */
export function solutionEditType(rec: RecordDef): EastType | undefined {
  if (rec.sources === undefined) return undefined;
  const key = solutionKeyType(rec.sources);
  const type: EastType = rec.type;
  if (key === undefined || type.type !== 'Dict') return undefined;
  const row: EastType = type.value;
  return editTypeOf(DictType(key, row));
}

/** Why a load's function may be neither async nor reach a platform function. */
const LOAD_PURITY = {
  async: 'an async function implies platform IO, and a load runs again a piece at a time, from its cache and after a rollback, and must give the same entries each time.',
  platform: 'a load runs again a piece at a time, from its cache and after a rollback, so a platform call makes the entries it commits depend on when it ran.',
};

/**
 * What a source was given as a type, checked to be an East type.
 *
 * @param words - The source's declaration, as a refusal names it
 * @param what - Which of its arguments, and where it is given
 * @param value - What was given
 * @returns The type
 * @throws {Error} When it is not an East type
 */
function typeOf(words: string, what: string, value: unknown): EastType {
  const refusal = `${words} takes an East type as ${what}`;
  if (typeof value !== 'object' || value === null) throw new Error(refusal);
  try {
    toEastTypeValue(value as EastType);
  } catch {
    throw new Error(refusal);
  }
  return value as EastType;
}

/**
 * A source's key type, checked: an East type a Dict of the record's rows is
 * keyed by.
 *
 * @param words - The source's declaration, as a refusal names it
 * @param row - The record's row type
 * @param key - What was given as its key
 * @param form - How the source is declared, for the refusal
 * @returns The key type
 * @throws {Error} When it is no type, or no type a Dict is keyed by
 */
function keyOf(words: string, row: EastType, key: unknown, form: string): EastType {
  const type = typeOf(words, `its key — ${form}`, key);
  try {
    DictType(type, row);
  } catch {
    throw new Error(`${words} is keyed by ${printType(type)}, which no Dict is keyed by: a source's key is an immutable type, as a Dict's is`);
  }
  return type;
}

/**
 * Builds a source of the solution's own, `source.mutations(key)`: its entries
 * are written by the record's mutations.
 *
 * @param where - The declaration, as a refusal names it
 * @param name - The source
 * @param row - The record's row type
 * @param key - Its key type, as given
 * @returns The source
 * @throws {Error} When the key is no type a Dict is keyed by
 */
export function mutationsDefinition(where: string, name: string, row: EastType, key: unknown): RecordSourceDef {
  return { kind: 'recordSource', name, key: keyOf(`${where} '${name}'`, row, key, 'source.mutations(key)'), external: false, load: undefined };
}

/**
 * What a load is delivered, as given: a type, which `e3 load` delivers, or a
 * dataset of the package the dataflow loads it from — a task, which feeds it
 * its output, an input or a record.
 *
 * @param words - The source's declaration, as a refusal names it
 * @param form - How the source is declared, for the refusal
 * @param delivery - What was given
 * @returns The delivery's type, and the dataset that feeds it, if one does
 * @throws {Error} When it is an index of a record or a partition, which no load
 *   is fed, or neither a dataset nor a type
 */
function deliveryOf(words: string, form: string, delivery: unknown): { readonly type: EastType; readonly feed: DatasetDef | undefined } {
  const given = delivery as { readonly kind?: unknown } | null;
  if (typeof given === 'object' && given !== null && typeof given.kind === 'string') {
    const fed = given as DatasetDef | TaskDef | { readonly kind: string };
    if (fed.kind === 'task') {
      const output = (fed as TaskDef).output;
      return { type: output.type, feed: output };
    }
    if (fed.kind === 'dataset') return { type: (fed as DatasetDef).type, feed: fed as DatasetDef };
    const what = fed.kind === 'index' ? 'an index of a record, which the record\'s own state holds' : fed.kind === 'partition' ? 'a partition, which a stream task\'s work is split over' : `a ${fed.kind}`;
    throw new Error(`${words} is fed a task, an input or a record of the package, which the dataflow loads, or delivered a type — not ${what}`);
  }
  return { type: typeOf(words, `what it is delivered, or a task, an input or a record that feeds it — ${form}`, delivery), feed: undefined };
}

/**
 * Builds an external source, `source.load(key, delivery, fn)`: its key and
 * delivery types, and its load's function, checked — pure, synchronous East of
 * `(delivery, Dict<key, Row>) -> Patch(Dict<key, Row>)`. A source fed by a
 * dataset of the package is delivered the dataset's type.
 *
 * @param where - The declaration, as a refusal names it
 * @param name - The source
 * @param row - The record's row type
 * @param key - Its key type, as given
 * @param delivery - The type of what it is delivered, or the task, input or record that feeds it, as given
 * @param fn - Its load's function
 * @param config - Its runner selection; the records' default runner when it names none
 * @returns The source
 * @throws {Error} When the key is no type a Dict is keyed by, the delivery is neither a type nor a task, input or
 *   record, the runner is not a known runtime, or the function is async, calls a platform function or is not of the
 *   load's signature
 */
export function loadDefinition(
  where: string, name: string, row: EastType, key: unknown, delivery: unknown, fn: IndexFunction, config: { runner?: FunctionRunner } | undefined,
): RecordSourceDef {
  const words = `${where} '${name}'`;
  const form = 'source.load(key, delivery, fn)';
  const keyType = keyOf(words, row, key, form);
  const { type: deliveryType, feed } = deliveryOf(words, form, delivery);
  const runner = indexRunner(config);

  checkPure(`${words} function`, fn, LOAD_PURITY);
  const entries = DictType(keyType, row);
  const patch = PatchType(entries);
  const signature = signatureOf(fn);
  const fits = signature.inputs.length === 2 && sameEastType(signature.inputs[0]!, deliveryType)
    && sameEastType(signature.inputs[1]!, entries) && sameEastType(signature.output, patch);
  if (!fits) {
    throw new Error(
      `${words} function takes a delivery and the source's entries by its own key, and returns a patch of the entries — ` +
      `(${printType(deliveryType)}, ${printType(entries)}) -> ${printType(patch)} — but is ` +
      `(${signature.inputs.map((input) => printType(input)).join(', ')}) -> ${printType(signature.output)}`);
  }
  // A delivery keyed as the source is cut with the source's entries at the same keys.
  const keyed = (deliveryType.type === 'Dict' || deliveryType.type === 'Set') && sameEastType(deliveryType.key, keyType);
  return { kind: 'recordSource', name, key: keyType, external: true, load: { delivery: deliveryType, feed, body: bundleOf(fn), fn, keyed, runner } };
}
