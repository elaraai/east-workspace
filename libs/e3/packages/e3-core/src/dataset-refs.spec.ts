/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for dataset-refs helpers that back the reactive dataflow engine's
 * per-dataset ref model:
 *
 * - keypath <-> refPath conversion, including backtick-quoted identifiers
 *   (dataset names that aren't bare identifiers are a real-life case that
 *   reaches every ref read/write) and the malformed-input error branches
 * - refs -> tree (`computeRootHash`, used by workspace export) and
 *   tree -> refs (`writeRefsFromTree`, used when materialising a deployed
 *   package's tree) round-trip, across all three ref states
 *   (unassigned / null / value)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { variant, StringType, encodeBeast2For, SortedMap } from '@elaraai/east';
import type { Structure, DatasetRef } from '@elaraai/e3-types';
import {
  keypathToRefPath,
  refPathToKeypath,
  computeRootHash,
  writeRefsFromTree,
} from './dataset-refs.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('keypathToRefPath', () => {
  it('converts dotted keypaths to slash paths', () => {
    assert.equal(keypathToRefPath('.inputs.sales'), 'inputs/sales');
    assert.equal(keypathToRefPath('.tasks.train.output'), 'tasks/train/output');
  });

  it('handles backtick-quoted identifiers (names with dots/spaces)', () => {
    assert.equal(keypathToRefPath('.inputs.`sales 2026`'), 'inputs/sales 2026');
    assert.equal(keypathToRefPath('.`weird.name`.value'), 'weird.name/value');
  });

  it('rejects keypaths without a leading dot', () => {
    assert.throws(() => keypathToRefPath('inputs/sales'), /leading '\.'/);
  });

  it('rejects unclosed backticks', () => {
    assert.throws(() => keypathToRefPath('.inputs.`oops'), /Unclosed backtick/);
  });
});

describe('refPathToKeypath', () => {
  it('round-trips with keypathToRefPath', () => {
    for (const keypath of ['.inputs.sales', '.tasks.train.output', '.inputs.`sales 2026`']) {
      assert.equal(refPathToKeypath(keypathToRefPath(keypath)), keypath);
    }
  });

  it('quotes non-identifier segments', () => {
    assert.equal(refPathToKeypath('inputs/sales 2026'), '.inputs.`sales 2026`');
  });
});

describe('refs <-> tree conversion', () => {
  let repoPath: string;
  let storage: StorageBackend;

  // Structure: { inputs: { a: value, b: value }, outputs: { c: value } }
  const valueStructure = (): Structure =>
    variant('value', { type: { type: 'String', value: null } as never, writable: true });
  const structure: Structure = variant('struct', new SortedMap([
    ['inputs', variant('struct', new SortedMap([
      ['a', valueStructure()],
      ['b', valueStructure()],
    ]))],
    ['outputs', variant('struct', new SortedMap([
      ['c', valueStructure()],
    ]))],
  ]));

  before(() => {
    repoPath = createTestRepo();
    storage = new LocalStorage(dirname(repoPath));
  });

  after(() => {
    removeTestRepo(repoPath);
  });

  it('computeRootHash builds a tree from refs and writeRefsFromTree restores them', async () => {
    const ws = 'refs-ws';
    const valueHash = await storage.objects.write(repoPath, encodeBeast2For(StringType)('hello'));

    // Seed refs covering all three states: value / null / unassigned
    await storage.datasets.write(repoPath, ws, 'inputs/a',
      variant('value', { hash: valueHash, versions: new Map() }) as DatasetRef);
    await storage.datasets.write(repoPath, ws, 'inputs/b',
      variant('null', { versions: new Map() }) as DatasetRef);
    await storage.datasets.write(repoPath, ws, 'outputs/c',
      variant('unassigned', null) as DatasetRef);

    // refs -> tree (workspace export path)
    const rootHash = await computeRootHash(storage, repoPath, ws, structure);
    assert.equal(rootHash.length, 64);

    // tree -> refs into a fresh workspace (deploy/import path)
    const ws2 = 'refs-ws-2';
    await writeRefsFromTree(storage, repoPath, ws2, structure, rootHash);

    const a = await storage.datasets.read(repoPath, ws2, 'inputs/a');
    assert.equal(a?.type, 'value');
    assert.equal((a as { value: { hash: string } }).value.hash, valueHash);

    const b = await storage.datasets.read(repoPath, ws2, 'inputs/b');
    assert.equal(b?.type, 'null');

    const c = await storage.datasets.read(repoPath, ws2, 'outputs/c');
    assert.equal(c?.type, 'unassigned');

    // And the round-trip is stable: same refs -> same root hash
    const rootHash2 = await computeRootHash(storage, repoPath, ws2, structure);
    assert.equal(rootHash2, rootHash);
  });

  it('computeRootHash treats missing ref files as unassigned', async () => {
    const ws = 'refs-sparse-ws';
    // Only one of three refs exists
    const valueHash = await storage.objects.write(repoPath, encodeBeast2For(StringType)('only-a'));
    await storage.datasets.write(repoPath, ws, 'inputs/a',
      variant('value', { hash: valueHash, versions: new Map() }) as DatasetRef);

    const rootHash = await computeRootHash(storage, repoPath, ws, structure);

    const ws2 = 'refs-sparse-ws-2';
    await writeRefsFromTree(storage, repoPath, ws2, structure, rootHash);
    const b = await storage.datasets.read(repoPath, ws2, 'inputs/b');
    assert.equal(b?.type, 'unassigned');
  });
});
