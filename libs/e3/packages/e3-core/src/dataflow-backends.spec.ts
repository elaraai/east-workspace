/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow loop's contract suite over e3-core's own backends: a local
 * repository, and the in-memory backend.
 */

import { describe } from 'node:test';
import { dataflowTests } from './contract/index.js';
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

describe('over the in-memory backend', () => {
  dataflowTests(async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('created');
    return { storage, repo: 'created' };
  });
});
