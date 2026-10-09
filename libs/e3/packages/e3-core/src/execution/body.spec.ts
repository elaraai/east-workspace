/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DictType, East, IntegerType, SortedMap, compareFor, variant } from '@elaraai/east';
import e3, { type TaskDef } from '@elaraai/e3';
import { ExecutionAttempt } from './attempt.js';
import { Budget } from './budget.js';
import { LocalTaskRunner, type TaskBodyRequest } from './LocalTaskRunner.js';
import { MockTaskRunner } from './MockTaskRunner.js';
import { readTestPieceBytesFrom } from './pieces.js';
import { LocalOrchestrator } from '../dataflow/orchestrator/LocalOrchestrator.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import { inputsHash } from '../executions.js';
import { packageImport } from '../package-files.js';
import { packageRead } from '../packages.js';
import { LocalStorage } from '../storage/local/index.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { datasetWrite } from '../trees.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';

describe('task body executor', () => {
  let repo: string;
  let storage: LocalStorage;
  const double = East.function([IntegerType], IntegerType, ($, value) => value.multiply(2n));

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
    readTestPieceBytesFrom(() => '64');
  });
  afterEach(() => removeTestRepo(repo));

  async function deploy(task: TaskDef): Promise<string> {
    const zip = join(repo, 'test.zip');
    await e3.export(e3.package('body', '1.0.0', task), zip);
    await packageImport(storage, repo, zip);
    return (await packageRead(storage, repo, 'body', '1.0.0')).tasks.get(task.name)!;
  }

  async function plain(): Promise<{ hash: string; inputs: string[] }> {
    const input = e3.input('input', IntegerType, variant('value', 2n));
    return {
      hash: await deploy(e3.task('double', [input], double)),
      inputs: [await datasetWrite(storage, repo, 2n, IntegerType)],
    };
  }

  it('routes a cache miss once, preserves fallback identity and output, and ignores graph name in cache identity', async () => {
    const { hash, inputs } = await plain();
    const calls: TaskBodyRequest[] = [];
    const runner = new LocalTaskRunner(repo, undefined, { body: (request, local) => {
      calls.push(request);
      return local();
    } });
    const first = await runner.execute(storage, hash, inputs, { taskName: 'double' });
    assert.equal(first.state, 'success', first.error);
    assert.equal(calls.length, 1);
    const request = calls[0]!;
    assert.equal(request.role, 'task');
    assert.equal(request.unit, undefined);
    assert.equal(request.options.taskName, 'double');
    assert.equal(first.executionId, request.ids.executionId);
    const second = await runner.execute(storage, hash, inputs, { taskName: 'another_name' });
    assert.equal(second.cached, true);
    assert.equal(second.executionId, first.executionId);
    assert.equal(calls.length, 1);

    const local = await new LocalTaskRunner(repo).execute(storage, hash, inputs, { force: true });
    assert.equal(local.state, 'success', local.error);
    assert.equal(local.outputHash, first.outputHash);
    for (const stream of ['stdout', 'stderr'] as const) {
      const read = (id: string) => storage.logs.read(repo, hash, inputsHash(inputs), id, stream);
      assert.equal((await read(first.executionId)).data, (await read(local.executionId)).data);
    }
    const status = await storage.refs.executionGet(repo, hash, inputsHash(inputs), first.executionId);
    assert.equal(status?.type, 'success');
    assert.ok(status?.type === 'success' && !status.value.unit);
  });

  it('runs a replacement while the whole local budget is held, and caches its own record', async () => {
    const { hash, inputs } = await plain();
    const budget = new Budget({ cores: 1, memory: 1024 }, { sampler: null });
    const held = await budget.acquire();
    let called = 0;
    try {
      const runner = new LocalTaskRunner(repo, budget, { body: async (request) => {
        called++;
        const output = await datasetWrite(storage, repo, 4n, IntegerType);
        return new ExecutionAttempt(storage, repo, hash, inputs, request.ids, false).recordSuccess(output, 512);
      } });
      const first = await runner.execute(storage, hash, inputs);
      assert.equal(first.state, 'success');
      const latest = await storage.refs.executionGetLatest(repo, hash, inputsHash(inputs));
      assert.equal(latest?.value.executionId, first.executionId);
      assert.equal(latest?.type, 'success');
      const again = await runner.execute(storage, hash, inputs);
      assert.equal(again.cached, true);
      assert.equal(again.peakBytes, 512);
      assert.equal(called, 1);
    } finally {
      held.release();
    }
  });

  for (const kind of ['dict', 'fold'] as const) {
    it(`passes pieces and ${kind} merges with the complete unit, while the engine owns the logical record`, async () => {
      const type = DictType(IntegerType, IntegerType);
      const input = e3.input('rows', type);
      const task = kind === 'dict'
        ? e3.streamTask('counts', {
          inputs: [e3.partition(input)],
          output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
        }, ($, rows, emit) => { $.for(rows, ($, _value, _key) => { $(emit(0n, 1n)); }); })
        : e3.streamTask('total', {
          inputs: [e3.partition(input)],
          output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
        }, ($, rows, emit) => { $.for(rows, ($, _value, _key) => { $(emit(1n)); }); });
      const hash = await deploy(task);
      const rows = new SortedMap(Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
      const inputs = [await datasetWrite(storage, repo, rows, type)];
      const calls: TaskBodyRequest[] = [];
      const runner = new LocalTaskRunner(repo, undefined, { body: (request, local) => {
        calls.push(request);
        return local();
      } });
      const result = await runner.execute(storage, hash, inputs, { taskName: task.name });
      assert.equal(result.state, 'success', result.error);
      assert.ok(calls.filter((c) => c.unit?.merge === null).length > 1);
      assert.ok(calls.some((c) => c.unit?.merge !== null));
      for (const call of calls) {
        assert.equal(call.role, 'unit');
        assert.equal(call.logicalTaskHash, hash);
        assert.equal(call.options.taskName, task.name);
        assert.equal(call.unit?.own, false);
        assert.deepEqual(call.unit.inputs, call.inputHashes);
        assert.notEqual(call.ids.executionId, result.executionId);
      }
      const expected = kind === 'dict'
        ? await datasetWrite(storage, repo, new SortedMap([[0n, 8000n]], compareFor(IntegerType)), type)
        : await datasetWrite(storage, repo, 8000n, IntegerType);
      assert.equal(result.outputHash, expected);

      calls.length = 0;
      const small = [await datasetWrite(storage, repo, new SortedMap([[0n, 1n]], compareFor(IntegerType)), type)];
      const single = await runner.execute(storage, hash, small);
      assert.equal(single.state, 'success', single.error);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.role, 'unit');
      assert.equal(calls[0]!.logicalTaskHash, hash);
      assert.equal(calls[0]!.unit?.own, true);
      assert.equal(calls[0]!.ids.executionId, single.executionId);
    });
  }

  it('carries the graph task name from the orchestrator to an injected runner', async () => {
    const { hash } = await plain();
    await workspaceCreate(storage, repo, 'dev');
    await workspaceDeploy(storage, repo, 'dev', 'body', '1.0.0');
    const runner = new MockTaskRunner();
    runner.setResult(hash, { state: 'success', cached: false, outputHash: await datasetWrite(storage, repo, 4n, IntegerType) });
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    await orchestrator.wait(await orchestrator.start(storage, repo, 'dev', { runner }));
    assert.deepEqual(runner.getCalls().map((call) => call.options?.taskName), ['double']);
  });
});
