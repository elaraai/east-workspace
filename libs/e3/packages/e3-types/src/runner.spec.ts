/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Gating contract for {@link withRunnerLifeline}.
 *
 * `--exit-with-parent` is a pure runtime toggle: it is spliced into an
 * already-built argv just before spawn. These tests pin the two things that
 * make it safe — it reaches the known runtimes at the right argv position, and
 * it never touches a `custom` runner's user-authored command.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { variant } from '@elaraai/east';
import { withRunnerLifeline, type RunnerValue } from './runner.js';

const KNOWN: Array<[string, RunnerValue, string]> = [
  ['east_node', variant('east_node', { platforms: ['@elaraai/east-node-std'] }), 'east-node'],
  ['east_py', variant('east_py', { platforms: ['east-py-std'] }), 'east-py'],
  ['east_c', variant('east_c', { platforms: ['east-c-std'] }), 'east-c'],
];

describe('withRunnerLifeline', () => {
  for (const [tag, runner, bin] of KNOWN) {
    it(`inserts --exit-with-parent after the subcommand for ${tag}`, () => {
      const args = [bin, 'exec', 'unit.beast2', '-v'];
      assert.deepStrictEqual(withRunnerLifeline(runner, args), [bin, 'exec', '--exit-with-parent', 'unit.beast2', '-v']);
    });
  }

  it('never splices the flag into a custom runner, which keeps an ignored stdin', () => {
    const runner: RunnerValue = variant('custom', { command: ['uv', 'run', 'east-py', 'run'] });
    const args = ['uv', 'run', 'east-py', 'run', '-i', 'in.beast2', '-o', 'out.beast2', 'program.beast2'];
    assert.deepStrictEqual(withRunnerLifeline(runner, args), args);
  });

  it('is a no-op on a degenerate argv and does not mutate its input', () => {
    const runner = variant('east_c', { platforms: [] });
    assert.deepStrictEqual(withRunnerLifeline(runner, ['east-c']), ['east-c']);
    const args = ['east-c', 'exec', 'unit.beast2'];
    const before = [...args];
    withRunnerLifeline(runner, args);
    assert.deepStrictEqual(args, before);
  });
});
