/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Input dataset definitions for e3 packages.
 */

import type { EastType, ValueTypeOf } from '@elaraai/east';
import { isVariant, StringType, VariantType, variant } from '@elaraai/east';
import type { DatasetDef, DataTreeDef } from './types.js';

/**
 * Singleton datatree definition for `.inputs`.
 *
 * All input datasets are children of this datatree.
 */
export const inputsTree: DataTreeDef = {
  kind: 'datatree',
  name: 'inputs',
  path: [variant('field', 'inputs')],
  deps: new Set(),
};

/**
 * Where an input's initial value comes from.
 *
 * @remarks
 * Two cases, one shape: `value` holds the value inline (it travels in the
 * package), while `file` names a beast2 file that stays where it is and is
 * adopted into the object store by hash at deploy. A 2 GB delivery is therefore
 * an ordinary content-addressed dataset — in the inputs hash, paged by every
 * runner, carved by `partitionTask` — instead of a String input plus a
 * `FileSystem.openBeast` inside a task body.
 *
 * @typeParam T - The East type of the input value
 */
export const DatasetSourceType = <T extends EastType>(type: T) =>
  VariantType({ value: type, file: StringType });
export type DatasetSourceType<T extends EastType> = ReturnType<typeof DatasetSourceType<T>>;

/**
 * A value for {@link DatasetSourceType} — what {@link input}'s third argument
 * is.
 *
 * @typeParam T - The East type of the input value
 */
export type DatasetSource<T extends EastType> = ValueTypeOf<DatasetSourceType<T>>;

/** The tags {@link input} accepts, for the definition-time refusal. */
const SOURCE_TAGS = new Set(['value', 'file']);

/**
 * Defines an input dataset.
 *
 * Creates a dataset at `.inputs.${name}` in the workspace.
 *
 * @typeParam T - The East type of the input value
 * @param name - Dataset name (used as path segment in the tree)
 * @param type - East type of the input value
 * @param source - Where the initial value comes from: `variant('value', v)`
 * inline, or `variant('file', path)` for a beast2 file on the deploying
 * machine. Omit it for an input that is unassigned until something sets it.
 * @returns A DatasetDef that can be used in dataflows and packages
 *
 * @throws {Error} When the third argument is not one of those two variants —
 * the bare-value form (`input('n', StringType, 'World')`) is no longer
 * accepted, because a value and a path are not distinguishable once the type is
 * `StringType`.
 *
 * @example
 * ```ts
 * import { ArrayType, DictType, FloatType, IntegerType, StringType, variant } from '@elaraai/east';
 *
 * // A small value, inline in the package
 * const rates = input('rates', DictType(StringType, FloatType), variant('value', new Map([['AUD', 1.0]])));
 *
 * // A large delivery, adopted by hash at deploy — the file is the value
 * const table = input('table', ArrayType(RowType), variant('file', './deliveries/TABLE.beast2'));
 *
 * // Unassigned until something sets it
 * const count = input('count', IntegerType);
 * ```
 */
export function input<Name extends string, T extends EastType>(
  name: Name,
  type: T,
  source?: DatasetSource<T>,
): DatasetDef<T, [ variant<"field", "inputs">, variant<"field", Name> ]> {
  if (source !== undefined && !(isVariant(source) && SOURCE_TAGS.has(source.type))) {
    throw new Error(
      `e3.input('${name}'): the third argument is a source — variant('value', v) ` +
      `or variant('file', path)`
    );
  }
  return {
    kind: 'dataset',
    name,
    path: [variant('field', 'inputs'), variant('field', name)],
    type,
    source,
    writable: true,
    deps: new Set([...inputsTree.deps, inputsTree]),
  };
}
