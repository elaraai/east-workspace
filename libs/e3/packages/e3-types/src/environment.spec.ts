/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Encode/decode contract for {@link EnvironmentSpecType}.
 *
 * BEAST2 encodes a variant's tag as the index of its case in the
 * alphabetically-sorted case list, so the case order is load-bearing: a repo
 * persists specs by that order, and a later code edit that inserts a case
 * before an existing one silently re-tags every later case and mis-decodes
 * already-stored specs. The frozen-order test pins the order so that mistake
 * is a red test; the round-trip tests pin the new cases.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { encodeBeast2For, decodeBeast2For, variant, some, none } from '@elaraai/east';
import {
  EnvironmentSpecType,
  environmentSpecObjectHashes,
  type EnvironmentSpec,
} from './environment.js';

const encodeCurrent = encodeBeast2For(EnvironmentSpecType);
const decodeCurrent = decodeBeast2For(EnvironmentSpecType);

const H = (c: string): string => c.repeat(64); // stand-in 64-hex object hash

describe('EnvironmentSpecType frozen case order', () => {
  it('is exactly [image, node, python, tools, workspace_node]', () => {
    // BEAST2 tags are indices into this sorted list. A new case must be
    // added so the order only grows at the end (or readers must migrate to
    // name-based decoding first) — inserting before an existing case
    // re-tags every later one and mis-decodes stored specs. This assertion
    // turns that mistake into a red test.
    assert.deepStrictEqual(
      Object.keys((EnvironmentSpecType as unknown as { cases: Record<string, unknown> }).cases),
      ['image', 'node', 'python', 'tools', 'workspace_node'],
    );
  });
});

describe('EnvironmentSpecType round-trips every case', () => {
  const specs: EnvironmentSpec[] = [
    variant('python', { pyproject: H('a'), lock: H('b'), sdists: [{ filename: 'pricing-1.0.0.tar.gz', hash: H('c') }] }),
    variant('node', { packageJson: H('d'), lock: H('e'), tarballs: [H('f')] }),
    variant('image', { digest: `repo@sha256:${H('0')}` }),
    variant('tools', { files: [{ path: 'bin/my-runner', hash: H('1') }] }),
    variant('workspace_node', {
      packageJson: H('2'), lock: H('3'), config: none, subject: 'packages/pricing',
      members: [{ path: 'packages/pricing', name: '@acme/pricing', tarball: H('4') }],
    }),
  ];

  it('encodes and decodes back to the same value', () => {
    for (const spec of specs) {
      assert.deepStrictEqual(decodeCurrent(encodeCurrent(spec)), spec);
    }
  });

  it('round-trips a workspace_node spec carrying a pnpm config blob and multiple members', () => {
    const withConfig: EnvironmentSpec = variant('workspace_node', {
      packageJson: H('2'), lock: H('3'), config: some(H('5')), subject: 'packages/pricing',
      members: [
        { path: 'packages/common', name: '@acme/common', tarball: H('6') },
        { path: 'packages/pricing', name: '@acme/pricing', tarball: H('7') },
      ],
    });
    assert.deepStrictEqual(decodeCurrent(encodeCurrent(withConfig)), withConfig);
  });
});

describe('environmentSpecObjectHashes', () => {
  it('lists python blobs', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('python', {
        pyproject: 'p', lock: 'l',
        sdists: [{ filename: 'a-1.0.tar.gz', hash: 's1' }, { filename: 'b-1.0.tar.gz', hash: 's2' }],
      })),
      ['p', 'l', 's1', 's2'],
    );
  });

  it('lists node blobs', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('node', { packageJson: 'p', lock: 'l', tarballs: ['t'] })),
      ['p', 'l', 't'],
    );
  });

  it('lists nothing for image', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('image', { digest: `repo@sha256:${H('0')}` })),
      [],
    );
  });

  it('lists every tools file hash', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('tools', {
        files: [{ path: 'bin/a', hash: 'h1' }, { path: 'bin/b', hash: 'h2' }],
      })),
      ['h1', 'h2'],
    );
  });

  it('lists workspace_node blobs including the config when present', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('workspace_node', {
        packageJson: 'p', lock: 'l', config: some('cfg'), subject: 'packages/x',
        members: [{ path: 'packages/x', name: '@acme/x', tarball: 't1' }, { path: 'packages/y', name: '@acme/y', tarball: 't2' }],
      })),
      ['p', 'l', 'cfg', 't1', 't2'],
    );
  });

  it('omits the config hash for an npm workspace_node (none)', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('workspace_node', {
        packageJson: 'p', lock: 'l', config: none, subject: 'packages/x',
        members: [{ path: 'packages/x', name: '@acme/x', tarball: 't1' }],
      })),
      ['p', 'l', 't1'],
    );
  });
});
