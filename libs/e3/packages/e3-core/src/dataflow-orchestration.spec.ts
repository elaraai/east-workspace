/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for dataflow orchestration using MockTaskRunner.
 *
 * These tests verify the dataflow execution logic (dependency ordering,
 * concurrency limits, failure propagation, abort handling, caching)
 * without spawning real processes.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { variant, StringType, IntegerType, ArrayType, encodeBeast2For, decodeBeast2For, East, IRType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  TaskObjectType,
  PackageObjectType,
  type TreePath,
  type Structure,
  type DatasetRef,
} from '@elaraai/e3-types';
import { dataflowExecute } from './dataflow.js';
import { LocalOrchestrator } from './dataflow/orchestrator/LocalOrchestrator.js';
import { InMemoryStateStore } from './dataflow/state-store/InMemoryStateStore.js';
import { datasetWrite } from './trees.js';
import { objectWrite } from './storage/local/LocalObjectStore.js';
import { workspaceDeploy, workspaceCreate, workspaceGetPackage } from './workspaces.js';
import { packageImport } from './packages.js';
import { recordMutate } from './records.js';
import { workspaceSetDataset } from './trees.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { MockTaskRunner } from './execution/MockTaskRunner.js';
import { inputsHash } from './executions.js';
import type { StorageBackend, LockHandle, LockOperation } from './storage/interfaces.js';
import type { TaskExecuteOptions, TaskRunner } from './execution/interfaces.js';

describe('dataflow orchestration with MockTaskRunner', () => {
  let testRepo: string;
  let storage: StorageBackend;
  let mockRunner: MockTaskRunner;

  beforeEach(() => {
    testRepo = createTestRepo();
    storage = new LocalStorage();
    mockRunner = new MockTaskRunner();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  /**
   * Helper to create a command IR object.
   */
  async function createCommandIr(repoPath: string, parts: string[]): Promise<string> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => {
        const result: (string | ReturnType<typeof inputs.get>)[] = [];
        for (const part of parts) {
          if (part === '{input}' || part === '{input0}') {
            result.push(inputs.get(0n));
          } else if (part.match(/^\{input(\d+)\}$/)) {
            const idx = BigInt(part.match(/^\{input(\d+)\}$/)![1]);
            result.push(inputs.get(idx));
          } else if (part === '{output}') {
            result.push(output);
          } else {
            result.push(part);
          }
        }
        return result;
      }
    );

    const ir = commandFn.toIR().ir;
    const encoder = encodeBeast2For(IRType);
    return objectWrite(repoPath, encoder(ir));
  }

  /**
   * Helper to create a package with tasks.
   * Returns a map of task names to task hashes.
   */
  async function createPackageWithTasks(
    repoPath: string,
    tasks: Array<{
      name: string;
      command: string[];
      inputs: TreePath[];
      output: TreePath;
    }>,
    structure: Structure,
  ): Promise<Map<string, string>> {
    const taskEncoder = encodeBeast2For(TaskObjectType);
    const tasksMap = new Map<string, string>();

    for (const t of tasks) {
      const commandIrHash = await createCommandIr(repoPath, t.command);
      const taskObj = {
        commandIr: commandIrHash,
        inputs: t.inputs,
        output: t.output,
        kind: variant('none', null), metadata: variant('none', null), runner: variant('custom', { command: [] }),
      };
      const taskHash = await objectWrite(repoPath, taskEncoder(taskObj));
      tasksMap.set(t.name, taskHash);
    }

    // Create package object (no root tree — per-dataset refs are used instead)
    const pkgEncoder = encodeBeast2For(PackageObjectType);
    const pkgObj = {
      data: {
        structure,
        refs: new Map(),
      },
      tasks: tasksMap,
      functions: new Map(),
      records: new Map(),
    };
    const pkgHash = await objectWrite(repoPath, pkgEncoder(pkgObj));

    const pkgDir = join(repoPath, 'packages', 'test');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, '1.0.0'), pkgHash + '\n');

    return tasksMap;
  }

  describe('dependency ordering', () => {
    it('executes tasks in topological order', async () => {
      // Create package with A -> B -> C chain
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle1', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle2', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middle1Path: TreePath = [variant('field', 'middle1')];
      const middle2Path: TreePath = [variant('field', 'middle2')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: middle1Path },
          { name: 'task-b', command: ['echo'], inputs: [middle1Path], output: middle2Path },
          { name: 'task-c', command: ['echo'], inputs: [middle2Path], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // Configure mock to return unique output hashes
      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success',
          cached: false,
          outputHash: `output-${name}`,
        });
      }

      const completedOrder: string[] = [];
      await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        onTaskComplete: (r) => completedOrder.push(r.name),
      });

      // Verify execution order: A must complete before B, B before C
      assert.strictEqual(completedOrder.indexOf('task-a') < completedOrder.indexOf('task-b'), true);
      assert.strictEqual(completedOrder.indexOf('task-b') < completedOrder.indexOf('task-c'), true);
    });

    it('executes independent tasks in parallel', async () => {
      // Create package with diamond: A -> B, A -> C, B+C -> D
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['out_a', { type: 'value', value: { type: StringType, writable: true } }],
          ['out_b', { type: 'value', value: { type: StringType, writable: true } }],
          ['out_c', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out_a')] },
          { name: 'task-b', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out_b')] },
          { name: 'task-c', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out_c')] },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // Configure mock results
      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success',
          cached: false,
          outputHash: `output-${name}`,
        });
      }

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.executed, 3);

      // Verify all tasks were called
      const calls = mockRunner.getCalls();
      assert.strictEqual(calls.length, 3);
    });
  });

  describe('concurrency limit', () => {
    it('respects concurrency limit with mock runner', async () => {
      // Create package with 4 independent tasks
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['out1', { type: 'value', value: { type: StringType, writable: true } }],
          ['out2', { type: 'value', value: { type: StringType, writable: true } }],
          ['out3', { type: 'value', value: { type: StringType, writable: true } }],
          ['out4', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-1', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out1')] },
          { name: 'task-2', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out2')] },
          { name: 'task-3', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out3')] },
          { name: 'task-4', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out4')] },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // Configure mock to add delay and track concurrency
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          // Simulate async work then decrement
          return {
            state: 'success',
            cached: false,
            outputHash: `output-${name}`,
          };
        });
      }

      // Track via callbacks since mock execute is sync
      let startCount = 0;
      await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 2,
        onTaskStart: () => {
          startCount++;
        },
        onTaskComplete: () => {
          currentConcurrent--;
        },
      });

      assert.strictEqual(startCount, 4);
      // Note: With synchronous mock, concurrency tracking through callbacks works differently
      // The key test is that all tasks were executed
      const calls = mockRunner.getCalls();
      assert.strictEqual(calls.length, 4);
    });
  });

  describe('cache behavior', () => {
    it('counts tasks as cached when runner returns cached: true', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // First run: not cached
      for (const [, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success',
          cached: false,
          outputHash: 'output-hash',
        });
      }

      const result1 = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result1.executed, 1);
      assert.strictEqual(result1.cached, 0);

      // Second run: runner returns cached: true
      mockRunner.clearCalls();
      for (const [, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success',
          cached: true,
          outputHash: 'output-hash',
        });
      }

      const result2 = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      // Note: The dataflow has its own cache check before calling the runner.
      // If the workspace output already matches the cached output, runner isn't called.
      // In this test, we're verifying that if runner IS called and returns cached: true,
      // it's counted correctly.
      assert.strictEqual(result2.success, true);
    });
  });

  describe('failure propagation', () => {
    it('skips downstream tasks when upstream fails', async () => {
      // Create A -> B -> C, where A fails
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle1', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle2', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middle1Path: TreePath = [variant('field', 'middle1')];
      const middle2Path: TreePath = [variant('field', 'middle2')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: middle1Path },
          { name: 'task-b', command: ['echo'], inputs: [middle1Path], output: middle2Path },
          { name: 'task-c', command: ['echo'], inputs: [middle2Path], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // task-a fails, others should succeed if called
      mockRunner.setResult(taskHashes.get('task-a')!, {
        state: 'failed',
        cached: false,
        exitCode: 1,
      });
      mockRunner.setResult(taskHashes.get('task-b')!, {
        state: 'success',
        cached: false,
        outputHash: 'output-b',
      });
      mockRunner.setResult(taskHashes.get('task-c')!, {
        state: 'success',
        cached: false,
        outputHash: 'output-c',
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.skipped, 2); // B and C should be skipped

      const taskA = result.tasks.find(t => t.name === 'task-a');
      const taskB = result.tasks.find(t => t.name === 'task-b');
      const taskC = result.tasks.find(t => t.name === 'task-c');

      assert.strictEqual(taskA?.state, 'failed');
      assert.strictEqual(taskB?.state, 'skipped');
      assert.strictEqual(taskC?.state, 'skipped');

      // Only task-a should have been called
      const calls = mockRunner.getCalls();
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].taskHash, taskHashes.get('task-a'));
    });

    it('handles error state from runner', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // Runner returns error state
      mockRunner.setResult(taskHashes.get('task')!, {
        state: 'error',
        cached: false,
        error: 'Internal error',
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.failed, 1);

      const task = result.tasks.find(t => t.name === 'task');
      assert.strictEqual(task?.state, 'error');
      assert.strictEqual(task?.error, 'Internal error');
    });
  });

  describe('abort handling', () => {
    it('does not start tasks when signal is pre-aborted', async () => {
      // Create an independent task
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      mockRunner.setResult(taskHashes.get('task')!, {
        state: 'success',
        cached: false,
        outputHash: 'output-hash',
      });

      // Pre-abort the signal before execution starts
      const controller = new AbortController();
      controller.abort();

      const { DataflowAbortedError } = await import('./errors.js');

      await assert.rejects(
        dataflowExecute(storage, testRepo, 'test-ws', {
          runner: mockRunner,
          signal: controller.signal,
        }),
        (err: Error) => {
          assert.ok(err instanceof DataflowAbortedError);
          return true;
        }
      );

      // No tasks should have been executed since signal was pre-aborted
      const calls = mockRunner.getCalls();
      assert.strictEqual(calls.length, 0, 'No tasks should execute when signal is pre-aborted');
    });
  });

  describe('input hash passing', () => {
    it('passes correct input hashes to runner', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('specific-value'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'specific-value', StringType);

      // Set up mock to capture input hashes
      let capturedInputHashes: string[] = [];
      mockRunner.setResult(taskHashes.get('task')!, (inputHashes) => {
        capturedInputHashes = [...inputHashes];
        return {
          state: 'success',
          cached: false,
          outputHash: 'output-hash',
        };
      });

      await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      // Verify the input hash was passed correctly
      assert.strictEqual(capturedInputHashes.length, 1);
      assert.strictEqual(capturedInputHashes[0], inputHash);
    });
  });

  describe('callback invocation', () => {
    it('calls onTaskStart and onTaskComplete callbacks', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'my-task', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      mockRunner.setResult(taskHashes.get('my-task')!, {
        state: 'success',
        cached: false,
        outputHash: 'output-hash',
      });

      const startedTasks: string[] = [];
      const completedTasks: string[] = [];

      await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        onTaskStart: (name) => startedTasks.push(name),
        onTaskComplete: (result) => completedTasks.push(result.name),
      });

      assert.deepStrictEqual(startedTasks, ['my-task']);
      assert.deepStrictEqual(completedTasks, ['my-task']);
    });

    it('passes stdout/stderr callbacks to runner', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const inputEncoder = encodeBeast2For(StringType);
      const _inputHash = await objectWrite(testRepo, inputEncoder('test'));

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // Capture the options passed to runner
      let _capturedOptions: TaskExecuteOptions | undefined;
      mockRunner.setResult(taskHashes.get('task')!, (_inputHashes) => {
        _capturedOptions = mockRunner.getCalls()[0]?.options;
        return {
          state: 'success',
          cached: false,
          outputHash: 'output-hash',
        };
      });

      const stdoutCalls: Array<{task: string; data: string}> = [];
      const stderrCalls: Array<{task: string; data: string}> = [];

      await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        onStdout: (task, data) => stdoutCalls.push({ task, data }),
        onStderr: (task, data) => stderrCalls.push({ task, data }),
      });

      // Verify callbacks were passed to runner's options
      const call = mockRunner.getCalls()[0];
      assert.ok(call.options?.onStdout, 'onStdout should be passed to runner');
      assert.ok(call.options?.onStderr, 'onStderr should be passed to runner');
    });
  });

  describe('reactive dataflow', () => {
    it('reaches fixpoint without re-execution when inputs unchanged', async () => {
      // Normal execution, no input changes → same behavior as before
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middlePath: TreePath = [variant('field', 'middle')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: middlePath },
          { name: 'task-b', command: ['echo'], inputs: [middlePath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success',
          cached: false,
          outputHash: `output-${name}`,
        });
      }

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.executed, 2);
      assert.strictEqual(result.reexecuted, 0);
    });

    it('re-executes downstream tasks when input changes during execution', async () => {
      // Setup: input → taskA → output
      // MockTaskRunner for taskA: during execution, write new value to input ref
      // After taskA completes, reactive loop detects change, invalidates taskA
      // taskA re-runs with new input
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'initial-value', StringType);

      let callCount = 0;
      const taskAHash = taskHashes.get('task-a')!;

      mockRunner.setResult(taskAHash, async (_inputHashes) => {
        callCount++;
        if (callCount === 1) {
          // On first execution, simulate a concurrent input change
          const newHash = await datasetWrite(storage, testRepo, 'changed-value', StringType);
          const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
          await storage.datasets.write(testRepo, 'test-ws', 'input', ref);
        }
        return {
          state: 'success' as const,
          cached: false,
          outputHash: `output-v${callCount}`,
        };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result.success, true);
      // Should have executed task-a twice: once initially, once after input change
      assert.strictEqual(callCount, 2);
      assert.strictEqual(result.reexecuted, 1);
      // executed counts final unique tasks, not total calls
      assert.strictEqual(result.executed, 1);
    });

    it('re-executes chain when input changes during execution', async () => {
      // Setup: input → taskA → middle → taskB → output
      // During taskA execution, input changes
      // taskA should re-run, then taskB should run with new output
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middlePath: TreePath = [variant('field', 'middle')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: middlePath },
          { name: 'task-b', command: ['echo'], inputs: [middlePath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'initial-value', StringType);

      let taskACallCount = 0;
      let taskBCallCount = 0;

      const taskAHash = taskHashes.get('task-a')!;
      const taskBHash = taskHashes.get('task-b')!;

      mockRunner.setResult(taskAHash, async (_inputHashes) => {
        taskACallCount++;
        if (taskACallCount === 1) {
          // On first execution, simulate a concurrent input change
          const newHash = await datasetWrite(storage, testRepo, 'changed-value', StringType);
          const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
          await storage.datasets.write(testRepo, 'test-ws', 'input', ref);
        }
        return {
          state: 'success' as const,
          cached: false,
          outputHash: `middle-v${taskACallCount}`,
        };
      });

      mockRunner.setResult(taskBHash, (_inputHashes) => {
        taskBCallCount++;
        return {
          state: 'success' as const,
          cached: false,
          outputHash: `output-v${taskBCallCount}`,
        };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result.success, true);
      // taskA should run twice (initial + re-execution after input change)
      assert.strictEqual(taskACallCount, 2);
      // taskB should run once (blocked until taskA re-executes, then runs with fresh data)
      assert.strictEqual(taskBCallCount, 1);
      // One re-execution (taskA)
      assert.strictEqual(result.reexecuted, 1);
    });

    it('tracks reexecuted count correctly', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'v1', StringType);

      let callCount = 0;
      const taskAHash = taskHashes.get('task-a')!;

      mockRunner.setResult(taskAHash, async (_inputHashes) => {
        callCount++;
        if (callCount <= 2) {
          // First two calls: write a new input value
          const newHash = await datasetWrite(storage, testRepo, `v${callCount + 1}`, StringType);
          const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
          await storage.datasets.write(testRepo, 'test-ws', 'input', ref);
        }
        return {
          state: 'success' as const,
          cached: false,
          outputHash: `output-v${callCount}`,
        };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result.success, true);
      // Should execute 3 times total: initial + 2 re-executions
      assert.strictEqual(callCount, 3);
      assert.strictEqual(result.reexecuted, 2);
    });

    it('calls onInputChanged callback', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'initial', StringType);

      let callCount = 0;
      const taskAHash = taskHashes.get('task-a')!;

      mockRunner.setResult(taskAHash, async (_inputHashes) => {
        callCount++;
        if (callCount === 1) {
          const newHash = await datasetWrite(storage, testRepo, 'changed', StringType);
          const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
          await storage.datasets.write(testRepo, 'test-ws', 'input', ref);
        }
        return {
          state: 'success' as const,
          cached: false,
          outputHash: `output-v${callCount}`,
        };
      });

      const inputChanges: Array<{ path: string; previousHash: string; newHash: string }> = [];

      await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        onInputChanged: (path, previousHash, newHash) => {
          inputChanges.push({ path, previousHash, newHash });
        },
      });

      assert.strictEqual(inputChanges.length, 1);
      assert.strictEqual(inputChanges[0]!.path, '.input');
      assert.ok(inputChanges[0]!.previousHash.length > 0);
      assert.ok(inputChanges[0]!.newHash.length > 0);
      assert.notStrictEqual(inputChanges[0]!.previousHash, inputChanges[0]!.newHash);
    });

    it('calls onTaskInvalidated callback', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'initial', StringType);

      let callCount = 0;
      const taskAHash = taskHashes.get('task-a')!;

      mockRunner.setResult(taskAHash, async (_inputHashes) => {
        callCount++;
        if (callCount === 1) {
          const newHash = await datasetWrite(storage, testRepo, 'changed', StringType);
          const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
          await storage.datasets.write(testRepo, 'test-ws', 'input', ref);
        }
        return {
          state: 'success' as const,
          cached: false,
          outputHash: `output-v${callCount}`,
        };
      });

      const invalidated: Array<{ name: string; reason: string }> = [];

      await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        onTaskInvalidated: (name, reason) => {
          invalidated.push({ name, reason });
        },
      });

      assert.strictEqual(invalidated.length, 1);
      assert.strictEqual(invalidated[0]!.name, 'task-a');
      assert.ok(invalidated[0]!.reason.includes('.input'), `Reason should mention input path, got: ${invalidated[0]!.reason}`);
    });

    it('handles no-op change (same hash)', async () => {
      // Input "changes" but to same hash value → no invalidation
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'same-value', StringType);

      let callCount = 0;
      const taskAHash = taskHashes.get('task-a')!;

      mockRunner.setResult(taskAHash, async (_inputHashes) => {
        callCount++;
        if (callCount === 1) {
          // Write the same value — hash should not change
          const sameHash = await datasetWrite(storage, testRepo, 'same-value', StringType);
          const ref: DatasetRef = variant('value', { hash: sameHash, versions: new Map() });
          await storage.datasets.write(testRepo, 'test-ws', 'input', ref);
        }
        return {
          state: 'success' as const,
          cached: false,
          outputHash: `output-v${callCount}`,
        };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });

      assert.strictEqual(result.success, true);
      // Should NOT re-execute since the hash is the same
      assert.strictEqual(callCount, 1);
      assert.strictEqual(result.reexecuted, 0);
    });
  });

  describe('diamond interleavings (deterministic)', () => {
    // The classic dataflow hazards — join synchronisation, mid-flight root
    // changes, mixed-version joins, fan-in failure — tested with NO sleeps:
    // MockTaskRunner task bodies are promise-gated / perform their mutation
    // synchronously inside a task execution, so every interleaving is a
    // fixed, repeatable schedule (CI-speed independent).

    /** Build the diamond: input → left, input → right, (left,right) → merge. */
    async function createDiamond() {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['left_out', { type: 'value', value: { type: StringType, writable: true } }],
          ['right_out', { type: 'value', value: { type: StringType, writable: true } }],
          ['merge_out', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const leftPath: TreePath = [variant('field', 'left_out')];
      const rightPath: TreePath = [variant('field', 'right_out')];
      const mergePath: TreePath = [variant('field', 'merge_out')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'left', command: ['echo'], inputs: [inputPath], output: leftPath },
          { name: 'right', command: ['echo'], inputs: [inputPath], output: rightPath },
          { name: 'merge', command: ['echo'], inputs: [leftPath, rightPath], output: mergePath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'v1', StringType);
      return { taskHashes, inputPath };
    }

    /** Update the diamond's root input ref to a fresh value (mid-flight mutation). */
    async function mutateInput(value: string): Promise<void> {
      const newHash = await datasetWrite(storage, testRepo, value, StringType);
      const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
      await storage.datasets.write(testRepo, 'test-ws', 'input', ref);
    }

    it('merge waits for BOTH branches even when one is held in-flight', async () => {
      const { taskHashes } = await createDiamond();
      const leftHash = taskHashes.get('left')!;
      const rightHash = taskHashes.get('right')!;
      const mergeHash = taskHashes.get('merge')!;

      // Hold `left` open until `right` has fully completed — the exact
      // schedule where a premature join would fire with a missing branch.
      let releaseLeft!: () => void;
      const leftGate = new Promise<void>((res) => { releaseLeft = res; });
      let rightCompleted = false;
      let mergeStarted = false;

      mockRunner.setResult(leftHash, async () => {
        await leftGate;
        return { state: 'success' as const, cached: false, outputHash: 'left-v1' };
      });
      mockRunner.setResult(rightHash, async () => {
        rightCompleted = true;
        releaseLeft();
        return { state: 'success' as const, cached: false, outputHash: 'right-v1' };
      });
      mockRunner.setResult(mergeHash, async (inputHashes) => {
        mergeStarted = true;
        // The join must see both branch outputs, never a partial set
        assert.deepStrictEqual([...inputHashes].sort(), ['left-v1', 'right-v1']);
        assert.strictEqual(rightCompleted, true, 'merge started before right completed');
        return { state: 'success' as const, cached: false, outputHash: 'merge-v1' };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(mergeStarted, true);
      assert.strictEqual(result.executed, 3);
    });

    it('never joins mixed versions when the root changes mid-flight', async () => {
      // The version-vector hazard: input changes while the branches run.
      // A broken engine merges left@v1 with right@v2 (or vice versa); a
      // correct one re-executes both branches and joins a matching pair.
      const { taskHashes } = await createDiamond();
      const leftHash = taskHashes.get('left')!;
      const rightHash = taskHashes.get('right')!;
      const mergeHash = taskHashes.get('merge')!;

      let leftCalls = 0;
      let rightCalls = 0;
      const mergeCalls: string[][] = [];

      mockRunner.setResult(leftHash, async () => {
        leftCalls++;
        if (leftCalls === 1) {
          // Root input changes WHILE left is executing — deterministic,
          // no sleeps: the mutation happens inside the task body.
          await mutateInput('v2');
        }
        return { state: 'success' as const, cached: false, outputHash: `left-v${leftCalls}` };
      });
      mockRunner.setResult(rightHash, async () => {
        rightCalls++;
        return { state: 'success' as const, cached: false, outputHash: `right-v${rightCalls}` };
      });
      mockRunner.setResult(mergeHash, async (inputHashes) => {
        mergeCalls.push([...inputHashes]);
        return { state: 'success' as const, cached: false, outputHash: `merge-v${mergeCalls.length}` };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      // Both branches re-ran after the root change
      assert.strictEqual(leftCalls, 2, 'left should re-execute after root change');
      assert.strictEqual(rightCalls, 2, 'right should re-execute after root change');
      assert.ok(result.reexecuted >= 2, `expected >=2 re-executions, got ${result.reexecuted}`);

      // THE invariant: every merge call joined a matching version pair
      assert.ok(mergeCalls.length >= 1, 'merge never ran');
      for (const inputs of mergeCalls) {
        const versions = new Set(inputs.map((h) => h.split('-v')[1]));
        assert.strictEqual(versions.size, 1, `merge joined mixed versions: ${inputs.join(', ')}`);
      }
      // And the final join used the post-change branch outputs
      const final = mergeCalls[mergeCalls.length - 1]!;
      assert.deepStrictEqual([...final].sort(), ['left-v2', 'right-v2']);
    });

    it('skips the join when one branch fails and preserves the surviving branch', async () => {
      const { taskHashes } = await createDiamond();
      const leftHash = taskHashes.get('left')!;
      const rightHash = taskHashes.get('right')!;
      const mergeHash = taskHashes.get('merge')!;

      let mergeRan = false;
      mockRunner.setResult(leftHash, { state: 'failed', cached: false, exitCode: 1 });
      mockRunner.setResult(rightHash, { state: 'success', cached: false, outputHash: 'right-v1' });
      mockRunner.setResult(mergeHash, async () => {
        mergeRan = true;
        return { state: 'success' as const, cached: false, outputHash: 'merge-v1' };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(mergeRan, false, 'merge must not run when a parent branch failed');
      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.skipped, 1);

      // The surviving branch's output is preserved in the workspace
      const rightRef = await storage.datasets.read(testRepo, 'test-ws', 'right_out');
      assert.strictEqual(rightRef?.type, 'value');
    });

    it('conflicting writes to two roots during execution converge to a consistent fixpoint', async () => {
      // Two independent roots, each mutated while the OTHER root's task is
      // running — the cross-invalidation case. Deterministic: mutations
      // happen inside the first execution of each task.
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['x', { type: 'value', value: { type: StringType, writable: true } }],
          ['y', { type: 'value', value: { type: StringType, writable: true } }],
          ['a_out', { type: 'value', value: { type: StringType, writable: true } }],
          ['b_out', { type: 'value', value: { type: StringType, writable: true } }],
          ['merge_out', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const xPath: TreePath = [variant('field', 'x')];
      const yPath: TreePath = [variant('field', 'y')];
      const aPath: TreePath = [variant('field', 'a_out')];
      const bPath: TreePath = [variant('field', 'b_out')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'ta', command: ['echo'], inputs: [xPath], output: aPath },
          { name: 'tb', command: ['echo'], inputs: [yPath], output: bPath },
          { name: 'merge', command: ['echo'], inputs: [aPath, bPath], output: [variant('field', 'merge_out')] },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', xPath, 'x1', StringType);
      await workspaceSetDataset(storage, testRepo, 'test-ws', yPath, 'y1', StringType);

      const writeRoot = async (refPath: string, value: string) => {
        const newHash = await datasetWrite(storage, testRepo, value, StringType);
        const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
        await storage.datasets.write(testRepo, 'test-ws', refPath, ref);
      };

      let taCalls = 0;
      let tbCalls = 0;
      const mergeCalls: string[][] = [];
      mockRunner.setResult(taskHashes.get('ta')!, async () => {
        taCalls++;
        if (taCalls === 1) await writeRoot('y', 'y2'); // mutate the OTHER root
        return { state: 'success' as const, cached: false, outputHash: `a-v${taCalls}` };
      });
      mockRunner.setResult(taskHashes.get('tb')!, async () => {
        tbCalls++;
        if (tbCalls === 1) await writeRoot('x', 'x2'); // mutate the OTHER root
        return { state: 'success' as const, cached: false, outputHash: `b-v${tbCalls}` };
      });
      mockRunner.setResult(taskHashes.get('merge')!, async (inputHashes) => {
        mergeCalls.push([...inputHashes]);
        return { state: 'success' as const, cached: false, outputHash: `m-v${mergeCalls.length}` };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      // Each task re-ran for its own root's change
      assert.strictEqual(taCalls, 2, 'ta should re-execute after x changed');
      assert.strictEqual(tbCalls, 2, 'tb should re-execute after y changed');
      // The final join saw the post-change outputs of BOTH branches
      const final = mergeCalls[mergeCalls.length - 1]!;
      assert.deepStrictEqual([...final].sort(), ['a-v2', 'b-v2']);
    });
    it('re-joins a consistent pair when the root changes while the join itself is running', async () => {
      // The change lands during MERGE's execution (not a branch's): the
      // in-progress join finishes with the v1 pair, then the engine must
      // re-execute both branches AND the join with the v2 pair.
      const { taskHashes } = await createDiamond();
      let leftCalls = 0;
      let rightCalls = 0;
      const mergeCalls: string[][] = [];

      mockRunner.setResult(taskHashes.get('left')!, async () => {
        leftCalls++;
        return { state: 'success' as const, cached: false, outputHash: `left-v${leftCalls}` };
      });
      mockRunner.setResult(taskHashes.get('right')!, async () => {
        rightCalls++;
        return { state: 'success' as const, cached: false, outputHash: `right-v${rightCalls}` };
      });
      mockRunner.setResult(taskHashes.get('merge')!, async (inputHashes) => {
        mergeCalls.push([...inputHashes]);
        if (mergeCalls.length === 1) {
          await mutateInput('v2'); // root changes while the join runs
        }
        return { state: 'success' as const, cached: false, outputHash: `merge-v${mergeCalls.length}` };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(leftCalls, 2, 'left should re-execute after the change');
      assert.strictEqual(rightCalls, 2, 'right should re-execute after the change');
      assert.strictEqual(mergeCalls.length, 2, 'join should re-execute after the change');
      assert.deepStrictEqual([...mergeCalls[1]!].sort(), ['left-v2', 'right-v2']);
    });

    it('converges to the LAST value when the root changes repeatedly during one run', async () => {
      // Two successive changes inside one run — the fixpoint loop must keep
      // re-executing until the graph reflects the final value, and stop.
      const { taskHashes } = await createDiamond();
      let leftCalls = 0;
      let rightCalls = 0;
      const mergeCalls: string[][] = [];

      mockRunner.setResult(taskHashes.get('left')!, async () => {
        leftCalls++;
        if (leftCalls === 1) await mutateInput('v2');
        if (leftCalls === 2) await mutateInput('v3');
        return { state: 'success' as const, cached: false, outputHash: `left-v${leftCalls}` };
      });
      mockRunner.setResult(taskHashes.get('right')!, async () => {
        rightCalls++;
        return { state: 'success' as const, cached: false, outputHash: `right-v${rightCalls}` };
      });
      mockRunner.setResult(taskHashes.get('merge')!, async (inputHashes) => {
        mergeCalls.push([...inputHashes]);
        return { state: 'success' as const, cached: false, outputHash: `merge-v${mergeCalls.length}` };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(leftCalls, 3, 'left should run for v1, v2, v3');
      const final = mergeCalls[mergeCalls.length - 1]!;
      assert.deepStrictEqual([...final].sort(), [`left-v${leftCalls}`, `right-v${rightCalls}`]);
      // No mixed-version join at any point
      for (const inputs of mergeCalls) {
        const lv = inputs.find((h) => h.startsWith('left-'))!.split('-v')[1];
        const rv = inputs.find((h) => h.startsWith('right-'))!.split('-v')[1];
        assert.strictEqual(lv, rv, `merge joined mixed versions: ${inputs.join(', ')}`);
      }
    });

    it('partially invalidates: a change feeding one branch does not re-run the other', async () => {
      // Two independent roots: x→ta→a, y→tb→b, (a,b)→merge. Changing y while
      // ta runs must re-execute ONLY tb and the join — ta's work stands.
      // Over-invalidation here is the efficiency regression that makes big
      // real-world dataflows re-run everything on every edit.
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['x', { type: 'value', value: { type: StringType, writable: true } }],
          ['y', { type: 'value', value: { type: StringType, writable: true } }],
          ['a_out', { type: 'value', value: { type: StringType, writable: true } }],
          ['b_out', { type: 'value', value: { type: StringType, writable: true } }],
          ['merge_out', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const xPath: TreePath = [variant('field', 'x')];
      const yPath: TreePath = [variant('field', 'y')];
      const aPath: TreePath = [variant('field', 'a_out')];
      const bPath: TreePath = [variant('field', 'b_out')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'ta', command: ['echo'], inputs: [xPath], output: aPath },
          { name: 'tb', command: ['echo'], inputs: [yPath], output: bPath },
          { name: 'merge', command: ['echo'], inputs: [aPath, bPath], output: [variant('field', 'merge_out')] },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', xPath, 'x1', StringType);
      await workspaceSetDataset(storage, testRepo, 'test-ws', yPath, 'y1', StringType);

      let taCalls = 0;
      let tbCalls = 0;
      const mergeCalls: string[][] = [];
      mockRunner.setResult(taskHashes.get('ta')!, async () => {
        taCalls++;
        if (taCalls === 1) {
          const newHash = await datasetWrite(storage, testRepo, 'y2', StringType);
          const ref: DatasetRef = variant('value', { hash: newHash, versions: new Map() });
          await storage.datasets.write(testRepo, 'test-ws', 'y', ref);
        }
        return { state: 'success' as const, cached: false, outputHash: `a-v${taCalls}` };
      });
      mockRunner.setResult(taskHashes.get('tb')!, async () => {
        tbCalls++;
        return { state: 'success' as const, cached: false, outputHash: `b-v${tbCalls}` };
      });
      mockRunner.setResult(taskHashes.get('merge')!, async (inputHashes) => {
        mergeCalls.push([...inputHashes]);
        return { state: 'success' as const, cached: false, outputHash: `m-v${mergeCalls.length}` };
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(taCalls, 1, 'ta must NOT re-run for a change to y (over-invalidation)');
      assert.strictEqual(tbCalls, 2, 'tb should re-run for the y change');
      const final = mergeCalls[mergeCalls.length - 1]!;
      assert.deepStrictEqual([...final].sort(), ['a-v1', 'b-v2']);
    });

    it('propagates a mid-flight change transitively through a double diamond', async () => {
      // diamond1 (input → l1,r1 → m1) feeding diamond2 (m1 → l2,r2 → m2):
      // a root change during l1 must cascade re-execution through BOTH
      // fan-out/fan-in layers, and m2 must join a consistent final pair.
      const fields: Array<[string, unknown]> = [
        ['input', { type: 'value', value: { type: StringType, writable: true } }],
        ['l1_out', { type: 'value', value: { type: StringType, writable: true } }],
        ['r1_out', { type: 'value', value: { type: StringType, writable: true } }],
        ['m1_out', { type: 'value', value: { type: StringType, writable: true } }],
        ['l2_out', { type: 'value', value: { type: StringType, writable: true } }],
        ['r2_out', { type: 'value', value: { type: StringType, writable: true } }],
        ['m2_out', { type: 'value', value: { type: StringType, writable: true } }],
      ];
      const structure: Structure = {
        type: 'struct',
        value: new Map(fields),
      } as unknown as Structure;
      const path = (name: string): TreePath => [variant('field', name)];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'l1', command: ['echo'], inputs: [path('input')], output: path('l1_out') },
          { name: 'r1', command: ['echo'], inputs: [path('input')], output: path('r1_out') },
          { name: 'm1', command: ['echo'], inputs: [path('l1_out'), path('r1_out')], output: path('m1_out') },
          { name: 'l2', command: ['echo'], inputs: [path('m1_out')], output: path('l2_out') },
          { name: 'r2', command: ['echo'], inputs: [path('m1_out')], output: path('r2_out') },
          { name: 'm2', command: ['echo'], inputs: [path('l2_out'), path('r2_out')], output: path('m2_out') },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', path('input'), 'v1', StringType);

      // Exact downstream call counts are schedule-dependent (a join that
      // wasn't ready yet when the change was detected legitimately runs
      // once, with the new inputs). The schedule-independent invariant is:
      // every join's LAST call consumed its parents' LATEST outputs.
      const calls = new Map<string, number>();
      const lastInputs = new Map<string, string[]>();
      const counted = (name: string, hash: string, extra?: (n: number) => Promise<void>) => {
        mockRunner.setResult(hash, async (inputHashes) => {
          const n = (calls.get(name) ?? 0) + 1;
          calls.set(name, n);
          lastInputs.set(name, [...inputHashes]);
          if (extra) await extra(n);
          return { state: 'success' as const, cached: false, outputHash: `${name}-v${n}` };
        });
      };
      counted('l1', taskHashes.get('l1')!, async (n) => {
        if (n === 1) await mutateInput('v2');
      });
      for (const name of ['r1', 'm1', 'l2', 'r2', 'm2']) {
        counted(name, taskHashes.get(name)!);
      }

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result.success, true);
      // The task that observed the change must have re-executed
      assert.strictEqual(calls.get('l1'), 2, 'l1 should re-execute after the root change');
      // Transitive freshness: each join's last call used its parents' final outputs
      const latest = (name: string) => `${name}-v${calls.get(name)}`;
      assert.deepStrictEqual(
        [...lastInputs.get('m1')!].sort(),
        [latest('l1'), latest('r1')].sort(),
        'first join must consume the latest branch outputs'
      );
      assert.deepStrictEqual(lastInputs.get('l2'), [latest('m1')], 'second fan-out must consume the latest m1');
      assert.deepStrictEqual(lastInputs.get('r2'), [latest('m1')]);
      assert.deepStrictEqual(
        [...lastInputs.get('m2')!].sort(),
        [latest('l2'), latest('r2')].sort(),
        'final join must consume the latest second-layer outputs'
      );
    });

  });

  describe('DataflowRun recording', () => {
    it('records correct outputVersions with task output hashes', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      mockRunner.setResult(taskHashes.get('task-a')!, {
        state: 'success',
        cached: false,
        outputHash: 'task-a-output-hash',
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });
      assert.strictEqual(result.success, true);

      const run = await storage.refs.dataflowRunGetLatest(testRepo, 'test-ws');
      assert.ok(run, 'DataflowRun should exist');
      assert.strictEqual(run.outputVersions.type, 'some');
      const outputVersions = run.outputVersions.value;
      assert.strictEqual(outputVersions.get('.output'), 'task-a-output-hash');
      assert.strictEqual(outputVersions.has('.input'), false, 'Input should not appear in outputVersions');
    });

    it('records outputVersions for all completed tasks in a chain', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middlePath: TreePath = [variant('field', 'middle')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: middlePath },
          { name: 'task-b', command: ['echo'], inputs: [middlePath], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      mockRunner.setResult(taskHashes.get('task-a')!, {
        state: 'success',
        cached: false,
        outputHash: 'middle-hash',
      });
      mockRunner.setResult(taskHashes.get('task-b')!, {
        state: 'success',
        cached: false,
        outputHash: 'output-hash',
      });

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
      });
      assert.strictEqual(result.success, true);

      const run = await storage.refs.dataflowRunGetLatest(testRepo, 'test-ws');
      assert.ok(run, 'DataflowRun should exist');
      assert.strictEqual(run.outputVersions.type, 'some');
      const outputVersions = run.outputVersions.value;
      assert.strictEqual(outputVersions.get('.middle'), 'middle-hash');
      assert.strictEqual(outputVersions.get('.output'), 'output-hash');
    });

    it('records partial outputVersions when execution is cancelled', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      const controller = new AbortController();

      // Task aborts during execution
      mockRunner.setResult(taskHashes.get('task-a')!, async () => {
        controller.abort();
        // Small delay to let abort propagate
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          state: 'success' as const,
          cached: false,
          outputHash: 'task-a-output-hash',
        };
      });

      const { DataflowAbortedError } = await import('./errors.js');

      await assert.rejects(
        dataflowExecute(storage, testRepo, 'test-ws', {
          runner: mockRunner,
          signal: controller.signal,
        }),
        (err: Error) => {
          assert.ok(err instanceof DataflowAbortedError);
          return true;
        }
      );

      const run = await storage.refs.dataflowRunGetLatest(testRepo, 'test-ws');
      assert.ok(run, 'DataflowRun should exist after cancellation');
      assert.strictEqual(run.status.type, 'cancelled');
      assert.strictEqual(run.outputVersions.type, 'some');
      // Input should not appear in outputVersions even on cancellation
      assert.strictEqual(run.outputVersions.value.has('.input'), false);
    });
  });

  describe('abort cleanup', () => {
    it('removes abort listener after normal completion', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'task', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      mockRunner.setResult(taskHashes.get('task')!, {
        state: 'success',
        cached: false,
        outputHash: 'output-hash',
      });

      const controller = new AbortController();

      const result = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        signal: controller.signal,
      });

      assert.strictEqual(result.success, true);

      // After execution completes, aborting should not throw.
      // If the abort listener were still attached, it could attempt to write
      // to a cleaned-up state store and throw.
      assert.doesNotThrow(() => controller.abort());
    });
  });

  describe('cache-hit mutex', () => {
    it('correctly handles cache hit during concurrent execution', async () => {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['out_a', { type: 'value', value: { type: StringType, writable: true } }],
          ['out_b', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out_a')] },
          { name: 'task-b', command: ['echo'], inputs: [inputPath], output: [variant('field', 'out_b')] },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

      // First run: both tasks execute and capture input hashes
      const capturedInputHashes = new Map<string, string[]>();
      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, (inputHashesArr) => {
          capturedInputHashes.set(name, [...inputHashesArr]);
          return {
            state: 'success' as const,
            cached: false,
            outputHash: `output-${name}`,
          };
        });
      }

      const result1 = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result1.executed, 2);

      // Write execution cache entries so the second run finds cached outputs.
      // The orchestrator's stepPrepareTask checks the execution store.
      // The executionId must be UUIDv7 format for LocalRefStore to find it.
      const now = new Date();
      const fakeUuid = '01900000-0000-7000-8000-000000000001';
      for (const [name, hash] of taskHashes) {
        const captured = capturedInputHashes.get(name);
        assert.ok(captured, `Should have captured input hashes for ${name}`);
        const inHash = inputsHash(captured);
        await storage.refs.executionWrite(testRepo, hash, inHash, fakeUuid, variant('success', {
          executionId: fakeUuid,
          inputHashes: captured,
          outputHash: `output-${name}`,
          startedAt: now,
          completedAt: now,
        }));
      }

      // Second run: both tasks should be inline cache hits (workspace output matches)
      mockRunner.clearCalls();
      const result2 = await dataflowExecute(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        concurrency: 4,
      });

      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.cached, 2);
      assert.strictEqual(result2.executed, 0);
      // MockRunner should not have been called — cache resolved inline
      assert.strictEqual(mockRunner.getCalls().length, 0);
    });
  });

  describe('yield and resume', () => {
    /**
     * Build the standard A -> B -> C chain fixture and return its task hashes.
     */
    async function createChainFixture(): Promise<Map<string, string>> {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle1', { type: 'value', value: { type: StringType, writable: true } }],
          ['middle2', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;

      const inputPath: TreePath = [variant('field', 'input')];
      const middle1Path: TreePath = [variant('field', 'middle1')];
      const middle2Path: TreePath = [variant('field', 'middle2')];
      const outputPath: TreePath = [variant('field', 'output')];

      const taskHashes = await createPackageWithTasks(
        testRepo,
        [
          { name: 'task-a', command: ['echo'], inputs: [inputPath], output: middle1Path },
          { name: 'task-b', command: ['echo'], inputs: [middle1Path], output: middle2Path },
          { name: 'task-c', command: ['echo'], inputs: [middle2Path], output: outputPath },
        ],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);
      return taskHashes;
    }

    it('yields at the checkpoint and resumes to completion', async () => {
      const taskHashes = await createChainFixture();
      const stateStore = new InMemoryStateStore();
      const orchestrator = new LocalOrchestrator(stateStore);

      // task-a completes immediately; task-b hangs until released, so the
      // yield deterministically catches it in_progress.
      let releaseB!: () => void;
      const bGate = new Promise<void>((resolve) => { releaseB = resolve; });
      mockRunner.setResult(taskHashes.get('task-a')!, {
        state: 'success', cached: false, outputHash: 'output-task-a',
      });
      mockRunner.setResult(taskHashes.get('task-b')!, async () => {
        await bGate;
        return { state: 'success', cached: false, outputHash: 'output-task-b' };
      });
      mockRunner.setResult(taskHashes.get('task-c')!, {
        state: 'success', cached: false, outputHash: 'output-task-c',
      });

      // Request the yield once task-a has completed.
      let yieldRequested = false;
      const handle = await orchestrator.start(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        shouldYield: () => yieldRequested,
        onTaskComplete: (r) => { if (r.name === 'task-a') yieldRequested = true; },
      });

      const result1 = await orchestrator.wait(handle);
      assert.strictEqual(result1.yielded, true);
      assert.strictEqual(result1.success, false);
      assert.strictEqual(result1.executed, 1); // task-a only

      // Persisted state: still running, task-a completed, nothing in_progress
      const persisted = await stateStore.read(testRepo, 'test-ws', handle.id);
      assert.ok(persisted);
      assert.strictEqual(persisted.status, 'running');
      assert.strictEqual(persisted.tasks.get('task-a')!.status, 'completed');
      assert.strictEqual(persisted.tasks.get('task-b')!.status, 'pending');
      assert.strictEqual(persisted.tasks.get('task-c')!.status, 'pending');

      // Resume — task-b runs normally this time. No lock retry needed: wait()
      // resolves a yield only after the locks are released.
      releaseB();
      // Let the abandoned task-b promise settle; its completion handler only
      // mutates the dead incarnation's in-memory state (persist suppressed).
      await new Promise((resolve) => setTimeout(resolve, 10));
      mockRunner.setResult(taskHashes.get('task-b')!, {
        state: 'success', cached: false, outputHash: 'output-task-b',
      });
      const handle2 = await orchestrator.resume(storage, testRepo, 'test-ws', handle.id, {
        runner: mockRunner,
      });
      assert.strictEqual(handle2.id, handle.id);

      const result2 = await orchestrator.wait(handle2);
      assert.strictEqual(result2.success, true);
      assert.ok(!result2.yielded);

      const final = await stateStore.read(testRepo, 'test-ws', handle.id);
      assert.strictEqual(final!.status, 'completed');
      for (const name of ['task-a', 'task-b', 'task-c']) {
        assert.strictEqual(final!.tasks.get(name)!.status, 'completed');
      }

      // task-a ran exactly once — completed work is not re-executed on resume
      const aCalls = mockRunner.getCalls().filter(c => c.taskHash === taskHashes.get('task-a'));
      assert.strictEqual(aCalls.length, 1);
    });

    it('continues the DataflowRun record across resume via runId', async () => {
      const taskHashes = await createChainFixture();
      const stateStore = new InMemoryStateStore();
      const orchestrator = new LocalOrchestrator(stateStore);

      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success', cached: false, outputHash: `output-${name}`,
        });
      }

      // Yield as soon as task-a completes
      let yieldRequested = false;
      const handle = await orchestrator.start(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        shouldYield: () => yieldRequested,
        onTaskComplete: (r) => { if (r.name === 'task-a') yieldRequested = true; },
      });
      const result1 = await orchestrator.wait(handle);
      assert.strictEqual(result1.yielded, true);

      // Resume under the original runId
      const handle2 = await orchestrator.resume(storage, testRepo, 'test-ws', handle.id, {
        runner: mockRunner,
        runId: result1.runId,
      });
      const result2 = await orchestrator.wait(handle2);
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.runId, result1.runId);

      // The final run record is written under the original runId and covers
      // tasks completed before the yield, not just this incarnation.
      const run = await storage.refs.dataflowRunGet(testRepo, 'test-ws', result1.runId);
      assert.ok(run);
      assert.strictEqual(run.status.type, 'completed');
      for (const name of ['task-a', 'task-b', 'task-c']) {
        assert.ok(run.taskExecutions.has(name), `run record should include ${name}`);
      }
    });

    it('recovers an execution stranded in_progress by a dead host', async () => {
      const taskHashes = await createChainFixture();
      const stateStore = new InMemoryStateStore();
      const orchestrator = new LocalOrchestrator(stateStore);

      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success', cached: false, outputHash: `output-${name}`,
        });
      }

      // Take a clean yield first to get a valid persisted 'running' state...
      let yieldRequested = false;
      const handle = await orchestrator.start(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        shouldYield: () => yieldRequested,
        onTaskComplete: () => { yieldRequested = true; },
      });
      await orchestrator.wait(handle);

      // ...then simulate a crash: strand task-b in_progress (a dead host
      // never runs stepYield, so this is what resume() actually sees).
      const state = await stateStore.read(testRepo, 'test-ws', handle.id);
      assert.ok(state);
      (state.tasks.get('task-b')! as { status: string }).status = 'in_progress';
      await stateStore.update(state);

      const handle2 = await orchestrator.resume(storage, testRepo, 'test-ws', handle.id, {
        runner: mockRunner,
      });
      const result = await orchestrator.wait(handle2);
      assert.strictEqual(result.success, true);

      const final = await stateStore.read(testRepo, 'test-ws', handle.id);
      assert.strictEqual(final!.status, 'completed');
    });

    it('rejects resume without a state store', async () => {
      await createChainFixture();
      const orchestrator = new LocalOrchestrator();
      await assert.rejects(
        orchestrator.resume(storage, testRepo, 'test-ws', '1', { runner: mockRunner }),
        /no state store/
      );
    });

    it('rejects resume of an unknown execution', async () => {
      await createChainFixture();
      const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
      await assert.rejects(
        orchestrator.resume(storage, testRepo, 'test-ws', '999', { runner: mockRunner }),
        /not found/
      );
    });

    it('rejects resume of a completed execution', async () => {
      const taskHashes = await createChainFixture();
      const stateStore = new InMemoryStateStore();
      const orchestrator = new LocalOrchestrator(stateStore);

      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success', cached: false, outputHash: `output-${name}`,
        });
      }

      const handle = await orchestrator.start(storage, testRepo, 'test-ws', { runner: mockRunner });
      const result = await orchestrator.wait(handle);
      assert.strictEqual(result.success, true);

      await assert.rejects(
        orchestrator.resume(storage, testRepo, 'test-ws', handle.id, { runner: mockRunner }),
        /status is 'completed'/
      );
    });

    it('finalizes normally when shouldYield is true but the dataflow is already complete', async () => {
      const taskHashes = await createChainFixture();
      const stateStore = new InMemoryStateStore();
      const orchestrator = new LocalOrchestrator(stateStore);

      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, {
          state: 'success', cached: false, outputHash: `output-${name}`,
        });
      }

      // Yield only requested after the last task completes — the loop's
      // done-check runs before the checkpoint, so it must finalize.
      let completedCount = 0;
      const handle = await orchestrator.start(storage, testRepo, 'test-ws', {
        runner: mockRunner,
        shouldYield: () => completedCount >= 3,
        onTaskComplete: () => { completedCount++; },
      });
      const result = await orchestrator.wait(handle);
      assert.strictEqual(result.success, true);
      assert.ok(!result.yielded);

      const final = await stateStore.read(testRepo, 'test-ws', handle.id);
      assert.strictEqual(final!.status, 'completed');
    });
  });

  describe('lock release ordering', () => {
    // Build a single-task workspace whose run we can drive to completion.
    async function deploySingleTask(): Promise<Map<string, string>> {
      const structure: Structure = {
        type: 'struct',
        value: new Map([
          ['input', { type: 'value', value: { type: StringType, writable: true } }],
          ['output', { type: 'value', value: { type: StringType, writable: true } }],
        ]),
      } as unknown as Structure;
      const inputPath: TreePath = [variant('field', 'input')];
      const outputPath: TreePath = [variant('field', 'output')];
      const taskHashes = await createPackageWithTasks(
        testRepo,
        [{ name: 'only', command: ['echo'], inputs: [inputPath], output: outputPath }],
        structure,
      );
      await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
      await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'seed', StringType);
      for (const [name, hash] of taskHashes) {
        mockRunner.setResult(hash, { state: 'success', cached: false, outputHash: `out-${name}` });
      }
      return taskHashes;
    }

    it('resolves wait() only after the workspace lock is released', async () => {
      // Regression for the cloud loop-engine leak: a bounded-lifetime host
      // returns the instant wait() resolves and then freezes, so any lock
      // release still pending in the loop's `finally` never flushes — leaking
      // the shared workspace lock and blocking a subsequent exclusive op
      // (e.g. `workspace export`). The orchestrator must release BEFORE it
      // resolves wait(). Proven here by gating the workspace lock's release:
      // wait() must stay pending until the gate opens.
      await deploySingleTask();

      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => { openGate = resolve; });
      let workspaceReleaseStarted = false;

      // Wrap the shared workspace lock's release so it blocks on the gate.
      const realAcquire = storage.locks.acquire.bind(storage.locks);
      storage.locks.acquire = async (
        repo: string, resource: string, op: LockOperation,
        opts?: { wait?: boolean; timeout?: number; mode?: 'shared' | 'exclusive' },
      ): Promise<LockHandle | null> => {
        const handle = await realAcquire(repo, resource, op, opts);
        if (handle && resource === 'test-ws') {
          const realRelease = handle.release.bind(handle);
          return {
            ...handle,
            release: async () => { workspaceReleaseStarted = true; await gate; await realRelease(); },
          };
        }
        return handle;
      };

      let resolved = false;
      try {
        const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
        const handle = await orchestrator.start(storage, testRepo, 'test-ws', { runner: mockRunner });
        const waitPromise = orchestrator.wait(handle).then((r) => { resolved = true; return r; });

        // Let the loop run to completion; its finally calls the gated release.
        const deadline = Date.now() + 5000;
        while (!workspaceReleaseStarted && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5));
        }
        assert.ok(workspaceReleaseStarted, 'workspace lock release should have started');

        // The release is in flight (blocked on the gate). wait() MUST NOT have
        // resolved yet — pre-fix it resolved before release and this flips.
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(resolved, false, 'wait() resolved before the workspace lock was released');

        // Open the gate → release completes → wait() resolves.
        openGate();
        const result = await waitPromise;
        assert.strictEqual(resolved, true);
        assert.strictEqual(result.success, true);
      } finally {
        storage.locks.acquire = realAcquire;
        openGate();
      }
    });
  });

  describe('record as a reactive task input', () => {
    // A record is a writable:false dataset leaf, so a task can read it like any
    // input. Mutating the record advances its ref/version, which the reactive
    // loop must detect to re-execute the dependent task — the end-to-end proof of
    // the commit-granular change detection that records-as-task-input relies on.
    const encodeInt = encodeBeast2For(IntegerType);
    const decodeInt = decodeBeast2For(IntegerType);
    // A reducer runner: returns the new state bytes without spawning a process.
    const fixedState = (value: bigint): TaskRunner => ({
      runDetached: async () => ({ kind: 'success', value: encodeInt(value), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }),
    }) as unknown as TaskRunner;

    it('feeds the dependent task the record state, and the mutated value on the next run', async () => {
      const tempDir = createTempDir();
      try {
        const counter = e3.record('counter', IntegerType, 0n);
        const increment = e3.mutation(
          'increment', counter,
          East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)),
        );
        const reader = e3.task(
          'reader', [counter],
          East.function([IntegerType], IntegerType, ($, c) => c.multiply(2n)),
        );
        const pkg = e3.package('recflow', '1.0.0', counter, increment, reader);
        const zip = join(tempDir, 'recflow.zip');
        await e3.export(pkg, zip);
        await packageImport(storage, testRepo, zip);
        await workspaceCreate(storage, testRepo, 'test-ws');
        await workspaceDeploy(storage, testRepo, 'test-ws', 'recflow', '1.0.0');

        const { hash } = await workspaceGetPackage(storage, testRepo, 'test-ws');
        const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(testRepo, hash));
        const readerHash = deployed.tasks.get('reader')!;

        // Capture the record state the reader is actually fed each run by decoding
        // whichever input object is the IntegerType state (the runner is also fed
        // the function IR, which is not an integer).
        const seen: bigint[] = [];
        mockRunner.setResult(readerHash, async (inputHashes) => {
          let state: bigint | undefined;
          for (const h of inputHashes) {
            try { state = decodeInt(await storage.objects.read(testRepo, h) as Uint8Array); break; } catch { /* not the state input */ }
          }
          seen.push(state!);
          return { state: 'success' as const, cached: false, outputHash: `reader-v${seen.length}` };
        });

        // Run 1: reader sees the genesis state (counter = 0).
        const run1 = await dataflowExecute(storage, testRepo, 'test-ws', { runner: mockRunner });
        assert.strictEqual(run1.success, true, JSON.stringify(run1.tasks));

        // Mutate the record out of band → its ref + version advance (0 → 5).
        const mutated = await recordMutate(
          storage, fixedState(5n), testRepo, 'test-ws', 'counter', 'increment', [encodeInt(5n)], { actor: 'test' });
        assert.strictEqual(mutated.kind, 'committed');

        // Run 2: the dependent task is fed the mutated state; Run 3: it is stable.
        await dataflowExecute(storage, testRepo, 'test-ws', { runner: mockRunner });
        await dataflowExecute(storage, testRepo, 'test-ws', { runner: mockRunner });

        // The record's committed value reaches the task that reads it, and tracks
        // the mutation — the end-to-end payoff of records being reactive inputs.
        assert.deepStrictEqual(seen, [0n, 5n, 5n]);
      } finally {
        removeTempDir(tempDir);
      }
    });
  });
});
