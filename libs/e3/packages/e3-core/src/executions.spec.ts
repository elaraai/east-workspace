/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for executions.ts - task execution operations
 */

import { describe, it, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { variant, none, StringType, ArrayType, IntegerType, encodeBeast2For, East, IRType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { TASK_OBJECT_KIND, TaskObjectType, type ExecutionStatus } from '@elaraai/e3-types';
import {
  inputsHash,
  executionGet,
  executionGetLatest,
  executionGetOutput,
  executionList,
  executionListForTask,
  executionFindCurrent,
  executionReadLog,
} from './executions.js';
import { uuidv7 } from './uuid.js';
import { taskExecute } from './execution/LocalTaskRunner.js';
import { objectWrite } from './storage/local/LocalObjectStore.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { workspaceGetDatasetHash } from './trees.js';
import { workspaceGetTaskHash } from './tasks.js';
import type { StorageBackend } from './storage/interfaces.js';

describe('executions', () => {
  let testRepo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  /**
   * Helper to create a command IR object.
   *
   * Creates an East FunctionIR: (inputs: Array<String>, output: String) -> Array<String>
   * that returns the provided command parts as a literal array.
   */
  async function createCommandIr(repoPath: string, parts: string[]): Promise<string> {
    // Build an East function that returns the command array
    // The function signature is: (inputs: Array<String>, output: String) -> Array<String>
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => {
        // Build the result array, substituting inputs[i] and output as needed
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

  describe('inputsHash', () => {
    it('computes consistent hash for same inputs', () => {
      const hash1 = inputsHash(['abc', 'def']);
      const hash2 = inputsHash(['abc', 'def']);
      assert.strictEqual(hash1, hash2);
    });

    it('computes different hash for different inputs', () => {
      const hash1 = inputsHash(['abc', 'def']);
      const hash2 = inputsHash(['abc', 'xyz']);
      assert.notStrictEqual(hash1, hash2);
    });

    it('order matters', () => {
      const hash1 = inputsHash(['abc', 'def']);
      const hash2 = inputsHash(['def', 'abc']);
      assert.notStrictEqual(hash1, hash2);
    });

    it('handles empty array', () => {
      const hash = inputsHash([]);
      assert.strictEqual(hash.length, 64); // SHA256 hex
    });

    it('handles single input', () => {
      const hash = inputsHash(['abc']);
      assert.strictEqual(hash.length, 64);
    });
  });

  describe('executionGet', () => {
    it('returns null for non-existent execution', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const executionId = uuidv7();
      const status = await executionGet(storage, testRepo, taskHash, inHash, executionId);
      assert.strictEqual(status, null);
    });
  });

  describe('executionGetLatest', () => {
    it('returns null for non-existent execution', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const status = await executionGetLatest(storage, testRepo, taskHash, inHash);
      assert.strictEqual(status, null);
    });
  });

  describe('executionGetOutput', () => {
    it('returns null for non-existent execution', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const output = await executionGetOutput(storage, testRepo, taskHash, inHash);
      assert.strictEqual(output, null);
    });

    it('returns the output hash the latest success record holds, and its id, past a later failure', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const succeeded = uuidv7();
      const failed = uuidv7();
      const outputHash = 'c'.repeat(64);

      await storage.refs.executionWrite(testRepo, taskHash, inHash, succeeded, variant('success', {
        executionId: succeeded,
        inputHashes: [],
        outputHash,
        startedAt: new Date(0),
        completedAt: new Date(1),
        peakBytes: none,
        plan: none,
        unit: false,
      }));
      await storage.refs.executionWrite(testRepo, taskHash, inHash, failed, variant('failed', {
        executionId: failed,
        inputHashes: [],
        startedAt: new Date(2),
        completedAt: new Date(3),
        exitCode: 1n,
        peakBytes: none,
        unit: false,
      }));

      const output = await executionGetOutput(storage, testRepo, taskHash, inHash);
      assert.deepStrictEqual(output, { outputHash, executionId: succeeded });
    });
  });

  describe('executionList', () => {
    it('returns empty array for no executions', async () => {
      const list = await executionList(storage, testRepo);
      assert.deepStrictEqual(list, []);
    });

    it('lists all executions', async () => {
      const taskHash1 = 'a'.repeat(64);
      const taskHash2 = 'b'.repeat(64);
      const inHash1 = 'c'.repeat(64);
      const inHash2 = 'd'.repeat(64);
      const execId1 = uuidv7();
      const execId2 = uuidv7();
      const execId3 = uuidv7();

      // Create execution directories (new structure includes executionId)
      mkdirSync(join(testRepo, 'executions', taskHash1, inHash1, execId1), { recursive: true });
      mkdirSync(join(testRepo, 'executions', taskHash1, inHash2, execId2), { recursive: true });
      mkdirSync(join(testRepo, 'executions', taskHash2, inHash1, execId3), { recursive: true });

      const list = await executionList(storage, testRepo);
      assert.strictEqual(list.length, 3);
    });
  });

  describe('executionListForTask', () => {
    it('returns empty array for non-existent task', async () => {
      const taskHash = 'a'.repeat(64);
      const list = await executionListForTask(storage, testRepo, taskHash);
      assert.deepStrictEqual(list, []);
    });

    it('lists inputs for a task', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash1 = 'b'.repeat(64);
      const inHash2 = 'c'.repeat(64);
      const executionId1 = uuidv7();
      const executionId2 = uuidv7();

      // New structure includes executionId
      mkdirSync(join(testRepo, 'executions', taskHash, inHash1, executionId1), { recursive: true });
      mkdirSync(join(testRepo, 'executions', taskHash, inHash2, executionId2), { recursive: true });

      const list = await executionListForTask(storage, testRepo, taskHash);
      assert.strictEqual(list.length, 2);
      assert.ok(list.includes(inHash1));
      assert.ok(list.includes(inHash2));
    });
  });

  describe('executionReadLog', () => {
    it('returns empty chunk for non-existent log', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const executionId = uuidv7();
      const chunk = await executionReadLog(storage, testRepo, taskHash, inHash, executionId, 'stdout');
      assert.strictEqual(chunk.data, '');
      assert.strictEqual(chunk.size, 0);
      assert.strictEqual(chunk.complete, true);
    });

    it('reads log content', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const executionId = uuidv7();
      const logContent = 'Hello, world!\nLine 2\n';

      const execDir = join(testRepo, 'executions', taskHash, inHash, executionId);
      mkdirSync(execDir, { recursive: true });
      writeFileSync(join(execDir, 'stdout.txt'), logContent);

      const chunk = await executionReadLog(storage, testRepo, taskHash, inHash, executionId, 'stdout');
      assert.strictEqual(chunk.data, logContent);
      assert.strictEqual(chunk.size, logContent.length);
      assert.strictEqual(chunk.totalSize, logContent.length);
      assert.strictEqual(chunk.complete, true);
    });

    it('supports pagination', async () => {
      const taskHash = 'a'.repeat(64);
      const inHash = 'b'.repeat(64);
      const executionId = uuidv7();
      const logContent = 'ABCDEFGHIJ';

      const execDir = join(testRepo, 'executions', taskHash, inHash, executionId);
      mkdirSync(execDir, { recursive: true });
      writeFileSync(join(execDir, 'stderr.txt'), logContent);

      // Read first 5 bytes
      const chunk1 = await executionReadLog(storage, testRepo, taskHash, inHash, executionId, 'stderr', {
        offset: 0,
        limit: 5,
      });
      assert.strictEqual(chunk1.data, 'ABCDE');
      assert.strictEqual(chunk1.offset, 0);
      assert.strictEqual(chunk1.size, 5);
      assert.strictEqual(chunk1.complete, false);

      // Read next 5 bytes
      const chunk2 = await executionReadLog(storage, testRepo, taskHash, inHash, executionId, 'stderr', {
        offset: 5,
        limit: 5,
      });
      assert.strictEqual(chunk2.data, 'FGHIJ');
      assert.strictEqual(chunk2.offset, 5);
      assert.strictEqual(chunk2.size, 5);
      assert.strictEqual(chunk2.complete, true);
    });
  });

  describe('taskExecute', () => {
    it('returns error for missing command IR', async () => {
      // Create a task object with non-existent command IR hash
      const task = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: 'a'.repeat(64) }), // Non-existent hash
        runner: variant('custom', { command: [] }),
        inputs: [],
        output: { path: [], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      const result = await taskExecute(storage, testRepo, taskHash, []);

      assert.strictEqual(result.state, 'error');
      assert.ok(result.error?.includes('Failed to evaluate command IR'));
    });

    it('executes simple cp command successfully', async () => {
      // Create command IR: cp {input} {output}
      const commandIrHash = await createCommandIr(testRepo, [
        'cp',
        '{input}',
        '{output}',
      ]);

      // Create a task object
      const task = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: commandIrHash }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'test')], partition: none }],
        output: { path: [variant('field', 'output')], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input data
      const inputEncoder = encodeBeast2For(StringType);
      const inputData = inputEncoder('hello world');
      const inputHash = await objectWrite(testRepo, inputData);

      // Execute
      const result = await taskExecute(storage, testRepo, taskHash, [inputHash]);

      assert.strictEqual(result.state, 'success');
      assert.strictEqual(result.cached, false);
      assert.ok(result.outputHash);
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.duration >= 0);
    });

    it('caches successful executions', async () => {
      // Create command IR
      const commandIrHash = await createCommandIr(testRepo, [
        'cp',
        '{input}',
        '{output}',
      ]);

      // Create task
      const task = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: commandIrHash }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'test')], partition: none }],
        output: { path: [variant('field', 'output')], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('test data'));

      // First execution
      const result1 = await taskExecute(storage, testRepo, taskHash, [inputHash]);
      assert.strictEqual(result1.cached, false);
      assert.strictEqual(result1.state, 'success');

      // Second execution should be cached
      const result2 = await taskExecute(storage, testRepo, taskHash, [inputHash]);
      assert.strictEqual(result2.cached, true);
      assert.strictEqual(result2.state, 'success');
      assert.strictEqual(result2.outputHash, result1.outputHash);
      assert.strictEqual(result2.duration, 0);
    });

    it('force bypasses cache', async () => {
      // Create command IR
      const commandIrHash = await createCommandIr(testRepo, [
        'cp',
        '{input}',
        '{output}',
      ]);

      // Create task
      const task = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: commandIrHash }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'test')], partition: none }],
        output: { path: [variant('field', 'output')], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('test data'));

      // First execution
      const result1 = await taskExecute(storage, testRepo, taskHash, [inputHash]);
      assert.strictEqual(result1.cached, false);

      // Force re-execution
      const result2 = await taskExecute(storage, testRepo, taskHash, [inputHash], { force: true });
      assert.strictEqual(result2.cached, false);
      assert.strictEqual(result2.state, 'success');
    });

    it('captures stdout and stderr', async () => {
      // Create command IR that echoes to both streams
      const commandIrHash = await createCommandIr(testRepo, [
        'bash',
        '-c',
        'echo stdout; echo stderr >&2; cp "$1" "$2"',
        '--',
        '{input}',
        '{output}',
      ]);

      // Create task
      const task = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: commandIrHash }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'test')], partition: none }],
        output: { path: [variant('field', 'output')], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      // Create input
      const inputEncoder = encodeBeast2For(StringType);
      const inputHash = await objectWrite(testRepo, inputEncoder('data'));

      // Capture callbacks
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const result = await taskExecute(storage, testRepo, taskHash, [inputHash], {
        onStdout: (data) => stdoutChunks.push(data),
        onStderr: (data) => stderrChunks.push(data),
      });

      assert.strictEqual(result.state, 'success');

      // Check callbacks received data
      assert.ok(stdoutChunks.join('').includes('stdout'));
      assert.ok(stderrChunks.join('').includes('stderr'));

      // Check logs were written
      const inHash = result.inputsHash;
      const executionId = result.executionId;
      const stdoutLog = await executionReadLog(storage, testRepo, taskHash, inHash, executionId, 'stdout');
      const stderrLog = await executionReadLog(storage, testRepo, taskHash, inHash, executionId, 'stderr');

      assert.ok(stdoutLog.data.includes('stdout'));
      assert.ok(stderrLog.data.includes('stderr'));
    });

    it('handles failed commands', async () => {
      // Create command IR that fails
      const commandIrHash = await createCommandIr(testRepo, [
        'bash',
        '-c',
        'exit 42',
      ]);

      // Create task
      const task = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: commandIrHash }),
        runner: variant('custom', { command: [] }),
        inputs: [],
        output: { path: [variant('field', 'output')], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const encoder = encodeBeast2For(TaskObjectType);
      const taskHash = await objectWrite(testRepo, encoder(task));

      const result = await taskExecute(storage, testRepo, taskHash, []);

      assert.strictEqual(result.state, 'failed');
      assert.strictEqual(result.exitCode, 42);
      assert.strictEqual(result.outputHash, null);

      // Check status was written: a task run on its own is its own execution, not a unit
      const status = await executionGet(storage, testRepo, taskHash, result.inputsHash, result.executionId);
      assert.ok(status);
      assert.strictEqual(status.type, 'failed');
      assert.strictEqual(status.value.unit, false);
    });
  });
});

describe('the execution a task\'s logs read (executionFindCurrent)', () => {
  /** A workspace a package of one input and one task over it is deployed
   *  to: the task's hash, and the hash of its current inputs. */
  async function deployed(t: TestContext): Promise<{ storage: InMemoryStorage; task: string; current: string }> {
    const dir = createTempDir();
    t.after(() => removeTempDir(dir));
    const x = e3.input('x', IntegerType, variant('value', 1n));
    const double = e3.task('double', [x], East.function([IntegerType], IntegerType, ($, value) => value.multiply(2n)));
    const zip = join(dir, 'logs.zip');
    await e3.export(e3.package('logs', '1.0.0', x, double), zip);
    const storage = new InMemoryStorage();
    await storage.repos.create('repo');
    await packageImport(storage, 'repo', zip);
    await workspaceCreate(storage, 'repo', 'ws');
    await workspaceDeploy(storage, 'repo', 'ws', 'logs', '1.0.0');
    const task = await workspaceGetTaskHash(storage, 'repo', 'ws', 'double');
    const { hash } = await workspaceGetDatasetHash(storage, 'repo', 'ws', [variant('field', 'inputs'), variant('field', 'x')]);
    assert.ok(hash !== null, 'the input is set');
    return { storage, task, current: inputsHash([hash]) };
  }

  /** An attempt that failed: a split task's unit, when `unit`. */
  function failed(executionId: string, unit = false): ExecutionStatus {
    return variant('failed', { executionId, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit });
  }

  /** Records each call of the store's listings of a task's, or a
   *  repository's, whole history: the lookup reads none of them. */
  function historyReads(storage: InMemoryStorage): string[] {
    const reads: string[] = [];
    const refs = storage.refs;
    const [list, forTask, latest] = [refs.executionList.bind(refs), refs.executionListForTask.bind(refs), refs.executionListLatest.bind(refs)];
    refs.executionList = (repo) => {
      reads.push('executionList');
      return list(repo);
    };
    refs.executionListForTask = (repo, task) => {
      reads.push('executionListForTask');
      return forTask(repo, task);
    };
    refs.executionListLatest = (repo, task) => {
      reads.push('executionListLatest');
      return latest(repo, task);
    };
    return reads;
  }

  it('is the latest attempt over the task\'s current inputs, read without the task\'s history', async (t) => {
    const { storage, task, current } = await deployed(t);
    const [older, newer] = [uuidv7(), uuidv7()];
    for (const id of [older, newer]) await storage.refs.executionWrite('repo', task, current, id, failed(id));
    // A later run, over other inputs: not the current one
    const elsewhere = uuidv7();
    await storage.refs.executionWrite('repo', task, 'b'.repeat(64), elsewhere, failed(elsewhere));
    const reads = historyReads(storage);

    const found = await executionFindCurrent(storage, 'repo', 'ws', 'double');
    assert.deepStrictEqual(found === null ? null : [found.inputsHash, found.executionId, found.isCurrent, found.status.type], [current, newer, true, 'failed']);
    assert.deepStrictEqual(reads, [], 'no listing of the task\'s history');
  });

  it('is the task\'s latest run when no attempt is recorded over its current inputs, never a unit, read from its index of runs', async (t) => {
    const { storage, task } = await deployed(t);
    const [first, second, unit] = [uuidv7(), uuidv7(), uuidv7()];
    await storage.refs.executionWrite('repo', task, 'a'.repeat(64), first, failed(first));
    await storage.refs.executionWrite('repo', task, 'b'.repeat(64), second, failed(second));
    await storage.refs.executionWrite('repo', task, 'c'.repeat(64), unit, failed(unit, true));
    const reads = historyReads(storage);

    const found = await executionFindCurrent(storage, 'repo', 'ws', 'double');
    assert.deepStrictEqual(found === null ? null : [found.inputsHash, found.executionId, found.isCurrent], ['b'.repeat(64), second, false]);
    assert.deepStrictEqual(reads, [], 'no listing of the task\'s history');
  });

  it('is none for a task that has never run', async (t) => {
    const { storage } = await deployed(t);
    assert.strictEqual(await executionFindCurrent(storage, 'repo', 'ws', 'double'), null);
  });
});
