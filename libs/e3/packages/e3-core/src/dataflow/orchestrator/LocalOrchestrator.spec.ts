/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local orchestrator owns the runs it starts: how a run ended is in its
 * state, and a caller that starts a run and never waits on it — a server's
 * route — leaves nothing to handle. It is each run's one writer of its state:
 * a write at a time, each the state as it stood when made; and a run another
 * process ended, or moved on, stops at its next write. The loop's contract
 * over every backend is `contract/dataflow.ts`.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, decodeBeast2For, encodeBeast2For, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { DataflowExecutionStateType, PackageObjectType } from '@elaraai/e3-types';
import { DataflowAbortedError, DataflowSupersededError } from '../../errors.js';
import { MockTaskRunner } from '../../execution/MockTaskRunner.js';
import { packageImport } from '../../package-files.js';
import { InMemoryStorage } from '../../storage/in-memory/InMemoryStorage.js';
import { workspaceCreate, workspaceDeploy, workspaceGetPackage } from '../../workspaces.js';
import { InMemoryStateStore } from '../state-store/InMemoryStateStore.js';
import type { StateWriteOutcome } from '../state-store/interfaces.js';
import type { DataflowExecutionState } from '../types.js';
import type { ExecutionHandle } from './interfaces.js';
import { LocalOrchestrator } from './LocalOrchestrator.js';

/**
 * Deploys a package to workspace `ws` of a fresh repository in memory.
 *
 * @returns The storage, and each task's hash by its name
 */
async function deploy(
  t: TestContext,
  name: string,
  pkg: Parameters<typeof e3.export>[0],
): Promise<{ storage: InMemoryStorage; tasks: ReadonlyMap<string, string> }> {
  const dir = mkdtempSync(join(tmpdir(), 'e3-orchestrator-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storage = new InMemoryStorage();
  await storage.repos.create('repo');
  const zip = join(dir, `${name}.zip`);
  await e3.export(pkg, zip);
  await packageImport(storage, 'repo', zip);
  await workspaceCreate(storage, 'repo', 'ws');
  await workspaceDeploy(storage, 'repo', 'ws', name, '1.0.0');
  const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read('repo', (await workspaceGetPackage(storage, 'repo', 'ws')).hash));
  return { storage, tasks: deployed.tasks };
}

/** The output hash a mock task reports for `name`. */
function outputOf(name: string): string {
  return createHash('sha256').update(name).digest('hex');
}

const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));

/** `first` over an input, and `second` over `first`. */
function chain(): Parameters<typeof e3.export>[0] {
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const first = e3.task('first', [a], add);
  return e3.package('chain', '1.0.0', a, first, e3.task('second', [first.output], add));
}

/** Waits for a run nobody waits on to let its locks go. */
async function released(storage: InMemoryStorage): Promise<boolean> {
  for (let i = 0; i < 500 && (await storage.locks.getState('repo', 'ws#dataflow')) !== null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return (await storage.locks.getState('repo', 'ws#dataflow')) === null;
}

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
    assert.ok(await released(storage), 'the run ended');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(unhandled, []);
    assert.equal((await storage.refs.dataflowRunGetLatest('repo', 'ws'))?.status.type, 'cancelled');
  });

  it('writes a run\'s state a write at a time, each carrying the state as it stood when the write was made', async (t) => {
    // 16 tasks over one input and 16 more over theirs, each a few milliseconds
    // apart: completions land while the loop launches.
    const seed = e3.input('seed', IntegerType, variant('value', 1n));
    const first = Array.from({ length: 16 }, (_, i) => e3.task(`p${String(i).padStart(2, '0')}`, [seed], add));
    const second = first.map((p, i) => e3.task(`q${String(i).padStart(2, '0')}`, [p.output], add));
    const { storage, tasks } = await deploy(t, 'fan', e3.package('fan', '1.0.0', seed, ...first, ...second));
    const runner = new MockTaskRunner();
    let i = 0;
    for (const [name, hash] of tasks) {
      const ms = 3 + ((i++ * 7) % 23);
      runner.setResult(hash, async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { state: 'success', cached: false, outputHash: outputOf(name) };
      });
    }

    /** A store slow to take a write, which counts how many it holds at once,
     *  and the writes whose state changed while it held them. */
    const encode = encodeBeast2For(DataflowExecutionStateType);
    class SlowStore extends InMemoryStateStore {
      writes = 0;
      held = 0;
      mostHeld = 0;
      changedWhileHeld = 0;
      override async update(state: DataflowExecutionState): Promise<StateWriteOutcome> {
        const made = encode(state);
        this.writes++;
        this.held++;
        this.mostHeld = Math.max(this.mostHeld, this.held);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          if (!Buffer.from(encode(state)).equals(Buffer.from(made))) this.changedWhileHeld++;
          return await super.update(state);
        } finally {
          this.held--;
        }
      }
    }
    const store = new SlowStore();
    const orchestrator = new LocalOrchestrator(store);
    const result = await orchestrator.wait(await orchestrator.start(storage, 'repo', 'ws', { runner, width: 8 }));

    assert.equal(result.success, true);
    assert.equal(result.executed, 32);
    assert.ok(store.writes > 32, `the run wrote its state as its tasks started and completed (${store.writes} writes)`);
    assert.equal(store.mostHeld, 1, 'no two of the run\'s writes reached the store at once');
    assert.equal(store.changedWhileHeld, 0, 'no write\'s state changed while the store held it');
  });

  it('stops a run another process cancelled at its next write: nothing more launched, no task failed, and its record ended cancelled', async (t) => {
    const { storage, tasks } = await deploy(t, 'chain', chain());
    const store = new InMemoryStateStore();
    const orchestrator = new LocalOrchestrator(store);
    const runner = new MockTaskRunner();
    let handle!: ExecutionHandle;
    // While `first` runs, another process cancels the run, writing it to the
    // store as a host's cancel in another process does.
    runner.setResult(tasks.get('first')!, async () => {
      assert.equal(await store.updateStatus('repo', 'ws', handle.id, 'cancelled', { error: 'cancelled elsewhere' }), 'applied');
      return { state: 'success', cached: false, outputHash: outputOf('first') };
    });
    handle = await orchestrator.start(storage, 'repo', 'ws', { runner });

    await assert.rejects(orchestrator.wait(handle), (err: unknown) => err instanceof DataflowAbortedError);
    assert.deepEqual(runner.getCalls().map((call) => call.taskHash), [tasks.get('first')], 'nothing more was launched');
    const stored = await store.read('repo', 'ws', handle.id);
    assert.equal(stored?.status, 'cancelled');
    assert.deepEqual(stored?.error, some('cancelled elsewhere'), 'the run keeps the state its cancel left');
    assert.equal(stored?.failed, 0n, 'no task failed for it');
    assert.equal((await storage.refs.dataflowRunGetLatest('repo', 'ws'))?.status.type, 'cancelled', 'its record ended as its state did');
    assert.ok(await released(storage), 'its locks are released');
  });

  it('stops a run another process moved on at its next write, writing and launching nothing more, and failing no task', async (t) => {
    const { storage, tasks } = await deploy(t, 'chain', chain());

    /** The store as shared with another process, which moves the run on once
     *  `first` runs: this process's writes after that are refused. */
    class MovedOnStore extends InMemoryStateStore {
      movedOn = false;
      refused = 0;
      override async update(state: DataflowExecutionState): Promise<StateWriteOutcome> {
        if (this.movedOn) {
          this.refused++;
          return 'refused';
        }
        return super.update(state);
      }
    }
    const store = new MovedOnStore();
    const orchestrator = new LocalOrchestrator(store);
    const runner = new MockTaskRunner();
    runner.setResult(tasks.get('first')!, () => {
      store.movedOn = true;
      return { state: 'success', cached: false, outputHash: outputOf('first') };
    });
    const handle = await orchestrator.start(storage, 'repo', 'ws', { runner });

    await assert.rejects(orchestrator.wait(handle), (err: unknown) => err instanceof DataflowSupersededError && err.runId === handle.id);
    assert.equal(store.refused, 1, 'the refused write was the run\'s last');
    assert.deepEqual(runner.getCalls().map((call) => call.taskHash), [tasks.get('first')], 'nothing more was launched');
    const stored = await store.read('repo', 'ws', handle.id);
    assert.equal(stored?.status, 'running', 'the run goes on where it was moved on');
    assert.equal(stored?.failed, 0n, 'no task failed for it');
    assert.equal((await storage.refs.dataflowRunGetLatest('repo', 'ws'))?.status.type, 'running', 'its record is the other process\'s to end');
    assert.ok(await released(storage), 'its locks are released');
  });
});
