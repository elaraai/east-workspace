/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Encode/decode contract for {@link EnvironmentSpecType}: every case round
 * trips through {@link decodeEnvironmentSpec}, which reads a spec at this
 * release's type alone.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { StringType, VariantType, encodeBeast2For, variant, some, none } from '@elaraai/east';
import {
  EnvironmentSpecType,
  ImageEnvironmentType,
  NodeEnvironmentType,
  PythonEnvironmentType,
  ToolsEnvironmentType,
  WorkspaceNodeEnvironmentType,
  decodeEnvironmentSpec,
  environmentSpecObjectHashes,
  type EnvironmentSpec,
} from './environment.js';

const encodeCurrent = encodeBeast2For(EnvironmentSpecType);
const decodeCurrent = (bytes: Uint8Array): EnvironmentSpec => decodeEnvironmentSpec(bytes, H('9'));

const H = (c: string): string => c.repeat(64); // stand-in 64-hex object hash

describe('decodeEnvironmentSpec', () => {
  it('refuses a spec an earlier release exported, which decodes at this type, naming the re-export; a later release\'s, naming the upgrade; and what is no spec', () => {
    // The type before its `workspace_python` case: its values decode at today's, and are refused by their type
    const Earlier = VariantType({
      python: PythonEnvironmentType, node: NodeEnvironmentType, image: ImageEnvironmentType, tools: ToolsEnvironmentType,
      workspace_node: WorkspaceNodeEnvironmentType,
    });
    const tools = variant('tools', { files: [{ path: 'bin/my-runner', hash: H('1') }] });
    assert.throws(() => decodeEnvironmentSpec(encodeBeast2For(Earlier)(tools), H('a')),
      { message: `the environment ${H('a')} was exported by an older e3 SDK — re-export its package with the current one` });
    // A later release's, with a case this one does not know: re-exporting with this one cannot help
    const Later = VariantType({ ...EnvironmentSpecType.cases, conda: StringType });
    assert.throws(() => decodeEnvironmentSpec(encodeBeast2For(Later)(tools), H('a')),
      { message: `the environment ${H('a')} was exported by a newer e3 SDK than this one, as its conda says — upgrade e3 to the release that exported its package` });
    for (const bytes of [encodeBeast2For(StringType)('not a spec'), new TextEncoder().encode('not beast2')]) {
      assert.throws(() => decodeEnvironmentSpec(bytes, H('a')), { message: `the object ${H('a')} is not an environment's spec` });
    }
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
    variant('workspace_python', {
      pyproject: H('5'), lock: H('6'), subjects: ['features'],
      sdists: [{ filename: 'features-0.1.0.tar.gz', hash: H('7') }], requires: ['elaraai-east-py', 'elaraai-east-py-std'],
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

  it('lists a workspace_python\'s root manifest, lock and every sdist', () => {
    assert.deepStrictEqual(
      environmentSpecObjectHashes(variant('workspace_python', {
        pyproject: 'p', lock: 'l', subjects: ['features', 'trainer'],
        sdists: [{ filename: 'features-0.1.0.tar.gz', hash: 's1' }, { filename: 'trainer-0.1.0.tar.gz', hash: 's2' }], requires: [],
      })),
      ['p', 'l', 's1', 's2'],
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
