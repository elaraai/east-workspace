/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What the contract suites share beside a backend's setup: a directory of a
 * test's own, the store a case's runs keep their state in, the wait for a
 * deploy to announce itself, and an input's path.
 */

import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { variant } from '@elaraai/east';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import { deployAnnounced } from '../deploy-lock.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { BackendContext } from './setup.js';

/**
 * A directory for a test's own files, removed when the test ends.
 *
 * @param t - The test
 * @returns The directory's path
 */
export function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * The store a case's runs keep their state in: the one the backend's setup
 * gives, or one in memory.
 *
 * @param context - The backend under test
 * @returns The store
 */
export function stateStoreOf(context: BackendContext): ExecutionStateStore {
  return context.stateStore ?? new InMemoryStateStore();
}

/**
 * Waits until a deploy that waits for its workspace has announced itself.
 *
 * @remarks
 * It asserts on no clock: the fault it looks for is a deploy whose own wait
 * ends before it has announced itself, which it fails on.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - The workspace the deploy waits for
 * @param deploying - The deploy's wait for its workspace
 * @returns Whether the deploy's wait is over, as it stands when asked
 */
export async function untilAnnounced(storage: StorageBackend, repo: string, ws: string, deploying: Promise<unknown>): Promise<() => boolean> {
  let settled = false;
  void deploying.then(() => { settled = true; }, () => { settled = true; });
  while (!(await deployAnnounced(storage, repo, ws))) {
    assert.equal(settled, false, 'the deploy announces itself while it waits');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return () => settled;
}

/**
 * The tree path of an input.
 *
 * @param name - The input's name
 * @returns Its path, under `inputs`
 */
export const inputPath = (name: string) => [variant('field', 'inputs'), variant('field', name)];
