/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local orchestrator owns the runs it starts: how a run ended is in its
 * state, and a caller that starts a run and never waits on it — a server's
 * route — leaves nothing to handle. The loop's contract over every backend is
 * `contract/dataflow.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, decodeBeast2For, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { PackageObjectType } from '@elaraai/e3-types';
import { MockTaskRunner } from '../../execution/MockTaskRunner.js';
import { packageImport } from '../../packages.js';
import { InMemoryStorage } from '../../storage/in-memory/InMemoryStorage.js';
import { workspaceCreate, workspaceDeploy, workspaceGetPackage } from '../../workspaces.js';
import { InMemoryStateStore } from '../state-store/InMemoryStateStore.js';
import type { ExecutionHandle } from './interfaces.js';
import { LocalOrchestrator } from './LocalOrchestrator.js';

describe('LocalOrchestrator', () => {
  it('handles the end of a run nobody waits on: a run that ends in an error leaves no rejection unhandled', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-orchestrator-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const storage = new InMemoryStorage();
    await storage.repos.create('repo');
    const sales = e3.input('sales', IntegerType, variant('value', 1n));
    const doubled = e3.task('doubled', [sales], East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
    const zip = join(dir, 'flow.zip');
    await e3.export(e3.package('flow', '1.0.0', sales, doubled), zip);
    await packageImport(storage, 'repo', zip);
    await workspaceCreate(storage, 'repo', 'ws');
    await workspaceDeploy(storage, 'repo', 'ws', 'flow', '1.0.0');
    const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read('repo', (await workspaceGetPackage(storage, 'repo', 'ws')).hash));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    t.after(() => {
      process.off('unhandledRejection', onUnhandled);
    });

    // A run cancelled while its task runs ends by rejecting: a run whose end
    // an error decides.
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    const runner = new MockTaskRunner();
    let handle!: ExecutionHandle;
    runner.setResult(deployed.tasks.get('doubled')!, async () => {
      await orchestrator.cancel(handle);
      return { state: 'error', cached: false, error: 'cancelled: e3 stopped the runner because the run was aborted', cancelled: true };
    });
    handle = await orchestrator.start(storage, 'repo', 'ws', { runner });

    // Nobody waits on the run. It has ended once it has let its locks go.
    for (let i = 0; i < 500 && (await storage.locks.getState('repo', 'ws#dataflow')) !== null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(await storage.locks.getState('repo', 'ws#dataflow'), null, 'the run ended');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(unhandled, []);
    assert.equal((await storage.refs.dataflowRunGetLatest('repo', 'ws'))?.status.type, 'cancelled');
  });
});
