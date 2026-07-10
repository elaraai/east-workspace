/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Gating contract for {@link withRunnerVerbose}.
 *
 * `-v` is a pure runtime toggle: it is spliced into an already-built argv just
 * before spawn. These tests pin the two things that make it safe — it reaches
 * the known runtimes (which all accept `-v`) at the right argv position, and it
 * never touches a `custom` runner's user-authored command. Because it only
 * rewrites the argv (never the runner variant or any hash), it is
 * cache-irrelevant by construction.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { variant } from '@elaraai/east';
import { runnerToArgv, withRunnerVerbose, type RunnerValue } from './runner.js';

/** A realistic fully-built argv: runner prefix + the `-i`/`-o`/`<ir>` suffix. */
function fullArgv(runner: RunnerValue): string[] {
  return [...runnerToArgv(runner), '-i', 'in.beast2', '-o', 'out.beast2', 'body.beast2'];
}

const KNOWN: Array<[string, RunnerValue, string]> = [
  ['east_node', variant('east_node', { platforms: ['@elaraai/east-node-std'] }), 'east-node'],
  ['east_py', variant('east_py', { platforms: ['east-py-std'] }), 'east-py'],
  ['east_c', variant('east_c', { platforms: ['east-c-std'] }), 'east-c'],
];

describe('withRunnerVerbose', () => {
  for (const [tag, runner, bin] of KNOWN) {
    it(`inserts -v after the 'run' subcommand for ${tag}`, () => {
      const args = fullArgv(runner);
      const out = withRunnerVerbose(runner, args, true);
      // `[<bin>, 'run', '-v', …rest]` — position 2, ahead of -p/-i/-o and the IR.
      assert.deepStrictEqual(out.slice(0, 3), [bin, 'run', '-v']);
      // Exactly one -v, and the rest of the argv is preserved in order.
      assert.strictEqual(out.filter((a) => a === '-v').length, 1);
      assert.deepStrictEqual(out.slice(3), args.slice(2));
      // The IR path is still last.
      assert.strictEqual(out[out.length - 1], 'body.beast2');
    });

    it(`leaves the argv untouched when verbose is off for ${tag}`, () => {
      const args = fullArgv(runner);
      assert.deepStrictEqual(withRunnerVerbose(runner, args, false), args);
      assert.deepStrictEqual(withRunnerVerbose(runner, args, undefined), args);
    });
  }

  it('never splices -v into a custom runner (user-authored argv)', () => {
    const runner: RunnerValue = variant('custom', { command: ['uv', 'run', 'east-py', 'run'] });
    const args = fullArgv(runner);
    // Even with verbose requested, a custom command is passed through verbatim —
    // we cannot know it understands `-v`.
    assert.deepStrictEqual(withRunnerVerbose(runner, args, true), args);
    assert.ok(!withRunnerVerbose(runner, args, true).includes('-v'));
  });

  it('does not mutate the input argv (returns a new array)', () => {
    const runner = variant('east_node', { platforms: ['@elaraai/east-node-std'] });
    const args = fullArgv(runner);
    const before = [...args];
    withRunnerVerbose(runner, args, true);
    assert.deepStrictEqual(args, before, 'input array must be unchanged');
  });

  it('is a no-op on a degenerate (too-short) argv rather than throwing', () => {
    const runner = variant('east_node', { platforms: [] });
    assert.deepStrictEqual(withRunnerVerbose(runner, ['east-node'], true), ['east-node']);
    assert.deepStrictEqual(withRunnerVerbose(runner, [], true), []);
  });
});
