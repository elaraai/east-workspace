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
 * Wire representation of a runner — shared by tasks and functions
 * (symmetric: both carry `runner: RunnerType`).
 *
 * The known-runtime tags name a runtime binary; `platforms` are passed as
 * `-p` flags. `custom` carries a raw argv prefix: for functions it is the
 * executed command (the standard `-i/-o/<ir>` suffix is appended, so the
 * command must speak the runner CLI convention); for tasks it is routing
 * metadata only — a task's `commandIr` remains authoritative for execution.
 * Package authors can already execute arbitrary commands via custom tasks,
 * so `custom` grants no capability that tasks don't have.
 */
export const RunnerType = VariantType({
  east_node: StructType({ platforms: ArrayType(StringType) }),
  east_py:   StructType({ platforms: ArrayType(StringType) }),
  east_c:    StructType({ platforms: ArrayType(StringType) }),
  custom:    StructType({ command: ArrayType(StringType) }),
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
    case 'custom':    return [...r.value.command];
  }
}
