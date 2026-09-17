/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The stream-task command — the one builder of every argv a stream execution
 * spawns: an authored `streamTask`'s, and the merge units e3-core synthesizes
 * for a partitioned task's keyed fan-in (issue #770).
 */

import { ArrayType, East, EastIR, IntegerType, SourceMap, StringType, isVariant } from '@elaraai/east';
import type { FunctionIR } from '@elaraai/east';
import { runnerToArgv, type RunnerValue } from './runner.js';

/**
 * How a stream execution's emit sink treats equal keys: `none` — a duplicate
 * is an error; `function` — the merge IR (wire input 1) folds equal Dict
 * keys, passed to the runner as `--merge`; `union` — equal Set elements
 * collapse to the first, `--union`.
 */
export type StreamMergeMode = 'none' | 'function' | 'union';

/**
 * The shape of a stream command.
 *
 * @remarks
 * The wire inputs a stream execution stages are laid out `[body IR, merge IR
 * (function mode only), ...-i inputs]`; `stream` names which of the `-i`
 * inputs the runner opens lazily.
 */
export interface StreamCommandSpec {
  /** The output collection kind the emit sink writes. */
  emit: 'array' | 'set' | 'dict';
  /** How equal keys fold — see {@link StreamMergeMode}. */
  merge: StreamMergeMode;
  /** The `-i` inputs the runner feeds lazily: none, the first, or every one. */
  stream: 'none' | 'first' | 'all';
}

/**
 * Builds the command IR of a stream execution: `(input_paths, output_path)
 * -> argv`.
 *
 * The argv is `[...runner, '--emit', <emit>, '--merge' <merge IR path> |
 * '--union', '--stream' <i> for each streamed -i input, '-i' <path> for each
 * -i input, '-o', <output>, <body IR path>]` — the body IR is wire input 0,
 * the merge IR wire input 1 in function mode, and the `-i` inputs follow.
 * Built with `East.function` exactly as a task command is, then passed through
 * {@link stripIrLocations}, so the IR — and the task hash that carries it —
 * does not depend on where it was built.
 *
 * @param runner - the stock runner the execution spawns
 * @param spec - the emit kind, the merge mode and the streamed inputs
 * @returns the command IR, with no locations
 *
 * @example
 * ```ts
 * import { variant } from '@elaraai/east';
 *
 * const command = streamCommandIr(variant('east_c', { platforms: [] }), { emit: 'dict', merge: 'function', stream: 'all' });
 * command.compile([])(['body.beast2', 'merge.beast2', 'a.beast2'], 'out.beast2');
 * // ['east-c', 'run', '--emit', 'dict', '--merge', 'merge.beast2', '--stream', '0',
 * //  '-i', 'a.beast2', '-o', 'out.beast2', 'body.beast2']
 * ```
 */
export function streamCommandIr(runner: RunnerValue, spec: StreamCommandSpec): EastIR<[string[], string], string[]> {
  // The command's build-time shape: the flags every execution carries, the
  // wire inputs passed as `--merge` (the merge IR, in function mode), the wire
  // index of the first -i input, and how many leading -i inputs stream —
  // every one of them in `all` mode.
  const prefix = [
    ...runnerToArgv(runner),
    '--emit', spec.emit,
    ...(spec.merge === 'union' ? ['--union'] : []),
  ];
  const mergeInputs = spec.merge === 'function' ? [1n] : [];
  const firstInput = BigInt(1 + mergeInputs.length);
  const streamLeading = spec.stream === 'none' ? 0n : 1n;
  const streamEvery = spec.stream === 'all';
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
      const streamed = $.let(streamLeading);
      const everyInput = $.const(streamEvery);
      $.if(everyInput, $ => {
        $.assign(streamed, input_paths.size().subtract(firstInput));
      });
      const s = $.let(0n);
      $.while(East.less(s, streamed), $ => {
        $(argv.pushLast('--stream'));
        $(argv.pushLast(East.print(s)));
        $.assign(s, s.add(1n));
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
  return stripIrLocations(command.toIR()) as EastIR<[string[], string], string[]>;
}

/**
 * Returns a copy of an IR bundle with every `loc_id` — each node's, each
 * variable's and each label's — set to `0n` and an empty source map, as
 * east-c's IR normalizer zeroes them.
 *
 * A built IR records where its builder ran: the loc_ids index a source map of
 * file positions, so the same program built from two call sites encodes — and
 * hashes — differently. Every IR e3-core synthesizes goes through this, so its
 * objects hash identically on every build. The input bundle is not modified.
 *
 * @param bundle - the IR bundle to strip
 * @returns a new bundle: the same IR with no locations
 *
 * @example
 * ```ts
 * const stripped = stripIrLocations(East.function([IntegerType], IntegerType, ($, x) => x.add(1n)).toIR());
 * encodeEastIR(stripped); // the same bytes wherever the function was built
 * ```
 */
export function stripIrLocations(bundle: EastIR<any, any>): EastIR<any, any> {
  // A copy of an IR value with its loc_ids zeroed. A node (a variant) shares
  // its types (`type`, `type_parameters`) and a `Value` node's literal rather
  // than walking them; an entry (`{ name, value }`, `{ key, value }`,
  // `{ predicate, body }`, `{ case, variable, body }`) or a label
  // (`{ name, loc_id }`) is copied field by field; names, flags and sizes
  // pass through.
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== 'object') return value;
    if (isVariant(value)) {
      const node = value as { type: string; value: Record<string, unknown> };
      const payload: Record<string, unknown> = {};
      for (const [field, child] of Object.entries(node.value)) {
        const shared = field === 'type' || field === 'type_parameters' || (node.type === 'Value' && field === 'value');
        payload[field] = field === 'loc_id' ? 0n : shared ? child : strip(child);
      }
      // The spread keeps the variant brand.
      return { ...node, value: payload };
    }
    const entry: Record<string, unknown> = {};
    for (const [field, child] of Object.entries(value)) {
      entry[field] = field === 'loc_id' ? 0n : strip(child);
    }
    return entry;
  };
  const stripped = new EastIR<any, any>(strip(bundle.ir) as FunctionIR);
  stripped.source_map = new SourceMap();
  return stripped;
}
