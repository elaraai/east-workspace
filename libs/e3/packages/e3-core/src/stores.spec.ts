/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The stores' contract suites over e3-core's own backends: a local repository
 * and the in-memory backend, and the repository lifecycle over a directory of
 * local repositories and over the in-memory backend. The log store's suite
 * runs over a store that holds appends until they are flushed too, as a store
 * that gathers appends into fewer writes does: it reads only what it flushed.
 */

import { describe } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  datasetRefStoreTests, lockServiceTests, logStoreTests, objectStoreTests, refStoreTests, repoStoreTests,
  type BackendSetup, type RepositoriesSetup,
} from './contract/index.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/LocalBackend.js';
import { executionPath } from './storage/local/localHelpers.js';
import { HeldLogStore, createTempDir, createTestRepo, removeTempDir, removeTestRepo, withLogStore } from './test-helpers.js';

const BACKENDS: [string, BackendSetup][] = [
  ['over a local repository', async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    return {
      storage: new LocalStorage(),
      repo,
      damage: {
        execution: (taskHash, inputsHash, executionId) => {
          const dir = executionPath(repo, taskHash, inputsHash, executionId);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'status.beast2'), 'not a record');
          return Promise.resolve();
        },
      },
    };
  }],
  ['over the in-memory backend', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('created');
    return {
      storage,
      repo: 'created',
      damage: {
        execution: (taskHash, inputsHash, executionId) => {
          storage.refs.damageExecution('created', taskHash, inputsHash, executionId);
          return Promise.resolve();
        },
      },
    };
  }],
];

const REPOSITORIES: [string, RepositoriesSetup][] = [
  ['over a directory of local repositories', async (t) => {
    const reposDir = createTempDir();
    t.after(() => removeTempDir(reposDir));
    return { storage: new LocalStorage(reposDir), repoOf: (name) => join(reposDir, name) };
  }],
  ['over the in-memory backend', async () => ({ storage: new InMemoryStorage(), repoOf: (name) => name })],
];

for (const [name, setup] of BACKENDS) {
  describe(name, () => {
    objectStoreTests(setup);
    refStoreTests(setup);
    datasetRefStoreTests(setup);
    lockServiceTests(setup);
    logStoreTests(setup);
  });
}

describe('over a log store that holds appends until they are flushed', () => {
  logStoreTests(async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('created');
    return { storage: withLogStore(storage, new HeldLogStore(storage.logs)), repo: 'created' };
  });
});

for (const [name, setup] of REPOSITORIES) {
  describe(name, () => {
    repoStoreTests(setup);
  });
}
