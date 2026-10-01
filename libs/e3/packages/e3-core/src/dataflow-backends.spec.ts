/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow loop's contract suite over e3-core's own backends: a local
 * repository, with its runs' state in memory and in its workspace files as the
 * local server keeps it, and the in-memory backend.
 */

import { describe } from 'node:test';
import { join } from 'node:path';
import { dataflowTests } from './contract/index.js';
import { FileStateStore } from './dataflow/state-store/FileStateStore.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/LocalBackend.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('over a local repository', () => {
  dataflowTests(async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    return { storage: new LocalStorage(), repo };
  });
});

describe('over a local repository, its runs\' state in its workspace files', () => {
  dataflowTests(async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    return { storage: new LocalStorage(), repo, stateStore: new FileStateStore(join(repo, 'workspaces')) };
  });
});

describe('over the in-memory backend', () => {
  dataflowTests(async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('created');
    return { storage, repo: 'created' };
  });
});
