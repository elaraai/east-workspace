/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The ref store's contract: what any backend's records do — the repository
 * record, package and workspace refs, execution attempts with their owners and
 * plans, the adoption memo, and dataflow runs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, none, some, variant } from '@elaraai/east';
import {
  DataflowRunType, ExecutionOwnerType, ExecutionStatusType, RepositoryRecordType,
  type DataflowRun, type ExecutionOwner, type ExecutionStatus,
} from '@elaraai/e3-types';
import { ExecutionCorruptError } from '../errors.js';
import { uuidv7 } from '../uuid.js';
import type { BackendSetup } from './setup.js';

const TASK = 'a'.repeat(64);
const INPUTS = 'b'.repeat(64);
const HASH = 'c'.repeat(64);
const OTHER_HASH = 'd'.repeat(64);
const AT = new Date('2026-09-28T00:00:00.000Z');

/** Two UUIDv7s minted one after the other, the second sorting after the
 *  first. */
function twoIds(): [string, string] {
  const first = uuidv7();
  return [first, uuidv7()];
}

/**
 * Registers the ref store's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function refStoreTests(setup: BackendSetup): void {
  describe('the ref store', () => {
    it('keeps the repository\'s record, which a write replaces', async (t) => {
      const { storage, repo } = await setup(t);
      const record = await storage.refs.repositoryRead(repo);
      assert.ok(record !== null, 'a created repository has its record');
      const next = { ...record, release: '0.0.1' };
      await storage.refs.repositoryWrite(repo, next);
      const read = await storage.refs.repositoryRead(repo);
      assert.ok(read !== null && equalFor(RepositoryRecordType)(read, next));
    });

    it('keeps a package\'s ref by its name and version, until it is removed', async (t) => {
      const { storage, repo } = await setup(t);
      assert.equal(await storage.refs.packageResolve(repo, 'pkg', '1.0.0'), null);
      await storage.refs.packageWrite(repo, 'pkg', '1.0.0', HASH);
      await storage.refs.packageWrite(repo, 'pkg', '2.0.0', OTHER_HASH);
      assert.equal(await storage.refs.packageResolve(repo, 'pkg', '1.0.0'), HASH);
      const listed = await storage.refs.packageList(repo);
      assert.deepEqual(listed.map(({ name, version }) => `${name}@${version}`).sort(), ['pkg@1.0.0', 'pkg@2.0.0']);

      await storage.refs.packageRemove(repo, 'pkg', '1.0.0');
      assert.equal(await storage.refs.packageResolve(repo, 'pkg', '1.0.0'), null);
      assert.deepEqual(await storage.refs.packageList(repo), [{ name: 'pkg', version: '2.0.0' }]);
    });

    it('keeps a workspace\'s record, and removes it with its runs', async (t) => {
      const { storage, repo } = await setup(t);
      assert.equal(await storage.refs.workspaceRead(repo, 'ws'), null);
      await storage.refs.workspaceWrite(repo, 'ws', new Uint8Array([1, 2, 3]));
      assert.deepEqual(new Uint8Array((await storage.refs.workspaceRead(repo, 'ws'))!), new Uint8Array([1, 2, 3]));
      assert.deepEqual(await storage.refs.workspaceList(repo), ['ws']);
      const runId = uuidv7();
      await storage.refs.dataflowRunWrite(repo, 'ws', {
        runId,
        workspaceName: 'ws',
        packageRef: 'pkg@1.0.0',
        startedAt: AT,
        completedAt: none,
        status: variant('running', {}),
        inputVersions: new Map([['inputs/sales', HASH]]),
        outputVersions: none,
        taskExecutions: new Map(),
        summary: { total: 1n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      });

      await storage.refs.workspaceRemove(repo, 'ws');
      assert.equal(await storage.refs.workspaceRead(repo, 'ws'), null);
      assert.deepEqual(await storage.refs.workspaceList(repo), []);
      assert.deepEqual(await storage.refs.dataflowRunList(repo, 'ws'), [], 'its runs go with it');
    });

    it('keeps every attempt at an execution, the latest sorting last', async (t) => {
      const { storage, repo } = await setup(t);
      assert.equal(await storage.refs.executionGetLatest(repo, TASK, INPUTS), null);
      const [first, second] = twoIds();
      const failed: ExecutionStatus = variant('failed', {
        executionId: first, inputHashes: [HASH], startedAt: AT, completedAt: AT, exitCode: 1n, peakBytes: none, unit: false,
      });
      const succeeded: ExecutionStatus = variant('success', {
        executionId: second, inputHashes: [HASH], outputHash: OTHER_HASH, startedAt: AT, completedAt: AT,
        peakBytes: some(1024n), plan: none, unit: false,
      });
      await storage.refs.executionWrite(repo, TASK, INPUTS, second, succeeded);
      await storage.refs.executionWrite(repo, TASK, INPUTS, first, failed);

      const equal = equalFor(ExecutionStatusType);
      assert.deepEqual(await storage.refs.executionListIds(repo, TASK, INPUTS), [first, second]);
      const got = await storage.refs.executionGet(repo, TASK, INPUTS, first);
      assert.ok(got !== null && equal(got, failed));
      const latest = await storage.refs.executionGetLatest(repo, TASK, INPUTS);
      assert.ok(latest !== null && equal(latest, succeeded));
      assert.deepEqual(await storage.refs.executionList(repo), [{ taskHash: TASK, inputsHash: INPUTS }]);
      assert.deepEqual(await storage.refs.executionListForTask(repo, TASK), [INPUTS]);
      const listed = await storage.refs.executionListLatest(repo, TASK);
      assert.deepEqual(listed.map(({ inputsHash }) => inputsHash), [INPUTS]);
      assert.ok(equal(listed[0]!.status, succeeded));
    });

    it('answers ExecutionCorruptError for an attempt whose record does not decode, which it still lists', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record that does not decode');
      const id = uuidv7();
      await storage.refs.executionWrite(repo, TASK, INPUTS, id, variant('failed', {
        executionId: id, inputHashes: [HASH], startedAt: AT, completedAt: AT, exitCode: 1n, peakBytes: none, unit: false,
      }));
      await damage.execution(TASK, INPUTS, id);
      // gc counts such an attempt as keeping nothing, where any other failure
      // to read one stops it.
      await assert.rejects(storage.refs.executionGet(repo, TASK, INPUTS, id), ExecutionCorruptError);
      assert.deepEqual(await storage.refs.executionListIds(repo, TASK, INPUTS), [id]);
    });

    it('keeps an attempt\'s owner, and deletes it with the attempt', async (t) => {
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      await storage.refs.executionWrite(repo, TASK, INPUTS, id, variant('failed', {
        executionId: id, inputHashes: [HASH], startedAt: AT, completedAt: AT, exitCode: 1n, peakBytes: none, unit: false,
      }));
      assert.equal(await storage.refs.executionOwnerRead(repo, TASK, INPUTS, id), null);
      const owner: ExecutionOwner = { pid: 1234n, pidStartTime: 5678n, bootId: 'contract-boot' };
      await storage.refs.executionOwnerWrite(repo, TASK, INPUTS, id, owner);
      const read = await storage.refs.executionOwnerRead(repo, TASK, INPUTS, id);
      assert.ok(read !== null && equalFor(ExecutionOwnerType)(read, owner));

      await storage.refs.executionDelete(repo, TASK, INPUTS, id);
      assert.equal(await storage.refs.executionGet(repo, TASK, INPUTS, id), null);
      assert.equal(await storage.refs.executionOwnerRead(repo, TASK, INPUTS, id), null);
      assert.deepEqual(await storage.refs.executionListIds(repo, TASK, INPUTS), []);
    });

    it('points a split task\'s execution at its plan, until the pointer is cleared', async (t) => {
      const { storage, repo } = await setup(t);
      assert.equal(await storage.refs.executionPlanRead(repo, TASK, INPUTS), null);
      await storage.refs.executionPlanWrite(repo, TASK, INPUTS, HASH);
      assert.equal(await storage.refs.executionPlanRead(repo, TASK, INPUTS), HASH);
      await storage.refs.executionPlanWrite(repo, TASK, INPUTS, OTHER_HASH);
      assert.equal(await storage.refs.executionPlanRead(repo, TASK, INPUTS), OTHER_HASH);
      await storage.refs.executionPlanWrite(repo, TASK, INPUTS, null);
      assert.equal(await storage.refs.executionPlanRead(repo, TASK, INPUTS), null);
    });

    it('remembers the manifest a delivery became, lists what it remembers, and forgets an entry', async (t) => {
      const { storage, repo } = await setup(t);
      const listed = async (): Promise<string[]> =>
        (await storage.refs.adoptionList(repo)).map(({ sourceHash, manifestHash }) => `${sourceHash}:${manifestHash}`).sort();
      assert.equal(await storage.refs.adoptionRead(repo, HASH), null);
      assert.deepEqual(await listed(), []);

      await storage.refs.adoptionWrite(repo, HASH, OTHER_HASH);
      await storage.refs.adoptionWrite(repo, OTHER_HASH, TASK);
      assert.equal(await storage.refs.adoptionRead(repo, HASH), OTHER_HASH);
      assert.deepEqual(await listed(), [`${HASH}:${OTHER_HASH}`, `${OTHER_HASH}:${TASK}`]);

      await storage.refs.adoptionDelete(repo, HASH);
      await storage.refs.adoptionDelete(repo, HASH);
      assert.equal(await storage.refs.adoptionRead(repo, HASH), null, 'forgotten, and forgetting it again does nothing');
      assert.deepEqual(await listed(), [`${OTHER_HASH}:${TASK}`]);
    });

    it('keeps a workspace\'s runs by id, the latest sorting last, until each is deleted', async (t) => {
      const { storage, repo } = await setup(t);
      assert.equal(await storage.refs.dataflowRunGetLatest(repo, 'ws'), null);
      const [first, second] = twoIds();
      const earlier: DataflowRun = {
        runId: first,
        workspaceName: 'ws',
        packageRef: 'pkg@1.0.0',
        startedAt: AT,
        completedAt: some(AT),
        status: variant('completed', {}),
        inputVersions: new Map([['inputs/sales', HASH]]),
        outputVersions: some(new Map([['tasks/etl/output', OTHER_HASH]])),
        taskExecutions: new Map([['etl', {
          executionId: uuidv7(), taskHash: TASK, inputsHash: INPUTS, cached: false,
          outputVersions: new Map([['inputs/sales', HASH]]), executionCount: 1n,
        }]]),
        summary: { total: 1n, completed: 1n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      };
      const later: DataflowRun = {
        runId: second,
        workspaceName: 'ws',
        packageRef: 'pkg@1.0.0',
        startedAt: AT,
        completedAt: none,
        status: variant('failed', { failedTask: 'etl', error: 'exit code 1' }),
        inputVersions: new Map([['inputs/sales', OTHER_HASH]]),
        outputVersions: none,
        taskExecutions: new Map(),
        summary: { total: 1n, completed: 0n, cached: 0n, failed: 1n, skipped: 0n, reexecuted: 0n },
      };
      await storage.refs.dataflowRunWrite(repo, 'ws', later);
      await storage.refs.dataflowRunWrite(repo, 'ws', earlier);

      const equal = equalFor(DataflowRunType);
      assert.deepEqual(await storage.refs.dataflowRunList(repo, 'ws'), [first, second]);
      const got = await storage.refs.dataflowRunGet(repo, 'ws', first);
      assert.ok(got !== null && equal(got, earlier));
      const latest = await storage.refs.dataflowRunGetLatest(repo, 'ws');
      assert.ok(latest !== null && equal(latest, later));
      assert.deepEqual(await storage.refs.dataflowRunList(repo, 'other'), [], 'another workspace has its own');

      await storage.refs.dataflowRunDelete(repo, 'ws', first);
      assert.equal(await storage.refs.dataflowRunGet(repo, 'ws', first), null);
      assert.deepEqual(await storage.refs.dataflowRunList(repo, 'ws'), [second]);
    });
  });
}
