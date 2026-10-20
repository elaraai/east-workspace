/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Record dataset definitions for e3 packages.
 *
 * `e3.record` declares a root dataset whose writes go through typed, pure East
 * mutations (`e3.mutation`) instead of blind replace — durable, audited,
 * compare-and-swap state that participates in reactive dataflow as a root
 * input. The current state reads exactly like a value dataset; only the write
 * protocol differs.
 */

import type { EastType, ValueTypeOf } from '@elaraai/east';
import { variant } from '@elaraai/east';
import type { DataTreeDef, RecordDef } from './types.js';

/**
 * Singleton datatree definition for `.records`.
 *
 * All record datasets are children of this datatree.
 */
export const recordsTree: DataTreeDef = {
  kind: 'datatree',
  name: 'records',
  path: [variant('field', 'records')],
  deps: new Set(),
};

/**
 * Defines a record — a root dataset written only through mutations.
 *
 * Creates a dataset at `.records.${name}` with `writable: false` (so raw
 * `e3 set` / `Data.write` is rejected). With an initial value, deploy writes
 * it as the genesis commit (`$init`). Without one the record is **unassigned**
 * until its first state is committed from outside — a host's file intake, or
 * `e3 seed` — which is then its `$init`: the deploy writes no commit for it,
 * its dependents wait as they wait on an unset input — a run leaves them
 * waiting, and goes on without them — and a mutation on it is refused until
 * it holds a state. So a record whose first state is data that arrives after
 * the deploy never runs its dependents on an empty value first.
 *
 * @typeParam T - The East type of the record state
 * @param name - Record name (used as path segment in the tree)
 * @param type - East type of the record state
 * @param initialValue - The initial state, the genesis commit; omitted for a
 *   record whose first state is committed from outside
 * @returns A RecordDef, usable anywhere a dataset is plus as a mutation target
 *
 * @example
 * ```ts
 * import { DictType, StringType } from '@elaraai/east';
 *
 * const orders = record('orders', DictType(StringType, OrderType), new Map());
 * // Unassigned until its first state is committed: `e3 seed` from a beast2
 * // file, or a host's file intake
 * const customers = record('customers', DictType(StringType, CustomerType));
 * ```
 */
export function record<Name extends string, T extends EastType>(
  name: Name,
  type: T,
  initialValue?: ValueTypeOf<T>,
): RecordDef<T, [ variant<"field", "records">, variant<"field", Name> ]> {
  return {
    kind: 'dataset',
    recordKind: 'record',
    name,
    path: [variant('field', 'records'), variant('field', name)],
    type,
    ...(initialValue !== undefined && { default: initialValue }),
    writable: false,
    mutations: {},
    indexes: {},
    migrations: [],
    deps: new Set([...recordsTree.deps, recordsTree]),
  };
}
