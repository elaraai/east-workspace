/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typed runner selection for {@link task}.
 *
 * Replaces the previous `runner: string[]` (raw argv) with a discriminated
 * union pairing each runtime with the platform names it accepts. The literal
 * platform sets are closed — a typo or a cross-runtime platform name is a
 * compile error. User-defined platforms go through `{ custom: 'name' }` so
 * the typed path stays typo-safe; the `custom` runtime branch is the full
 * escape hatch (any argv).
 *
 * Tasks and functions both store the runner as a wire variant (`RunnerType`
 * in e3-types) via {@link runnerToVariant}, and e3 builds the runner's argv
 * when it runs one. A stock runtime runs a unit through its `exec` command; a
 * `custom` one is run with `run`'s arguments (see {@link FunctionRunner}).
 */

import { variant } from '@elaraai/east';
import type { RunnerValue } from '@elaraai/e3-types';

/** Stock platforms shipped by `@elaraai/east-py-cli` runner. */
export type EastPyPlatform =
  | 'east-py-std'
  | 'east-py-io'
  | 'east-py-datascience';

/** Stock platforms shipped by `@elaraai/east-node-cli` runner. */
export type EastNodePlatform =
  | '@elaraai/east-node-std'
  | '@elaraai/east-node-io';

/** Stock platforms shipped by `@elaraai/east-c-cli` runner. */
export type EastCPlatform =
  | 'east-c-std';

/**
 * A platform argument: a stock literal, or an explicit user-defined name.
 *
 * The explicit `{ custom: '...' }` form is the only way to pass a non-stock
 * name. Bare strings are rejected so a typo of a stock name (e.g.
 * `'east-py-stdd'`) is a compile error instead of silently accepted.
 */
export type Platform<Known extends string> = Known | { custom: string };

/** Non-empty tuple — at least one element required at the type level. */
type NonEmpty<T> = [T, ...T[]];

/**
 * Runner selection for {@link task}.
 *
 * @example
 * ```ts
 * // east-c with the standard platform
 * { runtime: 'east-c', platforms: ['east-c-std'] }
 *
 * // east-node with two stock platforms
 * { runtime: 'east-node', platforms: ['@elaraai/east-node-std', '@elaraai/east-node-io'] }
 *
 * // east-py + a user-defined platform name
 * { runtime: 'east-py', platforms: ['east-py-std', { custom: 'my-org-platform' }] }
 *
 * // Anything else: Julia, uv wrap, container exec, …
 * { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] }
 * ```
 */
export type Runner =
  | { runtime: 'east-py';   platforms?: Platform<EastPyPlatform>[] }
  | { runtime: 'east-node'; platforms?: Platform<EastNodePlatform>[] }
  | { runtime: 'east-c';    platforms?: Platform<EastCPlatform>[] }
  | { runtime: 'custom';    command: NonEmpty<string> };

/**
 * Functions accept the same runners as tasks (symmetric model). `custom`
 * commands must speak the runner CLI convention (`<command…> -i <arg>…
 * -o <out> <ir>`), since e3 appends that suffix when it runs a function or a
 * task on one. Kept as an alias for source compatibility.
 */
export type FunctionRunner = Runner;

/**
 * Convert a {@link Runner} to its wire-format {@link RunnerValue} variant
 * (used by `e3.function` / `e3.export`).
 *
 * @param r - The runner
 * @returns Its wire variant
 */
export function runnerToVariant(r: Runner): RunnerValue {
  // The SDK makes `platforms` optional and allows `{ custom: name }` entries;
  // the wire type requires a plain string array — collapse both here.
  if (r.runtime === 'custom') {
    return variant('custom', { command: [...r.command] });
  }
  const platforms = (r.platforms ?? []).map((p) => (typeof p === 'string' ? p : p.custom));
  switch (r.runtime) {
    case 'east-node': return variant('east_node', { platforms });
    case 'east-py':   return variant('east_py',   { platforms });
    case 'east-c':    return variant('east_c',    { platforms });
  }
}

/**
 * The stock platform packages that implement ONE platform contract per
 * runtime. An imported function (#628) whose platform dependency is
 * provided by `east-py-std` runs unchanged on an east-node runner listing
 * `@elaraai/east-node-std`: the compliance suites pin that each family
 * implements the same functions on every runtime. A custom package name
 * must match exactly.
 */
export const STOCK_PLATFORM_FAMILIES: ReadonlyArray<ReadonlyArray<string>> = [
  ['east-py-std', '@elaraai/east-node-std', 'east-c-std'],
  ['east-py-io', '@elaraai/east-node-io'],
  ['east-py-datascience'],
];

/**
 * Whether a runner's platform packages include `provider`, or a stock
 * package of `provider`'s family. A `custom` runner is an arbitrary command
 * that cannot be inspected and is trusted.
 *
 * @param runner - The consuming task's runner
 * @param provider - The package an imported function's manifest names as
 *   implementing a platform dependency
 * @returns Whether the runner provides it
 */
export function runnerProvides(runner: Runner, provider: string): boolean {
  if (runner.runtime === 'custom') return true;
  const names = (runner.platforms ?? []).map((p) => (typeof p === 'string' ? p : p.custom));
  if (names.includes(provider)) return true;
  const family = STOCK_PLATFORM_FAMILIES.find((f) => f.includes(provider));
  return family !== undefined && names.some((n) => family.includes(n));
}

/**
 * Default runner when `e3.task(..., { runner })` is omitted.
 *
 * east-node is the safer baseline: every e3 project already needs Node to
 * compile and deploy, so the runner resolves with no extra toolchain. east-py
 * needs a Python install + uv + east-py wheels on top, which is fine when a
 * task actually uses python platforms but heavy as a default.
 */
export const DEFAULT_RUNNER: Runner = {
  runtime: 'east-node',
  platforms: ['@elaraai/east-node-std'],
};
