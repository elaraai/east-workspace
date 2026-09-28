/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The execution state store's contract suite over e3-core's two stores: in
 * memory, and a local repository's file per workspace.
 */

import { describe } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionStateStoreTests } from '../../contract/index.js';
import { FileStateStore } from './FileStateStore.js';
import { InMemoryStateStore } from './InMemoryStateStore.js';

describe('in memory', () => {
  executionStateStoreTests(async () => ({ store: new InMemoryStateStore(), repo: 'repo' }));
});

describe('in a local repository\'s workspace files', () => {
  executionStateStoreTests(async (t) => {
    const repo = mkdtempSync(join(tmpdir(), 'e3-state-store-'));
    t.after(() => rmSync(repo, { recursive: true, force: true }));
    return { store: new FileStateStore(join(repo, 'workspaces')), repo };
  });
});
