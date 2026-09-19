/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The stream and merge commands (issue #770) — the builders of every argv a
 * stream execution spawns (an authored `streamTask`'s) and of the merge
 * command a partitioned task's keyed fan-in runs per key range, both built
 * at export time and carried in the package like any other command IR.
 */

import { ArrayType, East, EastIR, IntegerType, StringType } from '@elaraai/east';
import { runnerToArgv, type RunnerValue } from './runner.js';

/**
 * How a stream execution's emit sink treats equal keys: `none` — a duplicate
 * is an error; `function` — the merge IR (wire input 1) folds adjacent equal
 * Dict keys, passed to the runner as `--merge`; `union` — adjacent equal Set
 * elements collapse to the first, `--union`.
 */
export type StreamMergeMode = 'none' | 'function' | 'union';

/**
 * The shape of a stream command.
 *
 * @remarks
 * The wire inputs a stream execution stages are laid out `[body IR, merge IR
 * (function mode only), ...-i inputs]`; `stream` names whether the first of
 * the `-i` inputs is the one the runner opens lazily.
 */
export interface StreamCommandSpec {
  /** The output collection kind the emit sink writes. */
  emit: 'array' | 'set' | 'dict';
  /** How equal keys fold — see {@link StreamMergeMode}. */
  merge: StreamMergeMode;
  /** The `-i` input the runner feeds lazily: none, or the first. */
  stream: 'none' | 'first';
}

/**
 * Builds the command IR of a stream execution: `(input_paths, output_path)
 * -> argv`.
 *
 * The argv is `[...runner, '--emit', <emit>, '--merge' <merge IR path> |
 * '--union', '--stream' '0' when the first -i input streams, '-i' <path> for
 * each -i input, '-o', <output>, <body IR path>]` — the body IR is wire
 * input 0, the merge IR wire input 1 in function mode, and the `-i` inputs
 * follow. Built with `East.function` exactly as a task command is.
 *
 * @param runner - the stock runner the execution spawns
 * @param spec - the emit kind, the merge mode and the streamed input
 * @returns the command IR
 *
 * @example
 * ```ts
 * import { variant } from '@elaraai/east';
 *
 * const command = streamCommandIr(variant('east_c', { platforms: [] }), { emit: 'dict', merge: 'function', stream: 'first' });
 * command.compile([])(['body.beast2', 'merge.beast2', 'a.beast2'], 'out.beast2');
 * // ['east-c', 'run', '--emit', 'dict', '--merge', 'merge.beast2', '--stream', '0',
 * //  '-i', 'a.beast2', '-o', 'out.beast2', 'body.beast2']
 * ```
 */
export function streamCommandIr(runner: RunnerValue, spec: StreamCommandSpec): EastIR<[string[], string], string[]> {
  // The command's build-time shape: the flags every execution carries, the
  // wire inputs passed as `--merge` (the merge IR, in function mode), the
  // stream flags, and the wire index of the first -i input.
  const prefix = [
    ...runnerToArgv(runner),
    '--emit', spec.emit,
    ...(spec.merge === 'union' ? ['--union'] : []),
  ];
  const mergeInputs = spec.merge === 'function' ? [1n] : [];
  const streamFlags = spec.stream === 'first' ? ['--stream', '0'] : [];
  const firstInput = BigInt(1 + mergeInputs.length);
  const command = East.function(
    [ArrayType(StringType), StringType],
    ArrayType(StringType),
    ($, input_paths, output_path) => {
      const argv = $.let(prefix, ArrayType(StringType));
      const merges = $.const(mergeInputs, ArrayType(IntegerType));
      $.for(merges, ($, input) => {
        $(argv.pushLast('--merge'));
        $(argv.pushLast(input_paths.get(input)));
      });
      const streams = $.const(streamFlags, ArrayType(StringType));
      $.for(streams, ($, flag) => {
        $(argv.pushLast(flag));
      });
      const i = $.let(firstInput);
      $.while(East.less(i, input_paths.size()), $ => {
        $(argv.pushLast('-i'));
        $(argv.pushLast(input_paths.get(i)));
        $.assign(i, i.add(1n));
      });
      $(argv.pushLast('-o'));
      $(argv.pushLast(output_path));
      $(argv.pushLast(input_paths.get(0n)));
      $.return(argv);
    },
  );
  return command.toIR();
}

/**
 * Builds the command IR of a merge execution — the runner's `merge` command
 * over sorted partials of one Set or Dict type, within a key range:
 * `(input_paths, output_path) -> argv`.
 *
 * The argv is `[...runner merge, '--merge' <merge IR path> | '--union',
 * '--range' <range path>, '-i' <path> for each partial, '-o', <output>]`. In
 * `function` mode wire input 0 is the merge IR `(K, V, V) -> V`, wire input
 * 1 the key range and the partials follow; in `union` mode wire input 0 is
 * the key range and every other wire input is a partial. The key range is a
 * blob of `Struct{from: Option<K>, to: Option<K>}` over the output's key
 * type: only the keys in `[from, to)` merge, each partial sought to the
 * segment owning `from`, and an absent bound is open — a component that
 * merges whole takes the open range. Equal keys across partials fold in
 * input order, and the output is byte-identical to what the runner's emit
 * sink writes for the same entries emitted ascending. A partitioned task's
 * SDK writes this IR into its metadata at export, and the orchestrator runs
 * it as an ordinary execution per key range of a group of partials.
 *
 * @param runner - the stock runner whose `merge` command runs
 * @param mode - `function` (a Dict output, folded with the merge IR) or
 *   `union` (a Set output, the first of equal elements standing)
 * @returns the command IR
 * @throws {Error} When the runner is `custom` — it has no merge command.
 *
 * @example
 * ```ts
 * import { variant } from '@elaraai/east';
 *
 * const command = mergeCommandIr(variant('east_c', { platforms: [] }), 'function');
 * command.compile([])(['merge.beast2', 'range.beast2', 'p0.beast2', 'p1.beast2'], 'out.beast2');
 * // ['east-c', 'merge', '--merge', 'merge.beast2', '--range', 'range.beast2',
 * //  '-i', 'p0.beast2', '-i', 'p1.beast2', '-o', 'out.beast2']
 * ```
 */
export function mergeCommandIr(runner: RunnerValue, mode: 'function' | 'union'): EastIR<[string[], string], string[]> {
  const prefix = [
    ...runnerToArgv(runner, 'merge'),
    ...(mode === 'union' ? ['--union'] : []),
  ];
  const mergeInputs = mode === 'function' ? [0n] : [];
  const rangeInput = BigInt(mergeInputs.length);
  const firstInput = rangeInput + 1n;
  const command = East.function(
    [ArrayType(StringType), StringType],
    ArrayType(StringType),
    ($, input_paths, output_path) => {
      const argv = $.let(prefix, ArrayType(StringType));
      const merges = $.const(mergeInputs, ArrayType(IntegerType));
      $.for(merges, ($, input) => {
        $(argv.pushLast('--merge'));
        $(argv.pushLast(input_paths.get(input)));
      });
      $(argv.pushLast('--range'));
      $(argv.pushLast(input_paths.get(rangeInput)));
      const i = $.let(firstInput);
      $.while(East.less(i, input_paths.size()), $ => {
        $(argv.pushLast('-i'));
        $(argv.pushLast(input_paths.get(i)));
        $.assign(i, i.add(1n));
      });
      $(argv.pushLast('-o'));
      $(argv.pushLast(output_path));
      $.return(argv);
    },
  );
  return command.toIR();
}
