/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArrayType, IntegerType, encodeCollectionManifest } from '@elaraai/east';
import { LocalStorage, datasetWrite, openDatasetObject, repoInit } from '@elaraai/e3-core';
import { callClosure, closureHashes, recordClosure } from './closure.js';

const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });

it('includes every descendant of a nested collection manifest and records large closures', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'e3-closure-')); homes.push(repo);
  assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const leaf = await datasetWrite(storage, repo, [1n, 2n], ArrayType(IntegerType));
  const opened = await openDatasetObject(storage, repo, leaf); assert(opened.manifest);
  const root = await storage.objects.write(repo, encodeCollectionManifest({ ...opened.manifest, level: 1n,
    entries: [{ hash: leaf, count: 2n, bytes: BigInt((await storage.objects.stat(repo, leaf)).size), fence: new Uint8Array() }] }));
  const parts = new Set<string>();
  const hashes = await callClosure(storage, repo, [{ dataset: root }], undefined, parts);
  assert.deepEqual(hashes, [...new Set([root, leaf, opened.manifest.header, ...opened.manifest.entries.map((entry) => entry.hash)])].sort());
  assert.deepEqual([...parts], opened.manifest.entries.map((entry) => entry.hash));
  const large = Array.from({ length: 513 }, (_, n) => n.toString(16).padStart(64, '0'));
  const closure = await recordClosure(storage, repo, large); assert('object' in closure);
  assert.deepEqual(await closureHashes(closure, (hash) => storage.objects.read(repo, hash)), [closure.object, ...large]);
});
