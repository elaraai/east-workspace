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

import { variant, type UnitDecode } from '@elaraai/east';
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

/** Stock platforms shipped for the `@elaraai/east-c-cli` runner. `east-c-std`
 *  is in the binary; `east-c-datascience` — east-py-datascience's families on
 *  the C runtime (OR-Tools, XGBoost, the neural networks on libtorch) — is the
 *  package `@elaraai/east-c-datascience`, installed beside the runner, which
 *  the binary opens when a program names it (the `east-c-datascience` Docker
 *  tier carries both). */
export type EastCPlatform =
  | 'east-c-std'
  | 'east-c-datascience';

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
 * How a stock runner reads a program's inputs — the choice every runner's
 * `run --decode` takes, and the `decode` of each run unit e3 stages for it.
 *
 * - `'lazy'` (the default): each collection input opens over its file, and a
 *   segment decodes when the program first reaches it, so a keyed read or a
 *   filtered pass costs the segments it touches, however large the input. An
 *   operation the pager cannot serve decodes the input whole, once, when it
 *   first needs it.
 * - `'whole'`: every input decodes before the program runs — for a program
 *   whose reads land at random across more segments than the pager keeps,
 *   which decodes each again. A runner's `-v`, in the task's log, says when
 *   an input's reads did.
 */
export type InputDecode = 'lazy' | 'whole';

/**
 * Runner selection for {@link task}.
 *
 * A stock runtime's `decode` says how it reads the program's inputs
 * ({@link InputDecode}, lazily by default); `custom` commands read them as
 * they choose.
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
 * // east-c, every input decoded before the program runs
 * { runtime: 'east-c', platforms: ['east-c-std'], decode: 'whole' }
 *
 * // Anything else: Julia, uv wrap, container exec, …
 * { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] }
 * ```
 */
export type Runner =
  | { runtime: 'east-py';   platforms?: Platform<EastPyPlatform>[];   decode?: InputDecode }
  | { runtime: 'east-node'; platforms?: Platform<EastNodePlatform>[]; decode?: InputDecode }
  | { runtime: 'east-c';    platforms?: Platform<EastCPlatform>[];    decode?: InputDecode }
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
  // The SDK makes `platforms` and `decode` optional and allows `{ custom: name }`
  // entries; the wire type requires a plain string array and a decode — fill
  // both here.
  if (r.runtime === 'custom') {
    return variant('custom', { command: [...r.command] });
  }
  const platforms = (r.platforms ?? []).map((p) => (typeof p === 'string' ? p : p.custom));
  const decode: UnitDecode = r.decode === 'whole' ? variant('whole', null) : variant('lazy', null);
  switch (r.runtime) {
    case 'east-node': return variant('east_node', { platforms, decode });
    case 'east-py':   return variant('east_py',   { platforms, decode });
    case 'east-c':    return variant('east_c',    { platforms, decode });
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
  ['east-py-datascience', 'east-c-datascience'],
];

/**
 * The platform functions a stock package implements of its family's
 * contract, where that is not all of it: `east-c-datascience` carries
 * east-py-datascience's OR-Tools, XGBoost and neural-network families
 * (`google_or_*`, `xgboost_*`, `nn_*` — the compliance suites it replays)
 * and none of the others. A package not listed implements its whole family.
 * {@link runnerProvides} consults it when given the function's name, so a
 * task on an east-c runner importing a function that calls, say, a LightGBM
 * platform function is refused at export, not at run time.
 */
export const STOCK_PLATFORM_SUBSETS: Readonly<Record<string, RegExp>> = {
  'east-c-datascience': /^(google_or|xgboost|nn)_/,
};

/**
 * Whether a stock package implements a platform function of its family's
 * contract: every one, unless {@link STOCK_PLATFORM_SUBSETS} lists the package.
 *
 * @param pkg - A stock platform package
 * @param name - A platform function of its family
 * @returns Whether the package implements it
 */
export function stockImplements(pkg: string, name: string): boolean {
  const subset = STOCK_PLATFORM_SUBSETS[pkg];
  return subset === undefined || subset.test(name);
}

/**
 * Lists the stock platform packages each runtime's published images carry
 * (`east-py-datascience` and `east-c-datascience` on their own tiers).
 * Rack routing uses these names to refuse project-specific platform packages.
 */
export const STOCK_PLATFORMS_BY_RUNNER = {
  east_node: ['@elaraai/east-node-std', '@elaraai/east-node-io'],
  east_py: ['east-py-std', 'east-py-io', 'east-py-datascience'],
  east_c: ['east-c-std', 'east-c-datascience'],
} as const;

/**
 * Whether a runner's platform packages include `provider`, or a stock
 * package of `provider`'s family — one implementing `name`, when the platform
 * function's name is given ({@link STOCK_PLATFORM_SUBSETS}). A `custom`
 * runner is an arbitrary command that cannot be inspected and is trusted.
 *
 * @param runner - The consuming task's runner
 * @param provider - The package an imported function's manifest names as
 *   implementing a platform dependency
 * @param name - The platform function, when known; without it any member of
 *   the family counts, whatever part of the contract it implements
 * @returns Whether the runner provides it
 */
export function runnerProvides(runner: Runner, provider: string, name?: string): boolean {
  if (runner.runtime === 'custom') return true;
  const names = (runner.platforms ?? []).map((p) => (typeof p === 'string' ? p : p.custom));
  if (names.includes(provider)) return true;
  const family = STOCK_PLATFORM_FAMILIES.find((f) => f.includes(provider));
  if (family === undefined) return false;
  return names.some((n) => family.includes(n) && (name === undefined || stockImplements(n, name)));
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
