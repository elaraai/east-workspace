/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The stream and merge command builders (issue #770): the argv a stream
 * execution spawns for each merge mode and streamed-input choice, and the
 * argv a merge execution spawns over sorted partials within a key range.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import { mergeCommandIr, streamCommandIr, type StreamCommandSpec } from './stream.js';
import type { RunnerValue } from './runner.js';

const EAST_C: RunnerValue = variant('east_c', { platforms: ['east-c-std'] });

/** The argv a stream command evaluates to for the staged `inputs`. */
function argvOf(runner: RunnerValue, spec: StreamCommandSpec, inputs: string[]): string[] {
  return streamCommandIr(runner, spec).compile([])(inputs, 'out.beast2');
}

/** The argv a merge command evaluates to for the staged `inputs`. */
function mergeArgvOf(runner: RunnerValue, mode: 'function' | 'union', inputs: string[]): string[] {
  return mergeCommandIr(runner, mode).compile([])(inputs, 'out.beast2');
}

describe('streamCommandIr', () => {
  it('builds a folding dict argv: the merge IR as --merge, the first input streamed', () => {
    assert.deepEqual(
      argvOf(EAST_C, { emit: 'dict', merge: 'function', stream: 'first' }, ['body.beast2', 'merge.beast2', 'rows.beast2', 'other.beast2']),
      ['east-c', 'run', '-p', 'east-c-std', '--emit', 'dict', '--merge', 'merge.beast2', '--stream', '0',
        '-i', 'rows.beast2', '-i', 'other.beast2', '-o', 'out.beast2', 'body.beast2'],
    );
  });

  it('builds a union set argv streaming the first input', () => {
    assert.deepEqual(
      argvOf(EAST_C, { emit: 'set', merge: 'union', stream: 'first' }, ['body.beast2', 'stream.beast2', 'other.beast2']),
      ['east-c', 'run', '-p', 'east-c-std', '--emit', 'set', '--union', '--stream', '0',
        '-i', 'stream.beast2', '-i', 'other.beast2', '-o', 'out.beast2', 'body.beast2'],
    );
  });

  it('builds a producer argv with no merge flag and no streamed input', () => {
    assert.deepEqual(
      argvOf(EAST_C, { emit: 'array', merge: 'none', stream: 'none' }, ['body.beast2', 'config.beast2']),
      ['east-c', 'run', '-p', 'east-c-std', '--emit', 'array', '-i', 'config.beast2', '-o', 'out.beast2', 'body.beast2'],
    );
  });

  it('starts from the runner argv of every stock runtime', () => {
    const node: RunnerValue = variant('east_node', { platforms: ['@elaraai/east-node-std'] });
    const argv = argvOf(node, { emit: 'set', merge: 'none', stream: 'first' }, ['body.beast2', 'rows.beast2']);
    assert.deepEqual(argv.slice(0, 6), ['east-node', 'run', '-p', '@elaraai/east-node-std', '--emit', 'set']);
  });
});

describe('mergeCommandIr', () => {
  it('builds a dict merge argv: the merge IR as --merge, the key range as --range, every other input a partial', () => {
    assert.deepEqual(
      mergeArgvOf(EAST_C, 'function', ['merge.beast2', 'range.beast2', 'p0.beast2', 'p1.beast2', 'p2.beast2']),
      ['east-c', 'merge', '-p', 'east-c-std', '--merge', 'merge.beast2', '--range', 'range.beast2',
        '-i', 'p0.beast2', '-i', 'p1.beast2', '-i', 'p2.beast2', '-o', 'out.beast2'],
    );
  });

  it('builds a set union argv: the key range first, every other input a partial', () => {
    assert.deepEqual(
      mergeArgvOf(EAST_C, 'union', ['range.beast2', 'p0.beast2', 'p1.beast2']),
      ['east-c', 'merge', '-p', 'east-c-std', '--union', '--range', 'range.beast2', '-i', 'p0.beast2', '-i', 'p1.beast2', '-o', 'out.beast2'],
    );
  });

  it('runs the merge command of every stock runtime', () => {
    const py: RunnerValue = variant('east_py', { platforms: ['east-py-std'] });
    assert.deepEqual(mergeArgvOf(py, 'union', ['range.beast2', 'p0.beast2']).slice(0, 4), ['east-py', 'merge', '-p', 'east-py-std']);
    const node: RunnerValue = variant('east_node', { platforms: [] });
    assert.deepEqual(mergeArgvOf(node, 'function', ['merge.beast2', 'range.beast2', 'p0.beast2']).slice(0, 2), ['east-node', 'merge']);
  });

  it('refuses a custom runner, which has no merge command', () => {
    const custom: RunnerValue = variant('custom', { command: ['uv', 'run', 'east-py', 'run'] });
    assert.throws(() => mergeCommandIr(custom, 'union'), { message: 'a custom runner has no merge command' });
  });
});
