/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_RUNNER, runnerToCommand, type Runner } from './runner.js';

describe('runnerToCommand', () => {
  it('default is east-node + east-node-std (cheap to resolve in any e3 project)', () => {
    assert.deepEqual(
      runnerToCommand(DEFAULT_RUNNER),
      ['east-node', 'run', '-p', '@elaraai/east-node-std'],
    );
  });

  it('east-py with multiple stock platforms', () => {
    const r: Runner = {
      runtime: 'east-py',
      platforms: ['east-py-std', 'east-py-io', 'east-py-datascience'],
    };
    assert.deepEqual(
      runnerToCommand(r),
      ['east-py', 'run', '-p', 'east-py-std', '-p', 'east-py-io', '-p', 'east-py-datascience'],
    );
  });

  it('east-node uses the @elaraai/* scoped platform names verbatim', () => {
    const r: Runner = {
      runtime: 'east-node',
      platforms: ['@elaraai/east-node-std', '@elaraai/east-node-io'],
    };
    assert.deepEqual(
      runnerToCommand(r),
      ['east-node', 'run', '-p', '@elaraai/east-node-std', '-p', '@elaraai/east-node-io'],
    );
  });

  it('east-c with the std platform', () => {
    const r: Runner = { runtime: 'east-c', platforms: ['east-c-std'] };
    assert.deepEqual(runnerToCommand(r), ['east-c', 'run', '-p', 'east-c-std']);
  });

  it('mixes stock literals with explicit { custom: ... } user-defined platforms', () => {
    const r: Runner = {
      runtime: 'east-py',
      platforms: ['east-py-std', { custom: 'my-org-platform' }],
    };
    assert.deepEqual(
      runnerToCommand(r),
      ['east-py', 'run', '-p', 'east-py-std', '-p', 'my-org-platform'],
    );
  });

  it('omits -p flags entirely when platforms is omitted', () => {
    const r: Runner = { runtime: 'east-c' };
    assert.deepEqual(runnerToCommand(r), ['east-c', 'run']);
  });

  it('omits -p flags when platforms is an empty array', () => {
    const r: Runner = { runtime: 'east-py', platforms: [] };
    assert.deepEqual(runnerToCommand(r), ['east-py', 'run']);
  });

  it('custom runtime returns the command argv verbatim', () => {
    const r: Runner = {
      runtime: 'custom',
      command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'],
    };
    assert.deepEqual(
      runnerToCommand(r),
      ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'],
    );
  });

  it('returns a fresh array on each call (defensive copy on custom command)', () => {
    const cmd = ['julia', 'run.jl'] as [string, ...string[]];
    const r: Runner = { runtime: 'custom', command: cmd };
    const out = runnerToCommand(r);
    out.push('--mutated');
    assert.deepEqual(cmd, ['julia', 'run.jl'], 'caller-supplied command must not be mutated');
  });
});
