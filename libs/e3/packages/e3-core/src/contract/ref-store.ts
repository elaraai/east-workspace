/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The ref store's contract: what any backend's records do — the repository
 * record and the upgrade under way, package and workspace refs, execution
 * attempts with their owners and plans, the adoption memo, and dataflow runs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, OptionType, StringType, StructType, encodeBeast2For, equalFor, none, printFor, some, variant } from '@elaraai/east';
import {
  DataflowRunType, E3_RELEASE, ExecutionOwnerType, ExecutionStatusType, RepositoryRecordType, RepositoryUpgradeProgressType, dataflowForce,
  type DataflowRun, type ExecutionOwner, type ExecutionStatus, type RepositoryUpgradeProgress,
} from '@elaraai/e3-types';
import { ExecutionCorruptError } from '../errors.js';
import { uuidv7 } from '../uuid.js';
import { MALFORMED_HASHES, MALFORMED_IDS, MALFORMED_NAMES, hashRefusal, idRefusal, nameRefusal } from './malformed.js';
import type { BackendSetup } from './setup.js';

const TASK = 'a'.repeat(64);
const INPUTS = 'b'.repeat(64);
const HASH = 'c'.repeat(64);
const OTHER_HASH = 'd'.repeat(64);
const OTHER_INPUTS = 'e'.repeat(64);
const OTHER_TASK = 'f'.repeat(64);
const AT = new Date('2026-09-28T00:00:00.000Z');

/** Two UUIDv7s minted one after the other, the second sorting after the
 *  first. */
function twoIds(): [string, string] {
  const first = uuidv7();
  return [first, uuidv7()];
}

/** An attempt recorded running: a split task's unit, when `unit`. */
function running(executionId: string, unit = false): ExecutionStatus {
  return variant('running', { executionId, inputHashes: [HASH], startedAt: AT, pid: 4242n, pidStartTime: 1n, bootId: 'contract-boot', unit });
}

/** An attempt that succeeded. */
function succeeded(executionId: string): ExecutionStatus {
  return variant('success', {
    executionId, inputHashes: [HASH], outputHash: OTHER_HASH, startedAt: AT, completedAt: AT, peakBytes: none, plan: none, unit: false,
  });
}

/** What `executionListRunning` answers: the latest status of inputs. */
const RunningListType = ArrayType(StructType({ inputsHash: StringType, status: ExecutionStatusType }));
const sameRunning = equalFor(RunningListType);
const printRunning = printFor(RunningListType);

/** Asserts a task's running attempts are those expected, in any order. */
async function assertRunning(
  listed: Promise<Array<{ inputsHash: string; status: ExecutionStatus }>>,
  expected: Array<{ inputsHash: string; status: ExecutionStatus }>,
  message: string,
): Promise<void> {
  const byInputs = (a: { inputsHash: string }, b: { inputsHash: string }): number =>
    (a.inputsHash < b.inputsHash ? -1 : a.inputsHash > b.inputsHash ? 1 : 0);
  const actual = [...await listed].sort(byInputs);
  const wanted = [...expected].sort(byInputs);
  assert.ok(sameRunning(actual, wanted), `${message}: ${printRunning(actual)}, where ${printRunning(wanted)} was expected`);
}

/** What `executionListAttempts` answers, as East values: each attempt's id,
 *  and its status, `none` for a record that does not decode. */
const AttemptsType = ArrayType(StructType({ executionId: StringType, status: OptionType(ExecutionStatusType) }));
const sameAttempts = equalFor(AttemptsType);
const printAttempts = printFor(AttemptsType);

/** What `executionListRuns` answers, as East values. */
const RunsType = ArrayType(StructType({ inputsHash: StringType, executionId: StringType, status: ExecutionStatusType }));
const sameRuns = equalFor(RunsType);
const printRuns = printFor(RunsType);

/** Asserts a page of a task's runs is the one expected, in that order. */
function assertRuns(
  listed: Array<{ inputsHash: string; executionId: string; status: ExecutionStatus }>,
  expected: Array<{ inputsHash: string; executionId: string; status: ExecutionStatus }>,
  message: string,
): void {
  assert.ok(sameRuns(listed, expected), `${message}: ${printRuns(listed)}, where ${printRuns(expected)} was expected`);
}

/** Asserts an execution's attempts are those expected, in that order. */
function assertAttempts(
  listed: Array<{ executionId: string; status: ExecutionStatus | null }>,
  expected: Array<[string, ExecutionStatus | null]>,
  message: string,
): void {
  const actual = listed.map(({ executionId, status }) => ({ executionId, status: status === null ? none : some(status) }));
  const wanted = expected.map(([executionId, status]) => ({ executionId, status: status === null ? none : some(status) }));
  assert.ok(sameAttempts(actual, wanted), `${message}: ${printAttempts(actual)}, where ${printAttempts(wanted)} was expected`);
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

    it('keeps the store upgrade under way beside the record, which a write replaces and a write of none clears', async (t) => {
      const { storage, repo } = await setup(t);
      assert.equal(await storage.refs.repositoryUpgradeRead(repo), null, 'a created repository has none under way');
      const record = await storage.refs.repositoryRead(repo);
      const equal = equalFor(RepositoryUpgradeProgressType);
      const first: RepositoryUpgradeProgress = { step: 'contract-step', release: '0.0.1', cursor: `${TASK}/${INPUTS}` };
      for (const progress of [first, { ...first, release: '0.0.2', cursor: `${TASK}/${HASH}` }]) {
        await storage.refs.repositoryUpgradeWrite(repo, progress);
        const read = await storage.refs.repositoryUpgradeRead(repo);
        assert.ok(read !== null && equal(read, progress), `it reads as written: ${progress.cursor}`);
      }
      const after = await storage.refs.repositoryRead(repo);
      assert.ok(record !== null && after !== null && equalFor(RepositoryRecordType)(after, record), 'the record is left as it was');

      await storage.refs.repositoryUpgradeWrite(repo, null);
      await storage.refs.repositoryUpgradeWrite(repo, null);
      assert.equal(await storage.refs.repositoryUpgradeRead(repo), null, 'cleared, and clearing it again does nothing');
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

    it('keeps a workspace\'s record, and removes it with its runs, their states and their events', async (t) => {
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
      // The run's state, and its events, in the backend's run state store
      const states = storage.runStates(repo);
      await states.create({
        release: E3_RELEASE, id: runId, repo, workspace: 'ws', startedAt: AT, force: dataflowForce(false), filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running',
        completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n,
        events: [variant('task_started', { seq: 1n, timestamp: AT, task: 'etl' })], eventSeq: 1n,
      });
      assert.equal((await states.getEventsSince(repo, 'ws', runId, 0)).length, 1);

      await storage.refs.workspaceRemove(repo, 'ws');
      assert.equal(await storage.refs.workspaceRead(repo, 'ws'), null);
      assert.deepEqual(await storage.refs.workspaceList(repo), []);
      assert.deepEqual(await storage.refs.dataflowRunList(repo, 'ws'), [], 'its runs go with it');
      assert.equal(await states.readLatest(repo, 'ws'), null, 'and their states');
      assert.deepEqual(await states.getEventsSince(repo, 'ws', runId, 0), [], 'and their events');
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

    it('answers the latest attempt over each of a task\'s inputs that is recorded running, a unit among them, until a later one or its end', async (t) => {
      const { storage, repo } = await setup(t);
      const list = () => storage.refs.executionListRunning(repo, TASK);
      await assertRunning(list(), [], 'a task that never ran runs nothing');

      const [first, second] = twoIds();
      await storage.refs.executionWrite(repo, TASK, INPUTS, first, running(first));
      const [unit, elsewhere] = twoIds();
      await storage.refs.executionWrite(repo, TASK, OTHER_INPUTS, unit, running(unit, true));
      await storage.refs.executionWrite(repo, OTHER_TASK, INPUTS, elsewhere, running(elsewhere));
      await assertRunning(list(), [{ inputsHash: INPUTS, status: running(first) }, { inputsHash: OTHER_INPUTS, status: running(unit, true) }],
        'its attempt and its unit, and not another task\'s');
      await assertRunning(storage.refs.executionListRunning(repo, OTHER_TASK), [{ inputsHash: INPUTS, status: running(elsewhere) }],
        'another task has its own');

      // A later attempt over the same inputs that ended answers for them,
      // though the first is still recorded running, as a crash leaves one.
      await storage.refs.executionWrite(repo, TASK, INPUTS, second, succeeded(second));
      await assertRunning(list(), [{ inputsHash: OTHER_INPUTS, status: running(unit, true) }], 'inputs whose latest attempt ended');
      const third = uuidv7();
      await storage.refs.executionWrite(repo, TASK, INPUTS, third, running(third));
      await assertRunning(list(), [{ inputsHash: INPUTS, status: running(third) }, { inputsHash: OTHER_INPUTS, status: running(unit, true) }],
        'a later attempt running');

      // Its end takes it out, and so does its deletion.
      await storage.refs.executionWrite(repo, TASK, OTHER_INPUTS, unit, succeeded(unit));
      await storage.refs.executionDelete(repo, TASK, INPUTS, third);
      await assertRunning(list(), [], 'an attempt ended, and one deleted');
    });

    it('reads of a task\'s attempts only those its index of running attempts names, however many it has made', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record in bytes of its choosing');
      // Fifty attempts over inputs of their own, each recorded running and
      // then ended, and then left in bytes that do not decode: a read of any
      // of them would fail, so an index that kept an ended one would too.
      for (let i = 0; i < 50; i++) {
        const inputs = i.toString(16).padStart(64, '0');
        const executionId = uuidv7();
        await storage.refs.executionWrite(repo, TASK, inputs, executionId, running(executionId));
        await storage.refs.executionWrite(repo, TASK, inputs, executionId, succeeded(executionId));
        await damage.execution(TASK, inputs, executionId);
      }
      await assert.rejects(storage.refs.executionListLatest(repo, TASK), ExecutionCorruptError, 'a read of the history meets them');
      const id = uuidv7();
      await storage.refs.executionWrite(repo, TASK, INPUTS, id, running(id));
      await assertRunning(storage.refs.executionListRunning(repo, TASK), [{ inputsHash: INPUTS, status: running(id) }],
        'the attempt running, and no attempt of the history read');

      // A record left running, as a release from before the index wrote one,
      // is in no index until it is written again; and a deleted attempt
      // leaves no place in it, for a record left after it.
      const earlier = uuidv7();
      const encode = encodeBeast2For(ExecutionStatusType);
      await damage.execution(TASK, OTHER_INPUTS, earlier, encode(running(earlier)));
      await assertRunning(storage.refs.executionListRunning(repo, TASK), [{ inputsHash: INPUTS, status: running(id) }],
        'a record no write indexed');
      await storage.refs.executionWrite(repo, TASK, OTHER_INPUTS, earlier, running(earlier));
      await assertRunning(storage.refs.executionListRunning(repo, TASK),
        [{ inputsHash: INPUTS, status: running(id) }, { inputsHash: OTHER_INPUTS, status: running(earlier) }], 'written again, it is indexed');
      await storage.refs.executionDelete(repo, TASK, OTHER_INPUTS, earlier);
      await damage.execution(TASK, OTHER_INPUTS, earlier, encode(running(earlier)));
      await assertRunning(storage.refs.executionListRunning(repo, TASK), [{ inputsHash: INPUTS, status: running(id) }],
        'a deleted attempt\'s place goes with it');
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

    it('answers every attempt at an execution with its status in one read, the latest last', async (t) => {
      const { storage, repo } = await setup(t);
      const attempts = () => storage.refs.executionListAttempts(repo, TASK, INPUTS);
      assertAttempts(await attempts(), [], 'an execution never run has none');
      const [first, second] = twoIds();
      const third = uuidv7();
      const failed: ExecutionStatus = variant('failed', {
        executionId: second, inputHashes: [HASH], startedAt: AT, completedAt: AT, exitCode: 1n, peakBytes: none, unit: false,
      });
      await storage.refs.executionWrite(repo, TASK, INPUTS, third, running(third));
      await storage.refs.executionWrite(repo, TASK, INPUTS, first, succeeded(first));
      await storage.refs.executionWrite(repo, TASK, INPUTS, second, failed);
      const elsewhere = uuidv7();
      await storage.refs.executionWrite(repo, TASK, OTHER_INPUTS, elsewhere, succeeded(elsewhere));
      assertAttempts(await attempts(), [[first, succeeded(first)], [second, failed], [third, running(third)]],
        'each, in the order of its id, whatever the order of the writes, and none of another execution');

      await storage.refs.executionDelete(repo, TASK, INPUTS, second);
      assertAttempts(await attempts(), [[first, succeeded(first)], [third, running(third)]], 'one deleted is gone');
    });

    it('lists a page of a task\'s runs, the latest first, and never a split task\'s units', async (t) => {
      const { storage, repo } = await setup(t);
      const runs = (page: { before?: string; limit: number }) => storage.refs.executionListRuns(repo, TASK, page);
      assertRuns(await runs({ limit: 10 }), [], 'a task that never ran has none');

      // A run, a unit of the task beside it, another run, and the latest,
      // still running; and another task's
      const [first, unit] = twoIds();
      const [second, latest] = twoIds();
      const failed: ExecutionStatus = variant('failed', {
        executionId: second, inputHashes: [HASH], startedAt: AT, completedAt: AT, exitCode: 1n, peakBytes: none, unit: false,
      });
      await storage.refs.executionWrite(repo, TASK, INPUTS, latest, running(latest));
      await storage.refs.executionWrite(repo, TASK, INPUTS, first, succeeded(first));
      await storage.refs.executionWrite(repo, TASK, HASH, unit, running(unit, true));
      await storage.refs.executionWrite(repo, TASK, OTHER_INPUTS, second, failed);
      const elsewhere = uuidv7();
      await storage.refs.executionWrite(repo, OTHER_TASK, INPUTS, elsewhere, succeeded(elsewhere));
      const [earliest, middle, newest] = [
        { inputsHash: INPUTS, executionId: first, status: succeeded(first) },
        { inputsHash: OTHER_INPUTS, executionId: second, status: failed },
        { inputsHash: INPUTS, executionId: latest, status: running(latest) },
      ];
      assertRuns(await runs({ limit: 10 }), [newest, middle, earliest], 'every run, the latest first, whatever the order of the writes');

      assertRuns(await runs({ limit: 2 }), [newest, middle], 'a page holds at most its limit');
      assertRuns(await runs({ before: second, limit: 2 }), [earliest], 'the next page begins before the last run of the one before');
      assertRuns(await runs({ before: first, limit: 2 }), [], 'and the last ends the listing');

      // A run's outcome replaces what the index answers of it, and a run
      // deleted goes from it
      await storage.refs.executionWrite(repo, TASK, INPUTS, latest, succeeded(latest));
      await storage.refs.executionDelete(repo, TASK, OTHER_INPUTS, second);
      assertRuns(await runs({ limit: 10 }), [{ ...newest, status: succeeded(latest) }, earliest], 'its outcome, and a run deleted gone');
    });

    it('lists only the runs its index names: a record no write indexed is in none, and a deleted run\'s place goes with it', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record in bytes of its choosing');
      const encode = encodeBeast2For(ExecutionStatusType);
      const runs = () => storage.refs.executionListRuns(repo, TASK, { limit: 10 });
      // A record left as a release from before the index wrote it
      const [earlier, kept] = twoIds();
      await damage.execution(TASK, INPUTS, earlier, encode(succeeded(earlier)));
      await storage.refs.executionWrite(repo, TASK, OTHER_INPUTS, kept, succeeded(kept));
      assertRuns(await runs(), [{ inputsHash: OTHER_INPUTS, executionId: kept, status: succeeded(kept) }], 'a record no write indexed');

      // Written, and deleted: a record left after it is in no index
      await storage.refs.executionWrite(repo, TASK, INPUTS, earlier, succeeded(earlier));
      await storage.refs.executionDelete(repo, TASK, INPUTS, earlier);
      await damage.execution(TASK, INPUTS, earlier, encode(succeeded(earlier)));
      assertRuns(await runs(), [{ inputsHash: OTHER_INPUTS, executionId: kept, status: succeeded(kept) }], 'a deleted run\'s place goes with it');
    });

    it('answers ExecutionCorruptError for a run on the page whose record does not decode, and reads no run off it', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record that does not decode');
      const [first, second] = twoIds();
      for (const id of [first, second]) await storage.refs.executionWrite(repo, TASK, INPUTS, id, succeeded(id));
      await damage.execution(TASK, INPUTS, first);
      await assert.rejects(storage.refs.executionListRuns(repo, TASK, { limit: 2 }), ExecutionCorruptError);
      assertRuns(await storage.refs.executionListRuns(repo, TASK, { limit: 1 }), [{ inputsHash: INPUTS, executionId: second, status: succeeded(second) }],
        'a page that ends before it');
    });

    it('refuses a page of runs whose limit is not a whole number greater than zero', async (t) => {
      const { storage, repo } = await setup(t);
      for (const limit of [0, -1, 1.5]) {
        await assert.rejects(storage.refs.executionListRuns(repo, TASK, { limit }), {
          name: 'RangeError', message: `a page's limit must be a whole number greater than zero, got ${limit}`,
        });
      }
    });

    it('answers null for an attempt whose record does not decode, which it still lists', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record that does not decode');
      const [first, second] = twoIds();
      for (const id of [first, second]) await storage.refs.executionWrite(repo, TASK, INPUTS, id, succeeded(id));
      await damage.execution(TASK, INPUTS, first);
      // gc takes it for an attempt that keeps nothing, where a failure to read
      // it stops gc
      assertAttempts(await storage.refs.executionListAttempts(repo, TASK, INPUTS), [[first, null], [second, succeeded(second)]],
        'the attempt, with no status');
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

    it('refuses a hash or an id that is not of its form, naming it, before it reads or writes anything', async (t) => {
      // A package being imported names an execution's hashes and an attempt's
      // id, a client names a run's id and a delivery's hash.
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      const failed: ExecutionStatus = variant('failed', {
        executionId: id, inputHashes: [HASH], startedAt: AT, completedAt: AT, exitCode: 1n, peakBytes: none, unit: false,
      });
      const owner: ExecutionOwner = { pid: 1234n, pidStartTime: 5678n, bootId: 'contract-boot' };
      const run: DataflowRun = {
        runId: uuidv7(), workspaceName: 'ws', packageRef: 'pkg@1.0.0', startedAt: AT, completedAt: none,
        status: variant('running', {}), inputVersions: new Map(), outputVersions: none, taskExecutions: new Map(),
        summary: { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      };

      for (const malformed of MALFORMED_HASHES) {
        for (const [task, inputs, refused] of [
          [malformed, INPUTS, hashRefusal('task hash', malformed)],
          [TASK, malformed, hashRefusal('inputs hash', malformed)],
        ] as const) {
          await assert.rejects(storage.refs.executionGet(repo, task, inputs, id), refused);
          await assert.rejects(storage.refs.executionReadBytes(repo, task, inputs, id), refused);
          await assert.rejects(storage.refs.executionWrite(repo, task, inputs, id, failed), refused);
          await assert.rejects(storage.refs.executionDelete(repo, task, inputs, id), refused);
          await assert.rejects(storage.refs.executionListIds(repo, task, inputs), refused);
          await assert.rejects(storage.refs.executionListAttempts(repo, task, inputs), refused);
          await assert.rejects(storage.refs.executionGetLatest(repo, task, inputs), refused);
          await assert.rejects(storage.refs.executionOwnerWrite(repo, task, inputs, id, owner), refused);
          await assert.rejects(storage.refs.executionOwnerRead(repo, task, inputs, id), refused);
          await assert.rejects(storage.refs.executionPlanWrite(repo, task, inputs, HASH), refused);
          await assert.rejects(storage.refs.executionPlanRead(repo, task, inputs), refused);
        }
        await assert.rejects(storage.refs.executionListForTask(repo, malformed), hashRefusal('task hash', malformed));
        await assert.rejects(storage.refs.executionListLatest(repo, malformed), hashRefusal('task hash', malformed));
        await assert.rejects(storage.refs.executionListRunning(repo, malformed), hashRefusal('task hash', malformed));
        await assert.rejects(storage.refs.executionListRuns(repo, malformed, { limit: 1 }), hashRefusal('task hash', malformed));
        await assert.rejects(storage.refs.adoptionWrite(repo, malformed, HASH), hashRefusal('object hash', malformed));
        // A key that is no SHA-256 names no entry of the memo
        assert.equal(await storage.refs.adoptionRead(repo, malformed), null);
        await storage.refs.adoptionDelete(repo, malformed);
      }

      for (const malformed of MALFORMED_IDS) {
        const refused = idRefusal('execution id', malformed);
        await assert.rejects(storage.refs.executionGet(repo, TASK, INPUTS, malformed), refused);
        await assert.rejects(storage.refs.executionReadBytes(repo, TASK, INPUTS, malformed), refused);
        await assert.rejects(storage.refs.executionWrite(repo, TASK, INPUTS, malformed, failed), refused);
        await assert.rejects(storage.refs.executionDelete(repo, TASK, INPUTS, malformed), refused);
        await assert.rejects(storage.refs.executionOwnerWrite(repo, TASK, INPUTS, malformed, owner), refused);
        await assert.rejects(storage.refs.executionOwnerRead(repo, TASK, INPUTS, malformed), refused);
        await assert.rejects(storage.refs.executionListRuns(repo, TASK, { before: malformed, limit: 1 }), refused);
        await assert.rejects(storage.refs.dataflowRunGet(repo, 'ws', malformed), idRefusal('run id', malformed));
        await assert.rejects(storage.refs.dataflowRunWrite(repo, 'ws', { ...run, runId: malformed }), idRefusal('run id', malformed));
        await assert.rejects(storage.refs.dataflowRunDelete(repo, 'ws', malformed), idRefusal('run id', malformed));
      }

      assert.deepEqual(await storage.refs.executionList(repo), [], 'no execution is written');
      assert.deepEqual(await storage.refs.adoptionList(repo), [], 'no memo entry is written');
      assert.deepEqual(await storage.refs.dataflowRunList(repo, 'ws'), [], 'no run is written');
    });

    it('refuses a package\'s name or version, or a workspace\'s name, that cannot be one path segment, naming it, before it reads or writes anything', async (t) => {
      const { storage, repo } = await setup(t);
      const runId = uuidv7();
      const run: DataflowRun = {
        runId, workspaceName: 'ws', packageRef: 'pkg@1.0.0', startedAt: AT, completedAt: none,
        status: variant('running', {}), inputVersions: new Map(), outputVersions: none, taskExecutions: new Map(),
        summary: { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      };

      for (const name of MALFORMED_NAMES['package']) {
        const refused = nameRefusal('package', name);
        await assert.rejects(storage.refs.packageResolve(repo, name, '1.0.0'), refused);
        await assert.rejects(storage.refs.packageWrite(repo, name, '1.0.0', HASH), refused);
        await assert.rejects(storage.refs.packageRemove(repo, name, '1.0.0'), refused);
      }
      for (const version of MALFORMED_NAMES['package version']) {
        const refused = nameRefusal('package version', version);
        await assert.rejects(storage.refs.packageResolve(repo, 'pkg', version), refused);
        await assert.rejects(storage.refs.packageWrite(repo, 'pkg', version, HASH), refused);
        await assert.rejects(storage.refs.packageRemove(repo, 'pkg', version), refused);
      }
      for (const workspace of MALFORMED_NAMES['workspace']) {
        const refused = nameRefusal('workspace', workspace);
        await assert.rejects(storage.refs.workspaceRead(repo, workspace), refused);
        await assert.rejects(storage.refs.workspaceWrite(repo, workspace, new Uint8Array([1])), refused);
        await assert.rejects(storage.refs.workspaceRemove(repo, workspace), refused);
        await assert.rejects(storage.refs.dataflowRunGet(repo, workspace, runId), refused);
        await assert.rejects(storage.refs.dataflowRunWrite(repo, workspace, run), refused);
        await assert.rejects(storage.refs.dataflowRunList(repo, workspace), refused);
        await assert.rejects(storage.refs.dataflowRunGetLatest(repo, workspace), refused);
        await assert.rejects(storage.refs.dataflowRunDelete(repo, workspace, runId), refused);
      }

      assert.deepEqual(await storage.refs.packageList(repo), [], 'no package ref is written');
      assert.deepEqual(await storage.refs.workspaceList(repo), [], 'no workspace is written');
    });
  });
}
