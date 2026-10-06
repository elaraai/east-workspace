/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace copy's contract suite over e3-core's own backends: a local
 * repository, and the in-memory backend.
 */

import { describe } from 'node:test';
import { workspaceCopyTests } from './contract/index.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/LocalBackend.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('over a local repository', () => {
  workspaceCopyTests(async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    return { storage: new LocalStorage(), repo };
  });
});

describe('over the in-memory backend', () => {
  workspaceCopyTests(async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('created');
    return { storage, repo: 'created' };
  });
});
