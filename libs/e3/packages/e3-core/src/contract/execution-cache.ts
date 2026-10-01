/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The execution cache's contract, over any backend: what its probe serves,
 * and a `running` record it rewrites as interrupted only when the judgement
 * it is given says the execution cannot finish — a split task's driver
 * probing each unit with its own.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DictType, IntegerType, SortedMap, compareFor, encodeBeast2For, none, some, variant } from '@elaraai/east';
import { TASK_OBJECT_KIND, TaskObjectType, type TaskObject } from '@elaraai/e3-types';
import { executeSplitTask } from '../execution/engine.js';
import type { ExecutionLiveness } from '../execution/interfaces.js';
import { probeExecutionCache, type ExecutionResult } from '../execution/LocalTaskRunner.js';
import { pieceSizes, planPieces } from '../execution/pieces.js';
import { inputsHash } from '../executions.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { datasetWrite } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import type { BackendSetup } from './setup.js';

/** Another host, which runs an execution this host cannot see: its boot id is
 *  none of this host's. */
const HOST_B = { bootId: 'b7c1a1e0-host-b-boot-id', owner: 4242n, runner: 4243n };

/**
 * Records an execution as another host records one it runs: its owner, then
 * its `running` status, both naming that host's processes.
 */
async function recordRunningElsewhere(storage: StorageBackend, repo: string, taskHash: string, inHash: string, unit: boolean): Promise<string> {
  const executionId = uuidv7();
  await storage.refs.executionOwnerWrite(repo, taskHash, inHash, executionId, { pid: HOST_B.owner, pidStartTime: 987654n, bootId: HOST_B.bootId });
  await storage.refs.executionWrite(repo, taskHash, inHash, executionId, variant('running', {
    executionId, inputHashes: [], startedAt: new Date(), pid: HOST_B.runner, pidStartTime: 987655n, bootId: HOST_B.bootId, unit,
  }));
  return executionId;
}

/** A liveness that answers `answer` for every execution, and counts what it
 *  was asked of. */
function liveness(answer: boolean): { alive: ExecutionLiveness; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    alive: (_storage, _taskHash, inHash) => {
      asked.push(inHash);
      return Promise.resolve(answer);
    },
  };
}

/**
 * A task split over its one input, which no runner ever runs: the tests'
 * executor stands in for one. Its input is cut into many pieces
 * (`E3_TEST_PIECE_BYTES`), and each unit's output is its piece, so the task
 * writes its input again.
 */
async function splitTask(t: TestContext, storage: StorageBackend, repo: string): Promise<{ taskHash: string; task: TaskObject; input: string }> {
  const pieceBytes = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = '64';
  t.after(() => {
    if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
    else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
  });
  const Rows = DictType(IntegerType, IntegerType);
  const rows = new SortedMap(Array.from({ length: 6000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
  const input = await datasetWrite(storage, repo, rows, Rows);
  const task: TaskObject = {
    kind: TASK_OBJECT_KIND,
    body: variant('east', { program: '0'.repeat(64) }),
    runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
    inputs: [{ path: [variant('field', 'inputs'), variant('field', 'rows')], partition: some({ by: [] }) }],
    output: { path: [variant('field', 'tasks'), variant('field', 'copy'), variant('field', 'output')], kind: variant('dict', { merge: none }) },
    role: variant('data', null),
    environment: none,
  };
  const taskHash = await storage.objects.write(repo, encodeBeast2For(TaskObjectType)(task));
  return { taskHash, task, input };
}

/**
 * Registers the execution cache's contract suite over a backend.
 *
 * @remarks
 * Every case goes through the storage interfaces: the records the probe reads
 * and rewrites are the backend's ref store's, and a split task's pieces are
 * cut from the manifests its object store holds. Whether an execution can
 * finish is what the case's liveness says, as a backend's runner would.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function executionCacheTests(setup: BackendSetup): void {
  describe('the execution cache', () => {
    const taskHash = 'a'.repeat(64);
    const inHash = 'b'.repeat(64);

    it('serves the latest attempt when it succeeded, and nothing behind one that did not', async (t) => {
      const { storage, repo } = await setup(t);
      const succeeded = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, succeeded, variant('success', {
        executionId: succeeded, inputHashes: [], outputHash: 'c'.repeat(64), startedAt: new Date(), completedAt: new Date(),
        peakBytes: some(1024n), plan: none, unit: false,
      }));
      const served = await probeExecutionCache(storage, repo, taskHash, inHash, liveness(true).alive);
      assert.deepEqual([served?.executionId, served?.outputHash, served?.cached, served?.peakBytes], [succeeded, 'c'.repeat(64), true, 1024]);

      // Minted after the success's, so its id sorts after it.
      const failed = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, failed, variant('failed', {
        executionId: failed, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit: false,
      }));
      assert.equal(await probeExecutionCache(storage, repo, taskHash, inHash, liveness(true).alive), null);
    });

    it('leaves an execution running on another host as it is while the liveness it is given says it can finish', async (t) => {
      const { storage, repo } = await setup(t);
      const executionId = await recordRunningElsewhere(storage, repo, taskHash, inHash, true);
      const { alive, asked } = liveness(true);

      assert.equal(await probeExecutionCache(storage, repo, taskHash, inHash, alive), null, 'nothing is served');
      const latest = await storage.refs.executionGetLatest(repo, taskHash, inHash);
      assert.equal(latest?.type, 'running', 'the probe judged by the liveness it was given, not by this host\'s processes');
      assert.equal(latest?.value.executionId, executionId);
      assert.deepEqual(asked, [inHash]);
    });

    it('rewrites an execution the liveness it is given says cannot finish as interrupted, keeping whether it is a unit', async (t) => {
      const { storage, repo } = await setup(t);
      const executionId = await recordRunningElsewhere(storage, repo, taskHash, inHash, true);

      assert.equal(await probeExecutionCache(storage, repo, taskHash, inHash, liveness(false).alive), null);
      const latest = await storage.refs.executionGetLatest(repo, taskHash, inHash);
      assert.ok(latest?.type === 'interrupted', `the record is ${latest?.type}`);
      assert.deepEqual([latest.value.executionId, latest.value.pid, latest.value.unit], [executionId, HOST_B.runner, true]);
    });

    it('hands a split task\'s unit running on another host to its executor as it is, once, when the driver\'s liveness says it can finish', async (t) => {
      const { storage, repo } = await setup(t);
      const { taskHash: split, task, input } = await splitTask(t, storage, repo);
      const plan = await planPieces(storage, repo, task.inputs, [input], pieceSizes());
      assert.ok(plan.pieces.length > 2, `the input is cut into ${plan.pieces.length} pieces`);
      const unit = inputsHash(plan.pieces[0]!);
      const running = await recordRunningElsewhere(storage, repo, split, unit, true);

      // Round two of a driver whose units run on other hosts: the unit a round
      // before it launched is still running there.
      const executed = new Map<string, number>();
      const execute = async (unitInputs: string[], ids: { inHash: string; executionId: string }): Promise<ExecutionResult> => {
        executed.set(ids.inHash, (executed.get(ids.inHash) ?? 0) + 1);
        return {
          inputsHash: ids.inHash, executionId: ids.executionId, cached: false, state: 'success', outputHash: unitInputs[0]!,
          exitCode: 0, duration: 0, error: null, cancelled: false,
        };
      };
      const { alive, asked } = liveness(true);
      const result = await executeSplitTask(storage, repo, split, task, [input],
        { inHash: inputsHash([input]), executionId: uuidv7(), startTime: Date.now() }, {}, execute,
        { width: 2, owner: null, executionAlive: alive });

      assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(result.outputHash, input, 'each unit wrote its piece, so the task wrote its input again');
      assert.equal(executed.get(unit), 1, 'the executor is handed the running unit once, to attach to');
      assert.equal(executed.size, plan.pieces.length);
      assert.deepEqual(asked, [unit], 'the driver\'s liveness judged the unit recorded running');
      const latest = await storage.refs.executionGetLatest(repo, split, unit);
      assert.ok(latest?.type === 'running' && latest.value.executionId === running, 'the unit is still recorded running');
    });

    it('repairs a split task\'s unit the driver\'s liveness says cannot finish, and runs it again', async (t) => {
      const { storage, repo } = await setup(t);
      const { taskHash: split, task, input } = await splitTask(t, storage, repo);
      const plan = await planPieces(storage, repo, task.inputs, [input], pieceSizes());
      const unit = inputsHash(plan.pieces[0]!);
      await recordRunningElsewhere(storage, repo, split, unit, true);

      const executed: string[] = [];
      const result = await executeSplitTask(storage, repo, split, task, [input],
        { inHash: inputsHash([input]), executionId: uuidv7(), startTime: Date.now() }, {},
        async (unitInputs, ids) => {
          executed.push(ids.inHash);
          return {
            inputsHash: ids.inHash, executionId: ids.executionId, cached: false, state: 'success', outputHash: unitInputs[0]!,
            exitCode: 0, duration: 0, error: null, cancelled: false,
          };
        },
        { width: 2, owner: null, executionAlive: liveness(false).alive });

      assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(executed.filter((ran) => ran === unit).length, 1);
      assert.equal((await storage.refs.executionGetLatest(repo, split, unit))?.type, 'interrupted');
    });
  });
}
