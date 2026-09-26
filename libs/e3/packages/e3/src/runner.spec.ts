/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { variant } from '@elaraai/east';
import { DEFAULT_RUNNER, runnerToVariant, type Runner } from './runner.js';

describe('runnerToVariant', () => {
  it('default is east-node + east-node-std (cheap to resolve in any e3 project)', () => {
    assert.deepEqual(runnerToVariant(DEFAULT_RUNNER), variant('east_node', { platforms: ['@elaraai/east-node-std'] }));
  });

  it('east-py with multiple stock platforms', () => {
    const r: Runner = {
      runtime: 'east-py',
      platforms: ['east-py-std', 'east-py-io', 'east-py-datascience'],
    };
    assert.deepEqual(runnerToVariant(r), variant('east_py', { platforms: ['east-py-std', 'east-py-io', 'east-py-datascience'] }));
  });

  it('east-c with the std platform', () => {
    const r: Runner = { runtime: 'east-c', platforms: ['east-c-std'] };
    assert.deepEqual(runnerToVariant(r), variant('east_c', { platforms: ['east-c-std'] }));
  });

  it('collapses explicit { custom: ... } user-defined platforms to their names', () => {
    const r: Runner = {
      runtime: 'east-py',
      platforms: ['east-py-std', { custom: 'my-org-platform' }],
    };
    assert.deepEqual(runnerToVariant(r), variant('east_py', { platforms: ['east-py-std', 'my-org-platform'] }));
  });

  it('lists no platforms when platforms is omitted', () => {
    assert.deepEqual(runnerToVariant({ runtime: 'east-c' }), variant('east_c', { platforms: [] }));
  });

  it('custom runtime carries the command verbatim, in a copy', () => {
    const cmd = ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] as [string, ...string[]];
    const wire = runnerToVariant({ runtime: 'custom', command: cmd });
    assert.deepEqual(wire, variant('custom', { command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] }));
    (wire.value as { command: string[] }).command.push('--mutated');
    assert.deepEqual(cmd, ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'], 'caller-supplied command must not be mutated');
  });
});
