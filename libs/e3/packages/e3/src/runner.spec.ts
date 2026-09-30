/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { variant } from '@elaraai/east';
import { DEFAULT_RUNNER, runnerToVariant, type Runner } from './runner.js';

const LAZY = variant('lazy', null);

describe('runnerToVariant', () => {
  it('default is east-node + east-node-std (cheap to resolve in any e3 project)', () => {
    assert.deepEqual(runnerToVariant(DEFAULT_RUNNER), variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: LAZY }));
  });

  it('east-py with multiple stock platforms', () => {
    const r: Runner = {
      runtime: 'east-py',
      platforms: ['east-py-std', 'east-py-io', 'east-py-datascience'],
    };
    assert.deepEqual(runnerToVariant(r), variant('east_py', { platforms: ['east-py-std', 'east-py-io', 'east-py-datascience'], decode: LAZY }));
  });

  it('east-c with the std platform', () => {
    const r: Runner = { runtime: 'east-c', platforms: ['east-c-std'] };
    assert.deepEqual(runnerToVariant(r), variant('east_c', { platforms: ['east-c-std'], decode: LAZY }));
  });

  it('collapses explicit { custom: ... } user-defined platforms to their names', () => {
    const r: Runner = {
      runtime: 'east-py',
      platforms: ['east-py-std', { custom: 'my-org-platform' }],
    };
    assert.deepEqual(runnerToVariant(r), variant('east_py', { platforms: ['east-py-std', 'my-org-platform'], decode: LAZY }));
  });

  it('lists no platforms when platforms is omitted', () => {
    assert.deepEqual(runnerToVariant({ runtime: 'east-c' }), variant('east_c', { platforms: [], decode: LAZY }));
  });

  it('reads inputs lazily unless the runner says whole, on every stock runtime', () => {
    for (const [runtime, tag] of [['east-node', 'east_node'], ['east-py', 'east_py'], ['east-c', 'east_c']] as const) {
      assert.deepEqual(runnerToVariant({ runtime, decode: 'lazy' }), variant(tag, { platforms: [], decode: LAZY }), runtime);
      assert.deepEqual(runnerToVariant({ runtime, decode: 'whole' }), variant(tag, { platforms: [], decode: variant('whole', null) }), runtime);
    }
  });

  it('custom runtime carries the command verbatim, in a copy', () => {
    const cmd = ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] as [string, ...string[]];
    const wire = runnerToVariant({ runtime: 'custom', command: cmd });
    assert.deepEqual(wire, variant('custom', { command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] }));
    (wire.value as { command: string[] }).command.push('--mutated');
    assert.deepEqual(cmd, ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'], 'caller-supplied command must not be mutated');
  });
});
