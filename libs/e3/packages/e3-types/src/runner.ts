/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runner wire types for e3 functions.
 *
 * `RunnerType` is the wire image of the SDK's `Runner` union (minus its
 * `custom` raw-argv runtime — see the security note below). It pins the
 * executable to a known runtime for every tag, so a function call can never
 * name its own executable; only platform flags vary.
 *
 * A `platforms` entry is just a `-p <name>` flag on the wire; the SDK's
 * `Platform<Known> | { custom }` distinction is authoring sugar that
 * collapses to a string.
 */

import { VariantType, StructType, ArrayType, StringType, ValueTypeOf } from '@elaraai/east';

/**
 * Wire representation of a function's runner.
 *
 * Each tag names a known runtime binary; `platforms` are passed as `-p`
 * flags. There is deliberately no raw-argv case: a resolved-argv field would
 * let any caller choose the executable and every flag — arbitrary command
 * execution by construction.
 */
export const RunnerType = VariantType({
  east_node: StructType({ platforms: ArrayType(StringType) }),
  east_py:   StructType({ platforms: ArrayType(StringType) }),
  east_c:    StructType({ platforms: ArrayType(StringType) }),
});
export type RunnerType = typeof RunnerType;

export type RunnerValue = ValueTypeOf<typeof RunnerType>;

function flags(platforms: string[]): string[] {
  return platforms.flatMap((p) => ['-p', p]);
}

/**
 * Resolve a {@link RunnerType} value to the argv prefix (the wire-value
 * analogue of the SDK's `runnerToCommand`). Lives in e3-types so both
 * e3-core (local) and the cloud execution kernel import the one resolver.
 *
 * Variant tags use underscores (`east_node`) mapped to the binary name
 * (`east-node`) here.
 */
export function runnerToArgv(r: RunnerValue): string[] {
  switch (r.type) {
    case 'east_node': return ['east-node', 'run', ...flags(r.value.platforms)];
    case 'east_py':   return ['east-py',   'run', ...flags(r.value.platforms)];
    case 'east_c':    return ['east-c',    'run', ...flags(r.value.platforms)];
  }
}
