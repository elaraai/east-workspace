/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Value dataset definitions for e3 packages.
 *
 * `e3.value` is the honestly-named successor to `e3.input`: a root dataset
 * with replace-on-write semantics, mounted at `.values.<name>`. It reads and
 * writes identically to an input — the rename only moves the tree segment so
 * the name matches the behaviour. `e3.input` (and `.inputs.<name>`) stays as a
 * deprecated alias; existing packages are unaffected.
 */

import type { EastType, ValueTypeOf } from '@elaraai/east';
import { variant } from '@elaraai/east';
import type { DatasetDef, DataTreeDef } from './types.js';

/**
 * Singleton datatree definition for `.values`.
 *
 * All value datasets are children of this datatree.
 */
export const valuesTree: DataTreeDef = {
  kind: 'datatree',
  name: 'values',
  path: [variant('field', 'values')],
  deps: new Set(),
};

/**
 * Defines a value dataset — a root with replace-on-write semantics.
 *
 * Creates a dataset at `.values.${name}` in the workspace. This is the
 * preferred form over {@link input}; the two differ only in the tree segment
 * they mount under (`.values` vs `.inputs`).
 *
 * @typeParam T - The East type of the value
 * @param name - Dataset name (used as path segment in the tree)
 * @param type - East type of the value
 * @param defaultValue - Optional default value
 * @returns A DatasetDef that can be used in dataflows and packages
 *
 * @example
 * ```ts
 * import { StringType, IntegerType } from '@elaraai/east';
 *
 * // Value with default
 * const name = value('name', StringType, 'World');
 *
 * // Value without default
 * const count = value('count', IntegerType);
 * ```
 */
export function value<Name extends string, T extends EastType>(
  name: Name,
  type: T,
  defaultValue?: ValueTypeOf<T>,
): DatasetDef<T, [ variant<"field", "values">, variant<"field", Name> ]> {
  return {
    kind: 'dataset',
    name,
    path: [variant('field', 'values'), variant('field', name)],
    type,
    default: defaultValue,
    writable: true,
    deps: new Set([...valuesTree.deps, valuesTree]),
  };
}
