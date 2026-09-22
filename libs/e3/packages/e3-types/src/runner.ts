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
 * Resolve a {@link RunnerType} value to the argv prefix of one of its
 * commands (the wire-value analogue of the SDK's `runnerToCommand`): `run`,
 * the default — `[<bin>, 'run', -p…]` — or `merge`, the blob merge every
 * stock runner ships — `[<bin>, 'merge', -p…]`, the fan-in of a partitioned
 * task's keyed partials (issue #770). Lives in e3-types so both e3-core
 * (local) and the cloud execution kernel import the one resolver.
 *
 * Variant tags use underscores (`east_node`) mapped to the binary name
 * (`east-node`) here. A `custom` runner's command is its `run`; it has no
 * merge command.
 *
 * @param r - the runner
 * @param command - the runner command, `run` by default
 * @returns the argv prefix
 * @throws {Error} When `merge` is asked of a custom runner.
 */
export function runnerToArgv(r: RunnerValue, command: 'run' | 'merge' = 'run'): string[] {
  switch (r.type) {
    case 'east_node': return ['east-node', command, ...flags(r.value.platforms)];
    case 'east_py':   return ['east-py',   command, ...flags(r.value.platforms)];
    case 'east_c':    return ['east-c',    command, ...flags(r.value.platforms)];
    case 'custom':
      if (command !== 'run') throw new Error(`a custom runner has no ${command} command`);
      return [...r.value.command];
  }
}

/**
 * Whether a runner opens a collection input staged as a segment manifest —
 * one file naming its segments as siblings — rather than needing them spliced
 * into one blob first.
 *
 * @remarks
 * A property of the runtime, decided here beside {@link runnerToArgv} and
 * never per task: either a runner's reader knows the layout or it does not,
 * and a task cannot change that. A runner that does gets its inputs staged by
 * linking the segment objects — O(segments) links and no bytes, whatever the
 * value weighs — and reads only the segments its body touches. A runner that
 * does not gets the value spliced into one file, which is what every runner
 * got before the layout.
 *
 * A `custom` runner is an arbitrary command: it reads what it is given, and
 * what it is given must be a blob.
 *
 * @param runner - the runner a task declares
 * @returns whether its inputs may be staged as manifests
 */
export function runnerOpensManifests(r: RunnerValue): boolean {
  return r.type === 'east_node';
}

/**
 * Insert the runner's `-v/--verbose` flag into a fully-built argv, for the
 * known runtimes only.
 *
 * All three known runners (`east-node`/`east-py`/`east-c`, `run` and `merge`)
 * accept `-v` among their options and print timing/perf detail to stderr; a
 * `custom` runner's argv is user-authored, so a flag is never spliced into
 * it. A known-runtime argv always starts `[<bin>, <command>, …]` (see
 * {@link runnerToArgv} and the SDK's `runnerToCommand`), so `-v` goes at
 * index 2 — ahead of the `-p`/`-i`/`-o` flags and the trailing IR path.
 *
 * This is a pure **runtime** toggle: it is applied to the *evaluated* argv
 * immediately before spawn and never touches the task's `commandIr`, the
 * {@link RunnerType}, or any hash — so it cannot affect caching.
 *
 * @param runner - the runner the argv was built for (gates the injection)
 * @param args - the fully-built argv (runner prefix + `-i`/`-o`/`<ir>` suffix)
 * @param verbose - when true, request the runner's verbose output
 * @returns the argv, with `-v` inserted for known runtimes when verbose
 */
export function withRunnerVerbose(runner: RunnerValue, args: string[], verbose?: boolean): string[] {
  if (!verbose || runner.type === 'custom' || args.length < 2) return args;
  return [...args.slice(0, 2), '-v', ...args.slice(2)];
}

/**
 * Insert the runner's `--exit-with-parent` flag into a fully-built argv, for
 * the known runtimes only — the stdin lifeline (issue #770).
 *
 * A stock runner given the flag and a stdin pipe its parent never writes to
 * exits as soon as the pipe reaches end of file: when the parent dies. A
 * `custom` runner's argv is user-authored, so the flag is never spliced into
 * it, and it keeps an ignored stdin. Like {@link withRunnerVerbose} the flag
 * goes at index 2, after `[<bin>, <command>]`, and is a pure runtime toggle
 * applied just before spawn — never part of the task's `commandIr` or any
 * hash.
 *
 * @param runner - the runner the argv was built for (gates the injection)
 * @param args - the fully-built argv
 * @returns the argv, with `--exit-with-parent` inserted for known runtimes
 */
export function withRunnerLifeline(runner: RunnerValue, args: string[]): string[] {
  if (runner.type === 'custom' || args.length < 2) return args;
  return [...args.slice(0, 2), '--exit-with-parent', ...args.slice(2)];
}
