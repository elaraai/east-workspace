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
 * The runner is consumed at task-definition time inside `e3.task` and
 * resolved into the existing argv-emitting `commandIr` constant — the wire
 * format (`TaskObjectType`) is unchanged.
 *
 * `e3.function` instead stores the runner as a wire variant (`RunnerType`
 * in e3-types) via {@link runnerToVariant}, which excludes the `custom`
 * runtime (see {@link FunctionRunner}).
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
 * A {@link Runner} restricted to the known runtimes — the only runners an
 * `e3.function` may use. The `custom` (raw-argv) runtime is task-only: a
 * function's runner is stored on the wire and resolvable at call time, so
 * allowing raw argv would be arbitrary command execution by construction.
 */
export type FunctionRunner = Exclude<Runner, { runtime: 'custom' }>;

/**
 * Convert a {@link Runner} to its wire-format {@link RunnerValue} variant
 * (used by `e3.function` / `e3.export`). Rejects the `custom` runtime —
 * prefer typing call sites as {@link FunctionRunner} so the rejection is a
 * compile error; this throw is the runtime backstop.
 */
export function runnerToVariant(r: Runner): RunnerValue {
  if (r.runtime === 'custom') {
    throw new Error(
      "e3.function does not support the 'custom' runner — functions run only on a known runtime (east-node, east-py, east-c)",
    );
  }
  // The SDK makes `platforms` optional and allows `{ custom: name }` entries;
  // the wire type requires a plain string array — collapse both here, exactly
  // like runnerToCommand.
  const platforms = (r.platforms ?? []).map((p) => (typeof p === 'string' ? p : p.custom));
  switch (r.runtime) {
    case 'east-node': return variant('east_node', { platforms });
    case 'east-py':   return variant('east_py',   { platforms });
    case 'east-c':    return variant('east_c',    { platforms });
  }
}

/**
 * Resolves a {@link Runner} to the argv prefix. The `-i` / `-o` / IR path
 * suffix is appended by {@link task}'s East command IR at evaluation time;
 * this function only produces what goes ahead of those.
 */
export function runnerToCommand(r: Runner): string[] {
  if (r.runtime === 'custom') return [...r.command];
  const platforms = r.platforms ?? [];
  const flags: string[] = [];
  for (const p of platforms) {
    flags.push('-p', typeof p === 'string' ? p : p.custom);
  }
  return [r.runtime, 'run', ...flags];
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
